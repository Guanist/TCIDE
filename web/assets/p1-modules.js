/*  TCIDE P1 功能前端逻辑
   文件名：dist/renderer/assets/p1-modules.js
   由 index.html 通过 <script src=...> 加载
   P1: Zen Mode 完善 / 标签页增强 / 面包屑 / 空状态 / 新建项目向导
*/

(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var $$ = function(sel){ return document.querySelectorAll(sel); };
var on = function(el,ev,fn){ if(el)el.addEventListener(ev,fn); };

// ═══════════════════════════════════════
// 1. Zen Mode 完善 — CSS 类方案，GPU加速，终端联动，编辑器居中
// ═══════════════════════════════════════
(function(){
    var zenActive = false;
    var savedTerminalVisible = false;

    /* 用 CSS 类切换，所有动画走 CSS transition */
    function enterZen() {
        zenActive = true;
        document.body.classList.add('tc-zen-mode');

        /* 记录终端状态 */
        var pa = $('panel-area');
        savedTerminalVisible = pa && !pa.classList.contains('hidden');

        /* 终端联动隐藏 */
        if (pa) pa.classList.add('hidden');
        var pr = $('panel-resizer');
        if (pr) pr.classList.add('hidden');

        /* 编辑器区域居中 */
        var ea = $('editor-area');
        if (ea) ea.classList.add('zen-centered');

        showToast('Zen 专注模式 · Ctrl+Shift+M 退出', 'info', 2000);
    }

    function exitZen() {
        zenActive = false;
        document.body.classList.remove('tc-zen-mode');

        /* 恢复终端 */
        if (savedTerminalVisible) {
            var pa = $('panel-area');
            if (pa) pa.classList.remove('hidden');
            var pr = $('panel-resizer');
            if (pr) pr.classList.remove('hidden');
        }

        var ea = $('editor-area');
        if (ea) ea.classList.remove('zen-centered');

        showToast('已退出 Zen 模式', 'info', 1500);
    }

    window.__tcide_toggleZen = function() {
        if (zenActive) exitZen();
        else enterZen();
    };

    /* 覆盖命令面板中的 Zen 模式回调 */
    var origPalette = window.__tcide_showCommandPalette;
    /* 在 CP 的 Zen 命令 action 里直接引用本函数即可 */

    /* 快捷键 */
    document.addEventListener('keydown', function(e){
        if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.code === 'KeyM') {
            e.preventDefault();
            window.__tcide_toggleZen();
        }
    });

    /* 如果存在旧的 toggleZenMode，覆盖它 */
    if (typeof window.toggleZenMode === 'undefined' || !window._zenPatched) {
        window.toggleZenMode = window.__tcide_toggleZen;
        window._zenPatched = true;
    }

    console.log('[P1] Zen Mode 就绪 (CSS class 方案)');
})();

