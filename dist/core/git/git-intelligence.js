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
exports.GitIntelligence = exports.gitIntelligence = void 0;
/**
 * TCIDE Git Intelligence — P1 Git 智能增强
 *
 * 能力:
 *   - 智能 Commit Message 生成 (约定式提交 + AI 语义总结)
 *   - 代码变更摘要 & 风险评估 (文件级 + 函数级变更分析)
 *   - 分支合并冲突智能解析 (冲突类型识别 + 推荐策略)
 *   - Git Blame 增强 (热力图 + 代码区域负责人)
 */
const child_process = require("child_process");
const path = require("path");
const fs = require("fs");

const CONVENTIONAL_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

class GitIntelligence {
    constructor() {
        this.aiSummarizeFn = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
    }

    setAISummarize(fn) {
        this.aiSummarizeFn = fn;
    }

    // ── 1. 智能 Commit Message 生成 ──
    /**
     * @param {string} projectRoot
     * @param {object} options - { style: 'conventional'|'simple', useAI: boolean, maxLength: number }
     * @returns {Promise<{message: string, breakdown: Array<{type: string, scope: string, short: string}>, rawDiff: string}>}
     */
    async generateCommitMessage(projectRoot, options = {}) {
        const { style = 'conventional', useAI = true, maxLength = 72 } = options;

        // Stage & get diff
        let stagedDiff = '';
        try {
            stagedDiff = this._exec('git diff --cached --stat', projectRoot);
        } catch {}

        if (!stagedDiff.trim()) {
            try {
                stagedDiff = this._exec('git diff --stat', projectRoot);
            } catch {}
            if (!stagedDiff.trim()) {
                return { message: 'chore: minor update', breakdown: [], rawDiff: '' };
            }
        }

        const rawDiff = this._exec('git diff --cached -U3', projectRoot) || this._exec('git diff -U3', projectRoot);
        const statLines = stagedDiff.split('\n').filter(l => l.includes('|'));
        const changedFiles = this._parseChangedFiles(statLines);

        // 规则引擎生成
        let message = '';
        let breakdown = [];

        if (style === 'conventional') {
            breakdown = this._conventionalBreakdown(changedFiles, rawDiff);
            message = this._formatConventional(breakdown, maxLength);
        } else {
            breakdown = this._simpleBreakdown(changedFiles);
            message = this._formatSimple(breakdown, maxLength);
        }

        // AI 增强
        if (useAI && this.aiSummarizeFn) {
            try {
                const aiMessage = await this._aiGenerateMessage(changedFiles, rawDiff.slice(0, 3000));
                if (aiMessage && aiMessage.length > 5) {
                    message = aiMessage; // AI output takes priority
                }
            } catch {}
        }

        return { message: message.slice(0, maxLength), breakdown, rawDiff };
    }

