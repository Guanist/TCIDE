// === 追加：项目级搜索 IPC handler ===
ipcMain.handle('search:project', async (_e, projectPath, query) => {
  const fs = require('fs');
  const path = require('path');
  const results = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'dist') continue;
        walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.exe') || entry.name.endsWith('.dll') || entry.name.endsWith('.so') || entry.name.endsWith('.class')) continue;
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                file: entry.name,
                path: full.replace(projectPath, '').replace(/^[/\\]/, ''),
                line: idx,
                snippet: line.trim().substring(0, 200)
              });
            }
          });
        } catch { /* skip binary files */ }
      }
    }
  }

  walk(projectPath);
  return results.slice(0, 500);  // 最多返回500条
});

// === 追加：最近项目读写 IPC handlers ===
const RECENT_PROJECTS_FILE = require('path').join(app.getPath('appData'), 'TCIDE', 'recent-projects.json');
const fs = require('fs');
const path = require('path');

function ensureRecentFile() {
  const dir = path.dirname(RECENT_PROJECTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(RECENT_PROJECTS_FILE)) fs.writeFileSync(RECENT_PROJECTS_FILE, '[]', 'utf-8');
}

ipcMain.handle('project:getRecent', async () => {
  ensureRecentFile();
  try {
    return JSON.parse(fs.readFileSync(RECENT_PROJECTS_FILE, 'utf-8'));
  } catch { return []; }
});

ipcMain.handle('project:addRecent', async (_e, projectPath) => {
  ensureRecentFile();
  let list = [];
  try { list = JSON.parse(fs.readFileSync(RECENT_PROJECTS_FILE, 'utf-8')); } catch {}
  // 去重，移到最前
  list = list.filter(p => p.path !== projectPath);
  const name = require('path').basename(projectPath);
  list.unshift({ name, path: projectPath, lastOpen: new Date().toISOString() });
  // 最多保留20个
  list = list.slice(0, 20);
  fs.writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  return list;
});
