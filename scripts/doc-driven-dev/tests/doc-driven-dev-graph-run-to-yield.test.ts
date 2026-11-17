import type { GraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import type { GraphRoute } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { TaskStatus } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import matter from "gray-matter";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import { routeGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type {
  CallerEffect,
  CompletedEffectOutcome,
  DurableDocumentReference,
  EffectOutcome,
  EffectProof,
  EffectReference,
  ReferenceSpec,
  RetryEffectOutcome,
  YieldEffectOutcome,
} from "../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import {
  createRun,
  loadRun,
  recordCheckpoint,
  recordReceipt,
  StoreError,
  type CheckpointRecord,
  type ReceiptRecord,
  type RunSnapshot,
} from "../src/skills/lib/execution_store";
import { canonicalJson, isPlainObject } from "../src/skills/lib/execution_store/types";

type YieldReason =
  | "approval-required"
  | "input-required"
  | "authority-required"
  | "unrecoverable-blocker"
  | "budget-exhausted"
  | "commit-required"
  | "terminal"
  | "single-step-complete";

type ScenarioMode = "single-step" | "run-until-yield";

type EffectYieldReason = Extract<YieldReason,
  "approval-required" | "input-required" | "authority-required" | "unrecoverable-blocker" | "commit-required">;

type EffectIdentity = CallerEffect;

type ScenarioStep = {
  expectEdge: string | null;
  applyCheckpointEvidence?: (repo: string, signals: Set<string>) => ReferenceSpec[] | void;
  audit?: (repo: string, signals: Set<string>, route: GraphRoute, audit: string) => EffectOutcome;
  delegate?: (repo: string, signals: Set<string>, route: GraphRoute) => EffectOutcome;
  yield?: YieldReason;
  observeOnly?: boolean;
};

type CommitBaseline = { head: string | null; dirty: string[] };

type PendingEdge = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  evidenceCheckpointId: string | null;
  commitBaseline: CommitBaseline | null;
};

type EdgeTrace = {
  route: GraphRoute;
  outcomes: EffectOutcome[];
  completedAudits: string[];
  delegate: string | null;
  delegateComplete: boolean;
  evidenceRecorded: boolean;
  checkpointComplete: boolean;
  commitWaived: boolean;
};

type ScenarioHandoff = {
  runId: string;
  current: string;
  mode: ScenarioMode;
  maxHops: number;
  taskBudgetCount: number | null;
  yieldReason: YieldReason | null;
  focus: string[];
  signals: string[];
  graphPath: string;
  completedEdges: string[];
  seenRouteFingerprints: string[];
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  checkpoints: GraphRoute[];
  edgeTrace: EdgeTrace[];
  outcomes: EffectOutcome[];
  pending: PendingEdge | null;
  hops: number;
};

type GraphRunResult = {
  status: "yielded";
  reason: YieldReason;
  route: GraphRoute;
  outcomes: EffectOutcome[];
  trace: EdgeTrace[];
  handoff: ScenarioHandoff;
};

type ScenarioOptions = {
  repo: string;
  current: string;
  mode: ScenarioMode;
  steps: ScenarioStep[];
  maxHops?: number;
  focus?: string[];
  signals?: string[];
  graphPath?: string;
  runId?: string;
  resume?: ScenarioHandoff;
};

type ScenarioResult = {
  routes: GraphRoute[];
  checkpoints: GraphRoute[];
  yieldReason: YieldReason | null;
  current: string;
  projectCalls: number;
  events: string[];
  auditCounts: Record<string, number>;
  delegateCounts: Record<string, number>;
  outcomes: EffectOutcome[];
  handoff: ScenarioHandoff;
  graphRun?: GraphRunResult;
};

const canonicalGraphPath = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
);
const canonicalTargets = [
  "docs/ideas",
  "docs/discovery",
  "docs/specs",
  "docs/designs",
  "docs/plans",
  "docs/tasks",
  "docs/test-specs",
  "docs/adr",
  "docs/impl/ir",
  "docs/impl/exp",
  "docs/knowledge",
  "docs/verification",
];

function writeArtifact(repo: string, relativePath: string, data: Record<string, unknown>, body: string): void {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, matter.stringify(body, {
    created: "2026-08-24",
    updated: "2026-08-24",
    owners: [],
    relations: {},
    ...data,
  }), "utf8");
}

function updateArtifact(repo: string, relativePath: string, data: Record<string, unknown>): void {
  const file = path.join(repo, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, ...data }), "utf8");
}

// The fixture's primary task doc: the task-graph fallback input and the doc
// each edge checkpoint binds — canonical content, never run bookkeeping
// (receipts/checkpoints live in the Execution Store).
const primaryTaskDoc = "docs/tasks/0001-task.md";
const canonicalDocumentPaths = [
  "docs/specs/0001-graph.md",
  "docs/adr/0001-graph.md",
  "docs/designs/0001-graph.md",
  "docs/plans/0001-graph.md",
  "docs/test-specs/0001-graph.md",
  primaryTaskDoc,
  "docs/impl/ir/0001-task.md",
];
const footerDelegates = new Set([
  "briefing-flow",
  "design-doc",
  "planning-flow",
  "implementation-flow",
  "doc-status",
]);
const callerNormalizedDelegates = new Set(["migrate_docs", "scaffold_docs", "build_task_graph"]);
const callerNormalizedAudits = new Set(["spec", "adr", "design", "plan", "task", "test-spec", "impl-record", "experiment-log", "all"]);

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function filesystemEntryKind(target: string): string {
  if (!fs.existsSync(target)) return "missing";
  const entry = fs.statSync(target);
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

function canonicalReference(repo: string, relativePath: string): DurableDocumentReference {
  if (relativePath === ".") {
    const entries = canonicalTargets.flatMap((directory) => {
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
  const parsed = matter(fs.readFileSync(file, "utf8"));
  return {
    kind: "durable-document",
    path: relativePath,
    id: parsed.data.id as string,
    revision: fingerprint(matter.stringify(parsed.content, parsed.data)),
  };
}

function isCallerNormalizedEffect(stage: EffectOutcome["stage"], effectId: string): boolean {
  return stage === "audit" ? callerNormalizedAudits.has(effectId) : callerNormalizedDelegates.has(effectId);
}

function taskGraphPaths(route: GraphRoute): string[] {
  return route.taskGraph?.nodes.map((node) => node.path) ?? [primaryTaskDoc];
}

function selectedTaskGraphPlanPath(route: GraphRoute): string {
  const plan = route.taskGraph?.plan;
  if (typeof plan !== "string" || plan.length === 0) {
    throw new Error("Missing selected Task Graph plan for build_task_graph");
  }
  return plan;
}

function effectInputPaths(route: GraphRoute, effect: EffectIdentity): string[] {
  if (effect.kind === "audit") {
    switch (effect.id) {
      case "spec": return ["docs/specs/0001-graph.md"];
      case "adr": return ["docs/adr/0001-graph.md"];
      case "design": return ["docs/designs/0001-graph.md"];
      case "plan": return ["docs/plans/0001-graph.md"];
      case "task": return taskGraphPaths(route);
      case "test-spec": return ["docs/test-specs/0001-graph.md"];
      case "impl-record": return ["docs/impl/ir/0001-task.md"];
      case "experiment-log": return ["docs/impl/exp/README.md"];
      case "all": return canonicalDocumentPaths;
    }
  }
  switch (effect.id) {
    case "migrate_docs": return canonicalDocumentPaths;
    case "scaffold_docs": return ["."];
    case "build_task_graph": return [selectedTaskGraphPlanPath(route), ...taskGraphPaths(route)];
    case "briefing-flow": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "design-doc": return ["docs/specs/0001-graph.md", "docs/adr/0001-graph.md"];
    case "planning-flow": return ["docs/designs/0001-graph.md"];
    case "implementation-flow": return [...taskGraphPaths(route), "docs/designs/0001-graph.md", "docs/plans/0001-graph.md"];
    case "doc-status": return canonicalDocumentPaths;
    default: throw new Error(`No authoritative-input mapping for ${effect.kind}:${effect.id}`);
  }
}

function effectOutputPath(route: GraphRoute, effect: EffectIdentity): string {
  if (effect.kind === "audit") return effectInputPaths(route, effect)[0];
  switch (effect.id) {
    case "design-doc": return "docs/designs/0001-graph.md";
    case "planning-flow": return "docs/plans/0001-graph.md";
    case "implementation-flow": return "docs/impl/ir/0001-task.md";
    case "doc-status": return "docs/impl/ir/0001-task.md";
    default: return effectInputPaths(route, effect)[0];
  }
}

function resolvedInputs(repo: string, route: GraphRoute, effect: EffectIdentity): EffectReference[] {
  return resolveReferenceSpecs(repo, undefined, effectInputPaths(route, effect));
}

function outputReference(repo: string, route: GraphRoute, effect: EffectIdentity): DurableDocumentReference {
  return canonicalReference(repo, effectOutputPath(route, effect));
}

function completedOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  provider?: { provider: string; idempotencyKey: string },
): CompletedEffectOutcome {
  const output = outputReference(repo, route, effect);
  const outputs = effect.id === "planning-flow"
    ? [
        output,
        canonicalReference(repo, "docs/test-specs/0001-graph.md"),
        ...taskGraphPaths(route).map((relativePath) => canonicalReference(repo, relativePath)),
      ]
    : [output];
  const proof: EffectProof = provider
    ? { kind: "provider", provider: provider.provider, idempotencyKey: provider.idempotencyKey }
    : output;
  return {
    status: "completed",
    edgeId: route.edgeId as string,
    stage,
    effect,
    inputs: resolvedInputs(repo, route, effect),
    outputs,
    proof,
  };
}

function yieldOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  reason: EffectYieldReason,
): YieldEffectOutcome {
  return {
    status: "yield",
    edgeId: route.edgeId as string,
    stage,
    effect,
    inputs: resolvedInputs(repo, route, effect),
    outputs: [outputReference(repo, route, effect)],
    reason,
  };
}

function retryOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  changedOutputs: EffectReference[],
): RetryEffectOutcome {
  return {
    status: "retry",
    edgeId: route.edgeId as string,
    stage,
    effect,
    inputs: resolvedInputs(repo, route, effect),
    outputs: [outputReference(repo, route, effect)],
    retry: { changedOutputs },
  };
}

function isDurableDocumentReference(value: unknown): value is DurableDocumentReference {
  return Boolean(value)
    && typeof value === "object"
    && (value as DurableDocumentReference).kind === "durable-document"
    && typeof (value as DurableDocumentReference).path === "string"
    && typeof (value as DurableDocumentReference).id === "string"
    && typeof (value as DurableDocumentReference).revision === "string";
}

function isEffectReference(value: unknown): value is EffectReference {
  if (!value || typeof value !== "object") return false;
  const kind = (value as EffectReference).kind;
  if (kind === "durable-document") return isDurableDocumentReference(value);
  if (kind === "execution-task") {
    const ref = value as { runId?: unknown; taskId?: unknown; version?: unknown };
    return typeof ref.runId === "string" && ref.runId.length > 0
      && typeof ref.taskId === "string" && ref.taskId.length > 0
      && Number.isInteger(ref.version) && (ref.version as number) >= 1;
  }
  if (kind === "provider") {
    const ref = value as { provider?: unknown; idempotencyKey?: unknown };
    return typeof ref.provider === "string" && ref.provider.length > 0
      && typeof ref.idempotencyKey === "string" && ref.idempotencyKey.length > 0;
  }
  return false;
}

type StoreView = { runId: string; tasks: ReadonlyArray<RunSnapshot["tasks"][number]> };

function validateEffectOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
  expectedInputs: EffectReference[],
  store?: StoreView,
): void {
  assert.ok(["completed", "retry", "yield"].includes(outcome.status), "unknown EffectOutcome status");
  assert.equal(outcome.edgeId, route.edgeId);
  assert.equal(outcome.stage, stage);
  assert.deepEqual(outcome.effect, effect);
  assert.ok(outcome.inputs.length > 0 && outcome.inputs.every(isEffectReference));
  assert.deepEqual(outcome.inputs, expectedInputs);
  assert.ok(outcome.outputs.length > 0 && outcome.outputs.every(isEffectReference));
  assert.ok(outcome.outputs.every((reference) => referenceIsLive(repo, store, reference)), "outcome outputs must resolve current canonical state");
  if (outcome.status === "completed") {
    assert.equal("reason" in outcome, false, "completed outcome must not include reason");
    assert.equal("retry" in outcome, false, "completed outcome must not include retry");
    const proof: unknown = outcome.proof;
    assert.ok(isEffectReference(proof), "completed outcome requires a typed proof reference");
    assert.notEqual(proof.kind, "execution-task", "completed proof must be a durable-document or provider reference");
    if (proof.kind === "durable-document") {
      assert.ok(durableDocumentMatches(repo, proof), "completed proof must resolve current canonical content");
    }
  } else if (outcome.status === "retry") {
    assert.equal("proof" in outcome, false, "retry outcome must not include proof");
    assert.equal("reason" in outcome, false, "retry outcome must not include reason");
    assert.ok(outcome.retry.changedOutputs.length > 0 && outcome.retry.changedOutputs.every(isEffectReference));
    assert.ok(
      outcome.retry.changedOutputs.every((reference) => (
        reference.kind !== "provider" && referenceIsLive(repo, store, reference)
      )),
      "retry changedOutputs must resolve current canonical state",
    );
  } else {
    assert.equal("proof" in outcome, false, "yield outcome must not include proof");
    assert.equal("retry" in outcome, false, "yield outcome must not include retry");
    assert.ok(["approval-required", "input-required", "authority-required", "unrecoverable-blocker", "commit-required"].includes(outcome.reason));
  }
}

