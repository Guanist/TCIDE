"use strict";
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") result[k[i]] = mod[k];
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnattendedRunner = exports.unattendedRunner = void 0;
/**
 * TCIDE UnattendedRunner — P2 无人值守自治执行器
 *
 * 核心循环:
 *   Checkpoint → Execute → Validate → (pass: advance | fail: rollback + retry)
 *
 * 特性:
 *   - 快照还原点 (每步自动创建)
 *   - 自验证循环 (lint/build/test)
 *   - 自动回滚 (验证失败时还原到上一快照)
 *   - 执行日志 (全链路可追溯)
 *   - 超时熔断 (单任务/全局超时保护)
 *   - 人机交互暂停点 (关键决策需要人工确认)
 */
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const MAX_RETRIES = 3;
const STEP_TIMEOUT = 120000; // 2 minutes per step
const GLOBAL_TIMEOUT = 1800000; // 30 minutes total
const MAX_CHECKPOINTS = 50;

class UnattendedRunner {
    constructor() {
        this.projectRoot = null;
        this.checkpoints = []; // [{id, timestamp, description, backup: Map<filePath, content>}]
        this.log = []; // [{timestamp, level, message, stepId}]
        this.currentStep = 0;
        this.totalSteps = 0;
        this.isRunning = false;
        this.abortController = null;
        this.globalTimeout = null;
        this.onLog = null;
        this.onStepChange = null;
        this.requireConfirmation = null; // callback for human-in-the-loop
    }

    /**
     * @param {string} projectRoot
     * @param {object} options
     * @param {Function} options.requireConfirmation — async (message, context) => boolean
     */
    init(projectRoot, options = {}) {
        this.projectRoot = projectRoot;
        if (options.requireConfirmation) this.requireConfirmation = options.requireConfirmation;

        const logDir = path.join(projectRoot, '.tcide', 'unattended');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    }

    /**
     * 执行一个任务计划
     * @param {Array<{id, desc, action: Function}>} plan — 步骤列表
     * @returns {Promise<{success, completedSteps, failedSteps, log}>}
     */
    async execute(plan, options = {}) {
        if (this.isRunning) throw new Error('Runner already executing');
        this.isRunning = true;
        this.abortController = new AbortController();
        this.checkpoints = [];
        this.log = [];
        this.currentStep = 0;
        this.totalSteps = plan.length;

        const stats = { completedSteps: 0, failedSteps: 0, retriedSteps: 0, checkpoints: 0 };

        // Global timeout
        this._log('info', `开始执行 ${plan.length} 个步骤`, 'system');
        this.globalTimeout = setTimeout(() => {
            this._log('warn', '全局超时，终止执行', 'system');
            this.abort();
        }, GLOBAL_TIMEOUT);

        for (let i = 0; i < plan.length; i++) {
            if (this.abortController.signal.aborted) break;

            const step = plan[i];
            this.currentStep = i + 1;
            this._log('info', `[${i+1}/${plan.length}] ${step.desc}`, step.id);
            this.onStepChange?.({ current: i + 1, total: plan.length, stepId: step.id, desc: step.desc });

            // Human-in-the-loop for critical steps
            if (step.critical && this.requireConfirmation) {
                const ok = await this.requireConfirmation(`确认执行关键步骤: ${step.desc}`, { step });
                if (!ok) {
                    this._log('warn', `用户跳过关键步骤: ${step.desc}`, step.id);
                    stats.failedSteps++;
                    continue;
                }
            }

            // Checkpoint before each step
            const ckId = await this._checkpoint(step.id, step.desc);
            stats.checkpoints++;

            let success = false;
            let retries = 0;

            while (retries <= MAX_RETRIES && !success) {
                if (this.abortController.signal.aborted) break;
                if (retries > 0) {
                    stats.retriedSteps++;
                    this._log('warn', `重试 ${retries}/${MAX_RETRIES}: ${step.desc}`, step.id);
                }

                try {
                    // Execute step with timeout
                    const result = await this._withTimeout(
                        step.action(this.projectRoot, { step, runner: this }),
                        STEP_TIMEOUT
                    );

                    // Validate
                    const validation = await this._validate(step);
                    if (validation.passed) {
                        success = true;
                        stats.completedSteps++;
                        this._log('info', `✓ 完成: ${step.desc}`, step.id);
                    } else {
                        this._log('warn', `验证失败: ${validation.errors.join('; ')}`, step.id);
                        // Rollback
                        if (retries < MAX_RETRIES) {
                            await this._rollback(ckId);
                            this._log('info', `已回滚到快照 ${ckId}`, step.id);
                        }
                    }
                } catch (err) {
                    this._log('error', `执行失败: ${err.message}`, step.id);
                    if (retries < MAX_RETRIES) {
                        await this._rollback(ckId);
                        this._log('info', `已回滚到快照 ${ckId}`, step.id);
                    }
                }

                retries++;
            }

            if (!success) {
                stats.failedSteps++;
                this._log('error', `✗ 放弃: ${step.desc} (已重试${MAX_RETRIES}次)`, step.id);
                if (step.fatal) {
                    this._log('error', '致命步骤失败，终止执行', 'system');
                    break;
                }
            }
        }

        clearTimeout(this.globalTimeout);
        this.isRunning = false;
        this._log('info', `执行结束: ${stats.completedSteps}/${plan.length} 完成, ${stats.failedSteps} 失败, ${stats.retriedSteps} 次重试`, 'system');

        // Save execution log
        this._saveLog();

        return {
            success: stats.failedSteps === 0,
            ...stats,
            log: this.log,
        };
    }

