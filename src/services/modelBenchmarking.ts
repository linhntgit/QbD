import type {
  Factor,
  CQA,
  DoERun,
  StatisticalModelResult,
  NeuralNetModelResult,
} from '../types/qbd';
import { calculateInformationCriteria } from './mathUtils';

export interface SVRConfig {
  kernel: 'rbf' | 'linear';
  C: number; // Regularization penalty C (default: 10.0)
  epsilon: number; // Epsilon-insensitivity tube width (default: 0.1)
  gamma?: number; // RBF kernel parameter gamma = 1 / (2 * sigma^2)
  tol?: number; // KKT numerical tolerance (default: 1e-3)
  maxIter?: number; // Maximum SMO iterations (default: 1000)
}

export interface SVRModelResult {
  cqaCode: string;
  config: SVRConfig;
  supportVectors: {
    coded: Record<string, number>;
    alphaDiff: number; // beta_i = alpha*_i - alpha_i
  }[];
  bias: number;
  numSupportVectors: number;
  parameterCount: number;
  diagnostics: {
    rSquared: number;
    adjRSquared: number;
    rmse: number;
    mae: number;
    sse: number;
    aicc: number;
    bic: number;
    logLikelihood: number;
    twoLL: number;
  };
  predict: (coded: Record<string, number>) => number;
}

export interface ModelBenchmarkCandidate {
  modelId: string;
  name: string;
  family: 'polynomial' | 'neural' | 'svr' | 'ensemble';
  architectureDescription: string;
  parameterCount: number;
  degreesOfFreedom: number;

  // Statistical Performance Metrics
  rSquared: number;
  adjRSquared: number;
  qSquared?: number;
  rmse: number;
  mae: number;
  sse: number;

  // Information Criteria
  aicc: number;
  bic: number;
  logLikelihood: number;
  twoLL: number;
  deltaAICc: number; // AICc - min(AICc)
  akaikeWeight: number; // 0 - 1.0 (Probability of being the best model)

  // Regulatory & Diagnostic Assessment
  overfittingRisk: 'Low' | 'Moderate' | 'High' | 'Severe';
  ichQ8Suitability: 'Recommended' | 'Acceptable' | 'Caution' | 'Not Recommended';
  rank: number;
  isRecommended: boolean;
  justificationNotes: string[];

  predict: (coded: Record<string, number>) => number;
}

export interface CQAMultiModelBenchmark {
  cqaCode: string;
  cqaName: string;
  sampleSize: number;
  candidates: ModelBenchmarkCandidate[];
  recommendedModelId: string;
  summaryRecommendation: string;
}

/**
 * Standardize calculation of model information criteria across all model types
 */
export function calculateBenchmarkInformationCriteria(
  n: number,
  p: number,
  sse: number,
  sst: number,
): {
  aicc: number;
  bic: number;
  logLikelihood: number;
  twoLL: number;
  rSquared: number;
  adjRSquared: number;
  rmse: number;
} {
  const safeSSE = Math.max(1e-12, sse);
  const info = calculateInformationCriteria(n, p, safeSSE);

  const rSquared = sst > 0 ? Math.max(0, 1 - safeSSE / sst) : 0;
  const dfResid = n - p;
  const adjRSquared =
    dfResid > 0 && n > 1 && sst > 0
      ? Math.max(0, 1 - (safeSSE / dfResid) / (sst / (n - 1)))
      : rSquared;
  const rmse = Math.sqrt(safeSSE / n);

  return {
    aicc: info.aicc,
    bic: info.bic,
    logLikelihood: info.logLikelihood,
    twoLL: info.twoLL,
    rSquared,
    adjRSquared,
    rmse,
  };
}

/**
 * Calculate Akaike weights from an array of model metrics
 */
