import type { NeuralNetConfig, NeuralTrainingMode } from './neuralNetwork';

export type FactorType = 'CMA' | 'CPP' | 'Formulation' | 'Process' | 'Mixture';
export type FactorDataType = 'quantitative' | 'quantitative_multilevel' | 'qualitative';
export type FactorControllability = 'controllable' | 'uncontrollable_noise' | 'constant';

export type ModelingEngine = 'polynomial' | 'neural';

export type CQADataType = 'quantitative' | 'qualitative_binary' | 'qualitative_ordinal';
export type CQAObjective = 'maximize' | 'minimize' | 'target' | 'range' | 'pass_category';

export interface QTPPItem {
  id: string;
  element: string; // e.g., Dosage Form, Route, Strength, Stability, Assay, Dissolution
  target: string; // e.g., Tablet 500mg, Extended Release 12h, >=98.0%
  justification: string;
}

export interface CQA {
  id: string;
  name: string; // e.g., Dissolution 2h (%), Tensile Strength (MPa), Assay (%), Appearance
  code: string; // Y1, Y2, ...
  dataType?: CQADataType; // quantitative, qualitative_binary, qualitative_ordinal
  unit: string;
  target?: number;
  lowerLimit?: number; // LSL
  upperLimit?: number; // USL
  categories?: string[]; // for qualitative, e.g. ['Không đạt', 'Đạt'] or ['Cấp 1', 'Cấp 2', 'Cấp 3']
  targetCategory?: string; // e.g. 'Đạt'
  objective: CQAObjective;
  weight: number; // 1 to 5 (importance)
  sShape?: number; // Desirability shape parameter (default 1)
  tShape?: number;
}

export type FactorRole = 
  | 'mixture_component'      // Thành phần hỗn hợp (tổng % = 100%)
  | 'formulation_other'       // Biến công thức khác (khối lượng, số lượng, loại chất ngoài hỗn hợp)
  | 'process_parameter'      // Biến quy trình (nhiệt độ, lực dập, tốc độ...)
  | 'process_independent';   // Legacy alias for process_parameter

export interface Factor {
  id: string;
  name: string; // e.g., Polymer % (HPMC), Compression Force, Inlet Temp, Ambient Humidity, Supplier
  code: string; // X1, X2, ...
  type: FactorType;
  dataType: FactorDataType; // quantitative, quantitative_multilevel, qualitative
  controllability: FactorControllability; // controllable, uncontrollable_noise, constant
  role?: FactorRole; // 'mixture_component' (sum = 100%), 'formulation_other', or 'process_parameter'
  unit: string;
  low: number; // -1 (or min % in mixture)
  high: number; // +1 (or max % in mixture)
  center?: number; // 0 (or center % in mixture)
  alpha?: number; // axial value for CCD
  categories?: string[]; // e.g. ['Nhà cung cấp A', 'Nhà cung cấp B'] or ['30 rpm', '60 rpm', '90 rpm']
  constantValue?: number | string; // for constant factors (e.g. 500 mg, 40 °C)
  currentValue?: number; // for contour slices
}

export interface FMEARiskItem {
  id: string;
  factorId: string;
  cqaId: string;
  failureMode: string;
  severity: number; // 1-10
  probability: number; // 1-10
  detectability: number; // 1-10
  rpn: number; // S * P * D
  riskLevel: 'Low' | 'Medium' | 'High';
  justification: string;
  recommendedDoE: boolean;
}

/** Editable cause-and-effect diagram retained with the project. */
export interface FishboneCause {
  id: string;
  text: string;
  children?: FishboneCause[];
}

export interface FishboneCategory {
  id: string;
  name: string;
  causes: FishboneCause[];
}

export interface FishboneDiagram {
  effect: string;
  categories: FishboneCategory[];
}

export type DoECategory = 'Screening' | 'RSM' | 'Mixture' | 'Combined_Mixture_Process' | 'Custom_Optimal';
export type DoEDesignGoal = 'screening' | 'optimization' | 'robustness';

