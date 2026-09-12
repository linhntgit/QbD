import { describe, expect, it } from 'vitest';
import type { Factor, CQA, StatisticalModelResult } from '../types/qbd';
import { optimizeDesirabilityGA, optimizeDesirability } from '../services/statistics';

describe('Continuous Metaheuristic Desirability Optimizer (RCGA + Nelder-Mead)', () => {
  // Helper to create mock StatisticalModelResult matching exact interface
  function createMockModel(
    predictFn: (coded: Record<string, number>) => number,
    rmse: number = 0.5
  ): StatisticalModelResult {
    return {
      cqaCode: 'Y1',
      modelType: 'Linear',
      equationString: 'Y = mock',
      terms: [
        {
          name: 'Intercept',
          factorCodes: [],
          power: [],
          coefficient: 0,
          stdError: 0.1,
          tValue: 10,
          pValue: 0.0001,
          vif: 1,
          significant: true,
        },
      ],
      anova: [],
      diagnostics: {
        rSquared: 0.98,
        adjRSquared: 0.97,
        predRSquared: 0.95,
        adeqPrecision: 20,
        press: 1,
        stdDev: rmse,
        mean: 50,
        cvPercent: 2,
        residuals: [],
      },
      predict: predictFn,
      predictStandardError: () => rmse,
      residualDegreesOfFreedom: 10,
    };
  }

  describe('Benchmark 1: Continuous Quadratic Surface with Known Global Optimum', () => {
    // Known global maximum at x1 = 0.35, x2 = -0.52, x3 = 0.18
    const targetX1 = 0.35;
    const targetX2 = -0.52;
    const targetX3 = 0.18;

    const factors: Factor[] = [
      { id: '1', code: 'X1', name: 'Factor 1', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'unit', low: 0, high: 100 },
      { id: '2', code: 'X2', name: 'Factor 2', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'unit', low: 10, high: 50 },
      { id: '3', code: 'X3', name: 'Factor 3', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'unit', low: 5, high: 25 },
    ];

    const cqa: CQA = {
      id: 'c1',
      code: 'Y1',
      name: 'Yield',
      unit: '%',
      objective: 'maximize',
      lowerLimit: 0,
      upperLimit: 100,
      target: 100,
      weight: 1,
    };

    // Response model: Y = 100 - 30*(x1 - 0.35)^2 - 40*(x2 + 0.52)^2 - 25*(x3 - 0.18)^2
    const model = createMockModel((coded) => {
      const x1 = coded['X1'] ?? 0;
      const x2 = coded['X2'] ?? 0;
      const x3 = coded['X3'] ?? 0;
      return 100 - 30 * Math.pow(x1 - targetX1, 2) - 40 * Math.pow(x2 - targetX2, 2) - 25 * Math.pow(x3 - targetX3, 2);
    });

    it('should converge to the exact known global maximum within 1e-3 precision', () => {
      const solution = optimizeDesirabilityGA(
        factors,
        [cqa],
        { Y1: model },
        undefined,
        {
          populationSize: 80,
          maxGenerations: 60,
          polishWithNelderMead: true,
          seed: 42,
        }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;

      // Overall desirability should be virtually 1.0 (near perfect peak)
      expect(solution.overallDesirability).toBeGreaterThan(0.999);
      expect(solution.predictedResponses['Y1'].desirability).toBeGreaterThan(0.999);

      // Verify that coordinates closely match the target optimum
      expect(solution.codedFactors['X1']).toBeCloseTo(targetX1, 2);
      expect(solution.codedFactors['X2']).toBeCloseTo(targetX2, 2);
      expect(solution.codedFactors['X3']).toBeCloseTo(targetX3, 2);

      // Predicted yield should be very close to 100%
      expect(solution.predictedResponses['Y1'].value).toBeGreaterThan(99.9);
    });

    it('should maintain strict continuous search beyond discrete grid points', () => {
      // Grid search with step 0.1 would miss x1=0.35 and x2=-0.52
      const solution = optimizeDesirabilityGA(
        factors,
        [cqa],
        { Y1: model },
        undefined,
        { seed: 999 }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;

      // Distance in coded space between solution and true global optimum
      const dist = Math.sqrt(
        Math.pow(solution.codedFactors['X1'] - targetX1, 2) +
        Math.pow(solution.codedFactors['X2'] - targetX2, 2) +
        Math.pow(solution.codedFactors['X3'] - targetX3, 2)
      );
      expect(dist).toBeLessThan(0.05);
    });
  });

  describe('Benchmark 2: Multi-Response Conflicting Objectives (Derringer & Suich Trade-off)', () => {
    const factors: Factor[] = [
      { id: '1', code: 'X1', name: 'Pressure', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'bar', low: 1, high: 10 },
      { id: '2', code: 'X2', name: 'Temperature', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '°C', low: 50, high: 150 },
    ];

    // CQA 1: Maximize Dissolution (increases with X1, decreases with X2)
    const cqa1: CQA = {
      id: 'c1',
      code: 'Y1',
      name: 'Dissolution',
      unit: '%',
      objective: 'maximize',
      lowerLimit: 70,
      upperLimit: 100,
      weight: 1,
    };
    const model1 = createMockModel((coded) => {
      const x1 = coded['X1'] ?? 0;
      const x2 = coded['X2'] ?? 0;
      return 85 + 12 * x1 - 10 * x2;
    });

    // CQA 2: Minimize Impurities (increases with both X1 and X2)
    const cqa2: CQA = {
      id: 'c2',
      code: 'Y2',
      name: 'Impurity',
      unit: '%',
      objective: 'minimize',
      lowerLimit: 0.1,
      upperLimit: 2.0,
      weight: 1,
    };
    const model2 = createMockModel((coded) => {
      const x1 = coded['X1'] ?? 0;
      const x2 = coded['X2'] ?? 0;
      return 0.8 + 0.6 * x1 + 0.5 * x2;
    });

    // CQA 3: Target Hardness at 80 N
    const cqa3: CQA = {
      id: 'c3',
      code: 'Y3',
      name: 'Hardness',
      unit: 'N',
      objective: 'target',
      lowerLimit: 60,
      upperLimit: 100,
      target: 80,
      weight: 1,
    };
    const model3 = createMockModel((coded) => {
      const x1 = coded['X1'] ?? 0;
      const x2 = coded['X2'] ?? 0;
      return 75 + 10 * x1 + 15 * x2;
    });

    it('should balance multi-response trade-offs achieving high overall desirability', () => {
      const solution = optimizeDesirabilityGA(
        factors,
        [cqa1, cqa2, cqa3],
        { Y1: model1, Y2: model2, Y3: model3 },
        undefined,
        { seed: 2026 }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;

      expect(solution.overallDesirability).toBeGreaterThan(0.5);
      expect(solution.predictedResponses['Y1'].desirability).toBeGreaterThan(0.3);
      expect(solution.predictedResponses['Y2'].desirability).toBeGreaterThan(0.3);
      expect(solution.predictedResponses['Y3'].desirability).toBeGreaterThan(0.3);

      // Verify geometric mean consistency: D = (d1 * d2 * d3)^(1/3)
      const dProd =
        solution.predictedResponses['Y1'].desirability *
        solution.predictedResponses['Y2'].desirability *
        solution.predictedResponses['Y3'].desirability;
      const expectedD = Math.pow(dProd, 1 / 3);
      expect(solution.overallDesirability).toBeCloseTo(expectedD, 4);

      // Verify all factors stay strictly within [-1, 1]
      expect(solution.codedFactors['X1']).toBeGreaterThanOrEqual(-1.0);
      expect(solution.codedFactors['X1']).toBeLessThanOrEqual(1.0);
      expect(solution.codedFactors['X2']).toBeGreaterThanOrEqual(-1.0);
      expect(solution.codedFactors['X2']).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Constraint Handling: Locked Factors, Discrete Snapping, and Mixture Simplex', () => {
    it('should strictly lock specified factor at locked value', () => {
      const factors: Factor[] = [
        { id: '1', code: 'X1', name: 'F1', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: 0, high: 10 },
        { id: '2', code: 'X2', name: 'F2', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: 0, high: 10 },
      ];
      const cqa: CQA = { id: 'c1', code: 'Y1', name: 'Yield', unit: '%', objective: 'maximize', lowerLimit: 0, upperLimit: 100, weight: 1 };
      const model = createMockModel((coded) => 50 + 20 * coded['X1'] + 20 * coded['X2']);

      const lockedVal = -0.42;
      const solution = optimizeDesirabilityGA(
        factors,
        [cqa],
        { Y1: model },
        { X2: lockedVal },
        { seed: 42 }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;
      expect(solution.codedFactors['X2']).toBeCloseTo(lockedVal, 6);
    });

    it('should snap discrete factors to valid categorical/discrete coded levels', () => {
      const factors: Factor[] = [
        {
          id: '1',
          code: 'X1',
          name: 'Impeller Type',
          type: 'Process',
          dataType: 'qualitative',
          categories: ['TypeA', 'TypeB', 'TypeC'],
          controllability: 'controllable',
          unit: '',
          low: 1,
          high: 3,
        },
        {
          id: '2',
          code: 'X2',
          name: 'Speed',
          type: 'Process',
          dataType: 'quantitative',
          controllability: 'controllable',
          unit: 'rpm',
          low: 100,
          high: 500,
        },
      ];

      const cqa: CQA = { id: 'c1', code: 'Y1', name: 'Response', unit: '', objective: 'maximize', lowerLimit: 0, upperLimit: 100, weight: 1 };
      // Model where discrete level 1 (TypeC) is best
      const model = createMockModel((coded) => 50 + 30 * coded['X1'] + 10 * coded['X2']);

      const solution = optimizeDesirabilityGA(
        factors,
        [cqa],
        { Y1: model },
        undefined,
        { seed: 42 }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;

      // Coded values for 3 levels should be -1, 0, or 1
      expect([-1, 0, 1]).toContain(solution.codedFactors['X1']);
    });

    it('should ensure mixture components sum exactly to 1.0 and obey bounds', () => {
      const factors: Factor[] = [
        { id: '1', code: 'M1', name: 'Water', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 20, high: 60 },
        { id: '2', code: 'M2', name: 'Ethanol', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 20, high: 60 },
        { id: '3', code: 'M3', name: 'Surfactant', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 10, high: 30 },
      ];

      const cqa: CQA = { id: 'c1', code: 'Y1', name: 'Stability', unit: '', objective: 'maximize', lowerLimit: 0, upperLimit: 100, weight: 1 };
      const model = createMockModel((coded) => 70 + 20 * coded['M1'] - 10 * coded['M2'] + 15 * coded['M3']);

      const solution = optimizeDesirabilityGA(
        factors,
        [cqa],
        { Y1: model },
        undefined,
        { seed: 42 }
      );

      expect(solution).not.toBeNull();
      if (!solution) return;

      const m1 = solution.codedFactors['M1'];
      const m2 = solution.codedFactors['M2'];
      const m3 = solution.codedFactors['M3'];

      // Bounds check (proportions 0.1 to 0.6)
      expect(m1).toBeGreaterThanOrEqual(0.2 - 1e-4);
      expect(m1).toBeLessThanOrEqual(0.6 + 1e-4);
      expect(m2).toBeGreaterThanOrEqual(0.2 - 1e-4);
      expect(m2).toBeLessThanOrEqual(0.6 + 1e-4);
      expect(m3).toBeGreaterThanOrEqual(0.1 - 1e-4);
      expect(m3).toBeLessThanOrEqual(0.3 + 1e-4);

      // Simplex sum check: M1 + M2 + M3 = 1.0
      expect(m1 + m2 + m3).toBeCloseTo(1.0, 4);
    });
  });

  describe('Nelder-Mead Polishing and Determinism', () => {
    const factors: Factor[] = [
      { id: '1', code: 'X1', name: 'Factor 1', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -10, high: 10 },
      { id: '2', code: 'X2', name: 'Factor 2', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -10, high: 10 },
    ];
    const cqa: CQA = { id: 'c1', code: 'Y1', name: 'Response', unit: '', objective: 'maximize', lowerLimit: 0, upperLimit: 100, target: 100, weight: 1 };
    const model = createMockModel((coded) => 100 - 50 * Math.pow(coded['X1'] - 0.2345, 2) - 50 * Math.pow(coded['X2'] + 0.6789, 2));

    it('should improve or maintain desirability with Nelder-Mead polishing enabled', () => {
      const raw = optimizeDesirabilityGA(factors, [cqa], { Y1: model }, undefined, {
        populationSize: 40,
        maxGenerations: 20,
        polishWithNelderMead: false,
        seed: 777,
      });

      const polished = optimizeDesirabilityGA(factors, [cqa], { Y1: model }, undefined, {
        populationSize: 40,
        maxGenerations: 20,
        polishWithNelderMead: true,
        seed: 777,
      });

      expect(raw).not.toBeNull();
      expect(polished).not.toBeNull();
      if (!raw || !polished) return;

      expect(polished.overallDesirability).toBeGreaterThanOrEqual(raw.overallDesirability - 1e-6);
      expect(polished.overallDesirability).toBeGreaterThan(0.99);
    });

    it('should be perfectly deterministic given identical seed', () => {
      const solA = optimizeDesirabilityGA(factors, [cqa], { Y1: model }, undefined, { seed: 12345 });
      const solB = optimizeDesirabilityGA(factors, [cqa], { Y1: model }, undefined, { seed: 12345 });

      expect(solA).not.toBeNull();
      expect(solB).not.toBeNull();
      if (!solA || !solB) return;

      expect(solA.overallDesirability).toBe(solB.overallDesirability);
      expect(solA.codedFactors['X1']).toBe(solB.codedFactors['X1']);
      expect(solA.codedFactors['X2']).toBe(solB.codedFactors['X2']);
    });

    it('should seamlessly execute via the default optimizeDesirability entrypoint', () => {
      const sol = optimizeDesirability(factors, [cqa], { Y1: model });
      expect(sol).not.toBeNull();
      if (!sol) return;
      expect(sol.overallDesirability).toBeGreaterThan(0.9);
    });
  });
});
