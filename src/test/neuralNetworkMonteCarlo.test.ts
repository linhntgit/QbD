import { describe, it, expect } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import { fitNeuralNetModel, fitMultiOutputNeuralNet, createNeuralPredictor } from '../services/neuralNetwork';
import { serializeModelsForWorker } from '../services/analysisWorkerClient';
import { rebuildModels } from '../workers/analysis.worker';
import { runMonteCarloSimulation, runMonteCarloSimulationAsync } from '../services/statistics';
import type { Factor, CQA } from '../types/qbd';

describe('Neural Network Model Reconstruction & Monte Carlo Simulation', () => {
  const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;

  it('trains an ANN model and verifies createNeuralPredictor matches model.predict', () => {
    expect(cs).toBeDefined();
    const cqa = cs.cqas[0];
    const annModel = fitNeuralNetModel(cqa, cs.factors, cs.runs, {
      hiddenNodes1: 2,
      hiddenNodes2: 0,
      activation: 'tanh',
      maxEpochs: 60,
      validationMethod: 'none',
      seed: 42,
    });
    expect(annModel).not.toBeNull();
    if (!annModel) return;

    expect(typeof annModel.predict).toBe('function');

    const manualPredict = createNeuralPredictor(annModel, cs.factors);
    expect(typeof manualPredict).toBe('function');

    // Test across several sample points
    const testPoints = [
      { X1: 0, X2: 0, X3: 0 },
      { X1: 0.5, X2: -0.5, X3: 0.2 },
      { X1: -1, X2: 1, X3: -0.8 },
    ];

    for (const pt of testPoints) {
      const origVal = annModel.predict(pt);
      const manualVal = manualPredict(pt);
      expect(Number.isFinite(origVal)).toBe(true);
      expect(manualVal).toBeCloseTo(origVal, 8);
    }
  });

  it('reconstructs ANN predict function through serializeModelsForWorker and rebuildModels', () => {
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitNeuralNetModel(cqa, cs.factors, cs.runs, {
        hiddenNodes1: 2,
        hiddenNodes2: 0,
        activation: 'sigmoid',
        maxEpochs: 40,
        validationMethod: 'none',
        seed: 123,
      });
      if (m) models[cqa.code] = m;
    }
    expect(Object.keys(models).length).toBe(cs.cqas.length);

    // 1. Serialize for worker (simulates postMessage serialization)
    const serialized = serializeModelsForWorker(models);
    for (const code of Object.keys(models)) {
      expect(serialized[code].kind).toBe('ann');
      // Verify predict was removed by serialization
      expect(serialized[code].predict).toBeUndefined();
      expect(serialized[code].weights).toBeDefined();
      expect(serialized[code].normParams).toBeDefined();
    }

    // 2. Rebuild in worker (simulates worker execution)
    const reconstructed = rebuildModels(serialized, cs.factors);
    for (const code of Object.keys(models)) {
      const reconstructedModel = reconstructed[code];
      expect(reconstructedModel).toBeDefined();
      // Crucial test: predict is a callable function!
      expect(typeof reconstructedModel.predict).toBe('function');

      // Verify numerical equivalence to original
      const sample = { X1: 0.3, X2: -0.4, X3: 0.1 };
      const origPred = models[code].predict(sample);
      const rebuiltPred = reconstructedModel.predict(sample);
      expect(rebuiltPred).toBeCloseTo(origPred, 8);
    }
  });

  it('runs Monte Carlo simulation successfully with reconstructed ANN models without throwing', () => {
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitNeuralNetModel(cqa, cs.factors, cs.runs, {
        hiddenNodes1: 2,
        hiddenNodes2: 0,
        activation: 'tanh',
        maxEpochs: 40,
        validationMethod: 'none',
        seed: 999,
      });
      if (m) models[cqa.code] = m;
    }

    // Simulate worker receiving serialized models
    const serialized = serializeModelsForWorker(models);
    const reconstructed = rebuildModels(serialized, cs.factors);

    // Setpoint in actual coordinates
    const targetActual: Record<string, number> = {
      X1: 75,
      X2: 7,
      X3: 2.0,
    };

    // Run Monte Carlo simulation with reconstructed models (single-stage)
    const mcResult = runMonteCarloSimulation(
      targetActual,
      cs.factors,
      cs.cqas,
      reconstructed,
      2.0,
      500,
      2026,
      undefined,
      false
    );

    expect(mcResult).toBeDefined();
    expect(mcResult.simulations).toBe(500);
    expect(mcResult.modeledCqaCodes).toEqual(cs.cqas.map((c) => c.code));
    for (const cqa of cs.cqas) {
      const stat = mcResult.cqaStats[cqa.code];
      expect(stat).toBeDefined();
      expect(Number.isFinite(stat.mean)).toBe(true);
      expect(Number.isFinite(stat.sd)).toBe(true);
      expect(stat.sd).toBeGreaterThan(0);
      expect(Number.isFinite(stat.ppk)).toBe(true);
    }

    // Run Monte Carlo simulation with two-stage parameter uncertainty
    const mcTwoStage = runMonteCarloSimulation(
      targetActual,
      cs.factors,
      cs.cqas,
      reconstructed,
      2.0,
      500,
      2026,
      undefined,
      true
    );
    expect(mcTwoStage).toBeDefined();
    expect(mcTwoStage.simulations).toBe(500);
  });

  it('runs runMonteCarloSimulationAsync successfully with ANN models', async () => {
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitNeuralNetModel(cqa, cs.factors, cs.runs, {
        hiddenNodes1: 2,
        hiddenNodes2: 0,
        activation: 'tanh',
        maxEpochs: 30,
        validationMethod: 'none',
        seed: 777,
      });
      if (m) models[cqa.code] = m;
    }

    const targetActual: Record<string, number> = {
      X1: 75,
      X2: 7,
      X3: 2.0,
    };

    let progressUpdates = 0;
    const mc = await runMonteCarloSimulationAsync(
      targetActual,
      cs.factors,
      cs.cqas,
      models,
      1.5,
      300,
      2026,
      () => {
        progressUpdates++;
      }
    );

    expect(mc).toBeDefined();
    expect(mc.simulations).toBe(300);
    expect(progressUpdates).toBeGreaterThan(0);
  });

  it('handles multi-output neural net reconstruction and prediction accurately', () => {
    const multiModels = fitMultiOutputNeuralNet(cs.cqas, cs.factors, cs.runs, {
      hiddenNodes1: 1,
      hiddenNodes2: 0,
      activation: 'relu',
      maxEpochs: 30,
      validationMethod: 'none',
      seed: 555,
    });

    expect(Object.keys(multiModels).length).toBe(cs.cqas.length);

    const serialized = serializeModelsForWorker(multiModels);
    const reconstructed = rebuildModels(serialized, cs.factors);

    for (const cqa of cs.cqas) {
      const orig = multiModels[cqa.code];
      const rebuilt = reconstructed[cqa.code];
      expect(rebuilt).toBeDefined();
      expect(typeof rebuilt.predict).toBe('function');

      const sample = { X1: -0.2, X2: 0.8, X3: -0.5 };
      expect(rebuilt.predict(sample)).toBeCloseTo(orig.predict(sample), 8);
    }
  });

  it('supports 2-hidden-layer networks, categorical factors, and edge fallbacks', () => {
    const categoricalFactors: Factor[] = [
      {
        id: 'f1',
        name: 'Solvent',
        code: 'A',
        type: 'Process',
        dataType: 'qualitative',
        categories: ['Ethanol', 'Water', 'Isopropanol'],
        low: -1,
        high: 1,
        unit: '',
        controllability: 'controllable',
      },
      {
        id: 'f2',
        name: 'Temp',
        code: 'B',
        type: 'Process',
        dataType: 'quantitative',
        low: 20,
        high: 80,
        unit: 'C',
        controllability: 'controllable',
      },
    ];

    const cqa: CQA = {
      id: 'c1',
      name: 'Yield',
      code: 'Y1',
      unit: '%',
      lowerLimit: 70,
      upperLimit: 100,
      objective: 'maximize',
      weight: 3,
    };

    // Construct a 2-layer ANN model with categorical input features
    const twoLayerWeights = {
      W1: [
        [0.5, -0.2], // A[Water]
        [-0.3, 0.4], // A[Isopropanol]
        [0.8, 0.1],  // B
      ],
      b1: [0.1, -0.1],
      W2: [
        [0.3, -0.5, 0.2],
        [-0.4, 0.6, -0.1],
      ],
      b2: [0.05, -0.05, 0.1],
      WOut: [[0.7], [-0.8], [0.5]],
      bOut: 0.2,
    };

    const mockModel: any = {
      kind: 'ann',
      cqaCode: cqa.code,
      config: { activation: 'relu' },
      weights: twoLayerWeights,
      inputFactorCodes: ['A[Water]', 'A[Isopropanol]', 'B'],
      normParams: {
        xMeans: [0, 0, 0],
        xSds: [1, 1, 1],
        yMean: 85,
        ySd: 10,
      },
      diagnostics: { rmseVal: 1.2 },
    };

    const predFn = createNeuralPredictor(mockModel, categoricalFactors);
    expect(typeof predFn).toBe('function');

    // Predict with Solvent = Water (A coded = 0 for 3-level [-1, 0, 1])
    const predWater = predFn({ A: 0, B: 0.5 });
    expect(Number.isFinite(predWater)).toBe(true);

    // Predict with Solvent = Ethanol (reference level, A coded = -1)
    const predEthanol = predFn({ A: -1, B: 0.5 });
    expect(Number.isFinite(predEthanol)).toBe(true);
    expect(predWater).not.toBe(predEthanol);

    // Edge case: Empty weights fallback returns yMean
    const emptyModel: any = {
      weights: { W1: [], b1: [] },
      normParams: { yMean: 42, ySd: 5 },
    };
    const emptyPred = createNeuralPredictor(emptyModel);
    expect(emptyPred({ X1: 1 })).toBe(42);
  });
});
