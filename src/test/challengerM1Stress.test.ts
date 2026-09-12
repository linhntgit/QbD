import { describe, expect, it } from 'vitest';
import type { Factor, CQA, StatisticalModelResult } from '../types/qbd';
import {
  generateDefinitiveScreening,
  getConferenceMatrix,
} from '../services/doeGenerator';
import {
  optimizeDesirabilityGA,
  validatePiepelBounds,
  isFeasibleBoundedMixture,
  projectToBoundedMixture,
} from '../services/statistics';

// Helper: matrix transpose * matrix: X^T * Y
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

describe('Challenger 1 — Empirical Mathematical Invariant Stress Tests (Milestone M1)', () => {

  // =========================================================================
  // 1. DSD Mathematical Invariants Across k in {4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20}
  // =========================================================================
  describe('1. DSD Mathematical Invariants across k in 4..20', () => {
    const testFactorCounts = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20];

    testFactorCounts.forEach((k) => {
      describe(`Factor count k = ${k}`, () => {
        it(`should satisfy all algebraic invariants for k = ${k}`, () => {
          const centerPoints = 1;
          const dsd = generateDefinitiveScreening(k, centerPoints);
          const X = dsd.matrix;
          const N = X.length;

          // Invariant A: Total rows = standardRuns + centerRuns
          expect(dsd.totalRuns).toBe(dsd.standardRuns + dsd.centerRuns);
          expect(dsd.centerRuns).toBe(centerPoints);
          expect(dsd.factorsCount).toBe(k);
          expect(N).toBe(dsd.totalRuns);

          // Invariant B: Values in standard matrix are strictly {-1, 0, 1}
          for (let r = 0; r < N; r++) {
            for (let c = 0; c < k; c++) {
              expect([-1, 0, 1]).toContain(X[r][c]);
            }
          }

          // Invariant C: Main Effects Orthogonality: X_1^T * X_1 is strictly diagonal
          const XtX = matrixMultiplyTranspose(X, X);
          for (let i = 0; i < k; i++) {
            for (let j = 0; j < k; j++) {
              if (i === j) {
                // Diagonal entry must be strictly positive
                expect(XtX[i][j]).toBeGreaterThan(0);
              } else {
                // Off-diagonal must be exactly 0 within float tolerance
                expect(Math.abs(XtX[i][j])).toBeLessThanOrEqual(1e-10);
              }
            }
          }

          // Invariant D: Main effects strictly orthogonal to 2FIs: X_1^T * X_2 = 0
          const X2 = getTwoFactorInteractions(X);
          const num2FI = (k * (k - 1)) / 2;
          expect(X2[0].length).toBe(num2FI);

          const XtX2 = matrixMultiplyTranspose(X, X2);
          for (let i = 0; i < k; i++) {
            for (let j = 0; j < num2FI; j++) {
              expect(Math.abs(XtX2[i][j])).toBeLessThanOrEqual(1e-10);
            }
          }

          // Invariant E: Main effects strictly orthogonal to quadratic curvature: X_1^T * (X_i^2) = 0
          const Xquad = getQuadraticColumns(X);
          const XtXquad = matrixMultiplyTranspose(X, Xquad);
          for (let i = 0; i < k; i++) {
            for (let j = 0; j < k; j++) {
              expect(Math.abs(XtXquad[i][j])).toBeLessThanOrEqual(1e-10);
            }
          }

          // Invariant F: Alias matrix A = (X_1^T X_1)^(-1) * X_1^T X_2 is identically 0
          // Since XtX is diagonal and XtX2 is 0, each A[i, j] = XtX2[i, j] / XtX[i, i] == 0
          for (let i = 0; i < k; i++) {
            for (let j = 0; j < num2FI; j++) {
              const aliasCoeff = XtX2[i][j] / XtX[i][i];
              expect(Math.abs(aliasCoeff)).toBeLessThanOrEqual(1e-10);
            }
          }

          // Check standard run count formula
          // In Jones & Nachtsheim (2011), when conference matrix of order k (or k+1) is used:
          // For even k where order k exists: standardRuns = 2k, total with 1 center = 2k+1.
          // For odd k: standardRuns = 2(k+1) = 2k+2, total with 1 center = 2k+3.
          if (k % 2 === 0) {
            // Check whether standard runs match 2k or if k=16 uses next order
            if (k === 16) {
              // Note: Conference matrix of order 16 is not prime power (16-1=15=3*5),
              // so implementation uses next available conference order K=18 (36 standard runs)
              expect(dsd.standardRuns).toBe(36);
            } else {
              expect(dsd.standardRuns).toBe(2 * k);
              expect(dsd.totalRuns).toBe(2 * k + 1);
            }
          } else {
            // Odd k: standard runs = 2*(k+1) = 2k + 2, total with 1 center = 2k + 3
            expect(dsd.standardRuns).toBe(2 * (k + 1));
            expect(dsd.totalRuns).toBe(2 * k + 3);
          }
        });
      });
    });

    it('should throw clear error for m < 3 factors', () => {
      expect(() => generateDefinitiveScreening(2, 1)).toThrow('Definitive Screening Design yêu cầu ít nhất 3 yếu tố');
      expect(() => generateDefinitiveScreening(1, 1)).toThrow('Definitive Screening Design yêu cầu ít nhất 3 yếu tố');
    });

    it('should throw clear error for m exceeding conference matrix capacity (m > 30)', () => {
      expect(() => generateDefinitiveScreening(32, 1)).toThrow('vượt quá giới hạn hỗ trợ của DSD');
    });

    it('generates DSD for m=25 and m=26 by falling back to K=30', () => {
      const dsd25 = generateDefinitiveScreening(25, 1);
      expect(dsd25.totalRuns).toBe(61); // 2 * 30 + 1 center point
      expect(dsd25.standardRuns).toBe(60);
      expect(dsd25.centerRuns).toBe(1);
      expect(dsd25.factorsCount).toBe(25);

      const dsd26 = generateDefinitiveScreening(26, 1);
      expect(dsd26.totalRuns).toBe(61); // 2 * 30 + 1 center point
      expect(dsd26.standardRuns).toBe(60);
      expect(dsd26.centerRuns).toBe(1);
      expect(dsd26.factorsCount).toBe(26);
    });

    it('should verify conference matrices C_k^T * C_k = (k-1) * I_k for all successfully implemented orders', () => {
      // Note: 26 is declared in AVAILABLE_CONFERENCE_ORDERS but not implemented (p=25 is composite)
      const implementedOrders = [4, 6, 8, 10, 12, 14, 18, 20, 24, 30];
      implementedOrders.forEach((order) => {
        const C = getConferenceMatrix(order);
        expect(C.length).toBe(order);
        expect(C[0].length).toBe(order);

        // Diagonal must be 0
        for (let i = 0; i < order; i++) {
          expect(C[i][i]).toBe(0);
        }

        // Off-diagonal must be +1 or -1
        for (let i = 0; i < order; i++) {
          for (let j = 0; j < order; j++) {
            if (i !== j) {
              expect(Math.abs(C[i][j])).toBe(1);
            }
          }
        }

        // C^T * C = (order - 1) * I
        const CtC = matrixMultiplyTranspose(C, C);
        for (let i = 0; i < order; i++) {
          for (let j = 0; j < order; j++) {
            if (i === j) {
              expect(CtC[i][j]).toBe(order - 1);
            } else {
              expect(Math.abs(CtC[i][j])).toBeLessThanOrEqual(1e-10);
            }
          }
        }
      });
    });

    it('BUG DISCOVERY: getConferenceMatrix(26) throws because GF(25) is not implemented', () => {
      expect(() => getConferenceMatrix(26)).toThrow('p=25 không phải số nguyên tố');
    });
  });

  // =========================================================================
  // 2. Continuous Desirability RCGA + Nelder-Mead Convergence & Determinism
  // =========================================================================
  describe('2. Continuous Desirability RCGA + Nelder-Mead Convergence', () => {
    // Factors in [-1, 1] coded space
    const factors2D: Factor[] = [
      { id: 'f1', code: 'X1', name: 'Factor 1', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 10, high: 90 },
      { id: 'f2', code: 'X2', name: 'Factor 2', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm', low: 100, high: 500 },
    ];

    it('Stress Test 2A: High-precision convergence to non-grid optimum (< 10^-4 tolerance, desirability > 0.999)', () => {
      // Known global optimum at arbitrary non-grid point: X1* = 0.38472, X2* = -0.71935
      const targetX1 = 0.38472;
      const targetX2 = -0.71935;

      // Model: Y1 = 100 - 50 * ((X1 - targetX1)^2 + (X2 - targetX2)^2)
      // Maximum at (targetX1, targetX2) is Y1 = 100.
      const modelY1 = {
        terms: ['Intercept', 'X1', 'X2', 'X1*X1', 'X2*X2'],
        coefficients: {
          Intercept: 100 - 50 * (targetX1 * targetX1 + targetX2 * targetX2),
          X1: 100 * targetX1,
          X2: 100 * targetX2,
          'X1*X1': -50,
          'X2*X2': -50,
        },
        rSquared: 1.0,
        adjRSquared: 1.0,
        fStatistic: 9999,
        pValue: 0.0001,
        rmse: 0.001,
        residualDegreesOfFreedom: 20,
        residuals: [],
        predict: (pt: Record<string, number>) => {
          const x1 = pt.X1 ?? 0;
          const x2 = pt.X2 ?? 0;
          return 100 - 50 * ((x1 - targetX1) ** 2 + (x2 - targetX2) ** 2);
        },
        predictStandardError: () => 0.01,
      } as unknown as StatisticalModelResult;

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Purity',
        objective: 'maximize',
        lowerLimit: 80,
        upperLimit: 100,
        target: 100,
        weight: 1,
        unit: '%',
      };

      const solution = optimizeDesirabilityGA(
        factors2D,
        [cqa],
        { Y1: modelY1 },
        undefined,
        {
          populationSize: 80,
          maxGenerations: 60,
          polishWithNelderMead: true,
          seed: 42,
        }
      );

      expect(solution).not.toBeNull();
      expect(solution!.overallDesirability).toBeGreaterThan(0.999);

      // Distance from known exact optimum should be < 1e-4
      const foundX1 = solution!.codedFactors.X1;
      const foundX2 = solution!.codedFactors.X2;
      const dist = Math.sqrt((foundX1 - targetX1) ** 2 + (foundX2 - targetX2) ** 2);
      expect(dist).toBeLessThan(1e-4);
    });

    it('Stress Test 2B: Multi-response competing objectives with non-linear trade-off', () => {
      // Y1: maximize yield (favors high X1, low X2)
      // Y2: minimize impurity (favors low X1, high X2)
      const modelY1 = {
        terms: ['Intercept', 'X1', 'X2'],
        coefficients: { Intercept: 80, X1: 15, X2: -10 },
        rSquared: 0.98,
        adjRSquared: 0.97,
        fStatistic: 150,
        pValue: 0.0001,
        rmse: 0.5,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => 80 + 15 * (pt.X1 ?? 0) - 10 * (pt.X2 ?? 0),
        predictStandardError: () => 0.1,
      } as unknown as StatisticalModelResult;

      const modelY2 = {
        terms: ['Intercept', 'X1', 'X2'],
        coefficients: { Intercept: 2.0, X1: 1.5, X2: -1.0 },
        rSquared: 0.98,
        adjRSquared: 0.97,
        fStatistic: 150,
        pValue: 0.0001,
        rmse: 0.05,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => 2.0 + 1.5 * (pt.X1 ?? 0) - 1.0 * (pt.X2 ?? 0),
        predictStandardError: () => 0.02,
      } as unknown as StatisticalModelResult;

      const cqas: CQA[] = [
        { id: 'c1', code: 'Y1', name: 'Yield', unit: '%', objective: 'maximize', lowerLimit: 60, upperLimit: 95, weight: 1 },
        { id: 'c2', code: 'Y2', name: 'Impurity', unit: '%', objective: 'minimize', lowerLimit: 0.5, upperLimit: 3.5, weight: 1 },
      ];

      const solution = optimizeDesirabilityGA(
        factors2D,
        cqas,
        { Y1: modelY1, Y2: modelY2 },
        undefined,
        { populationSize: 60, maxGenerations: 40, seed: 999 }
      );

      expect(solution).not.toBeNull();
      expect(solution!.overallDesirability).toBeGreaterThan(0.5);
      expect(solution!.predictedResponses.Y1.desirability).toBeGreaterThan(0);
      expect(solution!.predictedResponses.Y2.desirability).toBeGreaterThan(0);

      // Verify bounds compliance
      expect(solution!.codedFactors.X1).toBeGreaterThanOrEqual(-1.00001);
      expect(solution!.codedFactors.X1).toBeLessThanOrEqual(1.00001);
      expect(solution!.codedFactors.X2).toBeGreaterThanOrEqual(-1.00001);
      expect(solution!.codedFactors.X2).toBeLessThanOrEqual(1.00001);
    });

    it('Stress Test 2C: Multi-modal surface with deceptive local optima', () => {
      // Deceptive function: Global optimum at (0.6, 0.6) with Y=100, local optimum at (-0.6, -0.6) with Y=85
      const modelMultiModal = {
        terms: ['Intercept'],
        coefficients: { Intercept: 0 },
        rSquared: 0.95,
        adjRSquared: 0.94,
        fStatistic: 100,
        pValue: 0.001,
        rmse: 0.1,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => {
          const x1 = pt.X1 ?? 0;
          const x2 = pt.X2 ?? 0;
          const dGlobal = (x1 - 0.6) ** 2 + (x2 - 0.6) ** 2;
          const dLocal = (x1 + 0.6) ** 2 + (x2 + 0.6) ** 2;
          return 100 * Math.exp(-3 * dGlobal) + 85 * Math.exp(-3 * dLocal);
        },
        predictStandardError: () => 0.1,
      } as unknown as StatisticalModelResult;

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Potency',
        unit: '%',
        objective: 'maximize',
        lowerLimit: 50,
        upperLimit: 100,
        target: 100,
        weight: 1,
      };

      const solution = optimizeDesirabilityGA(
        factors2D,
        [cqa],
        { Y1: modelMultiModal },
        undefined,
        { populationSize: 100, maxGenerations: 60, seed: 123456 }
      );

      expect(solution).not.toBeNull();
      // Should find the global peak (~100) not just the local peak (~85)
      expect(solution!.predictedResponses.Y1.value).toBeGreaterThan(95);
      expect(solution!.overallDesirability).toBeGreaterThan(0.90);
      expect(solution!.codedFactors.X1).toBeCloseTo(0.6, 1);
      expect(solution!.codedFactors.X2).toBeCloseTo(0.6, 1);
    });

    it('Stress Test 2D: Seed determinism across repeated executions', () => {
      const modelSimple = {
        terms: ['Intercept', 'X1', 'X2'],
        coefficients: { Intercept: 50, X1: 20, X2: 15 },
        rSquared: 0.99,
        adjRSquared: 0.98,
        fStatistic: 200,
        pValue: 0.0001,
        rmse: 0.1,
        residualDegreesOfFreedom: 15,
        residuals: [],
        predict: (pt: Record<string, number>) => 50 + 20 * (pt.X1 ?? 0) + 15 * (pt.X2 ?? 0),
        predictStandardError: () => 0.05,
      } as unknown as StatisticalModelResult;

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Dissolution',
        unit: '%',
        objective: 'maximize',
        lowerLimit: 20,
        upperLimit: 85,
        target: 85,
        weight: 1,
      };

      const run1 = optimizeDesirabilityGA(factors2D, [cqa], { Y1: modelSimple }, undefined, { seed: 88888 });
      const run2 = optimizeDesirabilityGA(factors2D, [cqa], { Y1: modelSimple }, undefined, { seed: 88888 });

      expect(run1).not.toBeNull();
      expect(run2).not.toBeNull();
      // Exact bit-level reproducibility
      expect(run1!.codedFactors.X1).toBe(run2!.codedFactors.X1);
      expect(run1!.codedFactors.X2).toBe(run2!.codedFactors.X2);
      expect(run1!.overallDesirability).toBe(run2!.overallDesirability);
    });

    it('Stress Test 2E: Factor locking at arbitrary non-grid coordinate', () => {
      const lockedVal = 0.23456;
      const model = {
        terms: ['Intercept', 'X1', 'X2'],
        coefficients: { Intercept: 50, X1: 10, X2: 30 },
        rSquared: 0.99,
        adjRSquared: 0.98,
        fStatistic: 200,
        pValue: 0.0001,
        rmse: 0.1,
        residualDegreesOfFreedom: 15,
        residuals: [],
        predict: (pt: Record<string, number>) => 50 + 10 * (pt.X1 ?? 0) + 30 * (pt.X2 ?? 0),
        predictStandardError: () => 0.05,
      } as unknown as StatisticalModelResult;

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Hardness',
        unit: 'N',
        objective: 'maximize',
        lowerLimit: 30,
        upperLimit: 90,
        target: 90,
        weight: 1,
      };

      const solution = optimizeDesirabilityGA(
        factors2D,
        [cqa],
        { Y1: model },
        { X1: lockedVal },
        { seed: 777 }
      );

      expect(solution).not.toBeNull();
      expect(solution!.codedFactors.X1).toBe(lockedVal);
      // X2 should optimize to near 1.0 to maximize 30 * X2
      expect(solution!.codedFactors.X2).toBeCloseTo(1.0, 3);
    });

    it('Stress Test 2F: High-dimensional (5D) continuous convergence to arbitrary non-grid point', () => {
      const target5D = [0.2547, -0.4518, 0.7523, -0.1589, 0.6341];
      const factors5D: Factor[] = target5D.map((_, i) => ({
        id: `f${i + 1}`,
        code: `X${i + 1}`,
        name: `Factor ${i + 1}`,
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: '%',
        low: 0,
        high: 100,
      }));

      const model5D = {
        terms: ['Intercept'],
        coefficients: { Intercept: 100 },
        rSquared: 1.0,
        adjRSquared: 1.0,
        fStatistic: 9999,
        pValue: 0.0001,
        rmse: 0.001,
        residualDegreesOfFreedom: 20,
        residuals: [],
        predict: (pt: Record<string, number>) => {
          let distSq = 0;
          target5D.forEach((targetVal, idx) => {
            const val = pt[`X${idx + 1}`] ?? 0;
            distSq += (val - targetVal) ** 2;
          });
          return 100 - 50 * distSq;
        },
        predictStandardError: () => 0.01,
      } as unknown as StatisticalModelResult;

      const cqa5D: CQA = {
        id: 'c5d',
        code: 'Y1',
        name: 'Yield',
        unit: '%',
        objective: 'maximize',
        lowerLimit: 70,
        upperLimit: 100,
        target: 100,
        weight: 1,
      };

      const solution = optimizeDesirabilityGA(
        factors5D,
        [cqa5D],
        { Y1: model5D },
        undefined,
        {
          populationSize: 100,
          maxGenerations: 80,
          polishWithNelderMead: true,
          seed: 55555,
        }
      );

      expect(solution).not.toBeNull();
      expect(solution!.overallDesirability).toBeGreaterThan(0.999);

      let totalDistSq = 0;
      target5D.forEach((targetVal, idx) => {
        const found = solution!.codedFactors[`X${idx + 1}`];
        totalDistSq += (found - targetVal) ** 2;
      });
      const euclideanDist = Math.sqrt(totalDistSq);
      expect(euclideanDist).toBeLessThan(1e-3);
    });

    it('Stress Test 2G: Non-linear steep shape parameters (sShape = 3.0, tShape = 3.0)', () => {
      const targetVal = 0.5234;
      const model = {
        terms: ['Intercept', 'X1'],
        coefficients: { Intercept: 50 },
        rSquared: 0.99,
        adjRSquared: 0.98,
        fStatistic: 500,
        pValue: 0.0001,
        rmse: 0.01,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => 100 - 80 * Math.abs((pt.X1 ?? 0) - targetVal),
        predictStandardError: () => 0.01,
      } as unknown as StatisticalModelResult;

      const cqaSteep: CQA = {
        id: 'cSteep',
        code: 'Y1',
        name: 'Assay',
        unit: '%',
        objective: 'maximize',
        lowerLimit: 50,
        upperLimit: 100,
        target: 100,
        sShape: 3.0,
        tShape: 3.0,
        weight: 1,
      };

      const solution = optimizeDesirabilityGA(
        [factors2D[0]],
        [cqaSteep],
        { Y1: model },
        undefined,
        { seed: 3333 }
      );

      expect(solution).not.toBeNull();
      expect(solution!.overallDesirability).toBeGreaterThan(0.99);
      expect(solution!.codedFactors.X1).toBeCloseTo(targetVal, 3);
    });

    it('Stress Test 2H: Mutually exclusive CQA goals where desirability is zero everywhere', () => {
      // Y1 = 100 * X1; CQA 1 requires Y1 >= 80 (so X1 >= 0.8)
      // Y2 = 100 * X1; CQA 2 requires Y2 <= 20 (so X1 <= 0.2)
      // No point can satisfy both -> overall desirability must be 0
      const modelY1 = {
        terms: ['X1'],
        coefficients: { X1: 100 },
        rSquared: 1.0,
        adjRSquared: 1.0,
        fStatistic: 999,
        pValue: 0.0001,
        rmse: 0.01,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => 100 * (pt.X1 ?? 0),
        predictStandardError: () => 0.01,
      } as unknown as StatisticalModelResult;

      const modelY2 = {
        terms: ['X1'],
        coefficients: { X1: 100 },
        rSquared: 1.0,
        adjRSquared: 1.0,
        fStatistic: 999,
        pValue: 0.0001,
        rmse: 0.01,
        residualDegreesOfFreedom: 10,
        residuals: [],
        predict: (pt: Record<string, number>) => 100 * (pt.X1 ?? 0),
        predictStandardError: () => 0.01,
      } as unknown as StatisticalModelResult;

      const cqasMutuallyExclusive: CQA[] = [
        { id: 'c1', code: 'Y1', name: 'Y1', unit: '%', objective: 'maximize', lowerLimit: 80, upperLimit: 100, target: 100, weight: 1 },
        { id: 'c2', code: 'Y2', name: 'Y2', unit: '%', objective: 'minimize', lowerLimit: 0, upperLimit: 20, target: 0, weight: 1 },
      ];

      const solution = optimizeDesirabilityGA(
        [factors2D[0]],
        cqasMutuallyExclusive,
        { Y1: modelY1, Y2: modelY2 },
        undefined,
        { seed: 10101 }
      );

      expect(solution).not.toBeNull();
      // Zero overall desirability handled gracefully without NaN or infinity
      expect(solution!.overallDesirability).toBe(0);
      expect(Number.isFinite(solution!.overallDesirability)).toBe(true);
    });

    it('handles model with undefined diagnostics gracefully without throwing TypeError and returns se === 0', () => {
      const bareModel = {
        predict: (_pt: Record<string, number>) => 50,
      } as unknown as StatisticalModelResult;

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Y1',
        unit: '%',
        objective: 'maximize',
        lowerLimit: 0,
        upperLimit: 100,
        target: 100,
        weight: 1,
      };

      const solution = optimizeDesirabilityGA([factors2D[0]], [cqa], { Y1: bareModel });
      expect(solution).not.toBeNull();
      expect(solution!.predictedResponses.Y1.se).toBe(0);
      expect(solution!.predictedResponses.Y1.value).toBe(50);
    });
  });

  // =========================================================================
  // 3. Piepel Mixture Polytope Bounds, Inconsistency Detection & Simplex Projection
  // =========================================================================
  describe('3. Piepel Mixture Bound Invariants & Euclidean Simplex Projection', () => {

    it('Stress Test 3A: Detect inconsistent bounds when sum(L_i) > 1.0', () => {
      const lows = [0.40, 0.40, 0.30]; // sum = 1.10 > 1.0
      const highs = [0.60, 0.60, 0.50];
      const result = validatePiepelBounds(lows, highs, 1.0);

      expect(result.isFeasible).toBe(false);
      expect(result.messages.some((m) => m.includes('vượt quá'))).toBe(true);
      expect(isFeasibleBoundedMixture(lows, highs, 1.0)).toBe(false);
    });

    it('Stress Test 3B: Detect inconsistent bounds when sum(U_i) < 1.0', () => {
      const lows = [0.10, 0.10, 0.10];
      const highs = [0.20, 0.30, 0.40]; // sum = 0.90 < 1.0
      const result = validatePiepelBounds(lows, highs, 1.0);

      expect(result.isFeasible).toBe(false);
      expect(result.messages.some((m) => m.includes('nhỏ hơn'))).toBe(true);
      expect(isFeasibleBoundedMixture(lows, highs, 1.0)).toBe(false);
    });

    it('Stress Test 3C: Detect Piepel inconsistency condition L_i* > U_i*', () => {
      const squeezedLows = [0.60, 0.30, 0.10]; // sum = 1.00
      const squeezedHighs = [0.55, 0.35, 0.15]; // low[0] > high[0]
      const result = validatePiepelBounds(squeezedLows, squeezedHighs, 1.0);
      expect(result.isFeasible).toBe(false);
    });

    it('Stress Test 3D: Unreachable bound detection on Piepel 1983 classic system', () => {
      // Piepel (1983) Example 1:
      // L = [0.10, 0.05, 0.20], U = [0.70, 0.60, 0.75]
      // sumL = 0.35, sumU = 2.05
      // Implied U_i* = 1 - (sumL - L_i):
      // U_1* = 1 - (0.35 - 0.10) = 0.75 > U_1 (not reduced)
      // U_2* = 1 - (0.35 - 0.05) = 0.70 > U_2 (not reduced)
      // U_3* = 1 - (0.35 - 0.20) = 0.85 > U_3 (not reduced)
      // Now test with unreachable upper bounds:
      // L = [0.10, 0.20, 0.30], U = [0.80, 0.80, 0.80]
      // sumL = 0.60. U_1* = 1 - (0.60 - 0.10) = 0.50 < 0.80 -> Unreachable!
      // U_2* = 1 - (0.60 - 0.20) = 0.60 < 0.80 -> Unreachable!
      // U_3* = 1 - (0.60 - 0.30) = 0.70 < 0.80 -> Unreachable!
      const lows = [0.10, 0.20, 0.30];
      const highs = [0.80, 0.80, 0.80];
      const result = validatePiepelBounds(lows, highs, 1.0);

      expect(result.isFeasible).toBe(true);
      expect(result.effectiveHigh[0]).toBeCloseTo(0.50, 6);
      expect(result.effectiveHigh[1]).toBeCloseTo(0.60, 6);
      expect(result.effectiveHigh[2]).toBeCloseTo(0.70, 6);
      expect(result.unreachableUpperIndices).toEqual([0, 1, 2]);

      // Unreachable lower bounds:
      // If U = [0.30, 0.30, 0.50], sumU = 1.10.
      // L = [0.00, 0.00, 0.00].
      // Implied L_1* = 1 - (1.10 - 0.30) = 0.20 > 0.00 -> Unreachable!
      // Implied L_2* = 1 - (1.10 - 0.30) = 0.20 > 0.00 -> Unreachable!
      // Implied L_3* = 1 - (1.10 - 0.50) = 0.40 > 0.00 -> Unreachable!
      const lows2 = [0.00, 0.00, 0.00];
      const highs2 = [0.30, 0.30, 0.50];
      const result2 = validatePiepelBounds(lows2, highs2, 1.0);

      expect(result2.isFeasible).toBe(true);
      expect(result2.effectiveLow[0]).toBeCloseTo(0.20, 6);
      expect(result2.effectiveLow[1]).toBeCloseTo(0.20, 6);
      expect(result2.effectiveLow[2]).toBeCloseTo(0.40, 6);
      expect(result2.unreachableLowerIndices).toEqual([0, 1, 2]);
    });

    it('Stress Test 3E: Euclidean simplex projection onto bounded simplex with extreme corners', () => {
      const lows = [0.10, 0.10, 0.10];
      const highs = [0.60, 0.60, 0.60];
      const total = 1.0;

      // Extreme points:
      const testCandidates = [
        [10.0, -5.0, -2.0],        // Far outside positive & negative
        [0.0, 0.0, 0.0],           // Zero vector
        [1.0, 1.0, 1.0],           // High sum
        [-1.0, -1.0, -1.0],        // All negative
        [0.50, 0.30, 0.20],        // Already feasible interior point
        [0.60, 0.30, 0.10],        // Feasible boundary point
        [0.90, 0.05, 0.05],        // Squeezed at single large component
      ];

      testCandidates.forEach((raw) => {
        const proj = projectToBoundedMixture(raw, lows, highs, total);
        expect(proj.length).toBe(3);

        // Invariant 1: sum(proj) === total
        const sum = proj.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - total)).toBeLessThan(1e-7);

        // Invariant 2: l_i <= proj_i <= u_i
        for (let i = 0; i < 3; i++) {
          expect(proj[i]).toBeGreaterThanOrEqual(lows[i] - 1e-7);
          expect(proj[i]).toBeLessThanOrEqual(highs[i] + 1e-7);
        }
      });

      // If point is already strictly inside the bounded simplex, projection must be identity
      const interior = [0.40, 0.35, 0.25];
      const projInterior = projectToBoundedMixture(interior, lows, highs, total);
      for (let i = 0; i < 3; i++) {
        expect(projInterior[i]).toBeCloseTo(interior[i], 6);
      }
    });

    it('Stress Test 3F: Simplex projection edge cases (1D, empty, mismatched arrays, non-finite values)', () => {
      // 1D simplex: if upper < total, it is infeasible and returns []
      expect(projectToBoundedMixture([0.5], [0.2], [0.8], 1.0)).toEqual([]);
      // 1D simplex: feasible when bounds contain total
      expect(projectToBoundedMixture([0.5], [0.2], [1.0], 1.0)).toEqual([1.0]);
      expect(projectToBoundedMixture([1.5], [0.2], [1.0], 1.0)).toEqual([1.0]);
      expect(projectToBoundedMixture([0.5], [0.2], [0.8], 0.5)).toEqual([0.5]);

      // Empty arrays
      expect(projectToBoundedMixture([], [], [], 1.0)).toEqual([]);

      // Mismatched length
      expect(projectToBoundedMixture([0.5, 0.5], [0.2], [0.8, 0.8], 1.0)).toEqual([]);

      // Non-finite values
      expect(projectToBoundedMixture([NaN, 0.5], [0.2, 0.2], [0.8, 0.8], 1.0)).toEqual([]);
      expect(projectToBoundedMixture([Infinity, 0.5], [0.2, 0.2], [0.8, 0.8], 1.0)).toEqual([]);

      // Infeasible bounds
      expect(projectToBoundedMixture([0.5, 0.5], [0.6, 0.6], [0.8, 0.8], 1.0)).toEqual([]);
    });
  });
});
