/**
 * PersonalIDE - File Service
 * 主进程文件操作封装，包含基本安全检查
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

// 允许的文件操作根目录（防止路径遍历攻击）
const ALLOWED_ROOTS: string[] = [];

export function addAllowedRoot(root: string): void {
  const normalized = path.normalize(root);
  if (!ALLOWED_ROOTS.includes(normalized)) {
    ALLOWED_ROOTS.push(normalized);
  }
}

function checkPath(filePath: string): void {
  const normalized = path.normalize(filePath);
  // 路径遍历检测
  if (normalized.includes('..')) {
    // 允许相对路径，但必须落在 allowed roots 内
    if (ALLOWED_ROOTS.length > 0) {
      const resolved = path.resolve(normalized);
      const inAllowed = ALLOWED_ROOTS.some(root => resolved.startsWith(root));
      if (!inAllowed) {
        throw new Error(`路径访问被拒绝: ${filePath}`);
      }
    }
  }
}

export class FileService {
  read(filePath: string): string {
    checkPath(filePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      throw new Error(`路径是目录而非文件: ${filePath}`);
    }
    // 限制单个文件最大 50MB
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error(`文件过大 (${Math.round(stat.size / 1024 / 1024)}MB)，限制 50MB`);
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  write(filePath: string, content: string): void {
    checkPath(filePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  delete(filePath: string): void {
    checkPath(filePath);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
  }

  rename(oldPath: string, newPath: string): void {
    checkPath(oldPath);
    checkPath(newPath);
    if (!fs.existsSync(oldPath)) {
      throw new Error(`文件不存在: ${oldPath}`);
    }
    const newDir = path.dirname(newPath);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    fs.renameSync(oldPath, newPath);
  }

  mkdir(dirPath: string): void {
    checkPath(dirPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  readDir(dirPath: string, depth = 0): FileTreeNode[] {
    checkPath(dirPath);
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return [];
    }

    // 限制递归深度，防止超深目录扫描
    if (depth > 8) return [];

    // 过滤隐藏文件（可选，按需开启）
    const entries = fs.readdirSync(dirPath)
      .filter(name => !name.startsWith('.git'));

    return entries.map(name => {
      const fullPath = path.join(dirPath, name);
      let isDir = false;
      try {
        isDir = fs.statSync(fullPath).isDirectory();
      } catch {
        // 忽略无权访问的文件
      }

      const node: FileTreeNode = {
        name,
        path: fullPath,
        isDirectory: isDir,
      };

      if (isDir && depth < 8) {
        node.children = this.readDir(fullPath, depth + 1);
      }

      return node;
    }).sort((a, b) => {
      // 文件夹优先
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  stats(filePath: string): { size: number; mtime: number; isDirectory: boolean } {
    checkPath(filePath);
    const stat = fs.statSync(filePath);
    return {
      size: stat.size,
      mtime: stat.mtimeMs,
      isDirectory: stat.isDirectory(),
    };
  }
}
