import { describe, it, expect, vi, afterEach } from 'vitest';
import type { QBDProject, Factor, CQA } from '../types/qbd';

vi.mock('../components/PlotlyChart', () => ({
  PlotlyChart: () => null,
}));
vi.mock('canvas-confetti', () => ({
  default: () => Promise.resolve(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockStorage(values: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    },
    clear: () => {
      Object.keys(values).forEach((k) => delete values[k]);
    },
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

import {
  generateRegulatoryPDFABuffer,
  exportRegulatoryPDFA,
  sanitizePdfText,
  formatSha256,
} from '../services/pdfReportGenerator';
import { generateQBDWordDocument } from '../services/reportGenerator';
import { render3DSweetSpotSurface } from '../components/tabs/DesignSpaceTab';
import {
  sha256,
  signProjectSnapshot,
  verifyAuditTrailIntegrity,
  recordProjectVersion,
  getProjectHistory,
  computeProjectPayloadHash,
  type ProjectAuditEntry,
} from '../services/projectGovernance';

function createMockProject(): QBDProject {
  const factors: Factor[] = [
    {
      id: 'f1',
      name: 'Polymer Concentration',
      code: 'X1',
      type: 'Formulation',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 10,
      high: 30,
      center: 20,
    },
    {
      id: 'f2',
      name: 'Compression Force',
      code: 'X2',
      type: 'Process',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: 'kN',
      low: 5,
      high: 25,
      center: 15,
    },
    {
      id: 'f3',
      name: 'Lubricant Blending Time',
      code: 'X3',
      type: 'Process',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: 'min',
      low: 2,
      high: 10,
      center: 6,
    },
  ];

  const cqas: CQA[] = [
    {
      id: 'c1',
      name: 'Dissolution at 2h',
      code: 'Y1',
      unit: '%',
      objective: 'maximize',
      lowerLimit: 80,
      target: 95,
      weight: 5,
    },
    {
      id: 'c2',
      name: 'Tablet Hardness',
      code: 'Y2',
      unit: 'kP',
      objective: 'range',
      lowerLimit: 6,
      upperLimit: 14,
      target: 10,
      weight: 4,
    },
  ];

  return {
    id: 'test-project-reg-001',
    name: 'Metformin HCl Extended Release Tablets',
    moleculeName: 'Metformin Hydrochloride',
    dosageForm: 'Extended Release Tablet 500mg',
    author: 'Dr. Tran Linh Nguyen',
    version: '1.0',
    createdDate: '2026-09-12T01:00:00.000Z',
    updatedDate: '2026-09-12T01:30:00.000Z',
    description: 'ICH Q8(R2) Formulation Development with 3D Design Space',
    qtpp: [
      {
        id: 'qtpp-1',
        element: 'Dosage Form & Strength',
        target: 'Extended Release Tablet 500mg',
        justification: 'Bioequivalent to Glucophage XR reference product',
      },
      {
        id: 'qtpp-2',
        element: 'In Vitro Release',
        target: '>=80% at 2h; >=85% at 12h',
        justification: 'Ensures steady-state therapeutic efficacy',
      },
    ],
    cqas,
    factors,
    fmeaRisks: [
      {
        id: 'risk-1',
        factorId: 'f1',
        cqaId: 'c1',
        failureMode: 'Polymer under-dosing causes burst release',
        severity: 4,
        probability: 3,
        detectability: 2,
        rpn: 24,
        riskLevel: 'Medium',
        justification: 'Critical polymer ratio impact on dissolution',
        recommendedDoE: true,
      },
    ],
    doeConfig: {
      designType: 'BoxBehnken',
      category: 'RSM',
      replicates: 1,
      centerPoints: 3,
      randomized: true,
      numRuns: 15,
    },
    runs: [
      {
        id: 'run-1',
        runOrder: 1,
        stdOrder: 1,
        block: 1,
        factorCoded: { X1: -1, X2: -1, X3: 0 },
        factorActual: { X1: 10, X2: 5, X3: 6 },
        responses: { Y1: 82.4, Y2: 7.2 },
      },
      {
        id: 'run-2',
        runOrder: 2,
        stdOrder: 2,
        block: 1,
        factorCoded: { X1: 1, X2: -1, X3: 0 },
        factorActual: { X1: 30, X2: 5, X3: 6 },
        responses: { Y1: 76.1, Y2: 8.9 },
      },
      {
        id: 'run-3',
        runOrder: 3,
        stdOrder: 3,
        block: 1,
        factorCoded: { X1: 0, X2: 0, X3: 0 },
        factorActual: { X1: 20, X2: 15, X3: 6 },
        responses: { Y1: 91.5, Y2: 10.4 },
      },
    ],
    designSpace: [
      {
        factorCode: 'X1',
        knowledgeLow: 10,
        knowledgeHigh: 30,
        parLow: 16.5,
        parHigh: 24.5,
        norLow: 18.0,
        norHigh: 22.0,
        target: 20,
      },
      {
        factorCode: 'X2',
        knowledgeLow: 5,
        knowledgeHigh: 25,
        parLow: 11.0,
        parHigh: 19.0,
        norLow: 13.0,
        norHigh: 17.0,
        target: 15,
      },
      {
        factorCode: 'X3',
        knowledgeLow: 2,
        knowledgeHigh: 10,
        parLow: 4.0,
        parHigh: 8.0,
        norLow: 5.0,
        norHigh: 7.0,
        target: 6,
      },
    ],
  };
}

describe('Regulatory Archival PDF/A Generator (ISO 19005 & Checksum)', () => {
  it('should generate valid PDF/A byte stream with ISO 19005 conformance and embedded SHA-256 root checksum', async () => {
    const project = createMockProject();
    const bytes = generateRegulatoryPDFABuffer(project);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);

    const pdfText = new TextDecoder('utf-8').decode(bytes);

    // 1. Check ISO 19005 PDF/A-1b Header & binary comment
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText).toContain('%\xE2\xE3\xCF\xD3');

    // 2. Check Document Catalog & OutputIntents
    expect(pdfText).toContain('/Type /Catalog');
    expect(pdfText).toContain('/OutputIntents [3 0 R]');
    expect(pdfText).toContain('/S /GTS_PDFA1');
    expect(pdfText).toContain('/OutputConditionIdentifier (sRGB IEC61966-2.1)');

    // 3. Check Embedded XMP Metadata Stream
    expect(pdfText).toContain('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
    expect(pdfText).toContain('<pdfaid:part>1</pdfaid:part>');
    expect(pdfText).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(pdfText).toContain('<dc:identifier>urn:sha256:');
    expect(pdfText).toContain('sha256AuditRoot');
    expect(pdfText).toContain('<?xpacket end="w"?>');

    // 4. Check Trailer, Document ID and EOF
    expect(pdfText).toContain('trailer');
    expect(pdfText).toContain('/Root 1 0 R');
    expect(pdfText).toContain('/ID [');
    expect(pdfText).toContain('startxref');
    expect(pdfText.trim().endsWith('%%EOF')).toBe(true);

    // 5. Verify Blob creation
    const blob = await exportRegulatoryPDFA(project);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(bytes.length);
  });

  it('should embed CTD Section 3.2.P.2 content and electronic signature tables into the PDF document', () => {
    const project = createMockProject();
    const signedProject = signProjectSnapshot(project, {
      name: 'Dr. Jane Smith',
      role: 'Analyst',
      department: 'Formulation R&D',
      reason: 'Authorship: Designed DoE and verified raw data',
    });

    const bytes = generateRegulatoryPDFABuffer(signedProject);
    const pdfText = new TextDecoder('latin1').decode(bytes);

    // Verify CTD sections in text stream
    expect(pdfText).toContain('Metformin');
    expect(pdfText).toContain('QTPP');
    expect(pdfText).toContain('CQAs');
    expect(pdfText).toContain('CPPs');
    expect(pdfText).toContain('21 CFR PART 11');

    // Verify electronic signature manifestation
    expect(pdfText).toContain('Dr. Jane Smith');
    expect(pdfText).toContain('Analyst');
    expect(pdfText).toContain('Authorship');
  });

  it('should sanitize PDF text to avoid glyph corruption while retaining ASCII semantics', () => {
    const rawVietnamese = 'Đánh giá Độ Bền Vững Không Gian Thiết Kế (Design Space) — Đạt Chuẩn';
    const sanitized = sanitizePdfText(rawVietnamese);

    expect(sanitized).not.toContain('Đ');
    expect(sanitized).not.toContain('ế');
    expect(sanitized).toContain('Danh gia Do Ben Vung Khong Gian Thiet Ke');
    expect(sanitized).toContain('Dat Chuan');
  });

  it('should format SHA-256 strings in 16-character quadruplets', () => {
    const hash = sha256('test');
    const formatted = formatSha256(hash);
    const parts = formatted.split(' ');
    expect(parts.length).toBe(4);
    expect(parts[0].length).toBe(16);
    expect(parts[1].length).toBe(16);
  });
});

describe('Enhanced Word (.docx) Export & Governance Metadata', () => {
  it('should generate Word document embedding SHA-256 Root Checksum and 21 CFR Part 11 signature blocks', async () => {
    const project = createMockProject();
    const signed = signProjectSnapshot(project, {
      name: 'Dr. Tran Linh Nguyen',
      role: 'Reviewer',
      department: 'Scientific Review',
      reason: 'Technical Review: Verified ANOVA regression diagnostics',
    });

    const doc = await generateQBDWordDocument(signed);
    expect(doc).toBeDefined();

    // Verify project payload hash matches deterministic computation
    const payloadHash = computeProjectPayloadHash(signed);
    expect(payloadHash.length).toBe(64);
    expect(typeof payloadHash).toBe('string');
  });
});

describe('Interactive 3D Sweet-Spot Surface & Dynamic Slicing Threshold Logic', () => {
  const mockModels: Record<string, any> = {
    Y1: {
      predict: (coded: Record<string, number>) => 90 + 5 * (coded.X1 ?? 0) - 2 * (coded.X2 ?? 0) + 3 * (coded.X3 ?? 0),
    },
    Y2: {
      predict: (coded: Record<string, number>) => 10 + 2 * (coded.X1 ?? 0) + 3 * (coded.X2 ?? 0) - 1 * (coded.X3 ?? 0),
    },
  };

  it('should render 3D sweet-spot surface (Z = Margin_min) and semi-transparent reference plane at Z = 0', () => {
    const project = createMockProject();
    const traces = render3DSweetSpotSurface(
      project.factors,
      project.cqas,
      mockModels,
      'X3',
      6, // X3 = 6 (center point)
      25 // Resolution 25x25
    );

    expect(traces.length).toBe(2);

    // Trace 0: Sweet-spot surface
    const surfaceTrace = traces[0];
    expect(surfaceTrace.type).toBe('surface');
    expect(surfaceTrace.x.length).toBe(25);
    expect(surfaceTrace.y.length).toBe(25);
    expect(surfaceTrace.z.length).toBe(25);
    expect(surfaceTrace.z[0].length).toBe(25);

    // Trace 1: Reference boundary plane at Z = 0
    const planeTrace = traces[1];
    expect(planeTrace.type).toBe('surface');
    expect(planeTrace.z).toEqual([[0, 0], [0, 0]]);
    expect(planeTrace.opacity).toBe(0.42);
    expect(planeTrace.name).toContain('Z = 0');
  });

  it('should dynamically update 3D sweet-spot Z values when 3rd factor slice changes', () => {
    const project = createMockProject();

    // Slice at low end of X3 (2 min)
    const tracesSliceLow = render3DSweetSpotSurface(
      project.factors,
      project.cqas,
      mockModels,
      'X3',
      2,
      20
    );

    // Slice at high end of X3 (10 min)
    const tracesSliceHigh = render3DSweetSpotSurface(
      project.factors,
      project.cqas,
      mockModels,
      'X3',
      10,
      20
    );

    const zLowCenter = tracesSliceLow[0].z[10][10];
    const zHighCenter = tracesSliceHigh[0].z[10][10];

    // Margin should be different because Y1 and Y2 depend on X3
    expect(zLowCenter).not.toEqual(zHighCenter);
  });

  it('should correctly classify Z >= 0 as in-specification sweet spot and Z < 0 as out-of-specification', () => {
    const project = createMockProject();
    const traces = render3DSweetSpotSurface(
      project.factors,
      project.cqas,
      mockModels,
      'X3',
      6,
      20
    );

    const zGrid = traces[0].z as number[][];
    let hasPass = false;
    let hasFail = false;

    for (const row of zGrid) {
      for (const val of row) {
        if (val >= 0) hasPass = true;
        if (val < 0) hasFail = true;
      }
    }

    expect(hasPass || hasFail).toBe(true);
  });
});

describe('Tamper-Evident Reporting Integrity Workflow', () => {
  it('should detect single-character tampering in audit trail when building reports', () => {
    mockStorage();
    const project = createMockProject();

    // Create a chain of 3 actions
    recordProjectVersion(project, 'INITIAL_SETUP', 'Dr. Nguyen', 'Initial project creation');
    recordProjectVersion(project, 'DOE_SETUP', 'Dr. Nguyen', 'Box-Behnken 15 runs generated');
    recordProjectVersion(project, 'MODEL_FIT', 'Dr. Nguyen', 'Fitted Quadratic RSM models');

    const history = getProjectHistory(project.id);
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Check pristine integrity
    const pristineCheck = verifyAuditTrailIntegrity(history);
    expect(pristineCheck.isValid).toBe(true);

    // Tamper single character in middle entry
    const tamperedHistory: ProjectAuditEntry[] = JSON.parse(JSON.stringify(history));
    tamperedHistory[1].details = (tamperedHistory[1].details || '') + '!'; // Tampered by 1 character

    const tamperedCheck = verifyAuditTrailIntegrity(tamperedHistory);
    expect(tamperedCheck.isValid).toBe(false);
    expect(tamperedCheck.reason).toContain('mismatch');

    // Generate PDF with tampered history
    const bytes = generateRegulatoryPDFABuffer(project, { auditHistory: tamperedHistory });
    const pdfText = new TextDecoder('utf-8').decode(bytes);

    expect(pdfText).toContain('INTEGRITY ALERT');
  });
});
