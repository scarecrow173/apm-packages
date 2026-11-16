export type TokenClass =
  | "supported"            // maps to a real Devin tool/param
  | "alternative"          // mapped to a documented workaround
  | "skip"                 // intentionally not performed; must be said aloud
  | "error"                // required by the workflow but impossible on Devin — stop, don't pretend
  | "unavailable-external" // external skill not installable on Devin (cursor-team-kit)
  | "devin-only";          // our own overlay additions — never flagged

export interface VocabEntry {
  pattern: RegExp;   // matched case-insensitively per line
  label: string;     // stable identifier asserted by devin.md contract test
  cls: TokenClass;
  note: string;      // one-line rationale surfaced in audit output
}

export const VOCABULARY: VocabEntry[] = [
  // --- Tool names (upstream skill bodies use Cursor names) ---
  { pattern: /\bTask\b(?!\s*force)/i, label: "tool:Task", cls: "supported", note: "→ run_subagent" },
  { pattern: /AskQuestion|AskUserQuestion/i, label: "tool:AskQuestion", cls: "supported", note: "→ ask_user_question (parent only)" },
  { pattern: /TodoWrite/i, label: "tool:TodoWrite", cls: "supported", note: "→ todo_write" },
  { pattern: /subagent_type/i, label: "field:subagent_type", cls: "supported", note: "→ run_subagent profile" },
  { pattern: /generalPurpose/i, label: "value:generalPurpose", cls: "supported", note: "→ subagent_general" },
  { pattern: /readonly/i, label: "field:readonly", cls: "supported", note: "true→subagent_explore, false→subagent_general" },
  { pattern: /run_in_background/i, label: "field:run_in_background", cls: "supported", note: "→ is_background" },
  { pattern: /\bresume\b/i, label: "field:resume", cls: "supported", note: "→ run_subagent resume param" },
  { pattern: /file_attachments/i, label: "field:file_attachments", cls: "alternative", note: "list paths inline in task brief" },
  { pattern: /environment:\s*["']?cloud/i, label: "field:environment:cloud", cls: "error", note: "no Devin cloud subagent for local plugins" },
  { pattern: /environment:\s*["']?local/i, label: "field:environment:local", cls: "supported", note: "omit — default" },
  { pattern: /cloud_base_branch/i, label: "field:cloud_base_branch", cls: "alternative", note: "instruct worker to check out branch" },
  // --- Cursor-only features ---
  { pattern: /Automations?\b|update_state|webhook|routine wakeup/i, label: "feature:automations", cls: "skip", note: "Cursor-only; state it and skip" },
  { pattern: /Bugbot/i, label: "feature:bugbot", cls: "alternative", note: "forge-cmd triage when check exists; skip setup/wait" },
  { pattern: /SendToUser/i, label: "feature:sendtouser", cls: "error", note: "secrets must not transit the agent — refuse" },
  { pattern: /cloud (agent|VM|dashboard|machine)|environment:\s*"cloud"/i, label: "feature:cloud-agent", cls: "error", note: "no equivalent; error when mandatory, skip when optional" },
  // --- External skills (cursor-team-kit — not Devin-installable) ---
  { pattern: /\bdeslop\b/i, label: "extskill:deslop", cls: "unavailable-external", note: "cursor-team-kit; fallback = plain-words pass" },
  { pattern: /control-cli/i, label: "extskill:control-cli", cls: "unavailable-external", note: "cursor-team-kit; fallback = user-driven or exec verification" },
  { pattern: /control-ui/i, label: "extskill:control-ui", cls: "unavailable-external", note: "cursor-team-kit; fallback = user-driven verification" },
  // --- Paths/settings ---
  { pattern: /~?\.?\/\.cursor\/|~\/\.cursor/i, label: "path:.cursor", cls: "alternative", note: "map to Devin equivalents per paths table" },
  { pattern: /\.cursor-plugin/i, label: "path:.cursor-plugin", cls: "alternative", note: "→ .devin-plugin/plugin.json" },
  { pattern: /~\/\.claude|\.claude-plugin|CLAUDE\.md|AskUserQuestion|isolation:\s*"worktree"|pstack-models\.md/i, label: "devin-only:claude-adapter", cls: "devin-only", note: "claude-code.md adapter content — not ours to adapt" },
  // --- Added from real-tree audit (upstream usages the seed missed) ---
  { pattern: /\bGrep\b/i, label: "tool:Grep", cls: "supported", note: "→ grep (docs/harness/claude-code.md:13, skills/reflect/references/*-reviewer.md)" },
  { pattern: /\bGlob\b/i, label: "tool:Glob", cls: "supported", note: "→ find_file_by_name (docs/harness/claude-code.md:13)" },
  { pattern: /\bBash\b/i, label: "tool:Bash", cls: "supported", note: "→ exec (docs/harness/claude-code.md:13,21)" },
  { pattern: /\bShell\b/, label: "tool:Shell", cls: "supported", note: "→ exec (skills/reflect/references/*-reviewer.md 'Shell, Grep, MCP')" },
  { pattern: /`Read`/, label: "tool:Read", cls: "supported", note: "→ read (claude-code.md:12, reflect reviewers transcript checks)" },
  { pattern: /`Agent`/, label: "tool:Agent", cls: "devin-only", note: "Claude-side tool name in claude-code.md — adapter target, not ours" },
  { pattern: /`Skill`/, label: "tool:Skill", cls: "devin-only", note: "Claude-side tool name in claude-code.md — adapter target, not ours" },
  { pattern: /["'`]general-purpose["'`]/, label: "value:general-purpose", cls: "devin-only", note: "Claude subagent_type value in claude-code.md — not Devin-facing" },
  { pattern: /["'`]Explore["'`]/, label: "value:Explore", cls: "devin-only", note: "Claude subagent_type value in claude-code.md — not Devin-facing" },
  { pattern: /\bis_background\b/i, label: "field:is_background", cls: "alternative", note: "agents/poteto-agent.md frontmatter — not a Devin profile field; overwrite moves it to run_subagent param" },
  { pattern: /\bMCPs?\b/i, label: "feature:mcp", cls: "alternative", note: "MCP availability is env-dependent on Devin; parent performs lookups or the step says so" },
  { pattern: /custom modes?/i, label: "feature:custom-mode", cls: "skip", note: "Cursor-only feature (README.md:106, docs/guide/01-setup.md)" },
  { pattern: /\/loop\b/i, label: "feature:loop", cls: "skip", note: "Cursor /loop command (README.md:108, poteto-help/references/prompting.md)" },
  { pattern: /\/plugin\s+(marketplace|install|update)|claude plugin update/i, label: "feature:plugin-install", cls: "alternative", note: "Cursor/Claude plugin CLI — Devin install path differs (README.md:24-28)" },
  { pattern: /api2\.cursor\.sh/i, label: "feature:cursor-api", cls: "skip", note: "Cursor automations backend endpoint (claude-code.md:64, make-bot-ui/SKILL.md:39)" },
  { pattern: /\b\/?pstack:/i, label: "name:pstack-prefix", cls: "supported", note: "same /pstack:<name> and pstack:<agent> namespacing on Devin" },
  { pattern: /\bclaude-(?:opus|sonnet|haiku|fable)[\w*-]*|\bclaude-\*/i, label: "value:claude-slug", cls: "supported", note: "→ model: on the spawning profile, or inherit-parent" },
  { pattern: /\bgemini-[\w*-]+/i, label: "value:gemini-slug", cls: "alternative", note: "non-model slug → omit model → session model; say so" },
  { pattern: /inherit-parent/i, label: "value:inherit-parent", cls: "supported", note: "→ omit model → parent/session model" },
  { pattern: /\bAGENTS\.md\b/i, label: "path:agents-md", cls: "supported", note: "generic instructions file — Devin reads AGENTS.md natively" },
];
