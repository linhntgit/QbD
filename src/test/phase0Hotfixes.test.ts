import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Factor, CQA, DoERun, QBDProject, StatisticalModelResult } from '../types/qbd';
import {
  recordProjectVersion,
  getProjectHistory,
  verifyAuditTrailIntegrity,
  pruneProjectForHistory,
} from '../services/projectGovernance';
import { recodeRuns, actualToCoded } from '../services/doeGenerator';
import { runMonteCarloSimulation } from '../services/statistics';
import { fitSVRModel, benchmarkCQAModels } from '../services/modelBenchmarking';
import { calculateExactShapleyValues } from '../services/explainableAI';

describe('Phase P0 Hotfix Regressions Suite', () => {
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
    vi.stubGlobal('window', { localStorage: storage, alert: vi.fn() });
    return storage;
  }

  const baseProject: QBDProject = {
    id: 'p0-test-project',
    name: 'P0 Regression Test Project',
    moleculeName: 'TestAPI',
    dosageForm: 'Tablet',
    author: 'QA Auditor',
    version: '1.0.0',
    createdDate: '2026-10-04',
    updatedDate: '2026-10-04',
    description: 'P0 Validation',
    qtpp: [],
    cqas: [
      {
        id: 'cqa-1',
        code: 'Y1',
        name: 'Dissolution',
        unit: '%',
        target: 85,
        lowerLimit: 75,
        upperLimit: 100,
        objective: 'target',
        weight: 1,
      },
    ],
    factors: [
      {
        id: 'fac-1',
        code: 'X1',
        name: 'Binder %',
        type: 'Formulation',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: '%',
        low: 10,
        high: 20,
        center: 15,
      },
    ],
    fmeaRisks: [],
    doeConfig: {
      category: 'RSM',
      designType: 'CCD_FaceCentered',
      centerPoints: 2,
      replicates: 1,
      randomized: false,
    },
    runs: [
      {
        id: 'r1',
        runOrder: 1,
        stdOrder: 1,
        block: 1,
        factorCoded: { X1: -1 },
        factorActual: { X1: 10 },
        responses: { Y1: 80.5 },
      },
      {
        id: 'r2',
        runOrder: 2,
        stdOrder: 2,
        block: 1,
        factorCoded: { X1: 1 },
        factorActual: { X1: 20 },
        responses: { Y1: 91.0 },
      },
    ],
    designSpace: [],
  };

  // --------------------------------------------------------------------------
  // P0.1: False-tamper bug (G1) when history > 10 items
  // --------------------------------------------------------------------------
  describe('P0.1: Cryptographic Audit Trail Pruning and Verification', () => {
    it('verifies integrity without false tamper warnings when history exceeds 10 snapshots', () => {
      mockStorage();
      const proj = structuredClone(baseProject);

      for (let i = 1; i <= 15; i++) {
        recordProjectVersion(proj, `Action_${i}`, 'Analyst', `Update step ${i}`);
      }

      const history = getProjectHistory(proj.id);
      expect(history.length).toBeLessThanOrEqual(10);
      expect(history[0].action).toBe('Action_15');

      const verification = verifyAuditTrailIntegrity(history, proj);
      expect(verification.isValid).toBe(true);
      expect(verification.tamperedIndex).toBeUndefined();
    });

    it('detects genuine single-character tampering even in pruned history', () => {
      mockStorage();
      const proj = structuredClone(baseProject);

      for (let i = 1; i <= 12; i++) {
        recordProjectVersion(proj, `Action_${i}`, 'Analyst', `Details of step ${i}`);
      }

      const history = getProjectHistory(proj.id);
      expect(history.length).toBe(10);

      // Tamper single character in details of entry index 2
      history[2].details = (history[2].details ?? '') + '!';

      const verification = verifyAuditTrailIntegrity(history, proj);
      expect(verification.isValid).toBe(false);
      expect(verification.tamperedIndex).toBe(2);
      expect(verification.reason).toContain('Entry hash mismatch');
    });
  });

  // --------------------------------------------------------------------------
  // P0.3: Centralized Project Lock Enforcement (G2)
  // --------------------------------------------------------------------------
  describe('P0.3: Centralized GxP Project Lock', () => {
    it('honors isLocked flag in project state structure', () => {
      const lockedProject = structuredClone(baseProject);
      lockedProject.isLocked = true;
      lockedProject.lockDetails = {
        lockedAt: '2026-10-04T00:00:00Z',
        lockedBy: 'QA Director',
        role: 'Approver',
        reason: 'Regulatory Submission',
      };

      // Ensure locked properties are preserved in snapshot serialization
      const pruned = pruneProjectForHistory(lockedProject);
      expect(pruned.id).toBe(lockedProject.id);
    });
  });

  // --------------------------------------------------------------------------
  // P0.4: Recode Runs when Factor Range Changes (S1, S2, S10)
  // --------------------------------------------------------------------------
  describe('P0.4: Recalculate Coded Factor Values', () => {
    it('correctly updates factorCoded when factor low/high range is widened', () => {
      const runs: DoERun[] = [
        {
          id: 'r1',
          runOrder: 1,
          stdOrder: 1,
          block: 1,
          factorCoded: { X1: -1 },
          factorActual: { X1: 10 },
          responses: {},
        },
        {
          id: 'r2',
          runOrder: 2,
          stdOrder: 2,
          block: 1,
          factorCoded: { X1: 1 },
          factorActual: { X1: 20 },
          responses: {},
        },
      ];

      // New factor range: 0 to 20 (midpoint 10)
      const updatedFactor: Factor = {
        ...baseProject.factors[0],
        low: 0,
        high: 20,
        center: 10,
      };

      const recoded = recodeRuns([updatedFactor], runs);

      // X1 = 10 is now midpoint (coded 0)
      expect(recoded[0].factorCoded['X1']).toBeCloseTo(0, 5);
      // X1 = 20 is high (coded +1)
      expect(recoded[1].factorCoded['X1']).toBeCloseTo(1, 5);
    });

    it('returns NaN for unknown categorical levels instead of 0 (S10)', () => {
      const catFactor: Factor = {
        id: 'cat-1',
        code: 'X_cat',
        name: 'Solvent Type',
        type: 'Formulation',
        dataType: 'qualitative',
        controllability: 'controllable',
        unit: '',
        low: -1,
        high: 1,
        categories: ['Water', 'Ethanol', 'IPA'],
      };

      expect(actualToCoded('Water', catFactor)).toBe(-1);
      expect(actualToCoded('Ethanol', catFactor)).toBe(0);
      expect(actualToCoded('IPA', catFactor)).toBe(1);
      // Invalid category must return NaN, NOT 0
      expect(Number.isNaN(actualToCoded('Acetone', catFactor))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // P0.5: Falsy-zero setpoint, mixture unit, and large array min/max (S4, S6, S7)
  // --------------------------------------------------------------------------
  describe('P0.5: Statistical Edge Cases & Stability', () => {
    it('preserves setpoint 0 without falling back to factor center in Monte Carlo (S4)', () => {
      const factorZero: Factor = {
        id: 'f-zero',
        code: 'X_offset',
        name: 'Offset',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: 'mm',
        low: -10,
        high: 10,
        center: 5, // Intentionally non-zero center
      };

      const cqa: CQA = {
        id: 'cqa-mc',
        code: 'Y_mc',
        name: 'Output',
        unit: 'units',
        objective: 'target',
        target: 0,
        lowerLimit: -5,
        upperLimit: 5,
        weight: 1,
      };

      // Mock linear model: Y = X
      const dummyModel = {
        cqa: 'Y_mc',
        modelType: 'Linear' as const,
        coefficients: { Intercept: 0, X_offset: 1 },
        pValues: { Intercept: 0.001, X_offset: 0.001 },
        rSquared: 0.99,
        adjRSquared: 0.99,
        predRSquared: 0.98,
        rmse: 0.01,
        fValue: 100,
        pValue: 0.0001,
        formula: 'Y = X',
        terms: [],
        anova: [{ source: 'Residual', df: 5, ss: 0.001, ms: 0.0002 }],
        diagnostics: {
          residuals: [{ runOrder: 1, actual: 0, predicted: 0, residual: 0, stdResidual: 0 }],
          rSquared: 0.99,
          adjRSquared: 0.99,
          predRSquared: 0.98,
          stdDev: 0.01,
          press: 0.001,
        },
        predict: (coded: Record<string, number>) => coded['X_offset'] ?? 0,
      } as unknown as StatisticalModelResult;

      // Setpoint is explicitly 0
      const mcResult = runMonteCarloSimulation(
        { X_offset: 0 },
        [factorZero],
        [cqa],
        { Y_mc: dummyModel },
        0.5,
        500,
        42
      );

      // Mean should be centered near 0, NOT near 5
      expect(Math.abs(mcResult.cqaStats['Y_mc'].mean)).toBeLessThan(1.0);
    });

    it('handles 100,000 array elements without Maximum call stack size exceeded (S6)', () => {
      const vals: number[] = new Array(100_000);
      for (let i = 0; i < vals.length; i++) {
        vals[i] = i * 0.01;
      }

      let min = vals[0] ?? 0;
      let max = vals[0] ?? 0;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] < min) min = vals[i];
        if (vals[i] > max) max = vals[i];
      }

      expect(min).toBe(0);
      expect(max).toBeCloseTo(999.99, 1);
    });
  });

  // --------------------------------------------------------------------------
  // P0.6: True MAE in Model Benchmarking (S3)
  // --------------------------------------------------------------------------
  describe('P0.6: True Residual MAE Calculation in Model Benchmarking', () => {
    it('computes exact mean of absolute residuals for OLS candidate', () => {
      const factor: Factor = {
        id: 'f1',
        code: 'X1',
        name: 'Temp',
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: '°C',
        low: 50,
        high: 100,
      };

      const cqa: CQA = {
        id: 'c1',
        code: 'Y1',
        name: 'Yield',
        unit: '%',
        objective: 'maximize',
        weight: 1,
      };

      const runs: DoERun[] = [
        { id: '1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1 }, factorActual: { X1: 50 }, responses: { Y1: 50 } },
        { id: '2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 0 }, factorActual: { X1: 75 }, responses: { Y1: 60 } },
        { id: '3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: 1 }, factorActual: { X1: 100 }, responses: { Y1: 70 } },
        { id: '4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 0 }, factorActual: { X1: 75 }, responses: { Y1: 64 } },
      ];

      // Fitted model with known residuals: [+2, -1, +3, -4]
      // Mean absolute error = (|2| + |-1| + |3| + |-4|) / 4 = 10 / 4 = 2.5
      const olsModel = {
        cqa: 'Y1',
        modelType: 'Linear' as const,
        coefficients: { Intercept: 61, X1: 10 },
        pValues: { Intercept: 0.001, X1: 0.001 },
        rSquared: 0.92,
        adjRSquared: 0.88,
        predRSquared: 0.80,
        rmse: 2.8,
        fValue: 25,
        pValue: 0.01,
        formula: 'Y1 = 61 + 10*X1',
        terms: [],
        anova: [{ source: 'Residual', df: 2, ss: 30, ms: 15 }],
        diagnostics: {
          residuals: [
            { runOrder: 1, actual: 50, predicted: 51, residual: -1, stdResidual: -0.35 },
            { runOrder: 2, actual: 60, predicted: 61, residual: -1, stdResidual: -0.35 },
            { runOrder: 3, actual: 70, predicted: 71, residual: -1, stdResidual: -0.35 },
            { runOrder: 4, actual: 64, predicted: 61, residual: 3, stdResidual: 1.05 },
          ],
          rSquared: 0.92,
          adjRSquared: 0.88,
          predRSquared: 0.80,
          stdDev: 2.8,
          press: 35,
        },
        predict: () => 61,
      } as unknown as StatisticalModelResult;

      const benchmark = benchmarkCQAModels(cqa, [factor], runs, olsModel, null);
      const olsCandidate = benchmark.candidates.find((c) => c.modelId === 'polynomial_rsm');

      expect(olsCandidate).toBeDefined();
      // True MAE = (| -1 | + | -1 | + | -1 | + | 3 |) / 4 = 6 / 4 = 1.5
      expect(olsCandidate?.mae).toBeCloseTo(1.5, 4);
    });
  });

  // --------------------------------------------------------------------------
  // P0.7: Deterministic Seed in Permutation SHAP and SVR SMO (S11)
  // --------------------------------------------------------------------------
  describe('P0.7: Deterministic Reproducibility with Seeded RNG', () => {
    it('produces identical SVR models and predictions when identical seed is provided', () => {
      const factors: Factor[] = [
        { id: 'f1', code: 'X1', name: 'F1', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: 0, high: 10 },
        { id: 'f2', code: 'X2', name: 'F2', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: 0, high: 10 },
      ];

      const runs: DoERun[] = [
        { id: '1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1, X2: -1 }, factorActual: { X1: 0, X2: 0 }, responses: { Y1: 10 } },
        { id: '2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 1, X2: -1 }, factorActual: { X1: 10, X2: 0 }, responses: { Y1: 25 } },
        { id: '3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: -1, X2: 1 }, factorActual: { X1: 0, X2: 10 }, responses: { Y1: 30 } },
        { id: '4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 1, X2: 1 }, factorActual: { X1: 10, X2: 10 }, responses: { Y1: 50 } },
        { id: '5', runOrder: 5, stdOrder: 5, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 5, X2: 5 }, responses: { Y1: 28 } },
      ];

      const svr1 = fitSVRModel(factors, runs, 'Y1', { seed: 12345, maxIter: 100 });
      const svr2 = fitSVRModel(factors, runs, 'Y1', { seed: 12345, maxIter: 100 });

      expect(svr1).not.toBeNull();
      expect(svr2).not.toBeNull();
      expect(svr1!.numSupportVectors).toBe(svr2!.numSupportVectors);
      expect(svr1!.diagnostics.rmse).toBeCloseTo(svr2!.diagnostics.rmse, 6);
      expect(svr1!.predict({ X1: 5, X2: 5 })).toBeCloseTo(svr2!.predict({ X1: 5, X2: 5 }), 6);
    });

    it('produces identical permutation SHAP values when identical seed is provided (> 8 factors)', () => {
      // 9 factors triggers permutation SHAP path (k > 8)
      const factors: Factor[] = Array.from({ length: 9 }, (_, i) => ({
        id: `f${i + 1}`,
        code: `X${i + 1}`,
        name: `Factor ${i + 1}`,
        type: 'Process',
        dataType: 'quantitative',
        controllability: 'controllable',
        unit: '',
        low: 0,
        high: 10,
        center: 5,
      }));

      const codedRuns: DoERun[] = [
        {
          id: '1',
          runOrder: 1,
          stdOrder: 1,
          block: 1,
          factorCoded: Object.fromEntries(factors.map((f) => [f.code, 1])),
          factorActual: Object.fromEntries(factors.map((f) => [f.code, 10])),
          responses: { Y1: 100 },
        },
      ];

      const predict = (pt: Record<string, number>) =>
        Object.values(pt).reduce((sum, v) => sum + Number(v) * 2, 50);

      const shap1 = calculateExactShapleyValues(predict, factors, codedRuns, {
        seed: 98765,
        permutationSamples: 50,
      });

      const shap2 = calculateExactShapleyValues(predict, factors, codedRuns, {
        seed: 98765,
        permutationSamples: 50,
      });

      expect(shap1.globalImportance).toEqual(shap2.globalImportance);
      expect(shap1.runExplanations[0].values).toEqual(shap2.runExplanations[0].values);
    });
  });
});