function durableDocumentMatches(repo: string, reference: DurableDocumentReference): boolean {
  if (path.isAbsolute(reference.path)) return false;
  const resolved = path.resolve(repo, reference.path);
  const relative = path.relative(repo, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return false;
  try {
    const current = canonicalReference(repo, reference.path);
    return current.id === reference.id && current.revision === reference.revision;
  } catch {
    return false;
  }
}

function referenceIsLive(repo: string, store: StoreView | undefined, reference: EffectReference): boolean {
  if (reference.kind === "durable-document") return durableDocumentMatches(repo, reference);
  if (reference.kind === "execution-task") {
    if (!store || reference.runId !== store.runId) return false;
    const task = store.tasks.find((entry) => entry.taskId === reference.taskId);
    return task !== undefined && task.version === reference.version;
  }
  return reference.provider.length > 0 && reference.idempotencyKey.length > 0;
}

function resolveReference(repo: string, store: StoreView | undefined, spec: ReferenceSpec): EffectReference | null {
  try {
    if (typeof spec === "string") return canonicalReference(repo, spec);
    if (!spec || typeof spec !== "object") return null;
    if (spec.kind === "durable-document") return canonicalReference(repo, spec.path);
    if (spec.kind === "execution-task") {
      if (!store || typeof spec.taskId !== "string" || spec.taskId.length === 0) return null;
      const task = store.tasks.find((entry) => entry.taskId === spec.taskId);
      if (!task) return null;
      if (spec.version !== undefined && spec.version !== task.version) return null;
      return { kind: "execution-task", runId: task.runId, taskId: task.taskId, version: task.version };
    }
    if (spec.kind === "provider") return isEffectReference(spec) ? spec : null;
    return null;
  } catch {
    return null;
  }
}

function resolveReferenceSpecs(
  repo: string,
  store: StoreView | undefined,
  specs: readonly ReferenceSpec[],
): EffectReference[] {
  const resolved = specs.map((spec) => {
    const reference = resolveReference(repo, store, spec);
    assert.ok(reference !== null, `reference spec does not resolve: ${JSON.stringify(spec)}`);
    return reference;
  });
  const unique = new Map<string, EffectReference>();
  for (const reference of resolved) unique.set(canonicalJson(reference), reference);
  return [...unique.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

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

function sanitizeRecordIdPart(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 40) : "effect";
}

function outcomeReceiptId(outcome: CompletedEffectOutcome): string {
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

function parseReceiptScope(value: unknown): { edgeId: string; stage: "audit" | "delegate"; effect: EffectIdentity; inputs: EffectReference[] } | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.edgeId !== "string" || value.edgeId.length === 0) return null;
  if (value.stage !== "audit" && value.stage !== "delegate") return null;
  const effect = value.effect;
  if (!isPlainObject(effect)) return null;
  if ((effect.kind !== "audit" && effect.kind !== "delegate") || typeof effect.id !== "string") return null;
  if (!Array.isArray(value.inputs) || !value.inputs.every(isEffectReference)) return null;
  return { edgeId: value.edgeId, stage: value.stage, effect: { kind: effect.kind, id: effect.id }, inputs: value.inputs };
}

function parseReceiptResult(value: unknown): { outputs: EffectReference[]; proof: EffectProof } | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.outputs) || !value.outputs.every(isEffectReference)) return null;
  const proof = value.proof;
  if (!isEffectReference(proof) || proof.kind === "execution-task") return null;
  return { outputs: value.outputs, proof };
}

function findOutcomeReceipt(receipts: ReadonlyArray<ReceiptRecord>, outcome: CompletedEffectOutcome): ReceiptRecord | null {
  const scope = { edgeId: outcome.edgeId, stage: outcome.stage, effect: outcome.effect, inputs: outcome.inputs };
  const result = { outputs: outcome.outputs, proof: outcome.proof };
  for (const record of receipts) {
    if (record.status !== "success") continue;
    const parsedScope = parseReceiptScope(record.input);
    const parsedResult = parseReceiptResult(record.output);
    if (!parsedScope || !parsedResult) continue;
    if (JSON.stringify(parsedScope) === JSON.stringify(scope) && JSON.stringify(parsedResult) === JSON.stringify(result)) return record;
  }
  return null;
}

function receiptSummaries(repo: string, runId: string): unknown[] {
  try {
    return loadRun(repo, runId).receipts.map((receipt) => ({ input: receipt.input, output: receipt.output }));
  } catch {
    return [];
  }
}

type EdgeCheckpointData = {
  edgeId: string;
  receipts: string[];
  outputs: EffectReference[];
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
    receipts: value.receipts,
    outputs: value.outputs,
    routeHash: typeof value.routeHash === "string" ? value.routeHash : "",
  };
}

function defaultEffectOutcome(
  repo: string,
  route: GraphRoute,
  stage: EffectOutcome["stage"],
  effect: EffectIdentity,
): CompletedEffectOutcome {
  assert.ok(
    isCallerNormalizedEffect(stage, effect.id)
      || (stage === "delegate" && footerDelegates.has(effect.id)),
    `No EffectOutcome producer for ${stage}:${effect.id}`,
  );
  return completedOutcome(repo, route, stage, effect);
}

function isReusableCompletedOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  snapshot: RunSnapshot,
): boolean {
  if (outcome.status !== "completed") return false;
  const validEffect = outcome.stage === "audit"
    ? outcome.effect.kind === "audit" && route.requiredAudits.includes(outcome.effect.id)
    : outcome.effect.kind === "delegate" && outcome.effect.id === route.delegate;
  if (!validEffect) return false;
  const view: StoreView = { runId: snapshot.runId, tasks: snapshot.tasks };
  if (!sameInputScope(outcome.inputs, resolvedInputs(repo, route, outcome.effect))) return false;
  try {
    // Scope identity was just proven; the attestation binds itself — the
    // delegate's own committed work legitimately advanced the docs the
    // edge's earlier effects read (the commit-resume flow).
    validateEffectOutcome(repo, route, outcome, outcome.stage, outcome.effect, outcome.inputs, view);
  } catch {
    return false;
  }
  const receipt = findOutcomeReceipt(snapshot.receipts, outcome);
  if (receipt === null) return false;
  return outcome.proof.kind === "provider"
    ? receipt.idempotencyKey === outcome.proof.idempotencyKey
    : durableDocumentMatches(repo, outcome.proof);
}

function evaluateEffectOutcome(outcome: EffectOutcome): EffectYieldReason | "retry" | null {
  if (outcome.status === "yield") return outcome.reason;
  if (outcome.status === "retry") return "retry";
  return null;
}

