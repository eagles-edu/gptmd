from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import gptmd_memory


class CuratorMDTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "project"
        self.root.mkdir()
        (self.root / "persistence").mkdir()
        for filename in ("AGENTS.md", "SOP.md", "HISTORY.md", "LESSONS-LEARNED.md"):
            (self.root / "persistence" / filename).write_text(f"# {filename}\n", encoding="utf-8")
        (self.root / ".gitignore").write_text(".curatormd/\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "CuratorMD test"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "baseline"], cwd=self.root, check=True)
        self.plugin_data = tempfile.TemporaryDirectory()
        self.old_plugin_data = os.environ.get("CURATORMD_PLUGIN_DATA")
        os.environ["CURATORMD_PLUGIN_DATA"] = self.plugin_data.name

    def tearDown(self):
        if self.old_plugin_data is None:
            os.environ.pop("CURATORMD_PLUGIN_DATA", None)
        else:
            os.environ["CURATORMD_PLUGIN_DATA"] = self.old_plugin_data
        self.plugin_data.cleanup()
        self.temp_dir.cleanup()

    def test_project_root_must_be_absolute_worktree_root(self):
        with self.assertRaises(gptmd_memory.CuratorError):
            gptmd_memory.resolve_project_root(".")
        with self.assertRaises(gptmd_memory.CuratorError):
            gptmd_memory.resolve_project_root(str(self.root / "persistence"))
        with self.assertRaises(gptmd_memory.CuratorError):
            gptmd_memory.resolve_project_root(str(Path(self.temp_dir.name)))
        alias = Path(self.temp_dir.name) / "project-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.assertEqual(gptmd_memory.resolve_project_root(str(alias)), self.root.resolve())

    def test_snapshot_does_not_read_env_values(self):
        secret = "sk-test-secret-value-never-returned"
        (self.root / ".env").write_text(f"OPENAI_API_KEY={secret}\n", encoding="utf-8")
        snapshot = gptmd_memory.environment_snapshot(str(self.root))
        encoded = json.dumps(snapshot)
        self.assertNotIn(secret, encoded)
        self.assertNotIn(".env", json.dumps(snapshot["approved_manifests"]))

    def test_native_projection_redacts_and_is_idempotent(self):
        payload = {"response": "api_key=super-secret-value", "tool_names": ["git"]}
        first = gptmd_memory.native_projection_record(str(self.root), "test-source", "agent:end", payload, profile="test")
        second = gptmd_memory.native_projection_record(str(self.root), "test-source", "agent:end", payload, profile="test")
        self.assertTrue(first["written"])
        self.assertTrue(second["duplicate"])
        record = next((self.root / ".curatormd" / "native-inbox").glob("*.json")).read_text(encoding="utf-8")
        self.assertNotIn("super-secret-value", record)
        self.assertIn("[REDACTED]", record)

    def test_unreviewed_projection_is_ambiguous_and_not_promoted(self):
        gptmd_memory.native_projection_record(str(self.root), "test-source", "agent:end", {"note": "candidate"}, profile="test")
        result = gptmd_memory.curate(str(self.root), profile="test")
        self.assertEqual(len(result["ambiguous"]), 1)
        self.assertEqual((self.root / "persistence" / "HISTORY.md").read_text(encoding="utf-8"), "# HISTORY.md\n")

    def test_reviewed_candidate_is_promoted(self):
        gptmd_memory.native_projection_record(str(self.root), "test-source", "agent:end", {"note": "candidate"}, profile="test")
        path = next((self.root / ".curatormd" / "native-inbox").glob("*.json"))
        record = json.loads(path.read_text(encoding="utf-8"))
        record["reviewed"] = True
        record["candidate"] = {
            "kind": "history",
            "title": "Reviewed test decision",
            "content": "Use the reviewed curation path.",
            "rationale": "The behavior was verified in the test harness.",
            "impact": "Future runs retain a durable decision.",
        }
        path.write_text(json.dumps(record), encoding="utf-8")
        result = gptmd_memory.curate(str(self.root), profile="test")
        self.assertEqual(len(result["written"]), 1)
        self.assertIn("Reviewed test decision", (self.root / "persistence" / "HISTORY.md").read_text(encoding="utf-8"))

    def test_uncommitted_knowledge_file_is_a_conflict(self):
        gptmd_memory.native_projection_record(str(self.root), "test-source", "agent:end", {"note": "candidate"}, profile="test")
        path = next((self.root / ".curatormd" / "native-inbox").glob("*.json"))
        record = json.loads(path.read_text(encoding="utf-8"))
        record["reviewed"] = True
        record["candidate"] = {"kind": "history", "title": "Blocked", "content": "Must not append."}
        path.write_text(json.dumps(record), encoding="utf-8")
        history = self.root / "persistence" / "HISTORY.md"
        history.write_text(history.read_text(encoding="utf-8") + "\nlocal edit\n", encoding="utf-8")
        result = gptmd_memory.curate(str(self.root), profile="test")
        self.assertEqual(len(result["conflicts"]), 1)
        self.assertNotIn("Blocked", history.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
