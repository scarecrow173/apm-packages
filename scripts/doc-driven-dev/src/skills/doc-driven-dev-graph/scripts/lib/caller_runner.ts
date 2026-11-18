/**
 * Production-grade caller protocol for the doc-driven-dev execution graph.
 *
 * runCaller() drives the public contract:
 *   Graph Definition -> fresh Graph State (one route_graph CLI call per hop)
 *   -> one declared route -> audits -> delegate -> edge checkpoint in the
 *   Execution Store -> commit gate -> re-enter at next -> repeat or yield.
 *
 * Effect dispatch is injected: callers supply an EffectDispatcher (LLM, tool,
 * or scripted adapter). This module owns outcome validation, Effect Receipt
 * and edge-checkpoint persistence in the Execution Store, the commit
 * baseline/gate, pending edge resume, bounded hops and per-edge dispatch
 * budgets, and run-level trace events — never effect work.
 *
 * Execution state lives in the per-run Execution Store under
 * .apm/state/doc-driven-dev/runs/<runId>/ (#236): every accepted `completed`
 * outcome is recorded as an Effect Receipt (`receipts/`), every edge
 * checkpoint as a CheckpointRecord (`checkpoints/`), and run-level events are
 * mirrored into `run_trace.jsonl` — the trace is diagnostic only and never
 * authoritative (see run-trace-contract.md). An Effect Receipt proves an
 * execution-side effect completed; it is deliberately distinct from a
 * verification-side Evidence Record (#240), which lives in a separate store.
 * No Git-managed Markdown under docs/tasks or elsewhere carries this
 * bookkeeping anymore (Issue #238).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import { generateArtifactId } from "../../../lib/artifact_id";
import {
  appendTrace as appendStoreTrace,
  createRun,
  loadRun,
  recordCheckpoint,
  recordReceipt,
  StoreError,
  type CheckpointRecord,
  type ReceiptRecord,
  type RunSnapshot,
  type StoreRootOptions,
  type TaskRecord,
} from "../../../lib/execution_store";
import { canonicalJson, isPlainObject } from "../../../lib/execution_store/types";
import { CANONICAL_DOC_DIRS, isInside } from "./artifact_graph";
import { loadGraphDefinition } from "./graph_definition";
import { resolveGraphPath } from "./graph_cli";
import type { GraphRoute } from "./graph_router";
import { EXECUTION_STATE_ROOT } from "../../../lib/schema_preflight";
import {
  appendTraceEvent,
  DISPATCH_METHODS,
  EXECUTION_MODES,
  type DispatchMethod,
  type ExecutionMode,
  type TraceEventInput,
} from "./run_trace";
import {
  buildDelegateHandoff,
  selectDelegateMode,
  toExecutionMode,
  type DelegateHandoff,
  type PolicyDecision,
  type PolicyFacts,
} from "./delegate_policy";

export type YieldReason =
  | "terminal" | "single-step-complete" | "budget-exhausted"
  | "approval-required" | "input-required" | "authority-required"
  | "unrecoverable-blocker" | "commit-required";

export type EffectYieldReason = Extract<YieldReason,
  "approval-required" | "input-required" | "authority-required" | "unrecoverable-blocker" | "commit-required">;

export type CallerEffect = { kind: "audit" | "delegate"; id: string };

/**
 * The typed input/output reference vocabulary for EffectOutcome (#238).
 * Every reference names one kind of authoritative target plus the version
 * bound at dispatch time:
 * - `durable-document`: canonical Markdown, pinned by path + front-matter id
 *   + `revision` (the sha256 fingerprint of its canonical content);
 * - `execution-task`: a task record inside THIS run's Execution Store,
 *   pinned by taskId + CAS `version` — the run id always appears with it;
 * - `provider`: an external side-effect handle, identified by provider +
 *   `idempotencyKey` — the key is the proof the provider itself dedupes on.
 */
export type DurableDocumentReference = {
  kind: "durable-document"; path: string; id: string; revision: string;
};
export type ExecutionTaskReference = {
  kind: "execution-task"; runId: string; taskId: string; version: number;
};
export type ProviderReference = {
  kind: "provider"; provider: string; idempotencyKey: string;
};
export type EffectReference = DurableDocumentReference | ExecutionTaskReference | ProviderReference;

/** The proof slot of a completed outcome: canonical content or a provider key. */
export type EffectProof = DurableDocumentReference | ProviderReference;

/**
 * What adapters may hand the runner where a reference is expected: a plain
 * path (shorthand for a durable document), a partial typed ref (the runner
 * binds the missing id/revision/version against current state), or a fully
 * resolved EffectReference.
 */
export type ReferenceSpec =
  | string
  | { kind: "durable-document"; path: string; id?: string; revision?: string }
  | { kind: "execution-task"; taskId: string; version?: number }
  | EffectReference;

export type CompletedEffectOutcome = {
  status: "completed"; edgeId: string; stage: "audit" | "delegate";
  effect: CallerEffect;
  inputs: EffectReference[]; outputs: EffectReference[];
  proof: EffectProof;
};
export type RetryEffectOutcome = {
  status: "retry"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  inputs: EffectReference[]; outputs: EffectReference[];
  retry: { changedOutputs: EffectReference[] };
};
export type YieldEffectOutcome = {
  status: "yield"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  inputs: EffectReference[]; outputs: EffectReference[];
  reason: EffectYieldReason;
};
export type EffectOutcome = CompletedEffectOutcome | RetryEffectOutcome | YieldEffectOutcome;

export type CommitBaseline = { head: string | null; dirty: string[] };

/** Thrown for every EffectOutcome contract violation — callers catch it. */
export class OutcomeRejection extends Error {}

/**
 * The store-side view reference checks run against: the bound run id, its
 * task records (execution-task liveness) and, where required, the recorded
 * receipts/checkpoints (reuse verification).
 */
export type EffectStoreView = {
  runId: string;
  tasks: ReadonlyArray<TaskRecord>;
};

/**
 * Default per-edge dispatch budget — the same order as the topology hop
 * base (10). The declared graph's heaviest edge dispatches 4 times per
 * clean pass (3 audits + 1 delegate), so 10 leaves honest retries several
 * re-routes of headroom while still bounding a pathological adapter.
 */
export const DEFAULT_MAX_DISPATCHES_PER_EDGE = 10;

