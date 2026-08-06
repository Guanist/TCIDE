"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintManager = exports.LintManager = void 0;
class LintManager {
    issues = new Map();
    enabled = true;
    lastLintTime = new Map();
    DEBOUNCE_MS = 2000;
    /** Lint a single file */
    async lintFile(filePath, content, language) {
        if (!this.enabled)
            return [];
        // Debounce: skip if linted recently
        const lastTime = this.lastLintTime.get(filePath) || 0;
        if (Date.now() - lastTime < this.DEBOUNCE_MS) {
            return this.issues.get(filePath) || [];
        }
        this.lastLintTime.set(filePath, Date.now());
        const issues = this.basicLint(content, language);
        this.issues.set(filePath, issues);
        return issues;
    }
    /** Basic built-in linting rules (ESLint integration point) */
    basicLint(content, language) {
        const lines = content.split('\n');
        const issues = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const ln = i + 1;
            // Trailing whitespace
            if (line.match(/\s+$/)) {
                issues.push({
                    filePath: '', line: ln, column: line.trimEnd().length + 1,
                    message: 'Trailing whitespace',
                    severity: 'info', ruleId: 'no-trailing-spaces',
                    source: 'TCIDE Lint', fixAvailable: true,
                });
            }
            // Mixed tabs and spaces
            if (line.match(/^\t+/) && line.match(/^ +/m)) {
                issues.push({
                    filePath: '', line: ln, column: 1,
                    message: 'Mixed tabs and spaces in indentation',
                    severity: 'warning', ruleId: 'no-mixed-spaces-and-tabs',
                    source: 'TCIDE Lint', fixAvailable: false,
                });
            }
            // Long lines (> 120 chars)
            if (line.length > 120 && !line.startsWith('//') && !line.startsWith('import')) {
                issues.push({
                    filePath: '', line: ln, column: 120,
                    message: `Line too long (${line.length} > 120 characters)`,
                    severity: 'info', ruleId: 'max-len',
                    source: 'TCIDE Lint', fixAvailable: false,
                });
            }
            // Multiple consecutive blank lines
            if (i > 0 && line === '' && lines[i - 1] === '' && lines[i - 2] === '') {
                issues.push({
                    filePath: '', line: ln, column: 1,
                    message: 'Multiple consecutive blank lines',
                    severity: 'info', ruleId: 'no-multiple-empty-lines',
                    source: 'TCIDE Lint', fixAvailable: true,
                });
            }
            // Language-specific checks
            if (language === 'typescript' || language === 'javascript') {
                // console.log left in production code
                if (line.match(/console\.(log|debug)\s*\(/)) {
                    issues.push({
                        filePath: '', line: ln, column: 1,
                        message: 'console.log() may be unintended in production code',
                        severity: 'warning', ruleId: 'no-console',
                        source: 'TCIDE Lint', fixAvailable: false,
                    });
                }
                // var usage (prefer const/let)
                if (line.match(/\bvar\s+\w/)) {
                    issues.push({
                        filePath: '', line: ln, column: line.indexOf('var ') + 1,
                        message: 'Use const or let instead of var',
                        severity: 'warning', ruleId: 'no-var',
                        source: 'TCIDE Lint', fixAvailable: true,
                    });
                }
            }
        }
        return issues;
    }
    getIssues(filePath) {
        if (filePath)
            return this.issues.get(filePath) || [];
        const all = [];
        for (const iss of this.issues.values())
            all.push(...iss);
        return all;
    }
    clearFile(filePath) {
        this.issues.delete(filePath);
    }
    clearAll() {
        this.issues.clear();
    }
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    getSummary() {
        let errors = 0, warnings = 0, infos = 0;
        const filesWithIssues = new Set();
        for (const [fp, iss] of this.issues) {
            if (iss.length > 0)
                filesWithIssues.add(fp);
            for (const i of iss) {
                if (i.severity === 'error')
                    errors++;
                else if (i.severity === 'warning')
                    warnings++;
                else
                    infos++;
            }
        }
        return { totalErrors: errors, totalWarnings: warnings, totalInfos: infos, filesWithIssues: filesWithIssues.size, cleanFiles: 0 };
    }
}
exports.LintManager = LintManager;
exports.lintManager = new LintManager();
