import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import type { QBDProject } from '../types/qbd';
import {
  GENESIS_HASH,
  canonicalJsonStringify,
  computeEntryHash,
  computeProjectPayloadHash,
  computeSignatureChecksum,
  createElectronicSignature,
  getProjectHistory,
  hasProjectStructure,
  loadPersistedProject,
  lockProject,
  persistProject,
  recordProjectVersion,
  sha256,
  signProjectSnapshot,
  unlockProject,
  validateProjectTemplate,
  verifyAuditTrailIntegrity,
  verifyElectronicSignatures,
  type ProjectAuditEntry,
  type ProjectVersionSnapshot,
} from '../services/projectGovernance';

afterEach(() => vi.unstubAllGlobals());

function mockStorage(values: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

// =========================================================================
// 1. NIST FIPS 180-4 SHA-256 TEST VECTORS & DETERMINISM
// =========================================================================
describe('Pure TypeScript SHA-256 Engine (FIPS 180-4)', () => {
  it('computes exact hash for NIST empty string vector', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes exact hash for NIST "abc" test vector', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('computes exact hash for NIST 56-byte string vector', () => {
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256(input)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles multi-block long strings (> 128 bytes) deterministically', () => {
    const input = 'QbD-Pharmaceutical-Development-ICH-Q8-Q9-Q10-21-CFR-Part-11-Design-Space-Verification-Long-Payload-Data-Testing'.repeat(
      10
    );
    const hash1 = sha256(input);
    const hash2 = sha256(input);
    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });

  it('handles UTF-8 multibyte characters accurately', () => {
    const input = 'Nghiên cứu công thức bào chế viên nén phóng thích kéo dài 21 CFR Part 11';
    const hash = sha256(input);
    expect(hash).toHaveLength(64);
    expect(sha256(input)).toBe(hash);
  });
});

// =========================================================================
// 2. CANONICAL JSON DETERMINISM (RFC 8785)
// =========================================================================
describe('Deterministic Canonical JSON Serializer (RFC 8785)', () => {
  it('produces identical serialized string regardless of object key order', () => {
    const obj1 = { z: 10, a: 1, m: 'test', b: true };
    const obj2 = { a: 1, b: true, m: 'test', z: 10 };
    const obj3 = { m: 'test', z: 10, b: true, a: 1 };

    const canon1 = canonicalJsonStringify(obj1);
    const canon2 = canonicalJsonStringify(obj2);
    const canon3 = canonicalJsonStringify(obj3);

    expect(canon1).toBe('{"a":1,"b":true,"m":"test","z":10}');
    expect(canon1).toBe(canon2);
    expect(canon2).toBe(canon3);
    expect(sha256(canon1)).toBe(sha256(canon2));
  });

  it('handles deeply nested objects and preserves array order', () => {
    const nested1 = {
      beta: { d: 4, c: 3 },
      alpha: [{ y: 2, x: 1 }, { w: 4, v: 3 }],
    };
    const nested2 = {
      alpha: [{ x: 1, y: 2 }, { v: 3, w: 4 }],
      beta: { c: 3, d: 4 },
    };

    expect(canonicalJsonStringify(nested1)).toBe(canonicalJsonStringify(nested2));
    expect(computeProjectPayloadHash(nested1)).toBe(computeProjectPayloadHash(nested2));
  });

  it('guarantees round-trip payload hash determinism on full QBDProject', () => {
    const project = CASE_STUDIES[0];

    // Create a copy with scrambled keys
    const scrambled = {
      version: project.version,
      runs: project.runs.map((r) => ({
        responses: { ...r.responses },
        factorActual: { ...r.factorActual },
        factorCoded: { ...r.factorCoded },
        id: r.id,
        runOrder: r.runOrder,
        stdOrder: r.stdOrder,
        block: r.block,
      })),
      name: project.name,
      id: project.id,
      factors: [...project.factors],
      cqas: [...project.cqas],
      qtpp: [...project.qtpp],
      fmeaRisks: [...project.fmeaRisks],
      doeConfig: { ...project.doeConfig },
      description: project.description,
      dosageForm: project.dosageForm,
      moleculeName: project.moleculeName,
      createdDate: project.createdDate,
      updatedDate: project.updatedDate,
      designSpace: [...project.designSpace],
      author: project.author,
    };

    const hash1 = computeProjectPayloadHash(project);
    const hash2 = computeProjectPayloadHash(scrambled);
    expect(hash1).toBe(hash2);
  });
});