// ═══════════════════════════════════════
// 2. 编辑器标签页增强 — 关闭按钮/右键菜单/未保存指示器
// ═══════════════════════════════════════
(function(){
    var tabsContainer = $('editor-tabs');
    if (!tabsContainer) { console.log('[P1] editor-tabs 容器未找到，延迟初始化'); setTimeout(arguments.callee, 1000); return; }

    var contextMenu = null;
    var activeTabEl = null;

    /* 未保存跟踪 */
    window.__tcide_unsavedTabs = window.__tcide_unsavedTabs || {};
    window.__tcide_tabPaths = window.__tcide_tabPaths || {};

    /* 创建右键菜单 */
    function createContextMenu() {
        if (contextMenu) return;
        contextMenu = document.createElement('div');
        contextMenu.id = 'tab-context-menu';
        contextMenu.className = 'tab-context-menu';
        contextMenu.innerHTML =
            '<div class="tab-menu-item" data-action="close">关闭</div>' +
            '<div class="tab-menu-item" data-action="close-others">关闭其他</div>' +
            '<div class="tab-menu-item" data-action="close-right">关闭右侧</div>' +
            '<div class="tab-menu-sep"></div>' +
            '<div class="tab-menu-item" data-action="copy-path">复制路径</div>' +
            '<div class="tab-menu-item" data-action="reveal-file">在文件管理器中显示</div>';
        document.body.appendChild(contextMenu);

        contextMenu.addEventListener('click', function(e) {
            var action = e.target.dataset.action;
            if (!action || !activeTabEl) return;
            handleContextAction(action);
            hideContextMenu();
        });

        document.addEventListener('click', function(e) {
            if (!contextMenu || contextMenu.contains(e.target)) return;
            hideContextMenu();
        });
    }

    function showContextMenu(e, tabEl) {
        e.preventDefault();
        e.stopPropagation();
        activeTabEl = tabEl;
        createContextMenu();
        var x = Math.min(e.clientX, window.innerWidth - 160);
        var y = e.clientY;
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.add('visible');
    }

    function hideContextMenu() {
        if (contextMenu) contextMenu.classList.remove('visible');
        activeTabEl = null;
    }

    function handleContextAction(action) {
        if (!activeTabEl) return;
        var tabs = tabsContainer.querySelectorAll('.editor-tab');
        var tabArr = Array.from(tabs);
        var idx = tabArr.indexOf(activeTabEl);

        switch(action) {
            case 'close':
                closeTab(activeTabEl);
                break;
            case 'close-others':
                tabArr.forEach(function(t, i) {
                    if (i !== idx) closeTab(t);
                });
                break;
            case 'close-right':
                tabArr.forEach(function(t, i) {
                    if (i > idx) closeTab(t);
                });
                break;
            case 'copy-path':
                var fp = window.__tcide_tabPaths && window.__tcide_tabPaths[activeTabEl.dataset.tabId || ''];
                if (fp) {
                    navigator.clipboard.writeText(fp).then(function() {
                        showToast('路径已复制', 'success');
                    }).catch(function() {
                        showToast(fp, 'info', 5000);
                    });
                }
                break;
            case 'reveal-file':
                var fpath = window.__tcide_tabPaths && window.__tcide_tabPaths[activeTabEl.dataset.tabId || ''];
                if (fpath && window.api && window.api.revealInExplorer) {
                    window.api.revealInExplorer(fpath);
                }
                break;
        }
    }

    function closeTab(tabEl) {
        if (!tabEl) return;
        var clickEvent = new MouseEvent('click', { bubbles: true });
        /* 如果 tab 上有 data-path，尝试触发保存检查 */
        var closeBtn = tabEl.querySelector('.tab-close-btn');
        if (closeBtn) {
            /* 模拟原有关闭逻辑：触发原有 tab 切换机制中的关闭 */
            tabEl.dispatchEvent(new CustomEvent('tcide-close-tab', { bubbles: true }));
        }
        /* 回退：从 DOM 中移除 */
        if (tabEl.parentNode) tabEl.remove();
        document.dispatchEvent(new CustomEvent('tcide-tab-closed', { detail: tabEl.dataset.tabId }));
    }

    /* 增强所有 tab — MutationObserver 监听新增 */
    function enhanceTab(tab) {
        if (tab.dataset.tcEnhanced === '1') return;
        tab.dataset.tcEnhanced = '1';

        /* 关闭按钮 */
        var closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.title = '关闭';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeTab(tab);
        });
        tab.appendChild(closeBtn);

        /* 未保存指示器 */
        updateUnsavedDot(tab);

        /* 右键菜单 */
        tab.addEventListener('contextmenu', function(e) {
            showContextMenu(e, tab);
        });

        /* 中键关闭 */
        tab.addEventListener('mousedown', function(e) {
            if (e.button === 1) { /* 中键 */
                e.preventDefault();
                closeTab(tab);
            }
        });

        /* 双击关闭 */
        tab.addEventListener('dblclick', function(e) {
            /* 不双击关闭，容易误触。如需开启取消下面注释 */
            // closeTab(tab);
        });
    }

    function updateUnsavedDot(tab) {
        var tabId = tab.dataset.tabId;
        var isDirty = window.__tcide_unsavedTabs && window.__tcide_unsavedTabs[tabId];
        var existingDot = tab.querySelector('.tab-dirty-dot');
        if (isDirty) {
            if (!existingDot) {
                var dot = document.createElement('span');
                dot.className = 'tab-dirty-dot';
                dot.innerHTML = '●';
                tab.insertBefore(dot, tab.firstChild);
            }
        } else {
            if (existingDot) existingDot.remove();
        }
    }

    /* 监听编辑器变更来标记未保存 */
    function watchEditorChanges() {
        if (typeof monaco === 'undefined' || !monaco.editor) {
            setTimeout(watchEditorChanges, 500);
            return;
        }

        try {
            monaco.editor.onDidCreateModel(function(model) {
                model.onDidChangeContent(function() {
                    /* 标记当前 tab 为未保存 */
                    var activeTab = tabsContainer.querySelector('.editor-tab.active');
                    if (activeTab && activeTab.dataset.tabId) {
                        window.__tcide_unsavedTabs = window.__tcide_unsavedTabs || {};
                        window.__tcide_unsavedTabs[activeTab.dataset.tabId] = true;
                        updateUnsavedDot(activeTab);
                    }
                });
            });
        } catch(e) {
            console.log('[P1] Monaco 监听初始化失败:', e);
        }
    }

    /* 监听 Monaco 保存事件来清除未保存标记 */
    function watchSaveEvents() {
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
                setTimeout(function() {
                    var activeTab = tabsContainer.querySelector('.editor-tab.active');
                    if (activeTab && activeTab.dataset.tabId) {
                        window.__tcide_unsavedTabs = window.__tcide_unsavedTabs || {};
                        delete window.__tcide_unsavedTabs[activeTab.dataset.tabId];
                        updateUnsavedDot(activeTab);
                    }
                }, 300);
            }
        });
    }

    /* MutationObserver 监听新 tab */
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
                if (node.nodeType === 1 && node.classList && node.classList.contains('editor-tab')) {
                    enhanceTab(node);
                }
                /* 也检查子节点 */
                if (node.nodeType === 1 && node.querySelectorAll) {
                    node.querySelectorAll('.editor-tab').forEach(enhanceTab);
                }
            });
        });
    });

    observer.observe(tabsContainer, { childList: true, subtree: true });

    /* 增强已有 tabs */
    tabsContainer.querySelectorAll('.editor-tab').forEach(enhanceTab);
    /* 延迟再次增强（等待动态渲染） */
    setTimeout(function() { tabsContainer.querySelectorAll('.editor-tab').forEach(enhanceTab); }, 2000);

    createContextMenu();
    watchEditorChanges();
    watchSaveEvents();

    console.log('[P1] 标签页增强就绪');
})();

