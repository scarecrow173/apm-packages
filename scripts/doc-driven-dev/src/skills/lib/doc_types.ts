"use strict";

// ---------------------------------------------------------------------------
// Document Registry 3 (Issue #234)
// ---------------------------------------------------------------------------
//
// The single authority for the doc-suite's document types. One registry
// declares, per type: persistence, canonical directory and aliases, ID
// prefix, type-specific status vocabulary, the lifecycle axis, index owner
// and format, required fields, and the allowed forward-relation vocabulary.
// Every consumer — ownership rows, repository contracts, lifecycle policy,
// scanners, creators, indexes, and the schema preflight markers — derives
// from this table instead of restating it.
//
// Persistence axis (`persistence`):
//   durable   — canonical Git-Markdown documents, the registry's normal
//               contract. IDEA / BRAINSTORM / DISCOVERY / SPEC / DESIGN /
//               ADR / KNOWLEDGE / VERIFICATION are all durable: ideas,
//               brainstorms, and discoveries are the agreed capture layer
//               that feeds the durable knowledge graph (the Persistence
//               Policy for #234: capture docs stay durable so their
//               lifecycle can carry them to promoted/settled without a
//               store hop; only execution state and outcomes leave Git).
//   ephemeral — execution-bound types whose durable Git form is removed.
//               PLAN and TASK live in the Execution Store (#236); their
//               former dirs remain declared (`formerDirs`) only so legacy
//               files are still owned, never scanned or created.
//   evidence  — reserved for Evidence Store records (#240); no registry
//               entry carries it yet.
//   derived   — reserved for materialized projections (#243); indexes and
//               dashboards are always derived views, never a type.
//
// Lifecycle axis (`lifecycle`): `draft | current | superseded | retired` —
// the document's own archival state, kept strictly separate from the
// type-specific `status` vocabulary. New durable documents are always
// written `lifecycle: "draft"`; unknown values are never admitted at
// creation and never silently coerced to `current` at read time.
//
// Legacy types (test-spec / impl / exp) are not registry entries at all:
// they have no durable form under Registry 3 and are interpreted only by
// migration tooling. `legacyDocTypes` keeps the minimal shape migration
// needs — former dirs, ID prefixes, status vocabularies — so the normal
// path never implements a legacy reader or fallback parser.

const LIFECYCLE_VALUES = ["draft", "current", "superseded", "retired"] as const;
type LifecycleValue = typeof LIFECYCLE_VALUES[number];
const DEFAULT_LIFECYCLE: LifecycleValue = "draft";

const PERSISTENCE_VALUES = ["durable", "ephemeral", "evidence", "derived"] as const;
type Persistence = typeof PERSISTENCE_VALUES[number];

type DocOwner = "doc-suite" | "adr-doc" | "impl-doc";
type IndexFormat = "shared-4col" | "impl-4col" | "exp-1col" | "none";

// A declared forward-relation rule on a durable type (Knowledge Relations
// v1 seed): `field` names a stored source→target relation the type may
// populate, `targetTypes` the durable types it may point at.
type AllowedRelation = {
  field: string;
  targetTypes: readonly string[];
};

// A required forward relation: the document must carry a resolvable target
// of one of `targetTypes` (optionally only while in `appliesToStatuses`,
// optionally excused by a recorded `skipField` reason).
type RequiredRelation = {
  field: string;
  targetTypes: string[];
  appliesToStatuses?: string[];
  skipField?: string;
  gateCode?: string;
};

type UpstreamExpectation = {
  fields: string[];
  skipStatuses?: string[];
};

