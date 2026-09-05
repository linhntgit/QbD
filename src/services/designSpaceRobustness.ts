import type { CQA, Factor, MonteCarloResult, NeuralNetModelResult, StatisticalModelResult } from '../types/qbd';
import { actualToCoded, codedToActual, getConfiguredFactorCodes, isDiscreteFactor, snapFactorCoded } from './doeGenerator';
import { calculateCQAMargin, wilsonInterval } from './mathUtils';

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
  const failure = monteCarlo && monteCarlo.simulations > 0 ? monteCarlo.failCount / monteCarlo.simulations : null;
  const simulations = monteCarlo?.simulations ?? 0;
  const interval = monteCarlo && simulations > 0 ? wilsonInterval(monteCarlo.failCount, simulations) : null;
  const probabilityInterval95 = interval ? {
    low: interval.low * 100,
    high: interval.high * 100,
  } : null;

  const sensitivities = factors
    .filter((factor) => factor.controllability !== 'constant')
    .map((factor): FactorSensitivity => {
      if (isMixture(factor)) {
        return { factorCode: factor.code, factorName: factor.name, relativeImpact: 0, direction: 'balanced', note: 'Mixture phải đánh giá đồng thời trên simplex; xem ternary overlay.' };
      }
      if (isDiscreteFactor(factor)) {
        const codes = getConfiguredFactorCodes(factor);
        const currentCode = snapFactorCoded(coded[factor.code] ?? 0, factor);
        const currentIndex = codes.reduce((best, code, index) =>
          Math.abs(code - currentCode) < Math.abs(codes[best] - currentCode) ? index : best, 0);
        const lowCode = codes[Math.max(0, currentIndex - 1)] ?? currentCode;
        const highCode = codes[Math.min(codes.length - 1, currentIndex + 1)] ?? currentCode;
        let lowImpact = 0;
        let highImpact = 0;
        cqas.filter((cqa) => models[cqa.code]).forEach((cqa) => {
          const base = models[cqa.code].predict(coded);
          const scale = Math.max(Math.abs(cqa.upperLimit ?? cqa.lowerLimit ?? cqa.target ?? base), 1e-8);
          lowImpact = Math.max(lowImpact, Math.abs(models[cqa.code].predict({ ...coded, [factor.code]: lowCode }) - base) / scale);
          highImpact = Math.max(highImpact, Math.abs(models[cqa.code].predict({ ...coded, [factor.code]: highCode }) - base) / scale);
        });
        const acceptedCodes = codes.filter((code) => evaluatesAsAccepted({ ...coded, [factor.code]: code }, cqas, models));
        const acceptedActual = acceptedCodes.map((code) => codedToActual(code, factor));
        const numericAccepted = acceptedActual.map(Number).filter(Number.isFinite);
        return {
          factorCode: factor.code,
          factorName: factor.name,
          relativeImpact: Number((Math.max(lowImpact, highImpact) * 100).toFixed(2)),
          direction: lowImpact > highImpact * 1.1 ? 'higher-risk-at-low' : highImpact > lowImpact * 1.1 ? 'higher-risk-at-high' : 'balanced',
          parLow: factor.dataType === 'quantitative_multilevel' && numericAccepted.length ? Math.min(...numericAccepted) : undefined,
          parHigh: factor.dataType === 'quantitative_multilevel' && numericAccepted.length ? Math.max(...numericAccepted) : undefined,
          note: factor.dataType === 'qualitative'
            ? `Các mức đạt: ${acceptedActual.map(String).join(', ') || 'không có'}.`
            : `Các mức định lượng đạt: ${acceptedActual.map(String).join(', ') || 'không có'}; không nội suy giữa các mức.`,
        };
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
