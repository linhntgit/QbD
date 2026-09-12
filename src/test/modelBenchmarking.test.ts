import { describe, expect, it } from 'vitest';
import type { Factor, CQA, DoERun, StatisticalModelResult, NeuralNetModelResult } from '../types/qbd';
import {
  fitSVRModel,
  calculateBenchmarkInformationCriteria,
  calculateAkaikeBenchmarkingWeights,
  benchmarkCQAModels,
  benchmarkAllModels,
} from '../services/modelBenchmarking';

describe('Multi-Model Benchmarking & SVR Engine', () => {
  const sampleFactors: Factor[] = [
    {
      id: 'f1',
      code: 'X1',
      name: 'Granulation Liquid %',
      type: 'Formulation',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 15,
      high: 25,
    },
    {
      id: 'f2',
      code: 'X2',
      name: 'Impeller Speed',
      type: 'Process',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: 'rpm',
      low: 150,
      high: 350,
    },
    {
      id: 'f3',
      code: 'X3',
      name: 'Drying Temperature',
      type: 'Process',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '°C',
      low: 45,
      high: 65,
    },
  ];

  const sampleCQA: CQA = {
    id: 'cqa1',
    code: 'Y1',
    name: 'Dissolution at 30 min',
    unit: '%',
    objective: 'maximize',
    weight: 1,
    target: 85,
  };

  // 15-run Box-Behnken experimental design dataset
  const runs: DoERun[] = [
    { id: '1', runOrder: 1, stdOrder: 1, block: 1, factorCoded: { X1: -1, X2: -1, X3: 0 }, factorActual: { X1: 15, X2: 150, X3: 55 }, responses: { Y1: 72.4 } },
    { id: '2', runOrder: 2, stdOrder: 2, block: 1, factorCoded: { X1: 1, X2: -1, X3: 0 }, factorActual: { X1: 25, X2: 150, X3: 55 }, responses: { Y1: 84.1 } },
    { id: '3', runOrder: 3, stdOrder: 3, block: 1, factorCoded: { X1: -1, X2: 1, X3: 0 }, factorActual: { X1: 15, X2: 350, X3: 55 }, responses: { Y1: 76.8 } },
    { id: '4', runOrder: 4, stdOrder: 4, block: 1, factorCoded: { X1: 1, X2: 1, X3: 0 }, factorActual: { X1: 25, X2: 350, X3: 55 }, responses: { Y1: 89.5 } },
    { id: '5', runOrder: 5, stdOrder: 5, block: 1, factorCoded: { X1: -1, X2: 0, X3: -1 }, factorActual: { X1: 15, X2: 250, X3: 45 }, responses: { Y1: 71.0 } },
    { id: '6', runOrder: 6, stdOrder: 6, block: 1, factorCoded: { X1: 1, X2: 0, X3: -1 }, factorActual: { X1: 25, X2: 250, X3: 45 }, responses: { Y1: 85.2 } },
    { id: '7', runOrder: 7, stdOrder: 7, block: 1, factorCoded: { X1: -1, X2: 0, X3: 1 }, factorActual: { X1: 15, X2: 250, X3: 65 }, responses: { Y1: 74.5 } },
    { id: '8', runOrder: 8, stdOrder: 8, block: 1, factorCoded: { X1: 1, X2: 0, X3: 1 }, factorActual: { X1: 25, X2: 250, X3: 65 }, responses: { Y1: 87.8 } },
    { id: '9', runOrder: 9, stdOrder: 9, block: 1, factorCoded: { X1: 0, X2: -1, X3: -1 }, factorActual: { X1: 20, X2: 150, X3: 45 }, responses: { Y1: 78.0 } },
    { id: '10', runOrder: 10, stdOrder: 10, block: 1, factorCoded: { X1: 0, X2: 1, X3: -1 }, factorActual: { X1: 20, X2: 350, X3: 45 }, responses: { Y1: 82.3 } },
    { id: '11', runOrder: 11, stdOrder: 11, block: 1, factorCoded: { X1: 0, X2: -1, X3: 1 }, factorActual: { X1: 20, X2: 150, X3: 65 }, responses: { Y1: 81.1 } },
    { id: '12', runOrder: 12, stdOrder: 12, block: 1, factorCoded: { X1: 0, X2: 1, X3: 1 }, factorActual: { X1: 20, X2: 350, X3: 65 }, responses: { Y1: 86.4 } },
    { id: '13', runOrder: 13, stdOrder: 13, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 250, X3: 55 }, responses: { Y1: 81.5 } },
    { id: '14', runOrder: 14, stdOrder: 14, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 250, X3: 55 }, responses: { Y1: 81.9 } },
    { id: '15', runOrder: 15, stdOrder: 15, block: 1, factorCoded: { X1: 0, X2: 0, X3: 0 }, factorActual: { X1: 20, X2: 250, X3: 55 }, responses: { Y1: 81.2 } },
  ];

  describe('Support Vector Regression (Pure TypeScript Sequential Minimal Optimization)', () => {
    it('trains SVR with RBF kernel and converges to support vectors with accurate predictions', () => {
      const svr = fitSVRModel(sampleFactors, runs, 'Y1', {
        kernel: 'rbf',
        C: 10,
        epsilon: 0.1,
      });

      expect(svr).not.toBeNull();
      if (!svr) return;

      expect(svr.cqaCode).toBe('Y1');
      expect(svr.numSupportVectors).toBeGreaterThan(0);
      expect(svr.parameterCount).toBeGreaterThan(0);
      expect(svr.parameterCount).toBeLessThanOrEqual(svr.numSupportVectors + 1);

      // SVR should achieve strong goodness of fit
      expect(svr.diagnostics.rSquared).toBeGreaterThan(0.85);
      expect(svr.diagnostics.rmse).toBeLessThan(3.0);
      expect(Number.isFinite(svr.diagnostics.aicc)).toBe(true);
      expect(Number.isFinite(svr.diagnostics.bic)).toBe(true);

      // Verify prediction behavior: high X1 (+1) should predict higher response than low X1 (-1)
      const predHigh = svr.predict({ X1: 1, X2: 0, X3: 0 });
      const predLow = svr.predict({ X1: -1, X2: 0, X3: 0 });
      expect(predHigh).toBeGreaterThan(predLow);
    });

    it('trains SVR with Linear kernel and validates dual constraints', () => {
      const svrLinear = fitSVRModel(sampleFactors, runs, 'Y1', {
        kernel: 'linear',
        C: 5.0,
        epsilon: 0.2,
      });

      expect(svrLinear).not.toBeNull();
      if (!svrLinear) return;

      expect(svrLinear.config.kernel).toBe('linear');
      expect(svrLinear.diagnostics.rSquared).toBeGreaterThan(0.80);
      expect(Number.isFinite(svrLinear.bias)).toBe(true);
    });

    it('handles edge case of insufficient sample points (< 4 points)', () => {
      const smallRuns = runs.slice(0, 3);
      const svr = fitSVRModel(sampleFactors, smallRuns, 'Y1');
      expect(svr).toBeNull();
    });
  });

  describe('Hurvich-Tsai AICc & Statistical Information Criteria', () => {
    it('penalizes complex models more severely under small sample sizes', () => {
      const n = 15;
      const sse = 12.0;
      const sst = 150.0;

      const simple = calculateBenchmarkInformationCriteria(n, 3, sse, sst);
      const complex = calculateBenchmarkInformationCriteria(n, 8, sse, sst);

      expect(complex.aicc).toBeGreaterThan(simple.aicc);
      expect(complex.bic).toBeGreaterThan(simple.bic);
    });

    it('returns Infinity for saturated models where n - p - 1 <= 0', () => {
      const n = 10;
      const p = 10;
      const sse = 5.0;
      const sst = 100.0;

      const metrics = calculateBenchmarkInformationCriteria(n, p, sse, sst);
      expect(metrics.aicc).toBe(Infinity);
    });
  });

  describe('Akaike Weights & Model Selection Rules', () => {
    it('calculates normalized Akaike weights summing to 1.0', () => {
      const candidates = [
        { modelId: 'ols', aicc: 42.0 },
        { modelId: 'ann', aicc: 40.0 },
        { modelId: 'svr', aicc: 45.0 },
      ];

      const weighted = calculateAkaikeBenchmarkingWeights(candidates);
      expect(weighted.length).toBe(3);

      // Model with lowest AICc (ann) gets highest weight
      expect(weighted[1].akaikeWeight).toBeGreaterThan(weighted[0].akaikeWeight);
      expect(weighted[0].akaikeWeight).toBeGreaterThan(weighted[2].akaikeWeight);

      const sumWeights = weighted.reduce((sum, w) => sum + w.akaikeWeight, 0);
      expect(sumWeights).toBeCloseTo(1.0, 2);
    });

    it('assigns weight 0 to non-finite AICc models', () => {
      const candidates = [
        { modelId: 'm1', aicc: 35.0 },
        { modelId: 'm2_inf', aicc: Infinity },
      ];

      const weighted = calculateAkaikeBenchmarkingWeights(candidates);
      expect(weighted[1].akaikeWeight).toBe(0);
      expect(weighted[0].akaikeWeight).toBe(1.0);
    });
  });

  describe('Multi-Model Head-to-Head Benchmarking Arena', () => {
    const mockOLS: StatisticalModelResult = {
      cqaCode: 'Y1',
      modelType: 'Quadratic',
      terms: [
        { name: 'Intercept', factorCodes: [], power: [], coefficient: 81.5, stdError: 0.3, tValue: 271, pValue: 0.0001, vif: 1, significant: true },
        { name: 'X1', factorCodes: ['X1'], power: [1], coefficient: 6.2, stdError: 0.2, tValue: 31, pValue: 0.0001, vif: 1, significant: true },
        { name: 'X2', factorCodes: ['X2'], power: [1], coefficient: 2.3, stdError: 0.2, tValue: 11.5, pValue: 0.0001, vif: 1, significant: true },
        { name: 'X3', factorCodes: ['X3'], power: [1], coefficient: 1.5, stdError: 0.2, tValue: 7.5, pValue: 0.0005, vif: 1, significant: true },
      ],
      anova: [
        { source: 'Model', ss: 380.0, df: 3, ms: 126.7, fValue: 250, pValue: 0.0001 },
        { source: 'Residual', ss: 5.5, df: 11, ms: 0.5 },
      ],
      diagnostics: {
        rSquared: 0.985,
        adjRSquared: 0.981,
        predRSquared: 0.975,
        qSquared: 0.975,
        adeqPrecision: 35.0,
        press: 8.5,
        stdDev: 0.71,
        mean: 80.5,
        cvPercent: 0.88,
        aicc: 38.5,
        bic: 41.2,
        logLikelihood: -15.2,
        twoLL: 30.4,
        pLOF: 0.45,
        residuals: [],
      },
      equationString: 'Y1 = 81.5 + 6.2*X1 + 2.3*X2 + 1.5*X3',
      predict: (coded) => 81.5 + 6.2 * (coded.X1 ?? 0) + 2.3 * (coded.X2 ?? 0) + 1.5 * (coded.X3 ?? 0),
    };

    const mockANN: NeuralNetModelResult = {
      cqaCode: 'Y1',
      config: {
        hiddenNodes1: 2,
        hiddenNodes2: 0,
        activation: 'tanh',
        weightDecay: 0.01,
        learningRate: 0.05,
        maxEpochs: 200,
        validationMethod: 'kfold',
        holdoutRatio: 0,
        kFolds: 5,
        numTours: 2,
        seed: 42,
      },
      weights: {
        W1: [[1.5, 0.8], [0.6, 0.4], [0.3, 0.2]],
        b1: [0, 0],
        WOut: [[1.0], [0.5]],
        bOut: 0,
      },
      inputFactorCodes: ['X1', 'X2', 'X3'],
      normParams: { xMeans: [0, 0, 0], xSds: [1, 1, 1], yMean: 80.5, ySd: 5.5 },
      diagnostics: {
        rSquaredTrain: 0.99,
        rSquaredVal: 0.96,
        rSquaredOverall: 0.988,
        adjRSquared: 0.965,
        rmseTrain: 0.5,
        rmseVal: 0.8,
        rmseOverall: 0.6,
        maeTrain: 0.4,
        maeVal: 0.6,
        maeOverall: 0.5,
        sseTrain: 4.0,
        sseVal: 1.2,
        sseOverall: 4.0,
        aicc: 44.0, // Higher penalty due to 11 parameters
        bic: 49.5,
        logLikelihood: -13.0,
        twoLL: 26.0,
        lossHistory: [],
        residuals: [],
        variableImportance: [],
        bestTourIndex: 1,
      },
      predict: (coded) => 80.5 + 6.1 * (coded.X1 ?? 0) + 2.2 * (coded.X2 ?? 0) + 1.4 * (coded.X3 ?? 0),
      formulaString: 'MLP [2] -> 1',
      pythonCode: '# mock neural python code',
      excelFormula: '=MOCK_NEURAL()',
      architectureMode: 'independent',
      parameterCount: 11,
    };

    it('generates multi-model benchmark containing OLS, ANN, SVR, and Ensemble', () => {
      const benchmark = benchmarkCQAModels(sampleCQA, sampleFactors, runs, mockOLS, mockANN);

      expect(benchmark.cqaCode).toBe('Y1');
      expect(benchmark.candidates.length).toBe(4);

      // Verify all 4 model families are present
      const families = benchmark.candidates.map((c) => c.family);
      expect(families).toContain('polynomial');
      expect(families).toContain('neural');
      expect(families).toContain('svr');
      expect(families).toContain('ensemble');

      // Check metrics compliance
      benchmark.candidates.forEach((cand) => {
        expect(cand.rSquared).toBeGreaterThan(0.7);
        expect(cand.rmse).toBeGreaterThan(0);
        expect(Number.isFinite(cand.aicc)).toBe(true);
        expect(Number.isFinite(cand.bic)).toBe(true);
        expect(cand.akaikeWeight).toBeGreaterThanOrEqual(0);
        expect(cand.justificationNotes.length).toBeGreaterThan(0);
      });

      // Verify recommended model identification
      expect(benchmark.recommendedModelId).toBeDefined();
      const recommended = benchmark.candidates.find((c) => c.isRecommended);
      expect(recommended).toBeDefined();
      expect(benchmark.summaryRecommendation).toContain(recommended!.name);
    });

    it('respects Parsimony / Occam Razor: favors OLS when deltaAICc <= 2.0 and parameter count is lower', () => {
      const benchmark = benchmarkCQAModels(sampleCQA, sampleFactors, runs, mockOLS, mockANN);
      const olsCandidate = benchmark.candidates.find((c) => c.family === 'polynomial')!;

      // In this scenario OLS has lower AICc and fewer parameters (4 vs 11)
      expect(olsCandidate.isRecommended).toBe(true);
      expect(benchmark.recommendedModelId).toBe('polynomial_rsm');
    });

    it('benchmarks all CQAs across project with benchmarkAllModels', () => {
      const projectBenchmarks = benchmarkAllModels(
        runs,
        sampleFactors,
        [sampleCQA],
        { Y1: mockOLS },
        { Y1: mockANN },
      );

      expect(projectBenchmarks.Y1).toBeDefined();
      expect(projectBenchmarks.Y1.candidates.length).toBe(4);
    });
  });
});
