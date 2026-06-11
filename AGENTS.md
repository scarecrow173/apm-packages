# AGENTS.md

This file gives practical guidance for agents working in the repository root.
If a deeper directory contains its own `AGENTS.md`, that file takes precedence
for files under that subtree.

## 1. Scope

- Paths in this file are repository-root-relative unless a command block says otherwise.
- This repository is a monorepo-style index for multiple APM packages.
- Package manifests and distributed assets live under `packages/<name>/`.
- Build workspaces, source code, and tests may live under `scripts/<name>/`.
- Root-level files such as `apm.yml`, `README.md`, `README.ja.md`, and shared
  repo configuration apply to the whole repository.

## 2. Documentation Synchronization

- When a document has a localized sibling, keep the two versions synchronized
  in meaning and structure.
- This applies to pairs such as:
  - `*.md` and `*.ja.md`
  - English and Japanese package READMEs
  - English and Japanese skill references, templates, and specs
- If you change substantive content in one language, update the other language
  in the same change when possible.
- Do not leave localized docs partially updated if the source document changed;
  match added, removed, and reordered sections where practical.
- If a localized version lags intentionally, call that out explicitly in your
  summary so the mismatch is visible.

## 3. Change Workflow

- Read existing docs and package guidance before editing.
- Prefer the smallest change that keeps behavior and documentation aligned.
- When editing package code in `scripts/<name>/`, also update the distributed
  docs under `packages/<name>/.apm/**` when the user-facing behavior changes.
- Run the relevant validation or tests before claiming completion.

## 4. Ignore / Housekeeping

- Keep generated caches and local working directories out of version control.
- Add new transient artifacts to `.gitignore` when they appear repeatedly.
- Avoid committing workspace-only cache directories such as `.pnpm-store/`.
