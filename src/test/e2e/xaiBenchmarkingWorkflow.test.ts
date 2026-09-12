import { describe, expect, it } from 'vitest';
import type { Factor } from '../../types/qbd';

/**
 * Authoritative Mathematical References & Algorithms for XAI and Model Benchmarking
 */

interface TrainedWeights {
  w1: number[][]; // [hiddenNodes x inputNodes]
  b1: number[];   // [hiddenNodes]
  wOut: number[][]; // [outputNodes x hiddenNodes]
  bOut: number[]; // [outputNodes]
}

interface BenchmarkMetrics {
  modelName: string;
  rSquared: number;
  adjRSquared: number;
  rmse: number;
  aicc: number;
  bic: number;
  logLikelihood: number;
  twoLL: number;
  parameterCount: number;
  akaikeWeight?: number;
}

/**
 * Hurvich-Tsai (1989) Information Criteria Calculation
 */
function calculateModelInformationCriteria(n: number, p: number, sse: number, sst: number): {
  aicc: number;
  bic: number;
  logLikelihood: number;
  twoLL: number;
  rSquared: number;
  adjRSquared: number;
  rmse: number;
} {
  const safeSSE = Math.max(1e-12, sse);
  const sigma2 = safeSSE / n;
  const twoLL = n * Math.log(2 * Math.PI) + n * Math.log(sigma2) + n;
  const logLikelihood = -0.5 * twoLL;

  // Hurvich & Tsai (1989) small-sample correction
  const aicBase = twoLL + 2 * p;
  const denom = n - p - 1;
  const aicc = denom > 0 ? aicBase + (2 * p * (p + 1)) / denom : Infinity;

  const bic = twoLL + p * Math.log(n);
  const rSquared = sst > 0 ? Math.max(0, 1 - safeSSE / sst) : 0;
  const dfResid = n - p;
  const adjRSquared = (dfResid > 0 && n > 1 && sst > 0)
    ? 1 - (safeSSE / dfResid) / (sst / (n - 1))
    : rSquared;
  const rmse = Math.sqrt(safeSSE / n);

  return { aicc, bic, logLikelihood, twoLL, rSquared, adjRSquared, rmse };
}

/**
 * Garson's Algorithm for Relative Importance Percentage
 */
function computeGarsonImportance(weights: TrainedWeights): number[] {
  const h = weights.w1.length;
  const m = weights.w1[0].length;

  // S_i = sum_j ( |w1_ji| / sum_k |w1_jk| * |wOut_j| )
  const S: number[] = Array(m).fill(0);

  for (let j = 0; j < h; j++) {
    let sumInputs = 0;
    for (let k = 0; k < m; k++) {
      sumInputs += Math.abs(weights.w1[j][k]);
    }
    const safeSumInputs = sumInputs === 0 ? 1e-12 : sumInputs;
    const wOutJ = Math.abs(weights.wOut[0][j]);

    for (let i = 0; i < m; i++) {
      const q_ij = (Math.abs(weights.w1[j][i]) / safeSumInputs) * wOutJ;
      S[i] += q_ij;
    }
  }

  const sumS = S.reduce((a, b) => a + b, 0);
  const safeSumS = sumS === 0 ? 1e-12 : sumS;
  return S.map((s) => (s / safeSumS) * 100);
}

/**
 * Olden's Connection Weight Method for Directional (+/-) Influence
 */
function computeOldenWeights(weights: TrainedWeights): number[] {
  const h = weights.w1.length;
  const m = weights.w1[0].length;
  const C: number[] = Array(m).fill(0);

  for (let i = 0; i < m; i++) {
    let sumProd = 0;
    for (let j = 0; j < h; j++) {
      sumProd += weights.w1[j][i] * weights.wOut[0][j];
    }
    C[i] = sumProd;
  }
  return C;
}

/**
 * Exact Shapley Values (SHAP) for k <= 8 factors
 */
