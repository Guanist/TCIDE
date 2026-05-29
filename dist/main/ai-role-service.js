// ai-role-service.js
// AI 角色系统：角色 CRUD + 默认角色初始化
// 存储位置：appData/TCIDE/ai-roles.json

const fs = require('fs');
const path = require('path');
const electron = require('electron');

const ROLES_FILE = path.join(electron.app.getPath('appData'), 'TCIDE', 'ai-roles.json');

// 默认预制角色
const DEFAULT_ROLES = [
  {
    id: 'role-default',
    name: '默认助手',
    avatar: '🤖',
    description: '通用 AI 编程助手，平衡代码生成与解释',
    systemPrompt: '你是一个专业的编程助手。你擅长代码生成、调试、重构和架构设计。\n\n规则：\n1. 优先给出可运行的完整代码\n2. 解释关键逻辑，但不过度啰嗦\n3. 发现潜在 bug 时主动指出\n4. 代码格式规范，符合语言惯用风格',
    temperature: 0.7,
    maxTokens: 4096,
    isDefault: true
  },
  {
    id: 'role-reviewer',
    name: '代码审查者',
    avatar: '🔍',
    description: '专注代码质量、安全漏洞和最佳实践审查',
    systemPrompt: '你是一个严格的代码审查专家。你的职责是发现代码中的问题：\n\n审查重点：\n1. 安全漏洞（SQL注入、XSS、缓冲区溢出等）\n2. 逻辑错误和边界条件\n3. 性能问题（时间/空间复杂度）\n4. 代码规范和最佳实践\n5. 潜在 bug 和异常处理缺失\n\n输出格式：\n- 问题等级：[严重] / [警告] / [建议]\n- 问题描述 + 具体行号（如有）\n- 修复建议 + 示例代码',
    temperature: 0.3,
    maxTokens: 4096,
    isDefault: true
  },
  {
    id: 'role-architect',
    name: '架构师',
    avatar: '🏗️',
    description: '专注系统设计、模块划分和技术选型',
    systemPrompt: '你是一个资深软件架构师。你擅长：\n\n能力范围：\n1. 系统架构设计（分层、微服务、事件驱动等）\n2. 模块划分和依赖设计\n3. 技术选型建议（框架、数据库、中间件）\n4. 性能优化方案\n5. 可扩展性和可维护性设计\n\n回答风格：\n- 先给出整体架构图（用文字描述或 ASCII art）\n- 再分模块详细说明\n- 最后给出实施路线图\n- 权衡不同方案的优缺点',
    temperature: 0.5,
    maxTokens: 8192,
    isDefault: true
  }
];

function loadRoles() {
  try {
    if (!fs.existsSync(ROLES_FILE)) {
      // 首次使用，写入默认角色
      fs.writeFileSync(ROLES_FILE, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf-8');
      return DEFAULT_ROLES;
    }
    return JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8'));
  } catch (e) {
    console.error('[Roles] Load error:', e);
    return DEFAULT_ROLES;
  }
}

function saveRoles(roles) {
  try {
    const dir = path.dirname(ROLES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Roles] Save error:', e);
    throw e;
  }
}

function genId() {
  return 'role-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getActiveRole() {
  const roles = loadRoles();
  const active = roles.find(r => r.isActive);
  return active || roles.find(r => r.id === 'role-default') || roles[0];
}

function setActiveRole(id) {
  const roles = loadRoles();
  roles.forEach(r => { r.isActive = (r.id === id); });
  saveRoles(roles);
  return roles.find(r => r.id === id) || null;
}

module.exports = {
  DEFAULT_ROLES,
  ROLES_FILE,
  loadRoles,
  saveRoles,
  genId,
  getActiveRole,
  setActiveRole
};
