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
  selectedTermNames?: string[],
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
  if (hasMixture && (modelType === 'Linear' || modelType === 'Reduced')) {
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

  if (modelType === 'Reduced' && selectedTermNames && selectedTermNames.length > 0) {
    const selectedSet = new Set(selectedTermNames);
    // Always preserve Intercept or mixture components unless empty
    return terms.filter((t) => t.name === 'Intercept' || selectedSet.has(t.name));
  }

  return terms;
}

/**
 * Checks whether a given term can be safely removed from a term list without violating hierarchy.
 * Hierarchy rule:
 * - A linear term X_i can be removed only if no interaction X_i*X_j or quadratic X_i² remains in the model.
 * - An interaction or quadratic term can always be removed (assuming quadratic is max order 2).
 * - Intercept cannot be removed.
 */
export function canRemoveTermUnderHierarchy(termName: string, allTermNames: string[]): boolean {
  if (termName === 'Intercept') return false;

  const currentSet = new Set(allTermNames);
  if (!currentSet.has(termName)) return false;

  // If this is an interaction (contains '*') or quadratic (ends with '²')
  if (termName.includes('*') || termName.endsWith('²')) {
    return true;
  }

  // It's a linear term (or categorical contrast)
  // Check if any remaining term in the set is an interaction containing this code or a quadratic of this code
  for (const other of currentSet) {
    if (other === termName) continue;
    if (other.endsWith('²') && other.startsWith(termName)) {
      return false; // Still has quadratic term
    }
    if (other.includes('*')) {
      const parts = other.split('*');
      if (parts.includes(termName)) {
        return false; // Still has interaction term
      }
    }
  }

  return true;
}

/**
 * Checks if a complete model term selection satisfies polynomial hierarchy.
 */
export function validateModelHierarchy(selectedTermNames: string[]): { isValid: boolean; violations: string[] } {
  const violations: string[] = [];
  const set = new Set(selectedTermNames);

  for (const term of selectedTermNames) {
    if (term.endsWith('²')) {
      const base = term.slice(0, -1); // e.g. X1 from X1²
      if (!set.has(base)) {
        violations.push(`Số hạng bậc hai ${term} cần có số hạng tuyến tính ${base} trong mô hình.`);
      }
    } else if (term.includes('*')) {
      const parts = term.split('*');
      for (const part of parts) {
        if (!set.has(part)) {
          violations.push(`Số hạng tương tác ${term} cần có số hạng tuyến tính ${part} trong mô hình.`);
        }
      }
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
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
