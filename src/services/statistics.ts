import type {
  Factor,
  CQA,
  DoERun,
  ModelType,
  RegressionTerm,
  ANOVASource,
  StatisticalModelResult,
  NeuralNetModelResult,
  DesirabilitySolution,
  MonteCarloResult,
  UpdatedRiskItem,
  ControlStrategyItem,
  QBDProject,
} from '../types/qbd';
import {
  matMul,
  matTranspose,
  matInverse,
  fDistributionPValue,
  tDistributionPValue,
  tDistributionCritical,
  calculateIndividualDesirability,
  calculateInformationCriteria,
} from './mathUtils';
import { buildModelTerms, getModelBlockCounts, type ModelTermDefinition } from './modelTerms';
import { createSeededRandom } from './random';

type TermDef = ModelTermDefinition;

export interface ModelCandidateAssessment {
  modelType: Extract<ModelType, 'Linear' | '2FI' | 'Quadratic'>;
  model: StatisticalModelResult | null;
  isHierarchical: boolean;
  residualDegreesOfFreedom: number;
  aicc: number | null;
  qSquared: number | null;
  lackOfFitPValue: number | null;
  outlierRunOrders: number[];
  influentialRunOrders: number[];
  highLeverageRunOrders: number[];
  adequate: boolean;
  reasons: string[];
}

export interface AnalysisWizardResult {
  candidates: ModelCandidateAssessment[];
  recommended: ModelCandidateAssessment | null;
  warnings: string[];
}

export interface ConfirmationPlan {
  sourceRunOrder: number;
  sourceBlock: number;
  factorActual: Record<string, number | string>;
  predictedResponse: number;
  meanConfidenceInterval: { low: number; high: number } | null;
  individualPredictionInterval: { low: number; high: number } | null;
  recommendedReplicates: number;
  acceptanceCriterion: string;
}

function calculateSSE(X: number[][], Y: number[][]): number {
  const beta = matMul(matMul(matInverse(matMul(matTranspose(X), X)), matTranspose(X)), Y);
  const predicted = matMul(X, beta);
  return Y.reduce((sum, row, i) => sum + Math.pow(row[0] - predicted[i][0], 2), 0);
}

/** Variance inflation factors for non-intercept columns. */
function calculateVIFs(X: number[][], firstPredictorIndex: number = 1): number[] {
  const p = X[0].length;
  const n = X.length;
  const vifs = new Array(p).fill(1);

  for (let target = firstPredictorIndex; target < p; target++) {
    const y = X.map((row) => row[target]);
    const mean = y.reduce((sum, value) => sum + value, 0) / n;
    const sst = y.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0);
    if (sst <= 1e-12) {
      vifs[target] = Infinity;
      continue;
    }
    const others = X.map((row) => row.filter((_, index) => index !== target));
    try {
      const beta = matMul(matMul(matInverse(matMul(matTranspose(others), others)), matTranspose(others)), y.map((value) => [value]));
      const sse = others.reduce((sum, row, index) => {
        const predicted = row.reduce((acc, value, col) => acc + value * beta[col][0], 0);
        return sum + Math.pow(y[index] - predicted, 2);
      }, 0);
      const r2 = Math.min(1, Math.max(0, 1 - sse / sst));
      vifs[target] = r2 >= 1 - 1e-10 ? Infinity : 1 / (1 - r2);
    } catch {
      vifs[target] = Infinity;
    }
  }
  return vifs;
}

/**
 * Build term definitions based on factors and model type
 */
function buildTerms(factors: Factor[], modelType: ModelType): TermDef[] {
  return buildModelTerms(factors, modelType);
}

/**
 * Fit OLS Regression and generate full ANOVA & Diagnostics for a given CQA
 */
