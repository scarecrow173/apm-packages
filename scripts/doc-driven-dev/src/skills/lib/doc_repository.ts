"use strict";

import fs from "node:fs";
import path from "node:path";

import { configFor, docTypes, parseDoc, relationFields } from "./doc_suite_utils";
import { isIndexFileName, normalizeDir } from "./document_utils";

// ---------------------------------------------------------------------------
// Finding contract
// ---------------------------------------------------------------------------

type FindingSeverity = "error" | "warning" | "info";
type RepairClass = "safe" | "migration" | "manual";

type Finding = {
  ruleId: string;
  category: string;
  severity: FindingSeverity;
  blocking: boolean;
  path: string | null;
  line: number | null;
  artifactId: string | null;
  message: string;
  target: string | null;
  repair: RepairClass;
};

type FindingInput = Partial<Omit<Finding, "ruleId" | "category" | "message">> & {
  ruleId: string;
  category: string;
  message: string;
};

function finding(input: FindingInput): Finding {
  const severity = input.severity ?? "error";
  return {
    ruleId: input.ruleId,
    category: input.category,
    severity,
    blocking: input.blocking ?? severity === "error",
    path: input.path ?? null,
    line: input.line ?? null,
    artifactId: input.artifactId ?? null,
    message: input.message,
    target: input.target ?? null,
    repair: input.repair ?? "manual",
  };
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareFindings(left: Finding, right: Finding): number {
  return compareStrings(left.path ?? "", right.path ?? "")
    || (left.line ?? 0) - (right.line ?? 0)
    || compareStrings(left.ruleId, right.ruleId)
    || compareStrings(left.target ?? "", right.target ?? "")
    || compareStrings(left.message, right.message);
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}

// ---------------------------------------------------------------------------
// Document contract registry
// ---------------------------------------------------------------------------

type RequiredRelation = {
  field: string;
  targetTypes: string[];
  appliesToStatuses?: string[];
  skipField?: string;
  gateCode?: string;
};

type DocumentContract = {
  type: string;
  idPrefix: string;
  idPattern: RegExp;
  idExceptions: string[];
  canonicalDir: string;
  dirs: string[];
  defaultStatus: string;
  statusValues: string[];
  requiredFields: string[];
  requiredRelations: RequiredRelation[];
  requiredDirectoryFiles: string[];
  reservedFiles: string[];
  allowsRootArtifact: boolean;
  requiresSourceEvidence: boolean;
  expectedUpstream: UpstreamExpectation[];
};

type UpstreamExpectation = {
  fields: string[];
  skipStatuses?: string[];
};

const REQUIRED_FRONT_MATTER_FIELDS = [
  "id",
  "type",
  "status",
  "title",
  "created",
  "updated",
  "owners",
  "relations",
] as const;

const ROOT_ARTIFACT_TYPES: ReadonlySet<string> = new Set(["idea", "brainstorm", "discovery"]);

const TRACEABILITY_TERMINAL_STATUSES = ["superseded", "rejected", "archived", "deprecated", "abandoned", "wont-do"];

function contractForDocType(type: string): DocumentContract {
  const config = configFor(type);
  const contract: DocumentContract = {
    type,
    idPrefix: config.idPrefix,
    idPattern: new RegExp(`^${config.idPrefix}-[0-9A-Za-z]+$`),
    idExceptions: [],
    canonicalDir: config.dir,
    dirs: [...config.dirs],
    defaultStatus: config.defaultStatus,
    statusValues: [...config.statusValues],
    requiredFields: [...REQUIRED_FRONT_MATTER_FIELDS],
    requiredRelations: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    allowsRootArtifact: ROOT_ARTIFACT_TYPES.has(type),
    requiresSourceEvidence: false,
    expectedUpstream: [],
  };
  if (type === "discovery") {
    contract.requiresSourceEvidence = true;
  }
  if (type === "spec" || type === "plan" || type === "task" || type === "design") {
    contract.expectedUpstream = [
      { fields: ["implements", "derives-from", "refines"], skipStatuses: TRACEABILITY_TERMINAL_STATUSES },
    ];
  }
  if (type === "design") {
    contract.idExceptions = ["DESIGN-OVERVIEW"];
    contract.requiredDirectoryFiles = ["overview.md"];
    contract.reservedFiles = ["overview.md"];
  }
  if (type === "test-spec") {
    contract.requiredRelations = [
      { field: "verifies", targetTypes: ["spec", "design", "adr"], gateCode: "TEST-SPEC-DOC-GATE-001" },
    ];
  }
  if (type === "plan") {
    contract.requiredRelations = [
      {
        field: "verified-by",
        targetTypes: ["test-spec"],
        appliesToStatuses: ["approved", "in-progress", "completed"],
        skipField: "test-spec-skip",
      },
    ];
  }
  return contract;
}

const contracts: Record<string, DocumentContract> = {
  ...Object.fromEntries(docTypes.map((type) => [type, contractForDocType(type)])),
  impl: {
    type: "impl",
    idPrefix: "IMPL",
    idPattern: /^IMPL-[0-9A-Za-z]+$/,
    idExceptions: [],
    canonicalDir: "docs/impl",
    dirs: ["docs/impl/ir", "docs/impl/exp"],
    defaultStatus: "draft",
    statusValues: ["draft", "in-progress", "completed", "blocked", "abandoned", "superseded"],
    requiredFields: [...REQUIRED_FRONT_MATTER_FIELDS, "metadata"],
    requiredRelations: [],
    requiredDirectoryFiles: [],
    reservedFiles: [],
    allowsRootArtifact: false,
    requiresSourceEvidence: false,
    expectedUpstream: [],
  },
};

function documentContracts(): Record<string, DocumentContract> {
  return contracts;
}

function contractForType(type: string): DocumentContract | null {
  return contracts[type] ?? null;
}

function canonicalDocRoots(): string[] {
  const roots = new Set<string>();
  for (const contract of Object.values(contracts)) {
    for (const dir of contract.dirs) roots.add(normalizeDir(dir));
  }
  return [...roots].sort(compareStrings);
}

// ---------------------------------------------------------------------------
// Repository document model
// ---------------------------------------------------------------------------

type DocumentKind = "canonical" | "index" | "unmanaged";

type DocumentLink = {
  target: string;
  line: number;
  column: number;
  isImage: boolean;
};

type DocumentHeading = {
  depth: number;
  text: string;
  slug: string;
  line: number;
};

type RepositoryDocument = {
  path: string;
  absolutePath: string;
  kind: DocumentKind;
  expectedTypes: string[];
  type: string | null;
  id: string | null;
  status: string | null;
  title: string | null;
  owners: string[];
  created: string | null;
  updated: string | null;
  frontMatter: Record<string, unknown>;
  parseError: string | null;
  relations: Record<string, string[]>;
  links: DocumentLink[];
  headings: DocumentHeading[];
  indexMembership: string[];
  localeSiblings: string[];
  body: string;
};

type PathResolution = {
  status: "resolved" | "unresolved" | "escaped" | "external";
  path: string | null;
  fragment: string | null;
  document: RepositoryDocument | null;
};

type RelationResolution =
  | { status: "resolved"; document: RepositoryDocument }
  | { status: "resolved-file"; path: string }
  | { status: "ambiguous"; candidates: RepositoryDocument[] }
  | { status: "unresolved" }
  | { status: "escaped" }
  | { status: "external" };

type IdLookup =
  | { status: "none" }
  | { status: "unique"; document: RepositoryDocument }
  | { status: "ambiguous"; candidates: RepositoryDocument[] };

type DocumentRepository = {
  root: string;
  files: RepositoryDocument[];
  documents: RepositoryDocument[];
  canonicalDocuments: RepositoryDocument[];
  unmanagedDocuments: RepositoryDocument[];
  indexes: RepositoryDocument[];
  byPath: Map<string, RepositoryDocument>;
  byId: Map<string, RepositoryDocument[]>;
  lookupById(id: string): IdLookup;
  resolvePath(from: RepositoryDocument | null, target: string): PathResolution;
  resolveRelationTarget(from: RepositoryDocument, target: string): RelationResolution;
  hasAnchor(document: RepositoryDocument, slug: string): boolean;
  duplicateIds(): { id: string; paths: string[] }[];
};

type ScanOptions = {
  cwd: string;
  roots?: string[];
  includeTopLevelMarkdown?: boolean;
};

// ---------------------------------------------------------------------------
// Markdown extraction
// ---------------------------------------------------------------------------

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start?: { line?: number; column?: number } };
};

