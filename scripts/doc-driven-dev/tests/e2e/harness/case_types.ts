/**
 * Declarative E2E case shape. A case is pure data: fixture parameters, the
 * dispatcher script keyed by edgeId, optional multi-run legs for resume flows,
 * and the expectations the independent validator checks.
 */
import type {
  CallerEffect,
  CallerRunnerOptions,
} from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
import type { PolicyFacts } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/delegate_policy";
import type { GraphRoute } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import type { ExecutionMode } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/run_trace";
import type { CaseExpect } from "./case_validator";
import type { CliOp } from "./cli_ops";
import type { createFixtureRepo } from "./fixture_manager";
import type { EdgeScript, Mutator } from "./scripted_dispatcher";

export type E2ECase = {
  id: string;
  description: string;
  /** Default: standard happy fixture (oracle fixtureRepo layout). */
  fixture?: Parameters<typeof createFixtureRepo>[0];
  /**
   * Declared ops run after fixture creation and BEFORE any leg — real CLI
   * invocations (migrate plan/apply/recovery, evidence puts, index apply),
   * mutators, and saved snapshots/artifacts, recorded verbatim for the
   * validator. Pure-CLI cases set `steps: []` and assert only op results.
   */
  ops?: CliOp[];
  /** Declared ops run after the legs, before validation (e.g. index apply). */
  postOps?: CliOp[];
  /**
   * Router override (default: tsx + the production route_graph CLI). The
   * v2-refusal cases point it at a fixture script emitting a stale route
   * payload so the CALLER's own refusal is what is under test.
   */
  router?: { executable: string; prefixArgs: string[] };
  /** Default: graph entry node (allows starting mid-graph). */
  current?: string;
  focus?: string[];
  signals?: string[];
  graph?: string;
  maxHops?: number;
  mode?: "run-until-yield" | "single-step";
  /** Dispatcher script (keyed by edgeId). */
  script?: Record<string, EdgeScript>;
  /**
   * Optional per-effect execution-mode policy, passed verbatim to runCaller's
   * `policy` option on every leg. Absent → `effect-dispatched` carries the
   * declared executionMode ("tool" for the scripted adapter) and no modeReason.
   */
  policy?: (route: GraphRoute, effect: CallerEffect) => PolicyFacts;
  /**
   * Modes the scripted adapter cannot execute — dispatching one is refused
   * (not-executed + yield), never silently switched. Simulates a host
   * without the capability.
   */
  unsupportedModes?: ExecutionMode[];
  /** Passed verbatim to runCaller's `buildHandoff` on every leg. */
  buildHandoff?: CallerRunnerOptions["buildHandoff"];
  /**
   * Multi-run legs (resume flows). Leg 0 is always a fresh run. An EMPTY
   * array declares a pure-ops case: no runCaller leg runs at all (the
   * migration/preflight lanes), expectations assert op results and
   * end-state only.
   */
  steps?: Array<{
    /** Applied between runs (e.g. approval edit). */
    mutateBefore?: Mutator[];
    /**
     * Leg-scoped runner options. `focus`/`signals` always apply when given —
     * an explicit option beats the handoff inside runCaller. On RESUMED legs
     * (the default for legs ≥ 1) `current`/`mode`/`maxHops` come from the
     * previous leg's CallerHandoff and the option fields are ignored — the
     * handoff wins by runner contract. Set `resume: false` for a fresh run
     * on the same repo + trace: no handoff is passed, so ALL option fields
     * (including current/mode/maxHops) take effect. e2e-02's leg 2 needs
     * this — it is a new run, not a resume.
     *
     * `verificationSummary` binds the leg to a caller-supplied summary
     * file (an op-produced path via `$<saveAs>`); `focus` entries accept
     * `$run:only` (the fixture's single store run) and `$<saveAs>`
     * placeholders resolved from op results.
     */
    options?: Partial<Pick<CallerRunnerOptions, "focus" | "signals" | "current" | "mode" | "maxHops" | "verificationSummary">> & {
      /** Default true for legs ≥ 1: thread the previous leg's handoff. */
      resume?: boolean;
      /**
       * Execution Store run this (fresh) leg binds — e.g. `$run:only` for a
       * migration-imported run. An existing run keeps its records verbatim;
       * a new id is created and seeded from the fixture's task docs.
       */
      runId?: string;
    };
    /**
     * Per-leg expectations — evaluated against this leg's own trace slice
     * (between the previous leg's run-yield and this leg's run-yield).
     * briefingAudit/checkpointReceipts use the filesystem at the leg boundary;
     * finalFiles retains its end-of-run semantics.
     */
    expect?: Partial<CaseExpect>;
  }>;
  /**
   * Final-leg expectations: `yield`/`edgeSequence`/`completedEdges` scope to
   * the LAST leg's trace partition, `events` tallies the WHOLE concatenated
   * run, and `finalFiles` reads end-of-run repo state.
   */
  expect: CaseExpect;
};