export function fitModel(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  modelType: ModelType = 'Quadratic'
): StatisticalModelResult | null {
  // A 0/100 surrogate is not a binomial model.  Fail closed until a logistic
  // modelling engine is supplied rather than reporting invalid OLS p-values.
  if (cqa.dataType === 'qualitative_binary' || cqa.objective === 'pass_category') return null;
  // Block-adjusted inference is not implemented. Fail closed instead of
  // reporting p-values that confound execution batch with treatment effects.
  if (new Set(runs.map((run) => run.block ?? 1)).size > 1) return null;
  // Only vary factors that are not constant
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');

  // Convert response value to numeric (handling qualitative binary / numbers)
  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return isNaN(raw) ? null : raw;
    if (typeof raw === 'string') {
      const lower = raw.trim().toLowerCase();
      if (lower === 'đạt' || lower === 'pass' || lower === 'yes' || lower === 'true') return 100.0;
      if (lower === 'không đạt' || lower === 'fail' || lower === 'no' || lower === 'false') return 0.0;
      const num = Number(raw);
      return isNaN(num) ? null : num;
    }
    return null;
  };

  // Filter runs with valid response for this CQA
  const validRuns = runs
    .map((r) => ({ run: r, parsedY: parseResponse(r.responses[cqa.code]) }))
    .filter((item) => item.parsedY !== null);

  const n = validRuns.length;
  const terms = buildTerms(activeFactors, modelType);
  const p = terms.length;
  const hasExplicitIntercept = terms[0]?.name === 'Intercept';

  // A valid OLS ANOVA needs a full-rank model and at least one residual degree
  // of freedom.  Do not manufacture a residual df for a saturated model.
  if (n <= p) return null;

  // Build X matrix (n x p) and Y vector (n x 1)
  const X: number[][] = validRuns.map(({ run }) => terms.map((t) => t.evaluator(run.factorCoded)));
  const Y: number[][] = validRuns.map(({ parsedY }) => [parsedY!]);

  const XT = matTranspose(X);
  const XTX = matMul(XT, X);
  let invXTX: number[][];
  try {
    invXTX = matInverse(XTX);
  } catch {
    return null;
  }
  const XTY = matMul(XT, Y);
  const Beta = matMul(invXTX, XTY); // (p x 1)

  // Compute Predictions and Residuals
  const yPred = matMul(X, Beta).map((row) => row[0]);
  const yActual = Y.map((row) => row[0]);
  const residuals = yActual.map((act, i) => act - yPred[i]);

  const yMean = yActual.reduce((a, b) => a + b, 0) / n;

  // Sum of Squares
  const ssTotal = yActual.reduce((sum, act) => sum + Math.pow(act - yMean, 2), 0);
  const ssResidual = residuals.reduce((sum, res) => sum + Math.pow(res, 2), 0);
  const ssModel = Math.max(0, ssTotal - ssResidual);

  const dfTotal = n - 1;
  const dfModel = p - 1;
  const dfResidual = n - p;

  const msModel = dfModel > 0 ? ssModel / dfModel : 0;
  const msResidual = dfResidual > 0 ? ssResidual / dfResidual : 0;

  const fModel = msResidual > 0 ? msModel / msResidual : 0;
  const pModel = fDistributionPValue(fModel, dfModel, dfResidual);

  // Hat matrix H = X * (X^T X)^-1 * X^T for leverage & studentized residuals
  const H = matMul(matMul(X, invXTX), XT);
  const leverages = H.map((row, i) => Math.max(0, Math.min(1, row[i])));

  // Pure Error & Lack of Fit calculation (group duplicate factor combinations)
  const pointGroups: { [key: string]: number[] } = {};
  validRuns.forEach(({ run }, idx) => {
    const key = activeFactors.map((f) => run.factorCoded[f.code]?.toFixed(3) ?? '0').join('|');
    if (!pointGroups[key]) pointGroups[key] = [];
    pointGroups[key].push(yActual[idx]);
  });

  let ssPureError = 0;
  let dfPureError = 0;
  Object.values(pointGroups).forEach((group) => {
    if (group.length > 1) {
      const gMean = group.reduce((a, b) => a + b, 0) / group.length;
      const gSS = group.reduce((sum, val) => sum + Math.pow(val - gMean, 2), 0);
      ssPureError += gSS;
      dfPureError += group.length - 1;
    }
  });

  const ssLackOfFit = Math.max(0, ssResidual - ssPureError);
  const dfLackOfFit = Math.max(0, dfResidual - dfPureError);
  const msPureError = dfPureError > 0 ? ssPureError / dfPureError : 0;
  const msLackOfFit = dfLackOfFit > 0 ? ssLackOfFit / dfLackOfFit : 0;

  const fLackOfFit = msPureError > 0 && dfLackOfFit > 0 ? msLackOfFit / msPureError : undefined;
  const pLackOfFit =
    fLackOfFit !== undefined ? fDistributionPValue(fLackOfFit, dfLackOfFit, dfPureError) : undefined;

  // Sequential (Type I) ANOVA blocks.  These are fitted nested models, rather
  // than distributing the model SS in proportion to the number of terms.
  const modelBlocks = getModelBlockCounts(activeFactors, modelType);
  const linearCount = modelBlocks.linear;
  const linearDF = linearCount - (hasExplicitIntercept ? 0 : 1);
  const interactionCount = modelBlocks.interactions;
  const quadraticCount = modelBlocks.quadratic;

  const vifs = calculateVIFs(X, hasExplicitIntercept ? 1 : 0);

  // Compute Term Statistics (SE, t-value, p-value)
  const regressionTerms: RegressionTerm[] = terms.map((t, idx) => {
    const coeff = Beta[idx][0];
    const c_jj = Math.max(0, invXTX[idx][idx]);
    const se = Math.sqrt(msResidual * c_jj);
    const tVal = se > 0 ? coeff / se : 0;
    const pVal = tDistributionPValue(tVal, dfResidual);

    return {
      name: t.name,
      factorCodes: t.factorCodes,
      power: t.power,
      coefficient: coeff,
      stdError: se,
      tValue: tVal,
      pValue: pVal,
      vif: hasExplicitIntercept && idx === 0 ? 1 : vifs[idx],
      significant: pVal < 0.05,
    };
  });

  // Diagnostic Metrics
  let press = 0;
  const residualDetails = validRuns.map(({ run }, i) => {
    const act = yActual[i];
    const pred = yPred[i];
    const res = residuals[i];
    const h_ii = leverages[i];
    const press_i = 1 - h_ii > 1e-6 ? res / (1 - h_ii) : res;
    press += Math.pow(press_i, 2);

    const stdRes = msResidual > 0 ? res / Math.sqrt(msResidual) : 0;
    const denom = Math.sqrt(msResidual * Math.max(1e-6, 1 - h_ii));
    const studentized = denom > 0 ? res / denom : 0;

    // Cook's Distance
    const cooks =
      p > 0 && 1 - h_ii > 1e-6
        ? (Math.pow(studentized, 2) / p) * (h_ii / (1 - h_ii))
        : 0;

    return {
      runOrder: run.runOrder,
      actual: act,
      predicted: pred,
      residual: res,
      stdResidual: stdRes,
      studentizedResidual: studentized,
      cooksDistance: cooks,
      leverage: h_ii,
    };
  });

  const rSquared = ssTotal > 0 ? Math.max(0, Math.min(1, 1 - ssResidual / ssTotal)) : 0;
  const adjRSquared =
    dfTotal > 0 && dfResidual > 0
      ? 1 - (ssResidual / dfResidual) / (ssTotal / dfTotal)
      : Number.NaN;
  const predRSquared = ssTotal > 0 ? 1 - press / ssTotal : Number.NaN;
  const qSquared = predRSquared; // Slide 12 Q^2 (PRESS-based Leave-One-Out R^2)

  const infoCrit = calculateInformationCriteria(n, p, ssResidual);

  const yRange = Math.max(...yPred) - Math.min(...yPred);
  const averagePredictionError = leverages.reduce(
    (sum, leverage) => sum + Math.sqrt(Math.max(0, msResidual * leverage)),
    0
  ) / n;
  const adeqPrecision = averagePredictionError > 0 ? yRange / averagePredictionError : 0;

  const stdDev = Math.sqrt(msResidual);
  const cvPercent = yMean !== 0 ? (stdDev / yMean) * 100 : 0;

  // Build ANOVA Table
  const anova: ANOVASource[] = [
    {
      source: 'Model',
      ss: ssModel,
      df: dfModel,
      ms: msModel,
      fValue: fModel,
      pValue: pModel,
    },
  ];

  // Mixture bases omit an explicit intercept, but their components sum to one.
  // Use a constant-only baseline for sequential sums of squares rather than
  // treating the first mixture component as an intercept.
  const interceptX = hasExplicitIntercept ? X.map((row) => [row[0]]) : X.map(() => [1]);
  const linearEnd = (hasExplicitIntercept ? 1 : 0) + linearCount;
  const linearX = X.map((row) => row.slice(0, linearEnd));
  const interactionEnd = linearEnd + interactionCount;
  const interactionX = X.map((row) => row.slice(0, interactionEnd));
  const sseIntercept = calculateSSE(interceptX, Y);
  const sseLinear = calculateSSE(linearX, Y);
  const sse2FI = interactionCount > 0 ? calculateSSE(interactionX, Y) : sseLinear;

  if (linearDF > 0) {
    const ssLinear = Math.max(0, sseIntercept - sseLinear);
    const msLinear = ssLinear / linearDF;
    const fLinear = msResidual > 0 ? msLinear / msResidual : undefined;
    const pLinear = fLinear !== undefined && dfResidual > 0 ? fDistributionPValue(fLinear, linearDF, dfResidual) : undefined;
    anova.push({
      source: 'Linear (Sequential)',
      ss: ssLinear,
      df: linearDF,
      ms: msLinear,
      fValue: fLinear,
      pValue: pLinear,
    });
  }
  if (interactionCount > 0) {
    const ss2FIBlock = Math.max(0, sseLinear - sse2FI);
    const ms2FI = ss2FIBlock / interactionCount;
    const f2FI = msResidual > 0 ? ms2FI / msResidual : undefined;
    const p2FI = f2FI !== undefined && dfResidual > 0 ? fDistributionPValue(f2FI, interactionCount, dfResidual) : undefined;
    anova.push({
      source: '2-Factor Interaction (Sequential)',
      ss: ss2FIBlock,
      df: interactionCount,
      ms: ms2FI,
      fValue: f2FI,
      pValue: p2FI,
    });
  }
  if (quadraticCount > 0) {
    const ssQuad = Math.max(0, sse2FI - ssResidual);
    const msQuad = ssQuad / quadraticCount;
    const fQuad = msResidual > 0 ? msQuad / msResidual : undefined;
    const pQuad = fQuad !== undefined && dfResidual > 0 ? fDistributionPValue(fQuad, quadraticCount, dfResidual) : undefined;
    anova.push({
      source: 'Quadratic (Sequential)',
      ss: ssQuad,
      df: quadraticCount,
      ms: msQuad,
      fValue: fQuad,
      pValue: pQuad,
    });
  }

  anova.push({
    source: 'Residual',
    ss: ssResidual,
    df: dfResidual,
    ms: msResidual,
  });

  if (dfPureError > 0) {
    anova.push({
      source: 'Lack of Fit',
      ss: ssLackOfFit,
      df: dfLackOfFit,
      ms: msLackOfFit,
      fValue: fLackOfFit,
      pValue: pLackOfFit,
    });
    anova.push({
      source: 'Pure Error',
      ss: ssPureError,
      df: dfPureError,
      ms: msPureError,
    });
  }

  anova.push({
    source: 'Cor Total',
    ss: ssTotal,
    df: dfTotal,
    ms: ssTotal / dfTotal,
  });

  // Curvature Test for factorial designs with center points
  let curvatureTest: (ANOVASource & { significant: boolean; note: string }) | undefined = undefined;

  const isCenterPoint = (item: (typeof validRuns)[number]) => {
    return activeFactors.every((f) => Math.abs(item.run.factorCoded[f.code] ?? 0) <= 0.08);
  };
  const isFactorialCorner = (item: (typeof validRuns)[number]) => activeFactors.every((factor) =>
    Math.abs(Math.abs(item.run.factorCoded[factor.code] ?? 0) - 1) <= 0.08
  );
  const centerPointRuns = validRuns.filter(isCenterPoint);
  const factorialRuns = validRuns.filter(isFactorialCorner);
  const supportsClassicalCurvature =
    !activeFactors.some((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture') &&
    validRuns.every((item) => isCenterPoint(item) || isFactorialCorner(item));

  const nC = centerPointRuns.length;
  const nF = factorialRuns.length;

  if (supportsClassicalCurvature && nC >= 2 && nF >= 2) {
    const yCenterMean =
      centerPointRuns.reduce((sum, r) => sum + (r.parsedY ?? 0), 0) / nC;
    const yFactMean =
      factorialRuns.reduce((sum, r) => sum + (r.parsedY ?? 0), 0) / nF;

    const ssCurvature = (nF * nC * Math.pow(yFactMean - yCenterMean, 2)) / (nF + nC);
    const dfCurvature = 1;
    const msCurvature = ssCurvature;

    const errMS = dfPureError > 0 && msPureError > 0 ? msPureError : msResidual > 0 ? msResidual : 1e-6;
    const errDF = dfPureError > 0 ? dfPureError : dfResidual;

    const fCurvature = msCurvature / errMS;
    const pCurvature = fDistributionPValue(fCurvature, dfCurvature, errDF);
    const isSig = pCurvature < 0.05;

    curvatureTest = {
      source: 'Curvature (Độ Cong)',
      ss: ssCurvature,
      df: dfCurvature,
      ms: msCurvature,
      fValue: fCurvature,
      pValue: pCurvature,
      significant: isSig,
      note: isSig
        ? 'Phát hiện độ cong phi tuyến có ý nghĩa thống kê (p < 0.05). Khuyến nghị sử dụng mô hình Đa thức bậc 2 (Quadratic/RSM) hoặc Mạng Nơ-ron AI.'
        : 'Không phát hiện độ cong có ý nghĩa thống kê (p ≥ 0.05). Mô hình tuyến tính/tương tác phù hợp.',
    };
  }

  // Construct Equation String
  const equationParts: string[] = [];
  regressionTerms.forEach((term, idx) => {
    const coeff = term.coefficient;
    const sign = coeff >= 0 ? (idx === 0 ? '' : '+ ') : '- ';
    const absCoeff = Math.abs(coeff).toFixed(3);
    if (term.name === 'Intercept') {
      equationParts.push(`${coeff < 0 ? '-' : ''}${absCoeff}`);
    } else {
      equationParts.push(`${sign}${absCoeff}·${term.name}`);
    }
  });
  const equationString = `${cqa.name} (${cqa.code}) = ${equationParts.join(' ')}`;

  // Prediction function
  const predict = (coded: Record<string, number>): number => {
    let result = 0;
    terms.forEach((t, i) => {
      result += Beta[i][0] * t.evaluator(coded);
    });
    return result;
  };

  const predictStandardError = (coded: Record<string, number>): number => {
    const x0 = terms.map((term) => term.evaluator(coded));
    const varianceMultiplier = x0.reduce(
      (sum, value, i) => sum + value * x0.reduce((inner, other, j) => inner + invXTX[i][j] * other, 0),
      0
    );
    return Math.sqrt(Math.max(0, msResidual * varianceMultiplier));
  };

  return {
    cqaCode: cqa.code,
    modelType,
    terms: regressionTerms,
    anova,
    curvatureTest,
    diagnostics: {
      rSquared,
      adjRSquared,
      predRSquared,
      qSquared,
      adeqPrecision,
      press,
      stdDev,
      mean: yMean,
      cvPercent,
      aicc: infoCrit.aicc,
      bic: infoCrit.bic,
      logLikelihood: infoCrit.logLikelihood,
      twoLL: infoCrit.twoLL,
      fLOF: fLackOfFit,
      pLOF: pLackOfFit,
      ssLOF: ssLackOfFit,
      dfLOF: dfLackOfFit,
      msLOF: msLackOfFit,
      ssPureError: ssPureError,
      dfPureError: dfPureError,
      msPureError: msPureError,
      residuals: residualDetails,
    },
    equationString,
    predict,
    predictStandardError,
    residualDegreesOfFreedom: dfResidual,
  };
}

/**
 * Compare the complete hierarchical polynomial families available in the UI.
 * AICc drives fit comparison, while residual df, Q² and lack-of-fit act as
 * guardrails.  If candidates are within 2 AICc units, the simpler hierarchy is
 * selected to avoid spending precision on unsupported curvature.
 */
export function assessModelCandidates(cqa: CQA, factors: Factor[], runs: DoERun[]): AnalysisWizardResult {
  const modelTypes: ModelCandidateAssessment['modelType'][] = ['Linear', '2FI', 'Quadratic'];
  const candidates = modelTypes.map((modelType): ModelCandidateAssessment => {
    const model = fitModel(cqa, factors, runs, modelType);
    if (!model) {
      return {
        modelType,
        model: null,
        isHierarchical: true,
        residualDegreesOfFreedom: 0,
        aicc: null,
        qSquared: null,
        lackOfFitPValue: null,
        outlierRunOrders: [],
        influentialRunOrders: [],
        highLeverageRunOrders: [],
        adequate: false,
        reasons: ['Không đủ số liệu, bậc tự do dư hoặc ma trận không full-rank.'],
      };
    }
    const residuals = model.diagnostics.residuals;
    const parameterCount = model.terms.length;
    const n = Math.max(1, residuals.length);
    const outlierRunOrders = residuals.filter((item) => Math.abs(item.studentizedResidual) >= 3).map((item) => item.runOrder);
    const influentialRunOrders = residuals.filter((item) => item.cooksDistance > 4 / n).map((item) => item.runOrder);
    const highLeverageRunOrders = residuals.filter((item) => item.leverage > (2 * parameterCount) / n).map((item) => item.runOrder);
    const df = model.residualDegreesOfFreedom ?? 0;
    const aicc = Number.isFinite(model.diagnostics.aicc) ? model.diagnostics.aicc! : null;
    const qSquared = model.diagnostics.qSquared ?? model.diagnostics.predRSquared;
    const lackOfFitPValue = model.diagnostics.pLOF ?? null;
    const reasons: string[] = [];
    if (df < 4) reasons.push(`Chỉ còn ${df} df dư; kết luận cần thận trọng.`);
    if (qSquared < 0) reasons.push('Q² âm: mô hình dự báo kém hơn trung bình quan sát.');
    if (lackOfFitPValue !== null && lackOfFitPValue < 0.05) reasons.push('Lack-of-fit có ý nghĩa (p < 0,05).');
    if (outlierRunOrders.length > 0) reasons.push(`Cần rà soát phần dư lớn ở run ${outlierRunOrders.join(', ')}.`);
    if (influentialRunOrders.length > 0) reasons.push(`Cần rà soát điểm ảnh hưởng ở run ${influentialRunOrders.join(', ')}.`);
    return {
      modelType,
      model,
      isHierarchical: true,
      residualDegreesOfFreedom: df,
      aicc,
      qSquared,
      lackOfFitPValue,
      outlierRunOrders,
      influentialRunOrders,
      highLeverageRunOrders,
      adequate: df >= 4 && qSquared >= 0 && (lackOfFitPValue === null || lackOfFitPValue >= 0.05),
      reasons,
    };
  });
  const usable = candidates.filter((candidate) => candidate.model && candidate.adequate && candidate.aicc !== null);
  const fallback = candidates.filter((candidate) => candidate.model && candidate.aicc !== null);
  const ranked = (usable.length > 0 ? usable : fallback).sort((first, second) => (first.aicc! - second.aicc!) || first.model!.terms.length - second.model!.terms.length);
  const best = ranked[0] ?? null;
  const recommended = best
    ? ranked.filter((candidate) => candidate.aicc! <= best.aicc! + 2)
      .sort((first, second) => first.model!.terms.length - second.model!.terms.length)[0]
    : null;
  const warnings: string[] = [];
  if (!recommended) warnings.push('Chưa có mô hình OLS hợp lệ để so sánh. Hãy bổ sung dữ liệu hoặc giảm bậc mô hình.');
  else if (!recommended.adequate) warnings.push('Không có mô hình nào qua toàn bộ ngưỡng kiểm tra; đề xuất được chọn theo AICc chỉ để khởi đầu, không phải kết luận cuối cùng.');
  if (recommended && best && recommended.modelType !== best.modelType) warnings.push('Chọn mô hình đơn giản hơn vì AICc chênh không quá 2 đơn vị.');
  return { candidates, recommended, warnings };
}

/** Build a transparent confirmation-run plan from the best observed setting. */
export function buildConfirmationPlan(cqa: CQA, model: StatisticalModelResult, runs: DoERun[]): ConfirmationPlan | null {
  const eligible = runs.filter((run) => {
    const raw = run.responses[cqa.code];
    return typeof raw === 'number' ? Number.isFinite(raw) : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw));
  });
  if (eligible.length === 0) return null;
  const target = cqa.target ?? (cqa.lowerLimit !== undefined && cqa.upperLimit !== undefined ? (cqa.lowerLimit + cqa.upperLimit) / 2 : undefined);
  const score = (run: DoERun): number => {
    const value = Number(run.responses[cqa.code]);
    if (cqa.objective === 'minimize') return value;
    if (cqa.objective === 'maximize') return -value;
    return Math.abs(value - (target ?? value));
  };
  const source = [...eligible].sort((first, second) => score(first) - score(second))[0];
  const predictedResponse = model.predict(source.factorCoded);
  const seMean = model.predictStandardError?.(source.factorCoded);
  const df = model.residualDegreesOfFreedom ?? 0;
  const critical = df > 0 ? tDistributionCritical(0.05, df) : Number.NaN;
  const meanHalfWidth = seMean !== undefined && Number.isFinite(critical) ? critical * seMean : Number.NaN;
  const predictionHalfWidth = seMean !== undefined && Number.isFinite(critical)
    ? critical * Math.sqrt(seMean * seMean + model.diagnostics.stdDev * model.diagnostics.stdDev)
    : Number.NaN;
  const criterion = cqa.lowerLimit !== undefined || cqa.upperLimit !== undefined
    ? `Kết quả trung bình xác nhận phải nằm trong ${cqa.lowerLimit ?? '-∞'} đến ${cqa.upperLimit ?? '+∞'} ${cqa.unit}.`
    : cqa.objective === 'target' || cqa.objective === 'range'
      ? `Kết quả trung bình xác nhận nên gần mục tiêu ${target ?? 'đã xác định'} ${cqa.unit}.`
      : `Xác nhận xu hướng ${cqa.objective === 'minimize' ? 'giảm' : 'tăng'} so với các run đã quan sát.`;
  return {
    sourceRunOrder: source.runOrder,
    sourceBlock: source.block,
    factorActual: source.factorActual,
    predictedResponse,
    meanConfidenceInterval: Number.isFinite(meanHalfWidth) ? { low: predictedResponse - meanHalfWidth, high: predictedResponse + meanHalfWidth } : null,
    individualPredictionInterval: Number.isFinite(predictionHalfWidth) ? { low: predictedResponse - predictionHalfWidth, high: predictedResponse + predictionHalfWidth } : null,
    recommendedReplicates: df >= 8 ? 3 : 5,
    acceptanceCriterion: criterion,
  };
}

