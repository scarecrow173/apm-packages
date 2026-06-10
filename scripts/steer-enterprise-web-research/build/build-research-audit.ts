#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";

export function resolveOutputPath(root: string): string {
  return path.join(root, "..", "..", "packages", "steer-enterprise-web-research", "scripts", "research_audit.js");
}

async function main(): Promise<void> {
  const root = process.cwd();
  const outfile = resolveOutputPath(root);

  await build({
    entryPoints: [path.join(root, "src", "research_audit.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    charset: "ascii",
    sourcemap: false,
    logLevel: "silent",
  });

  console.log(`Built ${path.relative(root, outfile).replaceAll("\\", "/")}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}