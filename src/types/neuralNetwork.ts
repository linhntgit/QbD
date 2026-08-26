export type NeuralActivation = 'tanh' | 'linear' | 'gaussian' | 'sigmoid' | 'relu';
export type NeuralValidationMethod = 'holdout' | 'kfold' | 'none';
export type NeuralTrainingMode = 'shared' | 'independent';

export interface NeuralArchitectureMetrics {
  numInputs: number;
  hidden1: number;
  hidden2: number;
  numOutputs: number;
  totalParameters: number;
  numSamples: number;
  sampleToParamRatio: number;
  overfittingRisk: 'safe' | 'warning' | 'danger';
  carpenterRecommended?: number; // Carpenter (1995) formula: h = (N/beta - m) / (n + m + 1)
  rules?: { name: string; value: number; description: string }[];
  recommendation: string;
}

export interface NeuralNetConfig {
  hiddenNodes1: number; // e.g. 3 (Layer 1 nodes)
  hiddenNodes2: number; // e.g. 0 (Layer 2 nodes, 0 = 1 hidden layer)
  activation: NeuralActivation; // default 'tanh'
  weightDecay: number; // L2 penalty lambda, default 0.01
  learningRate: number; // default 0.05
  maxEpochs: number; // default 1000
  validationMethod: NeuralValidationMethod;
  holdoutRatio: number; // default 0.25 (25% validation holdout)
  numTours: number; // default 10 (number of random tours/restarts)
  seed: number;
}

export interface NeuralResidual {
  runOrder: number;
  actual: number;
  predicted: number;
  residual: number;
  isValidation: boolean;
}

export interface FactorSensitivity {
  factorCode: string;
  factorName: string;
  importance: number;
  relativeImportance: number; // 0 - 100%
}

export interface NeuralNetDiagnostics {
  rSquaredTrain: number;
  rSquaredVal: number;
  rSquaredOverall: number;
  adjRSquared?: number;
  qSquared?: number; // Q^2 (1 - PRESS/SSTotal or Validation R^2)
  rmseTrain: number;
  rmseVal: number;
  rmseOverall: number;
  maeTrain: number;
  maeVal: number;
  maeOverall: number;
  sseTrain: number;
  sseVal: number;
  sseOverall: number;
  aicc?: number;    // Akaike Information Criterion Corrected
  bic?: number;     // Bayesian Information Criterion
  logLikelihood?: number;
  twoLL?: number;   // -2LL (-2 x LogLikelihood)
  lossHistory: { epoch: number; trainLoss: number; valLoss?: number }[];
  residuals: NeuralResidual[];
  variableImportance: FactorSensitivity[];
  bestTourIndex: number;
}

export interface NeuralLayerWeights {
  W1: number[][]; // (n_inputs x hiddenNodes1)
  b1: number[];   // (hiddenNodes1)
  W2?: number[][]; // (hiddenNodes1 x hiddenNodes2)
  b2?: number[];   // (hiddenNodes2)
  WOut: number[][]; // (last_hidden x 1)
  bOut: number;
}

export interface NeuralNetModelResult {
  cqaCode: string;
  config: NeuralNetConfig;
  weights: NeuralLayerWeights;
  inputFactorCodes: string[];
  normParams: {
    xMeans: number[];
    xSds: number[];
    yMean: number;
    ySd: number;
  };
  diagnostics: NeuralNetDiagnostics;
  predict: (codedFactors: Record<string, number>) => number;
  formulaString: string;
  pythonCode: string;
  excelFormula: string;
  architectureMode?: NeuralTrainingMode;
  parameterCount?: number;
}
