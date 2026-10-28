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

export const CASES: E2ECase[] = [
  case01, case02, case03, case04, case05, case06,
  case07a, case07b, case07c,
  case08,
  case09,
  case10a, case10b, case10c,
  case11,
  case12a, case12b, case12c,
];
