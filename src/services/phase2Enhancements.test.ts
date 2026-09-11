import { describe, it, expect, vi, afterEach } from 'vitest';
import { jacobiEigenvalues } from './mathUtils';
import { calculateRSMCanonicalAnalysis, runMonteCarloSimulation, runMonteCarloSimulationAsync } from './statistics';
import { fitNeuralNetModel } from './neuralNetwork';
import { recordProjectVersion, getProjectHistory, pruneProjectForHistory } from './projectGovernance';
import type { Factor, CQA, DoERun, QBDProject, RegressionTerm, NeuralNetConfig } from '../types/qbd';

describe('Phase 2: Jacobi Eigenvalue Decomposition (mathUtils)', () => {
  it('correctly solves eigenvalues and eigenvectors of a 2x2 symmetric matrix', () => {
    // Matrix: [[2, 1], [1, 2]] -> eigenvalues should be 3 and 1
    const A = [
      [2, 1],
      [1, 2],
    ];
    const { eigenvalues, eigenvectors } = jacobiEigenvalues(A);

    expect(eigenvalues.length).toBe(2);
    const sorted = [...eigenvalues].sort((a, b) => b - a);
    expect(sorted[0]).toBeCloseTo(3, 4);
    expect(sorted[1]).toBeCloseTo(1, 4);

    // Eigenvectors should be orthonormal: v1 . v2 = 0
    const dotProduct = eigenvectors[0][0] * eigenvectors[0][1] + eigenvectors[1][0] * eigenvectors[1][1];
    expect(dotProduct).toBeCloseTo(0, 4);
  });

  it('handles already diagonal matrices without alteration', () => {
    const D = [
      [5, 0, 0],
      [0, -3, 0],
      [0, 0, 2],
    ];
    const { eigenvalues } = jacobiEigenvalues(D);
    const sorted = [...eigenvalues].sort((a, b) => b - a);
    expect(sorted[0]).toBeCloseTo(5, 4);
    expect(sorted[1]).toBeCloseTo(2, 4);
    expect(sorted[2]).toBeCloseTo(-3, 4);
  });
});

