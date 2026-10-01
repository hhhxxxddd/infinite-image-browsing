"""Large model downloads resume without accepting stale HTTP ranges."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

from omnigallery.infrastructure import artifact_download as artifacts


class ArtifactDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "model.gguf"
        self.data = b"abcdefgh"
        self.checksum = hashlib.sha256(self.data).hexdigest()

    def response(self, start, end, data):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 206
        response.headers = {"Content-Range": f"bytes {start}-{end}/8"}
        response.iter_content.return_value = iter([data])
        return response

    def session(self):
        session = MagicMock()
        session.__enter__.return_value = session
        scope = patch.object(artifacts.requests, "Session", return_value=session)
        scope.start()
        self.addCleanup(scope.stop)
        return session

    def test_resume_and_verify_then_reuse(self):
        partial = self.path.with_name("model.gguf.part")
        partial.write_bytes(self.data[:3])
        session = self.session()
        session.get.return_value = self.response(3, 7, self.data[3:])
        with patch.object(artifacts, "requests_proxy_kwargs", return_value={}):
            artifacts.download("https://source", self.path, 8, self.checksum)
        self.assertEqual(session.get.call_args.kwargs["headers"]["Range"], "bytes=3-7")
        self.assertEqual(self.path.read_bytes(), self.data)
        self.assertFalse(partial.exists())
        session.get.reset_mock()
        artifacts.download("https://source", self.path, 8, self.checksum)
        session.get.assert_not_called()

    def test_wrong_range_and_corrupt_existing_file_preserved(self):
        session = self.session()
        session.get.return_value = self.response(1, 7, self.data)
        with patch.object(artifacts, "requests_proxy_kwargs", return_value={}):
            with self.assertRaisesRegex(ValueError, "范围"):
                artifacts.download("https://source", self.path, 8, self.checksum)
        self.assertFalse(self.path.exists())
        self.path.write_bytes(b"user file")
        with self.assertRaises(ValueError):
            artifacts.download("https://source", self.path, 8, self.checksum)
        self.assertEqual(self.path.read_bytes(), b"user file")

    def test_partial_disconnect_resumes_from_received_bytes(self):
        session = self.session()
        first = self.response(0, 7, b"")

        def interrupted(_):
            yield self.data[:2]
            raise requests.ConnectionError("disconnected")

        first.iter_content.side_effect = interrupted
        session.get.side_effect = [first, self.response(2, 7, self.data[2:])]
        with patch.object(artifacts, "requests_proxy_kwargs", return_value={}):
            artifacts.download("https://source", self.path, 8, self.checksum)
        self.assertEqual(session.get.call_args.kwargs["headers"]["Range"], "bytes=2-7")
        self.assertEqual(self.path.read_bytes(), self.data)

    def test_invalid_sha_never_published(self):
        session = self.session()
        session.get.return_value = self.response(0, 7, b"badbytes")
        with patch.object(artifacts, "requests_proxy_kwargs", return_value={}):
            with self.assertRaisesRegex(ValueError, "校验失败"):
                artifacts.download("https://source", self.path, 8, self.checksum)
        self.assertFalse(self.path.exists())
        self.assertFalse(self.path.with_name("model.gguf.part").exists())

    def test_parallel_resume_reads_journal_instead_of_sparse_length(self):
        partial = self.path.with_name("model.gguf.part")
        partial.write_bytes(self.data[:4] + b"\0" * 4)
        journal = partial.with_name(partial.name + ".ranges.json")
        journal.write_text(
            json.dumps({"size": 8, "sha256": self.checksum, "chunk_bytes": 4, "completed": [0]})
        )
        session = self.session()
        session.get.return_value = self.response(4, 7, self.data[4:])
        with (
            patch.object(artifacts, "CHUNK_BYTES", 4),
            patch.object(artifacts, "requests_proxy_kwargs", return_value={}),
        ):
            artifacts.download("https://source", self.path, 8, self.checksum, parallel=True)
        self.assertEqual(session.get.call_args.kwargs["headers"]["Range"], "bytes=4-7")
        self.assertEqual(self.path.read_bytes(), self.data)
        self.assertFalse(journal.exists())
