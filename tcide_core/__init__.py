"""TCIDE 后端核心（从 tcide-pawui 搬运，**不依赖 PawUI、不依赖 Qt**）。

来源：https://github.com/Guanist/tcide-pawui 的 ``tcide/`` 包，仅搬运其中与
界面无关的纯后端模块，用于补齐本仓库 ``tcide-py`` 分支缺失的接口
（缺口清单由 ``tools/api_audit.py`` 生成）。

授权：**LGPL-3.0-or-later**（各文件头部保留 SPDX 标识）。LGPL 与本站的 GPLv3 兼容。

为什么单独成包：这些模块只依赖标准库，可以脱离界面独立测试与复用；把它们放在
``tcide_core/`` 而不是塞进 ``api/``，是为了让"可复用的引擎"与"HTTP 适配层"分层清楚。
"""

__all__ = ()
