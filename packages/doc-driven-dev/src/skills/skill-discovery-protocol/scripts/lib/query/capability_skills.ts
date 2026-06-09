"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "capability-skills",
  description: "capability 逆引き",
  requiredArgs: ["capability"],
  execute(ctx: QueryContext): unknown {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }

    const capabilityId = ctx.args.capability!;
    const matching = ctx.catalog.skills.filter((s) =>
      s.provides.some((p) => p.capability === capabilityId),
    );

    return matching.map((s) => ({
      name: s.name,
      description: s.description,
      provides: s.provides.find((p) => p.capability === capabilityId),
    }));
  },
};

register(handler);
export default handler;
