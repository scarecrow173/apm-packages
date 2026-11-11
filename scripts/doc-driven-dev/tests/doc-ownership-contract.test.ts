import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DIRECTORY_CONTRACTS } from "../src/skills/lib/doc_ownership";

const contractDocPath = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills/doc-maintenance/references/ownership-contract.md",
);

function docTableRows(): { dir: string; owner: string; residents: string[]; indexFormat: string }[] {
  const md = fs.readFileSync(contractDocPath, "utf8");
  const table = md.split("## Directory contract")[1] ?? "";
  return [...table.matchAll(/^\| `([^`]+)` \| (\S+) \| ([^|]+?) \| (\S+) \|$/gm)]
    .map((m) => ({
      dir: m[1],
      owner: m[2],
      residents: m[3].trim() === "—" ? [] : m[3].split(",").map((s) => s.trim()),
      indexFormat: m[4],
    }));
}

test("every DIRECTORY_CONTRACTS row appears in the public contract doc", () => {
  const rows = docTableRows();
  for (const contract of DIRECTORY_CONTRACTS) {
    const row = rows.find((r) => r.dir === contract.dir);
    assert.ok(row, `ownership-contract.md is missing a row for ${contract.dir}`);
    assert.equal(row.owner, contract.owner, `${contract.dir} owner`);
    assert.deepEqual(row.residents, [...contract.residentTypes], `${contract.dir} resident types`);
    assert.equal(row.indexFormat, contract.indexFormat, `${contract.dir} index format`);
  }
});

test("the public contract doc lists no extra directories", () => {
  const known = new Set(DIRECTORY_CONTRACTS.map((c) => c.dir));
  for (const row of docTableRows()) {
    assert.ok(known.has(row.dir), `ownership-contract.md lists undocumented dir ${row.dir}`);
  }
});
