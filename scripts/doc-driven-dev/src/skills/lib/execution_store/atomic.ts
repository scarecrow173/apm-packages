"use strict";

// ---------------------------------------------------------------------------
// Execution Store v1 — atomic file primitives and the per-run writer lock
// ---------------------------------------------------------------------------
//
// Two mechanisms, deliberately distinct (the issue warns against conflating
// them):
//
//   atomic write   — tmp file in the SAME directory + write + fsync +
//                    rename + best-effort directory fsync. A reader only ever
//                    sees the old or the new content; a crash leaves a
//                    `*.tmp-<pid>-<n>` sibling that is never valid content.
//   writer lock    — per-run `writer.lock` created with O_EXCL. Exactly one
//                    mutating operation per run at a time; the lock record
//                    carries pid+hostname so crash recovery can tell a stale
//                    local lock from a live remote one on shared roots.
//
// CAS lives one layer up: under the lock, an operation re-reads the record,
// compares expected revision/version, and only then writes — an interrupted
// sequence can never silently lose an update.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Machine-readable failure surface. The CLI maps `code` verbatim into its
// JSON error payload, so codes are stable contract, not prose.
class StoreError extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}

let tmpCounter = 0;

function tmpNameFor(file: string): string {
  tmpCounter = (tmpCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${file}.tmp-${process.pid}-${tmpCounter}`;
}

// Files this store may leave behind mid-write. Recovery only ever removes
// names matching this pattern — anything else is reported, not touched.
function isStoreTmpFile(name: string): boolean {
  return /\.tmp-\d+-\d+$/.test(name);
}

function fsyncDirectory(dir: string): void {
  // Directory fsync is what makes the rename durable on POSIX filesystems.
  // Windows rejects fsync on directory handles — the metadata flush there is
  // the filesystem's own business, so an unsupported error is tolerated and
  // every other failure still propagates.
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EPERM" && code !== "EBADF" && code !== "EISDIR") {
      throw error;
    }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* close-after-fsync is best-effort */ }
    }
  }
}

// Write `content` to `file` so no reader can observe a torn state.
function atomicWriteFile(file: string, content: string): void {
  const tmp = tmpNameFor(file);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, content, 0, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* fall through to cleanup */ }
    }
  }
  try {
    fs.renameSync(tmp, file);
  } catch (error: unknown) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* leave the tmp for recovery evidence */ }
    throw error;
  }
  fsyncDirectory(path.dirname(file));
}

// Strict JSON read: a parse failure is corrupt state, never content to
// adopt — callers must surface it, not repair it silently.
function readJsonFile(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error: unknown) {
    throw new StoreError(
      "state-unreadable",
      `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error: unknown) {
    throw new StoreError(
      "corrupt-state",
      `${file} is not valid JSON — the store never adopts a partial write: ${error instanceof Error ? error.message : String(error)}`,
      { path: file },
    );
  }
}

// Append a single line and flush — used only by the non-authoritative
// run trace. Appends hold the writer lock like every other mutation, and a
// crash may leave a torn LAST line; trace readers must tolerate that.
function appendLine(file: string, line: string): void {
  const fd = fs.openSync(file, "a");
  try {
    fs.writeSync(fd, `${line}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Per-run writer lock
// ---------------------------------------------------------------------------

const WRITER_LOCK_NAME = "writer.lock";

type WriterLockRecord = {
  pid: number;
  hostname: string;
  acquiredAt: string;
};

function readLockRecord(lockFile: string): WriterLockRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, "utf8")) as Partial<WriterLockRecord>;
    if (typeof parsed.pid === "number" && typeof parsed.hostname === "string") {
      return { pid: parsed.pid, hostname: parsed.hostname, acquiredAt: String(parsed.acquiredAt ?? "") };
    }
  } catch { /* unreadable lock records are treated as stale */ }
  return null;
}

function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process exists but belongs to another user — it is
    // alive for locking purposes. ESRCH means gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Acquire the per-run writer lock. A live same-machine holder (or any lock
// on a DIFFERENT machine, where pid liveness cannot be assessed) fails
// closed as `writer-conflict`. A lock left by a dead local pid — including a
// crashed earlier op in this same process — is recovered by stealing:
// remove it, then let O_EXCL arbitration pick exactly one winner.
function acquireWriterLock(runDir: string): () => void {
  const lockFile = path.join(runDir, WRITER_LOCK_NAME);
  const record: WriterLockRecord = {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
  };
  const tryCreate = (): boolean => {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };

  if (!tryCreate()) {
    const holder = readLockRecord(lockFile);
    const holderDescription = holder === null
      ? "unreadable lock record"
      : `pid ${holder.pid} on ${holder.hostname}`;
    const local = holder !== null
      && (holder.hostname === os.hostname() || holder.pid === process.pid);
    if (holder !== null && local && !pidAlive(holder.pid)) {
      try { fs.rmSync(lockFile, { force: true }); } catch { /* another recoverer may have won */ }
    }
    if (!tryCreate()) {
      throw new StoreError(
        "writer-conflict",
        `run at ${runDir} already has a writer (${holderDescription}) — per-run single writer is exclusive`,
        { lock: holder },
      );
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fs.rmSync(lockFile, { force: true }); } catch { /* releasing is best-effort */ }
  };
}

export {
  StoreError,
  WRITER_LOCK_NAME,
  acquireWriterLock,
  appendLine,
  atomicWriteFile,
  fsyncDirectory,
  isStoreTmpFile,
  pidAlive,
  readJsonFile,
  readLockRecord,
  tmpNameFor,
};

export type { WriterLockRecord };
