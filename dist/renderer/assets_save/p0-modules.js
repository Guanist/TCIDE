/*  TCIDE P0 功能前端逻辑 — 独立文件，避免 </script> 截断问题
   文件名：dist/renderer/assets/p0-modules.js
   由 index.html 通过 <script src=...> 加载
*/

/* 工具函数 */
function $id(x){ return document.getElementById(x); }
function showToast(msg, type, duration){
    type = type||'info'; duration = duration||3000;
    var c = $id('toast-container');
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    var icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
    t.innerHTML = '<span class="toast-msg">' + (icons[type]||'') + ' ' + msg + '</span><button class="toast-close">✕</button>';
    t.querySelector('.toast-close').onclick = function(){ t.remove(); };
    c.appendChild(t);
    setTimeout(function(){ t.style.animation='toastOut 0.3s ease forwards'; setTimeout(function(){t.remove();},280); }, duration);
}
function showLoading(msg){ $id('loading-text').textContent=msg||'加载中...'; $id('loading-overlay').classList.add('visible'); }
function hideLoading(){ $id('loading-overlay').classList.remove('visible'); }

/* 1. 代码大纲 */
(function(){
    var symbols = [];
    function refresh(){
        var model = window.editor && window.editor.getModel && window.editor.getModel();
        if(!model){ symbols=[]; render(); return; }
        var code = model.getValue();
        var lines = code.split('\n');
        symbols=[];
        var depth=0;
        for(var i=0;i<lines.length;i++){
            var line=lines[i];
            var m=line.match(/^\s*(export\s+)?(default\s+)?(class|interface|struct|enum)\s+(\w+)/);
            if(m){ symbols.push({name:m[4],type:'class',line:i,depth:depth}); depth++; continue; }
            m=line.match(/^\s*(public|private|protected|override)?\s*(fun|void|String|Int|Boolean|\w+)\s+(\w+)\s*\(/);
            if(m&&m[3]&&depth>0){ symbols.push({name:m[3]+'()',type:'method',line:i,depth:depth}); continue; }
            m=line.match(/^\s*(export\s+)?(async\s+)?function\s+(\w+)/);
            if(m){ symbols.push({name:m[3]+'()',type:'function',line:i,depth:0}); continue; }
            m=line.match(/^\s*(const|let|var|val|var)\s+(\w+)\s*=/);
            if(m){ symbols.push({name:m[2],type:'variable',line:i,depth:depth}); continue; }
            if(line.match(/^\s*\}/)){ depth=Math.max(0,depth-1); }
        }
        render();
    }
    function render(){
        var list=$id('outline-list'); if(!list) return;
        var q=($id('outline-search')&&$id('outline-search').value||'').toLowerCase();
        var filtered=q?symbols.filter(function(s){return s.name.toLowerCase().indexOf(q)>=0;}):symbols;
        if(!filtered.length){ list.innerHTML='<div id="outline-empty">'+(q?'无匹配符号':'打开文件后显示大纲')+'</div>'; return; }
        list.innerHTML='';
        filtered.forEach(function(s){
            var d=document.createElement('div');
            d.className='outline-item depth-'+Math.min(s.depth,3);
            var icons={class:'📦',function:'⚡',method:'🔧',variable:'📄'};
            d.innerHTML='<span class="sym-icon">'+(icons[s.type]||'📄')+'</span><span class="sym-name">'+s.name+'</span><span class="sym-type">'+s.type+'</span>';
            d.onclick=function(){ if(window.editor) window.editor.setPosition({lineNumber:s.line+1,column:1}); window.editor.focus(); };
            list.appendChild(d);
        });
    }
    var btn=document.querySelector('[data-view="outline"]');
    if(btn){ btn.addEventListener('click',function(){
        document.querySelectorAll('.activity-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        document.querySelectorAll('.sidebar-panel').forEach(function(p){p.classList.add('hidden');});
        var panel=$id('outline-panel'); if(panel) panel.classList.remove('hidden');
        refresh();
    });}
    if($id('outline-search')) $id('outline-search').addEventListener('input', render);
    setInterval(function(){ if(window.editor&&window.editor.getModel) refresh(); }, 3000);
    window.__tcide_refreshOutline=refresh;
})();

/* 2. 项目级搜索 Ctrl+Shift+F */
(function(){
    var panel=$id('search-panel');
    var input=$id('search-input');
    var results=$id('search-results');
    var status=$id('search-status');
    window.__tcide_showSearch=function(){ if(panel) panel.classList.add('visible'); if(input) input.focus(); };
    window.__tcide_hideSearch=function(){ if(panel) panel.classList.remove('visible'); };
    async function doSearch(){
        if(!input||!input.value.trim()) return;
        showLoading('正在搜索...');
        status.textContent='搜索中...';
        try {
            var root=window.__tcide_projectRoot||'';
            var r=await window.api.searchInProject(root, input.value.trim());
            hideLoading(); renderResults(r||[]);
        } catch(e){ hideLoading(); status.textContent='搜索出错'; }
    }
    function renderResults(items){
        if(!items.length){ results.innerHTML='<div style="padding:10px;color:#6e6e6e;">未找到匹配结果</div>'; status.textContent='找到 0 个匹配'; return; }
        status.textContent='找到 '+items.length+' 个匹配';
        results.innerHTML='';
        items.forEach(function(item){
            var d=document.createElement('div'); d.className='search-result-item';
            var snip=(item.snippet||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            try{ var q=(input&&input.value)||''; if(q) snip=snip.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'<mark>$&</mark>'); }catch(ex){}
            d.innerHTML='<span class="result-file">📄 '+item.file+'</span>'
                +'<span class="result-line">'+(item.line+1)+'</span>'
                +'<span class="result-snippet">'+snip+'</span>';
            d.onclick=function(){ if(window.editor&&item.line!=null) window.editor.setPosition({lineNumber:item.line+1,column:1}); };
            results.appendChild(d);
        });
    }
    if(input) input.addEventListener('keydown',function(e){ if(e.key==='Enter') doSearch(); });
    if($id('search-btn-go')) $id('search-btn-go').addEventListener('click',doSearch);
    if($id('search-btn-close')) $id('search-btn-close').addEventListener('click',function(){window.__tcide_hideSearch();});
    document.addEventListener('keydown',function(e){ if(e.ctrlKey&&e.shiftKey&&e.key==='F'){ e.preventDefault(); window.__tcide_showSearch(); } });
})();

/* 3. 文件树搜索 */
(function(){
    var bar=$id('filetree-search-bar'); var inp=$id('filetree-search-input');
    window.__tcide_showFileTreeSearch=function(){ if(bar){bar.classList.add('visible');if(inp)inp.focus();} };
    if(inp){ inp.addEventListener('input',function(){
        var q=inp.value.toLowerCase();
        if(!q){ $id('file-tree').querySelectorAll('.tree-item').forEach(function(item){item.style.display='flex';}); return; }
        $id('file-tree').querySelectorAll('.tree-item').forEach(function(item){
            item.style.display=(item.dataset.name||'').toLowerCase().indexOf(q)>=0?'flex':'none';
        });
    });}
    if($id('filetree-search-clear')) $id('filetree-search-clear').addEventListener('click',function(){if(inp)inp.value='';if(bar)bar.classList.remove('visible');});
    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&bar&&bar.classList.contains('visible')){ bar.classList.remove('visible'); if(inp)inp.value=''; }});
})();

