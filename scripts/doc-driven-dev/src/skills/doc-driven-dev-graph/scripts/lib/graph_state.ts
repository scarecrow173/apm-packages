import fs from "node:fs";
import path from "node:path";

import {
  artifactKeyOf,
  compareStrings,
  groupByArtifact,
  scanRepository,
} from "../../../lib/doc_repository";
import type { RepositoryDocument } from "../../../lib/doc_repository";
import {
  projectKnowledgeGraph,
  resolveClaimReference,
  type KnowledgeGraph,
} from "../../../lib/knowledge_graph";
import { parseClaimReference } from "../../../lib/claim_ids";
import {
  projectRunTasks,
  type TaskGraphResult,
} from "./task_graph";
import {
  listRuns,
  loadRun,
  type RunSnapshot,
} from "../../../lib/execution_store";
import { resolveCommitSubject } from "../../../lib/evidence_store";
import type { VerificationSummary } from "../../../lib/verification_assessment";
import { verificationCoverageGap } from "../../../lib/verification_assessment";
import { sectionBody, subHeadingCount } from "../../../lib/markdown_sections";
import { DURABLE_DOC_DIRS } from "../../../lib/doc_types";
import type { ArtifactScanCollector } from "./artifact_graph";
export { createArtifactScanCollector } from "./artifact_graph";
export type { ArtifactScanCollector } from "./artifact_graph";

export type GraphGateResult = { status: "pass" | "fail" | "blocked"; reasons: string[] };
export type GraphGateResults = Record<string, GraphGateResult>;
export type GraphSignal = string;

/**
 * The runtime gate vocabulary `evaluateGraphGates` emits (Issue #243) — the
 * only names a Graph Definition `gate` condition or `requiresGates` entry
 * may reference. The evaluator asserts it produces exactly this set on
 * every call, so a renamed or added gate must update this list; the
 * definition loader refuses names outside it rather than letting a
 * `not-pass` condition match an absent gate by fail-open.
 */
export const GRAPH_GATE_NAMES = [
  "bootstrap",
  "knowledge",
  "briefing",
  "design",
  "planning",
  "implementation",
  "verification",
  "knowledge-consolidation",
  "exit-audit",
] as const;

/**
 * The Verification Summary (#241) bound into this projection — the
 * verification gate's evidence authority. `summary` is the caller-supplied
 * (or route-computed) assessment; `boundToHead` records whether its target's
 * canonical subject digest equals this checkout's HEAD content identity —
 * `true` binds, `false` is a resolved HEAD and a different subject (a stale
 * artifact), and `null` means HEAD itself could not be resolved (unborn
 * branch, non-repo): binding is then unprovable, which fails closed but is
 * never a target mismatch. `documents` lists the Verification Design
 * documents in scope — durable intent, never the measurement itself.
 */
export type GraphVerification = {
  summary: VerificationSummary;
  boundToHead: boolean | null;
  documents: string[];
};

/**
 * The durable Git-managed knowledge projection (#234 registry + #235
 * claims/relations): the Knowledge Graph — document nodes with claims and
 * validated checks, stored forward Knowledge Relations, derived inverses,
 * check edges, and integrity issues — plus the canonical durable document
 * records the gates inspect (status, body, declared relations).
 */
export type GraphKnowledge = {
  graph: KnowledgeGraph;
  documents: RepositoryDocument[];
};

/**
 * The Execution Store projection (#236–#238): the selected run's identity,
 * lifecycle status, and declared artifact focus, plus the Dynamic Task
 * Graph projected from its plan.md and task records. `null` run means no
 * run selected (planning has not materialized one — never a blocker by
 * itself); task identity is always `(runId, taskId)` — records from other
 * runs are never read.
 */
export type GraphExecution = {
  run: {
    runId: string;
    status: string;
    focus: string[] | null;
  } | null;
  taskGraph: TaskGraphResult | null;
};

/**
 * Graph State v3 (Issue #243): a fresh projection of the three authorities —
 * `knowledge` (durable Git-managed documents and their Claims/Relations),
 * `execution` (the selected Execution Store run), and `verification` (the
 * HEAD-bound Verification Summary) — plus the resolved `focus`, `gates`,
 * `signals`, `blockers`, and `hardBlockers`. There is no artifactGraph,
 * taskDir, or durable plan/task data here: that corpus is migration-domain.
 */
export type GraphState = {
  schemaVersion: 3;
  graphId: string;
  cwd: string;
  knowledge: GraphKnowledge;
  execution: GraphExecution;
  verification: GraphVerification | null;
  focus: string[];
  gates: GraphGateResults;
  signals: GraphSignal[];
  blockers: string[];
  hardBlockers: string[];
};