// =========================================================================
// 3. TAMPER-EVIDENT HASH CHAIN AUDIT TRAIL
// =========================================================================
describe('Cryptographic Tamper-Evident Hash Chain Audit Trail', () => {
  function createTestChain(length: number = 5): ProjectAuditEntry[] {
    const chain: ProjectAuditEntry[] = [];
    const actions = [
      'PROJECT_INITIALIZED',
      'DOE_DESIGN_GENERATED',
      'RUN_DATA_MODIFIED',
      'MODEL_TRAINED',
      'ELECTRONIC_SIGNATURE_EXECUTED',
    ];

    for (let i = 0; i < length; i++) {
      const sequenceNumber = i + 1;
      const timestamp = new Date(1700000000000 + i * 60000).toISOString();
      const action = actions[i % actions.length];
      const versionLabel = `1.0.${i}`;
      const user = { name: 'Dr. Test', role: 'Analyst' as const, department: 'R&D' };
      const details = `Thực hiện bước kiểm toán ${sequenceNumber}: ${action}`;
      const payloadHash = sha256(`project-state-payload-${i}`);
      const previousHash = i === 0 ? GENESIS_HASH : chain[i - 1].entryHash;

      const entryHash = computeEntryHash({
        sequenceNumber,
        timestamp,
        action,
        versionLabel,
        user,
        details,
        payloadHash,
        previousHash,
      });

      chain.push({
        id: `entry-${sequenceNumber}`,
        sequenceNumber,
        timestamp,
        action,
        versionLabel,
        user,
        details,
        payloadHash,
        previousHash,
        entryHash,
      });
    }

    return chain;
  }

  it('validates a completely intact 5-block cryptographic hash chain', () => {
    const chain = createTestChain(5);
    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.tamperedIndex).toBeUndefined();
    expect(result.chainLength).toBe(5);
    expect(result.rootHash).toBe(chain[4].entryHash);
  });

  // CRITICAL MANDATORY ACCEPTANCE CRITERION
  it('immediately detects a single-character alteration in entry details', () => {
    const chain = createTestChain(5);
    // Tamper single character in entry 2 (index 1): add a trailing dot
    chain[1].details = chain[1].details + '.';

    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.tamperedIndex).toBe(1);
    expect(result.tamperedEntryIndex).toBe(1);
    expect(result.reason).toContain('sequence 2');
  });

  it('immediately detects a single-character alteration in timestamp', () => {
    const chain = createTestChain(5);
    // Alter last digit of timestamp
    const origTs = chain[2].timestamp;
    chain[2].timestamp = origTs.slice(0, -2) + '1Z';

    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(2);
  });

  it('immediately detects a single-character alteration in action', () => {
    const chain = createTestChain(5);
    chain[3].action = 'MODEL_TRAINED_TAMPERED';

    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(3);
  });

  it('immediately detects an alteration in previousHash (broken link)', () => {
    const chain = createTestChain(5);
    // Recompute entryHash for entry 2 with altered data, making entry 2 hash valid for itself,
    // but breaking the link from entry 3 to entry 2
    chain[2].previousHash = sha256('tampered-link');
    // Note: this invalidates entry 2's hash calculation
    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(2);
  });

  it('detects chain breakage when an intermediate block is deleted', () => {
    const chain = createTestChain(5);
    // Remove entry at index 2 (sequence 3)
    chain.splice(2, 1);
    // Now entry at new index 2 (originally seq 4) has previousHash pointing to deleted entry
    const result = verifyAuditTrailIntegrity(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(2);
    expect(result.reason).toContain('Chain link broken');
  });

  it('detects tampering inside snapshot project payload', () => {
    const project = CASE_STUDIES[0];
    const snapshotProject = structuredClone(project);
    const payloadHash = computeProjectPayloadHash(snapshotProject);

    const snapshot: ProjectVersionSnapshot = {
      id: 'snap-1',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      action: 'INITIAL_SNAPSHOT',
      versionLabel: '1.0.0',
      user: 'Dr. Analyst',
      details: 'Initial state',
      payloadHash,
      previousHash: GENESIS_HASH,
      entryHash: '',
      project: snapshotProject,
    };

    snapshot.entryHash = computeEntryHash(snapshot);

    // Verify valid snapshot
    expect(verifyAuditTrailIntegrity([snapshot]).isValid).toBe(true);

    // Tamper with project data inside snapshot (e.g. modify response)
    snapshot.project.runs[0].responses.Y1 = 99.99;

    const tamperedResult = verifyAuditTrailIntegrity([snapshot]);
    expect(tamperedResult.isValid).toBe(false);
    expect(tamperedResult.tamperedIndex).toBe(0);
    expect(tamperedResult.reason).toContain('Payload hash mismatch');
  });
});

