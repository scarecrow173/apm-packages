"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "category-skills",
  description: "カテゴリ内スキル一覧",
  requiredArgs: ["category"],
  execute(ctx: QueryContext): unknown {
    const categoryId = ctx.args.category!;
    const categories = ctx.profile.classification.categories;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) {
      return { error: `Category not found: ${categoryId}` };
    }
    return cat.skills;
  },
};

register(handler);
export default handler;
