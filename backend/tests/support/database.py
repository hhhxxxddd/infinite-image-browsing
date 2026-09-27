"""Shared database isolation for tests using threaded API clients."""

import sqlite3
import threading
from unittest.mock import patch

from omnigallery.infrastructure.database import Database


def isolate_database(test_case, path):
    """Restore global state and close all worker connections before temp cleanup.

    Register this after the temporary directory cleanup and before the client's
    cleanup. unittest runs cleanups in reverse order, including on test failure.
    Connections remain thread-local; disabling the thread check only permits the
    test's main thread to close them after the API client has stopped.
    """
    database_patch = patch.multiple(Database, path=str(path), local=threading.local())
    database_patch.start()
    test_case.addCleanup(database_patch.stop)
    connections = []

    def connect_for_test(database):
        conn = sqlite3.connect(database, check_same_thread=False)
        connections.append(conn)
        return conn

    def close_connections():
        for conn in connections:
            conn.close()

    test_case.addCleanup(close_connections)
    connect_patch = patch(
        "omnigallery.infrastructure.database.connect", side_effect=connect_for_test
    )
    connect_patch.start()
    test_case.addCleanup(connect_patch.stop)
    return connections


def isolate_project_storage(test_case):
    import tempfile
    from pathlib import Path

    directory = tempfile.TemporaryDirectory()
    test_case.addCleanup(directory.cleanup)
    storage_patch = patch(
        "omnigallery.storage.project_files.PROJECT_DATA_ROOT", Path(directory.name)
    )
    storage_patch.start()
    test_case.addCleanup(storage_patch.stop)
    return Path(directory.name)
