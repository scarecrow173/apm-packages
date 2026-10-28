/**
 * Declarative E2E case shape. A case is pure data: fixture parameters, the
 * dispatcher script keyed by edgeId, optional multi-run legs for resume flows,
 * and the expectations the independent validator checks.
 */
import type { CallerRunnerOptions } from "../../../src/skills/doc-driven-dev-graph/scripts/lib/caller_runner";
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
  /** Multi-run legs (resume flows). */
  steps?: Array<{
    /** Applied between runs (e.g. approval edit). */
    mutateBefore?: Mutator[];
    options?: Partial<Pick<CallerRunnerOptions, "focus" | "signals" | "current" | "mode" | "maxHops">>;
    /** Per-leg expectations. */
    expect?: Partial<CaseExpect>;
  }>;
  /** Final-leg expectations. */
  expect: CaseExpect;
};