function evidence(
  _edgeId: string,
  mutate?: (repo: string, signals: Set<string>) => void,
): (repo: string, signals: Set<string>) => ReferenceSpec[] {
  return (repo, signals) => {
    mutate?.(repo, signals);
    return [primaryTaskDoc];
  };
}

function committedEvidence(
  _edgeId: string,
  mutate?: (repo: string, signals: Set<string>) => void,
): (repo: string, signals: Set<string>) => ReferenceSpec[] {
  return (repo, signals) => {
    mutate?.(repo, signals);
    commitAll(repo);
    return [primaryTaskDoc];
  };
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function gitInit(repo: string): void {
  // The Execution Store boundary refuses state writes unless the root is
  // ignore-covered — the fixture declares the same entry `init` writes.
  fs.writeFileSync(
    path.join(repo, ".gitignore"),
    "# doc-driven-dev execution state — per-worktree, never committed\n/.apm/state/\n",
    "utf8",
  );
  git(repo, ["init", "-q"]);
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "baseline"]);
}

function commitAll(repo: string): void {
  git(repo, ["add", "-A"]);
  // Store records are Git-ignored, so a commit boundary can legitimately be
  // empty — still advance HEAD so the commit gate observes the commit.
  git(repo, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-qm", "checkpoint", "--allow-empty"]);
}

function captureBaseline(repo: string): CommitBaseline {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.stdout.split("\n").filter((line) => line.length > 0).sort(),
  };
}

function commitGatePasses(baseline: CommitBaseline, after: CommitBaseline): boolean {
  // Strict rule: HEAD advancing alone does not pass. The gate passes only when
  // every current porcelain entry was already present in the baseline. `head`
  // stays in the captured baseline for trace/debugging context only.
  const baselineDirty = new Set(baseline.dirty);
  return after.dirty.every((entry) => baselineDirty.has(entry));
}