type DocRegistryEntry = {
  type: string;
  persistence: Persistence;
  // Alternate spellings of the type name accepted by resolvers.
  aliases: readonly string[];
  // Canonical durable directory (first `dirs` entry). null when the type
  // has no durable form.
  dir: string | null;
  // Canonical dir plus alternate dirs the type may inhabit (durable only).
  dirs: readonly string[];
  // Directories the type inhabited under Registry 2 — still owned scopes so
  // legacy content there is never unmanaged, never a write target.
  formerDirs: readonly string[];
  // Owned zero-resident scope containers (e.g. docs/impl).
  scopeDirs: readonly string[];
  idPrefix: string;
  defaultStatus: string;
  statusValues: readonly string[];
  settledStatuses: readonly string[];
  lifecycleValues: readonly LifecycleValue[];
  defaultLifecycle: LifecycleValue | null;
  owner: DocOwner;
  indexFormat: IndexFormat;
  // Index title for owner-format dirs whose title is not derivable from an
  // ID prefix (ADR, impl formats).
  indexTitle?: string;
  indexRow?: {
    // Fallback ID when front matter `id:` is absent; return null for no fallback.
    idFromFile?: (file: string) => string | null;
    // Normalize a heading-derived title (NOT applied to front-matter `title:`).
    titleFromHeading?: (heading: string) => string;
  };
  // Creator entrypoint name (mutator declaration), when one exists.
  creator?: string;
  mutators: readonly string[];
  auditors: readonly string[];
  // Required front-matter fields beyond the shared base set (see
  // REQUIRED_FRONT_MATTER_FIELDS in doc_repository.ts).
  requiredFields: readonly string[];
  // Enumerated vocabularies for extra required fields (knowledge_kind).
  fieldVocabularies: Record<string, readonly string[]>;
  requiredRelations: readonly RequiredRelation[];
  expectedUpstream: readonly UpstreamExpectation[];
  allowedRelations: readonly AllowedRelation[];
  allowsRootArtifact: boolean;
  requiresSourceEvidence: boolean;
  idExceptions: readonly string[];
  requiredDirectoryFiles: readonly string[];
  reservedFiles: readonly string[];
  // Title the scaffold writes for this type's managed index; defaults to
  // `<idPrefix> Documents`.
  scaffoldIndexTitle?: string;
  // When several durable types share a canonical dir, the primary type
  // seeds the shared dir's scaffold/index identity (discovery owns
  // docs/discovery's index even though brainstorm is co-resident).
  indexPrimary?: boolean;
  note?: string;
};

// A durable entry always carries a canonical dir and the lifecycle axis.
type DurableDocConfig = DocRegistryEntry & {
  persistence: "durable";
  dir: string;
  dirs: string[];
  lifecycleValues: LifecycleValue[];
  defaultLifecycle: LifecycleValue;
};

type DocConfig = DurableDocConfig;

// ---------------------------------------------------------------------------
// Durable types — the Document Registry's normal contract
// ---------------------------------------------------------------------------

// Every durable type may point `supersedes` at a same-type predecessor;
// `informs`/`explains` may target any durable document.
const DURABLE_TARGETS = [
  "idea",
  "brainstorm",
  "discovery",
  "spec",
  "design",
  "adr",
  "knowledge",
  "verification",
] as const;

const docTypes = [...DURABLE_TARGETS] as const;
type DocType = typeof docTypes[number];

