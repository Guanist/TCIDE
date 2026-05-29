// template-service.js
// 模板系统：CRUD + 默认模板初始化
// 存储位置：appData/TCIDE/templates/

const fs = require('fs');
const path = require('path');
const electron = require('electron');

const TEMPLATES_DIR = path.join(electron.app.getPath('appData'), 'TCIDE', 'templates');
const USER_FILE = path.join(TEMPLATES_DIR, 'user_templates.json');
const DEFAULT_FILE = path.join(TEMPLATES_DIR, 'default_templates.json');

// 默认内置模板（首次启动时写入 default_templates.json）
const DEFAULT_TEMPLATES = [
  {
    id: 'default-cpp-basic',
    name: 'C++ 基础模板',
    category: 'C++',
    tags: ['基础', '竞赛'],
    code: `#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    // 你的代码\n    \n    return 0;\n}`,
    description: 'C++ 竞赛基础模板，包含常用头文件和加速'
  },
  {
    id: 'default-cpp-fastio',
    name: 'C++ 快读模板',
    category: 'C++',
    tags: ['快读', '竞赛'],
    code: `#include <iostream>\n#include <cstdio>\nusing namespace std;\n\ninline int read() {\n    int x = 0, f = 1;\n    char ch = getchar();\n    while (ch < '0' || ch > '9') { if (ch == '-') f = -1; ch = getchar(); }\n    while (ch >= '0' && ch <= '9') { x = x * 10 + ch - '0'; ch = getchar(); }\n    return x * f;\n}\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    int n = read();\n    // 你的代码\n    \n    return 0;\n}`,
    description: '带快读的 C++ 模板，适用于大数据量输入'
  },
  {
    id: 'default-cpp-dp',
    name: 'C++ DP 模板',
    category: 'C++',
    tags: ['DP', '动态规划'],
    code: `#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    int n;\n    cin >> n;\n    vector<int> dp(n + 1, 0);\n    \n    // DP 转移\n    for (int i = 1; i <= n; i++) {\n        dp[i] = max(dp[i-1], ...);\n    }\n    \n    cout << dp[n] << endl;\n    return 0;\n}`,
    description: '动态规划基础模板'
  },
  {
    id: 'default-python-basic',
    name: 'Python 基础模板',
    category: 'Python',
    tags: ['基础'],
    code: `import sys\n\ndef main():\n    # 你的代码\n    pass\n\nif __name__ == '__main__':\n    main()\n`,
    description: 'Python 基础模板'
  },
  {
    id: 'default-java-basic',
    name: 'Java 基础模板',
    category: 'Java',
    tags: ['基础', '竞赛'],
    code: `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n        // 你的代码\n        \n        sc.close();\n    }\n}\n`,
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
  } catch {
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
  } catch {
    return DEFAULT_TEMPLATES;
  }
}

// 生成简单 ID
function genId() {
  return 'tpl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  DEFAULT_TEMPLATES,
  TEMPLATES_DIR,
  USER_FILE,
  DEFAULT_FILE,
  ensureDir,
  initDefaults,
  loadUserTemplates,
  saveUserTemplates,
  loadDefaultTemplates,
  genId
};