// =========================================================================
// 4. 21 CFR PART 11 ELECTRONIC SIGN-OFF & RECORD LOCKING WORKFLOW
// =========================================================================
describe('21 CFR Part 11 Electronic Sign-Off & Record Locking Workflow', () => {
  it('executes 3-tier sign-off hierarchy: Analyst -> Reviewer -> Approver', () => {
    const baseProject = CASE_STUDIES[0];

    // Tier 1: Analyst Sign-off (Authorship)
    const analystSigned = signProjectSnapshot(baseProject, {
      name: 'Nguyen Van Analyst',
      role: 'Analyst',
      department: 'Formulation R&D',
      reason: 'Authorship: Đã hoàn tất thiết kế DoE và thực nghiệm',
    });

    expect(analystSigned.electronicSignatures).toHaveLength(1);
    expect(analystSigned.electronicSignatures![0].signerRole).toBe('Analyst');
    expect(analystSigned.isLocked).toBeFalsy();
    expect(verifyElectronicSignatures(analystSigned.electronicSignatures!).isValid).toBe(true);

    // Tier 2: Reviewer Sign-off (Technical Review)
    const reviewerSigned = signProjectSnapshot(analystSigned, {
      name: 'Tran Thi Reviewer',
      role: 'Reviewer',
      department: 'Statistical Review Dept',
      reason: 'Technical Review: Đã thẩm định mô hình toán và ANOVA',
    });

    expect(reviewerSigned.electronicSignatures).toHaveLength(2);
    expect(reviewerSigned.electronicSignatures![1].signerRole).toBe('Reviewer');
    expect(reviewerSigned.isLocked).toBeFalsy();
    expect(verifyElectronicSignatures(reviewerSigned.electronicSignatures!).isValid).toBe(true);

    // Tier 3: Approver Sign-off (QA Release & Lock)
    const approvedProject = signProjectSnapshot(reviewerSigned, {
      name: 'Le Van Approver',
      role: 'Approver',
      department: 'Quality Assurance (QA)',
      reason: 'Regulatory Approval: Phê duyệt hồ sơ lưu hành',
    });

    expect(approvedProject.electronicSignatures).toHaveLength(3);
    expect(approvedProject.electronicSignatures![2].signerRole).toBe('Approver');
    expect(approvedProject.isLocked).toBe(true);
    expect(approvedProject.lockDetails).toBeDefined();
    expect(approvedProject.lockDetails?.lockedBy).toBe('Le Van Approver');
    expect(approvedProject.lockDetails?.role).toBe('Approver');
    expect(verifyElectronicSignatures(approvedProject.electronicSignatures!).isValid).toBe(true);
  });

  it('generates cryptographic signature binding with computeSignatureChecksum', () => {
    const project = CASE_STUDIES[0];
    const sig = createElectronicSignature(project, {
      name: 'Nguyen Van Analyst',
      role: 'Analyst',
      department: 'Formulation R&D',
      reason: 'Authorship confirmed',
    });

    expect(sig.signatureChecksum).toHaveLength(64);
    const expected = computeSignatureChecksum({
      projectPayloadHash: sig.projectPayloadHash,
      signerName: sig.signerName,
      signerRole: sig.signerRole,
      timestamp: sig.timestamp,
      reason: sig.reason,
      department: sig.department,
    });
    expect(sig.signatureChecksum).toBe(expected);
  });

  it('detects tampering in an electronic signature checksum', () => {
    const project = CASE_STUDIES[0];
    const signed = signProjectSnapshot(project, {
      name: 'Test Signer',
      role: 'Analyst',
      reason: 'Authorship verification',
    });

    const signatures = [...signed.electronicSignatures!];
    expect(verifyElectronicSignatures(signatures).isValid).toBe(true);

    // Tamper with signer name
    signatures[0] = {
      ...signatures[0],
      signerName: 'Impostor Signer',
    };

    const result = verifyElectronicSignatures(signatures);
    expect(result.isValid).toBe(false);
    expect(result.invalidIndex).toBe(0);
    expect(result.reason).toContain('Signature checksum mismatch');
  });

  it('detects unauthorized modifications to approved project payload', () => {
    const project = CASE_STUDIES[0];
    const approved = signProjectSnapshot(project, {
      name: 'QA Director',
      role: 'Approver',
      reason: 'Approved',
    });

    // Valid state against its own payload hash
    const origHash = computeProjectPayloadHash(approved);
    expect(verifyElectronicSignatures(approved.electronicSignatures!, origHash).isValid).toBe(true);

    // Simulate unauthorized modification without unlocking
    const tampered = structuredClone(approved);
    tampered.cqas[0].weight = 999;
    const tamperedHash = computeProjectPayloadHash(tampered);

    const check = verifyElectronicSignatures(approved.electronicSignatures!, tamperedHash);
    expect(check.isValid).toBe(false);
    expect(check.reason).toContain('Approved project state altered');
  });

  it('unlocks project only with formal justification and records audit trail', () => {
    const project = CASE_STUDIES[0];
    const locked = lockProject(project, {
      name: 'QA Lead',
      role: 'Approver',
      reason: 'Release lock',
    });

    expect(locked.isLocked).toBe(true);

    // Attempt unlock without justification
    expect(() =>
      unlockProject(locked, {
        name: 'QA Lead',
        role: 'Approver',
        justification: '   ',
      })
    ).toThrow('justification');

    // Valid unlock
    const unlocked = unlockProject(locked, {
      name: 'QA Lead',
      role: 'Approver',
      justification: 'Yêu cầu thẩm định lại theo hồ sơ bổ sung',
    });

    expect(unlocked.isLocked).toBe(false);
    expect(unlocked.lockDetails).toBeUndefined();
  });
});

