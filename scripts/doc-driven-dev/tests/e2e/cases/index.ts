import type { E2ECase } from "../harness/case_types";
import { case01 } from "./case-01-happy-path";
import { case02 } from "./case-02-focus-required";
import { case03 } from "./case-03-briefing-retry";
import { case04 } from "./case-04-approval-resume";
import { case05 } from "./case-05-broken-relation";
import { case06 } from "./case-06-tasks-active";
import { case07a, case07b, case07c } from "./case-07-task-graph-fail-closed";
import { case08 } from "./case-08-implementation-loopback";
import { case09 } from "./case-09-commit-required";
import { case10a, case10b, case10c } from "./case-10-outcome-rejections";
import { case11 } from "./case-11-audit-retry";
import { case12a, case12b, case12c } from "./case-12-budgets-terminal";
import { case13a, case13b, case13c } from "./case-13-execution-modes";
import { case14a, case14c } from "./case-14-briefing-execution";
import {
  case15a, case15b, case15c, case15d,
  case15e, case15f, case15g, case15h, case15i, case15j,
} from "./case-15-dispatch-observation";
import { case16 } from "./case-16-preflight-migration";
import { case17a, case17b, case17c } from "./case-17-migration-plan-apply";
import { case18 } from "./case-18-migration-resume-portable";
import { case19a, case19b } from "./case-19-focus-run-selection";
import { case20 } from "./case-20-plan-approval-digest";
import { case21a, case21b } from "./case-21-task-graph-dag";
import { case22a, case22b } from "./case-22-parallel-tasks-cas";
import { case23a, case23b, case23c } from "./case-23-effect-receipts";
import { case24a, case24b, case24c } from "./case-24-evidence-invalidation";
import { case25a, case25b, case25c, case25d } from "./case-25-evidence-integrity";
import { case26a, case26b, case26c, case26d, case26e } from "./case-26-verification-exemptions";
import { case27 } from "./case-27-knowledge-noop";
import { case28 } from "./case-28-knowledge-consolidation";
import { case29 } from "./case-29-index-materialization";
import { case30a, case30b } from "./case-30-stale-route-refusal";
import { case31 } from "./case-31-evidence-store-boundary";

export const CASES: E2ECase[] = [
  case01, case02, case03, case04, case05, case06,
  case07a, case07b, case07c,
  case08,
  case09,
  case10a, case10b, case10c,
  case11,
  case12a, case12b, case12c,
  case13a, case13b, case13c,
  case14a, case14c,
  case15a, case15b, case15c, case15d,
  case15e, case15f, case15g, case15h, case15i, case15j,
  case16,
  case17a, case17b, case17c,
  case18,
  case19a, case19b,
  case20,
  case21a, case21b,
  case22a, case22b,
  case23a, case23b, case23c,
  case24a, case24b, case24c,
  case25a, case25b, case25c, case25d,
  case26a, case26b, case26c, case26d, case26e,
  case27,
  case28,
  case29,
  case30a, case30b,
  case31,
];