export function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function filesystemEntryKind(target: string): string {
  if (!fs.existsSync(target)) return "missing";
  const entry = fs.statSync(target);
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

export function canonicalReference(repo: string, relativePath: string): DurableDocumentReference {
  if (relativePath === ".") {
    // The "." workspace fingerprint covers the canonical doc directories in
    // their declared order — CANONICAL_DOC_DIRS is the single authority.
    const entries = CANONICAL_DOC_DIRS.flatMap((directory) => {
      const target = path.join(repo, directory);
      return [
        `${directory}:${filesystemEntryKind(target)}`,
        `${directory}/README.md:${filesystemEntryKind(path.join(target, "README.md"))}`,
      ];
    });
    return {
      kind: "durable-document",
      path: relativePath,
      id: "WORKSPACE_ROOT",
      revision: fingerprint(entries.join("\n")),
    };
  }
  const file = path.join(repo, relativePath);
  const raw = fs.readFileSync(file, "utf8");
  // Execution Store records (runs/<run-id>/tasks/<id>.json et al.) are JSON,
  // not front-matter Markdown — their canonical identity is the record's own
  // id field and their canonical content is the file bytes the store wrote.
  if (relativePath.endsWith(".json")) {
    try {
      const record = JSON.parse(raw) as Record<string, unknown>;
      const id = ["taskId", "checkpointId", "receiptId", "runId"]
        .map((key) => record[key])
        .find((value) => typeof value === "string" && value.length > 0);
      if (id !== undefined) {
        return {
          kind: "durable-document",
          path: relativePath,
          id: id as string,
          revision: fingerprint(raw),
        };
      }
    } catch {
      // Not a JSON record — fall through to the front-matter path.
    }
  }
  const parsed = matter(raw);
  // Caller bookkeeping appended to a doc's front matter must not perturb the
  // artifact's own fingerprint — evidence references to the doc stay live.
  const { effectOutcomes: _outcomes, checkpointEvidence: _checkpoints, ...data } = parsed.data;
  // Store-managed run files (plan.md, run_trace.jsonl) carry no front-matter
  // id — like a record's own id field for JSON records, the path inside the
  // run tree is their canonical identity. Durable docs still require `id`.
  const posixPath = relativePath.split(path.sep).join("/");
  const storeId = posixPath.startsWith(`${EXECUTION_STATE_ROOT}/`) ? posixPath : undefined;
  return {
    kind: "durable-document",
    path: relativePath,
    id: (data.id ?? storeId) as string,
    revision: fingerprint(matter.stringify(parsed.content, data)),
  };
}

export function isDurableDocumentReference(value: unknown): value is DurableDocumentReference {
  return Boolean(value)
    && typeof value === "object"
    && (value as DurableDocumentReference).kind === "durable-document"
    && typeof (value as DurableDocumentReference).path === "string"
    && typeof (value as DurableDocumentReference).id === "string"
    && typeof (value as DurableDocumentReference).revision === "string";
}

export function isEffectReference(value: unknown): value is EffectReference {
  if (!value || typeof value !== "object") return false;
  const kind = (value as EffectReference).kind;
  if (kind === "durable-document") return isDurableDocumentReference(value);
  if (kind === "execution-task") {
    const ref = value as ExecutionTaskReference;
    return typeof ref.runId === "string" && ref.runId.length > 0
      && typeof ref.taskId === "string" && ref.taskId.length > 0
      && Number.isInteger(ref.version) && ref.version >= 1;
  }
  if (kind === "provider") {
    const ref = value as ProviderReference;
    return typeof ref.provider === "string" && ref.provider.length > 0
      && typeof ref.idempotencyKey === "string" && ref.idempotencyKey.length > 0;
  }
  return false;
}

export function durableDocumentMatches(repo: string, reference: DurableDocumentReference): boolean {
  if (path.isAbsolute(reference.path)) return false;
  const resolved = path.resolve(repo, reference.path);
  if (!isInside(repo, resolved) || !fs.existsSync(resolved)) return false;
  try {
    const current = canonicalReference(repo, reference.path);
    return current.id === reference.id && current.revision === reference.revision;
  } catch {
    return false;
  }
}

/**
 * Is the declared reference still bound to current state? A durable document
 * must resolve to the same id+revision; an execution task must exist inside
 * the bound run at the declared CAS version; a provider reference is "live"
 * by construction — its idempotency key is the proof, and only the run's
 * receipts can carry it.
 */
export function referenceIsLive(repo: string, store: EffectStoreView | undefined, reference: EffectReference): boolean {
  if (reference.kind === "durable-document") return durableDocumentMatches(repo, reference);
  if (reference.kind === "execution-task") {
    if (!store || reference.runId !== store.runId) return false;
    const task = store.tasks.find((entry) => entry.taskId === reference.taskId);
    return task !== undefined && task.version === reference.version;
  }
  return reference.provider.length > 0 && reference.idempotencyKey.length > 0;
}

/**
 * Resolve one ReferenceSpec against current state — a durable document gains
 * its current id/revision, an execution task its current version inside the
 * bound run. Returns null when the spec cannot resolve (missing doc, unknown
 * task, malformed shape): callers turn that into a fail-closed decision,
 * never a crash on untrusted declarations.
 */
export function resolveReference(
  repo: string,
  store: EffectStoreView | undefined,
  spec: ReferenceSpec,
): EffectReference | null {
  try {
    if (typeof spec === "string") {
      return canonicalReference(repo, spec);
    }
    if (!spec || typeof spec !== "object") return null;
    if (spec.kind === "durable-document") {
      return canonicalReference(repo, spec.path);
    }
    if (spec.kind === "execution-task") {
      if (!store) return null;
      const taskId = (spec as { taskId?: unknown }).taskId;
      if (typeof taskId !== "string" || taskId.length === 0) return null;
      const task = store.tasks.find((entry) => entry.taskId === taskId);
      if (!task) return null;
      const declaredVersion = (spec as { version?: unknown }).version;
      // A partial task spec binds the current record; a fully declared
      // version must name the current one — pinning an older version as
      // present state would silently accept a lost update.
      if (declaredVersion !== undefined && declaredVersion !== task.version) return null;
      return { kind: "execution-task", runId: task.runId, taskId: task.taskId, version: task.version };
    }
    if (spec.kind === "provider") {
      return isEffectReference(spec) ? spec : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a resolver-supplied spec list into the run's input binding: fully
 * resolved, deduplicated by canonical content, and stably ordered so both
 * sides of the outcome contract derive the identical array. Unresolvable
 * specs throw — an adapter contract bug, not a recoverable outcome.
 */
export function resolveReferenceSpecs(
  repo: string,
  store: EffectStoreView | undefined,
  specs: readonly ReferenceSpec[],
): EffectReference[] {
  const resolved = specs.map((spec) => {
    const reference = resolveReference(repo, store, spec);
    if (reference === null) {
      throw new Error(`reference spec does not resolve against current state: ${JSON.stringify(spec)}`);
    }
    return reference;
  });
  const unique = new Map<string, EffectReference>();
  for (const reference of resolved) unique.set(canonicalJson(reference), reference);
  return [...unique.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

/**
 * Input-scope identity, ignoring bound revisions: two bindings name the same
 * authoritative scope when they carry the same multiset of (kind + locator).
 * The revision is deliberately NOT part of the identity — a completed
 * effect's own work legitimately advances the docs it read (the pending-edge
 * commit-resume flow depends on this), while a scope change such as a
 * re-projected Task Graph adding a task document refuses reuse.
 */
function referenceIdentity(reference: EffectReference): string {
  switch (reference.kind) {
    case "durable-document": return `doc:${reference.path}:${reference.id}`;
    case "execution-task": return `task:${reference.taskId}`;
    case "provider": return `provider:${reference.provider}:${reference.idempotencyKey}`;
  }
}

function sameInputScope(declared: EffectReference[], resolved: EffectReference[]): boolean {
  if (declared.length !== resolved.length) return false;
  const left = declared.map(referenceIdentity).sort();
  const right = resolved.map(referenceIdentity).sort();
  return left.every((identity, index) => identity === right[index]);
}

// ---------------------------------------------------------------------------
// Effect Receipt records — the stored proof an effect completed
// ---------------------------------------------------------------------------

/**
 * The receipt's `input` payload: the dispatch scope it proves — the selected
 * edge, the stage, the effect identity, and the inputs bound at dispatch.
 */
export type EffectReceiptScope = {
  edgeId: string;
  stage: "audit" | "delegate";
  effect: CallerEffect;
  inputs: EffectReference[];
};

/** The receipt's `output` payload: the produced outputs plus the completion proof. */
export type EffectReceiptResult = {
  outputs: EffectReference[];
  proof: EffectProof;
};

function sanitizeRecordIdPart(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 40) : "effect";
}

/** Content-derived receipt id — identical outcomes re-record as a no-op. */
export function outcomeReceiptId(outcome: CompletedEffectOutcome): string {
  const payload = canonicalJson({
    edgeId: outcome.edgeId,
    stage: outcome.stage,
    effect: outcome.effect,
    inputs: outcome.inputs,
    outputs: outcome.outputs,
    proof: outcome.proof,
  });
  return `receipt-${outcome.stage}-${sanitizeRecordIdPart(outcome.effect.id)}-${fingerprint(payload).slice(0, 12)}`;
}

function parseReceiptScope(value: unknown): EffectReceiptScope | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.edgeId !== "string" || value.edgeId.length === 0) return null;
  if (value.stage !== "audit" && value.stage !== "delegate") return null;
  const effect = value.effect;
  if (!isPlainObject(effect)) return null;
  if ((effect.kind !== "audit" && effect.kind !== "delegate") || typeof effect.id !== "string") return null;
  if (!Array.isArray(value.inputs) || !value.inputs.every(isEffectReference)) return null;
  return {
    edgeId: value.edgeId,
    stage: value.stage,
    effect: { kind: effect.kind, id: effect.id },
    inputs: value.inputs as EffectReference[],
  };
}

function parseReceiptResult(value: unknown): EffectReceiptResult | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.outputs) || !value.outputs.every(isEffectReference)) return null;
  const proof = value.proof;
  if (!isEffectReference(proof) || proof.kind === "execution-task") return null;
  return { outputs: value.outputs as EffectReference[], proof };
}

