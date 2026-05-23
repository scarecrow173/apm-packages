#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const candidateDirs = ["docs/adr", "docs/decisions", "adr", "docs/adrs", "decisions"];
const templates = {
  full: "madr-4-full.md",
  minimal: "madr-4-minimal.md",
  bare: "madr-4-bare.md",
  "bare-minimal": "madr-4-bare-minimal.md",
} as const;

type TemplateName = keyof typeof templates;
type NamingMode = "numbered" | "slug";

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "decision";
}

function findAdrDir(cwd: string, explicitDir?: string): string {
  if (explicitDir) return explicitDir.replace(/\\/g, "/");
  const existing = candidateDirs.filter((candidate) => fs.existsSync(path.join(cwd, candidate)));
  if (existing.length === 0) return "docs/adr";
  return existing
    .map((candidate, index) => ({ candidate, index, score: scoreDir(path.join(cwd, candidate)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].candidate;
}

function scoreDir(dir: string): number {
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  let score = 1;
  if (files.some((file) => /^\d{4}-.+\.md$/.test(file))) score += 4;
  if (files.includes("README.md") || files.includes("index.md")) score += 3;
  return score;
}

function detectNaming(files: string[]): NamingMode {
  if (files.some((file) => /^\d{4}-.+\.md$/.test(file))) return "numbered";
  if (files.some((file) => /^[a-z0-9][a-z0-9-]+\.md$/.test(file) && !/^readme\.md$/i.test(file) && !/^index\.md$/i.test(file))) {
    return "slug";
  }
  return "numbered";
}

function nextNumber(files: string[]): number {
  const numbers = files
    .map((file) => /^(\d{4})-.+\.md$/.exec(file))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
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
    fs.writeFileSync(path.join(adrDir, "README.md"), buildIndex(adrDir, relativeDir), "utf8");

    console.log(`Created ${path.relative(cwd, outputPath).replace(/\\/g, "/")}`);
    console.log(`Updated ${path.relative(cwd, path.join(adrDir, "README.md")).replace(/\\/g, "/")}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
