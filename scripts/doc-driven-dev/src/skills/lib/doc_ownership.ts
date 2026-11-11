"use strict";

import { configFor, docTypes } from "./doc_types";
import { normalizeDir } from "./document_utils";

// ---------------------------------------------------------------------------
// Directory ownership contract (Issue #182)
// ---------------------------------------------------------------------------
// One authoritative table mapping each owned doc directory to the skill that
// owns it: which document kinds may live there, which index format it
// carries, and which entrypoints may mutate or audit it. Writers, repair
// tooling, and read-only inspectors all resolve scope through this table so
// a document type can never be created in — or audited as — a foreign
// owner's directory.
//
// The shared-suite rows are DERIVED from `configs` (doc_types.ts): alias
// lists already live there, so this module unions per-type rows into
// per-directory rows (docs/discovery -> brainstorm + discovery) instead of
// restating paths. impl-doc territory is declared literally because no
// shared config describes it.

type DocOwner = "doc-suite" | "adr-doc" | "impl-doc";

type IndexFormat = "shared-4col" | "impl-4col" | "exp-1col" | "none";

// `exp` is a directory-level resident kind only: experiment logs are JSONL
// without front matter and never appear in `docTypes`.
type ResidentKind = string;

type DirectoryContract = {
  dir: string;
  canonical: boolean;
  owner: DocOwner;
  residentTypes: readonly ResidentKind[];
  indexFormat: IndexFormat;
  mutators: readonly string[];
  auditors: readonly string[];
};

type ScopeCheck = {
  ok: boolean;
  directory: string;
  ownership: DirectoryContract | null;
  reason: string | null;
};

const DOC_SUITE_MUTATORS = ["doc_maintenance", "scaffold_docs", "migrate_docs", "migrate_ids"] as const;
const DOC_SUITE_AUDITORS = ["doc_status", "audit_docs", "list_docs"] as const;
const ADR_MUTATORS = ["update_index", "relate_adr"] as const;
const ADR_AUDITORS = ["audit_adr", "review_adr", "list_adrs", "migrate_report", "check_code_links"] as const;

// `brainstorm` has no creator script: the brainstorming skill authors those
// documents directly, so it is absent here.
const SHARED_CREATORS: Record<string, string> = {
  idea: "new_idea",
  discovery: "new_discovery",
  spec: "new_spec",
  plan: "new_plan",
  task: "new_task",
  design: "new_design",
  adr: "new_adr",
  "test-spec": "new_test_spec",
};

function buildContracts(): DirectoryContract[] {
  const rows = new Map<string, {
    canonical: boolean;
    owner: DocOwner;
    residents: string[];
    mutators: Set<string>;
    auditors: Set<string>;
  }>();
  for (const type of docTypes) {
    const config = configFor(type);
    const adr = type === "adr";
    for (const dir of config.dirs) {
      const normalized = normalizeDir(dir);
      let row = rows.get(normalized);
      if (!row) {
        row = {
          canonical: false,
          owner: adr ? "adr-doc" : "doc-suite",
          residents: [],
          mutators: new Set(),
          auditors: new Set(),
        };
        rows.set(normalized, row);
      }
      row.canonical = row.canonical || normalized === normalizeDir(config.dir);
      if (!row.residents.includes(type)) row.residents.push(type);
      if (SHARED_CREATORS[type]) row.mutators.add(SHARED_CREATORS[type]);
      for (const mutator of DOC_SUITE_MUTATORS) row.mutators.add(mutator);
      for (const auditor of DOC_SUITE_AUDITORS) row.auditors.add(auditor);
      if (adr) {
        for (const mutator of ADR_MUTATORS) row.mutators.add(mutator);
        for (const auditor of ADR_AUDITORS) row.auditors.add(auditor);
      }
    }
  }
  const shared: DirectoryContract[] = [...rows.entries()].map(([dir, row]) => ({
    dir,
    canonical: row.canonical,
    owner: row.owner,
    residentTypes: row.residents,
    indexFormat: "shared-4col",
    mutators: [...row.mutators].sort(),
    auditors: [...row.auditors].sort(),
  }));
  // impl-doc territory: dedicated IR/EXP dirs plus their `docs/impl`
  // container, which is itself an owned (zero-resident) scope so
  // `--dir docs/impl` cannot smuggle a shared-suite operation in.
  const implRows: DirectoryContract[] = [
    {
      dir: "docs/impl",
      canonical: true,
      owner: "impl-doc",
      residentTypes: [],
      indexFormat: "none",
      mutators: [],
      auditors: [],
    },
    {
      dir: "docs/impl/ir",
      canonical: true,
      owner: "impl-doc",
      residentTypes: ["impl"],
      indexFormat: "impl-4col",
      mutators: ["new_impl_record", "migrate_ids"],
      auditors: ["audit_impl_record"],
    },
    {
      dir: "docs/impl/exp",
      canonical: true,
      owner: "impl-doc",
      residentTypes: ["exp"],
      indexFormat: "exp-1col",
      mutators: ["new_experiment_log", "append_experiment_event", "edit_experiment_log", "migrate_ids"],
      auditors: ["audit_experiment_log"],
    },
  ];
  return [...shared, ...implRows].sort((a, b) => a.dir.localeCompare(b.dir));
}

