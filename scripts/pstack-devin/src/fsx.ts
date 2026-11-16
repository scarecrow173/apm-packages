import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** SHA-256 hex digest of a Buffer. */
export function sha256Bytes(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

/** SHA-256 hex digest of a file, streamed in 1 MiB chunks. */
export function sha256File(p: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    let n: number;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** On Windows, prefix an absolute path with \\?\ so fs calls tolerate paths
 *  longer than MAX_PATH (the upstream tree has deep paths). */
function toExtendedPath(resolved: string): string {
  if (process.platform === "win32" && !resolved.startsWith("\\\\?\\")) {
    return resolved.startsWith("\\\\")
      ? "\\\\?\\UNC\\" + resolved.slice(2) // UNC shares need the UNC subprefix
      : "\\\\?\\" + resolved;
  }
  return resolved;
}

/** Write `data` to `dest`, creating parent directories. Defends the output
 *  tree: rejects NUL bytes and paths whose basename escapes their own parent
 *  via `..`. On win32 the write uses the extended-length path form. */
export function writeFileSafe(dest: string, data: Buffer | string): void {
  if (dest.includes("\0")) {
    throw new Error(`invalid path (NUL byte): ${JSON.stringify(dest)}`);
  }
  const resolved = path.resolve(dest);
  const parent = path.resolve(path.dirname(dest));
  if (resolved !== parent && !resolved.startsWith(parent + path.sep)) {
    throw new Error(`unsafe path escapes its parent directory: ${dest}`);
  }
  const target = toExtendedPath(resolved);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

/** Recursive, non-throwing removal (like `rm -rf`). */
export function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}
