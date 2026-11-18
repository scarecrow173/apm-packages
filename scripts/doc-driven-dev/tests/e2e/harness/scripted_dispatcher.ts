/**
 * Scripted effect dispatcher for the deterministic e2e harness. It replaces
 * the LLM/tool that a production caller would inject: every audit/delegate
 * outcome is scripted per edge, built from REAL canonical references over the
 * fixture's authoritative-input mapping (ported verbatim from the in-process
 * oracle's effectInputPaths/effectEvidencePath, run-to-yield lines 282–317).
 *
 * The dispatcher is intentionally dumb: it produces contract-shaped outcomes
 * and applies minimal document mutators — it never self-grades (no gate
 * checks, no expectation logic). Determinism: no clocks, no randomness; all
 * references derive from file content.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  resolveReference,
  resolveReferenceSpecs,
  type CallerEffect,
  type CompletedEffectOutcome,
  type DispatchObservation,
  type DispatchResult,
  type EffectDispatcher,
  type EffectOutcome,
  type EffectProof,
  type EffectReference,
  type EffectStoreView,
  type EffectYieldReason,
  type ReferenceSpec,
  type RetryEffectOutcome,
  type YieldEffectOutcome,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { DispatchMethod, ExecutionMode } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import type { TaskStatus } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";
import {
  approvePlan,
  loadRun,
  savePlan,
  updateRun,
  updateTask,
} from "../../../src/skills/lib/execution_store";
import { commitAll, E2E_RUN_ID, updateArtifact, VERIFICATION_DOC, writeArtifact } from "./fixture_manager";

// The primary task doc is the task-graph fallback input — canonical content,
// not per-run bookkeeping (receipts/checkpoints live in the Execution Store).
export const DEFAULT_TASK_DOC = "docs/tasks/0001-task.md";
export const DEFAULT_TASK_ID = "TASK-0001";
// The `test-spec` audit's Document Registry 3 successor scope — `test-spec`
// itself is legacy migration-only; verification intent is durable.
export { VERIFICATION_DOC };

const canonicalDocumentPaths = (taskDoc: string): string[] => [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  "docs/test-specs/0001-graph.md",
  taskDoc,
  "docs/impl/ir/0001-task.md",
  VERIFICATION_DOC,
];

/**
 * Execution-bound task scope: the run's task records keyed by the projected
 * Task Graph node ids. `plan` and `task` audit names refuse at the Registry 3
 * gate (`audit_docs.js --type <name>`), but the declared graph still lists
 * them — the scripted adapter audits the state directly and binds the task
 * records as `execution-task` refs, never `docs/tasks` durable documents.
 * The projected plan likewise has no durable form; its realized scope is the
 * same task record set. Falls back to the primary task id when the route
 * carries no Task Graph projection.
 */
function taskRefSpecs(route: GraphRoute): ReferenceSpec[] {
  const nodes = route.taskGraph?.nodes;
  if (!nodes || nodes.length === 0) return [{ kind: "execution-task", taskId: DEFAULT_TASK_ID }];
  return nodes.map((node): ReferenceSpec => ({ kind: "execution-task", taskId: node.id }));
}

/** Authoritative-input mapping (oracle `effectInputPaths`, verbatim). */
export function standardResolveInputs(
  route: GraphRoute,
  effect: CallerEffect,
  taskDoc: string = DEFAULT_TASK_DOC,
): ReferenceSpec[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "plan": return taskRefSpecs(route);
      case "task": return taskRefSpecs(route);
      case "test-spec": return [VERIFICATION_DOC];
      case "impl-record": return ["docs/impl/ir/0001-task.md"];
      case "experiment-log": return ["docs/impl/exp/README.md"];
      case "all": return canonicalDocumentPaths(taskDoc);
    }
  }
  switch (effect.id) {
    case "migrate_docs": return canonicalDocumentPaths(taskDoc);
    case "scaffold_docs": return ["."];
    case "build_task_graph": {
      // The delegate projects the selected Task Graph — its inputs are the
      // run's task records, and a route without a projection cannot supply
      // them. The pre-v3 plan path is intentionally not bound: the plan is
      // run state (manifest planDigest), not a durable document.
      if (!route.taskGraph || route.taskGraph.nodes.length === 0) {
        throw new Error("Missing selected Task Graph for build_task_graph");
      }
      return taskRefSpecs(route);
    }
    case "briefing-flow": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "design-doc": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "planning-flow": return ["docs/designs/0001-graph.md"];
    case "implementation-flow": return [...taskRefSpecs(route), "docs/designs/0001-graph.md"];
    case "doc-status": return canonicalDocumentPaths(taskDoc);
    default: throw new Error(`No authoritative-input mapping for ${effect.kind}:${effect.id}`);
  }
}

