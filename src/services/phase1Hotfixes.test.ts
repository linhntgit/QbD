import { describe, it, expect } from 'vitest';
import { generateCandidatePool } from './doeGenerator';
import { calculateIndividualDesirability, matMul, matTranspose } from './mathUtils';
import { sanitizeCSVField } from './doeExcelService';
import type { Factor } from '../types/qbd';

function createContinuousFactor(code: string): Factor {
  return {
    id: `factor-${code}`,
    name: `Factor ${code}`,
    code,
    low: 10,
    high: 50,
    unit: 'mg',
    type: 'CPP',
    dataType: 'quantitative',
    controllability: 'controllable',
  };
}

describe('Phase 1 Hotfixes Verification', () => {
  describe('ARCH-01: Candidate pool memory scaling', () => {
    it('uses 5 levels for k <= 4 factors (small space fine exploration)', () => {
      const factors: Factor[] = ['A', 'B', 'C', 'D'].map(createContinuousFactor);
      const pool = generateCandidatePool(factors);
      expect(pool.length).toBe(5 ** 4); // 625 points
    });

    it('throttles to 3 levels for k = 5 to 6 factors to prevent OOM explosion', () => {
      const factors5: Factor[] = ['A', 'B', 'C', 'D', 'E'].map(createContinuousFactor);
      const pool5 = generateCandidatePool(factors5);
      expect(pool5.length).toBe(3 ** 5); // 243 points (instead of 3,125)

      const factors6: Factor[] = ['A', 'B', 'C', 'D', 'E', 'F'].map(createContinuousFactor);
      const pool6 = generateCandidatePool(factors6);
      expect(pool6.length).toBe(3 ** 6); // 729 points (instead of 15,625)
    });

    it('throttles to 2 levels for k >= 7 factors (e.g. 8 screening factors)', () => {
      const factors8: Factor[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(createContinuousFactor);
      const pool8 = generateCandidatePool(factors8);
      expect(pool8.length).toBe(2 ** 8); // 256 points (instead of 390,625)
      expect(pool8[0].length).toBe(8);
    });
  });

  describe('STAT-02: Target desirability with negative or zero targets', () => {
    it('accurately evaluates desirability for negative targets (e.g. Zeta potential = -25 mV)', () => {
      // Target -25 with default bounds (target +/- 2.5 => [-27.5, -22.5])
      const dAtTarget = calculateIndividualDesirability(-25, 'target', undefined, undefined, -25);
      expect(dAtTarget).toBeCloseTo(1.0, 4);

      const dNearTargetLow = calculateIndividualDesirability(-26, 'target', undefined, undefined, -25);
      expect(dNearTargetLow).toBeGreaterThan(0.0);
      expect(dNearTargetLow).toBeLessThan(1.0);

      const dNearTargetHigh = calculateIndividualDesirability(-24, 'target', undefined, undefined, -25);
      expect(dNearTargetHigh).toBeGreaterThan(0.0);
      expect(dNearTargetHigh).toBeLessThan(1.0);

      const dOutside = calculateIndividualDesirability(-35, 'target', undefined, undefined, -25);
      expect(dOutside).toBe(0.0);
    });

    it('accurately evaluates desirability with explicit negative limits', () => {
      // Target = -20, lowLimit = -30, highLimit = -10
      const dTarget = calculateIndividualDesirability(-20, 'target', -30, -10, -20);
      expect(dTarget).toBeCloseTo(1.0, 4);

      const dMid = calculateIndividualDesirability(-25, 'target', -30, -10, -20);
      expect(dMid).toBeCloseTo(0.5, 2);

      const dOutLow = calculateIndividualDesirability(-32, 'target', -30, -10, -20);
      expect(dOutLow).toBe(0.0);
    });

    it('handles zero target without collapsing bounds (T = 0)', () => {
      const dZero = calculateIndividualDesirability(0, 'target', undefined, undefined, 0);
      expect(dZero).toBeCloseTo(1.0, 4);

      const dNear = calculateIndividualDesirability(0.5, 'target', undefined, undefined, 0);
      expect(dNear).toBeGreaterThan(0.0);
      expect(dNear).toBeLessThan(1.0);

      const dFar = calculateIndividualDesirability(3.0, 'target', undefined, undefined, 0);
      expect(dFar).toBe(0.0);
    });
  });

  describe('SEC-03: CSV Formula Injection (DDE) sanitization', () => {
    it('prepends single quote to formula triggers', () => {
      expect(sanitizeCSVField('=SUM(A1:B10)')).toBe("'=SUM(A1:B10)");
      expect(sanitizeCSVField('@HYPERLINK("http://evil.com")')).toBe("'@HYPERLINK(\"http://evil.com\")");
      expect(sanitizeCSVField('+cmd|/C calc')).toBe("'+cmd|/C calc");
      expect(sanitizeCSVField('-cmd|/C calc')).toBe("'-cmd|/C calc");
      expect(sanitizeCSVField('\t=1+1')).toBe("'\t=1+1");
    });

    it('preserves valid numeric literals (positive and negative numbers)', () => {
      expect(sanitizeCSVField(-25.5)).toBe('-25.5');
      expect(sanitizeCSVField(100)).toBe('100');
      expect(sanitizeCSVField('-12.34')).toBe('-12.34');
      expect(sanitizeCSVField('+5.6')).toBe('+5.6');
      expect(sanitizeCSVField('0')).toBe('0');
    });

    it('preserves normal text and handles null/undefined', () => {
      expect(sanitizeCSVField('Formulation Run #1')).toBe('Formulation Run #1');
      expect(sanitizeCSVField(null)).toBe('');
      expect(sanitizeCSVField(undefined)).toBe('');
    });
  });

  describe('ARCH-16: Empty matrix guards', () => {
    it('returns empty array on empty inputs without throwing errors', () => {
      expect(matMul([], [])).toEqual([]);
      expect(matMul([[1, 2]], [])).toEqual([]);
      expect(matMul([], [[1, 2]])).toEqual([]);
      expect(matMul([[]], [[1, 2]])).toEqual([]);

      expect(matTranspose([])).toEqual([]);
      expect(matTranspose([[]])).toEqual([]);
    });

    it('computes correctly for valid non-empty matrices', () => {
      const A = [
        [1, 2],
        [3, 4],
      ];
      const B = [
        [2, 0],
        [1, 2],
      ];
      expect(matMul(A, B)).toEqual([
        [4, 4],
        [10, 8],
      ]);
      expect(matTranspose(A)).toEqual([
        [1, 3],
        [2, 4],
      ]);
    });
  });
});
