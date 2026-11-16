import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BuildConfig } from "./config.js";
import { loadBuildConfig } from "./config.js";
import {
  catFileBlobs,
  gitRemote,
  listTree,
  manifestVersion,
} from "./gittools.js";
import type { TreeEntry, UpstreamRemote } from "./gittools.js";
import { scanTree } from "./inventory.js";
import { auditTree, TEXT_EXT } from "./compat-audit.js";
import { checkRoles, CONSUMER_DOC } from "./role-registry.js";
import { listOverlayFiles } from "./overlay.js";
import { rmrf } from "./fsx.js";

/** Diff classification buckets — the sections the PR reviewer scans. */
export type Category =
  | "skills/"
  | "agents/"
  | "docs/"
  | "manifests"
  | "LICENSE"
  | "other";

export type ChangeKind = "added" | "removed" | "changed";

export interface PathChange {
  path: string;
  kind: ChangeKind;
  category: Category;
}

export interface CategoryCount {
  category: Category;
  added: number;
  removed: number;
  changed: number;
}

export type BlockingKind =
  | "overlay-path"    // upstream touched a path the overlay owns
  | "license"         // LICENSE bytes changed/removed
  | "compat-unknown"  // added/changed file uses unclassified API tokens
  | "role-new"        // consumer doc names a role roles.json doesn't know
  | "role-removed";   // roles.json key no longer referenced upstream

export interface BlockingItem {
  kind: BlockingKind;
  path: string;
  detail: string;
}

