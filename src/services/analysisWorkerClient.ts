import type { Factor, CQA, MonteCarloResult, StatisticalModelResult, NeuralNetModelResult } from '../types/qbd';
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  MonteCarloTaskPayload,
} from '../workers/workerProtocol';

let workerInstance: Worker | null = null;
let currentTaskId: string | null = null;

export function serializeModelsForWorker(models: Record<string, StatisticalModelResult | NeuralNetModelResult>) {
  const serialized: Record<string, any> = {};

  Object.entries(models).forEach(([code, m]) => {
    if ('terms' in m) {
      // OLS
      const coeffs: Record<string, number> = {};
      m.terms.forEach((t) => {
        coeffs[t.name] = t.coefficient;
      });
      serialized[code] = {
        kind: 'ols',
        coefficients: coeffs,
        formula: m.equationString,
        modelType: m.modelType,
        diagnostics: m.diagnostics,
        predictionCovariance: m.predictionCovariance,
        terms: m.terms.map((t) => ({
          name: t.name,
          coefficient: t.coefficient,
          factorCodes: t.factorCodes,
          power: t.power,
        })),
      };
    } else {
      // ANN
      const { predict: _predict, ...artifact } = m;
      serialized[code] = {
        kind: 'ann',
        ...artifact,
      };
    }
  });

  return serialized;
}

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }

  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      workerInstance = null;
    }
  }

  return workerInstance;
}

export function terminateWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
    currentTaskId = null;
  }
}

export async function runMonteCarloInWorker(
  setpointActual: Record<string, number | string>,
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  variabilityPercent: number = 2.0,
  simulations: number = 10000,
  seed: number = 20260827,
  onProgress?: (progressPercent: number) => void,
  abortSignal?: AbortSignal,
  fallbackRunner?: (
    setpointActual: Record<string, number | string>,
    factors: Factor[],
    cqas: CQA[],
    models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
    variabilityPercent?: number,
    simulations?: number,
    seed?: number,
    onProgress?: (progressPercent: number) => void,
    twoStageMonteCarlo?: boolean
  ) => MonteCarloResult,
  twoStageMonteCarlo?: boolean
): Promise<MonteCarloResult> {
  const worker = getWorker();

  // If worker is unavailable (e.g. testing in node / vitest), fall back to synchronous calculation
  if (!worker) {
    if (abortSignal?.aborted) {
      throw new Error('Mô phỏng Monte Carlo đã bị hủy bởi người dùng.');
    }
    const runner = fallbackRunner ?? (await import('./statistics')).runMonteCarloSimulation;
    const result = runner(
      setpointActual,
      factors,
      cqas,
      models,
      variabilityPercent,
      simulations,
      seed,
      onProgress,
      twoStageMonteCarlo
    );
    onProgress?.(100);
    return result;
  }

  const taskId = `mc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  currentTaskId = taskId;

  const payload: MonteCarloTaskPayload = {
    setpointActual,
    factors,
    cqas,
    modelsPayload: serializeModelsForWorker(models),
    variabilityPercent,
    simulations,
    seed,
    twoStageMonteCarlo,
  };

  const request: WorkerRequestMessage = {
    taskId,
    type: 'MONTE_CARLO',
    payload,
  };

  return new Promise<MonteCarloResult>((resolve, reject) => {
    const handleAbort = () => {
      terminateWorker();
      cleanup();
      reject(new Error('Mô phỏng Monte Carlo đã bị hủy bởi người dùng.'));
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        handleAbort();
        return;
      }
      abortSignal.addEventListener('abort', handleAbort);
    }

    const messageHandler = (e: MessageEvent<WorkerResponseMessage>) => {
      const msg = e.data;
      if (msg.taskId !== taskId) return;

      if (msg.type === 'PROGRESS') {
        onProgress?.(msg.progress);
      } else if (msg.type === 'SUCCESS') {
        cleanup();
        onProgress?.(100);
        resolve(msg.result);
      } else if (msg.type === 'ERROR') {
        cleanup();
        reject(new Error(msg.error));
      }
    };

    const errorHandler = (err: ErrorEvent) => {
      cleanup();
      reject(new Error(err.message || 'Worker execution error'));
    };

    function cleanup() {
      worker?.removeEventListener('message', messageHandler);
      worker?.removeEventListener('error', errorHandler);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', handleAbort);
      }
      if (currentTaskId === taskId) {
        currentTaskId = null;
      }
    }

    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    worker.postMessage(request);
  });
}
