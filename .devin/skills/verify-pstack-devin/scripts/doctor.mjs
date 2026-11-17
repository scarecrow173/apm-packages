#!/usr/bin/env node
// doctor.mjs — read-only "is this instance worth driving?" check for the
// verify-pstack-devin skill. Run from the repository root:
//
//   mise exec -- node .devin/skills/verify-pstack-devin/scripts/doctor.mjs
//
// Exit 0 = worth driving. Exit 1 = a named prerequisite failed; the
// message names the SKILL.md launch step that fixes it. Every check is
// read-only: file existence, JSON/YAML reads, and a porcelain status.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ → verify-pstack-devin/ → skills/ → .devin/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const TSX_PKG = "scripts/pstack-devin/node_modules/tsx/package.json";
const PROVENANCE = "packages/pstack-devin/devin-plugin/provenance.json";
const UPSTREAM_YML = "packages/pstack-devin/upstream.yml";
const FIXTURE = "scripts/pstack-devin/fixtures/smoke-repo";
const STATUS_SPEC = "packages/pstack-devin/";

let failures = 0;
const ok = (msg) => console.log(`[ok] ${msg}`);
const warn = (msg) => console.log(`[warn] ${msg}`);
const fail = (msg, fix) => {
  failures += 1;
  console.log(`[fail] ${msg} — ${fix}`);
};

console.log("doctor: pstack-devin verification sanity");

// 1. Toolchain deps installed (launch step 2). tsx is the runner every
//    drive uses, so its package dir is the honest install marker.
if (fs.existsSync(path.join(repoRoot, TSX_PKG))) {
  ok(`tsx installed (${TSX_PKG})`);
} else {
  fail(
    `tsx not installed (${TSX_PKG} missing)`,
    "launch step 2: `mise exec -- pnpm --dir scripts/pstack-devin install`",
  );
}

// 2. Generated tree present — every checker asserts against it.
const provPath = path.join(repoRoot, PROVENANCE);
let provenance = null;
if (fs.existsSync(provPath)) {
  try {
    provenance = JSON.parse(fs.readFileSync(provPath, "utf8"));
    ok(`generated tree present (${PROVENANCE})`);
  } catch (e) {
    fail(
      `${PROVENANCE} is not valid JSON (${e.message})`,
      "rebuild: `mise exec -- pnpm --dir scripts/pstack-devin run build`",
    );
  }
} else {
  fail(
    `generated tree missing (${PROVENANCE})`,
    "launch step 1/2, then `mise exec -- pnpm --dir scripts/pstack-devin run build`",
  );
}

// 3. Provenance upstream.commit equals the upstream.yml pin — the built
//    tree is the one the checkers' contract names.
if (provenance !== null) {
  const ymlPath = path.join(repoRoot, UPSTREAM_YML);
  if (!fs.existsSync(ymlPath)) {
    fail(`${UPSTREAM_YML} missing`, "restore the pin file — it is tracked");
  } else {
    const yml = fs.readFileSync(ymlPath, "utf8");
    const m = /^[ \t]+commit:[ \t]+([0-9a-f]{40})[ \t]*$/m.exec(yml);
    if (m === null) {
      fail(
        `no upstream.commit pin found in ${UPSTREAM_YML}`,
        "restore the pin — never hand-edit it",
      );
    } else {
      const pin = m[1];
      const built = provenance?.upstream?.commit;
      if (built === pin) {
        ok(`provenance upstream.commit == upstream.yml pin (${pin.slice(0, 12)}…)`);
      } else {
        fail(
          `provenance upstream.commit (${built ?? "absent"}) != pin (${pin})`,
          "rebuild: `mise exec -- pnpm --dir scripts/pstack-devin run build`",
        );
      }
    }
  }
}

// 4. Baseline git state for the package — printed, never enforced. A
//    dirty baseline is legal for read-only drives but unsafe for
//    check-generated/apply:update (their feature files say why).
const st = spawnSync(
  "git",
  ["-C", repoRoot, "status", "--porcelain", "--", STATUS_SPEC],
  { encoding: "utf8" },
);
if (st.error || st.status !== 0) {
  warn(
    `git status unavailable: ${st.error?.message ?? st.stderr?.trim() ?? "unknown"}` +
      " — drives cannot diff git state",
  );
} else {
  const lines = st.stdout.trim();
  console.log(`[baseline] git status --porcelain -- ${STATUS_SPEC}`);
  console.log(lines === "" ? "  (clean)" : lines);
}

// 5. Fixture seeded (launch step 3) — warn only; only probe:* drives need it.
if (fs.existsSync(path.join(repoRoot, FIXTURE))) {
  ok(`consumer fixture present (${FIXTURE})`);
} else {
  warn(
    `consumer fixture missing (${FIXTURE}) — only probe:* drives need it; ` +
      "seed with `mise exec -- pnpm --dir scripts/pstack-devin run probe:fixture`",
  );
}

if (failures > 0) {
  console.log(`doctor: ${failures} failed check(s) — not worth driving`);
  process.exit(1);
}
console.log("doctor: ok to drive");
