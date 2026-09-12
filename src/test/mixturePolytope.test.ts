import { describe, expect, it } from 'vitest';
import type { Factor } from '../types/qbd';
import { calculateEffectiveMixtureBounds } from '../services/mathUtils';
import {
  validatePiepelBounds,
  isFeasibleBoundedMixture,
  projectToBoundedMixture,
} from '../services/statistics';
import { generateConstrainedMixtureDesign } from '../services/doeGenerator';

describe('Mixture Polyhedral Bound Constraints (Piepel 1983 & McLean-Anderson)', () => {
  describe('Piepel (1983) Effective Bounds Calculation & Consistency', () => {
    it('should compute exact effective bounds for classic Piepel (1983) 3-component system', () => {
      // Classic 3-component formulation:
      // X1 in [0.10, 0.60]
      // X2 in [0.05, 0.50]
      // X3 in [0.20, 0.70]
      // Sum L = 0.35 <= 1.0, Sum U = 1.80 >= 1.0
      //
      // Effective L1* = max(0.10, 1 - (0.50 + 0.70)) = max(0.10, -0.20) = 0.10
      // Effective U1* = min(0.60, 1 - (0.05 + 0.20)) = min(0.60, 0.75) = 0.60
      // Effective L2* = max(0.05, 1 - (0.60 + 0.70)) = max(0.05, -0.30) = 0.05
      // Effective U2* = min(0.50, 1 - (0.10 + 0.20)) = min(0.50, 0.70) = 0.50
      // Effective L3* = max(0.20, 1 - (0.60 + 0.50)) = max(0.20, -0.10) = 0.20
      // Effective U3* = min(0.70, 1 - (0.10 + 0.05)) = min(0.70, 0.85) = 0.70

      const lows = [0.10, 0.05, 0.20];
      const highs = [0.60, 0.50, 0.70];

      const piepel = validatePiepelBounds(lows, highs, 1.0);

      expect(piepel.isFeasible).toBe(true);
      expect(piepel.effectiveLow[0]).toBeCloseTo(0.10, 4);
      expect(piepel.effectiveHigh[0]).toBeCloseTo(0.60, 4);
      expect(piepel.effectiveLow[1]).toBeCloseTo(0.05, 4);
      expect(piepel.effectiveHigh[1]).toBeCloseTo(0.50, 4);
      expect(piepel.effectiveLow[2]).toBeCloseTo(0.20, 4);
      expect(piepel.effectiveHigh[2]).toBeCloseTo(0.70, 4);
    });

    it('should identify unreachable upper bounds and tighten effective bounds', () => {
      // 3 components:
      // X1 in [0.40, 0.90]
      // X2 in [0.30, 0.80]
      // X3 in [0.20, 0.70]
      // Sum L = 0.90 <= 1.0
      //
      // For X1: other lows sum to 0.30 + 0.20 = 0.50
      // Max possible X1 = 1 - 0.50 = 0.50.
      // Even though user specified U1 = 0.90, X1 can NEVER exceed 0.50!
      // Effective U1* = 0.50!
      //
      // For X2: other lows sum to 0.40 + 0.20 = 0.60 -> U2* = 1 - 0.60 = 0.40!
      // For X3: other lows sum to 0.40 + 0.30 = 0.70 -> U3* = 1 - 0.70 = 0.30!

      const lows = [0.40, 0.30, 0.20];
      const highs = [0.90, 0.80, 0.70];

      const piepel = validatePiepelBounds(lows, highs, 1.0);

      expect(piepel.isFeasible).toBe(true);
      expect(piepel.effectiveHigh[0]).toBeCloseTo(0.50, 4);
      expect(piepel.effectiveHigh[1]).toBeCloseTo(0.40, 4);
      expect(piepel.effectiveHigh[2]).toBeCloseTo(0.30, 4);
      expect(piepel.unreachableUpperIndices).toContain(0);
      expect(piepel.unreachableUpperIndices).toContain(1);
      expect(piepel.unreachableUpperIndices).toContain(2);
    });

    it('should identify unreachable lower bounds and raise effective lower bounds', () => {
      // 3 components:
      // X1 in [0.05, 0.30]
      // X2 in [0.05, 0.30]
      // X3 in [0.10, 0.80]
      //
      // For X3: other highs sum to 0.30 + 0.30 = 0.60
      // Min possible X3 = 1 - 0.60 = 0.40.
      // Even though user specified L3 = 0.10, X3 can NEVER be less than 0.40!
      // Effective L3* = 0.40!

      const lows = [0.05, 0.05, 0.10];
      const highs = [0.30, 0.30, 0.80];

      const piepel = validatePiepelBounds(lows, highs, 1.0);

      expect(piepel.isFeasible).toBe(true);
      expect(piepel.effectiveLow[2]).toBeCloseTo(0.40, 4);
      expect(piepel.unreachableLowerIndices).toContain(2);
    });

    it('should detect inconsistent/infeasible mixtures where L_i* > U_i*', () => {
      // Infeasible configuration:
      // X1 in [0.40, 0.50]
      // X2 in [0.40, 0.50]
      // X3 in [0.30, 0.40]
      // Sum L = 0.40 + 0.40 + 0.30 = 1.10 > 1.0!
      // Impossible to sum to 1.0!

      const lows = [0.40, 0.40, 0.30];
      const highs = [0.50, 0.50, 0.40];

      const piepel = validatePiepelBounds(lows, highs, 1.0);
      expect(piepel.isFeasible).toBe(false);
      expect(isFeasibleBoundedMixture(lows, highs, 1.0)).toBe(false);

      // Another subtle infeasibility case: Sum L <= 1 and Sum U >= 1, but L_i* > U_i*
      // Let X1 in [0.10, 0.20], X2 in [0.10, 0.20], X3 in [0.70, 0.75]
      // Sum L = 0.10 + 0.10 + 0.70 = 0.90 <= 1.0
      // Sum U = 0.20 + 0.20 + 0.75 = 1.15 >= 1.0
      // But:
      // For X3: other highs = 0.20 + 0.20 = 0.40 -> L3* = 1 - 0.40 = 0.60 <= 0.70 (OK)
      // other lows = 0.10 + 0.10 = 0.20 -> U3* = 1 - 0.20 = 0.80 >= 0.75 (OK)
      // For X1: other highs = 0.20 + 0.75 = 0.95 -> L1* = max(0.10, 1 - 0.95) = 0.10
      // other lows = 0.10 + 0.70 = 0.80 -> U1* = min(0.20, 1 - 0.80) = 0.20 (OK)
      // Now if X3 in [0.70, 0.75], X1 in [0.15, 0.20], X2 in [0.15, 0.20]:
      // Sum L = 0.15 + 0.15 + 0.70 = 1.00 (singleton point: 0.15, 0.15, 0.70)
      // If we change X3 high to 0.65:
      // X1 in [0.10, 0.20], X2 in [0.10, 0.20], X3 in [0.10, 0.50]
      // Sum U = 0.20 + 0.20 + 0.50 = 0.90 < 1.0!
      const piepel2 = validatePiepelBounds([0.1, 0.1, 0.1], [0.2, 0.2, 0.5], 1.0);
      expect(piepel2.isFeasible).toBe(false);
      expect(isFeasibleBoundedMixture([0.1, 0.1, 0.1], [0.2, 0.2, 0.5], 1.0)).toBe(false);
    });

    it('should test calculateEffectiveMixtureBounds with Factor objects in percentage format', () => {
      const components: Factor[] = [
        { id: '1', code: 'A', name: 'Binder', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 10, high: 40 },
        { id: '2', code: 'B', name: 'Filler', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 30, high: 70 },
        { id: '3', code: 'C', name: 'Disintegrant', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 5, high: 20 },
      ];

      const res = calculateEffectiveMixtureBounds(components);
      expect(res.isConsistent).toBe(true);
      expect(res.effectiveBounds.length).toBe(3);

      // Total = 100%
      // A effective bounds:
      // other high = 70 + 20 = 90 -> L_A* = max(10, 100 - 90) = 10
      // other low = 30 + 5 = 35 -> U_A* = min(40, 100 - 35) = 40
      expect(res.effectiveBounds[0].min).toBeCloseTo(10, 2);
      expect(res.effectiveBounds[0].max).toBeCloseTo(40, 2);
    });
  });

  describe('Euclidean Simplex Projection (projectToBoundedMixture)', () => {
    const lows = [0.20, 0.20, 0.10];
    const highs = [0.60, 0.50, 0.30];

    it('should leave an interior feasible point untouched', () => {
      const point = [0.40, 0.40, 0.20]; // sums to 1.0 and within [L, U]
      const proj = projectToBoundedMixture(point, lows, highs, 1.0);

      expect(proj[0]).toBeCloseTo(0.40, 4);
      expect(proj[1]).toBeCloseTo(0.40, 4);
      expect(proj[2]).toBeCloseTo(0.20, 4);
    });

    it('should project an unconstrained or infeasible point onto the bounded simplex', () => {
      // Point heavily outside simplex: negative or summing to 2.5
      const arbitraryPoints = [
        [1.0, 1.0, 0.5],
        [0.0, 0.0, 0.0],
        [-0.5, 0.8, 1.2],
        [0.7, 0.1, 0.4],
      ];

      arbitraryPoints.forEach((raw) => {
        const proj = projectToBoundedMixture(raw, lows, highs, 1.0);

        // Sum must be 1.0
        const sum = proj.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 4);

        // Bounds must be satisfied
        expect(proj[0]).toBeGreaterThanOrEqual(lows[0] - 1e-4);
        expect(proj[0]).toBeLessThanOrEqual(highs[0] + 1e-4);
        expect(proj[1]).toBeGreaterThanOrEqual(lows[1] - 1e-4);
        expect(proj[1]).toBeLessThanOrEqual(highs[1] + 1e-4);
        expect(proj[2]).toBeGreaterThanOrEqual(lows[2] - 1e-4);
        expect(proj[2]).toBeLessThanOrEqual(highs[2] + 1e-4);
      });
    });

    it('should project points in percentage space (total = 100)', () => {
      const pctLows = [20, 20, 10];
      const pctHighs = [60, 50, 30];
      const raw = [50, 50, 50]; // sum = 150

      const proj = projectToBoundedMixture(raw, pctLows, pctHighs, 100);
      const sum = proj.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(100, 3);
      expect(proj[0]).toBeGreaterThanOrEqual(20 - 1e-3);
      expect(proj[0]).toBeLessThanOrEqual(60 + 1e-3);
      expect(proj[1]).toBeGreaterThanOrEqual(20 - 1e-3);
      expect(proj[1]).toBeLessThanOrEqual(50 + 1e-3);
      expect(proj[2]).toBeGreaterThanOrEqual(10 - 1e-3);
      expect(proj[2]).toBeLessThanOrEqual(30 + 1e-3);
    });
  });

  describe('McLean-Anderson / XVERT Extreme Vertices Generation', () => {
    it('should generate extreme vertices and centroids for bounded mixture', () => {
      const factors: Factor[] = [
        { id: '1', code: 'X1', name: 'API', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: 'fraction', low: 0.10, high: 0.40 },
        { id: '2', code: 'X2', name: 'Polymer', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: 'fraction', low: 0.30, high: 0.60 },
        { id: '3', code: 'X3', name: 'Solvent', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: 'fraction', low: 0.20, high: 0.50 },
      ];

      const designMatrix = generateConstrainedMixtureDesign(factors, 'ExtremeVertices');

      expect(designMatrix.length).toBeGreaterThan(0);

      // Verify every generated run:
      // 1. Sums to 1.0
      // 2. Obeys the factor limits [L_i, U_i]
      designMatrix.forEach((run) => {
        const sum = run.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 4);

        expect(run[0]).toBeGreaterThanOrEqual(factors[0].low - 1e-4);
        expect(run[0]).toBeLessThanOrEqual(factors[0].high + 1e-4);
        expect(run[1]).toBeGreaterThanOrEqual(factors[1].low - 1e-4);
        expect(run[1]).toBeLessThanOrEqual(factors[1].high + 1e-4);
        expect(run[2]).toBeGreaterThanOrEqual(factors[2].low - 1e-4);
        expect(run[2]).toBeLessThanOrEqual(factors[2].high + 1e-4);
      });
    });

    it('should return empty array if bounds are mathematically impossible', () => {
      const impossibleFactors: Factor[] = [
        { id: '1', code: 'X1', name: 'A', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: 'fraction', low: 0.60, high: 0.80 },
        { id: '2', code: 'X2', name: 'B', type: 'Mixture', role: 'mixture_component', dataType: 'quantitative', controllability: 'controllable', unit: 'fraction', low: 0.50, high: 0.70 },
      ];

      const designMatrix = generateConstrainedMixtureDesign(impossibleFactors, 'ExtremeVertices');
      expect(designMatrix.length).toBe(0);
    });
  });
});