/* 4. 命令面板 Ctrl+Shift+P */
(function(){
    var overlay=$id('command-palette-overlay'); var input=$id('command-palette-input'); var list=$id('command-palette-list'); var selectedIdx=0; var filtered=[];
    var COMMANDS=[
        {label:'新建文件',category:'文件',shortcut:'Ctrl+N',action:function(){window.api&&window.api.newFile&&window.api.newFile();}},
        {label:'保存文件',category:'文件',shortcut:'Ctrl+S',action:function(){window.api&&window.api.saveFile&&window.api.saveFile();}},
        {label:'打开项目',category:'文件',shortcut:'Ctrl+O',action:function(){window.api&&window.api.openProject&&window.api.openProject();}},
        {label:'全部保存',category:'文件',shortcut:'Ctrl+K S',action:function(){window.api&&window.api.saveAll&&window.api.saveAll();}},
        {label:'全局搜索',category:'搜索',shortcut:'Ctrl+Shift+F',action:function(){window.__tcide_showSearch&&window.__tcide_showSearch();}},
        {label:'跳转到行',category:'搜索',shortcut:'Ctrl+G',action:function(){var n=prompt('跳转到行:');if(n&&window.editor)window.editor.setPosition({lineNumber:parseInt(n),column:1});}},
        {label:'AI 生成代码',category:'AI',shortcut:'Ctrl+Shift+I',action:function(){window.api&&window.api.aiGenerate&&window.api.aiGenerate();}},
        {label:'AI 解释代码',category:'AI',shortcut:'Ctrl+Shift+E',action:function(){window.api&&window.api.aiExplain&&window.api.aiExplain();}},
        {label:'代码大纲',category:'视图',shortcut:'Ctrl+Shift+O',action:function(){var b=document.querySelector('[data-view="outline"]');if(b)b.click();}},
        {label:'Zen 模式',category:'视图',shortcut:'Ctrl+Shift+M',action:function(){window.api&&window.api.toggleZen&&window.api.toggleZen();}},
        {label:'切换终端',category:'视图',shortcut:'Ctrl+`',action:function(){window.api&&window.api.toggleTerminal&&window.api.toggleTerminal();}},
        {label:'打开设置',category:'设置',shortcut:'Ctrl+,',action:function(){window.api&&window.api.openSettings&&window.api.openSettings();}},
    ];
    function show(){ if(!overlay) return; overlay.classList.add('visible'); if(input){input.value='';input.focus();} selectedIdx=0; render(COMMANDS); }
    function hide(){ if(!overlay) return; overlay.classList.remove('visible'); }
    window.__tcide_showCommandPalette=show;
    function render(cmds){ filtered=cmds; if(!list) return; if(!filtered.length){list.innerHTML='<div id="cmd-empty">未找到命令</div>';return;} list.innerHTML=''; filtered.forEach(function(cmd,i){ var d=document.createElement('div'); d.className='cmd-item'+(i===selectedIdx?' selected':''); d.innerHTML='<span class="cmd-icon">⚡</span><span class="cmd-category">'+cmd.category+'</span><span class="cmd-label">'+cmd.label+'</span><span class="cmd-shortcut">'+(cmd.shortcut||'')+'</span>'; d.onclick=function(){hide();cmd.action();}; list.appendChild(d); }); }
    if(input){ input.addEventListener('input',function(){ var q=input.value.toLowerCase(); var r=!q?COMMANDS:COMMANDS.filter(function(c){return c.label.toLowerCase().indexOf(q)>=0||c.category.toLowerCase().indexOf(q)>=0;}); selectedIdx=0; render(r); });
    input.addEventListener('keydown',function(e){ if(e.key==='ArrowDown'){e.preventDefault();selectedIdx=Math.min(selectedIdx+1,filtered.length-1);render(filtered);} if(e.key==='ArrowUp'){e.preventDefault();selectedIdx=Math.max(0,selectedIdx-1);render(filtered);} if(e.key==='Enter'&&filtered[selectedIdx]){e.preventDefault();hide();filtered[selectedIdx].action();} if(e.key==='Escape'){e.preventDefault();hide();} }); }
    if(overlay) overlay.addEventListener('click',function(e){if(e.target===overlay)hide();});
    document.addEventListener('keydown',function(e){if(e.ctrlKey&&e.shiftKey&&e.key==='P'){e.preventDefault();show();}});
})();

