"""An application-owned llama.cpp process; no user-managed server or port."""

from __future__ import annotations

import atexit
import base64
import io
import math
import os
import secrets
import socket
import subprocess
import threading
import time

import requests
from PIL import Image, ImageOps

from omnigallery.ai.models import desktop_runtime, gguf_runtime

START_TIMEOUT = 300
REQUEST_TIMEOUT = 300
IDLE_SECONDS = 120
DEFAULT_INSTRUCTION = "Represent the user's input."
RERANK_SYSTEM = (
    "Judge whether the Document meets the requirements based on the Query and the Instruct "
    'provided. Note that the answer can only be "yes" or "no".'
)


def prompt(system: str, content: str) -> str:
    # Both official processors end at the assistant's newline, without a think block.
    return f"<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{content}<|im_end|>\n<|im_start|>assistant\n"


def image_data(value) -> str:
    def encode(source):
        image = ImageOps.exif_transpose(source).convert("RGB")
        # Match the existing retrieval budget (512*512 pixels), preserve aspect ratio.
        scale = min(1.0, math.sqrt(512 * 512 / (image.width * image.height)))
        if scale < 1:
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.Resampling.LANCZOS,
            )
        output = io.BytesIO()
        image.save(output, format="PNG")
        return base64.b64encode(output.getvalue()).decode("ascii")

    if isinstance(value, Image.Image):
        return encode(value)
    with Image.open(value) as image:
        return encode(image)


def yes_probability(reply: dict) -> float:
    """Conditional yes/no softmax, equivalent to sigmoid(logit_yes - logit_no)."""
    rows = reply.get("probs", reply.get("completion_probabilities", []))
    if len(rows) != 1:
        raise ValueError("GGUF 重排没有返回首个 token 的概率")
    probabilities = {}
    for item in rows[0].get("top_probs", []):
        token = item.get("token")
        if token in {"yes", "no"}:
            probabilities[token] = float(item["prob"])
    if probabilities.keys() != {"yes", "no"}:
        raise ValueError("GGUF 重排缺少 yes/no 概率，请检查引擎版本与模型格式")
    yes, no = probabilities["yes"], probabilities["no"]
    if not all(math.isfinite(p) and 0 <= p <= 1 for p in (yes, no)) or yes + no <= 0:
        raise ValueError("GGUF 重排返回了无效概率")
    return yes / (yes + no)


