"use strict";

// ---------------------------------------------------------------------------
// Document type registry (extracted from doc_suite_utils.ts, Issue #182)
// ---------------------------------------------------------------------------
//
// The single authority for the shared doc-suite's document types: which
// types exist, the directories each may inhabit (canonical first), their ID
// prefixes, and their status vocabularies. This is a leaf module so the
// ownership contract (doc_ownership.ts) can consume the registry without a
// module cycle — doc_suite_utils re-exports everything unchanged.

const docTypes = ["idea", "brainstorm", "discovery", "spec", "plan", "task", "design", "adr", "test-spec"] as const;

type DocType = typeof docTypes[number];

type DocConfig = {
  defaultStatus: string;
  dir: string;
  dirs: string[];
  idPrefix: string;
  indexRow?: {
    // Fallback ID when front matter `id:` is absent; return null for no fallback.
    idFromFile?: (file: string) => string | null;
    // Normalize a heading-derived title (NOT applied to front-matter `title:`).
    titleFromHeading?: (heading: string) => string;
  };
  statusValues: string[];
  type: DocType;
};

const configs: Record<DocType, DocConfig> = {
  idea: {
    defaultStatus: "draft",
    dir: "docs/ideas",
    dirs: ["docs/ideas"],
    idPrefix: "IDEA",
    statusValues: ["draft", "exploring", "promoted", "parked", "archived", "superseded"],
    type: "idea",
  },
  brainstorm: {
    defaultStatus: "capturing",
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    idPrefix: "BRAINSTORM",
    statusValues: ["capturing", "confirmed", "routed", "superseded"],
    type: "brainstorm",
  },
  discovery: {
    defaultStatus: "draft",
    dir: "docs/discovery",
    dirs: ["docs/discovery"],
    idPrefix: "DISC",
    statusValues: ["draft", "active", "resolved", "archived", "superseded"],
    type: "discovery",
  },
  spec: {
    defaultStatus: "draft",
    dir: "docs/specs",
    dirs: ["docs/specs", "docs/spec", "specs", "spec"],
    idPrefix: "SPEC",
    statusValues: ["draft", "proposed", "approved", "implemented", "superseded", "rejected"],
    type: "spec",
  },
  plan: {
    defaultStatus: "draft",
    dir: "docs/plans",
    dirs: ["docs/plans", "docs/implementation-plans", "plans", "implementation-plans"],
    idPrefix: "PLAN",
    statusValues: ["draft", "approved", "in-progress", "blocked", "completed", "superseded"],
    type: "plan",
  },
  task: {
    defaultStatus: "todo",
    dir: "docs/tasks",
    dirs: ["docs/tasks", "docs/work-items", "tasks", "work-items"],
    idPrefix: "TASK",
    statusValues: ["todo", "in-progress", "blocked", "done", "wont-do"],
    type: "task",
  },
  "test-spec": {
    defaultStatus: "draft",
    dir: "docs/test-specs",
    dirs: ["docs/test-specs", "docs/test-spec", "test-specs", "test-spec"],
    idPrefix: "TSPEC",
    statusValues: ["draft", "proposed", "approved", "deprecated", "superseded"],
    type: "test-spec",
  },
  design: {
    defaultStatus: "draft",
    dir: "docs/designs",
    dirs: ["docs/designs", "docs/design", "designs", "design"],
    idPrefix: "DESIGN",
    statusValues: ["draft", "approved", "superseded", "rejected"],
    type: "design",
  },
  adr: {
    defaultStatus: "proposed",
    dir: "docs/adr",
    dirs: ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"],
    idPrefix: "ADR",
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
    statusValues: ["proposed", "accepted", "rejected", "deprecated", "superseded", "draft"],
    type: "adr",
  },
};

function configFor(type: string): DocConfig {
  if (!docTypes.includes(type as DocType)) throw new Error(`Unknown document type: ${type}`);
  return configs[type as DocType];
}

export { configFor, configs, docTypes };
export type { DocConfig, DocType };
