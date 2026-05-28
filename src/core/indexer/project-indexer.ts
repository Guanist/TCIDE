/**
 * PersonalIDE - Project Indexer
 */
import * as fs from 'fs';
import * as path from 'path';

export interface IndexedFile {
  path: string;
  relativePath: string;
  size: number;
  language: string;
  summary?: string;
}

export interface ModuleInfo {
  name: string;
  path: string;
  type: 'package' | 'module' | 'directory';
  exports: string[];
  imports: string[];
}

export interface SymbolEntry {
  name: string;
  type: 'class' | 'function' | 'method' | 'interface' | 'enum' | 'val' | 'var';
  file: string;
  line: number;
  signature?: string;
  dependencies: string[];
}

const EXT_TO_LANG: Record<string, string> = {
  '.kt': 'kotlin', '.java': 'java', '.xml': 'xml', '.gradle': 'gradle',
  '.kts': 'kotlin', '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
  '.tsx': 'typescript', '.json': 'json', '.md': 'markdown', '.txt': 'text',
  '.sh': 'shell', '.bat': 'batch', '.ps1': 'powershell', '.rs': 'rust',
  '.go': 'go', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml',
};

export class ProjectIndexer {
  constructor(private projectRoot: string) {}

  async index(): Promise<{
    fileTree: object[];
    modules: ModuleInfo[];
    symbols: SymbolEntry[];
    projectType: string;
  }> {
    const fileTree = this.buildFileTree(this.projectRoot, 0, 6);
    const projectType = this.detectProjectType();
    const modules = this.indexModules(projectType);
    const symbols = this.indexSymbols(projectType);
    return { fileTree, modules, symbols, projectType };
  }

  private buildFileTree(dir: string, depth: number, maxDepth: number): object[] {
    if (depth > maxDepth) return [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') || e.name === '.git')
        .filter(e => !['node_modules', 'build', '.gradle', 'target', 'dist'].includes(e.name));

      return entries.map(entry => {
        const fullPath = path.join(dir, entry.name);
        const isDir = entry.isDirectory();
        const node: Record<string, unknown> = {
          name: entry.name,
          path: path.relative(this.projectRoot, fullPath),
          isDirectory: isDir,
        };
        if (isDir && depth < maxDepth) {
          node.children = this.buildFileTree(fullPath, depth + 1, maxDepth);
        }
        return node;
      });
    } catch { return []; }
  }

  private indexModules(projectType: string): ModuleInfo[] {
    const modules: ModuleInfo[] = [];
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

  private scanJavaModules(dir: string, pkg = ''): ModuleInfo[] {
    const modules: ModuleInfo[] = [];
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
    } catch { /* ignore */ }
    return modules;
  }

  private indexSymbols(projectType: string): SymbolEntry[] {
    const symbols: SymbolEntry[] = [];
    const patterns: Array<{ regex: RegExp; type: SymbolEntry['type'] }> = [];
    if (projectType === 'android') {
      patterns.push(
        { regex: /^class\s+(\w+)/m, type: 'class' },
        { regex: /^data\s+class\s+(\w+)/m, type: 'class' },
        { regex: /^interface\s+(\w+)/m, type: 'interface' },
        { regex: /^enum\s+class\s+(\w+)/m, type: 'enum' },
        { regex: /^(?:private\s+|internal\s+|protected\s+)?fun\s+(\w+)/gm, type: 'function' },
        { regex: /^(?:val|var)\s+(\w+)/gm, type: 'val' },
      );
    }
    const sourceFiles = this.getSourceFiles(this.projectRoot, 200);
    for (const file of sourceFiles) {
      try {
        if (file.size > 200 * 1024) continue;
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
      } catch { /* ignore */ }
    }
    return symbols.slice(0, 5000);
  }

  private getLineNumber(content: string, charIndex: number, lines: string[]): number {
    const prefix = content.slice(0, charIndex);
    return (prefix.match(/\n/g) || []).length + 1;
  }

  private getSourceFiles(dir: string, maxFiles: number): Array<{ path: string; relativePath: string; size: number }> {
    const files: Array<{ path: string; relativePath: string; size: number }> = [];
    const extensions = ['.kt', '.java', '.xml', '.gradle', '.kts', '.py', '.js', '.ts', '.tsx', '.go', '.rs'];
    const skipDirs = new Set(['node_modules', 'build', '.gradle', 'target', 'dist']);

    const walk = (d: string, depth = 0): void => {
      if (files.length >= maxFiles || depth > 8) return;
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (files.length >= maxFiles) break;
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory() && !skipDirs.has(entry.name)) {
            walk(fullPath, depth + 1);
          } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
            try {
              const stat = fs.statSync(fullPath);
              files.push({ path: fullPath, relativePath: path.relative(dir, fullPath), size: stat.size });
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    };
    walk(dir);
    return files;
  }

  private detectProjectType(): string {
    if (fs.existsSync(path.join(this.projectRoot, 'build.gradle.kts')) ||
        fs.existsSync(path.join(this.projectRoot, 'build.gradle'))) {
      if (fs.existsSync(path.join(this.projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml'))) {
        return 'android';
      }
      return 'gradle';
    }
    if (fs.existsSync(path.join(this.projectRoot, 'package.json'))) return 'npm';
    if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) return 'rust';
    if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) return 'go';
    return 'generic';
  }
}
