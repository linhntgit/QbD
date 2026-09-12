import type {
  Factor,
  CQA,
  DoERun,
  NeuralNetModelResult,
  NeuralLayerWeights,
} from '../types/qbd';

/**
 * Trained weights structure matching both standard ANN MLP and matrix representations
 */
export interface GenericNeuralWeights {
  w1: number[][]; // [hiddenNodes x inputNodes] or [inputNodes x hiddenNodes]
  b1?: number[];
  w2?: number[][];
  b2?: number[];
  wOut: number[][]; // [outputNodes x hiddenNodes] or [hiddenNodes x outputNodes]
  bOut?: number[] | number;
}

export interface GarsonImportance {
  factorCode: string;
  factorName: string;
  relativeImportance: number; // 0 - 100%
  rank: number;
}

export interface OldenInfluence {
  factorCode: string;
  factorName: string;
  connectionWeight: number; // raw signed connection weight
  relativeImportance: number; // 0 - 100%
  direction: 'positive' | 'negative' | 'neutral';
  rank: number;
}

export interface LocalSHAPValue {
  factorCode: string;
  factorName: string;
  codedValue: number;
  actualValue: number | string;
  shapValue: number; // phi_i(x)
}

export interface RunSHAPExplanation {
  runOrder: number;
  actual?: number | null;
  prediction: number; // f(x)
  baseValue: number; // phi_0 = E[f(X)]
  sumShap: number; // sum(phi_i)
  efficiencyError: number; // |f(x) - phi_0 - sum(phi_i)|
  values: LocalSHAPValue[];
}

export interface GlobalSHAPImportance {
  factorCode: string;
  factorName: string;
  meanAbsShap: number; // (1/N) * sum |phi_i(x)|
  relativeImportance: number; // % of total sum
  direction: 'positive' | 'negative' | 'neutral';
  rank: number;
}

export interface SHAPAnalysisResult {
  baseValue: number; // phi_0
  globalImportance: GlobalSHAPImportance[];
  runExplanations: RunSHAPExplanation[];
  method: 'exact' | 'permutation';
  sampleCount: number;
  factorCount: number;
  values?: Record<string, number>;
}

export interface XAIComparisonRow {
  factorCode: string;
  factorName: string;
  garsonRank: number;
  garsonImportance: number;
  oldenRank: number;
  oldenImportance: number;
  oldenDirection: 'positive' | 'negative' | 'neutral';
  shapRank: number;
  shapImportance: number;
  shapDirection: 'positive' | 'negative' | 'neutral';
  consensusImportance: number;
  consensusRank: number;
  riskCategory: 'High' | 'Medium' | 'Low';
}

export interface XAIComprehensiveResult {
  cqaCode: string;
  cqaName: string;
  garson: Record<string, number>;
  olden: Record<string, number>;
  shap: SHAPAnalysisResult;
  garsonList: GarsonImportance[];
  oldenList: OldenInfluence[];
  comparisonTable: XAIComparisonRow[];
}

export interface CQAImpactMatrixItem {
  factorCode: string;
  factorName: string;
  cqaImpacts: Record<
    string,
    {
      importance: number;
      direction: 'positive' | 'negative' | 'neutral';
      riskCategory: 'High' | 'Medium' | 'Low';
    }
  >;
  overallMaxImpact: number;
  criticality: 'Critical' | 'Key' | 'Non-Critical';
}

/**
 * Standardize weight matrix dimensions:
 * Ensures W1 is [inputs x hidden1] and WOut is [hiddenLast x outputs]
 */
