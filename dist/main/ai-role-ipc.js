// ai-role-ipc.js
// AI 角色系统 IPC handlers
// 由 main/index.js 调用：setupRoleIpc(ipcMain, rolesFilePath)

const fs = require('fs');
const path = require('path');

const DEFAULT_ROLES = [
  {
    id: 'role-default',
    name: '默认助手',
    avatar: '🤖',
    description: '通用 AI 编程助手，平衡代码生成与解释',
    systemPrompt: '你是一个专业的编程助手。你擅长代码生成、调试、重构和架构设计。\n\n规则：\n1. 优先给出可运行的完整代码\n2. 解释关键逻辑，但不过度啰嗦\n3. 发现潜在 bug 时主动指出\n4. 代码格式规范，符合语言惯用风格',
    temperature: 0.7,
    maxTokens: 4096,
    isDefault: true,
    isActive: true
  },
  {
    id: 'role-reviewer',
    name: '代码审查者',
    avatar: '🔍',
    description: '专注代码质量、安全漏洞和最佳实践审查',
    systemPrompt: '你是一个严格的代码审查专家。你的职责是发现代码中的问题：\n\n审查重点：\n1. 安全漏洞（SQL注入、XSS、缓冲区溢出等）\n2. 逻辑错误和边界条件\n3. 性能问题（时间/空间复杂度）\n4. 代码规范和最佳实践\n5. 潜在 bug 和异常处理缺失\n\n输出格式：\n- 问题等级：[严重] / [警告] / [建议]\n- 问题描述 + 具体行号（如有）\n- 修复建议 + 示例代码',
    temperature: 0.3,
    maxTokens: 4096,
    isDefault: true,
    isActive: false
  },
  {
    id: 'role-architect',
    name: '架构师',
    avatar: '🏗️',
    description: '专注系统设计、模块划分和技术选型',
    systemPrompt: '你是一个资深软件架构师。你擅长：\n\n能力范围：\n1. 系统架构设计（分层、微服务、事件驱动等）\n2. 模块划分和依赖设计\n3. 技术选型建议（框架、数据库、中间件）\n4. 性能优化方案\n5. 可扩展性和可维护性设计\n\n回答风格：\n- 先给出整体架构图（用文字描述或 ASCII art）\n- 再分模块详细说明\n- 最后给出实施路线图\n- 权衡不同方案的优缺点',
    temperature: 0.5,
    maxTokens: 8192,
    isDefault: true,
    isActive: false
  }
];

function setupRoleIpc(ipcMain, rolesFile) {
  // rolesFile: 完整路径，如 C:\Users\...\AppData\Roaming\TCIDE\ai-roles.json

  function ensureRolesFile() {
    const dir = path.dirname(rolesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(rolesFile)) {
      fs.writeFileSync(rolesFile, JSON.stringify(DEFAULT_ROLES, null, 2), 'utf-8');
    }
  }

  function loadRoles() {
    ensureRolesFile();
    try {
      return JSON.parse(fs.readFileSync(rolesFile, 'utf-8'));
    } catch (e) {
      console.error('[RoleIPC] Load error:', e);
      return DEFAULT_ROLES;
    }
  }

  function saveRoles(roles) {
    ensureRolesFile();
    fs.writeFileSync(rolesFile, JSON.stringify(roles, null, 2), 'utf-8');
  }

  function genId() {
    return 'role-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  // 获取所有角色
  ipcMain.handle('role:list', async () => loadRoles());

  // 获取当前激活角色
  ipcMain.handle('role:getActive', async () => {
    const roles = loadRoles();
    return roles.find(r => r.isActive) || roles[0] || null;
  });

  // 切换激活角色
  ipcMain.handle('role:setActive', async (_e, id) => {
    const roles = loadRoles();
    roles.forEach(r => { r.isActive = (r.id === id); });
    saveRoles(roles);
    return roles.find(r => r.id === id) || null;
  });

  // 创建新角色
  ipcMain.handle('role:create', async (_e, role) => {
    const roles = loadRoles();
    const newRole = {
      id: genId(),
      name: role.name || '新角色',
      avatar: role.avatar || '🤖',
      description: role.description || '',
      systemPrompt: role.systemPrompt || '',
      temperature: role.temperature || 0.7,
      maxTokens: role.maxTokens || 4096,
      isDefault: false,
      isActive: false
    };
    roles.push(newRole);
    saveRoles(roles);
    return newRole;
  });

  // 更新角色
  ipcMain.handle('role:update', async (_e, id, updates) => {
    const roles = loadRoles();
    const idx = roles.findIndex(r => r.id === id);
    if (idx === -1) throw new Error('角色不存在');
    roles[idx] = { ...roles[idx], ...updates, id: roles[idx].id, isDefault: roles[idx].isDefault };
    saveRoles(roles);
    return roles[idx];
  });

  // 删除角色（不允许删除默认角色）
  ipcMain.handle('role:delete', async (_e, id) => {
    const roles = loadRoles();
    const target = roles.find(r => r.id === id);
    if (!target) throw new Error('角色不存在');
    if (target.isDefault) throw new Error('不能删除默认角色');
    const filtered = roles.filter(r => r.id !== id);
    // 如果删除的是当前激活角色，切换到默认
    if (target.isActive && filtered.length > 0) {
      filtered[0].isActive = true;
    }
    saveRoles(filtered);
    return { ok: true };
  });

  // 重置默认角色
  ipcMain.handle('role:resetDefaults', async () => {
    const roles = loadRoles();
    const userRoles = roles.filter(r => !r.isDefault);
    const active = roles.find(r => r.isActive);
    const merged = [...DEFAULT_ROLES, ...userRoles];
    if (active) {
      merged.forEach(r => { r.isActive = (r.id === active.id); });
    } else {
      merged[0].isActive = true;
    }
    saveRoles(merged);
    return { ok: true };
  });

  console.log('[RoleIPC] Handlers registered');
}

module.exports = { setupRoleIpc };
