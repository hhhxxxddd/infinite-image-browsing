"""Serialize local Qwen inference and model switching on one GPU."""

import threading

inference_lock = threading.RLock()