function normalizeWeightOrientations(weights: NeuralLayerWeights | GenericNeuralWeights): {
  W1: number[][]; // [inputs x h1]
  W2?: number[][]; // [h1 x h2]
  WOut: number[][]; // [lastHidden x outputs]
} {
  let W1: number[][];
  let W2: number[][] | undefined;
  let WOut: number[][];

  if ('W1' in weights) {
    // NeuralLayerWeights format from neuralNetwork.ts:
    // W1 is [numInputs x h1]
    // W2 is [h1 x h2]
    // WOut is [lastHidden x numOutputs]
    W1 = weights.W1.map((r) => [...r]);
    W2 = weights.W2 ? weights.W2.map((r) => [...r]) : undefined;
    WOut = weights.WOut.map((r) => [...r]);
  } else {
    // Generic weights: determine if w1 is [hidden x inputs] or [inputs x hidden]
    const rawW1 = weights.w1;
    const rawWOut = weights.wOut;

    const hiddenNodes = rawW1.length;
    const inputNodes = rawW1[0]?.length ?? 0;

    if (rawWOut[0]?.length === hiddenNodes) {
      // w1 is [hidden x inputs], transpose to [inputs x hidden]
      W1 = Array.from({ length: inputNodes }, (_, i) =>
        Array.from({ length: hiddenNodes }, (_, j) => rawW1[j][i]),
      );
      // wOut is [outputs x hidden], transpose to [hidden x outputs]
      const outNodes = rawWOut.length;
      WOut = Array.from({ length: hiddenNodes }, (_, j) =>
        Array.from({ length: outNodes }, (_, o) => rawWOut[o][j]),
      );
    } else {
      // Already [inputs x hidden] and [hidden x outputs]
      W1 = rawW1.map((r) => [...r]);
      WOut = rawWOut.map((r) => [...r]);
    }

    if (weights.w2) {
      W2 = weights.w2.map((r) => [...r]);
    }
  }

  return { W1, W2, WOut };
}

/**
 * Garson's Algorithm for Relative Importance Percentage
 * Supports:
 * - Direct TrainedWeights object ({ w1: [[...]], wOut: [[...]] }) returning number[]
 * - Full NeuralLayerWeights / Model format returning structured GarsonImportance[]
 */
export function computeGarsonImportance(
  weights: NeuralLayerWeights | GenericNeuralWeights,
  factors?: Factor[],
  inputCodes?: string[],
): number[] & { list?: GarsonImportance[] } {
  // Check if input is in the test-friendly format [hidden x inputs]
  const isDirectHiddenByInput =
    'w1' in weights &&
    'wOut' in weights &&
    weights.w1.length > 0 &&
    weights.wOut.length > 0 &&
    weights.wOut[0].length === weights.w1.length;

  if (isDirectHiddenByInput) {
    const w1 = weights.w1; // [h x m]
    const wOut = weights.wOut; // [outputs x h]
    const h = w1.length;
    const m = w1[0].length;

    const S: number[] = Array(m).fill(0);

    for (let j = 0; j < h; j++) {
      let sumInputs = 0;
      for (let k = 0; k < m; k++) {
        sumInputs += Math.abs(w1[j][k]);
      }
      const safeSumInputs = sumInputs === 0 ? 1e-12 : sumInputs;
      const wOutJ = Math.abs(wOut[0][j]);

      for (let i = 0; i < m; i++) {
        const q_ij = (Math.abs(w1[j][i]) / safeSumInputs) * wOutJ;
        S[i] += q_ij;
      }
    }

    const sumS = S.reduce((a, b) => a + b, 0);
    const safeSumS = sumS === 0 ? 1e-12 : sumS;
    const result = S.map((s) => (s / safeSumS) * 100);
    return result;
  }

  const { W1, W2, WOut } = normalizeWeightOrientations(weights);
  const numInputs = W1.length;
  const h1 = W1[0]?.length ?? 0;

  // Handle 2 hidden layers by matrix multiplying absolute weights: M = |W1| * |W2|
  let M: number[][]; // [numInputs x lastHidden]
  if (W2 && W2.length > 0) {
    const h2 = W2[0].length;
    M = Array.from({ length: numInputs }, () => new Array(h2).fill(0));
    for (let i = 0; i < numInputs; i++) {
      for (let j2 = 0; j2 < h2; j2++) {
        let sum = 0;
        for (let j1 = 0; j1 < h1; j1++) {
          sum += Math.abs(W1[i][j1]) * Math.abs(W2[j1][j2]);
        }
        M[i][j2] = sum;
      }
    }
  } else {
    M = W1.map((row) => row.map(Math.abs));
  }

  const lastHidden = M[0]?.length ?? 0;
  const S: number[] = new Array(numInputs).fill(0);

  for (let j = 0; j < lastHidden; j++) {
    let colSum = 0;
    for (let i = 0; i < numInputs; i++) {
      colSum += M[i][j];
    }
    const safeColSum = colSum === 0 ? 1e-12 : colSum;
    const outWeight = Math.abs(WOut[j]?.[0] ?? 0);

    for (let i = 0; i < numInputs; i++) {
      const q = (M[i][j] / safeColSum) * outWeight;
      S[i] += q;
    }
  }

  const totalS = S.reduce((a, b) => a + b, 0);
  const safeTotalS = totalS === 0 ? 1e-12 : totalS;
  const rawPercentages = S.map((s) => (s / safeTotalS) * 100);

  // If factors are provided, build structured GarsonImportance[]
  if (factors && factors.length > 0) {
    const active = factors.filter((f) => f.controllability !== 'constant');
    const factorList: GarsonImportance[] = active.map((factor, idx) => {
      let codeIdx = idx;
      if (inputCodes) {
        const foundIdx = inputCodes.indexOf(factor.code);
        if (foundIdx !== -1) codeIdx = foundIdx;
      }
      const relImp = rawPercentages[codeIdx] ?? (100 / active.length);
      return {
        factorCode: factor.code,
        factorName: factor.name,
        relativeImportance: Number(relImp.toFixed(2)),
        rank: 0,
      };
    });

    factorList.sort((a, b) => b.relativeImportance - a.relativeImportance);
    factorList.forEach((item, index) => {
      item.rank = index + 1;
    });

    const res = [...rawPercentages] as number[] & { list?: GarsonImportance[] };
    res.list = factorList;
    return res;
  }

  return rawPercentages;
}

