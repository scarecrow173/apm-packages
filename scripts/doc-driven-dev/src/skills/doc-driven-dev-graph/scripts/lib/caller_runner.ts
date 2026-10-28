/**
 * Production-grade caller protocol for the doc-driven-dev execution graph.
 *
 * runCaller() drives the public contract:
 *   Graph Definition -> fresh Graph State (one route_graph CLI call per hop)
 *   -> one declared route -> audits -> delegate -> canonical Markdown evidence
 *   -> commit gate -> re-enter at next -> repeat or yield.
 *
 * Effect dispatch is injected: callers supply an EffectDispatcher (LLM, tool,
 * or scripted adapter). This module owns outcome validation, canonical
 * evidence receipts, outcome persistence, the commit baseline/gate, pending
 * edge resume, bounded hops, and run-level trace events — never effect work.
 * The trace it appends is diagnostic only (see run-trace-contract.md).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import matter from "gray-matter";
import type { GraphRoute } from "./graph_router";

export type YieldReason =
  | "terminal" | "single-step-complete" | "budget-exhausted"
  | "approval-required" | "input-required" | "authority-required"
  | "unrecoverable-blocker" | "commit-required";

export type EffectYieldReason = Extract<YieldReason,
  "approval-required" | "input-required" | "authority-required" | "unrecoverable-blocker" | "commit-required">;

export type CallerEffect = { kind: "audit" | "delegate"; id: string };
export type CanonicalReference = { path: string; id: string; fingerprint: string };

export type CompletedEffectOutcome = {
  status: "completed"; edgeId: string; stage: "audit" | "delegate";
  effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  proof: { canonicalEvidence?: CanonicalReference; providerIdempotency?: { provider: string; key: string } };
};
export type RetryEffectOutcome = {
  status: "retry"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  retry: { changedEvidence: CanonicalReference[] };
};
export type YieldEffectOutcome = {
  status: "yield"; edgeId: string; stage: "audit" | "delegate"; effect: CallerEffect;
  authoritativeInputs: CanonicalReference[]; evidence: CanonicalReference[];
  reason: EffectYieldReason;
};
export type EffectOutcome = CompletedEffectOutcome | RetryEffectOutcome | YieldEffectOutcome;

export type EvidenceReceipt = { edgeId: string; evidence: CanonicalReference };
export type CommitBaseline = { head: string | null; dirty: string[] };

/** Thrown for every EffectOutcome contract violation — callers catch it. */
export class OutcomeRejection extends Error {}

/**
 * Canonical workspace directories fingerprinted for the "." reference, in the
 * declared artifact order (same contract as graph_state.ts / artifact_graph.ts).
 */
const CANONICAL_TARGETS = [
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
];

/**
 * Default canonical doc carrying caller bookkeeping (`effectOutcomes` and
 * `checkpointEvidence` front matter). Callers may override it per run; see
 * CallerRunnerOptions.proofPath.
 */
const DEFAULT_PROOF_PATH = "docs/tasks/0001-task.md";

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

export function canonicalReference(repo: string, relativePath: string): CanonicalReference {
  if (relativePath === ".") {
    const entries = CANONICAL_TARGETS.flatMap((directory) => {
      const target = path.join(repo, directory);
      return [
        `${directory}:${filesystemEntryKind(target)}`,
        `${directory}/README.md:${filesystemEntryKind(path.join(target, "README.md"))}`,
      ];
    });
    return {
      path: relativePath,
      id: "WORKSPACE_ROOT",
      fingerprint: fingerprint(entries.join("\n")),
    };
  }
  const file = path.join(repo, relativePath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  // Caller bookkeeping appended to a doc's front matter must not perturb the
  // artifact's own fingerprint — evidence references to the doc stay live.
  const { effectOutcomes: _outcomes, checkpointEvidence: _checkpoints, ...data } = parsed.data;
  return {
    path: relativePath,
    id: data.id as string,
    fingerprint: fingerprint(matter.stringify(parsed.content, data)),
  };
}

export function isCanonicalReference(value: unknown): value is CanonicalReference {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as CanonicalReference).path === "string"
    && typeof (value as CanonicalReference).id === "string"
    && typeof (value as CanonicalReference).fingerprint === "string";
}

export function canonicalEvidenceMatches(repo: string, evidence: CanonicalReference): boolean {
  if (path.isAbsolute(evidence.path)) return false;
  const resolved = path.resolve(repo, evidence.path);
  const relative = path.relative(repo, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved)) return false;
  try {
    const current = canonicalReference(repo, evidence.path);
    return current.id === evidence.id && current.fingerprint === evidence.fingerprint;
  } catch {
    return false;
  }
}

export function storedOutcomes(repo: string, proofPath: string): EffectOutcome[] {
  const parsed = matter(fs.readFileSync(path.resolve(repo, proofPath), "utf8"));
  return Array.isArray(parsed.data.effectOutcomes) ? parsed.data.effectOutcomes as EffectOutcome[] : [];
}

export function persistOutcome(repo: string, proofPath: string, outcome: EffectOutcome): void {
  const file = path.resolve(repo, proofPath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const outcomes = storedOutcomes(repo, proofPath);
  if (!outcomes.some((stored) => JSON.stringify(stored) === JSON.stringify(outcome))) outcomes.push(outcome);
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, effectOutcomes: outcomes }), "utf8");
}

