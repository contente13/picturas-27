"""Local checks for measurement arithmetic and streamed HTTP request contracts."""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import bench


class FakeConnection:
    def __init__(self):
        self.headers = {}
        self.parts = []

    def connect(self):
        pass

    def putrequest(self, method, path):
        self.request = (method, path)

    def putheader(self, name, value):
        self.headers[name] = value

    def endheaders(self):
        pass

    def send(self, data):
        self.parts.append(data)

    def getresponse(self):
        return self

    status = 204

    def getheader(self, name):
        return "1" if name == "X-Project-Version" else None

    def read(self):
        return b""

    def close(self):
        pass


class BenchTests(unittest.TestCase):
    def test_upload_streams_chunks_and_preserves_multipart_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "test.mp4"
            file.write_bytes(b"x" * (2 * 1024 * 1024 + 17))
            connection = FakeConnection()
            api = bench.API("https://localhost:8080/api-gateway")
            with patch.object(api, "connection", return_value=connection):
                result = api.upload({"user_id": "u", "token": "test-only"},
                    {"_id": "p", "version": 0}, file, "video", threading.Barrier(1))
            self.assertEqual(connection.request, ("POST", "/api-gateway/projects/u/p/video"))
            self.assertEqual(connection.headers["X-Project-Version"], "0")
            self.assertEqual(int(connection.headers["Content-Length"]), sum(map(len, connection.parts)))
            self.assertIn(b'name="video"; filename="test.mp4"', connection.parts[0])
            self.assertTrue(all(len(chunk) <= 1024 * 1024 for chunk in connection.parts[1:-1]))
            self.assertEqual(b"".join(connection.parts[1:-1]), file.read_bytes())
            self.assertEqual(result["status"], 204)
            self.assertEqual(result["version"], "1")

    def test_connection_failure_breaks_barrier_for_other_clients(self):
        api = bench.API("https://localhost:8080/api-gateway")
        connection = FakeConnection()
        barrier = threading.Barrier(2)
        with patch.object(api, "connection", return_value=connection), patch.object(connection, "connect", side_effect=OSError):
            result = api.upload({}, {"_id": "p"}, Path("unused"), "video", barrier)
        self.assertTrue(barrier.broken)
        self.assertEqual(result["error"], "OSError")
        self.assertIsNone(result["seconds"])

    def test_synchronized_sum_uses_idle_median_and_rejects_missing_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for service in bench.PROTOCOL["services"]:
                rows = []
                for milliseconds in range(0, 61000, 100):
                    rss = 100 if milliseconds < 30000 or milliseconds >= 31000 else 400
                    rows.append({"timestamp_ms": milliseconds, "read_ms": 1,
                        "complete": True, "processes": [{"pid": 1}], "rss_bytes": rss})
                (root / (service + ".jsonl")).write_text("\n".join(json.dumps(r) for r in rows))
            result = bench.summarize(root, 0, 61000)
            self.assertEqual(result["rest_rss_bytes"], 300)
            self.assertEqual(result["additional_peak_rss_bytes"], 900)
            self.assertEqual(result["post_response_median_rss_bytes"], 300)
            self.assertTrue(result["sampling_valid"])
            path = root / "projects.jsonl"
            lines = path.read_text().splitlines()
            del lines[305]
            path.write_text("\n".join(lines))
            result = bench.summarize(root, 0, 61000)
            self.assertEqual(result["missing_buckets"], 1)
            self.assertFalse(result["sampling_valid"])

    def test_refuses_nonlocal_insecure_target(self):
        for url in ("http://localhost", "https://example.com"):
            with self.assertRaises(ValueError):
                bench.API(url)


if __name__ == "__main__":
    unittest.main()
