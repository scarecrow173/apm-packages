/**
 * Regenerate the committed Issue #127 stats fixtures.
 *
 *   mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts
 *
 * The output is deterministic: corpus bytes/statuses/relations/findings are
 * pinned by the fixture content, so byte-diffs mean a real corpus or
 * doc-status contract change — review them before committing.
 */
import fs from "node:fs";
import path from "node:path";
import { createFixtureRepo } from "../../e2e/harness/fixture_manager";
import { benchmarkCorpusFiles, longRunningCorpusFiles } from "./corpora";
import { analyzeCorpus } from "../../../src/skills/lib/lifecycle_stats";

const FIXTURE_DIR = __dirname;

const corpora: Array<[label: string, build: () => string]> = [
  ["small", () => createFixtureRepo({})],
  ["benchmark", () => createFixtureRepo({ secondPlan: true, files: benchmarkCorpusFiles({}) })],
  ["long-running", () => createFixtureRepo({ files: longRunningCorpusFiles() })],
];

async function main(): Promise<void> {
  for (const [label, build] of corpora) {
    const stats = await analyzeCorpus(build(), { label });
    const file = path.join(FIXTURE_DIR, `stats-${label}.json`);
    fs.writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
    console.log(`wrote ${file} (documents=${stats.corpus.documents} findings=${stats.findings.total})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
