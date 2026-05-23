#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const candidateDirs = ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"];

type CliArgs = {
  cwd: string;
  dir?: string;
  help?: boolean;
  write: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/update_index.ts [--dir <path>] [--write]";
}

function findAdrDir(cwd: string, explicitDir?: string): string {
  if (explicitDir) return explicitDir.replace(/\\/g, "/");
  return candidateDirs.find((candidate) => fs.existsSync(path.join(cwd, candidate))) || "docs/adr";
}

function titleFromAdr(content: string, fallback: string): string {
  const firstHeading = /^#\s+(?:\d+\.\s*)?(.+)$/m.exec(content);
  return firstHeading ? firstHeading[1].trim() : fallback;
}

function buildIndex(dir: string, relativeDir: string): string {
  const entries = fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))
    .sort()
    .map((file) => {
      const title = titleFromAdr(fs.readFileSync(path.join(dir, file), "utf8"), path.basename(file, ".md"));
      return `- [${title}](./${file})`;
    });
  return `# Architecture Decision Records\n\nDirectory: \`${relativeDir.replace(/\\/g, "/")}\`\n\n${entries.join("\n")}\n`;
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }

    const cwd = path.resolve(args.cwd);
    const relativeDir = findAdrDir(cwd, args.dir);
    const adrDir = path.join(cwd, relativeDir);
    if (!fs.existsSync(adrDir)) throw new Error(`ADR directory not found: ${relativeDir}`);

    const output = buildIndex(adrDir, relativeDir);
    const indexPath = path.join(adrDir, "README.md");
    if (args.write) {
      fs.writeFileSync(indexPath, output, "utf8");
      console.log(`Updated ${path.relative(cwd, indexPath).replace(/\\/g, "/")}`);
    } else {
      console.log(`DRY RUN: would write ${path.relative(cwd, indexPath).replace(/\\/g, "/")}`);
      console.log(output);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