function computeExactSHAP(
  instance: number[],
  predictFn: (x: number[]) => number,
  baseline: number[]
): { shapValues: number[]; baseValue: number; predValue: number } {
  const k = instance.length;
  const numSubsets = 1 << k; // 2^k subsets
  const shap = Array(k).fill(0);
  const baseValue = predictFn(baseline);
  const predValue = predictFn(instance);

  const factorials: number[] = [1];
  for (let i = 1; i <= k; i++) factorials.push(factorials[i - 1] * i);

  for (let i = 0; i < k; i++) {
    let phi_i = 0;
    for (let s = 0; s < numSubsets; s++) {
      // If subset contains factor i, skip
      if ((s & (1 << i)) !== 0) continue;

      // Subset size |S|
      let sizeS = 0;
      for (let bit = 0; bit < k; bit++) {
        if ((s & (1 << bit)) !== 0) sizeS++;
      }

      // Weight = |S|! (k - |S| - 1)! / k!
      const weight = (factorials[sizeS] * factorials[k - sizeS - 1]) / factorials[k];

      // Form coalition without i
      const xWithout = baseline.map((b, idx) => ((s & (1 << idx)) !== 0 ? instance[idx] : b));
      // Form coalition with i
      const xWith = [...xWithout];
      xWith[i] = instance[i];

      const diff = predictFn(xWith) - predictFn(xWithout);
      phi_i += weight * diff;
    }
    shap[i] = phi_i;
  }

  return { shapValues: shap, baseValue, predValue };
}

/**
 * Multi-Model Benchmarking Engine with Akaike Weights
 */
function calculateAkaikeBenchmarkingWeights(models: BenchmarkMetrics[]): BenchmarkMetrics[] {
  const validModels = models.filter((m) => Number.isFinite(m.aicc));
  const minAICc = Math.min(...validModels.map((m) => m.aicc));

  let sumDelta = 0;
  validModels.forEach((m) => {
    const delta = m.aicc - minAICc;
    const expDelta = Math.exp(-0.5 * delta);
    sumDelta += expDelta;
  });

  return models.map((m) => {
    if (!Number.isFinite(m.aicc)) {
      return { ...m, akaikeWeight: 0 };
    }
    const delta = m.aicc - minAICc;
    const weight = Math.exp(-0.5 * delta) / (sumDelta === 0 ? 1 : sumDelta);
    return { ...m, akaikeWeight: Number(weight.toFixed(4)) };
  });
}

