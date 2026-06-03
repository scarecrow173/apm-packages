"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "categories",
  description: "カテゴリ一覧",
  execute(ctx: QueryContext): unknown {
    const categories = ctx.profile.classification.categories;
    return categories.map((c) => ({
      id: c.id,
      label: c.label,
      skill_count: c.skills.length,
    }));
  },
};

register(handler);
export default handler;