let markdownModules: Promise<{ unified: Function; remarkParse: unknown; visit: Function }> | null = null;

async function loadMarkdownModules(): Promise<{ unified: Function; remarkParse: unknown; visit: Function }> {
  if (!markdownModules) {
    markdownModules = Promise.all([
      import("unified"),
      import("remark-parse"),
      import("unist-util-visit"),
    ]).then(([unifiedModule, remarkParseModule, visitModule]) => ({
      unified: unifiedModule.unified,
      remarkParse: (remarkParseModule as { default?: unknown }).default || remarkParseModule,
      visit: visitModule.visit,
    }));
  }
  return markdownModules;
}

function textFromNode(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children || []).map(textFromNode).join("");
}

function slugifyAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

function frontMatterEndLine(content: string): number {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return 0;
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return closing > 0 ? closing + 1 : 0;
}

async function extractMarkdownStructure(body: string, lineOffset = 0): Promise<{ links: DocumentLink[]; headings: DocumentHeading[] }> {
  const { unified, remarkParse, visit } = await loadMarkdownModules();
  const tree = unified().use(remarkParse).parse(body) as MarkdownNode;
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node: MarkdownNode) => {
    if (typeof node.identifier === "string" && typeof node.url === "string") {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
  });

  const links: DocumentLink[] = [];
  const headings: DocumentHeading[] = [];
  const usedSlugs = new Map<string, number>();
  visit(tree, (node: MarkdownNode) => {
    const line = (node.position?.start?.line ?? 0) + lineOffset;
    const column = node.position?.start?.column ?? 0;
    if (node.type === "heading") {
      const text = textFromNode(node).replace(/\s+/g, " ").trim();
      const base = slugifyAnchor(text);
      const seen = usedSlugs.get(base) ?? 0;
      usedSlugs.set(base, seen + 1);
      headings.push({ depth: node.depth ?? 0, text, slug: seen === 0 ? base : `${base}-${seen}`, line });
      return;
    }
    if (node.type === "link" || node.type === "image") {
      if (typeof node.url === "string" && node.url.trim()) {
        links.push({ target: node.url.trim(), line, column, isImage: node.type === "image" });
      }
      return;
    }
    if (node.type === "linkReference" || node.type === "imageReference") {
      const url = typeof node.identifier === "string" ? definitions.get(node.identifier.toLowerCase()) : undefined;
      if (url && url.trim()) {
        links.push({ target: url.trim(), line, column, isImage: node.type === "imageReference" });
      }
    }
  });
  return { links, headings };
}

