import { describe, expect, it } from 'vitest';
import type { Factor } from '../types/qbd';
import { actualToCoded, codedToActual, getConfiguredFactorCodes } from './doeGenerator';

const makeFactor = (overrides: Partial<Factor>): Factor => ({
  id: 'factor-level-test',
  name: 'Test factor',
  code: 'X1',
  type: 'CPP',
  dataType: 'qualitative',
  controllability: 'controllable',
  role: 'process_parameter',
  unit: '',
  low: 0,
  high: 1,
  center: 0.5,
  ...overrides,
});

describe('configured factor levels', () => {
  it('codes every qualitative level evenly instead of collapsing to three values', () => {
    const factor = makeFactor({ categories: ['A', 'B', 'C', 'D', 'E'] });

    expect(getConfiguredFactorCodes(factor)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(codedToActual(0.5, factor)).toBe('D');
    expect(actualToCoded('B', factor)).toBe(-0.5);
  });

  it('keeps discrete numeric levels numeric in the generated run table', () => {
    const factor = makeFactor({
      dataType: 'quantitative_multilevel',
      categories: ['10', '25', '40', '80'],
      low: 10,
      high: 80,
      center: 40,
    });

    expect(getConfiguredFactorCodes(factor)).toEqual([-1, -0.3333, 0.3333, 1]);
    expect(codedToActual(0.3333, factor)).toBe(40);
    expect(actualToCoded(25, factor)).toBe(-0.3333);
  });

  it('uses at most the first ten configured levels', () => {
    const factor = makeFactor({ categories: Array.from({ length: 12 }, (_, index) => `L${index + 1}`) });

    expect(getConfiguredFactorCodes(factor)).toHaveLength(10);
    expect(codedToActual(1, factor)).toBe('L10');
  });
});
