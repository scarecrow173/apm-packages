"use strict";

import type { AdapterConfig, ScannedSkill, Category } from "./types";

type ClassificationResult = {
  categories: Category[];
  unmatched_skills: string[];
};

function classifySkills(skills: ScannedSkill[], adapter: AdapterConfig): ClassificationResult {
  const taxonomy = adapter.classification.taxonomy;
  const unmatched = adapter.classification.unmatched;

  const categoryMap = new Map<string, Set<string>>();
  for (const entry of taxonomy) {
    categoryMap.set(entry.id, new Set());
  }

  const matchedSkills = new Set<string>();

  for (const skill of skills) {
    let matched = false;
    for (const entry of taxonomy) {
      if (matchesCategory(skill, entry.match)) {
        categoryMap.get(entry.id)!.add(skill.name);
        matchedSkills.add(skill.name);
        matched = true;
      }
    }
    if (!matched && unmatched.action === "assign" && unmatched.category) {
      const cat = categoryMap.get(unmatched.category);
      if (cat) {
        cat.add(skill.name);
        matchedSkills.add(skill.name);
      }
    }
  }

  const categories: Category[] = taxonomy
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      skills: [...(categoryMap.get(entry.id) || [])].sort(),
    }))
    .filter((c) => c.skills.length > 0);

  // Sort categories by id
  categories.sort((a, b) => a.id.localeCompare(b.id));

  const unmatchedSkillNames = skills
    .filter((s) => !matchedSkills.has(s.name))
    .map((s) => s.name)
    .sort();

  return { categories, unmatched_skills: unmatchedSkillNames };
}

function matchesCategory(
  skill: ScannedSkill,
  match: { capabilities: string[]; tags: string[]; description_patterns: string[] },
): boolean {
  // Match by capabilities: skill.provides intersects match.capabilities
  if (match.capabilities.length > 0) {
    const skillCaps = new Set(skill.provides.map((p) => p.capability));
    if (match.capabilities.some((c) => skillCaps.has(c))) return true;
  }

  // Match by tags: skill.tags intersects match.tags
  if (match.tags.length > 0) {
    const skillTags = new Set(skill.tags);
    if (match.tags.some((t) => skillTags.has(t))) return true;
  }

  // Match by description_patterns: regex against skill.description
  if (match.description_patterns.length > 0) {
    for (const pattern of match.description_patterns) {
      try {
        // Reject patterns longer than 200 chars or with known ReDoS constructs
        if (pattern.length > 200) continue;
        if (/([+*])\)\1|\(\?[^)]*[+*]/.test(pattern)) continue;
        if (new RegExp(pattern, "i").test(skill.description)) return true;
      } catch {
        // Invalid regex, skip
      }
    }
  }

  return false;
}

module.exports = { classifySkills };
