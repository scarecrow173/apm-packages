#!/usr/bin/env node
"use strict";

import path from "node:path";
import { schemaEntrypointGuard } from "../../lib/schema_preflight";
import {
  resolveCheckReference,
  resolveClaimReference,
  scanKnowledgeGraph,
} from "../../lib/knowledge_graph";
import type { KnowledgeNode } from "../../lib/knowledge_graph";

type CliArgs = {
  cwd: string;
  doc?: string;
  forClaim?: string;
  help?: boolean;
  json?: boolean;
  ref?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--doc") args.doc = argv[++i];
    else if (arg === "--ref") args.ref = argv[++i];
    else if (arg === "--for-claim") args.forClaim = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage(): string {
  return "Usage: node scripts/resolve_verification.js [--doc <ref> | --ref <VD-id::CHK-NN> | --for-claim <DOC::KEY>] [--json]";
}

function nodeSummary(node: KnowledgeNode): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    path: node.path,
    checks: node.checks.map((check) => ({
      id: check.id,
      qualifiedId: check.qualifiedId,
      target: check.target,
      method: check.method,
      required: check.required,
      designRevision: check.designRevision,
    })),
  };
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    if (!args.doc && !args.ref && !args.forClaim) throw new Error("One of --doc, --ref, or --for-claim is required");
    const cwd = path.resolve(args.cwd);
    if (!schemaEntrypointGuard(cwd)) return;
    const graph = await scanKnowledgeGraph({ cwd });
    const emit = (payload: unknown): void => {
      console.log(args.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload));
    };

    if (args.ref) {
      // The same boundary task `checks` entries and Evidence Records
      // resolve through (#237/#240): anything that is not a live
      // `VD-<id>::CHK-NN` reports its status and never resolves to a
      // check by accident.
      const resolution = resolveCheckReference(graph, args.ref);
      emit(resolution.status === "resolved"
        ? { status: resolution.status, document: resolution.node.id, path: resolution.node.path, check: resolution.check }
        : { status: resolution.status, ref: args.ref });
      if (resolution.status !== "resolved") process.exitCode = 1;
      return;
    }

    if (args.doc) {
      const node = graph.nodes.find(
        (candidate) => candidate.type === "verification" && (candidate.id === args.doc || candidate.path === args.doc),
      );
      if (!node) {
        emit({ status: "unresolved-document", doc: args.doc });
        process.exitCode = 1;
        return;
      }
      emit({ status: "resolved", document: nodeSummary(node) });
      return;
    }

    // --for-claim <DOC::KEY>: which Verification Designs already check this
    // claim — the reuse-first lookup the skill runs before creating a new
    // document (Issue #239: an existing design is updated, not duplicated).
    const claimResolution = resolveClaimReference(graph, args.forClaim as string);
    const covering = graph.checkEdges
      .filter((edge) => edge.resolution === "resolved" && edge.target === (args.forClaim as string).trim())
      .map((edge) => ({
        document: edge.from.id,
        path: edge.from.path,
        check: edge.check,
        method: edge.method,
        required: edge.required,
      }));
    // An empty covering set is a normal answer — "no design checks this
    // claim yet, creating one is the right move" — not a failure.
    emit({
      claim: args.forClaim,
      claimStatus: claimResolution.status,
      coveringChecks: covering,
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}

main();
