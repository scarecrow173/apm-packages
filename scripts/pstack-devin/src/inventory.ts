import { assertSafeRelPath } from "./config.js";
import type { TreeEntry } from "./gittools.js";

export interface Inventory {
  entries: TreeEntry[];
  executables: string[];
}

const byPath = (a: TreeEntry, b: TreeEntry): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Validate a fetched tree listing for materialization. Only regular-blob
 *  modes survive: symlinks (`120000`), submodules (`160000`), and any other
 *  mode throw naming the path. Every path must pass `assertSafeRelPath` and
 *  be unique under case folding (win32/macOS checkouts would collide).
 *  Returns entries sorted by path plus the sorted list of exec-bit
 *  (`100755`) paths. */
export function scanTree(entries: TreeEntry[]): Inventory {
  const seen = new Map<string, string>();
  const out: TreeEntry[] = [];
  const executables: string[] = [];
  for (const e of entries) {
    assertSafeRelPath(e.path, "upstream path");
    if (e.mode === "120000") {
      throw new Error(`symlink rejected: ${e.path}`);
    }
    if (e.mode === "160000") {
      throw new Error(`submodule rejected: ${e.path}`);
    }
    if (e.mode !== "100644" && e.mode !== "100755") {
      throw new Error(`unsupported mode ${e.mode}: ${e.path}`);
    }
    const folded = e.path.toLowerCase();
    const prev = seen.get(folded);
    if (prev !== undefined) {
      throw new Error(
        `path collision (case-insensitive): ${prev} vs ${e.path}`,
      );
    }
    seen.set(folded, e.path);
    out.push(e);
    if (e.mode === "100755") {
      executables.push(e.path);
    }
  }
  out.sort(byPath);
  executables.sort();
  return { entries: out, executables };
}
