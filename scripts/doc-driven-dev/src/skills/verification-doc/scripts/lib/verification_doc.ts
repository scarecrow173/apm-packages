"use strict";

// Shared Verification Design document helpers — the script-side half of
// the Check contract (#239). `verification_checks.ts` owns the document
// schema and `knowledge_graph.ts` owns repository-wide resolution; this
// module is the intake/update boundary the CLI scripts share so create
// and update apply identical validation.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { parseDoc, resolveDocumentReferenceAll } from "../../../lib/doc_suite_utils";
import { artifactKeyOf, LOCALE_FILE_PATTERN } from "../../../lib/doc_repository";
import { isInsideCheckout } from "../../../lib/document_utils";
import { scanKnowledgeGraph, resolveClaimReference } from "../../../lib/knowledge_graph";
import type { KnowledgeGraph } from "../../../lib/knowledge_graph";
import { canonicalCheck, checkIdOrdinal, parseCheckInput } from "../../../lib/verification_checks";
import type { VerificationCheckV1 } from "../../../lib/verification_checks";

type LoadedVerificationDoc = {
  // Checkout-absolute path of the design document.
  fullPath: string;
  // Repo-relative path for messages.
  file: string;
  // Parsed front matter — mutated in place by update operations.
  data: Record<string, unknown>;
  // Parsed body — written back verbatim.
  body: string;
};

