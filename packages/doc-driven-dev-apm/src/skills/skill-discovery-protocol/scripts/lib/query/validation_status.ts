"use strict";

import type { QueryContext, QueryHandler } from "./registry";
import { register } from "./registry";

const handler: QueryHandler = {
  name: "validation-status",
  description: "検証状態要約",
  execute(ctx: QueryContext): unknown {
    if (!ctx.validationReport) {
      return { error: "Validation report not found (validation-report.json must be co-located with profile)" };
    }
    return {
      validated_at: ctx.validationReport.validated_at,
      adapter_id: ctx.validationReport.adapter_id,
      summary: ctx.validationReport.summary,
      checks: ctx.validationReport.checks,
    };
  },
};

register(handler);
export default handler;
