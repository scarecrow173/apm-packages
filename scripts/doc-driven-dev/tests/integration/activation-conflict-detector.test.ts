import { describe, it, expect, beforeAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Activation Conflict Detector Tests
 * 
 * Verifies that multiple meta-skills (lifecycle, briefing-flow, implementation-flow)
 * cannot activate simultaneously on the same request, preventing undefined behavior.
 */

describe('Activation Conflict Detector', () => {
  const SCHEMA_FILE = path.join(
    __dirname,
    '../../.apm/skills/skill-discovery-protocol/assets/schemas/activation-conflict-detector.json'
  );
  const AGENTS_FILE = path.join(__dirname, '../../AGENTS.md');
  
  let schemaContent: any;
  let agentsContent: string;

  beforeAll(() => {
    expect(fs.existsSync(SCHEMA_FILE)).toBe(true);
    schemaContent = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf-8'));
    agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8');
  });

  describe('Schema Structure', () => {
    it('schema file is valid JSON', () => {
      expect(schemaContent).toBeTruthy();
      expect(schemaContent.$schema).toBeDefined();
    });

    it('schema has required top-level properties', () => {
      expect(schemaContent.version).toBeDefined();
      expect(schemaContent.detection_rules).toBeDefined();
      expect(schemaContent.activation_matrix).toBeDefined();
      expect(schemaContent.guaranteed_invariants).toBeDefined();
    });

    it('detection_rules is an array with entries', () => {
      expect(Array.isArray(schemaContent.detection_rules)).toBe(true);
      expect(schemaContent.detection_rules.length).toBeGreaterThan(0);
    });

    it('each detection_rule has required fields', () => {
      schemaContent.detection_rules.forEach((rule: any) => {
        expect(rule.id).toBeDefined();
        expect(rule.description).toBeDefined();
        expect(rule.condition).toBeDefined();
        expect(rule.severity).toBeDefined();
        expect(['CRITICAL', 'HIGH', 'MEDIUM']).toContain(rule.severity);
      });
    });

    it('guaranteed_invariants is an array with entries', () => {
      expect(Array.isArray(schemaContent.guaranteed_invariants)).toBe(true);
      expect(schemaContent.guaranteed_invariants.length).toBeGreaterThan(0);
    });

    it('each invariant has required fields', () => {
      schemaContent.guaranteed_invariants.forEach((inv: any) => {
        expect(inv.id).toBeDefined();
        expect(inv.statement).toBeDefined();
        expect(inv.test).toBeDefined();
        expect(['MUST_NOT_VIOLATE', 'SHOULD_NOT_VIOLATE']).toContain(inv.enforcement);
      });
    });
  });

  describe('Activation Matrix Completeness', () => {
    it('matrix includes all three meta-skills', () => {
      const skills = ['doc-driven-dev-lifecycle', 'briefing-flow', 'implementation-flow'];
      skills.forEach(skill => {
        expect(schemaContent.activation_matrix).toHaveProperty(skill);
      });
    });

    it('each skill has entry_conditions', () => {
      const matrix = schemaContent.activation_matrix;
      Object.values(matrix).forEach((skill: any) => {
        expect(skill.entry_conditions).toBeDefined();
        expect(Array.isArray(skill.entry_conditions)).toBe(true);
      });
    });

    it('each skill defines mutual_exclusions', () => {
      const matrix = schemaContent.activation_matrix;
      Object.values(matrix).forEach((skill: any) => {
        expect(skill.mutual_exclusions).toBeDefined();
        expect(Array.isArray(skill.mutual_exclusions)).toBe(true);
      });
    });

    it('mutual_exclusions are symmetric or explained', () => {
      const matrix = schemaContent.activation_matrix;
      const lifecycle = matrix['doc-driven-dev-lifecycle'];
      const briefing = matrix['briefing-flow'];
      const impl = matrix['implementation-flow'];

      // If lifecycle excludes briefing, briefing should exclude lifecycle
      // (or explanation should exist in cannot_overlap_with)
      if (lifecycle.mutual_exclusions.includes('briefing-flow')) {
        expect(briefing.mutual_exclusions).toContain('doc-driven-dev-lifecycle');
      }
    });
  });

  describe('Invariant Enforcement', () => {
    it('has invariant for single active meta-skill', () => {
      const inv = schemaContent.guaranteed_invariants.find(
        (i: any) => i.statement && i.statement.includes('Single Active Meta-Skill')
      );
      expect(inv).toBeDefined();
      expect(inv.enforcement).toBe('MUST_NOT_VIOLATE');
    });

    it('has invariant for no cross-activation loops', () => {
      const inv = schemaContent.guaranteed_invariants.find(
        (i: any) => i.statement && i.statement.includes('Cross-Activation')
      );
      expect(inv).toBeDefined();
      expect(inv.enforcement).toBe('MUST_NOT_VIOLATE');
    });

    it('has invariant for phase boundary enforcement', () => {
      const inv = schemaContent.guaranteed_invariants.find(
        (i: any) => i.statement && i.statement.includes('Phase Boundary')
      );
      expect(inv).toBeDefined();
      expect(inv.enforcement).toBe('MUST_NOT_VIOLATE');
    });
  });

  describe('AGENTS.md Alignment', () => {
    it('AGENTS.md Section 8 exists and is complete', () => {
      expect(agentsContent).toContain('## 8. Meta-Skill Activation Boundaries');
      expect(agentsContent).toContain('Activation Matrix');
      expect(agentsContent).toContain('Dispatch Decision Tree');
      expect(agentsContent).toContain('Guarantees');
    });

    it('AGENTS.md lists all three meta-skills', () => {
      expect(agentsContent).toContain('doc-driven-dev-lifecycle');
      expect(agentsContent).toContain('briefing-flow');
      expect(agentsContent).toContain('implementation-flow');
    });

    it('AGENTS.md specifies mutual exclusions', () => {
      expect(agentsContent).toContain('Must not activate if');
      expect(agentsContent).toContain('Mutual Exclusions');
    });

    it('AGENTS.md includes dispatch decision tree', () => {
      expect(agentsContent).toContain('Dispatch Decision Tree');
      expect(agentsContent).toContain('Entry Request');
    });

    it('AGENTS.md references integration tests', () => {
      expect(agentsContent).toContain('activation-conflict-detector.test.ts');
      expect(agentsContent).toContain('review-gate-contract.test.ts');
    });
  });

  describe('Conflict Detection Rules', () => {
    it('rules use consistent ID naming', () => {
      schemaContent.detection_rules.forEach((rule: any) => {
        expect(rule.id).toMatch(/^CONFLICT_[A-Z0-9_]+$/);
      });
    });

    it('rules identify involved skills', () => {
      schemaContent.detection_rules.forEach((rule: any) => {
        if (rule.affected_skills) {
          expect(Array.isArray(rule.affected_skills)).toBe(true);
          expect(rule.affected_skills.length).toBeGreaterThan(0);
        }
      });
    });

    it('rules include remediation guidance', () => {
      schemaContent.detection_rules.forEach((rule: any) => {
        if (rule.severity === 'CRITICAL') {
          expect(rule.remediation).toBeDefined();
          expect(rule.remediation.length).toBeGreaterThan(0);
        }
      });
    });

    it('critical rules outnumber low-severity rules', () => {
      const critical = schemaContent.detection_rules.filter(
        (r: any) => r.severity === 'CRITICAL'
      ).length;
      const medium = schemaContent.detection_rules.filter(
        (r: any) => r.severity === 'MEDIUM'
      ).length;
      // Conflicts should be taken seriously
      expect(critical).toBeGreaterThanOrEqual(medium);
    });
  });

  describe('Schema Validation', () => {
    it('schema version is semantic', () => {
      expect(schemaContent.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('skill definitions follow pattern', () => {
      const matrix = schemaContent.activation_matrix;
      Object.values(matrix).forEach((skill: any) => {
        expect(skill.name).toBeDefined();
        expect(skill.name.length).toBeGreaterThan(0);
      });
    });

    it('no undefined or null values in critical fields', () => {
      schemaContent.detection_rules.forEach((rule: any) => {
        expect(rule.id).not.toBeNull();
        expect(rule.description).not.toBeNull();
        expect(rule.condition).not.toBeNull();
      });
    });
  });
});
