"""Executable entry point shared by the desktop sidecar packagers."""

import os
from pathlib import Path


def main():
    # In Nuitka onefile builds __file__ points inside the extracted resource tree.
    # Set this before importing configuration; sys.executable points to the outer EXE.
    os.environ["OMNIGALLERY_BUNDLE_ROOT"] = str(Path(__file__).resolve().parent)
    from omnigallery.__main__ import main as run_server

    run_server()


if __name__ == "__main__":
    main()