/**
 * Olden's Connection Weight Method for Directional (+/-) Influence
 * Returns signed connection weights: positive CW indicates positive impact on CQA.
 */
export function computeOldenWeights(
  weights: NeuralLayerWeights | GenericNeuralWeights,
): number[] {
  // Check if input is in [hidden x inputs] format
  const isDirectHiddenByInput =
    'w1' in weights &&
    'wOut' in weights &&
    weights.w1.length > 0 &&
    weights.wOut.length > 0 &&
    weights.wOut[0].length === weights.w1.length;

  if (isDirectHiddenByInput) {
    const w1 = weights.w1; // [h x m]
    const wOut = weights.wOut; // [outputs x h]
    const h = w1.length;
    const m = w1[0].length;
    const C: number[] = Array(m).fill(0);

    for (let i = 0; i < m; i++) {
      let sumProd = 0;
      for (let j = 0; j < h; j++) {
        sumProd += w1[j][i] * wOut[0][j];
      }
      C[i] = sumProd;
    }
    return C;
  }

  const { W1, W2, WOut } = normalizeWeightOrientations(weights);
  const numInputs = W1.length;
  const h1 = W1[0]?.length ?? 0;

  let effectiveW: number[][]; // [numInputs x lastHidden]
  if (W2 && W2.length > 0) {
    const h2 = W2[0].length;
    effectiveW = Array.from({ length: numInputs }, () => new Array(h2).fill(0));
    for (let i = 0; i < numInputs; i++) {
      for (let j2 = 0; j2 < h2; j2++) {
        let sum = 0;
        for (let j1 = 0; j1 < h1; j1++) {
          sum += W1[i][j1] * W2[j1][j2];
        }
        effectiveW[i][j2] = sum;
      }
    }
  } else {
    effectiveW = W1;
  }

  const lastHidden = effectiveW[0]?.length ?? 0;
  const C: number[] = new Array(numInputs).fill(0);

  for (let i = 0; i < numInputs; i++) {
    let sum = 0;
    for (let j = 0; j < lastHidden; j++) {
      sum += effectiveW[i][j] * (WOut[j]?.[0] ?? 0);
    }
    C[i] = sum;
  }

  return C;
}

/**
 * Calculate Olden influence as structured list
 */
