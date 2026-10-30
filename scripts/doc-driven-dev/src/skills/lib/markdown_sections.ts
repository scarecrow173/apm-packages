"use strict";

/**
 * Shared `##`-section parsing for machine-read Markdown contracts.
 *
 * Section headings are a schema vocabulary like front-matter keys: every
 * shipped template heading has one canonical English name, and localized
 * templates emit the fixed aliases declared in SECTION_HEADING_ALIASES.
 * Parsers always match the canonical name first, then aliases in declared
 * order, so a document written against a localized template reads exactly
 * like its English counterpart while unrecognized headings still miss
 * (fail-closed: `scope-undeclared`, zero counts, missing-section findings).
 *
 * Ambiguity rule: when a document contains both the canonical heading and an
 * alias (or several aliases), the canonical heading wins, then the earliest
 * alias in declared order — deterministic, and identical to the pre-alias
 * behavior for English documents.
 */

/**
 * Canonical English heading -> accepted localized aliases.
 *
 * Derived from the shipped `.ja.md` templates under each skill's
 * `assets/templates/` directory; every localized heading those templates
 * emit must appear here (the template drift guard in
 * `tests/doc-driven-dev-markdown-sections.test.ts` fails otherwise).
 * Canonicals that templates keep in English — for example
 * `Deferred Design Concerns` and `Design Inputs` — need no entry.
 */
const SECTION_HEADING_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // task-doc
  "Work": ["作業"],
  "Classification": ["分類"],
  "Upstream Documents": ["上流文書"],
  "Dependencies": ["依存関係"],
  "Affected Files": ["影響ファイル"],
  "Done When": ["完了条件"],
  "Verification": ["検証"],
  // spec-doc
  "What Should Be Built": ["何を作るべきか"],
  "Why Now": ["なぜ今必要か"],
  "Users and Value": ["利用者と価値"],
  "Scope": ["範囲", "スコープ"],
  "In Scope": ["範囲内"],
  "Out of Scope": ["範囲外"],
  "Requirements": ["要件"],
  "Acceptance Criteria": ["受け入れ基準"],
  "Sources and Relations": ["出典と Relations", "出典・Relations"],
  // discovery-doc
  "Exploration Goal": ["探索目的"],
  "Key Issues and Assumptions": ["論点・前提"],
  "Alternatives and Comparison": ["代替案と比較"],
  "Tentative Conclusions and Hypotheses": ["暫定結論・仮説"],
  "Open Questions": ["未解決の論点", "未解決事項"],
  "Promotion Candidates": ["昇華先候補"],
  // idea-doc
  "Summary": ["要約"],
  "Problem and Motivation": ["課題と動機"],
  "Expected Value": ["想定価値"],
  "Next Action": ["次のアクション"],
  // plan-doc
  "Goal": ["目的"],
  "File Map": ["ファイル表"],
  "Implementation Sequence": ["実装順序"],
  "Dependencies and Risks": ["依存関係とリスク"],
  "Task Breakdown": ["Task 分解"],
  "Open Questions / Gaps": ["未解決事項 / gap"],
  "Self-Review": ["自己レビュー"],
  "Implementation Handoff": ["実装ハンドオフ"],
  "Review Handoff": ["レビュー用ハンドオフ"],
  // adr-doc (MADR 4 templates)
  "Context and Problem Statement": ["背景と問題"],
  "Decision Drivers": ["決定ドライバー"],
  "Considered Options": ["検討した選択肢"],
  "Decision Outcome": ["決定内容"],
  "Consequences": ["影響"],
  "Confirmation": ["確認方法"],
  "Implementation Plan": ["実装計画"],
  "Pros and Cons of the Options": ["選択肢の利点と欠点"],
  "Option": ["選択肢"],
  "Option 1": ["選択肢 1"],
  "Option 2": ["選択肢 2"],
  "More Information": ["追加情報"],
  // implementation-flow profile
  "Available Skills": ["利用可能なスキル"],
  "Category Assignments": ["カテゴリ割り当て"],
};

/**
 * The heading spellings a parser accepts for `canonicalHeading`: the
 * canonical name first, then its declared aliases in order. Resolution order
 * is also match precedence — see the module's ambiguity rule.
 */
function headingNames(canonicalHeading: string): string[] {
  return [canonicalHeading, ...(SECTION_HEADING_ALIASES[canonicalHeading] ?? [])];
}

function headingPattern(heading: string): RegExp {
  return new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
}

/**
 * Body of the `##` section named by `canonicalHeading` or one of its
 * declared aliases — from the line after the heading to the next `##`
 * heading or end of body. Empty string when no accepted heading is present.
 * Canonical match wins over aliases; alias order is the declared order.
 */
function sectionBody(body: string, canonicalHeading: string): string {
  const lines = body.split(/\r?\n/);
  for (const name of headingNames(canonicalHeading)) {
    const pattern = headingPattern(name);
    const start = lines.findIndex((line) => pattern.test(line.trimEnd()));
    if (start < 0) continue;
    const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
    const section = endOffset < 0 ? lines.slice(start + 1) : lines.slice(start + 1, start + 1 + endOffset);
    return section.join("\n").trim();
  }
  return "";
}

/** True when the body carries a `##` heading accepted for `canonicalHeading`. */
function hasSection(body: string, canonicalHeading: string): boolean {
  const lines = body.split(/\r?\n/);
  return headingNames(canonicalHeading).some((name) => {
    const pattern = headingPattern(name);
    return lines.some((line) => pattern.test(line.trimEnd()));
  });
}

/**
 * Count ATX headings at exactly `depth` inside an extracted section body —
 * for example `###` option entries under `## Considered Options`. Heading
 * text is free-form here, so the count is locale-agnostic by construction.
 */
function subHeadingCount(section: string, depth = 3): number {
  return section.match(new RegExp(`^#{${depth}}\\s+.+$`, "gm"))?.length ?? 0;
}

export {
  SECTION_HEADING_ALIASES,
  hasSection,
  headingNames,
  sectionBody,
  subHeadingCount,
};
