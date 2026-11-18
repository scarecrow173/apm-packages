#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// Evidence Store v1 CLI (Issue #240)
// ---------------------------------------------------------------------------
//
// Immutable Evidence Records under `.apm/state/doc-driven-dev/evidence/` —
// Git-untracked, per-worktree by default. Records pin claim
// documentRevision, check designRevision, subject (commit | workspace
// snapshot), provider/run/environment, outcome, and artifact references.
// Every subcommand runs the shared schema preflight first (this is a
// normal mutation entry, not a migration surface); the store itself
// enforces ignore coverage, containment, and append-once writes on top.
//
//   put --file <evidence.json> [--resolve]
//   get <evidence-id>
//   query [--check <ref>] [--claim <ref>] [--outcome <o>] [--retention <r>]
//         [--subject-kind commit|workspace] [--run-id <id>]
//   reindex
//   resolve <evidence-id>
//   promote <evidence-id> --commit <sha> [--as <id>]
//   manifest
//   recover
//
// Options: --cwd <path> --state-root <path> --allow-external-root --json

import fs from "node:fs";
import path from "node:path";

import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import { scanKnowledgeGraph, resolveCheckReference, resolveClaimReference } from "../../lib/knowledge_graph";
import {
  StoreError,
  documentRevisionOf,
  getById,
  loadManifest,
  promoteToCommit,
  putImmutable,
  query,
  rebuildIndex,
  recoverEvidence,
  resolveEvidence,
} from "../../lib/evidence_store";
import type { EvidenceInput, StoreOptions } from "../../lib/evidence_store";

type CliArgs = {
  command?: string;
  positional: string[];
  cwd: string;
  stateRoot?: string;
  allowExternalRoot: boolean;
  json: boolean;
  help?: boolean;
  file?: string;
  resolve?: boolean;
  check?: string;
  claim?: string;
  outcome?: string;
  retention?: string;
  subjectKind?: string;
  runId?: string;
  commit?: string;
  as?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { positional: [], cwd: process.cwd(), allowExternalRoot: false, json: false };
  const take = (flag: string, i: number): string => {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") args.cwd = take(arg, i), i += 1;
    else if (arg === "--state-root") args.stateRoot = take(arg, i), i += 1;
    else if (arg === "--allow-external-root") args.allowExternalRoot = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--file") args.file = take(arg, i), i += 1;
    else if (arg === "--resolve") args.resolve = true;
    else if (arg === "--check") args.check = take(arg, i), i += 1;
    else if (arg === "--claim") args.claim = take(arg, i), i += 1;
    else if (arg === "--outcome") args.outcome = take(arg, i), i += 1;
    else if (arg === "--retention") args.retention = take(arg, i), i += 1;
    else if (arg === "--subject-kind") args.subjectKind = take(arg, i), i += 1;
    else if (arg === "--run-id") args.runId = take(arg, i), i += 1;
    else if (arg === "--commit") args.commit = take(arg, i), i += 1;
    else if (arg === "--as") args.as = take(arg, i), i += 1;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("-") && args.command === undefined) args.command = arg;
    else if (!arg.startsWith("-")) args.positional.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return [
    "Usage: node scripts/evidence_store.js <command> [options]",
    "",
    "Commands: put | get | query | reindex | resolve | promote | manifest | recover",
    "",
    "Run `node scripts/evidence_store.js` with a command plus --cwd <repo>;",
    "see references/evidence-store-contract.md for the record contract.",
  ].join("\n");
}

