import { describe, expect, it } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import { serializeModelsForWorker } from '../services/analysisWorkerClient';
import { buildRegressionTermEvaluators } from '../services/modelTerms';
import { fitModel, runMonteCarloSimulation } from '../services/statistics';
import { rebuildModels } from '../workers/analysis.worker';
import type { CQA, DoERun, Factor, ModelType, StatisticalModelResult } from '../types/qbd';

const cqa: CQA = {
  id: 'c1', code: 'Y1', name: 'Response', unit: '%',
  lowerLimit: 20, upperLimit: 80, objective: 'target', weight: 1,
};

function assertWorkerParity(
  model: StatisticalModelResult,
  factors: Factor[],
  points: Record<string, number>[],
) {
  const serialized = serializeModelsForWorker({ [model.cqaCode]: model });
  // JSON roundtrip mimics the Worker structured-clone boundary: no functions.
  const workerModel = rebuildModels(JSON.parse(JSON.stringify(serialized)), factors)[model.cqaCode] as StatisticalModelResult;
  expect(serialized[model.cqaCode].residualDegreesOfFreedom).toBe(model.residualDegreesOfFreedom);
  expect(workerModel.terms.map((term) => term.name)).toEqual(model.terms.map((term) => term.name));
  points.forEach((point) => {
    expect(workerModel.predict(point)).toBeCloseTo(model.predict(point), 9);
    expect(workerModel.predictStandardError?.(point)).toBeCloseTo(model.predictStandardError!(point), 9);
  });
  return workerModel;
}