function isCheckEntry(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

// The representative file of one logical artifact — the non-localized
// document (`foo.md` over `foo.ja.md`), the same primary rule the
// repository model applies. Writes always target the primary so a mirror
// file's `checks:` can never diverge from the canonical one.
function primaryFileOf(candidates: string[]): string {
  const nonLocalized = candidates.filter((full) => !LOCALE_FILE_PATTERN.test(path.basename(full)));
  const pool = nonLocalized.length > 0 ? nonLocalized : candidates;
  return [...pool].sort()[0];
}

// A ref that lands on a locale sibling still resolves to the artifact's
// primary file when the non-localized document exists on disk — by id or
// by path, the write boundary never mutates a mirror file while its
// canonical sibling stands (the .ja.md-write drift finding, Issue #239).
function artifactPrimaryPath(full: string): string {
  const locale = LOCALE_FILE_PATTERN.exec(path.basename(full));
  if (!locale) return full;
  const sibling = path.join(path.dirname(full), `${locale[1]}.md`);
  return fs.existsSync(sibling) ? sibling : full;
}

// Resolve a verification-document reference (path or `VD-<id>`) to the
// canonical file of its artifact. An id match is grouped into logical
// artifacts the way the repository model groups locale siblings: one
// artifact resolves to its primary file; an id naming several distinct
// artifacts is ambiguous and refuses instead of silently first-matching —
// `design.ja.md` sorting before `design.md` must never pick the write
// target.
function resolveVerificationDocPath(cwd: string, ref: string, flag: string): string {
  const matches = resolveDocumentReferenceAll(cwd, ref);
  if (matches.length === 0) {
    throw new Error(`${flag} does not resolve to a document: ${ref}`);
  }
  const groups = new Map<string, string[]>();
  for (const full of matches) {
    const key = artifactKeyOf(path.relative(cwd, full).replace(/\\/g, "/"));
    const bucket = groups.get(key) ?? [];
    bucket.push(full);
    groups.set(key, bucket);
  }
  if (groups.size > 1) {
    const candidates = [...groups.values()]
      .map((group) => path.relative(cwd, primaryFileOf(group)).replace(/\\/g, "/"))
      .sort();
    throw new Error(
      `${flag} id is ambiguous — it names ${groups.size} distinct documents: ${candidates.join(", ")} (disambiguate by path): ${ref}`,
    );
  }
  return artifactPrimaryPath(primaryFileOf([...groups.values()][0]));
}

// Resolve `--doc <ref>` to a live verification document. The ref accepts a
// repo-relative path or the `VD-<id>` front-matter id — the same resolution
// boundary relate_adr uses — and fails closed on anything that does not
// resolve inside the checkout to `type: verification`.
function resolveVerificationDoc(cwd: string, ref: string): LoadedVerificationDoc {
  const resolved = resolveVerificationDocPath(cwd, ref, "--doc");
  if (!isInsideCheckout(cwd, resolved)) {
    throw new Error(`--doc resolves outside the checkout: ${ref}`);
  }
  const content = fs.readFileSync(resolved, "utf8");
  const parsed = parseDoc(content);
  if (parsed.error) {
    throw new Error(`--doc target has unparseable front matter: ${ref} (${parsed.error})`);
  }
  if (parsed.data.type !== "verification") {
    throw new Error(`--doc must reference a verification design (type: verification), got type ${JSON.stringify(parsed.data.type ?? null)}: ${ref}`);
  }
  return {
    fullPath: resolved,
    file: path.relative(cwd, resolved).replace(/\\/g, "/"),
    data: parsed.data,
    body: parsed.body,
  };
}

// The check ids already declared in a document's raw `checks:` value —
// tolerant shape inspection only; malformed entries contribute no id and
// stay for the owning parser/lint to flag.
function existingCheckIds(checksValue: unknown): string[] {
  if (!Array.isArray(checksValue)) return [];
  return checksValue
    .filter(isCheckEntry)
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
}

// Validate `--check '<json>'` payloads into fully typed checks. Every
// payload must parse and satisfy the complete VerificationCheckV1 schema
// — a payload with issues refuses the whole invocation before any file is
// touched. Ids supplied by the caller are validated for uniqueness; idless
// payloads allocate the next CHK-NN past the document's high-water mark —
// `options.highWater` is the greatest CHK ordinal ever declared or
// allocated (the persisted `checkHighWater` field plus every id declared
// pre-mutation), so a removed check's id is never reissued, not even the
// highest one (`--remove-check CHK-02 --check …` on [01, 02] mints
// CHK-03, not a different check reusing CHK-02). Under `allowExistingIds`
// (the update path's upsert semantics) a payload may name a `takenIds`
// id — it replaces that check in place; two payloads sharing one id in a
// single invocation still conflict. The returned `highWater` covers every
// id the batch touched — explicit payloads raise it too, so a later
// removal cannot make a caller-minted id reissuable.
function assembleChecks(
  rawPayloads: string[],
  takenIds: string[],
  options?: { allowExistingIds?: boolean; highWater?: number },
): { checks: VerificationCheckV1[]; error: string | null; highWater: number } {
  const checks: VerificationCheckV1[] = [];
  const taken = new Set(takenIds);
  const batchIds = new Set<string>();
  let highWater = Math.max(options?.highWater ?? 0, ...takenIds.map(checkIdOrdinal), 0);
  for (const raw of rawPayloads) {
    const { check, issues } = parseCheckInput(raw);
    if (!check) {
      return { checks: [], error: issues.map((issue) => issue.message).join("\n"), highWater };
    }
    if (check.id !== "") {
      const exists = taken.has(check.id);
      if (batchIds.has(check.id) || (exists && !options?.allowExistingIds)) {
        return { checks: [], error: `Check id ${check.id} is already declared — check ids must be unique within the document`, highWater };
      }
      batchIds.add(check.id);
      highWater = Math.max(highWater, checkIdOrdinal(check.id));
    } else {
      highWater += 1;
      check.id = `CHK-${String(highWater).padStart(2, "0")}`;
      batchIds.add(check.id);
    }
    checks.push(check);
  }
  return { checks, error: null, highWater };
}

// Repository-wide validation of `checks[].target` — a check may never be
// minted or updated to target an unknown Claim ID, the same boundary the
// graph projection uses. Returns the first failure, or null when every
// target resolves to a live claim.
async function verifyCheckTargets(cwd: string, checks: VerificationCheckV1[]): Promise<{ graph: KnowledgeGraph; error: string | null }> {
  const graph = await scanKnowledgeGraph({ cwd });
  for (const check of checks) {
    const resolution = resolveClaimReference(graph, check.target);
    if (resolution.status === "resolved") continue;
    const reason = resolution.status === "invalid"
      ? "is not a qualified claim reference"
      : resolution.status === "ambiguous"
        ? "matches multiple documents"
        : resolution.status === "unresolved-document"
          ? "no document declares the target's document id"
          : `document ${resolution.node.id ?? resolution.node.path} declares no claim with that key`;
    return {
      graph,
      error: `Check ${check.id} target ${check.target} ${reason} — unknown Claim ID`,
    };
  }
  return { graph, error: null };
}

// Merge validated checks into a raw `checks:` array — the update
// operation's write path. A check whose id matches an existing entry
// replaces it in place (stable id, new design revision); unknown ids and
// freshly allocated ids append. Malformed entries (non-objects, objects
// without a string id) are preserved verbatim — lint owns their flagging,
// a check mutation must not silently launder them away. Returns the
// merged raw array; upserted entries serialize in canonical field order.
function upsertChecks(existing: unknown, updates: VerificationCheckV1[]): unknown[] {
  const base: unknown[] = Array.isArray(existing) ? [...existing] : [];
  for (const update of updates) {
    const canonical = canonicalCheck(update);
    const index = base.findIndex((entry) => isCheckEntry(entry) && entry.id === update.id);
    if (index >= 0) base[index] = canonical;
    else base.push(canonical);
  }
  return base;
}

// Remove check ids from a raw `checks:` array. A removal that names no
// declared id fails closed — silently ignoring it would hide a stale
// reference the caller believes is gone.
function removeChecks(existing: unknown, removeIds: string[]): { checks: unknown[]; error: string | null } {
  const base: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const declared = new Set(
    base.filter(isCheckEntry).map((entry) => entry.id).filter((id): id is string => typeof id === "string"),
  );
  for (const id of removeIds) {
    if (!declared.has(id)) {
      return { checks: [], error: `--remove-check ${id} names no declared check` };
    }
  }
  const drop = new Set(removeIds);
  // Malformed entries (non-objects, objects without a string id) are
  // preserved for lint to flag — removal only ever drops the ids it names.
  return {
    checks: base.filter((entry) => !isCheckEntry(entry) || typeof entry.id !== "string" || !drop.has(entry.id)),
    error: null,
  };
}

// `relations.supersedes` may only name Verification Designs — the declared
// targetTypes contract. Create and update enforce the same boundary before
// any write: unresolved refs, refs escaping the checkout, ambiguous ids,
// and wrong-typed targets all refuse.
function assertVerificationSupersedes(cwd: string, targets: string[]): void {
  for (const target of targets) {
    const resolved = resolveVerificationDocPath(cwd, target, "--supersedes");
    if (!isInsideCheckout(cwd, resolved)) {
      throw new Error(`--supersedes target resolves outside the checkout: ${target}`);
    }
    const parsed = parseDoc(fs.readFileSync(resolved, "utf8"));
    const targetType = !parsed.error && typeof parsed.data.type === "string" ? parsed.data.type : null;
    if (targetType !== "verification") {
      throw new Error(`--supersedes target resolves to type ${JSON.stringify(targetType)}, expected verification: ${target}`);
    }
  }
}

// The persisted check-id high-water mark — the greatest CHK ordinal ever
// declared or allocated in the document, kept in front matter so a removed
// tail id is never reissued. Missing or malformed values read as 0; the
// writer bumps it on every id-bearing mutation, never decrements.
function checkHighWaterOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// Serialize a mutated verification document back to disk in the same
// round-trip form relate_adr uses — front matter re-dumped, body
// preserved verbatim.
function writeVerificationDoc(doc: LoadedVerificationDoc): void {
  fs.writeFileSync(doc.fullPath, matter.stringify(doc.body, doc.data), "utf8");
}

export {
  assembleChecks,
  assertVerificationSupersedes,
  checkHighWaterOf,
  existingCheckIds,
  removeChecks,
  resolveVerificationDoc,
  upsertChecks,
  verifyCheckTargets,
  writeVerificationDoc,
};

export type { LoadedVerificationDoc };
