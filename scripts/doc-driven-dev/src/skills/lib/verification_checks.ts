"use strict";

// ---------------------------------------------------------------------------
// Verification Design v1 — the Check contract (Issue #239)
// ---------------------------------------------------------------------------
//
// A Verification Design document (`type: verification` under
// `docs/verification/`) records durable verification *intent*: what must
// hold, against which claim, verified by which method. It never records
// outcomes — measured results are immutable Evidence Records (#240), and
// coverage assessment is Evidence Assessment (#241).
//
// The durable datum is the top-level front-matter `checks:` array. Each
// entry is a `VerificationCheckV1`:
//
//   id             — document-local stable check key `CHK-<digits>`,
//                    unique inside the design document. The fully qualified
//                    check reference is `<VD id>::<CHK-NN>` — the same
//                    `<document-id>::<KEY>` grammar claims use, so
//                    `VD-<id>::CHK-01` resolves identically everywhere.
//   target         — the sole Check→Claim authority: a qualified claim
//                    reference `<document-id>::<claim-key>` (e.g.
//                    `SPEC-<id>::R-01`). `relations.checks` is never stored;
//                    the graph derives `checks`/`checked-by` edges from this
//                    field alone.
//   method         — the verification method discriminant (one of
//                    VERIFICATION_METHODS).
//   implementation — how the check is realized (test name, proof script,
//                    monitor, review step).
//   preconditions  — conditions under which the check applies; a `required`
//                    check must declare at least one so #241 can assess
//                    applicability instead of guessing.
//   passCriteria   — the method-typed discriminated union
//                    `{ kind: <method>, <methodField>: string, ... }`. The
//                    `kind` discriminant must equal `method` — a criteria
//                    payload written for one method is never silently
//                    reinterpreted as another, and no single boolean
//                    flattens distinct verification methods.
//   limitations    — known limits of the check (blind spots, skipped
//                    platforms). May be empty, but must be present.
//   required       — boolean: `true` marks the check as a required gate for
//                    Evidence Assessment; `false` marks it advisory.
//
// The body mirrors the structure with optional `<!-- check:CHK-NN -->`
// markers that bind a check's identity to its prose position — the same
// stability contract `<!-- claim:KEY -->` gives claims. Markers outside a
// verification document, or naming checks the front matter does not
// declare, are lint findings.
//
// This module owns only the *document-local* contract: field shapes,
// vocabulary, and the canonical serialization. Cross-document resolution
// (unknown Claim IDs, ambiguous targets, edge projection) needs the
// repository-wide claim index and lives in `knowledge_graph.ts` — the same
// split the claim grammar uses.

import { createHash } from "node:crypto";

import { parseClaimReference } from "./claim_ids";

// Document-local check key: `CHK-<digits>` (`CHK-01`). Matches the claim
// key grammar's shape by design — `CHK-01` is a valid `<KEY>` — so the
// qualified form `VD-<id>::CHK-01` parses through the shared
// `<document-id>::<KEY>` boundary without a second grammar.
const CHECK_KEY_PATTERN = /^CHK-\d+$/;

// Check anchor marker in a verification document's body:
// `<!-- check:CHK-01 -->` binds a check's identity to its prose position —
// the check analogue of `<!-- claim:KEY -->`. The qualified form
// `<!-- check:DOC-ID::CHK-01 -->` declares identity inside the named
// document only; a mismatched qualifier is a finding, never an adoption.
const CHECK_MARKER_PATTERN = /<!--\s*check\s*:(.*?)-->/g;

// The verification methods Verification Design v1 admits — the `method`
// discriminant and the `passCriteria.kind` vocabulary.
const VERIFICATION_METHODS = [
  "unit",
  "integration",
  "e2e",
  "property",
  "static",
  "model-checking",
  "formal-proof",
  "runtime-monitoring",
  "manual-review",
] as const;

type VerificationMethod = typeof VERIFICATION_METHODS[number];

// Each method's passCriteria variant carries one required, method-specific
// string field — the typed criterion that keeps distinct verification
// methods from collapsing into a shared pass flag. `kind` is the
// discriminant and must equal `method`.
const METHOD_CRITERIA_FIELDS: Record<VerificationMethod, string> = {
  unit: "expect",
  integration: "expect",
  e2e: "expect",
  property: "invariant",
  static: "rule",
  "model-checking": "property",
  "formal-proof": "theorem",
  "runtime-monitoring": "signal",
  "manual-review": "checklistItem",
};

type VerificationPassCriteria = { kind: VerificationMethod } & Record<string, unknown>;

type VerificationCheckV1 = {
  id: string;
  target: string;
  method: VerificationMethod;
  implementation: string;
  preconditions: string[];
  passCriteria: VerificationPassCriteria;
  limitations: string[];
  required: boolean;
};

