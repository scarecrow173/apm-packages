import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { collectDashboard } from "./dashboard_collect";
import { renderDashboard } from "./dashboard_render";
import { resolveGraphPath } from "./graph_cli";

export type DashboardArgs = {
  cwd: string;
  graph?: string;
  focus: string[];
  current?: string;
  signals: string[];
  out: string;
  force: boolean;
  help: boolean;
};

const DEFAULT_OUTPUT = "reports/doc-driven-dev/index.html";

type DashboardWriteOperations = {
  randomUUID: () => string;
  openExclusive: (file: string) => number;
  write: (fd: number, html: string) => void;
  close: (fd: number) => void;
  link: (from: string, to: string) => void;
  rename: (from: string, to: string) => void;
  unlink: (file: string) => void;
};

const defaultWriteOperations: DashboardWriteOperations = {
  randomUUID,
  openExclusive: (file) => fs.openSync(file, "wx"),
  write: (fd, html) => fs.writeFileSync(fd, html, { encoding: "utf8" }),
  close: (fd) => fs.closeSync(fd),
  link: (from, to) => fs.linkSync(from, to),
  rename: (from, to) => fs.renameSync(from, to),
  unlink: (file) => fs.unlinkSync(file),
};

const requiredValue = (argv: string[], index: number): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argv[index]}`);
  return value;
};

const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

export function parseDashboardArgs(argv: string[], processCwd: string): DashboardArgs {
  let cwdValue = ".";
  let graphValue: string | undefined;
  let outValue = DEFAULT_OUTPUT;
  let current: string | undefined;
  const focus: string[] = [];
  const signals: string[] = [];
  let force = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--force") force = true;
    else if (option === "--help") help = true;
    else if (["--cwd", "--graph", "--focus", "--current", "--signal", "--out"].includes(option)) {
      const value = requiredValue(argv, index);
      index += 1;
      if (option === "--cwd") cwdValue = value;
      else if (option === "--graph") graphValue = value;
      else if (option === "--focus") focus.push(value);
      else if (option === "--current") current = value;
      else if (option === "--signal") signals.push(value);
      else outValue = value;
    } else if (option.startsWith("--")) {
      throw new Error(`Unknown option: ${option}`);
    } else {
      throw new Error(`Unexpected argument: ${option}`);
    }
  }

  const cwd = path.resolve(processCwd, cwdValue);
  return {
    cwd,
    graph: graphValue === undefined ? undefined : path.resolve(processCwd, graphValue),
    focus,
    current,
    signals,
    out: path.resolve(cwd, outValue),
    force,
    help,
  };
}

function assertRegularOutput(output: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Output must not be a symbolic link: ${output}`);
  if (!stat.isFile()) throw new Error(`Output must be a regular HTML file: ${output}`);
}

function assertExistingAncestorsInside(root: string, targetParent: string): void {
  let cursor = targetParent;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`Output is outside repository: ${targetParent}`);
    cursor = parent;
  }
  const realAncestor = fs.realpathSync(cursor);
  if (!isInside(root, realAncestor)) throw new Error(`Output ancestor resolves outside repository: ${cursor}`);
}

export function writeDashboard(cwd: string, outputValue: string, html: string, force: boolean): string {
  return writeDashboardWithOperations(cwd, outputValue, html, force, defaultWriteOperations);
}

export function writeDashboardWithOperations(
  cwd: string,
  outputValue: string,
  html: string,
  force: boolean,
  operations: DashboardWriteOperations,
): string {
  const rootPath = path.resolve(cwd);
  const rootStat = fs.statSync(rootPath);
  if (!rootStat.isDirectory()) throw new Error(`Dashboard cwd is not a directory: ${rootPath}`);
  const root = fs.realpathSync(rootPath);
  const requestedOutput = path.resolve(rootPath, outputValue);
  if (!isInside(rootPath, requestedOutput)) throw new Error(`Output is outside repository: ${requestedOutput}`);
  if (path.extname(requestedOutput).toLowerCase() !== ".html") throw new Error(`Output must use the .html extension: ${requestedOutput}`);

  const relativeOutput = path.relative(rootPath, requestedOutput);
  const output = path.resolve(root, relativeOutput);
  const parent = path.dirname(output);
  assertExistingAncestorsInside(root, parent);
  assertRegularOutput(output);
  if (!force && fs.existsSync(output)) throw new Error(`Output already exists; pass --force to replace it: ${output}`);

  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync(parent);
  if (!isInside(root, realParent)) throw new Error(`Output parent resolves outside repository: ${parent}`);
  assertRegularOutput(output);
  if (!force && fs.existsSync(output)) throw new Error(`Output already exists; pass --force to replace it: ${output}`);

  const temp = path.join(realParent, `.${path.basename(output)}.${operations.randomUUID()}.tmp`);
  let fd: number | undefined;
  let ownsTemp = false;
  try {
    fd = operations.openExclusive(temp);
    ownsTemp = true;
    operations.write(fd, html);
    operations.close(fd);
    fd = undefined;
    assertRegularOutput(output);
    if (force && fs.existsSync(output)) operations.rename(temp, output);
    else operations.link(temp, output);
  } finally {
    try {
      if (fd !== undefined) operations.close(fd);
    } finally {
      if (ownsTemp) {
        try {
          operations.unlink(temp);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  }
  return output;
}

const usage = `Usage: build_dashboard [options]

Options:
  --cwd <dir>       Repository to read (relative to process cwd; default: process cwd)
  --graph <file>    Graph definition (relative to process cwd; default: bundled sibling graph)
  --focus <value>   Focus ID or canonical path (repeatable)
  --current <node>  Current graph node for route preview (default: omitted)
  --signal <signal> Caller supplied signal (repeatable)
  --out <file.html> Output path relative to --cwd (default: ${DEFAULT_OUTPUT})
  --force           Replace an existing regular HTML output
  --help            Show this help without reading or writing files`;

export async function runDashboard(argv: string[]): Promise<void> {
  const args = parseDashboardArgs(argv, process.cwd());
  if (args.help) {
    console.log(usage);
    return;
  }
  let cwdStat: fs.Stats;
  try {
    cwdStat = fs.statSync(args.cwd);
  } catch {
    throw new Error(`Dashboard cwd does not exist: ${args.cwd}`);
  }
  if (!cwdStat.isDirectory()) throw new Error(`Dashboard cwd is not a directory: ${args.cwd}`);
  const graphPath = resolveGraphPath(args.graph, args.cwd);
  const snapshot = await collectDashboard({
    cwd: args.cwd,
    graphPath,
    focus: args.focus,
    current: args.current,
    signals: args.signals,
  });
  const html = renderDashboard(snapshot);
  const output = writeDashboard(args.cwd, args.out, html, args.force);
  console.log(`Dashboard written: ${output}`);
}