/* 5. 欢迎页 */
(function(){
    var panel=$id('welcome-panel');
    window.__tcide_showWelcome=function(){if(panel)panel.classList.add('visible');};
    window.__tcide_hideWelcome=function(){if(panel)panel.classList.remove('visible');};
    async function loadRecent(){
        try {
            var list=await (window.api&&window.api.getRecentProjects?window.api.getRecentProjects():Promise.resolve([]));
            var rl=$id('welcome-recent-list'); if(!rl) return;
            if(!list||!list.length){rl.innerHTML='<div style="color:#6e6e6e;font-size:12px;">暂无最近项目</div>';return;}
            rl.innerHTML='';
            list.forEach(function(p){
                var d=document.createElement('div'); d.className='welcome-recent-item';
                d.innerHTML='<span class="recent-icon">📁</span><div><div>'+p.name+'</div><div class="recent-path">'+p.path+'</div></div>';
                d.onclick=function(){window.api&&window.api.openProjectPath&&window.api.openProjectPath(p.path);};
                rl.appendChild(d);
            });
        }catch(e){}
    }
    if($id('welcome-open')) $id('welcome-open').onclick=function(){window.api&&window.api.openProject&&window.api.openProject();};
    if($id('welcome-new')) $id('welcome-new').onclick=function(){window.api&&window.api.newProject&&window.api.newProject();};
    setTimeout(function(){ if(!window.__tcide_projectRoot) window.__tcide_showWelcome&&window.__tcide_showWelcome(); loadRecent(); }, 800);
})();

console.log('[P0] All modules loaded from p0-modules.js');
