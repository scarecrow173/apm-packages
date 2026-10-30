"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "resolution",
  description: "解決関係一覧",
  execute(ctx: QueryContext): unknown {
    const invocations = ctx.profile.resolved_invocations;
    // Defense in depth: the loader rejects profiles that lack this field,
    // but never let a malformed profile degrade into a rendered
    // "undefined" — fail with a structured error instead.
    if (!Array.isArray(invocations)) {
      throw new Error("Invalid profile: missing or invalid resolved_invocations");
    }
    if (ctx.args.skill) {
      return invocations.filter((i) => i.source_skill === ctx.args.skill);
    }
    return invocations;
  },
};

register(handler);
export default handler;
