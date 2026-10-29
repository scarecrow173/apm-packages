#!/usr/bin/env node
"use strict";

/**
 * Progressive artifact context retrieval CLI (Issue #124).
 *
 * Exactly one mode per invocation:
 *   --metadata  L1 body-free metadata for the focus chain + typed-relation
 *               neighbors (listArtifactMetadata).
 *   --fetch     L2 validated body fetch for checkout-relative canonical refs
 *               (fetchArtifactBodies); --id/--fingerprint pin expected values.
 *   --expand    L3 bounded deterministic BFS over typed relations
 *               (expandArtifactContext).
 *
 * Output is always JSON on stdout. Mode results exit 1 when the lib reports
 * findings (fail-closed refusals are data, not crashes). CLI-level failures —
 * unknown flags, missing values, conflicting modes, malformed --id/--depth —
 * surface as {error} on stdout plus the message/usage on stderr, exit 1.
 */

import path from "node:path";

import {
  expandArtifactContext,
  fetchArtifactBodies,
  listArtifactMetadata,
} from "./lib/artifact_context";
import { normalizeArtifactPath } from "./lib/artifact_graph";

type PathValue = { path: string; value: string };

type CliArgs = {
  cwd: string;
  metadata: boolean;
  focus: string[];
  taskDir?: string;
  fetchPaths: string[];
  idRefs: PathValue[];
  fingerprintRefs: PathValue[];
  expand?: string;
  relations?: string;
  depth?: number;
  reason?: string;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return "Usage: node fetch_context.js [--cwd <dir>] <mode> [options] [--json]\n"
    + "  L1 metadata: --metadata --focus <id-or-path> [--focus <x> ...] [--task-dir <dir>]\n"
    + "  L2 fetch:    --fetch <path> [--fetch <path> ...] [--id <path>:<id> ...] [--fingerprint <path>:<fp> ...]\n"
    + "  L3 expand:   --expand <id-or-path> [--relations <a,b,c>] [--depth <n>] [--reason <text>]\n"
    + "Exactly one mode is required per invocation.";
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

/** Split a `path:value` option on the FIRST colon (values may contain ':'). */
function splitPathValue(raw: string, option: string): PathValue {
  const index = raw.indexOf(":");
  if (index === -1) {
    throw new Error(`${option} expects <path>:<value>: ${raw}`);
  }
  const refPath = raw.slice(0, index);
  const value = raw.slice(index + 1);
  if (!refPath) throw new Error(`${option} expects a non-empty path before ':': ${raw}`);
  if (!value) throw new Error(`${option} expects a non-empty value after ':': ${raw}`);
  return { path: refPath, value };
}

function parseDepth(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--depth must be an integer >= 0: ${raw}`);
  }
  return Number(raw);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    cwd: process.cwd(),
    metadata: false,
    focus: [],
    fetchPaths: [],
    idRefs: [],
    fingerprintRefs: [],
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--metadata") {
      args.metadata = true;
    } else if (arg === "--focus") {
      args.focus.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--task-dir") {
      args.taskDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--fetch") {
      args.fetchPaths.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--id") {
      args.idRefs.push(splitPathValue(requiredValue(argv, index, arg), arg));
      index += 1;
    } else if (arg === "--fingerprint") {
      args.fingerprintRefs.push(splitPathValue(requiredValue(argv, index, arg), arg));
      index += 1;
    } else if (arg === "--expand") {
      args.expand = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--relations") {
      args.relations = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--depth") {
      args.depth = parseDepth(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--reason") {
      args.reason = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

type Mode = "metadata" | "fetch" | "expand";

/** Exactly one mode per invocation; supporting flags belong to their mode. */
function resolveMode(args: CliArgs): Mode {
  const selected: Mode[] = [];
  if (args.metadata) selected.push("metadata");
  if (args.fetchPaths.length > 0) selected.push("fetch");
  if (args.expand !== undefined) selected.push("expand");
  if (selected.length !== 1) {
    throw new Error("Exactly one of --metadata, --fetch <path>, or --expand <path> is required");
  }
  const mode = selected[0];

  // A supporting flag used outside its mode is a caller error, not something
  // to drop silently — e.g. `--metadata --id p:x` must not ignore the pin.
  const foreign: Array<[boolean, string]> = mode === "metadata"
    ? [
      [args.idRefs.length > 0, "--id"],
      [args.fingerprintRefs.length > 0, "--fingerprint"],
      [args.relations !== undefined, "--relations"],
      [args.depth !== undefined, "--depth"],
      [args.reason !== undefined, "--reason"],
    ]
    : mode === "fetch"
      ? [
        [args.focus.length > 0, "--focus"],
        [args.taskDir !== undefined, "--task-dir"],
        [args.relations !== undefined, "--relations"],
        [args.depth !== undefined, "--depth"],
        [args.reason !== undefined, "--reason"],
      ]
      : [
        [args.focus.length > 0, "--focus"],
        [args.taskDir !== undefined, "--task-dir"],
        [args.idRefs.length > 0, "--id"],
        [args.fingerprintRefs.length > 0, "--fingerprint"],
      ];
  const rejected = foreign.filter(([used]) => used).map(([, flag]) => flag);
  if (rejected.length > 0) {
    throw new Error(`${rejected.join(", ")} not valid with --${mode}`);
  }
  return mode;
}

/**
 * Build L2 refs: one per unique --fetch path (normalized-path dedupe), then
 * apply --id/--fingerprint pins. A pin naming a path that was never fetched
 * is a caller error — the pin would otherwise be silently unenforced.
 */
function buildFetchRefs(cwd: string, args: CliArgs): Array<{ path: string; id?: string; fingerprint?: string }> {
  const refsByKey = new Map<string, { path: string; id?: string; fingerprint?: string }>();
  for (const fetchPath of args.fetchPaths) {
    const key = normalizeArtifactPath(cwd, fetchPath);
    if (!refsByKey.has(key)) refsByKey.set(key, { path: fetchPath });
  }

  const apply = (pins: PathValue[], option: string, field: "id" | "fingerprint"): void => {
    for (const pin of pins) {
      const ref = refsByKey.get(normalizeArtifactPath(cwd, pin.path));
      if (!ref) {
        throw new Error(`${option} refers to a path not given via --fetch: ${pin.path}`);
      }
      if (ref[field] !== undefined) {
        throw new Error(`Duplicate ${option} for ${pin.path}`);
      }
      ref[field] = pin.value;
    }
  };
  apply(args.idRefs, "--id", "id");
  apply(args.fingerprintRefs, "--fingerprint", "fingerprint");
  return [...refsByKey.values()];
}

/** Comma-separated relation list; an empty list would silently traverse nothing. */
function parseRelations(raw: string): string[] {
  const relations = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (relations.length === 0) {
    throw new Error("--relations must name at least one relation");
  }
  return relations;
}

function emitReport(report: unknown, findings: unknown[]): void {
  console.log(JSON.stringify(report, null, 2));
  if (findings.length > 0) process.exitCode = 1;
}

function run(args: CliArgs): void {
  const mode = resolveMode(args);
  const cwd = path.resolve(args.cwd);
  if (mode === "metadata") {
    const { metadata, findings } = listArtifactMetadata(cwd, args.focus, args.taskDir);
    emitReport({ metadata, findings }, findings);
  } else if (mode === "fetch") {
    const result = fetchArtifactBodies(cwd, buildFetchRefs(cwd, args));
    emitReport(result, result.findings);
  } else {
    const result = expandArtifactContext(cwd, args.expand as string, {
      ...(args.relations !== undefined ? { relations: parseRelations(args.relations) } : {}),
      ...(args.depth !== undefined ? { maxDepth: args.depth } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    });
    emitReport(result, result.findings);
  }
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    run(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ error: message }));
    console.error(message);
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