    // ── 2. 代码变更摘要 & 风险评估 ──
    /**
     * @returns {Promise<{summary: string, risk: string, riskScore: number, riskyFiles: Array<{file, reason, severity}>, warnings: string[], stats: object}>}
     */
    async analyzeChanges(projectRoot, baseRef = 'HEAD~1', headRef = 'HEAD') {
        const results = {
            summary: '',
            risk: 'low',
            riskScore: 0,
            riskyFiles: [],
            warnings: [],
            stats: { files: 0, additions: 0, deletions: 0, binary: 0 },
        };

        try {
            // Diff stats
            const diffStat = this._exec(`git diff ${baseRef} ${headRef} --stat`, projectRoot);
            const statLines = diffStat.split('\n');
            const lastLine = statLines[statLines.length - 2] || '';
            const statMatch = lastLine.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
            if (statMatch) {
                results.stats.files = parseInt(statMatch[1]) || 0;
                results.stats.additions = parseInt(statMatch[2]) || 0;
                results.stats.deletions = parseInt(statMatch[3]) || 0;
            }

            // Get file-level changes
            const files = this._parseChangedFiles(statLines.filter(l => l.includes('|')));
            const riskyFiles = [];

            for (const file of files) {
                const warnings = [];

                // Risk: large changes (>200 lines)
                if (file.changes > 200) {
                    warnings.push({ reason: `Large change (${file.changes} lines)`, severity: 'medium' });
                }

                // Risk: config files
                if (file.file.match(/package\.json|\.env|tsconfig|\.lock|dockerfile/i)) {
                    warnings.push({ reason: 'Critical config file changed', severity: 'high' });
                }

                // Risk: database migration / schema
                if (file.file.includes('migration') || file.file.includes('schema') || file.file.endsWith('.sql')) {
                    warnings.push({ reason: 'Database schema change', severity: 'high' });
                }

                // Risk: security-related
                if (file.file.includes('auth') || file.file.includes('security') || file.file.includes('permission')) {
                    warnings.push({ reason: 'Security-related change', severity: 'medium' });
                }

                // Risk: new binary files
                if (file.isBinary) {
                    warnings.push({ reason: 'Binary file added', severity: 'medium' });
                    results.stats.binary++;
                }

                // Risk: deleted files
                if (file.deleted) {
                    warnings.push({ reason: 'File deleted', severity: 'medium' });
                }

                for (const w of warnings) {
                    riskyFiles.push({ file: file.file, ...w });
                    results.warnings.push(`[${w.severity.toUpperCase()}] ${file.file}: ${w.reason}`);
                }
            }

            // Calculate overall risk
            const highCount = riskyFiles.filter(f => f.severity === 'high').length;
            const mediumCount = riskyFiles.filter(f => f.severity === 'medium').length;
            results.riskScore = Math.min(100, highCount * 20 + mediumCount * 5 + files.length * 2);
            results.risk = results.riskScore > 50 ? 'high' : results.riskScore > 20 ? 'medium' : 'low';
            results.riskyFiles = riskyFiles;

            // Generate summary
            results.summary = this._generateSummary(files, results.stats);

        } catch (err) {
            results.summary = 'Unable to analyze changes: ' + err.message;
            results.risk = 'unknown';
        }

        return results;
    }

    // ── 3. 分支合并冲突智能解析 ──
    /**
     * @returns {Promise<{hasConflicts: boolean, conflicts: Array<{file, type, oursLines: number, theirsLines: number, recommendation: string}>, mergeBase: string}>}
     */
    async analyzeConflicts(projectRoot, branch) {
        const result = {
            hasConflicts: false,
            conflicts: [],
            mergeBase: '',
        };

        try {
            result.mergeBase = this._exec(`git merge-base HEAD ${branch}`, projectRoot).trim();

            // Test merge
            const mergeMsg = this._exec(`git merge --no-commit --no-ff ${branch} 2>&1 || true`, projectRoot);
            if (mergeMsg.includes('CONFLICT')) {
                result.hasConflicts = true;

                const diffCheck = this._exec('git diff --name-only --diff-filter=U', projectRoot);
                const conflictedFiles = diffCheck.split('\n').filter(f => f.trim());

                for (const file of conflictedFiles) {
                    try {
                        const conflict = this._analyzeFileConflict(projectRoot, file);
                        result.conflicts.push(conflict);
                    } catch {
                        result.conflicts.push({
                            file,
                            type: 'unknown',
                            recommendation: 'Manual resolution required',
                        });
                    }
                }

                // Reset
                this._exec('git merge --abort', projectRoot);
            }
        } catch {
            // Could not analyze, clean up
            try { this._exec('git merge --abort', projectRoot); } catch {}
        }

        return result;
    }

    // ── 4. Git Blame 增强 — 代码热力图 ──
    /**
     * @returns {Promise<Array<{line, author, date, age: 'hot'|'warm'|'cold', hash}>>}
     */
    async blameHeatmap(projectRoot, filePath) {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
        const results = [];

        try {
            const blame = this._exec(`git blame --line-porcelain "${absPath}"`, projectRoot);
            const chunks = blame.split('\n');

            let current = null;
            for (const line of chunks) {
                if (line.match(/^[0-9a-f]{40}/)) {
                    current = { hash: line.split(' ')[0], line: 0, author: '', date: '', age: 'cold' };
                } else if (current && line.startsWith('author ')) {
                    current.author = line.slice(7);
                } else if (current && line.startsWith('author-time ')) {
                    current.date = new Date(parseInt(line.slice(12)) * 1000).toISOString().slice(0, 10);
                    const daysOld = (Date.now() - parseInt(line.slice(12)) * 1000) / 86400000;
                    current.age = daysOld < 3 ? 'hot' : daysOld < 14 ? 'warm' : 'cold';
                } else if (current && line.startsWith('\t')) {
                    current.line = results.length + 1;
                    results.push({ ...current });
                    current = null;
                }
            }
        } catch (err) {
            console.warn('[GitIntelligence] Blame failed:', err.message);
        }

        return results;
    }

