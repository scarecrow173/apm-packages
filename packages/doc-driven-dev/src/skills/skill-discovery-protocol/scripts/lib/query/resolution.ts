"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "resolution",
  description: "解決関係一覧",
  execute(ctx: QueryContext): unknown {
    const invocations = ctx.profile.resolved_invocations;
    if (ctx.args.skill) {
      return invocations.filter((i) => i.source_skill === ctx.args.skill);
    }
    return invocations;
  },
};

register(handler);
export default handler;
