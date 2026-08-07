/**
 * TCIDE Snippet Service — 代码片段管理
 *
 * 预置常用代码片段，支持自定义和 Monaco 集成。
 */

import * as monaco from 'monaco-editor';

// ── 默认片段 ──

const DEFAULT_SNIPPETS: Record<string, Array<{ prefix: string; name: string; body: string; description?: string }>> = {
  html: [
    { prefix: '!', name: 'HTML5 Boilerplate', body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:Document}</title>\n</head>\n<body>\n  ${0}\n</body>\n</html>' },
    { prefix: 'link', name: 'CSS Link', body: '<link rel="stylesheet" href="${1:style.css}">' },
    { prefix: 'script:src', name: 'Script Src', body: '<script src="${1:app.js}"></script>' },
    { prefix: 'div', name: 'Div Block', body: '<div class="${1:class}">\n  ${0}\n</div>' },
    { prefix: 'form', name: 'Form', body: '<form action="${1:#}" method="${2:post}">\n  ${0}\n</form>' },
    { prefix: 'input', name: 'Input', body: '<input type="${1:text}" name="${2:name}" placeholder="${3}">' },
    { prefix: 'table', name: 'Table', body: '<table>\n  <thead>\n    <tr>\n      ${0}\n    </tr>\n  </thead>\n  <tbody>\n  </tbody>\n</table>' },
    { prefix: 'ul>li', name: 'Unordered List', body: '<ul>\n  <li>${1:item}</li>\n</ul>' },
    { prefix: 'a', name: 'Link', body: '<a href="${1:#}">${2:text}</a>' },
  ],
  css: [
    { prefix: 'flex', name: 'Flex Container', body: 'display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};' },
    { prefix: 'grid', name: 'Grid', body: 'display: grid;\ngrid-template-columns: repeat(${1:3}, 1fr);\ngap: ${2:1rem};' },
    { prefix: 'pos', name: 'Position', body: 'position: ${1:relative};\ntop: ${2:0};\nleft: ${3:0};' },
    { prefix: 'trs', name: 'Transition', body: 'transition: ${1:all} ${2:0.3s} ease;' },
  ],
  typescript: [
    { prefix: 'comp', name: 'React Component', body: 'import React from \'react\';\n\ninterface ${1:Props} {\n  ${2}\n}\n\nexport const ${3:Component}: React.FC<${1:Props}> = (${4:props}) => {\n  return (\n    <div>\n      ${0}\n    </div>\n  );\n};' },
    { prefix: 'useEf', name: 'useEffect', body: 'useEffect(() => {\n  ${1}\n}, [${2}]);' },
    { prefix: 'useSt', name: 'useState', body: 'const [${1:state}, set${1/(.*)/${1:/capitalize}/}] = useState<${2:type}>(${3:initial});' },
    { prefix: 'ife', name: 'If-Else', body: 'if (${1:condition}) {\n  ${2}\n} else {\n  ${3}\n}' },
    { prefix: 'for', name: 'For Loop', body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${0}\n}' },
    { prefix: 'forof', name: 'For-Of Loop', body: 'for (const ${1:item} of ${2:array}) {\n  ${0}\n}' },
    { prefix: 'clg', name: 'Console Log', body: 'console.log(${1});' },
    { prefix: 'trycatch', name: 'Try-Catch', body: 'try {\n  ${1}\n} catch (${2:error}) {\n  ${3}\n}' },
    { prefix: 'fun', name: 'Function', body: 'function ${1:name}(${2:params}) {\n  ${0}\n}' },
    { prefix: 'afun', name: 'Arrow Function', body: 'const ${1:name} = (${2:params}) => {\n  ${0}\n};' },
    { prefix: 'then', name: 'Promise Then', body: '.then((${1:result}) => {\n  ${0}\n})' },
  ],
  javascript: [
    { prefix: 'clg', name: 'Console Log', body: 'console.log(${1});' },
    { prefix: 'for', name: 'For Loop', body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${0}\n}' },
    { prefix: 'fun', name: 'Function', body: 'function ${1:name}(${2:params}) {\n  ${0}\n}' },
    { prefix: 'ife', name: 'If-Else', body: 'if (${1:condition}) {\n  ${2}\n} else {\n  ${3}\n}' },
  ],
  python: [
    { prefix: 'def', name: 'Function', body: 'def ${1:name}(${2:params}):\n    ${0}' },
    { prefix: 'class', name: 'Class', body: 'class ${1:Name}:\n    def __init__(self${2}):\n        ${0}' },
    { prefix: 'for', name: 'For Loop', body: 'for ${1:item} in ${2:iterable}:\n    ${0}' },
    { prefix: 'if', name: 'If Statement', body: 'if ${1:condition}:\n    ${0}' },
    { prefix: 'imp', name: 'Import', body: 'import ${1:module}' },
    { prefix: 'try', name: 'Try-Except', body: 'try:\n    ${1}\nexcept ${2:Exception} as ${3:e}:\n    ${0}' },
  ],
  go: [
    { prefix: 'func', name: 'Function', body: 'func ${1:name}(${2:params}) ${3:returnType} {\n    ${0}\n}' },
    { prefix: 'iferr', name: 'If Err', body: 'if err != nil {\n    return ${1:err}\n}' },
    { prefix: 'struct', name: 'Struct', body: 'type ${1:Name} struct {\n    ${0}\n}' },
    { prefix: 'for', name: 'For Loop', body: 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n    ${0}\n}' },
  ],
  rust: [
    { prefix: 'fn', name: 'Function', body: 'fn ${1:name}(${2:params}) -> ${3:ReturnType} {\n    ${0}\n}' },
    { prefix: 'impl', name: 'Impl Block', body: 'impl ${1:Type} {\n    ${0}\n}' },
    { prefix: 'match', name: 'Match', body: 'match ${1:expr} {\n    ${2:pattern} => ${3:result},\n    _ => ${4:default},\n}' },
  ],
};