    /**
     * 获取文件的主要贡献者
     */
    async getFileOwners(projectRoot, filePath) {
        const heatmap = await this.blameHeatmap(projectRoot, filePath);
        const authorLines = {};
        for (const entry of heatmap) {
            if (!authorLines[entry.author]) authorLines[entry.author] = 0;
            authorLines[entry.author]++;
        }
        const total = heatmap.length || 1;
        const sorted = Object.entries(authorLines)
            .sort((a, b) => b[1] - a[1])
            .map(([author, lines]) => ({
                author,
                lines,
                percentage: Math.round(lines / total * 100),
            }));
        return sorted.slice(0, 5);
    }

    // ── 5. 变更时间线 ──
    async getChangelog(projectRoot, days = 7) {
        const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const log = this._exec(`git log --since="${since}" --pretty=format:"%h|%an|%ad|%s" --date=short`, projectRoot);
        return log.split('\n').filter(l => l).map(l => {
            const [hash, author, date, ...msg] = l.split('|');
            return { hash, author, date, message: msg.join('|') };
        });
    }

    // ── 私有方法 ──

    _exec(cmd, cwd) {
        try {
            return child_process.execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
        } catch (e) {
            return e.stdout || e.stderr || '';
        }
    }

    _parseChangedFiles(statLines) {
        return statLines.map(line => {
            const parts = line.trim().split(/\s+\|\s+/);
            if (parts.length >= 2) {
                const file = parts[0].trim();
                const stats = parts[1].trim();
                const isBinary = stats === 'Bin';
                const changes = isBinary ? 0 : (() => {
                    let total = 0;
                    const plusMatch = stats.match(/(\d+)\s*\+/);
                    const minusMatch = stats.match(/(\d+)\s*\-/);
                    if (plusMatch) total += parseInt(plusMatch[1]);
                    if (minusMatch) total += parseInt(minusMatch[1]);
                    return total;
                })();
                const deleted = stats.includes(' 0 ');
                return { file, changes, isBinary, deleted };
            }
            return { file: line.trim(), changes: 0, isBinary: false, deleted: false };
        }).filter(f => f.file);
    }

    _conventionalBreakdown(files, diff) {
        const breakdown = [];
        // Classify by type
        const fileTypes = new Map();

        for (const file of files) {
            const f = file.file;
            let type = 'chore';
            let scope = '';

            if (f.startsWith('test') || f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')) {
                type = 'test';
            } else if (f.endsWith('.md') || f.endsWith('.txt')) {
                type = 'docs';
            } else if (f.includes('.css') || f.includes('.scss') || f.includes('.less') || f.includes('.svg')) {
                type = 'style';
            } else if (f.includes('.config.') || f.includes('.json') || f.includes('Dockerfile') || f.includes('ci/') || f.startsWith('.github/')) {
                type = 'build';
            } else if (f.includes('fix') || diff?.includes('fix') || diff?.includes('bug')) {
                type = 'fix';
            } else if (f.match(/\.(js|ts|py|go|rs|java|kt|vue)$/)) {
                type = 'feat';
            } else if (f.match(/\.lock$/)) {
                type = 'chore';
            }

            // Scope from directory
            const dir = path.dirname(f);
            scope = dir === '.' ? '' : dir.split('/')[0] || dir.split('\\')[0] || '';

            if (!fileTypes.has(type)) fileTypes.set(type, { type, scope, files: [], totalChanges: 0 });
            const entry = fileTypes.get(type);
            entry.files.push(f);
            entry.totalChanges += file.changes;
        }

        // Merge into one (or few) conventional commits
        for (const [type, entry] of fileTypes) {
            const short = entry.files.length <= 3
                ? entry.files.map(f => path.basename(f)).join(', ')
                : `${entry.files.length} files (${entry.totalChanges} lines)`;
            breakdown.push({ type, scope: entry.scope || entry.files[0]?.split('/')[0] || '', short });
        }

        return breakdown;
    }

