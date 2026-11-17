"use strict";

// Shared Verification Design document helpers — the script-side half of
// the Check contract (#239). `verification_checks.ts` owns the document
// schema and `knowledge_graph.ts` owns repository-wide resolution; this
// module is the intake/update boundary the CLI scripts share so create
// and update apply identical validation.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { parseDoc, resolveDocumentReference } from "../../../lib/doc_suite_utils";
import { isInsideCheckout } from "../../../lib/document_utils";
import { scanKnowledgeGraph, resolveClaimReference } from "../../../lib/knowledge_graph";
import type { KnowledgeGraph } from "../../../lib/knowledge_graph";
import { canonicalCheck, nextCheckId, parseCheckInput } from "../../../lib/verification_checks";
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

// Resolve `--doc <ref>` to a live verification document. The ref accepts a
// repo-relative path or the `VD-<id>` front-matter id — the same resolution
// boundary relate_adr uses — and fails closed on anything that does not
// resolve inside the checkout to `type: verification`.
function resolveVerificationDoc(cwd: string, ref: string): LoadedVerificationDoc {
  const resolved = resolveDocumentReference(cwd, ref);
  if (!resolved) {
    throw new Error(`--doc does not resolve to a document: ${ref}`);
  }
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
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
}

// Validate `--check '<json>'` payloads into fully typed checks. Every
// payload must parse and satisfy the complete VerificationCheckV1 schema
// — a payload with issues refuses the whole invocation before any file is
// touched. Ids supplied by the caller are validated for uniqueness; idless
// payloads allocate the next CHK-NN after `takenIds` (existing document
// ids for updates, none for creates). Under `allowExistingIds` (the
// update path's upsert semantics) a payload may name a `takenIds` id —
// it replaces that check in place; two payloads sharing one id in a
// single invocation still conflict.
function assembleChecks(
  rawPayloads: string[],
  takenIds: string[],
  options?: { allowExistingIds?: boolean },
): { checks: VerificationCheckV1[]; error: string | null } {
  const checks: VerificationCheckV1[] = [];
  const taken = new Set(takenIds);
  const used = new Set(takenIds);
  const batchIds = new Set<string>();
  for (const raw of rawPayloads) {
    const { check, issues } = parseCheckInput(raw);
    if (!check) {
      return { checks: [], error: issues.map((issue) => issue.message).join("\n") };
    }
    if (check.id !== "") {
      const exists = taken.has(check.id);
      if (batchIds.has(check.id) || (exists && !options?.allowExistingIds)) {
        return { checks: [], error: `Check id ${check.id} is already declared — check ids must be unique within the document` };
      }
      used.add(check.id);
      batchIds.add(check.id);
    } else {
      check.id = nextCheckId([...used]);
      used.add(check.id);
      batchIds.add(check.id);
    }
    checks.push(check);
  }
  return { checks, error: null };
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
// freshly allocated ids append. Returns the merged raw array in canonical
// field order.
function upsertChecks(existing: unknown, updates: VerificationCheckV1[]): Record<string, unknown>[] {
  const base: Record<string, unknown>[] = Array.isArray(existing)
    ? existing.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
  for (const update of updates) {
    const canonical = canonicalCheck(update);
    const index = base.findIndex((entry) => entry.id === update.id);
    if (index >= 0) base[index] = canonical;
    else base.push(canonical);
  }
  return base;
}

// Remove check ids from a raw `checks:` array. A removal that names no
// declared id fails closed — silently ignoring it would hide a stale
// reference the caller believes is gone.
function removeChecks(existing: unknown, removeIds: string[]): { checks: Record<string, unknown>[]; error: string | null } {
  const base: Record<string, unknown>[] = Array.isArray(existing)
    ? existing.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
  const declared = new Set(base.map((entry) => entry.id).filter((id): id is string => typeof id === "string"));
  for (const id of removeIds) {
    if (!declared.has(id)) {
      return { checks: [], error: `--remove-check ${id} names no declared check` };
    }
  }
  const drop = new Set(removeIds);
  // Malformed entries (no string id) are preserved for lint to flag —
  // removal only ever drops the ids it names.
  return { checks: base.filter((entry) => typeof entry.id !== "string" || !drop.has(entry.id)), error: null };
}

// Serialize a mutated verification document back to disk in the same
// round-trip form relate_adr uses — front matter re-dumped, body
// preserved verbatim.
function writeVerificationDoc(doc: LoadedVerificationDoc): void {
  fs.writeFileSync(doc.fullPath, matter.stringify(doc.body, doc.data), "utf8");
}

export {
  assembleChecks,
  existingCheckIds,
  removeChecks,
  resolveVerificationDoc,
  upsertChecks,
  verifyCheckTargets,
  writeVerificationDoc,
};

export type { LoadedVerificationDoc };