const DIRECTORY_CONTRACTS: readonly DirectoryContract[] = Object.freeze(buildContracts());

// Innermost owned contract containing `directory` (already normalized and
// repo-relative — callers obtain that from resolveContainedDir /
// findDocumentDir, which also realpath existing dirs so aliases and
// symlinks collapse to the owned identity). null = unclaimed custom dir.
function ownershipForDir(directory: string): DirectoryContract | null {
  const normalized = normalizeDir(directory);
  let best: DirectoryContract | null = null;
  for (const contract of DIRECTORY_CONTRACTS) {
    if (normalized === contract.dir || normalized.startsWith(`${contract.dir}/`)) {
      if (!best || contract.dir.length > best.dir.length) best = contract;
    }
  }
  return best;
}

function describeOwnership(directory: string): string {
  const normalized = normalizeDir(directory);
  const ownership = ownershipForDir(normalized);
  if (!ownership) return `custom directory "${normalized}" (no declared owner)`;
  const residents = ownership.residentTypes.length > 0 ? ownership.residentTypes.join(", ") : "none";
  return `"${ownership.dir}" (owned by ${ownership.owner}; resident types: ${residents})`;
}

// Scope verdict for placing or inspecting `type` under `directory`. An
// unclaimed dir is the established custom-dir contract and accepts any
// type; an owned dir accepts only its resident types.
function checkTypeScope(type: string, directory: string): ScopeCheck {
  const normalized = normalizeDir(directory);
  const ownership = ownershipForDir(normalized);
  if (!ownership || ownership.residentTypes.includes(type)) {
    return { ok: true, directory: normalized, ownership, reason: null };
  }
  return {
    ok: false,
    directory: normalized,
    ownership,
    reason: `Scope mismatch: type "${type}" is not resident in ${describeOwnership(normalized)}`,
  };
}

function assertTypeScope(type: string, directory: string): void {
  const check = checkTypeScope(type, directory);
  if (!check.ok) throw new Error(check.reason ?? "Scope mismatch");
}

// Shared-suite types resident in `directory`: owned residents intersected
// with `docTypes`, or every shared type when the dir is unclaimed. impl/exp
// kinds never leak into shared-suite query scopes.
function sharedTypesResidentIn(directory: string): string[] {
  const ownership = ownershipForDir(directory);
  if (!ownership) return [...docTypes];
  return ownership.residentTypes.filter((type) => (docTypes as readonly string[]).includes(type));
}

// Whether the shared doc_maintenance repair whitelist may regenerate the
// index in `directory`. Only shared-4col territory qualifies; impl-doc's
// impl-4col / exp-1col formats belong to owner tooling only.
function sharedRepairAllowed(directory: string): boolean {
  const ownership = ownershipForDir(directory);
  return !ownership || ownership.indexFormat === "shared-4col";
}

// Narrow a query's type selection to the shared-suite types actually
// resident in the explicit scope dir (`directory` = the normalized --dir,
// or null when the caller resolves each type's canonical dir instead). An
// explicit non-resident type is a caller error: it fails loudly rather
// than linting foreign documents as the wrong type or reporting an empty
// scan as a clean one (Issue #183). Unknown type names keep the existing
// `Unknown document type` error.
function scopeTypesForQuery(directory: string | null, requestedType: string | undefined): string[] {
  if (requestedType && requestedType !== "all") {
    configFor(requestedType);
    if (directory !== null && !sharedTypesResidentIn(directory).includes(requestedType)) {
      throw new Error(`Scope mismatch: type "${requestedType}" is not resident in ${describeOwnership(directory)}`);
    }
    return [requestedType];
  }
  if (directory === null) return [...docTypes];
  const residents = sharedTypesResidentIn(directory);
  if (residents.length === 0) {
    throw new Error(`Scope mismatch: no shared-suite document types are resident in ${describeOwnership(directory)}`);
  }
  return residents;
}

export {
  assertTypeScope,
  checkTypeScope,
  describeOwnership,
  DIRECTORY_CONTRACTS,
  ownershipForDir,
  scopeTypesForQuery,
  sharedRepairAllowed,
  sharedTypesResidentIn,
};
export type { DirectoryContract, DocOwner, IndexFormat, ResidentKind, ScopeCheck };
