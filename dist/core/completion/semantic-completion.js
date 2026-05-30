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
exports.SemanticCompletion = exports.semanticCompletion = void 0;
/**
 * TCIDE Semantic Completion — P1 语义级代码补全
 *
 * 策略:
 *   Layer 1: 本地缓存命中 (5ms) — 项目内同名/前置/后缀匹配
 *   Layer 2: 向量语义匹配 (50ms) — TF-IDF 最近邻
 *   Layer 3: AI 模型补全 (300ms+) — 全函数级别
 *
 * 与 Monaco 原生补全互补: Monaco 做 token 级, 我们做语义级
 */
const fs = require("fs");
const path = require("path");

const COMPLETION_CACHE_TTL = 300000; // 5分钟缓存

class SemanticCompletion {
    constructor() {
        this.cache = new Map(); // key -> {completions, timestamp}
        this.projectRoot = null;
        this.onCompletions = null;
        this.aiCompleteFn = null; // 可注入的 AI 补全函数
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
    }

    /**
     * 设置 AI 补全回调 (由 renderer 注入)
     * @param {Function} fn — (context, language, options) => Promise<string>
     */
    setAIComplete(fn) {
        this.aiCompleteFn = fn;
    }

    /**
     * 触发补全
     * @param {object} params
     * @param {string} params.filePath - 当前文件绝对路径
     * @param {string} params.language - 语言
     * @param {string} params.prefix - 光标前第3行 (上下文)
     * @param {string} params.suffix - 光标后第3行
     * @param {number} params.cursorLine - 行号
     * @param {number} params.cursorColumn - 列号
     * @param {object} params.projectRoot - 项目根
     * @returns {Promise<Array<{label, insertText, detail, kind, score}>>}
     */
    async getCompletions(params) {
        const { filePath, language, prefix, suffix, projectRoot } = params;

        // Layer 1: 缓存
        const cacheKey = this._buildCacheKey(params);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < COMPLETION_CACHE_TTL) {
            return cached.completions;
        }

        const results = [];

        // Layer 1a: 本地项目模式匹配
        const localResults = await this._localCompletions(params);
        results.push(...localResults);

        // Layer 2: 项目内上下文语义
        if (this.projectRoot && results.length < 3) {
            const contextResults = await this._contextCompletions(params);
            results.push(...contextResults);
        }

        // Layer 3: AI 补全 (异步, 不阻塞返回)
        if (this.aiCompleteFn && results.length < 5) {
            this._aiCompletion(params).then(aiResults => {
                if (aiResults.length) {
                    this.onCompletions?.(aiResults);
                }
            });
        }

        // 去重、排序
        const deduped = this._dedupe(results);
        const sorted = this._rank(deduped, prefix);

        // 缓存
        this.cache.set(cacheKey, { completions: sorted, timestamp: Date.now() });
        // 限制缓存大小
        if (this.cache.size > 200) {
            const keys = this.cache.keys();
            for (let i = 0; i < 50; i++) this.cache.delete(keys.next().value);
        }

