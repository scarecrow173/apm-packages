#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// consolidate_knowledge — the #242 consolidation entrypoint
// ---------------------------------------------------------------------------
//
// Two verbs:
//
//   assess   Read-only screening of a candidate finding against every durable
//            document directory — always run before any create/integrate
//            decision. Reports integration candidates (existing knowledge →
//            `integrate`; other durable types → their owning skill's route),
//            duplicate/contradiction conflicts, and the gate the caller
//            reports to the run's exit gate (`clear` | `review-required`).
//
//   apply    Record an explicit decision:
//              none      — nothing worth persisting; a valid no-op completion.
//              route     — the finding belongs to another type's owner
//                          (spec/design/ADR…); prints the route, writes nothing.
//              integrate — merge into an existing knowledge document
//                          (provenance 原典 + basis 根拠 recorded).
//              create    — mint a new knowledge document; refused while
//                          unacknowledged conflicts exist — duplicates and
//                          contradictions are reviewed, never added
//                          unconditionally.
//
// The extraction criteria themselves — what counts as durable knowledge from
// an implementation record — are the skill contract
// (references/knowledge-extraction.md); this CLI enforces the bookkeeping.

import fs from "node:fs";
import path from "node:path";

import { createDocument, logIndexResult } from "../../lib/doc_suite_utils";
import { configFor } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import {
  appendProvenanceEntry,
  assessConsolidation,
  integrateKnowledge,
  provenanceEntry,
  resolveKnowledgeTarget,
  ROUTE_SKILLS,
} from "./lib/consolidation";

const KNOWLEDGE_KINDS: readonly string[] = configFor("knowledge").fieldVocabularies.knowledge_kind ?? [];
const KNOWLEDGE_STATUSES: readonly string[] = configFor("knowledge").statusValues;
const DECISIONS = ["none", "route", "integrate", "create"] as const;
// The durable types a `route` decision may name — every type whose route
// is an owning skill rather than `integrate` (knowledge). Derived from
// ROUTE_SKILLS so the route table stays the single authority for both the
// routes `assess` reports and the owners `apply` names.
const ROUTE_TARGET_TYPES: readonly string[] = Object.keys(ROUTE_SKILLS)
  .filter((type) => ROUTE_SKILLS[type] !== "integrate");

