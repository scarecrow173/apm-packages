"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "unresolved",
  description: "未解決一覧",
  execute(ctx: QueryContext): unknown {
    const unresolved: unknown[] = [];

    // Check resolved_invocations for null/empty resolved_skill
    for (const inv of ctx.profile.resolved_invocations) {
      if (!inv.resolved_skill) {
        unresolved.push({
          source: "resolved_invocations",
          source_skill: inv.source_skill,
          capability: inv.capability,
          slot: inv.slot,
          reason: inv.reason,
        });
      }
    }

    // Check warnings for resolution failures
    for (const warning of ctx.profile.warnings) {
      if (warning.toLowerCase().includes("unresolved") || warning.toLowerCase().includes("resolution")) {
        unresolved.push({
          source: "warnings",
          message: warning,
        });
      }
    }

    return unresolved;
  },
};

register(handler);
export default handler;
