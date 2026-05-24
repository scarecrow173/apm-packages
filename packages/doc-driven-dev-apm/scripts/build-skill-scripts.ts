#!/usr/bin/env node
import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src", "skills");
const OUTPUT_ROOT = path.join(ROOT, ".apm", "skills");

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return fullPath;
    })
  );

  return files.flat();
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isEntryPoint(filePath: string): boolean {
  const rel = toPosix(path.relative(SOURCE_ROOT, filePath));
  if (!rel.endsWith(".ts")) {
    return false;
  }

  if (!rel.includes("/scripts/")) {
    return false;
  }

  if (rel.includes("/scripts/lib/")) {
    return false;
  }

  return true;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function cleanupOutputDir(dir: string): Promise<void> {
  await ensureDir(dir);

  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      await fs.rm(path.join(dir, entry.name), { force: true });
      return;
    }

    if (entry.isDirectory() && entry.name === "dist") {
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
    }
  }));
}

async function main(): Promise<void> {
  const allFiles = await walk(SOURCE_ROOT);
  const entryPoints = allFiles.filter(isEntryPoint);

  if (entryPoints.length === 0) {
    console.log("No TypeScript entry points found under src/skills/**/scripts/*.ts");
    return;
  }

  const cleanedDirs = new Set<string>();

  for (const entryPoint of entryPoints) {
    const rel = path.relative(SOURCE_ROOT, entryPoint);
    const relDir = path.dirname(rel);
    const relBaseName = path.basename(rel, ".ts") + ".js";
    const outDir = path.join(OUTPUT_ROOT, relDir);
    const outfile = path.join(outDir, relBaseName);

    if (!cleanedDirs.has(outDir)) {
      await cleanupOutputDir(outDir);
      cleanedDirs.add(outDir);
    }

    await build({
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: ["node20"],
      charset: "ascii",
      sourcemap: false,
      logLevel: "silent"
    });

    console.log(`Built ${toPosix(path.relative(ROOT, outfile))}`);
  }

  console.log(`Finished: ${entryPoints.length} script(s) built.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});