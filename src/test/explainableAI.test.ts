import { describe, expect, it } from 'vitest';
import type { Factor, CQA, DoERun, NeuralNetModelResult } from '../types/qbd';
import {
  computeGarsonImportance,
  computeOldenWeights,
  calculateOldenInfluenceList,
  computeExactSHAP,
  calculateExactShapleyValues,
  computeXAIImportance,
  generateCQAImpactMatrix,
} from '../services/explainableAI';

describe('Explainable AI (XAI) Suite for Neural Networks', () => {
  const sampleFactors: Factor[] = [
    {
      id: 'f1',
      code: 'X1',
      name: 'Polymer Concentration',
      type: 'Formulation',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 10,
      high: 30,
    },
    {
      id: 'f2',
      code: 'X2',
      name: 'Compression Force',
      type: 'Process',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: 'kN',
      low: 5,
      high: 25,
    },
    {
      id: 'f3',
      code: 'X3',
      name: 'Lubricant Ratio',
      type: 'Formulation',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 0.5,
      high: 2.0,
    },
  ];

  const sampleCQA: CQA = {
    id: 'cqa1',
    code: 'Y1',
    name: 'Tablet Hardness',
    unit: 'kP',
    objective: 'target',
    weight: 1,
    target: 12,
  };

  describe('Garson Algorithm (Structural Importance Decomposition)', () => {
    it('calculates relative importance summing to exactly 100% on 1-hidden-layer network', () => {
      const syntheticWeights = {
        w1: [
          [1.5, -0.5, 0.2], // Hidden neuron 1
          [-0.8, 1.2, -0.4], // Hidden neuron 2
        ],
        b1: [0.1, -0.1],
        wOut: [[1.0, -1.0]],
        bOut: [0.5],
      };

      const importance = computeGarsonImportance(syntheticWeights);

      expect(importance.length).toBe(3);
      importance.forEach((imp) => expect(imp).toBeGreaterThanOrEqual(0));
      const totalImp = importance.reduce((a, b) => a + b, 0);
      expect(totalImp).toBeCloseTo(100.0, 5);
      // X1 and X2 have much higher weights than X3
      expect(importance[0]).toBeGreaterThan(importance[2]);
      expect(importance[1]).toBeGreaterThan(importance[2]);
    });

    it('handles 2-hidden-layer network structure through matrix contraction', () => {
      // W1: [3 inputs x 2 hidden1]
      // W2: [2 hidden1 x 2 hidden2]
      // WOut: [2 hidden2 x 1 output]
      const twoLayerWeights = {
        W1: [
          [1.0, 0.5],
          [0.2, 0.8],
          [0.1, 0.1],
        ],
        W2: [
          [0.8, 0.3],
          [0.4, 0.9],
        ],
        WOut: [[1.2], [0.7]],
      };

      const result = computeGarsonImportance(twoLayerWeights as any, sampleFactors);
      const totalImp = result.reduce((a, b) => a + b, 0);
      expect(totalImp).toBeCloseTo(100.0, 4);

      if (result.list) {
        expect(result.list.length).toBe(3);
        expect(result.list[0].rank).toBe(1);
        expect(result.list[1].rank).toBe(2);
        expect(result.list[2].rank).toBe(3);
      }
    });

    it('handles dead neurons (all zero weights) safely without NaN or infinite values', () => {
      const deadWeights = {
        w1: [
          [0, 0, 0],
          [0, 0, 0],
        ],
        b1: [0, 0],
        wOut: [[0, 0]],
        bOut: [0],
      };

      const importance = computeGarsonImportance(deadWeights);
      expect(importance.length).toBe(3);
      importance.forEach((imp) => {
        expect(Number.isFinite(imp)).toBe(true);
        expect(imp).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Olden Connection Weight Method (Directional +/- Influence)', () => {
    it('preserves signed directional impact of input parameters', () => {
      // 3 inputs, 2 hidden neurons, 1 output
      const directionalWeights = {
        w1: [
          [2.0, -1.5, 0.4], // Neuron 1
          [1.0, -1.0, -0.2], // Neuron 2
        ],
        wOut: [[1.0, 1.0]],
      };

      const cw = computeOldenWeights(directionalWeights);
      expect(cw.length).toBe(3);

      // X1: 2.0*1.0 + 1.0*1.0 = +3.0 (positive promoter)
      expect(cw[0]).toBeCloseTo(3.0, 5);
      // X2: -1.5*1.0 + -1.0*1.0 = -2.5 (negative inhibitor)
      expect(cw[1]).toBeCloseTo(-2.5, 5);
      // X3: 0.4*1.0 + -0.2*1.0 = +0.2
      expect(cw[2]).toBeCloseTo(0.2, 5);
    });

    it('generates structured Olden influence list with correct ranks and directions', () => {
      const directionalWeights = {
        w1: [
          [2.0, -3.0, 0.1],
          [1.0, -2.0, -0.1],
        ],
        wOut: [[1.0, 1.0]],
      };

      const list = calculateOldenInfluenceList(directionalWeights, sampleFactors);
      expect(list.length).toBe(3);

      // X2 has highest magnitude |-5.0|
      expect(list[0].factorCode).toBe('X2');
      expect(list[0].direction).toBe('negative');
      expect(list[0].rank).toBe(1);

      // X1 has second highest magnitude |+3.0|
      expect(list[1].factorCode).toBe('X1');
      expect(list[1].direction).toBe('positive');
      expect(list[1].rank).toBe(2);

      // Sum of relative importances must be 100%
      const sumPct = list.reduce((sum, item) => sum + item.relativeImportance, 0);
      expect(sumPct).toBeCloseTo(100.0, 1);
    });
  });

  describe('Exact Shapley Values (SHAP Axioms & Efficiency)', () => {
    it('strictly satisfies the Efficiency Axiom: sum(phi_i) === f(x) - f_baseline', () => {
      // Non-linear polynomial response: y = 50 + 12*x1 - 8*x2 + 15*x1*x2 - 5*x3^2
      const predictFn = (x: number[]) =>
        50 + 12 * x[0] - 8 * x[1] + 15 * x[0] * x[1] - 5 * x[2] * x[2];
      const baseline = [0, 0, 0];

      // Test multiple operating points across the design space
      const testPoints = [
        [0.8, -0.5, 0.4],
        [-1.0, 1.0, -0.5],
        [0.0, 0.0, 1.0],
        [0.35, -0.8, -0.2],
      ];

      for (const instance of testPoints) {
        const { shapValues, baseValue, predValue } = computeExactSHAP(
          instance,
          predictFn,
          baseline,
        );
        const sumShap = shapValues.reduce((a, b) => a + b, 0);
        const deltaPred = predValue - baseValue;

        // Efficiency axiom must hold to floating-point precision
        expect(sumShap).toBeCloseTo(deltaPred, 6);
      }
    });

    it('strictly satisfies the Dummy / Null Player Axiom', () => {
      // Factor X3 is a dummy player that has zero impact on the response
      const predictFn = (x: number[]) => 40 + 15 * x[0] - 10 * x[1];
      const baseline = [0, 0, 0];
      const instance = [0.7, -0.4, 0.95];

      const { shapValues } = computeExactSHAP(instance, predictFn, baseline);

      // Dummy factor X3 must receive identically 0 SHAP value
      expect(shapValues[2]).toBeCloseTo(0, 8);
      // Active factors receive non-zero contributions
      expect(Math.abs(shapValues[0])).toBeGreaterThan(0);
      expect(Math.abs(shapValues[1])).toBeGreaterThan(0);
    });

    it('strictly satisfies the Symmetry Axiom for identical factor effects', () => {
      // Factors X1 and X2 enter symmetrically: y = 20 + 8*(x1 + x2) + 4*(x1*x2)
      const predictFn = (x: number[]) => 20 + 8 * (x[0] + x[1]) + 4 * x[0] * x[1];
      const baseline = [0, 0];
      const instance = [0.65, 0.65]; // Identical input values

      const { shapValues } = computeExactSHAP(instance, predictFn, baseline);

      // Symmetrical factors must receive identical Shapley allocations
      expect(shapValues[0]).toBeCloseTo(shapValues[1], 7);
    });
  });

  describe('Full Dataset SHAP Analysis & Consensus Ranking', () => {
    // Generate synthetic 15-run Box-Behnken style dataset
    const runs: DoERun[] = [
      { id: '1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1, X2: -1, X3: 0 }, factorActual: { X1: 10, X2: 5, X3: 1.25 }, responses: { Y1: 8.5 } },
      { id: '2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 1, X2: -1, X3: 0 }, factorActual: { X1: 30, X2: 5, X3: 1.25 }, responses: { Y1: 15.2 } },
      { id: '3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: -1, X2: 1, X3: 0 }, factorActual: { X1: 10, X2: 25, X3: 1.25 }, responses: { Y1: 6.8 } },
      { id: '4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 1, X2: 1, X3: 0 }, factorActual: { X1: 30, X2: 25, X3: 1.25 }, responses: { Y1: 13.5 } },
      { id: '5', runOrder: 5, stdOrder: 5, block: 1, factorCoded: { X1: -1, X2: 0, X3: -1 }, factorActual: { X1: 10, X2: 15, X3: 0.5 }, responses: { Y1: 7.9 } },
      { id: '6', runOrder: 6, stdOrder: 6, block: 1, factorCoded: { X1: 1, X2: 0, X3: -1 }, factorActual: { X1: 30, X2: 15, X3: 0.5 }, responses: { Y1: 14.8 } },
      { id: '7', runOrder: 7, stdOrder: 7, block: 1, factorCoded: { X1: -1, X2: 0, X3: 1 }, factorActual: { X1: 10, X2: 15, X3: 2.0 }, responses: { Y1: 8.2 } },
      { id: '8', runOrder: 8, stdOrder: 8, block: 1, factorCoded: { X1: 1, X2: 0, X3: 1 }, factorActual: { X1: 30, X2: 15, X3: 2.0 }, responses: { Y1: 15.1 } },
      { id: '9', runOrder: 9, stdOrder: 9, block: 1, factorCoded: { X1: 0, X2: -1, X3: -1 }, factorActual: { X1: 20, X2: 5, X3: 0.5 }, responses: { Y1: 12.0 } },
      { id: '10', runOrder: 10, stdOrder: 10, block: 1, factorCoded: { X1: 0, X2: 1, X3: -1 }, factorActual: { X1: 20, X2: 25, X3: 0.5 }, responses: { Y1: 10.3 } },
      { id: '11', runOrder: 11, stdOrder: 11, block: 1, factorCoded: { X1: 0, X2: -1, X3: 1 }, factorActual: { X1: 20, X2: 5, X3: 2.0 }, responses: { Y1: 12.2 } },
      { id: '12', runOrder: 12, stdOrder: 12, block: 1, factorCoded: { X1: 0, X2: 1, X3: 1 }, factorActual: { X1: 20, X2: 25, X3: 2.0 }, responses: { Y1: 10.5 } },
      { id: '13', runOrder: 13, stdOrder: 13, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 15, X3: 1.25 }, responses: { Y1: 11.4 } },
      { id: '14', runOrder: 14, stdOrder: 14, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 15, X3: 1.25 }, responses: { Y1: 11.5 } },
      { id: '15', runOrder: 15, stdOrder: 15, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 15, X3: 1.25 }, responses: { Y1: 11.3 } },
    ];

    const mockPredict = (coded: Record<string, number>) => {
      const x1 = coded.X1 ?? 0;
      const x2 = coded.X2 ?? 0;
      const x3 = coded.X3 ?? 0;
      return 11.4 + 3.4 * x1 - 0.9 * x2 + 0.15 * x3;
    };

    it('performs exact SHAP analysis on experimental runs with zero efficiency error', () => {
      const shapResult = calculateExactShapleyValues(mockPredict, sampleFactors, runs);

      expect(shapResult.method).toBe('exact');
      expect(shapResult.runExplanations.length).toBe(15);
      expect(shapResult.globalImportance.length).toBe(3);

      // Verify that every single run explanation satisfies efficiency
      shapResult.runExplanations.forEach((exp) => {
        expect(exp.efficiencyError).toBeLessThan(1e-4);
      });

      // Factor X1 is dominant in importance
      expect(shapResult.globalImportance[0].factorCode).toBe('X1');
      expect(shapResult.globalImportance[0].direction).toBe('positive');

      // Factor X2 has negative impact
      const x2Imp = shapResult.globalImportance.find((g) => g.factorCode === 'X2');
      expect(x2Imp?.direction).toBe('negative');
    });

    it('integrates Garson, Olden, and SHAP into consensus comparison table', () => {
      const mockNeuralModel: NeuralNetModelResult = {
        cqaCode: 'Y1',
        config: {
          hiddenNodes1: 2,
          hiddenNodes2: 0,
          activation: 'tanh',
          weightDecay: 0.01,
          learningRate: 0.05,
          maxEpochs: 100,
          validationMethod: 'none',
          holdoutRatio: 0,
          kFolds: 5,
          numTours: 1,
          seed: 42,
        },
        weights: {
          W1: [
            [2.5, 1.8], // X1
            [-1.2, -0.8], // X2
            [0.2, 0.1], // X3
          ],
          b1: [0, 0],
          WOut: [[1.2], [0.8]],
          bOut: 0,
        },
        inputFactorCodes: ['X1', 'X2', 'X3'],
        normParams: {
          xMeans: [0, 0, 0],
          xSds: [1, 1, 1],
          yMean: 11.4,
          ySd: 2.5,
        },
        diagnostics: {
          rSquaredTrain: 0.95,
          rSquaredVal: 0.92,
          rSquaredOverall: 0.95,
          rmseTrain: 0.5,
          rmseVal: 0.6,
          rmseOverall: 0.5,
          maeTrain: 0.4,
          maeVal: 0.5,
          maeOverall: 0.4,
          sseTrain: 3.5,
          sseVal: 0.9,
          sseOverall: 3.5,
          lossHistory: [],
          residuals: [],
          variableImportance: [],
          bestTourIndex: 1,
        },
        predict: mockPredict,
        formulaString: 'MLP [2] -> 1',
        pythonCode: '# mock neural python code',
        excelFormula: '=MOCK_NEURAL()',
        architectureMode: 'independent',
        parameterCount: 11,
      };

      const xai = computeXAIImportance(mockNeuralModel, runs, sampleFactors, sampleCQA);

      expect(xai.cqaCode).toBe('Y1');
      expect(xai.comparisonTable.length).toBe(3);

      // Top consensus factor should be X1
      expect(xai.comparisonTable[0].factorCode).toBe('X1');
      expect(xai.comparisonTable[0].riskCategory).toBe('High');

      // Check Impact Matrix generation
      const matrix = generateCQAImpactMatrix([sampleCQA], sampleFactors, { Y1: xai });
      expect(matrix.length).toBe(3);
      expect(matrix[0].criticality).toBe('Critical');
    });
  });
});
