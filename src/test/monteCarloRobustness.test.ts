import { describe, it, expect } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import { fitModel, runMonteCarloSimulation, optimizeDesirability } from '../services/statistics';

describe('Monte Carlo Robustness & Statistical Coherence', () => {
  it('ensures Case Study 2 with high Ppk (>3) has 0 PPM CQA defects and near-zero excursions with robust margin', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    expect(cs).toBeDefined();

    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      if (m) models[cqa.code] = m;
    }

    // Run GA optimizer with robust margin (default 3 sigma)
    const opt = optimizeDesirability(cs.factors, cs.cqas, models, undefined, 42, { robustMarginSigma: 3 });
    expect(opt).not.toBeNull();
    const x3Val = Number(opt?.actualFactors.X3);
    // Factor X3 has high=2.5 and processSD=0.03. With 3 sigma buffer, X3 <= 2.5 - 0.09 = 2.41
    expect(x3Val).toBeLessThanOrEqual(2.42);

    // Simulate Monte Carlo with the robust optimal setpoint
    const mc = runMonteCarloSimulation(
      opt!.actualFactors,
      cs.factors,
      cs.cqas,
      models,
      2.0,
      3000,
      2026,
      undefined,
      true // twoStageMonteCarlo
    );

    // All CQAs have high capability
    for (const cqa of cs.cqas) {
      const stat = mc.cqaStats[cqa.code];
      expect(stat.ppk).toBeGreaterThan(2.0);
      expect(stat.outOfSpecPercent).toBe(0);
    }

    // Pure CQA defect rate should be 0 PPM
    expect(mc.cqaDefectRatePPM).toBe(0);
    expect(mc.cqaFailCount).toBe(0);

    // Excursion rate should be negligible (<= 1%) instead of > 50%
    expect(mc.excursionRatePercent).toBeLessThan(1.0);
    expect(mc.reliabilityPercent).toBeGreaterThanOrEqual(99.0);
  });

  it('runs Two-Stage Monte Carlo stably on mixture and blocked designs without dimension error', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-sedds-combined')!;
    expect(cs).toBeDefined();

    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Linear');
      if (m) models[cqa.code] = m;
    }

    const setpoint = { X1: 25, X2: 50, X3: 25, X4: 12000, X5: 10 };
    const mc = runMonteCarloSimulation(
      setpoint,
      cs.factors,
      cs.cqas,
      models,
      2.0,
      1000,
      2026,
      undefined,
      true // twoStageMonteCarlo
    );

    expect(mc.simulations).toBe(1000);
    expect(mc.cqaStats.Y1).toBeDefined();
    expect(mc.cqaStats.Y2).toBeDefined();
    expect(mc.cqaStats.Y3).toBeDefined();
    expect(mc.cqaDefectRatePPM).toBeDefined();
  });
});