/**
 * Project and clip mixture proportions onto the bounded simplex:
 * l_i <= p_i <= u_i  AND  sum(p_i) = total
 */
export function projectToBoundedMixture(
  p: number[],
  l: number[],
  u: number[],
  total: number = 1.0
): number[] {
  const n = p.length;
  if (l.length !== n || u.length !== n) return [];
  if (!isFeasibleBoundedMixture(l, u, total)) return [];
  if (n === 0) return [];
  if (n === 1) return [Math.max(l[0], Math.min(u[0], total))];

  // Clip to [l_i, u_i]
  let current = p.map((val, i) => Math.max(l[i], Math.min(u[i], val)));

  // Iterative projection onto simplex hyperplane sum(p_i) = total
  for (let iter = 0; iter < n + 5; iter++) {
    const curSum = current.reduce((a, b) => a + b, 0);
    const diff = total - curSum;
    if (Math.abs(diff) < 1e-6) break;

    // Find indices of variables that can be adjusted
    const freeIndices = current
      .map((val, i) => (diff > 0 ? (val < u[i] - 1e-6 ? i : -1) : (val > l[i] + 1e-6 ? i : -1)))
      .filter((i) => i >= 0);

    if (freeIndices.length === 0) break;

    const delta = diff / freeIndices.length;
    freeIndices.forEach((i) => {
      current[i] = Math.max(l[i], Math.min(u[i], current[i] + delta));
    });
  }

  return current.map((v) => Number(v.toFixed(10)));
}

