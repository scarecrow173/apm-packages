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
 *  is rejected — it could escape the overlay root or smuggle foreign bytes.
 *  Exported so the update report can compute which upstream paths the
 *  overlay owns without re-walking the tree. */
export function listOverlayFiles(dir: string): string[] {
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
 *  Every overlay rel path is checked by `assertSafeRelPath`, and overlay
 *  paths must be unique under case folding (like `scanTree` enforces for
 *  upstream — a pair such as `a/X.md` + `a/x.md` would collide on
 *  win32/macOS checkouts and produce platform-dependent output). A path
 *  that exists upstream REQUIRES `overlay.yml allow_overwrite` membership —
 *  "exists" is judged under case folding too, so a differently-cased
 *  overlay name cannot evade the allowlist and silently replace upstream
 *  bytes on a case-insensitive filesystem while provenance calls it an
 *  addition. Such overwrites are authorized by, applied to, and recorded
 *  under the CANONICAL upstream path so output casing stays byte-stable
 *  across platforms. All validation completes before any byte is copied,
 *  so a rejected overlay never mutates the staged tree. Overwrites record
 *  the staged upstream sha256 for provenance; allowlist entries that end
 *  up unused only warn. */
export function applyOverlay(
  cfg: BuildConfig,
  outDir: string,
  upstreamHash: Map<string, string>,
): OverlayResult {
  const files = fs.existsSync(cfg.overlay.dir)
    ? listOverlayFiles(cfg.overlay.dir)
    : [];

  // Case-folded index of upstream paths: folded rel path → canonical
  // upstream path. `scanTree` already rejected fold-collisions inside the
  // upstream tree, so each folded key resolves to one canonical path.
  const upstreamFolded = new Map<string, string>();
  for (const p of upstreamHash.keys()) {
    upstreamFolded.set(p.toLowerCase(), p);
  }

  // Pass 1 — validate every overlay rel path and overwrite authorization
  // before copying anything. `targets` maps each overwriting overlay path
  // to the canonical upstream path it replaces.
  const overlayFolded = new Map<string, string>();
  const targets = new Map<string, string>();
  for (const relPath of files) {
    assertSafeRelPath(relPath, "overlay path");
    const folded = relPath.toLowerCase();
    const prev = overlayFolded.get(folded);
    if (prev !== undefined) {
      throw new Error(
        `overlay path collision (case-insensitive): ${prev} vs ${relPath}`,
      );
    }
    overlayFolded.set(folded, relPath);
    const canonical = upstreamHash.has(relPath)
      ? relPath
      : upstreamFolded.get(folded);
    if (canonical === undefined) continue; // addition
    if (!cfg.overlay.allowOverwrite.includes(canonical)) {
      throw new Error(
        canonical === relPath
          ? `overlay overwrite not allowlisted: ${relPath}`
          : `overlay overwrite not allowlisted: ${relPath} ` +
            `(overwrites upstream path ${canonical} on ` +
            `case-insensitive filesystems)`,
      );
    }
    targets.set(relPath, canonical);
  }

  // Pass 2 — copy bytes verbatim into the staged tree. Overwrites land on
  // the canonical upstream path — never the differently-cased overlay
  // name — so provenance records the path that actually exists in output.
  const result: OverlayResult = { additions: [], overwrites: [] };
  for (const relPath of files) {
    const bytes = fs.readFileSync(path.join(cfg.overlay.dir, relPath));
    const dest = targets.get(relPath) ?? relPath;
    writeFileSafe(path.join(outDir, dest), bytes);
    const digest = sha256Bytes(bytes);
    const upstreamSha = upstreamHash.get(dest);
    if (upstreamSha === undefined) {
      result.additions.push({ path: relPath, sha256: digest });
    } else {
      result.overwrites.push({
        path: dest,
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