/**
 * The stored receipt that proves exactly this outcome: matching dispatch
 * scope (edgeId/stage/effect/inputs) AND matching result payload
 * (outputs/proof). A claimed completion without its record — a caller-side
 * handoff edit, a lost write, a forged outcome — simply finds nothing.
 */
export function findOutcomeReceipt(
  receipts: ReadonlyArray<ReceiptRecord>,
  outcome: CompletedEffectOutcome,
): ReceiptRecord | null {
  const scope = {
    edgeId: outcome.edgeId,
    stage: outcome.stage,
    effect: outcome.effect,
    inputs: outcome.inputs,
  };
  const result = { outputs: outcome.outputs, proof: outcome.proof };
  for (const record of receipts) {
    if (record.status !== "success") continue;
    const parsedScope = parseReceiptScope(record.input);
    const parsedResult = parseReceiptResult(record.output);
    if (!parsedScope || !parsedResult) continue;
    if (isDeepStrictEqual(parsedScope, scope) && isDeepStrictEqual(parsedResult, result)) return record;
  }
  return null;
}

export function assertEffectOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  stage: "audit" | "delegate",
  effect: CallerEffect,
  expectedInputs: EffectReference[],
  store?: EffectStoreView,
): void {
  if (typeof outcome !== "object" || outcome === null) {
    throw new OutcomeRejection("EffectOutcome must be an object");
  }
  if (!["completed", "retry", "yield"].includes(outcome.status)) {
    throw new OutcomeRejection("unknown EffectOutcome status");
  }
  if (outcome.edgeId !== route.edgeId) {
    throw new OutcomeRejection(`EffectOutcome edgeId does not match route edge ${route.edgeId}`);
  }
  if (outcome.stage !== stage) {
    throw new OutcomeRejection(`EffectOutcome stage does not match dispatch stage ${stage}`);
  }
  if (!isDeepStrictEqual(outcome.effect, effect)) {
    throw new OutcomeRejection("EffectOutcome effect does not match the dispatched effect");
  }
  if (!Array.isArray(outcome.inputs)
      || outcome.inputs.length === 0
      || !outcome.inputs.every(isEffectReference)) {
    throw new OutcomeRejection("inputs must be a non-empty list of typed effect references");
  }
  // Dispatch-time binding is exact: the outcome attests the same resolved
  // refs the runner bound — revision included. A stale attestation rejects.
  if (!isDeepStrictEqual(outcome.inputs, expectedInputs)) {
    throw new OutcomeRejection("inputs do not match the resolved authoritative inputs");
  }
  if (!Array.isArray(outcome.outputs)
      || outcome.outputs.length === 0
      || !outcome.outputs.every(isEffectReference)) {
    throw new OutcomeRejection("outputs must be a non-empty list of typed effect references");
  }
  if (!outcome.outputs.every((reference) => referenceIsLive(repo, store, reference))) {
    throw new OutcomeRejection("outcome outputs must resolve current canonical state");
  }
  if (outcome.status === "completed") {
    if ("reason" in outcome) {
      throw new OutcomeRejection("completed outcome must not include reason");
    }
    if ("retry" in outcome) {
      throw new OutcomeRejection("completed outcome must not include retry");
    }
    // `unknown`: the outcome is untrusted adapter output — an execution-task
    // ref reaching this slot is a contract violation, not a type guarantee.
    const proof: unknown = outcome.proof;
    if (!isEffectReference(proof)) {
      throw new OutcomeRejection("completed outcome requires a typed proof reference");
    }
    if (proof.kind === "execution-task") {
      throw new OutcomeRejection("completed proof must be a durable-document or provider reference");
    }
    if (proof.kind === "durable-document" && !referenceIsLive(repo, store, proof)) {
      throw new OutcomeRejection("completed proof must resolve current canonical content");
    }
  } else if (outcome.status === "retry") {
    if ("proof" in outcome) {
      throw new OutcomeRejection("retry outcome must not include proof");
    }
    if ("reason" in outcome) {
      throw new OutcomeRejection("retry outcome must not include reason");
    }
    const changedOutputs = outcome.retry?.changedOutputs;
    if (!Array.isArray(changedOutputs)
        || changedOutputs.length === 0
        || !changedOutputs.every(isEffectReference)) {
      throw new OutcomeRejection("retry outcome must include non-empty typed changedOutputs");
    }
    // A retry must name verifiable changed state — a provider handle cannot
    // prove "the document changed"; only locally resolvable refs can.
    if (!changedOutputs.every((reference) => (
      reference.kind !== "provider" && referenceIsLive(repo, store, reference)
    ))) {
      throw new OutcomeRejection("retry changedOutputs must resolve current canonical state");
    }
  } else {
    if ("proof" in outcome) {
      throw new OutcomeRejection("yield outcome must not include proof");
    }
    if ("retry" in outcome) {
      throw new OutcomeRejection("yield outcome must not include retry");
    }
    if (!["approval-required", "input-required", "authority-required", "unrecoverable-blocker", "commit-required"]
      .includes(outcome.reason)) {
      throw new OutcomeRejection(`unknown yield reason: ${String(outcome.reason)}`);
    }
  }
}

/**
 * Reuse determination for a pending-edge completed outcome (the "stored
 * receipt 再利用判定"). Reuse refuses — the caller yields authority-required —
 * unless every gate passes: the outcome still validates against the fresh
 * scope, its declared input scope matches the freshly resolved one
 * (fingerprint/input-version drift on the effect's own outputs does not
 * count, a changed input set does), a stored receipt proves exactly this
 * outcome, and its proof still holds — a provider proof additionally
 * requires the recorded idempotency key (missing provider proof refuses).
 */
export function isReusableCompletedOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  expectedInputs: EffectReference[],
  store: EffectStoreView & { receipts: ReadonlyArray<ReceiptRecord> },
): boolean {
  if (outcome.status !== "completed") return false;
  // A real GraphRoute always declares `requiredAudits`; a route missing the
  // field binds no audits, so only the effect kind can be checked. A present
  // list must contain the audit effect (verbatim oracle semantics).
  const validEffect = outcome.stage === "audit"
    ? outcome.effect.kind === "audit"
      && (!Array.isArray(route.requiredAudits) || route.requiredAudits.includes(outcome.effect.id))
    : outcome.effect.kind === "delegate" && outcome.effect.id === route.delegate;
  if (!validEffect) return false;
  if (!sameInputScope(outcome.inputs, expectedInputs)) return false;
  try {
    // The outcome's own inputs stand as its scope attestation — scope
    // compatibility was just proven by sameInputScope, so the dispatch-time
    // exact-binding check binds against the attestation itself. Requiring
    // current revisions here would wrongly reject the pending-edge
    // commit-resume flow, where the delegate's own committed work
    // legitimately advanced the docs the edge's earlier effects read.
    assertEffectOutcome(repo, route, outcome, outcome.stage, outcome.effect, outcome.inputs, store);
  } catch {
    return false;
  }
  const receipt = findOutcomeReceipt(store.receipts, outcome);
  if (receipt === null) return false;
  if (outcome.proof.kind === "provider") {
    return receipt.idempotencyKey === outcome.proof.idempotencyKey;
  }
  return durableDocumentMatches(repo, outcome.proof);
}

export function evaluateEffectOutcome(outcome: EffectOutcome): EffectYieldReason | "retry" | null {
  if (outcome.status === "yield") return outcome.reason;
  if (outcome.status === "retry") return "retry";
  return null;
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function captureBaseline(repo: string): CommitBaseline {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.stdout.split("\n").filter((line) => line.length > 0).sort(),
  };
}

