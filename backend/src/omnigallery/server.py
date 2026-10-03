"""Production factory: finish storage migration before importing path-bound services."""


def create_app(**options):
    import os
    import tempfile

    from omnigallery.storage.layout import storage

    storage.prepare()
    temporary = storage.root / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(temporary)
    for variable in ("TEMP", "TMP", "TMPDIR"):
        os.environ[variable] = str(temporary)
    os.environ["PIP_CACHE_DIR"] = str(storage.root / "cache/pip")
    os.environ["HF_HOME"] = str(storage.root / "cache/huggingface")
    os.environ["HF_HUB_CACHE"] = str(storage.root / "cache/huggingface/hub")
    from omnigallery.app import create_app as compose_app

    return compose_app(**options)
