"use strict";

const os = require("node:os");
const path = require("node:path");

/**
 * Expand ${VAR} and ${VAR:-default} patterns from process.env.
 * Unknown variables without defaults resolve to empty string.
 */
function expandEnvVars(s: string): string {
  return s.replace(/\$\{([^}]+)\}/g, (_match: string, expr: string) => {
    const sepIdx = expr.indexOf(":-");
    if (sepIdx !== -1) {
      const varName = expr.slice(0, sepIdx);
      const defaultVal = expr.slice(sepIdx + 2);
      return process.env[varName] || defaultVal;
    }
    return process.env[expr] || "";
  });
}

/**
 * Expand ~ prefix to os.homedir().
 */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Full expansion pipeline: ${VAR:-default} → ~ → path.resolve against cwd.
 */
function resolvePath(raw: string, cwd: string): string {
  const expanded = expandHome(expandEnvVars(raw));
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(cwd, expanded);
}

module.exports = { expandEnvVars, expandHome, resolvePath };