/**
 * Canonical output mapping (oracle `effectEvidencePath`, verbatim). A durable
 * document output is a path spec; `planning-flow`'s durable work product
 * under Registry 3 is the verification-intent document (its plan/test-spec
 * records are execution-bound and surface as `execution-task` outputs, not
 * the primary proof).
 */
export function standardResolveOutputPath(
  route: GraphRoute,
  effect: CallerEffect,
  taskDoc: string = DEFAULT_TASK_DOC,
): ReferenceSpec {
  if (effect.kind === "audit") return standardResolveInputs(route, effect, taskDoc)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    case "planning-flow": return VERIFICATION_DOC;
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "doc-status": return "docs/impl/ir/0001-task.md";
    default: return standardResolveInputs(route, effect, taskDoc)[0];
  }
}

export type OutcomeSpec =
  | "completed" | "retry" | { yield: EffectYieldReason }
  | { malformed: "missing-proof" | "scope-mismatch" | "stale-revision" | "wrong-edge" };

export type Mutator =
  | { write: { path: string; frontmatter?: Record<string, unknown>; body?: string } }
  | { set: { path: string; frontmatter: Record<string, unknown> } }
  | { append: { path: string; body: string } }
  | { commit: true } // commitAll(repo) — git inside the fixture repo only
  // Execution Store mutators (Issue #237): the run's records are the task
  // authority — a `task` mutator patches the record via updateTask (create
  // or CAS-less write), `plan` re-saves plan.md (invalidating approvals
  // bound to the old digest), `approve` binds the current digest, and
  // `runFocus` rewrites the manifest's chain binding.
  | { task: { taskId: string; title?: string; status?: TaskStatus; dependsOn?: string[]; checks?: string[]; scope?: string[] } }
  | { plan: { content: string } }
  | { approve: { actor?: string } }
  | { runFocus: { focus: string[] } };

/**
 * One adapter-internal sub-dispatch a composite delegate performs. This is
 * how the scripted adapter simulates briefing-flow's inner skill fan-out —
 * spec-doc/adr-doc running as same-context skills vs an independent
 * `research` dispatch under a delegated mode. Each entry produces one
 * `dispatch-observed` trace event: what the adapter actually did, not a
 * relabel of the top-level dispatch.
 */
export type SubDispatchSpec = {
  /** Internal target id recorded on the observation (e.g. "spec-doc", "research"). */
  target: string;
  /** Mode the internal dispatch is requested under; default "same-context". */
  requested?: ExecutionMode;
  /**
   * Mechanism the adapter reports; default `inline-skill` for same-context
   * requests and `subagent-spawn` for delegated ones. A delegated sub-dispatch
   * genuinely runs the bounded path: its mutators are scope-checked against
   * `writeScope` before any write, so the method reflects different behavior,
   * not a label.
   */
  method?: DispatchMethod;
  /** Mutators applied by this sub-dispatch, in order. */
  mutate?: Mutator[];
  /**
   * Permitted write scope for the bounded path — `pathInScope` grammar:
   * trailing-`/` prefix or exact path match, no globs. Required for a
   * delegated sub-dispatch that mutates — absent means fail-closed refusal;
   * a mutator outside it (or a path-less `commit` mutator) is refused as an
   * unauthorized change. Ignored for same-context sub-dispatches (they run
   * in the caller's context, like the top-level inline path).
   */
  writeScope?: string[];
  /** Adapter declines outright — e.g. the host cannot execute the mode. */
  refuse?: boolean;
  /**
   * The sub-dispatch executes but its returned reference does not resolve
   * current canonical content — the simulated host rejects the return and
   * the delegate fails instead of completing on a stale output.
   */
  staleReturn?: boolean;
  /** Report an actual mode different from the request — dishonest adapter. */
  reportActual?: ExecutionMode;
};