describe('Phase 2: RSM Canonical Analysis (STAT-01)', () => {
  const factors: Factor[] = [
    { id: 'f1', code: 'X1', name: 'Temperature', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '°C', low: 50, high: 90, center: 70 },
    { id: 'f2', code: 'X2', name: 'Pressure', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'bar', low: 1, high: 5, center: 3 },
  ];

  it('correctly classifies a Maximum surface with stationary point inside design space', () => {
    // Model: y = 80 + 0.4*X1 - 0.6*X2 - 2.0*X1^2 - 1.5*X2^2 + 0.2*X1*X2
    // Linear a = [0.4, -0.6]
    // B = [[-2.0, 0.1], [0.1, -1.5]] (both eigenvalues negative -> Maximum)
    const terms: RegressionTerm[] = [
      { name: 'Intercept', factorCodes: [], power: [], coefficient: 80, stdError: 0.1, tValue: 800, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X1', factorCodes: ['X1'], power: [1, 0], coefficient: 0.4, stdError: 0.1, tValue: 4, pValue: 0.01, vif: 1, significant: true },
      { name: 'X2', factorCodes: ['X2'], power: [0, 1], coefficient: -0.6, stdError: 0.1, tValue: -6, pValue: 0.001, vif: 1, significant: true },
      { name: 'X1*X2', factorCodes: ['X1', 'X2'], power: [1, 1], coefficient: 0.2, stdError: 0.1, tValue: 2, pValue: 0.05, vif: 1, significant: true },
      { name: 'X1²', factorCodes: ['X1'], power: [2, 0], coefficient: -2.0, stdError: 0.1, tValue: -20, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X2²', factorCodes: ['X2'], power: [0, 2], coefficient: -1.5, stdError: 0.1, tValue: -15, pValue: 0.0001, vif: 1, significant: true },
    ];

    const result = calculateRSMCanonicalAnalysis(terms, factors);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.surfaceNature).toBe('maximum');
    expect(result.isInsideDesignSpace).toBe(true);
    expect(result.eigenvalues.every((l) => l < 0)).toBe(true);
    expect(result.predictedAtStationaryPoint).toBeGreaterThan(80);
    expect(result.canonicalEquation).toContain('w1²');
  });

  it('correctly classifies a Saddle Point with mixed eigenvalues', () => {
    // Model: y = 50 + 1.0*X1 + 1.0*X2 + 2.0*X1^2 - 2.0*X2^2
    const terms: RegressionTerm[] = [
      { name: 'Intercept', factorCodes: [], power: [], coefficient: 50, stdError: 0.1, tValue: 500, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X1', factorCodes: ['X1'], power: [1, 0], coefficient: 1.0, stdError: 0.1, tValue: 10, pValue: 0.001, vif: 1, significant: true },
      { name: 'X2', factorCodes: ['X2'], power: [0, 1], coefficient: 1.0, stdError: 0.1, tValue: 10, pValue: 0.001, vif: 1, significant: true },
      { name: 'X1²', factorCodes: ['X1'], power: [2, 0], coefficient: 2.0, stdError: 0.1, tValue: 20, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X2²', factorCodes: ['X2'], power: [0, 2], coefficient: -2.0, stdError: 0.1, tValue: -20, pValue: 0.0001, vif: 1, significant: true },
    ];

    const result = calculateRSMCanonicalAnalysis(terms, factors);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.surfaceNature).toBe('saddle');
    const hasPos = result.eigenvalues.some((l) => l > 0);
    const hasNeg = result.eigenvalues.some((l) => l < 0);
    expect(hasPos && hasNeg).toBe(true);
  });

  it('flags stationary points that fall outside the experimental design space', () => {
    // Model with extreme slope driving stationary point far outside [-1, 1]
    const terms: RegressionTerm[] = [
      { name: 'Intercept', factorCodes: [], power: [], coefficient: 10, stdError: 0.1, tValue: 100, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X1', factorCodes: ['X1'], power: [1, 0], coefficient: 50.0, stdError: 0.1, tValue: 500, pValue: 0.0001, vif: 1, significant: true },
      { name: 'X1²', factorCodes: ['X1'], power: [2, 0], coefficient: -1.0, stdError: 0.1, tValue: -10, pValue: 0.0001, vif: 1, significant: true },
    ];

    const result = calculateRSMCanonicalAnalysis(terms, [factors[0]]);
    expect(result).not.toBeNull();
    if (!result) return;

    // x0 = -0.5 * (-1)^(-1) * 50 = 25 >> 1
    expect(result.isInsideDesignSpace).toBe(false);
    expect(Math.abs(result.stationaryPointCoded['X1'])).toBeGreaterThan(1);
  });
});

describe('Phase 2: Monte Carlo Simulation & Ppk Metric (STAT-08 & PERF-01)', () => {
  const factor1: Factor = { id: 'f1', code: 'X1', name: 'Temp', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '°C', low: 50, high: 90, center: 70 };
  const cqa1: CQA = { id: 'c1', code: 'Y1', name: 'Yield', unit: '%', target: 85, lowerLimit: 75, upperLimit: 95, objective: 'maximize', weight: 1 };
  const models = {
    Y1: {
      cqaCode: 'Y1',
      modelType: 'Linear' as const,
      terms: [
        { name: 'Intercept', factorCodes: [], power: [], coefficient: 85, stdError: 0.1, tValue: 850, pValue: 0.0001, vif: 1, significant: true },
        { name: 'X1', factorCodes: ['X1'], power: [1, 0], coefficient: 5, stdError: 0.1, tValue: 50, pValue: 0.0001, vif: 1, significant: true },
      ],
      anova: [],
      diagnostics: {
        rSquared: 0.95,
        adjRSquared: 0.94,
        predRSquared: 0.92,
        adeqPrecision: 20,
        press: 10,
        stdDev: 0.8,
        mean: 85,
        cvPercent: 0.94,
        residuals: [],
      },
      equationString: 'Y1 = 85 + 5*X1',
      predict: (coded: Record<string, number>) => 85 + 5 * (coded.X1 ?? 0),
    },
  };

  it('computes Ppk alongside Cpk in Monte Carlo simulation', () => {
    const result = runMonteCarloSimulation(
      { X1: 70 },
      [factor1],
      [cqa1],
      models,
      2.0,
      1000,
      42
    );

    expect(result.cqaStats['Y1']).toBeDefined();
    expect(result.cqaStats['Y1'].ppk).toBeDefined();
    expect(result.cqaStats['Y1'].cpk).toBeDefined();
    expect(typeof result.cqaStats['Y1'].ppk).toBe('number');
    expect(result.cqaStats['Y1'].ppk).toBeGreaterThan(0);
  });

  it('runs async Monte Carlo non-blockingly and delivers identical results with progress callback', async () => {
    const progressUpdates: number[] = [];
    const asyncResult = await runMonteCarloSimulationAsync(
      { X1: 70 },
      [factor1],
      [cqa1],
      models,
      2.0,
      2000,
      42,
      (pct) => progressUpdates.push(pct)
    );

    const syncResult = runMonteCarloSimulation(
      { X1: 70 },
      [factor1],
      [cqa1],
      models,
      2.0,
      2000,
      42
    );

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

    expect(asyncResult.passCount).toBe(syncResult.passCount);
    expect(asyncResult.failCount).toBe(syncResult.failCount);
    expect(asyncResult.cqaStats['Y1'].mean).toBe(syncResult.cqaStats['Y1'].mean);
    expect(asyncResult.cqaStats['Y1'].ppk).toBe(syncResult.cqaStats['Y1'].ppk);
  });
});

describe('Phase 2: ANN Early Stopping (STAT-07)', () => {
  const factor1: Factor = { id: 'f1', code: 'X1', name: 'Temp', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: '°C', low: 50, high: 90, center: 70 };
  const cqa1: CQA = { id: 'c1', code: 'Y1', name: 'Yield', unit: '%', target: 85, lowerLimit: 75, upperLimit: 95, objective: 'maximize', weight: 1 };
  
  const runs: DoERun[] = Array.from({ length: 30 }, (_, i) => {
    const x = -1 + (2 * i) / 29;
    return {
      id: `run-${i}`,
      stdOrder: i + 1,
      runOrder: i + 1,
      block: 1,
      factorCoded: { X1: x },
      factorActual: { X1: 70 + 20 * x },
      responses: { Y1: 80 + 10 * Math.sin(x * 3) },
    };
  });

  it('stops early when validation loss fails to improve within patience limit', () => {
    const config: NeuralNetConfig = {
      hiddenNodes1: 4,
      hiddenNodes2: 0,
      activation: 'tanh',
      weightDecay: 0.01,
      learningRate: 0.05,
      maxEpochs: 500,
      validationMethod: 'holdout',
      holdoutRatio: 0.25,
      kFolds: 5,
      numTours: 1,
      seed: 42,
      earlyStopping: true,
      patience: 10,
    };

    const model = fitNeuralNetModel(cqa1, [factor1], runs, config);
    expect(model).not.toBeNull();
    if (!model) return;

    const maxRecordedEpoch = Math.max(...model.diagnostics.lossHistory.map((h) => h.epoch));
    expect(maxRecordedEpoch).toBeLessThan(500);
  });
});

describe('Phase 2: LocalStorage Quota Protection (PERF-06 & SEC-02)', () => {
  const dummyProject: QBDProject = {
    id: 'test-proj-p2',
    name: 'Test Project',
    moleculeName: 'API-001',
    dosageForm: 'Tablet',
    author: 'Tester',
    version: '1.0',
    createdDate: '2026-09-11',
    updatedDate: '2026-09-11',
    description: 'Test',
    qtpp: [],
    cqas: [],
    factors: [],
    fmeaRisks: [],
    doeConfig: { category: 'Screening', designType: 'FullFactorial2k', centerPoints: 3, replicates: 1, randomized: true },
    runs: [],
    designSpace: [],
    analysisSettings: {
      modelingEngine: 'polynomial',
      modelTypes: {},
      neuralTrainingMode: 'independent',
      sharedNeuralConfig: {} as any,
      neuralConfigs: {},
      neuralArtifacts: {
        version: 1,
        fingerprint: 'dummy-fingerprint',
        models: {
          Y1: {
            cqaCode: 'Y1',
            inputFactorCodes: ['X1'],
            normParams: { xMeans: [0], xSds: [1], yMean: 80, ySd: 10 },
            weights: { W1: [[1, 2, 3]], b1: [0, 0, 0], WOut: [[1], [1], [1]], bOut: 0 },
            diagnostics: {} as any,
            config: {} as any,
            formulaString: '',
            pythonCode: '',
            excelFormula: '',
          },
        },
      },
    },
  };

  afterEach(() => vi.unstubAllGlobals());

  function mockStorage(values: Record<string, string> = {}) {
    const storage = {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value; },
      removeItem: (key: string) => { delete values[key]; },
      clear: () => { Object.keys(values).forEach((k) => delete values[k]); },
    };
    vi.stubGlobal('window', { localStorage: storage });
    return storage;
  }

  it('strips heavy neuralArtifacts when saving snapshots to localStorage', () => {
    mockStorage();
    recordProjectVersion(dummyProject, 'Test Snapshot');
    const history = getProjectHistory('test-proj-p2');

    expect(history.length).toBe(1);
    const savedSnapshot = history[0];
    expect(savedSnapshot.project.analysisSettings?.neuralArtifacts).toBeUndefined();
    expect(pruneProjectForHistory(dummyProject).analysisSettings?.neuralArtifacts).toBeUndefined();
  });

  it('caps history snapshots to a maximum of 10 items', () => {
    mockStorage();
    for (let i = 1; i <= 15; i++) {
      recordProjectVersion(dummyProject, `Snapshot ${i}`);
    }

    const history = getProjectHistory('test-proj-p2');
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history[0].action).toBe('Snapshot 15');
  });
});
