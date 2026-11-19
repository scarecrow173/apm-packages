import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

export interface BuildConfig {
  /** <repoRoot>/packages/pstack-devin */
  packageDir: string;
  upstream: {
    /** owner/name, e.g. "cursor/plugins" (from upstream.yml) */
    repo: string;
    /** git host, e.g. "github.com" (from upstream.yml) */
    host: string;
    /** fetch URL: apm.yml devDependencies.apm[0].git, falling back to
     *  https://{host}/{repo}.git — lets e2e fixtures point `git:` at a
     *  local repo without changing upstream.yml semantics. */
    repoUrl: string;
    /** subtree inside the repo, e.g. "harness/pstack/claude-code" */
    path: string;
    /** 40-hex commit; single pin authority */
    commit: string;
  };
  overlay: { dir: string; allowOverwrite: string[] };
  distribution: { packageName: string; pluginName: string; version: string };
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const NON_PORTABLE = /[<>:"|?*]/;

/** Assert `p` is a safe, portable relative path (forward slashes).
 *  Rejects empty paths, NUL, absolute or drive-prefixed forms, `..`/`.`
 *  segments (after backslash→slash normalization), trailing slashes, and
 *  characters not portable across filesystems. `kind` names the field in
 *  error messages. */
export function assertSafeRelPath(p: string, kind: string): void {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`invalid ${kind}: empty path`);
  }
  if (p.includes("\0")) {
    throw new Error(`invalid ${kind}: NUL byte in ${JSON.stringify(p)}`);
  }
  if (p.startsWith("/") || p.startsWith("\\")) {
    throw new Error(`unsafe ${kind}: absolute path ${JSON.stringify(p)}`);
  }
  if (/^[A-Za-z]:/.test(p)) {
    throw new Error(`unsafe ${kind}: drive prefix in ${JSON.stringify(p)}`);
  }
  const norm = p.replace(/\\/g, "/");
  if (norm.endsWith("/")) {
    throw new Error(`invalid ${kind}: trailing slash in ${JSON.stringify(p)}`);
  }
  if (NON_PORTABLE.test(norm)) {
    throw new Error(`invalid ${kind}: non-portable char in ${JSON.stringify(p)}`);
  }
  for (const seg of norm.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(
        `unsafe ${kind}: bad segment ${JSON.stringify(seg)} in ${JSON.stringify(p)}`,
      );
    }
  }
}

function reqString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`invalid config: ${what} must be a non-empty string`);
  }
  return v;
}

/** Load and cross-check the package's four config files under
 *  <repoRoot>/packages/pstack-devin. Enforces the #212 pin contract:
 *  upstream.yml commit == apm.yml devDep ref == apm.lock.yaml
 *  resolved_commit — and throws naming the divergent side on mismatch. */