describe('OLS Worker serialization and uncertainty parity', () => {
  it('predicts full quadratic terms, including the superscript squared form', () => {
    const study = CASE_STUDIES.find((project) => project.id === 'case-study-api-ccd')!;
    const model = fitModel(study.cqas[0], study.factors, study.runs, 'Quadratic')!;
    expect(model).not.toBeNull();
    expect(model.terms.some((term) => term.name.endsWith('²'))).toBe(true);
    assertWorkerParity(model, study.factors, [
      { X1: 0.3, X2: -0.6, X3: 0.1 },
      { X1: -0.7, X2: 0.2, X3: 0.6 },
      { X1: 0, X2: 0, X3: 0 },
    ]);
  });

  it('handles categorical contrasts and categorical-by-numeric interactions', () => {
    const factors: Factor[] = [
      { id: 'cat', code: 'A', name: 'Solvent', type: 'Process', dataType: 'qualitative',
        controllability: 'controllable', categories: ['Water', 'Ethanol', 'IPA'], low: -1, high: 1, unit: '' },
      { id: 'temp', code: 'B', name: 'Temperature', type: 'Process', dataType: 'quantitative',
        controllability: 'controllable', low: 25, high: 75, unit: '°C' },
    ];
    const runs: DoERun[] = [];
    for (const category of [-1, 0, 1]) {
      for (const temp of [-1, 0, 1]) {
        for (const replicate of [0, 1]) {
          const i = runs.length;
          runs.push({
            id: `r${i}`, runOrder: i + 1, stdOrder: i + 1, block: 1,
            factorCoded: { A: category, B: temp },
            factorActual: { A: ['Water', 'Ethanol', 'IPA'][category + 1], B: 50 + 25 * temp },
            responses: { Y1: 40 + 3 * (category === 0 ? 1 : 0) + 6 * (category === 1 ? 1 : 0)
              + 4 * temp + 2 * temp * (category === 1 ? 1 : 0) + (replicate ? 0.12 : -0.09) },
          });
        }
      }
    }
    const model = fitModel(cqa, factors, runs, '2FI')!;
    expect(model).not.toBeNull();
    expect(model.terms.some((term) => term.name.includes('[IPA]*B'))).toBe(true);
    const reference = model.predict({ A: -1, B: 0.45 });
    const ipa = model.predict({ A: 1, B: 0.45 });
    expect(ipa).not.toBeCloseTo(reference, 3);
    assertWorkerParity(model, factors, [
      { A: -1, B: 0.45 }, { A: 0, B: -0.3 }, { A: 1, B: 0.75 },
    ]);
  });

  it('matches mixture-by-process terms used by combined designs', () => {
    const study = CASE_STUDIES.find((project) => project.id === 'case-study-sedds-combined')!;
    const model = fitModel(study.cqas[0], study.factors, study.runs, 'Linear')!;
    expect(model).not.toBeNull();
    expect(model.terms.some((term) => term.name.includes('X1*X4'))).toBe(true);
    assertWorkerParity(model, study.factors, [
      { X1: 0.2, X2: 0.5, X3: 0.3, X4: -0.7, X5: 0.6 },
      { X1: 0.4, X2: 0.3, X3: 0.3, X4: 0.3, X5: -0.5 },
    ]);
  });

  it('excludes block nuisance effects and ignored noise factors, including reduced models', () => {
    const factors: Factor[] = [
      { id: 'f1', code: 'X1', name: 'Mixing', type: 'Process', dataType: 'quantitative',
        controllability: 'controllable', low: 10, high: 30, unit: 'rpm' },
      { id: 'f2', code: 'X2', name: 'Temperature', type: 'Process', dataType: 'quantitative',
        controllability: 'controllable', low: 30, high: 70, unit: '°C' },
      { id: 'noise', code: 'Z', name: 'Humidity', type: 'Process', dataType: 'quantitative',
        controllability: 'uncontrollable_noise', low: 20, high: 80, unit: '%' },
    ];
    const runs: DoERun[] = [];
    for (const block of [1, 2]) {
      for (const x1 of [-1, 0, 1]) {
        for (const x2 of [-1, 0, 1]) {
          const i = runs.length;
          runs.push({
            id: `r${i}`, runOrder: i + 1, stdOrder: i + 1, block,
            factorCoded: { X1: x1, X2: x2, Z: i % 2 ? -1 : 1 },
            factorActual: { X1: 20 + 10 * x1, X2: 50 + 20 * x2, Z: i % 2 ? 20 : 80 },
            responses: { Y1: 50 + 3 * x1 - 2 * x2 + x1 * x2 - 2 * x1 * x1
              + 0.5 * x2 * x2 + (block === 2 ? 5 : 0) + 0.03 * (i % 3 - 1) },
          });
        }
      }
    }
    for (const [modelType, selected] of [
      ['Quadratic', undefined],
      ['Reduced', ['Intercept', 'X1', 'X1²']],
    ] as [ModelType, string[] | undefined][]) {
      const model = fitModel(cqa, factors, runs, modelType, selected)!;
      expect(model).not.toBeNull();
      expect(model.terms.some((term) => term.name.startsWith('Block '))).toBe(true);
      expect(model.terms.some((term) => term.name.includes('Z'))).toBe(false);
      assertWorkerParity(model, factors, [
        { X1: 0.3, X2: -0.6, Z: -1 }, { X1: -0.7, X2: 0.5, Z: 1 },
      ]);
    }
  });

  it('preserves seeded Monte Carlo metrics in both one-stage and two-stage runs', () => {
    const study = CASE_STUDIES.find((project) => project.id === 'case-study-api-ccd')!;
    const model = fitModel(study.cqas[0], study.factors, study.runs, 'Quadratic')!;
    expect(model).not.toBeNull();
    const workerModel = assertWorkerParity(model, study.factors, [{ X1: 0.2, X2: -0.3, X3: 0.4 }]);
    const originalModels = { [model.cqaCode]: model };
    const workerModels = { [model.cqaCode]: workerModel };
    const point = { X1: 75, X2: 7, X3: 2 };
    for (const twoStage of [false, true]) {
      const original = runMonteCarloSimulation(point, study.factors, [study.cqas[0]], originalModels,
        1.5, 250, 2026, undefined, twoStage);
      const reconstructed = runMonteCarloSimulation(point, study.factors, [study.cqas[0]], workerModels,
        1.5, 250, 2026, undefined, twoStage);
      expect(reconstructed.reliabilityPercent).toBe(original.reliabilityPercent);
      expect(reconstructed.cqaStats.Y1.mean).toBeCloseTo(original.cqaStats.Y1.mean, 3);
      expect(reconstructed.cqaStats.Y1.sd).toBeCloseTo(original.cqaStats.Y1.sd, 3);
      expect(reconstructed.varianceDecomposition?.Y1.processVariance).toBeCloseTo(
        original.varianceDecomposition!.Y1.processVariance, 3);
    }
  });

  it('evaluates the correct factor powers in the two-stage parameter basis', () => {
    const study = CASE_STUDIES.find((project) => project.id === 'case-study-api-ccd')!;
    const model = fitModel(study.cqas[0], study.factors, study.runs, 'Quadratic')!;
    const evaluators = buildRegressionTermEvaluators(study.factors, model.modelType, model.terms);
    const quadraticIndex = model.terms.findIndex((term) => term.name === 'X2²');
    expect(quadraticIndex).toBeGreaterThanOrEqual(0);
    expect(evaluators[quadraticIndex]({ X1: 0.2, X2: -0.6, X3: 0.8 })).toBeCloseTo(0.36, 12);
  });
});
