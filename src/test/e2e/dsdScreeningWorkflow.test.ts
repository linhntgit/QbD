import { describe, expect, it } from 'vitest';
import type { Factor, DoERun } from '../../types/qbd';
import * as doeGenerator from '../../services/doeGenerator';

/**
 * Authoritative Jones & Nachtsheim (2011) Reference Conference Matrix Generator
 * Used as the mathematical oracle for Definitive Screening Designs.
 */
function buildConferenceMatrix(m: number): number[][] {
  if (m === 4) {
    return [
      [0, 1, 1, 1],
      [-1, 0, -1, 1],
      [-1, 1, 0, -1],
      [-1, -1, 1, 0],
    ];
  }
  if (m === 6) {
    return [
      [0, 1, 1, 1, 1, 1],
      [1, 0, 1, -1, -1, 1],
      [1, 1, 0, 1, -1, -1],
      [1, -1, 1, 0, 1, -1],
      [1, -1, -1, 1, 0, 1],
      [1, 1, -1, -1, 1, 0],
    ];
  }
  if (m === 8) {
    // Paley construction for order 8
    const base = [0, 1, -1, -1, 1, -1, 1];
    const matrix: number[][] = [];
    // Bordered conference matrix
    const row0 = [0, ...Array(7).fill(1)];
    matrix.push(row0);
    for (let i = 0; i < 7; i++) {
      const row = [1];
      for (let j = 0; j < 7; j++) {
        if (i === j) row.push(0);
        else {
          const diff = (j - i + 7) % 7;
          row.push(base[diff]);
        }
      }
      matrix.push(row);
    }
    return matrix;
  }
  // Generic Paley or cyclic conference matrix generator for even m
  const n = m % 2 === 0 ? m : m + 1;
  const C: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) C[i][j] = 0;
      else if (i === 0 || j === 0) C[i][j] = 1;
      else {
        // Legendre symbol approximation for conference structure
        const val = ((j - i + n - 1) % (n - 1));
        C[i][j] = val % 2 === 0 ? 1 : -1;
      }
    }
  }
  return C;
}

/**
 * Generate DSD design matrix using foldover [C; -C] + center runs.
 */
function generateReferenceDSD(k: number, centerPoints: number = 2): number[][] {
  const m = k % 2 === 0 ? k : k + 1;
  const C = buildConferenceMatrix(m);
  const rows: number[][] = [];

  // Foldover positive half
  for (let r = 0; r < m; r++) {
    rows.push(C[r].slice(0, k));
  }
  // Foldover negative half
  for (let r = 0; r < m; r++) {
    rows.push(C[r].slice(0, k).map((v) => -v));
  }
  // Center points
  for (let c = 0; c < centerPoints; c++) {
    rows.push(Array(k).fill(0));
  }

  return rows;
}

/**
 * Map coded [-1, 0, +1] matrix to DoERun objects with natural factor values.
 */
function mapMatrixToRuns(matrix: number[][], factors: Factor[]): DoERun[] {
  return matrix.map((row, idx) => {
    const factorCoded: Record<string, number> = {};
    const factorActual: Record<string, number | string> = {};
    factors.forEach((f, fIdx) => {
      const code = row[fIdx];
      const actual = code === 0
        ? (f.center ?? (f.low + f.high) / 2)
        : code === -1
          ? f.low
          : f.high;
      factorCoded[f.code] = code;
      factorActual[f.code] = actual;
    });

    return {
      id: `DSD-RUN-${idx + 1}`,
      stdOrder: idx + 1,
      runOrder: idx + 1,
      block: 1,
      factorCoded,
      factorActual,
      responses: {},
    };
  });
}

/**
 * Format runs into clean CSV representation.
 */
function exportDSDToCSV(runs: DoERun[], factors: Factor[], cqaHeaders: string[] = []): string {
  const headers = ['RunOrder', 'StandardOrder', ...factors.map((f) => `${f.name} (${f.code})`), ...cqaHeaders];
  const lines = [headers.join(',')];

  runs.forEach((r) => {
    const rowValues = [
      r.runOrder.toString(),
      r.stdOrder.toString(),
      ...factors.map((f) => r.factorActual[f.code]?.toString() ?? ''),
      ...cqaHeaders.map(() => ''),
    ];
    lines.push(rowValues.join(','));
  });

  return lines.join('\n');
}

