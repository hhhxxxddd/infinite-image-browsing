from typing import List
from fastapi import FastAPI, Response
from fastapi.responses import FileResponse
import uvicorn
import os
from scripts.iib.api import infinite_image_browsing_api, index_html_path, DEFAULT_BASE
from scripts.iib.tool import (
    normalize_paths,
)
from scripts.iib.db.datamodel import DataBase, Image, ExtraPath, Folder
from scripts.iib.db.update_image_data import update_image_data
import argparse
from typing import Optional, Coroutine

tag = "\033[31m[warn]\033[0m"

default_port = 7877
default_host = "127.0.0.1"

def paths_check(paths):
    for path in paths:
        if not path or len(path.strip()) == 0:
            continue
        if os.path.isabs(path):
            abs_path = path
        else:
            abs_path = os.path.normpath(os.path.join(os.getcwd(), path))
        if not os.path.exists(abs_path):
            print(f"{tag} The path '{abs_path}' will be ignored (value: {path}).")


def get_all_img_dirs():
    return [x.path for x in ExtraPath.get_extra_paths(DataBase.get_conn())]


def do_update_image_index():
    conn = DataBase.get_conn()
    dirs = Folder.get_expired_dirs(conn)
    if not len(dirs):
        return print("image index is up to date")
    update_image_data(dirs)
    if Image.count(conn=conn) == 0:
        return print(f"{tag} it appears that there is some issue")
    print("update image index completed. ✨")


class AppUtils:
    def __init__(
        self,
        update_image_index: bool = False,
        extra_paths: List[str] = [],
        allow_cors=False,
        enable_shutdown=False,
        base: Optional[str] = None,
        export_fe_fn=False,
        **args: dict,
    ):
        """
        Parameter definitions can be found by running the `python app.py -h `command or by examining the setup_parser() function.
        """
        self.update_image_index = update_image_index
        self.extra_paths = extra_paths
        self.allow_cors = allow_cors
        self.enable_shutdown = enable_shutdown
        if base and not base.startswith("/"):
            base = "/" + base
        self.base = base
        self.export_fe_fn = export_fe_fn

    def set_params(self, *args, **kwargs) -> None:
        """改变参数，与__init__的行为一致"""
        self.__init__(*args, **kwargs)

    @staticmethod
    def async_run(
        app: FastAPI, port: int = default_port, host=default_host
    ) -> Coroutine:
        """
        用于从异步运行的 FastAPI，在 Jupyter Notebook 环境中非常有用
        """
        # 不建议改成 async def，并且用 await 替换 return，
        # 因为这样会失去对 server.serve() 的控制。
        config = uvicorn.Config(app, host=host, port=port)
        server = uvicorn.Server(config)
        return server.serve()

    def wrap_app(self, app: FastAPI) -> None:
        """
        将拾影后端挂载到传入的 FastAPI 应用
        """
        update_image_index = self.update_image_index
        extra_paths = self.extra_paths

        if update_image_index:
            do_update_image_index()
        paths_check(extra_paths)

        infinite_image_browsing_api(
            app,
            extra_paths_cli=normalize_paths(extra_paths, os.getcwd()),
            allow_cors=self.allow_cors,
            enable_shutdown=self.enable_shutdown,
            launch_mode="server",
            base=self.base,
            export_fe_fn=self.export_fe_fn,
        )

    def get_root_browser_app(self) -> FastAPI:
        """
        创建首页位于 "/" 的拾影 FastAPI 应用
        """
        app = FastAPI()

        # 用于在首页显示
        @app.get("/")
        def index():
            if isinstance(self.base, str):
                with open(index_html_path, "r", encoding="utf-8") as file:
                    content = file.read().replace(DEFAULT_BASE, self.base)
                    return Response(content=content, media_type="text/html")
            return FileResponse(index_html_path)

        self.wrap_app(app)
        return app


def create_app() -> FastAPI:
    """ASGI factory for development with uvicorn --factory --reload."""
    return AppUtils().get_root_browser_app()


def setup_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="拾影：本地媒体库，支持标签、描述、生成信息与图文检索。"
    )
    parser.add_argument(
        "--host", type=str, default=default_host, help="The host to use"
    )
    parser.add_argument(
        "--port", type=int, help="The port to use", default=default_port
    )
    parser.add_argument(
        "--update_image_index", action="store_true", help="Update the image index"
    )
    parser.add_argument(
        "--generate_video_cover",
        action="store_true",
        help="Pre-generate video cover images to speed up browsing.",
    )
    parser.add_argument(
        "--generate_image_cache",
        action="store_true",
        help="Pre-generate image cache for folders added to the index through the homepage.",
    )
    parser.add_argument(
        "--generate_image_cache_size",
        type=str,
        default="512x512",
        help="The size of the image cache to generate. Default is 512x512",
    )
    parser.add_argument(
        "--gen_cache_verbose",
        action="store_true",
        help="Verbose mode for cache generation.",
    )
    parser.add_argument(
        "--extra_paths",
        nargs="+",
        help="Extra paths to use, these paths will be added to the homepage but the images in these paths will not be indexed. They are only used for browsing. If you need to index them, please add them via the '+ Add' button on the homepage.",
        default=[],
    )
    parser.add_argument(
        "--allow_cors",
        action="store_true",
        help="Allow Cross-Origin Resource Sharing (CORS) for the API.",
    )
    parser.add_argument(
        "--enable_shutdown",
        action="store_true",
        help="Enable the shutdown endpoint.",
    )
    parser.add_argument(
        "--export_fe_fn",
        default=True,
        action="store_true",
        help="Export front-end functions to enable external access through iframe.",
    )
    parser.add_argument("--base", type=str, help="The base URL for the IIB Api.")
    return parser


def launch_app(
    port: int = default_port, host: str = default_host, *args, **kwargs: dict
) -> None:
    """
    Launches the application on the specified port.

    Args:
        **kwargs (dict): Optional keyword arguments that can be used to configure the application.
            These can be viewed by running 'python app.py -h' or by checking the setup_parser() function.
    """
    app_utils = AppUtils(*args, **kwargs)
    app = app_utils.get_root_browser_app()
    uvicorn.run(app, host=host, port=port)


async def async_launch_app(
    port: int = default_port, host: str = default_host, *args, **kwargs: dict
) -> None:
    """
    Asynchronously launches the application on the specified port.

    Args:
        **kwargs (dict): Optional keyword arguments that can be used to configure the application.
            These can be viewed by running 'python app.py -h' or by checking the setup_parser() function.
    """
    app_utils = AppUtils(*args, **kwargs)
    app = app_utils.get_root_browser_app()
    await app_utils.async_run(app, host=host, port=port)


if __name__ == "__main__":
    parser = setup_parser()
    args = parser.parse_args()
    args_dict = vars(args)

    if args_dict.get("generate_video_cover"):
        from scripts.iib.video_cover_gen import generate_video_covers

        conn = DataBase.get_conn()
        generate_video_covers(
            dirs = map(lambda x: x.path, ExtraPath.get_extra_paths(conn)),
            verbose=args.gen_cache_verbose,
        )
        exit(0)
    if args_dict.get("generate_image_cache"):
        from scripts.iib.img_cache_gen import generate_image_cache
        generate_image_cache(
            dirs = get_all_img_dirs(),
            size = args.generate_image_cache_size,
            verbose = args.gen_cache_verbose
        )
        exit(0)

    launch_app(**vars(args))
