import { describe, it, expect } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import { fitModel, runMonteCarloSimulation, runMonteCarloSimulationAsync, optimizeDesirability } from '../services/statistics';
import type { MonteCarloCustomVariability } from '../types/qbd';

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

  it('dynamically changes simulation results and response variance when RSD is changed', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    expect(cs).toBeDefined();

    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      if (m) models[cqa.code] = m;
    }
    const setpoint = { X1: 75, X2: 450, X3: 2.0 };

    // Run at RSD = 1.0% (tight control)
    const mcLowRSD = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 1.0, 1000, 2026);
    // Run at RSD = 5.0% (high variability)
    const mcHighRSD = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 5.0, 1000, 2026);

    // Response standard deviation should be strictly larger at higher RSD
    const sdLow = mcLowRSD.cqaStats['Y1'].sd;
    const sdHigh = mcHighRSD.cqaStats['Y1'].sd;
    expect(sdHigh).toBeGreaterThan(sdLow);

    // Ppk should be strictly lower at higher RSD
    const ppkLow = mcLowRSD.cqaStats['Y1'].ppk;
    const ppkHigh = mcHighRSD.cqaStats['Y1'].ppk;
    expect(ppkLow).toBeDefined();
    expect(ppkHigh).toBeDefined();
    expect(Number(ppkLow)).toBeGreaterThan(Number(ppkHigh));
  });

  it('supports individual factor Xi variability in component_wise mode', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      if (m) models[cqa.code] = m;
    }
    const setpoint = { X1: 75, X2: 450, X3: 2.0 };

    // Config 1: Tight variability on all factors
    const customTight: MonteCarloCustomVariability = {
      mode: 'component_wise',
      globalRSD: 2.0,
      factorVariability: {
        X1: { type: 'sd', value: 0.05 },
        X2: { type: 'sd', value: 0.01 },
        X3: { type: 'sd', value: 0.005 },
      },
    };
    const mcTight = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 2.0, 1000, 2026, undefined, false, customTight);

    // Config 2: Loose variability on X1 only (e.g. temperature fluctuates widely)
    const customLooseX1: MonteCarloCustomVariability = {
      mode: 'component_wise',
      globalRSD: 2.0,
      factorVariability: {
        X1: { type: 'sd', value: 3.5 }, // large temperature fluctuation +/- 3.5 °C
        X2: { type: 'sd', value: 0.01 },
        X3: { type: 'sd', value: 0.005 },
      },
    };
    const mcLooseX1 = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 2.0, 1000, 2026, undefined, false, customLooseX1);

    // Y1 (Yield) is heavily influenced by X1 (Temperature)
    expect(mcLooseX1.cqaStats['Y1'].sd).toBeGreaterThan(mcTight.cqaStats['Y1'].sd);
    expect(mcLooseX1.varianceDecomposition!['Y1'].processVariance).toBeGreaterThan(mcTight.varianceDecomposition!['Y1'].processVariance);
  });

  it('supports CQA analytical measurement noise and decomposes variance components', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      if (m) models[cqa.code] = m;
    }
    const setpoint = { X1: 75, X2: 450, X3: 2.0 };

    // Case A: Simulation without analytical measurement noise
    const mcNoMeas = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 2.0, 1000, 2026);
    expect(mcNoMeas.varianceDecomposition).toBeDefined();
    const decompNoMeas = mcNoMeas.varianceDecomposition!['Y1'];
    expect(decompNoMeas.measurementVariance).toBe(0);
    expect(decompNoMeas.measurementPercent).toBe(0);
    expect(decompNoMeas.processPercent + decompNoMeas.modelPercent).toBeCloseTo(100, 0);

    // Case B: Simulation with analytical measurement noise enabled on Y1 (e.g. HPLC RSD = 3.5%)
    const customWithMeas: MonteCarloCustomVariability = {
      mode: 'component_wise',
      globalRSD: 2.0,
      factorVariability: {
        X1: { type: 'sd', value: 0.5 },
        X2: { type: 'sd', value: 0.08 },
        X3: { type: 'sd', value: 0.03 },
      },
      cqaMeasurementVariability: {
        Y1: { type: 'rsd', value: 3.5, enabled: true },
      },
    };
    const mcWithMeas = runMonteCarloSimulation(setpoint, cs.factors, cs.cqas, models, 2.0, 1000, 2026, undefined, false, customWithMeas);
    expect(mcWithMeas.varianceDecomposition).toBeDefined();
    const decompWithMeas = mcWithMeas.varianceDecomposition!['Y1'];

    // Measurement noise must increase total SD and have non-zero measurement variance & percent
    expect(mcWithMeas.cqaStats['Y1'].sd).toBeGreaterThan(mcNoMeas.cqaStats['Y1'].sd);
    expect(decompWithMeas.measurementVariance).toBeGreaterThan(0);
    expect(decompWithMeas.measurementPercent).toBeGreaterThan(5.0);
    const sumPercents = decompWithMeas.processPercent + decompWithMeas.modelPercent + decompWithMeas.measurementPercent;
    expect(sumPercents).toBeCloseTo(100, 0);
  });

  it('runs asynchronously via runMonteCarloSimulationAsync forwarding customVariability', async () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    const models: Record<string, any> = {};
    for (const cqa of cs.cqas) {
      const m = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      if (m) models[cqa.code] = m;
    }
    const setpoint = { X1: 75, X2: 450, X3: 2.0 };

    const customConfig: MonteCarloCustomVariability = {
      mode: 'component_wise',
      globalRSD: 2.0,
      factorVariability: {
        X1: { type: 'sd', value: 0.5 },
      },
      cqaMeasurementVariability: {
        Y1: { type: 'rsd', value: 2.0, enabled: true },
      },
    };

    const mcAsync = await runMonteCarloSimulationAsync(
      setpoint,
      cs.factors,
      cs.cqas,
      models,
      2.0,
      500,
      2026,
      undefined,
      undefined,
      false,
      customConfig
    );

    expect(mcAsync.customVariability).toEqual(customConfig);
    expect(mcAsync.varianceDecomposition).toBeDefined();
    expect(mcAsync.varianceDecomposition!['Y1'].measurementVariance).toBeGreaterThan(0);
  });
});
