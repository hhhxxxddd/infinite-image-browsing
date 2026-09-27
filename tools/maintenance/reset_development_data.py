"""Reset only managed development data; preview the absolute targets by default."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANAGED_DIRECTORIES = ("db", "cache", "logs", "project-data")


def reset_targets(root: Path) -> list[Path]:
    """Refuse symlinks/junctions that would escape the workspace's .local directory."""
    root = root.resolve(strict=True)
    data = root / ".local"
    if data.is_symlink() or data.is_junction() or data.resolve() != data:
        raise ValueError(f"Managed data directory is redirected: {data}")
    targets = []
    for name in MANAGED_DIRECTORIES:
        target = data / name
        if target.is_symlink() or target.is_junction() or target.resolve() != target:
            raise ValueError(f"Managed data target is redirected: {target}")
        if target.exists() and not target.is_dir():
            raise ValueError(f"Managed data target is not a directory: {target}")
        targets.append(target)
    return targets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes", action="store_true", help="Delete the listed data after stopping the app"
    )
    args = parser.parse_args()
    try:
        targets = reset_targets(ROOT)
    except ValueError as error:
        parser.error(str(error))
    print("Managed development data (stop the backend and desktop app before deletion):")
    for target in targets:
        print(f"  {target} {'[exists]' if target.exists() else '[absent]'}")
    if not args.yes:
        print(
            "Dry run only. Pass --yes to delete these directories. Media, models and credentials remain."
        )
        return
    # Resolve and validate again immediately before the destructive operation.
    for target in reset_targets(ROOT):
        if target.exists():
            shutil.rmtree(target)
            print(f"Deleted: {target}")


if __name__ == "__main__":
    main()