function hasStoredOutcome(repo: string, proofPath: string, outcome: EffectOutcome): boolean {
  return storedOutcomes(repo, proofPath).some((stored) => JSON.stringify(stored) === JSON.stringify(outcome));
}

export function evidenceReceipts(repo: string, proofPath: string): EvidenceReceipt[] {
  const parsed = matter(fs.readFileSync(path.resolve(repo, proofPath), "utf8"));
  return Array.isArray(parsed.data.checkpointEvidence)
    ? parsed.data.checkpointEvidence as EvidenceReceipt[]
    : [];
}

export function persistEvidence(repo: string, proofPath: string, edgeId: string): void {
  const file = path.resolve(repo, proofPath);
  const parsed = matter(fs.readFileSync(file, "utf8"));
  const receipts = evidenceReceipts(repo, proofPath);
  receipts.push({ edgeId, evidence: canonicalReference(repo, proofPath) });
  fs.writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, checkpointEvidence: receipts }), "utf8");
}

export function hasEvidence(repo: string, proofPath: string, edgeId: string): boolean {
  return evidenceReceipts(repo, proofPath).some((receipt) => (
    receipt.edgeId === edgeId
    && isCanonicalReference(receipt.evidence)
    && canonicalEvidenceMatches(repo, receipt.evidence)
  ));
}

export function assertEffectOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  stage: "audit" | "delegate",
  effect: CallerEffect,
  expectedInputs: CanonicalReference[],
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
  if (!Array.isArray(outcome.authoritativeInputs)
      || outcome.authoritativeInputs.length === 0
      || !outcome.authoritativeInputs.every(isCanonicalReference)) {
    throw new OutcomeRejection("authoritativeInputs must be a non-empty list of canonical references");
  }
  if (!isDeepStrictEqual(outcome.authoritativeInputs, expectedInputs)) {
    throw new OutcomeRejection("authoritativeInputs do not match the resolved authoritative inputs");
  }
  if (!Array.isArray(outcome.evidence)
      || outcome.evidence.length === 0
      || !outcome.evidence.every(isCanonicalReference)) {
    throw new OutcomeRejection("evidence must be a non-empty list of canonical references");
  }
  if (!outcome.evidence.every((evidence) => canonicalEvidenceMatches(repo, evidence))) {
    throw new OutcomeRejection("outcome evidence must resolve current canonical content");
  }
  if (outcome.status === "completed") {
    if ("reason" in outcome) {
      throw new OutcomeRejection("completed outcome must not include reason");
    }
    if ("retry" in outcome) {
      throw new OutcomeRejection("completed outcome must not include retry");
    }
    const proof = outcome.proof ?? {};
    const hasCanonicalEvidence = isCanonicalReference(proof.canonicalEvidence);
    const hasProviderIdempotency = typeof proof.providerIdempotency?.provider === "string"
      && proof.providerIdempotency.provider.length > 0
      && typeof proof.providerIdempotency.key === "string"
      && proof.providerIdempotency.key.length > 0;
    if (hasCanonicalEvidence === hasProviderIdempotency) {
      throw new OutcomeRejection(
        "completed outcome requires exactly one of proof.canonicalEvidence or proof.providerIdempotency",
      );
    }
    if (isCanonicalReference(proof.canonicalEvidence)
        && !canonicalEvidenceMatches(repo, proof.canonicalEvidence)) {
      throw new OutcomeRejection("completed proof must resolve current canonical content");
    }
  } else if (outcome.status === "retry") {
    if ("proof" in outcome) {
      throw new OutcomeRejection("retry outcome must not include proof");
    }
    if ("reason" in outcome) {
      throw new OutcomeRejection("retry outcome must not include reason");
    }
    const changedEvidence = outcome.retry?.changedEvidence;
    if (!Array.isArray(changedEvidence)
        || changedEvidence.length === 0
        || !changedEvidence.every(isCanonicalReference)) {
      throw new OutcomeRejection("retry outcome must include non-empty canonical changedEvidence");
    }
    if (!changedEvidence.every((evidence) => canonicalEvidenceMatches(repo, evidence))) {
      throw new OutcomeRejection("retry evidence must resolve current canonical content");
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

export function isReusableCompletedOutcome(
  repo: string,
  route: GraphRoute,
  outcome: EffectOutcome,
  proofPath: string = DEFAULT_PROOF_PATH,
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
  try {
    // The authoritative-input mapping belongs to the injected dispatcher, so
    // reuse validation re-checks the outcome's own declared inputs — shape,
    // edge/stage/effect identity, and live evidence fingerprints.
    assertEffectOutcome(repo, route, outcome, outcome.stage, outcome.effect, outcome.authoritativeInputs);
  } catch {
    return false;
  }
  if (!hasStoredOutcome(repo, proofPath, outcome)) return false;
  const proof = outcome.proof;
  if (proof?.providerIdempotency !== undefined) return true;
  const canonicalEvidence = proof?.canonicalEvidence;
  return isCanonicalReference(canonicalEvidence)
    && canonicalEvidenceMatches(repo, canonicalEvidence);
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
