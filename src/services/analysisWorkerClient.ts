import type { Factor, CQA, MonteCarloResult, StatisticalModelResult, NeuralNetModelResult, MonteCarloCustomVariability } from '../types/qbd';
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  MonteCarloTaskPayload,
} from '../workers/workerProtocol';

// A run owns its worker. Cancelling one run must never leave another promise
// waiting for a response from a worker that was terminated underneath it.
const activeTaskCancels = new Set<() => void>();

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
        cqaCode: m.cqaCode,
        coefficients: coeffs,
        formula: m.equationString,
        modelType: m.modelType,
        diagnostics: m.diagnostics,
        predictionCovariance: m.predictionCovariance,
        residualDegreesOfFreedom: m.residualDegreesOfFreedom,
        reducedTerms: m.reducedTerms,
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

  try {
    return new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
        type: 'module',
    });
  } catch {
    return null;
  }
}

export function terminateWorker() {
  for (const cancel of [...activeTaskCancels]) {
    cancel();
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
    twoStageMonteCarlo?: boolean,
    customVariability?: MonteCarloCustomVariability
  ) => MonteCarloResult,
  twoStageMonteCarlo?: boolean,
  customVariability?: MonteCarloCustomVariability
): Promise<MonteCarloResult> {
  if (abortSignal?.aborted) {
    throw new Error('Mô phỏng Monte Carlo đã bị hủy bởi người dùng.');
  }
  const candidateWorker = getWorker();

  // If worker is unavailable (e.g. testing in node / vitest), fall back to synchronous calculation
  if (!candidateWorker) {
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
      twoStageMonteCarlo,
      customVariability
    );
    onProgress?.(100);
    return result;
  }
  const worker = candidateWorker;

  const taskId = `mc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const payload: MonteCarloTaskPayload = {
    setpointActual,
    factors,
    cqas,
    modelsPayload: serializeModelsForWorker(models),
    variabilityPercent,
    simulations,
    seed,
    twoStageMonteCarlo,
    customVariability,
  };

  const request: WorkerRequestMessage = {
    taskId,
    type: 'MONTE_CARLO',
    payload,
  };

  return new Promise<MonteCarloResult>((resolve, reject) => {
    let settled = false;

    function cleanup() {
      worker.removeEventListener('message', messageHandler);
      worker.removeEventListener('error', errorHandler);
      abortSignal?.removeEventListener('abort', handleAbort);
      activeTaskCancels.delete(handleAbort);
      worker.terminate();
    }

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    }

    const handleAbort = () => {
      finish(() => reject(new Error('Mô phỏng Monte Carlo đã bị hủy bởi người dùng.')));
    };

    const messageHandler = (e: MessageEvent<WorkerResponseMessage>) => {
      const msg = e.data;
      if (msg.taskId !== taskId) return;

      if (msg.type === 'PROGRESS') {
        onProgress?.(msg.progress);
      } else if (msg.type === 'SUCCESS') {
        finish(() => {
          onProgress?.(100);
          resolve(msg.result as MonteCarloResult);
        });
      } else if (msg.type === 'ERROR') {
        finish(() => reject(new Error(msg.error)));
      }
    };

    const errorHandler = (err: ErrorEvent) => {
      finish(() => reject(new Error(err.message || 'Worker execution error')));
    };

    activeTaskCancels.add(handleAbort);
    if (abortSignal) {
      if (abortSignal.aborted) {
        handleAbort();
        return;
      }
      abortSignal.addEventListener('abort', handleAbort);
    }

    worker.addEventListener('message', messageHandler);
    worker.addEventListener('error', errorHandler);
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