function fixtureRepo(options: {
  taskStatuses?: TaskStatus[];
  dependsOn?: string[][];
  secondPlan?: boolean;
} = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "doc-driven-dev-graph-run-to-yield-"));
  for (const directory of canonicalTargets) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true });
    fs.writeFileSync(path.join(repo, directory, "README.md"), `# ${directory}\n`, "utf8");
  }
  // The experiment-log audit's canonical input anchor is the managed exp
  // index; it needs a front-matter id to resolve as a DurableDocumentReference.
  writeArtifact(repo, "docs/impl/exp/README.md", {
    id: "EXP-INDEX", title: "Experiment Logs",
  }, "# Experiment Logs\n");
  writeArtifact(repo, "docs/specs/0001-graph.md", {
    id: "SPEC-0001", type: "spec", status: "approved", title: "Graph",
  }, "# Graph\n\n## Acceptance Criteria\n\n- [ ] graph\n");
  writeArtifact(repo, "docs/adr/0001-graph.md", {
    id: "ADR-0001", type: "adr", status: "accepted", title: "Graph",
  }, "# Graph\n\n## Considered Options\n\n### A\n\n### B\n");
  writeArtifact(repo, "docs/designs/0001-graph.md", {
    id: "DESIGN-0001", type: "design", status: "approved", title: "Graph",
    relations: { "derives-from": ["SPEC-0001", "ADR-0001"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/plans/0001-graph.md", {
    id: "PLAN-0001", type: "plan", status: "approved", title: "Graph",
    relations: { "derives-from": ["DESIGN-0001"], "verified-by": ["docs/test-specs/0001-graph.md"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/test-specs/0001-graph.md", {
    id: "TSPEC-0001", type: "test-spec", status: "approved", title: "Graph",
    relations: { verifies: ["SPEC-0001"] },
  }, "# Graph\n");
  writeArtifact(repo, "docs/impl/ir/0001-task.md", {
    id: "IMPL-0001", type: "implementation-record", status: "complete", title: "Graph implementation",
  }, "# Implementation Record\n");
  (options.taskStatuses ?? ["todo"]).forEach((status, index) => {
    const id = `TASK-${String(index + 1).padStart(4, "0")}`;
    writeArtifact(repo, `docs/tasks/${String(index + 1).padStart(4, "0")}-task.md`, {
      id, type: "task", status, title: id,
      relations: {
        implements: ["docs/plans/0001-graph.md"],
        ...(options.dependsOn?.[index]?.length ? { "depends-on": options.dependsOn[index] } : {}),
      },
    }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
  });
  if (options.secondPlan) {
    writeArtifact(repo, "docs/plans/0002-other.md", {
      id: "PLAN-0002", type: "plan", status: "approved", title: "Other",
      relations: { "derives-from": ["DESIGN-0001"] },
    }, "# Other\n");
  }
  gitInit(repo);
  return repo;
}

function addTask(repo: string, index: number, status: TaskStatus = "todo"): void {
  const id = `TASK-${String(index).padStart(4, "0")}`;
  writeArtifact(repo, `docs/tasks/${String(index).padStart(4, "0")}-task.md`, {
    id, type: "task", status, title: id,
    relations: { implements: ["docs/plans/0001-graph.md"] },
  }, "# Task\n\n## Verification\n\n- [ ] node --test\n");
}

function graphRun(result: ScenarioResult): GraphRunResult {
  assert.ok(result.graphRun, "yielded scenarios must return GraphRunResult");
  return result.graphRun;
}

function traceKey(route: GraphRoute): string {
  return `${route.current}\u0000${route.edgeId ?? route.condition}`;
}

function recordTrace(traces: EdgeTrace[], trace: EdgeTrace): void {
  const index = traces.findLastIndex((candidate: any) =>
    traceKey(candidate.route) === traceKey(trace.route) && !candidate.checkpointComplete,
  );
  if (index < 0) traces.push(trace);
  else traces[index] = trace;
}

let scenarioRunCounter = 0;
function runScenario(options: ScenarioOptions): ScenarioResult {
  const mode = options.resume?.mode ?? options.mode;
  const topologyBaseHops = 10;
  let taskBudgetCount = options.resume
    ? options.resume.taskBudgetCount
    : options.maxHops === undefined ? 0 : null;
  let taskBudgetFrozen = options.resume !== undefined || options.maxHops !== undefined;
  let maxHops = options.resume?.maxHops
    ?? options.maxHops
    ?? topologyBaseHops;
  const graphPath = options.graphPath ?? options.resume?.graphPath ?? canonicalGraphPath;
  const definition = loadGraphDefinition(graphPath);
  const focus = options.focus ?? options.resume?.focus ?? ["PLAN-0001"];
  const signals = new Set(options.signals ?? options.resume?.signals ?? []);
  let current = options.resume?.current ?? options.current;
  let hops = options.resume?.hops ?? 0;
  const routes: GraphRoute[] = [];
  const checkpoints = [...(options.resume?.checkpoints ?? [])];
  const completedEdges = [...(options.resume?.completedEdges ?? [])];
  const edgeTrace = [...(options.resume?.edgeTrace ?? [])];
  const seenRouteFingerprints = new Set(options.resume?.seenRouteFingerprints ?? []);
  const auditCounts = { ...(options.resume?.auditCounts ?? {}) };
  const delegateCounts = { ...(options.resume?.delegateCounts ?? {}) };
  const outcomes = [...(options.resume?.outcomes ?? [])];
  const events: string[] = [];
  let pending = options.resume?.pending ? {
    route: options.resume.pending.route,
    outcomes: [...options.resume.pending.outcomes],
    completedAudits: [...options.resume.pending.completedAudits],
    delegateComplete: options.resume.pending.delegateComplete,
    evidenceRecorded: options.resume.pending.evidenceRecorded,
    evidenceCheckpointId: options.resume.pending.evidenceCheckpointId ?? null,
    commitBaseline: options.resume.pending.commitBaseline ?? null,
  } : null;
  let projectCalls = 0;

  // Execution Store binding: the run carries receipts + edge checkpoints.
  // A resumed leg reuses the handoff's runId; a fresh leg binds a fresh id.
  const runId = options.resume?.runId ?? options.runId ?? `scenario-${scenarioRunCounter += 1}`;
  let snapshot: RunSnapshot;
  try {
    snapshot = loadRun(options.repo, runId);
  } catch (error: unknown) {
    if (error instanceof StoreError && error.code === "run-not-found") {
      snapshot = createRun(options.repo, { runId, graphId: definition.id, focus: [...focus] });
    } else {
      throw error;
    }
  }
  const reloadStore = (): void => { snapshot = loadRun(options.repo, runId); };
  const storeView = (): StoreView => ({ runId, tasks: snapshot.tasks });
  const recordOutcomeReceipt = (outcome: CompletedEffectOutcome): void => {
    recordReceipt(options.repo, runId, {
      receiptId: outcomeReceiptId(outcome),
      effect: `${outcome.effect.kind}:${outcome.effect.id}`,
      taskId: null,
      idempotencyKey: outcome.proof.kind === "provider" ? outcome.proof.idempotencyKey : null,
      actor: "oracle/default",
      status: "success",
      input: {
        edgeId: outcome.edgeId,
        stage: outcome.stage,
        effect: outcome.effect,
        inputs: outcome.inputs,
      },
      output: { outputs: outcome.outputs, proof: outcome.proof },
    });
    reloadStore();
  };
  const checkpointIsVerified = (checkpointId: string | null, edgeId: string): boolean => {
    if (checkpointId === null) return false;
    const record = snapshot.checkpoints.find((entry) => entry.checkpointId === checkpointId);
    if (!record || record.edgeId !== edgeId) return false;
    const data = parseCheckpointData(record.data);
    return data !== null
      && data.edgeId === edgeId
      && data.outputs.every((reference) => referenceIsLive(options.repo, storeView(), reference));
  };
  const adoptStoredReceipt = (
    route: GraphRoute,
    stage: "audit" | "delegate",
    effect: EffectIdentity,
    expectedInputs: EffectReference[],
  ): CompletedEffectOutcome | null => {
    if (options.resume === undefined) return null;
    for (const record of snapshot.receipts) {
      if (record.status !== "success") continue;
      const scope = parseReceiptScope(record.input);
      const result = parseReceiptResult(record.output);
      if (!scope || !result) continue;
      if (scope.edgeId !== route.edgeId || scope.stage !== stage) continue;
      if (JSON.stringify(scope.effect) !== JSON.stringify(effect)) continue;
      if (!sameInputScope(scope.inputs, expectedInputs)) continue;
      if (!result.outputs.every((reference) => referenceIsLive(options.repo, storeView(), reference))) continue;
      if (result.proof.kind === "provider") {
        if (record.idempotencyKey !== result.proof.idempotencyKey) continue;
      } else if (!durableDocumentMatches(options.repo, result.proof)) {
        continue;
      }
      return {
        status: "completed",
        edgeId: route.edgeId as string,
        stage,
        effect,
        inputs: expectedInputs,
        outputs: result.outputs,
        proof: result.proof,
      };
    }
    return null;
  };

  const project = () => {
    projectCalls += 1;
    return projectGraphState({
      cwd: options.repo,
      graphId: definition.id,
      focus,
      signals: [...signals],
    });
  };
  const expectYield = (step: ScenarioStep, reason: YieldReason) => {
    if (step.yield) assert.equal(step.yield, reason);
  };
  const savePending = (
    route: GraphRoute,
    edgeOutcomes: EffectOutcome[],
    evidenceRecorded: boolean,
    evidenceCheckpointId: string | null,
    commitBaseline: CommitBaseline | null = null,
  ) => {
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
    };
    recordTrace(edgeTrace, {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits,
      delegate: route.delegate,
      delegateComplete,
      evidenceRecorded,
      checkpointComplete: false,
      commitWaived: route.commitGate === true && signals.has("commit-waived"),
    });
  };

  let state = project();
  let yieldReason: YieldReason | null = null;
  stepLoop: for (let index = 0; index < options.steps.length; index += 1) {
    const step = options.steps[index];
    const route = routeGraph({ current, definition, state });
    routes.push(route);
    events.push(`route:${route.edgeId ?? route.status}`);
    reloadStore();
    assert.equal(route.edgeId, step.expectEdge);

    if (!taskBudgetFrozen && route.delegate === "implementation-flow") {
      assert.ok(route.taskGraph && route.taskGraph.issues.length === 0);
      taskBudgetCount = route.taskGraph.nodes
        .filter((task) => ["todo", "in-progress", "blocked"].includes(task.status))
        .length;
      maxHops = topologyBaseHops + Math.max(0, taskBudgetCount - 1);
      taskBudgetFrozen = true;
    }

    if (route.status === "terminal") {
      yieldReason = "terminal";
      expectYield(step, yieldReason);
      break;
    }
    if (route.status === "blocked") {
      yieldReason = route.blockers.includes("focus-required") || route.blockers.includes("focus-invalid")
        ? "input-required"
        : "unrecoverable-blocker";
      expectYield(step, yieldReason);
      break;
    }
    if (hops >= maxHops) {
      yieldReason = "budget-exhausted";
      break;
    }

    const routeFingerprint = JSON.stringify(route);
    if (seenRouteFingerprints.has(routeFingerprint)) {
      yieldReason = "budget-exhausted";
      expectYield(step, yieldReason);
      break;
    }
    if (step.observeOnly) {
      savePending(route, [], false, null);
      break;
    }

    const resumingPending = pending?.route.edgeId === route.edgeId && pending.route.current === route.current
      ? pending
      : null;
    if (resumingPending) {
      const invalidReceipt = resumingPending.outcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .some((outcome) => !isReusableCompletedOutcome(options.repo, route, outcome, snapshot));
      const unverifiedCheckpoint = resumingPending.evidenceRecorded
        && !checkpointIsVerified(resumingPending.evidenceCheckpointId, route.edgeId as string);
      if (invalidReceipt || unverifiedCheckpoint) {
        yieldReason = "authority-required";
        expectYield(step, yieldReason);
        break;
      }
    }

    const commitBaseline = resumingPending?.commitBaseline
      ?? (route.commitGate && !signals.has("commit-waived") ? captureBaseline(options.repo) : null);

    const edgeOutcomes = [...(resumingPending?.outcomes ?? [])];
    const completedAudits = new Set(edgeOutcomes
      .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed" && outcome.stage === "audit")
      .map((outcome) => outcome.effect.id));
    for (const audit of route.requiredAudits) {
      if (completedAudits.has(audit)) continue;
      const effect: EffectIdentity = { kind: "audit", id: audit };
      const expectedInputs = resolvedInputs(options.repo, route, effect);
      const adopted = adoptStoredReceipt(route, "audit", effect, expectedInputs);
      if (adopted) {
        edgeOutcomes.push(adopted);
        outcomes.push(adopted);
        completedAudits.add(audit);
        continue;
      }
      events.push(`audit:${audit}`);
      const outcome = step.audit?.(options.repo, signals, route, audit)
        ?? defaultEffectOutcome(options.repo, route, "audit", effect);
      validateEffectOutcome(options.repo, route, outcome, "audit", effect, resolvedInputs(options.repo, route, effect), storeView());
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      if (outcome.status === "completed") recordOutcomeReceipt(outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        if (index + 1 < options.steps.length) {
          events.push("project");
          state = project();
          continue stepLoop;
        }
        break stepLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        expectYield(step, yieldReason);
        break stepLoop;
      }
      completedAudits.add(audit);
      auditCounts[audit] = (auditCounts[audit] ?? 0) + 1;
    }

    let delegateComplete = edgeOutcomes.some((outcome) => (
      outcome.status === "completed" && outcome.stage === "delegate" && outcome.effect.id === route.delegate
    ));
    if (route.delegate && !delegateComplete) {
      const effect: EffectIdentity = { kind: "delegate", id: route.delegate };
      const expectedInputs = resolvedInputs(options.repo, route, effect);
      const adopted = adoptStoredReceipt(route, "delegate", effect, expectedInputs);
      if (adopted) {
        edgeOutcomes.push(adopted);
        outcomes.push(adopted);
        delegateComplete = true;
      }
    }
    if (route.delegate && !delegateComplete) {
      events.push(`delegate:${route.delegate}`);
      const effect: EffectIdentity = { kind: "delegate", id: route.delegate };
      const outcome = step.delegate?.(options.repo, signals, route)
        ?? defaultEffectOutcome(options.repo, route, "delegate", effect);
      validateEffectOutcome(options.repo, route, outcome, "delegate", effect, resolvedInputs(options.repo, route, effect), storeView());
      edgeOutcomes.push(outcome);
      outcomes.push(outcome);
      if (outcome.status === "completed") recordOutcomeReceipt(outcome);
      const evaluation = evaluateEffectOutcome(outcome);
      if (evaluation === "retry") {
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        if (index + 1 < options.steps.length) {
          events.push("project");
          state = project();
          continue stepLoop;
        }
        break stepLoop;
      }
      if (evaluation) {
        yieldReason = evaluation;
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        expectYield(step, yieldReason);
        break stepLoop;
      }
      delegateCounts[route.delegate] = (delegateCounts[route.delegate] ?? 0) + 1;
      delegateComplete = true;
    }

    let evidenceRecorded = resumingPending?.evidenceRecorded === true
      && checkpointIsVerified(resumingPending.evidenceCheckpointId, route.edgeId as string);
    let evidenceCheckpointId = evidenceRecorded ? resumingPending?.evidenceCheckpointId ?? null : null;
    if (!evidenceRecorded) {
      if (!step.applyCheckpointEvidence) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        expectYield(step, yieldReason);
        break;
      }
      const declared = step.applyCheckpointEvidence(options.repo, signals) ?? [];
      const declaredRefs = declared.map((spec) => resolveReference(options.repo, storeView(), spec));
      const refreshed: Array<EffectReference | null> = edgeOutcomes
        .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
        .flatMap((outcome) => outcome.outputs)
        .map((reference) => resolveReference(options.repo, storeView(), reference));
      const invalidDeclaration = declaredRefs.some((reference) => reference === null)
        || refreshed.some((reference) => reference === null);
      const bound = [...declaredRefs, ...refreshed]
        .filter((reference): reference is EffectReference => reference !== null);
      const unique = new Map<string, EffectReference>();
      for (const reference of bound) unique.set(canonicalJson(reference), reference);
      const boundOutputs = [...unique.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      if (invalidDeclaration || !boundOutputs.every((reference) => referenceIsLive(options.repo, storeView(), reference))) {
        yieldReason = "authority-required";
        savePending(route, edgeOutcomes, false, null, commitBaseline);
        expectYield(step, yieldReason);
        break;
      }
      const data: EdgeCheckpointData = {
        edgeId: route.edgeId as string,
        receipts: edgeOutcomes
          .filter((outcome): outcome is CompletedEffectOutcome => outcome.status === "completed")
          .map((outcome) => outcomeReceiptId(outcome)),
        outputs: boundOutputs,
        routeHash: fingerprint(JSON.stringify(route)),
      };
      const recorded = recordCheckpoint(options.repo, runId, {
        checkpointId: edgeCheckpointId(route.edgeId as string, data),
        nodeId: route.next,
        edgeId: route.edgeId as string,
        taskId: null,
        data,
      });
      evidenceRecorded = true;
      evidenceCheckpointId = recorded.checkpoint.checkpointId;
      reloadStore();
    }
    events.push(`checkpoint:${route.edgeId}`);
    if (commitBaseline && !signals.has("commit-waived")) {
      const after = captureBaseline(options.repo);
      if (!commitGatePasses(commitBaseline, after)) {
        yieldReason = "commit-required";
        savePending(route, edgeOutcomes, true, evidenceCheckpointId, commitBaseline);
        expectYield(step, yieldReason);
        break;
      }
    }
    pending = null;
    checkpoints.push(route);
    completedEdges.push(route.edgeId as string);
    recordTrace(edgeTrace, {
      route,
      outcomes: [...edgeOutcomes],
      completedAudits: [...completedAudits].sort(),
      delegate: route.delegate,
      delegateComplete,
      evidenceRecorded: true,
      checkpointComplete: true,
      commitWaived: route.commitGate === true && signals.has("commit-waived"),
    });
    seenRouteFingerprints.add(routeFingerprint);
    hops += 1;
    current = route.next;

    if (mode === "single-step") {
      yieldReason = "single-step-complete";
      expectYield(step, yieldReason);
      break;
    }
    if (index + 1 < options.steps.length) {
      events.push("project");
      state = project();
    }
  }

  const handoff: ScenarioHandoff = {
    runId,
    current,
    mode,
    maxHops,
    yieldReason,
    focus: [...focus],
    signals: [...signals].sort(),
    graphPath,
    completedEdges,
    seenRouteFingerprints: [...seenRouteFingerprints],
    taskBudgetCount,
    auditCounts,
    delegateCounts,
    checkpoints,
    edgeTrace,
    outcomes,
    pending,
    hops,
  };
  const finalRoute = routes[routes.length - 1];
  const graphRun: GraphRunResult | undefined = yieldReason !== null && finalRoute
    ? {
      status: "yielded",
      reason: yieldReason,
      route: finalRoute,
      outcomes: [...outcomes],
      trace: [...edgeTrace],
      handoff: JSON.parse(JSON.stringify(handoff)),
    }
    : undefined;
  return {
    routes,
    checkpoints,
    yieldReason,
    current,
    projectCalls,
    events,
    auditCounts,
    delegateCounts,
    outcomes,
    handoff: JSON.parse(JSON.stringify(handoff)),
    graphRun,
  };
}

function customGraph(repo: string, text: string): string {
  const file = path.join(repo, "caller-graph.yaml");
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function twoEdgeGraph(repo: string): string {
  return customGraph(repo, `schemaVersion: 2
id: caller-fixture
entry: start
runtimeSignals: [advance]
conditions:
  advance: { kind: signal, signal: advance }
nodes:
  start: { kind: action }
  briefing: { kind: delegate, delegate: briefing-flow, audits: [spec] }
  done: { kind: terminal }
edges:
  - { id: edge-a, from: start, to: briefing, when: advance, priority: 10 }
  - { id: edge-b, from: briefing, to: done, when: advance, priority: 10 }
`);
}

function cycleGraph(repo: string): string {
  return customGraph(repo, `schemaVersion: 2
id: caller-cycle
entry: start
runtimeSignals: [advance]
conditions:
  advance: { kind: signal, signal: advance }
nodes:
  start: { kind: action }
  middle: { kind: action }
edges:
  - { id: cycle-a, from: start, to: middle, when: advance, priority: 10 }
  - { id: cycle-b, from: middle, to: start, when: advance, priority: 10 }
`);
}

test("runs a bounded partial canonical path with fresh projection between checkpoints", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing", (fixture) => addTask(fixture, 2)) },
      { expectEdge: "briefing-to-design", applyCheckpointEvidence: evidence("briefing-to-design", (fixture) => addTask(fixture, 3)) },
      { expectEdge: "design-to-planning", applyCheckpointEvidence: evidence("design-to-planning", (fixture) => addTask(fixture, 4)) },
      { expectEdge: "planning-to-task-graph", applyCheckpointEvidence: evidence("planning-to-task-graph", (fixture) => addTask(fixture, 5)) },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "probe-to-briefing",
    "briefing-to-design",
    "design-to-planning",
    "planning-to-task-graph",
  ]);
  assert.equal(result.checkpoints.length, 4);
  assert.equal(result.projectCalls, 4);
  assert.equal(result.yieldReason, null); // Fixture steps exhausted; this is not a production yield.
  for (let index = 1; index < result.routes.length; index += 1) {
    assert.notDeepEqual(result.routes[index].taskGraph, result.routes[index - 1].taskGraph);
  }
});

test("observes terminal after the migration path reaches the derived task budget", () => {
  const repo = fixtureRepo({
    taskStatuses: ["todo", "todo"],
    dependsOn: [[], ["TASK-0001"]],
  });
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    signals: ["migration-requested", "migration-complete"],
    steps: [
      { expectEdge: "probe-to-migration", applyCheckpointEvidence: evidence("probe-to-migration") },
      { expectEdge: "migration-to-bootstrap", applyCheckpointEvidence: evidence("migration-to-bootstrap") },
      { expectEdge: "bootstrap-to-briefing", applyCheckpointEvidence: evidence("bootstrap-to-briefing") },
      { expectEdge: "briefing-to-design", applyCheckpointEvidence: evidence("briefing-to-design") },
      { expectEdge: "design-to-planning", applyCheckpointEvidence: evidence("design-to-planning") },
      { expectEdge: "planning-to-task-graph", applyCheckpointEvidence: evidence("planning-to-task-graph") },
      {
        expectEdge: "task-graph-to-implementation",
        applyCheckpointEvidence: committedEvidence("task-graph-to-implementation", (fixture) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
        }),
      },
      {
        expectEdge: "implementation-retry",
        applyCheckpointEvidence: committedEvidence("implementation-retry", (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0002-task.md", { status: "done" });
          signals.add("implementation-verified");
        }),
      },
      {
        expectEdge: "implementation-to-followup-triage",
        applyCheckpointEvidence: evidence("implementation-to-followup-triage", (_fixture, signals) => {
          signals.add("followup-terminal");
        }),
      },
      {
        expectEdge: "followup-triage-terminal",
        applyCheckpointEvidence: evidence("followup-triage-terminal", (_fixture, signals) => {
          signals.add("exit-audit-pass");
        }),
      },
      { expectEdge: "exit-audit-to-complete", applyCheckpointEvidence: evidence("exit-audit-to-complete") },
      { expectEdge: null, yield: "terminal" },
    ],
  });
  assert.equal(result.checkpoints.length, 11);
  assert.equal(result.handoff.taskBudgetCount, 2);
  assert.equal(result.handoff.maxHops, 11);
  assert.equal(result.handoff.hops, 11);
  assert.equal(result.current, "complete");
  assert.equal(result.yieldReason, "terminal");
});

