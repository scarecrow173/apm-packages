import type { E2ECase } from "../harness/case_types";
import { case01 } from "./case-01-happy-path";
import { case02 } from "./case-02-focus-required";
import { case03 } from "./case-03-briefing-retry";
import { case04 } from "./case-04-approval-resume";
import { case05 } from "./case-05-broken-relation";
import { case06 } from "./case-06-tasks-active";

export const CASES: E2ECase[] = [case01, case02, case03, case04, case05, case06];
