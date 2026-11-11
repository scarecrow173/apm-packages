"use strict";

import fs from "node:fs";
import path from "node:path";

import { artifactKeyOf, contractForType, finding, frontMatterEndLine, isExternalReference, slugifyAnchor } from "./doc_repository";
import type { DocumentRepository, Finding, RepositoryDocument } from "./doc_repository";
import { parseManagedIndexLayout } from "./doc_index_tiers";
import type { IndexRowTier } from "./doc_index_tiers";
import { isSettledStatus } from "./doc_lifecycle";
import { primaryIndexTypeForDir, residentTypesForDir } from "./doc_suite_utils";
import { isIndexFileName, normalizeDir } from "./document_utils";
import type { AuditProfile, LintScope } from "./doc_lint";

// ---------------------------------------------------------------------------
// Markdown link integrity
// ---------------------------------------------------------------------------

function caseInsensitiveExists(model: DocumentRepository, absolute: string): string | null {
  const dir = path.dirname(absolute);
  const base = path.basename(absolute).toLowerCase();
  if (!fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === base);
  if (!match) return null;
  const candidate = path.join(dir, match);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : null;
}

function lintDocumentLinks(model: DocumentRepository, scope: LintScope): Finding[] {
  const findings: Finding[] = [];
  for (const document of scope.documents) {
    if (document.parseError) continue;
    for (const link of document.links) {
      const resolved = model.resolvePath(document, link.target);
      if (resolved.status === "external") continue;
      if (resolved.status === "escaped") {
        findings.push(finding({
          ruleId: "link-escapes-root",
          category: "link",
          severity: "error",
          path: document.path,
          line: link.line,
          artifactId: document.id,
          message: `Link target escapes the repository root: ${link.target}`,
          target: link.target,
          repair: "manual",
        }));
        continue;
      }
      if (resolved.status === "unresolved") {
        const absolute = path.resolve(model.root, resolved.path ?? link.target);
        const caseMatch = resolved.path ? caseInsensitiveExists(model, absolute) : null;
        if (caseMatch) {
          findings.push(finding({
            ruleId: "link-case-mismatch",
            category: "link",
            severity: "warning",
            path: document.path,
            line: link.line,
            artifactId: document.id,
            message: `Link target differs only by case: ${link.target} (actual: ${path.basename(caseMatch)})`,
            target: link.target,
            repair: "safe",
          }));
          continue;
        }
        findings.push(finding({
          ruleId: link.isImage ? "missing-image-link" : "broken-link",
          category: "link",
          severity: "error",
          path: document.path,
          line: link.line,
          artifactId: document.id,
          message: `${link.isImage ? "Image" : "Link"} target does not exist: ${link.target}`,
          target: link.target,
          repair: "manual",
        }));
        continue;
      }

      if (resolved.status === "resolved" && resolved.path) {
        const targetBase = (() => {
          try {
            return decodeURIComponent(path.posix.basename(link.target.split("#")[0].split("?")[0]));
          } catch {
            return path.posix.basename(link.target.split("#")[0].split("?")[0]);
          }
        })();
        const absolute = path.resolve(model.root, resolved.path);
        const dir = path.dirname(absolute);
        const actualBase = fs.existsSync(dir)
          ? fs.readdirSync(dir).find((entry) => entry.toLowerCase() === targetBase.toLowerCase())
          : undefined;
        if (actualBase && actualBase !== targetBase) {
          findings.push(finding({
            ruleId: "link-case-mismatch",
            category: "link",
            severity: "warning",
            path: document.path,
            line: link.line,
            artifactId: document.id,
            message: `Link target differs only by case: ${link.target} (actual: ${actualBase})`,
            target: link.target,
            repair: "safe",
          }));
        }
      }

      if (!resolved.fragment) continue;
      const anchorDoc = resolved.document ?? document;
      const fragment = (() => {
        try {
          return decodeURIComponent(resolved.fragment as string);
        } catch {
          return resolved.fragment as string;
        }
      })();
      if (anchorDoc && !model.hasAnchor(anchorDoc, fragment)) {
        findings.push(finding({
          ruleId: "broken-anchor",
          category: "link",
          severity: "warning",
          path: document.path,
          line: link.line,
          artifactId: document.id,
          message: `Link target ${link.target} has no heading anchor "${fragment}"`,
          target: link.target,
          repair: "manual",
        }));
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// External link checks (opt-in)
// ---------------------------------------------------------------------------

const EXTERNAL_FETCH_TIMEOUT_MS = 8000;
const EXTERNAL_CONCURRENCY = 4;

type ExternalStatus = "ok" | "broken" | "redirect" | "unverifiable";

async function probeExternal(url: string): Promise<{ status: ExternalStatus; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "doc-status-link-check" },
    });
    if (response.status === 404 || response.status === 410) {
      return { status: "broken", detail: `HTTP ${response.status}` };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location") ?? "";
      return { status: "redirect", detail: `HTTP ${response.status} -> ${location}` };
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return { status: "unverifiable", detail: `HTTP ${response.status}` };
    }
    if (response.status >= 200 && response.status < 400) {
      return { status: "ok", detail: `HTTP ${response.status}` };
    }
    return { status: "unverifiable", detail: `HTTP ${response.status}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unverifiable", detail: message };
  } finally {
    clearTimeout(timer);
  }
}

async function lintExternalLinks(model: DocumentRepository, scope: LintScope): Promise<Finding[]> {
  const urls = new Map<string, { document: RepositoryDocument; line?: number }[]>();
  const collect = (document: RepositoryDocument, target: string, line?: number) => {
    if (!/^https?:\/\//i.test(target.trim())) return;
    const entries = urls.get(target) ?? [];
    entries.push({ document, line });
    urls.set(target, entries);
  };
  for (const document of scope.documents) {
    for (const link of document.links) {
      collect(document, link.target, link.line);
    }
    for (const source of document.relations.source ?? []) {
      collect(document, source.trim());
    }
  }

  const findings: Finding[] = [];
  const entries = [...urls.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (let index = 0; index < entries.length; index += EXTERNAL_CONCURRENCY) {
    const batch = entries.slice(index, index + EXTERNAL_CONCURRENCY);
    const results = await Promise.all(batch.map(([url]) => probeExternal(url)));
    for (let i = 0; i < batch.length; i += 1) {
      const [url, occurrences] = batch[i];
      const result = results[i];
      for (const occurrence of occurrences) {
        if (result.status === "ok") continue;
        findings.push(finding({
          ruleId: result.status === "broken"
            ? "external-link-broken"
            : result.status === "redirect"
              ? "external-link-redirect"
              : "external-link-unverifiable",
          category: "link",
          severity: result.status === "broken" ? "error" : result.status === "redirect" ? "warning" : "info",
          path: occurrence.document.path,
          line: occurrence.line,
          artifactId: occurrence.document.id,
          message: `External link ${url}: ${result.detail}`,
          target: url,
          repair: "manual",
        }));
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

// `includeIndexLinks` controls whether links contributed by index files count
// toward inbound reachability. The index is a generated view of the canonical
// graph; the artifact profile excludes its links so a document reachable only
// through the index still reads as navigation-orphaned (Issue #195).
function inboundLinkCounts(
  model: DocumentRepository,
  options: { includeIndexLinks?: boolean } = {},
): Map<string, number> {
  const includeIndexLinks = options.includeIndexLinks ?? true;
  const counts = new Map<string, number>();
  for (const source of model.files) {
    if (!includeIndexLinks && source.kind === "index") continue;
    const seen = new Set<string>();
    for (const link of source.links) {
      if (link.isImage || isExternalReference(link.target)) continue;
      const resolved = model.resolvePath(source, link.target);
      if (resolved.status === "resolved" && resolved.path && resolved.path !== source.path) {
        seen.add(resolved.path);
      }
    }
    for (const target of seen) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

// Inbound counts are computed per logical artifact: localized siblings share
// one identity, so a relation declared by `foo.md` and re-declared by
// `foo.ja.md` counts once, and sibling-to-sibling links are not inbound.
function inboundRelationCounts(model: DocumentRepository): Map<string, number> {
  const bySourceArtifact = new Map<string, Set<string>>();
  for (const source of model.files) {
    if (source.kind === "index") continue;
    const sourceKey = artifactKeyOf(source.path);
    const targets = bySourceArtifact.get(sourceKey) ?? new Set<string>();
    for (const relationTargets of Object.values(source.relations)) {
      for (const target of relationTargets) {
        const resolved = model.resolveRelationTarget(source, target);
        if (resolved.status === "resolved"
          && resolved.document !== null
          && !model.sameLogicalArtifact(resolved.document.path, source.path)) {
          targets.add(artifactKeyOf(resolved.document.path));
        }
      }
    }
    bySourceArtifact.set(sourceKey, targets);
  }
  const counts = new Map<string, number>();
  for (const targets of bySourceArtifact.values()) {
    for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

function lintOrphans(
  model: DocumentRepository,
  scope: LintScope,
  profile: AuditProfile = "materialized",
): Finding[] {
  const findings: Finding[] = [];
  const linkCounts = inboundLinkCounts(model, { includeIndexLinks: profile !== "artifact" });
  const relationCounts = inboundRelationCounts(model);
  const contract = contractForType(scope.type);
  const severity = contract?.allowsRootArtifact ? "info" : "warning";
  const hasIndex = model.files.some((file) =>
    file.kind === "index" && normalizeDir(path.posix.dirname(file.path)) === scope.directory);

  for (const document of scope.documents) {
    if (document.parseError) continue;
    if (profile !== "artifact" && hasIndex && document.indexMembership.length === 0) {
      findings.push(finding({
        ruleId: "orphan-index",
        category: "orphan",
        severity,
        path: document.path,
        artifactId: document.id,
        message: `Document is not listed in the directory index: ${document.path}`,
        target: document.path,
        repair: "safe",
      }));
    }
    if ((linkCounts.get(document.path) ?? 0) === 0) {
      findings.push(finding({
        ruleId: "orphan-navigation",
        category: "orphan",
        severity,
        path: document.path,
        artifactId: document.id,
        message: `Document is not reachable from any Markdown link: ${document.path}`,
        target: document.path,
        repair: "manual",
      }));
    }
    const outgoing = Object.values(document.relations).some((targets) =>
      targets.some((target) => {
        const resolved = model.resolveRelationTarget(document, target);
        return resolved.status === "resolved"
          && resolved.document !== null
          && !model.sameLogicalArtifact(resolved.document.path, document.path);
      }));
    if (!outgoing && (relationCounts.get(artifactKeyOf(document.path)) ?? 0) === 0) {
      findings.push(finding({
        ruleId: "orphan-relation",
        category: "orphan",
        severity,
        path: document.path,
        artifactId: document.id,
        message: `Document has no semantic relations in either direction: ${document.path}`,
        target: document.path,
        repair: "manual",
      }));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Index consistency
// ---------------------------------------------------------------------------

function lintIndexConsistency(model: DocumentRepository, scope: LintScope, index: RepositoryDocument): Finding[] {
  const findings: Finding[] = [];
  if (index.parseError) {
    findings.push(finding({
      ruleId: "index-unparseable",
      category: "index",
      severity: "error",
      path: index.path,
      message: `Index front matter is not valid YAML: ${index.parseError}`,
      target: index.path,
      repair: "manual",
    }));
    return findings;
  }

  const seen = new Set<string>();
  const layout = parseManagedIndexLayout(index.body);
  const indexDir = normalizeDir(path.posix.dirname(index.path));
  const residentTypes = residentTypesForDir(indexDir);
  const indexPrimaryType = primaryIndexTypeForDir(
    indexDir,
    residentTypes.length > 0 ? residentTypes : [scope.type],
  );
  let lineOffset = 0;
  try {
    lineOffset = frontMatterEndLine(fs.readFileSync(path.join(model.root, index.path), "utf8"));
  } catch {
    lineOffset = 0;
  }

  // Structural anomalies are managed-layout violations: only indexes that
  // opted in via the generated marker get them — a hand-curated index keeps
  // its own sections (Issue #189).
  const structural = (message: string, line?: number): void => {
    findings.push(finding({
      ruleId: "index-unparseable",
      category: "index",
      severity: "warning",
      path: index.path,
      line: line !== undefined ? line + lineOffset : undefined,
      message,
      target: index.path,
      repair: "safe",
    }));
  };
  if (layout.generated) {
    if (layout.settledHeadings > 1) {
      structural(`Index declares ## Settled ${layout.settledHeadings} times; expected at most one`);
    }
    if (layout.unmarkedSettledHeadings > 0) {
      structural("Index has a ## Settled heading without the managed settled-index marker");
    }
    for (const table of layout.unknownSectionTables) {
      structural(`Index has a table under unrecognized heading: ${table.heading}`, table.line);
    }
    for (const table of layout.extraTables) {
      structural(`Index has more than one table in the ${table.tier} section`, table.line);
    }
  }

  for (const item of layout.malformed) {
    findings.push(finding({
      ruleId: "index-unparseable",
      category: "index",
      severity: "warning",
      path: index.path,
      line: item.line + lineOffset,
      message: `Index entry is not a parseable table row: ${item.text}`,
      target: index.path,
      repair: "safe",
    }));
  }

  // Resolved row files per physical tier — ordering is checked inside each
  // tier, mirroring renderIndexBody's per-tier sort (Issue #189). The legacy
  // flat formula (in-flight rows then settled rows, each file-lexical, with
  // overview.md first for design scopes — Issue #162) still applies to
  // non-generated indexes.
  const tierFiles: Record<Exclude<IndexRowTier, "unknown">, string[]> = { active: [], settled: [] };
  const rowFiles: { file: string; settled: boolean }[] = [];

  for (const placed of layout.rows) {
    const row = placed.row;
    const resolved = model.resolvePath(index, row.file);
    if (resolved.status === "escaped") {
      findings.push(finding({
        ruleId: "index-escapes-root",
        category: "index",
        severity: "error",
        path: index.path,
        message: `Index entry escapes the repository root: ${row.file}`,
        target: row.file,
        repair: "manual",
      }));
      continue;
    }
    if (resolved.status !== "resolved" || !resolved.path) {
      findings.push(finding({
        ruleId: "index-stale-entry",
        category: "index",
        severity: "warning",
        path: index.path,
        message: `Index links a missing file: ${row.file}`,
        target: row.file,
        repair: "safe",
      }));
      continue;
    }
    if (seen.has(resolved.path)) {
      findings.push(finding({
        ruleId: "index-duplicate-entry",
        category: "index",
        severity: "warning",
        path: index.path,
        message: `Index links ${row.file} more than once`,
        target: row.file,
        repair: "safe",
      }));
    }
    seen.add(resolved.path);
    const member = model.byPath.get(resolved.path);
    const settled = member ? isSettledStatus(member.type ?? indexPrimaryType, member.status) : false;
    rowFiles.push({ file: path.posix.basename(resolved.path), settled });
    if (placed.tier !== "unknown") tierFiles[placed.tier].push(path.posix.basename(resolved.path));

    if (member && member.kind === "canonical") {
      const expected: [string, string | null][] = [
        ["id", member.id],
        ["title", member.title],
        ["status", member.status],
      ];
      for (const [field, value] of expected) {
        if (value === null) continue;
        const actual = field === "id" ? row.id : field === "title" ? row.title : row.status;
        if (actual !== value) {
          findings.push(finding({
            ruleId: "index-metadata-mismatch",
            category: "index",
            severity: "warning",
            path: index.path,
            artifactId: member.id,
            message: `Index row for ${row.file} has ${field} "${actual}", expected "${value}"`,
            target: row.file,
            repair: "safe",
          }));
        }
      }
      // Settled comes from the SOURCE document's front matter; the tier comes
      // from the row's PHYSICAL table — that comparison is the point of #189.
      if (layout.generated && placed.tier !== "unknown" && (placed.tier === "settled") !== settled) {
        findings.push(finding({
          ruleId: "index-tier-mismatch",
          category: "index",
          severity: "warning",
          path: index.path,
          line: placed.line + lineOffset,
          artifactId: member.id,
          message: settled
            ? `Index lists settled document ${row.file} in the active table`
            : `Index lists in-flight document ${row.file} in the settled table`,
          target: row.file,
          repair: "safe",
        }));
      }
    }
  }

  const compareGroup = (left: string, right: string): number => {
    if (scope.type === "design") {
      if (left === "overview.md") return -1;
      if (right === "overview.md") return 1;
    }
    return left.localeCompare(right);
  };
  let misordered: boolean;
  if (layout.generated) {
    misordered = (["active", "settled"] as const).some((tier) => {
      const files = tierFiles[tier];
      const expected = [...files].sort(compareGroup);
      return files.length > 1 && files.some((file, i) => file !== expected[i]);
    });
  } else {
    const expected = [
      ...rowFiles.filter((entry) => !entry.settled).map((entry) => entry.file).sort(compareGroup),
      ...rowFiles.filter((entry) => entry.settled).map((entry) => entry.file).sort(compareGroup),
    ];
    const actual = rowFiles.map((entry) => entry.file);
    misordered = actual.length > 1 && actual.some((file, i) => file !== expected[i]);
  }
  if (misordered) {
    findings.push(finding({
      ruleId: "index-ordering",
      category: "index",
      severity: "info",
      path: index.path,
      message: "Index entries are not in the deterministic ordering rule",
      target: index.path,
      repair: "safe",
    }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function lintStructure(
  model: DocumentRepository,
  scope: LintScope,
  profile: AuditProfile = "materialized",
): Finding[] {
  const dir = scope.directory;
  const indexCandidates = model.files.filter((file) =>
    normalizeDir(path.posix.dirname(file.path)) === dir
    && /^(readme|index)\.md$/i.test(path.posix.basename(file.path)));
  const index = indexCandidates.find((file) => /^readme\.md$/i.test(path.posix.basename(file.path)))
    ?? indexCandidates[0];

  const findings = [
    ...lintDocumentLinks(model, scope),
    ...lintOrphans(model, scope, profile),
  ];
  if (index && profile !== "artifact") findings.push(...lintIndexConsistency(model, scope, index));
  return findings;
}

export {
  inboundLinkCounts,
  inboundRelationCounts,
  lintDocumentLinks,
  lintExternalLinks,
  lintIndexConsistency,
  lintOrphans,
  lintStructure,
};