export type ProjectGraphStateOptions = {
  cwd: string;
  graphId?: string;
  /**
   * Focus tokens resolved against durable Claim/Document IDs, Run IDs, and
   * canonical paths. A Claim reference (`DOC-ID::KEY`) binds its owning
   * document; a Run ID binds that run and contributes its manifest focus;
   * a Document ID binds its primary path; a path binds itself. Ambiguous
   * or unresolvable tokens fail closed — plans and tasks in other runs or
   * other chains can never trigger `focus-required` (Issue #243).
   */
  focus?: string[];
  signals?: GraphSignal[];
  /**
   * Execution Store run selector: the run whose plan/tasks the Dynamic
   * Task Graph projects. When absent — and no focus token names a run —
   * the projection resolves the store implicitly: exactly one active run
   * bound to this graph whose declared focus sits inside the selected
   * chain. Zero candidates stay null (fail open — planning has not
   * materialized a run); several or unreadable candidates fail closed.
   */
  runId?: string;
  stateRoot?: string;
  allowExternalRoot?: boolean;
  /**
   * The Verification Summary the verification gate consumes (Issue #241).
   * The projection binds it to this checkout's HEAD through the canonical
   * subject digest — a summary for another commit or workspace can never
   * pass this gate. Absent means no verification input: the gate fails
   * closed.
   */
  verificationSummary?: VerificationSummary;
};

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function gate(status: GraphGateResult["status"], reasons: string[] = []): GraphGateResult {
  return { status, reasons: sortedUnique(reasons) };
}

function consideredOptionCount(body: string): number {
  const section = sectionBody(body, "Considered Options");
  if (!section) return 0;
  const headings = subHeadingCount(section);
  const listItems = section.match(/^\s*[-*+]\s+\S/gm)?.length ?? 0;
  return Math.max(headings, listItems);
}

