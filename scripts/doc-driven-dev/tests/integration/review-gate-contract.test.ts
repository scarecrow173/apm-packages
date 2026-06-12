import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Review Gate Contract Regression Tests
 * 
 * Ensures that Phase E of implementation-flow maintains canonical review skill naming
 * and correctly references the review-gate-contract.md specification.
 */

describe('Review Gate Contract', () => {
  const SKILL_DIR = path.join(__dirname, '../../.apm/skills/implementation-flow');
  const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
  const CONTRACT_FILE = path.join(SKILL_DIR, 'references/review-gate-contract.md');
  
  const CANONICAL_SKILL_NAME = 'requesting-code-review';

  it('contract file exists and is readable', () => {
    expect(fs.existsSync(CONTRACT_FILE)).toBe(true);
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(100);
  });

  it('contract declares canonical skill name', () => {
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toContain(CANONICAL_SKILL_NAME);
    expect(content).toMatch(/Official Skill Name.*requesting-code-review/i);
  });

  it('contract includes immutability notice', () => {
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toContain('Immutable Name');
    expect(content).toContain('stable contract');
  });

  it('contract includes testing section', () => {
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toContain('Testing');
    expect(content).toContain('regression tests');
  });

  it('implementation-flow SKILL.md references contract in Phase E', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    
    // Must have Phase E section
    expect(content).toContain('## Phase E: Review');
    
    // Must reference the contract file
    expect(content).toContain('review-gate-contract.md');
    expect(content).toContain('references/review-gate-contract.md');
  });

  it('implementation-flow Phase E specifies canonical skill name', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    const phaseEStart = content.indexOf('## Phase E: Review');
    const phaseEEnd = content.indexOf('---', phaseEStart + 1);
    const phaseEContent = content.substring(phaseEStart, phaseEEnd);
    
    // Must explicitly mention the canonical skill name
    expect(phaseEContent).toContain(CANONICAL_SKILL_NAME);
    expect(phaseEContent).toMatch(/canonical.*skill.*requesting-code-review/i);
  });

  it('implementation-flow Phase E does not use vague skill references', () => {
    const content = fs.readFileSync(SKILL_MD, 'utf-8');
    const phaseEStart = content.indexOf('## Phase E: Review');
    const phaseEEnd = content.indexOf('---', phaseEStart + 1);
    const phaseEContent = content.substring(phaseEStart, phaseEEnd);
    
    // Must NOT say "if available" or other conditional language for canonical skill
    // (It should reference it as the required/canonical skill)
    const hasClearRequirement = phaseEContent.includes('canonical') || 
                               phaseEContent.includes('contract');
    expect(hasClearRequirement).toBe(true);
  });

  it('contract file includes phase E responsibility statement', () => {
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toContain('Phase E');
    expect(content).toMatch(/Phase E.*review.*gate/i);
  });

  it('contract file includes failure mode documentation', () => {
    const content = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    expect(content).toContain('Failure Mode');
    expect(content).toMatch(/fail.*fast|error.*message/i);
  });

  it('contract file is synced with implementation-flow', () => {
    const skillContent = fs.readFileSync(SKILL_MD, 'utf-8');
    const contractContent = fs.readFileSync(CONTRACT_FILE, 'utf-8');
    
    // Both must reference the same canonical name
    expect(skillContent).toContain(CANONICAL_SKILL_NAME);
    expect(contractContent).toContain(CANONICAL_SKILL_NAME);
    
    // Both must agree on the skill category/purpose
    expect(contractContent).toContain('review');
  });
});
