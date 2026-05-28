/**
 * after-pack.js - Electron Builder 打包后处理
 * 进一步裁剪 Monaco Editor 体积（tree-shaking）
 */
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const extResources = path.join(appOutDir, 'resources', 'monaco-editor');

  if (!fs.existsSync(extResources)) return;

  // 删除未使用的语言支持文件（保留 Kotlin/Java/Python/TypeScript/JSON/Markdown/Shell）
  const langToRemove = [
    'az', 'bg', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fr', 'hu', 'it',
    'ja', 'ko', 'nl', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk',
    'sl', 'sr', 'sv', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
  ];

  for (const lang of langToRemove) {
    const localeDir = path.join(extResources, 'vs', 'language', lang);
    if (fs.existsSync(localeDir)) {
      fs.rmSync(localeDir, { recursive: true, force: true });
    }
  }

  // 删除未使用的 editor 功能
  const removeDirs = [
    'vs/editor/editor.worker',
    'vs/json.worker',
    'vs/css.worker',
    'vs/html.worker',
  ];

  for (const dir of removeDirs) {
    const fullPath = path.join(extResources, dir);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  // 清理测试和源码文件
  const patterns = [
    /test\//, /\.test\./, /\.spec\./, /_test/, /_spec/,
  ];

  function cleanFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanFiles(fullPath);
        // 删除空目录
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else if (patterns.some(p => p.test(entry.name))) {
        fs.unlinkSync(fullPath);
      }
    }
  }

  cleanFiles(extResources);
  console.log('[AfterPack] Monaco Editor tree-shaking complete');
};
