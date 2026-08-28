import type { Factor, ModelType } from '../types/qbd';
import { getConfiguredFactorCodes, getConfiguredFactorLevels, snapFactorCoded } from './doeGenerator';

export type PolynomialModelOrder = 'Linear' | '2FI' | 'Quadratic';

export interface ModelTermDefinition {
  name: string;
  factorCodes: string[];
  power: number[];
  evaluator: (coded: Record<string, number>) => number;
}

export interface FactorFeatureDefinition {
  name: string;
  factorCode: string;
  categorical: boolean;
  evaluator: (coded: Record<string, number>) => number;
}

/**
 * Numerical model features. Nominal factors use treatment contrasts (L-1
 * columns, first level is reference); numeric factors retain one physical
 * coded coordinate.
 */
export function buildFactorFeatures(factors: Factor[]): FactorFeatureDefinition[] {
  return factors.flatMap<FactorFeatureDefinition>((factor): FactorFeatureDefinition[] => {
    if (factor.dataType !== 'qualitative') {
      return [{
        name: factor.code,
        factorCode: factor.code,
        categorical: false,
        evaluator: (coded: Record<string, number>) => coded[factor.code] ?? 0,
      }];
    }
    const levels = getConfiguredFactorLevels(factor);
    const codes = getConfiguredFactorCodes(factor);
    if (levels.length < 2) return [];
    return levels.slice(1).map((level, offset) => {
      const levelIndex = offset + 1;
      return {
        name: `${factor.code}[${String(level)}]`,
        factorCode: factor.code,
        categorical: true,
        evaluator: (coded: Record<string, number>) =>
          Math.abs(snapFactorCoded(coded[factor.code] ?? codes[0], factor) - codes[levelIndex]) < 1e-8 ? 1 : 0,
      };
    });
  });
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

  const factorFeatures = factors.map((factor) => buildFactorFeatures([factor]));
  factors.forEach((factor, index) => {
    if (hasMixture && !mixtureIndexes.includes(index)) return;
    const power = new Array(k).fill(0);
    power[index] = 1;
    factorFeatures[index].forEach((feature) => terms.push({
      name: feature.name,
      factorCodes: [factor.code],
      power: [...power],
      evaluator: feature.evaluator,
    }));
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
        factorFeatures[processIndex].forEach((feature) => terms.push({
          name: `${mixtureCode}*${feature.name}`,
          factorCodes: [mixtureCode, processCode],
          power: [...power],
          evaluator: (coded) => (coded[mixtureCode] ?? 0) * feature.evaluator(coded),
        }));
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
        factorFeatures[i].forEach((firstFeature) => factorFeatures[j].forEach((secondFeature) => terms.push({
          name: `${firstFeature.name}*${secondFeature.name}`,
          factorCodes: [firstCode, secondCode],
          power: [...power],
          evaluator: (coded) => firstFeature.evaluator(coded) * secondFeature.evaluator(coded),
        })));
      }
    }
  }

  if (modelType === 'Quadratic' || modelType === 'Reduced') {
    for (let index = 0; index < k; index++) {
      if (mixtureIndexes.includes(index) || factors[index].dataType === 'qualitative') continue;
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