/** Return the mixture factors in their project order. */
export function getMixtureFactors(factors: Factor[]): Factor[] {
  return factors.filter((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
}

function mixtureBoundsAsProportions(factors: Factor[]): { low: number[]; high: number[] } {
  return {
    low: factors.map((factor) => (factor.high <= 1 && factor.unit !== '%' ? factor.low : factor.low / 100)),
    high: factors.map((factor) => (factor.high <= 1 && factor.unit !== '%' ? factor.high : factor.high / 100)),
  };
}

/**
 * Projects all mixture fields in a coded point to the bounded simplex.  Use this
 * at UI boundaries as well as in numerical routines: a response surface may
 * never evaluate a composition whose components do not sum to 100%.
 */
export function normalizeMixtureCoded(
  coded: Record<string, number>,
  factors: Factor[],
): Record<string, number> {
  const mixture = getMixtureFactors(factors);
  if (mixture.length < 2) return { ...coded };
  const { low, high } = mixtureBoundsAsProportions(mixture);
  const candidate = mixture.map((factor, index) => {
    const fallback = (low[index] + high[index]) / 2;
    return Number.isFinite(coded[factor.code]) ? coded[factor.code] : fallback;
  });
  const projected = projectToBoundedMixture(candidate, low, high, 1);
  if (projected.length !== mixture.length) return { ...coded };
  const normalized = { ...coded };
  mixture.forEach((factor, index) => {
    normalized[factor.code] = projected[index];
  });
  return normalized;
}

/**
 * Set one mixture component while preserving the simplex and all component
 * bounds.  The selected component is retained whenever it is feasible; the
 * remaining components are projected only over the residual total.
 */
export function setBoundedMixtureComponent(
  coded: Record<string, number>,
  factors: Factor[],
  factorCode: string,
  requestedValue: number,
): Record<string, number> {
  const mixture = getMixtureFactors(factors);
  const selectedIndex = mixture.findIndex((factor) => factor.code === factorCode);
  if (mixture.length < 2 || selectedIndex < 0) return { ...coded, [factorCode]: requestedValue };

  const { low, high } = mixtureBoundsAsProportions(mixture);
  if (!isFeasibleBoundedMixture(low, high)) return normalizeMixtureCoded(coded, factors);
  const otherIndices = mixture.map((_, index) => index).filter((index) => index !== selectedIndex);
  const otherLow = otherIndices.reduce((sum, index) => sum + low[index], 0);
  const otherHigh = otherIndices.reduce((sum, index) => sum + high[index], 0);
  const selected = Math.max(
    low[selectedIndex],
    Math.min(high[selectedIndex], Math.max(1 - otherHigh, Math.min(1 - otherLow, requestedValue))),
  );
  const remaining = otherIndices.map((index) => {
    const fallback = (low[index] + high[index]) / 2;
    return Number.isFinite(coded[mixture[index].code]) ? coded[mixture[index].code] : fallback;
  });
  const projectedOthers = projectToBoundedMixture(
    remaining,
    otherIndices.map((index) => low[index]),
    otherIndices.map((index) => high[index]),
    1 - selected,
  );
  const next = { ...coded, [factorCode]: Number(selected.toFixed(10)) };
  otherIndices.forEach((index, otherIndex) => {
    next[mixture[index].code] = Number((projectedOthers[otherIndex] ?? low[index]).toFixed(10));
  });
  return next;
}

/** Feasible range for a component after accounting for all other bounds. */
export function getFeasibleMixtureComponentRange(
  factors: Factor[],
  factorCode: string,
): { low: number; high: number } | null {
  const mixture = getMixtureFactors(factors);
  const selectedIndex = mixture.findIndex((factor) => factor.code === factorCode);
  if (mixture.length < 2 || selectedIndex < 0) return null;
  const { low, high } = mixtureBoundsAsProportions(mixture);
  const otherLow = low.reduce((sum, value, index) => index === selectedIndex ? sum : sum + value, 0);
  const otherHigh = high.reduce((sum, value, index) => index === selectedIndex ? sum : sum + value, 0);
  return {
    low: Math.max(low[selectedIndex], 1 - otherHigh),
    high: Math.min(high[selectedIndex], 1 - otherLow),
  };
}

export function isFeasibleBoundedMixture(l: number[], u: number[], total: number = 1): boolean {
  if (l.length === 0 || l.length !== u.length || !Number.isFinite(total)) return false;
  if (l.some((value, index) => !Number.isFinite(value) || !Number.isFinite(u[index]) || value > u[index])) return false;
  const sumL = l.reduce((sum, value) => sum + value, 0);
  const sumU = u.reduce((sum, value) => sum + value, 0);
  return sumL <= total + 1e-10 && sumU >= total - 1e-10;
}

/**
 * Check if coded factor set satisfies all individual survey boundaries [L_i, U_i]
 */
export function isWithinSurveyBounds(
  coded: Record<string, number>,
  factors: Factor[]
): boolean {
  let mixtureTotal = 0;
  let mixtureCount = 0;
  for (const f of factors) {
    if (f.controllability === 'constant') continue;
    const isMixture = f.role === 'mixture_component' || f.type === 'Mixture';
    if (isMixture) {
      const lowPct = f.high <= 1.0 && f.unit !== '%' ? f.low * 100 : f.low;
      const highPct = f.high <= 1.0 && f.unit !== '%' ? f.high * 100 : f.high;
      const valProp = coded[f.code] ?? 0;
      const valPct = valProp * 100;
      // Allow slight numerical tolerance 0.05%
      if (valPct < lowPct - 0.05 || valPct > highPct + 0.05) {
        return false;
      }
      mixtureTotal += valProp;
      mixtureCount++;
    } else {
      const c = coded[f.code] ?? 0;
      if (c < -1.05 || c > 1.05) {
        return false;
      }
    }
  }
  return mixtureCount < 2 || Math.abs(mixtureTotal - 1) <= 1e-6;
}

/**
 * Multi-Response Desirability Optimization (Derringer & Suich)
 * Finds the global optimum factor combination strictly within the survey region [L_i, U_i]
 */
export function optimizeDesirability(
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  lockedFactors?: Record<string, number>,
  seed: number = 20260827,
): DesirabilitySolution | null {
  if (cqas.some((c) => !models[c.code])) return null;
  const validCQAs = cqas;

  const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
  const random = createSeededRandom(seed);
  const k = factors.length;

  const evaluateOverallDesirability = (coded: Record<string, number>): { dOverall: number; dMap: Record<string, number> } => {
    // 1. Strict Survey Boundary Check: Reject any point outside the experimental bounding box
    if (!isWithinSurveyBounds(coded, factors)) {
      return { dOverall: 0, dMap: {} };
    }

    let logSum = 0;
    const dMap: Record<string, number> = {};

    for (const cqa of validCQAs) {
      const model = models[cqa.code];
      const yPred = model.predict(coded);
      const di = calculateIndividualDesirability(
        yPred,
        cqa.objective,
        cqa.lowerLimit,
        cqa.upperLimit,
        cqa.target,
        cqa.sShape || 1.0,
        cqa.tShape || 1.0
      );
      dMap[cqa.code] = di;
      if (di <= 0) return { dOverall: 0, dMap };
      logSum += (cqa.weight || 1) * Math.log(di);
    }

    const dOverall = Math.exp(logSum / totalWeight);
    return { dOverall, dMap };
  };

  // Identify mixture and process factors and their survey bounds
  const mixFactors = factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const procFactors = factors.filter(
    (f) => f.role !== 'mixture_component' && f.type !== 'Mixture' && f.controllability === 'controllable'
  );
  const hasMixture = mixFactors.length >= 2;

  const mixLowProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.low : f.low / 100));
  const mixHighProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.high : f.high / 100));
  if (hasMixture && !isFeasibleBoundedMixture(mixLowProps, mixHighProps)) return null;

  let bestD = -1;
  let bestCoded: Record<string, number> = {};
  let bestDMap: Record<string, number> = {};

  // 1. Seed candidate with Feasible Polytope Centroid
  const initialCandidate: Record<string, number> = {};
  factors
    .filter((f) => f.controllability === 'uncontrollable_noise')
    .forEach((f) => { initialCandidate[f.code] = 0; });
  procFactors.forEach((f) => {
    initialCandidate[f.code] = lockedFactors && lockedFactors[f.code] !== undefined ? lockedFactors[f.code] : 0.0;
  });

  if (hasMixture) {
    const rawMid = mixFactors.map((f, i) => (lockedFactors && lockedFactors[f.code] !== undefined ? lockedFactors[f.code] : (mixLowProps[i] + mixHighProps[i]) / 2));
    const projMid = projectToBoundedMixture(rawMid, mixLowProps, mixHighProps, 1.0);
    mixFactors.forEach((f, i) => {
      initialCandidate[f.code] = projMid[i];
    });
  } else if (mixFactors.length === 1) {
    initialCandidate[mixFactors[0].code] = 1.0;
  }

  const { dOverall: initD, dMap: initDMap } = evaluateOverallDesirability(initialCandidate);
  if (initD > bestD) {
    bestD = initD;
    bestCoded = { ...initialCandidate };
    bestDMap = { ...initDMap };
  }

  // 2. High-Density Grid Exploration inside the Survey Bounds [L_i, U_i]
  const gridSteps = k <= 3 ? 18 : (k <= 4 ? 12 : 7);

  const exploreGrid = (factorIdx: number, currentCoded: Record<string, number>) => {
    if (factorIdx >= k) {
      let evalCoded = { ...currentCoded };
      if (hasMixture) {
        const rawVals = mixFactors.map((f) => evalCoded[f.code] ?? 0);
        const projVals = projectToBoundedMixture(rawVals, mixLowProps, mixHighProps, 1.0);
        mixFactors.forEach((f, i) => {
          evalCoded[f.code] = projVals[i];
        });
      }
      const { dOverall, dMap } = evaluateOverallDesirability(evalCoded);
      if (dOverall > bestD) {
        bestD = dOverall;
        bestCoded = { ...evalCoded };
        bestDMap = { ...dMap };
      }
      return;
    }

    const factor = factors[factorIdx];
    if (lockedFactors && lockedFactors[factor.code] !== undefined) {
      currentCoded[factor.code] = lockedFactors[factor.code];
      exploreGrid(factorIdx + 1, currentCoded);
    } else if (factor.controllability !== 'controllable') {
      currentCoded[factor.code] = 0;
      exploreGrid(factorIdx + 1, currentCoded);
    } else {
      const isMix = factor.role === 'mixture_component' || factor.type === 'Mixture';
      const lowVal = isMix ? (factor.high <= 1.0 && factor.unit !== '%' ? factor.low : factor.low / 100) : -1.0;
      const highVal = isMix ? (factor.high <= 1.0 && factor.unit !== '%' ? factor.high : factor.high / 100) : 1.0;

      for (let step = 0; step < gridSteps; step++) {
        const val = lowVal + (step / (gridSteps - 1)) * (highVal - lowVal);
        currentCoded[factor.code] = Number(val.toFixed(4));
        exploreGrid(factorIdx + 1, currentCoded);
      }
    }
  };

  exploreGrid(0, {});

  // 3. Multi-Start Local Fine-Tuning strictly inside Bounded Simplex
  const numStarts = 400;
  for (let iter = 0; iter < numStarts; iter++) {
    const candidateCoded: Record<string, number> = {};
    procFactors.forEach((f) => {
      if (lockedFactors && lockedFactors[f.code] !== undefined) {
        candidateCoded[f.code] = lockedFactors[f.code];
      } else {
        const current = bestCoded[f.code] ?? 0;
        const jitter = (random() - 0.5) * 0.25;
        candidateCoded[f.code] = Math.max(-1.0, Math.min(1.0, Number((current + jitter).toFixed(4))));
      }
    });

    if (hasMixture) {
      const rawJittered = mixFactors.map((f, i) => {
        if (lockedFactors && lockedFactors[f.code] !== undefined) {
          return lockedFactors[f.code];
        }
        const current = bestCoded[f.code] ?? (mixLowProps[i] + mixHighProps[i]) / 2;
        const range = mixHighProps[i] - mixLowProps[i];
        const jitter = (random() - 0.5) * range * 0.4;
        return current + jitter;
      });

      const proj = projectToBoundedMixture(rawJittered, mixLowProps, mixHighProps, 1.0);
      mixFactors.forEach((f, i) => {
        candidateCoded[f.code] = proj[i];
      });
    }

    const { dOverall, dMap } = evaluateOverallDesirability(candidateCoded);
    if (dOverall > bestD) {
      bestD = dOverall;
      bestCoded = { ...candidateCoded };
      bestDMap = { ...dMap };
    }
  }

  // Calculate actual factor values and predicted responses with CI
  const actualFactors: Record<string, number | string> = {};
  factors.forEach((f) => {
    if (f.controllability === 'constant') {
      actualFactors[f.code] = f.constantValue ?? f.low;
    } else if (f.role === 'mixture_component' || f.type === 'Mixture') {
      const frac = bestCoded[f.code] ?? (1 / mixFactors.length);
      actualFactors[f.code] = f.high <= 1.0 && f.unit !== '%'
        ? Number(frac.toFixed(4))
        : Number((frac * 100).toFixed(2));
    } else {
      const c = bestCoded[f.code] ?? 0;
      if (f.dataType === 'qualitative' && f.categories && f.categories.length > 0) {
        if (c <= -0.5) actualFactors[f.code] = f.categories[0];
        else if (c >= 0.5) actualFactors[f.code] = f.categories[1] || f.categories[0];
        else actualFactors[f.code] = f.categories[2] || f.categories[0];
      } else {
        const center = f.center !== undefined ? f.center : (f.low + f.high) / 2;
        const half = (f.high - f.low) / 2;
        actualFactors[f.code] = Number((center + c * half).toFixed(3));
      }
    }
  });

  const predictedResponses: Record<string, { value: number; se: number; ciLow: number; ciHigh: number; desirability: number }> = {};
  validCQAs.forEach((cqa) => {
    const model = models[cqa.code];
    const val = model.predict(bestCoded);
    const statisticalModel = 'predictStandardError' in model ? model : undefined;
    const se = statisticalModel?.predictStandardError?.(bestCoded) ?? (model.diagnostics as any).rmseVal ?? (model.diagnostics as any).rmseOverall;
    const df = statisticalModel?.residualDegreesOfFreedom;
    const critical = df && df > 0 ? tDistributionCritical(0.05, df) : Number.NaN;
    // Neural-network residual RMSE is not a parameter-estimation CI.  Preserve
    // the field for UI compatibility but do not label its interval as a CI.
    const ciHalfWidth = Number.isFinite(critical) && statisticalModel?.predictStandardError ? critical * se : Number.NaN;
    predictedResponses[cqa.code] = {
      value: Number(val.toFixed(3)),
      se: Number(se.toFixed(3)),
      ciLow: Number.isFinite(ciHalfWidth) ? Number((val - ciHalfWidth).toFixed(3)) : Number.NaN,
      ciHigh: Number.isFinite(ciHalfWidth) ? Number((val + ciHalfWidth).toFixed(3)) : Number.NaN,
      desirability: Number((bestDMap[cqa.code] ?? 0).toFixed(4)),
    };
  });

  return {
    codedFactors: bestCoded,
    actualFactors,
    predictedResponses,
    overallDesirability: Number(Math.max(0, bestD).toFixed(4)),
  };
}