export function commitGatePasses(baseline: CommitBaseline, after: CommitBaseline): boolean {
  // Strict rule: HEAD advancing alone does not pass. The gate passes only when
  // every current porcelain entry was already present in the baseline. `head`
  // stays in the captured baseline for trace/debugging context only.
  const baselineDirty = new Set(baseline.dirty);
  return after.dirty.every((entry) => baselineDirty.has(entry));
}

export type EffectDispatchContext = {
  repo: string;
  /** The bound run — dispatchers producing execution-task refs use this id. */
  runId: string;
  route: GraphRoute;
  effect: CallerEffect;
  signals: ReadonlySet<string>;
  /**
   * The execution mode this dispatch is requested under: the policy
   * decision's mode projected onto the trace taxonomy, or the caller-
   * declared `executionMode` when no policy runs. The adapter must honor
   * it or decline — never silently switch (see DispatchResult).
   */
  requestedMode: ExecutionMode;
  /**
   * Present only when the policy decision selected a delegated mode
   * (`subagent-as-tool`/`isolated-subagent` → `tool`/`subagent`): the
   * #122 handoff the adapter must confine the dispatch to. Absent for
   * `same-context` requests — a caller-declared `executionMode` describes
   * the adapter's nature and never by itself delegates a dispatch.
   */
  handoff?: DelegateHandoff;
};

/**
 * The adapter's own report of one dispatch it performed. Exactly one
 * observation per DispatchResult must carry `target === effect.id` (the
 * self-observation); further entries record adapter-internal sub-dispatches
 * a composite delegate (e.g. briefing-flow) performed on the way to its
 * outcome — same-context inner skills, bounded research spawns, refusals.
 * `requested`/`actual` carry the trace ExecutionMode taxonomy; `method`
 * names the mechanism (`not-executed` only for a declined dispatch).
 */
export type DispatchObservation = {
  target: string;
  requested: ExecutionMode;
  actual: ExecutionMode;
  method: DispatchMethod;
};

/**
 * What an EffectDispatcher returns: the #122 outcome plus the adapter's
 * report of what it actually did. The runner emits every observation as a
 * `dispatch-observed` trace event and enforces the attribution contract on
 * the self-observation before validating the outcome:
 *
 * - `requested` must equal `ctx.requestedMode`;
 * - an executed dispatch (`method !== "not-executed"`) must report
 *   `actual === requestedMode` when the request named a mode — a mismatch
 *   is a silent-switch attempt and rejects like any outcome violation;
 * - `method: "not-executed"` (declined dispatch) requires a `yield`
 *   outcome — a refusal must not claim completed work.
 */
export type DispatchResult = {
  outcome: EffectOutcome;
  observations: DispatchObservation[];
};

/** Injected effect executor — an LLM, tool, or scripted adapter. */
export type EffectDispatcher = (ctx: EffectDispatchContext) => DispatchResult;

export type CallerRunnerOptions = {
  repo: string;
  /**
   * Spawn: executable [...prefixArgs, ...routeArgs]. The runner appends its
   * own routing flags after prefixArgs. Under Graph Route v3 there is no
   * task-doc scan root to pin (Issue #243): an adapter-supplied --task-dir
   * in prefixArgs reaches route_graph untouched, which rejects it — the
   * Execution Store is the only execution-state authority.
   */
  router: { executable: string; prefixArgs: string[] };
  /** Default: resolveGraphPath(undefined, repo). */
  graphPath?: string;
  /** Default: definition entry node. */
  current?: string;
  /** Default: []. */
  focus?: string[];
  /** Default: []. */
  signals?: string[];
  /**
   * Verification Summary file handed to every `route_graph` hop (Issue
   * #241): the exemption channel — a caller-produced summary carrying
   * validated waivers and not-applicable verdicts. The file is re-read on
   * EVERY hop, so the caller rewrites it as evidence lands; the gate
   * binds it to that hop's HEAD and refuses a stale one. Absent, the
   * router computes the summary itself from the live Evidence Store —
   * the default evidence-backed authority.
   */
  verificationSummary?: string;
  /** Default: "run-until-yield". */
  mode?: "run-until-yield" | "single-step";
  /** Explicit fixed budget; absent -> topology budget below. */
  maxHops?: number;
  /**
   * Default true: the first implementation-flow route freezes the hop budget
   * at 10 + (activeTasks - 1). Pass false to keep the plain topology budget.
   */
  taskBudget?: boolean;
  /**
   * Per-edge dispatch budget: the total number of effect dispatches one
   * pending edge may consume across re-routes, counted independently of
   * outcome payloads, route fingerprints, and hop completion. `hops` only
   * grows on completed edges and `repeatedRetry` only fires on a byte-
   * identical prior retry, so an adapter returning byte-distinct `retry`
   * outcomes would otherwise loop forever (#131). Reaching the budget yields
   * `budget-exhausted`. Default: {@link DEFAULT_MAX_DISPATCHES_PER_EDGE}.
   */
  maxDispatchesPerEdge?: number;
  /**
   * Run-level dispatch bound: every effect dispatch in the run counts once,
   * across all edges. The per-edge budget resets when routing selects a
   * different edge, so an adapter alternating retries across edges — each
   * staying under its own per-edge count — would otherwise loop forever;
   * hops and route fingerprints never grow because nothing completes.
   * Reaching the bound yields `budget-exhausted`. Default: the run's
   * current `maxHops` times `maxDispatchesPerEdge` — every hop's edge
   * consuming its full per-edge budget — so the bound stays generous yet
   * finite as the task-aware hop budget freezes upward.
   */
  maxTotalDispatches?: number;
  dispatcher: EffectDispatcher;
  /**
   * Execution Store binding. `runId` identifies the run under
   * `.apm/state/doc-driven-dev/runs/` (or the declared `stateRoot`); it is
   * created on first use when absent and is threaded through resume via
   * `CallerHandoff.runId`. `stateRoot`/`allowExternalRoot` pass through to
   * the store boundary unchanged.
   */
  store?: StoreRootOptions & { runId?: string };
  /** Adapter-owned authoritative input mapping, resolved to live typed refs. */
  resolveInputs: (route: GraphRoute, effect: CallerEffect) => ReferenceSpec[];
  /** Adapter-owned canonical output spec mapping (consumed by dispatchers). */
  resolveOutputPath: (route: GraphRoute, effect: CallerEffect) => ReferenceSpec;
  /**
   * Evidence-phase hook: applies the caller's canonical mutations for the
   * edge checkpoint and returns the produced references (paths or typed
   * refs) to bind alongside the edge's refreshed outcome outputs. A
   * declared ref that does not resolve current state fails the checkpoint
   * (`authority-required`), and absent hook declarations default to the
   * completed outcomes' outputs alone.
   */
  applyCheckpointEvidence?: (repo: string, signals: ReadonlySet<string>, edgeId: string) => ReferenceSpec[] | void;
  /** The dispatcher's nature, caller-declared; recorded on effect-dispatched. */
  executionMode?: ExecutionMode;
  /**
   * Optional per-effect execution-mode policy. When provided, each dispatch
   * feeds its facts through selectDelegateMode: the decision's mode overrides
   * `executionMode` on effect-dispatched, its reasons are recorded as
   * modeReason, and it becomes the dispatch's `requestedMode`. Absent, the
   * event carries the declared executionMode only.
   */
  policy?: (route: GraphRoute, effect: CallerEffect) => PolicyFacts;
  /**
   * Optional handoff builder for delegated dispatches (a policy decision of
   * `subagent-as-tool`/`isolated-subagent`). When absent the runner supplies
   * a minimal handoff: `focus`/`authoritativeInputs` from the resolved input
   * references, empty permissions (fail-closed write scope), default budget
   * and completion. A returned handoff whose `executionMode` differs from
   * the requested mode rejects the dispatch.
   */
  buildHandoff?: (args: {
    route: GraphRoute;
    effect: CallerEffect;
    decision: PolicyDecision;
    inputs: EffectReference[];
  }) => DelegateHandoff;
  trace?: { file: string; runId: string };
  resume?: CallerHandoff;
};