test("yields approval exactly once before design evidence is written", () => {
  const repo = fixtureRepo();
  let evidenceCalls = 0;
  const blocked = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "approval-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "approval-required",
      ),
      applyCheckpointEvidence: () => { evidenceCalls += 1; },
    }],
  });
  assert.equal(blocked.yieldReason, "approval-required");
  assert.equal(evidenceCalls, 0);
  assert.equal(blocked.checkpoints.length, 0);
  assert.equal(blocked.handoff.pending?.route.edgeId, "briefing-to-design");
  assert.equal(blocked.handoff.pending?.delegateComplete, false);
  assert.equal(blocked.projectCalls, 1);

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: blocked.handoff,
    steps: [{
      expectEdge: "briefing-to-design",
      applyCheckpointEvidence: evidence("briefing-to-design", () => { evidenceCalls += 1; }),
    }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(evidenceCalls, 1);
  assert.equal(resumed.current, "design");
  assert.equal(blocked.auditCounts.design, 1);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, outcomes: receiptSummaries(repo, resumed.handoff.runId) }));
});

test("focus input yield leaves the next route and effects untouched", () => {
  const repo = fixtureRepo({ secondPlan: true });
  let effects = 0;
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: [],
    steps: [{
      expectEdge: null,
      yield: "input-required",
      applyCheckpointEvidence: () => { effects += 1; },
    }],
  });
  assert.equal(result.yieldReason, "input-required");
  assert.equal(result.routes[0].condition, "blocked");
  assert.equal(effects, 0);
  assert.equal(result.projectCalls, 1);
});

test("resume after a completed edge starts at its recorded next node", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing") }],
  });
  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "briefing-to-design", applyCheckpointEvidence: evidence("briefing-to-design") }],
  });
  assert.equal(first.current, "briefing");
  assert.equal(resumed.routes[0].current, "briefing");
  assert.equal(resumed.routes[0].edgeId, "briefing-to-design");
  assert.equal(resumed.delegateCounts["design-doc"], 1);
});

test("resume after audit-complete delegate-pending does not repeat the audit", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  assert.equal(first.auditCounts.design, 1);
  assert.equal(first.handoff.pending?.completedAudits.length, 1);
  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "briefing-to-design", applyCheckpointEvidence: evidence("briefing-to-design") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1, JSON.stringify({ handoff: resumed.handoff, outcomes: receiptSummaries(repo, resumed.handoff.runId) }));
  assert.equal(resumed.checkpoints.length, 1);
});

test("resume skips scope-valid pending audit and delegate receipts", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.deepEqual(interrupted.handoff.pending?.completedAudits, ["design"]);
  assert.equal(interrupted.handoff.pending?.delegateComplete, true);

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{ expectEdge: "briefing-to-design", applyCheckpointEvidence: evidence("briefing-to-design") }],
  });
  assert.deepEqual(resumed.routes[0].taskGraph, interrupted.handoff.pending?.route.taskGraph);
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.design, 1);
  assert.equal(resumed.delegateCounts["design-doc"], 1);
  assert.equal(resumed.checkpoints.length, 1);
});

test("does not skip an implementation receipt after its authoritative Task Graph changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{ expectEdge: "implementation-retry", yield: "authority-required" }],
  });
  assert.equal(interrupted.handoff.pending?.delegateComplete, true);

  addTask(repo, 2);
  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "implementation-retry",
      applyCheckpointEvidence: evidence("implementation-retry"),
    }],
  });
  assert.notDeepEqual(resumed.routes[0].taskGraph, interrupted.handoff.pending?.route.taskGraph);
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.delegateCounts["implementation-flow"], 1);
});

test("freezes focused task budget across resume and refreshes it only for a new run", () => {
  const repo = fixtureRepo({
    taskStatuses: ["todo", "in-progress", "blocked", "done", "wont-do"],
  });
  const first = runScenario({
    repo,
    current: "task-graph",
    mode: "single-step",
    steps: [{
      expectEdge: "task-graph-to-active-implementation",
      applyCheckpointEvidence: committedEvidence("task-graph-to-active-implementation"),
    }],
  });
  assert.equal(first.handoff.taskBudgetCount, 3);
  assert.equal(first.handoff.maxHops, 12);

  addTask(repo, 6);
  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "single-step",
    resume: first.handoff,
    steps: [{
      expectEdge: "implementation-retry",
      applyCheckpointEvidence: committedEvidence("implementation-retry"),
    }],
  });
  assert.equal(resumed.handoff.taskBudgetCount, 3);
  assert.equal(resumed.handoff.maxHops, 12);

  const nextRun = runScenario({
    repo,
    current: "implementation",
    mode: "single-step",
    steps: [{
      expectEdge: "implementation-retry",
      applyCheckpointEvidence: committedEvidence("implementation-retry"),
    }],
  });
  assert.equal(nextRun.handoff.taskBudgetCount, 4);
  assert.equal(nextRun.handoff.maxHops, 13);
});

