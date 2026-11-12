#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { findAdrDir, slugify } from "./lib/adr_utils";
import { generateArtifactId } from "../../lib/artifact_id";
import { configFor, frontMatter, sanitizeTitle } from "../../lib/doc_suite_utils";

const templates = {
  full: "madr-4-full.md",
  minimal: "madr-4-minimal.md",
  bare: "madr-4-bare.md",
  "bare-minimal": "madr-4-bare-minimal.md",
} as const;

type TemplateName = keyof typeof templates;

type CliArgs = {
  cwd: string;
  date?: string;
  dir?: string;
  forceIndex?: boolean;
  help?: boolean;
  noIndex?: boolean;
  status: string;
  template: TemplateName;
  title?: string;
};

type TemplateValues = {
  title: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { template: "full", status: "proposed", cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") args.title = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--template") args.template = parseTemplate(argv[++i]);
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--no-index") args.noIndex = true;
    else if (arg === "--force-index") args.forceIndex = true;
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!args.title) args.title = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function parseTemplate(value: string): TemplateName {
  if (value in templates) return value as TemplateName;
  throw new Error(`Unknown template: ${value}`);
}

function usage(): string {
  return [
    "Usage: node scripts/new_adr.js --title <title> [--dir <path>] [--template full|minimal|bare|bare-minimal] [--status <status>] [--date <YYYY-MM-DD>]",
    "",
    "Creates a new MADR ADR. Index materialization is explicit: doc_maintenance.js index apply --dir <adr-dir>.",
  ].join("\n");
}

function renderTemplate(templateName: TemplateName, values: TemplateValues): string {
  const templatePath = path.join(__dirname, "../assets/templates", templates[templateName]);
  if (!templates[templateName] || !fs.existsSync(templatePath)) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  return fs.readFileSync(templatePath, "utf8")
    .replaceAll("{{title}}", values.title);
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.title) throw new Error("Missing required --title");

    const cwd = path.resolve(args.cwd);
    const relativeDir = findAdrDir(cwd, args.dir);
    const adrDir = path.join(cwd, relativeDir);
    fs.mkdirSync(adrDir, { recursive: true });

    const title = sanitizeTitle(args.title);
    const slug = slugify(title);
    const filename = `${slug}.md`;
    const outputPath = path.join(adrDir, filename);
    if (fs.existsSync(outputPath)) throw new Error(`ADR already exists: ${path.relative(cwd, outputPath)}`);

    const date = args.date || new Date().toISOString().slice(0, 10);
    const status = args.status;
    const adrConfig = configFor("adr");
    const metadata = {
      adr: {
        "decision-makers": [],
        consulted: [],
        informed: [],
      },
    };
    const header = frontMatter(adrConfig, generateArtifactId(adrConfig.idPrefix), title, status, date, undefined, metadata);
    const body = renderTemplate(args.template, { title }).trimStart();
    const content = `${header}\n\n${body}\n`;
    fs.writeFileSync(outputPath, content, "utf8");

    const indexPath = path.join(adrDir, "README.md");
    const relativeIndex = path.relative(cwd, indexPath).replace(/\\/g, "/");
    console.log(`Created ${path.relative(cwd, outputPath).replace(/\\/g, "/")}`);
    console.log(`Index deferred: ${relativeIndex} — materialize explicitly via doc_maintenance.js index apply --dir ${relativeDir}`);
    if (args.noIndex || args.forceIndex) {
      console.log("Note: --no-index/--force-index are deprecated and have no effect; indexes are materialized via doc_maintenance.js index plan|apply");
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
