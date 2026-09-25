"""Run a Hugging Face download in a process with its own proxy environment."""

from __future__ import annotations

import sys

from huggingface_hub import snapshot_download

if __name__ == "__main__":
    snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2], max_workers=4)