test("preserves a frozen zero task budget across same-run additions and resume", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        applyCheckpointEvidence: committedEvidence("implementation-retry", (fixture) => {
          addTask(fixture, 2);
          addTask(fixture, 3);
        }),
      },
      { expectEdge: "implementation-retry", applyCheckpointEvidence: committedEvidence("implementation-retry") },
    ],
  });
  assert.equal(result.handoff.taskBudgetCount, 0);
  assert.equal(result.handoff.maxHops, 10);

  addTask(repo, 4);
  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    resume: result.handoff,
    steps: [{ expectEdge: "implementation-retry", applyCheckpointEvidence: committedEvidence("implementation-retry") }],
  });
  assert.equal(resumed.handoff.taskBudgetCount, 0);
  assert.equal(resumed.handoff.maxHops, 10);
});

test("continues implementation retry only after re-projection", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        applyCheckpointEvidence: committedEvidence("implementation-retry", (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
        }),
      },
      { expectEdge: "implementation-to-followup-triage", applyCheckpointEvidence: evidence("implementation-to-followup-triage") },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "implementation-retry",
    "implementation-to-followup-triage",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("continues implementation retry when the Task Graph advances to the next runnable task", () => {
  const repo = fixtureRepo({
    taskStatuses: ["in-progress", "todo"],
    dependsOn: [[], ["TASK-0001"]],
  });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        applyCheckpointEvidence: committedEvidence("implementation-retry", (fixture) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
        }),
      },
      {
        expectEdge: "implementation-retry",
        applyCheckpointEvidence: committedEvidence("implementation-retry", (fixture, signals) => {
          updateArtifact(fixture, "docs/tasks/0002-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
        }),
      },
      {
        expectEdge: "implementation-to-followup-triage",
        applyCheckpointEvidence: evidence("implementation-to-followup-triage"),
      },
    ],
  });

  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "implementation-retry",
    "implementation-retry",
    "implementation-to-followup-triage",
  ]);
  assert.deepEqual(result.routes[0].taskGraph?.resumableActive, ["TASK-0001"]);
  assert.deepEqual(result.routes[0].taskGraph?.runnable, []);
  assert.deepEqual(result.routes[0].taskGraph?.completed, []);
  assert.deepEqual(result.routes[1].taskGraph?.resumableActive, []);
  assert.deepEqual(result.routes[1].taskGraph?.runnable, ["TASK-0002"]);
  assert.deepEqual(result.routes[1].taskGraph?.completed, ["TASK-0001"]);
  assert.notEqual(JSON.stringify(result.routes[0]), JSON.stringify(result.routes[1]));
  assert.equal(result.yieldReason, null);
});

test("continues implementation-to-design and then design-to-planning", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    signals: ["implementation-verified", "design-gap"],
    steps: [
      { expectEdge: "implementation-to-design", applyCheckpointEvidence: evidence("implementation-to-design", (_repo, signals) => signals.delete("design-gap")) },
      { expectEdge: "design-to-planning", applyCheckpointEvidence: evidence("design-to-planning") },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "implementation-to-design",
    "design-to-planning",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("runs planning-flow before downstream plan and task audits", () => {
  const repo = fixtureRepo({ taskStatuses: ["todo", "todo"] });
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "design-to-planning", applyCheckpointEvidence: evidence("design-to-planning") },
      { expectEdge: "planning-to-task-graph", applyCheckpointEvidence: evidence("planning-to-task-graph") },
    ],
  });

  assert.deepEqual(result.events, [
    "route:design-to-planning",
    "audit:design",
    "delegate:planning-flow",
    "checkpoint:design-to-planning",
    "project",
    "route:planning-to-task-graph",
    "audit:plan",
    "audit:task",
    "audit:test-spec",
    "delegate:build_task_graph",
    "checkpoint:planning-to-task-graph",
  ]);
  assert.equal(result.delegateCounts["planning-flow"], 1);
  assert.equal(result.delegateCounts.build_task_graph, 1);
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "design-to-planning",
    "planning-to-task-graph",
  ]);
  const planningOutcome = result.outcomes.find((outcome) => (
    outcome.stage === "delegate" && outcome.effect.id === "planning-flow"
  ));
  assert.deepEqual(planningOutcome?.outputs, [
    canonicalReference(repo, "docs/plans/0001-graph.md"),
    canonicalReference(repo, "docs/test-specs/0001-graph.md"),
    canonicalReference(repo, "docs/tasks/0001-task.md"),
    canonicalReference(repo, "docs/tasks/0002-task.md"),
  ]);
  assert.deepEqual(planningOutcome?.status === "completed" ? planningOutcome.proof : null, canonicalReference(repo, "docs/plans/0001-graph.md"));
});

test("repairs an invalid task graph before returning to task-graph", () => {
  const repo = fixtureRepo({
    taskStatuses: ["in-progress", "in-progress"],
    dependsOn: [["TASK-0002"], ["TASK-0001"]],
  });
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "task-graph-to-planning",
        applyCheckpointEvidence: evidence("task-graph-to-planning", (fixture) => updateArtifact(fixture, "docs/tasks/0002-task.md", {
          status: "todo",
          relations: { implements: ["docs/plans/0001-graph.md"] },
        })),
      },
      { expectEdge: "planning-to-task-graph", applyCheckpointEvidence: evidence("planning-to-task-graph") },
    ],
  });
  assert.deepEqual(result.routes.map((route) => route.edgeId), [
    "task-graph-to-planning",
    "planning-to-task-graph",
  ]);
  assert.equal(result.projectCalls, 2);
});

test("routes completed implementation work to follow-up triage", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    signals: ["implementation-verified", "followup-terminal"],
    steps: [{ expectEdge: "implementation-to-followup-triage", applyCheckpointEvidence: evidence("implementation-to-followup-triage") }],
  });
  assert.equal(result.routes[0].edgeId, "implementation-to-followup-triage");
  assert.deepEqual(result.routes[0].requiredAudits, ["impl-record", "task"]);
  assert.equal(result.auditCounts["impl-record"], 1);
  assert.equal(result.auditCounts.task, 1);
  assert.equal(result.checkpoints.length, 1);
});

test("stops an unchanged self-loop on its repeated complete-route fingerprint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      { expectEdge: "implementation-retry", applyCheckpointEvidence: committedEvidence("implementation-retry") },
      { expectEdge: "implementation-retry", yield: "budget-exhausted" },
    ],
  });
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.handoff.seenRouteFingerprints.length, 1);
  assert.equal(JSON.stringify(result.routes[1]), result.handoff.seenRouteFingerprints[0]);
  assert.equal(result.yieldReason, "budget-exhausted");
});

test("bounds a changing multi-node repair cycle at the default maxHops", () => {
  const repo = fixtureRepo();
  const steps: ScenarioStep[] = Array.from({ length: 12 }, (_, index) => ({
    expectEdge: index % 2 === 0 ? "design-to-briefing" : "briefing-to-design",
    applyCheckpointEvidence: evidence(index % 2 === 0 ? "design-to-briefing" : "briefing-to-design", (fixture) => addTask(fixture, index + 2)),
  }));
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    signals: ["spec-gap"],
    steps,
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.checkpoints.length, 10);
  assert.equal(result.handoff.maxHops, 10);
  assert.equal(result.handoff.hops, 10);
  assert.equal(graphRun(result).trace.length, 10);
  assert.deepEqual(graphRun(result).trace.map((entry) => entry.route.edgeId), steps.slice(0, 10).map((step) => step.expectEdge));
  assert.equal(graphRun(result).reason, "budget-exhausted");

  const nextRun = runScenario({
    repo,
    current: result.current,
    mode: "run-until-yield",
    signals: ["spec-gap"],
    steps: [{
      expectEdge: "design-to-briefing",
      applyCheckpointEvidence: evidence("design-to-briefing", (fixture) => addTask(fixture, 20)),
    }],
  });
  assert.equal(nextRun.handoff.hops, 1);
  assert.equal(nextRun.yieldReason, null);
});

test("stops on a repeated complete GraphRoute fingerprint", () => {
  const repo = fixtureRepo();
  const graphPath = cycleGraph(repo);
  const result = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "cycle-a", applyCheckpointEvidence: evidence("cycle-a") },
      { expectEdge: "cycle-b", applyCheckpointEvidence: evidence("cycle-b") },
      { expectEdge: "cycle-a", yield: "budget-exhausted" },
    ],
  });
  assert.equal(result.yieldReason, "budget-exhausted");
  assert.equal(result.checkpoints.length, 2);
  assert.equal(result.handoff.seenRouteFingerprints.length, 2);
  assert.equal(result.routes[2].edgeId, result.routes[0].edgeId);
});

test("terminal re-entry yields one idempotent terminal result", () => {
  const repo = fixtureRepo({ taskStatuses: ["done"] });
  const first = runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  });
  const second = runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  });
  assert.equal(first.yieldReason, "terminal");
  assert.equal(first.routes.length, 1);
  assert.deepEqual(second.routes, first.routes);
});

test("fails closed for malformed graph, unknown signal, and invalid focus", () => {
  const repo = fixtureRepo();
  const malformed = path.join(repo, "malformed.yaml");
  fs.writeFileSync(malformed, "schemaVersion: 2\nid: malformed\nentry: missing\nnodes: {}\nconditions: {}\nedges: []\n", "utf8");
  assert.throws(() => loadGraphDefinition(malformed), /Invalid graph definition/);

  const tsx = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "../src/skills/doc-driven-dev-graph/scripts/route_graph.ts");
  const unknownSignal = spawnSync(process.execPath, [
    tsx,
    cli,
    "--graph", canonicalGraphPath,
    "--cwd", repo,
    "--focus", "PLAN-0001",
    "--signal", "not-declared",
    "--json",
  ], { encoding: "utf8" });
  assert.notEqual(unknownSignal.status, 0);
  assert.match(unknownSignal.stderr, /Unknown signal not declared/);

  const invalidFocus = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: ["MISSING"],
    steps: [{ expectEdge: null, yield: "input-required" }],
  });
  assert.equal(invalidFocus.yieldReason, "input-required");
  assert.ok(invalidFocus.routes[0].blockers.includes("focus-invalid"));
});

