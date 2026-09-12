import { describe, expect, it } from 'vitest';
import type { Factor, DoEDesignConfig } from '../types/qbd';
import {
  generateDefinitiveScreening,
  generateDefinitiveScreeningDesign,
  generateDoERuns,
  validateDesignSetup,
} from '../services/doeGenerator';

describe('Definitive Screening Design (DSD - Jones & Nachtsheim 2011)', () => {
  // Helper to compute matrix transpose * matrix: X^T * Y
  function matrixMultiplyTranspose(X: number[][], Y: number[][]): number[][] {
    const n = X.length;
    const p = X[0].length;
    const q = Y[0].length;
    const result: number[][] = Array.from({ length: p }, () => new Array(q).fill(0));

    for (let j = 0; j < p; j++) {
      for (let k = 0; k < q; k++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += X[i][j] * Y[i][k];
        }
        result[j][k] = sum;
      }
    }
    return result;
  }

  // Generate all two-factor interaction columns: X_i * X_j (i < j)
  function getTwoFactorInteractions(X: number[][]): number[][] {
    const n = X.length;
    const p = X[0].length;
    const interactions: number[][] = [];

    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let a = 0; a < p; a++) {
        for (let b = a + 1; b < p; b++) {
          row.push(X[i][a] * X[i][b]);
        }
      }
      interactions.push(row);
    }
    return interactions;
  }

  // Generate all quadratic columns: X_i^2
  function getQuadraticColumns(X: number[][]): number[][] {
    return X.map((row) => row.map((val) => val * val));
  }

  describe('DSD Core Matrix Properties for Even Factor Counts (m = 4, 6, 8, 10)', () => {
    const evenTestCases = [4, 6, 8, 10];

    evenTestCases.forEach((m) => {
      it(`should construct orthogonal DSD matrix for m = ${m} factors`, () => {
        const centerPoints = 2;
        const dsd = generateDefinitiveScreening(m, centerPoints);

        // Run counts: 2m standard foldover runs + centerPoints
        expect(dsd.standardRuns).toBe(2 * m);
        expect(dsd.centerRuns).toBe(centerPoints);
        expect(dsd.totalRuns).toBe(2 * m + centerPoints);
        expect(dsd.factorsCount).toBe(m);
        expect(dsd.matrix.length).toBe(dsd.totalRuns);

        const X = dsd.matrix;

        // 1. Each factor takes only 3 levels: -1, 0, +1
        for (let r = 0; r < X.length; r++) {
          for (let c = 0; c < m; c++) {
            expect([-1, 0, 1]).toContain(X[r][c]);
          }
        }

        // 2. In standard runs, each row has exactly one 0 (center) and m-1 +/-1 entries
        for (let r = 0; r < dsd.standardRuns; r++) {
          const zerosInRow = X[r].filter((v) => v === 0).length;
          expect(zerosInRow).toBe(1);
          const nonZeros = X[r].filter((v) => Math.abs(v) === 1).length;
          expect(nonZeros).toBe(m - 1);
        }

        // 3. Center runs are all zeros
        for (let r = dsd.standardRuns; r < dsd.totalRuns; r++) {
          expect(X[r].every((v) => v === 0)).toBe(true);
        }

        // 4. Main Effects Orthogonality: X_1^T * X_1 is strictly diagonal
        const XtX = matrixMultiplyTranspose(X, X);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < m; j++) {
            if (i === j) {
              // Diagonal: 2*(m-1) because in standard runs each column has 2 zeros, remaining 2m-2 entries are +/-1
              expect(XtX[i][j]).toBe(2 * (m - 1));
            } else {
              // Off-diagonal must be exactly 0
              expect(Math.abs(XtX[i][j])).toBeLessThanOrEqual(1e-10);
            }
          }
        }

        // 5. Unconfounded with Two-Factor Interactions: X_1^T * X_2 = 0
        const X2 = getTwoFactorInteractions(X);
        const XtX2 = matrixMultiplyTranspose(X, X2);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < X2[0].length; j++) {
            expect(Math.abs(XtX2[i][j])).toBeLessThanOrEqual(1e-10);
          }
        }

        // 6. Unconfounded with Quadratic Curvature: X_1^T * (X^2) = 0
        const Xquad = getQuadraticColumns(X);
        const XtXquad = matrixMultiplyTranspose(X, Xquad);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < m; j++) {
            expect(Math.abs(XtXquad[i][j])).toBeLessThanOrEqual(1e-10);
          }
        }

        // 7. Alias Matrix A = (X_1^T X_1)^(-1) * X_1^T X_2 is identically 0
        // Since X_1^T X_2 = 0, A is identically zero matrix
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < X2[0].length; j++) {
            const aliasCoeff = XtX2[i][j] / XtX[i][i];
            expect(Math.abs(aliasCoeff)).toBeLessThanOrEqual(1e-10);
          }
        }
      });
    });
  });

  describe('DSD Core Matrix Properties for Odd Factor Counts (m = 3, 5, 7, 9)', () => {
    const oddTestCases = [3, 5, 7, 9];

    oddTestCases.forEach((m) => {
      it(`should construct DSD matrix for odd m = ${m} factors with unconfounded main effects`, () => {
        const centerPoints = 1;
        const dsd = generateDefinitiveScreening(m, centerPoints);

        // For odd m, DSD uses conference matrix of size m+1, giving 2(m+1) = 2m + 2 standard runs
        expect(dsd.standardRuns).toBe(2 * (m + 1));
        expect(dsd.centerRuns).toBe(centerPoints);
        expect(dsd.totalRuns).toBe(2 * (m + 1) + centerPoints);
        expect(dsd.factorsCount).toBe(m);

        const X = dsd.matrix;

        // All entries in {-1, 0, 1}
        for (let r = 0; r < X.length; r++) {
          for (let c = 0; c < m; c++) {
            expect([-1, 0, 1]).toContain(X[r][c]);
          }
        }

        // Main Effects Orthogonality: off-diagonals of X^T X are 0
        const XtX = matrixMultiplyTranspose(X, X);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < m; j++) {
            if (i !== j) {
              expect(Math.abs(XtX[i][j])).toBeLessThanOrEqual(1e-10);
            }
          }
        }

        // Unconfounded with 2FIs: X_1^T X_2 = 0
        const X2 = getTwoFactorInteractions(X);
        const XtX2 = matrixMultiplyTranspose(X, X2);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < X2[0].length; j++) {
            expect(Math.abs(XtX2[i][j])).toBeLessThanOrEqual(1e-10);
          }
        }

        // Unconfounded with Quadratic effects: X_1^T X^2 = 0
        const Xquad = getQuadraticColumns(X);
        const XtXquad = matrixMultiplyTranspose(X, Xquad);
        for (let i = 0; i < m; i++) {
          for (let j = 0; j < m; j++) {
            expect(Math.abs(XtXquad[i][j])).toBeLessThanOrEqual(1e-10);
          }
        }
      });
    });
  });

  describe('generateDefinitiveScreeningDesign High-Level API', () => {
    const testFactors: Factor[] = [
      {
        id: 'f1',
        code: 'X1',
        name: 'Temperature',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: '°C',
        low: 40,
        high: 80,
      },
      {
        id: 'f2',
        code: 'X2',
        name: 'Stirring Speed',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'rpm',
        low: 200,
        high: 600,
      },
      {
        id: 'f3',
        code: 'X3',
        name: 'Feed Rate',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'mL/min',
        low: 5,
        high: 15,
      },
      {
        id: 'f4',
        code: 'X4',
        name: 'Pressure',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'bar',
        low: 1,
        high: 5,
      },
    ];

    it('should generate complete DoEExperimentalDesign object with correct actual mapping', () => {
      const design = generateDefinitiveScreeningDesign(testFactors, 2, 42);

      expect(design.designType).toBe('DefinitiveScreening');
      expect(design.factorsCount).toBe(4);
      expect(design.standardRuns).toBe(8);
      expect(design.centerRuns).toBe(2);
      expect(design.totalRuns).toBe(10);
      expect(design.runs.length).toBe(10);

      // Verify that actual values correctly correspond to coded values
      design.runs.forEach((run) => {
        // Temperature: -1 -> 40, 0 -> 60, +1 -> 80
        const codedT = run.factorCoded['X1'];
        const actualT = Number(run.factorActual['X1']);
        if (codedT === -1) expect(actualT).toBeCloseTo(40, 4);
        if (codedT === 0) expect(actualT).toBeCloseTo(60, 4);
        if (codedT === 1) expect(actualT).toBeCloseTo(80, 4);

        // Stirring Speed: -1 -> 200, 0 -> 400, +1 -> 600
        const codedS = run.factorCoded['X2'];
        const actualS = Number(run.factorActual['X2']);
        if (codedS === -1) expect(actualS).toBeCloseTo(200, 4);
        if (codedS === 0) expect(actualS).toBeCloseTo(400, 4);
        if (codedS === 1) expect(actualS).toBeCloseTo(600, 4);
      });
    });

    it('should throw error when active factors < 3', () => {
      const twoFactors = testFactors.slice(0, 2);
      expect(() => generateDefinitiveScreeningDesign(twoFactors, 2, 42)).toThrow(
        'Definitive Screening Design yêu cầu ít nhất 3 yếu tố'
      );
    });

    it('should produce deterministic randomized runs when randomSeed is provided', () => {
      const design1 = generateDefinitiveScreeningDesign(testFactors, 2, 12345);
      const design2 = generateDefinitiveScreeningDesign(testFactors, 2, 12345);

      expect(design1.runs.length).toBe(design2.runs.length);
      for (let i = 0; i < design1.runs.length; i++) {
        expect(design1.runs[i].factorCoded).toEqual(design2.runs[i].factorCoded);
      }
    });
  });

  describe('Integration with generateDoERuns and validateDesignSetup', () => {
    const validFactors: Factor[] = [
      { id: '1', code: 'A', name: 'Factor A', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'g', low: 10, high: 20 },
      { id: '2', code: 'B', name: 'Factor B', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'g', low: 5, high: 15 },
      { id: '3', code: 'C', name: 'Factor C', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'g', low: 1, high: 3 },
    ];

    it('should validate DSD setup successfully for 3 or more continuous factors', () => {
      const config: DoEDesignConfig = {
        designType: 'DefinitiveScreening',
        category: 'Screening',
        centerPoints: 2,
        replicates: 1,
        randomized: false,
      };

      const validation = validateDesignSetup(validFactors, config);
      expect(validation.isValid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject DSD when fewer than 3 factors are provided', () => {
      const config: DoEDesignConfig = {
        designType: 'DefinitiveScreening',
        category: 'Screening',
        centerPoints: 2,
        replicates: 1,
        randomized: false,
      };

      const validation = validateDesignSetup(validFactors.slice(0, 2), config);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Definitive Screening Design cần ít nhất 3 yếu tố'))).toBe(true);
    });

    it('should reject DSD when mixture factors are included', () => {
      const mixFactors: Factor[] = [
        ...validFactors.slice(0, 2),
        { id: 'm1', code: 'M1', name: 'Solvent', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 10, high: 50 },
      ];

      const config: DoEDesignConfig = {
        designType: 'DefinitiveScreening',
        category: 'Screening',
        centerPoints: 2,
        replicates: 1,
        randomized: false,
      };

      const validation = validateDesignSetup(mixFactors, config);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes('không áp dụng cho biến hỗn hợp'))).toBe(true);
    });

    it('should generate DSD runs properly through generateDoERuns', () => {
      const config: DoEDesignConfig = {
        designType: 'DefinitiveScreening',
        category: 'Screening',
        centerPoints: 3,
        replicates: 1,
        randomized: false,
      };

      const result = generateDoERuns(validFactors, config);
      // For m=3, standard = 8, center = 3 -> 11 total runs
      expect(result.runs.length).toBe(11);
      expect(result.runs[0].factorCoded).toBeDefined();
      expect(result.runs[0].factorActual).toBeDefined();
    });
  });
});
