# SPDX-FileCopyrightText: 2025 TCIDE contributors
# SPDX-License-Identifier: LGPL-3.0-or-later
"""DAP（Debug Adapter Protocol）客户端 —— 接 debugpy，做**真的**调试会话。

## 为什么有了 pdb 还要这个

``api/ui_contract.py`` 里的 pdb 会话能单步、能跑，但拿不到**变量值/调用栈**这类
结构化信息（只能解析文本输出）。DAP 是 VS Code 用的标准调试协议，debugpy 是它的
Python 实现：装上之后可以拿到栈帧、作用域、变量、求值结果，界面才能做真正的
调试面板。

## 已验证的通路（不是照文档猜的）

本模块的调用顺序是用 ``.tcide-sync/probe_dap3.py`` 实跑确认过的：

    debugpy --listen 127.0.0.1:<port> --wait-for-client <script>
    → 客户端连上 TCP → initialize → setBreakpoints → configurationDone
    → 收到 stopped 事件（reason=breakpoint）
    → stackTrace / scopes / variables / evaluate 全部可用

两个实测要点：
- **不需要单独的 ``attach`` 请求**：用 ``--listen`` 起进程时，客户端一连上就算附加
  （第一版照文档发了 ``attach``，它没有响应，但后续请求都正常）。
- 建议带 ``-Xfrozen_modules=off`` 与 ``PYDEVD_DISABLE_FILE_VALIDATION=1``，
  否则可能漏断点/刷警告。

依赖：``pip install debugpy``（未安装时调用方应回退到 pdb 会话）。
"""

from __future__ import annotations

import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time


class DapError(Exception):
    """DAP 会话出错（连不上、握手失败、进程已退出…）。"""