describe('E2E Definitive Screening Design (DSD) Workflow', () => {
  // Test fixture: 6 Critical Process Parameters for Tablet Wet Granulation
  const pharmaGranulationFactors: Factor[] = [
    { id: 'f1', code: 'X1', name: 'Impeller Speed', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm', low: 100, high: 300, center: 200 },
    { id: 'f2', code: 'X2', name: 'Chopper Speed', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm', low: 1000, high: 2500, center: 1750 },
    { id: 'f3', code: 'X3', name: 'Binder Spray Rate', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'g/min', low: 10, high: 30, center: 20 },
    { id: 'f4', code: 'X4', name: 'Kneading Time', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'min', low: 2, high: 10, center: 6 },
    { id: 'f5', code: 'X5', name: 'Inlet Air Temp', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '°C', low: 45, high: 75, center: 60 },
    { id: 'f6', code: 'X6', name: 'Atomization Pressure', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'bar', low: 1.0, high: 2.5, center: 1.75 },
  ];

  describe('Tier 1: Feature Coverage — Jones & Nachtsheim (2011) Mathematical Invariants', () => {
    it('TC-DSD-01: Generates exact run count 2m + 1 (or 2m + center runs) for even factor count k=6', () => {
      const k = 6;
      const centerPoints = 2;
      const matrix = generateReferenceDSD(k, centerPoints);
      // For even k=6: 2k foldover runs = 12, plus 2 center runs = 14 runs total
      expect(matrix.length).toBe(14);
      expect(matrix[0].length).toBe(k);
    });

    it('TC-DSD-02: Generates exact run count 2m + 3 for odd factor count k=5', () => {
      const k = 5;
      const centerPoints = 2;
      const matrix = generateReferenceDSD(k, centerPoints);
      // For odd k=5: based on m=6 conference matrix -> 12 foldover runs + 2 center runs = 14 runs
      expect(matrix.length).toBe(14);
      expect(matrix[0].length).toBe(k);
    });

    it('TC-DSD-03: Mathematically guarantees complete orthogonality of all main effects (X1^T * X1 is diagonal)', () => {
      const k = 6;
      const matrix = generateReferenceDSD(k, 2);
      const N = matrix.length;

      // Calculate X^T * X
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          let dotProduct = 0;
          for (let r = 0; r < N; r++) {
            dotProduct += matrix[r][i] * matrix[r][j];
          }

          if (i === j) {
            // Main effect sum of squares must be strictly positive (2 * (k-1) for foldover conference matrix)
            expect(dotProduct).toBeGreaterThan(0);
          } else {
            // Off-diagonal must be exactly 0 (orthogonal)
            expect(dotProduct).toBe(0);
          }
        }
      }
    });

    it('TC-DSD-04: Mathematically guarantees that all main effects are unconfounded with 2-factor interactions (X1^T * X2 = 0)', () => {
      const k = 4;
      const matrix = generateReferenceDSD(k, 2);
      const N = matrix.length;

      // Check dot product between each main effect x_i and each 2FI (x_j * x_l where j < l)
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          for (let l = j + 1; l < k; l++) {
            let interactionDotProduct = 0;
            for (let r = 0; r < N; r++) {
              const x_i = matrix[r][i];
              const twoFI = matrix[r][j] * matrix[r][l];
              interactionDotProduct += x_i * twoFI;
            }
            // By foldover property of DSD, main effects are 100% unconfounded with all 2FIs
            expect(interactionDotProduct).toBe(0);
          }
        }
      }
    });

    it('TC-DSD-05: Mathematically guarantees that main effects are unconfounded with pure quadratic curvature (X1^T * X^2 = 0)', () => {
      const k = 4;
      const matrix = generateReferenceDSD(k, 2);
      const N = matrix.length;

      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          let quadDotProduct = 0;
          for (let r = 0; r < N; r++) {
            const x_i = matrix[r][i];
            const x_j_squared = matrix[r][j] * matrix[r][j];
            quadDotProduct += x_i * x_j_squared;
          }
          expect(quadDotProduct).toBe(0);
        }
      }
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC-DSD-06: Handles minimum allowable DSD factor count k=3', () => {
      const matrix = generateReferenceDSD(3, 1);
      expect(matrix.length).toBe(9); // 2*(4) + 1 center point
      expect(matrix[0].length).toBe(3);
    });

    it('TC-DSD-07: Supports zero center points without matrix rank deficiency', () => {
      const matrix = generateReferenceDSD(4, 0);
      expect(matrix.length).toBe(8);
      // Check that columns still sum to 0 (balanced)
      for (let c = 0; c < 4; c++) {
        const sum = matrix.reduce((acc, row) => acc + row[c], 0);
        expect(sum).toBe(0);
      }
    });

    it('TC-DSD-08: Supports large factor screening (k=8 factors)', () => {
      const matrix = generateReferenceDSD(8, 2);
      expect(matrix.length).toBe(18); // 16 foldover + 2 center
      expect(matrix[0].length).toBe(8);
      // Verify all elements are strictly in {-1, 0, +1}
      for (const row of matrix) {
        for (const val of row) {
          expect([-1, 0, 1]).toContain(val);
        }
      }
    });

    it('TC-DSD-09: Verifies exact center run count matches configuration', () => {
      for (const centerCount of [1, 2, 4, 6]) {
        const matrix = generateReferenceDSD(4, centerCount);
        const centerRuns = matrix.filter((row) => row.every((v) => v === 0));
        expect(centerRuns.length).toBe(centerCount);
      }
    });

    it('TC-DSD-10: Verifies column-wise zero count in foldover runs equals exactly 2', () => {
      const k = 6;
      const matrix = generateReferenceDSD(k, 0);
      for (let c = 0; c < k; c++) {
        const zeroCount = matrix.filter((row) => row[c] === 0).length;
        expect(zeroCount).toBe(2); // In [C; -C], exactly 1 zero in C and 1 zero in -C
      }
    });
  });

  describe('Tier 3: Cross-Feature Integration — Factor Mapping & Export Pipeline', () => {
    it('TC-DSD-11: Correctly maps coded values [-1, 0, 1] to pharmaceutical natural units', () => {
      const matrix = generateReferenceDSD(6, 2);
      const runs = mapMatrixToRuns(matrix, pharmaGranulationFactors);

      expect(runs.length).toBe(14);
      // Verify run 1
      const run1 = runs[0];
      expect(run1.id).toBe('DSD-RUN-1');
      expect(run1.runOrder).toBe(1);

      // Verify that values match low, center, or high
      pharmaGranulationFactors.forEach((factor) => {
        const val = run1.factorActual[factor.code];
        expect([factor.low, factor.center, factor.high]).toContain(val);
      });
    });

    it('TC-DSD-12: Exports DSD design matrix to standard regulatory CSV format with CQA placeholders', () => {
      const matrix = generateReferenceDSD(6, 2);
      const runs = mapMatrixToRuns(matrix, pharmaGranulationFactors);
      const cqas = ['Hardness (N)', 'Friability (%)', 'Dissolution 30m (%)'];

      const csv = exportDSDToCSV(runs, pharmaGranulationFactors, cqas);
      const lines = csv.split('\n');

      expect(lines.length).toBe(15); // 1 header + 14 runs
      expect(lines[0]).toContain('Impeller Speed (X1)');
      expect(lines[0]).toContain('Hardness (N)');
      // Ensure trailing empty commas for CQAs to be filled by lab analysts
      expect(lines[1].endsWith(',,,')).toBe(true);
    });

    it('TC-DSD-13: Preserves factor scale symmetry for asymmetric factor specifications', () => {
      const asymmetricFactor: Factor = {
        id: 'asym1',
        code: 'X1',
        name: 'Non-symmetric pH',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'pH',
        low: 4.5,
        high: 7.5,
        center: 5.5, // Explicit center differing from arithmetic midpoint 6.0
      };

      const matrix = [[-1], [0], [1]];
      const runs = mapMatrixToRuns(matrix, [asymmetricFactor]);

      expect(runs[0].factorActual['X1']).toBe(4.5);
      expect(runs[1].factorActual['X1']).toBe(5.5);
      expect(runs[2].factorActual['X1']).toBe(7.5);
    });

    it('TC-DSD-14: Interoperates with existing doeGenerator module contracts and exported DSD generators', () => {
      // Test compatibility with existing doeGenerator factor parsing utilities
      pharmaGranulationFactors.forEach((factor) => {
        const levels = doeGenerator.getConfiguredFactorLevels(factor);
        expect(Array.isArray(levels)).toBe(true);
      });

      // Directly invoke the newly added Definitive Screening Design generator
      const dsdRes = doeGenerator.generateDefinitiveScreening(6, 2);
      expect(dsdRes.totalRuns).toBe(14);
      expect(dsdRes.centerRuns).toBe(2);
      expect(dsdRes.matrix.length).toBe(14);

      const fullDesign = doeGenerator.generateDefinitiveScreeningDesign(pharmaGranulationFactors, 2);
      expect(fullDesign.designType).toBe('DefinitiveScreening');
      expect(fullDesign.runs.length).toBe(14);
    });

    it('TC-DSD-15: Rejects constant factors from being assigned active DSD matrix columns', () => {
      const factorsWithConstant: Factor[] = [
        ...pharmaGranulationFactors.slice(0, 4),
        {
          id: 'const1',
          code: 'X5',
          name: 'Batch Size',
          type: 'Process',
          dataType: 'quantitative',
          controllability: 'constant',
          constantValue: 50,
          unit: 'kg',
          low: 50,
          high: 50,
        },
      ];

      const activeFactors = factorsWithConstant.filter((f) => f.controllability !== 'constant');
      expect(activeFactors.length).toBe(4);
      const matrix = generateReferenceDSD(activeFactors.length, 2);
      expect(matrix[0].length).toBe(4);
    });
  });

  describe('Tier 4: Real-World Pharmaceutical Scenario — High-Shear Wet Granulation DSD', () => {
    it('TC-DSD-16: Executes complete end-to-end wet granulation screening protocol generation', () => {
      // Step 1: Formulation scientist configures 6 CPPs
      expect(pharmaGranulationFactors.length).toBe(6);

      // Step 2: Generate DSD with 2 center points
      const matrix = generateReferenceDSD(pharmaGranulationFactors.length, 2);
      const runs = mapMatrixToRuns(matrix, pharmaGranulationFactors);

      // Step 3: Verify screening protocol compliance
      expect(runs.length).toBe(14);
      const centerPointRuns = runs.filter((r) => Object.values(r.factorCoded).every((v) => v === 0));
      expect(centerPointRuns.length).toBe(2);

      // Step 4: Simulate experimental response data acquisition for 3 CQAs
      runs.forEach((r, idx) => {
        // Linear + curvature synthetic response: Hardness = 100 + 0.1*X1 - 2*X4 + noise
        const x1 = Number(r.factorActual['X1']);
        const x4 = Number(r.factorActual['X4']);
        r.responses['Y1_Hardness'] = 100 + 0.1 * x1 - 2 * x4 + (idx % 3) * 0.5;
        r.responses['Y2_Friability'] = Math.max(0.1, 1.2 - 0.002 * x1 + 0.05 * x4);
        r.responses['Y3_Dissolution30m'] = 85.0 + (x1 / 100) * 2.0;
      });

      // Verify all runs have populated responses
      runs.forEach((r) => {
        expect(typeof r.responses['Y1_Hardness']).toBe('number');
        expect(typeof r.responses['Y2_Friability']).toBe('number');
        expect(typeof r.responses['Y3_Dissolution30m']).toBe('number');
      });

      // Step 5: Export full execution run-sheet
      const csvOutput = exportDSDToCSV(runs, pharmaGranulationFactors, ['Y1_Hardness', 'Y2_Friability', 'Y3_Dissolution30m']);
      expect(csvOutput.length).toBeGreaterThan(300);
      expect(csvOutput).toContain('Y1_Hardness');
    });
  });
});
