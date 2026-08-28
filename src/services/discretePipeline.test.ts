import { describe, expect, it } from 'vitest';
import type { CQA, DoEDesignConfig, DoERun, Factor } from '../types/qbd';
import { actualToCoded, getConfiguredFactorCodes, validateDesignSetup } from './doeGenerator';
import { fitModel, isWithinSurveyBounds, optimizeDesirability, runMonteCarloSimulation } from './statistics';

const qualitativeFactor: Factor = {
  id: 'x1', code: 'X1', name: 'Supplier', type: 'CMA', dataType: 'qualitative',
  controllability: 'controllable', unit: '', low: 0, high: 1, categories: ['A', 'B', 'C', 'D'],
};

const cqa: CQA = {
  id: 'y1', code: 'Y1', name: 'Yield', dataType: 'quantitative', unit: '%',
  objective: 'maximize', lowerLimit: 0, target: 10, weight: 1,
};

describe('discrete factor pipeline', () => {
  it('fits independent category means without imposing an ordinal slope', () => {
    const means: Record<string, number> = { A: 1, B: 7, C: 2, D: 10 };
    const runs: DoERun[] = qualitativeFactor.categories!.flatMap((level, levelIndex) => [0, 1].map((replicate) => ({
      id: `${level}-${replicate}`,
      stdOrder: levelIndex * 2 + replicate + 1,
      runOrder: levelIndex * 2 + replicate + 1,
      block: 1,
      factorCoded: { X1: actualToCoded(level, qualitativeFactor) },
      factorActual: { X1: level },
      responses: { Y1: means[level] + (replicate ? 0.05 : -0.05) },
    })));
    const model = fitModel(cqa, [qualitativeFactor], runs, 'Linear');
    expect(model).not.toBeNull();
    qualitativeFactor.categories!.forEach((level) => {
      expect(model!.predict({ X1: actualToCoded(level, qualitativeFactor) })).toBeCloseTo(means[level], 6);
    });
    expect(model!.terms).toHaveLength(4);
  });

  it('rejects impossible intermediate category coordinates', () => {
    const legal = getConfiguredFactorCodes(qualitativeFactor)[1];
    expect(isWithinSurveyBounds({ X1: legal }, [qualitativeFactor])).toBe(true);
    expect(isWithinSurveyBounds({ X1: (legal + getConfiguredFactorCodes(qualitativeFactor)[2]) / 2 }, [qualitativeFactor])).toBe(false);
  });

  it('requires an appropriate design when a factor has more than two levels', () => {
    const base: DoEDesignConfig = { category: 'Screening', designType: 'FullFactorial2k', centerPoints: 0, replicates: 1, randomized: false };
    expect(validateDesignSetup([qualitativeFactor], base).isValid).toBe(false);
    expect(validateDesignSetup([qualitativeFactor], { ...base, category: 'Custom_Optimal', designType: 'DOptimal', numRuns: 8, dOptimalModel: 'Linear' }).isValid).toBe(true);
  });

  it('keeps optimizer and Monte Carlo predictions on declared category levels', () => {
    const allowed = getConfiguredFactorCodes(qualitativeFactor);
    const observed: number[] = [];
    const model = {
      predict: (coded: Record<string, number>) => {
        observed.push(coded.X1);
        return coded.X1 === allowed[2] ? 10 : 1;
      },
      diagnostics: { stdDev: 0 },
    } as any;
    const optimum = optimizeDesirability([qualitativeFactor], [cqa], { Y1: model }, undefined, 22);
    expect(optimum?.codedFactors.X1).toBe(allowed[2]);
    expect(optimum?.actualFactors.X1).toBe('C');
    runMonteCarloSimulation({ X1: 'C' }, [qualitativeFactor], [cqa], { Y1: model }, 5, 20, 12);
    expect(observed.every((code) => allowed.includes(code))).toBe(true);
  });
});
