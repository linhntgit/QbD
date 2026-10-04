import { runMonteCarloSimulation, optimizeDesirability } from '../services/statistics';
import type { Factor, CQA, StatisticalModelResult, NeuralNetModelResult } from '../types/qbd';
import type { WorkerRequestMessage, WorkerResponseMessage } from './workerProtocol';

// Helper to rebuild callable predict function from serialized model payload
function rebuildModels(modelsPayload: Record<string, any>): Record<string, StatisticalModelResult | NeuralNetModelResult> {
  const result: Record<string, any> = {};

  Object.entries(modelsPayload).forEach(([code, m]) => {
    if (m.kind === 'ols') {
      const coeffs = m.coefficients || {};
      const reconstructedTerms = Array.isArray(m.terms)
        ? m.terms.map((t: any) => ({
            ...t,
            evaluator: (coded: Record<string, number>) => {
              if (t.name === 'Intercept' || t.name === '(Intercept)') return 1;
              if (t.factorCodes && t.power) {
                return t.factorCodes.reduce((prod: number, code: string, idx: number) => {
                  const pow = t.power[idx] ?? 1;
                  return prod * Math.pow(coded[code] ?? 0, pow);
                }, 1);
              }
              if (t.name.includes('*')) {
                return t.name.split('*').reduce((p: number, f: string) => p * (coded[f] ?? 0), 1);
              }
              if (t.name.includes('^2')) {
                const f = t.name.replace('^2', '');
                return Math.pow(coded[f] ?? 0, 2);
              }
              return coded[t.name] ?? 0;
            },
          }))
        : undefined;

      result[code] = {
        ...m,
        terms: reconstructedTerms,
        predictionCovariance: m.predictionCovariance,
        predict: (coded: Record<string, number>) => {
          let sum = coeffs.Intercept ?? coeffs['(Intercept)'] ?? 0;
          Object.entries(coeffs).forEach(([term, b]) => {
            if (term === 'Intercept' || term === '(Intercept)') return;
            const termVal = Number(b);
            if (term.includes('*')) {
              const parts = term.split('*');
              const prod = parts.reduce((p, fCode) => p * (coded[fCode] ?? 0), 1);
              sum += termVal * prod;
            } else if (term.includes('^2')) {
              const fCode = term.replace('^2', '');
              const val = coded[fCode] ?? 0;
              sum += termVal * val * val;
            } else {
              sum += termVal * (coded[term] ?? 0);
            }
          });
          return sum;
        },
      };
    } else {
      // Rebuild ANN prediction if weights exist
      result[code] = m;
    }
  });

  return result;
}

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const { taskId, type, payload } = event.data;

  try {
    if (type === 'MONTE_CARLO') {
      const { setpointActual, factors, cqas, modelsPayload, variabilityPercent, simulations, seed, twoStageMonteCarlo } = payload;
      const reconstructedModels = rebuildModels(modelsPayload);

      // Report initial progress
      const progressMsg: WorkerResponseMessage = { taskId, type: 'PROGRESS', progress: 5 };
      self.postMessage(progressMsg);

      const result = runMonteCarloSimulation(
        setpointActual,
        factors as Factor[],
        cqas as CQA[],
        reconstructedModels,
        variabilityPercent,
        simulations,
        seed,
        (progress) => {
          const pMsg: WorkerResponseMessage = { taskId, type: 'PROGRESS', progress };
          self.postMessage(pMsg);
        },
        Boolean(twoStageMonteCarlo)
      );

      const successMsg: WorkerResponseMessage = { taskId, type: 'SUCCESS', result };
      self.postMessage(successMsg);
    } else if (type === 'OPTIMIZE_DESIRABILITY') {
      const { factors, cqas, modelsPayload, options, seed } = payload;
      const reconstructedModels = rebuildModels(modelsPayload);

      const result = optimizeDesirability(
        factors as Factor[],
        cqas as CQA[],
        reconstructedModels,
        options,
        seed
      );

      const successMsg: WorkerResponseMessage = { taskId, type: 'SUCCESS', result };
      self.postMessage(successMsg);
    }
  } catch (error) {
    const errorMsg: WorkerResponseMessage = {
      taskId,
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(errorMsg);
  }
};