const configs: Record<DocType, DocConfig> = {
  idea: {
    type: "idea",
    persistence: "durable",
    aliases: [],
    dir: "docs/ideas",
    dirs: ["docs/ideas"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "IDEA",
    defaultStatus: "draft",
    statusValues: ["draft", "exploring", "promoted", "parked", "archived", "superseded"],
    settledStatuses: ["promoted", "parked", "archived", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_idea",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [
      { field: "motivates", targetTypes: ["spec"] },
      { field: "supersedes", targetTypes: ["idea"] },
    ],
    allowsRootArtifact: true,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    note: "Durable capture type: raw unformalized ideas feeding discovery/spec.",
  },
  brainstorm: {
    type: "brainstorm",
    persistence: "durable",
    aliases: [],
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "BRAINSTORM",
    defaultStatus: "capturing",
    statusValues: ["capturing", "confirmed", "routed", "superseded"],
    settledStatuses: ["routed", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    // `brainstorm` has no creator script: the brainstorming skill authors
    // those documents directly.
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [
      { field: "motivates", targetTypes: ["spec", "adr"] },
      { field: "supersedes", targetTypes: ["brainstorm"] },
    ],
    allowsRootArtifact: true,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    note: "Durable capture type co-resident with discovery in docs/discovery.",
  },
  discovery: {
    type: "discovery",
    persistence: "durable",
    aliases: [],
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "DISC",
    defaultStatus: "draft",
    statusValues: ["draft", "active", "resolved", "archived", "superseded"],
    settledStatuses: ["resolved", "archived", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_discovery",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [
      { field: "motivates", targetTypes: ["spec"] },
      { field: "informs", targetTypes: [...DURABLE_TARGETS] },
      { field: "supersedes", targetTypes: ["discovery"] },
    ],
    allowsRootArtifact: true,
    requiresSourceEvidence: true,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    indexPrimary: true,
    note: "Durable capture type: bounded exploration with source evidence.",
  },
  spec: {
    type: "spec",
    persistence: "durable",
    aliases: [],
    dir: "docs/specs",
    dirs: ["docs/specs", "docs/spec", "specs", "spec"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "SPEC",
    defaultStatus: "draft",
    statusValues: ["draft", "proposed", "approved", "implemented", "superseded", "rejected"],
    settledStatuses: ["implemented", "superseded", "rejected"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_spec",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    // Under Knowledge Relations v1 a spec declares no forward upstream
    // (it is the target of motivates/realizes/decides-for, not the source).
    expectedUpstream: [],
    allowedRelations: [
      { field: "supersedes", targetTypes: ["spec"] },
    ],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    note: "Durable normative requirements document.",
  },
  design: {
    type: "design",
    persistence: "durable",
    aliases: [],
    dir: "docs/designs",
    dirs: ["docs/designs", "docs/design", "designs", "design"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "DESIGN",
    defaultStatus: "draft",
    statusValues: ["draft", "approved", "superseded", "rejected"],
    settledStatuses: ["superseded", "rejected"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_design",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    // A design realizes a spec: `realizes` is its declared upstream under
    // Knowledge Relations v1 (skip the check once the design is settled).
    expectedUpstream: [
      { fields: ["realizes"], skipStatuses: ["superseded", "rejected", "archived", "deprecated", "abandoned", "wont-do"] },
    ],
    allowedRelations: [
      { field: "realizes", targetTypes: ["spec"] },
      { field: "supersedes", targetTypes: ["design"] },
    ],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: ["DESIGN-OVERVIEW"],
    requiredDirectoryFiles: ["overview.md"],
    reservedFiles: ["overview.md"],
    scaffoldIndexTitle: "DESIGN Documents",
    note: "Durable design document; docs/designs requires overview.md.",
  },
  adr: {
    type: "adr",
    persistence: "durable",
    aliases: [],
    dir: "docs/adr",
    dirs: ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "ADR",
    defaultStatus: "proposed",
    statusValues: ["proposed", "accepted", "rejected", "deprecated", "superseded", "draft"],
    settledStatuses: ["rejected", "deprecated", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "adr-doc",
    indexFormat: "shared-4col",
    indexTitle: "Architecture Decision Records",
    indexRow: {
      // MADR filenames carry the decision number (`0007-use-pgsql.md`) and
      // H1s keep it (`# 7. Use PostgreSQL`); mirror adr_utils' fallbacks so
      // every producer derives identical rows (Issue #185).
      idFromFile: (file: string) => {
        const match = /^(\d+)-/.exec(file);
        return match ? `ADR-${match[1]}` : null;
      },
      titleFromHeading: (heading: string) =>
        heading.replace(/^\d+\.\s*/, "").trim(),
    },
    creator: "new_adr",
    mutators: ["update_index", "relate_adr"],
    auditors: ["audit_adr", "review_adr", "list_adrs", "migrate_report", "check_code_links"],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [
      { field: "decides-for", targetTypes: ["spec", "design"] },
      { field: "supersedes", targetTypes: ["adr"] },
    ],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    scaffoldIndexTitle: "Architecture Decision Records",
    note: "Durable decision record owned by adr-doc (MADR conventions).",
  },
  knowledge: {
    type: "knowledge",
    persistence: "durable",
    aliases: [],
    dir: "docs/knowledge",
    dirs: ["docs/knowledge"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "KNOW",
    defaultStatus: "draft",
    statusValues: ["draft", "confirmed", "archived", "superseded"],
    settledStatuses: ["archived", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_knowledge",
    mutators: [],
    auditors: [],
    // `knowledge_kind` classifies the durable knowledge record
    // (codebase|architecture|operation|lesson — the Registry's fixed
    // vocabulary per #242).
    requiredFields: ["knowledge_kind"],
    fieldVocabularies: {
      knowledge_kind: ["codebase", "architecture", "operation", "lesson"],
    },
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [
      { field: "informs", targetTypes: [...DURABLE_TARGETS] },
      { field: "explains", targetTypes: [...DURABLE_TARGETS] },
      { field: "supersedes", targetTypes: ["knowledge"] },
    ],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    scaffoldIndexTitle: "Knowledge Documents",
    note: "Durable knowledge record (#242 refines the skill flow).",
  },
  verification: {
    type: "verification",
    persistence: "durable",
    aliases: [],
    dir: "docs/verification",
    dirs: ["docs/verification"],
    formerDirs: [],
    scopeDirs: [],
    idPrefix: "VD",
    defaultStatus: "draft",
    statusValues: ["draft", "proposed", "approved", "deprecated", "superseded"],
    settledStatuses: ["deprecated", "superseded"],
    lifecycleValues: [...LIFECYCLE_VALUES],
    defaultLifecycle: DEFAULT_LIFECYCLE,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    creator: "new_verification",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    // Check→Claim relations are derived from `checks[].target` (#239) and
    // Evidence `supported-by` comes from the Evidence Store (#240); neither
    // is a stored relation field here.
    allowedRelations: [
      { field: "supersedes", targetTypes: ["verification"] },
    ],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    scaffoldIndexTitle: "Verification Design Documents",
    note: "Durable verification-intent document (#239 defines the Check contract).",
  },
};

// ---------------------------------------------------------------------------
// Ephemeral types — execution-bound, no durable Git form
// ---------------------------------------------------------------------------

const executionTypes = ["plan", "task"] as const;
type ExecutionDocType = typeof executionTypes[number];

const ephemeralConfigs: Record<ExecutionDocType, DocRegistryEntry> = {
  plan: {
    type: "plan",
    persistence: "ephemeral",
    aliases: [],
    dir: null,
    dirs: [],
    formerDirs: ["docs/plans", "docs/implementation-plans", "plans", "implementation-plans"],
    scopeDirs: [],
    idPrefix: "PLAN",
    defaultStatus: "draft",
    statusValues: ["draft", "approved", "in-progress", "blocked", "completed", "superseded"],
    settledStatuses: ["completed", "superseded"],
    lifecycleValues: [],
    defaultLifecycle: null,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    note: "Execution-bound: plan state lives in the Execution Store (#236); docs/plans is a former dir only.",
  },
  task: {
    type: "task",
    persistence: "ephemeral",
    aliases: [],
    dir: null,
    dirs: [],
    formerDirs: ["docs/tasks", "docs/work-items", "tasks", "work-items"],
    scopeDirs: [],
    idPrefix: "TASK",
    defaultStatus: "todo",
    statusValues: ["todo", "in-progress", "blocked", "done", "wont-do"],
    settledStatuses: ["done", "wont-do"],
    lifecycleValues: [],
    defaultLifecycle: null,
    owner: "doc-suite",
    indexFormat: "shared-4col",
    mutators: [],
    auditors: [],
    requiredFields: [],
    fieldVocabularies: {},
    requiredRelations: [],
    expectedUpstream: [],
    allowedRelations: [],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    idExceptions: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    note: "Execution-bound: task state lives in the Execution Store (#236); docs/tasks is a former dir only.",
  },
};

// ---------------------------------------------------------------------------
// Legacy types — interpreted only by migration tooling
// ---------------------------------------------------------------------------

// The minimal shape migration needs to read legacy artifacts. `legacy` is
// deliberately not a persistence value: these types are outside the
// registry's persistence axis — they have no durable form at all.
type LegacyDocTypeEntry = {
  type: string;
  aliases: readonly string[];
  formerDirs: readonly string[];
  scopeDirs: readonly string[];
  idPrefix: string;
  defaultStatus: string | null;
  statusValues: readonly string[];
  settledStatuses: readonly string[];
  owner: DocOwner;
  indexFormat: IndexFormat;
  indexTitle?: string;
  mutators: readonly string[];
  auditors: readonly string[];
  requiredFields: readonly string[];
  note: string;
};

const legacyTypes = ["test-spec", "impl", "exp"] as const;
type LegacyDocType = typeof legacyTypes[number];

const legacyDocTypes: Record<LegacyDocType, LegacyDocTypeEntry> = {
  "test-spec": {
    type: "test-spec",
    aliases: ["test_spec", "testspec"],
    formerDirs: ["docs/test-specs", "docs/test-spec", "test-specs", "test-spec"],
    scopeDirs: [],
    idPrefix: "TSPEC",
    defaultStatus: "draft",
    statusValues: ["draft", "proposed", "approved", "deprecated", "superseded"],
    settledStatuses: ["deprecated", "superseded"],
    owner: "doc-suite",
    indexFormat: "shared-4col",
    mutators: ["new_test_spec", "doc_maintenance", "scaffold_docs", "migrate_docs", "migrate_ids"],
    auditors: ["doc_status", "audit_docs", "list_docs"],
    requiredFields: [],
    note: "Legacy verification-intent type, superseded by `verification` (#239); migration-only.",
  },
  impl: {
    type: "impl",
    aliases: ["implementation-record", "impl-record", "ir"],
    formerDirs: ["docs/impl/ir"],
    scopeDirs: ["docs/impl"],
    idPrefix: "IMPL",
    defaultStatus: "draft",
    statusValues: ["draft", "in-progress", "completed", "blocked", "abandoned", "superseded"],
    settledStatuses: ["completed", "abandoned", "superseded"],
    owner: "impl-doc",
    indexFormat: "impl-4col",
    indexTitle: "Implementation Records",
    mutators: ["new_impl_record", "migrate_ids", "promote_index", "sync_impl_index"],
    auditors: ["audit_impl_record"],
    requiredFields: ["metadata"],
    note: "Legacy implementation record; interpretation is migration-only (#240 extracts durable knowledge).",
  },
  exp: {
    type: "exp",
    aliases: ["experiment-log"],
    formerDirs: ["docs/impl/exp"],
    scopeDirs: [],
    idPrefix: "EXP",
    // Experiment logs are JSONL event logs without front matter.
    defaultStatus: null,
    statusValues: [],
    settledStatuses: [],
    owner: "impl-doc",
    indexFormat: "exp-1col",
    indexTitle: "Experiment Logs",
    mutators: ["new_experiment_log", "append_experiment_event", "edit_experiment_log", "migrate_ids", "promote_index", "sync_impl_index"],
    auditors: ["audit_experiment_log"],
    requiredFields: [],
    note: "Legacy experiment log (JSONL, no front matter); interpretation is migration-only.",
  },
};

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

const registry: Record<string, DocRegistryEntry> = {
  ...configs,
  ...ephemeralConfigs,
};

const legacyAliases = new Map<string, LegacyDocType>();
for (const entry of Object.values(legacyDocTypes)) {
  for (const alias of [entry.type, ...entry.aliases]) legacyAliases.set(alias, entry.type as LegacyDocType);
}

function configFor(type: string): DocConfig {
  const entry = registry[type];
  if (entry?.persistence === "durable") return entry as DocConfig;
  if (entry?.persistence === "ephemeral") {
    throw new Error(
      `Document type "${type}" is execution-bound (persistence: ephemeral): it has no durable Git form under Document Registry 3 — plan/task state lives in the Execution Store`,
    );
  }
  if (legacyAliases.has(type)) {
    throw new Error(
      `Document type "${type}" is a legacy format under Document Registry 3: it is interpreted only by migration tooling and cannot be created or linted as a durable document`,
    );
  }
  throw new Error(`Unknown document type: ${type}`);
}

type ResolvedDocType =
  | { kind: "durable"; entry: DocConfig }
  | { kind: "ephemeral"; entry: DocRegistryEntry }
  | { kind: "legacy"; entry: LegacyDocTypeEntry }
  | { kind: "unknown"; entry: null };

// The one "what is this type name" resolver: canonical name or declared
// alias → its registry class.
function resolveDocType(name: string): ResolvedDocType {
  const entry = registry[name];
  if (entry) {
    return entry.persistence === "durable"
      ? { kind: "durable", entry: entry as DocConfig }
      : { kind: "ephemeral", entry };
  }
  const legacy = legacyAliases.get(name);
  if (legacy) return { kind: "legacy", entry: legacyDocTypes[legacy] };
  return { kind: "unknown", entry: null };
}

function isDurableType(name: string): boolean {
  return resolveDocType(name).kind === "durable";
}

// Types with no durable Git form under Registry 3 — the schema preflight's
// execution-bound marker vocabulary (ephemeral names plus every legacy name
// and alias).
function executionBoundTypeNames(): string[] {
  return [
    ...executionTypes,
    ...[...legacyAliases.keys()].sort(),
  ];
}

function statusValuesFor(name: string): readonly string[] {
  const resolved = resolveDocType(name);
  return resolved.entry?.statusValues ?? [];
}

function settledStatusesFor(name: string): readonly string[] {
  const resolved = resolveDocType(name);
  return resolved.entry?.settledStatuses ?? [];
}

// ID prefixes across the whole registry (durable + ephemeral + legacy) —
// the vocabulary legacy-ID detection and ID migration must recognize.
function allIdPrefixes(): string[] {
  const prefixes = new Set<string>();
  for (const entry of Object.values(registry)) prefixes.add(entry.idPrefix);
  for (const entry of Object.values(legacyDocTypes)) prefixes.add(entry.idPrefix);
  return [...prefixes].sort();
}

// Types that had a Git-Markdown form under Registry 2, with the dirs each
// inhabited (canonical first). Migration tooling sweeps this set — durable
// `dirs` for current types, `formerDirs` for execution-bound/legacy types.
function gitEraDocTypes(): { type: string; dirs: string[]; idPrefix: string }[] {
  return [
    ...docTypes.map((type) => {
      const config = configs[type];
      return { type, dirs: [...config.dirs], idPrefix: config.idPrefix };
    }),
    ...executionTypes.map((type) => {
      const entry = ephemeralConfigs[type];
      return { type, dirs: [...entry.formerDirs], idPrefix: entry.idPrefix };
    }),
    ...Object.values(legacyDocTypes).map((entry) => ({
      type: entry.type,
      dirs: [...entry.formerDirs],
      idPrefix: entry.idPrefix,
    })),
  ];
}

// ---------------------------------------------------------------------------
// Directory sets
// ---------------------------------------------------------------------------

// Canonical durable directories — the v3 managed doc tree, in registry order.
const DURABLE_DOC_DIRS: readonly string[] = Object.freeze(
  [...new Set(docTypes.map((type) => configs[type].dir))],
);

// Every directory a non-durable type inhabited under Registry 2 — canonical
// and alias spellings plus owned scope containers. Still owned scopes, so
// legacy content there is never unmanaged and never a write target.
const LEGACY_DOC_DIRS: readonly string[] = Object.freeze(
  [
    ...executionTypes.flatMap((type) => [...ephemeralConfigs[type].formerDirs]),
    ...Object.values(legacyDocTypes).flatMap((entry) => [...entry.formerDirs, ...entry.scopeDirs]),
  ]
    .filter((dir) => !DURABLE_DOC_DIRS.includes(dir))
    .sort(),
);

// The canonical home each non-durable type had under Registry 2 — the first
// (canonical) formerDir, never aliases.
const LEGACY_CANONICAL_DIRS: readonly string[] = Object.freeze([
  ...executionTypes.map((type) => ephemeralConfigs[type].formerDirs[0]),
  ...Object.values(legacyDocTypes).map((entry) => entry.formerDirs[0]),
]);

// Every doc-bearing canonical directory the toolchain has ever managed —
// durable dirs plus the canonical former dirs of execution-bound and legacy
// types. The artifact scan, workspace fingerprint, and migration sweeps
// enumerate this union; aliases resolve through ownership instead.
const CANONICAL_DOC_DIRS: readonly string[] = Object.freeze(
  [...DURABLE_DOC_DIRS, ...LEGACY_CANONICAL_DIRS],
);

// Every managed dir spelling — the schema preflight's scan-root vocabulary
// (its `docs/` walk already covers docs/* spellings; root-level aliases are
// walked individually).
function managedDocDirs(): string[] {
  const dirs = new Set<string>(CANONICAL_DOC_DIRS);
  for (const type of docTypes) {
    for (const dir of configs[type].dirs) dirs.add(dir);
  }
  for (const dir of LEGACY_DOC_DIRS) dirs.add(dir);
  return [...dirs].sort();
}

// Knowledge Relations v1: the stored forward relation vocabulary across
// every durable type — the set schema preflight checks populated relation
// keys against (#235 owns the full contract; the registry declares it).
function knowledgeRelationFields(): string[] {
  const fields = new Set<string>();
  for (const type of docTypes) {
    for (const relation of configs[type].allowedRelations) fields.add(relation.field);
  }
  return [...fields].sort();
}

// `relations.source` stays a legal populated field under Registry 3 — it is
// the provenance contract (discovery's required source evidence), not
// Knowledge Relations vocabulary, so the legacy-relation marker exempts it.
const PROVENANCE_RELATION_KEYS: readonly string[] = ["source"];

function allowedRelationFieldsFor(type: string): string[] {
  const resolved = resolveDocType(type);
  if (resolved.kind !== "durable") return [];
  return resolved.entry.allowedRelations.map((relation) => relation.field);
}

export {
  allIdPrefixes,
  allowedRelationFieldsFor,
  CANONICAL_DOC_DIRS,
  configFor,
  configs,
  DEFAULT_LIFECYCLE,
  docTypes,
  DURABLE_DOC_DIRS,
  ephemeralConfigs,
  executionBoundTypeNames,
  executionTypes,
  gitEraDocTypes,
  isDurableType,
  knowledgeRelationFields,
  legacyDocTypes,
  LEGACY_DOC_DIRS,
  LIFECYCLE_VALUES,
  managedDocDirs,
  PERSISTENCE_VALUES,
  PROVENANCE_RELATION_KEYS,
  registry,
  resolveDocType,
  settledStatusesFor,
  statusValuesFor,
};

export type {
  AllowedRelation,
  DocConfig,
  DocOwner,
  DocRegistryEntry,
  DocType,
  ExecutionDocType,
  IndexFormat,
  LegacyDocType,
  LegacyDocTypeEntry,
  LifecycleValue,
  Persistence,
  RequiredRelation,
  ResolvedDocType,
  UpstreamExpectation,
};
