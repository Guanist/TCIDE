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
exports.FileService = void 0;
exports.addAllowedRoot = addAllowedRoot;
/**
 * PersonalIDE - File Service
 * 主进程文件操作封装，包含基本安全检查
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 允许的文件操作根目录（防止路径遍历攻击）
const ALLOWED_ROOTS = [];
function addAllowedRoot(root) {
    const normalized = path.normalize(root);
    if (!ALLOWED_ROOTS.includes(normalized)) {
        ALLOWED_ROOTS.push(normalized);
    }
}
function checkPath(filePath) {
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
class FileService {
    read(filePath) {
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
    write(filePath, content) {
        checkPath(filePath);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
    }
    delete(filePath) {
        checkPath(filePath);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true });
        }
        else {
            fs.unlinkSync(filePath);
        }
    }
    rename(oldPath, newPath) {
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
    mkdir(dirPath) {
        checkPath(dirPath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
    readDir(dirPath, depth = 0) {
        checkPath(dirPath);
        if (!fs.existsSync(dirPath)) {
            return [];
        }
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            return [];
        }
        // 限制递归深度，防止超深目录扫描
        if (depth > 8)
            return [];
        // 过滤隐藏文件（可选，按需开启）
        const entries = fs.readdirSync(dirPath)
            .filter(name => !name.startsWith('.git'));
        return entries.map(name => {
            const fullPath = path.join(dirPath, name);
            let isDir = false;
            try {
                isDir = fs.statSync(fullPath).isDirectory();
            }
            catch {
                // 忽略无权访问的文件
            }
            const node = {
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
            if (a.isDirectory && !b.isDirectory)
                return -1;
            if (!a.isDirectory && b.isDirectory)
                return 1;
            return a.name.localeCompare(b.name);
        });
    }
    stats(filePath) {
        checkPath(filePath);
        const stat = fs.statSync(filePath);
        return {
            size: stat.size,
            mtime: stat.mtimeMs,
            isDirectory: stat.isDirectory(),
        };
    }
}
exports.FileService = FileService;
