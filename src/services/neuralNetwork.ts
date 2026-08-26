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
import { calculateIndividualDesirability } from './mathUtils';

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
 * Fit a Neural Network Model for Experimental Data (MLP Architecture)
 */
export function fitNeuralNetModel(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  userConfig: Partial<NeuralNetConfig> = {}
): NeuralNetModelResult | null {
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
    const indices = Array.from({ length: N }, (_, i) => i);
    // Shuffle indices
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

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
    const baseCoded = activeFactors.map(() => rngSens() * 2 - 1);
    const basePred = predictNorm(baseCoded);
    const delta = 0.01;

    for (let j = 0; j < numInputs; j++) {
      const perturbed = [...baseCoded];
      perturbed[j] = Math.min(1.0, perturbed[j] + delta);
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
    pyLines.push(`    a1 = 1 / (1 + np.exp(-np.dot(x, W1) + b1))`);
  } else if (act === 'gaussian') {
    pyLines.push(`    z1 = np.dot(x, W1) + b1; a1 = np.exp(-z1*z1)`);
  } else {
    pyLines.push(`    a1 = np.dot(x, W1) + b1`);
  }

  if (hasLayer2 && W2 && b2) {
    pyLines.push(`    W2 = np.array(${JSON.stringify(W2)})`);
    pyLines.push(`    b2 = np.array(${JSON.stringify(b2)})`);
    pyLines.push(`    a2 = np.tanh(np.dot(a1, W2) + b2)`);
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
      rmseTrain: Number(rmseTrain.toFixed(4)),
      rmseVal: Number(rmseVal.toFixed(4)),
      rmseOverall: Number(rmseOverall.toFixed(4)),
      maeTrain: Number(maeTrain.toFixed(4)),
      maeVal: Number(maeVal.toFixed(4)),
      maeOverall: Number(maeOverall.toFixed(4)),
      sseTrain: Number(trainSSE.toFixed(4)),
      sseVal: Number(valSSE.toFixed(4)),
      sseOverall: Number(overallSSE.toFixed(4)),
      lossHistory: bestGlobalLossHistory,
      residuals,
      variableImportance,
      bestTourIndex: bestGlobalTourIndex,
    },
    predict,
    formulaString,
    pythonCode,
    excelFormula,
  };
}

/**
 * Multi-Response Desirability Optimization using Neural Network Models
 */
export function optimizeNeuralDesirability(
  factors: Factor[],
  cqas: CQA[],
  neuralModels: Record<string, NeuralNetModelResult>
): DesirabilitySolution | null {
  const validCQAs = cqas.filter((c) => neuralModels[c.code]);
  if (validCQAs.length === 0) return null;

  const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
  const k = factors.length;

  const evaluateOverallDesirability = (coded: Record<string, number>): { dOverall: number; dMap: Record<string, number> } => {
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

  let bestD = -1;
  let bestCoded: Record<string, number> = {};
  let bestDMap: Record<string, number> = {};

  const mixFactors = factors.filter((f) => f.role === 'mixture_component');
  const hasMixture = mixFactors.length >= 2;

  const gridSteps = k <= 3 ? 15 : (k <= 4 ? 9 : 5);
  const stepSize = 2.0 / (gridSteps - 1);

  const exploreGrid = (factorIdx: number, currentCoded: Record<string, number>) => {
    if (factorIdx >= k) {
      let evalCoded = { ...currentCoded };
      if (hasMixture) {
        const rawSum = mixFactors.reduce((sum, f) => sum + Math.max(0, evalCoded[f.code] ?? 0), 0);
        if (rawSum > 0) {
          mixFactors.forEach((f) => {
            evalCoded[f.code] = Number((Math.max(0, evalCoded[f.code] ?? 0) / rawSum).toFixed(4));
          });
        }
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
    for (let step = 0; step < gridSteps; step++) {
      const val = factor.role === 'mixture_component' ? step / (gridSteps - 1) : -1.0 + step * stepSize;
      currentCoded[factor.code] = Number(val.toFixed(3));
      exploreGrid(factorIdx + 1, currentCoded);
    }
  };

  exploreGrid(0, {});

  // Local Fine-Tuning around best grid point
  for (let iter = 0; iter < 300; iter++) {
    const candidateCoded: Record<string, number> = {};
    factors.forEach((f) => {
      const current = bestCoded[f.code] ?? 0;
      const jitter = (Math.random() - 0.5) * 0.15;
      if (f.role === 'mixture_component') {
        candidateCoded[f.code] = Math.max(0.01, current + jitter);
      } else {
        candidateCoded[f.code] = Math.max(-1.0, Math.min(1.0, Number((current + jitter).toFixed(3))));
      }
    });

    if (hasMixture) {
      const rawSum = mixFactors.reduce((sum, f) => sum + candidateCoded[f.code], 0);
      if (rawSum > 0) {
        mixFactors.forEach((f) => {
          candidateCoded[f.code] = Number((candidateCoded[f.code] / rawSum).toFixed(4));
        });
      }
    }

    const { dOverall, dMap } = evaluateOverallDesirability(candidateCoded);
    if (dOverall > bestD) {
      bestD = dOverall;
      bestCoded = candidateCoded;
      bestDMap = dMap;
    }
  }

  // Calculate actual factor values and predicted responses with CI
  const actualFactors: Record<string, number | string> = {};
  factors.forEach((f) => {
    if (f.controllability === 'constant') {
      actualFactors[f.code] = f.constantValue ?? f.low;
    } else if (f.role === 'mixture_component') {
      const frac = bestCoded[f.code] ?? (1 / mixFactors.length);
      actualFactors[f.code] = Number((frac * 100).toFixed(2));
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
      ciLow: Number((val - 1.96 * se).toFixed(3)),
      ciHigh: Number((val + 1.96 * se).toFixed(3)),
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
