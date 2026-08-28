import { describe, expect, it } from 'vitest';
import type { CQA, DoEDesignConfig, DoERun, Factor } from '../types/qbd';
import {
  generateDoERuns,
  generateFractionalFactorial,
  generateTaguchi,
  validateDesignSetup,
} from './doeGenerator';
import { fitModel } from './statistics';

const factor = (code: string, controllability: Factor['controllability'] = 'controllable'): Factor => ({
  id: code,
  code,
  name: code,
  type: 'Process',
  dataType: 'quantitative',
  controllability,
  unit: '',
  low: 0,
  center: 5,
  high: 10,
  constantValue: controllability === 'constant' ? 5 : undefined,
});

const screeningConfig = (designType: DoEDesignConfig['designType']): DoEDesignConfig => ({
  category: 'Screening',
  designType,
  centerPoints: 0,
  replicates: 1,
  randomized: false,
  blocks: 1,
});

describe('screening design generators', () => {
  it('creates the requested supported Taguchi arrays', () => {
    expect(generateTaguchi(3, 'L4')).toHaveLength(4);
    expect(generateTaguchi(7, 'L8')).toHaveLength(8);
    expect(generateTaguchi(4, 'L9')).toHaveLength(9);
    expect(generateTaguchi(11, 'L12')).toHaveLength(12);
    expect(generateTaguchi(15, 'L16')).toHaveLength(16);
    expect(generateTaguchi(8, 'L8')).toEqual([]);
  });

  it('keeps every two-level Taguchi column balanced and orthogonal', () => {
    const matrix = generateTaguchi(15, 'L16');
    for (let column = 0; column < 15; column++) {
      expect(matrix.reduce((sum, row) => sum + row[column], 0)).toBe(0);
      for (let other = column + 1; other < 15; other++) {
        expect(matrix.reduce((sum, row) => sum + row[column] * row[other], 0)).toBe(0);
      }
    }
  });

  it('does not silently turn a six-factor half fraction into a full factorial', () => {
    const matrix = generateFractionalFactorial(6);
    expect(matrix).toHaveLength(32);
    expect(matrix.every((row) => row.length === 6)).toBe(true);
  });

  it('excludes constant factors from the design matrix and run count', () => {
    const factors = [factor('X1'), factor('X2'), factor('X3', 'constant')];
    const { runs } = generateDoERuns(factors, screeningConfig('FullFactorial2k'));
    expect(runs).toHaveLength(4);
    expect(new Set(runs.map((run) => run.factorActual.X3))).toEqual(new Set([5]));
    expect(new Set(runs.map((run) => run.factorCoded.X3))).toEqual(new Set([0]));
  });

  it('reproduces randomized run order from the persisted seed', () => {
    const config = { ...screeningConfig('FullFactorial2k'), randomized: true, randomizationSeed: 12345 };
    const factors = [factor('X1'), factor('X2'), factor('X3')];
    const first = generateDoERuns(factors, config).runs.map((run) => run.stdOrder);
    const second = generateDoERuns(factors, config).runs.map((run) => run.stdOrder);
    expect(second).toEqual(first);
  });

  it('rejects a Taguchi array with insufficient factor capacity', () => {
    const config = { ...screeningConfig('Taguchi'), taguchiArray: 'L4' as const };
    expect(validateDesignSetup([factor('X1'), factor('X2'), factor('X3'), factor('X4')], config).isValid).toBe(false);
  });
});

describe('fail-closed statistical inference', () => {
  const cqa: CQA = {
    id: 'Y1', code: 'Y1', name: 'Response', unit: '', objective: 'target', weight: 1,
    lowerLimit: 0, target: 5, upperLimit: 10,
  };

  const makeRuns = (blocks = 1): DoERun[] => {
    const points = [-1, 1, -1, 1, 0, 0];
    return points.map((coded, index) => ({
      id: `r${index}`,
      stdOrder: index + 1,
      runOrder: index + 1,
      block: blocks > 1 ? (index % blocks) + 1 : 1,
      factorCoded: { X1: coded },
      factorActual: { X1: 5 + 5 * coded },
      responses: { Y1: 5 + 2 * coded + (index % 2 ? 0.1 : -0.1) },
    }));
  };

  it('does not report unadjusted OLS when execution uses multiple blocks', () => {
    expect(fitModel(cqa, [factor('X1')], makeRuns(2), 'Linear')).toBeNull();
  });

  it('only emits the classical curvature test for corner-plus-center designs', () => {
    const factorial = fitModel(cqa, [factor('X1')], makeRuns(), 'Linear');
    expect(factorial?.curvatureTest).toBeDefined();
    const axialLike = makeRuns().map((run, index) => index === 0
      ? { ...run, factorCoded: { X1: -1.414 }, factorActual: { X1: -2.07 } }
      : run);
    expect(fitModel(cqa, [factor('X1')], axialLike, 'Linear')?.curvatureTest).toBeUndefined();
  });
});