        return sorted;
    }

    /**
     * 无效化缓存
     */
    invalidateCache(filePath) {
        const toRemove = [];
        for (const [key] of this.cache) {
            if (key.startsWith(filePath)) toRemove.push(key);
        }
        for (const k of toRemove) this.cache.delete(k);
    }

    /**
     * 选区补全 — 基于选区文本生成完整实现
     */
    async completeSelection(filePath, language, selectionText, contextBefore, contextAfter) {
        if (!this.aiCompleteFn) return null;

        const prompt = this._buildSelectionPrompt(language, selectionText, contextBefore, contextAfter);
        try {
            const result = await this.aiCompleteFn(prompt, language, {
                maxTokens: 512,
                temperature: 0.2,
            });
            return result;
        } catch {
            return null;
        }
    }

    // ── 私有: Layer 1 本地补全 ──
    async _localCompletions(params) {
        const { filePath, language, prefix, suffix } = params;
        const results = [];
        const lines = prefix.split('\n');
        const lastLine = lines[lines.length - 1] || '';

        // 1. 方法调用的参数补全
        const callMatch = lastLine.match(/(\w+)\.(\w+)\($/);
        if (callMatch) {
            const [, obj, method] = callMatch;
            const content = this._readCurrentFile(filePath);
            if (content) {
                const methodDefs = this._findMethodDefs(content, language, method, obj);
                for (const def of methodDefs) {
                    results.push({
                        label: `${method}(${def.params})`,
                        insertText: def.params?.includes(',') ? '${1:arg1})' : ')',
                        detail: def.signature || `${method}()`,
                        kind: 2, // Method
                        score: 0.9,
                        source: 'local',
                    });
                }
            }
        }

        // 2. 变量名补全
        const varMatch = lastLine.match(/(?:const|let|var|)\s*(\w+)$/);
        if (varMatch && varMatch[1].length > 2) {
            const prefixName = varMatch[1];
            const content = this._readCurrentFile(filePath);
            if (content) {
                const vars = this._extractVariables(content, language);
                const matches = vars
                    .filter(v => v.name.startsWith(prefixName))
                    .slice(0, 10);
                for (const v of matches) {
                    results.push({
                        label: v.name,
                        insertText: v.name,
                        detail: v.type || 'variable',
                        kind: 6, // Variable
                        score: 0.85,
                        source: 'local',
                    });
                }
            }
        }

        // 3. 函数/类名补全
        const nameMatch = lastLine.match(/(?:new\s+|extends\s+|implements\s+)?(\w+)$/);
        if (nameMatch && nameMatch[1].length > 2) {
            const prefixName = nameMatch[1];
            const content = this._readCurrentFile(filePath);
            if (content) {
                const symbols = this._extractSymbols(content, language);
                const matches = symbols
                    .filter(s => s.name.startsWith(prefixName))
                    .slice(0, 10);
                for (const s of matches) {
                    results.push({
                        label: s.name,
                        insertText: s.name,
                        detail: `${s.kind}: ${s.line}`,
                        kind: s.kind === 'class' ? 5 : 1, // Class or Text
                        score: 0.8,
                        source: 'local',
                    });
                }
            }
        }

        return results;
    }

    // ── 私有: Layer 2 上下文补全 ──
    async _contextCompletions(params) {
        const { filePath, language, prefix } = params;
        const results = [];

        // 同目录同名文件
        const dir = path.dirname(filePath);
        try {
            const entries = fs.readdirSync(dir);
            const baseName = path.basename(filePath, path.extname(filePath));
            const siblings = entries
                .filter(e => e !== path.basename(filePath) && (
                    e.startsWith(baseName) || 
                    (e.includes(baseName) && e.match(/\w+/))
                ))
                .slice(0, 5);

            for (const s of siblings) {
                results.push({
                    label: `import './${s}'`,
                    insertText: `'./${s}'`,
                    detail: 'sibling module',
                    kind: 9, // Module
                    score: 0.6,
                    source: 'context',
                });
            }
        } catch {}

        // 常见导入路径
        const commonImports = this._getCommonImports(language);
        for (const imp of commonImports.slice(0, 5)) {
            results.push({
                label: imp.label,
                insertText: imp.insertText,
                detail: imp.detail,
                kind: 9,
                score: 0.5,
                source: 'context',
            });
        }

        return results;
    }

    // ── 私有: Layer 3 AI 补全 ──
    async _aiCompletion(params) {
        if (!this.aiCompleteFn) return [];
        const { language, prefix, suffix } = params;
        const prompt = [
            `Complete the following ${language} code. Return ONLY the completion, no explanation.`,
            `\`\`\`${language}`,
            prefix + '█' + suffix,
            '```',
            'Completion:',
        ].join('\n');

        try {
            const result = await this.aiCompleteFn(prompt, language, {
                maxTokens: 128,
                temperature: 0.1,
                stop: ['\n\n'],
            });

            if (!result) return [];

            // Parse AI response
            const cleaned = result.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
            const lines = cleaned.split('\n').filter(l => l.trim());
            const completions = [];
            for (const line of lines.slice(0, 3)) {
                const trimmed = line.trim();
                if (trimmed.length > 2) {
                    completions.push({
                        label: trimmed.slice(0, 60),
                        insertText: trimmed,
                        detail: 'AI',
                        kind: 1,
                        score: 0.95,
                        source: 'ai',
                    });
                }
            }
            return completions;
        } catch {
            return [];
        }
    }

    // ── 辅助方法 ──
    _buildCacheKey(params) {
        const { filePath, prefix } = params;
        const tail = prefix.slice(-200);
        let hash = 0;
        for (let i = 0; i < tail.length; i++) {
            hash = ((hash << 5) - hash) + tail.charCodeAt(i);
            hash |= 0;
        }
        return `${filePath}:${hash}`;
    }

    _readCurrentFile(filePath) {
        try {
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    _findMethodDefs(content, language, methodName, objName) {
        const results = [];
        const lines = content.split('\n');

        // Look for function/method definitions matching the name
        const patterns = [
            new RegExp(`(?:function|async\\s+function|const|let|var)\\s+${methodName}\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)`, 'i'),
            new RegExp(`${methodName}\\s*\\(([^)]*)\\)\\s*\\{`, 'g'),
            new RegExp(`${objName}\.prototype\.${methodName}\\s*=\\s*function\\(([^)]*)\\)`, 'i'),
        ];

        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match) {
                const params = match[1] || '';
                results.push({ params, signature: `${methodName}(${params})` });
            }
        }

        return results.slice(0, 3);
    }

    _extractVariables(content, language) {
        const results = [];
        const patterns = [
            /(?:const|let|var)\s+(\w+)\s*[:=]\s*([^;\n]+)/g,
            /(\w+)\s*[:=]\s*([^;\n]+)/g,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const name = match[1];
                if (name && name.length > 1 && !['if','for','while','switch','return','throw','new','const','let','var','function','class'].includes(name)) {
                    results.push({ name, type: match[2]?.trim().slice(0, 40) || 'any', line: 'N/A' });
                }
            }
        }
        return results;
    }

    _extractSymbols(content, language) {
        const results = [];
        const patterns = [
            { kind: 'function', re: /function\s+(\w+)/g },
            { kind: 'class', re: /class\s+(\w+)/g },
            { kind: 'function', re: /const\s+(\w+)\s*=\s*(?:async\s+)?\(/g },
            { kind: 'function', re: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g },
        ];

        for (const { kind, re } of patterns) {
            let match;
            while ((match = re.exec(content)) !== null) {
                const name = match[1];
                if (name && name.length > 1 && name !== 'if' && name !== 'for' && name !== 'while') {
                    results.push({ name, kind, line: 'N/A' });
                }
            }
        }
        return results;
    }

    _getCommonImports(language) {
        const common = {
            javascript: [
                { label: "import React from 'react'", insertText: "React from 'react'", detail: 'react' },
                { label: "import { useState } from 'react'", insertText: "{ useState } from 'react'", detail: 'react hook' },
                { label: "import path from 'path'", insertText: "path from 'path'", detail: 'node builtin' },
                { label: "import fs from 'fs'", insertText: "fs from 'fs'", detail: 'node builtin' },
            ],
            typescript: [
                { label: "import React from 'react'", insertText: "React from 'react'", detail: 'react' },
                { label: "import { useState } from 'react'", insertText: "{ useState } from 'react'", detail: 'react hook' },
            ],
            python: [
                { label: "import os", insertText: "os", detail: 'stdlib' },
                { label: "from typing import ", insertText: "typing import ", detail: 'type hints' },
                { label: "import json", insertText: "json", detail: 'stdlib' },
            ],
        };
        return common[language] || common.javascript || [];
    }

    _buildSelectionPrompt(language, selection, contextBefore, contextAfter) {
        return [
            `Complete the following ${language} code block.`,
            `Context before:\n\`\`\`${language}\n${contextBefore?.slice(-500)}\n\`\`\``,
            `Selected code to complete:\n\`\`\`${language}\n${selection?.slice(0, 300)}\n\`\`\``,
            `Context after:\n\`\`\`${language}\n${contextAfter?.slice(0, 500)}\n\`\`\``,
            'Return ONLY the completed code, no explanation.',
        ].join('\n');
    }

    _dedupe(results) {
        const seen = new Set();
        const deduped = [];
        for (const r of results) {
            const key = r.label + r.insertText;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(r);
            }
        }
        return deduped;
    }

    _rank(results, prefix) {
        return results.sort((a, b) => {
            // Prefer exact insertions
            const aScore = a.score || 0;
            const bScore = b.score || 0;
            // Prefer local over context over AI
            const sourceScore = { local: 0.05, context: 0.03, ai: 0.01 };
            return (bScore + (sourceScore[b.source] || 0)) - (aScore + (sourceScore[a.source] || 0));
        });
    }
}

exports.SemanticCompletion = SemanticCompletion;
exports.semanticCompletion = new SemanticCompletion();
