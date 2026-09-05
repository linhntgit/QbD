import { describe, it, expect } from 'vitest';
import { roundMixtureComponents, generateDoERuns } from './doeGenerator';
import { CASE_STUDIES } from '../data/caseStudies';
import type { Factor, DoEDesignConfig } from '../types/qbd';

describe('roundMixtureComponents algorithm', () => {
  it('correctly eliminates floating point noise for integer-intended components', () => {
    // Exact numbers from the user screenshot
    const input1 = [60, 20, 19.999999999999996];
    const rounded1 = roundMixtureComponents(input1, 100, 2);
    expect(rounded1).toEqual([60, 20, 20]);
    expect(rounded1.reduce((a, b) => a + b, 0)).toBe(100);

    const input2 = [10, 70, 20.000000000000007];
    const rounded2 = roundMixtureComponents(input2, 100, 2);
    expect(rounded2).toEqual([10, 70, 20]);
    expect(rounded2.reduce((a, b) => a + b, 0)).toBe(100);

    const input3 = [30.000000000000004, 20, 50];
    const rounded3 = roundMixtureComponents(input3, 100, 2);
    expect(rounded3).toEqual([30, 20, 50]);
    expect(rounded3.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('guarantees exact 100% total for recurring fractional centroids (e.g. 1/3)', () => {
    const input = [100 / 3, 100 / 3, 100 / 3];
    const rounded = roundMixtureComponents(input, 100, 2);
    expect(rounded).toEqual([33.34, 33.33, 33.33]);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles 0..1 proportion scale with 4 decimals and preserves 1.0 total', () => {
    const input = [1 / 3, 1 / 3, 1 / 3];
    const rounded = roundMixtureComponents(input, 1.0, 4);
    expect(rounded).toEqual([0.3334, 0.3333, 0.3333]);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('generateDoERuns with mixture designs', () => {
  it('generates cleanly rounded mixture components that sum to exactly 100% for Case Study 3', () => {
    const cs = CASE_STUDIES[2];
    const mixFactors = cs.factors.filter((f) => f.role === 'mixture_component');
    expect(mixFactors.length).toBe(3);

    const config: DoEDesignConfig = {
      category: 'Combined_Mixture_Process',
      designType: 'Combined_Mixture_Factorial',
      centerPoints: 0,
      replicates: 1,
      randomized: false,
    };

    const res = generateDoERuns(cs.factors, config);

    expect(res.runs.length).toBeGreaterThan(0);

    res.runs.forEach((run) => {
      const x1 = run.factorActual.X1 as number;
      const x2 = run.factorActual.X2 as number;
      const x3 = run.factorActual.X3 as number;

      // Ensure no long trailing decimals (max 2 decimal places)
      expect(Number(x1.toFixed(2))).toBe(x1);
      expect(Number(x2.toFixed(2))).toBe(x2);
      expect(Number(x3.toFixed(2))).toBe(x3);

      // Ensure exact 100% sum
      const total = x1 + x2 + x3;
      expect(total).toBeCloseTo(100, 6);
      expect(Math.round(total * 100) / 100).toBe(100);
    });
  });

  it('generates cleanly rounded mixture runs for pure Simplex Centroid design', () => {
    const factors: Factor[] = [
      { id: '1', code: 'X1', name: 'A', type: 'Mixture', dataType: 'quantitative', role: 'mixture_component', unit: '%', low: 0, high: 100, controllability: 'controllable' },
      { id: '2', code: 'X2', name: 'B', type: 'Mixture', dataType: 'quantitative', role: 'mixture_component', unit: '%', low: 0, high: 100, controllability: 'controllable' },
      { id: '3', code: 'X3', name: 'C', type: 'Mixture', dataType: 'quantitative', role: 'mixture_component', unit: '%', low: 0, high: 100, controllability: 'controllable' },
    ];

    const config: DoEDesignConfig = {
      category: 'Mixture',
      designType: 'SimplexCentroid',
      centerPoints: 0,
      replicates: 1,
      randomized: false,
    };

    const res = generateDoERuns(factors, config);

    res.runs.forEach((run) => {
      const x1 = run.factorActual.X1 as number;
      const x2 = run.factorActual.X2 as number;
      const x3 = run.factorActual.X3 as number;

      expect(Number(x1.toFixed(2))).toBe(x1);
      expect(Number(x2.toFixed(2))).toBe(x2);
      expect(Number(x3.toFixed(2))).toBe(x3);

      const sum = x1 + x2 + x3;
      expect(sum).toBeCloseTo(100, 6);
    });
  });
});