export type PendingEdge = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  /** CheckpointRecord id the evidence phase wrote for this pending edge. */
  evidenceCheckpointId: string | null;
  commitBaseline: CommitBaseline | null;
  /**
   * Effect dispatches this pending edge has consumed so far (#131). Counts
   * every dispatch — not only retries — and persists through the handoff
   * so the budget cannot be reset by serializing and resuming mid-edge.
   */
  dispatches: number;
};

/** JSON-serializable — callers may persist it across sessions. */
export type CallerHandoff = {
  /** The Execution Store run this handoff continues. */
  runId: string;
  current: string;
  mode: "run-until-yield" | "single-step";
  maxHops: number;
  maxDispatchesPerEdge: number;
  maxTotalDispatches: number;
  yieldReason: YieldReason | null;
  focus: string[];
  signals: string[];
  /** The verification-summary file path routed on, persisted for resume. */
  verificationSummary?: string;
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  taskBudgetCount: number | null;
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  outcomes: EffectOutcome[];
  pending: PendingEdge | null;
  /** Run-level count of every effect dispatch so far (#131). */
  totalDispatches: number;
  hops: number;
};

export type CallerRunResult = {
  routes: GraphRoute[];
  checkpoints: GraphRoute[];
  yieldReason: YieldReason | null;
  current: string;
  hops: number;
  outcomes: EffectOutcome[];
  completedEdges: string[];
  /** "route:<id>", "audit:<id>", "delegate:<id>", "checkpoint:<id>", "project". */
  events: string[];
  handoff: CallerHandoff;
};

/** The edge-checkpoint `data` payload recorded per completed evidence phase. */
export type EdgeCheckpointData = {
  edgeId: string;
  /** Receipt ids proving the edge's completed effects. */
  receipts: string[];
  /** The bound outputs: refreshed outcome outputs plus hook-declared refs. */
  outputs: EffectReference[];
  /** fingerprint(JSON.stringify(route)) — diagnostic, never a reuse gate. */
  routeHash: string;
};

function edgeCheckpointId(edgeId: string, data: EdgeCheckpointData): string {
  return `checkpoint-${sanitizeRecordIdPart(edgeId)}-${fingerprint(canonicalJson(data)).slice(0, 12)}`;
}

function parseCheckpointData(value: unknown): EdgeCheckpointData | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.edgeId !== "string" || value.edgeId.length === 0) return null;
  if (!Array.isArray(value.receipts) || !value.receipts.every((entry) => typeof entry === "string")) return null;
  if (!Array.isArray(value.outputs) || !value.outputs.every(isEffectReference)) return null;
  return {
    edgeId: value.edgeId,
    receipts: value.receipts as string[],
    outputs: value.outputs as EffectReference[],
    routeHash: typeof value.routeHash === "string" ? value.routeHash : "",
  };
}

/**
 * Drive the caller loop: spawn the route_graph CLI once per hop (a fresh
 * projection per process), run the declared audits then the delegate, record
 * the edge checkpoint in the Execution Store, enforce the commit gate, and
 * re-enter at next until the graph yields. All oracle `runScenario` semantics
 * are preserved; effect work is delegated to the injected dispatcher.
 */