export type EdgeScript = {
  /** Queue form is consumed per dispatch of that audit; scalar repeats. */
  audits?: Record<string, OutcomeSpec | OutcomeSpec[]>;
  delegate?: OutcomeSpec | OutcomeSpec[];
  /** Applied when the delegate outcome resolves to "completed". */
  mutate?: Mutator[];
  /**
   * Internal dispatch plan for a composite delegate, fired when the delegate
   * outcome resolves to "completed". Scalar repeats per delegate dispatch;
   * queue form (array of plans) is consumed one plan per delegate dispatch.
   * A refused or rejected sub-dispatch forces the delegate outcome to a
   * `yield authority-required` — the delegate never completes over a breach.
   */
  subDispatches?: SubDispatchSpec[] | SubDispatchSpec[][];
  /**
   * Report a different `actual` mode on this delegate's self-observation —
   * simulates an adapter that silently switched modes; the runner's
   * attribution check must reject the dispatch.
   */
  reportActual?: ExecutionMode;
  /** runCase's evidence phase: declare the task doc + commitAll for the edge. */
  commitEvidence?: boolean;
};

/** Apply one mutator inside the fixture repo — document or store record. */
export function applyMutator(repo: string, mutator: Mutator, runId: string = E2E_RUN_ID): void {
  if ("write" in mutator) {
    const { path: rel, frontmatter, body } = mutator.write;
    const file = path.join(repo, rel);
    const parsed = fs.existsSync(file) ? matter(fs.readFileSync(file, "utf8")) : null;
    writeArtifact(repo, rel, { ...(parsed?.data ?? {}), ...(frontmatter ?? {}) }, body ?? parsed?.content ?? "");
  } else if ("set" in mutator) {
    updateArtifact(repo, mutator.set.path, mutator.set.frontmatter);
  } else if ("append" in mutator) {
    const file = path.join(repo, mutator.append.path);
    const parsed = matter(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, matter.stringify(parsed.content + mutator.append.body, parsed.data), "utf8");
  } else if ("task" in mutator) {
    const { taskId, ...patch } = mutator.task;
    // CAS read-modify-write: updates pin the record's current version,
    // creates pass no expectation (the store refuses either misuse).
    const current = loadRun(repo, runId).tasks.find((task) => task.taskId === taskId);
    updateTask(repo, runId, taskId, patch, { expectedVersion: current?.version });
  } else if ("plan" in mutator) {
    savePlan(repo, runId, mutator.plan.content);
  } else if ("approve" in mutator) {
    approvePlan(repo, runId, { actor: mutator.approve.actor ?? "e2e" });
  } else if ("runFocus" in mutator) {
    updateRun(repo, runId, { focus: mutator.runFocus.focus });
  } else {
    commitAll(repo);
  }
}

/** The bound run's task records — the store view execution-task specs resolve against. */
function storeView(repo: string, runId: string): EffectStoreView {
  const snapshot = loadRun(repo, runId);
  return { runId: snapshot.runId, tasks: snapshot.tasks };
}

function inputReferences(
  repo: string,
  runId: string,
  route: GraphRoute,
  effect: CallerEffect,
  taskDoc: string,
): EffectReference[] {
  // The same resolution the runner applies to resolveInputs specs — the
  // outcome's `inputs` attestation must deep-equal the runner's binding.
  return resolveReferenceSpecs(repo, storeView(repo, runId), standardResolveInputs(route, effect, taskDoc));
}

function outputReference(
  repo: string,
  runId: string,
  route: GraphRoute,
  effect: CallerEffect,
  taskDoc: string,
): EffectReference {
  const reference = resolveReference(repo, storeView(repo, runId), standardResolveOutputPath(route, effect, taskDoc));
  if (reference === null) {
    throw new Error(`output spec does not resolve current state: ${effect.kind}:${effect.id}`);
  }
  return reference;
}

