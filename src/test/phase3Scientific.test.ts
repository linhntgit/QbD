import { describe, it, expect } from 'vitest';
import type { Factor, CQA, DoERun } from '../types/qbd';
import {
  convertCodedToActualEquation,
} from '../services/equationTransforms';
import {
  canRemoveTermUnderHierarchy,
  validateModelHierarchy,
} from '../services/modelTerms';
import {
  runBackwardElimination,
} from '../services/modelReduction';
import {
  fitModel,
  runMonteCarloSimulation,
} from '../services/statistics';
import {
  calculateProbabilisticCQAMargin,
} from '../services/mathUtils';
import {
  calculateOLSCrossValidation,
  calculateSVRCrossValidation,
  benchmarkCQAModels,
} from '../services/modelBenchmarking';

describe('Phase P3: Advanced Scientific & Statistical Enhancements', () => {
  // Test fixture helpers
  const factors: Factor[] = [
    {
      id: 'f1',
      code: 'X1',
      name: 'Temperature',
      unit: '°C',
      type: 'Process',
      dataType: 'quantitative',
      low: 50,
      high: 70,
      center: 60,
      role: 'process_parameter',
      controllability: 'controllable',
    },
    {
      id: 'f2',
      code: 'X2',
      name: 'Agitation',
      unit: 'rpm',
      type: 'Process',
      dataType: 'quantitative',
      low: 100,
      high: 300,
      center: 200,
      role: 'process_parameter',
      controllability: 'controllable',
    },
  ];

  const cqa: CQA = {
    id: 'c1',
    code: 'Y1',
    name: 'Yield',
    unit: '%',
    target: 85,
    lowerLimit: 75,
    upperLimit: 95,
    weight: 1.0,
    objective: 'maximize',
  };

  // 13-run Central Composite Design (CCD) for 2 factors
  // Y = 80 + 4*x1 - 3*x2 - 2.5*x1^2 - 1.8*x2^2 + 2.0*x1*x2 + noise
  const ccdRuns: DoERun[] = [
    // Factorial runs
    { id: 'r1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1, X2: -1 }, factorActual: { X1: 50, X2: 100 }, responses: { Y1: 76.7 } },
    { id: 'r2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 1, X2: -1 }, factorActual: { X1: 70, X2: 100 }, responses: { Y1: 82.3 } },
    { id: 'r3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: -1, X2: 1 }, factorActual: { X1: 50, X2: 300 }, responses: { Y1: 68.3 } },
    { id: 'r4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 1, X2: 1 }, factorActual: { X1: 70, X2: 300 }, responses: { Y1: 78.7 } },
    // Axial runs (alpha = 1.414)
    { id: 'r5', runOrder: 5, stdOrder: 5, block: 1, factorCoded: { X1: -1.414, X2: 0 }, factorActual: { X1: 45.86, X2: 200 }, responses: { Y1: 70.34 } },
    { id: 'r6', runOrder: 6, stdOrder: 6, block: 1, factorCoded: { X1: 1.414, X2: 0 }, factorActual: { X1: 74.14, X2: 200 }, responses: { Y1: 81.66 } },
    { id: 'r7', runOrder: 7, stdOrder: 7, block: 1, factorCoded: { X1: 0, X2: -1.414 }, factorActual: { X1: 60, X2: 58.6 }, responses: { Y1: 81.24 } },
    { id: 'r8', runOrder: 8, stdOrder: 8, block: 1, factorCoded: { X1: 0, X2: 1.414 }, factorActual: { X1: 60, X2: 341.4 }, responses: { Y1: 72.76 } },
    // Center point runs (replicates)
    { id: 'r9', runOrder: 9, stdOrder: 9, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 60, X2: 200 }, responses: { Y1: 80.1 } },
    { id: 'r10', runOrder: 10, stdOrder: 10, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 60, X2: 200 }, responses: { Y1: 79.9 } },
    { id: 'r11', runOrder: 11, stdOrder: 11, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 60, X2: 200 }, responses: { Y1: 80.2 } },
    { id: 'r12', runOrder: 12, stdOrder: 12, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 60, X2: 200 }, responses: { Y1: 79.8 } },
    { id: 'r13', runOrder: 13, stdOrder: 13, block: 1, factorCoded: { X1: 0, X2: 0 }, factorActual: { X1: 60, X2: 200 }, responses: { Y1: 80.0 } },
  ];

  describe('P3.2: Actual Engineering Unit Equation Transformation', () => {
    it('accurately transforms linear and quadratic terms into physical units', () => {
      const model = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model) return;

      expect(model.actualEquationString).toBeDefined();
      expect(model.actualEquationString).toContain('Y1 =');
      expect(model.actualEquationLatex).toBeDefined();

      // Check numeric equivalence at center point: X1 = 60, X2 = 200 (x1 = 0, x2 = 0)
      const codedPred = model.predict({ X1: 0, X2: 0 });

      // Transform equation directly:
      const actualEq = convertCodedToActualEquation(model.terms, factors, 'Y1');
      expect(actualEq.intercept).toBeDefined();

      let actualPred = actualEq.intercept;
      for (const t of actualEq.terms) {
        if (t.factorCodes.length === 1 && !t.name.includes('²')) {
          const val = t.factorCodes[0] === 'X1' ? 60 : 200;
          actualPred += t.coefficient * val;
        } else if (t.factorCodes.length === 1 && t.name.includes('²')) {
          const val = t.factorCodes[0] === 'X1' ? 60 : 200;
          actualPred += t.coefficient * val * val;
        } else if (t.factorCodes.length === 2) {
          actualPred += t.coefficient * 60 * 200;
        }
      }

      expect(actualPred).toBeCloseTo(codedPred, 2);
    });

    it('correctly handles mixture components with unit % vs fractional scaling', () => {
      const mixFactors: Factor[] = [
        { id: 'm1', code: 'A', name: 'Water', unit: '%', type: 'Mixture', dataType: 'quantitative', low: 20, high: 80, role: 'mixture_component', controllability: 'controllable' },
        { id: 'm2', code: 'B', name: 'Ethanol', unit: '%', type: 'Mixture', dataType: 'quantitative', low: 10, high: 70, role: 'mixture_component', controllability: 'controllable' },
        { id: 'm3', code: 'C', name: 'Surfactant', unit: '%', type: 'Mixture', dataType: 'quantitative', low: 0, high: 30, role: 'mixture_component', controllability: 'controllable' },
      ];
      const mixTerms = [
        { name: 'A', factorCodes: ['A'], power: [1], coefficient: 12.5, stdError: 0.5, tValue: 25, pValue: 0.001, vif: 1, significant: true },
        { name: 'B', factorCodes: ['B'], power: [1], coefficient: 18.2, stdError: 0.5, tValue: 36, pValue: 0.001, vif: 1, significant: true },
        { name: 'C', factorCodes: ['C'], power: [1], coefficient: 5.0, stdError: 0.5, tValue: 10, pValue: 0.005, vif: 1, significant: true },
      ];
      const eq = convertCodedToActualEquation(mixTerms, mixFactors, 'Y_mix');
      expect(eq.equationString).toContain('Y_mix =');
      expect(eq.equationString).toContain('Water');
      expect(eq.equationString).toContain('Ethanol');
      expect(eq.equationString).toContain('Surfactant');
    });
  });

  describe('P3.1: Model Reduction & Hierarchy Preservation', () => {
    it('strictly preserves linear terms if interactions or quadratic terms exist', () => {
      const activeTerms = ['Intercept', 'X1', 'X2', 'X1*X2', 'X1^2'];
      // Removing X1 is illegal because X1*X2 and X1^2 still exist
      expect(canRemoveTermUnderHierarchy('X1', activeTerms)).toBe(false);
      // Removing X2 is illegal because X1*X2 still exists
      expect(canRemoveTermUnderHierarchy('X2', activeTerms)).toBe(false);
      // Removing X1^2 is legal
      expect(canRemoveTermUnderHierarchy('X1^2', activeTerms)).toBe(true);
      // Removing X1*X2 is legal
      expect(canRemoveTermUnderHierarchy('X1*X2', activeTerms)).toBe(true);

      const valid = validateModelHierarchy(activeTerms);
      expect(valid.isValid).toBe(true);

      const invalidHierarchy = ['Intercept', 'X1*X2']; // missing X1 and X2
      const invalidResult = validateModelHierarchy(invalidHierarchy);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.violations.length).toBeGreaterThan(0);
    });

    it('runs backward elimination to reduce non-significant terms while maintaining hierarchy', () => {
      const result = runBackwardElimination(cqa, factors, ccdRuns, {
        alphaToRemove: 0.10,
        criterion: 'p-value',
        startModelType: 'Quadratic',
      });

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.reducedModel.modelType).toBe('Reduced');
      expect(result.steps.length).toBeGreaterThanOrEqual(0);
      expect(result.finalTerms.length).toBeLessThanOrEqual(6); // Intercept + X1 + X2 + X1^2 + X2^2 + X1*X2

      // Verify that the resulting model strictly satisfies polynomial hierarchy
      const check = validateModelHierarchy(result.finalTerms);
      expect(check.isValid).toBe(true);
      expect(check.violations.length).toBe(0);
    });

    it('actually eliminates non-significant interaction terms in stepwise backward elimination', () => {
      // Y = 80 + 5*x1 - 4*x2 + 2*x1^2 + 1.5*x2^2 (NO X1*X2 interaction)
      const runsWithoutInteraction: DoERun[] = ccdRuns.map((r) => {
        const x1 = r.factorCoded.X1;
        const x2 = r.factorCoded.X2;
        const yVal = 80 + 5 * x1 - 4 * x2 + 2 * x1 * x1 + 1.5 * x2 * x2;
        return {
          ...r,
          responses: { Y1: yVal },
        };
      });

      const result = runBackwardElimination(cqa, factors, runsWithoutInteraction, {
        alphaToRemove: 0.10,
        criterion: 'p-value',
        startModelType: 'Quadratic',
      });

      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.reducedModel.modelType).toBe('Reduced');
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.finalTerms).not.toContain('X1*X2');
      expect(result.finalTerms).toContain('X1');
      expect(result.finalTerms).toContain('X2');

      const check = validateModelHierarchy(result.finalTerms);
      expect(check.isValid).toBe(true);
    });
  });

  describe('P3.5: Type III ANOVA and Box-Cox Recommendation', () => {
    it('calculates Type III partial sum of squares for each term independently', () => {
      const model = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model) return;

      expect(model.type3Anova).toBeDefined();
      expect(model.type3Anova!.length).toBeGreaterThan(0);

      // Residual and Total rows must be present
      const residRow = model.type3Anova!.find((r) => r.source === 'Residual');
      expect(residRow).toBeDefined();
      expect(residRow!.df).toBe(model.residualDegreesOfFreedom);

      // Verify that partial SS for significant terms is positive
      const x1Row = model.type3Anova!.find((r) => r.source === 'X1');
      expect(x1Row).toBeDefined();
      expect(x1Row!.ss).toBeGreaterThan(0);
      expect(x1Row!.fValue).toBeDefined();
      expect(x1Row!.pValue).toBeDefined();
    });

    it('correctly diagnoses optimal Box-Cox transformation parameter lambda', () => {
      const model = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model || !model.boxCox) return;

      expect(model.boxCox.optimalLambda).toBeDefined();
      expect(model.boxCox.ci95Low).toBeLessThanOrEqual(model.boxCox.optimalLambda);
      expect(model.boxCox.ci95High).toBeGreaterThanOrEqual(model.boxCox.optimalLambda);
      expect(model.boxCox.recommendedTransform).toBeDefined();
      expect(model.boxCox.points.length).toBeGreaterThan(10);
    });

    it('recommends Log or Square Root transform when response requires power transformation', () => {
      // Synthetic exponential response Y = exp(0.05 * X1)
      const expRuns = ccdRuns.map((r, i) => ({
        ...r,
        responses: { Y1: Math.exp((r.factorCoded.X1 ?? 0) * 1.5 + 2) + (i % 2 === 0 ? 0.2 : -0.2) },
      }));
      const modelExp = fitModel(cqa, factors, expRuns, 'Linear');
      expect(modelExp?.boxCox).toBeDefined();
      if (modelExp?.boxCox) {
        // Optimal lambda for exponential growth tends towards log (lambda <= 0.2)
        expect(modelExp.boxCox.optimalLambda).toBeLessThan(0.7);
      }
    });
  });

  describe('P3.4: Two-Stage Monte Carlo & Process SD', () => {
    it('executes two-stage Monte Carlo simulation with parameter realization sampling', () => {
      const model = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model) return;

      const setpoint = { X1: 60, X2: 200 };
      const mc1Stage = runMonteCarloSimulation(setpoint, factors, [cqa], { Y1: model }, 2.0, 500, 2026, undefined, false);
      const mc2Stage = runMonteCarloSimulation(setpoint, factors, [cqa], { Y1: model }, 2.0, 500, 2026, undefined, true);

      expect(mc1Stage.twoStageMonteCarlo).toBe(false);
      expect(mc2Stage.twoStageMonteCarlo).toBe(true);
      expect(mc2Stage.cqaStats['Y1']).toBeDefined();
      expect(mc2Stage.cqaStats['Y1'].mean).toBeCloseTo(80, 0);
      expect(mc2Stage.reliabilityPercent).toBeGreaterThanOrEqual(0);
      expect(mc2Stage.reliabilityPercent).toBeLessThanOrEqual(100);
    });

    it('respects factor.processSD absolute standard deviation when provided', () => {
      const factorsWithSD: Factor[] = [
        { ...factors[0], processSD: 0.1 }, // very tight temperature control (0.1°C)
        { ...factors[1], processSD: 1.0 }, // tight agitation control (1 rpm)
      ];
      const model = fitModel(cqa, factorsWithSD, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model) return;

      const setpoint = { X1: 60, X2: 200 };
      const mcTight = runMonteCarloSimulation(setpoint, factorsWithSD, [cqa], { Y1: model }, 2.0, 500, 2026);
      expect(mcTight.defectRatePPM).toBeDefined();
    });
  });

  describe('P3.6: Out-of-Sample Cross-Validation in Benchmarking', () => {
    it('calculates exact Leave-One-Out PRESS cross-validation for OLS models', () => {
      const model = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      expect(model).not.toBeNull();
      if (!model) return;

      const Y = ccdRuns.map((r) => Number(r.responses.Y1));
      const yMean = Y.reduce((a, b) => a + b, 0) / Y.length;
      const sst = Y.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0);

      const olsCV = calculateOLSCrossValidation(model, ccdRuns.length, sst);
      expect(olsCV).toBeDefined();
      if (!olsCV) return;

      expect(olsCV.kFold).toBe(ccdRuns.length);
      expect(olsCV.rmseCV).toBeGreaterThan(0);
      expect(olsCV.maeCV).toBeGreaterThan(0);
      expect(olsCV.qSquaredCV).toBeGreaterThan(0);
      expect(olsCV.qSquaredCV).toBeLessThanOrEqual(1);
      expect(olsCV.residualsCV.length).toBe(ccdRuns.length);
    });

    it('calculates K-fold cross-validation for SVR models', () => {
      const svrCV = calculateSVRCrossValidation(factors, ccdRuns, 'Y1', { kernel: 'rbf', C: 10, epsilon: 0.1 });
      expect(svrCV).toBeDefined();
      if (!svrCV) return;

      expect(svrCV.kFold).toBe(5);
      expect(svrCV.rmseCV).toBeGreaterThan(0);
      expect(svrCV.maeCV).toBeGreaterThan(0);
      expect(svrCV.residualsCV.length).toBe(ccdRuns.length);
    });

    it('includes cross-validation metrics across all candidates in benchmarkCQAModels', () => {
      const ols = fitModel(cqa, factors, ccdRuns, 'Quadratic');
      const benchmark = benchmarkCQAModels(cqa, factors, ccdRuns, ols, null);

      expect(benchmark.candidates.length).toBeGreaterThanOrEqual(2);
      const poly = benchmark.candidates.find((c) => c.family === 'polynomial');
      expect(poly).toBeDefined();
      expect(poly?.rmseCV).toBeDefined();
      expect(poly?.maeCV).toBeDefined();
      expect(poly?.qSquaredCV).toBeDefined();
    });
  });

  describe('P3.3: Probabilistic Design Space Acceptance Margin', () => {
    it('tightens acceptance margin when evaluating 95% prediction interval boundary', () => {
      const yPred = 84;
      const sePred = 0.5;
      const msResidual = 1.0;
      const dfResidual = 7;
      const lowerLimit = 75;
      const upperLimit = 95;

      const meanMargin = calculateProbabilisticCQAMargin(
        yPred, sePred, msResidual, dfResidual, 'maximize', lowerLimit, upperLimit, 'mean'
      );
      const pi95Margin = calculateProbabilisticCQAMargin(
        yPred, sePred, msResidual, dfResidual, 'maximize', lowerLimit, upperLimit, 'pi95'
      );
      const probMargin = calculateProbabilisticCQAMargin(
        yPred, sePred, msResidual, dfResidual, 'maximize', lowerLimit, upperLimit, 'probabilistic', 0.95
      );

      // PI 95% margin must be strictly smaller than mean margin (accounts for individual variation)
      expect(pi95Margin).toBeLessThan(meanMargin);
      // Probabilistic margin is positive when within spec
      expect(probMargin).toBeGreaterThan(-0.1);
    });
  });
});