export function calculateOldenInfluenceList(
  weights: NeuralLayerWeights | GenericNeuralWeights,
  factors: Factor[],
  inputCodes?: string[],
): OldenInfluence[] {
  const rawCW = computeOldenWeights(weights);
  const active = factors.filter((f) => f.controllability !== 'constant');

  const absSum = rawCW.reduce((sum, v) => sum + Math.abs(v), 0) || 1e-12;

  const list: OldenInfluence[] = active.map((factor, idx) => {
    let codeIdx = idx;
    if (inputCodes) {
      const foundIdx = inputCodes.indexOf(factor.code);
      if (foundIdx !== -1) codeIdx = foundIdx;
    }
    const cw = rawCW[codeIdx] ?? 0;
    const relImp = (Math.abs(cw) / absSum) * 100;
    const direction: 'positive' | 'negative' | 'neutral' =
      cw > 1e-6 ? 'positive' : cw < -1e-6 ? 'negative' : 'neutral';

    return {
      factorCode: factor.code,
      factorName: factor.name,
      connectionWeight: Number(cw.toFixed(4)),
      relativeImportance: Number(relImp.toFixed(2)),
      direction,
      rank: 0,
    };
  });

  list.sort((a, b) => Math.abs(b.connectionWeight) - Math.abs(a.connectionWeight));
  list.forEach((item, index) => {
    item.rank = index + 1;
  });

  return list;
}

/**
 * Compute Exact Shapley Values (SHAP) for a single instance
 * Guarantees efficiency axiom: sum(phi_i) === predValue - baseValue
 */