type CliArgs = {
  cwd: string;
  verb?: string;
  decision?: string;
  title?: string;
  kind?: string;
  keywords: string[];
  from: string[];
  basis?: string;
  note?: string;
  into?: string;
  to?: string;
  informs: string[];
  explains: string[];
  supersedes: string[];
  acknowledge: string[];
  status?: string;
  lifecycle?: string;
  date?: string;
  dir?: string;
  name?: string;
  json: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    cwd: process.cwd(),
    keywords: [],
    from: [],
    informs: [],
    explains: [],
    supersedes: [],
    acknowledge: [],
    json: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--kind") args.kind = argv[++i];
    else if (arg === "--keyword") args.keywords.push(argv[++i]);
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--basis") args.basis = argv[++i];
    else if (arg === "--note") args.note = argv[++i];
    else if (arg === "--decision") args.decision = argv[++i];
    else if (arg === "--into") args.into = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--informs") args.informs.push(argv[++i]);
    else if (arg === "--explains") args.explains.push(argv[++i]);
    else if (arg === "--supersedes") args.supersedes.push(argv[++i]);
    else if (arg === "--acknowledge") args.acknowledge.push(argv[++i]);
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--lifecycle") args.lifecycle = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 0) args.verb = positional[0];
  if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`);
  return args;
}

function usage(): string {
  return `Usage:
  node scripts/consolidate_knowledge.js assess --title <title> [--kind <${KNOWLEDGE_KINDS.join("|")}>] [--keyword <kw>]... [--json]
  node scripts/consolidate_knowledge.js apply --decision none
  node scripts/consolidate_knowledge.js apply --decision route --to <${ROUTE_TARGET_TYPES.join("|")}> [--note <text>]
  node scripts/consolidate_knowledge.js apply --decision integrate --into <knowledge-doc> --from <source>... --basis <evidence> [--status <status>] [--informs <doc>]... [--explains <doc>]... [--note <text>]
  node scripts/consolidate_knowledge.js apply --decision create --title <title> --kind <${KNOWLEDGE_KINDS.join("|")}> --from <source>... --basis <evidence> [--acknowledge <conflict-id|path>]... [--informs <doc>]... [--explains <doc>]... [--supersedes <doc>]... [--status <status>] [--dir <path>]`;
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function runAssess(args: CliArgs): Promise<void> {
  if (!args.title) throw new Error("Missing required --title");
  if (args.kind && !KNOWLEDGE_KINDS.includes(args.kind)) {
    throw new Error(`Invalid knowledge kind: ${args.kind} (expected one of: ${KNOWLEDGE_KINDS.join(", ")})`);
  }
  const assessment = assessConsolidation(args.cwd, {
    title: args.title,
    keywords: args.keywords,
    kind: args.kind,
  });
  if (args.json) {
    printJson(assessment);
    return;
  }
  console.log(`Consolidation assessment: ${args.title}`);
  if (assessment.candidates.length === 0) {
    console.log("- no existing document overlaps this finding");
  }
  for (const candidate of assessment.candidates) {
    const flag = candidate.conflict ? " [conflict — review required]" : candidate.settled ? " [settled]" : "";
    console.log(`- ${candidate.path} (${candidate.type} → ${candidate.route}, matched: ${candidate.matchedTokens.join(", ")})${flag}`);
  }
  console.log(`gate: ${assessment.gate}`);
}

// The conflict gate on `create`: every reported conflict must be
// acknowledged explicitly by id or path before a new knowledge document is
// minted — a finding is never added unconditionally over a semantic
// duplicate or contradiction candidate.
function assertConflictsAcknowledged(args: CliArgs): void {
  const assessment = assessConsolidation(args.cwd, {
    title: args.title ?? "",
    keywords: args.keywords,
    kind: args.kind,
  });
  const unresolved = assessment.conflicts.filter(
    (conflict) => !args.acknowledge.includes(conflict.id ?? "") && !args.acknowledge.includes(conflict.path),
  );
  const invalid = args.acknowledge.filter(
    (ack) => !assessment.conflicts.some((conflict) => conflict.id === ack || conflict.path === ack),
  );
  if (invalid.length > 0) {
    throw new Error(`--acknowledge names no reported conflict: ${invalid.join(", ")} (conflicts: ${assessment.conflicts.map((conflict) => conflict.id ?? conflict.path).join(", ") || "none"})`);
  }
  if (unresolved.length > 0) {
    throw new Error(
      `Consolidation conflicts require explicit review before create: ${unresolved.map((conflict) => `${conflict.id ?? conflict.path} (${conflict.path})`).join(", ")} — pass --acknowledge <id|path> for each reviewed candidate`,
    );
  }
}

async function runApply(args: CliArgs): Promise<void> {
  if (!args.decision) throw new Error(`Missing required --decision (${DECISIONS.join("|")})`);
  if (!(DECISIONS as readonly string[]).includes(args.decision)) {
    throw new Error(`Invalid decision: ${args.decision} (expected one of: ${DECISIONS.join(", ")})`);
  }

  if (args.decision === "none") {
    // Saving nothing is an explicit, valid consolidation outcome — the
    // no-op completion a normal fix takes when nothing durable resulted.
    const payload = { decision: "none", recorded: false, note: args.note ?? null };
    if (args.json) printJson(payload);
    else console.log("Decision: none — nothing persisted (no durable knowledge to record).");
    return;
  }

  if (args.decision === "route") {
    if (!args.to) throw new Error(`Missing required --to (${ROUTE_TARGET_TYPES.join("|")})`);
    if (args.to === "knowledge") {
      throw new Error("--to knowledge is not a route: use --decision integrate or create");
    }
    if (!ROUTE_TARGET_TYPES.includes(args.to)) {
      throw new Error(`Invalid route target: ${args.to} (expected one of: ${ROUTE_TARGET_TYPES.join(", ")})`);
    }
    // The owner comes from the same ROUTE_SKILLS table `assess` reports —
    // apply never derives an owner spelling (brainstorm routes to
    // briefing-flow, not a non-existent `brainstorm-doc`), and a type the
    // table does not map fails closed.
    const skill = ROUTE_SKILLS[args.to];
    if (!skill) {
      throw new Error(`No owning skill is registered for route target: ${args.to}`);
    }
    const payload = {
      decision: "route",
      targetType: args.to,
      ownerSkill: skill,
      note: args.note ?? null,
      recorded: false,
      guidance: `Apply the change through ${skill}; consolidation never writes non-knowledge documents.`,
    };
    if (args.json) printJson(payload);
    else console.log(`Decision: route → ${args.to} via ${skill} (no document written; ${skill} owns the change).`);
    return;
  }

  if (args.decision === "integrate") {
    if (!args.into) throw new Error("Missing required --into <knowledge document>");
    const result = integrateKnowledge(args.cwd, {
      into: args.into,
      from: args.from,
      basis: args.basis ?? "",
      note: args.note,
      status: args.status,
      informs: args.informs,
      explains: args.explains,
      date: args.date,
    });
    const payload = { decision: "integrate", recorded: true, ...result };
    if (args.json) printJson(payload);
    else {
      console.log(`Integrated into ${result.file} (status: ${result.status}, updated: ${result.updated})`);
      console.log(`Index deferred: materialize explicitly via doc_maintenance.js index plan|apply`);
    }
    return;
  }

  // create
  if (!args.title) throw new Error("Missing required --title");
  if (!args.kind) throw new Error(`Missing required --kind (expected one of: ${KNOWLEDGE_KINDS.join(", ")})`);
  if (!KNOWLEDGE_KINDS.includes(args.kind)) {
    throw new Error(`Invalid knowledge kind: ${args.kind} (expected one of: ${KNOWLEDGE_KINDS.join(", ")})`);
  }
  if (args.from.length === 0) {
    throw new Error("Missing required --from: an extraction must record its source (原典)");
  }
  if (!args.basis?.trim()) {
    throw new Error("Missing required --basis: an extraction must record its evidence basis (根拠)");
  }
  if (args.status !== undefined && !KNOWLEDGE_STATUSES.includes(args.status)) {
    throw new Error(`Invalid knowledge status: ${args.status} (expected one of: ${KNOWLEDGE_STATUSES.join(", ")})`);
  }
  assertConflictsAcknowledged(args);
  // `supersedes` only ever points at another knowledge document — validate
  // targets before minting so no unresolvable edge is stored.
  for (const target of args.supersedes) {
    resolveKnowledgeTarget(args.cwd, target, "supersedes");
  }
  const result = await createDocument("knowledge", {
    cwd: args.cwd,
    date: args.date,
    dir: args.dir,
    fields: { knowledge_kind: args.kind },
    lifecycle: args.lifecycle,
    name: args.name,
    relations: {
      source: args.from,
      informs: args.informs,
      explains: args.explains,
      supersedes: args.supersedes,
    },
    status: args.status,
    title: args.title,
  });
  // The extraction contract records basis next to provenance: the front
  // matter carries `relations.source` (原典) and the body gets the dated
  // evidence entry (根拠) — same bookkeeping `integrate` writes.
  const createdPath = path.join(args.cwd, result.file);
  const created = fs.readFileSync(createdPath, "utf8");
  const date = args.date || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    createdPath,
    appendProvenanceEntry(created.trimEnd(), provenanceEntry(date, args.basis ?? "", args.from, args.note)),
    "utf8",
  );
  const payload = { decision: "create", recorded: true, file: result.file, acknowledged: args.acknowledge };
  if (args.json) printJson(payload);
  else {
    console.log(`Created ${result.file}`);
    logIndexResult(result);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.verb) {
      console.log(usage());
      if (!args.verb && !args.help) process.exitCode = 1;
      return;
    }
    args.cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(args.cwd)) return;
    if (args.verb === "assess") await runAssess(args);
    else if (args.verb === "apply") await runApply(args);
    else throw new Error(`Unknown verb: ${args.verb} (expected assess|apply)`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
