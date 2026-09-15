#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/skills/skill-discovery-protocol/scripts/sdp.ts
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"));
var MAX_BUFFER = 10 * 1024 * 1024;
function usage() {
  return `Usage: sdp <command> [options]

Commands:
  scan        Generate skill scan list
  infer       Generate skill reference inference from scan list
  profile     Generate skill catalog and flow profile
  validate    Validate artifacts or adapter
  query       Query flow profile data

Run 'sdp <command> --help' for command-specific usage.`;
}
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  const remaining = args.slice(1);
  const scriptDir = __dirname;
  const validCommands = ["scan", "infer", "profile", "validate", "query"];
  if (!validCommands.includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const scriptPath = import_node_path.default.join(scriptDir, `${command}.js`);
  const result = (0, import_node_child_process.spawnSync)(process.execPath, [scriptPath, ...remaining], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    if (result.error.code === "ENOBUFS") {
      process.stderr.write(`sdp ${command} output exceeded maxBuffer (${MAX_BUFFER} bytes).
`);
    } else {
      process.stderr.write(`Failed to run sdp ${command}: ${result.error.message}
`);
    }
    process.exitCode = 1;
    return;
  }
  if (result.signal) {
    process.stderr.write(`sdp ${command} terminated by signal ${result.signal}.
`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}
main();