// Document-local check findings. `knowledge_graph.ts` widens
// VerificationCheckIssueCode into KnowledgeGraphIssueCode one-to-one, so
// every code here is already a graph/lint vocabulary member; `target`
// carries the offending value (check id, field name, or raw input) and
// `index` the checks[] position when one exists.
type VerificationCheckIssueCode =
  | "malformed-checks"
  | "malformed-check-entry"
  | "missing-check-field"
  | "invalid-check-id"
  | "duplicate-check"
  | "invalid-check-target"
  | "invalid-check-method"
  | "check-criteria-mismatch"
  | "incomplete-required-check";

type VerificationCheckIssue = {
  code: VerificationCheckIssueCode;
  index: number | null;
  target: string | null;
  message: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string");
  if (items.length !== value.length) return null;
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function checkLabel(index: number, id: unknown): string {
  return typeof id === "string" && id ? `check ${id}` : `checks[${index}]`;
}

// Structural validation of one checks[] entry. Returns a fully typed
// VerificationCheckV1 or a list of issues — never a partial check. `id` is
// optional only when `allowMissingId` is set (script intake allocates
// CHK-NN after validation); the document contract always requires it. A
// missing-but-allowed id comes back as "".
function validateCheckEntry(
  entry: unknown,
  index: number,
  allowMissingId: boolean,
): { check: VerificationCheckV1 | null; issues: VerificationCheckIssue[] } {
  const issues: VerificationCheckIssue[] = [];
  if (!isPlainObject(entry)) {
    issues.push({
      code: "malformed-check-entry",
      index,
      target: null,
      message: `checks[${index}] is not a verification check object (expected id/target/method/implementation/preconditions/passCriteria/limitations/required)`,
    });
    return { check: null, issues };
  }

  const missing = (field: string): void => {
    issues.push({
      code: "missing-check-field",
      index,
      target: field,
      message: `${checkLabel(index, entry.id)} is missing required check field: ${field}`,
    });
  };

  // --- id ---
  let id: string | null = null;
  if (entry.id === undefined || entry.id === null) {
    if (!allowMissingId) missing("id");
  } else if (!nonEmptyString(entry.id) || !CHECK_KEY_PATTERN.test(entry.id.trim())) {
    issues.push({
      code: "invalid-check-id",
      index,
      target: String(entry.id),
      message: `checks[${index}].id must be a stable check key matching CHK-<digits> (e.g. CHK-01), got ${JSON.stringify(entry.id)}`,
    });
  } else {
    id = entry.id.trim();
  }

  // --- target ---
  let target: string | null = null;
  if (!nonEmptyString(entry.target)) {
    missing("target");
  } else if (parseClaimReference(entry.target.trim()) === null) {
    issues.push({
      code: "invalid-check-target",
      index,
      target: entry.target.trim(),
      message: `checks[${index}].target must be a qualified claim reference <document-id>::<KEY> (e.g. SPEC-<id>::R-01), got ${JSON.stringify(entry.target)}`,
    });
  } else {
    target = entry.target.trim();
  }

  // --- method ---
  let method: VerificationMethod | null = null;
  if (!nonEmptyString(entry.method)) {
    missing("method");
  } else if (!(VERIFICATION_METHODS as readonly string[]).includes(entry.method.trim())) {
    issues.push({
      code: "invalid-check-method",
      index,
      target: entry.method.trim(),
      message: `checks[${index}].method must be one of: ${VERIFICATION_METHODS.join(", ")} — got ${JSON.stringify(entry.method)}`,
    });
  } else {
    method = entry.method.trim() as VerificationMethod;
  }

  // --- implementation ---
  let implementation: string | null = null;
  if (!nonEmptyString(entry.implementation)) {
    missing("implementation");
  } else {
    implementation = entry.implementation.trim();
  }

  // --- preconditions / limitations ---
  let preconditions: string[] | null = null;
  if (!Array.isArray(entry.preconditions)) {
    missing("preconditions");
  } else {
    preconditions = stringList(entry.preconditions);
    if (preconditions === null) {
      issues.push({
        code: "missing-check-field",
        index,
        target: "preconditions",
        message: `${checkLabel(index, entry.id)} field preconditions must be a list of strings`,
      });
    }
  }

  let limitations: string[] | null = null;
  if (!Array.isArray(entry.limitations)) {
    missing("limitations");
  } else {
    limitations = stringList(entry.limitations);
    if (limitations === null) {
      issues.push({
        code: "missing-check-field",
        index,
        target: "limitations",
        message: `${checkLabel(index, entry.id)} field limitations must be a list of strings`,
      });
    }
  }

  // --- required ---
  let required: boolean | null = null;
  if (typeof entry.required !== "boolean") {
    missing("required");
  } else {
    required = entry.required;
  }

  // --- passCriteria ---
  let passCriteria: VerificationPassCriteria | null = null;
  const criteria = entry.passCriteria;
  if (!isPlainObject(criteria)) {
    missing("passCriteria");
  } else if (typeof criteria.kind !== "string" || !(VERIFICATION_METHODS as readonly string[]).includes(criteria.kind)) {
    issues.push({
      code: "check-criteria-mismatch",
      index,
      target: typeof criteria.kind === "string" ? criteria.kind : null,
      message: `checks[${index}].passCriteria.kind must be one of: ${VERIFICATION_METHODS.join(", ")}`,
    });
  } else if (method !== null && criteria.kind !== method) {
    issues.push({
      code: "check-criteria-mismatch",
      index,
      target: String(criteria.kind),
      message: `checks[${index}].passCriteria.kind "${String(criteria.kind)}" contradicts method "${method}" — the criteria variant must match the declared method`,
    });
  } else {
    const kind = criteria.kind as VerificationMethod;
    const field = METHOD_CRITERIA_FIELDS[kind];
    if (!nonEmptyString(criteria[field])) {
      issues.push({
        code: "check-criteria-mismatch",
        index,
        target: field,
        message: `checks[${index}].passCriteria for method ${kind} requires a non-empty "${field}" criterion`,
      });
    } else {
      passCriteria = criteria as VerificationPassCriteria;
    }
  }

  // --- required completeness ---
  if (required === true && (preconditions === null || preconditions.length === 0)) {
    issues.push({
      code: "incomplete-required-check",
      index,
      target: id,
      message: `${checkLabel(index, entry.id)} is marked required but declares no preconditions — a required check must state when it applies so assessment can judge applicability`,
    });
  }

  if (issues.length > 0) return { check: null, issues };
  return {
    check: {
      id: id ?? "",
      target: target as string,
      method: method as VerificationMethod,
      implementation: implementation as string,
      preconditions: preconditions as string[],
      passCriteria: passCriteria as VerificationPassCriteria,
      limitations: limitations as string[],
      required: required as boolean,
    },
    issues,
  };
}

// Parse a document's `checks:` front-matter value into typed checks.
// Entries that fail structural validation produce issues and no check;
// only fully valid VerificationCheckV1 entries are returned, so the graph
// never projects a malformed check. Claim existence is not checked here —
// it needs the repository claim index (knowledge_graph).
function parseVerificationChecks(value: unknown): { checks: VerificationCheckV1[]; issues: VerificationCheckIssue[] } {
  const issues: VerificationCheckIssue[] = [];
  if (value === undefined || value === null) return { checks: [], issues };
  if (!Array.isArray(value)) {
    issues.push({
      code: "malformed-checks",
      index: null,
      target: null,
      message: "checks must be a list of VerificationCheckV1 entries",
    });
    return { checks: [], issues };
  }
  const checks: VerificationCheckV1[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < value.length; index += 1) {
    const { check, issues: entryIssues } = validateCheckEntry(value[index], index, false);
    issues.push(...entryIssues);
    if (!check) continue;
    const first = seen.get(check.id);
    if (first !== undefined) {
      issues.push({
        code: "duplicate-check",
        index,
        target: check.id,
        message: `Check id ${check.id} is declared more than once (first at checks[${first}]) — check ids must be unique and stable within the document`,
      });
      continue;
    }
    seen.set(check.id, index);
    checks.push(check);
  }
  return { checks, issues };
}

// CLI intake for one check payload (`--check '<json>'`). The id may be
// omitted: the caller allocates it with nextCheckId ("" marks "no id
// supplied"; a supplied id is validated and returned). Returns a fully
// validated check, or issues — never a partial check.
function parseCheckInput(raw: string): { check: VerificationCheckV1 | null; issues: VerificationCheckIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    return {
      check: null,
      issues: [{
        code: "malformed-check-entry",
        index: null,
        target: null,
        message: `--check is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
  return validateCheckEntry(value, 0, true);
}

// The canonical key order a check serializes in — creation, update, and
// revision hashing all emit this shape so the durable form is stable.
function canonicalCheck(check: VerificationCheckV1): Record<string, unknown> {
  return {
    id: check.id,
    target: check.target,
    method: check.method,
    implementation: check.implementation,
    preconditions: check.preconditions,
    passCriteria: check.passCriteria,
    limitations: check.limitations,
    required: check.required,
  };
}

// The check's design revision: a content digest of its canonical payload.
// Evidence Records (#240) pin this value so an outcome measured against a
// since-edited check is detectable without diffing documents.
function checkDesignRevision(check: VerificationCheckV1): string {
  const canonical = JSON.stringify(canonicalCheck(check));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// Next unallocated CHK-NN for a document — the smallest unused number at
// least one greater than the highest declared suffix, zero-padded to two
// digits. Ids are never renumbered: allocation only appends.
function nextCheckId(existingIds: readonly string[]): string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^CHK-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  const next = highest + 1;
  return `CHK-${String(next).padStart(2, "0")}`;
}

function isVerificationMethod(value: string): value is VerificationMethod {
  return (VERIFICATION_METHODS as readonly string[]).includes(value);
}

export {
  canonicalCheck,
  CHECK_KEY_PATTERN,
  CHECK_MARKER_PATTERN,
  checkDesignRevision,
  isVerificationMethod,
  METHOD_CRITERIA_FIELDS,
  nextCheckId,
  parseCheckInput,
  parseVerificationChecks,
  VERIFICATION_METHODS,
};

export type {
  VerificationCheckIssue,
  VerificationCheckIssueCode,
  VerificationCheckV1,
  VerificationMethod,
  VerificationPassCriteria,
};
