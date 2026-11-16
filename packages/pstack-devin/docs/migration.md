# Migration — upstream `pstack` ↔ `pstack-devin`

Upstream `cursor/plugins` and this package both ship a Devin plugin named
`pstack`. Only one can be installed at a time — installing the second
collides on the name, and the `/pstack:` skill prefix belongs to
whichever is installed. This guide covers identifying the installed
one, backing up before switching, switching, and rolling back.

Evidence: install/remove/provenance commands and outputs are recorded in
`distribution-verification.md` (§2 source syntax, §3 local path, §4
GitHub path, §5 APM path, §6 name collision); runtime behavior is
recorded in `runtime-verification.md`. Anything not exercised in those
logs says so below — nothing here claims unrecorded behavior.

Scope note: this guide is about the **Devin plugin** only. `apm install`
deploys this package's `.apm/` primitives (today the single
`setup-pstack-devin` skill) and never installs or removes a Devin
plugin — see `distribution-verification.md` §5.

## 1. Identify which `pstack` is installed

```bash
devin plugins list
devin plugins info pstack
```

The `info` provenance fields disambiguate the shared name (recorded in
`distribution-verification.md` §6):

| Field | `pstack-devin` (this package) | Upstream `cursor/plugins` |
| --- | --- | --- |
| `version:` | `0.1.0` | `0.15.42` |
| `source:` | `https://github.com/scarecrow173/apm-packages#packages/pstack-devin/devin-plugin`, or the local path used for `--local` installs | `https://github.com/cursor/plugins#…` |
| skill marker | `/pstack:setup-pstack-devin` present | no `setup-pstack-devin` skill |

If several installed plugins share the name, `devin plugins remove`
accepts a disambiguated `owner/repo` label (per `remove --help`,
recorded in `distribution-verification.md` §6).

## 2. Back up before switching

1. Run `devin plugins list` and `devin plugins info pstack`; keep the
   `version:`/`source:` output — it is the record of what to restore.
2. If `/pstack:setup-pstack` was ever run, check for the files it
   generated outside the plugin tree (locations in §4) and copy them
   aside — a rollback to upstream will not reuse them, and they are
   yours to keep or delete (§4).
3. Plan the switch at a session boundary: finish or discard in-flight
   `devin` sessions first (see §5).

## 3. Switch to `pstack-devin`

1. Remove the current `pstack`, matching the scope it was installed
   with — `devin plugins remove pstack -y` for a personal-plugins
   install, `devin plugins remove pstack --local -y` for a `--local`
   install. The scope pairing is enforced: `remove --local` fails for
   plugins in your personal plugins (`distribution-verification.md`
   §2).
2. Install this distribution:

   ```bash
   # personal plugins scope (syncs toward cloud sessions and other devices)
   devin plugins install scarecrow173/apm-packages#packages/pstack-devin/devin-plugin -y

   # or machine-only, from a local checkout
   devin plugins install /path/to/apm-packages/packages/pstack-devin/devin-plugin --local -y
   ```

3. Start a **new** `devin` session (§5).
4. Confirm: `devin plugins info pstack` reports `version:` `0.1.0`, and
   `/pstack:poteto-help` resolves in the new session — that invocation
   is verified end-to-end in `runtime-verification.md` §2.

## 4. Config files that live outside the plugin

`/pstack:setup-pstack` (the `setup-pstack-devin` skill) writes user
config, not plugin files. The recorded `devin plugins remove` removes
the plugin registration; these files sit outside the plugin's scope, so
plan to keep or delete them yourself after a removal or a switch:

| What | Where |
| --- | --- |
| Model rule | `~/.devin/rules/pstack-models.md` — an always-on rule (`trigger: always_on`) with one `role: slug[, slug…]` line per configured role |
| Model-pinned subagent profiles | `pstack-<slug>.md` and `pstack-<slug>-ro.md` in `agents/` under the Devin config root — `~/.config/devin/agents/` (Linux/macOS); on Windows `%APPDATA%\devin\agents\` |
| Installed plugin tree | `%APPDATA%\devin\cli\plugins\` (Windows; `~/.config/devin/cli/plugins/` per the config-root convention elsewhere) — CLI-managed, never hand-edit |

Generated files carry a `# pstack-generated:` sha256 marker, so a later
`/pstack:setup-pstack` run tells its own output from user edits and only
deletes obsolete `pstack-*.md` profiles via its explicit `--remove`
path. When rolling back to upstream, delete `pstack-models.md` and the
`pstack-*.md` profiles by hand if you do not want them left behind —
they are inert files, but they are this distribution's artifacts.

## 5. New-session note

- Plugin skills, `pstack:*` agent profiles, and `~/.devin/rules/` rules
  are loaded at session start. Verified shape: every probe in
  `runtime-verification.md` ran in a session started **after** the
  `--local` install and resolved `/pstack:*` and the plugin's profiles.
- Not verified: whether a session already running picks up a plugin
  install/removal or a rewritten `pstack-models.md`. The reliable path
  is a new session — after install, after rollback, and after
  `/pstack:setup-pstack` changes model config. The README's model-setup
  section states the same boundary for generated config: a setup
  applies to new sessions; the current one keeps its models.

## 6. Roll back to upstream `pstack`

1. `devin plugins remove pstack -y` (or `--local` — same scope rule as
   §3).
2. Reinstall upstream's plugin. The documented upstream install source
   is `devin plugins install cursor/plugins#harness/pstack/claude-code`
   (see `devin-adapter-decisions.md` §4 — upstream's root `plugin.json`
   is an Agent Plugins manifest). The recorded runs did not exercise an
   upstream install, so treat the form as documented, not verified.
3. Verify provenance before trusting it: `devin plugins info pstack`
   must show `version:` `0.15.42` and a `cursor/plugins` `source:` (§1).
4. Start a new session; upstream's skills return on the same `/pstack:`
   prefix. Regenerate model config through upstream's `setup-pstack`
   rather than reusing this distribution's `~/.devin/rules/pstack-models.md`
   — the Devin rule path is this distribution's mapping.
