import type { BuildConfig } from "./config.js";
import type { Inventory } from "./inventory.js";
import type { OverlayResult } from "./overlay.js";

export interface UpstreamInfo {
  /** `.version` of the staged upstream plugin.json ("" when absent). */
  version: string;
  /** SHA of the pinned upstream subtree (`<commit>:<upstream.path>`). */
  treeSha: string;
  /** Number of files materialized from the upstream subtree. */
  fileCount: number;
}

/** Deterministic provenance record for a built devin-plugin tree. Contains
 *  no timestamps or run-specific data so the output is byte-stable for a
 *  given upstream commit + overlay content. */
export function buildProvenance(
  cfg: BuildConfig,
  u: UpstreamInfo,
  inv: Inventory,
  ov: OverlayResult,
): Record<string, unknown> {
  return {
    schema: "pstack-devin/provenance@1",
    upstream: {
      repo: cfg.upstream.repo,
      host: cfg.upstream.host,
      path: cfg.upstream.path,
      commit: cfg.upstream.commit,
      version: u.version,
      tree_sha: u.treeSha,
      file_count: u.fileCount,
    },
    distribution: {
      name: cfg.distribution.packageName,
      plugin_name: cfg.distribution.pluginName,
      version: cfg.distribution.version,
    },
    overlay: { additions: ov.additions, overwrites: ov.overwrites },
    executables: inv.executables,
    generator: "scripts/pstack-devin build",
  };
}

/** Recursively sort object keys so JSON.stringify emits a canonical order. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortKeys);
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Canonical JSON: recursively sorted keys, 2-space indent, LF newlines,
 *  one trailing newline. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2).replace(/\r\n/g, "\n") + "\n";
}
