import { describe, expect, it } from 'vitest';
import { getEvenContourSettings, generateTernaryDesignSpace } from './ternaryContour';
import type { Factor, CQA, StatisticalModelResult } from '../types/qbd';

describe('contour level spacing', () => {
  it('uses an explicit equal response-value interval', () => {
    expect(getEvenContourSettings(10, 30, 6)).toEqual({ start: 10, end: 30, size: 4 });
  });

  it('does not request contours for a flat or invalid response surface', () => {
    expect(getEvenContourSettings(12, 12, 8)).toBeUndefined();
    expect(getEvenContourSettings(Number.NaN, 12, 8)).toBeUndefined();
  });
});

describe('generateTernaryDesignSpace probabilistic 4-sigma boundary', () => {
  const factorA: Factor = { id: '1', code: 'A', name: 'Thành phần A', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', role: 'mixture_component', low: 0, high: 100, unit: '%' };
  const factorB: Factor = { id: '2', code: 'B', name: 'Thành phần B', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', role: 'mixture_component', low: 0, high: 100, unit: '%' };
  const factorC: Factor = { id: '3', code: 'C', name: 'Thành phần C', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', role: 'mixture_component', low: 0, high: 100, unit: '%' };
  const allFactors = [factorA, factorB, factorC];

  const cqa: CQA = {
    id: 'c1',
    code: 'Y1',
    name: 'Độ hòa tan',
    unit: '%',
    objective: 'range',
    weight: 1,
    lowerLimit: 50,
    upperLimit: 90,
  };

  const modelY1: StatisticalModelResult = {
    cqaCode: 'Y1',
    modelType: 'Linear',
    terms: [],
    anova: [],
    diagnostics: {
      rSquared: 0.95,
      adjRSquared: 0.94,
      predRSquared: 0.92,
      adeqPrecision: 15,
      press: 10,
      stdDev: 2.0,
      mean: 70,
      cvPercent: 2.8,
      residuals: [],
    },
    equationString: 'Y1 = 70',
    predict: () => 70,
    predictStandardError: () => 0.5,
    residualDegreesOfFreedom: 12,
  };

  it('generates Ppk/Cpk >= 1.33 (4σ) boundary mode legend badge', () => {
    const result = generateTernaryDesignSpace(
      factorA,
      factorB,
      factorC,
      allFactors,
      {},
      { Y1: modelY1 },
      [cqa],
      40,
      {
        boundaryMode: 'probabilistic',
        probThreshold: 0.999937,
      }
    );

    expect(result).toBeDefined();
    const sweetSpotLegend = result.sweetSpotTraces.find((t) =>
      t.name?.includes('Ppk/Cpk ≥ 1.33 (4σ)')
    );
    expect(sweetSpotLegend).toBeDefined();
  });

  it('contracts design space monotonically as capability requirement increases from 3σ to 4σ', () => {
    // Sloped response: Y1 varies from 45 to 95 across the simplex
    const slopedModel: StatisticalModelResult = {
      ...modelY1,
      predict: (coded) => 45 + (coded.A ?? 0) * 50,
      predictStandardError: () => 2.0,
      diagnostics: { ...modelY1.diagnostics, stdDev: 4.0 },
    };

    const resMean = generateTernaryDesignSpace(factorA, factorB, factorC, allFactors, {}, { Y1: slopedModel }, [cqa], 40, {
      boundaryMode: 'mean',
    });
    const res3Sigma = generateTernaryDesignSpace(factorA, factorB, factorC, allFactors, {}, { Y1: slopedModel }, [cqa], 40, {
      boundaryMode: 'probabilistic',
      probThreshold: 0.9973,
    });
    const res4Sigma = generateTernaryDesignSpace(factorA, factorB, factorC, allFactors, {}, { Y1: slopedModel }, [cqa], 40, {
      boundaryMode: 'probabilistic',
      probThreshold: 0.999937,
    });

    expect(resMean.sweetSpotFraction).toBeGreaterThanOrEqual(res3Sigma.sweetSpotFraction);
    expect(res3Sigma.sweetSpotFraction).toBeGreaterThanOrEqual(res4Sigma.sweetSpotFraction);
  });
});