// =========================================================================
// 5. STORAGE BOUNDARIES & LEGACY BACKWARD COMPATIBILITY
// =========================================================================
describe('Project Persistence Boundaries & Compatibility', () => {
  it('round trips every bundled case study and retains unfinished drafts', () => {
    mockStorage();
    for (const project of CASE_STUDIES) {
      expect(hasProjectStructure(project)).toBe(true);
      expect(persistProject(project)).toBe(true);
      expect(loadPersistedProject()).toEqual(project);
    }
    const draft = { ...CASE_STUDIES[0], name: '', cqas: [], runs: [] };
    expect(persistProject(draft)).toBe(true);
    expect(loadPersistedProject()).toEqual(draft);
  });

  it.each(['null', '{}', '[]', '{broken', '{"cqas":true,"factors":[]}'])(
    'ignores corrupt autosave %s',
    (raw) => {
      mockStorage({ 'qbd.project.last': raw });
      expect(loadPersistedProject()).toBeNull();
    }
  );

  it('handles denied access to the localStorage getter', () => {
    vi.stubGlobal(
      'window',
      Object.defineProperty({}, 'localStorage', {
        get() {
          throw new Error('SecurityError');
        },
      })
    );
    expect(loadPersistedProject()).toBeNull();
    expect(getProjectHistory('x')).toEqual([]);
    expect(persistProject(CASE_STUDIES[0])).toBe(false);
    expect(recordProjectVersion(CASE_STUDIES[0], 'test')).toBe(false);
  });

  it('reports quota failures without throwing', () => {
    const storage = mockStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(persistProject(CASE_STUDIES[0])).toBe(false);
    expect(recordProjectVersion(CASE_STUDIES[0], 'test')).toBe(false);
  });

  it('filters invalid history entries and can append a new snapshot', () => {
    const project = CASE_STUDIES[0];
    const key = `qbd.project.history.${project.id}`;
    const storage = mockStorage({ [key]: '[null,{},42]' });
    expect(getProjectHistory(project.id)).toEqual([]);
    expect(recordProjectVersion(project, 'saved')).toBe(true);
    expect(getProjectHistory(project.id)[0].project).toEqual(project);
    storage.setItem(key, '{}');
    expect(getProjectHistory(project.id)).toEqual([]);
  });

  it('returns validation errors for malformed imports instead of throwing', () => {
    for (const value of [
      null,
      {},
      { ...CASE_STUDIES[0], factors: [null] },
      { ...CASE_STUDIES[0], runs: [{ id: 'bad' }] },
      { ...CASE_STUDIES[0], factors: [{ ...CASE_STUDIES[0].factors[0], categories: [2] }] },
    ]) {
      expect(validateProjectTemplate(value as QBDProject).valid).toBe(false);
    }
  });

  it('rejects nonnumeric quantitative levels', () => {
    const project = structuredClone(CASE_STUDIES[0]);
    project.runs = [];
    project.factors[0].dataType = 'quantitative_multilevel';
    project.factors[0].categories = ['10', 'not-a-number'];
    expect(validateProjectTemplate(project).errors.some((error) => error.includes('số hữu hạn'))).toBe(
      true
    );
  });
});