def debugpy_available() -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec("debugpy") is not None
    except Exception:      # noqa: BLE001
        return False


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class DapSession:
    """一个 debugpy 调试会话（TCP + Content-Length 帧）。"""

    def __init__(self, program: str | pathlib.Path, *, cwd: str | pathlib.Path = "",
                 python: str = "", timeout: float = 15.0) -> None:
        self.program = str(program)
        self.cwd = str(cwd or pathlib.Path(self.program).parent)
        self.python = python or sys.executable
        self.timeout = float(timeout)
        self.port = free_port()
        self.process: subprocess.Popen | None = None
        self.sock: socket.socket | None = None
        self.buffer = b""
        self.inbox: list[dict] = []
        self.seq = 0
        self.initialized = False
        self._stopped: dict | None = None
        #: 被调试进程的 stdout/stderr 收集（**必须有人在读**，见 _drain_process）
        self.process_output: list[str] = []
        self._reader: threading.Thread | None = None

    # -- 生命周期 ---------------------------------------------------------

    def start(self) -> bool:
        if not debugpy_available():
            raise DapError("未安装 debugpy（pip install debugpy）")
        env = dict(os.environ, PYDEVD_DISABLE_FILE_VALIDATION="1")
        self.process = subprocess.Popen(
            [self.python, "-Xfrozen_modules=off", "-m", "debugpy",
             "--listen", f"127.0.0.1:{self.port}", "--wait-for-client", self.program],
            cwd=self.cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace")
        # **必须把被调试进程的 stdout 读掉**：debugpy 会往这里写 telemetry 等输出，
        # 管道写满（Windows 默认约 4KB）之后进程就卡住 —— 表现是 setBreakpoints
        # 之后**再也收不到任何响应**、断点永远不命中（我第一版就是这样，
        # 独立探针能过是因为那次输出少、跑得快）。
        self._reader = threading.Thread(target=self._drain_process, daemon=True)
        self._reader.start()
        self.sock = self._connect()
        if self.sock is None:
            raise DapError(f"连不上调试端口 {self.port}（debugpy 是否启动失败？）")
        self.sock.settimeout(1.0)
        response = self.request("initialize", clientID="tcide", adapterID="python",
                                linesStartAt1=True, columnsStartAt1=True,
                                pathFormat="path")
        self.initialized = bool(response and response.get("success"))
        if self.initialized:
            # **必须发 attach**（即使它不回响应）：在 `--listen --wait-for-client`
            # 模式下，是这一步让 debugpy 真正开始执行被调试程序。不发的话后续
            # setBreakpoints 之后**再也收不到任何消息**、断点永不命中。
            # （我一开始误以为"客户端连上就算附加、不用 attach"——探针里其实发了，
            #  只是它的响应超时，我把它当成了可有可无 ✗。）
            self.request("attach", justMyCode=False, timeout=1.0)
        return self.initialized

    def _drain_process(self) -> None:
        """读掉被调试进程的输出（不读会把管道写满、把调试进程卡死）。"""
        stream = getattr(self.process, "stdout", None)
        if stream is None:
            return
        try:
            for line in stream:
                self.process_output.append(line.rstrip("\n"))
                if len(self.process_output) > 500:
                    del self.process_output[:200]
        except Exception:      # noqa: BLE001 - 进程结束就正常退出
            pass

    def _connect(self, timeout: float = 12.0) -> socket.socket | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process is not None and self.process.poll() is not None:
                return None
            try:
                return socket.create_connection(("127.0.0.1", self.port), timeout=1)
            except OSError:
                time.sleep(0.2)
        return None

    def alive(self) -> bool:
        return bool(self.process is not None and self.process.poll() is None)

    def stop(self) -> None:
        try:
            self.request("disconnect", terminateDebuggee=True, timeout=3)
        except Exception:      # noqa: BLE001
            pass
        if self.sock is not None:
            try:
                self.sock.close()
            except Exception:      # noqa: BLE001
                pass
            self.sock = None
        if self.process is not None and self.process.poll() is None:
            try:
                self.process.kill()
            except Exception:      # noqa: BLE001
                pass

    # -- 协议 -------------------------------------------------------------

    def request(self, command: str, *, timeout: float = 20.0, **arguments) -> dict:
        self.seq += 1
        payload = {"seq": self.seq, "type": "request", "command": command,
                   "arguments": arguments or {}}
        body = json.dumps(payload).encode("utf-8")
        if self.sock is None:
            raise DapError("调试连接已关闭")
        self.sock.sendall(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        response = self._wait("response", command=command, timeout=timeout)
        return response or {"success": False, "message": f"{command} 无响应"}

    def _wait(self, kind: str, *, command: str = "", event: str = "",
              timeout: float = 20.0) -> dict | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for index, message in enumerate(self.inbox):
                if message.get("type") != kind:
                    continue
                if kind == "response" and command and message.get("command") != command:
                    continue
                if kind == "event" and event and message.get("event") != event:
                    continue
                return self.inbox.pop(index)
            self._pump()
            time.sleep(0.05)
        return None

    def _pump(self) -> None:
        if self.sock is None:
            return
        try:
            chunk = self.sock.recv(65536)
        except socket.timeout:
            return
        except OSError:
            return
        if not chunk:
            return
        self.buffer += chunk
        while b"\r\n\r\n" in self.buffer:
            head, rest = self.buffer.split(b"\r\n\r\n", 1)
            length = 0
            for line in head.split(b"\r\n"):
                if line.lower().startswith(b"content-length:"):
                    length = int(line.split(b":", 1)[1].strip())
            if len(rest) < length:
                break
            body, self.buffer = rest[:length], rest[length:]
            try:
                self.inbox.append(json.loads(body.decode("utf-8")))
            except Exception:      # noqa: BLE001 - 坏帧直接跳过
                pass

    def drain_events(self, limit: int = 50) -> list[dict]:
        """取走并返回当前积压的事件（前端可用它显示 output/terminated）。"""
        self._pump()
        events: list[dict] = []
        remaining: list[dict] = []
        for message in self.inbox:
            if message.get("type") == "event" and len(events) < limit:
                events.append(message)
            else:
                remaining.append(message)
        self.inbox = remaining
        return events

    # -- 调试动作 ---------------------------------------------------------

    def set_breakpoints(self, path: str, lines: list[int]) -> list[bool]:
        response = self.request("setBreakpoints",
                                source={"path": str(path)},
                                breakpoints=[{"line": int(line)} for line in lines])
        items = (response.get("body") or {}).get("breakpoints", [])
        return [bool(item.get("verified")) for item in items]

    def configuration_done(self) -> None:
        self.request("configurationDone", timeout=10)

    def wait_stopped(self, timeout: float = 30.0) -> dict | None:
        """等下一次 stopped 事件（也接受 terminated/exited —— 说明程序跑完了）。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            stopped = self._wait("event", event="stopped", timeout=1.0)
            if stopped is not None:
                self._stopped = stopped
                return stopped
            for name in ("terminated", "exited"):
                if self._wait("event", event=name, timeout=0.2) is not None:
                    return {"body": {"reason": name}}
        return None

    def threads(self) -> list[dict]:
        return (self.request("threads").get("body") or {}).get("threads", [])

    def frames(self, thread_id: int = 1, levels: int = 20) -> list[dict]:
        response = self.request("stackTrace", threadId=int(thread_id),
                                startFrame=0, levels=int(levels))
        return (response.get("body") or {}).get("stackFrames", [])

    def scopes(self, frame_id: int) -> list[dict]:
        return (self.request("scopes", frameId=int(frame_id)).get("body") or {}) \
            .get("scopes", [])

    def variables(self, reference: int) -> list[dict]:
        return (self.request("variables", variablesReference=int(reference))
                .get("body") or {}).get("variables", [])

    def evaluate(self, expression: str, frame_id: int = 0) -> str:
        arguments = {"expression": expression, "context": "repl"}
        if frame_id:
            arguments["frameId"] = int(frame_id)
        response = self.request("evaluate", **arguments)
        if not response.get("success"):
            return ""
        return str((response.get("body") or {}).get("result", ""))

    def state(self, thread_id: int = 1) -> dict:
        """当前位置 + 栈顶帧的局部变量（界面要用它画调试面板）。"""
        frames = self.frames(thread_id)
        if not frames:
            return {"frames": 0, "reason": (self._stopped or {}).get("body", {}).get("reason", "")}
        top = frames[0]
        scopes = self.scopes(top["id"])
        local = next((item for item in scopes if item.get("name") == "Locals"),
                     scopes[0] if scopes else None)
        variables = []
        if local is not None:
            variables = [{"name": item.get("name"), "value": item.get("value"),
                          "type": item.get("type", "")}
                         for item in self.variables(local["variablesReference"])]
        return {"reason": (self._stopped or {}).get("body", {}).get("reason", ""),
                "file": top.get("source", {}).get("path", ""),
                "line": top.get("line"), "function": top.get("name", ""),
                "frames": [{"name": item.get("name"), "line": item.get("line"),
                            "file": item.get("source", {}).get("path", "")}
                           for item in frames[:10]],
                "locals": variables}

    def step(self, action: str, thread_id: int = 1) -> dict:
        """执行一个步进动作并返回停下后的状态。"""
        commands = {"continue": "continue", "next": "next",
                    "step-in": "stepIn", "step-out": "stepOut", "pause": "pause"}
        command = commands.get(action)
        if command is None:
            raise DapError(f"不支持的调试动作：{action}")
        response = self.request(command, threadId=int(thread_id), timeout=10)
        if not response.get("success") and command != "pause":
            return {"success": False, "error": response.get("message", "请求失败")}
        stopped = self.wait_stopped(timeout=30)
        if stopped is None:
            return {"success": True, "action": action, "terminated": True,
                    "note": "程序已结束（没有再次停下）"}
        if stopped.get("body", {}).get("reason") in ("terminated", "exited"):
            return {"success": True, "action": action, "terminated": True}
        return {"success": True, "action": action, "terminated": False,
                "state": self.state(thread_id)}