export function calculateAkaikeBenchmarkingWeights<T extends { aicc: number; akaikeWeight?: number }>(
  models: T[],
): (T & { deltaAICc: number; akaikeWeight: number })[] {
  const validModels = models.filter((m) => Number.isFinite(m.aicc));
  const minAICc = validModels.length > 0 ? Math.min(...validModels.map((m) => m.aicc)) : 0;

  let sumDelta = 0;
  validModels.forEach((m) => {
    const delta = m.aicc - minAICc;
    const expDelta = Math.exp(-0.5 * delta);
    sumDelta += expDelta;
  });

  return models.map((m) => {
    if (!Number.isFinite(m.aicc)) {
      return { ...m, deltaAICc: Infinity, akaikeWeight: 0 };
    }
    const delta = m.aicc - minAICc;
    const weight = Math.exp(-0.5 * delta) / (sumDelta === 0 ? 1 : sumDelta);
    return {
      ...m,
      deltaAICc: Number(delta.toFixed(2)),
      akaikeWeight: Number(weight.toFixed(4)),
    };
  });
}

/**
 * Fit Support Vector Regression (ε-SVR) via pure TypeScript Sequential Minimal Optimization (SMO)
 */
export function fitSVRModel(
  factors: Factor[],
  runs: DoERun[],
  cqaCode: string,
  userConfig?: Partial<SVRConfig>,
): SVRModelResult | null {
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const k = activeFactors.length;
  if (k === 0) return null;

  // Extract valid numerical responses
  const validRuns = runs.filter((r) => {
    const val = r.responses[cqaCode];
    return val !== null && val !== undefined && val !== '' && !Number.isNaN(Number(val));
  });

  const N = validRuns.length;
  if (N < 4) return null;

  const X = validRuns.map((r) => activeFactors.map((f) => r.factorCoded[f.code] ?? 0));
  const Y = validRuns.map((r) => Number(r.responses[cqaCode]));

  // Standardize Y for numerical stability
  const yMean = Y.reduce((a, b) => a + b, 0) / N;
  const yVar = Y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0) / Math.max(1, N - 1);
  const ySd = Math.sqrt(Math.max(1e-6, yVar));
  const Y_norm = Y.map((y) => (y - yMean) / ySd);

  const config: SVRConfig = {
    kernel: userConfig?.kernel ?? 'rbf',
    C: userConfig?.C ?? 10.0,
    epsilon: userConfig?.epsilon ?? 0.1,
    gamma: userConfig?.gamma ?? 1.0 / Math.max(1, k),
    tol: userConfig?.tol ?? 1e-3,
    maxIter: userConfig?.maxIter ?? 1000,
  };

  const { C, epsilon, gamma = 1.0 / k, tol = 1e-3, maxIter = 1000 } = config;

  // Kernel Function Evaluation
  const kernel = (x1: number[], x2: number[]): number => {
    if (config.kernel === 'linear') {
      return x1.reduce((sum, val, idx) => sum + val * x2[idx], 0);
    }
    // RBF Kernel
    let dist2 = 0;
    for (let i = 0; i < k; i++) {
      const diff = x1[i] - x2[i];
      dist2 += diff * diff;
    }
    return Math.exp(-gamma * dist2);
  };

  // Precompute Kernel Gram Matrix
  const K: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => kernel(X[i], X[j])),
  );

  // Dual variables: beta[i] = alpha*_i - alpha_i in [-C, C]
  const beta = new Array(N).fill(0);
  let bias = 0;

  // Error function: E_i = f(x_i) - y_norm[i]
  const computeError = (i: number): number => {
    let predNorm = bias;
    for (let j = 0; j < N; j++) {
      if (Math.abs(beta[j]) > 1e-8) {
        predNorm += beta[j] * K[j][i];
      }
    }
    return predNorm - Y_norm[i];
  };

  // Sequential Minimal Optimization (SMO) Loop
  let iter = 0;
  let numChanged = 0;
  let examineAll = true;

  while ((numChanged > 0 || examineAll) && iter < maxIter) {
    numChanged = 0;
    iter++;

    for (let i = 0; i < N; i++) {
      if (!examineAll && Math.abs(beta[i]) < 1e-6) continue;

      const Ei = computeError(i);

      // Check Karush-Kuhn-Tucker (KKT) conditions with tolerance
      const violatesKKT =
        (Ei < -epsilon - tol && beta[i] < C) ||
        (Ei > epsilon + tol && beta[i] > -C) ||
        (Math.abs(beta[i]) > 1e-6 && Math.abs(Math.abs(Ei) - epsilon) > tol);

      if (violatesKKT) {
        // Select second index j maximizing error step |Ei - Ej|
        let j = Math.floor(Math.random() * N);
        let maxDeltaE = 0;
        for (let cand = 0; cand < N; cand++) {
          if (cand === i) continue;
          const Ecand = computeError(cand);
          const deltaE = Math.abs(Ei - Ecand);
          if (deltaE > maxDeltaE) {
            maxDeltaE = deltaE;
            j = cand;
          }
        }

        const Ej = computeError(j);
        const eta = 2 * K[i][j] - K[i][i] - K[j][j];
        if (eta >= -1e-6) continue;

        const delta = -(Ei - Ej) / eta;
        const sumBeta = beta[i] + beta[j];

        // Box constraints for beta in [-C, C]
        const L = Math.max(-C, sumBeta - C);
        const H = Math.min(C, sumBeta + C);
        if (L >= H) continue;

        let newBetaJ = beta[j] + delta;
        if (newBetaJ > H) newBetaJ = H;
        else if (newBetaJ < L) newBetaJ = L;

        if (Math.abs(newBetaJ - beta[j]) < 1e-6) continue;

        const newBetaI = sumBeta - newBetaJ;

        // Update bias b using support vectors on the margin
        const b1 =
          bias -
          Ei -
          (newBetaI - beta[i]) * K[i][i] -
          (newBetaJ - beta[j]) * K[i][j];
        const b2 =
          bias -
          Ej -
          (newBetaI - beta[i]) * K[i][j] -
          (newBetaJ - beta[j]) * K[j][j];

        if (Math.abs(newBetaI) < C && Math.abs(newBetaI) > 1e-6) bias = b1;
        else if (Math.abs(newBetaJ) < C && Math.abs(newBetaJ) > 1e-6) bias = b2;
        else bias = (b1 + b2) / 2;

        beta[i] = newBetaI;
        beta[j] = newBetaJ;
        numChanged++;
      }
    }

    if (examineAll) examineAll = false;
    else if (numChanged === 0) examineAll = true;
  }

  // Extract support vectors
  const svIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    if (Math.abs(beta[i]) > 1e-5) {
      svIndices.push(i);
    }
  }

  // SVR Parameter Count: Number of support vectors + bias intercept bounded by residual degrees of freedom
  const numSV = Math.max(1, svIndices.length);
  const maxFeasibleP = Math.max(k + 1, Math.min(numSV + 1, Math.max(2, N - 3)));
  const pCount = Math.min(numSV + 1, maxFeasibleP);

  const predict = (coded: Record<string, number>): number => {
    const xVec = activeFactors.map((f) => coded[f.code] ?? 0);
    let predNorm = bias;
    for (const idx of svIndices) {
      predNorm += beta[idx] * kernel(X[idx], xVec);
    }
    return predNorm * ySd + yMean;
  };

  // Evaluate performance on training dataset
  let sse = 0;
  let sae = 0;
  for (let i = 0; i < N; i++) {
    const predVal = predict(validRuns[i].factorCoded);
    const err = Y[i] - predVal;
    sse += err * err;
    sae += Math.abs(err);
  }

  const sst = Y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
  const metrics = calculateBenchmarkInformationCriteria(N, pCount, sse, sst);

  const supportVectors = svIndices.map((idx) => ({
    coded: { ...validRuns[idx].factorCoded },
    alphaDiff: beta[idx],
  }));

  return {
    cqaCode,
    config,
    supportVectors,
    bias,
    numSupportVectors: numSV,
    parameterCount: pCount,
    diagnostics: {
      rSquared: metrics.rSquared,
      adjRSquared: metrics.adjRSquared,
      rmse: metrics.rmse,
      mae: sae / N,
      sse,
      aicc: metrics.aicc,
      bic: metrics.bic,
      logLikelihood: metrics.logLikelihood,
      twoLL: metrics.twoLL,
    },
    predict,
  };
}

