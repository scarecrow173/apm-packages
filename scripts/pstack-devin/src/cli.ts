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
    await checkGenerated(repoRoot);
    return;
  }
  throw new Error(`usage: tsx src/cli.ts <build|check>`);
}

main(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
