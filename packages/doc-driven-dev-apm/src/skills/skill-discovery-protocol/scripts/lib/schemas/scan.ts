"use strict";

import { z } from "zod";

const RawScannedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  skill_path: z.string(),
  scope: z.string(),
});

export const SkillScanListDocumentSchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  skills: z.array(RawScannedSkillSchema),
});
