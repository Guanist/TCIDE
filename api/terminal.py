"""
终端管理 API - WebSocket 交互式终端
"""
import asyncio
import os
import subprocess
import threading
import queue
import uuid


class Terminal:
    """单个终端实例"""

    def __init__(self, terminal_id: str, cwd: str):
        self.id = terminal_id
        self.cwd = cwd
        self.process: subprocess.Popen | None = None
        self.output_queue: queue.Queue = queue.Queue()
        self._running = False

    def start(self):
        """启动 shell 进程"""
        if os.name == "nt":
            shell = os.environ.get("COMSPEC", "cmd.exe")
        else:
            shell = os.environ.get("SHELL", "/bin/bash")

        self.process = subprocess.Popen(
            shell,
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=0,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self._running = True
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

    def _read_output(self):
        """后台线程读取输出"""
        try:
            while self._running and self.process and self.process.poll() is None:
                data = self.process.stdout.read(1)
                if data:
                    self.output_queue.put(data.decode("utf-8", errors="replace"))
        except Exception:
            pass
        finally:
            self._running = False

    def write(self, data: str):
        """向终端写入"""
        if self.process and self.process.poll() is None:
            try:
                self.process.stdin.write(data.encode("utf-8"))
                self.process.stdin.flush()
            except (BrokenPipeError, OSError):
                pass

    def read_all(self) -> str:
        """读取所有可用输出"""
        output = ""
        while not self.output_queue.empty():
            try:
                output += self.output_queue.get_nowait()
            except queue.Empty:
                break
        return output

    def is_alive(self) -> bool:
        return self._running and self.process is not None and self.process.poll() is None

    def kill(self):
        """终止终端"""
        self._running = False
        if self.process:
            try:
                self.process.terminate()
            except Exception:
                pass


# 终端实例管理
_terminals: dict[str, Terminal] = {}


def create_terminal(cwd: str) -> dict:
    """创建新终端"""
    tid = str(uuid.uuid4())[:8]
    term = Terminal(tid, cwd)
    term.start()
    _terminals[tid] = term
    return {"id": tid, "cwd": cwd, "alive": term.is_alive()}


def write_terminal(terminal_id: str, data: str) -> dict:
    term = _terminals.get(terminal_id)
    if not term:
        return {"error": "Terminal not found"}
    term.write(data)
    return {"success": True}


def read_terminal(terminal_id: str) -> dict:
    term = _terminals.get(terminal_id)
    if not term:
        return {"error": "Terminal not found"}
    output = term.read_all()
    return {"output": output, "alive": term.is_alive()}


def close_terminal(terminal_id: str) -> dict:
    term = _terminals.pop(terminal_id, None)
    if term:
        term.kill()
    return {"success": True}


def list_terminals() -> list:
    return [{"id": t.id, "cwd": t.cwd, "alive": t.is_alive()} for t in _terminals.values()]


def exec_command(command: str, cwd: str, timeout: int = 30) -> dict:
    """一次性执行命令"""
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
        )
        return {
            "success": True,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exitCode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Command timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}
