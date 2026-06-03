"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "flow-stack",
  description: "Flow Stack 定義",
  execute(ctx: QueryContext): unknown {
    const flowStack = ctx.profile.flow_stack;
    if (ctx.args.slot) {
      const slot = flowStack.slots.find((s) => s.slot_id === ctx.args.slot);
      if (!slot) {
        return { error: `Slot not found: ${ctx.args.slot}` };
      }
      return slot;
    }
    return flowStack;
  },
};

register(handler);
export default handler;
