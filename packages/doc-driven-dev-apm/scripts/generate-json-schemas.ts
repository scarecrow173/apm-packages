#!/usr/bin/env node
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

import { AdapterConfigSchema } from "../src/skills/skill-discovery-protocol/scripts/lib/schemas/adapter";
import { SkillReferenceCatalogSchema } from "../src/skills/skill-discovery-protocol/scripts/lib/schemas/catalog";
import { FlowProfileSchema } from "../src/skills/skill-discovery-protocol/scripts/lib/schemas/profile";
import { ValidationReportSchema } from "../src/skills/skill-discovery-protocol/scripts/lib/schemas/validation-report";

const OUTPUT_DIR = path.join(process.cwd(), ".apm", "skills", "skill-discovery-protocol", "schemas");

const schemas: { name: string; schema: z.ZodType }[] = [
  { name: "adapter.schema.json", schema: AdapterConfigSchema },
  { name: "catalog.schema.json", schema: SkillReferenceCatalogSchema },
  { name: "profile.schema.json", schema: FlowProfileSchema },
  { name: "validation-report.schema.json", schema: ValidationReportSchema },
];

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const { name, schema } of schemas) {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
    const outPath = path.join(OUTPUT_DIR, name);
    await fs.writeFile(outPath, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
    console.log(`Generated: ${path.relative(process.cwd(), outPath)}`);
  }

  console.log(`\nDone: ${schemas.length} JSON Schema files generated.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
