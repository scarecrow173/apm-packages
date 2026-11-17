#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { configFor, parseDoc, resolveDocumentReference } from "../../lib/doc_suite_utils";
import { isInsideCheckout } from "../../lib/document_utils";
import { LIFECYCLE_VALUES } from "../../lib/doc_types";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import { CHECK_KEY_PATTERN } from "../../lib/verification_checks";
import {
  assembleChecks,
  existingCheckIds,
  removeChecks,
  resolveVerificationDoc,
  upsertChecks,
  verifyCheckTargets,
  writeVerificationDoc,
} from "./lib/verification_doc";

type CliArgs = {
  checks: string[];
  cwd: string;
  date?: string;
  doc?: string;
  from: string[];
  help?: boolean;
  lifecycle?: string;
  removeChecks: string[];
  status?: string;
  supersedes: string[];
  title?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { checks: [], cwd: process.cwd(), from: [], removeChecks: [], supersedes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--doc") args.doc = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--status") args.status = argv[++i];
    else if (arg === "--lifecycle") args.lifecycle = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--from") args.from.push(argv[++i]);
    else if (arg === "--supersedes") args.supersedes.push(argv[++i]);
    else if (arg === "--check") args.checks.push(argv[++i]);
    else if (arg === "--remove-check") args.removeChecks.push(argv[++i]);
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/update_verification.js --doc <ref> [--title <title>] [--status <status>] [--lifecycle <lifecycle>] [--from <source>]... [--supersedes <verification-doc>]... [--check '<json>']... [--remove-check <CHK-NN>]... [--date <YYYY-MM-DD>]";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.doc) throw new Error("Missing required --doc");
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
    const doc = resolveVerificationDoc(cwd, args.doc);
    const config = configFor("verification");
    const data = doc.data;
    const date = args.date ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date: ${date} (expected YYYY-MM-DD)`);
    }

    // Scalar axis fields — validated against the registry vocabulary before
    // anything is written; unknown values refuse rather than coerce.
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Invalid title: empty");
      data.title = title;
    }
    if (args.status !== undefined && !(config.statusValues as readonly string[]).includes(args.status)) {
      throw new Error(`Invalid verification status: ${args.status} (expected one of: ${config.statusValues.join(", ")})`);
    }
    if (args.status !== undefined) data.status = args.status;
    if (args.lifecycle !== undefined && !(LIFECYCLE_VALUES as readonly string[]).includes(args.lifecycle)) {
      throw new Error(`Invalid verification lifecycle: ${args.lifecycle} (expected one of: ${LIFECYCLE_VALUES.join(", ")})`);
    }
    if (args.lifecycle !== undefined) data.lifecycle = args.lifecycle;

    // Stored relation fields (`source` provenance, `supersedes` →
    // verification): append with dedupe, never reorder. `supersedes`
    // targets must resolve to verification documents — the declared
    // targetTypes contract — so a wrong-typed edge is never written.
    const relations = (data.relations && typeof data.relations === "object" && !Array.isArray(data.relations))
      ? { ...(data.relations as Record<string, unknown>) }
      : {};
    for (const field of ["source", "supersedes"] as const) {
      const additions = field === "source" ? args.from : args.supersedes;
      if (additions.length === 0) continue;
      const existing = Array.isArray(relations[field])
        ? (relations[field] as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      const merged = new Set(existing);
      for (const target of additions) {
        if (field === "supersedes") {
          const resolved = resolveDocumentReference(cwd, target);
          if (!resolved || !isInsideCheckout(cwd, resolved)) {
            throw new Error(`--supersedes target does not resolve to a document: ${target}`);
          }
          const parsed = parseDoc(fs.readFileSync(resolved, "utf8"));
          const targetType = !parsed.error && typeof parsed.data.type === "string" ? parsed.data.type : null;
          if (targetType !== "verification") {
            throw new Error(`--supersedes target resolves to type ${JSON.stringify(targetType)}, expected verification: ${target}`);
          }
        }
        merged.add(target);
      }
      relations[field] = [...merged];
    }
    if (args.from.length > 0 || args.supersedes.length > 0) {
      data.relations = relations;
    }

    // Check mutations: removals first, then upserts — a payload may
    // re-declare a removed id in one invocation (a replace, not an id
    // conflict). Upserts validate the full VerificationCheckV1 schema and
    // resolve Claim targets; an invalid payload refuses the whole update
    // before any write (Issue #239).
    for (const id of args.removeChecks) {
      if (!CHECK_KEY_PATTERN.test(id)) {
        throw new Error(`Invalid --remove-check id: ${id} (expected CHK-<digits>)`);
      }
    }
    const removed = removeChecks(data.checks, args.removeChecks);
    if (removed.error) throw new Error(removed.error);
    const assembled = assembleChecks(args.checks, existingCheckIds(removed.checks), { allowExistingIds: true });
    if (assembled.error) throw new Error(assembled.error);
    if (assembled.checks.length > 0) {
      const targets = await verifyCheckTargets(cwd, assembled.checks);
      if (targets.error) throw new Error(targets.error);
    }
    if (args.removeChecks.length > 0 || args.checks.length > 0) {
      data.checks = upsertChecks(removed.checks, assembled.checks);
    }
    data.updated = date;

    writeVerificationDoc(doc);
    console.log(`Updated ${doc.file}`);
    const touched = [
      args.title !== undefined ? "title" : null,
      args.status !== undefined ? "status" : null,
      args.lifecycle !== undefined ? "lifecycle" : null,
      args.from.length > 0 ? "source" : null,
      args.supersedes.length > 0 ? "supersedes" : null,
      args.removeChecks.length > 0 ? `-${args.removeChecks.length} check(s)` : null,
      args.checks.length > 0 ? `+${args.checks.length} check(s)` : null,
    ].filter((label): label is string => label !== null);
    console.log(`Fields: ${touched.length > 0 ? touched.join(", ") : "updated timestamp only"}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
