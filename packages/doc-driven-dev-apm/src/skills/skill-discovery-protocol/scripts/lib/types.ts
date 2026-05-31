"use strict";

// ─── Adapter Types ───

export type AdapterScope = {
  enabled: boolean;
  roots: string[];
};

export type AdapterSlot = {
  slot_id: string;
  slot_type: "exclusive" | "layerable";
  activation: "always" | "conditional" | "on_demand" | "gate";
  default?: {
    skill?: string;
    reason?: string;
  };
};

export type TaxonomyEntry = {
  id: string;
  label: string;
  description: string;
  match: {
    capabilities: string[];
    tags: string[];
    description_patterns: string[];
  };
};

export type AdapterConfig = {
  schema_version: string;
  adapter_id: string;
  protocol: { name: string; min_version: string };
  enabled?: boolean;
  extends?: string[];
  metadata?: { description?: string; owner?: string };
  scan: {
    scopes: Record<string, AdapterScope>;
  };
  profile: { title?: string };
  flow_stack: { slots: AdapterSlot[] };
  classification: {
    unmatched: { action: string; category?: string; severity: string };
    taxonomy: TaxonomyEntry[];
  };
  invocation_resolution: {
    overrides: {
      slots: Record<string, { use: string; reason?: string; fallback?: string | null }>;
      capabilities: Record<string, { prefer: string; reason?: string; fallback?: string | null }>;
    };
    resolution_order: string[];
    unresolved: { required: string; optional: string };
    invalid_override: Record<string, string>;
  };
  validation: {
    schema: boolean;
    staleness?: { enabled: boolean; basis?: string; max_age_days?: number };
    deterministic?: { enabled: boolean; compare?: string[] };
    invocation?: { enabled: boolean };
  };
  render: {
    stable_sort: { skills: string[]; invocations: string[] };
    normalize_whitespace?: boolean;
    newline?: string;
  };
  artifacts: {
    protocol: Record<string, string>;
  };
  readable_outputs: {
    enabled: boolean;
    include?: string[];
  };
};

// ─── Scanned Skill ───

export type ScannedSkill = {
  name: string;
  description: string;
  provides: { capability: string; description?: string }[];
  uses: { capability: string; required: boolean; default_skill?: string; override_allowed: boolean }[];
  execution_policy: {
    strictness: "rigid" | "flexible";
    sequence_required: boolean;
    allow_step_reordering: boolean;
    allow_partial_application: boolean;
    guidance?: string;
  };
  tags: string[];
};

// ─── Skill Reference Catalog ───

export type CatalogSlot = {
  slot_id: string;
  description: string;
  default_skill?: string;
};

export type CatalogSkill = ScannedSkill;

export type SkillReferenceCatalog = {
  schema_version: string;
  generated_at: string;
  validated_at: string;
  skill_count: number;
  capability_count: number;
  slot_count: number;
  slots: CatalogSlot[];
  skills: CatalogSkill[];
};

// ─── Flow Profile ───

export type FlowStackSlot = {
  slot_id: string;
  slot_type: "exclusive" | "layerable";
  activation: "always" | "conditional" | "on_demand" | "gate";
  default?: { skill: string; reason?: string };
};

export type Category = {
  id: string;
  label: string;
  skills: string[];
};

export type ResolvedInvocation = {
  source_skill: string;
  slot: string;
  capability: string;
  resolved_skill: string;
  resolution_method: string;
  reason: string;
  fallback: string | null;
};

export type RuntimeGuidance = {
  skill: string;
  context: string;
  guidance: string;
};

export type FlowProfile = {
  schema_version: string;
  flow_name: string;
  generated_at: string;
  validated_at: string;
  adapter_id: string;
  flow_stack: { slots: FlowStackSlot[] };
  classification: {
    categories: Category[];
    unmatched_skills: string[];
  };
  resolved_invocations: ResolvedInvocation[];
  runtime_guidance: RuntimeGuidance[];
  warnings: string[];
};
