"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "runtime-guidance",
  description: "実行時ガイダンス",
  execute(ctx: QueryContext): unknown {
    const guidance = ctx.profile.runtime_guidance;
    if (ctx.args.skill) {
      return guidance.filter((g) => g.skill === ctx.args.skill);
    }
    return guidance;
  },
};

register(handler);
export default handler;
