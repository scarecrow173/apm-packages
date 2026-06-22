"use strict";

import type { SkillReferenceInferenceDocument, SkillScanListDocument } from "./types";
import { InferOpSchema, type InferOp } from "./schemas/infer_ops";

function defaultExecutionPolicy() {
  return {
    strictness: "flexible",
    sequence_required: false,
    allow_step_reordering: true,
    allow_partial_application: true,
  } as const;
}

function buildInitDocument(scanList: SkillScanListDocument): SkillReferenceInferenceDocument {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    inference_source: "agent",
    skills: [...scanList.skills]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({
        name: skill.name,
        review_status: "pending",
        provides: [],
        uses: [],
        execution_policy: defaultExecutionPolicy(),
        tags: [],
      })),
  };
}

function mergeInitWithExisting(
  initDoc: SkillReferenceInferenceDocument,
  existingDoc: SkillReferenceInferenceDocument,
): SkillReferenceInferenceDocument {
  const existingByName = new Map(existingDoc.skills.map((skill) => [skill.name, skill]));
  const merged = initDoc.skills.map((skill) => existingByName.get(skill.name) ?? skill);

  return {
    ...initDoc,
    skills: merged,
  };
}

function parseOpsJsonl(content: string): InferOp[] {
  return content
    .split(/\r?\n/)
    .map((line, i) => ({ line, lineNo: i + 1 }))
    .filter((x) => x.line.trim().length > 0)
    .map(({ line, lineNo }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        throw new Error(`Invalid JSONL at line ${lineNo}: ${(e as Error).message}`);
      }

      const validated = InferOpSchema.safeParse(parsed);
      if (!validated.success) {
        const details = validated.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        throw new Error(`Invalid operation at line ${lineNo}: ${details}`);
      }

      return validated.data;
    });
}

function upsertSkill(doc: SkillReferenceInferenceDocument, name: string, skillSpec: any): SkillReferenceInferenceDocument {
  const next = JSON.parse(JSON.stringify(doc)) as SkillReferenceInferenceDocument;
  const index = next.skills.findIndex((skill) => skill.name === name);
  const normalized = {
    review_status: skillSpec.review_status ?? "pending",
    provides: [],
    uses: [],
    tags: [],
    ...skillSpec,
    name,
  };

  if (index >= 0) next.skills[index] = normalized;
  else next.skills.push(normalized);

  next.skills.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

function deleteSkill(doc: SkillReferenceInferenceDocument, name: string): SkillReferenceInferenceDocument {
  const next = JSON.parse(JSON.stringify(doc)) as SkillReferenceInferenceDocument;
  const before = next.skills.length;
  next.skills = next.skills.filter((skill) => skill.name !== name);

  if (next.skills.length === before) {
    throw new Error(`Skill not found: ${name}`);
  }

  return next;
}

function applyOps(baseDoc: SkillReferenceInferenceDocument, ops: InferOp[]): SkillReferenceInferenceDocument {
  let next = JSON.parse(JSON.stringify(baseDoc)) as SkillReferenceInferenceDocument;

  for (const op of ops) {
    if (op.op === "upsert-skill") {
      next = upsertSkill(next, op.name, op.skill);
      continue;
    }

    if (op.op === "delete-skill") {
      next = deleteSkill(next, op.name);
      continue;
    }

    const target = next.skills.find((skill) => skill.name === op.name);
    if (!target) {
      throw new Error(`Skill not found: ${op.name}`);
    }

    if (op.op === "add-provides") {
      target.provides.push(...op.provides);
    } else if (op.op === "add-uses") {
      target.uses.push(...op.uses);
    } else if (op.op === "remove-provides") {
      const removeSet = new Set(op.capabilities);
      target.provides = target.provides.filter((item) => !removeSet.has(item.capability));
    } else if (op.op === "remove-uses") {
      const removeSet = new Set(op.capabilities);
      target.uses = target.uses.filter((item) => !removeSet.has(item.capability));
    } else if (op.op === "add-tags") {
      const merged = new Set([...target.tags, ...op.tags]);
      target.tags = [...merged];
    } else if (op.op === "set-tags") {
      target.tags = [...op.tags];
    }
  }

  return next;
}

module.exports = {
  buildInitDocument,
  mergeInitWithExisting,
  parseOpsJsonl,
  applyOps,
  upsertSkill,
  deleteSkill,
};
