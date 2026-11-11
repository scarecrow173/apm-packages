"use strict";

import { GENERATED_INDEX_MARKER, GENERATED_SETTLED_MARKER } from "./doc_suite_utils";

// Shared-4-column managed-index layout parser (Issue #189). Classifies every
// table row by its physical tier — active (before any `##` heading), settled
// (under `## Settled`), or unknown (under any other `##` heading) — so lint
// audits placement and structure, not only row content. impl-4col/exp-1col
// owner formats keep their own parsers in impl_doc_utils; this module covers
// only the shared `| ID | Title | Status | File |` contract.

type IndexRowTier = "active" | "settled" | "unknown";

type IndexRow = {
  id: string;
  title: string;
  status: string;
  file: string;
};

type TieredIndexRow = {
  row: IndexRow;
  tier: IndexRowTier;
  /** 1-based line inside the index body. */
  line: number;
};

type ManagedIndexLayout = {
  /** The index opted into managed generation (GENERATED_INDEX_MARKER). */
  generated: boolean;
  rows: TieredIndexRow[];
  malformed: { line: number; text: string }[];
  /** `## Settled` headings, marker or not. */
  settledHeadings: number;
  /** `## Settled` headings missing GENERATED_SETTLED_MARKER. */
  unmarkedSettledHeadings: number;
  /** First table run under each unrecognized `##` heading. */
  unknownSectionTables: { line: number; heading: string }[];
  /** Second and later table runs inside a single active/settled section. */
  extraTables: { line: number; tier: "active" | "settled" }[];
};

const HEADING2 = /^##\s+(.*)$/;
const SETTLED_HEADING = /^##\s+Settled\b/i;
const TABLE_LINE = /^\|.*\|$/;
const LIST_ITEM = /^[-*+]\s+/;
const LINK = /\[[^\]]*\]\([^)]*\)/;

function unescapeCell(value: string): string {
  return value.replace(/\\\|/g, "|").trim();
}

function parseManagedIndexLayout(content: string): ManagedIndexLayout {
  const layout: ManagedIndexLayout = {
    generated: content.includes(GENERATED_INDEX_MARKER),
    rows: [],
    malformed: [],
    settledHeadings: 0,
    unmarkedSettledHeadings: 0,
    unknownSectionTables: [],
    extraTables: [],
  };
  let tier: IndexRowTier = "active";
  let sectionHeading = "";
  let sectionTables = 0;
  let inTable = false;
  content.split(/\r?\n/).forEach((line, offset) => {
    const trimmed = line.trim();
    const heading = HEADING2.exec(trimmed);
    if (heading) {
      if (SETTLED_HEADING.test(trimmed)) {
        tier = "settled";
        layout.settledHeadings += 1;
        if (!trimmed.includes(GENERATED_SETTLED_MARKER)) layout.unmarkedSettledHeadings += 1;
      } else {
        tier = "unknown";
      }
      sectionHeading = heading[1].trim();
      sectionTables = 0;
      inTable = false;
      return;
    }
    if (TABLE_LINE.test(trimmed)) {
      if (!inTable) {
        inTable = true;
        sectionTables += 1;
        if (tier === "unknown" && sectionTables === 1) {
          layout.unknownSectionTables.push({ line: offset + 1, heading: sectionHeading });
        }
        if ((tier === "active" || tier === "settled") && sectionTables > 1) {
          layout.extraTables.push({ line: offset + 1, tier });
        }
      }
      const cells = trimmed.slice(1, -1).split(/(?<!\\)\|/).map(unescapeCell);
      if (/^-{3,}/.test(cells[0]) || /^id$/i.test(cells[0])) return;
      if (cells.length < 4) {
        layout.malformed.push({ line: offset + 1, text: trimmed });
        return;
      }
      const fileMatch = /\[([^\]]*)\]\(([^)]*)\)/.exec(cells[3]);
      layout.rows.push({
        tier,
        line: offset + 1,
        row: {
          id: cells[0],
          title: cells[1],
          status: cells[2],
          file: fileMatch ? fileMatch[2].trim() : cells[3],
        },
      });
      return;
    }
    inTable = false;
    if (LIST_ITEM.test(trimmed) && !LINK.test(trimmed)) {
      layout.malformed.push({ line: offset + 1, text: trimmed });
    }
  });
  return layout;
}

export { parseManagedIndexLayout };
export type { IndexRow, IndexRowTier, ManagedIndexLayout, TieredIndexRow };
