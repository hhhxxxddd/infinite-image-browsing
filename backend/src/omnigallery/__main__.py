"""Run the OmniGallery HTTP service."""

import argparse

import uvicorn

from omnigallery.app import create_app
from omnigallery.infrastructure.paths import normalize_paths


def setup_parser():
    parser = argparse.ArgumentParser(description="OmniGallery media library")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7877)
    parser.add_argument("--extra-paths", nargs="+", default=[])
    parser.add_argument("--allow-cors", action="store_true")
    parser.add_argument("--enable-shutdown", action="store_true")
    return parser


def main():
    args = setup_parser().parse_args()
    app = create_app(
        extra_paths_cli=normalize_paths(args.extra_paths),
        allow_cors=args.allow_cors,
        enable_shutdown=args.enable_shutdown,
        launch_mode="server",
    )
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