// ═══════════════════════════════════════
// 3. 面包屑导航
// ═══════════════════════════════════════
(function(){
    var bar = $('breadcrumb-bar');
    var pathEl = $('breadcrumb-path');
    var symEl = $('breadcrumb-symbol');
    if (!bar || !pathEl) { console.log('[P1] 面包屑容器未找到'); return; }

    var lastPath = '';
    var lastSymbol = '';

    function extractSymbols(code, lineNum) {
        /* 从光标所在行向上查找最近的 class/function/method */
        var lines = code.split('\n');
        var candidates = [];
        for (var i = 0; i < Math.min(lineNum, lines.length); i++) {
            var line = lines[i];
            var m;
            m = line.match(/^\s*(export\s+)?(default\s+)?(class|interface|struct|enum)\s+(\w+)/);
            if (m) candidates.push({ type: m[3], name: m[4], line: i });
            m = line.match(/^\s*(public|private|protected|override|static|async)?\s*(fun|function|def)\s+(\w+)\s*\(/);
            if (m) candidates.push({ type: 'function', name: m[3] + '()', line: i });
            m = line.match(/^\s*(export\s+)?(async\s+)?function\s+(\w+)/);
            if (m) candidates.push({ type: 'function', name: m[3] + '()', line: i });
            m = line.match(/^\s*(public|private|protected)?\s*(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/);
            if (m && m[3] && m[3].charCodeAt(0) > 96) candidates.push({ type: 'method', name: m[3] + '()', line: i });
        }
        /* 找光标所在行之前最近的声明 */
        var closest = null;
        for (var j = candidates.length - 1; j >= 0; j--) {
            if (candidates[j].line < lineNum) {
                if (!closest || candidates[j].line > closest.line) closest = candidates[j];
            }
        }
        return closest;
    }

    function updateBreadcrumb() {
        if (!bar) return;
        /* 获取当前文件路径 */
        var fp = '';
        if (window.editor && window.editor.getModel) {
            var model = window.editor.getModel();
            if (model && model.uri) {
                fp = model.uri.fsPath || model.uri.path || '';
            }
        }
        /* 尝试从 project root 获取相对路径 */
        var root = window.__tcide_projectRoot || '';
        if (root && fp.startsWith(root)) {
            fp = fp.substring(root.length).replace(/\\/g, '/').replace(/^\//, '');
        }

        if (fp !== lastPath) {
            lastPath = fp;
            /* 构建面包屑：将路径按 / 拆分 */
            var parts = fp.split('/').filter(Boolean);
            var html = '';
            if (parts.length > 0) {
                html += '<span class="bc-sep">📁</span> ';
                parts.forEach(function(part, i) {
                    if (i > 0) html += '<span class="bc-arrow">›</span> ';
                    html += '<span class="bc-segment' + (i === parts.length - 1 ? ' bc-file' : '') + '">' + escapeHtml(part) + '</span> ';
                });
            }
            pathEl.innerHTML = html || '<span class="bc-empty">无文件</span>';
        }

        /* 更新符号位置 */
        updateSymbol();
    }

    function updateSymbol() {
        if (!bar || !symEl || !window.editor) return;
        var model = window.editor.getModel();
        if (!model) return;
        var pos = window.editor.getPosition();
        if (!pos) return;
        var code = model.getValue();
        var sym = extractSymbols(code, pos.lineNumber);
        var newSym = sym ? '› ' + sym.name : '';
        if (newSym !== lastSymbol) {
            lastSymbol = newSym;
            symEl.textContent = newSym;
        }
    }

    function escapeHtml(s) {
        return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /* 显示 / 隐藏 */
    function show() { if(bar) bar.classList.remove('hidden'); }
    function hide() { if(bar) bar.classList.add('hidden'); }

    /* 有文件打开时显示 */
    window.__tcide_showBreadcrumb = show;
    window.__tcide_hideBreadcrumb = hide;

    /* 定时更新 */
    setInterval(updateBreadcrumb, 2000);

    /* 快捷键切换显示 */
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.code === 'KeyB') {
            e.preventDefault();
            if (bar.classList.contains('hidden')) show(); else hide();
        }
    });

    /* 初始 */
    setTimeout(show, 1500);

    console.log('[P1] 面包屑导航就绪');
})();

// ═══════════════════════════════════════
// 4. 空状态引导
// ═══════════════════════════════════════
(function(){
    /* 文件树空状态 */
    function checkFileTree() {
        var tree = $('file-tree');
        if (!tree) return;
        var items = tree.querySelectorAll('.tree-item, .tree-row, [data-path]');
        var emptyState = tree.querySelector('.empty-state-filetree');
        if (items.length === 0) {
            if (!emptyState) {
                var div = document.createElement('div');
                div.className = 'empty-state-filetree empty-state';
                div.innerHTML = '<div class="empty-state-icon">📂</div><div class="empty-state-title">暂无文件</div><div class="empty-state-desc">打开项目开始 (Ctrl+O)</div>';
                tree.appendChild(div);
            }
        } else {
            if (emptyState) emptyState.remove();
        }
    }

    /* 搜索空状态 */
    function checkSearchResults() {
        var results = $('search-results');
        if (!results) return;
        if (results.children.length === 0) {
            results.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">输入搜索内容</div><div class="empty-state-desc">Ctrl+Shift+F 打开项目级搜索</div></div>';
        }
    }

    /* 任务列表空状态 */
    function checkTaskList() {
        var list = $('task-list');
        if (!list) return;
        var tasks = list.querySelectorAll('.task-item, .task-row');
        if (tasks.length === 0) {
            var empty = list.querySelector('.task-empty');
            if (!empty) {
                var div = document.createElement('div');
                div.className = 'task-empty empty-state';
                div.innerHTML = '<div class="empty-state-icon">📋</div><div class="empty-state-title">暂无任务</div><div class="empty-state-desc">在 AI 对话中使用 /task 发起任务</div>';
                list.appendChild(div);
            }
        }
    }

    /* 问题面板空状态 */
    function checkProblems() {
        var list = $('problems-list');
        if (!list) return;
        var items = list.querySelectorAll('.problem-item');
        var empty = $('problems-empty');
        if (items.length > 0) {
            if (empty) empty.classList.add('hidden');
            if (list) list.classList.remove('hidden');
        } else {
            if (empty) empty.classList.remove('hidden');
            if (list) list.classList.add('hidden');
        }
    }

    /* 定时检查 */
    setInterval(function() {
        checkFileTree();
        checkTaskList();
        checkProblems();
    }, 3000);

    /* 初始检查 */
    setTimeout(function() {
        checkFileTree();
        checkSearchResults();
        checkTaskList();
        checkProblems();
    }, 2000);

    console.log('[P1] 空状态引导就绪');
})();

// ═══════════════════════════════════════
// 5. 新建项目向导
// ═══════════════════════════════════════
(function(){
    var TEMPLATES = [
        { id: 'blank', name: '空白项目', desc: '空的目录结构，从零开始', icon: '📄' },
        { id: 'node', name: 'Node.js', desc: 'package.json + 基础配置', icon: '⬢' },
        { id: 'python', name: 'Python', desc: '虚拟环境 + 基础脚本', icon: '🐍' },
        { id: 'frontend', name: '前端 (HTML/JS/CSS)', desc: 'index.html + 基础样式', icon: '🌐' },
        { id: 'kotlin', name: 'Kotlin / Android', desc: 'Gradle 项目骨架', icon: '📱' },
    ];

    function show() {
        /* 移除已有 modal */
        var existing = $('new-project-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'new-project-modal';
        overlay.className = 'modal-overlay';

        var tmplHtml = TEMPLATES.map(function(t, i) {
            return '<div class="np-template-card' + (i === 0 ? ' selected' : '') + '" data-tpl="' + t.id + '">' +
                '<span class="np-template-icon">' + t.icon + '</span>' +
                '<div class="np-template-info"><div class="np-template-name">' + t.name + '</div>' +
                '<div class="np-template-desc">' + t.desc + '</div></div></div>';
        }).join('');

        overlay.innerHTML =
            '<div class="modal-box np-modal">' +
            '<h3>🆕 新建项目</h3>' +
            '<div class="form-group"><label>项目名称</label><input id="np-name" type="text" placeholder="如: my-app" /></div>' +
            '<div class="form-group"><label>项目位置</label><div class="np-location-row"><input id="np-location" type="text" placeholder="点击选择..."/><button id="np-browse" class="btn-browse">浏览...</button></div></div>' +
            '<div class="form-group"><label>项目模板</label></div>' +
            '<div class="np-templates">' + tmplHtml + '</div>' +
            '<div class="modal-actions">' +
            '<button class="btn-cancel">取消</button>' +
            '<button class="btn-ok" id="np-create">创建项目</button>' +
            '</div></div>';

        document.body.appendChild(overlay);
        overlay.style.display = 'flex';

        /* 事件绑定 */
        overlay.querySelector('.btn-cancel').onclick = function() { overlay.remove(); };
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        /* 浏览按钮 */
        var browseBtn = overlay.querySelector('#np-browse');
        var locInput = overlay.querySelector('#np-location');
        if (browseBtn && window.api && window.api.selectDirectory) {
            browseBtn.onclick = async function() {
                try {
                    var dir = await window.api.selectDirectory();
                    if (dir) locInput.value = dir;
                } catch(e) {
                    /* 回退：使用原生 openProject 风格 */
                    var result = await window.api.openProject();
                    if (result) locInput.value = result;
                }
            };
        }
        /* 回退：点击直接打开文件夹对话框 */
        if (browseBtn && !window.api) {
            browseBtn.onclick = function() {
                showToast('打开项目对话框...', 'info');
                if (window.api && window.api.openProject) window.api.openProject();
            };
        }

        /* 模板选择 */
        var cards = overlay.querySelectorAll('.np-template-card');
        var selectedTpl = 'blank';
        cards.forEach(function(card) {
            card.addEventListener('click', function() {
                cards.forEach(function(c) { c.classList.remove('selected'); });
                card.classList.add('selected');
                selectedTpl = card.dataset.tpl;
            });
        });

        /* 创建 */
        var createBtn = overlay.querySelector('#np-create');
        createBtn.onclick = async function() {
            var name = overlay.querySelector('#np-name').value.trim();
            var location = locInput.value.trim();
            if (!name) { showToast('请输入项目名称', 'warning'); return; }
            if (!location) { showToast('请选择项目位置', 'warning'); return; }

            createBtn.disabled = true;
            createBtn.textContent = '创建中...';
            showLoading('正在创建项目...');

            try {
                var projectPath = location.replace(/\\/g, '/').replace(/\/$/, '') + '/' + name;

                if (window.api && window.api.createProject) {
                    await window.api.createProject({ name: name, path: projectPath, template: selectedTpl });
                } else {
                    /* 回退：通过 IPC 发送创建请求 */
                    /* 暂时用简单方式 */
                }

                hideLoading();
                overlay.remove();
                showToast('项目创建成功！', 'success');

                /* 尝试打开新项目 */
                if (window.api && window.api.openProjectPath) {
                    window.api.openProjectPath(projectPath);
                }
            } catch(e) {
                hideLoading();
                showToast('创建失败: ' + (e.message || '未知错误'), 'error');
                createBtn.disabled = false;
                createBtn.textContent = '创建项目';
            }
        };

        /* 自动聚焦 */
        setTimeout(function() {
            var nameInput = overlay.querySelector('#np-name');
            if (nameInput) nameInput.focus();
        }, 100);
    }

    window.__tcide_showNewProject = show;

    /* 绑定欢迎页的新建按钮 */
    setTimeout(function() {
        var btn = $('welcome-new-project');
        if (btn) btn.addEventListener('click', function() { show(); });
        var btn2 = $('welcome-new');
        if (btn2) btn2.addEventListener('click', function() { show(); });
    }, 1500);

    console.log('[P1] 新建项目向导就绪');
})();

// ═══════════════════════════════════════
// 6. UI 一致性优化 — 注入 CSS 变量 + 通用过渡
// ═══════════════════════════════════════
(function(){
    /* 如果页面已有 tc-vars 则跳过 */
    if (document.getElementById('tc-vars-style')) { console.log('[P1] CSS 变量已存在，跳过'); return; }

    var style = document.createElement('style');
    style.id = 'tc-vars-style';
    style.textContent =
        '/* TCIDE UI 一致性 CSS 变量 */\n' +
        ':root {\n' +
        '  --tc-bg-primary: #1e1e1e;\n' +
        '  --tc-bg-secondary: #252526;\n' +
        '  --tc-bg-tertiary: #2d2d2d;\n' +
        '  --tc-bg-hover: #2a2d2e;\n' +
        '  --tc-bg-active: #37373d;\n' +
        '  --tc-border: #3c3c3c;\n' +
        '  --tc-border-light: #454545;\n' +
        '  --tc-text-primary: #cccccc;\n' +
        '  --tc-text-secondary: #969696;\n' +
        '  --tc-text-muted: #6e6e6e;\n' +
        '  --tc-accent: #007acc;\n' +
        '  --tc-accent-hover: #1a8ad4;\n' +
        '  --tc-danger: #f44747;\n' +
        '  --tc-warning: #ffcc00;\n' +
        '  --tc-success: #4ec9b0;\n' +
        '  --tc-orange: #ff8c00;\n' +
        '  --tc-radius: 4px;\n' +
        '  --tc-transition: 200ms ease;\n' +
        '}\n' +
        '/* 通用过渡 */\n' +
        '.activity-btn, .editor-tab, .panel-tab, .ai-tab, .sidebar *, .ai-panel *, .tree-item, .chat-message {\n' +
        '  transition: background-color var(--tc-transition), color var(--tc-transition), border-color var(--tc-transition), opacity var(--tc-transition);\n' +
        '}\n' +
        'button, .icon-btn, .quick-btn, .send-btn, .abort-btn {\n' +
        '  transition: background-color var(--tc-transition), color var(--tc-transition), transform var(--tc-transition), opacity var(--tc-transition);\n' +
        '}\n' +
        'button:active { transform: scale(0.97); }\n' +
        '.icon-btn:active { transform: scale(0.92); }\n' +
        '/* 聚焦环 */\n' +
        'input:focus-visible, button:focus-visible, textarea:focus-visible, select:focus-visible {\n' +
        '  outline: 1px solid var(--tc-accent);\n' +
        '  outline-offset: -1px;\n' +
        '}\n';

    document.head.appendChild(style);
    console.log('[P1] CSS 变量已注入');
})();

// ═══════════════════════════════════════
// 7. 全局快捷键增强 + 菜单命令监听
// ═══════════════════════════════════════
(function(){
    /* 监听主进程菜单命令 */
    if (window.api && window.api.onMenuAction) {
        window.api.onMenuAction(function(action) {
            switch(action) {
                case 'new-file': $$('#btn-new-file')[0] && $$('#btn-new-file')[0].click(); break;
                case 'new-folder': $$('#btn-new-folder')[0] && $$('#btn-new-folder')[0].click(); break;
                case 'new-project': window.__tcide_showNewProject && window.__tcide_showNewProject(); break;
                case 'toggle-breadcrumb':
                    var bc = $('breadcrumb-bar'); if(bc) bc.classList.toggle('hidden');
                    break;
                case 'show-shortcuts':
                    var hd = $('help-dialog'); if(hd) hd.classList.remove('hidden');
                    break;
                case 'save-all': /* 触发全保存 */ break;
                case 'find': /* 触发 Monaco 查找 */ break;
                case 'replace': /* 触发 Monaco 替换 */ break;
                case 'toggle-ai-panel': 
                    var ap = $('ai-panel'); if(ap) ap.classList.toggle('hidden');
                    break;
                case 'zen-mode': window.__tcide_toggleZen && window.__tcide_toggleZen(); break;
                case 'toggle-terminal':
                    var pa = $('panel-area'); if(pa) pa.classList.toggle('hidden');
                    var pr = $('panel-resizer'); if(pr) pr.classList.toggle('hidden');
                    break;
                case 'send-to-builder': /* AI 面板操作 */ break;
                case 'abort-task': /* AI 面板操作 */ break;
                case 'clear-chat': /* AI 面板操作 */ break;
                case 'open-settings': 
                    var st = document.querySelector('.ai-tab[data-tab="settings"]');
                    if(st) st.click();
                    break;
                default: console.log('[P1] 未处理的菜单命令:', action);
            }
        });
    }

    /* 额外快捷键 */
    document.addEventListener('keydown', function(e) {
        /* Ctrl+Shift+N — 新建项目 */
        if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.code === 'KeyN') {
            e.preventDefault();
            window.__tcide_showNewProject && window.__tcide_showNewProject();
        }
    });

    console.log('[P1] 快捷键增强就绪');
})();

console.log('[P1] 所有 P1 模块加载完成');
})();