function completedOutcome(
  repo: string,
  runId: string,
  route: GraphRoute,
  stage: "audit" | "delegate",
  effect: CallerEffect,
  inputs: EffectReference[],
  output: EffectReference,
  taskDoc: string,
): CompletedEffectOutcome {
  const outputs = effect.id === "planning-flow"
    // Registry 3 work product: the durable verification-intent document plus
    // the run's task records — never the pre-v3 plan/test-spec durable docs.
    ? resolveReferenceSpecs(repo, storeView(repo, runId), [VERIFICATION_DOC, ...taskRefSpecs(route)])
    : [output];
  const proof: EffectProof = output.kind === "execution-task"
    // An execution-task ref can never be a proof; the store attests the
    // task-bound work through a provider-scoped idempotency key instead.
    ? { kind: "provider", provider: "execution-store", idempotencyKey: `${output.runId}:${output.taskId}@${output.version}` }
    : output;
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    inputs,
    outputs,
    proof,
  };
}

function buildOutcome(
  spec: OutcomeSpec,
  ctx: {
    repo: string; runId: string; route: GraphRoute; stage: "audit" | "delegate"; effect: CallerEffect;
    inputs: EffectReference[]; output: EffectReference; taskDoc: string;
  },
): EffectOutcome {
  const { repo, runId, route, stage, effect, inputs, output, taskDoc } = ctx;
  if (spec === "completed") {
    return completedOutcome(repo, runId, route, stage, effect, inputs, output, taskDoc);
  }
  if (spec === "retry") {
    const outcome: RetryEffectOutcome = {
      status: "retry",
      edgeId: route.edgeId as string,
      stage,
      effect,
      inputs,
      outputs: [output],
      retry: { changedOutputs: [output] },
    };
    return outcome;
  }
  if (typeof spec === "object" && "yield" in spec) {
    const outcome: YieldEffectOutcome = {
      status: "yield",
      edgeId: route.edgeId as string,
      stage,
      effect,
      inputs,
      outputs: [output],
      reason: spec.yield,
    };
    return outcome;
  }
  if (typeof spec === "object" && "malformed" in spec) {
    const completed = completedOutcome(repo, runId, route, stage, effect, inputs, output, taskDoc);
    switch (spec.malformed) {
      case "missing-proof":
        return { ...completed, proof: {} } as EffectOutcome;
      case "scope-mismatch":
        return { ...completed, inputs: [] };
      case "stale-revision":
        // A well-formed ref that no longer resolves current state — a durable
        // doc claims a dead revision, a task record a dead CAS version.
        return {
          ...completed,
          outputs: [output.kind === "execution-task"
            ? { ...output, version: output.version + 1000 }
            : output.kind === "provider"
              ? { ...output, idempotencyKey: `${output.idempotencyKey}-stale` }
              : { ...output, revision: "0".repeat(64) }],
        };
      case "wrong-edge":
        return { ...completed, edgeId: `${route.edgeId as string}-wrong` };
    }
  }
  throw new Error(`Unknown outcome spec: ${JSON.stringify(spec)}`);
}

/**
 * The repo-relative path a mutator writes; `{commit:true}` and the store
 * mutators touch no repo path — store records are never writable repo
 * scope, so a delegated sub-dispatch carrying one is refused outright.
 */
function mutatorPath(mutator: Mutator): string | null {
  if ("write" in mutator) return mutator.write.path;
  if ("set" in mutator) return mutator.set.path;
  if ("append" in mutator) return mutator.append.path;
  return null;
}

/**
 * Scope membership on repo-relative paths (posix-normalized): a scope ending
 * in `/` is a prefix match (`docs/specs/` covers its subtree); anything else
 * is an exact-path match. No glob syntax — `docs/specs/**` is a literal
 * string that matches nothing.
 */
export function pathInScope(relativePath: string, scopes: readonly string[]): boolean {
  const rel = relativePath.split(path.sep).join("/");
  return scopes.some((scope) => {
    const normalized = scope.split(path.sep).join("/");
    return normalized.endsWith("/") ? rel.startsWith(normalized) : rel === normalized;
  });
}

/**
 * Build an EffectDispatcher from a per-edge outcome script. Unscripted
 * effects follow `onUnhandled` ("throw" by default — no silent defaults);
 * an exhausted queue always throws (a script bug must fail deterministically).
 *
 * The adapter reports honest DispatchObservations: its self-observation is
 * `method: "scripted"` (it IS a scripted simulation) with `actual` equal to
 * the request it honored — same-context effects mutate inline, delegated
 * requests run the handoff's write scope. `unsupportedModes` simulates a
 * host that cannot execute a mode: the dispatch declines (not-executed +
 * yield), it never silently switches.
 */
