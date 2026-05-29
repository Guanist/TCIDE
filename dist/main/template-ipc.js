// template-ipc.js
// 模板系统 IPC handlers
// 由 ipc-handlers.js 的 setupIpcHandlers() 调用

const electron = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = electron;

const TEMPLATES_DIR = path.join(app.getPath('appData'), 'TCIDE', 'templates');
const USER_FILE = path.join(TEMPLATES_DIR, 'user_templates.json');
const DEFAULT_FILE = path.join(TEMPLATES_DIR, 'default_templates.json');

const DEFAULT_TEMPLATES = [
  {
    id: 'default-cpp-basic',
    name: 'C++ 基础模板',
    category: 'C++',
    tags: ['基础', '竞赛'],
    code: '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    // 你的代码\n    \n    return 0;\n}',
    description: 'C++ 竞赛基础模板，包含常用头文件和加速'
  },
  {
    id: 'default-cpp-fastio',
    name: 'C++ 快读模板',
    category: 'C++',
    tags: ['快读', '竞赛'],
    code: '#include <iostream>\n#include <cstdio>\nusing namespace std;\n\ninline int read() {\n    int x = 0, f = 1;\n    char ch = getchar();\n    while (ch < \'0\' || ch > \'9\') { if (ch == \'-\') f = -1; ch = getchar(); }\n    while (ch >= \'0\' && ch <= \'9\') { x = x * 10 + ch - \'0\'; ch = getchar(); }\n    return x * f;\n}\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    int n = read();\n    // 你的代码\n    \n    return 0;\n}',
    description: '带快读的 C++ 模板，适用于大数据量输入'
  },
  {
    id: 'default-cpp-dp',
    name: 'C++ DP 模板',
    category: 'C++',
    tags: ['DP', '动态规划'],
    code: '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    int n;\n    cin >> n;\n    vector<int> dp(n + 1, 0);\n    \n    // DP 转移\n    for (int i = 1; i <= n; i++) {\n        dp[i] = max(dp[i-1], ...);\n    }\n    \n    cout << dp[n] << endl;\n    return 0;\n}',
    description: '动态规划基础模板'
  },
  {
    id: 'default-python-basic',
    name: 'Python 基础模板',
    category: 'Python',
    tags: ['基础'],
    code: 'import sys\n\ndef main():\n    # 你的代码\n    pass\n\nif __name__ == \'__main__\':\n    main()\n',
    description: 'Python 基础模板'
  },
  {
    id: 'default-java-basic',
    name: 'Java 基础模板',
    category: 'Java',
    tags: ['基础', '竞赛'],
    code: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n        // 你的代码\n        \n        sc.close();\n    }\n}\n',
    description: 'Java 竞赛基础模板'
  }
];

function ensureDir() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
}

function initDefaults() {
  ensureDir();
  if (!fs.existsSync(DEFAULT_FILE)) {
    fs.writeFileSync(DEFAULT_FILE, JSON.stringify(DEFAULT_TEMPLATES, null, 2), 'utf-8');
  }
}

function loadUserTemplates() {
  ensureDir();
  initDefaults();
  if (!fs.existsSync(USER_FILE)) {
    fs.writeFileSync(USER_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(USER_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveUserTemplates(templates) {
  ensureDir();
  fs.writeFileSync(USER_FILE, JSON.stringify(templates, null, 2), 'utf-8');
}

function loadDefaultTemplates() {
  ensureDir();
  initDefaults();
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf-8'));
  } catch (e) {
    return DEFAULT_TEMPLATES;
  }
}

function genId() {
  return 'tpl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function setupTemplateIpc() {
  // 获取所有模板（内置 + 用户）
  electron.ipcMain.handle('template:list', async () => {
    const defaults = loadDefaultTemplates();
    const user = loadUserTemplates();
    return { defaults, user };
  });

  // 获取单个模板详情
  electron.ipcMain.handle('template:get', async (_e, id) => {
    const defaults = loadDefaultTemplates();
    const user = loadUserTemplates();
    return defaults.find(t => t.id === id) || user.find(t => t.id === id) || null;
  });

  // 新建用户模板
  electron.ipcMain.handle('template:create', async (_e, template) => {
    const user = loadUserTemplates();
    const newTpl = {
      id: genId(),
      name: template.name || '新模板',
      category: template.category || '未分类',
      tags: template.tags || [],
      code: template.code || '',
      description: template.description || ''
    };
    user.push(newTpl);
    saveUserTemplates(user);
    return newTpl;
  });

  // 更新用户模板
  electron.ipcMain.handle('template:update', async (_e, id, updates) => {
    const user = loadUserTemplates();
    const idx = user.findIndex(t => t.id === id);
    if (idx === -1) throw new Error('模板不存在或不可编辑');
    user[idx] = { ...user[idx], ...updates, id }; // 保留 id 不变
    saveUserTemplates(user);
    return user[idx];
  });

  // 删除用户模板
  electron.ipcMain.handle('template:delete', async (_e, id) => {
    let user = loadUserTemplates();
    user = user.filter(t => t.id !== id);
    saveUserTemplates(user);
    return { ok: true };
  });

  // 重置内置模板（恢复默认）
  electron.ipcMain.handle('template:resetDefaults', async () => {
    fs.writeFileSync(DEFAULT_FILE, JSON.stringify(DEFAULT_TEMPLATES, null, 2), 'utf-8');
    return { ok: true };
  });
}

module.exports = { setupTemplateIpc };