test("blocked route without a declared edge yields unrecoverable-blocker", () => {
  const repo = fixtureRepo();
  const graphPath = customGraph(repo, `schemaVersion: 2
id: blocked-fixture
entry: blocked
runtimeSignals: [never]
conditions:
  never: { kind: signal, signal: never }
nodes:
  blocked: { kind: action }
  done: { kind: terminal }
edges:
  - { id: blocked-to-done, from: blocked, to: done, when: never, priority: 10 }
`);
  const result = runScenario({
    repo,
    graphPath,
    current: "blocked",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "unrecoverable-blocker" }],
  });
  assert.equal(result.yieldReason, "unrecoverable-blocker");
  assert.equal(result.routes[0].condition, "blocked");
});

test("single-step completes exactly one checkpoint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "single-step",
    steps: [
      { expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing") },
      { expectEdge: "briefing-to-design" },
    ],
  });
  assert.equal(result.yieldReason, "single-step-complete");
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.routes.length, 1);
  assert.equal(result.current, "briefing");
});

test("preserves deterministic evidence ordering and full-route fingerprints", () => {
  const firstRepo = fixtureRepo();
  const first = runScenario({
    repo: firstRepo,
    graphPath: twoEdgeGraph(firstRepo),
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "edge-a", applyCheckpointEvidence: evidence("edge-a") },
      { expectEdge: "edge-b", observeOnly: true },
    ],
  });
  assert.deepEqual(first.events, [
    "route:edge-a", "audit:spec", "delegate:briefing-flow", "checkpoint:edge-a",
    "project", "route:edge-b",
  ]);
  assert.equal(first.handoff.seenRouteFingerprints[0], JSON.stringify(first.routes[0]));

  const secondRepo = fixtureRepo();
  const second = runScenario({
    repo: secondRepo,
    graphPath: twoEdgeGraph(secondRepo),
    current: "start",
    mode: "run-until-yield",
    signals: ["advance"],
    steps: [
      { expectEdge: "edge-a", applyCheckpointEvidence: evidence("edge-a") },
      { expectEdge: "edge-b", observeOnly: true },
    ],
  });
  assert.deepEqual(second.routes, first.routes);
});

test("does not trust an unverified delegate-complete resume claim", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.delegateComplete = true;
  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: forged,
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not trust an audit receipt absent from canonical evidence", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      audit: (fixture, _signals, route, audit) => yieldOutcome(
        fixture,
        route,
        "audit",
        { kind: "audit", id: audit },
        "authority-required",
      ),
    }],
  });
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.outcomes = [completedOutcome(
    repo,
    interrupted.handoff.pending!.route,
    "audit",
    { kind: "audit", id: "adr" },
  )];

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: forged,
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyCheckpointEvidence: evidence("probe-to-briefing"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not reuse persisted canonical evidence after its content changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => {
        const staleProof = canonicalReference(fixture, "docs/designs/0001-graph.md");
        return {
          ...completedOutcome(
            fixture,
            route,
            "delegate",
            { kind: "delegate", id: route.delegate as string },
          ),
          outputs: [staleProof],
          proof: staleProof,
        };
      },
    }],
  });
  updateArtifact(repo, "docs/designs/0001-graph.md", { title: "Changed Graph" });

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      applyCheckpointEvidence: evidence("briefing-to-design"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not trust an evidence claim proved only for another run state", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  const forged = JSON.parse(JSON.stringify(interrupted.handoff)) as ScenarioHandoff;
  forged.pending!.evidenceRecorded = true;

  const resumed = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    resume: forged,
    steps: [{ expectEdge: "briefing-to-design", yield: "authority-required" }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("does not complete an edge when its evidence declarations cannot resolve", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyCheckpointEvidence: (fixture) => {
        updateArtifact(fixture, "docs/tasks/0001-task.md", { title: "changed-without-proof" });
        return ["docs/tasks/9999-missing.md"];
      },
    }],
  });
  assert.equal(result.yieldReason, "authority-required");
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.handoff.pending?.evidenceRecorded, false);
});

test("audit effects can yield and resume without repeating completed audits", () => {
  const repo = fixtureRepo();
  let auditCalls = 0;
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "approval-required",
      audit: (fixture, _signals, route, audit) => {
        auditCalls += 1;
        return auditCalls === 2
          ? yieldOutcome(fixture, route, "audit", { kind: "audit", id: audit }, "approval-required")
          : completedOutcome(fixture, route, "audit", { kind: "audit", id: audit });
      },
    }],
  });
  assert.equal(interrupted.yieldReason, "approval-required");
  assert.equal(interrupted.auditCounts.adr, 1);
  assert.equal(interrupted.auditCounts.spec, undefined);
  assert.deepEqual(interrupted.handoff.pending?.completedAudits, ["adr"]);

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{ expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.auditCounts.adr, 1);
  assert.equal(resumed.auditCounts.spec, 1);
  assert.equal(resumed.checkpoints.length, 1);
});

test("handoff records caller mode, hop bound, and per-edge completion trace", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "single-step",
    maxHops: 4,
    steps: [{ expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(result.handoff.mode, "single-step");
  assert.equal(result.handoff.maxHops, 4);
  assert.equal(result.handoff.taskBudgetCount, null);
  assert.equal(result.handoff.yieldReason, "single-step-complete");
  assert.equal(result.handoff.edgeTrace.length, 1);
  assert.deepEqual(result.handoff.edgeTrace[0].completedAudits, ["adr", "spec"]);
  assert.equal(result.handoff.edgeTrace[0].delegate, "briefing-flow");
  assert.equal(result.handoff.edgeTrace[0].delegateComplete, true);
  assert.equal(result.handoff.edgeTrace[0].evidenceRecorded, true);
  assert.equal(result.handoff.edgeTrace[0].checkpointComplete, true);
});

test("records ordered typed outcomes and yields an irreversible effect without proof", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "design",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "design-to-planning",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  assert.equal(result.yieldReason, "authority-required");
  const outcomes = (result.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes;
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["completed", "yield"]);
  assert.equal("proof" in outcomes[1], false);
  assert.deepEqual(result.handoff.pending?.outcomes.map((outcome) => outcome.status), ["completed", "yield"]);
});

test("resumes a completed irreversible effect only with a provider idempotency receipt", () => {
  const repo = fixtureRepo();
  const first = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => completedOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        { provider: "deploy", idempotencyKey: "run-1" },
      ),
    }],
  });
  assert.equal(first.yieldReason, "authority-required");
  const delegateOutcome = (first.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes
    .find((outcome) => outcome.stage === "delegate");
  assert.deepEqual(delegateOutcome?.proof, { kind: "provider", provider: "deploy", idempotencyKey: "run-1" });

  const resumed = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    resume: first.handoff,
    steps: [{ expectEdge: "implementation-retry", applyCheckpointEvidence: committedEvidence("implementation-retry") }],
  });
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.delegateCounts["implementation-flow"], 1);
});

test("continues a typed retry only after its canonical evidence changes", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [
      {
        expectEdge: "implementation-retry",
        delegate: (fixture, signals, route) => {
          updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
          signals.add("implementation-verified");
          signals.add("followup-terminal");
          return retryOutcome(
            fixture,
            route,
            "delegate",
            { kind: "delegate", id: route.delegate as string },
            [canonicalReference(fixture, "docs/tasks/0001-task.md")],
          );
        },
      },
      {
        expectEdge: "implementation-to-followup-triage",
        applyCheckpointEvidence: evidence("implementation-to-followup-triage"),
      },
    ],
  });
  assert.equal(result.routes.length, 2);
  assert.equal(result.projectCalls, 2);
  const outcomes = (result.handoff as unknown as { outcomes: Array<Record<string, unknown>> }).outcomes;
  assert.equal(outcomes.some((outcome) => outcome.status === "retry"), true);
});

test("rejects a completed outcome with a forbidden yield reason", () => {
  const repo = fixtureRepo();
  assert.throws(() => runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      delegate: (fixture, _signals, route) => ({
        ...completedOutcome(
          fixture,
          route,
          "delegate",
          { kind: "delegate", id: route.delegate as string },
        ),
        reason: "authority-required",
      } as unknown as EffectOutcome),
    }],
  }), /completed outcome must not include reason/);
});

test("returns a typed GraphRunResult with the final yielded route and resume data", () => {
  const repo = fixtureRepo();
  const yielded = runScenario({
    repo,
    current: "briefing",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "briefing-to-design",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "authority-required",
      ),
    }],
  });
  const result = graphRun(yielded);
  assert.equal(result.status, "yielded");
  assert.equal(result.reason, "authority-required");
  assert.deepEqual(result.route, yielded.routes.at(-1));
  assert.deepEqual(result.outcomes, yielded.outcomes);
  assert.deepEqual(result.trace, yielded.handoff.edgeTrace);
  assert.deepEqual(result.handoff, yielded.handoff);

  const terminal = graphRun(runScenario({
    repo,
    current: "complete",
    mode: "run-until-yield",
    steps: [{ expectEdge: null, yield: "terminal" }],
  }));
  assert.equal(terminal.route.status, "terminal");
  assert.equal(terminal.reason, "terminal");

  const blocked = graphRun(runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    focus: [],
    steps: [{ expectEdge: null, yield: "input-required" }],
  }));
  assert.equal(blocked.route.status, "blocked");
  assert.equal(blocked.reason, "input-required");
});

