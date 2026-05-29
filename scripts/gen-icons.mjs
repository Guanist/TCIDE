/**
 * 批量生成 TCIDE 文件/文件夹 SVG 图标
 * 替代 emoji，解决 Windows 渲染问题
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'renderer', 'public', 'icons', 'file');

// ─── 辅助：创建 SVG ───
function svg(body: string, size = 18): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

function save(filename: string, content: string): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, filename), content);
}

// ─── 文件夹图标（基础文件夹 + 彩色标签） ───
function folderIcon(labelColor: string, badge?: string): string {
  const body = `
    <path d="M2 4.5C2 3.67 2.67 3 3.5 3H7l1.5 2h5c.83 0 1.5.67 1.5 1.5V12c0 .83-.67 1.5-1.5 1.5H3.5A1.5 1.5 0 012 12V4.5z" fill="#555"/>
    <path d="M2 4.5C2 3.67 2.67 3 3.5 3H7l1.5 2h5c.83 0 1.5.67 1.5 1.5V12c0 .83-.67 1.5-1.5 1.5H3.5A1.5 1.5 0 012 12V4.5z" fill="${labelColor}" opacity="0.7"/>
    ${badge || '<circle cx="14" cy="6" r="3" fill="#fff" opacity="0.9"/>'}
  `;
  return svg(body);
}

// ─── 文件图标（文档形状 + 颜色 + 标记） ───
function fileIcon(fillColor: string, label: string): string {
  const body = `
    <path d="M4 2h6l4 4v9c0 .55-.45 1-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" fill="${fillColor}" opacity="0.85"/>
    <path d="M10 2v4h4" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.8"/>
    <text x="9" y="13.5" text-anchor="middle" font-size="7" font-family="Arial,sans-serif" fill="#fff" font-weight="bold">${label}</text>
  `;
  return svg(body);
}

// ════════════════════════════════════════
// 特殊文件夹图标
// ════════════════════════════════════════
save('folder-git.svg', folderIcon('#F05032', '<circle cx="14" cy="5.5" r="3.5" fill="#F05032"/><text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff" font-weight="bold">G</text>'));
save('folder-package.svg', folderIcon('#CB3837', '<rect x="11.5" y="3.5" width="5" height="5" rx="1" fill="#CB3837"/><text x="14" y="7.2" text-anchor="middle" font-size="4" fill="#fff" font-weight="bold">N</text>'));
save('folder-py.svg', folderIcon('#3776AB', '<text x="14" y="7.5" text-anchor="middle" font-size="5.5" fill="#FFD43B" font-weight="bold">Py</text>'));
save('folder-config.svg', folderIcon('#607D8B', '<text x="14" y="7.5" text-anchor="middle" font-size="6" fill="#fff">⚙</text>'));
save('folder-build.svg', folderIcon('#FF9800', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">⚡</text>'));
save('folder-src.svg', folderIcon('#4FC3F7', '<text x="14" y="7.5" text-anchor="middle" font-size="6" fill="#fff">{</text>'));
save('folder-test.svg', folderIcon('#4CAF50', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">✓</text>'));
save('folder-docs.svg', folderIcon('#2196F3', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">?</text>'));
save('folder-web.svg', folderIcon('#00BCD4', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">www</text>'));
save('folder-assets.svg', folderIcon('#E91E63', '<text x="14" y="7.5" text-anchor="middle" font-size="6" fill="#fff">◆</text>'));
save('folder-components.svg', folderIcon('#9C27B0', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">[]</text>'));
save('folder-db.svg', folderIcon('#795548', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">DB</text>'));
save('folder-docker.svg', folderIcon('#2496ED', '<text x="14" y="7.5" text-anchor="middle" font-size="6" fill="#fff">🐋</text>'));
save('folder-k8s.svg', folderIcon('#326CE5', '<text x="14" y="7.5" text-anchor="middle" font-size="6" fill="#fff">⛵</text>'));
save('folder-temp.svg', folderIcon('#9E9E9E', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">✕</text>'));
save('folder-tools.svg', folderIcon('#FF5722', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">🔧</text>'));
save('folder-scripts.svg', folderIcon('#009688', '<text x="14" y="7.5" text-anchor="middle" font-size="5" fill="#fff">$</text>'));
save('folder-migrations.svg', folderIcon('#FF7043', '<text x="14" y="7.5" text-anchor="middle" font-size="4" fill="#fff">↑</text>'));
save('folder-ci.svg', folderIcon('#00C853', '<text x="14" y="7.5" text-anchor="middle" font-size="4" fill="#fff">CI</text>'));

// ════════════════════════════════════════
// 文件类型图标
// ════════════════════════════════════════
save('file-pdf.svg', fileIcon('#E53935', 'PDF'));
save('file-doc.svg', fileIcon('#1976D2', 'DOC'));
save('file-sheet.svg', fileIcon('#388E3C', 'XLS'));
save('file-slide.svg', fileIcon('#D32F2F', 'PPT'));
save('file-archive.svg', fileIcon('#795548', 'ZIP'));
save('file-image.svg', fileIcon('#E91E63', 'IMG'));
save('file-audio.svg', fileIcon('#9C27B0', '♪'));
save('file-video.svg', fileIcon('#FF5722', '▶'));
save('file-font.svg', fileIcon('#607D8B', 'Aa'));
save('file-db.svg', fileIcon('#5D4037', 'DB'));
save('file-binary.svg', fileIcon('#424242', 'BIN'));
save('file-cert.svg', fileIcon('#FFA000', 'KEY'));
save('file-config.svg', fileIcon('#546E7A', 'cfg'));
save('file-notebook.svg', fileIcon('#F37726', 'NB'));
save('file-model.svg', fileIcon('#7B1FA2', '3D'));
save('file-i18n.svg', fileIcon('#43A047', 'i18'));

console.log(`✅ ${OUT_DIR} — SVG icons generated`);