// ---------------------------------------------------------------------------
// Scanner helpers
// ---------------------------------------------------------------------------

const SKIPPED_DIRS = new Set([".git", "node_modules", ".pnpm-store"]);
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const LOCALE_FILE_PATTERN = /^(.+)\.([a-z]{2})\.md$/i;

function isWindowsAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH.test(value.trim());
}

function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  if (isWindowsAbsolutePath(trimmed)) return false;
  return EXTERNAL_REFERENCE.test(trimmed);
}

function walkMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const files: string[] = [];
  const visitDir = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visitDir(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(full);
      }
    }
  };
  visitDir(root);
  return files.sort(compareStrings);
}

function toRepoPath(cwd: string, absolute: string): string {
  return path.relative(cwd, absolute).split(path.sep).join("/");
}

function isUnderDir(child: string, parent: string): boolean {
  const c = normalizeDir(child);
  const p = normalizeDir(parent);
  return c === p || c.startsWith(`${p}/`);
}

function canonicalTypeMap(): { dir: string; types: string[] }[] {
  const byDir = new Map<string, Set<string>>();
  for (const contract of Object.values(contracts)) {
    for (const dir of contract.dirs) {
      const normalized = normalizeDir(dir);
      const types = byDir.get(normalized) ?? new Set<string>();
      types.add(contract.type);
      byDir.set(normalized, types);
    }
  }
  return [...byDir.entries()]
    .map(([dir, types]) => ({ dir, types: [...types].sort(compareStrings) }))
    .sort((a, b) => b.dir.length - a.dir.length || compareStrings(a.dir, b.dir));
}

