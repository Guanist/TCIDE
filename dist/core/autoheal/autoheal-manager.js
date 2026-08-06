"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoHealManager = exports.AutoHealManager = void 0;
class AutoHealManager {
    patterns = [];
    constructor() {
        this.registerDefaults();
    }
    registerDefaults() {
        // TypeScript: cannot find name
        this.register({
            name: 'ts-cannot-find-name',
            regex: /Cannot find name '(\w+)'/,
            suggestion: (m) => `Variable '${m[1]}' not declared. Check for missing import or typo.`,
        });
        // TypeScript: property does not exist
        this.register({
            name: 'ts-property-not-exist',
            regex: /Property '(\w+)' does not exist on type '(.+?)'/,
            suggestion: (m) => `'${m[1]}' is not a property of ${m[2]}. Check type definition or use type assertion.`,
        });
        // Python: NameError
        this.register({
            name: 'py-name-error',
            regex: /NameError: name '(\w+)' is not defined/,
            suggestion: (m) => `Variable '${m[1]}' not defined. Check for import or definition before use.`,
        });
        // Python: IndentationError
        this.register({
            name: 'py-indent',
            regex: /IndentationError: (.+)/,
            suggestion: (m) => `Indentation error: ${m[1]}. Check mixed tabs/spaces or incorrect indentation level.`,
        });
        // Go: undefined
        this.register({
            name: 'go-undefined',
            regex: /undefined: (w+)/,
            suggestion: (m) => `'${m[1]}' is undefined. Check import or declaration.`,
        });
        // Java/Kotlin: cannot find symbol
        this.register({
            name: 'java-cannot-find-symbol',
            regex: /cannot find symbols+symbol:s+(.+)/,
            suggestion: (m) => `Symbol not found: ${m[1]}. Check import statement or classpath.`,
        });
        // Gradle: dependency resolution
        this.register({
            name: 'gradle-dep-resolution',
            regex: /Could not resolve (.+)/,
            suggestion: (m) => `Dependency resolution failed: ${m[1]}. Check version or repository configuration.`,
        });
        // Rust: mismatched types
        this.register({
            name: 'rust-mismatched-types',
            regex: /mismatched typess+expected (.+?), found (.+)/,
            suggestion: (m) => `Type mismatch: expected ${m[1]}, found ${m[2]}. Consider type conversion or annotation.`,
        });
        // NPM: module not found
        this.register({
            name: 'npm-module-not-found',
            regex: /Cannot find module '(.+?)'/,
            suggestion: (m) => `Module '${m[1]}' not found. Run 'npm install' or check import path.`,
        });
        // ESLint errors
        this.register({
            name: 'eslint-any',
            regex: /(d+):(d+)s+errors+(.+?)s+(.+)/,
            suggestion: (m) => `Line ${m[1]}:${m[2]}: ${m[4]} (${m[3]})`,
        });
    }
    register(pattern) {
        this.patterns.push(pattern);
    }
    /** Analyze error output and generate fix suggestions */
    analyzeErrors(errors, filePath) {
        const suggestions = [];
        for (const err of errors) {
            let matched = false;
            for (const pattern of this.patterns) {
                const match = err.match(pattern.regex);
                if (match) {
                    suggestions.push({
                        error: err,
                        patternName: pattern.name,
                        suggestion: pattern.suggestion(match, filePath || ''),
                        filePath,
                        autoFixAvailable: !!pattern.autoFix,
                    });
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                suggestions.push({
                    error: err,
                    patternName: 'unknown',
                    suggestion: 'Manual inspection required — no matching pattern found.',
                    filePath,
                    autoFixAvailable: false,
                });
            }
        }
        return suggestions;
    }
    /** Get a generic fallback hint for unrecognized errors */
    getGenericHint(error) {
        // Extract file:line if present
        const flMatch = error.match(/(\S+):(\d+):(\d+)/);
        if (flMatch) {
            return `Error at ${flMatch[1]}:${flMatch[2]}:${flMatch[3]}. Review this location for syntax or type issues.`;
        }
        return 'Build error detected. Check compiler output for details.';
    }
    /** Count errors by severity category */
    categorizeErrors(errors) {
        const result = { syntax: 0, type: 0, import: 0, other: 0 };
        for (const err of errors) {
            if (/syntax|unexpected|parse/i.test(err))
                result.syntax++;
            else if (/type|cannot|not assignable/i.test(err))
                result.type++;
            else if (/import|cannot find module|not found/i.test(err))
                result.import++;
            else
                result.other++;
        }
        return result;
    }
}
exports.AutoHealManager = AutoHealManager;
exports.autoHealManager = new AutoHealManager();