    abort() {
        this.abortController?.abort();
        this.isRunning = false;
        clearTimeout(this.globalTimeout);
    }

    // ── Checkpoints ──
    async _checkpoint(stepId, description) {
        const id = `ck_${Date.now()}_${this.checkpoints.length}`;
        const backup = new Map();

        // Snapshot tracked files
        const manifestFile = path.join(this.projectRoot, '.tcide', 'unattended', `manifest_${id}.json`);
        const files = this._getTrackedFiles();

        for (const file of files) {
            try {
                backup.set(file, fs.readFileSync(path.join(this.projectRoot, file), 'utf-8'));
            } catch { /* file might not exist yet */ }
        }

        this.checkpoints.push({ id, stepId, timestamp: Date.now(), description, backup });
        if (this.checkpoints.length > MAX_CHECKPOINTS) {
            // Prune oldest checkpoint (keep backup files though)
            const old = this.checkpoints.shift();
            // Old backups can be cleaned, but we keep for safety
        }

        // Persist checkpoint manifest
        fs.writeFileSync(manifestFile, JSON.stringify({
            id, stepId, description, timestamp: Date.now(),
            files: [...backup.keys()],
        }, null, 2), 'utf-8');

        return id;
    }

    async _rollback(checkpointId) {
        const ck = this.checkpoints.find(c => c.id === checkpointId);
        if (!ck) return;

        for (const [file, content] of ck.backup) {
            try {
                const fullPath = path.join(this.projectRoot, file);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(fullPath, content, 'utf-8');
            } catch (err) {
                this._log('error', `回滚文件失败 ${file}: ${err.message}`, 'system');
            }
        }
    }

