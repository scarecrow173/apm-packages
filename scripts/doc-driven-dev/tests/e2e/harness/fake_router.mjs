/**
 * Deliberately stale router for the v2-refusal cases: reads `--cwd` from the
 * caller's argv and prints `<cwd>/fake-route.json` verbatim. The payload is
 * fixture data — a v2-schema or proofPath-carrying route the runner must
 * refuse before any dispatch. A missing/unreadable payload exits nonzero,
 * exactly like a router that cannot honor the invocation.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const cwdIndex = argv.indexOf("--cwd");
if (cwdIndex === -1 || argv[cwdIndex + 1] === undefined) {
  console.error("fake_router: --cwd missing");
  process.exit(1);
}
const payload = path.join(argv[cwdIndex + 1], "fake-route.json");
try {
  process.stdout.write(fs.readFileSync(payload, "utf8"));
} catch (error) {
  console.error(`fake_router: ${payload}: ${error.message}`);
  process.exit(1);
}
