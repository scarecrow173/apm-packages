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
import type { CaseExpect } from "./case_validator";
import type { createFixtureRepo } from "./fixture_manager";
import type { EdgeScript, Mutator } from "./scripted_dispatcher";

export type E2ECase = {
  id: string;
  description: string;
  /** Default: standard happy fixture (oracle fixtureRepo layout). */
  fixture?: Parameters<typeof createFixtureRepo>[0];
  /** Default: graph entry node (allows starting mid-graph). */
  current?: string;
  focus?: string[];
  signals?: string[];
  graph?: string;
  maxHops?: number;
  mode?: "run-until-yield" | "single-step";
  /** Default "docs/tasks/0001-task.md". */
  proofPath?: string;
  /** Dispatcher script (keyed by edgeId). */
  script?: Record<string, EdgeScript>;
  /**
   * Optional per-effect execution-mode policy, passed verbatim to runCaller's
   * `policy` option on every leg. Absent → `effect-dispatched` carries the
   * declared executionMode ("tool" for the scripted adapter) and no modeReason.
   */
  policy?: (route: GraphRoute, effect: CallerEffect) => PolicyFacts;
  /** Multi-run legs (resume flows). Leg 0 is always a fresh run. */
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
     */
    options?: Partial<Pick<CallerRunnerOptions, "focus" | "signals" | "current" | "mode" | "maxHops">> & {
      /** Default true for legs ≥ 1: thread the previous leg's handoff. */
      resume?: boolean;
    };
    /**
     * Per-leg expectations — evaluated against this leg's own trace slice
     * (between the previous leg's run-yield and this leg's run-yield).
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
