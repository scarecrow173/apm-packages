/**
 * Regenerate the committed staged-loading guard fixtures.
 *
 *   mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/skill-discovery-inventory/write_inventory.ts
 *
 * Both JSONs are written from one `inventoryAll` pass over the live package,
 * so the stored endpoint always reflects the current extraction rules.
 * `inventory-baseline.json` is the guard's anchor; `inventory-final.json` is
 * the audited endpoint it checks live output against — keeping them equal is
 * what lets the guard trip on real directive drift. Re-pinned together for
 * #147 after the extraction rules changed; the original Task-2 audit
 * snapshots (pre/post-fix, old rules) live in
 * `.superpowers/sdd/2026-10-29-skill-discovery/`.
 *
 * The output is deterministic (flows/directives/referencedFiles are sorted),
 * so byte-diffs mean a real SKILL.md or load_inventory change — review them
 * before committing.
 */
import fs from "node:fs";
import path from "node:path";
import { inventoryAll } from "../../../src/skills/skill-discovery-protocol/scripts/lib/load_inventory";

const skillsRoot = path.resolve(
  __dirname,
  "../../../../../packages/doc-driven-dev/.apm/skills",
);

const inventory = inventoryAll(skillsRoot);
for (const name of ["inventory-baseline.json", "inventory-final.json"]) {
  const file = path.join(__dirname, name);
  fs.writeFileSync(file, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`wrote ${file}`);
}
console.log(
  `flows=${inventory.totals.flows} directives=${inventory.totals.directives} ` +
    `alwaysOnChars=${inventory.totals.alwaysOnChars} ` +
    `referencedBytes=${inventory.totals.referencedBytes} missing=${inventory.totals.missing}`,
);
