import { describe, expect, it } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import type { Factor } from '../types/qbd';
import { sampleDistribution } from './mathUtils';
import { validateProjectSchema } from './projectGovernance';
import { generateFractionalFactorial, calculateAliasStructure } from './doeGenerator';
import { runMonteCarloSimulation } from './statistics';

describe('Phase 4: Zod Formal Schema Validation (SEC-04)', () => {
  it('validates bundled case study projects successfully', () => {
    for (const project of CASE_STUDIES) {
      const result = validateProjectSchema(project);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });

  it('rejects payloads exceeding the 50-factor boundary', () => {
    const base = structuredClone(CASE_STUDIES[0]);
    const excessiveFactors: Factor[] = Array.from({ length: 55 }, (_, i) => ({
      id: `f-${i}`,
      name: `Factor ${i}`,
      code: `X${i + 1}`,
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 10,
      high: 50,
    }));

    const invalidProject = { ...base, factors: excessiveFactors };
    const result = validateProjectSchema(invalidProject);
    expect(result.success).toBe(false);
    expect(result.errors.some((err) => err.includes('50 yếu tố'))).toBe(true);
  });

  it('rejects payloads exceeding the 5,000-run boundary', () => {
    const base = structuredClone(CASE_STUDIES[0]);
    const excessiveRuns = Array.from({ length: 5005 }, (_, i) => ({
      id: `run-${i}`,
      factorCoded: { X1: 0, X2: 0, X3: 0 },
      factorActual: { X1: 20, X2: 30, X3: 40 },
      responses: { Y1: 50 },
    }));

    const invalidProject = { ...base, runs: excessiveRuns };
    const result = validateProjectSchema(invalidProject);
    expect(result.success).toBe(false);
    expect(result.errors.some((err) => err.includes('5.000 lần chạy'))).toBe(true);
  });

  it('rejects payloads missing mandatory identification fields', () => {
    const badPayload = { name: 'No ID Project', factors: [] };
    const result = validateProjectSchema(badPayload);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('Phase 4: Expanded Monte Carlo Random Variate Samplers (STAT-03)', () => {
  it('samples Lognormal distribution strictly positive and adheres to log parameters', () => {
    const mean = 50.0;
    const sd = 10.0;
    const samples: number[] = [];

    for (let i = 0; i < 2000; i++) {
      const val = sampleDistribution('Lognormal', { mean, sd });
      expect(val).toBeGreaterThan(0); // Strictly positive (particle size / impurity)
      samples.push(val);
    }

    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Sample mean should approximate target physical mean within sampling margin
    expect(sampleMean).toBeGreaterThan(45);
    expect(sampleMean).toBeLessThan(55);
  });

  it('samples Uniform distribution strictly within specified bounds', () => {
    const min = 45.0;
    const max = 65.0;
    for (let i = 0; i < 500; i++) {
      const val = sampleDistribution('Uniform', { min, max });
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
    }
  });

  it('samples Triangular distribution within [min, max] with expected mode tendency', () => {
    const min = 10.0;
    const mode = 15.0;
    const max = 30.0;
    const samples: number[] = [];

    for (let i = 0; i < 2000; i++) {
      const val = sampleDistribution('Triangular', { min, mode, max });
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
      samples.push(val);
    }

    // Theoretical mean of Triangular(a, c, b) = (a + b + c) / 3 = (10 + 30 + 15) / 3 = 18.33
    const sampleMean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(sampleMean).toBeGreaterThan(16.5);
    expect(sampleMean).toBeLessThan(20.5);
  });

  it('integrates non-normal distributions seamlessly into runMonteCarloSimulation', () => {
    const cqa: any = {
      id: 'Y1',
      code: 'Y1',
      name: 'Dissolution (%)',
      unit: '%',
      objective: 'target',
      weight: 1,
      lowerLimit: 70,
      target: 80,
      upperLimit: 90,
    };

    const factor1: Factor = {
      id: 'f1',
      code: 'X1',
      name: 'Polymer %',
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '%',
      low: 15,
      high: 35,
      center: 25,
      distribution: 'Lognormal',
      distParams: { mean: 25, sd: 2.5, min: 15, max: 35 },
    };

    const factor2: Factor = {
      id: 'f2',
      code: 'X2',
      name: 'Relative Humidity',
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'uncontrollable_noise',
      unit: '%',
      low: 40,
      high: 70,
      center: 55,
      distribution: 'Uniform',
      distParams: { min: 45, max: 65 },
    };

    const model = {
      predict: (coded: Record<string, number>) => 80 + 5 * (coded.X1 ?? 0) - 2 * (coded.X2 ?? 0),
      diagnostics: { stdDev: 0.5, residuals: [] },
    } as any;

    const setpoint = {
      X1: 25,
      X2: 55,
    };

    const mcResult = runMonteCarloSimulation(
      setpoint,
      [factor1, factor2],
      [cqa],
      { Y1: model },
      2.0,
      1000,
      20260911
    );

    expect(mcResult.simulations).toBe(1000);
    expect(mcResult.reliabilityPercent).toBeGreaterThanOrEqual(0);
    expect(mcResult.reliabilityPercent).toBeLessThanOrEqual(100);
    expect(mcResult.cqaStats.Y1).toBeDefined();
    expect(mcResult.cqaStats.Y1.mean).toBeGreaterThan(70);
    expect(mcResult.cqaStats.Y1.mean).toBeLessThan(90);
  });
});

describe('Phase 4: Montgomery Table 8.14 Resolution IV Fractional Factorials (STAT-04)', () => {
  it('generates a 16-run Resolution IV design for k = 6 (2^(6-2))', () => {
    const matrix = generateFractionalFactorial(6);
    expect(matrix).toHaveLength(16);
    expect(matrix.every((row) => row.length === 6)).toBe(true);

    // Verify all factor columns are balanced (sum of each column is 0)
    for (let col = 0; col < 6; col++) {
      const sum = matrix.reduce((acc, row) => acc + row[col], 0);
      expect(sum).toBe(0);
    }
  });

  it('generates a 16-run Resolution IV design for k = 7 (2^(7-3))', () => {
    const matrix = generateFractionalFactorial(7);
    expect(matrix).toHaveLength(16);
    expect(matrix.every((row) => row.length === 7)).toBe(true);

    // Verify all 7 columns are balanced (+1 and -1 occur 8 times each)
    for (let col = 0; col < 7; col++) {
      const sum = matrix.reduce((acc, row) => acc + row[col], 0);
      expect(sum).toBe(0);
    }
  });

  it('generates a 16-run Resolution IV design for k = 8 (2^(8-4))', () => {
    const matrix = generateFractionalFactorial(8);
    expect(matrix).toHaveLength(16);
    expect(matrix.every((row) => row.length === 8)).toBe(true);

    for (let col = 0; col < 8; col++) {
      const sum = matrix.reduce((acc, row) => acc + row[col], 0);
      expect(sum).toBe(0);
    }
  });
});

describe('Phase 4: Confounding & Alias Structure Matrix (STAT-05)', () => {
  it('correctly classifies a Full Factorial design with no aliasing', () => {
    const factors: Factor[] = [
      { id: '1', code: 'X1', name: 'F1', type: 'CPP', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -1, high: 1 },
      { id: '2', code: 'X2', name: 'F2', type: 'CPP', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -1, high: 1 },
      { id: '3', code: 'X3', name: 'F3', type: 'CPP', dataType: 'quantitative', controllability: 'controllable', unit: '', low: -1, high: 1 },
    ];

    // 8 runs of 2^3 full factorial
    const fullRuns = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
    ].map((coords, i) => ({
      id: `r-${i}`,
      stdOrder: i + 1,
      runOrder: i + 1,
      block: 1,
      factorCoded: { X1: coords[0], X2: coords[1], X3: coords[2] },
      factorActual: { X1: coords[0], X2: coords[1], X3: coords[2] },
      responses: {},
    }));

    const result = calculateAliasStructure(factors, fullRuns);
    expect(result.resolution).toBe('Full');
    expect(result.hasAliasing).toBe(false);
    expect(result.mainEffectAliases).toHaveLength(0);
    expect(result.twoFactorAliases).toHaveLength(0);
  });

  it('detects Resolution IV in a 2^(6-2) design with zero main effect confounding', () => {
    const factorCodes = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
    const factors: Factor[] = factorCodes.map((code, i) => ({
      id: `f-${i}`,
      code,
      name: `Factor ${code}`,
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '',
      low: -1,
      high: 1,
    }));

    const rawMatrix = generateFractionalFactorial(6);
    const runs = rawMatrix.map((row, i) => ({
      id: `r-${i}`,
      stdOrder: i + 1,
      runOrder: i + 1,
      block: 1,
      factorCoded: Object.fromEntries(factorCodes.map((code, idx) => [code, row[idx]])),
      factorActual: Object.fromEntries(factorCodes.map((code, idx) => [code, row[idx]])),
      responses: {},
    }));

    const result = calculateAliasStructure(factors, runs);
    expect(result.resolution).toBe('IV');
    expect(result.hasAliasing).toBe(true);
    // In Resolution IV, NO main effects are aliased with 2FIs
    expect(result.mainEffectAliases).toHaveLength(0);
    // Two-factor interactions ARE aliased with other 2FIs
    expect(result.twoFactorAliases.length).toBeGreaterThan(0);
  });

  it('detects Resolution III when main effects are aliased with 2FIs in a 2^(3-1) half-fraction', () => {
    const factorCodes = ['X1', 'X2', 'X3'];
    const factors: Factor[] = factorCodes.map((code, i) => ({
      id: `f-${i}`,
      code,
      name: `Factor ${code}`,
      type: 'CPP',
      dataType: 'quantitative',
      controllability: 'controllable',
      unit: '',
      low: -1,
      high: 1,
    }));

    // 2^(3-1) = 4 runs: X3 = X1*X2
    const rawMatrix = generateFractionalFactorial(3);
    const runs = rawMatrix.map((row, i) => ({
      id: `r-${i}`,
      stdOrder: i + 1,
      runOrder: i + 1,
      block: 1,
      factorCoded: Object.fromEntries(factorCodes.map((code, idx) => [code, row[idx]])),
      factorActual: Object.fromEntries(factorCodes.map((code, idx) => [code, row[idx]])),
      responses: {},
    }));

    const result = calculateAliasStructure(factors, runs);
    expect(result.resolution).toBe('III');
    expect(result.hasAliasing).toBe(true);
    // In Resolution III, main effects ARE aliased with 2FIs
    expect(result.mainEffectAliases.length).toBeGreaterThan(0);
  });
});