export interface UpdateReport {
  current: string;
  candidate: string;
  /** Manifest versions on both sides, when at least one parses. */
  upstreamVersion: { current: string; candidate: string } | null;
  /** Every path-level diff, sorted by path. */
  changes: PathChange[];
  /** Per-category tallies, fixed section order, non-zero rows only. */
  categories: CategoryCount[];
  /** Compat findings on scanned (added/changed text) files — FYI count. */
  compatFindings: number;
  blocking: BlockingItem[];
  /** Notes that are neither diffs nor blocking (e.g. a skipped scan). */
  notes: string[];
  markdown: string;
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const CATEGORIES: Category[] = [
  "skills/", "agents/", "docs/", "manifests", "LICENSE", "other",
];

/** Bucket a subtree-relative path. `manifests` = the plugin manifests
 *  (`plugin.json`, `*.json` package manifests, dot-dir plugin manifests
 *  like `.claude-plugin/plugin.json`); `LICENSE` = the top-level license
 *  file and its extension variants. Everything else is `other`. */
export function categorize(p: string): Category {
  if (p.startsWith("skills/")) return "skills/";
  if (p.startsWith("agents/")) return "agents/";
  if (p.startsWith("docs/")) return "docs/";
  if (p === "LICENSE" || p.startsWith("LICENSE.")) return "LICENSE";
  if (
    p === "plugin.json" || p === "package.json" || p === "manifest.json" ||
    /^\.[^/]+\/plugin\.json$/.test(p)
  ) {
    return "manifests";
  }
  return "other";
}

interface EntryDiff {
  added: TreeEntry[];
  removed: TreeEntry[];
  changed: { path: string; before: TreeEntry; after: TreeEntry }[];
}

/** Path-keyed diff of two validated tree listings. A mode flip
 *  (644 ↔ 755) with identical blob sha still counts as `changed` —
 *  exec-bit drift is a real behavioral change for shipped scripts. */
function diffEntries(cur: TreeEntry[], cand: TreeEntry[]): EntryDiff {
  const curMap = new Map(cur.map((e) => [e.path, e]));
  const candMap = new Map(cand.map((e) => [e.path, e]));
  const added = cand.filter((e) => !curMap.has(e.path));
  const removed = cur.filter((e) => !candMap.has(e.path));
  const changed: EntryDiff["changed"] = [];
  for (const e of cand) {
    const before = curMap.get(e.path);
    if (before === undefined) continue;
    if (before.sha !== e.sha || before.mode !== e.mode) {
      changed.push({ path: e.path, before, after: e });
    }
  }
  return { added, removed, changed };
}

/** Paths the overlay writes into the generated tree: `allow_overwrite`
 *  entries (authorized replacements) plus every overlay payload (a pure
 *  addition collides the day upstream ships the same path, and an
 *  allowlisted path changing upstream invalidates the adapter content's
 *  review). Keyed case-folded, matching the overlay's collision rule. */
function watchedOverlayPaths(
  cfg: BuildConfig,
): Map<string, { allowlisted: boolean }> {
  const watched = new Map<string, { allowlisted: boolean }>();
  for (const p of cfg.overlay.allowOverwrite) {
    watched.set(p.toLowerCase(), { allowlisted: true });
  }
  const payloads = fs.existsSync(cfg.overlay.dir)
    ? listOverlayFiles(cfg.overlay.dir)
    : [];
  for (const p of payloads) {
    const key = p.toLowerCase();
    if (!watched.has(key)) watched.set(key, { allowlisted: false });
  }
  return watched;
}

const byPath = (
  a: { path: string },
  b: { path: string },
): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** The markdown report — the PR body core. Sections: Summary, Blocking,
 *  Categories, Non-blocking changes. Every diffed path appears exactly
 *  once in a list: either a ❌ blocking row or a non-blocking bullet. */
function renderMarkdown(rep: UpdateReport): string {
  const counts = {
    added: rep.changes.filter((c) => c.kind === "added").length,
    removed: rep.changes.filter((c) => c.kind === "removed").length,
    changed: rep.changes.filter((c) => c.kind === "changed").length,
  };
  const verdict = rep.blocking.length === 0
    ? "✅ no blocking findings — simple update"
    : `❌ BLOCKING — ${rep.blocking.length} finding(s) need adapter review`;

  const out: string[] = [];
  out.push("# pstack-devin upstream update report", "");
  out.push("## Summary", "");
  out.push("| | |");
  out.push("| --- | --- |");
  out.push(`| **Current pin** | \`${rep.current}\` |`);
  out.push(`| **Candidate** | \`${rep.candidate}\` |`);
  if (rep.upstreamVersion !== null) {
    const cur = rep.upstreamVersion.current || "none";
    const cand = rep.upstreamVersion.candidate || "none";
    out.push(`| **Upstream version** | \`${cur}\` → \`${cand}\` |`);
  }
  out.push(
    `| **Diff** | ${counts.added} added, ${counts.removed} removed, ` +
      `${counts.changed} changed |`,
  );
  out.push(`| **Verdict** | ${verdict} |`);
  out.push("");

  out.push("## Blocking", "");
  if (rep.blocking.length === 0) {
    out.push("No blocking findings.", "");
  } else {
    out.push("| Check | Path | Detail |");
    out.push("| --- | --- | --- |");
    for (const b of rep.blocking) {
      out.push(`| ❌ ${b.kind} | \`${esc(b.path)}\` | ${esc(b.detail)} |`);
    }
    out.push("");
  }
  for (const note of rep.notes) {
    out.push(`_${note}_`, "");
  }

  out.push("## Categories", "");
  if (rep.categories.length === 0) {
    out.push("No changes.", "");
  } else {
    out.push("| Category | Added | Removed | Changed |");
    out.push("| --- | --- | --- | --- |");
    for (const c of rep.categories) {
      out.push(
        `| ${c.category} | ${c.added} | ${c.removed} | ${c.changed} |`,
      );
    }
    out.push("");
  }

  const blockedPaths = new Set(rep.blocking.map((b) => b.path));
  const clean = rep.changes.filter((c) => !blockedPaths.has(c.path));
  out.push("## Non-blocking changes", "");
  if (clean.length === 0) {
    out.push("No non-blocking changes.", "");
  } else {
    const mark = { added: "+", removed: "-", changed: "~" } as const;
    for (const c of clean) {
      out.push(`- \`${mark[c.kind]} ${c.path}\` — ${c.category}`);
    }
    out.push("");
  }
  out.push(
    "_Manual Devin CLI re-verification: REQUIRED / not run " +
      "(generated report)._",
    "",
  );
  return out.join("\n");
}

/** Blob-diff the pinned upstream subtree against `candidateSha` and
 *  classify every path-level change. Blocking classes: a path the overlay
 *  owns changed upstream (allowlisted overwrite or would-be addition
 *  collision), the LICENSE bytes changed, a compat vocabulary scan of
 *  added/changed text files yields unknown tokens, or the role registry
 *  no longer covers the candidate docs (new or removed roles). All git
 *  access flows through the injected `remote`; blob payloads are only
 *  pulled for the files the scans actually read. */
export async function updateReport(
  cfg: BuildConfig,
  remote: UpstreamRemote,
  candidateSha: string,
  opts: { workDir: string },
): Promise<UpdateReport> {
  if (!COMMIT_RE.test(candidateSha)) {
    throw new Error(`candidate sha is not a 40-hex commit: ${candidateSha}`);
  }
  const current = cfg.upstream.commit;
  const notes: string[] = [];
  const repoCur = remote.fetchCommit(
    current,
    path.join(opts.workDir, "current"),
  );
  const repoCand = remote.fetchCommit(
    candidateSha,
    path.join(opts.workDir, "candidate"),
  );
  const curEntries = scanTree(
    listTree(repoCur, current, cfg.upstream.path),
  ).entries;
  const candInv = scanTree(listTree(repoCand, candidateSha, cfg.upstream.path));

  const diff = diffEntries(curEntries, candInv.entries);
  const changes: PathChange[] = [
    ...diff.added.map((e) => ({
      path: e.path, kind: "added" as const, category: categorize(e.path),
    })),
    ...diff.removed.map((e) => ({
      path: e.path, kind: "removed" as const, category: categorize(e.path),
    })),
    ...diff.changed.map((c) => ({
      path: c.path, kind: "changed" as const, category: categorize(c.path),
    })),
  ].sort(byPath);

  const blocking: BlockingItem[] = [];

  // Overlay-owned paths: any upstream-side diff at a path the overlay
  // writes must re-review the adapter before adoption.
  const watched = watchedOverlayPaths(cfg);
  for (const c of changes) {
    const w = watched.get(c.path.toLowerCase());
    if (w === undefined) continue;
    blocking.push({
      kind: "overlay-path",
      path: c.path,
      detail:
        `upstream ${c.kind} a path the overlay ` +
        (w.allowlisted
          ? "replaces (allowlisted overwrite)"
          : "also writes as an addition") +
        " — adapter content must be re-reviewed",
    });
  }

  // License bytes changed or removed — a legal-relevant upstream event.
  for (const c of changes) {
    if (c.category === "LICENSE" && c.kind !== "added") {
      blocking.push({
        kind: "license",
        path: c.path,
        detail: `upstream ${c.kind} the license file`,
      });
    }
  }

  // Compat scan of added/changed TEXT files — unknown tokens mean new
  // upstream API surface the adapter does not classify yet. Mode-only
  // flips share the blob sha, so they cannot introduce tokens.
  const isText = (p: string): boolean =>
    TEXT_EXT.has(path.extname(p).toLowerCase());
  const scanTargets: TreeEntry[] = [
    ...diff.added.filter((e) => isText(e.path)),
    ...diff.changed
      .filter((c) => c.before.sha !== c.after.sha && isText(c.after.path))
      .map((c) => c.after),
  ];
  let compatFindings = 0;
  if (scanTargets.length > 0) {
    const scanDir = path.join(opts.workDir, "compat-scan");
    await catFileBlobs(repoCand, scanTargets, scanDir);
    const audit = auditTree(scanDir, scanTargets.map((e) => e.path));
    compatFindings = audit.findings.length;
    for (const u of audit.unknowns) {
      blocking.push({
        kind: "compat-unknown",
        path: u.file,
        detail:
          `line ${u.line}: \`${u.match}\` is not in the compat ` +
          "vocabulary — new upstream API surface",
      });
    }
  }

  // Role-registry coverage of the candidate docs — refs live only in
  // consumer Markdown, so an unchanged doc set means unchanged roles.
  const rolesJson = path.join(
    cfg.overlay.dir,
    "skills/setup-pstack-devin/scripts/roles.json",
  );
  if (changes.some((c) => CONSUMER_DOC.test(c.path))) {
    if (fs.existsSync(rolesJson)) {
      const docEntries = candInv.entries.filter((e) =>
        CONSUMER_DOC.test(e.path)
      );
      const docDir = path.join(opts.workDir, "candidate-docs");
      await catFileBlobs(repoCand, docEntries, docDir);
      const roles = checkRoles(docDir, rolesJson);
      for (const u of roles.unknown) {
        blocking.push({
          kind: "role-new",
          path: u.file,
          detail:
            `line ${u.line} references \`${u.role}\` (${u.context}) — ` +
            "not registered in roles.json",
        });
      }
      for (const key of roles.dead) {
        blocking.push({
          kind: "role-removed",
          path: "roles.json",
          detail:
            `registry key \`${key}\` is no longer referenced ` +
            "upstream — drop or re-map it",
        });
      }
    } else {
      notes.push(
        "Consumer docs changed but overlay roles.json was not found — " +
          "role-registry scan skipped.",
      );
    }
  }

  const vCur = manifestVersion(repoCur, current, cfg.upstream.path);
  const vCand = manifestVersion(repoCand, candidateSha, cfg.upstream.path);
  const rep: UpdateReport = {
    current,
    candidate: candidateSha,
    upstreamVersion:
      vCur === "" && vCand === ""
        ? null
        : { current: vCur, candidate: vCand },
    changes,
    categories: CATEGORIES
      .map((category) => ({
        category,
        added: changes.filter(
          (c) => c.category === category && c.kind === "added",
        ).length,
        removed: changes.filter(
          (c) => c.category === category && c.kind === "removed",
        ).length,
        changed: changes.filter(
          (c) => c.category === category && c.kind === "changed",
        ).length,
      }))
      .filter((c) => c.added + c.removed + c.changed > 0),
    compatFindings,
    blocking,
    notes,
    markdown: "",
  };
  rep.markdown = renderMarkdown(rep);
  return rep;
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function main(argv: string[]): Promise<void> {
  const candidateSha = argv[2];
  if (candidateSha === undefined || !COMMIT_RE.test(candidateSha)) {
    throw new Error("usage: tsx src/update-report.ts <candidateSha>");
  }
  const cfg = loadBuildConfig(repoRoot);
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pstack-update-report-"),
  );
  try {
    const rep = await updateReport(
      cfg,
      gitRemote(cfg.upstream.repoUrl),
      candidateSha,
      { workDir },
    );
    process.stdout.write(rep.markdown);
  } finally {
    rmrf(workDir);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
