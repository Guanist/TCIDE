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
exports.EntropyEvaluator = exports.entropyEvaluator = void 0;
/**
 * TCIDE Entropy Evaluator — P3 代码熵评估引擎
 *
 * 熵(Entropy) = 系统混乱度的度量。代码熵越高，可维护性越差。
 *
 * 评估维度:
 *   1. 圈复杂度分布 (Cyclomatic Complexity) — 函数级 + 文件级 + 项目级
 *   2. 代码重复密度 (Duplication Density) — 跨文件克隆比率
 *   3. 耦合/内聚比率 (Coupling/Cohesion Ratio) — 模块间依赖熵
 *   4. 变更加权复杂度 (Churn-Weighted Complexity) — 高频修改+高复杂度的热点
 *   5. 认知复杂度 (Cognitive Complexity) — 嵌套/逻辑跳转的认知负担
 *   6. 综合代码健康分 (Code Health Score) — 0-100，阈值分色(绿>80/黄>50/红<50)
 *
 * 输出建议优先级排序（熵分降序），供 Smart Trimmer 和 Context Controller 消费。
 */
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', 'target', 'out']);
const INDEX_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.kts']);

class EntropyEvaluator {
    constructor() {
        this.projectRoot = null;
        this.results = null;
        this.fileMetrics = new Map();
        this.onProgress = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
    }

