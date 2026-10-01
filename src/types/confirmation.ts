import type { CQA, Factor, ModelType, SerializedNeuralNetModel, DesirabilitySolution } from './qbd';

export interface FrozenResponse {
  cqa: CQA;
  predicted: number | null;
  model?: { kind: 'ols'; modelType: ModelType; coefficients: number[]; covariance?: number[][]; residualSD: number; df: number }
    | { kind: 'ann'; artifact: SerializedNeuralNetModel };
  tolerance?: number;
  toleranceMode: 'absolute' | 'relative';
}
export interface ConfirmationRun {
  id: string;
  batch: string;
  date: string;
  notes: string;
  actualFactors: Record<string, number | string>;
  /** One result per independent experimental unit; technical repeats are averaged before entry. */
  responses: Record<string, number | string | null>;
}
export interface ConfirmationStudy {
  id: string;
  name: string;
  createdAt: string;
  sourceHash: string;
  sourceVersion: string;
  factors: Factor[];
  sourceBlocks: number[];
  solution: DesirabilitySolution;
  /** Original selected optimum, retained when the executable setpoint is rounded. */
  originalSolution?: DesirabilitySolution;
  responses: FrozenResponse[];
  plannedReplicates: number;
  confidence: 0.9 | 0.95 | 0.99;
  specificationBasis: 'individual' | 'mean';
  status: 'draft' | 'collecting' | 'complete';
  runs: ConfirmationRun[];
  history: { at: string; action: string; before?: string }[];
  addedToTrainingAt?: string;
}
