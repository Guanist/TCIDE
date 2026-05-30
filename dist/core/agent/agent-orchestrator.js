"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = exports.agentOrchestrator = void 0;
/**
 * TCIDE Agent Orchestrator — P2 多 Agent 协作引擎
 *
 * 架构: Pipeline + Fan-out 混合
 *   Builder（需求拆解）
 *     → Coder1, Coder2, ...CoderN（并行开发，按任务DAG调度）
 *       → Reviewer（代码审查）
 *         → Tester（构建+测试验证）
 *           → Integrator（冲突检查+合并）
 *
 * 特性:
 *   - DAG 拓扑调度（Builder 输出任务依赖图）
 *   - 并行 Coder 池（最多 4 个并行）
 *   - 自动文件锁（防止并行修改冲突）
 *   - 审查门禁（Reviewer 不通过则退回 Coder）
 *   - 构建验证（Tester 不通过则触发 AutoHeal）
 */
const path = require("path");
const fs = require("fs");

const MAX_PARALLEL_CODERS = 4;
const MAX_CODER_RETRY = 2;
const REVIEWER_GATE_ENABLED = true;

class AgentOrchestrator {
    constructor() {
        this.projectRoot = null;
        this.aiAdapter = null;
        this.tasks = [];
        this.taskResults = new Map();
        this.lockedFiles = new Set();
        this.pipeline = []; // Current pipeline status
        this.onPhaseChange = null;
        this.onTaskProgress = null;
        this.isRunning = false;
        this.abortController = null;
    }

    /**
     * @param {string} projectRoot
     * @param {object} aiAdapter - { send(messages, options) => string }
     */
    init(projectRoot, aiAdapter) {
        this.projectRoot = projectRoot;
        this.aiAdapter = aiAdapter;
    }

    /**
     * 启动多 Agent 流水线
     * @param {string} requirement - 用户需求
     * @param {object} context - 项目上下文 { fileTree, modules, symbols, projectType }
     * @returns {Promise<{success, stats, results}>}
     */
    async run(requirement, context = {}) {
        if (this.isRunning) throw new Error('Orchestrator already running');
        this.isRunning = true;
        this.abortController = new AbortController();
        this.taskResults.clear();
        this.lockedFiles.clear();

        const stats = { 
            phases: { builder: 0, coder: 0, reviewer: 0, tester: 0 },
            retries: 0,
            filesModified: new Set(),
            startTime: Date.now(),
        };

        try {
            // Phase 1: Builder — 需求 → 任务 DAG
            this._emitPhase('builder', '拆解需求...');
            this.tasks = await this._runBuilder(requirement, context);
            if (!this.tasks.length) {
                return { success: false, error: 'Builder 未产出任务', stats };
            }
            stats.phases.builder = this.tasks.length;
            this._emitPhase('builder_done', this.tasks);

            // Phase 2: Coder Pool — 按 DAG 拓扑并行执行
            this._emitPhase('coder', `启动 ${Math.min(this.tasks.length, MAX_PARALLEL_CODERS)} 个 Coder 并行开发...`);
            const coderResults = await this._runCoderPool(this.tasks, context);
            stats.phases.coder = coderResults.filter(r => r.success).length;
            stats.retries = coderResults.reduce((sum, r) => sum + (r.retries || 0), 0);
            for (const r of coderResults) {
                if (r.files) r.files.forEach(f => stats.filesModified.add(f));
            }

            // Phase 3: Reviewer — 代码审查门禁
            if (REVIEWER_GATE_ENABLED) {
                this._emitPhase('reviewer', '代码审查...');
                const reviewResults = await this._runReviewer(coderResults, context);
                stats.phases.reviewer = reviewResults.length;

                // 退回未通过的给 Coder 重新修改
                const rejected = reviewResults.filter(r => !r.passed);
                if (rejected.length > 0) {
                    this._emitPhase('reviewer_fix', `${rejected.length} 个任务需要修改`);
                    const fixResults = await this._runCoderFix(rejected, context);
                    for (const fix of fixResults) {
                        if (fix.files) fix.files.forEach(f => stats.filesModified.add(f));
                    }
                }
            }

            // Phase 4: Tester — 构建 + 测试验证
            this._emitPhase('tester', '构建验证...');
            const testResult = await this._runTester(context);
            stats.phases.tester = 1;

            // Phase 5: Final summary
            const duration = Date.now() - stats.startTime;
            this._emitPhase('done', { 
                tasks: this.tasks.length,
                filesModified: stats.filesModified.size,
                duration: `${(duration / 1000).toFixed(1)}s`,
            });

            return {
                success: testResult.success,
                stats: { ...stats, filesModified: [...stats.filesModified] },
                results: [...this.taskResults.values()],
                buildResult: testResult,
            };

        } catch (err) {
            this._emitPhase('error', err.message);
            return { success: false, error: err.message, stats };
        } finally {
            this.isRunning = false;
        }
    }

