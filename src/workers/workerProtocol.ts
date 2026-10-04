import type { Factor, CQA, MonteCarloResult, DesirabilitySolution, MonteCarloCustomVariability } from '../types/qbd';

export type WorkerTaskType = 'MONTE_CARLO' | 'OPTIMIZE_DESIRABILITY';

export interface MonteCarloTaskPayload {
  setpointActual: Record<string, number | string>;
  factors: Factor[];
  cqas: CQA[];
  modelsPayload: Record<string, {
    kind: 'ols' | 'ann';
    coefficients?: Record<string, number>;
    formula?: string;
    modelType?: string;
    // For ANN models
    weights?: any;
    normParams?: any;
    config?: any;
    inputFactorCodes?: string[];
  }>;
  variabilityPercent: number;
  simulations: number;
  seed: number;
  twoStageMonteCarlo?: boolean;
  customVariability?: MonteCarloCustomVariability;
}

export interface WorkerRequestMessage {
  taskId: string;
  type: WorkerTaskType;
  payload: MonteCarloTaskPayload | any;
}

export interface WorkerProgressMessage {
  taskId: string;
  type: 'PROGRESS';
  progress: number;
}

export interface WorkerSuccessMessage {
  taskId: string;
  type: 'SUCCESS';
  result: MonteCarloResult | DesirabilitySolution | any;
}

export interface WorkerErrorMessage {
  taskId: string;
  type: 'ERROR';
  error: string;
}

export type WorkerResponseMessage = WorkerProgressMessage | WorkerSuccessMessage | WorkerErrorMessage;
