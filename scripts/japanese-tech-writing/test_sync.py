"""Offline regression tests for upstream synchronization."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest

from sync import GIST, LICENSE_URL, LOCK, PROVENANCE, SKILL, SyncError, sync


SHA_A = "8f2d57610a73efc97d743c9b0b0ecb1002e09fa4"
SHA_B = "a" * 40


def upstream(body: str = "初期本文") -> bytes:
    return (
        "---\n"
        "name: japanese-tech-writing\n"
        "description: 日本語技術文書の文章規範\n"
        f"license: Unlicense（{LICENSE_URL}）\n"
        "---\n\n"
        "# 日本語技術文書の文章規範\n\n"
        f"{body}\n"
    ).encode("utf-8")


def locked(digest: str) -> str:
    lines = [
        "lockfile_version: '1'",
        "dependencies:",
        "- repo_url: _local/japanese-tech-writing",
        "  name: japanese-tech-writing",
        "  deployed_file_hashes:",
    ]
    locations = (
        ".agents/skills/japanese-tech-writing/SKILL.md",
        ".claude/skills/japanese-tech-writing/SKILL.md",
    )
    lines += [f"    {location}: sha256:{digest}" for location in locations]
    lines += ["  source: local", "deployments:"]
    for target, location in zip(("agent-skills", "claude"), locations):
        lines += [
            "- kind: project-relative",
            f"  target: {target}",
            f"  value: {location}",
            "  runtime: null",
            "  scope: project",
            "  owners:",
            "  - ./packages/japanese-tech-writing",
            "  active_owner: ./packages/japanese-tech-writing",
            f"  content_hash: sha256:{digest}",
        ]
    return "\n".join(lines) + "\n"


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.md"
        self.source.write_bytes(upstream())
        self.skill = self.root / SKILL
        self.skill.parent.mkdir(parents=True)
        self.skill.write_bytes(upstream().replace(
            f"license: Unlicense（{LICENSE_URL}）".encode(), b"license: Unlicense"
        ))
        self.initial_skill = self.skill.read_bytes()
        self.lock = self.root / LOCK
        self.lock.write_text(locked(hashlib.sha256(self.initial_skill).hexdigest()), encoding="utf-8")
        self.original_lock = self.lock.read_bytes()

    def test_update_body_and_revision_and_lock(self) -> None:
        self.source.write_bytes(upstream("改訂本文"))
        changed = sync(self.root, self.source, SHA_B)
        self.assertEqual(set(changed), {self.skill, self.lock, self.root / PROVENANCE})
        self.assertIn("改訂本文", self.skill.read_text(encoding="utf-8"))
        new_digest = hashlib.sha256(self.skill.read_bytes()).hexdigest()
        self.assertEqual(self.lock.read_text(encoding="utf-8").count(new_digest), 4)
        self.assertEqual(sync(self.root, self.source, SHA_B), [])

    def test_new_revision_with_same_content_changes_only_provenance(self) -> None:
        first = sync(self.root, self.source, SHA_A)
        self.assertEqual(first, [self.root / PROVENANCE])
        self.assertEqual(sync(self.root, self.source, SHA_B), [self.root / PROVENANCE])
        self.assertEqual(self.lock.read_bytes(), self.original_lock)

    def test_invalid_name_fails_without_changes(self) -> None:
        self.source.write_bytes(upstream().replace(
            b"name: japanese-tech-writing", b"name: compromised-name"
        ))
        with self.assertRaisesRegex(SyncError, "skill name changed"):
            sync(self.root, self.source, SHA_B)
        self.assertEqual(self.skill.read_bytes(), self.initial_skill)
        self.assertEqual(self.lock.read_bytes(), self.original_lock)
        self.assertFalse((self.root / PROVENANCE).exists())

    def test_license_change_fails(self) -> None:
        self.source.write_bytes(upstream().replace(b"Unlicense", b"GPL-3.0"))
        with self.assertRaisesRegex(SyncError, "license changed"):
            sync(self.root, self.source, SHA_B)

    def test_reject_mismatched_lock_before_writing(self) -> None:
        self.source.write_bytes(upstream("改訂本文"))
        self.lock.write_text(locked("0" * 64), encoding="utf-8")
        with self.assertRaisesRegex(SyncError, "does not match"):
            sync(self.root, self.source, SHA_B)
        self.assertEqual(self.skill.read_bytes(), self.initial_skill)

    def test_reject_invalid_revision(self) -> None:
        with self.assertRaisesRegex(SyncError, "revision must"):
            sync(self.root, self.source, "main")

    def test_reject_extra_frontmatter_field(self) -> None:
        self.source.write_bytes(upstream().replace(
            b"name: japanese-tech-writing", b"name: japanese-tech-writing\ncommand: dangerous"
        ))
        with self.assertRaisesRegex(SyncError, "Unexpected"):
            sync(self.root, self.source, SHA_B)

    def test_reject_missing_upstream_heading(self) -> None:
        self.source.write_bytes(upstream().replace(
            "# 日本語技術文書の文章規範".encode(), "# 改名".encode()
        ))
        with self.assertRaisesRegex(SyncError, "heading changed"):
            sync(self.root, self.source, SHA_B)

    def test_reject_symlink(self) -> None:
        link = self.root / "link.md"
        try:
            link.symlink_to(self.source)
        except OSError:
            self.skipTest("symlinks are unsupported on this platform")
        with self.assertRaisesRegex(SyncError, "ordinary file"):
            sync(self.root, link, SHA_B)

    def test_empty_and_binary_inputs_rejected(self) -> None:
        self.source.write_bytes(b"")
        with self.assertRaisesRegex(SyncError, "size"):
            sync(self.root, self.source, SHA_B)
        self.source.write_bytes(b"\xff")
        with self.assertRaisesRegex(SyncError, "UTF-8"):
            sync(self.root, self.source, SHA_B)


if __name__ == "__main__":
    unittest.main()
