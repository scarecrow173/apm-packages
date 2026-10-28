import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TRACE_SCHEMA_VERSION = 1;

export type ExecutionMode = "same-context" | "subagent" | "tool" | "unknown";

export type EffectYieldReason =
  | "approval-required"
  | "input-required"
  | "authority-required"
  | "unrecoverable-blocker"
  | "commit-required";

export type RunYieldReason =
  | EffectYieldReason
  | "budget-exhausted"
  | "terminal"
  | "single-step-complete";

type TraceEventBase = {
  v: typeof TRACE_SCHEMA_VERSION;
  runId: string;
  seq: number;
};

export type ArtifactScanEvent = TraceEventBase & {
  kind: "artifact-scan";
  scans: number;
  filesRead: number;
  uniqueFiles: number;
  bytesRead: number;
};

export type RouteSelectedEvent = TraceEventBase & {
  kind: "route-selected";
  current: string;
  next: string;
  edgeId: string | null;
  status: "edge" | "terminal" | "blocked";
  condition: string;
  delegate: string | null;
  requiredAudits: string[];
  commitGate: boolean;
  blockers: string[];
  focus: string[];
  tasks: Array<{ id: string; status: string }>;
  routeHash: string;
  durationMs?: number;
};

export type EffectDispatchedEvent = TraceEventBase & {
  kind: "effect-dispatched";
  edgeId: string;
  stage: "audit" | "delegate";
  effectId: string;
  executionMode: ExecutionMode;
  focusPaths: string[];
};

export type EffectOutcomeEvent = TraceEventBase & {
  kind: "effect-outcome";
  edgeId: string;
  stage: "audit" | "delegate";
  effectId: string;
  outcome: "completed" | "retry" | "yield";
  reason?: EffectYieldReason;
  evidencePaths: string[];
};

export type RunYieldEvent = TraceEventBase & {
  kind: "run-yield";
  reason: RunYieldReason;
  hops: number;
  completedEdges: string[];
};

export type TraceEvent =
  | ArtifactScanEvent
  | RouteSelectedEvent
  | EffectDispatchedEvent
  | EffectOutcomeEvent
  | RunYieldEvent;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type TraceEventInput = DistributiveOmit<TraceEvent, "seq">;

export type TraceSummary = {
  runId: string;
  eventCount: number;
  routeSelections: number;
  edgesSelected: string[];
  blockedRoutes: number;
  terminalRoutes: number;
  auditsDispatched: Record<string, number>;
  delegatesDispatched: Record<string, number>;
  executionModes: Record<ExecutionMode, number>;
  effectOutcomes: { completed: number; retry: number; yield: number };
  yieldReasons: Record<string, number>;
  scans: number;
  filesRead: number;
  uniqueFilesMax: number;
  bytesRead: number;
};

const EXECUTION_MODES: readonly ExecutionMode[] = ["same-context", "subagent", "tool", "unknown"];
const EFFECT_YIELD_REASONS: readonly string[] = [
  "approval-required", "input-required", "authority-required",
  "unrecoverable-blocker", "commit-required",
];
const RUN_YIELD_REASONS: readonly string[] = [
  ...EFFECT_YIELD_REASONS, "budget-exhausted", "terminal", "single-step-complete",
];
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/;
const BLOCKER_TOKEN = /^[a-z0-9-]+:sha256:[0-9a-f]{12}$/;

function fail(message: string): never {
  throw new Error(`run trace: ${message}`);
}

function requireCount(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    fail(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${field} must be a non-empty string`);
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${field} must be a string array`);
  }
  return value as string[];
}

function requireRelativePaths(value: unknown, field: string): string[] {
  const paths = requireStringArray(value, field);
  for (const item of paths) {
    if (ABSOLUTE_PATH.test(item)) fail(`${field} must use repo-relative paths, got: ${item}`);
  }
  return paths;
}

function requireStage(value: unknown): "audit" | "delegate" {
  if (value !== "audit" && value !== "delegate") fail(`stage must be audit or delegate`);
  return value;
}

/** Map a free-text blocker to a bounded deterministic token: kind + content hash. */
function sanitizeBlocker(blocker: string): string {
  if (BLOCKER_TOKEN.test(blocker)) return blocker;
  const separator = blocker.indexOf(":");
  if (separator === -1) return blocker;
  const kind = blocker.slice(0, separator);
  const digest = crypto.createHash("sha256").update(blocker).digest("hex").slice(0, 12);
  return `${kind}:sha256:${digest}`;
}

