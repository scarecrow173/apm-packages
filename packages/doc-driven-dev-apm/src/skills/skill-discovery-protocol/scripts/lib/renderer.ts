"use strict";

const fs = require("node:fs");
const path = require("node:path");

import type { SkillReferenceCatalog, FlowProfile } from "./types";

/**
 * Render JSON with stable sorting and consistent formatting.
 * Returns a string with 2-space indentation and LF newline.
 */
function renderJson(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  // Normalize to LF
  return json.replace(/\r\n/g, "\n") + "\n";
}

/**
 * Write a JSON artifact to disk only if content changed (excluding timestamps).
 * This ensures idempotency: same input → no file diff.
 */
function writeArtifact(filePath: string, data: Record<string, unknown>): boolean {
  const absPath = path.resolve(filePath);
  const newContent = renderJson(data);

  if (fs.existsSync(absPath)) {
    const existing = fs.readFileSync(absPath, "utf8");
    // Compare content without timestamps
    const existingNoTs = stripTimestamps(existing);
    const newNoTs = stripTimestamps(newContent);

    if (existingNoTs === newNoTs) {
      // Content is same, preserve existing file (keeps old timestamps)
      return false;
    }
  }

  // Ensure directory exists
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, newContent, "utf8");
  return true;
}

/**
 * Strip timestamp fields for comparison purposes.
 */
function stripTimestamps(content: string): string {
  return content
    .replace(/"generated_at"\s*:\s*"[^"]*"/g, '"generated_at": ""')
    .replace(/"validated_at"\s*:\s*"[^"]*"/g, '"validated_at": ""');
}

/**
 * Sort catalog arrays for stable output.
 */
function stabilizeCatalog(catalog: SkillReferenceCatalog): SkillReferenceCatalog {
  const result = { ...catalog };
  result.skills = [...result.skills].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of result.skills) {
    skill.provides = [...skill.provides].sort((a, b) => a.capability.localeCompare(b.capability));
    skill.uses = [...skill.uses].sort((a, b) => a.capability.localeCompare(b.capability));
  }
  result.slots = [...result.slots].sort((a, b) => a.slot_id.localeCompare(b.slot_id));
  return result;
}

/**
 * Sort profile arrays for stable output.
 * flow_stack.slots preserve declaration order (already ordered by adapter).
 */
function stabilizeProfile(profile: FlowProfile): FlowProfile {
  const result = { ...profile };

  // Sort categories by id
  result.classification = {
    ...result.classification,
    categories: [...result.classification.categories].sort((a, b) => a.id.localeCompare(b.id)),
    unmatched_skills: [...result.classification.unmatched_skills].sort(),
  };

  // Sort category skills
  for (const cat of result.classification.categories) {
    cat.skills = [...cat.skills].sort();
  }

  // Sort resolved_invocations by source_skill → slot → capability
  result.resolved_invocations = [...result.resolved_invocations].sort((a, b) => {
    const cmp1 = a.source_skill.localeCompare(b.source_skill);
    if (cmp1 !== 0) return cmp1;
    const cmp2 = a.slot.localeCompare(b.slot);
    if (cmp2 !== 0) return cmp2;
    return a.capability.localeCompare(b.capability);
  });

  // flow_stack.slots: preserve adapter declaration order (don't sort)

  return result;
}

module.exports = { renderJson, writeArtifact, stripTimestamps, stabilizeCatalog, stabilizeProfile };