function readFileArg(cwd: string, value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} is required`);
  return fs.readFileSync(path.resolve(cwd, value), "utf8");
}

function requireEvidenceId(args: CliArgs): string {
  const id = args.positional[0];
  if (id === undefined) throw new Error(`${args.command} requires an <evidence-id>`);
  return id;
}

function storeOptions(args: CliArgs): StoreOptions {
  return { stateRoot: args.stateRoot, allowExternalRoot: args.allowExternalRoot };
}

function emit(args: CliArgs, payload: Record<string, unknown>): void {
  if (args.json) {
    console.log(JSON.stringify({ command: args.command, ...payload }, null, 2));
    return;
  }
  console.log(JSON.stringify({ command: args.command, ...payload }));
}

// `--resolve` pins the claim documentRevision and check designRevision
// from the LIVE Knowledge Graph — the refs must resolve to a real claim
// and a real check, never to whatever the caller guessed. Either ref
// failing closed stops the put. The same claim↔check cross-check
// resolveEvidenceIn reports applies here at write time: a record may
// only credit a check for the claim that check actually targets.
async function resolvePinnedRevisions(cwd: string, input: EvidenceInput): Promise<void> {
  const graph = await scanKnowledgeGraph({ cwd });
  const claim = resolveClaimReference(graph, String(input.claim?.ref ?? ""));
  if (claim.status !== "resolved") {
    throw new StoreError(
      "invalid-argument",
      `claim reference ${JSON.stringify(input.claim?.ref)} cannot resolve (${claim.status}) — evidence only records checks measured against real claims`,
    );
  }
  input.claim.documentRevision = documentRevisionOf(
    fs.readFileSync(path.join(path.resolve(cwd), claim.node.path), "utf8"),
  );
  const check = resolveCheckReference(graph, String(input.check?.ref ?? ""));
  if (check.status !== "resolved") {
    throw new StoreError(
      "invalid-argument",
      `check reference ${JSON.stringify(input.check?.ref)} cannot resolve (${check.status}) — evidence only records outcomes of real checks`,
    );
  }
  if (check.check.target !== String(input.claim.ref).trim()) {
    throw new StoreError(
      "invalid-argument",
      `check ${JSON.stringify(input.check.ref)} targets ${check.check.target}, not ${JSON.stringify(input.claim.ref)} — evidence must record the claim its check verifies`,
    );
  }
  input.check.designRevision = check.check.designRevision;
}

async function main(): Promise<void> {
  let args: CliArgs = { positional: [], cwd: process.cwd(), allowExternalRoot: false, json: false };
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help || args.command === undefined) {
      console.log(usage());
      if (!args.help && args.command === undefined) process.exitCode = 1;
      return;
    }
    const cwd = path.resolve(args.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`--cwd does not exist or is not a directory: ${args.cwd}`);
    }
    if (!schemaEntrypointGuard(cwd)) return;
    const options = storeOptions(args);
    const command = args.command;

    if (command === "put") {
      const input = JSON.parse(readFileArg(cwd, args.file, "--file")) as EvidenceInput;
      if (args.resolve) await resolvePinnedRevisions(cwd, input);
      emit(args, putImmutable(cwd, input, options) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "get") {
      const record = getById(cwd, requireEvidenceId(args), options);
      if (record === null) {
        throw new StoreError("evidence-not-found", `evidence ${args.positional[0]} does not exist`);
      }
      emit(args, { record: record as unknown as Record<string, unknown> });
      return;
    }
    if (command === "query") {
      emit(args, {
        records: query(cwd, {
          check: args.check,
          claim: args.claim,
          outcome: args.outcome as never,
          retention: args.retention as never,
          subjectKind: args.subjectKind as never,
          runId: args.runId,
        }, options) as unknown as Record<string, unknown>,
      });
      return;
    }
    if (command === "reindex") {
      emit(args, { index: rebuildIndex(cwd, options) as unknown as Record<string, unknown> });
      return;
    }
    if (command === "resolve") {
      const record = getById(cwd, requireEvidenceId(args), options);
      if (record === null) {
        throw new StoreError("evidence-not-found", `evidence ${args.positional[0]} does not exist`);
      }
      emit(args, { resolution: await resolveEvidence(cwd, record) as unknown as Record<string, unknown> });
      return;
    }
    if (command === "promote") {
      if (args.commit === undefined) {
        throw new Error("promote requires --commit <sha> — the store resolves the commit's tree and verifies content identity itself");
      }
      emit(args, promoteToCommit(cwd, requireEvidenceId(args), {
        newEvidenceId: args.as,
        commit: args.commit,
      }, options) as unknown as Record<string, unknown>);
      return;
    }
    if (command === "manifest") {
      emit(args, { manifest: loadManifest(cwd, options) as unknown as Record<string, unknown> });
      return;
    }
    if (command === "recover") {
      emit(args, recoverEvidence(cwd, options) as unknown as Record<string, unknown>);
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error: unknown) {
    if (error instanceof StoreError) {
      const payload: Record<string, unknown> = { command: args.command ?? null, error: error.code, message: error.message };
      if (error.detail !== undefined) payload.detail = error.detail;
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const message = error instanceof Error ? error.message : String(error);
      if (args.json) {
        console.log(JSON.stringify({ command: args.command ?? null, error: "invalid-argument", message }));
      } else {
        console.error(message);
        console.error(usage());
      }
    }
    process.exitCode = 1;
  }
}

main();
