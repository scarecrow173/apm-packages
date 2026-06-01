#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function usage(): string {
  return `Usage: sdp <command> [options]

Commands:
  generate    Generate skill catalog and flow profile
  infer       Generate skill reference inference from scan list
  validate    Validate artifacts or adapter
  query       Query flow profile data

Run 'sdp <command> --help' for command-specific usage.`;
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }

  const remaining = args.slice(1);
  const scriptDir = __dirname;
  const validCommands = ["generate", "infer", "validate", "query"];

  if (!validCommands.includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const scriptPath = path.join(scriptDir, `${command}.js`);
  const result = spawnSync(process.execPath, [scriptPath, ...remaining], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  process.exitCode = result.status ?? 1;
}

main();