export function loadBuildConfig(repoRoot: string): BuildConfig {
  const packageDir = path.join(repoRoot, "packages", "pstack-devin");
  const readYaml = (file: string): unknown =>
    load(fs.readFileSync(path.join(packageDir, file), "utf8"));

  const upDoc = readYaml("upstream.yml") as {
    upstream?: Record<string, unknown>;
  } | null;
  if (upDoc?.upstream == null || typeof upDoc.upstream !== "object") {
    throw new Error("upstream.yml: missing \"upstream\" mapping");
  }
  const up = upDoc.upstream;
  const repo = reqString(up.repo, "upstream.yml upstream.repo");
  const host = reqString(up.host, "upstream.yml upstream.host");
  const upPath = reqString(up.path, "upstream.yml upstream.path");
  const commit = reqString(up.commit, "upstream.yml upstream.commit");
  assertSafeRelPath(upPath, "upstream path");
  if (!COMMIT_RE.test(commit)) {
    throw new Error(
      `upstream.yml upstream.commit is not a 40-hex commit: ${commit}`,
    );
  }

  const manifest = readYaml("apm.yml") as Record<string, unknown> | null;
  if (manifest == null || typeof manifest !== "object") {
    throw new Error("apm.yml: not a YAML mapping");
  }
  const packageName = reqString(manifest.name, "apm.yml name");
  const version = reqString(manifest.version, "apm.yml version");
  const apmDeps = (manifest.devDependencies as { apm?: unknown } | undefined)?.apm;
  if (!Array.isArray(apmDeps) || apmDeps.length !== 1) {
    throw new Error(
      "apm.yml devDependencies.apm must list exactly one provenance entry",
    );
  }
  const dep = apmDeps[0] as Record<string, unknown>;
  if (dep.ref !== commit) {
    throw new Error(
      `apm.yml devDependencies ref (${dep.ref}) does not match upstream.yml commit (${commit})`,
    );
  }
  if (dep.path !== upPath) {
    throw new Error(
      `apm.yml devDependencies path (${dep.path}) does not match upstream.yml upstream.path (${upPath})`,
    );
  }
  if (
    !Array.isArray(dep.targets) || dep.targets.length !== 1 ||
    dep.targets[0] !== "copilot"
  ) {
    throw new Error(
      `apm.yml devDependencies targets must be ["copilot"], got ${JSON.stringify(dep.targets)}`,
    );
  }
  const repoUrl = dep.git == null
    ? `https://${host}/${repo}.git`
    : reqString(dep.git, "apm.yml devDependencies.apm[0].git");

  // Optional `dependencies.apm`: shorthand `owner/repo/path#ref` entries
  // (e.g. the cursor-team-kit skills pstack references). Every ref must
  // equal the upstream commit — single-authority pinning — and no dep may
  // resolve the upstream pstack subtree itself: the tree ships through the
  // copilot-scoped devDependency only, never to consumers.
  const deps = (manifest.dependencies as { apm?: unknown } | undefined)?.apm;
  if (deps !== undefined) {
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== "string")) {
      throw new Error(
        "apm.yml dependencies.apm must be a list of shorthand `owner/repo/path#ref` strings",
      );
    }
    for (const d of deps as string[]) {
      const hashIdx = d.lastIndexOf("#");
      const depPath = hashIdx === -1 ? d : d.slice(0, hashIdx);
      const depRef = hashIdx === -1 ? "" : d.slice(hashIdx + 1);
      if (depRef !== commit) {
        throw new Error(
          `apm.yml dependencies ref (${depRef || "<none>"}) does not match upstream.yml commit (${commit}) — deps pin to the same upstream commit`,
        );
      }
      if (depPath.endsWith(`/${upPath}`)) {
        throw new Error(
          "apm.yml dependencies must not resolve the upstream pstack subtree — it ships via the copilot-scoped devDependency only",
        );
      }
    }
  }

  const lock = readYaml("apm.lock.yaml") as {
    dependencies?: Array<Record<string, unknown>>;
  } | null;
  const devEntries = (lock?.dependencies ?? []).filter(
    (e) => e.is_dev === true,
  );
  if (!Array.isArray(lock?.dependencies) || devEntries.length !== 1) {
    throw new Error(
      "apm.lock.yaml dependencies must contain exactly one devDependency pin entry",
    );
  }
  for (const e of lock.dependencies) {
    if (e.resolved_commit !== commit) {
      throw new Error(
        `apm.lock.yaml resolved_commit (${e.resolved_commit}) does not match upstream.yml commit (${commit})`,
      );
    }
  }
  const lockEntry = devEntries[0];
  if (lockEntry.package_type !== "agent_plugin") {
    process.stderr.write(
      `warning: apm.lock.yaml package_type is ${JSON.stringify(lockEntry.package_type)}, expected "agent_plugin"\n`,
    );
  }

  const overlayDoc = readYaml("overlay.yml") as {
    allow_overwrite?: unknown;
  } | null;
  const allow = overlayDoc?.allow_overwrite ?? [];
  if (!Array.isArray(allow) || allow.some((e) => typeof e !== "string")) {
    throw new Error("overlay.yml allow_overwrite must be a list of strings");
  }
  for (const entry of allow as string[]) {
    assertSafeRelPath(entry, "overlay allow_overwrite path");
    if (!entry.includes("/")) {
      throw new Error(
        `overlay.yml allow_overwrite entry must be a file path, not a directory-level policy: ${entry}`,
      );
    }
  }

  return {
    packageDir,
    upstream: { repo, host, repoUrl, path: upPath, commit },
    overlay: {
      dir: path.join(packageDir, "overlay"),
      allowOverwrite: allow as string[],
    },
    distribution: { packageName, pluginName: "pstack", version },
  };
}
