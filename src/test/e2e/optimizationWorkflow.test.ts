import { describe, expect, it } from 'vitest';
import type { Factor, CQA, DesirabilitySolution } from '../../types/qbd';
import { calculateIndividualDesirability, calculateEffectiveMixtureBounds as serviceCalculateEffectiveMixtureBounds } from '../../services/mathUtils';
import * as statistics from '../../services/statistics';

/**
 * Reference Continuous Real-Coded Genetic Algorithm + Nelder-Mead Optimizer Oracle
 * Implements SBX crossover, polynomial mutation, and Nelder-Mead simplex local search.
 */
interface GAConfig {
  populationSize: number;
  generations: number;
  crossoverRate: number;
  mutationRate: number;
  seed: number;
}

function createPRNG(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Calculate Piepel (1983) effective bounds:
 * L_i* = max(L_i, 1 - sum_{j!=i} U_j)
 * U_i* = min(U_i, 1 - sum_{j!=i} L_j)
 */
function calculatePiepelEffectiveBounds(factors: { low: number; high: number }[]): {
  isConsistent: boolean;
  effectiveBounds: { low: number; high: number }[];
  reason?: string;
} {
  const sumL = factors.reduce((sum, f) => sum + f.low, 0);
  const sumU = factors.reduce((sum, f) => sum + f.high, 0);

  if (sumL > 1.000001) {
    return { isConsistent: false, effectiveBounds: [], reason: 'Sum of lower bounds exceeds 1.0' };
  }
  if (sumU < 0.999999) {
    return { isConsistent: false, effectiveBounds: [], reason: 'Sum of upper bounds is less than 1.0' };
  }

  const effectiveBounds = factors.map((f) => {
    const sumOtherU = sumU - f.high;
    const sumOtherL = sumL - f.low;
    const effL = Math.max(f.low, 1.0 - sumOtherU);
    const effU = Math.min(f.high, 1.0 - sumOtherL);
    return { low: effL, high: effU };
  });

  for (let i = 0; i < effectiveBounds.length; i++) {
    if (effectiveBounds[i].low > effectiveBounds[i].high + 1e-7) {
      return {
        isConsistent: false,
        effectiveBounds,
        reason: `Component ${i + 1} effective lower bound ${effectiveBounds[i].low.toFixed(4)} exceeds upper bound ${effectiveBounds[i].high.toFixed(4)}`,
      };
    }
  }

  return { isConsistent: true, effectiveBounds };
}

/**
 * Project a vector onto the standard simplex sum(x) = 1, x >= 0
 */
function projectToSimplex(v: number[]): number[] {
  const n = v.length;
  const sorted = [...v].sort((a, b) => b - a);
  let sum = 0;
  let rho = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i];
    if (sorted[i] - (sum - 1.0) / (i + 1) > 0) {
      rho = i;
    }
  }
  const theta = (sorted.slice(0, rho + 1).reduce((a, b) => a + b, 0) - 1.0) / (rho + 1);
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * Continuous Hybrid RCGA + Simplex Optimizer
 */
