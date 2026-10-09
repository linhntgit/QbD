import { runMonteCarloSimulation, optimizeDesirability } from '../services/statistics';
import { createNeuralPredictor } from '../services/neuralNetwork';
import { buildRegressionTermEvaluators } from '../services/modelTerms';
import type { Factor, CQA, StatisticalModelResult, NeuralNetModelResult } from '../types/qbd';
import type { WorkerRequestMessage, WorkerResponseMessage } from './workerProtocol';

// Helper to rebuild callable predict function from serialized model payload
export function rebuildModels(
  modelsPayload: Record<string, any>,
  factors?: Factor[]
): Record<string, StatisticalModelResult | NeuralNetModelResult> {
  const result: Record<string, any> = {};

  Object.entries(modelsPayload).forEach(([code, m]) => {
    if (m.kind === 'ols') {
      const serializedTerms = m.terms ?? [];
      const evaluators = buildRegressionTermEvaluators(factors ?? [], m.modelType, serializedTerms);
      const reconstructedTerms = serializedTerms.map((term: any, index: number) => ({
        ...term,
        evaluator: evaluators[index],
      }));
      const covariance: number[][] | undefined = m.predictionCovariance;
      if (covariance && (covariance.length !== evaluators.length ||
        covariance.some((row) => row.length !== evaluators.length))) {
        throw new Error(`Invalid prediction covariance dimensions for ${code}`);
      }

      result[code] = {
        ...m,
        terms: reconstructedTerms,
        predictionCovariance: covariance,
        predict: (coded: Record<string, number>) => {
          return serializedTerms.reduce(
            (sum: number, term: { coefficient: number }, index: number) =>
              sum + term.coefficient * evaluators[index](coded),
            0,
          );
        },
        predictStandardError: covariance ? (coded: Record<string, number>) => {
          const x0 = evaluators.map((evaluate) => evaluate(coded));
          const variance = x0.reduce((sum, value, i) =>
            sum + value * x0.reduce((inner, other, j) => inner + covariance[i][j] * other, 0), 0);
          return Math.sqrt(Math.max(0, variance));
        } : undefined,
      };
    } else if (m.kind === 'ann' || m.weights) {
      result[code] = {
        ...m,
        predict: createNeuralPredictor(m, factors),
      };
    } else {
      result[code] = m;
    }
  });

  return result;
}

if (typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
    const { taskId, type, payload } = event.data;

    try {
      if (type === 'MONTE_CARLO') {
        const { setpointActual, factors, cqas, modelsPayload, variabilityPercent, simulations, seed, twoStageMonteCarlo, customVariability } = payload;
        const reconstructedModels = rebuildModels(modelsPayload, factors as Factor[]);

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
          Boolean(twoStageMonteCarlo),
          customVariability
        );

        const successMsg: WorkerResponseMessage = { taskId, type: 'SUCCESS', result };
        self.postMessage(successMsg);
      } else if (type === 'OPTIMIZE_DESIRABILITY') {
        const { factors, cqas, modelsPayload, options, seed } = payload;
        const reconstructedModels = rebuildModels(modelsPayload, factors as Factor[]);

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
}