function baseFields(record: Record<string, unknown>): TraceEventBase {
  if (record.v !== TRACE_SCHEMA_VERSION) fail(`unsupported schema version: ${String(record.v)}`);
  const seq = requireCount(record.seq, "seq");
  if (seq < 1) fail("seq must be a positive integer");
  return { v: TRACE_SCHEMA_VERSION, runId: requireString(record.runId, "runId"), seq };
}

/** Validate a raw value into a canonical TraceEvent, dropping unknown fields. */
export function normalizeTraceEvent(raw: unknown): TraceEvent {
  if (!raw || typeof raw !== "object") fail("event must be an object");
  const record = raw as Record<string, unknown>;
  const base = baseFields(record);
  switch (record.kind) {
    case "artifact-scan":
      return {
        ...base, kind: "artifact-scan",
        scans: requireCount(record.scans, "scans"),
        filesRead: requireCount(record.filesRead, "filesRead"),
        uniqueFiles: requireCount(record.uniqueFiles, "uniqueFiles"),
        bytesRead: requireCount(record.bytesRead, "bytesRead"),
      };
    case "route-selected": {
      const status = record.status;
      if (status !== "edge" && status !== "terminal" && status !== "blocked") {
        fail("route-selected status must be edge, terminal, or blocked");
      }
      if (typeof record.commitGate !== "boolean") {
        fail("commitGate must be a boolean");
      }
      const event: RouteSelectedEvent = {
        ...base, kind: "route-selected",
        current: requireString(record.current, "current"),
        next: requireString(record.next, "next"),
        edgeId: record.edgeId === null ? null : requireString(record.edgeId, "edgeId"),
        status,
        condition: requireString(record.condition, "condition"),
        delegate: record.delegate === null ? null : requireString(record.delegate, "delegate"),
        requiredAudits: requireStringArray(record.requiredAudits, "requiredAudits"),
        commitGate: record.commitGate,
        blockers: requireStringArray(record.blockers, "blockers").map(sanitizeBlocker),
        focus: requireRelativePaths(record.focus, "focus"),
        tasks: requireTasks(record.tasks),
        routeHash: requireString(record.routeHash, "routeHash"),
      };
      if (record.durationMs !== undefined) {
        if (!Number.isFinite(record.durationMs) || (record.durationMs as number) < 0) {
          fail("durationMs must be a finite non-negative number");
        }
        event.durationMs = record.durationMs as number;
      }
      return event;
    }
    case "effect-dispatched": {
      const mode = record.executionMode;
      if (!EXECUTION_MODES.includes(mode as ExecutionMode)) {
        fail(`executionMode must be one of ${EXECUTION_MODES.join(", ")}`);
      }
      return {
        ...base, kind: "effect-dispatched",
        edgeId: requireString(record.edgeId, "edgeId"),
        stage: requireStage(record.stage),
        effectId: requireString(record.effectId, "effectId"),
        executionMode: mode as ExecutionMode,
        focusPaths: requireRelativePaths(record.focusPaths, "focusPaths"),
      };
    }
    case "effect-outcome": {
      const outcome = record.outcome;
      if (outcome !== "completed" && outcome !== "retry" && outcome !== "yield") {
        fail("effect-outcome outcome must be completed, retry, or yield");
      }
      if (record.reason !== undefined && !EFFECT_YIELD_REASONS.includes(record.reason as string)) {
        fail(`effect-outcome reason must be one of ${EFFECT_YIELD_REASONS.join(", ")}`);
      }
      if (outcome !== "yield" && record.reason !== undefined) {
        fail("effect-outcome reason is only valid for yield outcomes");
      }
      if (outcome === "yield" && record.reason === undefined) {
        fail("effect-outcome yield requires a reason");
      }
      const event: EffectOutcomeEvent = {
        ...base, kind: "effect-outcome",
        edgeId: requireString(record.edgeId, "edgeId"),
        stage: requireStage(record.stage),
        effectId: requireString(record.effectId, "effectId"),
        outcome,
        evidencePaths: requireRelativePaths(record.evidencePaths, "evidencePaths"),
      };
      if (record.reason !== undefined) event.reason = record.reason as EffectYieldReason;
      return event;
    }
    case "run-yield": {
      if (!RUN_YIELD_REASONS.includes(record.reason as string)) {
        fail(`run-yield reason must be one of ${RUN_YIELD_REASONS.join(", ")}`);
      }
      return {
        ...base, kind: "run-yield",
        reason: record.reason as RunYieldReason,
        hops: requireCount(record.hops, "hops"),
        completedEdges: requireStringArray(record.completedEdges, "completedEdges"),
      };
    }
    default:
      fail(`unknown trace event kind: ${String(record.kind)}`);
  }
}