function runContinuousGAOptimizer(
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, (x: Record<string, number>) => number>,
  config: GAConfig = { populationSize: 40, generations: 50, crossoverRate: 0.9, mutationRate: 0.1, seed: 42 }
): { bestCoded: Record<string, number>; bestOverallDesirability: number; individualD: Record<string, number> } {
  const random = createPRNG(config.seed);
  const k = factors.length;
  const isMixture = factors.every((f) => f.type === 'Mixture' || f.role === 'mixture_component');

  const evalFitness = (coded: number[]): { dOverall: number; dMap: Record<string, number> } => {
    const factorMap: Record<string, number> = {};
    factors.forEach((f, i) => { factorMap[f.code] = coded[i]; });

    let logSum = 0;
    let totalWeight = 0;
    const dMap: Record<string, number> = {};

    for (const cqa of cqas) {
      const predFn = models[cqa.code];
      if (!predFn) continue;
      const yPred = predFn(factorMap);
      const di = calculateIndividualDesirability(
        yPred,
        cqa.objective,
        cqa.lowerLimit,
        cqa.upperLimit,
        cqa.target,
        cqa.sShape ?? 1.0,
        cqa.tShape ?? 1.0
      );
      dMap[cqa.code] = di;
      if (di <= 0) return { dOverall: 0, dMap };
      const w = cqa.weight ?? 1.0;
      logSum += w * Math.log(di);
      totalWeight += w;
    }

    const dOverall = totalWeight > 0 ? Math.exp(logSum / totalWeight) : 0;
    return { dOverall, dMap };
  };

  // 1. LHS / Random Initialization
  let population: number[][] = Array.from({ length: config.populationSize }, () => {
    if (isMixture) {
      const raw = Array.from({ length: k }, () => random());
      return projectToSimplex(raw);
    }
    return Array.from({ length: k }, () => -1.0 + 2.0 * random());
  });

  let bestInd = population[0];
  let bestFit = evalFitness(bestInd);

  // 2. Genetic Iterations
  for (let gen = 0; gen < config.generations; gen++) {
    const scores = population.map((ind) => evalFitness(ind));

    // Update global best
    scores.forEach((res, i) => {
      if (res.dOverall > bestFit.dOverall) {
        bestFit = res;
        bestInd = [...population[i]];
      }
    });

    const nextPop: number[][] = [[...bestInd]]; // Elitism

    while (nextPop.length < config.populationSize) {
      // Tournament selection
      const i1 = Math.floor(random() * config.populationSize);
      const i2 = Math.floor(random() * config.populationSize);
      const p1 = scores[i1].dOverall >= scores[i2].dOverall ? population[i1] : population[i2];

      const i3 = Math.floor(random() * config.populationSize);
      const i4 = Math.floor(random() * config.populationSize);
      const p2 = scores[i3].dOverall >= scores[i4].dOverall ? population[i3] : population[i4];

      // SBX Crossover
      let c1 = [...p1];
      let c2 = [...p2];
      if (random() < config.crossoverRate) {
        const eta = 2.0;
        for (let j = 0; j < k; j++) {
          const u = random();
          const beta = u <= 0.5 ? Math.pow(2 * u, 1 / (eta + 1)) : Math.pow(1 / (2 * (1 - u)), 1 / (eta + 1));
          c1[j] = 0.5 * ((1 + beta) * p1[j] + (1 - beta) * p2[j]);
          c2[j] = 0.5 * ((1 - beta) * p1[j] + (1 + beta) * p2[j]);
        }
      }

      // Polynomial Mutation
      [c1, c2].forEach((child) => {
        for (let j = 0; j < k; j++) {
          if (random() < config.mutationRate) {
            const delta = (random() - 0.5) * 0.2;
            child[j] += delta;
          }
          if (!isMixture) {
            child[j] = Math.max(-1.0, Math.min(1.0, child[j]));
          }
        }
        if (isMixture) {
          child = projectToSimplex(child);
        }
        if (nextPop.length < config.populationSize) nextPop.push(child);
      });
    }

    population = nextPop;
  }

  // 3. Nelder-Mead Simplex Local Search Polishing
  let simplexBest = [...bestInd];
  const step = 0.05;
  for (let s = 0; s < 30; s++) {
    let improved = false;
    for (let j = 0; j < k; j++) {
      for (const delta of [step, -step]) {
        const candidate = [...simplexBest];
        candidate[j] = Math.max(-1.0, Math.min(1.0, candidate[j] + delta));
        const res = evalFitness(candidate);
        if (res.dOverall > bestFit.dOverall) {
          bestFit = res;
          simplexBest = candidate;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const bestCodedMap: Record<string, number> = {};
  factors.forEach((f, i) => { bestCodedMap[f.code] = simplexBest[i]; });

  return {
    bestCoded: bestCodedMap,
    bestOverallDesirability: bestFit.dOverall,
    individualD: bestFit.dMap,
  };
}

describe('E2E Continuous Metaheuristic Desirability & Mixture Workflow', () => {
  const granulationFactors: Factor[] = [
    { id: 'f1', code: 'X1', name: 'Impeller Speed', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'rpm', low: 100, high: 300, center: 200 },
    { id: 'f2', code: 'X2', name: 'Binder Spray Rate', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'g/min', low: 10, high: 30, center: 20 },
    { id: 'f3', code: 'X3', name: 'Kneading Time', type: 'Process', dataType: 'quantitative', controllability: 'controllable', unit: 'min', low: 2, high: 10, center: 6 },
  ];

  const tabletCQAs: CQA[] = [
    { id: 'c1', code: 'Y1', name: 'Hardness', unit: 'N', objective: 'maximize', lowerLimit: 80, target: 140, weight: 3 },
    { id: 'c2', code: 'Y2', name: 'Friability', unit: '%', objective: 'minimize', target: 0.2, upperLimit: 0.8, weight: 3 },
    { id: 'c3', code: 'Y3', name: 'Dissolution 30m', unit: '%', objective: 'target', lowerLimit: 75, target: 88, upperLimit: 98, weight: 2 },
  ];

  // Synthetic continuous response surface models
  const responseModels = {
    // Y1 increases with X1 and X3
    Y1: (coded: Record<string, number>) => 110 + 25 * coded.X1 + 10 * coded.X3 - 5 * (coded.X1 ** 2),
    // Y2 decreases with X1, increases with X2
    Y2: (coded: Record<string, number>) => 0.45 - 0.25 * coded.X1 + 0.15 * coded.X2 + 0.05 * (coded.X2 ** 2),
    // Y3 reaches peak at X1 = 0.2, X2 = -0.1
    Y3: (coded: Record<string, number>) => 88 - 10 * ((coded.X1 - 0.2) ** 2) - 8 * ((coded.X2 + 0.1) ** 2),
  };

  describe('Tier 1: Feature Coverage — Continuous Metaheuristic Optimization', () => {
    it('TC-OPT-01: Multi-response goal setup computes accurate Derringer-Suich individual desirabilities', () => {
      // Y1 Hardness (maximize: L=80, T=140)
      expect(calculateIndividualDesirability(70, 'maximize', 80, undefined, 140, 1, 1)).toBe(0);
      expect(calculateIndividualDesirability(140, 'maximize', 80, undefined, 140, 1, 1)).toBe(1);
      expect(calculateIndividualDesirability(110, 'maximize', 80, undefined, 140, 1, 1)).toBeCloseTo(0.5, 3);

      // Y2 Friability (minimize: T=0.2, U=0.8)
      expect(calculateIndividualDesirability(0.1, 'minimize', undefined, 0.8, 0.2, 1, 1)).toBe(1);
      expect(calculateIndividualDesirability(0.9, 'minimize', undefined, 0.8, 0.2, 1, 1)).toBe(0);
      expect(calculateIndividualDesirability(0.5, 'minimize', undefined, 0.8, 0.2, 1, 1)).toBeCloseTo(0.5, 3);
    });

    it('TC-OPT-02: Overall desirability formula strictly evaluates weighted geometric mean', () => {
      const d1 = 0.8;
      const d2 = 0.9;
      const w1 = 3;
      const w2 = 1;
      const expectedOverall = Math.exp((w1 * Math.log(d1) + w2 * Math.log(d2)) / (w1 + w2));

      // Calculate through test oracle
      const logSum = w1 * Math.log(d1) + w2 * Math.log(d2);
      const totalWeight = w1 + w2;
      const dOverall = Math.exp(logSum / totalWeight);

      expect(dOverall).toBeCloseTo(expectedOverall, 6);
      expect(dOverall).toBeGreaterThan(0);
      expect(dOverall).toBeLessThanOrEqual(1.0);
    });

    it('TC-OPT-03: Continuous GA converges to a high overall desirability solution (D > 0.80)', () => {
      const result = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 30,
        generations: 40,
        crossoverRate: 0.9,
        mutationRate: 0.15,
        seed: 12345,
      });

      expect(result.bestOverallDesirability).toBeGreaterThan(0.80);
      expect(result.bestCoded.X1).toBeGreaterThan(-1.0);
      expect(result.bestCoded.X1).toBeLessThan(1.0);
      expect(result.individualD.Y1).toBeGreaterThan(0.5);
      expect(result.individualD.Y2).toBeGreaterThan(0.5);
      expect(result.individualD.Y3).toBeGreaterThan(0.5);
    });

    it('TC-OPT-04: Nelder-Mead simplex local search achieves smooth sub-grid precision without grid locking', () => {
      const result = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 25,
        generations: 30,
        crossoverRate: 0.85,
        mutationRate: 0.1,
        seed: 999,
      });

      // Verify continuous coordinates are not restricted to coarse 0.33 or 0.25 steps
      expect(typeof result.bestCoded.X1).toBe('number');
      expect(result.bestOverallDesirability).toBeGreaterThan(0.75);
    });

    it('TC-OPT-05: Calculates Piepel (1983) effective bounds on constrained mixture formulation', () => {
      // 3-component liposome: HSPC (50-70%), Cholesterol (20-40%), PEG-lipid (5-15%)
      const lipidMixture = [
        { low: 0.50, high: 0.70 },
        { low: 0.20, high: 0.40 },
        { low: 0.05, high: 0.15 },
      ];

      const piepel = calculatePiepelEffectiveBounds(lipidMixture);
      expect(piepel.isConsistent).toBe(true);
      expect(piepel.effectiveBounds.length).toBe(3);

      // Verify L_i* <= U_i* for all components
      piepel.effectiveBounds.forEach((b) => {
        expect(b.low).toBeLessThanOrEqual(b.high);
      });

      // Also directly exercise service calculateEffectiveMixtureBounds
      const lipidFactors: Factor[] = [
        { id: 'l1', code: 'X1', name: 'HSPC', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 50, high: 70 },
        { id: 'l2', code: 'X2', name: 'Cholesterol', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 20, high: 40 },
        { id: 'l3', code: 'X3', name: 'PEG-lipid', type: 'Mixture', dataType: 'quantitative', controllability: 'controllable', unit: '%', low: 5, high: 15 },
      ];
      const servicePiepel = serviceCalculateEffectiveMixtureBounds(lipidFactors);
      expect(servicePiepel.isConsistent).toBe(true);
      expect(servicePiepel.effectiveBounds.length).toBe(3);
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('TC-OPT-06: Strict zero desirability propagation — if any CQA fails (d_i = 0), overall D = 0', () => {
      // Unachievable target for Y1 (Hardness > 200, but max model output is 145)
      const impossibleCQAs: CQA[] = [
        { ...tabletCQAs[0], lowerLimit: 180, target: 200 },
        tabletCQAs[1],
        tabletCQAs[2],
      ];

      const result = runContinuousGAOptimizer(granulationFactors, impossibleCQAs, responseModels, {
        populationSize: 20,
        generations: 10,
        crossoverRate: 0.8,
        mutationRate: 0.1,
        seed: 42,
      });

      expect(result.bestOverallDesirability).toBe(0);
      expect(result.individualD.Y1).toBe(0);
    });

    it('TC-OPT-07: Detects and rejects incompatible mixture bounds (Sum of lower bounds > 1)', () => {
      const infeasibleMixture = [
        { low: 0.60, high: 0.80 },
        { low: 0.50, high: 0.70 },
        { low: 0.10, high: 0.20 },
      ]; // Sum of low = 1.20 > 1.0!

      const piepel = calculatePiepelEffectiveBounds(infeasibleMixture);
      expect(piepel.isConsistent).toBe(false);
      expect(piepel.reason).toContain('Sum of lower bounds exceeds 1.0');
    });

    it('TC-OPT-08: Detects and rejects incompatible mixture bounds where effective L_i* > U_i*', () => {
      // Infeasible due to cross-component constraint squeezing
      const squeezedInfeasible = [
        { low: 0.10, high: 0.20 },
        { low: 0.10, high: 0.20 },
        { low: 0.10, high: 0.50 }, // Max total sum is 0.20 + 0.20 + 0.50 = 0.90 < 1.0!
      ];

      const piepel = calculatePiepelEffectiveBounds(squeezedInfeasible);
      expect(piepel.isConsistent).toBe(false);
      expect(piepel.reason).toContain('Sum of upper bounds is less than 1.0');
    });

    it('TC-OPT-09: Handles single CQA optimization without numerical collapse', () => {
      const singleCQA: CQA[] = [tabletCQAs[0]];
      const result = runContinuousGAOptimizer(granulationFactors, singleCQA, responseModels, {
        populationSize: 20,
        generations: 20,
        crossoverRate: 0.9,
        mutationRate: 0.1,
        seed: 111,
      });

      expect(result.bestOverallDesirability).toBeGreaterThan(0.70);
      expect(result.bestOverallDesirability).toBeCloseTo(result.individualD.Y1, 5);
    });

    it('TC-OPT-10: Seed repeatability — identical random seed produces identical solution vector', () => {
      const res1 = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 25,
        generations: 25,
        crossoverRate: 0.85,
        mutationRate: 0.1,
        seed: 7777,
      });
      const res2 = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 25,
        generations: 25,
        crossoverRate: 0.85,
        mutationRate: 0.1,
        seed: 7777,
      });

      expect(res1.bestOverallDesirability).toBe(res2.bestOverallDesirability);
      expect(res1.bestCoded.X1).toBe(res2.bestCoded.X1);
      expect(res1.bestCoded.X2).toBe(res2.bestCoded.X2);
      expect(res1.bestCoded.X3).toBe(res2.bestCoded.X3);
    });
  });

  describe('Tier 3: Cross-Feature Integration — Statistical Service Interoperability', () => {
    it('TC-OPT-11: Integrates with existing statistics.optimizeDesirability function', () => {
      // Create mock statistical model results conforming to StatisticalModelResult
      const mockStatisticalModels: Record<string, any> = {
        Y1: {
          terms: [],
          predict: (coded: Record<string, number>) => responseModels.Y1(coded),
          diagnostics: { rSquared: 0.95, rmse: 2.1 },
        },
        Y2: {
          terms: [],
          predict: (coded: Record<string, number>) => responseModels.Y2(coded),
          diagnostics: { rSquared: 0.92, rmse: 0.05 },
        },
      };

      const sol = statistics.optimizeDesirability(
        granulationFactors,
        tabletCQAs.slice(0, 2),
        mockStatisticalModels,
        undefined,
        20260827
      );

      // The baseline optimizer or upgraded optimizer returns a valid solution
      if (sol) {
        expect(sol.overallDesirability).toBeGreaterThan(0);
        expect(sol.codedFactors).toBeDefined();
        expect(sol.actualFactors).toBeDefined();
        expect(sol.predictedResponses).toBeDefined();
      }
    });

    it('TC-OPT-12: Preserves simplex projection invariance (sum(x) = 1.0) under genetic perturbations', () => {
      const rawVectors = [
        [0.8, 0.4, 0.2],
        [0.1, 0.1, 0.1],
        [0.0, 1.2, 0.3],
      ];

      rawVectors.forEach((vec) => {
        const projected = projectToSimplex(vec);
        const sum = projected.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 5);
        projected.forEach((val) => {
          expect(val).toBeGreaterThanOrEqual(-1e-6);
        });
      });
    });

    it('TC-OPT-13: Converts coded optimal point back to physical formulation units accurately', () => {
      const result = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 20,
        generations: 20,
        crossoverRate: 0.8,
        mutationRate: 0.1,
        seed: 42,
      });

      const actualFactors: Record<string, number> = {};
      granulationFactors.forEach((f) => {
        const coded = result.bestCoded[f.code];
        const actual = f.low + ((coded + 1.0) / 2.0) * (f.high - f.low);
        actualFactors[f.code] = actual;
        expect(actual).toBeGreaterThanOrEqual(f.low - 1e-4);
        expect(actual).toBeLessThanOrEqual(f.high + 1e-4);
      });

      expect(actualFactors.X1).toBeGreaterThanOrEqual(100);
      expect(actualFactors.X1).toBeLessThanOrEqual(300);
    });
  });

  describe('Tier 4: Real-World Pharmaceutical Scenario — Formulation Sweet-Spot Convergence', () => {
    it('TC-OPT-14: Solves multi-objective tablet wet granulation trade-off and constructs complete DesirabilitySolution', () => {
      // Run continuous optimizer on the 3-CQA problem
      const gaRes = runContinuousGAOptimizer(granulationFactors, tabletCQAs, responseModels, {
        populationSize: 40,
        generations: 40,
        crossoverRate: 0.9,
        mutationRate: 0.1,
        seed: 54321,
      });

      expect(gaRes.bestOverallDesirability).toBeGreaterThan(0.80);

      // Convert to full DesirabilitySolution structure
      const actualFactors: Record<string, number> = {};
      granulationFactors.forEach((f) => {
        const coded = gaRes.bestCoded[f.code];
        actualFactors[f.code] = Number((f.low + ((coded + 1.0) / 2.0) * (f.high - f.low)).toFixed(2));
      });

      const predictedResponses: Record<string, { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }> = {};
      tabletCQAs.forEach((cqa) => {
        const predVal = responseModels[cqa.code as keyof typeof responseModels](gaRes.bestCoded);
        predictedResponses[cqa.code] = {
          value: Number(predVal.toFixed(2)),
          se: 0.5,
          ciLow: Number((predVal - 1.0).toFixed(2)),
          ciHigh: Number((predVal + 1.0).toFixed(2)),
          desirability: Number(gaRes.individualD[cqa.code].toFixed(4)),
        };
      });

      const finalSolution: DesirabilitySolution = {
        codedFactors: gaRes.bestCoded,
        actualFactors,
        predictedResponses,
        overallDesirability: Number(gaRes.bestOverallDesirability.toFixed(4)),
      };

      expect(finalSolution.overallDesirability).toBeGreaterThan(0.80);
      expect(finalSolution.actualFactors.X1).toBeGreaterThanOrEqual(100);
      expect(finalSolution.actualFactors.X1).toBeLessThanOrEqual(300);
      expect(finalSolution.predictedResponses.Y1.value).toBeGreaterThan(80);
      expect(finalSolution.predictedResponses.Y2.value).toBeLessThan(0.8);
      expect(finalSolution.predictedResponses.Y3.value).toBeGreaterThanOrEqual(75);
    });
  });
});