export function computeExactSHAP(
  instance: number[],
  predictFn: (x: number[]) => number,
  baseline: number[],
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
      if ((s & (1 << i)) !== 0) continue;

      let sizeS = 0;
      for (let bit = 0; bit < k; bit++) {
        if ((s & (1 << bit)) !== 0) sizeS++;
      }

      const weight = (factorials[sizeS] * factorials[k - sizeS - 1]) / factorials[k];

      const xWithout = baseline.map((b, idx) => ((s & (1 << idx)) !== 0 ? instance[idx] : b));
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
 * Comprehensive Dataset SHAP Analysis (Exact for k <= 8, Permutation for k > 8)
 */
export function calculateExactShapleyValues(
  predict: (coded: Record<string, number>) => number,
  factors: Factor[],
  runs: DoERun[],
  options?: { permutationSamples?: number },
): SHAPAnalysisResult {
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const k = activeFactors.length;
  const numRuns = runs.length;

  // Background baseline: center points or average of runs
  const baselineCoded: Record<string, number> = {};
  activeFactors.forEach((f) => {
    const avg =
      runs.reduce((sum, r) => sum + (r.factorCoded[f.code] ?? 0), 0) /
      Math.max(1, numRuns);
    baselineCoded[f.code] = Number.isFinite(avg) ? avg : 0;
  });

  const baseValue = predict(baselineCoded);

  const runExplanations: RunSHAPExplanation[] = [];
  const factorAbsShapSum: number[] = new Array(k).fill(0);
  const factorCodedVals: number[][] = Array.from({ length: k }, () => []);
  const factorShapVals: number[][] = Array.from({ length: k }, () => []);

  const useExact = k <= 8;
  const factorials: number[] = [1];
  for (let i = 1; i <= k; i++) factorials.push(factorials[i - 1] * i);

  for (const r of runs) {
    const instanceVec = activeFactors.map((f) => r.factorCoded[f.code] ?? 0);
    const predValue = predict(r.factorCoded);
    const shapValues: number[] = new Array(k).fill(0);

    if (useExact) {
      const numSubsets = 1 << k;
      for (let i = 0; i < k; i++) {
        let phi_i = 0;
        for (let s = 0; s < numSubsets; s++) {
          if ((s & (1 << i)) !== 0) continue;
          let sizeS = 0;
          for (let bit = 0; bit < k; bit++) {
            if ((s & (1 << bit)) !== 0) sizeS++;
          }
          const weight = (factorials[sizeS] * factorials[k - sizeS - 1]) / factorials[k];

          const pointWithout: Record<string, number> = {};
          const pointWith: Record<string, number> = {};

          for (let bit = 0; bit < k; bit++) {
            const fCode = activeFactors[bit].code;
            const inCoalition = (s & (1 << bit)) !== 0;
            const valWithout = inCoalition ? instanceVec[bit] : baselineCoded[fCode];
            pointWithout[fCode] = valWithout;
            pointWith[fCode] = bit === i ? instanceVec[bit] : valWithout;
          }

          const diff = predict(pointWith) - predict(pointWithout);
          phi_i += weight * diff;
        }
        shapValues[i] = phi_i;
      }
    } else {
      // Permutation SHAP for k > 8
      const nPerm = options?.permutationSamples ?? 200;
      for (let p = 0; p < nPerm; p++) {
        // Generate random permutation of 0..k-1
        const perm = Array.from({ length: k }, (_, idx) => idx);
        for (let idx = k - 1; idx > 0; idx--) {
          const j = Math.floor(Math.random() * (idx + 1));
          [perm[idx], perm[j]] = [perm[j], perm[idx]];
        }

        const currPoint: Record<string, number> = { ...baselineCoded };
        let prevPred = baseValue;

        for (const featIdx of perm) {
          const fCode = activeFactors[featIdx].code;
          currPoint[fCode] = instanceVec[featIdx];
          const currPred = predict(currPoint);
          shapValues[featIdx] += (currPred - prevPred) / nPerm;
          prevPred = currPred;
        }
      }
    }

    const sumShap = shapValues.reduce((a, b) => a + b, 0);
    const deltaY = predValue - baseValue;
    const efficiencyError = Math.abs(deltaY - sumShap);

    const values: LocalSHAPValue[] = activeFactors.map((f, idx) => {
      const sv = shapValues[idx];
      factorAbsShapSum[idx] += Math.abs(sv);
      factorCodedVals[idx].push(instanceVec[idx]);
      factorShapVals[idx].push(sv);

      return {
        factorCode: f.code,
        factorName: f.name,
        codedValue: instanceVec[idx],
        actualValue: r.factorActual[f.code] ?? instanceVec[idx],
        shapValue: Number(sv.toFixed(4)),
      };
    });

    runExplanations.push({
      runOrder: r.runOrder,
      actual: typeof r.responses !== 'undefined' ? (r.responses as any)[activeFactors[0]?.code] : null,
      prediction: Number(predValue.toFixed(4)),
      baseValue: Number(baseValue.toFixed(4)),
      sumShap: Number(sumShap.toFixed(4)),
      efficiencyError: Number(efficiencyError.toFixed(6)),
      values,
    });
  }

  // Calculate Global Importance & Direction
  const totalMeanAbs = factorAbsShapSum.map((s) => s / Math.max(1, numRuns));
  const sumTotalAbs = totalMeanAbs.reduce((a, b) => a + b, 0) || 1e-12;

  const globalImportance: GlobalSHAPImportance[] = activeFactors.map((f, idx) => {
    const meanAbs = totalMeanAbs[idx];
    const relImp = (meanAbs / sumTotalAbs) * 100;

    // Direction from Pearson correlation between coded factor and SHAP
    const x = factorCodedVals[idx];
    const y = factorShapVals[idx];
    const n = x.length;
    let dir: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (n > 1) {
      const meanX = x.reduce((a, b) => a + b, 0) / n;
      const meanY = y.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let denX = 0;
      let denY = 0;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
      }
      const r = denX * denY > 0 ? num / Math.sqrt(denX * denY) : 0;
      if (r > 0.05) dir = 'positive';
      else if (r < -0.05) dir = 'negative';
    }

    return {
      factorCode: f.code,
      factorName: f.name,
      meanAbsShap: Number(meanAbs.toFixed(4)),
      relativeImportance: Number(relImp.toFixed(2)),
      direction: dir,
      rank: 0,
    };
  });

  globalImportance.sort((a, b) => b.meanAbsShap - a.meanAbsShap);
  globalImportance.forEach((item, index) => {
    item.rank = index + 1;
  });

  const valuesMap: Record<string, number> = {};
  globalImportance.forEach((g) => {
    valuesMap[g.factorCode] = g.relativeImportance;
  });

  return {
    baseValue: Number(baseValue.toFixed(4)),
    globalImportance,
    runExplanations,
    method: useExact ? 'exact' : 'permutation',
    sampleCount: numRuns,
    factorCount: k,
    values: valuesMap,
  };
}

/**
 * High-level unified Explainable AI Engine
 * Compatible with interface contract:
 * computeXAIImportance(model, runs, factors, cqa)
 */
