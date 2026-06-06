"use strict";

import type { RuntimeGuidance, ScannedSkill } from "./types";

type SelectionContext = {
  terms?: string[];
};

type ScoredGuidance = {
  guidance: RuntimeGuidance;
  score: number;
};

function normalizeTerms(terms: string[] = []): string[] {
  return terms
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

function entryText(entry: RuntimeGuidance): string {
  return `${entry.skill} ${entry.context} ${entry.guidance}`.toLowerCase();
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term) || term.includes(text));
}

function isCompatibleWithPolicy(entry: RuntimeGuidance, policy: ScannedSkill["execution_policy"]): boolean {
  if (entry.requires_sequence && !policy.sequence_required) {
    return false;
  }

  if (entry.requires_step_reordering && !policy.allow_step_reordering) {
    return false;
  }

  if (entry.requires_partial_application && !policy.allow_partial_application) {
    return false;
  }

  return true;
}

function scoreGuidance(entry: RuntimeGuidance, selectionContext: SelectionContext): number {
  let score = entry.priority_delta ?? 0;
  const selectionTerms = normalizeTerms(selectionContext.terms);

  if (selectionTerms.length === 0) {
    return score;
  }

  const preferTerms = normalizeTerms(entry.prefer_when);
  const avoidTerms = normalizeTerms(entry.avoid_when);
  const haystack = entryText(entry);

  for (const term of selectionTerms) {
    if (haystack.includes(term) || term.includes(haystack)) {
      score += 1;
    }

    if (matchesAny(term, preferTerms)) {
      score += 3;
    }

    if (matchesAny(term, avoidTerms)) {
      score -= 3;
    }
  }

  return score;
}

export function rankRuntimeGuidance(
  entries: RuntimeGuidance[],
  skills: ScannedSkill[] = [],
  selectionContext: SelectionContext = {},
): RuntimeGuidance[] {
  const policyBySkill = new Map(skills.map((skill) => [skill.name, skill.execution_policy]));
  const seen = new Set<string>();
  const scored: ScoredGuidance[] = [];

  for (const entry of entries) {
    const policy = policyBySkill.get(entry.skill);
    if (policy && !isCompatibleWithPolicy(entry, policy)) {
      continue;
    }

    const dedupeKey = `${entry.skill}::${entry.context}::${entry.guidance}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    scored.push({
      guidance: entry,
      score: scoreGuidance(entry, selectionContext),
    });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const skillCompare = left.guidance.skill.localeCompare(right.guidance.skill);
    if (skillCompare !== 0) {
      return skillCompare;
    }

    const contextCompare = left.guidance.context.localeCompare(right.guidance.context);
    if (contextCompare !== 0) {
      return contextCompare;
    }

    return left.guidance.guidance.localeCompare(right.guidance.guidance);
  });

  return scored.map((item) => item.guidance);
}
