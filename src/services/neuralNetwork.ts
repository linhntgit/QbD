import type {
  Factor,
  CQA,
  DoERun,
  NeuralNetConfig,
  NeuralNetModelResult,
  NeuralLayerWeights,
  FactorSensitivity,
  NeuralResidual,
  NeuralActivation,
  SerializedNeuralNetModel,
  DesirabilitySolution,
} from '../types/qbd';
import {
  calculateCarpenterArchitecture,
} from './mathUtils';
import { projectToBoundedMixture, optimizeDesirability } from './statistics';
import { buildFactorFeatures } from './modelTerms';

export const getNeuralArtifactFingerprint = (factors: Factor[], cqas: CQA[], runs: DoERun[]): string => {
  const source = JSON.stringify({ algorithm: 'ann-audit-2026-09-05', factors, cqas, runs });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ann-v1-${(hash >>> 0).toString(16)}`;
};

export const serializeNeuralModels = (models: Record<string, NeuralNetModelResult>): Record<string, SerializedNeuralNetModel> =>
  Object.fromEntries(Object.entries(models).map(([code, model]) => {
    const { predict: _predict, ...artifact } = model;
    return [code, artifact];
  }));

export const hydrateNeuralModels = (
  artifacts: Record<string, SerializedNeuralNetModel>,
  factors: Factor[],
  runs: DoERun[],
): Record<string, NeuralNetModelResult> => {
  const active = factors.filter((factor) => factor.controllability !== 'constant');
  const features = buildFactorFeatures(active);
  const blockLevels = [...new Set(runs.map((run) => Math.max(1, Math.floor(run.block ?? 1))))].sort((a, b) => a - b);
  const blockFeatures = blockLevels.slice(1);
  const expectedInputs = [...features.map((feature) => feature.name), ...blockFeatures.map((block) => `Block ${block}`)];
  return Object.fromEntries(Object.entries(artifacts).flatMap(([code, artifact]) => {
    if (artifact.inputFactorCodes.join('|') !== expectedInputs.join('|')) return [];
    const { W1, b1, W2, b2, WOut, bOut } = artifact.weights;
    const activation = artifact.config.activation;
    const predict = (coded: Record<string, number>): number => {
      const input = [...features.map((feature) => feature.evaluator(coded)), ...blockFeatures.map(() => 0)];
      const layer1 = b1.map((bias, j) => activate(bias + input.reduce((sum, value, k) => sum + value * W1[k][j], 0), activation));
      const last = W2 && b2 ? b2.map((bias, j) => activate(bias + layer1.reduce((sum, value, k) => sum + value * W2[k][j], 0), activation)) : layer1;
      return (bOut + last.reduce((sum, value, k) => sum + value * WOut[k][0], 0)) * artifact.normParams.ySd + artifact.normParams.yMean;
    };
    return [[code, { ...artifact, predict }]];
  }));
};
import { getConfiguredFactorCodes, isDiscreteFactor } from './doeGenerator';

/** Draw and perturb points only inside the physically feasible mixture simplex.
 * Non-mixture inputs retain their coded [-1, 1] survey range. */
function sampleFeasibleSensitivityPoint(factors: Factor[], rng: () => number): number[] {
  const point = factors.map((factor) => {
    if (factor.role === 'mixture_component' || factor.type === 'Mixture') return 0;
    if (isDiscreteFactor(factor)) {
      const codes = getConfiguredFactorCodes(factor);
      return codes[Math.min(codes.length - 1, Math.floor(rng() * codes.length))] ?? 0;
    }
    return rng() * 2 - 1;
  });
  const mixtureIndexes = factors
    .map((factor, index) => (factor.role === 'mixture_component' || factor.type === 'Mixture' ? index : -1))
    .filter((index) => index >= 0);
  if (mixtureIndexes.length < 2) return point;

  const lower = mixtureIndexes.map((index) => {
    const factor = factors[index];
    return factor.high <= 1 && factor.unit !== '%' ? factor.low : factor.low / 100;
  });
  const upper = mixtureIndexes.map((index) => {
    const factor = factors[index];
    return factor.high <= 1 && factor.unit !== '%' ? factor.high : factor.high / 100;
  });
  const composition = projectToBoundedMixture(mixtureIndexes.map(() => rng()), lower, upper, 1);
  mixtureIndexes.forEach((index, mixtureIndex) => {
    point[index] = composition[mixtureIndex] ?? lower[mixtureIndex];
  });
  return point;
}

function perturbFeasibleSensitivityPoint(
  point: number[],
  index: number,
  factors: Factor[],
  delta: number,
): number[] {
  const perturbed = [...point];
  const factor = factors[index];
  const isMixture = factor.role === 'mixture_component' || factor.type === 'Mixture';
  if (!isMixture) {
    if (isDiscreteFactor(factor)) {
      const codes = getConfiguredFactorCodes(factor);
      const currentIndex = codes.reduce((best, code, candidateIndex) =>
        Math.abs(code - point[index]) < Math.abs(codes[best] - point[index]) ? candidateIndex : best, 0);
      const nextIndex = currentIndex < codes.length - 1 ? currentIndex + 1 : Math.max(0, currentIndex - 1);
      perturbed[index] = codes[nextIndex] ?? point[index];
      return perturbed;
    }
    perturbed[index] = Math.max(-1, Math.min(1, perturbed[index] + delta));
    return perturbed;
  }

  const mixtureIndexes = factors
    .map((candidate, candidateIndex) => (candidate.role === 'mixture_component' || candidate.type === 'Mixture' ? candidateIndex : -1))
    .filter((candidateIndex) => candidateIndex >= 0);
  const lower = mixtureIndexes.map((mixtureIndex) => {
    const candidate = factors[mixtureIndex];
    return candidate.high <= 1 && candidate.unit !== '%' ? candidate.low : candidate.low / 100;
  });
  const upper = mixtureIndexes.map((mixtureIndex) => {
    const candidate = factors[mixtureIndex];
    return candidate.high <= 1 && candidate.unit !== '%' ? candidate.high : candidate.high / 100;
  });
  const composition = projectToBoundedMixture(
    mixtureIndexes.map((mixtureIndex) => point[mixtureIndex] + (mixtureIndex === index ? delta : 0)),
    lower,
    upper,
    1,
  );
  mixtureIndexes.forEach((mixtureIndex, compositionIndex) => {
    perturbed[mixtureIndex] = composition[compositionIndex] ?? point[mixtureIndex];
  });
  return perturbed;
}

/**
 * Seedable pseudo-random number generator (Mulberry32)
 */
function createRNG(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard Normal Random Generator (Box-Muller) using custom RNG
 */
function randomNormal(rng: () => number, mean: number = 0, std: number = 1): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * std;
}

/**
 * Activation function evaluation and its derivative
 */
function activate(x: number, func: NeuralActivation): number {
  switch (func) {
    case 'tanh':
      return Math.tanh(x);
    case 'linear':
      return x;
    case 'gaussian':
      return Math.exp(-x * x);
    case 'sigmoid':
      return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
    case 'relu':
      return Math.max(0, x);
    default:
      return Math.tanh(x);
  }
}

function activateDerivative(x: number, a: number, func: NeuralActivation): number {
  switch (func) {
    case 'tanh':
      return 1 - a * a;
    case 'linear':
      return 1;
    case 'gaussian':
      return -2 * x * a;
    case 'sigmoid':
      return a * (1 - a);
    case 'relu':
      return x > 0 ? 1 : 0;
    default:
      return 1 - a * a;
  }
}

/**
 * Default Neural Net Configuration
 */
export const DEFAULT_NEURAL_CONFIG: NeuralNetConfig = {
  hiddenNodes1: 3,
  hiddenNodes2: 0,
  activation: 'tanh',
  weightDecay: 0.01,
  learningRate: 0.03,
  maxEpochs: 1000,
  validationMethod: 'kfold',
  holdoutRatio: 0.25,
  kFolds: 5,
  numTours: 10,
  seed: 42,
};

export interface NeuralValidationSplit {
  trainIdx: number[];
  valIdx: number[];
}

/** Pool exactly one out-of-fold prediction per response, then refit all rows.
 * Restart/epoch selection is confined to training loss inside each fold.
 */
function crossValidatedModels(
  config: NeuralNetConfig,
  splits: NeuralValidationSplit[],
  fit: (config: NeuralNetConfig, split?: NeuralValidationSplit) => Record<string, NeuralNetModelResult>,
): Record<string, NeuralNetModelResult> {
  const pooled: Record<string, NeuralResidual[]> = {};
  for (const split of splits) {
    const models = fit({ ...config, validationMethod: 'holdout' }, split);
    if (Object.keys(models).length === 0) return {};
    for (const [code, model] of Object.entries(models)) {
      (pooled[code] ??= []).push(...model.diagnostics.residuals.filter((row) => row.isValidation));
    }
  }
  const final = fit({ ...config, validationMethod: 'none' });
  for (const [code, model] of Object.entries(final)) {
    const residuals = pooled[code] ?? [];
    if (residuals.length !== model.diagnostics.residuals.length) { delete final[code]; continue; }
    const n = residuals.length;
    const mean = residuals.reduce((sum, row) => sum + row.actual, 0) / n;
    const sst = residuals.reduce((sum, row) => sum + (row.actual - mean) ** 2, 0);
    const sse = residuals.reduce((sum, row) => sum + row.residual ** 2, 0);
    const mae = residuals.reduce((sum, row) => sum + Math.abs(row.residual), 0) / n;
    const r2 = n > 1 && sst > 0 ? 1 - sse / sst : NaN;
    model.config = config;
    Object.assign(model.diagnostics, {
      trainingSampleCount: Math.min(...splits.map((split) => split.trainIdx.length)),
      validationSampleCount: n, validationKind: 'out-of-fold',
      rSquaredVal: r2, rmseVal: Math.sqrt(sse / n), maeVal: mae, sseVal: sse,
      rSquaredOverall: r2, rmseOverall: Math.sqrt(sse / n), maeOverall: mae, sseOverall: sse,
      residuals: residuals.sort((a, b) => a.runOrder - b.runOrder),
    });
  }
  return final;
}

/** Objective whose derivative is used in backprop: sum-output SSE/(2N) + λ||W||²/2. */
function networkTrainingLoss(
  inputs: number[][], targets: number[][], mask: boolean[][], indices: number[],
  weights: { W1: number[][]; b1: number[]; W2?: number[][]; b2?: number[]; WOut: number[][]; bOut: number[] },
  activation: NeuralActivation, lambda: number,
): number {
  let sse = 0;
  for (const index of indices) {
    const a1 = weights.b1.map((bias, j) => activate(bias + inputs[index].reduce((sum, value, k) => sum + value * weights.W1[k][j], 0), activation));
    const last = weights.W2 && weights.b2 ? weights.b2.map((bias, j) => activate(bias + a1.reduce((sum, value, k) => sum + value * weights.W2![k][j], 0), activation)) : a1;
    weights.bOut.forEach((bias, c) => {
      if (mask[index][c]) {
        const prediction = bias + last.reduce((sum, value, k) => sum + value * weights.WOut[k][c], 0);
        sse += (prediction - targets[index][c]) ** 2;
      }
    });
  }
  const penalty = [weights.W1, weights.W2 ?? [], weights.WOut].reduce((sum, matrix) =>
    sum + matrix.reduce((subtotal, row) => subtotal + row.reduce((acc, value) => acc + value * value, 0), 0), 0);
  return sse / (2 * indices.length) + lambda * penalty / 2;
}

/**
 * Create deterministic validation partitions.  K-fold rotates every valid
 * experiment through validation exactly once; its largest validation fold is
 * used for conservative architecture/sample-size checks.
 */
export function getNeuralValidationSplits(sampleCount: number, config: NeuralNetConfig): NeuralValidationSplit[] {
  const indices = Array.from({ length: sampleCount }, (_, index) => index);
  const rng = createRNG(config.seed + 7919);
  for (let index = indices.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }

  if (config.validationMethod === 'kfold' && sampleCount >= 4) {
    const k = Math.max(2, Math.min(Math.floor(config.kFolds || 5), sampleCount));
    return Array.from({ length: k }, (_, fold) => {
      const start = Math.floor((fold * sampleCount) / k);
      const end = Math.floor(((fold + 1) * sampleCount) / k);
      const valIdx = indices.slice(start, end);
      return { trainIdx: indices.filter((_, index) => index < start || index >= end), valIdx };
    });
  }

  if (config.validationMethod === 'holdout' && config.holdoutRatio > 0 && sampleCount >= 6) {
    const validationCount = Math.max(1, Math.min(Math.floor(sampleCount * 0.4), Math.round(sampleCount * config.holdoutRatio)));
    return [{ trainIdx: indices.slice(validationCount), valIdx: indices.slice(0, validationCount) }];
  }

  return [{ trainIdx: indices, valIdx: [] }];
}

export function getNeuralTrainingSampleCount(sampleCount: number, config: NeuralNetConfig): number {
  return Math.min(...getNeuralValidationSplits(sampleCount, config).map((split) => split.trainIdx.length));
}

/**
 * Calculate Neural Network Learnable Parameter Count and Overfitting Risk Metrics
 */
export function calculateNeuralArchitectureMetrics(
  numInputs: number,
  hidden1: number,
  hidden2: number,
  numOutputs: number,
  numSamples: number
): {
  numInputs: number;
  hidden1: number;
  hidden2: number;
  numOutputs: number;
  totalParameters: number;
  numSamples: number;
  sampleToParamRatio: number;
  overfittingRisk: 'safe' | 'warning' | 'danger';
  carpenterRecommended?: number;
  rules?: { name: string; value: number; description: string }[];
  recommendation: string;
} {
  const h1 = Math.max(1, hidden1);
  const h2 = Math.max(0, hidden2);
  const m = Math.max(1, numOutputs);

  const p1 = (numInputs + 1) * h1; // W1 (numInputs x h1) + b1 (h1)
  const p2 = h2 > 0 ? (h1 + 1) * h2 : 0; // W2 (h1 x h2) + b2 (h2)
  const lastHidden = h2 > 0 ? h2 : h1;
  const pOut = (lastHidden + 1) * m; // WOut (lastHidden x m) + bOut (m)
  const totalParameters = p1 + p2 + pOut;

  const sampleToParamRatio = totalParameters > 0 ? Number((numSamples / totalParameters).toFixed(2)) : 0;

  const carp = calculateCarpenterArchitecture(numInputs, m, numSamples, 1.2);

  let overfittingRisk: 'safe' | 'warning' | 'danger' = 'safe';
  let recommendation = '';

  if (sampleToParamRatio >= 2.0) {
    overfittingRisk = 'safe';
    recommendation = `Kích thước mẫu đủ lớn so với số tham số mạng (N/P = ${sampleToParamRatio} ≥ 2.0). Khuyến nghị số neuron theo Carpenter (1995): h = ${carp.carpenterRecommended}.`;
  } else if (sampleToParamRatio >= 1.0) {
    overfittingRisk = 'warning';
    recommendation = `Cảnh báo nguy cơ quá khớp trung bình (1.0 ≤ N/P < 2.0). Khuyến nghị cấu trúc theo Carpenter: h = ${carp.carpenterRecommended}, bật L2 Regularization (Weight Decay ≥ 0.01).`;
  } else {
    overfittingRisk = 'danger';
    recommendation = `BÁO ĐỘNG OVERFITTING: Số tham số mạng (${totalParameters}) lớn hơn số thí nghiệm (${numSamples})! Khuyến nghị hạ số neuron xuống h = ${carp.carpenterRecommended} theo công thức Carpenter và đặt Weight Decay ≥ 0.05.`;
  }

  return {
    numInputs,
    hidden1: h1,
    hidden2: h2,
    numOutputs: m,
    totalParameters,
    numSamples,
    sampleToParamRatio,
    overfittingRisk,
    carpenterRecommended: carp.carpenterRecommended,
    rules: carp.rules,
    recommendation,
  };
}

/**
 * Fit a Neural Network Model for Experimental Data (MLP Architecture)
 */
export function fitNeuralNetModel(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  userConfig: Partial<NeuralNetConfig> = {},
  splitOverride?: NeuralValidationSplit,
): NeuralNetModelResult | null {
  if (cqa.dataType?.startsWith('qualitative') || cqa.objective === 'pass_category') return null;
  const config: NeuralNetConfig = { ...DEFAULT_NEURAL_CONFIG, ...userConfig };
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const inputFeatures = buildFactorFeatures(activeFactors);
  const blockLevels = [...new Set(runs.map((run) => Math.max(1, Math.floor(run.block ?? 1))))].sort((a, b) => a - b);
  const blockFeatures = blockLevels.slice(1);
  const blockValues = (block?: number) => blockFeatures.map((level) => Math.max(1, Math.floor(block ?? 1)) === level ? 1 : 0);
  const numInputs = inputFeatures.length + blockFeatures.length;

  if (numInputs === 0) return null;

  // 1. Parse and extract valid data points
  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') {
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };

  const validData = runs
    .map((r) => ({
      run: r,
      x: [...inputFeatures.map((feature) => feature.evaluator(r.factorCoded)), ...blockValues(r.block)],
      y: parseResponse(r.responses[cqa.code]),
    }))
    .filter((d): d is { run: DoERun; x: number[]; y: number } => d.y !== null);

  const N = validData.length;
  if (N < 4) return null; // Need minimum data points

  const validationSplits = splitOverride ? [splitOverride] : getNeuralValidationSplits(N, config);
  if (config.validationMethod === 'kfold' && !splitOverride) {
    return crossValidatedModels(config, validationSplits, (cfg, split) => {
      const model = fitNeuralNetModel(cqa, factors, runs, cfg, split);
      return model ? { [cqa.code]: model } : {};
    })[cqa.code] ?? null;
  }
  const yValues = validData.map((d) => d.y);
  const trainingY = validationSplits[0].trainIdx.map((index) => yValues[index]);
  const yMean = trainingY.reduce((a, b) => a + b, 0) / trainingY.length;
  const yVar = trainingY.reduce((sum, value) => sum + (value - yMean) ** 2, 0) / Math.max(1, trainingY.length - 1);
  const ySd = Math.sqrt(Math.max(1e-6, yVar));
  const X_all = validData.map((d) => [...d.x]);
  const Y_norm_all = yValues.map((value) => (value - yMean) / ySd);

  const h1 = Math.max(1, config.hiddenNodes1);
  const h2 = Math.max(0, config.hiddenNodes2);
  const hasLayer2 = h2 > 0;
  const act = config.activation;
  const lambda = config.weightDecay;
  const lr = config.learningRate;
  const parameterCount = calculateNeuralArchitectureMetrics(numInputs, h1, h2, 1, N).totalParameters;
  if (validationSplits[0].trainIdx.length <= parameterCount) return null;

  let bestGlobalSelectionLoss = Infinity;
  let bestGlobalWeights: NeuralLayerWeights | null = null;
  let bestGlobalTourIndex = 0;
  let bestGlobalLossHistory: { epoch: number; trainLoss: number; valLoss?: number }[] = [];
  let bestGlobalSplit: { trainIdx: number[]; valIdx: number[] } | null = null;

  // 3. Every K-fold is trained independently; each observation is held out
  // once when K-fold validation is selected.
  for (let fold = 0; fold < validationSplits.length; fold++) {
    const { trainIdx, valIdx } = validationSplits[fold];
    for (let tour = 0; tour < config.numTours; tour++) {
    const tourSeed = config.seed + fold * 1_000_003 + tour * 10007;
    const rng = createRNG(tourSeed);

    const nTrain = trainIdx.length;

    // Xavier/Glorot Initialization
    const std1 = Math.sqrt(2.0 / (numInputs + h1));
    const W1: number[][] = Array.from({ length: numInputs }, () =>
      Array.from({ length: h1 }, () => randomNormal(rng, 0, std1))
    );
    const b1: number[] = new Array(h1).fill(0);

    let W2: number[][] = [];
    let b2: number[] = [];
    if (hasLayer2) {
      const std2 = Math.sqrt(2.0 / (h1 + h2));
      W2 = Array.from({ length: h1 }, () =>
        Array.from({ length: h2 }, () => randomNormal(rng, 0, std2))
      );
      b2 = new Array(h2).fill(0);
    }

    const lastHidden = hasLayer2 ? h2 : h1;
    const stdOut = Math.sqrt(2.0 / (lastHidden + 1));
    const WOut: number[][] = Array.from({ length: lastHidden }, () => [
      randomNormal(rng, 0, stdOut),
    ]);
    let bOut = 0;

    // Adam optimizer moment states
    const mW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
    const vW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
    const mb1 = new Array(h1).fill(0);
    const vb1 = new Array(h1).fill(0);

    const mW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
    const vW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
    const mb2 = hasLayer2 ? new Array(h2).fill(0) : [];
    const vb2 = hasLayer2 ? new Array(h2).fill(0) : [];

    const mWOut = Array.from({ length: lastHidden }, () => [0]);
    const vWOut = Array.from({ length: lastHidden }, () => [0]);
    let mbOut = 0;
    let vbOut = 0;

    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;

    let tourBestSelectionLoss = Infinity;
    let tourBestWeights: NeuralLayerWeights = {
      W1: W1.map((r) => [...r]),
      b1: [...b1],
      W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
      b2: hasLayer2 ? [...b2] : undefined,
      WOut: WOut.map((r) => [...r]),
      bOut,
    };

    const lossHistory: { epoch: number; trainLoss: number; valLoss?: number }[] = [];

    // Training Epochs
    for (let epoch = 1; epoch <= config.maxEpochs; epoch++) {
      // Forward pass on training samples
      const gradW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
      const gradB1 = new Array(h1).fill(0);
      const gradW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
      const gradB2 = hasLayer2 ? new Array(h2).fill(0) : [];
      const gradWOut = Array.from({ length: lastHidden }, () => [0]);
      let gradBOut = 0;


      for (let i = 0; i < nTrain; i++) {
        const idx = trainIdx[i];
        const x = X_all[idx];
        const yTrue = Y_norm_all[idx];

        // Layer 1
        const z1: number[] = new Array(h1).fill(0);
        const a1: number[] = new Array(h1).fill(0);
        for (let j = 0; j < h1; j++) {
          let sum = b1[j];
          for (let k = 0; k < numInputs; k++) sum += x[k] * W1[k][j];
          z1[j] = sum;
          a1[j] = activate(sum, act);
        }

        // Layer 2 (if present)
        let z2: number[] = [];
        let a2: number[] = [];
        if (hasLayer2) {
          z2 = new Array(h2).fill(0);
          a2 = new Array(h2).fill(0);
          for (let j = 0; j < h2; j++) {
            let sum = b2[j];
            for (let k = 0; k < h1; k++) sum += a1[k] * W2[k][j];
            z2[j] = sum;
            a2[j] = activate(sum, act);
          }
        }

        // Output layer
        const aLast = hasLayer2 ? a2 : a1;
        let yPredNorm = bOut;
        for (let k = 0; k < lastHidden; k++) {
          yPredNorm += aLast[k] * WOut[k][0];
        }

        const err = yPredNorm - yTrue;

        // Backprop Output
        const deltaOut = err;
        gradBOut += deltaOut;
        for (let k = 0; k < lastHidden; k++) {
          gradWOut[k][0] += deltaOut * aLast[k];
        }

        // Backprop Layer 2 (if present)
        if (hasLayer2) {
          const delta2: number[] = new Array(h2).fill(0);
          for (let j = 0; j < h2; j++) {
            const dAct = activateDerivative(z2[j], a2[j], act);
            delta2[j] = deltaOut * WOut[j][0] * dAct;
            gradB2[j] += delta2[j];
            for (let k = 0; k < h1; k++) {
              gradW2[k][j] += delta2[j] * a1[k];
            }
          }

          // Backprop Layer 1 from Layer 2
          for (let j = 0; j < h1; j++) {
            let sumDelta = 0;
            for (let k = 0; k < h2; k++) {
              sumDelta += delta2[k] * W2[j][k];
            }
            const dAct1 = activateDerivative(z1[j], a1[j], act);
            const delta1 = sumDelta * dAct1;
            gradB1[j] += delta1;
            for (let k = 0; k < numInputs; k++) {
              gradW1[k][j] += delta1 * x[k];
            }
          }
        } else {
          // Backprop Layer 1 directly from Output
          for (let j = 0; j < h1; j++) {
            const dAct1 = activateDerivative(z1[j], a1[j], act);
            const delta1 = deltaOut * WOut[j][0] * dAct1;
            gradB1[j] += delta1;
            for (let k = 0; k < numInputs; k++) {
              gradW1[k][j] += delta1 * x[k];
            }
          }
        }
      }

      // Average gradients and add L2 weight decay regularization
      const invNTrain = 1.0 / nTrain;
      for (let k = 0; k < lastHidden; k++) {
        gradWOut[k][0] = gradWOut[k][0] * invNTrain + lambda * WOut[k][0];
      }
      gradBOut *= invNTrain;

      if (hasLayer2) {
        for (let j = 0; j < h1; j++) {
          for (let k = 0; k < h2; k++) {
            gradW2[j][k] = gradW2[j][k] * invNTrain + lambda * W2[j][k];
          }
        }
        for (let k = 0; k < h2; k++) gradB2[k] *= invNTrain;
      }

      for (let k = 0; k < numInputs; k++) {
        for (let j = 0; j < h1; j++) {
          gradW1[k][j] = gradW1[k][j] * invNTrain + lambda * W1[k][j];
        }
      }
      for (let j = 0; j < h1; j++) gradB1[j] *= invNTrain;

      // Adam parameter update for Layer 1
      for (let k = 0; k < numInputs; k++) {
        for (let j = 0; j < h1; j++) {
          const g = gradW1[k][j];
          mW1[k][j] = beta1 * mW1[k][j] + (1 - beta1) * g;
          vW1[k][j] = beta2 * vW1[k][j] + (1 - beta2) * g * g;
          const mHat = mW1[k][j] / (1 - Math.pow(beta1, epoch));
          const vHat = vW1[k][j] / (1 - Math.pow(beta2, epoch));
          W1[k][j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
        }
      }
      for (let j = 0; j < h1; j++) {
        const g = gradB1[j];
        mb1[j] = beta1 * mb1[j] + (1 - beta1) * g;
        vb1[j] = beta2 * vb1[j] + (1 - beta2) * g * g;
        const mHat = mb1[j] / (1 - Math.pow(beta1, epoch));
        const vHat = vb1[j] / (1 - Math.pow(beta2, epoch));
        b1[j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }

      // Adam update for Layer 2
      if (hasLayer2) {
        for (let j = 0; j < h1; j++) {
          for (let k = 0; k < h2; k++) {
            const g = gradW2[j][k];
            mW2[j][k] = beta1 * mW2[j][k] + (1 - beta1) * g;
            vW2[j][k] = beta2 * vW2[j][k] + (1 - beta2) * g * g;
            const mHat = mW2[j][k] / (1 - Math.pow(beta1, epoch));
            const vHat = vW2[j][k] / (1 - Math.pow(beta2, epoch));
            W2[j][k] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
          }
        }
        for (let k = 0; k < h2; k++) {
          const g = gradB2[k];
          mb2[k] = beta1 * mb2[k] + (1 - beta1) * g;
          vb2[k] = beta2 * vb2[k] + (1 - beta2) * g * g;
          const mHat = mb2[k] / (1 - Math.pow(beta1, epoch));
          const vHat = vb2[k] / (1 - Math.pow(beta2, epoch));
          b2[k] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
        }
      }

      // Adam update for Output Layer
      for (let k = 0; k < lastHidden; k++) {
        const g = gradWOut[k][0];
        mWOut[k][0] = beta1 * mWOut[k][0] + (1 - beta1) * g;
        vWOut[k][0] = beta2 * vWOut[k][0] + (1 - beta2) * g * g;
        const mHat = mWOut[k][0] / (1 - Math.pow(beta1, epoch));
        const vHat = vWOut[k][0] / (1 - Math.pow(beta2, epoch));
        WOut[k][0] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
      {
        const g = gradBOut;
        mbOut = beta1 * mbOut + (1 - beta1) * g;
        vbOut = beta2 * vbOut + (1 - beta2) * g * g;
        const mHat = mbOut / (1 - Math.pow(beta1, epoch));
        const vHat = vbOut / (1 - Math.pow(beta2, epoch));
        bOut -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }

      const selectionLoss = networkTrainingLoss(X_all, Y_norm_all.map((value) => [value]),
        Y_norm_all.map(() => [true]), trainIdx,
        { W1, b1, W2: hasLayer2 ? W2 : undefined, b2: hasLayer2 ? b2 : undefined, WOut, bOut: [bOut] }, act, lambda);

      if (selectionLoss < tourBestSelectionLoss) {
        tourBestSelectionLoss = selectionLoss;
        tourBestWeights = {
          W1: W1.map((r) => [...r]),
          b1: [...b1],
          W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
          b2: hasLayer2 ? [...b2] : undefined,
          WOut: WOut.map((r) => [...r]),
          bOut,
        };
      }

      // Sample loss history points (up to 50 points across epochs)
      if (epoch === 1 || epoch % Math.max(1, Math.floor(config.maxEpochs / 50)) === 0 || epoch === config.maxEpochs) {
        lossHistory.push({
          epoch,
          trainLoss: selectionLoss,
        });
      }
    }

    // Validation observations never select an epoch or restart.
    const validationSelectionLoss = tourBestSelectionLoss;

    if (validationSelectionLoss < bestGlobalSelectionLoss) {
      bestGlobalSelectionLoss = validationSelectionLoss;
      bestGlobalWeights = tourBestWeights;
      bestGlobalTourIndex = tour + 1;
      bestGlobalLossHistory = lossHistory;
      bestGlobalSplit = { trainIdx, valIdx };
    }
    }
  }

  if (!bestGlobalWeights || !bestGlobalSplit) return null;

  // 4. Create Evaluation / Prediction Function using optimal weights
  const { W1, b1, W2, b2, WOut, bOut } = bestGlobalWeights;
  const inputCodes = [...inputFeatures.map((feature) => feature.name), ...blockFeatures.map((block) => `Block ${block}`)];
  const lastHidden = hasLayer2 ? h2 : h1;

  const predictNorm = (xVector: number[]): number => {
    // Layer 1
    const a1: number[] = new Array(h1).fill(0);
    for (let j = 0; j < h1; j++) {
      let sum = b1[j];
      for (let k = 0; k < numInputs; k++) sum += xVector[k] * W1[k][j];
      a1[j] = activate(sum, act);
    }

    let aLast = a1;
    if (hasLayer2 && W2 && b2) {
      const a2: number[] = new Array(h2).fill(0);
      for (let j = 0; j < h2; j++) {
        let sum = b2[j];
        for (let k = 0; k < h1; k++) sum += a1[k] * W2[k][j];
        a2[j] = activate(sum, act);
      }
      aLast = a2;
    }

    let predNorm = bOut;
    for (let k = 0; k < lastHidden; k++) {
      predNorm += aLast[k] * WOut[k][0];
    }
    return predNorm;
  };

  const predict = (coded: Record<string, number>): number => {
    const xVec = [...inputFeatures.map((feature) => feature.evaluator(coded)), ...blockValues()];
    const pNorm = predictNorm(xVec);
    return pNorm * ySd + yMean;
  };
  const predictRun = (run: DoERun): number => {
    const xVec = [...inputFeatures.map((feature) => feature.evaluator(run.factorCoded)), ...blockValues(run.block)];
    return predictNorm(xVec) * ySd + yMean;
  };

  // 5. Diagnostics: Actual vs Predicted, Residuals, R², RMSE, MAE
  const valSet = new Set(bestGlobalSplit.valIdx);
  const residuals: NeuralResidual[] = [];

  let trainSSE = 0;
  let trainSAE = 0;
  let valSSE = 0;
  let valSAE = 0;
  let overallSSE = 0;
  let overallSAE = 0;

  const yTrainVals: number[] = [];
  const yValVals: number[] = [];

  validData.forEach((d, i) => {
    const isVal = valSet.has(i);
    const predVal = predictRun(d.run);
    const res = d.y - predVal;

    residuals.push({
      runOrder: d.run.runOrder,
      actual: d.y,
      predicted: predVal,
      residual: res,
      isValidation: isVal,
    });

    overallSSE += res * res;
    overallSAE += Math.abs(res);

    if (isVal) {
      valSSE += res * res;
      valSAE += Math.abs(res);
      yValVals.push(d.y);
    } else {
      trainSSE += res * res;
      trainSAE += Math.abs(res);
      yTrainVals.push(d.y);
    }
  });

  const nTrain = bestGlobalSplit.trainIdx.length;
  const nVal = bestGlobalSplit.valIdx.length;

  const meanTrainY = yTrainVals.length > 0 ? yTrainVals.reduce((a, b) => a + b, 0) / nTrain : yMean;
  const sstTrain = yTrainVals.reduce((sum, v) => sum + Math.pow(v - meanTrainY, 2), 0);
  const r2Train = sstTrain > 0 ? 1 - trainSSE / sstTrain : NaN;

  const meanValY = yValVals.length > 0 ? yValVals.reduce((a, b) => a + b, 0) / nVal : yMean;
  const sstVal = yValVals.reduce((sum, v) => sum + Math.pow(v - meanValY, 2), 0);
  const r2Val = sstVal > 0 ? 1 - valSSE / sstVal : NaN;

  const overallMean = yValues.reduce((sum, value) => sum + value, 0) / N;
  const sstOverall = yValues.reduce((sum, v) => sum + Math.pow(v - overallMean, 2), 0);
  const r2Overall = sstOverall > 0 ? 1 - overallSSE / sstOverall : NaN;

  const rmseTrain = Math.sqrt(trainSSE / Math.max(1, nTrain));
  const rmseVal = nVal > 0 ? Math.sqrt(valSSE / nVal) : NaN;
  const rmseOverall = Math.sqrt(overallSSE / N);

  const maeTrain = trainSAE / Math.max(1, nTrain);
  const maeVal = nVal > 0 ? valSAE / nVal : NaN;
  const maeOverall = overallSAE / N;

  // 6. Independent Variable Importance / Sensitivity Analysis
  // Compute mean absolute gradient or perturbation response across grid
  const rawSensitivities: number[] = new Array(activeFactors.length).fill(0);
  const numGrid = 200;
  const rngSens = createRNG(12345);

  for (let s = 0; s < numGrid; s++) {
    const baseCoded = sampleFeasibleSensitivityPoint(activeFactors, rngSens);
    const basePoint = activeFactors.reduce<Record<string, number>>((point, factor, index) => {
      point[factor.code] = baseCoded[index];
      return point;
    }, {});
    const basePred = predict(basePoint);
    const delta = 0.01;

    for (let j = 0; j < activeFactors.length; j++) {
      const perturbed = perturbFeasibleSensitivityPoint(baseCoded, j, activeFactors, delta);
      const perturbedPoint = activeFactors.reduce<Record<string, number>>((point, factor, index) => {
        point[factor.code] = perturbed[index];
        return point;
      }, {});
      const perturbedPred = predict(perturbedPoint);
      const effectiveDelta = Math.max(1e-8, Math.abs(perturbed[j] - baseCoded[j]));
      const grad = Math.abs((perturbedPred - basePred) / effectiveDelta);
      rawSensitivities[j] += grad;
    }
  }

  const totalSens = rawSensitivities.reduce((a, b) => a + b, 0) || 1e-6;
  const variableImportance: FactorSensitivity[] = activeFactors.map((f, idx) => {
    const sens = rawSensitivities[idx] / numGrid;
    const relImp = (sens / (totalSens / numGrid)) * 100;
    return {
      factorCode: f.code,
      factorName: f.name,
      importance: Number(sens.toFixed(4)),
      relativeImportance: Number(relImp.toFixed(2)),
    };
  });
  // Sort descending by importance
  variableImportance.sort((a, b) => b.importance - a.importance);

  // 7. Formula String & Export Code
  const formulaString = `NeuralNet(${act.toUpperCase()} [${h1}${hasLayer2 ? `, ${h2}` : ''}] -> 1) for ${cqa.name}`;

  // Python Inference Snippet
  const pyLines = [
    `import numpy as np`,
    ``,
    `def predict_${cqa.code.toLowerCase()}(factors_dict):`,
    `    # Factors order: ${inputCodes.join(', ')} (in coded scale [-1, 1])`,
    `    x = np.array([factors_dict.get(k, 0.0) for k in [${inputCodes.map((c) => `'${c}'`).join(', ')}]])`,
    `    W1 = np.array(${JSON.stringify(W1)})`,
    `    b1 = np.array(${JSON.stringify(b1)})`,
  ];
  if (act === 'tanh') {
    pyLines.push(`    a1 = np.tanh(np.dot(x, W1) + b1)`);
  } else if (act === 'relu') {
    pyLines.push(`    a1 = np.maximum(0, np.dot(x, W1) + b1)`);
  } else if (act === 'sigmoid') {
    pyLines.push(`    a1 = 1 / (1 + np.exp(-(np.dot(x, W1) + b1)))`);
  } else if (act === 'gaussian') {
    pyLines.push(`    z1 = np.dot(x, W1) + b1; a1 = np.exp(-z1*z1)`);
  } else {
    pyLines.push(`    a1 = np.dot(x, W1) + b1`);
  }

  if (hasLayer2 && W2 && b2) {
    pyLines.push(`    W2 = np.array(${JSON.stringify(W2)})`);
    pyLines.push(`    b2 = np.array(${JSON.stringify(b2)})`);
    if (act === 'tanh') pyLines.push(`    a2 = np.tanh(np.dot(a1, W2) + b2)`);
    else if (act === 'relu') pyLines.push(`    a2 = np.maximum(0, np.dot(a1, W2) + b2)`);
    else if (act === 'sigmoid') pyLines.push(`    a2 = 1 / (1 + np.exp(-(np.dot(a1, W2) + b2)))`);
    else if (act === 'gaussian') pyLines.push(`    z2 = np.dot(a1, W2) + b2; a2 = np.exp(-z2*z2)`);
    else pyLines.push(`    a2 = np.dot(a1, W2) + b2`);
    pyLines.push(`    a_last = a2`);
  } else {
    pyLines.push(`    a_last = a1`);
  }

  pyLines.push(`    W_out = np.array(${JSON.stringify(WOut)})`);
  pyLines.push(`    b_out = ${String(bOut)}`);
  pyLines.push(`    y_norm = np.dot(a_last, W_out)[0] + b_out`);
  pyLines.push(`    y_actual = y_norm * ${String(ySd)} + ${String(yMean)}`);
  pyLines.push(`    return float(y_actual)`);

  const pythonCode = pyLines.join('\n');

  // Excel formula representation for 1 hidden layer
  let excelFormula = `=(${String(bOut)}`;
  for (let j = 0; j < h1; j++) {
    const wOutJ = String(WOut[j][0]);
    let inner = `${String(b1[j])}`;
    for (let k = 0; k < numInputs; k++) {
      const w1KJ = String(W1[k][j]);
      inner += ` + (${w1KJ} * [Cell_${inputCodes[k]}])`;
    }
    excelFormula += ` + (${wOutJ} * TANH(${inner}))`;
  }
  excelFormula += `) * ${String(ySd)} + ${String(yMean)}`;
  if (hasLayer2 || act !== 'tanh') {
    excelFormula = 'N/A — Excel export currently supports only a one-hidden-layer TANH network.';
  }

  const pCount = parameterCount;

  return {
    cqaCode: cqa.code,
    config,
    weights: bestGlobalWeights,
    inputFactorCodes: inputCodes,
    normParams: {
      xMeans: activeFactors.map(() => 0),
      xSds: activeFactors.map(() => 1),
      yMean,
      ySd,
    },
    diagnostics: {
      trainingSampleCount: nTrain, validationSampleCount: nVal, validationKind: nVal > 0 ? 'holdout' : 'none',
      rSquaredTrain: r2Train,
      rSquaredVal: r2Val,
      rSquaredOverall: r2Overall,
      adjRSquared: undefined,
      rmseTrain: rmseTrain,
      rmseVal: rmseVal,
      rmseOverall: rmseOverall,
      maeTrain: maeTrain,
      maeVal: maeVal,
      maeOverall: maeOverall,
      sseTrain: trainSSE,
      sseVal: valSSE,
      sseOverall: overallSSE,
      aicc: undefined,
      bic: undefined,
      logLikelihood: undefined,
      twoLL: undefined,
      lossHistory: bestGlobalLossHistory,
      residuals,
      variableImportance,
      bestTourIndex: bestGlobalTourIndex,
    },
    predict,
    formulaString,
    pythonCode,
    excelFormula,
    architectureMode: 'independent',
    parameterCount: pCount,
  };
}

