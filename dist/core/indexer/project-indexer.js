"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
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
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectIndexer = void 0;
/**
 * PersonalIDE - Project Indexer
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const EXT_TO_LANG = {
    '.kt': 'kotlin', '.java': 'java', '.xml': 'xml', '.gradle': 'gradle',
    '.kts': 'kotlin', '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
    '.tsx': 'typescript', '.json': 'json', '.md': 'markdown', '.txt': 'text',
    '.sh': 'shell', '.bat': 'batch', '.ps1': 'powershell', '.rs': 'rust',
    '.go': 'go', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml',
};
class ProjectIndexer {
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    async index() {
        const fileTree = this.buildFileTree(this.projectRoot, 0, 6);
        const projectType = this.detectProjectType();
        const modules = this.indexModules(projectType);
        const symbols = this.indexSymbols(projectType);
        return { fileTree, modules, symbols, projectType };
    }
    buildFileTree(dir, depth, maxDepth) {
        if (depth > maxDepth)
            return [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
                .filter(e => !e.name.startsWith('.') || e.name === '.git')
                .filter(e => !['node_modules', 'build', '.gradle', 'target', 'dist'].includes(e.name));
            return entries.map(entry => {
                const fullPath = path.join(dir, entry.name);
                const isDir = entry.isDirectory();
                const node = {
                    name: entry.name,
                    path: path.relative(this.projectRoot, fullPath),
                    isDirectory: isDir,
                };
                if (isDir && depth < maxDepth) {
                    node.children = this.buildFileTree(fullPath, depth + 1, maxDepth);
                }
                return node;
            });
        }
        catch {
            return [];
        }
    }
    indexModules(projectType) {
        const modules = [];
        if (projectType === 'android') {
            const appDir = path.join(this.projectRoot, 'app', 'src', 'main', 'java');
            if (fs.existsSync(appDir)) {
                modules.push(...this.scanJavaModules(appDir));
            }
            const settingsFile = path.join(this.projectRoot, 'settings.gradle.kts');
            if (fs.existsSync(settingsFile)) {
                const content = fs.readFileSync(settingsFile, 'utf-8');
                const matches = [...content.matchAll(/include\s*\(["']([^"']+)["']\)/g)];
                for (const m of matches) {
                    modules.push({ name: m[1], path: m[1], type: 'module', exports: [], imports: [] });
                }
            }
        }
        return modules;
    }
    scanJavaModules(dir, pkg = '') {
        const modules = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
            for (const subdir of subdirs) {
                const subPkg = pkg ? `${pkg}.${subdir.name}` : subdir.name;
                const subPath = path.join(dir, subdir.name);
                const files = fs.readdirSync(subPath).filter(f => f.endsWith('.kt') || f.endsWith('.java'));
                if (files.length > 0) {
                    modules.push({
                        name: subPkg,
                        path: path.relative(this.projectRoot, subPath),
                        type: 'package',
                        exports: files.map(f => f.replace(/\.(kt|java)$/, '')),
                        imports: [],
                    });
                }
                modules.push(...this.scanJavaModules(subPath, subPkg));
            }
        }
        catch { /* ignore */ }
        return modules;
    }
    indexSymbols(projectType) {
        const symbols = [];
        const patterns = [];
        if (projectType === 'android') {
            patterns.push({ regex: /^class\s+(\w+)/m, type: 'class' }, { regex: /^data\s+class\s+(\w+)/m, type: 'class' }, { regex: /^interface\s+(\w+)/m, type: 'interface' }, { regex: /^enum\s+class\s+(\w+)/m, type: 'enum' }, { regex: /^(?:private\s+|internal\s+|protected\s+)?fun\s+(\w+)/gm, type: 'function' }, { regex: /^(?:val|var)\s+(\w+)/gm, type: 'val' });
        }
        const sourceFiles = this.getSourceFiles(this.projectRoot, 200);
        for (const file of sourceFiles) {
            try {
                if (file.size > 200 * 1024)
                    continue;
                const content = fs.readFileSync(file.path, 'utf-8');
                const lines = content.split('\n');
                for (const pattern of patterns) {
                    const matches = content.matchAll(pattern.regex);
                    for (const match of matches) {
                        const name = match[1];
                        const lineNum = this.getLineNumber(content, match.index || 0, lines);
                        symbols.push({ name, type: pattern.type, file: file.relativePath, line: lineNum, dependencies: [] });
                    }
                }
            }
            catch { /* ignore */ }
        }
        return symbols.slice(0, 5000);
    }
    getLineNumber(content, charIndex, lines) {
        const prefix = content.slice(0, charIndex);
        return (prefix.match(/\n/g) || []).length + 1;
    }
    getSourceFiles(dir, maxFiles) {
        const files = [];
        const extensions = ['.kt', '.java', '.xml', '.gradle', '.kts', '.py', '.js', '.ts', '.tsx', '.go', '.rs'];
        const skipDirs = new Set(['node_modules', 'build', '.gradle', 'target', 'dist']);
        const walk = (d, depth = 0) => {
            if (files.length >= maxFiles || depth > 8)
                return;
            try {
                for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                    if (files.length >= maxFiles)
                        break;
                    const fullPath = path.join(d, entry.name);
                    if (entry.isDirectory() && !skipDirs.has(entry.name)) {
                        walk(fullPath, depth + 1);
                    }
                    else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
                        try {
                            const stat = fs.statSync(fullPath);
                            files.push({ path: fullPath, relativePath: path.relative(dir, fullPath), size: stat.size });
                        }
                        catch { /* ignore */ }
                    }
                }
            }
            catch { /* ignore */ }
        };
        walk(dir);
        return files;
    }
    detectProjectType() {
        if (fs.existsSync(path.join(this.projectRoot, 'build.gradle.kts')) ||
            fs.existsSync(path.join(this.projectRoot, 'build.gradle'))) {
            if (fs.existsSync(path.join(this.projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml'))) {
                return 'android';
            }
            return 'gradle';
        }
        if (fs.existsSync(path.join(this.projectRoot, 'package.json')))
            return 'npm';
        if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml')))
            return 'rust';
        if (fs.existsSync(path.join(this.projectRoot, 'go.mod')))
            return 'go';
        return 'generic';
    }
}
exports.ProjectIndexer = ProjectIndexer;
