import { fileURLToPath } from "node:url";
import { loadBuildConfig } from "./config.js";
import { buildPlugin } from "./build.js";
import { checkGenerated } from "./check.js";

// src/ → scripts/pstack-devin/ → scripts/ → repo root (trailing slash kept
// so fileURLToPath yields a directory path).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function main(argv: string[]): Promise<void> {
  const cmd = argv[2];
  if (cmd === "build") {
    const res = await buildPlugin(loadBuildConfig(repoRoot));
    console.log(
      `built ${res.outDir}: ${res.fileCount} files, ` +
        `upstream tree ${res.treeSha}`,
    );
    return;
  }
  if (cmd === "check") {
    // `--pre-commit` skips the index-vs-HEAD clean gate — the mode
    // apply-update needs while its regenerated tree is still uncommitted
    // (see checkGenerated). Everything else still applies.
    // `undefined` when the flag is absent — the env var
    // (PSTACK_DEVIN_CHECK_PRECOMMIT) is the pipeline's path into nested
    // invocations and must not be masked by an explicit false here.
    await checkGenerated(repoRoot, {
      preCommit: argv.includes("--pre-commit") ? true : undefined,
    });
    return;
  }
  throw new Error(`usage: tsx src/cli.ts <build|check [--pre-commit]>`);
}

main(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
