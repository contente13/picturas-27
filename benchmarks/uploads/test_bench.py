"""Local checks for measurement arithmetic and streamed HTTP request contracts."""
import json
import io
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

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

    def test_shutdown_timeout_removes_helper_and_still_stops_all_workers(self):
        with tempfile.TemporaryDirectory() as directory:
            saved = Path(directory) / "result.json"
            bench.save(saved, {"uploads": [{"status": 504, "seconds": 65.8}]})
            workers = [("helper-a", Mock(), io.StringIO(), io.StringIO()),
                       ("helper-b", Mock(), io.StringIO(), io.StringIO())]
            for _, process, _, _ in workers:
                process.poll.return_value = None
            ok = Mock(returncode=0, stderr=b"", stdout=b"")
            gone = Mock(returncode=1, stderr=b"Error: No such container: helper-b")
            with patch.object(bench.subprocess, "run", side_effect=[
                subprocess.TimeoutExpired("docker stop", 15), ok, ok, ok, gone, ok]) as run:
                diagnostics = bench.stop_observers(workers)
            self.assertTrue(all(x["removed"] for x in diagnostics))
            self.assertIn("stop_TimeoutExpired", diagnostics[0]["warnings"])
            self.assertEqual([call.args[0] for call in run.call_args_list], [
                ["docker", "stop", "--time", "1", "helper-a"], ["docker", "rm", "-f", "helper-a"],
                ["docker", "ps", "-aq", "--filter", "name=^/helper-a$"],
                ["docker", "stop", "--time", "1", "helper-b"], ["docker", "rm", "-f", "helper-b"],
                ["docker", "ps", "-aq", "--filter", "name=^/helper-b$"]])
            self.assertTrue(all(out.closed and err.closed for _, _, out, err in workers))
            self.assertEqual(json.loads(saved.read_text())["uploads"][0]["status"], 504)

    def test_shutdown_waits_for_asynchronous_removal(self):
        process = Mock()
        process.poll.return_value = 0
        out, err = io.StringIO(), io.StringIO()
        ok = Mock(returncode=0, stdout=b"", stderr=b"")
        pending = Mock(returncode=0, stdout=b"container-id\n", stderr=b"")
        with patch.object(bench.subprocess, "run", side_effect=[ok, ok, pending, ok]), patch.object(bench.time, "sleep") as sleep:
            result = bench.stop_observers([("helper", process, out, err)])
        self.assertTrue(result[0]["removed"])
        sleep.assert_called_once_with(1)

    def test_atomic_checkpoint_keeps_previous_result_if_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            bench.save(path, {"stage": "responses_received", "uploads": [204, 504]})
            with patch.object(bench.os, "replace", side_effect=OSError("test failure")):
                with self.assertRaises(OSError):
                    bench.save(path, {"stage": "window_complete"})
            self.assertEqual(json.loads(path.read_text())["uploads"], [204, 504])

    def test_reviewed_failures_do_not_allow_unresolved_cleanup_or_other_scenarios(self):
        result = {"services_stable": True, "observer_cleanup_successful": True,
            "cleanup": {"projects_absent": True, "remaining_objects": 0},
            "uploads": [{"status": 504}] * 3}
        self.assertTrue(bench.may_continue_reviewed_failure("concurrent", result, True))
        self.assertFalse(bench.may_continue_reviewed_failure("small", result, True))
        self.assertFalse(bench.may_continue_reviewed_failure("concurrent", result, False))
        result["cleanup"]["remaining_objects"] = 1
        self.assertFalse(bench.may_continue_reviewed_failure("concurrent", result, True))
        result["cleanup"]["remaining_objects"] = 0
        result["measurement_error"] = "stop failure"
        self.assertFalse(bench.may_continue_reviewed_failure("concurrent", result, True))

    def test_refuses_nonlocal_insecure_target(self):
        for url in ("http://localhost", "https://example.com"):
            with self.assertRaises(ValueError):
                bench.API(url)


if __name__ == "__main__":
    unittest.main()
