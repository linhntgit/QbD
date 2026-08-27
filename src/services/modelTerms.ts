import type { Factor, ModelType } from '../types/qbd';

export type PolynomialModelOrder = 'Linear' | '2FI' | 'Quadratic';

export interface ModelTermDefinition {
  name: string;
  factorCodes: string[];
  power: number[];
  evaluator: (coded: Record<string, number>) => number;
}

export const isMixtureFactor = (factor: Factor): boolean =>
  factor.role === 'mixture_component' || factor.type === 'Mixture';

/**
 * Canonical estimable polynomial basis for ordinary and mixture-process DoE.
 * Mixture components sum to one, therefore the basis has no intercept and
 * no standalone process main effects when mixture × process terms are used.
 */
export function buildModelTerms(
  factors: Factor[],
  modelType: ModelType | PolynomialModelOrder,
): ModelTermDefinition[] {
  const terms: ModelTermDefinition[] = [];
  const k = factors.length;
  const mixtureIndexes = factors
    .map((factor, index) => (isMixtureFactor(factor) ? index : -1))
    .filter((index) => index >= 0);
  const hasMixture = mixtureIndexes.length > 0;

  if (!hasMixture) {
    terms.push({ name: 'Intercept', factorCodes: [], power: [], evaluator: () => 1 });
  }

  factors.forEach((factor, index) => {
    if (hasMixture && !mixtureIndexes.includes(index)) return;
    const power = new Array(k).fill(0);
    power[index] = 1;
    terms.push({
      name: factor.code,
      factorCodes: [factor.code],
      power,
      evaluator: (coded) => coded[factor.code] ?? 0,
    });
  });

  // A first-order mixture-process model represents process effects through
  // x_i·z_j terms, not redundant standalone z_j terms.
  if (hasMixture && modelType === 'Linear') {
    for (const mixtureIndex of mixtureIndexes) {
      for (let processIndex = 0; processIndex < k; processIndex++) {
        if (mixtureIndexes.includes(processIndex)) continue;
        const power = new Array(k).fill(0);
        power[mixtureIndex] = 1;
        power[processIndex] = 1;
        const mixtureCode = factors[mixtureIndex].code;
        const processCode = factors[processIndex].code;
        terms.push({
          name: `${mixtureCode}*${processCode}`,
          factorCodes: [mixtureCode, processCode],
          power,
          evaluator: (coded) => (coded[mixtureCode] ?? 0) * (coded[processCode] ?? 0),
        });
      }
    }
  }

  if (modelType === '2FI' || modelType === 'Quadratic' || modelType === 'Reduced') {
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const power = new Array(k).fill(0);
        power[i] = 1;
        power[j] = 1;
        const firstCode = factors[i].code;
        const secondCode = factors[j].code;
        terms.push({
          name: `${firstCode}*${secondCode}`,
          factorCodes: [firstCode, secondCode],
          power,
          evaluator: (coded) => (coded[firstCode] ?? 0) * (coded[secondCode] ?? 0),
        });
      }
    }
  }

  if (modelType === 'Quadratic' || modelType === 'Reduced') {
    for (let index = 0; index < k; index++) {
      if (mixtureIndexes.includes(index)) continue;
      const power = new Array(k).fill(0);
      power[index] = 2;
      const code = factors[index].code;
      terms.push({
        name: `${code}²`,
        factorCodes: [code],
        power,
        evaluator: (coded) => Math.pow(coded[code] ?? 0, 2),
      });
    }
  }

  return terms;
}

export function buildModelVector(
  coded: number[],
  factors: Factor[],
  modelType: PolynomialModelOrder,
): number[] {
  const point = factors.reduce<Record<string, number>>((acc, factor, index) => {
    acc[factor.code] = coded[index] ?? 0;
    return acc;
  }, {});
  return buildModelTerms(factors, modelType).map((term) => term.evaluator(point));
}

export function getModelTermCount(factors: Factor[], modelType: PolynomialModelOrder): number {
  return buildModelTerms(factors, modelType).length;
}

export function getModelBlockCounts(factors: Factor[], modelType: ModelType): {
  linear: number;
  interactions: number;
  quadratic: number;
} {
  const terms = buildModelTerms(factors, modelType);
  return {
    linear: terms.filter((term) => term.power.reduce((sum, power) => sum + power, 0) === 1).length,
    interactions: terms.filter((term) => term.factorCodes.length === 2).length,
    quadratic: terms.filter((term) => term.power.some((power) => power === 2)).length,
  };
}
