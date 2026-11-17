#!/usr/bin/env python3
"""Deterministically vendor a single pinned Japanese technical writing Gist.

The caller must supply SKILL.md from a Git checkout and its exact HEAD SHA.
This script has no network access and never executes upstream content.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

GIST = "k16shikano/fd287c3133457c4fd8f5601d34aa817d"
LICENSE_URL = "https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063"
SKILL = Path("packages/japanese-tech-writing/.apm/skills/japanese-tech-writing/SKILL.md")
PROVENANCE = Path("packages/japanese-tech-writing/upstream.json")
LOCK = Path("apm.lock.yaml")
NAME = "japanese-tech-writing"
COMMIT_RE = re.compile(r"[0-9a-f]{40}\Z")
HASH_RE = re.compile(r"[0-9a-f]{64}\Z")
MAX_BYTES = 256 * 1024


class SyncError(ValueError):
    """An upstream or checked-in artifact violates the sync contract."""


def normalize(raw: bytes) -> bytes:
    if not (0 < len(raw) <= MAX_BYTES):
        raise SyncError("Gist SKILL.md size must be 1..262144 bytes")
    try:
        source = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SyncError("Gist SKILL.md must be UTF-8") from error
    if "\0" in source:
        raise SyncError("Gist SKILL.md may not contain NUL")
    source = source.replace("\r\n", "\n")
    if not source.startswith("---\n"):
        raise SyncError("Gist SKILL.md must start with YAML frontmatter")
    closing = source.find("\n---\n", 4)
    if closing < 0:
        raise SyncError("Gist SKILL.md is missing its closing frontmatter delimiter")
    header = source[4:closing]
    rest = source[closing + len("\n---\n"):]
    lines = header.split("\n")
    fields: dict[str, str] = {}
    for line in lines:
        match = re.fullmatch(r"([a-z][a-z-]*):\s*(.+)", line)
        if not match:
            raise SyncError("Unsupported upstream frontmatter syntax")
        key, value = match.groups()
        if key in fields or key not in {"name", "description", "license"}:
            raise SyncError(f"Unexpected or repeated frontmatter field: {key}")
        fields[key] = value
    if set(fields) != {"name", "description", "license"}:
        raise SyncError("Expected name, description, and license frontmatter")
    if fields["name"] != NAME:
        raise SyncError("Upstream skill name changed")
    if not (
        fields["license"] == "Unlicense"
        or fields["license"] == f"Unlicense（{LICENSE_URL}）"
        or fields["license"] == f"Unlicense ({LICENSE_URL})"
    ):
        raise SyncError("Upstream license changed; update requires manual review")
    if not rest.lstrip().startswith("# 日本語技術文書の文章規範"):
        raise SyncError("Upstream heading changed; update requires manual review")
    index = next(i for i, line in enumerate(lines) if line.startswith("license:"))
    lines[index] = "license: Unlicense"
    normalized = "---\n" + "\n".join(lines) + "\n---\n" + rest
    return normalized.encode("utf-8")


def replace_one(text: str, pattern: str, old: str, new: str) -> str:
    matches = list(re.finditer(pattern, text, re.MULTILINE))
    if len(matches) != 1:
        raise SyncError(f"Expected one lock entry, found {len(matches)}: {pattern}")
    match = matches[0]
    if match.group("hash") != old:
        raise SyncError("Committed lockfile hash does not match vendored SKILL.md")
    start, end = match.span("hash")
    return text[:start] + new + text[end:]


def update_lock(lock: str, previous: str, current: str) -> str:
    if not HASH_RE.fullmatch(previous) or not HASH_RE.fullmatch(current):
        raise SyncError("Invalid SHA-256 digest")
    if previous == current:
        return lock
    updated = lock
    for location in (
        ".agents/skills/japanese-tech-writing/SKILL.md",
        ".claude/skills/japanese-tech-writing/SKILL.md",
    ):
        # Hashes in the _local package's deployed_file_hashes mapping.
        key = re.escape(location)
        updated = replace_one(
            updated, rf"^    {key}: sha256:(?P<hash>[0-9a-f]{{64}})$", previous, current
        )
        # The same files are declared as independently deployed artifacts.
        updated = replace_one(
            updated,
            rf"^  value: {key}\n"
            rf"  runtime: null\n"
            rf"  scope: project\n"
            rf"  owners:\n"
            rf"  - ./packages/japanese-tech-writing\n"
            rf"  active_owner: ./packages/japanese-tech-writing\n"
            rf"  content_hash: sha256:(?P<hash>[0-9a-f]{{64}})$",
            previous,
            current,
        )
    return updated


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=path.parent, prefix=".sync-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def sync(root: Path, source_path: Path, revision: str) -> list[Path]:
    if not COMMIT_RE.fullmatch(revision):
        raise SyncError("Gist revision must be a full 40-character lowercase Git SHA")
    if source_path.is_symlink() or not source_path.is_file():
        raise SyncError("Upstream SKILL.md must be an ordinary file, not a symlink")
    new_skill = normalize(source_path.read_bytes())
    skill_path, metadata_path, lock_path = (root / SKILL, root / PROVENANCE, root / LOCK)
    previous_skill = skill_path.read_bytes()
    previous_lock = lock_path.read_bytes()
    try:
        lock_text = previous_lock.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SyncError("APM lockfile is not UTF-8") from error
    old_hash = hashlib.sha256(previous_skill).hexdigest()
    new_hash = hashlib.sha256(new_skill).hexdigest()
    new_lock = update_lock(lock_text, old_hash, new_hash).encode("utf-8")

    if metadata_path.exists():
        try:
            recorded = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise SyncError("Invalid existing provenance metadata") from error
        if recorded.get("gist") != GIST or not COMMIT_RE.fullmatch(
            str(recorded.get("revision", ""))
        ):
            raise SyncError("Existing provenance is not this Gist")
    new_metadata = (
        json.dumps({"gist": GIST, "revision": revision}, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")

    # Validate all three outputs before writing any. A failed Actions run never pushes.
    replacements = (
        (skill_path, new_skill),
        (lock_path, new_lock),
        (metadata_path, new_metadata),
    )
    changed: list[Path] = []
    for path, desired in replacements:
        if not path.exists() or path.read_bytes() != desired:
            changed.append(path)
    for path, desired in replacements:
        if path in changed:
            atomic_write(path, desired)
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Gist checkout SKILL.md")
    parser.add_argument("--revision", required=True, help="git rev-parse HEAD of checkout")
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2],
        help="apm-packages repo root (primarily for testing)",
    )
    args = parser.parse_args()
    try:
        changed = sync(args.root.resolve(), args.source, args.revision)
    except (SyncError, OSError) as error:
        parser.exit(1, f"japanese-tech-writing sync failed: {error}\n")
    if changed:
        for path in changed:
            print(f"updated {path.relative_to(args.root.resolve())}")
    else:
        print("japanese-tech-writing: already up to date")


if __name__ == "__main__":
    main()
