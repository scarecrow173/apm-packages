#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildIndex,
  detectNaming,
  findAdrDir,
  nextNumber,
  slugify,
} = require("./lib/adr_utils.ts");

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
  help?: boolean;
  status: string;
  template: TemplateName;
  title?: string;
};

type TemplateValues = {
  date: string;
  number: number;
  status: string;
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
    "Usage: node scripts/new_adr.ts --title <title> [--dir <path>] [--template full|minimal|bare|bare-minimal]",
    "",
    "Creates a new MADR ADR and refreshes the ADR index.",
  ].join("\n");
}

function renderTemplate(templateName: TemplateName, values: TemplateValues): string {
  const templatePath = path.join(__dirname, "../assets/templates", templates[templateName]);
  if (!templates[templateName] || !fs.existsSync(templatePath)) {
    throw new Error(`Unknown template: ${templateName}`);
  }
  return fs.readFileSync(templatePath, "utf8")
    .replaceAll("{{number}}", String(values.number))
    .replaceAll("{{title}}", values.title)
    .replaceAll("{{date}}", values.date)
    .replaceAll("{{status}}", values.status);
}

async function main(): Promise<void> {
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

    const files = fs.readdirSync(adrDir);
    const naming = detectNaming(files);
    const number = nextNumber(files);
    const slug = slugify(args.title);
    const filename = naming === "slug" ? `${slug}.md` : `${String(number).padStart(4, "0")}-${slug}.md`;
    const outputPath = path.join(adrDir, filename);
    if (fs.existsSync(outputPath)) throw new Error(`ADR already exists: ${path.relative(cwd, outputPath)}`);

    const date = args.date || new Date().toISOString().slice(0, 10);
    const content = renderTemplate(args.template, { number, title: args.title, date, status: args.status });
    fs.writeFileSync(outputPath, content, "utf8");
    fs.writeFileSync(path.join(adrDir, "README.md"), await buildIndex(adrDir, relativeDir), "utf8");

    console.log(`Created ${path.relative(cwd, outputPath).replace(/\\/g, "/")}`);
    console.log(`Updated ${path.relative(cwd, path.join(adrDir, "README.md")).replace(/\\/g, "/")}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
