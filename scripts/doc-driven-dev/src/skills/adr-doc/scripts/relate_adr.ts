#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { findAdrDir, relationFields } from "./lib/adr_utils";
import { parseDoc, resolveDocumentReference } from "../../lib/doc_suite_utils";
import { allowedRelationsFor } from "../../lib/doc_types";
import { isInsideCheckout } from "../../lib/document_utils";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";

type CliArgs = {
  cwd: string;
  dir?: string;
  from?: string;
  help?: boolean;
  relation?: string;
  to?: string;
  write: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--relation") args.relation = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--write") args.write = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return `Usage: node scripts/relate_adr.js --from <adr.md> --to <target> --relation ${relationFields.join("|")} [--dir <path>] [--write]`;
}

function ensureRelation(content: string, relation: string, target: string): string {
  const parsed = matter(content);
  const data = parsed.data || {};
  const relations = data.relations && typeof data.relations === "object" && !Array.isArray(data.relations)
    ? data.relations as Record<string, unknown>
    : {};
  for (const field of relationFields) {
    if (!Array.isArray(relations[field])) relations[field] = [];
  }
  const values = relations[relation] as string[];
  if (!values.includes(target)) values.push(target);
  data.relations = relations;
  return matter.stringify(parsed.content, data);
}

function prepareUpdate(cwd: string, relativeDir: string, file: string, relation: string, target: string): { fullPath: string; label: string; next: string } {
  const fullPath = path.join(cwd, relativeDir, file);
  if (!fs.existsSync(fullPath)) throw new Error(`ADR not found: ${relativeDir}/${file}`);
  const next = ensureRelation(fs.readFileSync(fullPath, "utf8"), relation, target);
  return { fullPath, label: `${relativeDir}/${file}: ${relation} -> ${target}`, next };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.from || !args.to || !args.relation) throw new Error("Missing --from, --to, or --relation");
    // Knowledge Relations v1 (Issue #235): only canonical forward fields are
    // stored — `source` provenance plus the adr type's declared relations
    // (`decides-for`, `supersedes`). Inverse links are derived projections,
    // never written; legacy keys are refused, not rewritten.
    if (!relationFields.includes(args.relation as never)) {
      throw new Error(`Unknown relation: ${args.relation} (stored forward fields: ${relationFields.join(", ")})`);
    }
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
    const relativeDir = findAdrDir(cwd, args.dir);
    const from = path.basename(args.from);
    // Typed relations (`decides-for`, `supersedes`) name durable targets —
    // resolve the `--to` reference the same way the graph does (ADR-dir
    // relative, checkout relative, then front-matter id) and refuse a value
    // that does not resolve or resolves to a type outside the relation's
    // declared target set, rather than writing an edge the audit then flags
    // `invalid-relation-target-type`. `source` stays free-form provenance.
    const declared = allowedRelationsFor("adr").find((relation) => relation.field === args.relation);
    if (declared) {
      const resolved = resolveDocumentReference(cwd, args.to, path.join(cwd, relativeDir));
      if (!resolved) {
        throw new Error(`Relation ${args.relation} --to target does not resolve to a document: ${args.to}`);
      }
      if (!isInsideCheckout(cwd, resolved)) {
        throw new Error(`Relation ${args.relation} --to target escapes the checkout: ${args.to}`);
      }
      const parsed = parseDoc(fs.readFileSync(resolved, "utf8"));
      const targetType = !parsed.error && typeof parsed.data.type === "string" ? parsed.data.type : null;
      if (!targetType || !declared.targetTypes.includes(targetType)) {
        throw new Error(`Relation ${args.relation} target resolves to type "${targetType ?? "unknown"}", expected one of: ${declared.targetTypes.join(", ")}: ${args.to}`);
      }
    }
    // The stored target is the value as written — a same-directory basename,
    // a checkout-relative path, or a front-matter id all resolve through the
    // same boundary the validation above used, so the stored edge resolves.
    const updates = [prepareUpdate(cwd, relativeDir, from, args.relation, args.to)];
    if (args.write) {
      for (const update of updates) fs.writeFileSync(update.fullPath, update.next, "utf8");
    }
    console.log(args.write ? "Updated ADR relations:" : "DRY RUN: would update ADR relations:");
    for (const update of updates) console.log(`- ${update.label}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
