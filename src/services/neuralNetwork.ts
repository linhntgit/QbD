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
  DesirabilitySolution,
} from '../types/qbd';
import {
  calculateIndividualDesirability,
  calculateInformationCriteria,
  calculateCarpenterArchitecture,
} from './mathUtils';
import { projectToBoundedMixture, isWithinSurveyBounds, isFeasibleBoundedMixture } from './statistics';

/** Draw and perturb points only inside the physically feasible mixture simplex.
 * Non-mixture inputs retain their coded [-1, 1] survey range. */
function sampleFeasibleSensitivityPoint(factors: Factor[], rng: () => number): number[] {
  const point = factors.map((factor) =>
    factor.role === 'mixture_component' || factor.type === 'Mixture' ? 0 : rng() * 2 - 1,
  );
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
  validationMethod: 'holdout',
  holdoutRatio: 0.25,
  numTours: 10,
  seed: 42,
};

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
  userConfig: Partial<NeuralNetConfig> = {}
): NeuralNetModelResult | null {
  if (cqa.dataType === 'qualitative_binary' || cqa.objective === 'pass_category') return null;
  const config: NeuralNetConfig = { ...DEFAULT_NEURAL_CONFIG, ...userConfig };
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const numInputs = activeFactors.length;

  if (numInputs === 0) return null;

  // 1. Parse and extract valid data points
  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase();
      if (lower === 'đạt' || lower === 'pass' || lower === 'yes' || lower === 'true') return 100.0;
      if (lower === 'không đạt' || lower === 'fail' || lower === 'no' || lower === 'false') return 0.0;
      const num = Number(raw);
      return isNaN(num) ? null : num;
    }
    return null;
  };

  const validData = runs
    .map((r) => ({
      run: r,
      x: activeFactors.map((f) => r.factorCoded[f.code] ?? 0),
      y: parseResponse(r.responses[cqa.code]),
    }))
    .filter((d): d is { run: DoERun; x: number[]; y: number } => d.y !== null);

  const N = validData.length;
  if (N < 4) return null; // Need minimum data points

  // 2. Normalization Parameters for Y
  const yValues = validData.map((d) => d.y);
  const yMean = yValues.reduce((a, b) => a + b, 0) / N;
  const yVar = yValues.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0) / Math.max(1, N - 1);
  const ySd = Math.sqrt(Math.max(1e-6, yVar));

  // Normalized inputs X (already coded in [-1, 1]) and normalized targets Y
  const X_all = validData.map((d) => [...d.x]);
  const Y_norm_all = validData.map((d) => (d.y - yMean) / ySd);

  const h1 = Math.max(1, config.hiddenNodes1);
  const h2 = Math.max(0, config.hiddenNodes2);
  const hasLayer2 = h2 > 0;
  const act = config.activation;
  const lambda = config.weightDecay;
  const lr = config.learningRate;
  const parameterCount = calculateNeuralArchitectureMetrics(numInputs, h1, h2, 1, N).totalParameters;
  const expectedValidationCount = config.validationMethod === 'holdout' && config.holdoutRatio > 0 && N >= 6
    ? Math.max(1, Math.min(Math.floor(N * 0.4), Math.round(N * config.holdoutRatio)))
    : 0;
  if (N - expectedValidationCount <= parameterCount) return null;

  // Keep one validation partition across restarts.  Re-splitting every tour
  // makes selection among tours optimistically biased.
  const splitRng = createRNG(config.seed + 7919);
  const validationIndices = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(splitRng() * (i + 1));
    [validationIndices[i], validationIndices[j]] = [validationIndices[j], validationIndices[i]];
  }

  let bestGlobalValLoss = Infinity;
  let bestGlobalWeights: NeuralLayerWeights | null = null;
  let bestGlobalTourIndex = 0;
  let bestGlobalLossHistory: { epoch: number; trainLoss: number; valLoss?: number }[] = [];
  let bestGlobalSplit: { trainIdx: number[]; valIdx: number[] } | null = null;

  // 3. Multi-Tour Training loop (Multi-Tour Optimization Restarts)
  for (let tour = 0; tour < config.numTours; tour++) {
    const tourSeed = config.seed + tour * 10007;
    const rng = createRNG(tourSeed);

    // Train/Val Partitioning
    const indices = [...validationIndices];

    let trainIdx: number[] = [];
    let valIdx: number[] = [];

    if (config.validationMethod === 'holdout' && config.holdoutRatio > 0 && N >= 6) {
      const valCount = Math.max(1, Math.min(Math.floor(N * 0.4), Math.round(N * config.holdoutRatio)));
      valIdx = indices.slice(0, valCount);
      trainIdx = indices.slice(valCount);
    } else {
      trainIdx = indices;
      valIdx = [];
    }

    const nTrain = trainIdx.length;
    const nVal = valIdx.length;

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

    let tourBestValLoss = Infinity;
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

      let trainSSE = 0;

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
        trainSSE += err * err;

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

      // Compute Validation Loss
      let valSSE = 0;
      if (nVal > 0) {
        for (let i = 0; i < nVal; i++) {
          const idx = valIdx[i];
          const x = X_all[idx];
          const yTrue = Y_norm_all[idx];

          // Forward
          let aLastVal: number[] = [];
          const a1Val: number[] = new Array(h1).fill(0);
          for (let j = 0; j < h1; j++) {
            let sum = b1[j];
            for (let k = 0; k < numInputs; k++) sum += x[k] * W1[k][j];
            a1Val[j] = activate(sum, act);
          }
          if (hasLayer2) {
            const a2Val: number[] = new Array(h2).fill(0);
            for (let j = 0; j < h2; j++) {
              let sum = b2[j];
              for (let k = 0; k < h1; k++) sum += a1Val[k] * W2[k][j];
              a2Val[j] = activate(sum, act);
            }
            aLastVal = a2Val;
          } else {
            aLastVal = a1Val;
          }

          let predNorm = bOut;
          for (let k = 0; k < lastHidden; k++) predNorm += aLastVal[k] * WOut[k][0];
          const err = predNorm - yTrue;
          valSSE += err * err;
        }
      }

      const trainMSE = trainSSE / nTrain;
      const valMSE = nVal > 0 ? valSSE / nVal : trainMSE;
      const criterionLoss = nVal > 0 ? valMSE : trainMSE;

      if (criterionLoss < tourBestValLoss) {
        tourBestValLoss = criterionLoss;
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
          trainLoss: Number(trainMSE.toFixed(5)),
          valLoss: nVal > 0 ? Number(valMSE.toFixed(5)) : undefined,
        });
      }
    }

    // Check if this tour is the best across all tours
    if (tourBestValLoss < bestGlobalValLoss) {
      bestGlobalValLoss = tourBestValLoss;
      bestGlobalWeights = tourBestWeights;
      bestGlobalTourIndex = tour + 1;
      bestGlobalLossHistory = lossHistory;
      bestGlobalSplit = { trainIdx, valIdx };
    }
  }

  if (!bestGlobalWeights || !bestGlobalSplit) return null;

  // 4. Create Evaluation / Prediction Function using optimal weights
  const { W1, b1, W2, b2, WOut, bOut } = bestGlobalWeights;
  const inputCodes = activeFactors.map((f) => f.code);
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
    const xVec = inputCodes.map((code) => coded[code] ?? 0);
    const pNorm = predictNorm(xVec);
    return pNorm * ySd + yMean;
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
    const predVal = predict(d.run.factorCoded);
    const res = d.y - predVal;

    residuals.push({
      runOrder: d.run.runOrder,
      actual: Number(d.y.toFixed(3)),
      predicted: Number(predVal.toFixed(3)),
      residual: Number(res.toFixed(3)),
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
  const r2Train = sstTrain > 0 ? Math.max(0, Math.min(1, 1 - trainSSE / sstTrain)) : 1.0;

  const meanValY = yValVals.length > 0 ? yValVals.reduce((a, b) => a + b, 0) / nVal : yMean;
  const sstVal = yValVals.reduce((sum, v) => sum + Math.pow(v - meanValY, 2), 0);
  const r2Val = sstVal > 0 ? Math.max(0, Math.min(1, 1 - valSSE / sstVal)) : r2Train;

  const sstOverall = yValues.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0);
  const r2Overall = sstOverall > 0 ? Math.max(0, Math.min(1, 1 - overallSSE / sstOverall)) : 1.0;

  const rmseTrain = Math.sqrt(trainSSE / Math.max(1, nTrain));
  const rmseVal = nVal > 0 ? Math.sqrt(valSSE / nVal) : rmseTrain;
  const rmseOverall = Math.sqrt(overallSSE / N);

  const maeTrain = trainSAE / Math.max(1, nTrain);
  const maeVal = nVal > 0 ? valSAE / nVal : maeTrain;
  const maeOverall = overallSAE / N;

  // 6. Independent Variable Importance / Sensitivity Analysis
  // Compute mean absolute gradient or perturbation response across grid
  const rawSensitivities: number[] = new Array(numInputs).fill(0);
  const numGrid = 200;
  const rngSens = createRNG(12345);

  for (let s = 0; s < numGrid; s++) {
    const baseCoded = sampleFeasibleSensitivityPoint(activeFactors, rngSens);
    const basePred = predictNorm(baseCoded);
    const delta = 0.01;

    for (let j = 0; j < numInputs; j++) {
      const perturbed = perturbFeasibleSensitivityPoint(baseCoded, j, activeFactors, delta);
      const perturbedPred = predictNorm(perturbed);
      const grad = Math.abs((perturbedPred - basePred) / delta);
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
  pyLines.push(`    b_out = ${bOut.toFixed(6)}`);
  pyLines.push(`    y_norm = np.dot(a_last, W_out)[0] + b_out`);
  pyLines.push(`    y_actual = y_norm * ${ySd.toFixed(6)} + ${yMean.toFixed(6)}`);
  pyLines.push(`    return float(y_actual)`);

  const pythonCode = pyLines.join('\n');

  // Excel formula representation for 1 hidden layer
  let excelFormula = `=(${bOut.toFixed(4)}`;
  for (let j = 0; j < h1; j++) {
    const wOutJ = WOut[j][0].toFixed(4);
    let inner = `${b1[j].toFixed(4)}`;
    for (let k = 0; k < numInputs; k++) {
      const w1KJ = W1[k][j].toFixed(4);
      inner += ` + (${w1KJ} * [Cell_${inputCodes[k]}])`;
    }
    excelFormula += ` + (${wOutJ} * TANH(${inner}))`;
  }
  excelFormula += `) * ${ySd.toFixed(4)} + ${yMean.toFixed(4)}`;
  if (hasLayer2 || act !== 'tanh') {
    excelFormula = 'N/A — Excel export currently supports only a one-hidden-layer TANH network.';
  }

  const pCount = parameterCount;
  const adjRSquared = N > pCount && N > 1 ? Math.max(0, Math.min(1, 1 - ((1 - r2Overall) * (N - 1)) / (N - pCount))) : r2Overall;
  const infoCrit = calculateInformationCriteria(N, pCount, overallSSE);

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
      rSquaredTrain: Number(r2Train.toFixed(4)),
      rSquaredVal: Number(r2Val.toFixed(4)),
      rSquaredOverall: Number(r2Overall.toFixed(4)),
      adjRSquared: Number(adjRSquared.toFixed(4)),
      rmseTrain: Number(rmseTrain.toFixed(4)),
      rmseVal: Number(rmseVal.toFixed(4)),
      rmseOverall: Number(rmseOverall.toFixed(4)),
      maeTrain: Number(maeTrain.toFixed(4)),
      maeVal: Number(maeVal.toFixed(4)),
      maeOverall: Number(maeOverall.toFixed(4)),
      sseTrain: Number(trainSSE.toFixed(4)),
      sseVal: Number(valSSE.toFixed(4)),
      sseOverall: Number(overallSSE.toFixed(4)),
      aicc: infoCrit.aicc,
      bic: infoCrit.bic,
      logLikelihood: infoCrit.logLikelihood,
      twoLL: infoCrit.twoLL,
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
  userConfig: Partial<NeuralNetConfig> = {}
): Record<string, NeuralNetModelResult> {
  if (cqas.some((cqa) => cqa.dataType === 'qualitative_binary' || cqa.objective === 'pass_category')) return {};
  const config: NeuralNetConfig = { ...DEFAULT_NEURAL_CONFIG, ...userConfig };
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const numInputs = activeFactors.length;
  const numOutputs = cqas.length;

  if (numInputs === 0 || numOutputs === 0) return {};

  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase();
      if (lower === 'đạt' || lower === 'pass' || lower === 'yes' || lower === 'true') return 100.0;
      if (lower === 'không đạt' || lower === 'fail' || lower === 'no' || lower === 'false') return 0.0;
      const num = Number(raw);
      return isNaN(num) ? null : num;
    }
    return null;
  };

  // Filter runs where at least one CQA is valid
  const validData = runs
    .map((r) => {
      const x = activeFactors.map((f) => r.factorCoded[f.code] ?? 0);
      const yArr = cqas.map((cqa) => parseResponse(r.responses[cqa.code]));
      return { run: r, x, yArr };
    })
    .filter((d) => d.yArr.some((v) => v !== null));

  const N = validData.length;
  if (N < 4) return {};

  // Normalization parameters per CQA
  const cqaNorms = cqas.map((_, cIdx) => {
    const validVals = validData
      .map((d) => d.yArr[cIdx])
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
  const expectedValidationCount = config.validationMethod === 'holdout' && config.holdoutRatio > 0 && N >= 6
    ? Math.max(1, Math.min(Math.floor(N * 0.4), Math.round(N * config.holdoutRatio)))
    : 0;
  if (N - expectedValidationCount <= totalParams) return {};

  const splitRng = createRNG(config.seed + 7919);
  const validationIndices = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(splitRng() * (i + 1));
    [validationIndices[i], validationIndices[j]] = [validationIndices[j], validationIndices[i]];
  }

  let bestGlobalValLoss = Infinity;
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

  // Multi-Tour Training loop
  for (let tour = 0; tour < config.numTours; tour++) {
    const tourSeed = config.seed + tour * 10007;
    const rng = createRNG(tourSeed);

    const indices = [...validationIndices];

    let trainIdx: number[] = [];
    let valIdx: number[] = [];

    if (config.validationMethod === 'holdout' && config.holdoutRatio > 0 && N >= 6) {
      const valCount = Math.max(1, Math.min(Math.floor(N * 0.4), Math.round(N * config.holdoutRatio)));
      valIdx = indices.slice(0, valCount);
      trainIdx = indices.slice(valCount);
    } else {
      trainIdx = indices;
      valIdx = [];
    }

    const nTrain = trainIdx.length;
    const nVal = valIdx.length;

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

    let tourBestValLoss = Infinity;
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

      let trainSSE = 0;
      let trainPointsCount = 0;

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
          trainSSE += err * err;
          trainPointsCount++;

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
      let l2Sum = 0;
      for (let k = 0; k < numInputs; k++) {
        for (let j = 0; j < h1; j++) {
          gradW1[k][j] += lambda * W1[k][j] * nTrain;
          l2Sum += W1[k][j] * W1[k][j];
        }
      }
      if (hasLayer2) {
        for (let k = 0; k < h1; k++) {
          for (let j = 0; j < h2; j++) {
            gradW2[k][j] += lambda * W2[k][j] * nTrain;
            l2Sum += W2[k][j] * W2[k][j];
          }
        }
      }
      for (let k = 0; k < lastHidden; k++) {
        for (let c = 0; c < numOutputs; c++) {
          gradWOut[k][c] += lambda * WOut[k][c] * nTrain;
          l2Sum += WOut[k][c] * WOut[k][c];
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

      // Validation evaluation
      let valLoss: number | undefined = undefined;
      let totalTrainLoss = trainSSE / Math.max(1, trainPointsCount) + 0.5 * lambda * l2Sum;

      if (nVal > 0) {
        let valSSE = 0;
        let valPointsCount = 0;
        for (let i = 0; i < nVal; i++) {
          const idx = valIdx[i];
          const x = X_all[idx];
          const yTrueArr = Y_norm_all[idx];
          const yMask = Y_valid_mask[idx];

          const a1: number[] = new Array(h1).fill(0);
          for (let j = 0; j < h1; j++) {
            let sum = b1[j];
            for (let k = 0; k < numInputs; k++) sum += x[k] * W1[k][j];
            a1[j] = activate(sum, act);
          }

          let aLast = a1;
          if (hasLayer2) {
            const a2: number[] = new Array(h2).fill(0);
            for (let j = 0; j < h2; j++) {
              let sum = b2[j];
              for (let k = 0; k < h1; k++) sum += a1[k] * W2[k][j];
              a2[j] = activate(sum, act);
            }
            aLast = a2;
          }

          for (let c = 0; c < numOutputs; c++) {
            if (!yMask[c]) continue;
            let yPredNorm = bOut[c];
            for (let k = 0; k < lastHidden; k++) {
              yPredNorm += aLast[k] * WOut[k][c];
            }
            const err = yPredNorm - yTrueArr[c];
            valSSE += err * err;
            valPointsCount++;
          }
        }
        valLoss = valSSE / Math.max(1, valPointsCount);

        if (valLoss < tourBestValLoss) {
          tourBestValLoss = valLoss;
          tourBestWeights = {
            W1: W1.map((r) => [...r]),
            b1: [...b1],
            W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
            b2: hasLayer2 ? [...b2] : undefined,
            WOut: WOut.map((r) => [...r]),
            bOut: [...bOut],
          };
        }
      } else {
        if (totalTrainLoss < tourBestValLoss) {
          tourBestValLoss = totalTrainLoss;
          tourBestWeights = {
            W1: W1.map((r) => [...r]),
            b1: [...b1],
            W2: hasLayer2 ? W2.map((r) => [...r]) : undefined,
            b2: hasLayer2 ? [...b2] : undefined,
            WOut: WOut.map((r) => [...r]),
            bOut: [...bOut],
          };
        }
      }

      if (epoch % 20 === 0 || epoch === config.maxEpochs) {
        lossHistory.push({
          epoch,
          trainLoss: Number(totalTrainLoss.toFixed(5)),
          valLoss: valLoss !== undefined ? Number(valLoss.toFixed(5)) : undefined,
        });
      }
    }

    const currentCrit = nVal > 0 ? tourBestValLoss : tourBestValLoss;
    if (currentCrit < bestGlobalValLoss) {
      bestGlobalValLoss = currentCrit;
      bestGlobalWeights = tourBestWeights;
      bestGlobalTourIndex = tour + 1;
      bestGlobalLossHistory = lossHistory;
      bestGlobalSplit = { trainIdx, valIdx };
    }
  }

  if (!bestGlobalWeights || !bestGlobalSplit) return {};

  // Extract individual NeuralNetModelResult for each CQA
  const results: Record<string, NeuralNetModelResult> = {};
  const { W1, b1, W2, b2, WOut, bOut } = bestGlobalWeights;
  const inputCodes = activeFactors.map((f) => f.code);
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
      const xVec = inputCodes.map((code) => coded[code] ?? 0);
      const pNorm = predictNorm(xVec);
      return pNorm * ySd + yMean;
    };

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
      const predVal = predict(d.run.factorCoded);
      const res = actualY - predVal;

      residuals.push({
        runOrder: d.run.runOrder,
        actual: Number(actualY.toFixed(3)),
        predicted: Number(predVal.toFixed(3)),
        residual: Number(res.toFixed(3)),
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
    const r2Train = sstTrain > 0 ? Math.max(0, Math.min(1, 1 - trainSSE / sstTrain)) : 1.0;

    const meanValY = nCqaVal > 0 ? yValVals.reduce((a, b) => a + b, 0) / nCqaVal : yMean;
    const sstVal = yValVals.reduce((sum, v) => sum + Math.pow(v - meanValY, 2), 0);
    const r2Val = sstVal > 0 ? Math.max(0, Math.min(1, 1 - valSSE / sstVal)) : r2Train;

    const allActualY = residuals.map((r) => r.actual);
    const sstOverall = allActualY.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0);
    const r2Overall = sstOverall > 0 ? Math.max(0, Math.min(1, 1 - overallSSE / sstOverall)) : 1.0;

    const rmseTrain = Math.sqrt(trainSSE / Math.max(1, nCqaTrain));
    const rmseVal = nCqaVal > 0 ? Math.sqrt(valSSE / Math.max(1, nCqaVal)) : rmseTrain;
    const rmseOverall = Math.sqrt(overallSSE / Math.max(1, nCqaTotal));

    const maeTrain = trainSAE / Math.max(1, nCqaTrain);
    const maeVal = nCqaVal > 0 ? valSAE / Math.max(1, nCqaVal) : maeTrain;
    const maeOverall = overallSAE / Math.max(1, nCqaTotal);

    // Variable Sensitivity for this CQA
    const rawSensitivities: number[] = new Array(numInputs).fill(0);
    const numGrid = 200;
    const rngSens = createRNG(12345 + cIdx * 77);

    for (let s = 0; s < numGrid; s++) {
      const baseCoded = sampleFeasibleSensitivityPoint(activeFactors, rngSens);
      const basePred = predictNorm(baseCoded);
      const delta = 0.01;
      for (let k = 0; k < numInputs; k++) {
        const perturbed = perturbFeasibleSensitivityPoint(baseCoded, k, activeFactors, delta);
        const diff = Math.abs(predictNorm(perturbed) - basePred) / delta;
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
    pyLines.push(`    b_out_c = ${singleBOut.toFixed(6)}`);
    pyLines.push(`    y_norm = np.dot(a_last, W_out_c)[0] + b_out_c`);
    pyLines.push(`    y_actual = y_norm * ${ySd.toFixed(6)} + ${yMean.toFixed(6)}`);
    pyLines.push(`    return float(y_actual)`);
    const pythonCode = pyLines.join('\n');

    let excelFormula = `=(${singleBOut.toFixed(4)}`;
    for (let j = 0; j < h1; j++) {
      const wOutJ = singleWOut[j][0].toFixed(4);
      let inner = `${b1[j].toFixed(4)}`;
      for (let k = 0; k < numInputs; k++) {
        const w1KJ = W1[k][j].toFixed(4);
        inner += ` + (${w1KJ} * [Cell_${inputCodes[k]}])`;
      }
      excelFormula += ` + (${wOutJ} * TANH(${inner}))`;
    }
    excelFormula += `) * ${ySd.toFixed(4)} + ${yMean.toFixed(4)}`;
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
        rSquaredTrain: Number(r2Train.toFixed(4)),
        rSquaredVal: Number(r2Val.toFixed(4)),
        rSquaredOverall: Number(r2Overall.toFixed(4)),
        adjRSquared: Number((nCqaTotal > numInputs && nCqaTotal > 1 ? Math.max(0, Math.min(1, 1 - ((1 - r2Overall) * (nCqaTotal - 1)) / (nCqaTotal - numInputs))) : r2Overall).toFixed(4)),
        rmseTrain: Number(rmseTrain.toFixed(4)),
        rmseVal: Number(rmseVal.toFixed(4)),
        rmseOverall: Number(rmseOverall.toFixed(4)),
        maeTrain: Number(maeTrain.toFixed(4)),
        maeVal: Number(maeVal.toFixed(4)),
        maeOverall: Number(maeOverall.toFixed(4)),
        sseTrain: Number(trainSSE.toFixed(4)),
        sseVal: Number(valSSE.toFixed(4)),
        sseOverall: Number(overallSSE.toFixed(4)),
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
  factors: Factor[],
  cqas: CQA[],
  neuralModels: Record<string, NeuralNetModelResult>,
  seed: number = 20260827,
): DesirabilitySolution | null {
  if (cqas.some((c) => !neuralModels[c.code])) return null;
  const validCQAs = cqas;

  const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
  const k = factors.length;

  const evaluateOverallDesirability = (coded: Record<string, number>): { dOverall: number; dMap: Record<string, number> } => {
    // 1. Strict Survey Boundary Check: Reject any point outside the experimental bounding box
    if (!isWithinSurveyBounds(coded, factors)) {
      return { dOverall: 0, dMap: {} };
    }

    let logSum = 0;
    const dMap: Record<string, number> = {};

    for (const cqa of validCQAs) {
      const model = neuralModels[cqa.code];
      const yPred = model.predict(coded);
      const di = calculateIndividualDesirability(
        yPred,
        cqa.objective,
        cqa.lowerLimit,
        cqa.upperLimit,
        cqa.target,
        cqa.sShape || 1.0,
        cqa.tShape || 1.0
      );
      dMap[cqa.code] = di;
      if (di <= 0) return { dOverall: 0, dMap };
      logSum += (cqa.weight || 1) * Math.log(di);
    }

    const dOverall = Math.exp(logSum / totalWeight);
    return { dOverall, dMap };
  };

  // Identify mixture and process factors and their survey bounds
  const mixFactors = factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const procFactors = factors.filter(
    (f) => f.role !== 'mixture_component' && f.type !== 'Mixture' && f.controllability === 'controllable'
  );
  const hasMixture = mixFactors.length >= 2;

  const mixLowProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.low : f.low / 100));
  const mixHighProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.high : f.high / 100));
  if (hasMixture && !isFeasibleBoundedMixture(mixLowProps, mixHighProps)) return null;

  let bestD = -1;
  let bestCoded: Record<string, number> = {};
  let bestDMap: Record<string, number> = {};

  // 1. Seed candidate with Feasible Polytope Centroid
  const initialCandidate: Record<string, number> = {};
  factors.filter((f) => f.controllability === 'uncontrollable_noise').forEach((f) => { initialCandidate[f.code] = 0; });
  procFactors.forEach((f) => {
    initialCandidate[f.code] = 0.0;
  });

  if (hasMixture) {
    const rawMid = mixFactors.map((_, i) => (mixLowProps[i] + mixHighProps[i]) / 2);
    const projMid = projectToBoundedMixture(rawMid, mixLowProps, mixHighProps, 1.0);
    mixFactors.forEach((f, i) => {
      initialCandidate[f.code] = projMid[i];
    });
  } else if (mixFactors.length === 1) {
    initialCandidate[mixFactors[0].code] = 1.0;
  }

  const { dOverall: initD, dMap: initDMap } = evaluateOverallDesirability(initialCandidate);
  if (initD > bestD) {
    bestD = initD;
    bestCoded = { ...initialCandidate };
    bestDMap = { ...initDMap };
  }

  // 2. High-Density Grid Exploration inside the Survey Bounds [L_i, U_i]
  const gridSteps = k <= 3 ? 18 : (k <= 4 ? 12 : 7);

  const exploreGrid = (factorIdx: number, currentCoded: Record<string, number>) => {
    if (factorIdx >= k) {
      let evalCoded = { ...currentCoded };
      if (hasMixture) {
        const rawVals = mixFactors.map((f) => evalCoded[f.code] ?? 0);
        const projVals = projectToBoundedMixture(rawVals, mixLowProps, mixHighProps, 1.0);
        mixFactors.forEach((f, i) => {
          evalCoded[f.code] = projVals[i];
        });
      }
      const { dOverall, dMap } = evaluateOverallDesirability(evalCoded);
      if (dOverall > bestD) {
        bestD = dOverall;
        bestCoded = { ...evalCoded };
        bestDMap = { ...dMap };
      }
      return;
    }

    const factor = factors[factorIdx];
    if (factor.controllability !== 'controllable') {
      currentCoded[factor.code] = 0;
      exploreGrid(factorIdx + 1, currentCoded);
      return;
    }
    const isMix = factor.role === 'mixture_component' || factor.type === 'Mixture';
    const lowVal = isMix ? (factor.high <= 1.0 && factor.unit !== '%' ? factor.low : factor.low / 100) : -1.0;
    const highVal = isMix ? (factor.high <= 1.0 && factor.unit !== '%' ? factor.high : factor.high / 100) : 1.0;

    for (let step = 0; step < gridSteps; step++) {
      const val = lowVal + (step / (gridSteps - 1)) * (highVal - lowVal);
      currentCoded[factor.code] = Number(val.toFixed(4));
      exploreGrid(factorIdx + 1, currentCoded);
    }
  };

  exploreGrid(0, {});

  // 3. Multi-Start Local Fine-Tuning strictly inside Bounded Simplex
  const numStarts = 400;
  const random = createRNG(seed);
  for (let iter = 0; iter < numStarts; iter++) {
    const candidateCoded: Record<string, number> = {};
    procFactors.forEach((f) => {
      const current = bestCoded[f.code] ?? 0;
      const jitter = (random() - 0.5) * 0.25;
      candidateCoded[f.code] = Math.max(-1.0, Math.min(1.0, Number((current + jitter).toFixed(4))));
    });

    if (hasMixture) {
      const rawJittered = mixFactors.map((f, i) => {
        const current = bestCoded[f.code] ?? (mixLowProps[i] + mixHighProps[i]) / 2;
        const range = mixHighProps[i] - mixLowProps[i];
        const jitter = (random() - 0.5) * range * 0.4;
        return current + jitter;
      });

      const proj = projectToBoundedMixture(rawJittered, mixLowProps, mixHighProps, 1.0);
      mixFactors.forEach((f, i) => {
        candidateCoded[f.code] = proj[i];
      });
    }

    const { dOverall, dMap } = evaluateOverallDesirability(candidateCoded);
    if (dOverall > bestD) {
      bestD = dOverall;
      bestCoded = { ...candidateCoded };
      bestDMap = { ...dMap };
    }
  }

  // Calculate actual factor values and predicted responses with CI
  const actualFactors: Record<string, number | string> = {};
  factors.forEach((f) => {
    if (f.controllability === 'constant') {
      actualFactors[f.code] = f.constantValue ?? f.low;
    } else if (f.role === 'mixture_component' || f.type === 'Mixture') {
      const frac = bestCoded[f.code] ?? (1 / mixFactors.length);
      actualFactors[f.code] = f.high <= 1.0 && f.unit !== '%'
        ? Number(frac.toFixed(4))
        : Number((frac * 100).toFixed(2));
    } else {
      const c = bestCoded[f.code] ?? 0;
      if (f.dataType === 'qualitative' && f.categories && f.categories.length > 0) {
        if (c <= -0.5) actualFactors[f.code] = f.categories[0];
        else if (c >= 0.5) actualFactors[f.code] = f.categories[1] || f.categories[0];
        else actualFactors[f.code] = f.categories[2] || f.categories[0];
      } else {
        const center = f.center !== undefined ? f.center : (f.low + f.high) / 2;
        const half = (f.high - f.low) / 2;
        actualFactors[f.code] = Number((center + c * half).toFixed(3));
      }
    }
  });

  const predictedResponses: Record<string, { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }> = {};
  validCQAs.forEach((cqa) => {
    const model = neuralModels[cqa.code];
    const val = model.predict(bestCoded);
    const se = model.diagnostics.rmseOverall;
    predictedResponses[cqa.code] = {
      value: Number(val.toFixed(3)),
      se: Number(se.toFixed(3)),
      ciLow: Number.NaN,
      ciHigh: Number.NaN,
      desirability: Number((bestDMap[cqa.code] ?? 0).toFixed(4)),
    };
  });

  return {
    codedFactors: bestCoded,
    actualFactors,
    predictedResponses,
    overallDesirability: Number(Math.max(0, bestD).toFixed(4)),
  };
}