/**
 * Fit a Unified Multi-Output Neural Network Model for All CQAs simultaneously (Shared MLP Architecture)
 */
export function fitMultiOutputNeuralNet(
  cqas: CQA[],
  factors: Factor[],
  runs: DoERun[],
  userConfig: Partial<NeuralNetConfig> = {},
  splitOverride?: NeuralValidationSplit,
): Record<string, NeuralNetModelResult> {
  cqas = cqas.filter((cqa) => !cqa.dataType?.startsWith('qualitative') && cqa.objective !== 'pass_category');
  const config: NeuralNetConfig = { ...DEFAULT_NEURAL_CONFIG, ...userConfig };
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const inputFeatures = buildFactorFeatures(activeFactors);
  const blockLevels = [...new Set(runs.map((run) => Math.max(1, Math.floor(run.block ?? 1))))].sort((a, b) => a - b);
  const blockFeatures = blockLevels.slice(1);
  const blockValues = (block?: number) => blockFeatures.map((level) => Math.max(1, Math.floor(block ?? 1)) === level ? 1 : 0);
  const numInputs = inputFeatures.length + blockFeatures.length;
  const numOutputs = cqas.length;

  if (numInputs === 0 || numOutputs === 0) return {};

  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') {
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };

  // Filter runs where at least one CQA is valid
  const validData = runs
    .map((r) => {
      const x = [...inputFeatures.map((feature) => feature.evaluator(r.factorCoded)), ...blockValues(r.block)];
      const yArr = cqas.map((cqa) => parseResponse(r.responses[cqa.code]));
      return { run: r, x, yArr };
    })
    .filter((d) => d.yArr.some((v) => v !== null));

  const N = validData.length;
  if (N < 4) return {};

  const validationSplits = splitOverride ? [splitOverride] : getNeuralValidationSplits(N, config);
  if (config.validationMethod === 'kfold' && !splitOverride) {
    return crossValidatedModels(config, validationSplits, (cfg, split) => fitMultiOutputNeuralNet(cqas, factors, runs, cfg, split));
  }
  // Normalization parameters per CQA
  const cqaNorms = cqas.map((_, cIdx) => {
    const validVals = validationSplits[0].trainIdx
      .map((index) => validData[index].yArr[cIdx])
      .filter((v): v is number => v !== null);
    const count = validVals.length;
    const mean = count > 0 ? validVals.reduce((a, b) => a + b, 0) / count : 0;
    const variance =
      count > 1
        ? validVals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (count - 1)
        : 1;
    const sd = Math.sqrt(Math.max(1e-6, variance));
    return { mean, sd, count };
  });

  const X_all = validData.map((d) => [...d.x]);
  const Y_norm_all = validData.map((d) =>
    d.yArr.map((val, cIdx) =>
      val !== null ? (val - cqaNorms[cIdx].mean) / cqaNorms[cIdx].sd : 0
    )
  );
  const Y_valid_mask = validData.map((d) => d.yArr.map((val) => val !== null));

  const h1 = Math.max(1, config.hiddenNodes1);
  const h2 = Math.max(0, config.hiddenNodes2);
  const hasLayer2 = h2 > 0;
  const lastHidden = hasLayer2 ? h2 : h1;
  const act = config.activation;
  const lambda = config.weightDecay;
  const lr = config.learningRate;

  const totalParams = calculateNeuralArchitectureMetrics(numInputs, h1, h2, numOutputs, N).totalParameters;
  if (validationSplits[0].trainIdx.length <= totalParams || cqaNorms.some((norm) => norm.count < 2)) return {};

  // Reserve one fixed final holdout. Epoch and restart selection below use
  // regularized training loss only, preventing optimistic holdout reuse.
  let bestGlobalSelectionLoss = Infinity;
  let bestGlobalWeights: {
    W1: number[][];
    b1: number[];
    W2?: number[][];
    b2?: number[];
    WOut: number[][]; // lastHidden x numOutputs
    bOut: number[]; // numOutputs
  } | null = null;
  let bestGlobalTourIndex = 0;
  let bestGlobalLossHistory: { epoch: number; trainLoss: number; valLoss?: number }[] = [];
  let bestGlobalSplit: { trainIdx: number[]; valIdx: number[] } | null = null;

  // Train all folds independently so every observation serves as validation
  // once under K-fold cross validation.
  for (let fold = 0; fold < validationSplits.length; fold++) {
    const { trainIdx, valIdx } = validationSplits[fold];
    for (let tour = 0; tour < config.numTours; tour++) {
    const tourSeed = config.seed + fold * 1_000_003 + tour * 10007;
    const rng = createRNG(tourSeed);

    const nTrain = trainIdx.length;

    // Xavier/Glorot Initialization
    const std1 = Math.sqrt(2.0 / (numInputs + h1));
    const W1: number[][] = Array.from({ length: numInputs }, () =>
      Array.from({ length: h1 }, () => randomNormal(rng, 0, std1))
    );
    const b1: number[] = new Array(h1).fill(0);

    let W2: number[][] = [];
    let b2: number[] = [];
    if (hasLayer2) {
      const std2 = Math.sqrt(2.0 / (h1 + h2));
      W2 = Array.from({ length: h1 }, () =>
        Array.from({ length: h2 }, () => randomNormal(rng, 0, std2))
      );
      b2 = new Array(h2).fill(0);
    }

    const stdOut = Math.sqrt(2.0 / (lastHidden + numOutputs));
    const WOut: number[][] = Array.from({ length: lastHidden }, () =>
      Array.from({ length: numOutputs }, () => randomNormal(rng, 0, stdOut))
    );
    const bOut: number[] = new Array(numOutputs).fill(0);

    // Adam optimizer moment states
    const mW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
    const vW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
    const mb1 = new Array(h1).fill(0);
    const vb1 = new Array(h1).fill(0);

    const mW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
    const vW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
    const mb2 = hasLayer2 ? new Array(h2).fill(0) : [];
    const vb2 = hasLayer2 ? new Array(h2).fill(0) : [];

    const mWOut = Array.from({ length: lastHidden }, () => new Array(numOutputs).fill(0));
    const vWOut = Array.from({ length: lastHidden }, () => new Array(numOutputs).fill(0));
    const mbOut = new Array(numOutputs).fill(0);
    const vbOut = new Array(numOutputs).fill(0);

    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;

    let tourBestSelectionLoss = Infinity;
    let tourBestWeights = {
      W1: W1.map((r) => [...r]),
      b1: [...b1],
      W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
      b2: hasLayer2 ? [...b2] : undefined,
      WOut: WOut.map((r) => [...r]),
      bOut: [...bOut],
    };

    const lossHistory: { epoch: number; trainLoss: number; valLoss?: number }[] = [];

    for (let epoch = 1; epoch <= config.maxEpochs; epoch++) {
      const gradW1 = Array.from({ length: numInputs }, () => new Array(h1).fill(0));
      const gradB1 = new Array(h1).fill(0);
      const gradW2 = hasLayer2 ? Array.from({ length: h1 }, () => new Array(h2).fill(0)) : [];
      const gradB2 = hasLayer2 ? new Array(h2).fill(0) : [];
      const gradWOut = Array.from({ length: lastHidden }, () => new Array(numOutputs).fill(0));
      const gradBOut = new Array(numOutputs).fill(0);


      for (let i = 0; i < nTrain; i++) {
        const idx = trainIdx[i];
        const x = X_all[idx];
        const yTrueArr = Y_norm_all[idx];
        const yMask = Y_valid_mask[idx];

        // Layer 1
        const z1: number[] = new Array(h1).fill(0);
        const a1: number[] = new Array(h1).fill(0);
        for (let j = 0; j < h1; j++) {
          let sum = b1[j];
          for (let k = 0; k < numInputs; k++) sum += x[k] * W1[k][j];
          z1[j] = sum;
          a1[j] = activate(sum, act);
        }

        // Layer 2
        let z2: number[] = [];
        let a2: number[] = [];
        if (hasLayer2) {
          z2 = new Array(h2).fill(0);
          a2 = new Array(h2).fill(0);
          for (let j = 0; j < h2; j++) {
            let sum = b2[j];
            for (let k = 0; k < h1; k++) sum += a1[k] * W2[k][j];
            z2[j] = sum;
            a2[j] = activate(sum, act);
          }
        }

        const aLast = hasLayer2 ? a2 : a1;
        const deltaOut: number[] = new Array(numOutputs).fill(0);

        for (let c = 0; c < numOutputs; c++) {
          if (!yMask[c]) continue;
          let yPredNorm = bOut[c];
          for (let k = 0; k < lastHidden; k++) {
            yPredNorm += aLast[k] * WOut[k][c];
          }
          const err = yPredNorm - yTrueArr[c];
  
          deltaOut[c] = err;
          gradBOut[c] += err;
          for (let k = 0; k < lastHidden; k++) {
            gradWOut[k][c] += err * aLast[k];
          }
        }

        // Backprop to last hidden layer
        if (hasLayer2) {
          const delta2: number[] = new Array(h2).fill(0);
          for (let j = 0; j < h2; j++) {
            const dAct = activateDerivative(z2[j], a2[j], act);
            let sumDelta = 0;
            for (let c = 0; c < numOutputs; c++) {
              if (yMask[c]) sumDelta += deltaOut[c] * WOut[j][c];
            }
            delta2[j] = sumDelta * dAct;
            gradB2[j] += delta2[j];
            for (let k = 0; k < h1; k++) {
              gradW2[k][j] += delta2[j] * a1[k];
            }
          }

          // Backprop to Layer 1
          for (let j = 0; j < h1; j++) {
            const dAct1 = activateDerivative(z1[j], a1[j], act);
            let sumDelta1 = 0;
            for (let k = 0; k < h2; k++) {
              sumDelta1 += delta2[k] * W2[j][k];
            }
            const delta1 = sumDelta1 * dAct1;
            gradB1[j] += delta1;
            for (let k = 0; k < numInputs; k++) {
              gradW1[k][j] += delta1 * x[k];
            }
          }
        } else {
          // Single hidden layer backprop
          for (let j = 0; j < h1; j++) {
            const dAct1 = activateDerivative(z1[j], a1[j], act);
            let sumDelta1 = 0;
            for (let c = 0; c < numOutputs; c++) {
              if (yMask[c]) sumDelta1 += deltaOut[c] * WOut[j][c];
            }
            const delta1 = sumDelta1 * dAct1;
            gradB1[j] += delta1;
            for (let k = 0; k < numInputs; k++) {
              gradW1[k][j] += delta1 * x[k];
            }
          }
        }
      }

      // L2 Regularization
      for (let k = 0; k < numInputs; k++) {
        for (let j = 0; j < h1; j++) {
          gradW1[k][j] += lambda * W1[k][j] * nTrain;
        }
      }
      if (hasLayer2) {
        for (let k = 0; k < h1; k++) {
          for (let j = 0; j < h2; j++) {
            gradW2[k][j] += lambda * W2[k][j] * nTrain;
          }
        }
      }
      for (let k = 0; k < lastHidden; k++) {
        for (let c = 0; c < numOutputs; c++) {
          gradWOut[k][c] += lambda * WOut[k][c] * nTrain;
        }
      }

      // Adam Updates for W1, b1
      for (let k = 0; k < numInputs; k++) {
        for (let j = 0; j < h1; j++) {
          const g = gradW1[k][j] / Math.max(1, nTrain);
          mW1[k][j] = beta1 * mW1[k][j] + (1 - beta1) * g;
          vW1[k][j] = beta2 * vW1[k][j] + (1 - beta2) * g * g;
          const mHat = mW1[k][j] / (1 - Math.pow(beta1, epoch));
          const vHat = vW1[k][j] / (1 - Math.pow(beta2, epoch));
          W1[k][j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
        }
      }
      for (let j = 0; j < h1; j++) {
        const g = gradB1[j] / Math.max(1, nTrain);
        mb1[j] = beta1 * mb1[j] + (1 - beta1) * g;
        vb1[j] = beta2 * vb1[j] + (1 - beta2) * g * g;
        const mHat = mb1[j] / (1 - Math.pow(beta1, epoch));
        const vHat = vb1[j] / (1 - Math.pow(beta2, epoch));
        b1[j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }

      // Adam Updates for W2, b2
      if (hasLayer2) {
        for (let k = 0; k < h1; k++) {
          for (let j = 0; j < h2; j++) {
            const g = gradW2[k][j] / Math.max(1, nTrain);
            mW2[k][j] = beta1 * mW2[k][j] + (1 - beta1) * g;
            vW2[k][j] = beta2 * vW2[k][j] + (1 - beta2) * g * g;
            const mHat = mW2[k][j] / (1 - Math.pow(beta1, epoch));
            const vHat = vW2[k][j] / (1 - Math.pow(beta2, epoch));
            W2[k][j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
          }
        }
        for (let j = 0; j < h2; j++) {
          const g = gradB2[j] / Math.max(1, nTrain);
          mb2[j] = beta1 * mb2[j] + (1 - beta1) * g;
          vb2[j] = beta2 * vb2[j] + (1 - beta2) * g * g;
          const mHat = mb2[j] / (1 - Math.pow(beta1, epoch));
          const vHat = vb2[j] / (1 - Math.pow(beta2, epoch));
          b2[j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
        }
      }

      // Adam Updates for WOut, bOut
      for (let k = 0; k < lastHidden; k++) {
        for (let c = 0; c < numOutputs; c++) {
          const g = gradWOut[k][c] / Math.max(1, nTrain);
          mWOut[k][c] = beta1 * mWOut[k][c] + (1 - beta1) * g;
          vWOut[k][c] = beta2 * vWOut[k][c] + (1 - beta2) * g * g;
          const mHat = mWOut[k][c] / (1 - Math.pow(beta1, epoch));
          const vHat = vWOut[k][c] / (1 - Math.pow(beta2, epoch));
          WOut[k][c] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
        }
      }
      for (let c = 0; c < numOutputs; c++) {
        const g = gradBOut[c] / Math.max(1, nTrain);
        mbOut[c] = beta1 * mbOut[c] + (1 - beta1) * g;
        vbOut[c] = beta2 * vbOut[c] + (1 - beta2) * g * g;
        const mHat = mbOut[c] / (1 - Math.pow(beta1, epoch));
        const vHat = vbOut[c] / (1 - Math.pow(beta2, epoch));
        bOut[c] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }

      // Select epochs and restarts only from the regularized training loss.
      // The fixed holdout remains untouched until final diagnostics below.
      const totalTrainLoss = networkTrainingLoss(X_all, Y_norm_all, Y_valid_mask, trainIdx,
        { W1, b1, W2: hasLayer2 ? W2 : undefined, b2: hasLayer2 ? b2 : undefined, WOut, bOut }, act, lambda);
      if (totalTrainLoss < tourBestSelectionLoss) {
        tourBestSelectionLoss = totalTrainLoss;
        tourBestWeights = {
          W1: W1.map((r) => [...r]),
          b1: [...b1],
          W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
          b2: hasLayer2 ? [...b2] : undefined,
          WOut: WOut.map((r) => [...r]),
          bOut: [...bOut],
        };
      }

      if (epoch % 20 === 0 || epoch === config.maxEpochs) {
        lossHistory.push({
          epoch,
          trainLoss: totalTrainLoss,
        });
      }
    }

    const validationSelectionLoss = tourBestSelectionLoss;

    if (validationSelectionLoss < bestGlobalSelectionLoss) {
      bestGlobalSelectionLoss = validationSelectionLoss;
      bestGlobalWeights = tourBestWeights;
      bestGlobalTourIndex = tour + 1;
      bestGlobalLossHistory = lossHistory;
      bestGlobalSplit = { trainIdx, valIdx };
    }
    }
  }

  if (!bestGlobalWeights || !bestGlobalSplit) return {};

  // Extract individual NeuralNetModelResult for each CQA
  const results: Record<string, NeuralNetModelResult> = {};
  const { W1, b1, W2, b2, WOut, bOut } = bestGlobalWeights;
  const inputCodes = [...inputFeatures.map((feature) => feature.name), ...blockFeatures.map((block) => `Block ${block}`)];
  const valSet = new Set(bestGlobalSplit.valIdx);

  cqas.forEach((cqa, cIdx) => {
    const yMean = cqaNorms[cIdx].mean;
    const ySd = cqaNorms[cIdx].sd;

    const singleWOut: number[][] = Array.from({ length: lastHidden }, (_, k) => [WOut[k][cIdx]]);
    const singleBOut = bOut[cIdx];

    const predictNorm = (xVector: number[]): number => {
      const a1: number[] = new Array(h1).fill(0);
      for (let j = 0; j < h1; j++) {
        let sum = b1[j];
        for (let k = 0; k < numInputs; k++) sum += xVector[k] * W1[k][j];
        a1[j] = activate(sum, act);
      }
      let aLast = a1;
      if (hasLayer2 && W2 && b2) {
        const a2: number[] = new Array(h2).fill(0);
        for (let j = 0; j < h2; j++) {
          let sum = b2[j];
          for (let k = 0; k < h1; k++) sum += a1[k] * W2[k][j];
          a2[j] = activate(sum, act);
        }
        aLast = a2;
      }
      let predNorm = singleBOut;
      for (let k = 0; k < lastHidden; k++) {
        predNorm += aLast[k] * singleWOut[k][0];
      }
      return predNorm;
    };

    const predict = (coded: Record<string, number>): number => {
      const xVec = [...inputFeatures.map((feature) => feature.evaluator(coded)), ...blockValues()];
      const pNorm = predictNorm(xVec);
      return pNorm * ySd + yMean;
    };
    const predictRun = (run: DoERun): number => predictNorm([
      ...inputFeatures.map((feature) => feature.evaluator(run.factorCoded)),
      ...blockValues(run.block),
    ]) * ySd + yMean;

    // Diagnostics for this CQA
    const residuals: NeuralResidual[] = [];
    let trainSSE = 0;
    let trainSAE = 0;
    let valSSE = 0;
    let valSAE = 0;
    let overallSSE = 0;
    let overallSAE = 0;

    const yTrainVals: number[] = [];
    const yValVals: number[] = [];

    validData.forEach((d, i) => {
      const actualY = d.yArr[cIdx];
      if (actualY === null) return;

      const isVal = valSet.has(i);
      const predVal = predictRun(d.run);
      const res = actualY - predVal;

      residuals.push({
        runOrder: d.run.runOrder,
        actual: actualY,
        predicted: predVal,
        residual: res,
        isValidation: isVal,
      });

      overallSSE += res * res;
      overallSAE += Math.abs(res);

      if (isVal) {
        valSSE += res * res;
        valSAE += Math.abs(res);
        yValVals.push(actualY);
      } else {
        trainSSE += res * res;
        trainSAE += Math.abs(res);
        yTrainVals.push(actualY);
      }
    });

    const nCqaTrain = yTrainVals.length;
    const nCqaVal = yValVals.length;
    const nCqaTotal = residuals.length;

    const meanTrainY = nCqaTrain > 0 ? yTrainVals.reduce((a, b) => a + b, 0) / nCqaTrain : yMean;
    const sstTrain = yTrainVals.reduce((sum, v) => sum + Math.pow(v - meanTrainY, 2), 0);
    const r2Train = sstTrain > 0 ? 1 - trainSSE / sstTrain : NaN;

    const meanValY = nCqaVal > 0 ? yValVals.reduce((a, b) => a + b, 0) / nCqaVal : yMean;
    const sstVal = yValVals.reduce((sum, v) => sum + Math.pow(v - meanValY, 2), 0);
    const r2Val = sstVal > 0 ? 1 - valSSE / sstVal : NaN;

    const allActualY = validData.map((d) => d.yArr[cIdx]).filter((value): value is number => value !== null);
    const overallMean = allActualY.reduce((sum, value) => sum + value, 0) / allActualY.length;
    const sstOverall = allActualY.reduce((sum, v) => sum + Math.pow(v - overallMean, 2), 0);
    const r2Overall = sstOverall > 0 ? 1 - overallSSE / sstOverall : NaN;

    const rmseTrain = Math.sqrt(trainSSE / Math.max(1, nCqaTrain));
    const rmseVal = nCqaVal > 0 ? Math.sqrt(valSSE / Math.max(1, nCqaVal)) : NaN;
    const rmseOverall = Math.sqrt(overallSSE / Math.max(1, nCqaTotal));

    const maeTrain = trainSAE / Math.max(1, nCqaTrain);
    const maeVal = nCqaVal > 0 ? valSAE / Math.max(1, nCqaVal) : NaN;
    const maeOverall = overallSAE / Math.max(1, nCqaTotal);

    // Variable Sensitivity for this CQA
    const rawSensitivities: number[] = new Array(activeFactors.length).fill(0);
    const numGrid = 200;
    const rngSens = createRNG(12345 + cIdx * 77);

    for (let s = 0; s < numGrid; s++) {
      const baseCoded = sampleFeasibleSensitivityPoint(activeFactors, rngSens);
      const basePoint = activeFactors.reduce<Record<string, number>>((point, factor, index) => {
        point[factor.code] = baseCoded[index];
        return point;
      }, {});
      const basePred = predict(basePoint);
      const delta = 0.01;
      for (let k = 0; k < activeFactors.length; k++) {
        const perturbed = perturbFeasibleSensitivityPoint(baseCoded, k, activeFactors, delta);
        const perturbedPoint = activeFactors.reduce<Record<string, number>>((point, factor, index) => {
          point[factor.code] = perturbed[index];
          return point;
        }, {});
        const effectiveDelta = Math.max(1e-8, Math.abs(perturbed[k] - baseCoded[k]));
        const diff = Math.abs(predict(perturbedPoint) - basePred) / effectiveDelta;
        rawSensitivities[k] += diff;
      }
    }

    const sumSens = rawSensitivities.reduce((a, b) => a + b, 0) || 1.0;
    const variableImportance: FactorSensitivity[] = activeFactors.map((f, k) => {
      const sens = rawSensitivities[k] / numGrid;
      const relImp = (rawSensitivities[k] / sumSens) * 100;
      return {
        factorCode: f.code,
        factorName: f.name,
        importance: Number(sens.toFixed(4)),
        relativeImportance: Number(relImp.toFixed(2)),
      };
    });
    variableImportance.sort((a, b) => b.importance - a.importance);

    // Formula & Code Strings
    const formulaString = `MultiOutputNeuralNet(${act.toUpperCase()} [${h1}${hasLayer2 ? `, ${h2}` : ''}] -> ${numOutputs} CQAs) [Output: ${cqa.name}]`;

    const pyLines = [
      `import numpy as np`,
      ``,
      `def predict_${cqa.code.toLowerCase()}_multi(factors_dict):`,
      `    # Multi-Output Shared Network Inference for ${cqa.name}`,
      `    # Factors order: ${inputCodes.join(', ')} (in coded scale [-1, 1])`,
      `    x = np.array([factors_dict.get(k, 0.0) for k in [${inputCodes.map((c) => `'${c}'`).join(', ')}]])`,
      `    W1 = np.array(${JSON.stringify(W1)})`,
      `    b1 = np.array(${JSON.stringify(b1)})`,
    ];
    if (act === 'tanh') pyLines.push(`    a1 = np.tanh(np.dot(x, W1) + b1)`);
    else if (act === 'relu') pyLines.push(`    a1 = np.maximum(0, np.dot(x, W1) + b1)`);
    else if (act === 'sigmoid') pyLines.push(`    a1 = 1 / (1 + np.exp(-(np.dot(x, W1) + b1)))`);
    else if (act === 'gaussian') pyLines.push(`    z1 = np.dot(x, W1) + b1; a1 = np.exp(-z1*z1)`);
    else pyLines.push(`    a1 = np.dot(x, W1) + b1`);

    if (hasLayer2 && W2 && b2) {
      pyLines.push(`    W2 = np.array(${JSON.stringify(W2)})`);
      pyLines.push(`    b2 = np.array(${JSON.stringify(b2)})`);
      if (act === 'tanh') pyLines.push(`    a2 = np.tanh(np.dot(a1, W2) + b2)`);
      else if (act === 'relu') pyLines.push(`    a2 = np.maximum(0, np.dot(a1, W2) + b2)`);
      else if (act === 'sigmoid') pyLines.push(`    a2 = 1 / (1 + np.exp(-(np.dot(a1, W2) + b2)))`);
      else if (act === 'gaussian') pyLines.push(`    z2 = np.dot(a1, W2) + b2; a2 = np.exp(-z2*z2)`);
      else pyLines.push(`    a2 = np.dot(a1, W2) + b2`);
      pyLines.push(`    a_last = a2`);
    } else {
      pyLines.push(`    a_last = a1`);
    }

    pyLines.push(`    W_out_c = np.array(${JSON.stringify(singleWOut)})`);
    pyLines.push(`    b_out_c = ${String(singleBOut)}`);
    pyLines.push(`    y_norm = np.dot(a_last, W_out_c)[0] + b_out_c`);
    pyLines.push(`    y_actual = y_norm * ${String(ySd)} + ${String(yMean)}`);
    pyLines.push(`    return float(y_actual)`);
    const pythonCode = pyLines.join('\n');

    let excelFormula = `=(${String(singleBOut)}`;
    for (let j = 0; j < h1; j++) {
      const wOutJ = String(singleWOut[j][0]);
      let inner = `${String(b1[j])}`;
      for (let k = 0; k < numInputs; k++) {
        const w1KJ = String(W1[k][j]);
        inner += ` + (${w1KJ} * [Cell_${inputCodes[k]}])`;
      }
      excelFormula += ` + (${wOutJ} * TANH(${inner}))`;
    }
    excelFormula += `) * ${String(ySd)} + ${String(yMean)}`;
    if (hasLayer2 || act !== 'tanh') {
      excelFormula = 'N/A — Excel export currently supports only a one-hidden-layer TANH network.';
    }

    results[cqa.code] = {
      cqaCode: cqa.code,
      config,
      weights: {
        W1,
        b1,
        W2: hasLayer2 ? W2 : undefined,
        b2: hasLayer2 ? b2 : undefined,
        WOut: singleWOut,
        bOut: singleBOut,
      },
      inputFactorCodes: inputCodes,
      normParams: {
        xMeans: activeFactors.map(() => 0),
        xSds: activeFactors.map(() => 1),
        yMean,
        ySd,
      },
      diagnostics: {
        trainingSampleCount: nCqaTrain, validationSampleCount: nCqaVal, validationKind: nCqaVal > 0 ? 'holdout' : 'none',
        rSquaredTrain: r2Train,
        rSquaredVal: r2Val,
        rSquaredOverall: r2Overall,
        adjRSquared: undefined,
        rmseTrain: rmseTrain,
        rmseVal: rmseVal,
        rmseOverall: rmseOverall,
        maeTrain: maeTrain,
        maeVal: maeVal,
        maeOverall: maeOverall,
        sseTrain: trainSSE,
        sseVal: valSSE,
        sseOverall: overallSSE,
        // Information criteria cannot be allocated per CQA for a shared
        // multi-output network without a joint likelihood model.
        aicc: undefined,
        bic: undefined,
        logLikelihood: undefined,
        twoLL: undefined,
        lossHistory: bestGlobalLossHistory,
        residuals,
        variableImportance,
        bestTourIndex: bestGlobalTourIndex,
      },
      predict,
      formulaString,
      pythonCode,
      excelFormula,
      architectureMode: 'shared',
      parameterCount: totalParams,
    };
  });

  return results;
}

/**
 * Multi-Response Desirability Optimization using Neural Network Models
 */
export function optimizeNeuralDesirability(
  factors: Factor[], cqas: CQA[], neuralModels: Record<string, NeuralNetModelResult>, seed = 20260827,
): DesirabilitySolution | null {
  if (cqas.some((cqa) => !neuralModels[cqa.code])) return null;
  return optimizeDesirability(factors, cqas, neuralModels, undefined, seed);
}