export function computeXAIImportance(
  model: NeuralNetModelResult,
  runs: DoERun[],
  factors: Factor[],
  cqa?: CQA,
): XAIComprehensiveResult {
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const cqaCode = cqa?.code ?? model.cqaCode ?? 'Y1';
  const cqaName = cqa?.name ?? model.cqaCode ?? 'Response';

  // 1. Garson's Algorithm
  const garsonArray = computeGarsonImportance(model.weights, factors, model.inputFactorCodes);
  const garsonList = garsonArray.list ?? [];
  const garsonMap: Record<string, number> = {};
  garsonList.forEach((g) => {
    garsonMap[g.factorCode] = g.relativeImportance;
  });

  // 2. Olden's Connection Weight Method
  const oldenList = calculateOldenInfluenceList(model.weights, factors, model.inputFactorCodes);
  const oldenMap: Record<string, number> = {};
  oldenList.forEach((o) => {
    oldenMap[o.factorCode] = o.connectionWeight;
  });

  // 3. Exact SHAP Values
  const shap = calculateExactShapleyValues(model.predict, factors, runs);

  // 4. Consensus Comparison Table
  const comparisonTable: XAIComparisonRow[] = activeFactors.map((factor) => {
    const gItem = garsonList.find((g) => g.factorCode === factor.code);
    const oItem = oldenList.find((o) => o.factorCode === factor.code);
    const sItem = shap.globalImportance.find((s) => s.factorCode === factor.code);

    const gImp = gItem?.relativeImportance ?? 0;
    const oImp = oItem?.relativeImportance ?? 0;
    const sImp = sItem?.relativeImportance ?? 0;

    const consensusImp = (gImp + oImp + sImp) / 3;
    const riskCat: 'High' | 'Medium' | 'Low' =
      consensusImp >= 30 ? 'High' : consensusImp >= 10 ? 'Medium' : 'Low';

    return {
      factorCode: factor.code,
      factorName: factor.name,
      garsonRank: gItem?.rank ?? 0,
      garsonImportance: gImp,
      oldenRank: oItem?.rank ?? 0,
      oldenImportance: oImp,
      oldenDirection: oItem?.direction ?? 'neutral',
      shapRank: sItem?.rank ?? 0,
      shapImportance: sImp,
      shapDirection: sItem?.direction ?? 'neutral',
      consensusImportance: Number(consensusImp.toFixed(2)),
      consensusRank: 0,
      riskCategory: riskCat,
    };
  });

  comparisonTable.sort((a, b) => b.consensusImportance - a.consensusImportance);
  comparisonTable.forEach((row, idx) => {
    row.consensusRank = idx + 1;
  });

  return {
    cqaCode,
    cqaName,
    garson: garsonMap,
    olden: oldenMap,
    shap,
    garsonList,
    oldenList,
    comparisonTable,
  };
}

/**
 * Generate CQA vs CPP Impact Matrix Heatmap
 */
export function generateCQAImpactMatrix(
  cqas: CQA[],
  factors: Factor[],
  xaiResults: Record<string, XAIComprehensiveResult>,
): CQAImpactMatrixItem[] {
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');

  return activeFactors.map((factor) => {
    const cqaImpacts: Record<
      string,
      {
        importance: number;
        direction: 'positive' | 'negative' | 'neutral';
        riskCategory: 'High' | 'Medium' | 'Low';
      }
    > = {};

    let maxImp = 0;

    cqas.forEach((cqa) => {
      const res = xaiResults[cqa.code];
      if (res) {
        const row = res.comparisonTable.find((r) => r.factorCode === factor.code);
        if (row) {
          cqaImpacts[cqa.code] = {
            importance: row.consensusImportance,
            direction: row.shapDirection !== 'neutral' ? row.shapDirection : row.oldenDirection,
            riskCategory: row.riskCategory,
          };
          if (row.consensusImportance > maxImp) maxImp = row.consensusImportance;
        }
      }
    });

    const criticality: 'Critical' | 'Key' | 'Non-Critical' =
      maxImp >= 30 ? 'Critical' : maxImp >= 10 ? 'Key' : 'Non-Critical';

    return {
      factorCode: factor.code,
      factorName: factor.name,
      cqaImpacts,
      overallMaxImpact: Number(maxImp.toFixed(2)),
      criticality,
    };
  });
}
