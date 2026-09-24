"""TCIDE RichWeb: 支持 {$key} 状态绑定的 <Web> 组件（项目侧扩展，不改 pawui）。"""

import re
from PySide6.QtWebEngineWidgets import QWebEngineView
from pawui.components import Component, BUILTINS
from pawui.resolve import is_template, resolve_prop_value, runtime_refs


class RichWeb(Component):
    def build(self):
        view = QWebEngineView()
        self.widget = view
        self._view = view
        html = self.props.get("html", "")
        if isinstance(html, str) and is_template(html):
            self._render(html)
            for k in runtime_refs(html):
                self.watch_state(k, lambda _v, t=html: self._render(t))
        elif html:
            view.setHtml(str(html))
        return view

    def _render(self, template):
        self._view.setHtml(resolve_prop_value(template, self.scope, self.runtime))


def install():
    BUILTINS["Web"] = RichWeb
