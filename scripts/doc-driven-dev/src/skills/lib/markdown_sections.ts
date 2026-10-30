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
 *
 * Fence rule: fenced code blocks (``` / ~~~) are stripped before the line
 * scan. A `##` heading or `Label:` bullet inside a fence is documentation,
 * not a declaration, and must never satisfy a section or label check; an
 * unclosed fence drops the remainder of the body. The AST-based helpers in
 * `adr_utils.ts` are fence-aware through the Markdown parser itself and do
 * not use this line-scan path.
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
  "Evidence": ["エビデンス"],
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
 * Canonical English `Label:` body prefix -> accepted localized spellings.
 *
 * Section bodies carry fixed bullet labels that are part of the template
 * vocabulary just like headings — the MADR Implementation Plan emits
 * `* Affected paths:` in English and `* 影響するパス:` in the shipped
 * `.ja.md` templates. Same matching rule as SECTION_HEADING_ALIASES: the
 * canonical spelling is accepted first, then its declared aliases.
 */
const SECTION_BODY_LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // adr-doc (MADR 4 templates): `* Label:` bullets under Implementation Plan
  "Affected paths": ["影響するパス"],
  "Constraints": ["制約"],
  "Patterns to follow": ["従うパターン"],
};

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Remove fenced code blocks (``` / ~~~) before heading and label extraction:
 * a `##` heading or bullet inside a fence is documentation, not a
 * declaration, and must never verify as real section content. An unclosed
 * fence drops the remainder of the body — its content is code, not sections.
 */
function stripFencedBlocks(body: string): string {
  const kept: string[] = [];
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of body.split(/\r?\n/)) {
    if (fenceChar === "") {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        const run = open[1];
        const info = line.slice(line.indexOf(run) + run.length);
        // CommonMark: a backtick fence's info string may not contain a
        // backtick and a tilde fence's may not contain a tilde — those lines
        // are ordinary text, not fence openers.
        if (info.includes(run[0])) {
          kept.push(line);
          continue;
        }
        fenceChar = run[0];
        fenceLen = run.length;
        continue;
      }
      kept.push(line);
      continue;
    }
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
      fenceChar = "";
      fenceLen = 0;
    }
    // Fenced content lines (and the closer) are dropped.
  }
  return kept.join("\n");
}

/**
 * The heading spellings a parser accepts for `canonicalHeading`: the
 * canonical name first, then its declared aliases in order. Resolution order
 * is also match precedence — see the module's ambiguity rule.
 */
function headingNames(canonicalHeading: string): string[] {
  return [canonicalHeading, ...(SECTION_HEADING_ALIASES[canonicalHeading] ?? [])];
}

/**
 * The `Label:` spellings a check accepts for `canonicalLabel`: the canonical
 * name first, then its declared localized aliases — same convention as
 * `headingNames`.
 */
function bodyLabelNames(canonicalLabel: string): string[] {
  return [canonicalLabel, ...(SECTION_BODY_LABEL_ALIASES[canonicalLabel] ?? [])];
}

/**
 * Case-insensitive `Label:` matcher over one or more canonical body labels:
 * any accepted spelling (canonical or localized alias) followed by a colon
 * anywhere in the body text satisfies the pattern. Pass several canonicals
 * for either-of checks (for example `Patterns to follow` or `Constraints`).
 */
function bodyLabelPattern(...canonicalLabels: string[]): RegExp {
  const spellings = canonicalLabels.flatMap(bodyLabelNames);
  const alternation = spellings.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?:${alternation}):`, "i");
}

function headingPattern(heading: string): RegExp {
  return new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
}

/**
 * Body of the `##` section named by `canonicalHeading` or one of its
 * declared aliases — from the line after the heading to the next `##`
 * heading or end of body. Empty string when no accepted heading is present.
 * Canonical match wins over aliases; alias order is the declared order.
 * Fenced code blocks are stripped first (module fence rule), so the returned
 * section text never contains fenced content.
 */
function sectionBody(body: string, canonicalHeading: string): string {
  const lines = stripFencedBlocks(body).split(/\r?\n/);
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

/**
 * True when the body carries a `##` heading accepted for `canonicalHeading`.
 * Fenced code blocks are stripped first — a `##` line inside a fence is a
 * code sample, not a section.
 */
function hasSection(body: string, canonicalHeading: string): boolean {
  const lines = stripFencedBlocks(body).split(/\r?\n/);
  return headingNames(canonicalHeading).some((name) => {
    const pattern = headingPattern(name);
    return lines.some((line) => pattern.test(line.trimEnd()));
  });
}

/**
 * Count ATX headings at exactly `depth` inside an extracted section body —
 * for example `###` option entries under `## Considered Options`. Heading
 * text is free-form here, so the count is locale-agnostic by construction.
 * Fenced lines are stripped first, matching the other entry points.
 */
function subHeadingCount(section: string, depth = 3): number {
  return stripFencedBlocks(section).match(new RegExp(`^#{${depth}}\\s+.+$`, "gm"))?.length ?? 0;
}

export {
  SECTION_BODY_LABEL_ALIASES,
  SECTION_HEADING_ALIASES,
  bodyLabelNames,
  bodyLabelPattern,
  hasSection,
  headingNames,
  sectionBody,
  stripFencedBlocks,
  subHeadingCount,
};