    _formatConventional(breakdown, maxLength) {
        if (breakdown.length === 0) return 'chore: minor update';

        const primary = breakdown[0];
        let message = `${primary.type}${primary.scope ? `(${primary.scope})` : ''}: ${primary.short}`;

        if (breakdown.length > 1) {
            message += ` (+${breakdown.length - 1} more changes)`;
        }

        return message.slice(0, maxLength);
    }

    _simpleBreakdown(files) {
        return [{ type: 'update', scope: '', short: `${files.length} files changed` }];
    }

    _formatSimple(breakdown, maxLength) {
        return (breakdown[0]?.short || 'minor update').slice(0, maxLength);
    }

    async _aiGenerateMessage(files, diff) {
        if (!this.aiSummarizeFn) return null;
        const prompt = [
            'Generate a conventional commit message for these changes:',
            '',
            `Files changed (${files.length}):`,
            ...files.slice(0, 10).map(f => `- ${f.file} (${f.changes} lines)`),
            '',
            'Diff snippet:',
            diff.slice(0, 1500),
            '',
            'Return ONLY the commit message in format "type(scope): description", no explanation.',
        ].join('\n');

        try {
            return await this.aiSummarizeFn(prompt, { maxTokens: 50, temperature: 0.1 });
        } catch {
            return null;
        }
    }

    _generateSummary(files, stats) {
        const parts = [`${stats.files} files changed`];
        if (stats.additions) parts.push(`${stats.additions} additions`);
        if (stats.deletions) parts.push(`${stats.deletions} deletions`);
        if (stats.binary) parts.push(`${stats.binary} binary files`);

        const byType = {};
        for (const f of files) {
            const ext = path.extname(f.file).slice(1) || 'other';
            byType[ext] = (byType[ext] || 0) + 1;
        }

        const typeSummary = Object.entries(byType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([ext, count]) => `${count} ${ext}`)
            .join(', ');

        return `${parts.join(', ')}. Types: ${typeSummary}.`;
    }

    _analyzeFileConflict(projectRoot, filePath) {
        try {
            const content = fs.readFileSync(path.join(projectRoot, filePath), 'utf-8');
            const lines = content.split('\n');

            let oursLines = 0, theirsLines = 0;
            let currentSide = null;

            for (const line of lines) {
                if (line.startsWith('<<<<<<<')) { currentSide = 'ours'; continue; }
                if (line.startsWith('=======')) { currentSide = 'theirs'; continue; }
                if (line.startsWith('>>>>>>>')) { currentSide = null; continue; }
                if (currentSide === 'ours') oursLines++;
                if (currentSide === 'theirs') theirsLines++;
            }

            // Conflict type classification
            let type = 'content';
            let recommendation = 'Manual review recommended.';

            if (oursLines === 0 || theirsLines === 0) {
                type = 'additive';
                recommendation = oursLines === 0 ? 'Accept incoming (theirs)' : 'Keep current (ours)';
            } else if (Math.abs(oursLines - theirsLines) > 50) {
                type = 'divergent';
                recommendation = 'Significant divergence — carefully review both sides';
            } else if (Math.abs(oursLines - theirsLines) < 5) {
                type = 'formatting';
                recommendation = 'Likely formatting conflict — consider accepting either side and re-running formatter';
            }

            return { file: filePath, type, oursLines, theirsLines, recommendation };
        } catch {
            return { file: filePath, type: 'unknown', oursLines: 0, theirsLines: 0, recommendation: 'Manual review required.' };
        }
    }
}

exports.GitIntelligence = GitIntelligence;
exports.gitIntelligence = new GitIntelligence();