function requireTasks(value: unknown): Array<{ id: string; status: string }> {
  if (!Array.isArray(value)) fail("tasks must be an array");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") fail("tasks entries must be objects");
    const task = entry as Record<string, unknown>;
    return { id: requireString(task.id, "tasks[].id"), status: requireString(task.status, "tasks[].status") };
  });
}

/** Append one event to a JSONL trace file; seq is assigned per runId. */
export function appendTraceEvent(filePath: string, input: TraceEventInput): TraceEvent {
  const resolved = path.resolve(filePath);
  const existing = fs.existsSync(resolved) ? readTraceFile(resolved) : [];
  const seq = existing.filter((event) => event.runId === input.runId).length + 1;
  const event = normalizeTraceEvent({ ...input, seq });
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

/** Read every event in a JSONL trace file, in file order. */
export function readTraceFile(filePath: string): TraceEvent[] {
  const text = fs.readFileSync(filePath, "utf8");
  const events: TraceEvent[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(`line ${index + 1} is not valid JSON`);
    }
    try {
      events.push(normalizeTraceEvent(parsed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`line ${index + 1}: ${message}`);
    }
  });
  return events;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** sha256 over the key-sorted JSON of a complete GraphRoute. */
export function stableRouteHash(route: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(sortValue(route))).digest("hex");
}

/**
 * Per-run aggregate counters for measurement and fixture comparison.
 * Callers must pre-filter events by `runId`; this aggregates whatever array it
 * receives and adopts the first event's `runId` as the summary label.
 */
export function summarizeTrace(events: TraceEvent[]): TraceSummary {
  const scoped = [...events].sort((a, b) => a.seq - b.seq);
  const runId = scoped[0]?.runId ?? "";
  const summary: TraceSummary = {
    runId,
    eventCount: scoped.length,
    routeSelections: 0,
    edgesSelected: [],
    blockedRoutes: 0,
    terminalRoutes: 0,
    auditsDispatched: {},
    delegatesDispatched: {},
    executionModes: { "same-context": 0, subagent: 0, tool: 0, unknown: 0 },
    effectOutcomes: { completed: 0, retry: 0, yield: 0 },
    yieldReasons: {},
    scans: 0,
    filesRead: 0,
    uniqueFilesMax: 0,
    bytesRead: 0,
  };
  const bump = (table: Record<string, number>, key: string) => {
    table[key] = (table[key] ?? 0) + 1;
  };
  for (const event of scoped) {
    switch (event.kind) {
      case "route-selected":
        summary.routeSelections += 1;
        if (event.edgeId) summary.edgesSelected.push(event.edgeId);
        if (event.status === "blocked") summary.blockedRoutes += 1;
        if (event.status === "terminal") summary.terminalRoutes += 1;
        break;
      case "artifact-scan":
        summary.scans += event.scans;
        summary.filesRead += event.filesRead;
        summary.bytesRead += event.bytesRead;
        summary.uniqueFilesMax = Math.max(summary.uniqueFilesMax, event.uniqueFiles);
        break;
      case "effect-dispatched":
        summary.executionModes[event.executionMode] += 1;
        bump(event.stage === "audit" ? summary.auditsDispatched : summary.delegatesDispatched, event.effectId);
        break;
      case "effect-outcome":
        summary.effectOutcomes[event.outcome] += 1;
        if (event.outcome === "yield" && event.reason) bump(summary.yieldReasons, event.reason);
        break;
      case "run-yield":
        bump(summary.yieldReasons, event.reason);
        break;
    }
  }
  return summary;
}

/** Strip non-deterministic fields before comparing traces across fixtures. */
export function normalizeForCompare(events: TraceEvent[]): Array<Record<string, unknown>> {
  return events.map((event) => {
    const clone: Record<string, unknown> = { ...event };
    delete clone.durationMs;
    return clone;
  });
}