/**
 * Monte Carlo Simulation to quantify Risk / Assurance of Quality (ICH Q9 / Q8)
 * Generates N virtual batches with normal variability around setpoints and predicts CQA defect rates
 */
export function runMonteCarloSimulation(
  setpointActual: Record<string, number | string>,
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  variabilityPercent: number = 2.0, // % RSD of process parameters
  simulations: number = 10000,
  seed: number = 20260827,
): MonteCarloResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const validCQAs = cqas.filter((c) => models[c.code]);
  let passCount = 0;
  let failCount = 0;

  const cqaValues: Record<string, number[]> = {};
  validCQAs.forEach((c) => {
    cqaValues[c.code] = [];
  });

  const mixFactors = factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const hasMixture = mixFactors.length >= 2;
  const mixLowProps = mixFactors.map((f) => (f.high <= 1 && f.unit !== '%' ? f.low : f.low / 100));
  const mixHighProps = mixFactors.map((f) => (f.high <= 1 && f.unit !== '%' ? f.high : f.high / 100));
  if (hasMixture && !isFeasibleBoundedMixture(mixLowProps, mixHighProps)) {
    throw new Error('Mixture bounds are infeasible: require Σlower ≤ 100% ≤ Σupper.');
  }

  const random = createSeededRandom(seed);
  const standardNormal = () => {
    const u1 = Math.max(1e-12, random());
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * random());
  };
  const valueToProportion = (factor: Factor, value: number) =>
    factor.high <= 1 && factor.unit !== '%' ? value : value / 100;

  // Preserve observed residual co-movement between CQAs when enough paired
  // residuals exist; otherwise the conservative fallback is independence.
  const residualMaps = validCQAs.map((cqa) => {
    const map = new Map<number, number>();
    ((models[cqa.code].diagnostics as any).residuals ?? []).forEach((residual: any) => {
      if (Number.isFinite(residual.residual)) map.set(residual.runOrder, residual.residual);
    });
    return map;
  });
  const correlation = validCQAs.map((_, i) => validCQAs.map((_, j) => {
    if (i === j) return 1;
    const paired = [...residualMaps[i]].flatMap(([runOrder, left]) => {
      const right = residualMaps[j].get(runOrder);
      return right === undefined ? [] : [[left, right] as [number, number]];
    });
    if (paired.length < 3) return 0;
    const meanLeft = paired.reduce((sum, pair) => sum + pair[0], 0) / paired.length;
    const meanRight = paired.reduce((sum, pair) => sum + pair[1], 0) / paired.length;
    const numerator = paired.reduce((sum, pair) => sum + (pair[0] - meanLeft) * (pair[1] - meanRight), 0);
    const denomLeft = Math.sqrt(paired.reduce((sum, pair) => sum + Math.pow(pair[0] - meanLeft, 2), 0));
    const denomRight = Math.sqrt(paired.reduce((sum, pair) => sum + Math.pow(pair[1] - meanRight, 2), 0));
    return denomLeft > 0 && denomRight > 0 ? Math.max(-0.95, Math.min(0.95, numerator / (denomLeft * denomRight))) : 0;
  }));
  const tryCholesky = (matrix: number[][]): number[][] | null => {
    const result = matrix.map((row) => new Array(row.length).fill(0));
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j <= i; j++) {
        const value = matrix[i][j] - Array.from({ length: j }, (_, k) => result[i][k] * result[j][k]).reduce((sum, item) => sum + item, 0);
        if (i === j) {
          if (value <= 1e-10) return null;
          result[i][j] = Math.sqrt(value);
        } else {
          result[i][j] = value / result[j][j];
        }
      }
    }
    return result;
  };
  // Pairwise residual correlations are not guaranteed positive definite.
  // Shrink them toward independence until Cholesky is mathematically valid.
  let correlationShrink = 1;
  let cholesky: number[][] | null = null;
  while (!cholesky && correlationShrink >= 0.05) {
    const candidate = correlation.map((row, i) => row.map((value, j) => i === j ? 1 : value * correlationShrink));
    cholesky = tryCholesky(candidate);
    correlationShrink *= 0.9;
  }
  cholesky ??= correlation.map((row, i) => row.map((_, j) => i === j ? 1 : 0));

  for (let s = 0; s < simulations; s++) {
    // Generate randomized factor actuals and convert to coded/proportion
    const sampleCoded: Record<string, number> = {};

    // 1. Process factors
    factors.forEach((f) => {
      if (f.controllability === 'constant') {
        const constNum = typeof f.constantValue === 'number' ? f.constantValue : Number(f.constantValue) || f.low;
        sampleCoded[f.code] = f.role === 'mixture_component' || f.type === 'Mixture' ? constNum / 100 : 0;
        return;
      }

      if (f.role === 'mixture_component' || f.type === 'Mixture') {
        // Will handle collectively below
        return;
      }

      const rawMean = setpointActual[f.code];
      const mean: number = typeof rawMean === 'number' ? rawMean : Number(rawMean) || (f.low + f.high) / 2;
      const scale = Math.max(Math.abs(mean), Math.abs(f.high - f.low) / 2);
      const sd = Math.max(1e-5, scale * (variabilityPercent / 100.0));

      // Box-Muller standard normal transform
      // Truncated normal sampling prevents extrapolation outside the proven
      // operating range while retaining stochastic process variation.
      let actualVal = mean;
      for (let attempt = 0; attempt < 100; attempt++) {
        actualVal = mean + standardNormal() * sd;
        if (actualVal >= f.low && actualVal <= f.high) break;
      }
      actualVal = Math.max(f.low, Math.min(f.high, actualVal));

      const center = f.center !== undefined ? f.center : (f.low + f.high) / 2;
      const half = (f.high - f.low) / 2;
      sampleCoded[f.code] = half > 0 ? (actualVal - center) / half : 0;
    });

    // 2. Mixture factors (sample & normalize to maintain 100% total)
    if (mixFactors.length > 0) {
      const sampledProps: number[] = [];
      mixFactors.forEach((f) => {
        if (f.controllability === 'constant') {
          const constNum = typeof f.constantValue === 'number' ? f.constantValue : Number(f.constantValue) || f.low;
          sampledProps.push(valueToProportion(f, constNum));
          return;
        }
        const rawMean = setpointActual[f.code];
        const mean: number = typeof rawMean === 'number' ? rawMean : Number(rawMean) || (f.low + f.high) / 2; // mean in %
        const sd = Math.max(1e-5, mean * (variabilityPercent / 100.0));

        const actualVal = Math.max(0, mean + standardNormal() * sd);
        sampledProps.push(valueToProportion(f, actualVal));
      });

      if (hasMixture) {
        const boundedProps = projectToBoundedMixture(sampledProps, mixLowProps, mixHighProps, 1.0);
        mixFactors.forEach((f, idx) => {
          sampleCoded[f.code] = boundedProps[idx];
        });
      } else {
        mixFactors.forEach((f, idx) => {
          sampleCoded[f.code] = sampledProps[idx];
        });
      }
    }

    // 3. Evaluate each CQA with True Gaussian Model Residual Noise
    let batchPass = true;
    const correlatedZ = new Array(validCQAs.length).fill(0);
    const independentZ = validCQAs.map(() => standardNormal());
    for (let i = 0; i < cholesky.length; i++) {
      correlatedZ[i] = cholesky[i].reduce((sum, coefficient, j) => sum + coefficient * independentZ[j], 0);
    }
    for (let cqaIndex = 0; cqaIndex < validCQAs.length; cqaIndex++) {
      const cqa = validCQAs[cqaIndex];
      const model = models[cqa.code];
      const residualStd = (model.diagnostics as any).stdDev ?? (model.diagnostics as any).rmseVal ?? (model.diagnostics as any).rmseOverall ?? 0.1;
      const meanPredictionSE = 'predictStandardError' in model ? model.predictStandardError?.(sampleCoded) ?? 0 : 0;
      const noiseStd = Math.sqrt(residualStd * residualStd + meanPredictionSE * meanPredictionSE);

      // Exact Box-Muller Gaussian Noise for model residual variance
      const resError = noiseStd * correlatedZ[cqaIndex];

      const yPred = model.predict(sampleCoded) + resError;
      cqaValues[cqa.code].push(yPred);

      if (cqa.lowerLimit !== undefined && yPred < cqa.lowerLimit) {
        batchPass = false;
      }
      if (cqa.upperLimit !== undefined && yPred > cqa.upperLimit) {
        batchPass = false;
      }
      if (cqa.objective === 'pass_category' && yPred < 90) batchPass = false;
    }

    if (batchPass) passCount++;
    else failCount++;
  }

  const defectRatePPM = Math.round((failCount / simulations) * 1_000_000);
  const reliabilityPercent = Number(((passCount / simulations) * 100).toFixed(2));

  const cqaStats: Record<string, any> = {};
  validCQAs.forEach((cqa) => {
    const vals = cqaValues[cqa.code];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, vals.length - 1));
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    let cpk: number | undefined = undefined;
    if (sd > 0) {
      if (cqa.lowerLimit !== undefined && cqa.upperLimit !== undefined) {
        const cpl = (mean - cqa.lowerLimit) / (3 * sd);
        const cpu = (cqa.upperLimit - mean) / (3 * sd);
        cpk = Number(Math.min(cpl, cpu).toFixed(2));
      } else if (cqa.lowerLimit !== undefined) {
        cpk = Number(((mean - cqa.lowerLimit) / (3 * sd)).toFixed(2));
      } else if (cqa.upperLimit !== undefined) {
        cpk = Number(((cqa.upperLimit - mean) / (3 * sd)).toFixed(2));
      }
    }

    let oosCount = 0;
    vals.forEach((v) => {
      if ((cqa.lowerLimit !== undefined && v < cqa.lowerLimit) || (cqa.upperLimit !== undefined && v > cqa.upperLimit)) {
        oosCount++;
      }
    });

    cqaStats[cqa.code] = {
      mean: Number(mean.toFixed(3)),
      sd: Number(sd.toFixed(3)),
      min: Number(min.toFixed(3)),
      max: Number(max.toFixed(3)),
      cpk,
      outOfSpecPercent: Number(((oosCount / simulations) * 100).toFixed(2)),
    };
  });

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const executionTimeMs = Number((endTime - startTime).toFixed(2));

  return {
    simulations,
    seed,
    variabilityPercent,
    passCount,
    failCount,
    defectRatePPM,
    reliabilityPercent,
    executionTimeMs,
    cqaStats,
  };
}