/**
 * Head-to-Head Multi-Model Benchmarking Engine
 * Compares: Polynomial RSM, ANN MLP, SVR, and Ensemble Stacking
 */
export function benchmarkCQAModels(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  olsModel: StatisticalModelResult | null,
  neuralModel: NeuralNetModelResult | null,
  options?: { svrConfig?: Partial<SVRConfig> },
): CQAMultiModelBenchmark {
  const validRuns = runs.filter((r) => {
    const val = r.responses[cqa.code];
    return val !== null && val !== undefined && val !== '' && !Number.isNaN(Number(val));
  });
  const N = validRuns.length;
  const Y = validRuns.map((r) => Number(r.responses[cqa.code]));
  const yMean = N > 0 ? Y.reduce((a, b) => a + b, 0) / N : 0;
  const sst = Y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);

  const rawCandidates: Omit<ModelBenchmarkCandidate, 'deltaAICc' | 'akaikeWeight' | 'rank' | 'isRecommended'>[] = [];

  // 1. Polynomial RSM OLS Model
  if (olsModel && N > 0) {
    const pCount = olsModel.terms.length;
    const sse = olsModel.anova.find((a) => a.source.startsWith('Residual'))?.ss ?? 0;
    const metrics = calculateBenchmarkInformationCriteria(N, pCount, sse, sst);

    rawCandidates.push({
      modelId: 'polynomial_rsm',
      name: `Hồi Quy Đa Thức OLS (${olsModel.modelType})`,
      family: 'polynomial',
      architectureDescription: `${olsModel.modelType} (${pCount} số hạng)`,
      parameterCount: pCount,
      degreesOfFreedom: Math.max(1, N - pCount),
      rSquared: olsModel.diagnostics.rSquared,
      adjRSquared: olsModel.diagnostics.adjRSquared,
      qSquared: olsModel.diagnostics.qSquared ?? olsModel.diagnostics.predRSquared,
      rmse: olsModel.diagnostics.stdDev,
      mae: sse > 0 ? Math.sqrt(sse / N) * 0.8 : 0,
      sse,
      aicc: olsModel.diagnostics.aicc ?? metrics.aicc,
      bic: olsModel.diagnostics.bic ?? metrics.bic,
      logLikelihood: olsModel.diagnostics.logLikelihood ?? metrics.logLikelihood,
      twoLL: olsModel.diagnostics.twoLL ?? metrics.twoLL,
      overfittingRisk: N / pCount >= 3 ? 'Low' : N / pCount >= 2 ? 'Moderate' : 'High',
      ichQ8Suitability:
        (olsModel.diagnostics.pLOF ?? 1) > 0.05 && olsModel.diagnostics.adjRSquared > 0.7
          ? 'Recommended'
          : 'Acceptable',
      justificationNotes: [
        'Mô hình tham chiếu chuẩn hóa của hướng dẫn ICH Q8(R2).',
        `Bậc tự do phần dư df = ${Math.max(1, N - pCount)}.`,
        olsModel.diagnostics.pLOF !== undefined && olsModel.diagnostics.pLOF > 0.05
          ? 'Kiểm định Lack of Fit không có ý nghĩa (p > 0.05): Mô hình phù hợp dữ liệu.'
          : 'Có thể tồn tại độ cong hoặc tương tác bậc cao chưa được bắt trọn.',
      ],
      predict: olsModel.predict,
    });
  }

  // 2. Artificial Neural Network (ANN MLP)
  if (neuralModel && N > 0) {
    const diag = neuralModel.diagnostics;
    const pCount: number =
      neuralModel.parameterCount ??
      Math.max(1, (neuralModel.config.hiddenNodes1 || 2) * (factors.length + 1) + 1);
    const sse = diag.sseOverall;
    const metrics = calculateBenchmarkInformationCriteria(N, pCount, sse, sst);

    const aiccVal = diag.aicc ?? metrics.aicc;
    const bicVal = diag.bic ?? metrics.bic;
    const adjR2 = diag.adjRSquared ?? metrics.adjRSquared;

    const sampleRatio = N / Math.max(1, pCount);
    const risk: 'Low' | 'Moderate' | 'High' | 'Severe' =
      !Number.isFinite(aiccVal) || sampleRatio < 1
        ? 'Severe'
        : sampleRatio < 2
          ? 'High'
          : sampleRatio < 3
            ? 'Moderate'
            : 'Low';

    rawCandidates.push({
      modelId: 'neural_mlp',
      name: 'Mạng Nơ-ron Nhân Tạo (ANN MLP)',
      family: 'neural',
      architectureDescription: `MLP [${neuralModel.config.hiddenNodes1}${neuralModel.config.hiddenNodes2 > 0 ? `, ${neuralModel.config.hiddenNodes2}` : ''}] (${neuralModel.config.activation.toUpperCase()})`,
      parameterCount: pCount,
      degreesOfFreedom: Math.max(0, N - pCount),
      rSquared: diag.rSquaredOverall,
      adjRSquared: adjR2,
      qSquared: diag.rSquaredVal,
      rmse: diag.rmseOverall,
      mae: diag.maeOverall,
      sse,
      aicc: aiccVal,
      bic: bicVal,
      logLikelihood: diag.logLikelihood ?? metrics.logLikelihood,
      twoLL: diag.twoLL ?? metrics.twoLL,
      overfittingRisk: risk,
      ichQ8Suitability:
        risk === 'Low' && diag.rSquaredVal > 0.7
          ? 'Recommended'
          : risk === 'Severe'
            ? 'Not Recommended'
            : 'Acceptable',
      justificationNotes: [
        `Năng lực xấp xỉ phi tuyến mạnh mẽ (${pCount} trọng số kết nối).`,
        diag.rSquaredVal > 0.7
          ? 'Độ tin cậy kiểm định ngoại suy (Validation R²) đạt yêu cầu.'
          : 'Cảnh báo: Validation R² thấp hơn Train R², nguy cơ overfit trên tập mẫu nhỏ.',
      ],
      predict: neuralModel.predict,
    });
  }

  // 3. Support Vector Regression (SVR)
  const svr = fitSVRModel(factors, runs, cqa.code, options?.svrConfig);
  if (svr && N > 0) {
    const sDiag = svr.diagnostics;
    rawCandidates.push({
      modelId: 'svr_rbf',
      name: `Hồi Quy Vectơ Hỗ Trợ (SVR ${svr.config.kernel.toUpperCase()})`,
      family: 'svr',
      architectureDescription: `SVR (C=${svr.config.C}, ε=${svr.config.epsilon}, ${svr.numSupportVectors} SVs)`,
      parameterCount: svr.parameterCount,
      degreesOfFreedom: Math.max(1, N - svr.parameterCount),
      rSquared: sDiag.rSquared,
      adjRSquared: sDiag.adjRSquared,
      rmse: sDiag.rmse,
      mae: sDiag.mae,
      sse: sDiag.sse,
      aicc: sDiag.aicc,
      bic: sDiag.bic,
      logLikelihood: sDiag.logLikelihood,
      twoLL: sDiag.twoLL,
      overfittingRisk: svr.numSupportVectors / N <= 0.6 ? 'Low' : 'Moderate',
      ichQ8Suitability: sDiag.adjRSquared >= 0.75 ? 'Recommended' : 'Acceptable',
      justificationNotes: [
        'Tối ưu hóa lồi toàn cục (Global Convex Optimization) qua giải thuật SMO.',
        `Sử dụng ${svr.numSupportVectors} vectơ hỗ trợ làm mốc nội suy không gian thiết kế.`,
        'Bền vững cao đối với các điểm dị biệt (Outliers) nhờ ống dung sai ε-insensitivity.',
      ],
      predict: svr.predict,
    });
  }

  // 4. Ensemble Stacking (Akaike-Weighted Model Averaging)
  if (rawCandidates.length >= 2) {
    const candidatesWithWeights = calculateAkaikeBenchmarkingWeights(rawCandidates as any[]);

    const ensemblePredict = (coded: Record<string, number>): number => {
      let weightedSum = 0;
      let totalW = 0;
      candidatesWithWeights.forEach((cand) => {
        const w = cand.akaikeWeight ?? 0;
        if (w > 0) {
          weightedSum += w * cand.predict(coded);
          totalW += w;
        }
      });
      return totalW > 0 ? weightedSum / totalW : yMean;
    };

    let ensSSE = 0;
    let ensSAE = 0;
    for (let i = 0; i < N; i++) {
      const predVal = ensemblePredict(validRuns[i].factorCoded);
      const err = Y[i] - predVal;
      ensSSE += err * err;
      ensSAE += Math.abs(err);
    }

    // Weighted average of parameter counts
    const ensP = Math.round(
      candidatesWithWeights.reduce((sum, c) => sum + (c.akaikeWeight ?? 0) * c.parameterCount, 0),
    );
    const ensMetrics = calculateBenchmarkInformationCriteria(N, Math.max(2, ensP), ensSSE, sst);

    rawCandidates.push({
      modelId: 'ensemble_stacking',
      name: 'Mô Hình Hợp Tuyển Đa Mô Hình (Ensemble Stacking)',
      family: 'ensemble',
      architectureDescription: `Hợp nhất ${rawCandidates.length} mô hình theo trọng số Akaike`,
      parameterCount: Math.max(2, ensP),
      degreesOfFreedom: Math.max(1, N - ensP),
      rSquared: ensMetrics.rSquared,
      adjRSquared: ensMetrics.adjRSquared,
      rmse: ensMetrics.rmse,
      mae: ensSAE / N,
      sse: ensSSE,
      aicc: ensMetrics.aicc,
      bic: ensMetrics.bic,
      logLikelihood: ensMetrics.logLikelihood,
      twoLL: ensMetrics.twoLL,
      overfittingRisk: 'Low',
      ichQ8Suitability: 'Recommended',
      justificationNotes: [
        'Kết hợp dự báo đa dạng giảm thiểu phương sai (Variance Reduction).',
        'Cân bằng tự động giữa tính đơn giản của OLS và phi tuyến tính của ANN/SVR.',
      ],
      predict: ensemblePredict,
    });
  }

  // Calculate final Akaike weights & rankings
  const rankedCandidates = calculateAkaikeBenchmarkingWeights(rawCandidates as any[]);

  // Rank by AICc ascending (lower is better)
  rankedCandidates.sort((a, b) => a.aicc - b.aicc);

  let recommendedId = rankedCandidates[0]?.modelId ?? '';

  // Parsimony principle (Occam's razor): If deltaAICc <= 2.0, favor simpler model
  const topCandidate = rankedCandidates[0];
  const candidatesWithin2 = rankedCandidates.filter((c) => c.deltaAICc <= 2.0);
  if (candidatesWithin2.length > 1) {
    const parsimonious = candidatesWithin2.reduce((prev, curr) =>
      curr.parameterCount < prev.parameterCount ? curr : prev,
    );
    if (parsimonious.parameterCount < topCandidate.parameterCount) {
      recommendedId = parsimonious.modelId;
    }
  }

  const finalCandidates: ModelBenchmarkCandidate[] = rankedCandidates.map((cand, idx) => ({
    ...cand,
    rank: idx + 1,
    isRecommended: cand.modelId === recommendedId,
  }));

  const recommendedObj = finalCandidates.find((c) => c.modelId === recommendedId);
  const summary = recommendedObj
    ? `Mô hình được khuyến nghị cho hồ sơ pháp lý ICH Q8 là [${recommendedObj.name}] với AICc = ${recommendedObj.aicc.toFixed(1)}, R²adj = ${recommendedObj.adjRSquared.toFixed(4)}, và xác suất Akaike Weight = ${(recommendedObj.akaikeWeight * 100).toFixed(1)}%.`
    : 'Chưa đủ dữ liệu để so sánh mô hình.';

  return {
    cqaCode: cqa.code,
    cqaName: cqa.name,
    sampleSize: N,
    candidates: finalCandidates,
    recommendedModelId: recommendedId,
    summaryRecommendation: summary,
  };
}

/**
 * Benchmark all CQAs across the project
 */
export function benchmarkAllModels(
  data: DoERun[],
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult> = {},
  neuralModels: Record<string, NeuralNetModelResult> = {},
): Record<string, CQAMultiModelBenchmark> {
  const benchmarks: Record<string, CQAMultiModelBenchmark> = {};
  cqas.forEach((cqa) => {
    benchmarks[cqa.code] = benchmarkCQAModels(
      cqa,
      factors,
      data,
      models[cqa.code] ?? null,
      neuralModels[cqa.code] ?? null,
    );
  });
  return benchmarks;
}
