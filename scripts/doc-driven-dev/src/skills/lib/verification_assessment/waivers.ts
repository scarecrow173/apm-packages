"use strict";

// ---------------------------------------------------------------------------
// Waivers + not-applicable verdicts — validated exemptions (Issue #241)
// ---------------------------------------------------------------------------
//
// An exemption is an ASSERTION the summary validates, never a skip a
// caller smuggles in:
//
//   VerificationWaiver — exempts one required check or every required
//   check targeting one claim. Valid only when:
//     - the shape is complete (scope.kind ∈ check|claim, resolvable ref,
//       non-empty authority and reason, ISO grantedAt/expiresAt),
//     - `authority` sits in the caller-supplied trusted allowlist — no
//       allowlist, no applied waiver,
//     - `scope.ref` resolves in the live Knowledge Graph,
//     - `expiresAt` is a future deadline at the assessment instant —
//       expiry AT or BEFORE the instant is expired, and expiry at or
//       before `grantedAt` is a malformed window.
//
//   NotApplicableVerdict — declares a check conditionally out-of-scope
//   for the current change. Valid only when every impact-analysis field
//   is present: the check ref resolves, `revision` names what the
//   analysis ran at, `paths` lists the changed inputs it covered, `rule`
//   names the precondition/rule applied, and `judger`/`method`/`reason`
//   say who judged, how, and why. Missing basis = refused verdict; an
//   unexecuted check is NEVER out-of-scope by default.
//
// Rejections are data, not silence: a refused waiver or verdict lands in
// `rejectedWaivers`/`rejectedNotApplicable` on the summary AND attaches
// to its check with `status: "rejected"`, so a gate sees the refusal.

import { resolveCheckReference, resolveClaimReference } from "../knowledge_graph";
import type { KnowledgeGraph } from "../knowledge_graph";
import { validateNotApplicableVerdict, validateWaiver } from "./types";
import type {
  ExemptionVerdict,
  NotApplicableVerdict,
  RejectedNotApplicable,
  RejectedWaiver,
  VerificationWaiver,
} from "./types";

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

const WAIVER_REASONS = {
  malformed: "waiver-malformed",
  untrustedAuthority: "waiver-untrusted-authority",
  scopeUnresolved: "waiver-scope-unresolved",
  expired: "waiver-expired",
  invalidWindow: "waiver-invalid-window",
} as const;

function waiverScopeResolves(graph: KnowledgeGraph, waiver: VerificationWaiver): boolean {
  if (waiver.scope.kind === "check") {
    return resolveCheckReference(graph, waiver.scope.ref).status === "resolved";
  }
  return resolveClaimReference(graph, waiver.scope.ref).status === "resolved";
}

// Evaluate one waiver candidate against the graph, the trusted-authority
// allowlist, and the assessment instant. `authorities === null` means the
// caller declared no trust policy — every waiver rejects as untrusted
// (fail closed: no implicit authority).
function evaluateWaiver(
  graph: KnowledgeGraph,
  input: unknown,
  authorities: string[] | null,
  now: string,
): ExemptionVerdict<VerificationWaiver> {
  const reasons: string[] = [];
  if (!validateWaiver(input)) {
    const waiver = (typeof input === "object" && input !== null
      ? input
      : { scope: { kind: "check", ref: "" }, authority: "", reason: "", grantedAt: "", expiresAt: "" }
    ) as VerificationWaiver;
    return { verdict: waiver, status: "rejected", reasons: [WAIVER_REASONS.malformed] };
  }
  if (authorities === null || !authorities.includes(input.authority)) {
    reasons.push(WAIVER_REASONS.untrustedAuthority);
  }
  if (!waiverScopeResolves(graph, input)) {
    reasons.push(WAIVER_REASONS.scopeUnresolved);
  }
  const granted = Date.parse(input.grantedAt);
  const expires = Date.parse(input.expiresAt);
  if (expires <= Date.parse(now)) {
    reasons.push(WAIVER_REASONS.expired);
  }
  if (expires <= granted) {
    reasons.push(WAIVER_REASONS.invalidWindow);
  }
  return { verdict: input, status: reasons.length === 0 ? "applied" : "rejected", reasons };
}

// Evaluate all waiver candidates once; results keyed for scope lookup —
// `check:<ref>` for check waivers, `claim:<ref>` for claim waivers that
// cover every required check targeting the claim.
function evaluateWaivers(
  graph: KnowledgeGraph,
  inputs: unknown[],
  authorities: string[] | null,
  now: string,
): { results: ExemptionVerdict<VerificationWaiver>[]; rejected: RejectedWaiver[] } {
  const results = inputs.map((input) => evaluateWaiver(graph, input, authorities, now));
  const rejected = results
    .filter((result) => result.status === "rejected")
    .map((result) => ({ waiver: result.verdict, reasons: result.reasons }));
  return { results, rejected };
}

// ---------------------------------------------------------------------------
// Not-applicable verdicts
// ---------------------------------------------------------------------------

const NOT_APPLICABLE_REASONS = {
  malformed: "not-applicable-malformed",
  checkUnresolved: "not-applicable-check-unresolved",
} as const;

function evaluateNotApplicable(
  graph: KnowledgeGraph,
  input: unknown,
): ExemptionVerdict<NotApplicableVerdict> {
  if (!validateNotApplicableVerdict(input)) {
    const verdict = (typeof input === "object" && input !== null
      ? input
      : { check: "", revision: "", paths: [], rule: "", judger: "", method: "", reason: "" }
    ) as NotApplicableVerdict;
    return { verdict, status: "rejected", reasons: [NOT_APPLICABLE_REASONS.malformed] };
  }
  if (resolveCheckReference(graph, input.check).status !== "resolved") {
    return { verdict: input, status: "rejected", reasons: [NOT_APPLICABLE_REASONS.checkUnresolved] };
  }
  return { verdict: input, status: "applied", reasons: [] };
}

function evaluateNotApplicables(
  graph: KnowledgeGraph,
  inputs: unknown[],
): { results: ExemptionVerdict<NotApplicableVerdict>[]; rejected: RejectedNotApplicable[] } {
  const results = inputs.map((input) => evaluateNotApplicable(graph, input));
  const rejected = results
    .filter((result) => result.status === "rejected")
    .map((result) => ({ verdict: result.verdict, reasons: result.reasons }));
  return { results, rejected };
}

export { evaluateWaivers, evaluateNotApplicables, NOT_APPLICABLE_REASONS, WAIVER_REASONS };