/**
 * Generate Updated Risk Assessment table (ICH Q9 / FDA ANDA Standard)
 * Compares Initial Risk (High/Medium) -> Updated Risk (Low/Medium) after DoE
 * with automated scientific justification.
 */
export function generateUpdatedRiskAssessment(
  project: QBDProject,
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>
): UpdatedRiskItem[] {
  const items: UpdatedRiskItem[] = [];

  project.factors.forEach((f) => {
    project.cqas.forEach((c) => {
      const model = models[c.code];
      let isSig = false;

      if (model) {
        if ('terms' in model) {
          // Statistical Model
          const term = model.terms.find((t) => t.factorCodes.includes(f.code));
          if (term && term.significant) {
            isSig = true;
          }
        } else if ('diagnostics' in model) {
          // Neural Net Model
          const diag = (model as any).diagnostics;
          const varImp = diag.variableImportance?.find((v: any) => v.factorCode === f.code);
          // ANN importance is a sensitivity screen, never a p-value.
          isSig = varImp ? varImp.relativeImportance >= 10 : false;
        }
      }

      // Initial Risk Determination (from prior risk matrix or factor criticality)
      const isCriticalRole = f.role === 'mixture_component' || f.controllability === 'controllable';
      const isHighCriticalCQA = c.weight >= 4 || c.objective === 'target';
      const linkedFmea = project.fmeaRisks.filter((risk) => risk.factorId === f.id && risk.cqaId === c.id);
      const initialRisk: 'High' | 'Medium' | 'Low' = linkedFmea.length > 0
        ? linkedFmea.some((risk) => risk.riskLevel === 'High') ? 'High' : linkedFmea.some((risk) => risk.riskLevel === 'Medium') ? 'Medium' : 'Low'
        : isCriticalRole && isHighCriticalCQA ? 'High' : isCriticalRole || isHighCriticalCQA ? 'Medium' : 'Low';
      const isPolynomial = Boolean(model && 'predictStandardError' in model);
      const diagnostics = model?.diagnostics as any;
      const q2 = diagnostics?.qSquared ?? diagnostics?.predRSquared;
      const lof = diagnostics?.pLOF;
      const modelAdequate = isPolynomial
        ? ((model as StatisticalModelResult | undefined)?.residualDegreesOfFreedom ?? 0) >= 4 && Number.isFinite(q2) && q2 >= 0 && (lof === undefined || lof === null || lof >= 0.05)
        : Number.isFinite(diagnostics?.rSquaredVal) && diagnostics.rSquaredVal >= 0.5;
      // A model alone never authorizes a risk downgrade.  Confirmation data and
      // approved controls are required; retain medium risk when any evidence is missing.
      const updatedRisk: 'Low' | 'Medium' = initialRisk === 'Low' && modelAdequate ? 'Low' : 'Medium';
      const evidence = isPolynomial
        ? `OLS: df dư ${(model as StatisticalModelResult | undefined)?.residualDegreesOfFreedom ?? 0}, Q² ${Number.isFinite(q2) ? q2.toFixed(3) : 'không có'}, LOF ${lof === undefined || lof === null ? 'không ước lượng được' : `p=${lof.toFixed(3)}`}`
        : `ANN: validation R² ${Number.isFinite(diagnostics?.rSquaredVal) ? diagnostics.rSquaredVal.toFixed(3) : 'không có'} (không phải p-value/Q²)`;
      const justification = `${isSig ? 'Mô hình sàng lọc ghi nhận ảnh hưởng cần kiểm soát.' : 'Chưa có bằng chứng đủ mạnh để kết luận không có ảnh hưởng bất lợi.'} ${evidence}. Kết quả chỉ dùng cho sàng lọc; cần rà soát FMEA, confirmation run và phê duyệt chiến lược kiểm soát trước khi hạ mức rủi ro.`;

      items.push({
        factorCode: f.code,
        factorName: f.name,
        cqaCode: c.code,
        cqaName: c.name,
        initialRisk,
        updatedRisk,
        isSignificantInModel: isSig,
        justification,
      });
    });
  });

  return items;
}