export type DoEDesignType = 
  | 'FullFactorial2k'
  | 'FractionalFactorial'
  | 'PlackettBurman'
  | 'Taguchi'
  | 'BoxBehnken'
  | 'CCD_Full'
  | 'CCD_FaceCentered'
  | 'CCD_Rotatable'
  | 'Doehlert'
  | 'SimplexLattice'
  | 'SimplexCentroid'
  | 'Combined_Mixture_Factorial'
  | 'Combined_Mixture_RSM'
  | 'Combined_Mixture_DOptimal'
  | 'DOptimal';

export interface DoEDesignConfig {
  category: DoECategory;
  designType: DoEDesignType;
  centerPoints: number;
  replicates: number;
  randomized: boolean;
  randomizationSeed?: number;
  alpha?: number;
  taguchiArray?: 'L4' | 'L8' | 'L9' | 'L12' | 'L16';
  numRuns?: number; // Target number of runs for D-Optimal
  dOptimalModel?: 'Linear' | '2FI' | 'Quadratic';
  designGoal?: DoEDesignGoal;
  runBudget?: number; // Maximum feasible runs for design-wizard recommendations
  /** Execution batches.  These are balanced run-plan blocks, not ANOVA terms. */
  blocks?: number;
}

export interface DesignEvaluationMetrics {
  dEfficiency: number; // 0 - 100%
  aEfficiency: number; // 0 - 100%
  gEfficiency: number; // 0 - 100%
  determinantXTX: number;
  conditionNumber: number;
  averageLeverage: number;
  maxLeverage: number;
  numRuns: number;
  numParameters: number;
  degreesOfFreedom: number;
  rating: 'Xuất sắc (>85%)' | 'Tốt (70-85%)' | 'Chấp nhận được (50-70%)' | 'Kém (<50%)';
}

export interface DoERun {
  id: string;
  stdOrder: number;
  runOrder: number;
  block: number;
  factorCoded: Record<string, number>; // code (X1) -> coded value (-1, 0, 1, +alpha, -alpha)
  factorActual: Record<string, number | string>; // code (X1) -> actual value (number or string category)
  responses: Record<string, number | string | null>; // code (Y1) -> result (numeric or string)
}

export type ModelType = 'Linear' | '2FI' | 'Quadratic' | 'Reduced';

export interface RegressionTerm {
  name: string; // 'Intercept', 'X1', 'X2', 'X1*X2', 'X1^2'
  factorCodes: string[];
  power: number[]; // e.g. [1, 0] or [1, 1] or [2, 0]
  coefficient: number;
  stdError: number;
  tValue: number;
  pValue: number;
  vif: number;
  significant: boolean;
}

export interface ANOVASource {
  source: string;
  ss: number; // Sum of Squares
  df: number; // Degrees of Freedom
  ms: number; // Mean Square
  fValue?: number;
  pValue?: number;
}

export interface ModelDiagnostics {
  rSquared: number;
  adjRSquared: number;
  predRSquared: number; // Q^2 (1 - PRESS/SSTotal)
  qSquared?: number;    // Alias for Q^2 (Slide 12)
  adeqPrecision: number;
  press: number;
  stdDev: number;
  mean: number;
  cvPercent: number;
  aicc?: number;        // Akaike's Information Criterion Corrected (Slide 12)
  bic?: number;         // Bayesian Information Criterion (Slide 12)
  logLikelihood?: number;
  twoLL?: number;       // -2 x LogLikelihood (-2LL) (Slide 12)
  fLOF?: number;        // Lack of Fit F-ratio (Slide 11, 16, 20)
  pLOF?: number;        // Lack of Fit P-value (> 0.05 indicates good fit)
  ssLOF?: number;
  dfLOF?: number;
  msLOF?: number;
  ssPureError?: number;
  dfPureError?: number;
  msPureError?: number;
  residuals: {
    runOrder: number;
    actual: number;
    predicted: number;
    residual: number;
    stdResidual: number;
    studentizedResidual: number;
    cooksDistance: number;
    leverage: number;
  }[];
}

