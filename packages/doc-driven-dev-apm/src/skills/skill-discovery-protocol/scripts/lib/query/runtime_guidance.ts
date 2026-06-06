"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";
import { rankRuntimeGuidance } from "../runtime_guidance_ranker";

const handler: QueryHandler = {
  name: "runtime-guidance",
  description: "螳溯｡梧凾繧ｬ繧､繝繝ｳ繧ｹ",
  execute(ctx: QueryContext): unknown {
    const guidance = rankRuntimeGuidance(
      ctx.profile.runtime_guidance,
      ctx.catalog?.skills ?? [],
    );
    if (ctx.args.skill) {
      return guidance.filter((g) => g.skill === ctx.args.skill);
    }
    return guidance;
  },
};

register(handler);
export default handler;
