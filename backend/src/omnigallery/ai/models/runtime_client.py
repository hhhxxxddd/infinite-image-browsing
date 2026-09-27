"""Serialized, persistent EXE inference worker with bounded request lifetime."""

import atexit
import json
import queue
import subprocess
import threading

from omnigallery.ai.models import desktop_runtime


class RuntimeClient:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.responses = None
        self.kind = None
        self.log = None

    def close(self):
        with self.lock:
            if self.process:
                if self.process.poll() is None:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait(timeout=5)
                self.process.stdin.close()
                self.process.stdout.close()
                self.process = None
            if self.log:
                self.log.close()
                self.log = None
            self.kind = None

    def release(self, kind):
        with self.lock:
            if self.kind == kind:
                self.close()

    def _start(self):
        path = desktop_runtime.active_runtime()
        if path is None:
            raise RuntimeError("请先安装 AI 运行环境")
        self.log = (path / "worker.log").open("a", encoding="utf-8")
        try:
            with desktop_runtime.external_dll_search():
                self.process = subprocess.Popen(
                    [str(path / "python.exe"), "-I", "-u", str(path / "worker/runtime_worker.py")],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=self.log,
                    text=True,
                    encoding="utf-8",
                    **desktop_runtime.process_options(),
                )
        except Exception:
            self.close()
            raise
        self.responses = queue.Queue()
        process, responses = self.process, self.responses

        def read():
            try:
                for line in process.stdout:
                    responses.put(line)
            finally:
                responses.put(None)

        threading.Thread(target=read, daemon=True).start()

    def request(self, **request):
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                self.close()
                self._start()
            try:
                self.process.stdin.write(json.dumps(request, ensure_ascii=True) + "\n")
                self.process.stdin.flush()
                response = self.responses.get(timeout=600)
                if response is None:
                    raise RuntimeError("AI 运行进程意外退出，请检查运行环境")
                result = json.loads(response)
                if result.get("error"):
                    raise RuntimeError(result["error"])
                self.kind = request.get("kind")
                return result["result"]
            except queue.Empty:
                self.close()
                raise RuntimeError("本地 AI 推理超时，运行进程已停止，可重试") from None
            except Exception:
                self.close()
                raise


client = RuntimeClient()
atexit.register(client.close)