test("normalizes every declared script delegate and named audit into typed outcomes", () => {
  const graph = require("js-yaml").load(fs.readFileSync(canonicalGraphPath, "utf8")) as {
    nodes: Record<string, { delegate?: string; audits?: string[] }>;
  };
  const declaredDelegates = [...new Set(Object.values(graph.nodes)
    .map((node) => node.delegate)
    .filter((delegate): delegate is string => Boolean(delegate)))].sort();
  const declaredAudits = [...new Set(Object.values(graph.nodes).flatMap((node) => node.audits ?? []))].sort();
  const scriptDelegates = ["migrate_docs", "scaffold_docs", "build_task_graph"];
  const namedAudits = ["spec", "adr", "design", "plan", "task", "test-spec", "impl-record", "experiment-log", "all"];
  assert.ok(scriptDelegates.every((effect) => declaredDelegates.includes(effect)));
  assert.ok(namedAudits.every((effect) => declaredAudits.includes(effect)));
  assert.ok(scriptDelegates.every((effect) => isCallerNormalizedEffect("delegate", effect)));
  assert.ok(namedAudits.every((effect) => isCallerNormalizedEffect("audit", effect)));
  assert.ok(["briefing-flow", "design-doc", "implementation-flow", "doc-status"]
    .every((effect) => !isCallerNormalizedEffect("delegate", effect)));

  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    signals: ["migration-requested"],
    steps: [{ expectEdge: "probe-to-migration", applyCheckpointEvidence: evidence("probe-to-migration") }],
  });
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ["completed"]);
  assert.deepEqual(result.outcomes[0].effect, { kind: "delegate", id: "migrate_docs" });
});

test("rejects initial completed and retry receipts without current canonical evidence", () => {
  const missing: DurableDocumentReference = {
    kind: "durable-document",
    path: "docs/impl/ir/missing.md",
    id: "IMPL-MISSING",
    revision: "sha256:missing",
  };
  const repo = fixtureRepo();
  assert.throws(() => runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "probe-to-briefing",
      audit: (fixture, _signals, route, audit) => ({
        ...completedOutcome(fixture, route, "audit", { kind: "audit", id: audit }),
        outputs: [missing],
        proof: missing,
      }),
    }],
  }), /canonical/i);
  assert.throws(() => runScenario({
    repo,
    current: "implementation",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "implementation-retry",
      delegate: (fixture, _signals, route) => retryOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        [missing],
      ),
    }],
  }), /canonical/i);
});

test("does not reuse a non-implementation audit after its authoritative input changes", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", yield: "authority-required" }],
  });
  updateArtifact(repo, "docs/specs/0001-graph.md", { title: "Changed Spec" });

  const resumed = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "probe-to-briefing",
      yield: "authority-required",
      applyCheckpointEvidence: evidence("probe-to-briefing"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");
  assert.equal(resumed.checkpoints.length, 0);
});

test("binds script delegates to their workspace-root and plan/task inputs", () => {
  const repo = fixtureRepo();
  const graphPath = customGraph(repo, `schemaVersion: 2
id: scaffold-input-fixture
entry: start
runtimeSignals: [bootstrap]
conditions:
  bootstrap: { kind: signal, signal: bootstrap }
nodes:
  start: { kind: action }
  bootstrap: { kind: action, delegate: scaffold_docs }
  complete: { kind: terminal }
edges:
  - { id: start-to-bootstrap, from: start, to: bootstrap, when: bootstrap, priority: 10 }
  - { id: bootstrap-to-complete, from: bootstrap, to: complete, when: bootstrap, priority: 10 }
`);
  const interrupted = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["bootstrap"],
    steps: [{ expectEdge: "start-to-bootstrap", yield: "authority-required" }],
  });
  assert.deepEqual(effectInputPaths(interrupted.routes[0], { kind: "delegate", id: "scaffold_docs" }), ["."]);
  fs.unlinkSync(path.join(repo, "docs/specs/README.md"));
  const resumed = runScenario({
    repo,
    graphPath,
    current: "start",
    mode: "run-until-yield",
    signals: ["bootstrap"],
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "start-to-bootstrap",
      yield: "authority-required",
      applyCheckpointEvidence: evidence("start-to-bootstrap"),
    }],
  });
  assert.equal(resumed.yieldReason, "authority-required");

  const focusedRepo = fixtureRepo({ secondPlan: true });
  writeArtifact(focusedRepo, "docs/tasks/0002-focused.md", {
    id: "TASK-0002", type: "task", status: "todo", title: "Focused",
    relations: { implements: ["docs/plans/0002-other.md"] },
  }, "# Focused task\n");
  const taskGraph = runScenario({
    repo: focusedRepo,
    current: "planning",
    mode: "run-until-yield",
    focus: ["docs/plans/0002-other.md"],
    steps: [{ expectEdge: "planning-to-task-graph", yield: "authority-required" }],
  });
  assert.deepEqual(effectInputPaths(taskGraph.routes[0], { kind: "delegate", id: "build_task_graph" }), [
    "docs/plans/0002-other.md",
    "docs/tasks/0002-focused.md",
  ]);
});

test("fails closed when build_task_graph has no selected Task Graph plan", () => {
  assert.throws(
    () => effectInputPaths({ taskGraph: null } as unknown as GraphRoute, { kind: "delegate", id: "build_task_graph" }),
    /Missing selected Task Graph plan/,
  );
});

test("yields commit-required when a gated checkpoint leaves new uncommitted changes", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "task-graph-to-implementation",
      yield: "commit-required",
      applyCheckpointEvidence: evidence("task-graph-to-implementation", (fixture) => {
        // A new untracked file leaves uncommitted changes without
        // invalidating the stored delegate outcome or its receipt.
        fs.writeFileSync(path.join(fixture, "slice-output.txt"), "implemented slice\n", "utf8");
      }),
    }],
  });
  assert.equal(result.yieldReason, "commit-required");
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.handoff.pending?.route.edgeId, "task-graph-to-implementation");
  assert.equal(result.handoff.pending?.evidenceRecorded, true);
  assert.ok(result.handoff.pending?.commitBaseline);

  commitAll(repo);
  const resumed = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    resume: result.handoff,
    steps: [{ expectEdge: "task-graph-to-implementation" }],
  });
  // Resume re-enters the same edge; the retained baseline is reused and the
  // gate passes once HEAD advanced, completing the checkpoint.
  assert.equal(resumed.yieldReason, null);
  assert.equal(resumed.checkpoints.length, 1);
  assert.equal(resumed.current, "implementation");
  assert.equal(resumed.handoff.edgeTrace.at(-1)?.commitWaived, false);
});

test("commit-waived signal skips the gate and completes the checkpoint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    signals: ["commit-waived"],
    steps: [{
      expectEdge: "task-graph-to-implementation",
      applyCheckpointEvidence: evidence("task-graph-to-implementation", (fixture) => {
        updateArtifact(fixture, "docs/tasks/0001-task.md", { status: "done" });
      }),
    }],
  });
  assert.equal(result.yieldReason, null);
  assert.equal(result.checkpoints.length, 1);
  assert.equal(result.handoff.edgeTrace[0].commitWaived, true);
});

test("non-gated destinations ignore worktree state", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "probe",
    mode: "run-until-yield",
    steps: [{ expectEdge: "probe-to-briefing", applyCheckpointEvidence: evidence("probe-to-briefing") }],
  });
  assert.equal(result.yieldReason, null);
  assert.equal(result.checkpoints.length, 1);
});

test("commit gate passes without a commit when dirty entries were already in the baseline", () => {
  const repo = fixtureRepo();
  // Dirty the task doc before the edge starts so the baseline captured at
  // edge start already contains its porcelain entry. Store writes are
  // Git-ignored, so the evidence phase adds no new dirty entries.
  updateArtifact(repo, "docs/tasks/0001-task.md", { title: "pre-existing dirty" });
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "task-graph-to-implementation",
      applyCheckpointEvidence: evidence("task-graph-to-implementation"),
    }],
  });
  // No commit happened: the checkpoint record lands in the Git-ignored
  // Execution Store, so every current porcelain entry was present in the
  // baseline and the strict dirty-subset rule passes. This pins the accepted
  // baseline-dirty limitation: edits inside an already-dirty file are not
  // detected.
  assert.equal(result.yieldReason, null);
  assert.equal(result.checkpoints.length, 1);
});

test("resume reuses the retained baseline instead of recapturing it", () => {
  const repo = fixtureRepo();
  const interrupted = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "task-graph-to-implementation",
      yield: "authority-required",
      delegate: (fixture, _signals, route) => {
        fs.writeFileSync(path.join(fixture, "slice-output.txt"), "x", "utf8");
        return yieldOutcome(
          fixture,
          route,
          "delegate",
          { kind: "delegate", id: route.delegate as string },
          "authority-required",
        );
      },
    }],
  });
  assert.equal(interrupted.yieldReason, "authority-required");
  // The baseline captured at edge start predates slice-output.txt.
  assert.deepEqual(interrupted.handoff.pending?.commitBaseline?.dirty, []);

  // Resume without committing. Under retained-baseline semantics
  // slice-output.txt is not in the baseline, so the gate must yield
  // commit-required again; a recaptured baseline would wrongly include it
  // and let the gate pass.
  const resumed = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    resume: interrupted.handoff,
    steps: [{
      expectEdge: "task-graph-to-implementation",
      yield: "commit-required",
      applyCheckpointEvidence: evidence("task-graph-to-implementation"),
    }],
  });
  assert.equal(resumed.yieldReason, "commit-required");
  assert.equal(resumed.checkpoints.length, 0);
  assert.deepEqual(
    resumed.handoff.pending?.commitBaseline,
    interrupted.handoff.pending?.commitBaseline,
  );
});

test("a delegate-emitted commit-required yields without completing the checkpoint", () => {
  const repo = fixtureRepo();
  const result = runScenario({
    repo,
    current: "task-graph",
    mode: "run-until-yield",
    steps: [{
      expectEdge: "task-graph-to-implementation",
      yield: "commit-required",
      delegate: (fixture, _signals, route) => yieldOutcome(
        fixture,
        route,
        "delegate",
        { kind: "delegate", id: route.delegate as string },
        "commit-required",
      ),
    }],
  });
  assert.equal(result.yieldReason, "commit-required");
  assert.equal(result.checkpoints.length, 0);
});
