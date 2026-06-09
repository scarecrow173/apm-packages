"use strict";

import type { FlowProfile, SkillReferenceCatalog } from "../types";

// ─── Query Types ───

export type QueryArgs = {
  profile?: string;
  subcommand?: string;
  category?: string;
  skill?: string;
  slot?: string;
  capability?: string;
  cwd?: string;
  help?: boolean;
  format?: "json" | "md" | "table";
};

export type ValidationReport = {
  schema_version: string;
  validated_at: string;
  adapter_id: string;
  checks: { name: string; status: string; message?: string }[];
  summary: { total: number; passed: number; failed: number; skipped: number };
};

export type QueryContext = {
  profile: FlowProfile;
  catalog: SkillReferenceCatalog | null;
  validationReport: ValidationReport | null;
  args: QueryArgs;
};

export type QueryHandler = {
  name: string;
  description: string;
  requiredArgs?: string[];
  execute: (ctx: QueryContext) => unknown;
};

// ─── Registry ───

const registry: Map<string, QueryHandler> = new Map();

export function register(handler: QueryHandler): void {
  registry.set(handler.name, handler);
}

export function getHandler(name: string): QueryHandler | undefined {
  return registry.get(name);
}

export function getAllHandlers(): QueryHandler[] {
  return Array.from(registry.values());
}

export function getSubcommandNames(): string[] {
  return Array.from(registry.keys());
}

export function findClosestMatch(input: string): string | null {
  const names = getSubcommandNames();
  let best: string | null = null;
  let bestDist = Infinity;

  for (const name of names) {
    const dist = levenshtein(input, name);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  // Only suggest if distance is reasonable (< half the length of input)
  if (best && bestDist <= Math.ceil(input.length / 2)) {
    return best;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