// Indexes are derived (materialized) views, so a missing or stale README is
// never a bootstrap reason — only a genuinely absent canonical durable tree
// gates graph execution. Under Registry 3 the canonical tree is the durable
// doc set: execution-bound (plan/task) and legacy (impl/exp, test-spec)
// dirs are migration-owned — their absence is normal in a v3-native
// workspace, never a bootstrap reason (Issue #234).
function bootstrapReasons(cwd: string): string[] {
  const reasons: string[] = [];
  for (const directory of DURABLE_DOC_DIRS) {
    const full = path.join(cwd, directory);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) reasons.push(`missing-directory:${directory}`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Knowledge-chain selection — spec/ADR/design chains over Knowledge Relations
// ---------------------------------------------------------------------------

/**
 * A v3 artifact chain: the durable spec/ADR/design triple plus the
 * pre-design anchors (discovery/brainstorm evidence) that pair a spec with
 * an ADR before a design exists. Plans and tasks are no longer members —
 * they live in the Execution Store run, never in Git-managed Markdown.
 */
export type ArtifactChain = {
  spec?: string;
  adr?: string;
  design?: string;
  anchors?: string[];
};

const CHAIN_STATUSES: Record<string, ReadonlySet<string>> = {
  spec: new Set(["proposed", "approved", "implemented"]),
  adr: new Set(["proposed", "accepted"]),
  design: new Set(["approved"]),
};

function chainKey(chain: ArtifactChain): string {
  return [chain.spec, chain.adr, chain.design].map((value) => value ?? "").join("\u0000");
}

export function chainMembers(chain: ArtifactChain): Set<string> {
  return new Set([chain.spec, chain.adr, chain.design, ...(chain.anchors ?? [])]
    .filter((value): value is string => Boolean(value)));
}

/** A resolved stored forward Knowledge Relation between two documents. */
function hasKnowledgeEdge(
  graph: KnowledgeGraph,
  fromPath: string,
  relation: string,
  toPath: string,
): boolean {
  return graph.edges.some((edge) => edge.resolution === "resolved"
    && edge.from.path === fromPath
    && edge.relation === relation
    && edge.to?.path === toPath);
}

// Knowledge Relations v1 (Issue #235): a design claims a spec only through
// the stored forward edge `design.realizes → spec`. The pre-v3 spellings
// (`derives-from`, `implements`) are never read — legacy corpora are
// migration-domain data.
export function designClaimsSpec(graph: KnowledgeGraph, designPath: string, specPath: string | undefined): boolean {
  return Boolean(specPath) && hasKnowledgeEdge(graph, designPath, "realizes", specPath as string);
}

// A design claims an ADR through the stored forward edge `adr decides-for
// design` — the only v1 direction. `implements`/`derives-from` spellings
// are migration-domain data.
export function designClaimsAdr(graph: KnowledgeGraph, designPath: string, adrPath: string | undefined): boolean {
  return Boolean(adrPath) && hasKnowledgeEdge(graph, adrPath as string, "decides-for", designPath);
}

/** Return discovery anchors, an empty array for a direct pair, or undefined when unrelated.
 *
 *  The spec↔ADR pre-design pairing is the stored forward edge
 *  `adr.decides-for → spec`; capture-layer anchors are discovery/brainstorm
 *  documents whose stored `motivates`/`informs` edges reach both artifacts
 *  (the stored direction is anchor → artifact). */
export function preDesignAnchors(
  graph: KnowledgeGraph,
  records: RepositoryDocument[],
  spec: RepositoryDocument,
  adr: RepositoryDocument,
): string[] | undefined {
  const direct = hasKnowledgeEdge(graph, adr.path, "decides-for", spec.path);
  const discoveries = records.filter((record) => (record.type === "discovery" || record.type === "brainstorm")
    && [spec, adr].every((artifact) =>
      hasKnowledgeEdge(graph, record.path, "motivates", artifact.path)
      || hasKnowledgeEdge(graph, record.path, "informs", artifact.path)));
  return direct || discoveries.length > 0 ? discoveries.map((record) => record.path) : undefined;
}

/** Enumerate valid spec/ADR/design chains from resolved Knowledge Relations. */
export function artifactChainCandidates(graph: KnowledgeGraph, records: RepositoryDocument[]): ArtifactChain[] {
  const specs = records.filter((record) => record.type === "spec" && CHAIN_STATUSES.spec.has(record.status ?? ""));
  const adrs = records.filter((record) => record.type === "adr" && CHAIN_STATUSES.adr.has(record.status ?? ""));
  const designs = records.filter((record) => record.type === "design" && CHAIN_STATUSES.design.has(record.status ?? ""));
  const chains = new Map<string, ArtifactChain>();
  const add = (chain: ArtifactChain): void => { chains.set(chainKey(chain), chain); };
  const cartesian = <T>(values: T[], fallback: Array<T | undefined>): Array<T | undefined> => values.length > 0 ? values : fallback;

  for (const design of designs) {
    const relatedSpecs = specs.filter((candidate) => designClaimsSpec(graph, design.path, candidate.path));
    const relatedAdrs = adrs.filter((candidate) => designClaimsAdr(graph, design.path, candidate.path));
    for (const spec of cartesian(relatedSpecs, [undefined])) {
      for (const adr of cartesian(relatedAdrs, [undefined])) {
        add({ spec: spec?.path, adr: adr?.path, design: design.path });
      }
    }
  }
  const unassignedSpecs = specs.filter((spec) => !designs.some((design) => designClaimsSpec(graph, design.path, spec.path)));
  const paired = new Set<string>();
  for (const spec of unassignedSpecs) {
    // An ADR already claimed by a design chain can still pair with a new
    // spec: pair evidence is independent of downstream chain selection. The
    // ADR then belongs to both chains, so focusing it alone stays ambiguous.
    for (const adr of adrs) {
      const anchors = preDesignAnchors(graph, records, spec, adr);
      if (!anchors) continue;
      add({ spec: spec.path, adr: adr.path, anchors });
      paired.add(spec.path);
      paired.add(adr.path);
    }
  }
  for (const artifact of [...specs, ...adrs]) {
    if (!paired.has(artifact.path)
      && !designs.some((design) => artifact.type === "adr"
        ? designClaimsAdr(graph, design.path, artifact.path)
        : designClaimsSpec(graph, design.path, artifact.path))) {
      add(artifact.type === "spec" ? { spec: artifact.path } : { adr: artifact.path });
    }
  }
  return [...chains.values()].sort((left, right) => compareStrings(chainKey(left), chainKey(right)));
}

export function selectArtifactChain(
  graph: KnowledgeGraph,
  records: RepositoryDocument[],
  focusPaths: Iterable<string>,
): ArtifactChain | undefined {
  const focus = [...focusPaths];
  const candidates = artifactChainCandidates(graph, records).filter((chain) => {
    const members = chainMembers(chain);
    return focus.every((focusPath) => members.has(focusPath));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isFocusAmbiguous(
  graph: KnowledgeGraph,
  records: RepositoryDocument[],
  focusPaths: Iterable<string>,
): boolean {
  const focus = [...focusPaths];
  const relevant = focus.some((focusPath) => {
    const type = records.find((record) => record.path === focusPath)?.type;
    return ["discovery", "brainstorm", "spec", "adr", "design"].includes(type ?? "");
  });
  if (!relevant) return false;
  const candidates = artifactChainCandidates(graph, records).filter((chain) => {
    const members = chainMembers(chain);
    return focus.every((focusPath) => members.has(focusPath));
  });
  return candidates.length > 1;
}

// ---------------------------------------------------------------------------
// Focus resolution — durable Claim/Document IDs, Run IDs, canonical paths
// ---------------------------------------------------------------------------

export type GraphFocusResolution = {
  /** Normalized primary document paths. */
  focus: string[];
  /** Run named by a focus token, or null. */
  runId: string | null;
  /** The focused document (highest-priority member of the chain). */
  focusedPath?: string;
  blockers: string[];
};

const FOCUS_RANK: Record<string, number> = { design: 0, spec: 1, adr: 2, discovery: 3, brainstorm: 4 };

function primaryPathByArtifactKey(records: RepositoryDocument[]): Map<string, string> {
  const primaries = new Map<string, string>();
  for (const [key, group] of groupByArtifact(records)) {
    const nonLocalized = group.filter((document) => !/\.[a-z]{2}\.md$/i.test(path.posix.basename(document.path)));
    const pool = nonLocalized.length > 0 ? nonLocalized : group;
    primaries.set(key, [...pool].sort((a, b) => compareStrings(a.path, b.path))[0].path);
  }
  return primaries;
}

/**
 * Resolve raw focus tokens to durable document primary paths. Order:
 * claim reference → document ID → run ID → canonical path. A run token
 * selects that run AND contributes its manifest focus paths — the run id
 * IS a focus selector under v3 (other runs' plans/tasks never enter the
 * resolution). Anything unresolvable or ambiguous fails closed.
 */
function resolveFocus(
  cwd: string,
  records: RepositoryDocument[],
  knowledge: KnowledgeGraph,
  options: Pick<ProjectGraphStateOptions, "focus" | "stateRoot" | "allowExternalRoot">,
): GraphFocusResolution {
  const rawValues = [...(options.focus ?? [])];
  if (rawValues.length === 0) {
    const active = records.filter((record) => record.status && ACTIVE_STATUSES_FOR_FOCUS.has(record.status));
    return { focus: [], runId: null, blockers: active.length > 0 ? ["focus-required"] : [] };
  }

  const primaries = primaryPathByArtifactKey(records);
  const byId = new Map<string, RepositoryDocument[]>();
  for (const record of records) {
    if (!record.id) continue;
    const group = byId.get(record.id) ?? [];
    group.push(record);
    byId.set(record.id, group);
  }
  const primaryFor = (group: RepositoryDocument[]): RepositoryDocument[] => {
    const keys = new Set(group.map((record) => artifactKeyOf(record.path)));
    return [...keys].map((key) => primaries.get(key))
      .filter((value): value is string => Boolean(value))
      .map((key) => records.find((record) => record.path === key) as RepositoryDocument);
  };
  const listed = listRuns(cwd, {
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  });
  const runIds = new Set(listed.map((run) => run.runId));

  const focus: string[] = [];
  const runTokens = new Set<string>();
  const blockers = new Set<string>();
  for (const rawToken of rawValues) {
    const token = rawToken.trim();
    if (!token) continue;
    // 1. Claim reference (`DOC-ID::KEY`) binds its owning document — but
    // only when the claim itself resolves (a missing claim is invalid
    // input, never silently doc-bound).
    if (parseClaimReference(token)) {
      const resolved = resolveClaimReference(knowledge, token);
      if (resolved.status === "resolved") {
        focus.push(resolved.node.path);
        continue;
      }
      blockers.add(resolved.status === "ambiguous" ? "focus-required" : "focus-invalid");
      continue;
    }
    // 2. Document ID binds its primary path — the artifact's canonical
    // identity, locale siblings included.
    const idGroup = byId.get(token);
    if (idGroup) {
      const idPrimaries = primaryFor(idGroup);
      if (idPrimaries.length === 1) {
        focus.push(idPrimaries[0].path);
      } else {
        blockers.add("focus-required");
      }
      continue;
    }
    // 3. Run ID binds the run and contributes its declared focus paths.
    if (runIds.has(token)) {
      if (runTokens.size > 0 && !runTokens.has(token)) blockers.add("focus-invalid");
      runTokens.add(token);
      try {
        const snapshot = loadRun(cwd, token, {
          stateRoot: options.stateRoot,
          allowExternalRoot: options.allowExternalRoot,
        });
        const runFocus = runFocusPaths(snapshot.manifest.focus);
        if (runFocus) focus.push(...runFocus);
      } catch {
        blockers.add("task-graph-run-unreadable");
      }
      continue;
    }
    // 4. Canonical path — normalized to the artifact's primary path.
    const normalized = normalizeRepoPath(cwd, token);
    const primary = primaries.get(artifactKeyOf(normalized));
    if (primary) {
      focus.push(primary);
      continue;
    }
    blockers.add("focus-invalid");
  }

  const resolvedFocus = sortedUnique(focus);
  if (blockers.size > 0) {
    return { focus: resolvedFocus, runId: null, blockers: sortedUnique(blockers) };
  }
  const runId = runTokens.size === 1 ? [...runTokens][0] : null;
  if (isFocusAmbiguous(knowledge, records, resolvedFocus)) {
    return { focus: resolvedFocus, runId, blockers: ["focus-required"] };
  }
  const chain = selectArtifactChain(knowledge, records, resolvedFocus);
  if (resolvedFocus.length > 1 && !chain) return { focus: resolvedFocus, runId, blockers: ["focus-required"] };
  const focused = records.filter((record) => resolvedFocus.includes(record.path))
    .sort((left, right) => (FOCUS_RANK[left.type ?? ""] ?? 9) - (FOCUS_RANK[right.type ?? ""] ?? 9) || compareStrings(left.path, right.path))[0];
  return { focus: resolvedFocus, runId, focusedPath: focused?.path, blockers: [] };
}

function normalizeRepoPath(cwd: string, target: string): string {
  return path.relative(path.resolve(cwd), path.resolve(cwd, target)).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Run selection — explicit, focus-bound, or implicit single-candidate
// ---------------------------------------------------------------------------

function findRecord(records: RepositoryDocument[], pathValue: string | undefined): RepositoryDocument | undefined {
  return pathValue ? records.find((record) => record.path === pathValue) : undefined;
}

/**
 * A run declares the artifact paths it executes against in `manifest.focus`
 * — a JSON array of repo-relative artifact paths, the same vocabulary the
 * resolved `state.focus` carries. Anything else (absent, empty, non-array)
 * means the run is unbound: it cannot implicitly match a chain and cannot
 * satisfy the planning gate's focus relation.
 */
function runFocusPaths(focus: unknown): string[] | null {
  if (!Array.isArray(focus) || focus.length === 0) return null;
  return focus.every((entry) => typeof entry === "string") ? focus : null;
}

// A run is a candidate for implicit selection only while `active` —
// finalized runs are read-only history, never the live execution. The
// run's own `graphId` must match the projected graph: a run created for
// another graph is not this graph's execution state. Its declared focus
// must sit inside the focused chain: a run bound to a different chain's
// artifacts never becomes this projection's execution state.
function runMatchesGraph(
  snapshot: RunSnapshot,
  graphId: string,
  members: ReadonlySet<string> | null,
): boolean {
  if (snapshot.status !== "active" || snapshot.manifest.graphId !== graphId) return false;
  const focus = runFocusPaths(snapshot.manifest.focus);
  return focus !== null && members !== null && focus.every((entry) => members.has(entry));
}

/**
 * Resolve the run whose plan/tasks back the Dynamic Task Graph. Explicit
 * `--run` wins outright; a run named by a focus token binds next (a
 * conflicting explicit selector is `focus-invalid`); implicit selection
 * requires exactly one active run bound to this graph and chain. Zero
 * candidates return null (planning has not materialized a run yet —
 * normal), while several or unreadable candidates fail closed so records
 * from different runs can never be mixed.
 */
function resolveRunSnapshot(
  cwd: string,
  graphId: string,
  chain: ArtifactChain | undefined,
  focusRunId: string | null,
  options: Pick<ProjectGraphStateOptions, "runId" | "stateRoot" | "allowExternalRoot">,
): { snapshot: RunSnapshot | null; blocker: string | null } {
  const store = { stateRoot: options.stateRoot, allowExternalRoot: options.allowExternalRoot };
  if (options.runId !== undefined && focusRunId !== null && options.runId !== focusRunId) {
    return { snapshot: null, blocker: "focus-invalid" };
  }
  const selectedId = options.runId ?? focusRunId;
  if (selectedId !== undefined && selectedId !== null) {
    return { snapshot: loadRun(cwd, selectedId, store), blocker: null };
  }
  const members = chain === undefined ? null : chainMembers(chain);
  const listed = listRuns(cwd, store);
  // A `corrupt` listing cannot prove which graph it belongs to, so it can
  // never be silently skipped — it is an unknown candidate. Alone it makes
  // the selection unreadable; alongside matching runs it makes it ambiguous.
  const corrupt = listed.filter((run) => run.status === "corrupt");
  const matched: RunSnapshot[] = [];
  try {
    for (const run of listed) {
      if (run.status !== "active") continue;
      const snapshot = loadRun(cwd, run.runId, store);
      if (runMatchesGraph(snapshot, graphId, members)) matched.push(snapshot);
    }
  } catch {
    return { snapshot: null, blocker: "task-graph-run-unreadable" };
  }
  if (corrupt.length > 0) {
    return { snapshot: null, blocker: matched.length === 0 ? "task-graph-run-unreadable" : "task-graph-run-ambiguous" };
  }
  if (matched.length === 1) return { snapshot: matched[0], blocker: null };
  if (matched.length > 1) return { snapshot: null, blocker: "task-graph-run-ambiguous" };
  return { snapshot: null, blocker: null };
}

// ---------------------------------------------------------------------------
// Signals / blockers
// ---------------------------------------------------------------------------

function deriveSignals(input: GraphSignal[], blockers: string[], gates: GraphGateResults, taskGraph: TaskGraphResult | null): GraphSignal[] {
  const signals = new Set(input);
  if (blockers.includes("focus-required")) signals.add("focus-required");
  if (blockers.includes("bootstrap-incomplete")) signals.add("bootstrap-incomplete");
  if (blockers.length === 0 && Object.values(gates).length > 0 && Object.values(gates).every((result) => result.status === "pass")
    && (!taskGraph || taskGraph.issues.length === 0)) signals.add("graph-complete");
  return sortedUnique(signals);
}

function deriveHardBlockers(blockers: string[], gates: GraphGateResults): string[] {
  return sortedUnique([
    ...blockers.filter((blocker) => blocker === "focus-required"
      || blocker === "focus-invalid"
      || blocker === "duplicate-id"
      || blocker.startsWith("knowledge:")),
    ...(gates.knowledge && gates.knowledge.status !== "pass" ? ["knowledge"] : []),
  ]);
}

// ---------------------------------------------------------------------------
// Gates — sufficiency of requirement/decision/implementation/verification
// ---------------------------------------------------------------------------

/**
 * Evaluate every gate against the projected state. Each gate inspects the
 * *sufficiency* of the underlying requirement, decision, implementation,
 * or verification — never mere document existence. `pass` means the
 * evidence suffices; `fail` means the stage's own work is incomplete;
 * `blocked` means external evidence or authority is required (unresolved
 * focus, missing HEAD-bound verification input, knowledge integrity
 * issues). Waived/out-of-scope check statuses reach `pass` ONLY through
 * the Verification Summary's validated exemptions — authority-less waiver
 * candidates land on its rejected lists and never satisfy the gate.
 */
export function evaluateGraphGates(state: GraphState): GraphGateResults {
  const cwd = path.resolve(state.cwd);
  const records = state.knowledge.documents;
  // A blocked focus resolution still carries its candidate paths for
  // diagnostics — the gates must treat it as unfocused, never let one
  // member's content stand in for an ambiguous selection.
  const focusBlocked = state.blockers.includes("focus-required") || state.blockers.includes("focus-invalid");
  const focused = focusBlocked ? undefined : findRecord(records, focusRank(state, records));
  const chain = focused ? selectArtifactChain(state.knowledge.graph, records, state.focus) : undefined;
  const taskGraph = state.execution.taskGraph;
  const bootstrap = bootstrapReasons(cwd);
  const gates: GraphGateResults = {
    bootstrap: gate(bootstrap.length === 0 ? "pass" : "fail", bootstrap),
    // Knowledge integrity (Issue #235): any projection issue — a duplicate
    // Claim ID, an unresolvable stored relation, a legacy relation field —
    // blocks routing outright. The durable corpus is the authority, so its
    // corruption is a hard blocker, never a repairable stage.
    knowledge: gate(
      state.knowledge.graph.issues.length === 0 ? "pass" : "blocked",
      state.knowledge.graph.issues.map((issue) => `knowledge:${issue.code}`),
    ),
  };
  if (!focused) {
    gates.briefing = gate(state.blockers.includes("focus-required") ? "blocked" : "fail", [state.blockers.includes("focus-required") ? "focus-required" : "focus-missing"]);
    gates.design = gate("blocked", ["focus-required"]);
    gates.planning = gate("blocked", ["focus-required"]);
    gates.implementation = gate("blocked", ["focus-required"]);
    gates.verification = gate("blocked", ["focus-required"]);
  } else {
    const spec = findRecord(records, chain?.spec);
    const adr = findRecord(records, chain?.adr);
    const design = findRecord(records, chain?.design);

    // Briefing: requirement (spec) and decision (ADR) sufficiency — the
    // documents must carry a live status and the content the stage must
    // produce, not merely exist.
    const briefingReasons: string[] = [];
    if (!spec || !["proposed", "approved", "implemented"].includes(spec.status ?? "")) briefingReasons.push("spec-status");
    if (!spec || !sectionBody(spec.body, "Acceptance Criteria")) briefingReasons.push("acceptance-criteria");
    if (!adr || !["proposed", "accepted"].includes(adr.status ?? "")) briefingReasons.push("adr-status");
    if (!adr || consideredOptionCount(adr.body) < 2) briefingReasons.push("considered-options");
    gates.briefing = gate(briefingReasons.length === 0 ? "pass" : "fail", briefingReasons);

    // Design: the decision record must be approved AND claim its upstream
    // through the v1 relations — `realizes` the spec, decided-for by the
    // ADR. Legacy spellings never satisfy this gate.
    const designReasons: string[] = [];
    if (!design || design.status !== "approved") designReasons.push("design-status");
    if (!design || !designClaimsSpec(state.knowledge.graph, design.path, spec?.path)) designReasons.push("design-spec-relation");
    if (!design || !designClaimsAdr(state.knowledge.graph, design.path, adr?.path)) designReasons.push("design-adr-relation");
    gates.design = gate(designReasons.length === 0 ? "pass" : "fail", designReasons);

    // Planning: the selected run's plan.md carries a digest-bound approval
    // (unapproved/stale plans surface as `task-graph:plan-not-approved`),
    // the run's declared focus sits inside this chain, and the run
    // materialized at least one task — task identity is `(runId, taskId)`,
    // so records from other runs or chains can never satisfy this gate.
    const planningReasons: string[] = [];
    if (state.execution.taskGraph?.plan?.approved !== true) planningReasons.push("plan-status");
    const members = chain === undefined ? null : chainMembers(chain);
    const runFocus = state.execution.run?.focus ?? null;
    if (runFocus === null || members === null || !runFocus.every((entry) => members.has(entry))) {
      planningReasons.push("plan-design-relation");
    }
    if (!taskGraph || taskGraph.nodes.length === 0) planningReasons.push("no-selected-tasks");
    if (taskGraph && taskGraph.issues.length > 0) planningReasons.push(...taskGraph.issues.map((issue) => `task-graph:${issue.code}`));
    gates.planning = gate(
      planningReasons.length === 0 ? "pass" : taskGraph && taskGraph.issues.length > 0 ? "blocked" : "fail",
      planningReasons,
    );

    // Implementation: every selected task in this run reached a terminal
    // status — the implementation work itself is sufficient. Verification
    // is the next stage's gate; it is never folded in here.
    const implementationReasons: string[] = [];
    if (!taskGraph || taskGraph.nodes.length === 0) implementationReasons.push("no-selected-tasks");
    if (taskGraph && taskGraph.nodes.some((node) => !["done", "wont-do"].includes(node.status))) implementationReasons.push("tasks-incomplete");
    gates.implementation = gate(implementationReasons.length === 0 ? "pass" : "fail", implementationReasons);

    // Verification (Issue #241): authority is a Verification Summary of
    // actual Evidence Assessments bound to this checkout's HEAD — never a
    // caller-asserted signal. A missing summary, a summary targeting
    // another subject, a non-verified verdict, and a `verified` verdict
    // over un-covered required checks all fail closed; the summary's own
    // reasons propagate so the operator sees WHICH coverage failed.
    // Waived/out-of-scope checks only count through the summary's
    // validated exemptions — evidence plus authority, by contract.
    const verificationReasons: string[] = [];
    const verification = state.verification;
    // `== null` covers a hand-projected state that never set the field —
    // missing verification input always fails closed, never crashes.
    if (verification == null) {
      verificationReasons.push("verification-summary");
    } else if (verification.boundToHead === null) {
      verificationReasons.push("verification-summary-head-unreadable");
    } else if (!verification.boundToHead) {
      verificationReasons.push("verification-summary-target-mismatch");
    } else if (verification.summary.verdict !== "verified") {
      verificationReasons.push(`verification-${verification.summary.verdict}`);
      verificationReasons.push(...verification.summary.reasons);
    } else if (verificationCoverageGap(verification.summary)) {
      verificationReasons.push("verification-summary-inconsistent");
    }
    gates.verification = gate(verificationReasons.length === 0 ? "pass" : "blocked", verificationReasons);
  }

  // Knowledge consolidation (#242): the caller signals `knowledge-consolidated`
  // once the consolidation decision is taken — integrating findings or
  // deliberately persisting nothing (a valid no-op). The gate never infers
  // it: an absent signal keeps the run looping through the
  // knowledge-consolidation delegate until the decision is honestly made.
  gates["knowledge-consolidation"] = state.signals.includes("knowledge-consolidated")
    ? gate("pass")
    : gate("fail", ["knowledge-consolidation-pending"]);
  gates["exit-audit"] = state.signals.includes("exit-audit-pass") ? gate("pass") : gate("blocked", ["exit-audit-pass"]);
  // Fail closed on vocabulary drift: the projection must emit exactly the
  // declared gate names — a dropped gate would let a `not-pass` condition
  // match it by absence (Issue #243).
  const emittedGates = Object.keys(gates).sort(compareStrings);
  const declaredGates = [...GRAPH_GATE_NAMES].sort(compareStrings);
  if (emittedGates.join("\u0000") !== declaredGates.join("\u0000")) {
    throw new Error(`gate vocabulary drift: expected ${declaredGates.join(", ")}; emitted ${emittedGates.join(", ")}`);
  }
  return gates;
}

// The focused document is the highest-ranking focus member — the
// projection ranks design > spec > adr > capture docs, mirroring how far
// the chain has progressed.
function focusRank(state: GraphState, records: RepositoryDocument[]): string | undefined {
  return records.filter((record) => state.focus.includes(record.path))
    .sort((left, right) => (FOCUS_RANK[left.type ?? ""] ?? 9) - (FOCUS_RANK[right.type ?? ""] ?? 9) || compareStrings(left.path, right.path))[0]
    ?.path;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project Graph State v3: one fresh read of the durable corpus
 * (`scanRepository` over `DURABLE_DOC_DIRS` only — legacy dirs are
 * migration-owned and never read here), the Knowledge Graph built over it,
 * the selected Execution Store run's Dynamic Task Graph, and the HEAD-bound
 * Verification Summary. Focus resolves by Claim/Document ID and Run ID;
 * plans/tasks in other runs or chains never trigger `focus-required`.
 */
export async function projectGraphState(options: ProjectGraphStateOptions, collector?: ArtifactScanCollector): Promise<GraphState> {
  const cwd = path.resolve(options.cwd);
  // The durable corpus only: `roots` restrict the scan to the registry's
  // durable dirs so plan/task/test-spec/impl Markdown is never even read —
  // migration-owned content stays outside the projection by construction.
  if (collector) collector.scans += 1;
  const model = await scanRepository({ cwd, roots: [...DURABLE_DOC_DIRS], includeTopLevelMarkdown: false });
  const knowledge = projectKnowledgeGraph(model);
  const records = model.canonicalDocuments;
  if (collector) {
    for (const document of model.files) {
      collector.filesRead += 1;
      collector.filePaths.add(document.path);
      try {
        collector.bytesRead += fs.statSync(document.absolutePath).size;
      } catch { /* missing file — count nothing */ }
    }
  }

  const graphId = options.graphId ?? "doc-driven-dev";
  const resolution = resolveFocus(cwd, records, knowledge, {
    focus: options.focus,
    stateRoot: options.stateRoot,
    allowExternalRoot: options.allowExternalRoot,
  });
  const chain = resolution.blockers.length === 0
    ? selectArtifactChain(knowledge, records, resolution.focus)
    : undefined;
  // The Dynamic Task Graph is a projection of the selected Execution Store
  // run — never durable plan/task Markdown (Issue #237).
  const { snapshot: run, blocker: runBlocker } = resolveRunSnapshot(
    cwd,
    graphId,
    chain,
    resolution.runId,
    options,
  );
  const taskGraph = run ? projectRunTasks(run) : null;

  const duplicateIds = model.duplicateIds();
  const blockers = sortedUnique([
    ...resolution.blockers,
    ...knowledge.issues.map((issue) => `knowledge:${issue.code}`),
    ...(duplicateIds.length > 0 ? ["duplicate-id", "focus-required"] : []),
    ...(taskGraph && taskGraph.issues.length > 0 ? ["task-graph-invalid"] : []),
    ...(runBlocker !== null ? [runBlocker] : []),
    ...(bootstrapReasons(cwd).length > 0 ? ["bootstrap-incomplete"] : []),
  ]);

  // Bind the caller's Verification Summary to this checkout's HEAD through
  // the canonical subject digest (#241): the digest IS the content
  // identity, so a summary whose target digests to HEAD's tree speaks for
  // this checkout — commit and workspace spellings bind the same way. A
  // HEAD that cannot resolve (unborn branch, non-repo) proves nothing:
  // `boundToHead: null` keeps that failure distinct from a resolved-but-
  // different subject, which IS a target mismatch.
  const verification = options.verificationSummary === undefined
    ? null
    : (() => {
      const head = resolveCommitSubject(cwd, "HEAD");
      return {
        summary: options.verificationSummary,
        boundToHead: head === null
          ? null
          : options.verificationSummary.target.subjectDigest === head.subjectDigest,
        documents: knowledge.nodes
          .filter((node) => node.type === "verification")
          .map((node) => node.path)
          .sort(compareStrings),
      };
    })();

  const state: GraphState = {
    schemaVersion: 3,
    graphId,
    cwd,
    knowledge: { graph: knowledge, documents: records },
    execution: {
      run: run === null ? null : {
        runId: run.runId,
        status: run.status,
        focus: runFocusPaths(run.manifest.focus),
      },
      taskGraph,
    },
    verification,
    focus: resolution.focus,
    gates: {},
    signals: sortedUnique(options.signals ?? []),
    blockers,
    hardBlockers: [],
  };
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.gates = evaluateGraphGates(state);
  // The verification gate's blocker vocabulary (#241) is authoritative
  // routing state: a non-pass verification gate surfaces its reasons as
  // blockers so every route carries why verification cannot advance.
  if (state.gates.verification && state.gates.verification.status !== "pass") {
    state.blockers = sortedUnique([...state.blockers, ...state.gates.verification.reasons]);
  }
  state.signals = deriveSignals(state.signals, state.blockers, state.gates, taskGraph);
  state.hardBlockers = deriveHardBlockers(state.blockers, state.gates);
  return state;
}

export { sectionBody };

const ACTIVE_STATUSES_FOR_FOCUS = new Set([
  "draft", "proposed", "approved", "in-progress", "capturing",
  "confirmed", "routed", "active",
]);