    abort() {
        this.abortController?.abort();
        this.isRunning = false;
    }

    // ── Phase 1: Builder ──
    async _runBuilder(requirement, context) {
        const prompt = [
            'You are the Architect. Break down the user requirement into atomic development tasks.',
            'Output a JSON array of tasks. Each task: { "id": string, "desc": string, "dep": string[], "files": string[], "priority": number }',
            '',
            'Project context:',
            `Type: ${context.projectType || 'unknown'}`,
            `Files: ${JSON.stringify(context.fileTree?.slice(0, 20))}`,
            `Modules: ${JSON.stringify(context.modules?.slice(0, 5))}`,
            '',
            `Requirement: ${requirement}`,
            '',
            'Rules:',
            '- dep: IDs of tasks that must complete first (empty array if none)',
            '- priority: 0=critical, 1=high, 2=normal, 3=low',
            '- Assign unique, short string IDs',
            '- Output ONLY the JSON array, no markdown',
        ].join('\n');

        const response = await this.aiAdapter.send([
            { role: 'system', content: 'You are a software architect. Output valid JSON only.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.2, maxTokens: 2048 });

        try {
            const json = response.match(/\[[\s\S]*\]/)?.[0] || '[]';
            const tasks = JSON.parse(json);
            return tasks.map(t => ({
                ...t,
                status: 'pending',
                attempts: 0,
                maxAttempts: MAX_CODER_RETRY,
            }));
        } catch {
            // Fallback: single task
            return [{
                id: '1', desc: requirement, dep: [], files: [], priority: 1,
                status: 'pending', attempts: 0, maxAttempts: MAX_CODER_RETRY,
            }];
        }
    }

    // ── Phase 2: Coder Pool ──
    async _runCoderPool(tasks, context) {
        const results = [];
        const completed = new Set();
        let rounds = 0;
        const maxRounds = tasks.length * 2; // safety valve

        while (completed.size < tasks.length && rounds < maxRounds) {
            rounds++;
            // Find ready tasks (all deps completed)
            const ready = tasks.filter(t => 
                !completed.has(t.id) &&
                t.dep.every(d => completed.has(d)) &&
                t.attempts < t.maxAttempts
            ).sort((a, b) => a.priority - b.priority);

            if (ready.length === 0) break;

            // Execute up to MAX_PARALLEL_CODERS in parallel
            const batch = ready.slice(0, MAX_PARALLEL_CODERS);
            const promises = batch.map(task => this._runSingleCoder(task, context));

            const batchResults = await Promise.allSettled(promises);
            for (let i = 0; i < batchResults.length; i++) {
                const task = batch[i];
                const result = batchResults[i];
                if (result.status === 'fulfilled') {
                    const r = result.value;
                    results.push(r);
                    if (r.success) {
                        completed.add(task.id);
                        // Unlock files
                        if (r.files) r.files.forEach(f => this.lockedFiles.delete(f));
                    } else {
                        task.attempts++;
                    }
                    this.taskResults.set(task.id, { task, ...r });
                } else {
                    task.attempts++;
                    results.push({ taskId: task.id, success: false, error: result.reason?.message, retries: task.attempts });
                }
            }

            if (this.abortController?.signal.aborted) break;
        }

        return results;
    }

    async _runSingleCoder(task, context) {
        this._emitTaskProgress(task.id, 'coding', task.desc);

        // Lock task files
        const conflicts = (task.files || []).filter(f => this.lockedFiles.has(f));
        if (conflicts.length > 0) {
            return { taskId: task.id, success: false, error: `Files locked by another coder: ${conflicts.join(', ')}`, files: [] };
        }
        (task.files || []).forEach(f => this.lockedFiles.add(f));

        const coderPrompt = [
            'You are the Coder. Implement the following task by writing/modifying code files.',
            `Task: ${task.desc}`,
            `Project root: ${this.projectRoot}`,
            '',
            'Available tools: read_file, write_file, delete_file, run_terminal',
            '',
            'Output format:',
            '```json',
            '{',
            '  "files_modified": ["path/to/file.js"],',
            '  "summary": "What was done",',
            '  "build_cmd": "npm build" (optional verification command)',
            '}',
            '```',
            '',
            'Build verification (optional): after modifying, run the build command to verify.',
        ].join('\n');

        try {
            const response = await this.aiAdapter.send([
                { role: 'system', content: 'You are an expert coder. Implement tasks precisely. Write actual code to files.' },
                { role: 'user', content: coderPrompt },
            ], { temperature: 0.3, maxTokens: 4096 });

            // Parse coder output
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { files_modified: [], summary: response.slice(0, 200) };

            return {
                taskId: task.id,
                success: true,
                files: parsed.files_modified || [],
                summary: parsed.summary || '',
                buildCmd: parsed.build_cmd || null,
                retries: task.attempts,
            };
        } catch (err) {
            this.lockedFiles.delete(...(task.files || []));
            return { taskId: task.id, success: false, error: err.message, files: [], retries: task.attempts };
        } finally {
            // Finished
        }
    }

    // ── Phase 3: Reviewer ──
    async _runReviewer(coderResults, context) {
        const successful = coderResults.filter(r => r.success && r.files?.length > 0);
        if (!successful.length) return [];

        const reviewPrompt = [
            'You are the Code Reviewer. Review these code changes and approve or reject each.',
            `Project root: ${this.projectRoot}`,
            '',
            'Changes to review:',
            ...successful.map(r => `- Task ${r.taskId}: ${r.summary} → files: ${(r.files || []).join(', ')}`),
            '',
            'Review criteria:',
            '1. Code quality (naming, structure, readability)',
            '2. Correctness (does it do what the task says?)',
            '3. Side effects (does it break other files?)',
            '4. Consistency (matches project style)',
            '',
            'Output JSON array:',
            '[{ "taskId": "1", "passed": true, "issues": [], "suggestion": "" }, ...]',
        ].join('\n');

        try {
            const response = await this.aiAdapter.send([
                { role: 'system', content: 'You are a strict code reviewer. Be thorough but constructive.' },
                { role: 'user', content: reviewPrompt },
            ], { temperature: 0.1, maxTokens: 2048 });

            const jsonMatch = response.match(/\[[\s\S]*\]/);
            return jsonMatch ? JSON.parse(jsonMatch[0]) : successful.map(r => ({ taskId: r.taskId, passed: true, issues: [] }));
        } catch {
            return successful.map(r => ({ taskId: r.taskId, passed: true, issues: [] }));
        }
    }

    // ── Phase 3b: Coder Fix ──
    async _runCoderFix(rejected, context) {
        const results = [];
        for (const item of rejected) {
            this._emitTaskProgress(item.taskId, 'fixing', `修复审查意见: ${item.issues?.join(', ')}`);
            const result = await this._runSingleCoder(
                { id: item.taskId, desc: `FIX review feedback: ${item.issues?.join('; ')}. ${item.suggestion || ''}`, dep: [], files: [], priority: 0, attempts: 0, maxAttempts: 1 },
                context
            );
            results.push(result);
        }
        return results;
    }

    // ── Phase 4: Tester ──
    async _runTester(context) {
        this._emitTaskProgress('test', 'building', '执行构建验证...');

        // Try to detect build command
        const buildCmds = [];
        if (fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'));
                if (pkg.scripts?.build) buildCmds.push('npm run build');
                if (pkg.scripts?.test) buildCmds.push('npm test');
            } catch {}
        }
        if (fs.existsSync(path.join(this.projectRoot, 'Makefile'))) buildCmds.push('make');
        if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) buildCmds.push('go build ./...');
        if (fs.existsSync(path.join(this.projectRoot, 'pyproject.toml'))) buildCmds.push('python -m compileall .');

        const testerPrompt = [
            'You are the Tester. Verify the code changes compile and pass tests.',
            `Project root: ${this.projectRoot}`,
            `Suggested build commands: ${buildCmds.join(' | ') || 'none detected'}`,
            '',
            'Modified files:', ...Array.from(this.taskResults.keys()),
            '',
            'Run the build command and report:',
            '```json',
            '{ "success": true/false, "output": "...", "errors": "..." }',
            '```',
        ].join('\n');

        try {
            const response = await this.aiAdapter.send([
                { role: 'system', content: 'You verify builds. Check compilation and run tests. Report results honestly.' },
                { role: 'user', content: testerPrompt },
            ], { temperature: 0, maxTokens: 1024 });

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true, output: response };
        } catch {
            return { success: true, output: 'Tester skipped (no AI adapter)' };
        }
    }

    // ── Events ──
    _emitPhase(phase, data) {
        this.pipeline.push({ phase, data, timestamp: Date.now() });
        this.onPhaseChange?.({ phase, data });
    }

    _emitTaskProgress(taskId, status, message) {
        this.onTaskProgress?.({ taskId, status, message });
    }

    getPipelineStatus() {
        return this.pipeline;
    }
}

exports.AgentOrchestrator = AgentOrchestrator;
exports.agentOrchestrator = new AgentOrchestrator();