def _windows_job(process):
    """Kill the owned native process even when the desktop/backend crashes."""
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("ProcessTime", ctypes.c_int64),
            ("JobTime", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSet", ctypes.c_size_t),
            ("MaximumWorkingSet", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("Basic", BasicLimits),
            ("IoInfo", ctypes.c_uint64 * 6),
            ("ProcessMemory", ctypes.c_size_t),
            ("JobMemory", ctypes.c_size_t),
            ("PeakProcessMemory", ctypes.c_size_t),
            ("PeakJobMemory", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = ExtendedLimits()
    limits.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (
        not handle
        or not kernel.SetInformationJobObject(
            handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        )
        or not kernel.AssignProcessToJobObject(handle, int(process._handle))
    ):
        if handle:
            kernel.CloseHandle(handle)
        raise OSError(ctypes.get_last_error(), "无法设置 GGUF 子进程退出清理")
    return lambda: kernel.CloseHandle(handle)


class GGUFClient:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.session = None
        self.log = None
        self.job_close = None
        self.key = ""
        self.kind = ""
        self.url = ""
        self.marker = ""
        self.last_used = 0.0
        self._idle_thread_started = False

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
                self.process = None
            if self.job_close:
                self.job_close()
                self.job_close = None
            if self.session:
                self.session.close()
                self.session = None
            if self.log:
                self.log.close()
                self.log = None
            self.key = self.kind = self.url = self.marker = ""

    def release(self, kind: str):
        with self.lock:
            if self.kind == kind:
                self.close()

    def _idle(self):
        while True:
            time.sleep(20)
            with self.lock:
                if self.process and time.monotonic() - self.last_used >= IDLE_SECONDS:
                    self.close()

    def _request(self, route: str, payload=None):
        response = self.session.request(
            "GET" if payload is None else "POST",
            self.url + route,
            json=payload,
            timeout=(5, REQUEST_TIMEOUT),
        )
        if not response.ok:
            raise RuntimeError(f"GGUF 推理失败（{response.status_code}）：{response.text[-1000:]}")
        return response.json()

    def _start(self, bundle: gguf_runtime.Bundle):
        self.close()
        executable = gguf_runtime.binary()
        if not executable:
            raise RuntimeError("请先在运行环境安装 GGUF 引擎")
        # The random credential prevents us from attaching to an unrelated process
        # if another program wins the short bind/rebind race.
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        self.session = requests.Session()
        self.session.trust_env = False  # Internal inference must bypass download proxies.
        secret = secrets.token_urlsafe(32)
        self.session.headers["Authorization"] = "Bearer " + secret
        options = desktop_runtime.process_options()
        for name in list(options["env"]):
            if name.startswith("LLAMA_"):
                options["env"].pop(name)
        options["env"]["LLAMA_API_KEY"] = secret
        args = [
            executable,
            "--model",
            str(bundle.model),
            "--mmproj",
            str(bundle.projector),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--parallel",
            "1",
            "--ctx-size",
            "4096",
            "--batch-size",
            "2048",
            "--ubatch-size",
            "512",
            "--image-min-tokens",
            "4",
            "--image-max-tokens",
            "1024" if bundle.kind == "instruct" else "256",
            "--no-webui",
            "--no-context-shift",
        ]
        if bundle.kind == "embedding":
            args.extend(["--embedding", "--pooling", "last"])
        elif bundle.kind == "instruct":
            args.append("--jinja")
        gguf_runtime.RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
        log_path = gguf_runtime.RUNTIME_ROOT / f"inference-{os.getpid()}.log"
        self.log = log_path.open("w", encoding="utf-8")
        try:
            with desktop_runtime.external_dll_search():
                self.process = subprocess.Popen(
                    args,
                    stdin=subprocess.DEVNULL,
                    stdout=self.log,
                    stderr=subprocess.STDOUT,
                    **options,
                )
            self.job_close = _windows_job(self.process)
            deadline = time.monotonic() + START_TIMEOUT
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    tail = log_path.read_text(encoding="utf-8", errors="replace")[-1600:]
                    raise RuntimeError("GGUF 模型加载失败：" + tail)
                try:
                    response = self.session.get(self.url + "/health", timeout=(1, 2))
                    if response.status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.2)
            else:
                raise RuntimeError("GGUF 模型加载超时；子进程已停止，可重试")
            props = self._request("/props")
            if not props.get("modalities", {}).get("vision") or not props.get("media_marker"):
                raise RuntimeError("GGUF 引擎没有加载视觉能力，请检查配套 mmproj 和引擎版本")
            self.marker = props["media_marker"]
            self.kind, self.key = bundle.kind, bundle.key()
            self.last_used = time.monotonic()
            if not self._idle_thread_started:
                threading.Thread(target=self._idle, daemon=True).start()
                self._idle_thread_started = True
        except Exception:
            self.close()
            raise

    def _ensure(self, bundle):
        if not self.process or self.process.poll() is not None or self.key != bundle.key():
            self._start(bundle)

    def vector(self, bundle, value, media: bool, instruction: str):
        with self.lock:
            try:
                self._ensure(bundle)
                content = self.marker if media else str(value)
                data = {
                    "prompt_string": prompt(DEFAULT_INSTRUCTION if media else instruction, content)
                }
                if media:
                    # MTMD adds vision_start/end itself. Do not double-wrap the marker.
                    data["multimodal_data"] = [image_data(value)]
                result = self._request("/embedding", {"content": data, "embd_normalize": 2})
                vector = result[0]["embedding"]
                if len(vector) == 1 and isinstance(vector[0], list):
                    vector = vector[0]
                if len(vector) != 4096 or not all(math.isfinite(v) for v in vector):
                    raise ValueError("GGUF 未返回有效的 8B 图片向量（4096 维）")
                return vector
            except Exception:
                self.close()
                raise
            finally:
                self.last_used = time.monotonic()

    def generate(self, bundle, path: str, instruction: str, max_tokens: int, system=False) -> str:
        with self.lock:
            try:
                self._ensure(bundle)
                content = [
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64," + image_data(path)},
                    },
                    {
                        "type": "text",
                        "text": "Follow the instruction for this image." if system else instruction,
                    },
                ]
                messages = [{"role": "user", "content": content}]
                if system:
                    messages.insert(0, {"role": "system", "content": instruction})
                reply = self._request(
                    "/v1/chat/completions",
                    {
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": 0,
                        "stream": False,
                    },
                )
                choices = reply.get("choices", [])
                text = choices[0].get("message", {}).get("content") if choices else None
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("GGUF 图片理解未返回有效文本")
                return text.strip()
            except Exception:
                self.close()
                raise
            finally:
                self.last_used = time.monotonic()

    def rerank(self, bundle, query: str, paths: list[str], instruction: str) -> list[float]:
        with self.lock:
            try:
                self._ensure(bundle)
                scores = []
                for path in paths:
                    content = f"<Instruct>: {instruction}<Query>:{query}\n<Document>:{self.marker}"
                    reply = self._request(
                        "/completion",
                        {
                            "prompt": {
                                "prompt_string": prompt(RERANK_SYSTEM, content),
                                "multimodal_data": [image_data(path)],
                            },
                            "n_predict": 1,
                            "stream": False,
                            "cache_prompt": False,
                            "temperature": 1,
                            "top_k": 0,
                            "top_p": 1,
                            "min_p": 0,
                            "typical_p": 1,
                            "repeat_penalty": 1,
                            "presence_penalty": 0,
                            "frequency_penalty": 0,
                            "grammar": 'root ::= "yes" | "no"',
                            "n_probs": 32,
                            "post_sampling_probs": True,
                        },
                    )
                    # Partial-word tokens can also pass the grammar; condition on
                    # the exact yes/no tokens rather than treating the sampled word as a score.
                    scores.append(yes_probability(reply))
                return scores
            except Exception:
                self.close()
                raise
            finally:
                self.last_used = time.monotonic()


client = GGUFClient()
atexit.register(client.close)