/**
 * Generate Comprehensive Control Strategy table (ICH Q10 & FDA Table 105/106/107)
 * Establishes CMAs, CPPs, IPCs, Release Specifications with NOR, PAR, and Control Methods.
 */
export function generateControlStrategy(
  project: QBDProject,
  optimum: DesirabilitySolution | null
): ControlStrategyItem[] {
  const items: ControlStrategyItem[] = [];

  // 1. Material Attributes (CMAs) & Process Parameters (CPPs)
  project.factors.forEach((f) => {
    const isMaterial = f.role === 'mixture_component' || f.type === 'Mixture' || f.type === 'CMA' || f.type === 'Formulation';
    const cat = isMaterial ? ('Material Attribute (CMA)' as const) : ('Process Parameter (CPP)' as const);

    const optVal = optimum?.actualFactors[f.code];
    const targetVal = typeof optVal === 'number' ? optVal : f.center !== undefined ? f.center : (f.low + f.high) / 2;

    const span = f.high - f.low;
    const norDelta = span > 0 ? Number((span * 0.1).toFixed(1)) : 0;
    const norLow = typeof targetVal === 'number' ? Number((targetVal - norDelta).toFixed(1)) : f.low;
    const norHigh = typeof targetVal === 'number' ? Number((targetVal + norDelta).toFixed(1)) : f.high;

    const norStr = `${norLow} - ${norHigh} ${f.unit || ''} (screening)` .trim();
    const parStr = `${f.low} - ${f.high} ${f.unit || ''} (dải khảo sát; chưa phải PAR)` .trim();
    const dsStr = 'Chưa xác nhận: cần acceptance grid/Monte Carlo có seed và confirmation run';

    const method = isMaterial
      ? 'Tiêu chuẩn kiểm nghiệm nguyên liệu đầu vào (Vendor CoA & Kiểm nghiệm định tính/định lượng trước pha chế)'
      : 'Hệ thống giám sát tự động In-line / Cảm biến thời gian thực (SCADA, PAT NIR, Load cell đo lực nén)';

    items.push({
      category: cat,
      parameterName: f.name,
      parameterCode: f.code,
      unit: f.unit || '',
      target: typeof targetVal === 'number' ? targetVal.toFixed(1) : String(targetVal),
      nor: norStr,
      par: parStr,
      designSpaceLimit: dsStr,
      controlMethod: method,
    });
  });

  // 2. In-Process Controls (IPCs)
  items.push({
    category: 'In-Process Control (IPC)',
    parameterName: 'Độ đồng nhất khối bột / hạt (Blend Uniformity)',
    unit: '% RSD',
    target: '≤ 3.0%',
    nor: 'RSD ≤ 4.0%',
    par: 'RSD ≤ 5.0%',
    designSpaceLimit: 'RSD ≤ 5.0% (USP <905>)',
    controlMethod: 'Kiểm tra quang phổ cận hồng ngoại (In-line PAT NIR) hoặc lấy mẫu đa điểm V-blender',
  });

  items.push({
    category: 'In-Process Control (IPC)',
    parameterName: 'Độ ẩm bột cốm / hạt bao (Loss on Drying - LOD)',
    unit: '%',
    target: '1.5 - 2.5%',
    nor: '1.2 - 2.8%',
    par: '1.0 - 3.2%',
    designSpaceLimit: '1.0 - 3.5%',
    controlMethod: 'Cân sấy hồng ngoại tại chỗ (At-line Moisture Analyzer)',
  });

  // 3. Finished Product Specifications
  project.cqas.forEach((c) => {
    const targetStr =
      c.target !== undefined
        ? `${c.target} ${c.unit}`
        : c.lowerLimit !== undefined && c.upperLimit !== undefined
        ? `${c.lowerLimit} - ${c.upperLimit} ${c.unit}`
        : c.lowerLimit !== undefined
        ? `≥ ${c.lowerLimit} ${c.unit}`
        : c.upperLimit !== undefined
        ? `≤ ${c.upperLimit} ${c.unit}`
        : 'Theo Dược điển';

    const specStr =
      c.lowerLimit !== undefined && c.upperLimit !== undefined
        ? `${c.lowerLimit} - ${c.upperLimit} ${c.unit}`
        : c.lowerLimit !== undefined
        ? `≥ ${c.lowerLimit} ${c.unit}`
        : c.upperLimit !== undefined
        ? `≤ ${c.upperLimit} ${c.unit}`
        : 'Theo tiêu chuẩn cơ sở';

    items.push({
      category: 'Finished Product Specification',
      parameterName: c.name,
      parameterCode: c.code,
      unit: c.unit,
      target: targetStr,
      nor: specStr,
      par: specStr,
      designSpaceLimit: `100% Lô sản xuất nằm trong tiêu chuẩn chấp nhận`,
      controlMethod: `Kiểm nghiệm xuất xưởng lô thành phẩm (Release Testing / HPLC / USP Apparatus 2)`,
    });
  });

  return items;
}
