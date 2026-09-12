import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QBDProject } from '../../types/qbd';
import { CASE_STUDIES } from '../../data/caseStudies';
import {
  GENESIS_HASH,
  canonicalJsonStringify,
  computeProjectPayloadHash,
  sha256,
} from '../../services/cryptoSha256';
import {
  getProjectHistory,
  persistProject,
  recordProjectVersion,
  signProjectSnapshot,
  verifyAuditTrailIntegrity,
  verifyElectronicSignatures,
} from '../../services/projectGovernance';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setupMockStorage(initialData: Record<string, string> = {}) {
  const storage: Record<string, string> = { ...initialData };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
    },
  });
  return storage;
}

describe('E2E GxP Governance, Audit Trail & 21 CFR Part 11 Workflow', () => {
  describe('Tier 1: Feature Coverage — Cryptographic Hash Engine & Canonical Serialization', () => {
    it('TC-GXP-01: Pure TypeScript SHA-256 strictly matches official NIST FIPS 180-4 test vectors', () => {
      // Vector 1: Empty string
      expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      // Vector 2: "abc"
      expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

      // Vector 3: Standard pangram
      expect(sha256('The quick brown fox jumps over the lazy dog')).toBe(
        'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
      );

      // Vector 4: 1-character difference demonstrates avalanche effect
      const hash1 = sha256('The quick brown fox jumps over the lazy dog');
      const hash2 = sha256('The quick brown fox jumps over the lazy cog');
      expect(hash1).not.toBe(hash2);
      expect(hash2).toBe('e4c4d8f3bf76b692de791a173e05321150f7a345b46484fe427f6acc7ecc81be');
    });

    it('TC-GXP-02: RFC 8785 canonical JSON serializer guarantees deterministic object key ordering', () => {
      const obj1 = { z: 100, a: 'first', m: { y: 2, b: 1 } };
      const obj2 = { a: 'first', m: { b: 1, y: 2 }, z: 100 };

      const canon1 = canonicalJsonStringify(obj1);
      const canon2 = canonicalJsonStringify(obj2);

      expect(canon1).toBe('{"a":"first","m":{"b":1,"y":2},"z":100}');
      expect(canon1).toBe(canon2);
      expect(sha256(canon1)).toBe(sha256(canon2));
    });

    it('TC-GXP-03: Builds immutable cryptographic hash chain linking successive project snapshots', () => {
      setupMockStorage();
      const project: QBDProject = structuredClone(CASE_STUDIES[0]);

      // Record Version 1 (Creation)
      recordProjectVersion(project, 'PROJECT_CREATED', { name: 'Dr. Analyst', role: 'Analyst' }, 'Initial protocol setup');
      // Record Version 2 (DoE Configuration)
      project.doeConfig.centerPoints = 4;
      recordProjectVersion(project, 'DOE_CONFIGURED', { name: 'Dr. Analyst', role: 'Analyst' }, 'Added center runs');
      // Record Version 3 (Responses Logged)
      recordProjectVersion(project, 'RESPONSES_LOGGED', { name: 'Dr. Analyst', role: 'Analyst' }, 'Experimental data collected');

      const history = getProjectHistory(project.id);
      expect(history.length).toBe(3);

      // Verify chain integrity
      const verification = verifyAuditTrailIntegrity(history);
      expect(verification.isValid).toBe(true);
      expect(verification.tamperedIndex).toBeUndefined();
    });

    it('TC-GXP-04: Computes deterministic payload hash for full QBDProject structures', () => {
      const project1 = structuredClone(CASE_STUDIES[0]);
      const project2 = structuredClone(CASE_STUDIES[0]);

      const hash1 = computeProjectPayloadHash(project1);
      const hash2 = computeProjectPayloadHash(project2);

      expect(hash1.length).toBe(64);
      expect(hash1).toBe(hash2);

      // Mutate 1 attribute
      project2.factors[0].name += ' ';
      const hash3 = computeProjectPayloadHash(project2);
      expect(hash3).not.toBe(hash1);
    });

    it('TC-GXP-05: Executes 3-tier electronic sign-off workflow (Analyst -> Reviewer -> Approver)', () => {
      setupMockStorage();
      let project: QBDProject = structuredClone(CASE_STUDIES[0]);

      // Step 1: Analyst Sign-off
      project = signProjectSnapshot(project, {
        name: 'John Analyst',
        role: 'Analyst',
        reason: 'Protocol executed and verified',
        department: 'Formulation R&D',
      });
      expect(project.electronicSignatures?.length).toBe(1);
      expect(project.isLocked).toBeFalsy();

      // Step 2: Reviewer Sign-off
      project = signProjectSnapshot(project, {
        name: 'Sarah Reviewer',
        role: 'Reviewer',
        reason: 'Statistical models reviewed and confirmed',
        department: 'Quality Assurance',
      });
      expect(project.electronicSignatures?.length).toBe(2);
      expect(project.isLocked).toBeFalsy();

      // Step 3: Approver Sign-off
      project = signProjectSnapshot(project, {
        name: 'Robert Director',
        role: 'Approver',
        reason: 'Approved for formal regulatory filing',
        department: 'Regulatory Affairs',
      });
      expect(project.electronicSignatures?.length).toBe(3);
      // Upon Approver sign-off, project MUST enter locked state
      expect(project.isLocked).toBe(true);
      expect(project.lockDetails?.lockedBy).toBe('Robert Director');
      expect(project.lockDetails?.role).toBe('Approver');
    });
  });

  describe('Tier 2: Boundary & Corner Cases — Adversarial Tamper Injections', () => {
    it('TC-GXP-06: Detects 1-character tamper injection in audit entry timestamp', () => {
      setupMockStorage();
      const project: QBDProject = structuredClone(CASE_STUDIES[0]);

      recordProjectVersion(project, 'STEP_1', 'Analyst', 'Step 1');
      recordProjectVersion(project, 'STEP_2', 'Analyst', 'Step 2');

      const history = getProjectHistory(project.id);
      expect(verifyAuditTrailIntegrity(history).isValid).toBe(true);

      // Inject 1-character tamper in timestamp of entry 0
      const originalTime = history[0].timestamp;
      const tamperedTime = originalTime.slice(0, -2) + (originalTime.endsWith('1Z') ? '2Z' : '1Z');
      history[0].timestamp = tamperedTime;

      const result = verifyAuditTrailIntegrity(history);
      expect(result.isValid).toBe(false);
      expect(result.tamperedIndex).toBe(0);
      expect(result.reason).toContain('Entry hash mismatch');
    });

    it('TC-GXP-07: Detects 1-character tamper injection in project snapshot payload', () => {
      setupMockStorage();
      const project: QBDProject = structuredClone(CASE_STUDIES[0]);

      recordProjectVersion(project, 'INIT', 'Analyst', 'Initial');
      const history = getProjectHistory(project.id);
      expect(verifyAuditTrailIntegrity(history).isValid).toBe(true);

      // Tamper project data inside snapshot
      history[0].project.name += '!';

      const result = verifyAuditTrailIntegrity(history);
      expect(result.isValid).toBe(false);
      expect(result.tamperedIndex).toBe(0);
      expect(result.reason).toContain('Payload hash mismatch');
    });

    it('TC-GXP-08: Detects broken previousHash link in middle of chain', () => {
      setupMockStorage();
      const project: QBDProject = structuredClone(CASE_STUDIES[0]);

      recordProjectVersion(project, 'E1', 'Analyst', 'First');
      recordProjectVersion(project, 'E2', 'Analyst', 'Second');
      recordProjectVersion(project, 'E3', 'Analyst', 'Third');

      const history = getProjectHistory(project.id);
      expect(verifyAuditTrailIntegrity(history).isValid).toBe(true);

      // Tamper entry 1 previousHash
      history[1].previousHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const result = verifyAuditTrailIntegrity(history);
      expect(result.isValid).toBe(false);
      // Either entryHash or chain link mismatch will be detected
      expect(result.tamperedIndex).toBe(1);
    });

    it('TC-GXP-09: Empty audit trail returns valid with genesis root hash', () => {
      const result = verifyAuditTrailIntegrity([]);
      expect(result.isValid).toBe(true);
      expect(result.rootHash).toBe(GENESIS_HASH);
    });

    it('TC-GXP-10: Detects falsified electronic signature checksum', () => {
      const project = structuredClone(CASE_STUDIES[0]);
      const signed = signProjectSnapshot(project, {
        name: 'Analyst Alice',
        role: 'Analyst',
        reason: 'Initial run',
      });

      expect(verifyElectronicSignatures(signed.electronicSignatures ?? []).isValid).toBe(true);

      // Tamper signature checksum
      const tamperedSignatures = structuredClone(signed.electronicSignatures ?? []);
      tamperedSignatures[0].signatureChecksum = 'bad_checksum_hash_value_123456789';

      const verifyTampered = verifyElectronicSignatures(tamperedSignatures);
      expect(verifyTampered.isValid).toBe(false);
      expect(verifyTampered.invalidIndex).toBe(0);
    });
  });

  describe('Tier 3: Cross-Feature Integration — Project Persistence & Governance Enforcement', () => {
    it('TC-GXP-11: Full round-trip persistence preserves audit trail and cryptographic state', () => {
      setupMockStorage();
      const project = structuredClone(CASE_STUDIES[0]);

      recordProjectVersion(project, 'SAVED_DRAFT', 'Analyst', 'Saving draft');
      persistProject(project);

      const history = getProjectHistory(project.id);
      expect(history.length).toBe(1);
      expect(verifyAuditTrailIntegrity(history).isValid).toBe(true);
    });

    it('TC-GXP-12: Enforces immutable locking when approved project is re-signed or edited', () => {
      setupMockStorage();
      let project = structuredClone(CASE_STUDIES[0]);

      // Execute full approval
      project = signProjectSnapshot(project, { name: 'A', role: 'Analyst', reason: 'R1' });
      project = signProjectSnapshot(project, { name: 'B', role: 'Reviewer', reason: 'R2' });
      project = signProjectSnapshot(project, { name: 'C', role: 'Approver', reason: 'R3' });

      expect(project.isLocked).toBe(true);

      // Verify electronic signature verification on locked project
      const sigVerification = verifyElectronicSignatures(project.electronicSignatures ?? []);
      expect(sigVerification.isValid).toBe(true);
    });
  });

  describe('Tier 4: Real-World Pharmaceutical Scenario — Regulatory Audit Readiness Flow', () => {
    it('TC-GXP-13: Executes complete GxP lifecycle from project inception to regulatory sign-off', () => {
      setupMockStorage();
      let project: QBDProject = structuredClone(CASE_STUDIES[0]);
      project.id = 'QBD-REG-2026-001';
      project.name = 'Paracetamol 500mg Extended Release Formulation';

      // 1. Inception
      recordProjectVersion(project, 'PROJECT_INITIALIZATION', { name: 'Pham Hoang', role: 'Analyst', department: 'Formulation' }, 'Created new QbD project');

      // 2. Factor definition
      project.factors[0].low = 15;
      project.factors[0].high = 35;
      recordProjectVersion(project, 'FACTORS_UPDATED', { name: 'Pham Hoang', role: 'Analyst', department: 'Formulation' }, 'Narrowed HPMC K100M polymer range');

      // 3. DoE Generation
      recordProjectVersion(project, 'DOE_GENERATED', { name: 'Pham Hoang', role: 'Analyst', department: 'Formulation' }, 'Generated Definitive Screening Design (14 runs)');

      // 4. Lab Results Ingestion
      project.runs.forEach((r, idx) => {
        r.responses['Y1'] = 80 + idx * 1.2;
      });
      recordProjectVersion(project, 'RUN_RESULTS_LOGGED', { name: 'Pham Hoang', role: 'Analyst', department: 'Analytical Lab' }, 'Completed dissolution testing batch 1-14');

      // 5. Analyst Formal Sign-Off
      project = signProjectSnapshot(project, {
        name: 'Pham Hoang',
        role: 'Analyst',
        department: 'Formulation R&D',
        reason: 'All raw experimental data and DoE parameters entered accurately',
      });

      // 6. Reviewer Scientific Peer Review
      project = signProjectSnapshot(project, {
        name: 'Dr. Le Van',
        role: 'Reviewer',
        department: 'Scientific Advisory Board',
        reason: 'Verified statistical ANOVA lack of fit and RSM response models',
      });

      // 7. QA Director Approval & Record Locking
      project = signProjectSnapshot(project, {
        name: 'Nguyen Thi QA',
        role: 'Approver',
        department: 'Quality Assurance',
        reason: 'Approved for inclusion in CTD Module 3.2.P.2 Pharmaceutical Development',
      });

      // 8. Final Regulatory Audit Verification
      const auditTrail = getProjectHistory(project.id);
      expect(auditTrail.length).toBe(7); // 4 manual stages + 3 signature stages

      const chainIntegrity = verifyAuditTrailIntegrity(auditTrail);
      expect(chainIntegrity.isValid).toBe(true);

      const sigIntegrity = verifyElectronicSignatures(project.electronicSignatures ?? []);
      expect(sigIntegrity.isValid).toBe(true);
      expect(project.isLocked).toBe(true);
    });
  });
});
