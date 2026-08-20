import fs from "node:fs";
import path from "node:path";

/** Resolve an explicitly selected graph or one of the supported default locations. */
export function resolveGraphPath(explicitGraph?: string, cwd = process.cwd()): string {
  // Preserve the route CLI contract: an explicit relative graph is resolved
  // from the process working directory; cwd only selects runtime projection.
  if (explicitGraph) return path.resolve(explicitGraph);

  // Keep resolution relative to the CLI directory. In source this module
  // lives in scripts/lib; esbuild bundles it into the scripts entrypoint.
  const cliDir = path.basename(__dirname) === "lib" ? path.resolve(__dirname, "..") : __dirname;
  const candidates = [
    // Distributed skill layout: scripts/route_graph.js next to ../graphs.
    path.resolve(cliDir, "../graphs/doc-driven-dev.yaml"),
    // Source layout when the CLI is run from the monorepo checkout.
    path.resolve(
      cliDir,
      "../../../../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
    ),
    path.resolve(
      cwd,
      "packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml",
    ),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Unable to locate the default Graph Definition (tried: ${candidates.join(", ")})`);
  return found;
}
