"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "execution-policy",
  description: "実行ポリシー",
  execute(ctx: QueryContext): unknown {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }

    const skills = ctx.catalog.skills;
    if (ctx.args.skill) {
      const skill = skills.find((s) => s.name === ctx.args.skill);
      if (!skill) {
        return { error: `Skill not found: ${ctx.args.skill}` };
      }
      return { skill: skill.name, execution_policy: skill.execution_policy };
    }

    return skills.map((s) => ({
      skill: s.name,
      execution_policy: s.execution_policy,
    }));
  },
};

register(handler);
export default handler;