export interface StatisticalModelResult {
  cqaCode: string;
  modelType: ModelType;
  terms: RegressionTerm[];
  anova: ANOVASource[];
  lackOfFit?: ANOVASource;
  pureError?: ANOVASource;
  totalError?: ANOVASource;
  curvatureTest?: ANOVASource & { significant: boolean; note: string };
  diagnostics: ModelDiagnostics;
  equationString: string;
  predict: (codedFactors: Record<string, number>) => number;
  /** Standard error of the estimated mean response at a coded factor point. */
  predictStandardError?: (codedFactors: Record<string, number>) => number;
  residualDegreesOfFreedom?: number;
}

export interface UpdatedRiskItem {
  factorCode: string;
  factorName: string;
  cqaCode: string;
  cqaName: string;
  initialRisk: 'High' | 'Medium' | 'Low';
  updatedRisk: 'Low' | 'Medium';
  isSignificantInModel: boolean;
  justification: string;
}

export interface ControlStrategyItem {
  category: 'Material Attribute (CMA)' | 'Process Parameter (CPP)' | 'In-Process Control (IPC)' | 'Finished Product Specification';
  parameterName: string;
  parameterCode?: string;
  unit: string;
  target: string | number;
  nor: string; // Normal Operating Range (Khoảng vận hành thông thường)
  par: string; // Proven Acceptable Range (Khoảng chấp nhận đã chứng minh)
  designSpaceLimit: string; // Giới hạn vùng thiết kế
  controlMethod: string; // Phương pháp kiểm soát (PAT/IPC/Release)
}

export interface DesirabilitySolution {
  codedFactors: Record<string, number>;
  actualFactors: Record<string, number | string>;
  predictedResponses: Record<string, { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }>;
  overallDesirability: number;
}

export interface SavedDesirabilitySetting {
  id: string;
  name: string;
  createdAt: string;
  codedFactors: Record<string, number>;
  actualFactors: Record<string, number | string>;
  predictedResponses: Record<string, { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }>;
  overallDesirability: number;
}

export interface DesignSpaceRanges {
  factorCode: string;
  knowledgeLow: number;
  knowledgeHigh: number;
  parLow: number; // Proven Acceptable Range
  parHigh: number;
  norLow: number; // Normal Operating Range
  norHigh: number;
  target: number | string;
  evidenceLevel?: 'provisional_screening' | 'confirmed';
  evidenceNote?: string;
}

export interface MonteCarloResult {
  simulations: number;
  seed?: number;
  variabilityPercent?: number;
  passCount: number;
  failCount: number;
  defectRatePPM: number;
  reliabilityPercent: number;
  executionTimeMs?: number;
  cqaStats: Record<string, {
    mean: number;
    sd: number;
    min: number;
    max: number;
    cpk?: number;
    outOfSpecPercent: number;
  }>;
}

/** Persisted analysis settings make optimization/simulation reproducible. */
export interface AnalysisProvenance {
  optimizerSeed: number;
  monteCarloSeed: number;
  demoDataSeed: number;
  monteCarloVariabilityPercent: number;
  monteCarloSimulations: number;
}

/**
 * Persisted analysis choices. These settings are part of the scientific
 * provenance and must travel with JSON exports and project snapshots.
 */
export interface AnalysisSettings {
  modelingEngine: ModelingEngine;
  modelTypes: Record<string, ModelType>;
  neuralTrainingMode: NeuralTrainingMode;
  sharedNeuralConfig: NeuralNetConfig;
  neuralConfigs: Record<string, NeuralNetConfig>;
  /** Last explicitly applied profiler solution, serialized without functions. */
  appliedOptimum?: DesirabilitySolution;
}

export interface QBDProject {
  id: string;
  name: string;
  moleculeName: string;
  dosageForm: string;
  author: string;
  version: string;
  createdDate: string;
  updatedDate: string;
  description: string;
  qtpp: QTPPItem[];
  cqas: CQA[];
  factors: Factor[];
  fmeaRisks: FMEARiskItem[];
  fishbone?: FishboneDiagram;
  doeConfig: DoEDesignConfig;
  runs: DoERun[];
  designSpace: DesignSpaceRanges[];
  modelingEngine?: ModelingEngine;
  analysisProvenance?: AnalysisProvenance;
  analysisSettings?: AnalysisSettings;
}

export * from './neuralNetwork';