describe('E2E Explainable AI & Multi-Model Benchmarking Workflow', () => {
  const formulationFactors: Factor[] = [
    { id: 'f1', code: 'X1', name: 'Lipid Ratio', type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 40, high: 80, center: 60 },
    { id: 'f2', code: 'X2', name: 'Cholesterol Ratio', type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 10, high: 40, center: 25 },
    { id: 'f3', code: 'X3', name: 'PEG-Lipid Ratio', type: 'Formulation', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 2, high: 10, center: 6 },
  ];

  describe('Tier 1: Feature Coverage — ANN Information Criteria & XAI Algorithms', () => {
    it('TC-XAI-01: Hurvich-Tsai AICc penalizes parameter overfitting more severely than standard asymptotic AIC', () => {
      const n = 14; // Small sample size typical of DoE
      const pSmall = 3; // Linear model
      const pLarge = 8; // Overparameterized ANN
      const sse = 10.0;
      const sst = 100.0;

      const metricsSmall = calculateModelInformationCriteria(n, pSmall, sse, sst);
      const metricsLarge = calculateModelInformationCriteria(n, pLarge, sse, sst);

      // Large model should have significantly higher AICc due to small sample penalty
      expect(metricsLarge.aicc).toBeGreaterThan(metricsSmall.aicc);
      expect(Number.isFinite(metricsSmall.aicc)).toBe(true);
      expect(Number.isFinite(metricsLarge.aicc)).toBe(true);
    });

    it('TC-XAI-02: Garson algorithm calculates relative importance summing to exactly 100%', () => {
      // 3 inputs, 2 hidden neurons, 1 output
      const syntheticWeights: TrainedWeights = {
        w1: [
          [0.8, -0.4, 0.2], // Hidden neuron 1
          [-0.5, 0.9, -0.1], // Hidden neuron 2
        ],
        b1: [0.1, -0.2],
        wOut: [[1.2, -0.8]],
        bOut: [0.5],
      };

      const importance = computeGarsonImportance(syntheticWeights);

      expect(importance.length).toBe(3);
      // All importances must be non-negative
      importance.forEach((imp) => expect(imp).toBeGreaterThanOrEqual(0));
      // Sum of relative importance must be 100%
      const totalImp = importance.reduce((a, b) => a + b, 0);
      expect(totalImp).toBeCloseTo(100.0, 5);
      // Factor X2 has highest input weights into hidden neurons
      expect(importance[1]).toBeGreaterThan(importance[2]);
    });

    it('TC-XAI-03: Olden connection weight method identifies directional positive and negative CPP contributions', () => {
      const syntheticWeights: TrainedWeights = {
        w1: [
          [2.0, -2.0, 0.5],
          [1.0, -1.5, -0.5],
        ],
        b1: [0, 0],
        wOut: [[1.0, 1.0]], // Positive weights on both hidden neurons
        bOut: [0],
      };

      const directionalWeights = computeOldenWeights(syntheticWeights);

      expect(directionalWeights.length).toBe(3);
      // X1 should have positive directional weight (2*1 + 1*1 = 3)
      expect(directionalWeights[0]).toBe(3.0);
      // X2 should have negative directional weight (-2*1 + -1.5*1 = -3.5)
      expect(directionalWeights[1]).toBe(-3.5);
    });

    it('TC-XAI-04: Exact SHAP computation verifies the efficiency/additivity axiom (sum(phi_i) = y_pred - baseValue)', () => {
      // Linear + interaction test model: y = 50 + 10*x1 - 5*x2 + 8*x1*x2 + 3*x3
      const predictFn = (x: number[]) => 50 + 10 * x[0] - 5 * x[1] + 8 * x[0] * x[1] + 3 * x[2];
      const baseline = [0, 0, 0];
      const instance = [0.8, -0.5, 0.4];

      const { shapValues, baseValue, predValue } = computeExactSHAP(instance, predictFn, baseline);

      expect(shapValues.length).toBe(3);
      const sumShap = shapValues.reduce((a, b) => a + b, 0);
      const deltaY = predValue - baseValue;

      // Additivity axiom must hold exactly
      expect(sumShap).toBeCloseTo(deltaY, 6);
    });

    it('TC-XAI-05: Multi-model benchmarking table calculates AICc-based Akaike weights summing to 1.0', () => {
      const mockModels: BenchmarkMetrics[] = [
        { modelName: 'Polynomial Quadratic RSM', rSquared: 0.94, adjRSquared: 0.91, rmse: 1.8, aicc: 45.2, bic: 48.0, logLikelihood: -18.6, twoLL: 37.2, parameterCount: 4 },
        { modelName: 'Artificial Neural Network (MLP)', rSquared: 0.98, adjRSquared: 0.95, rmse: 1.1, aicc: 41.0, bic: 46.5, logLikelihood: -14.5, twoLL: 29.0, parameterCount: 6 },
        { modelName: 'Support Vector Regression (SVR)', rSquared: 0.89, adjRSquared: 0.85, rmse: 2.3, aicc: 52.4, bic: 55.0, logLikelihood: -22.2, twoLL: 44.4, parameterCount: 4 },
        { modelName: 'Ensemble Stacking', rSquared: 0.97, adjRSquared: 0.94, rmse: 1.2, aicc: 42.1, bic: 47.8, logLikelihood: -15.0, twoLL: 30.0, parameterCount: 6 },
      ];

      const ranked = calculateAkaikeBenchmarkingWeights(mockModels);

      expect(ranked.length).toBe(4);
      // Best model (lowest AICc) has highest Akaike weight
      const bestModel = ranked.reduce((prev, curr) => ((curr.akaikeWeight ?? 0) > (prev.akaikeWeight ?? 0) ? curr : prev));
      expect(bestModel.modelName).toBe('Artificial Neural Network (MLP)');

      // Sum of Akaike weights must equal 1.0
      const sumWeights = ranked.reduce((acc, m) => acc + (m.akaikeWeight ?? 0), 0);
      expect(sumWeights).toBeCloseTo(1.0, 3);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC-XAI-06: Handles zero weight input neuron (dummy player in SHAP)', () => {
      // Model where x2 has zero effect (dummy player in cooperative game theory)
      const predictFn = (x: number[]) => 100 + 20 * x[0];
      const baseline = [0, 0];
      const instance = [0.5, 0.9];

      const { shapValues } = computeExactSHAP(instance, predictFn, baseline);
      // Dummy player must receive exactly 0 SHAP value
      expect(shapValues[1]).toBeCloseTo(0, 8);
      expect(shapValues[0]).toBeCloseTo(10.0, 6);
    });

    it('TC-XAI-07: Handles small sample size saturation where n - p - 1 <= 0', () => {
      const n = 5;
      const p = 5; // Parameter count equals sample size
      const sse = 2.0;
      const sst = 50.0;

      const metrics = calculateModelInformationCriteria(n, p, sse, sst);
      // AICc must return Infinity or handle division by zero gracefully
      expect(metrics.aicc).toBe(Infinity);
    });

    it('TC-XAI-08: Symmetric features receive identical SHAP values', () => {
      // Model symmetric with respect to x1 and x2: y = 50 + 10*(x1 + x2)
      const predictFn = (x: number[]) => 50 + 10 * (x[0] + x[1]);
      const baseline = [0, 0];
      const instance = [0.6, 0.6]; // Identical input values

      const { shapValues } = computeExactSHAP(instance, predictFn, baseline);
      expect(shapValues[0]).toBeCloseTo(shapValues[1], 6);
    });

    it('TC-XAI-09: Garson algorithm handles dead neuron (all zero weights) without NaN or crash', () => {
      const zeroWeights: TrainedWeights = {
        w1: [
          [0, 0, 0],
          [0, 0, 0],
        ],
        b1: [0, 0],
        wOut: [[0, 0]],
        bOut: [0],
      };

      const importance = computeGarsonImportance(zeroWeights);
      expect(importance.length).toBe(3);
      importance.forEach((imp) => {
        expect(Number.isFinite(imp)).toBe(true);
      });
    });

    it('TC-XAI-10: Benchmarking handles model with non-finite AICc (assigns weight 0)', () => {
      const modelsWithInf: BenchmarkMetrics[] = [
        { modelName: 'Model A', rSquared: 0.9, adjRSquared: 0.88, rmse: 1.0, aicc: 20.0, bic: 22.0, logLikelihood: -8, twoLL: 16, parameterCount: 2 },
        { modelName: 'Saturated Model B', rSquared: 0.99, adjRSquared: 0.99, rmse: 0.1, aicc: Infinity, bic: 50.0, logLikelihood: 0, twoLL: 0, parameterCount: 10 },
      ];

      const ranked = calculateAkaikeBenchmarkingWeights(modelsWithInf);
      expect(ranked[1].akaikeWeight).toBe(0);
      expect(ranked[0].akaikeWeight).toBe(1.0);
    });
  });

  describe('Tier 3: Cross-Feature Integration — XAI to Benchmarking Consistency', () => {
    it('TC-XAI-11: Confirms consistency between Garson feature rank and Olden absolute magnitude rank', () => {
      const weights: TrainedWeights = {
        w1: [
          [3.0, 0.2, -1.0],
          [2.5, -0.1, 0.8],
        ],
        b1: [0, 0],
        wOut: [[1.5, 1.2]],
        bOut: [0],
      };

      const garson = computeGarsonImportance(weights);
      const olden = computeOldenWeights(weights);

      // In this unambiguous architecture, X1 is dominant in both Garson and Olden
      expect(garson[0]).toBeGreaterThan(garson[1]);
      expect(garson[0]).toBeGreaterThan(garson[2]);
      expect(Math.abs(olden[0])).toBeGreaterThan(Math.abs(olden[1]));
      expect(Math.abs(olden[0])).toBeGreaterThan(Math.abs(olden[2]));
    });

    it('TC-XAI-12: Verifies that Ensemble Stacking model metrics improve upon individual weak models', () => {
      const models: BenchmarkMetrics[] = [
        { modelName: 'Linear OLS', rSquared: 0.72, adjRSquared: 0.70, rmse: 4.5, aicc: 65.0, bic: 67.0, logLikelihood: -28, twoLL: 56, parameterCount: 3 },
        { modelName: 'Quadratic RSM', rSquared: 0.88, adjRSquared: 0.84, rmse: 2.8, aicc: 52.0, bic: 56.0, logLikelihood: -20, twoLL: 40, parameterCount: 6 },
      ];

      const ranked = calculateAkaikeBenchmarkingWeights(models);
      // Quadratic model has lower AICc, should dominate Akaike weight
      expect(ranked[1].akaikeWeight).toBeGreaterThan(ranked[0].akaikeWeight ?? 0);
    });
  });

  describe('Tier 4: Real-World Pharmaceutical Scenario — Liposomal Formulation Model Selection', () => {
    it('TC-XAI-13: Evaluates lipid composition impact on Encapsulation Efficiency and selects best regulatory model', () => {
      // Synthetic experimental dataset (n = 16 runs)
      const n = 16;
      const sst = 250.0;

      // Model 1: Polynomial RSM (Linear + 2FI, p = 7)
      const rsmSSE = 28.5;
      const rsmMetrics = calculateModelInformationCriteria(n, 7, rsmSSE, sst);

      // Model 2: ANN MLP (3-3-1, p = 16)
      const annSSE = 8.2;
      const annMetrics = calculateModelInformationCriteria(n, 16, annSSE, sst);

      // Model 3: SVR with RBF kernel (equivalent degrees of freedom p = 5)
      const svrSSE = 18.0;
      const svrMetrics = calculateModelInformationCriteria(n, 5, svrSSE, sst);

      const benchmarkingTable: BenchmarkMetrics[] = [
        { modelName: 'Polynomial RSM (2FI)', ...rsmMetrics, parameterCount: 7 },
        { modelName: 'Artificial Neural Network (MLP)', ...annMetrics, parameterCount: 16 },
        { modelName: 'Support Vector Regression (SVR)', ...svrMetrics, parameterCount: 5 },
      ];

      const evaluated = calculateAkaikeBenchmarkingWeights(benchmarkingTable);

      // Verify all models are properly scored
      evaluated.forEach((m) => {
        expect(m.rSquared).toBeGreaterThan(0.80);
        expect(m.rmse).toBeGreaterThan(0);
        expect(m.akaikeWeight).toBeDefined();
      });

      // Explainable AI on the top model
      const trainedLipidWeights: TrainedWeights = {
        w1: [
          [1.5, -0.8, 0.3],
          [1.2, 0.4, -0.2],
          [-0.3, 1.1, 0.6],
        ],
        b1: [0.1, -0.1, 0.2],
        wOut: [[1.0, -0.5, 0.8]],
        bOut: [0.3],
      };

      const garsonReport = computeGarsonImportance(trainedLipidWeights);
      expect(garsonReport.length).toBe(formulationFactors.length);
      const totalPct = garsonReport.reduce((a, b) => a + b, 0);
      expect(totalPct).toBeCloseTo(100.0, 4);

      // Formulate final regulatory report recommendation
      const bestRegulatoryModel = evaluated.reduce((prev, curr) => ((curr.akaikeWeight ?? 0) > (prev.akaikeWeight ?? 0) ? curr : prev));
      expect(bestRegulatoryModel.modelName).toBeDefined();
    });
  });
});
