"use strict";

import { configFor, configs, docTypes, ephemeralConfigs, executionTypes, legacyDocTypes } from "./doc_types";
import type { DocOwner, IndexFormat } from "./doc_types";
import { normalizeDir } from "./document_utils";

// ---------------------------------------------------------------------------
// Directory ownership contract (Issues #182, #234)
// ---------------------------------------------------------------------------
// One authoritative table mapping each owned doc directory to the skill that
// owns it: which document kinds may live there, which index format it
// carries, and which entrypoints may mutate or audit it. Writers, repair
// tooling, and read-only inspectors all resolve scope through this table so
// a document type can never be created in — or audited as — a foreign
// owner's directory.
//
// Every row is DERIVED from the Document Registry (doc_types.ts): durable
// types contribute their `dirs`, execution-bound types their `formerDirs`,
// and legacy types their `formerDirs`/`scopeDirs` — plus declared owners,
// index formats/titles, mutators, and auditors. Nothing here restates a
// path or type list the registry already owns.

// `exp` is a directory-level resident kind only: experiment logs are JSONL
// without front matter and never appear in `docTypes`.
type ResidentKind = string;

type DirectoryContract = {
  dir: string;
  canonical: boolean;
  owner: DocOwner;
  residentTypes: readonly ResidentKind[];
  indexFormat: IndexFormat;
  // Canonical index title for dirs whose index is not derivable from a
  // shared type (owner formats). Aliases and title-less shared rows omit it.
  indexTitle?: string;
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
const PROMOTE_INDEX_MUTATOR = "promote_index";

function buildContracts(): DirectoryContract[] {
  type ContractRow = Omit<DirectoryContract, "residentTypes" | "mutators" | "auditors"> & {
    residents: string[];
    mutators: Set<string>;
    auditors: Set<string>;
  };
  const rows = new Map<string, ContractRow>();
  const rowFor = (dir: string, owner: DocOwner, indexFormat: IndexFormat, indexTitle?: string): ContractRow => {
    const normalized = normalizeDir(dir);
    let row = rows.get(normalized);
    if (!row) {
      row = {
        dir: normalized,
        canonical: false,
        owner,
        residents: [],
        indexFormat,
        indexTitle,
        mutators: new Set<string>(),
        auditors: new Set<string>(),
      };
      rows.set(normalized, row);
    }
    return row;
  };

  // Durable types: every declared dir is an owned shared/owner scope. Only
  // the canonical dir carries the indexTitle — alias rows share the owner
  // writer at write time but never become a scaffold/empty-index target.
  for (const type of docTypes) {
    const config = configFor(type);
    for (const dir of config.dirs) {
      const canonical = normalizeDir(dir) === normalizeDir(config.dir);
      const row = rowFor(dir, config.owner, config.indexFormat, canonical ? config.indexTitle : undefined);
      row.canonical = row.canonical || canonical;
      if (!row.residents.includes(type)) row.residents.push(type);
      if (canonical && config.indexTitle) row.mutators.add(PROMOTE_INDEX_MUTATOR);
      if (config.creator) row.mutators.add(config.creator);
      for (const mutator of DOC_SUITE_MUTATORS) row.mutators.add(mutator);
      for (const auditor of DOC_SUITE_AUDITORS) row.auditors.add(auditor);
      for (const mutator of config.mutators) row.mutators.add(mutator);
      for (const auditor of config.auditors) row.auditors.add(auditor);
    }
  }

  // Execution-bound types: their former dirs stay owned scopes (canonical
  // = first formerDir). Residents are the ephemeral kind itself — they are
  // never shared-suite residents, so shared queries reject these dirs while
  // the scope check still recognizes the dir's own kind.
  for (const type of executionTypes) {
    const entry = ephemeralConfigs[type];
    for (const dir of entry.formerDirs) {
      const row = rowFor(dir, entry.owner, entry.indexFormat);
      row.canonical = row.canonical || dir === entry.formerDirs[0];
      if (!row.residents.includes(type)) row.residents.push(type);
      for (const mutator of DOC_SUITE_MUTATORS) row.mutators.add(mutator);
      for (const auditor of DOC_SUITE_AUDITORS) row.auditors.add(auditor);
      for (const mutator of entry.mutators) row.mutators.add(mutator);
      for (const auditor of entry.auditors) row.auditors.add(auditor);
    }
  }

  // Legacy types: formerDirs plus scopeDirs (zero-resident containers such
  // as docs/impl, which is itself an owned scope so `--dir docs/impl`
  // cannot smuggle a shared-suite operation in).
  for (const entry of Object.values(legacyDocTypes)) {
    for (const dir of entry.scopeDirs) {
      const row = rowFor(dir, entry.owner, "none");
      row.canonical = true;
    }
    for (const dir of entry.formerDirs) {
      const canonical = dir === entry.formerDirs[0];
      const row = rowFor(dir, entry.owner, entry.indexFormat, canonical ? entry.indexTitle : undefined);
      row.canonical = row.canonical || canonical;
      if (!row.residents.includes(entry.type)) row.residents.push(entry.type);
      if (canonical && entry.indexTitle) row.mutators.add(PROMOTE_INDEX_MUTATOR);
      for (const mutator of entry.mutators) row.mutators.add(mutator);
      for (const auditor of entry.auditors) row.auditors.add(auditor);
    }
  }

  return [...rows.values()].map((row) => ({
    dir: row.dir,
    canonical: row.canonical,
    owner: row.owner,
    residentTypes: row.residents,
    indexFormat: row.indexFormat,
    indexTitle: row.indexTitle,
    mutators: [...row.mutators].sort(),
    auditors: [...row.auditors].sort(),
  })).sort((a, b) => a.dir.localeCompare(b.dir));
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
// with `docTypes`, or every shared type when the dir is unclaimed.
// Execution-bound and legacy kinds never leak into shared-suite query
// scopes.
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
// `Unknown document type` error; execution-bound and legacy names raise the
// registry's dedicated error.
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
    throw new Error(`Scope mismatch: no shared-suite document types are resident in ${describeOwnership(directory)} — migration-owned dirs are audited only by migration tooling; run doc_maintenance.js migrate plan --json`);
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