    /**
     * @returns {Promise<{score, grade, dimensions, hotspots, recommendations}>}
     */
    async evaluate(onProgress) {
        this.onProgress = onProgress;
        this.fileMetrics.clear();

        const files = this._collectFiles();
        const total = files.length;

        const dimensions = {
            complexity: { score: 0, details: [] },
            duplication: { score: 0, details: [] },
            coupling: { score: 0, details: [] },
            churn: { score: 0, details: [] },
            cognitive: { score: 0, details: [] },
        };

        // Phase 1: Per-file complexity & cognitive analysis
        this.onProgress?.({ phase: 'complexity', progress: 0 });
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const metrics = this._analyzeComplexity(content, file);
                this.fileMetrics.set(file, metrics);
                dimensions.complexity.details.push(metrics);
                dimensions.cognitive.details.push({ file, cognitive: metrics.cognitive, nesting: metrics.maxNesting });
            } catch {}
            this.onProgress?.({ phase: 'complexity', progress: i / total });
        }

        // Phase 2: Duplication analysis (simplified cross-file n-gram)
        this.onProgress?.({ phase: 'duplication', progress: 0 });
        const dupResults = this._analyzeDuplication(files);
        dimensions.duplication = dupResults;

        // Phase 3: Coupling analysis (import/export density)
        this.onProgress?.({ phase: 'coupling', progress: 0.5 });
        const couplingResults = this._analyzeCoupling(files);
        dimensions.coupling = couplingResults;

        // Phase 4: Churn analysis (git-based change frequency)
        this.onProgress?.({ phase: 'churn', progress: 0.7 });
        const churnResults = this._analyzeChurn();
        dimensions.churn = churnResults;

        // Compute entropy scores (0-100, higher = more entropy = worse)
        dimensions.complexity.score = this._computeComplexityScore(dimensions.complexity.details);
        dimensions.duplication.score = dimensions.duplication.score || 0;
        dimensions.coupling.score = dimensions.coupling.score || 0;
        dimensions.churn.score = dimensions.churn.score || 0;
        dimensions.cognitive.score = this._computeCognitiveScore(dimensions.cognitive.details);

        // Weighted entropy total (lower = better, 0=perfect, 100=maximum entropy)
        const weights = { complexity: 0.30, duplication: 0.20, coupling: 0.20, churn: 0.15, cognitive: 0.15 };
        const totalEntropy = Math.round(
            dimensions.complexity.score * weights.complexity +
            dimensions.duplication.score * weights.duplication +
            dimensions.coupling.score * weights.coupling +
            dimensions.churn.score * weights.churn +
            dimensions.cognitive.score * weights.cognitive
        );

        // Health score (inverted: 100 = perfect, 0 = chaos)
        const healthScore = Math.max(0, 100 - totalEntropy);
        const grade = healthScore > 80 ? 'A' : healthScore > 65 ? 'B' : healthScore > 50 ? 'C' : healthScore > 35 ? 'D' : 'F';

        // Hotspots (files with worst composite metrics)
        const hotspots = this._identifyHotspots(dimensions);

        // Recommendations
        const recommendations = this._generateRecommendations(dimensions, healthScore);

        this.results = {
            score: healthScore,
            grade,
            entropy: totalEntropy,
            dimensions,
            hotspots,
            recommendations,
            timestamp: Date.now(),
        };

        this.onProgress?.({ phase: 'done', progress: 1 });
        return this.results;
    }

    /**
     * 获取文件级别的熵分（给 Smart Trimmer 用）
     */
    getFileEntropy(filePath) {
        return this.fileMetrics.get(filePath) || { complexity: 1, cognitive: 0, entropy: 5 };
    }

    /**
     * 获取项目熵分（给 Context Controller 用）
     */
    getProjectEntropy() {
        return this.results || { score: 50, grade: 'C', entropy: 50 };
    }

    // ── Private: Complexity ──
    _analyzeComplexity(content, file) {
        const lines = content.split('\n');
        let complexity = 1;
        let cognitive = 0;
        let maxNesting = 0;
        let currentNesting = 0;
        let functionCount = 0;
        let commentLines = 0;
        let blankLines = 0;

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) { blankLines++; continue; }
            if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                commentLines++; continue;
            }

            // Complexity contributors
            if (/\bif\b/.test(trimmed)) complexity++;
            if (/\bfor\b/.test(trimmed)) complexity++;
            if (/\bwhile\b/.test(trimmed)) complexity++;
            if (/\bswitch\b/.test(trimmed)) complexity++;
            if (/\bcase\b/.test(trimmed) && !trimmed.startsWith('switch')) complexity++;
            if (/\bcatch\b/.test(trimmed)) complexity++;
            if (/\?.*:/.test(trimmed)) complexity++;
            if (/\&\&/.test(trimmed)) complexity++;
            if (/\|\|/.test(trimmed)) complexity++;
            if (/\bthrow\b/.test(trimmed)) complexity++;

            // Nesting depth
            if (/{/.test(trimmed)) currentNesting++;
            if (/}/.test(trimmed)) currentNesting--;
            maxNesting = Math.max(maxNesting, currentNesting);

            // Cognitive complexity (nesting × branching penalty)
            if (/\b(if|for|while|switch|catch|else\s+if)\b/.test(trimmed)) {
                cognitive += 1 + currentNesting * 0.5;
            }

            // Function count
            if (/\b(function|def|func|fun|=>|class|interface|struct)\b/.test(trimmed)) functionCount++;
        }

        const totalLines = lines.length;
        const codeLines = totalLines - commentLines - blankLines;
        const commentRatio = totalLines > 0 ? commentLines / totalLines : 0;

        // File entropy = complexity density × nesting penalty
        const density = codeLines > 0 ? complexity / codeLines : 0;
        const nestingPenalty = 1 + (maxNesting > 3 ? (maxNesting - 3) * 0.2 : 0);
        const fileEntropy = Math.min(100, Math.round(density * nestingPenalty * 40));

        return {
            file: file ? path.relative(this.projectRoot, file) : '',
            lines: totalLines,
            codeLines,
            complexity,
            density: Math.round(density * 100) / 100,
            cognitive: Math.round(cognitive),
            maxNesting,
            functions: functionCount,
            commentRatio: Math.round(commentRatio * 100),
            entropy: fileEntropy,
        };
    }

    _computeComplexityScore(details) {
        if (!details.length) return 0;
        const totalComplexity = details.reduce((s, d) => s + d.complexity, 0);
        const totalLines = details.reduce((s, d) => s + d.codeLines, 0) || 1;

        // Average complexity per 100 lines
        const avgPer100 = (totalComplexity / totalLines) * 100;

        // High-complexity files (>30 complexity)
        const highFiles = details.filter(d => d.complexity > 30).length;
        const highFilePct = highFiles / details.length;

        return Math.min(100, Math.round(avgPer100 * 2.5 + highFilePct * 30));
    }

    _computeCognitiveScore(details) {
        if (!details.length) return 0;
        const avgCognitive = details.reduce((s, d) => s + d.cognitive, 0) / details.length;
        const deepNesting = details.filter(d => d.maxNesting > 5).length;
        const nestingPct = deepNesting / details.length;

        return Math.min(100, Math.round(avgCognitive * 2 + nestingPct * 40));
    }

    // ── Private: Duplication ──
    _analyzeDuplication(files) {
        const details = [];
        const ngramSize = 6; // 6-line n-gram
        const allNgrams = new Map(); // ngram hash → [{file, startLine}]

        let processed = 0;
        for (const file of files.slice(0, 300)) { // limit for performance
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                for (let i = 0; i < lines.length - ngramSize; i++) {
                    const ngram = lines.slice(i, i + ngramSize).join('\n');
                    if (ngram.length < 30) continue;
                    const hash = this._hashStr(ngram);
                    if (!allNgrams.has(hash)) allNgrams.set(hash, []);
                    allNgrams.get(hash).push({ file, startLine: i + 1 });
                }
            } catch {}
            processed++;
            if (processed % 50 === 0) {
                this.onProgress?.({ phase: 'duplication', progress: processed / Math.min(files.length, 300) });
            }
        }

        // Find duplicated ngrams (appearing in >1 file)
        let dupBlocks = 0;
        let totalDupLines = 0;
        const dupByFile = new Map();

        for (const [hash, occurrences] of allNgrams) {
            if (occurrences.length > 1) {
                const uniqueFiles = [...new Set(occurrences.map(o => o.file))];
                if (uniqueFiles.length > 1) {
                    dupBlocks++;
                    totalDupLines += ngramSize;
                    for (const file of uniqueFiles) {
                        dupByFile.set(file, (dupByFile.get(file) || 0) + ngramSize);
                    }
                    details.push({
                        files: uniqueFiles.slice(0, 3),
                        lines: ngramSize,
                        startLines: occurrences.slice(0, 2).map(o => o.startLine),
                    });
                }
            }
        }

        // Dup density = duplicated lines / estimated total lines
        const totalEstLines = files.length * 100; // rough estimate
        const dupDensity = totalEstLines > 0 ? (totalDupLines / totalEstLines) * 100 : 0;

        return {
            score: Math.min(100, Math.round(dupDensity * 15)),
            dupBlocks,
            totalDupLines,
            dupDensity: Math.round(dupDensity * 100) / 100,
            details: details.slice(0, 20),
        };
    }

    // ── Private: Coupling ──
    _analyzeCoupling(files) {
        const details = [];
        const importsByFile = new Map();
        const fanOut = new Map(); // file → number of imports
        let totalImports = 0;

        for (const file of files.slice(0, 300)) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const imports = this._extractImports(content);
                fanOut.set(file, imports.length);
                totalImports += imports.length;
                for (const imp of imports) {
                    if (!importsByFile.has(imp)) importsByFile.set(imp, []);
                    importsByFile.get(imp).push(file);
                }
            } catch {}
        }

        // High fan-out files
        const highFanOut = [...fanOut.entries()]
            .filter(([_, count]) => count > 15)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        for (const [file, count] of highFanOut) {
            details.push({ file, fanOut: count, type: 'high-fan-out' });
        }

        // High fan-in modules (imported by many)
        const highFanIn = [...importsByFile.entries()]
            .filter(([_, importers]) => importers.length > 5)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 10);

        for (const [module, importers] of highFanIn) {
            details.push({ module, fanIn: importers.length, importers: importers.slice(0, 5), type: 'high-fan-in' });
        }

        const avgFanOut = files.length > 0 ? totalImports / files.length : 0;
        const couplingScore = Math.min(100, Math.round(avgFanOut * 6 + highFanOut.length * 3));

        return { score: couplingScore, avgFanOut: Math.round(avgFanOut * 10) / 10, highFanOut, highFanIn: highFanIn.map(h => ({ module: h[0], count: h[1].length })) };
    }

    // ── Private: Churn ──
    _analyzeChurn() {
        const details = [];
        try {
            // Get churn data from git (last 90 days)
            const output = child_process.execSync(
                'git log --pretty=format: --name-only --since="90 days ago" | sort | uniq -c | sort -rn | head -30',
                { cwd: this.projectRoot, encoding: 'utf-8', timeout: 10000 }
            );
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
                const match = line.match(/^\s*(\d+)\s+(.+)/);
                if (match) {
                    const count = parseInt(match[1]);
                    const file = match[2].trim();
                    const metrics = this.fileMetrics.get(path.join(this.projectRoot, file));
                    const complexity = metrics?.complexity || 1;
                    const churnComplexity = count * complexity;
                    details.push({ file, changes: count, complexity, churnComplexity });
                }
            }
        } catch {
            // No git or no history
            return { score: 0, details: [] };
        }

        const totalChurnComplexity = details.reduce((s, d) => s + d.churnComplexity, 0);
        const score = Math.min(100, Math.round(totalChurnComplexity / 50));

        return {
            score,
            totalChurnComplexity,
            topChurnFiles: details.slice(0, 10),
        };
    }

    // ── Private: Hotspots ──
    _identifyHotspots(dimensions) {
        const files = new Map();
        for (const d of dimensions.complexity.details) {
            if (!d.file) continue;
            files.set(d.file, { file: d.file, complexity: d.complexity, entropy: d.entropy, cognitive: d.cognitive });
        }

        for (const d of dimensions.churn.details || []) {
            if (files.has(d.file)) {
                files.get(d.file).churnComplexity = d.churnComplexity;
                files.get(d.file).changes = d.changes;
            }
        }

        return [...files.values()]
            .sort((a, b) => (b.entropy || 0) + (b.churnComplexity || 0) / 10 - (a.entropy || 0) - (a.churnComplexity || 0) / 10)
            .slice(0, 15)
            .map(f => ({
                ...f,
                hotspotScore: Math.round((f.entropy || 0) + (f.churnComplexity || 0) / 10),
            }));
    }

    // ── Private: Recommendations ──
    _generateRecommendations(dimensions, healthScore) {
        const recs = [];

        if (dimensions.complexity.score > 60) {
            recs.push({
                priority: 'high',
                category: 'complexity',
                title: '圈复杂度过高',
                desc: `${dimensions.complexity.details.filter(d => d.complexity > 30).length} 个文件复杂度>30，建议拆分长函数`,
                action: 'refactor_complex_functions',
            });
        }

        if (dimensions.duplication.score > 50) {
            recs.push({
                priority: 'high',
                category: 'duplication',
                title: '代码重复严重',
                desc: `发现 ${dimensions.duplication.dupBlocks} 处重复代码块，建议抽取公共模块`,
                action: 'extract_common_module',
            });
        }

        if (dimensions.coupling.score > 50) {
            recs.push({
                priority: 'medium',
                category: 'coupling',
                title: '模块耦合度偏高',
                desc: `${dimensions.coupling.highFanOut?.length || 0} 个文件导入超过15个模块`,
                action: 'decouple_modules',
            });
        }

        if (dimensions.churn.score > 40) {
            recs.push({
                priority: 'medium',
                category: 'churn',
                title: '存在高频修改热点',
                desc: `${dimensions.churn.topChurnFiles?.length || 0} 个文件在过去90天被频繁修改`,
                action: 'stabilize_hotspots',
            });
        }

        if (dimensions.cognitive.score > 50) {
            recs.push({
                priority: 'medium',
                category: 'cognitive',
                title: '认知复杂度偏高',
                desc: `部分文件嵌套层数过深(>5层)，建议扁平化控制流`,
                action: 'flatten_nesting',
            });
        }

        if (healthScore < 35) {
            recs.push({
                priority: 'critical',
                category: 'overall',
                title: '代码健康度严重不足',
                desc: `综合评分 ${healthScore}/100 (等级 ${healthScore > 15 ? 'D' : 'F'})，建议优先处理复杂度+重复问题`,
                action: 'emergency_refactor',
            });
        }

        return recs;
    }

    // ── Helpers ──
    _collectFiles() {
        const files = [];
        const walk = (dir, depth) => {
            if (depth > 8 || files.length > 2000) return;
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
                    if (SKIP_DIRS.has(entry.name)) continue;
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(full, depth + 1);
                    else if (INDEX_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full);
                }
            } catch {}
        };
        walk(this.projectRoot, 0);
        return files;
    }

    _extractImports(content) {
        const imports = [];
        const re = /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            imports.push(m[1] || m[2] || m[3]);
        }
        return [...new Set(imports)];
    }

    _hashStr(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }
}

exports.EntropyEvaluator = EntropyEvaluator;
exports.entropyEvaluator = new EntropyEvaluator();