function expectedTypesFor(repoPath: string, typeMap: { dir: string; types: string[] }[]): string[] {
  const dir = normalizeDir(path.posix.dirname(repoPath));
  const match = typeMap.find((entry) => isUnderDir(dir, entry.dir));
  return match ? match.types : [];
}

function extractRelations(data: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const raw = data.relations;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "changes") continue;
    const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const values = items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
    if (values.length > 0) result[key] = [...new Set(values)].sort(compareStrings);
  }
  return result;
}

function stringField(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function localeSiblingsFor(repoPath: string, siblingsByDir: Map<string, Set<string>>): string[] {
  const dir = path.posix.dirname(repoPath);
  const base = path.posix.basename(repoPath);
  const peers = siblingsByDir.get(dir);
  if (!peers) return [];
  const localeMatch = LOCALE_FILE_PATTERN.exec(base);
  if (localeMatch) {
    const sibling = `${dir === "." ? "" : `${dir}/`}${localeMatch[1]}.md`;
    return peers.has(localeMatch[1] + ".md") ? [sibling] : [];
  }
  const stem = base.replace(/\.md$/i, "");
  return [...peers]
    .filter((peer) => LOCALE_FILE_PATTERN.test(peer) && peer.replace(LOCALE_FILE_PATTERN, "$1") === stem)
    .map((peer) => `${dir === "." ? "" : `${dir}/`}${peer}`)
    .sort(compareStrings);
}

function defaultScanRoots(cwd: string): string[] {
  const roots = new Set<string>();
  if (fs.existsSync(path.join(cwd, "docs"))) roots.add("docs");
  for (const dir of canonicalDocRoots()) {
    if (fs.existsSync(path.join(cwd, dir))) roots.add(dir);
  }
  return [...roots].sort(compareStrings);
}

function pruneNestedRoots(roots: string[]): string[] {
  const sorted = [...new Set(roots.map((root) => normalizeDir(root)))].sort(compareStrings);
  return sorted.filter((root) => !sorted.some((other) => other !== root && isUnderDir(root, other)));
}

// ---------------------------------------------------------------------------
// Repository scan
// ---------------------------------------------------------------------------

async function scanRepository(options: ScanOptions): Promise<DocumentRepository> {
  const cwd = path.resolve(options.cwd);
  const roots = pruneNestedRoots(options.roots?.length ? options.roots : defaultScanRoots(cwd));
  const typeMap = canonicalTypeMap();

  const absoluteFiles = new Set<string>();
  for (const root of roots) {
    for (const file of walkMarkdownFiles(path.join(cwd, root))) absoluteFiles.add(file);
  }
  if (options.includeTopLevelMarkdown !== false) {
    for (const entry of fs.readdirSync(cwd, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        absoluteFiles.add(path.join(cwd, entry.name));
      }
    }
  }

  const siblingsByDir = new Map<string, Set<string>>();
  for (const absolute of absoluteFiles) {
    const repoPath = toRepoPath(cwd, absolute);
    const dir = path.posix.dirname(repoPath);
    const peers = siblingsByDir.get(dir) ?? new Set<string>();
    peers.add(path.posix.basename(repoPath));
    siblingsByDir.set(dir, peers);
  }

  const files: RepositoryDocument[] = [];
  for (const absolute of [...absoluteFiles].sort(compareStrings)) {
    const repoPath = toRepoPath(cwd, absolute);
    const expectedTypes = expectedTypesFor(repoPath, typeMap);
    const canonical = expectedTypes.length > 0;
    const kind: DocumentKind = !canonical ? "unmanaged" : isIndexFileName(path.posix.basename(repoPath)) ? "index" : "canonical";

    let content = "";
    let readError: string | null = null;
    try {
      content = fs.readFileSync(absolute, "utf8");
    } catch (error: unknown) {
      readError = error instanceof Error ? error.message : String(error);
    }
    const parsed = readError ? { data: {}, body: "", error: readError } : parseDoc(content);
    const structure = await extractMarkdownStructure(parsed.body, frontMatterEndLine(content));
    const data = parsed.data as Record<string, unknown>;
    const owners = Array.isArray(data.owners)
      ? data.owners.filter((owner): owner is string => typeof owner === "string" && Boolean(owner.trim()))
      : [];

    files.push({
      path: repoPath,
      absolutePath: absolute,
      kind,
      expectedTypes,
      type: stringField(data, "type"),
      id: stringField(data, "id"),
      status: stringField(data, "status"),
      title: stringField(data, "title"),
      owners,
      created: stringField(data, "created"),
      updated: stringField(data, "updated"),
      frontMatter: parsed.error ? {} : data,
      parseError: parsed.error,
      relations: extractRelations(data),
      links: structure.links,
      headings: structure.headings,
      indexMembership: [],
      localeSiblings: localeSiblingsFor(repoPath, siblingsByDir),
      body: parsed.body,
    });
  }

  const byPath = new Map<string, RepositoryDocument>();
  const byId = new Map<string, RepositoryDocument[]>();
  for (const document of files) {
    byPath.set(document.path, document);
    if (!document.id) continue;
    const group = byId.get(document.id) ?? [];
    group.push(document);
    byId.set(document.id, group);
  }

  const insideRoot = (absolute: string): boolean => {
    const resolved = path.resolve(absolute);
    return resolved === cwd || resolved.startsWith(`${cwd}${path.sep}`);
  };

  const fileExistsInsideRoot = (absolute: string): boolean => {
    return insideRoot(absolute) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
  };

  const splitTarget = (raw: string): { pathname: string; fragment: string | null } => {
    const trimmed = raw.trim();
    const withoutFragment = trimmed.split("#", 2);
    const pathname = withoutFragment[0].split("?", 1)[0];
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = pathname;
    }
    return { pathname: decoded, fragment: withoutFragment[1] ?? null };
  };

  const resolvePath = (from: RepositoryDocument | null, rawTarget: string): PathResolution => {
    const value = rawTarget.trim();
    if (isExternalReference(value)) return { status: "external", path: null, fragment: null, document: null };
    const { pathname, fragment } = splitTarget(value);
    if (!pathname) {
      const self = from?.path ?? null;
      return { status: "resolved", path: self, fragment, document: self ? byPath.get(self) ?? null : null };
    }

    const docRelative = pathname.startsWith("./") || pathname.startsWith("../") || pathname === "." || pathname === "..";
    const candidates = docRelative
      ? [from ? path.resolve(path.dirname(from.absolutePath), pathname) : null, path.resolve(cwd, pathname)]
      : [path.resolve(cwd, pathname), from ? path.resolve(path.dirname(from.absolutePath), pathname) : null];
    if (path.isAbsolute(pathname) || isWindowsAbsolutePath(pathname)) {
      candidates.length = 0;
      candidates.push(path.resolve(pathname));
    }

    let sawEscaped = false;
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (!insideRoot(candidate)) {
        sawEscaped = true;
        continue;
      }
      if (fileExistsInsideRoot(candidate)) {
        const repoPath = toRepoPath(cwd, candidate);
        return { status: "resolved", path: repoPath, fragment, document: byPath.get(repoPath) ?? null };
      }
    }
    if (sawEscaped) {
      return { status: "escaped", path: null, fragment, document: null };
    }
    const preferred = candidates.find((candidate): candidate is string => Boolean(candidate)) ?? null;
    return {
      status: "unresolved",
      path: preferred && insideRoot(preferred) ? toRepoPath(cwd, preferred) : null,
      fragment,
      document: null,
    };
  };

  const resolveRelationTarget = (from: RepositoryDocument, rawTarget: string): RelationResolution => {
    const value = rawTarget.trim();
    if (isExternalReference(value)) return { status: "external" };
    const byIdMatch = byId.get(value);
    if (byIdMatch && byIdMatch.length === 1) return { status: "resolved", document: byIdMatch[0] };
    if (byIdMatch && byIdMatch.length > 1) return { status: "ambiguous", candidates: [...byIdMatch].sort((a, b) => compareStrings(a.path, b.path)) };

    const resolved = resolvePath(from, value);
    if (resolved.status === "resolved") {
      if (resolved.document) return { status: "resolved", document: resolved.document };
      return { status: "resolved-file", path: resolved.path as string };
    }
    if (resolved.status === "escaped") return { status: "escaped" };
    return { status: "unresolved" };
  };

  // Index membership: links from index files into scanned documents.
  for (const index of files.filter((file) => file.kind === "index")) {
    const members = new Set<string>();
    for (const link of index.links) {
      if (link.isImage) continue;
      const resolved = resolvePath(index, link.target);
      if (resolved.status === "resolved" && resolved.path && byPath.has(resolved.path)) {
        members.add(resolved.path);
      }
    }
    for (const memberPath of members) {
      const member = byPath.get(memberPath);
      if (member && member.path !== index.path) member.indexMembership.push(index.path);
    }
  }
  for (const document of files) {
    document.indexMembership.sort(compareStrings);
  }

  const repository: DocumentRepository = {
    root: cwd,
    files,
    documents: files.filter((file) => file.kind !== "index"),
    canonicalDocuments: files.filter((file) => file.kind === "canonical"),
    unmanagedDocuments: files.filter((file) => file.kind === "unmanaged"),
    indexes: files.filter((file) => file.kind === "index"),
    byPath,
    byId,
    lookupById(id: string): IdLookup {
      const matches = byId.get(id.trim()) ?? [];
      if (matches.length === 0) return { status: "none" };
      if (matches.length === 1) return { status: "unique", document: matches[0] };
      return { status: "ambiguous", candidates: [...matches].sort((a, b) => compareStrings(a.path, b.path)) };
    },
    resolvePath,
    resolveRelationTarget,
    hasAnchor(document: RepositoryDocument, slug: string): boolean {
      return document.headings.some((heading) => heading.slug === slug);
    },
    duplicateIds(): { id: string; paths: string[] }[] {
      return [...byId.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([id, group]) => ({ id, paths: group.map((document) => document.path).sort(compareStrings) }))
        .sort((a, b) => compareStrings(a.id, b.id));
    },
  };
  return repository;
}

export {
  canonicalDocRoots,
  compareFindings,
  contractForType,
  documentContracts,
  finding,
  frontMatterEndLine,
  isExternalReference,
  scanRepository,
  slugifyAnchor,
  sortFindings,
};

export type {
  DocumentContract,
  DocumentHeading,
  DocumentKind,
  DocumentLink,
  DocumentRepository,
  Finding,
  FindingSeverity,
  IdLookup,
  PathResolution,
  RelationResolution,
  RepairClass,
  RepositoryDocument,
  RequiredRelation,
  ScanOptions,
  UpstreamExpectation,
};