export function scriptedDispatcher(options: {
  repo: string;
  taskDoc?: string;
  script: Record<string, EdgeScript>;
  onUnhandled?: "throw" | "completed";
  /** Modes the simulated host cannot execute — dispatching one is refused. */
  unsupportedModes?: readonly ExecutionMode[];
}): EffectDispatcher {
  const taskDoc = options.taskDoc ?? DEFAULT_TASK_DOC;
  const onUnhandled = options.onUnhandled ?? "throw";
  const unsupported = new Set<ExecutionMode>(options.unsupportedModes ?? []);
  const queues = new Map<string, OutcomeSpec[]>();
  const subPlans = new Map<string, SubDispatchSpec[][]>();
  for (const [edgeId, edgeScript] of Object.entries(options.script)) {
    for (const [auditId, spec] of Object.entries(edgeScript.audits ?? {})) {
      if (Array.isArray(spec)) queues.set(`${edgeId}${auditId}`, [...spec]);
    }
    if (Array.isArray(edgeScript.delegate)) queues.set(`${edgeId}delegate`, [...edgeScript.delegate]);
    if (Array.isArray(edgeScript.subDispatches?.[0])) {
      subPlans.set(`${edgeId}subDispatches`, [...edgeScript.subDispatches] as SubDispatchSpec[][]);
    }
  }

  const scriptedSpec = (edgeId: string, effect: CallerEffect): OutcomeSpec | undefined => {
    const edgeScript = options.script[edgeId];
    if (!edgeScript) return undefined;
    if (effect.kind === "audit") {
      const spec = edgeScript.audits?.[effect.id];
      if (spec === undefined) return undefined;
      if (Array.isArray(spec)) {
        const queue = queues.get(`${edgeId}${effect.id}`) ?? [];
        const next = queue.shift();
        if (next === undefined) {
          throw new Error(`scriptedDispatcher: outcome queue exhausted for ${effect.kind}:${effect.id} on ${edgeId}`);
        }
        return next;
      }
      return spec;
    }
    const spec = edgeScript.delegate;
    if (spec === undefined) return undefined;
    if (Array.isArray(spec)) {
      const queue = queues.get(`${edgeId}delegate`) ?? [];
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(`scriptedDispatcher: outcome queue exhausted for delegate on ${edgeId}`);
      }
      return next;
    }
    return spec;
  };

  const subDispatchPlan = (edgeId: string): SubDispatchSpec[] => {
    const declared = options.script[edgeId]?.subDispatches;
    if (!declared) return [];
    if (!Array.isArray(declared[0])) return declared as SubDispatchSpec[];
    const queue = subPlans.get(`${edgeId}subDispatches`) ?? [];
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`scriptedDispatcher: subDispatches queue exhausted on ${edgeId}`);
    }
    return next;
  };

  const delegated = (mode: ExecutionMode): boolean => mode === "tool" || mode === "subagent";

  /**
   * Fire one edge's internal dispatch plan: every entry produces an
   * observation; a refusal (unsupported mode, unauthorized write scope,
   * explicit `refuse`) or a rejected return (`staleReturn`) fails the
   * delegate's internal pipeline — the adapter then yields authority-
   * required instead of claiming a completed delegate over a breach.
   */
  const runSubDispatches = (
    repo: string,
    edgeId: string,
  ): { observations: DispatchObservation[]; failed: boolean } => {
    const observations: DispatchObservation[] = [];
    for (const sub of subDispatchPlan(edgeId)) {
      const requested = sub.requested ?? "same-context";
      const mutators = sub.mutate ?? [];
      const writePaths = mutators.map(mutatorPath).filter((p): p is string => p !== null);
      // A delegated sub-dispatch mutating without a declared writeScope is a
      // fail-closed contract breach — like a handoff that grants no writes.
      // A path-less mutator ({commit:true}) is unauthorized outright: a
      // commit is caller-phase work, not dispatch work, and no writeScope can
      // express it — the bounded spawn may not commit.
      const scope = sub.writeScope;
      const unauthorized = delegated(requested)
        && (mutators.some((mutator) => mutatorPath(mutator) === null)
          || (writePaths.length > 0
            && (scope === undefined || !writePaths.every((p) => pathInScope(p, scope)))));
      const declined = sub.refuse === true || unsupported.has(requested) || unauthorized;
      if (declined) {
        observations.push({ target: sub.target, requested, actual: "unknown", method: "not-executed" });
        return { observations, failed: true };
      }
      for (const mutator of mutators) applyMutator(repo, mutator);
      observations.push({
        target: sub.target,
        requested,
        actual: sub.reportActual ?? requested,
        method: sub.method ?? (delegated(requested) ? "subagent-spawn" : "inline-skill"),
      });
      // The sub-dispatch executed but returned a reference that no longer
      // resolves current content — the host rejects it and the delegate fails.
      if (sub.staleReturn === true) return { observations, failed: true };
    }
    return { observations, failed: false };
  };

  return (ctx): DispatchResult => {
    const { repo, route, effect, requestedMode } = ctx;
    const edgeId = route.edgeId as string;
    const stage = effect.kind;
    const self = (actual: ExecutionMode, method: DispatchMethod): DispatchObservation => (
      { target: effect.id, requested: requestedMode, actual, method }
    );
    const refused = (): DispatchResult => {
      const inputs = inputReferences(repo, ctx.runId, route, effect, taskDoc);
      const output = outputReference(repo, ctx.runId, route, effect, taskDoc);
      const outcome = buildOutcome(
        { yield: "authority-required" },
        { repo, runId: ctx.runId, route, stage, effect, inputs, output, taskDoc },
      );
      return { outcome, observations: [self("unknown", "not-executed")] };
    };

    let spec = scriptedSpec(edgeId, effect);
    if (spec === undefined) {
      if (onUnhandled === "throw") {
        throw new Error(`scriptedDispatcher: no scripted outcome for ${effect.kind}:${effect.id} on edge ${edgeId}`);
      }
      spec = "completed";
    }
    // Capability gate: the adapter declines a mode it cannot execute.
    if (unsupported.has(requestedMode)) return refused();
    // Authoritative inputs are what the effect READ — resolved before any
    // mutator runs so they match the runner's pre-dispatch expectedInputs
    // binding (a mutator that touches an input doc must not break it).
    const inputs = inputReferences(repo, ctx.runId, route, effect, taskDoc);
    // Mutators are the completed delegate's work product: they run before
    // the output ref is bound so it reflects post-mutation content. A
    // delegated top-level dispatch confines them to the handoff write scope
    // — a write outside it is refused as an unauthorized change.
    const mutators = effect.kind === "delegate" && spec === "completed"
      ? options.script[edgeId]?.mutate ?? []
      : [];
    if (ctx.handoff) {
      // Mutators are confined to the handoff write scope; a path-less
      // mutator ({commit:true}) is refused outright — commits are
      // caller-phase work and no permission scope can express them.
      const unscoped = mutators.some((mutator) => mutatorPath(mutator) === null);
      const writePaths = mutators.map(mutatorPath).filter((p): p is string => p !== null);
      if (unscoped || !writePaths.every((p) => pathInScope(p, ctx.handoff!.permissions.write))) {
        return refused();
      }
    }
    for (const mutator of mutators) applyMutator(repo, mutator);

    const subObservations: DispatchObservation[] = [];
    let subFailed = false;
    if (effect.kind === "delegate" && spec === "completed") {
      const subs = runSubDispatches(repo, edgeId);
      subObservations.push(...subs.observations);
      subFailed = subs.failed;
    }
    const output = outputReference(repo, ctx.runId, route, effect, taskDoc);
    const outcome = subFailed
      ? buildOutcome(
          { yield: "authority-required" },
          { repo, runId: ctx.runId, route, stage, effect, inputs, output, taskDoc },
        )
      : buildOutcome(spec, { repo, runId: ctx.runId, route, stage, effect, inputs, output, taskDoc });
    return {
      outcome,
      observations: [
        self(options.script[edgeId]?.reportActual ?? requestedMode, "scripted"),
        ...subObservations,
      ],
    };
  };
}
