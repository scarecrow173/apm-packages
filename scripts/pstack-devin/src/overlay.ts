import fs from "node:fs";
import path from "node:path";
import { sha256Bytes, writeFileSafe } from "./fsx.js";
import { assertSafeRelPath } from "./config.js";
import type { BuildConfig } from "./config.js";

export interface OverlayResult {
  additions: { path: string; sha256: string }[];
  overwrites: { path: string; sha256: string; upstreamSha256: string }[];
}

const byPath = (
  a: { path: string },
  b: { path: string },
): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** List overlay payload files as forward-slash rel paths, sorted. Any entry
 *  that is neither a regular file nor a directory (symlink, junction, fifo)
 *  is rejected — it could escape the overlay root or smuggle foreign bytes. */
function listOverlayFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const dirents = fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const de of dirents) {
      const relPath = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(path.join(abs, de.name), relPath);
      } else if (de.isFile()) {
        out.push(relPath);
      } else {
        throw new Error(`overlay entry is not a regular file: ${relPath}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Apply `cfg.overlay.dir` over the staged upstream tree at `outDir`.
 *  Every overlay rel path is checked by `assertSafeRelPath`, and a path that
 *  exists upstream REQUIRES `overlay.yml allow_overwrite` membership — all
 *  validation completes before any byte is copied, so a rejected overlay
 *  never mutates the staged tree. Overwrites record the staged upstream
 *  sha256 for provenance; allowlist entries that end up unused only warn. */
export function applyOverlay(
  cfg: BuildConfig,
  outDir: string,
  upstreamHash: Map<string, string>,
): OverlayResult {
  const files = fs.existsSync(cfg.overlay.dir)
    ? listOverlayFiles(cfg.overlay.dir)
    : [];

  // Pass 1 — validate every overlay rel path and overwrite authorization
  // before copying anything.
  for (const relPath of files) {
    assertSafeRelPath(relPath, "overlay path");
    if (
      upstreamHash.has(relPath) &&
      !cfg.overlay.allowOverwrite.includes(relPath)
    ) {
      throw new Error(`overlay overwrite not allowlisted: ${relPath}`);
    }
  }

  // Pass 2 — copy bytes verbatim into the staged tree.
  const result: OverlayResult = { additions: [], overwrites: [] };
  for (const relPath of files) {
    const bytes = fs.readFileSync(path.join(cfg.overlay.dir, relPath));
    writeFileSafe(path.join(outDir, relPath), bytes);
    const digest = sha256Bytes(bytes);
    const upstreamSha = upstreamHash.get(relPath);
    if (upstreamSha === undefined) {
      result.additions.push({ path: relPath, sha256: digest });
    } else {
      result.overwrites.push({
        path: relPath,
        sha256: digest,
        upstreamSha256: upstreamSha,
      });
    }
  }
  result.additions.sort(byPath);
  result.overwrites.sort(byPath);

  for (const entry of cfg.overlay.allowOverwrite) {
    if (!result.overwrites.some((o) => o.path === entry)) {
      console.warn(`overlay allow_overwrite entry unused: ${entry}`);
    }
  }
  return result;
}
