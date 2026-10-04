import { describe, it, expect } from 'vitest';
import { CASE_STUDIES } from '../data/caseStudies';
import { validateProjectSchema } from '../services/projectGovernance';
import { fitModel, runMonteCarloSimulation } from '../services/statistics';
import { convertCodedToActualEquation } from '../services/equationTransforms';

describe('Demo Case Studies Realism & Industrial Pharmacopeial Rigor', () => {
  it('validates that all 4 case studies pass Zod formal schema validation', () => {
    expect(CASE_STUDIES).toHaveLength(4);
    for (const project of CASE_STUDIES) {
      const res = validateProjectSchema(project);
      expect(res.success).toBe(true);
      expect(res.errors).toHaveLength(0);
    }
  });

  it('verifies Case Study 1 (Metoprolol Succinate ER Tablet BBD): factors, processSD, fishbone and model fit', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-tablet-bbd')!;
    expect(cs).toBeDefined();
    expect(cs.strength).toBe('100 mg');
    expect(cs.factors.length).toBeGreaterThanOrEqual(4);

    // Controllable process/formulation factors have processSD defined
    const activeFactors = cs.factors.filter((f) => f.controllability === 'controllable');
    for (const f of activeFactors) {
      expect(f.processSD).toBeDefined();
      expect(f.processSD).toBeGreaterThan(0);
    }

    // Fishbone diagram exists with 6 categories
    expect(cs.fishbone).toBeDefined();
    expect(cs.fishbone?.categories).toHaveLength(6);
    expect(cs.fishbone?.effect).toContain('Metoprolol');

    // FMEA has high, medium risks with proper RPN
    expect(cs.fmeaRisks.length).toBeGreaterThanOrEqual(6);
    for (const risk of cs.fmeaRisks) {
      expect(risk.rpn).toBe(risk.severity * risk.probability * risk.detectability);
    }

    // Runs support Quadratic model fitting without matrix singularity
    const y1 = cs.cqas.find((c) => c.code === 'Y1')!;
    const model = fitModel(y1, cs.factors, cs.runs, 'Quadratic');
    expect(model).not.toBeNull();
    expect(model?.diagnostics.rSquared).toBeGreaterThan(0.85);

    // Actual equation transformation works
    const actualEq = convertCodedToActualEquation(model!.terms, cs.factors, y1.code);
    expect(actualEq.equationString).toContain('Y1 =');
  });

  it('verifies Case Study 2 (Apixaban API Intermediate CCD): ICH Q11 chemical synthesis and crystallization', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-api-ccd')!;
    expect(cs).toBeDefined();
    expect(cs.dosageForm).toContain('API');

    // Process tolerances
    const tempFactor = cs.factors.find((f) => f.code === 'X1')!;
    expect(tempFactor.processSD).toBe(0.5);

    // Fishbone diagram exists
    expect(cs.fishbone).toBeDefined();
    expect(cs.fishbone?.categories).toHaveLength(6);

    // FMEA covers yield, impurities and D90 particle size
    expect(cs.fmeaRisks.length).toBeGreaterThanOrEqual(5);

    // Fit quadratic model on chemical yield and total impurities
    const yYield = cs.cqas.find((c) => c.code === 'Y1')!;
    const yImp = cs.cqas.find((c) => c.code === 'Y2')!;

    const modelYield = fitModel(yYield, cs.factors, cs.runs, 'Quadratic');
    const modelImp = fitModel(yImp, cs.factors, cs.runs, 'Quadratic');

    expect(modelYield).not.toBeNull();
    expect(modelImp).not.toBeNull();
    expect(modelYield?.diagnostics.rSquared).toBeGreaterThan(0.80);
    expect(modelImp?.diagnostics.rSquared).toBeGreaterThan(0.75);
  });

  it('verifies Case Study 3 (SEDDS Nanoemulsion Combined Design): mixture and process integration', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-sedds-combined')!;
    expect(cs).toBeDefined();
    expect(cs.doeConfig.category).toBe('Combined_Mixture_Process');

    // Mixture components sum check
    const mixFactors = cs.factors.filter((f) => f.type === 'Mixture');
    expect(mixFactors).toHaveLength(3);

    for (const r of cs.runs) {
      const sum = (Number(r.factorActual.X1) || 0) + (Number(r.factorActual.X2) || 0) + (Number(r.factorActual.X3) || 0);
      expect(sum).toBeCloseTo(100.0, 1);
    }

    // Fishbone diagram exists
    expect(cs.fishbone).toBeDefined();
    expect(cs.fishbone?.categories).toHaveLength(6);

    // Linear Scheffe mixture model fits droplet size Y1
    const yDroplet = cs.cqas.find((c) => c.code === 'Y1')!;
    const model = fitModel(yDroplet, cs.factors, cs.runs, 'Linear');
    expect(model).not.toBeNull();
    expect(model?.diagnostics.rSquared).toBeGreaterThan(0.70);
  });

  it('verifies Case Study 4 (FDA MR MUPS Tablet CCF): full 28 runs, alcohol resistance and quadratic fit', () => {
    const cs = CASE_STUDIES.find((p) => p.id === 'case-study-fda-mr-tablet')!;
    expect(cs).toBeDefined();
    expect(cs.doeConfig.designType).toBe('CCD_FaceCentered');
    expect(cs.doeConfig.alpha).toBe(1.0);

    // Full 28 runs (16 factorial + 8 axial + 4 center points)
    expect(cs.runs).toHaveLength(28);

    // Axial points are properly distributed
    const axialRunX1Pos = cs.runs.find((r) => r.id === 'fda-run-22')!;
    expect(axialRunX1Pos.factorCoded.X1).toBe(1);
    expect(axialRunX1Pos.factorCoded.X2).toBe(0);
    expect(axialRunX1Pos.factorCoded.X3).toBe(0);
    expect(axialRunX1Pos.factorCoded.X4).toBe(0);

    // Fishbone diagram exists
    expect(cs.fishbone).toBeDefined();
    expect(cs.fishbone?.categories).toHaveLength(6);

    // Quadratic model can be fitted without matrix singularity on all 5 CQAs
    for (const cqa of cs.cqas) {
      const model = fitModel(cqa, cs.factors, cs.runs, 'Quadratic');
      expect(model).not.toBeNull();
      expect(model?.diagnostics.rSquared).toBeGreaterThan(0.80);
      expect(model?.terms.length).toBe(15); // Intercept + 4 linear + 4 quad + 6 interaction
    }

    // Two-stage Monte Carlo simulation executes stably with factor processSD
    const yT50 = cs.cqas.find((c) => c.code === 'Y1')!;
    const modelT50 = fitModel(yT50, cs.factors, cs.runs, 'Quadratic')!;
    const mc = runMonteCarloSimulation(
      { X1: 30, X2: 10, X3: 10, X4: 40 },
      cs.factors,
      [yT50],
      { Y1: modelT50 },
      3.0,
      1000,
      12345,
      undefined,
      true // twoStageMonteCarlo
    );

    expect(mc.simulations).toBe(1000);
    expect(mc.reliabilityPercent).toBeGreaterThan(50);
  });
});
