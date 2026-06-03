"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "skill-detail",
  description: "スキル詳細",
  requiredArgs: ["skill"],
  execute(ctx: QueryContext): unknown {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }

    const skillName = ctx.args.skill!;
    const skill = ctx.catalog.skills.find((s) => s.name === skillName);
    if (!skill) {
      return { error: `Skill not found: ${skillName}` };
    }
    return skill;
  },
};

register(handler);
export default handler;