export function runCaller(options: CallerRunnerOptions): CallerRunResult {
  const repo = options.repo;
  const graphPath = options.graphPath ?? options.resume?.graphPath ?? resolveGraphPath(undefined, repo);
  const definition = loadGraphDefinition(graphPath);
  const mode = options.resume?.mode ?? options.mode ?? "run-until-yield";
  const topologyBaseHops = 10;
  let taskBudgetCount = options.resume
    ? options.resume.taskBudgetCount
    : options.maxHops === undefined ? 0 : null;
  let taskBudgetFrozen = options.resume !== undefined || options.maxHops !== undefined || options.taskBudget === false;
  let maxHops = options.resume?.maxHops
    ?? options.maxHops
    ?? topologyBaseHops;
  const maxDispatchesPerEdge = options.resume?.maxDispatchesPerEdge
    ?? options.maxDispatchesPerEdge
    ?? DEFAULT_MAX_DISPATCHES_PER_EDGE;
  const configuredMaxTotalDispatches = options.resume?.maxTotalDispatches
    ?? options.maxTotalDispatches;
  // The default scales with the run's own budgets — evaluated at each check
  // so it tracks the task-aware maxHops freeze upward.
  const totalDispatchBound = (): number => configuredMaxTotalDispatches
    ?? maxHops * maxDispatchesPerEdge;
  const focus = options.focus ?? options.resume?.focus ?? [];
  const signals = new Set(options.signals ?? options.resume?.signals ?? []);
  // The verification-summary file path — option beats handoff, mirroring
  // signals; the file's CONTENTS are re-read each hop either way.
  const verificationSummary = options.verificationSummary ?? options.resume?.verificationSummary;
  let current = options.resume?.current ?? options.current ?? definition.entry;
  let hops = options.resume?.hops ?? 0;
  const routes: GraphRoute[] = [];
  const checkpoints: GraphRoute[] = [];
  const completedEdges = [...(options.resume?.completedEdges ?? [])];
  const seenRouteFingerprints = new Set(options.resume?.seenRouteFingerprints ?? []);
  const auditCounts = { ...(options.resume?.auditCounts ?? {}) };
  const delegateCounts = { ...(options.resume?.delegateCounts ?? {}) };
  const outcomes = [...(options.resume?.outcomes ?? [])];
  // Run-level dispatch count — seeded from the handoff so a resumed run
  // continues the same budget instead of restarting it. Handoffs written
  // before the field existed approximate it with the recorded outcome
  // count — every stored outcome was a dispatch.
  let totalDispatches = options.resume?.totalDispatches
    ?? (options.resume?.outcomes ?? []).length;
  const events: string[] = [];
  // A handoff written by a v2 runner carries a v2 pending route — refuse to
  // resume it into v3 routing (Issue #243): the run starts a fresh handoff
  // at the definition's entry rather than mixing schemas mid-edge.
  if (options.resume?.pending !== undefined && options.resume.pending !== null
      && (options.resume.pending.route as { schemaVersion?: unknown })?.schemaVersion !== 3) {
    throw new Error(
      "resume handoff carries a pre-v3 pending route — start a fresh run instead of resuming " +
      "(the recorded outcomes stay in the Execution Store; nothing is lost)");
  }
  let pending: PendingEdge | null = options.resume?.pending ? {
    route: options.resume.pending.route,
    outcomes: [...options.resume.pending.outcomes],
    completedAudits: [...options.resume.pending.completedAudits],
    delegateComplete: options.resume.pending.delegateComplete,
    evidenceRecorded: options.resume.pending.evidenceRecorded,
    evidenceCheckpointId: options.resume.pending.evidenceCheckpointId ?? null,
    commitBaseline: options.resume.pending.commitBaseline ?? null,
    // Handoffs written before the field existed keep their recorded
    // outcomes as the dispatch count — every stored outcome was a dispatch.
    dispatches: options.resume.pending.dispatches ?? options.resume.pending.outcomes.length,
  } : null;
  const trace = options.trace;
  const executionMode = options.executionMode ?? "unknown";

  // Execution Store binding (#238): the run carries receipts, checkpoints,
  // and the mirrored diagnostic trace. A declared run that does not exist
  // yet is materialized — binding a run id is declaring the run.
  const storeOptions: StoreRootOptions = {
    stateRoot: options.store?.stateRoot,
    allowExternalRoot: options.store?.allowExternalRoot,
  };
  if (options.resume?.runId !== undefined
      && options.store?.runId !== undefined
      && options.store.runId !== options.resume.runId) {
    throw new Error(`resume handoff runId ${options.resume.runId} does not match store.runId ${options.store.runId}`);
  }
  const runId = options.resume?.runId ?? options.store?.runId ?? generateArtifactId("RUN");
  let storeSnapshot: RunSnapshot;
  try {
    storeSnapshot = loadRun(repo, runId, storeOptions);
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === "run-not-found") {
      storeSnapshot = createRun(repo, { runId, graphId: definition.id, focus: [...focus] }, storeOptions);
    } else {
      throw error;
    }
  }
  const reloadStore = (): void => {
    storeSnapshot = loadRun(repo, runId, storeOptions);
  };
  const storeView = (): EffectStoreView & { receipts: ReadonlyArray<ReceiptRecord> } => ({
    runId,
    tasks: storeSnapshot.tasks,
    receipts: storeSnapshot.receipts,
  });
  // A resume handoff is the only continuation receipt reuse may honor: a
  // fresh leg on the same run id never adopts stored receipts — it is a new
  // execution, not the in-flight pending edge.
  const resumedRun = options.resume !== undefined;

  const traceRunId = trace?.runId ?? runId;
  let mirrorSeq = 0;
  const emitTrace = (input: TraceEventInput): void => {
    const event = { ...input, runId: traceRunId };
    let seq = ++mirrorSeq;
    if (trace) {
      try {
        seq = appendTraceEvent(trace.file, event).seq;
      } catch (error: unknown) {
        // Diagnostics never fail a run.
        console.error(`run trace append failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      // run_trace.jsonl mirrors the same diagnostic event — non-authoritative
      // by contract; the run's receipts/checkpoints are the only proof.
      appendStoreTrace(repo, runId, { ...event, seq }, storeOptions);
    } catch (error: unknown) {
      console.error(`store trace append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const routeOnce = (): GraphRoute => {
    const args = [
      ...options.router.prefixArgs,
      "--graph", graphPath,
      "--cwd", repo,
      "--current", current,
      ...focus.flatMap((entry) => ["--focus", entry]),
      ...[...signals].flatMap((signal) => ["--signal", signal]),
      ...(verificationSummary ? ["--verification-summary", verificationSummary] : []),
      // Graph Route v3 (Issue #243): no corpus-scan flags — execution state
      // comes from the Execution Store run the projection resolves itself.
      // An adapter that still emits v2 routes is refused below.
      "--json",
      ...(trace ? ["--trace-file", trace.file, "--run-id", trace.runId] : []),
    ];
    const result = spawnSync(options.router.executable, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`route_graph invocation failed: ${result.stderr || result.error?.message || result.stdout}`);
    }
    let route: GraphRoute;
    try {
      route = JSON.parse(result.stdout) as GraphRoute;
    } catch {
      throw new Error(`route_graph invocation failed: ${result.stderr || result.stdout}`);
    }
    // Fail closed on any non-v3 route payload (Issue #243): a stale
    // route_graph binary or a v2 adapter is migration-domain — never
    // silently routed. A `proofPath` field is a pre-v3 handoff marker and
    // is refused the same way.
    if (route?.schemaVersion !== 3 || "proofPath" in (route as object)) {
      throw new Error(
        `route_graph returned a non-v3 route (schemaVersion ${(route as { schemaVersion?: unknown })?.schemaVersion ?? "missing"}) — ` +
        "the deployed graph scripts are out of date; rebuild the package or migrate the workspace " +
        "(doc_maintenance.js migrate plan --json)");
    }
    return route;
  };

  const resolveEffectInputs = (route: GraphRoute, effect: CallerEffect): EffectReference[] => {
    return resolveReferenceSpecs(repo, storeView(), options.resolveInputs(route, effect));
  };

  /**
   * Record one accepted completed outcome as an Effect Receipt — the only
   * channel by which an effect's completion becomes authoritative (#238).
   * The record is content-keyed, so a re-record of the identical outcome is
   * an idempotent no-op. `actor` attributes the dispatch mode/method the
   * adapter reported.
   */
  const recordOutcomeReceipt = (outcome: CompletedEffectOutcome, actor: string | null): void => {
    recordReceipt(repo, runId, {
      receiptId: outcomeReceiptId(outcome),
      effect: `${outcome.effect.kind}:${outcome.effect.id}`,
      taskId: null,
      idempotencyKey: outcome.proof.kind === "provider" ? outcome.proof.idempotencyKey : null,
      actor,
      status: "success",
      input: {
        edgeId: outcome.edgeId,
        stage: outcome.stage,
        effect: outcome.effect,
        inputs: outcome.inputs,
      } satisfies EffectReceiptScope,
      output: {
        outputs: outcome.outputs,
        proof: outcome.proof,
      } satisfies EffectReceiptResult,
    }, storeOptions);
    reloadStore();
  };

  /**
   * Stored-receipt adoption for a resumed run whose pending edge was lost
   * mid-edge (the crash window): a receipt recorded before the crash proves
   * the effect ran under this exact scope, so the stage may be skipped
   * without re-dispatch. Adoption is strict: scope identity must match the
   * freshly resolved inputs, every recorded output must still resolve
   * current state, and a provider proof requires its idempotency key —
   * anything less and the stage simply re-dispatches.
   */
  const adoptStoredReceipt = (
    route: GraphRoute,
    stage: "audit" | "delegate",
    effect: CallerEffect,
    expectedInputs: EffectReference[],
  ): CompletedEffectOutcome | null => {
    if (!resumedRun) return null;
    for (const record of storeSnapshot.receipts) {
      if (record.status !== "success") continue;
      const scope = parseReceiptScope(record.input);
      const result = parseReceiptResult(record.output);
      if (!scope || !result) continue;
      if (scope.edgeId !== route.edgeId || scope.stage !== stage) continue;
      if (!isDeepStrictEqual(scope.effect, effect)) continue;
      if (!sameInputScope(scope.inputs, expectedInputs)) continue;
      if (!result.outputs.every((reference) => referenceIsLive(repo, storeView(), reference))) continue;
      if (result.proof.kind === "provider") {
        if (record.idempotencyKey !== result.proof.idempotencyKey) continue;
      } else if (!durableDocumentMatches(repo, result.proof)) {
        continue;
      }
      return {
        status: "completed",
        edgeId: route.edgeId as string,
        stage,
        effect,
        // The receipt's recorded scope is replayed verbatim — byte-identity
        // with the stored record is the whole point of adoption. Binding the
        // freshly resolved `expectedInputs` instead would synthesize an
        // outcome whose content-keyed receipt id does not exist in
        // `receipts/` (checkpoint `data.receipts` would dangle) and whose
        // input revisions a later resume cannot match in
        // `findOutcomeReceipt` — a false `authority-required`.
        inputs: scope.inputs,
        outputs: result.outputs,
        proof: result.proof,
      };
    }
    return null;
  };

  /**
   * Dispatch one effect: emit effect-dispatched before execution, hand the
   * dispatcher the requested mode (and a #122 handoff when the policy
   * delegated), then record what the adapter reports as dispatch-observed
   * events before validation. assertEffectOutcome remains the sole
   * input-binding enforcer and runs before any receipt is recorded; the
   * observation contract is enforced first — a dispatch that misreports its
   * own mode is a contract breach identical to a malformed outcome.
   * Accepted outcomes emit effect-outcome; rejected ones leave the dispatch
   * and observation events as the forensic record (no outcome event, no
   * recorded receipt).
   */
  const dispatchEffect = (
    route: GraphRoute,
    stage: "audit" | "delegate",
    effect: CallerEffect,
  ): { outcome: EffectOutcome; actor: string | null } | { rejection: OutcomeRejection } => {
    const expectedInputs = resolveEffectInputs(route, effect);
    const decision = options.policy
      ? selectDelegateMode(options.policy(route, effect))
      : undefined;
    const requestedMode: ExecutionMode = decision ? toExecutionMode(decision.mode) : executionMode;
    emitTrace({
      v: 1, runId: traceRunId, kind: "effect-dispatched",
      edgeId: route.edgeId as string, stage, effectId: effect.id,
      executionMode: requestedMode,
      focusPaths: expectedInputs
        .filter((entry): entry is DurableDocumentReference => entry.kind === "durable-document")
        .map((entry) => entry.path),
      ...(decision ? { modeReason: decision.reasons.join(";") } : {}),
    });
    // A handoff exists only when the policy decision delegated the dispatch.
    // The declared executionMode ("tool" for a scripted adapter, say) is the
    // adapter's nature — it never delegates by itself, so it gets no handoff.
    let handoff: DelegateHandoff | undefined;
    if (decision && decision.mode !== "same-context") {
      handoff = options.buildHandoff
        ? options.buildHandoff({ route, effect, decision, inputs: expectedInputs })
        : buildDelegateHandoff({
            mode: requestedMode,
            focus: expectedInputs
              .filter((entry): entry is DurableDocumentReference => entry.kind === "durable-document")
              .map((entry) => entry.path),
            inputs: expectedInputs,
          });
    }
    try {
      // A delegated decision must carry a handoff — an absent or falsy one
      // would run the dispatch unscoped, and a mode-mismatched one means the
      // delegate executes under a different contract than the runner
      // recorded. Both reject like any outcome violation.
      if (decision && decision.mode !== "same-context" && !handoff) {
        throw new OutcomeRejection(
          `delegated dispatch on ${effect.id} requires a DelegateHandoff — an absent one would run unscoped`,
        );
      }
      if (handoff && handoff.executionMode !== requestedMode) {
        throw new OutcomeRejection(
          `delegate handoff executionMode ${handoff.executionMode} does not match requested mode ${requestedMode}`,
        );
      }
      const result = options.dispatcher({ repo, runId, route, effect, signals, requestedMode, handoff });
      // Observation entries are adapter output — untrusted input at this
      // boundary. Every entry is structurally validated BEFORE any event is
      // emitted: a malformed observation rejects like a malformed outcome
      // instead of reaching the trace as a null-dereference or a silently
      // dropped normalize failure.
      const rawObservations = Array.isArray(result?.observations) ? result.observations : [];
      const observations = rawObservations.map((entry: DispatchObservation, index: number) => {
        const observation = entry as DispatchObservation | null | undefined;
        const valid = observation !== null && typeof observation === "object"
          && typeof observation.target === "string" && observation.target.length > 0
          && EXECUTION_MODES.includes(observation.requested)
          && EXECUTION_MODES.includes(observation.actual)
          && DISPATCH_METHODS.includes(observation.method);
        if (!valid) {
          throw new OutcomeRejection(
            `dispatch observation ${index} is malformed — target must be a non-empty string`
            + ` and requested/actual/method must be declared enum members`,
          );
        }
        return observation;
      });
      for (const observation of observations) {
        emitTrace({
          v: 1, runId: traceRunId, kind: "dispatch-observed",
          edgeId: route.edgeId as string, stage, effectId: effect.id,
          target: observation.target,
          requested: observation.requested,
          actual: observation.actual,
          method: observation.method,
        });
      }
      if (!result || typeof result !== "object" || !result.outcome || typeof result.outcome !== "object") {
        throw new OutcomeRejection("DispatchResult must carry an outcome object");
      }
      // Attribution contract on the self-observation — enforced before the
      // outcome is trusted. Internal sub-dispatch records (target ≠
      // effect.id) are the adapter's own report and are not re-checked here.
      const self = observations.filter((observation) => observation.target === effect.id);
      if (self.length !== 1) {
        throw new OutcomeRejection(
          `dispatch must report exactly one self-observation (target === ${effect.id}), got ${self.length}`,
        );
      }
      if (self[0].requested !== requestedMode) {
        throw new OutcomeRejection(
          `dispatch observation requested mode ${self[0].requested} does not match the request ${requestedMode}`,
        );
      }
      if (self[0].method === "not-executed") {
        if (result.outcome.status !== "yield") {
          throw new OutcomeRejection("a declined dispatch (not-executed) must return a yield outcome");
        }
      } else if (requestedMode !== "unknown" && self[0].actual !== requestedMode) {
        throw new OutcomeRejection(
          `dispatch executed in mode ${self[0].actual}, not the requested ${requestedMode} — mode switches are never silent`,
        );
      }
      // Refresh the store view post-dispatch: a dispatched effect may
      // legitimately have written task records (execution-task refs bind
      // the versions present now).
      reloadStore();
      assertEffectOutcome(repo, route, result.outcome, stage, effect, expectedInputs, storeView());
      emitTrace({
        v: 1, runId: traceRunId, kind: "effect-outcome",
        edgeId: route.edgeId as string, stage, effectId: effect.id,
        outcome: result.outcome.status,
        ...(result.outcome.status === "yield" ? { reason: result.outcome.reason } : {}),
        outputPaths: result.outcome.outputs
          .filter((entry): entry is DurableDocumentReference => entry.kind === "durable-document")
          .map((entry) => entry.path),
      });
      return { outcome: result.outcome, actor: `${self[0].actual}/${self[0].method}` };
    } catch (error: unknown) {
      if (error instanceof OutcomeRejection) return { rejection: error };
      throw error;
    }
  };

  const savePending = (
    route: GraphRoute,
    edgeOutcomes: EffectOutcome[],
    evidenceRecorded: boolean,
    evidenceCheckpointId: string | null,
    dispatches: number,
    commitBaseline: CommitBaseline | null = null,
  ): void => {
    const completedAudits = edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id)
      .sort();
    const delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    pending = {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits,
      delegateComplete,
      evidenceRecorded,
      evidenceCheckpointId,
      commitBaseline,
      dispatches,
    };
  };

  /**
   * The stored checkpoint the pending edge's evidence phase recorded —
   * verified fresh: the record must exist, bind this edge, and every bound
   * output must still resolve current state.
   */
  const checkpointIsVerified = (checkpointId: string | null, edgeId: string): boolean => {
    if (checkpointId === null) return false;
    const record = storeSnapshot.checkpoints.find((entry) => entry.checkpointId === checkpointId);
    if (!record || record.edgeId !== edgeId) return false;
    const data = parseCheckpointData(record.data);
    if (data === null || data.edgeId !== edgeId) return false;
    // Every receipt id the checkpoint names must be a recorded receipt in
    // this run — a dangling id means the checkpoint claims proof that was
    // never persisted.
    const receiptIds = new Set(storeSnapshot.receipts.map((entry) => entry.receiptId));
    return data.receipts.every((receiptId) => receiptIds.has(receiptId))
      && data.outputs.every((reference) => referenceIsLive(repo, storeView(), reference));
  };

  let yieldReason: YieldReason | null = null;
  let firstRoute = true;
  hopLoop: while (yieldReason === null) {
    if (!firstRoute) events.push("project");
    firstRoute = false;
    const route = routeOnce();
    routes.push(route);
    events.push(`route:${route.edgeId ?? route.status}`);
    // The store view is reloaded per hop: resume checks and adoption read
    // post-crash/leg state, never a stale in-memory snapshot.
    reloadStore();

    if (!taskBudgetFrozen && route.delegate === "implementation-flow") {
      if (!route.taskGraph || route.taskGraph.issues.length !== 0) {
        throw new Error("implementation-flow route requires a selected Task Graph without issues");
      }
      taskBudgetCount = route.taskGraph.nodes
        .filter((task) => ["todo", "in-progress", "blocked"].includes(task.status))
        .length;
      maxHops = topologyBaseHops + Math.max(0, taskBudgetCount - 1);
      taskBudgetFrozen = true;
    }

    if (route.status === "terminal") {
      yieldReason = "terminal";
      break;
    }
    if (route.status === "blocked") {
      yieldReason = route.blockers.includes("focus-required") || route.blockers.includes("focus-invalid")
        ? "input-required"
        : "unrecoverable-blocker";
      break;
    }
    if (hops >= maxHops) {
      yieldReason = "budget-exhausted";
      break;
    }

    // The identical-reroute bound compares routing semantics, not CAS
    // metadata: a task record's `version` bumps on every store write, so an
    // honest repair loop that restores the same task statuses would never
    // produce a byte-identical route. Stripping it keeps the bound a true
    // "no progress" detector (Issue #237).
    const routeFingerprint = JSON.stringify(route, (key, value) => (key === "version" ? undefined : value));
    if (seenRouteFingerprints.has(routeFingerprint)) {
      yieldReason = "budget-exhausted";
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    // Per-edge dispatch budget (#131): the count lives on the pending edge,
    // so re-routes of the same edge — whether the prior outcome was an
    // identical retry or a byte-distinct one — all draw down one budget.
    // A different selected edge starts its own count.
    let edgeDispatches = resumingPending?.dispatches ?? 0;
    if (resumingPending) {
      const invalidReceipt = resumingPending.outcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .some((outcome) => !isReusableCompletedOutcome(
          repo,
          route,
          outcome,
          resolveEffectInputs(route, outcome.effect),
          storeView(),
        ));
      const unverifiedCheckpoint = resumingPending.evidenceRecorded
        && !checkpointIsVerified(resumingPending.evidenceCheckpointId, route.edgeId as string);
      if (invalidReceipt || unverifiedCheckpoint) {
        yieldReason = "authority-required";
        break;
      }
    }

    const commitBaseline = resumingPending?.commitBaseline
      ?? (route.commitGate && !signals.has("commit-waived") ? captureBaseline(repo) : null);

    const edgeOutcomes = [...(resumingPending?.outcomes ?? [])];
    const completedAudits = new Set(edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id));
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      const effect: CallerEffect = { kind: "audit", id: audit };
      const expectedInputs = resolveEffectInputs(route, effect);
      const adopted = adoptStoredReceipt(route, "audit", effect, expectedInputs);
      if (adopted) {
        edgeOutcomes.push(adopted);
        outcomes.push(adopted);
        completedAudits.add(audit);
        continue;
      }
      // Two dispatch bounds guard every effect: the pending edge's own
      // budget and the run total — the latter catches retries rotated
      // across different edges, which reset the per-edge count.
      if (edgeDispatches >= maxDispatchesPerEdge
          || totalDispatches >= totalDispatchBound()) {
        yieldReason = "budget-exhausted";
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      events.push(`audit:${audit}`);
      edgeDispatches += 1;
      totalDispatches += 1;
      const dispatched = dispatchEffect(route, "audit", effect);
      if ("rejection" in dispatched) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      const outcome = dispatched.outcome;
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      if (outcome.status === "completed") recordOutcomeReceipt(outcome, dispatched.actor);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        // A retry promises changed outputs; an identical retry outcome on an
        // identical re-route can never progress, so the run stops instead of
        // looping forever (the oracle bounded this with its finite step list).
        // Distinct payloads fall through to the per-edge dispatch budget.
        const repeatedRetry = edgeOutcomes.slice(0, -1)
          .some((prior) => JSON.stringify(prior) === JSON.stringify(outcome));
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        if (repeatedRetry) {
          yieldReason = "budget-exhausted";
          break hopLoop;
        }
        continue hopLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }

    let delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    if (route.delegate && !delegateComplete) {
      const effect: CallerEffect = { kind: "delegate", id: route.delegate };
      const expectedInputs = resolveEffectInputs(route, effect);
      const adopted = adoptStoredReceipt(route, "delegate", effect, expectedInputs);
      if (adopted) {
        edgeOutcomes.push(adopted);
        outcomes.push(adopted);
        delegateComplete = true;
      }
    }
    if (route.delegate && !delegateComplete) {
      if (edgeDispatches >= maxDispatchesPerEdge
          || totalDispatches >= totalDispatchBound()) {
        yieldReason = "budget-exhausted";
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      events.push(`delegate:${route.delegate}`);
      const effect: CallerEffect = { kind: "delegate", id: route.delegate };
      edgeDispatches += 1;
      totalDispatches += 1;
      const dispatched = dispatchEffect(route, "delegate", effect);
      if ("rejection" in dispatched) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      const outcome = dispatched.outcome;
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      if (outcome.status === "completed") recordOutcomeReceipt(outcome, dispatched.actor);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        const repeatedRetry = edgeOutcomes.slice(0, -1)
          .some((prior) => JSON.stringify(prior) === JSON.stringify(outcome));
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        if (repeatedRetry) {
          yieldReason = "budget-exhausted";
          break hopLoop;
        }
        continue hopLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break hopLoop;
      }
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    let evidenceRecorded = false;
    let evidenceCheckpointId: string | null = null;
    if (resumingPending?.evidenceRecorded === true
        && checkpointIsVerified(resumingPending.evidenceCheckpointId, route.edgeId as string)) {
      evidenceRecorded = true;
      evidenceCheckpointId = resumingPending.evidenceCheckpointId;
    }
    if (!evidenceRecorded) {
      // Evidence phase: the caller hook applies its canonical mutations and
      // declares produced refs; the checkpoint then binds the edge's
      // refreshed outcome outputs plus the hook's declarations. A declared
      // ref that fails to resolve refuses the checkpoint — the runner never
      // asserts unverifiable evidence.
      const declared = options.applyCheckpointEvidence?.(repo, signals, route.edgeId as string) ?? [];
      const declaredRefs = declared.map((spec) => resolveReference(repo, storeView(), spec));
      const refreshed: Array<EffectReference | null> = edgeOutcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .flatMap((outcome) => outcome.outputs)
        .map((reference) => resolveReference(repo, storeView(), reference));
      const invalidDeclaration = declaredRefs.some((reference) => reference === null)
        || refreshed.some((reference) => reference === null);
      const boundOutputs = [...declaredRefs, ...refreshed]
        .filter((reference): reference is EffectReference => reference !== null);
      const unique = new Map<string, EffectReference>();
      for (const reference of boundOutputs) unique.set(canonicalJson(reference), reference);
      const outputs = [...unique.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      if (invalidDeclaration || !outputs.every((reference) => referenceIsLive(repo, storeView(), reference))) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, null, edgeDispatches, commitBaseline);
        break;
      }
      const data: EdgeCheckpointData = {
        edgeId: route.edgeId as string,
        receipts: edgeOutcomes
          .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
          .map((outcome) => outcomeReceiptId(outcome)),
        outputs,
        routeHash: fingerprint(JSON.stringify(route)),
      };
      const recorded = recordCheckpoint(repo, runId, {
        checkpointId: edgeCheckpointId(route.edgeId as string, data),
        nodeId: route.next,
        edgeId: route.edgeId as string,
        taskId: null,
        data,
      }, storeOptions);
      evidenceRecorded = true;
      evidenceCheckpointId = recorded.checkpoint.checkpointId;
      reloadStore();
    }
    events.push(`checkpoint:${route.edgeId}`);
    if (commitBaseline && !signals.has("commit-waived")) {
      const after = captureBaseline(repo);
      if (!commitGatePasses(commitBaseline, after)) {
        yieldReason = "commit-required";
        savePending(route, edgeOutcomes, true, evidenceCheckpointId, edgeDispatches, commitBaseline);
        break;
      }
    }
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    seenRouteFingerprints.add(routeFingerprint);
    hops += 1;
    current = route.next;

    if (mode === "single-step") {
      yieldReason = "single-step-complete";
      break;
    }
  }

  const handoff: CallerHandoff = {
    runId,
    current,
    mode,
    maxHops,
    maxDispatchesPerEdge,
    maxTotalDispatches: totalDispatchBound(),
    yieldReason,
    focus: [...focus],
    signals: [...signals].sort(),
    verificationSummary,
    graphPath,
    completedEdges,
    seenRouteFingerprints: [...seenRouteFingerprints],
    taskBudgetCount,
    auditCounts,
    delegateCounts,
    outcomes,
    pending,
    totalDispatches,
    hops,
  };
  if (yieldReason !== null) {
    emitTrace({
      v: 1, runId: traceRunId, kind: "run-yield",
      reason: yieldReason, hops, completedEdges: [...completedEdges],
    });
  }
  return {
    routes,
    checkpoints,
    yieldReason,
    current,
    hops,
    outcomes,
    completedEdges,
    events,
    handoff: JSON.parse(JSON.stringify(handoff)) as CallerHandoff,
  };
}