    // ── Validation ──
    async _validate(step) {
        const errors = [];
        const warnings = [];

        // 1. Lint check (if ESLint available)
        if (step.validate?.lint) {
            try {
                const result = child_process.execSync('npx eslint . --format json 2>&1 || true', {
                    cwd: this.projectRoot, timeout: 30000, encoding: 'utf-8',
                });
                try {
                    const parsed = JSON.parse(result);
                    const errCount = parsed.reduce((sum, f) => sum + (f.errorCount || 0), 0);
                    if (errCount > 0) errors.push(`${errCount} lint errors`);
                    const warnCount = parsed.reduce((sum, f) => sum + (f.warningCount || 0), 0);
                    if (warnCount > 0) warnings.push(`${warnCount} lint warnings`);
                } catch {
                    // Not JSON (ESLint not run or error)
                }
            } catch { /* ESlint not available */ }
        }

        // 2. TypeScript check
        if (step.validate?.tsc && fs.existsSync(path.join(this.projectRoot, 'tsconfig.json'))) {
            try {
                child_process.execSync('npx tsc --noEmit 2>&1', {
                    cwd: this.projectRoot, timeout: 60000, encoding: 'utf-8',
                });
            } catch (e) {
                const tsErrors = e.stdout || e.stderr || '';
                const errLines = tsErrors.split('\n').filter(l => l.includes('error TS')).length;
                if (errLines > 0) errors.push(`${errLines} TypeScript errors`);
            }
        }

        // 3. Build
        if (step.validate?.build) {
            const buildCmd = step.validate.buildCmd || this._detectBuildCmd();
            if (buildCmd) {
                try {
                    child_process.execSync(buildCmd, {
                        cwd: this.projectRoot, timeout: 60000, encoding: 'utf-8',
                    });
                } catch (e) {
                    errors.push(`Build failed: ${(e.message || '').slice(0, 100)}`);
                }
            }
        }

        // 4. Custom validation function
        if (step.validate?.custom) {
            try {
                const result = await step.validate.custom(this.projectRoot);
                if (!result.passed) {
                    errors.push(result.message || 'Custom validation failed');
                }
            } catch (e) {
                errors.push(`Custom validation error: ${e.message}`);
            }
        }

        return { passed: errors.length === 0, errors, warnings };
    }

    // ── Helpers ──
    _getTrackedFiles() {
        const files = [];
        const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.tcide']);
        const walk = (dir, depth) => {
            if (depth > 5 || files.length > 500) return;
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (skip.has(entry.name)) continue;
                    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(fullPath, depth + 1);
                    else files.push(path.relative(this.projectRoot, fullPath));
                }
            } catch {}
        };
        walk(this.projectRoot, 0);
        return files.slice(0, 500);
    }

    _detectBuildCmd() {
        if (fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'));
                if (pkg.scripts?.build) return 'npm run build';
            } catch {}
        }
        if (fs.existsSync(path.join(this.projectRoot, 'Makefile'))) return 'make';
        if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) return 'go build ./...';
        return null;
    }

    async _withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Step timeout after ${ms}ms`)), ms);
        });
        try {
            const result = await Promise.race([promise, timeout]);
            clearTimeout(timer);
            return result;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    _log(level, message, stepId) {
        const entry = { timestamp: Date.now(), level, message, stepId };
        this.log.push(entry);
        this.onLog?.(entry);
    }

    _saveLog() {
        try {
            const logPath = path.join(this.projectRoot, '.tcide', 'unattended', `run_${Date.now()}.json`);
            fs.writeFileSync(logPath, JSON.stringify({
                startedAt: this.log[0]?.timestamp,
                steps: { total: this.totalSteps, completed: this.currentStep },
                entries: this.log,
            }, null, 2), 'utf-8');
        } catch {}
    }

    /**
     * 获取历史执行记录
     */
    getHistory(limit = 10) {
        const logDir = path.join(this.projectRoot, '.tcide', 'unattended');
        if (!fs.existsSync(logDir)) return [];
        try {
            return fs.readdirSync(logDir)
                .filter(f => f.startsWith('run_') && f.endsWith('.json'))
                .sort()
                .reverse()
                .slice(0, limit)
                .map(f => {
                    try {
                        return JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf-8'));
                    } catch { return null; }
                })
                .filter(Boolean);
        } catch { return []; }
    }
}

exports.UnattendedRunner = UnattendedRunner;
exports.unattendedRunner = new UnattendedRunner();