// ── 用户自定义片段存储 ──

let customSnippets: Record<string, Array<{ prefix: string; name: string; body: string }>> = {};

/** 获取某语言的全部片段 */
function getSnippets(language: string): Array<{ prefix: string; name: string; body: string }> {
  const defaults = DEFAULT_SNIPPETS[language] || [];
  const customs = customSnippets[language] || [];
  return [...defaults, ...customs];
}

/** 注册/更新某语言的片段 Provider */
let snippetDisposables = new Map<string, monaco.IDisposable>();

export function registerSnippets(language: string): void {
  // 先取消旧注册
  if (snippetDisposables.has(language)) {
    snippetDisposables.get(language)!.dispose();
    snippetDisposables.delete(language);
  }

  const snippets = getSnippets(language);
  if (snippets.length === 0) return;

  const disposable = monaco.languages.registerCompletionItemProvider(language, {
    provideCompletionItems: () => {
      const items = snippets.map(s => ({
        label: s.prefix,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: s.name,
        documentation: s.body,
        insertText: s.body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '0' + s.prefix,
      } as monaco.languages.CompletionItem));
      return { suggestions: items };
    },
  });

  snippetDisposables.set(language, disposable);
}

/** 初始化所有语言 */
export function initSnippets(): void {
  for (const lang of Object.keys(DEFAULT_SNIPPETS)) {
    registerSnippets(lang);
  }
}

/** 添加自定义片段 */
export function addCustomSnippet(language: string, prefix: string, name: string, body: string): void {
  if (!customSnippets[language]) customSnippets[language] = [];
  customSnippets[language].push({ prefix, name, body });
  registerSnippets(language);
}

/** 获取片段列表（含状态标记） */
export function listSnippets(): Record<string, Array<{ prefix: string; name: string; body: string; isDefault: boolean }>> {
  const result: Record<string, Array<{ prefix: string; name: string; body: string; isDefault: boolean }>> = {};
  for (const lang of Object.keys(DEFAULT_SNIPPETS)) {
    result[lang] = [
      ...DEFAULT_SNIPPETS[lang].map(s => ({ ...s, isDefault: true })),
      ...(customSnippets[lang] || []).map(s => ({ ...s, isDefault: false })),
    ];
  }
  return result;
}
