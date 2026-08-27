import type { CQA, Factor, MonteCarloResult, NeuralNetModelResult, StatisticalModelResult } from '../types/qbd';
import { actualToCoded } from './doeGenerator';
import { calculateCQAMargin } from './mathUtils';

type PredictiveModel = StatisticalModelResult | NeuralNetModelResult;

export interface CQAAcceptanceStatus {
  code: string;
  predicted: number;
  normalizedMargin: number;
  accepted: boolean;
}

export interface FactorSensitivity {
  factorCode: string;
  factorName: string;
  relativeImpact: number;
  direction: 'higher-risk-at-low' | 'higher-risk-at-high' | 'balanced';
  parLow?: number;
  parHigh?: number;
  note?: string;
}

export interface RobustnessAssessment {
  probabilityOfFailurePercent: number | null;
  probabilityInterval95: { low: number; high: number } | null;
  acceptance: CQAAcceptanceStatus[];
  sensitivities: FactorSensitivity[];
  note: string;
}

const actualPointToCoded = (actual: Record<string, number | string>, factors: Factor[]): Record<string, number> =>
  factors.reduce<Record<string, number>>((point, factor) => {
    const value = actual[factor.code] ?? factor.center ?? (factor.low + factor.high) / 2;
    point[factor.code] = actualToCoded(value, factor);
    return point;
  }, {});

const isMixture = (factor: Factor): boolean => factor.role === 'mixture_component' || factor.type === 'Mixture';

const evaluatesAsAccepted = (coded: Record<string, number>, cqas: CQA[], models: Record<string, PredictiveModel>): boolean =>
  cqas.filter((cqa) => models[cqa.code]).every((cqa) => calculateCQAMargin(models[cqa.code].predict(coded), cqa.objective, cqa.lowerLimit, cqa.upperLimit, cqa.target) >= 0);

/**
 * Local robustness screen around a chosen setpoint.  PAR is one-factor-at-a-
 * time, so it is explicitly labelled as a screening range rather than a full
 * multivariate proof.  Mixture components are excluded because moving one
 * component independently would violate the simplex.
 */
export function assessDesignSpaceRobustness(
  setpointActual: Record<string, number | string>,
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, PredictiveModel>,
  monteCarlo: MonteCarloResult | null,
): RobustnessAssessment {
  const coded = actualPointToCoded(setpointActual, factors);
  const acceptance = cqas.filter((cqa) => models[cqa.code]).map((cqa) => {
    const predicted = models[cqa.code].predict(coded);
    const normalizedMargin = calculateCQAMargin(predicted, cqa.objective, cqa.lowerLimit, cqa.upperLimit, cqa.target);
    return { code: cqa.code, predicted, normalizedMargin, accepted: normalizedMargin >= 0 };
  });
  const failure = monteCarlo ? 1 - monteCarlo.reliabilityPercent / 100 : null;
  const simulations = monteCarlo?.simulations ?? 0;
  const halfWidth = failure !== null && simulations > 0 ? 1.96 * Math.sqrt(Math.max(0, failure * (1 - failure) / simulations)) : null;
  const probabilityInterval95 = failure !== null && halfWidth !== null ? {
    low: Number((Math.max(0, failure - halfWidth) * 100).toFixed(3)),
    high: Number((Math.min(1, failure + halfWidth) * 100).toFixed(3)),
  } : null;

  const sensitivities = factors
    .filter((factor) => factor.controllability !== 'constant')
    .map((factor): FactorSensitivity => {
      if (isMixture(factor)) {
        return { factorCode: factor.code, factorName: factor.name, relativeImpact: 0, direction: 'balanced', note: 'Mixture phải đánh giá đồng thời trên simplex; xem ternary overlay.' };
      }
      const current = Number(setpointActual[factor.code] ?? factor.center ?? (factor.low + factor.high) / 2);
      const delta = Math.max((factor.high - factor.low) * 0.05, 1e-9);
      const lowActual = Math.max(factor.low, current - delta);
      const highActual = Math.min(factor.high, current + delta);
      const lowPoint = { ...coded, [factor.code]: actualToCoded(lowActual, factor) };
      const highPoint = { ...coded, [factor.code]: actualToCoded(highActual, factor) };
      let lowImpact = 0;
      let highImpact = 0;
      cqas.filter((cqa) => models[cqa.code]).forEach((cqa) => {
        const base = models[cqa.code].predict(coded);
        const scale = Math.max(Math.abs(cqa.upperLimit ?? cqa.lowerLimit ?? cqa.target ?? base), 1e-8);
        lowImpact = Math.max(lowImpact, Math.abs(models[cqa.code].predict(lowPoint) - base) / scale);
        highImpact = Math.max(highImpact, Math.abs(models[cqa.code].predict(highPoint) - base) / scale);
      });
      let parLow = current;
      let parHigh = current;
      for (let step = 1; step <= 30; step++) {
        const value = current - ((current - factor.low) * step) / 30;
        if (!evaluatesAsAccepted({ ...coded, [factor.code]: actualToCoded(value, factor) }, cqas, models)) break;
        parLow = value;
      }
      for (let step = 1; step <= 30; step++) {
        const value = current + ((factor.high - current) * step) / 30;
        if (!evaluatesAsAccepted({ ...coded, [factor.code]: actualToCoded(value, factor) }, cqas, models)) break;
        parHigh = value;
      }
      return {
        factorCode: factor.code,
        factorName: factor.name,
        relativeImpact: Number((Math.max(lowImpact, highImpact) * 100).toFixed(2)),
        direction: lowImpact > highImpact * 1.1 ? 'higher-risk-at-low' : highImpact > lowImpact * 1.1 ? 'higher-risk-at-high' : 'balanced',
        parLow: Number(parLow.toFixed(4)),
        parHigh: Number(parHigh.toFixed(4)),
      };
    })
    .sort((first, second) => second.relativeImpact - first.relativeImpact);
  return {
    probabilityOfFailurePercent: failure === null ? null : Number((failure * 100).toFixed(3)),
    probabilityInterval95,
    acceptance,
    sensitivities,
    note: 'PAR hiển thị là screening one-factor-at-a-time tại setpoint; bằng chứng Design Space đa biến vẫn dựa trên overlay/ternary và Monte Carlo.',
  };
}
