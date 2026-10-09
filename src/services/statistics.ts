import type {
  Factor,
  CQA,
  DoERun,
  ModelType,
  RegressionTerm,
  ANOVASource,
  StatisticalModelResult,
  RSMCanonicalAnalysisResult,
  NeuralNetModelResult,
  DesirabilitySolution,
  MonteCarloResult,
  MonteCarloCustomVariability,
  MonteCarloVarianceDecomposition,
  UpdatedRiskItem,
  ControlStrategyItem,
  QBDProject,
  GeneticOptimizerOptions,
  PiepelBoundsResult,
  BoxCoxRecommendation,
} from '../types/qbd';
import {
  matMul,
  matTranspose,
  matInverse,
  jacobiEigenvalues,
  solveLeastSquaresQR,
  fDistributionPValue,
  tDistributionPValue,
  tDistributionCritical,
  calculateIndividualDesirability,
  calculateInformationCriteria,
  sampleDistribution,
  latinHypercubeSample,
  nelderMeadSimplex,
} from './mathUtils';
import { buildModelTerms, buildRegressionTermEvaluators, getModelBlockCounts, getRegressionModelFactors, type ModelTermDefinition } from './modelTerms';
import { createSeededRandom } from './random';
import { actualToCoded, codedToActual, getConfiguredFactorCodes, isDiscreteFactor, snapFactorCoded } from './doeGenerator';
import { convertCodedToActualEquation } from './equationTransforms';

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

function calculateSSE(X: number[][], Y: number[][]): number | null {
  try {
    const fit = solveLeastSquaresQR(X, Y.map((row) => row[0]));
    const predicted = X.map((row) => row.reduce((sum, value, index) => sum + value * fit.coefficients[index], 0));
    return Y.reduce((sum, row, i) => sum + Math.pow(row[0] - predicted[i], 2), 0);
  } catch {
    // A sequential ANOVA submodel can be aliased (for example, an intercept
    // plus all mixture components). It must not bring down the whole UI.
    return null;
  }
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
      const beta = solveLeastSquaresQR(others, y).coefficients;
      const sse = others.reduce((sum, row, index) => {
        const predicted = row.reduce((acc, value, col) => acc + value * beta[col], 0);
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
 * Calculates Partial (Type III) Sum of Squares for each term in the regression model.
 * Type III SS for term j: SS(term_j | all other terms) = SSE(model without term j) - SSE(full model).
 */
export function calculateType3ANOVA(
  X: number[][],
  Y: number[][],
  terms: { name: string }[],
  ssResidualFull: number,
  msResidualFull: number,
  dfResidualFull: number
): ANOVASource[] {
  const sources: ANOVASource[] = [];

  for (let j = 0; j < terms.length; j++) {
    const term = terms[j];
    if (term.name === 'Intercept') continue;

    // Build design matrix omitting column j
    const X_omit = X.map((row) => row.filter((_, colIndex) => colIndex !== j));

    let ssTerm = 0;
    try {
      const sseReduced = calculateSSE(X_omit, Y);
      if (sseReduced !== null && Number.isFinite(sseReduced)) {
        ssTerm = Math.max(0, sseReduced - ssResidualFull);
      }
    } catch {
      ssTerm = 0;
    }

    const dfTerm = 1;
    const msTerm = ssTerm / dfTerm;
    const fVal = msResidualFull > 0 ? msTerm / msResidualFull : 0;
    const pVal = fDistributionPValue(fVal, dfTerm, dfResidualFull);

    sources.push({
      source: term.name,
      ss: ssTerm,
      df: dfTerm,
      ms: msTerm,
      fValue: fVal,
      pValue: pVal,
    });
  }

  sources.push({
    source: 'Residual',
    ss: ssResidualFull,
    df: dfResidualFull,
    ms: msResidualFull,
  });

  return sources;
}

/**
 * Calculates Box-Cox power transformation profile log-likelihood and optimal lambda.
 * Only applicable when all response values are strictly positive (> 0).
 */
export function calculateBoxCoxRecommendation(
  yValues: number[],
  X: number[][]
): BoxCoxRecommendation | null {
  const n = yValues.length;
  if (n < 4) return null;
  if (yValues.some((y) => !Number.isFinite(y) || y <= 0)) return null;

  const sumLnY = yValues.reduce((sum, y) => sum + Math.log(y), 0);
  const dotY = Math.exp(sumLnY / n);

  const lambdaGrid: number[] = [];
  for (let l = -2.0; l <= 2.05; l += 0.1) {
    lambdaGrid.push(Number(l.toFixed(2)));
  }

  const points: { lambda: number; logLikelihood: number }[] = [];
  let bestLambda = 1.0;
  let maxLogLikelihood = -Infinity;

  for (const lambda of lambdaGrid) {
    const yTrans = yValues.map((y) => {
      if (Math.abs(lambda) < 1e-4) {
        return dotY * Math.log(y);
      }
      return (Math.pow(y, lambda) - 1) / (lambda * Math.pow(dotY, lambda - 1));
    });

    const Y_col = yTrans.map((yt) => [yt]);
    const sse = calculateSSE(X, Y_col);
    if (sse === null || sse <= 0) continue;

    const logLikelihood = - (n / 2) * Math.log(sse / n);
    points.push({ lambda, logLikelihood });

    if (logLikelihood > maxLogLikelihood) {
      maxLogLikelihood = logLikelihood;
      bestLambda = lambda;
    }
  }

  if (points.length === 0 || !Number.isFinite(maxLogLikelihood)) return null;

  const cutoff = maxLogLikelihood - 1.9207;
  const inCI = points.filter((p) => p.logLikelihood >= cutoff);
  const ci95Low = inCI.length > 0 ? inCI[0].lambda : bestLambda;
  const ci95High = inCI.length > 0 ? inCI[inCI.length - 1].lambda : bestLambda;

  let recommendedTransform: BoxCoxRecommendation['recommendedTransform'] = 'None';
  let formulaExplanation = 'Khoảng tin cậy 95% bao gồm λ = 1; không cần biến đổi dữ liệu.';

  if (ci95Low <= 1 && ci95High >= 1) {
    recommendedTransform = 'None';
    formulaExplanation = 'λ = 1 nằm trong khoảng tin cậy 95%; giữ nguyên thang đo gốc Y.';
  } else if (ci95Low <= 0 && ci95High >= 0) {
    recommendedTransform = 'Natural Log (ln)';
    formulaExplanation = 'λ = 0 nằm trong khoảng tin cậy 95%; khuyến nghị biến đổi Y* = ln(Y).';
  } else if (ci95Low <= 0.5 && ci95High >= 0.5) {
    recommendedTransform = 'Square Root';
    formulaExplanation = 'λ = 0.5 nằm trong khoảng tin cậy 95%; khuyến nghị biến đổi Y* = √Y.';
  } else if (ci95Low <= -1 && ci95High >= -1) {
    recommendedTransform = 'Inverse';
    formulaExplanation = 'λ = -1 nằm trong khoảng tin cậy 95%; khuyến nghị biến đổi Y* = 1 / Y.';
  } else if (ci95Low <= -0.5 && ci95High >= -0.5) {
    recommendedTransform = 'Inverse Square Root';
    formulaExplanation = 'λ = -0.5 nằm trong khoảng tin cậy 95%; khuyến nghị biến đổi Y* = 1 / √Y.';
  } else {
    recommendedTransform = 'Power';
    formulaExplanation = `Khuyến nghị biến đổi lũy thừa tối ưu Y* = Y^(${bestLambda.toFixed(2)}).`;
  }

  return {
    optimalLambda: bestLambda,
    ci95Low,
    ci95High,
    recommendedTransform,
    formulaExplanation,
    points,
  };
}

/**
 * Build term definitions based on factors and model type
 */
function buildTerms(factors: Factor[], modelType: ModelType, selectedTermNames?: string[]): TermDef[] {
  return buildModelTerms(factors, modelType, selectedTermNames);
}

/**
 * Fit OLS Regression and generate full ANOVA & Diagnostics for a given CQA
 */
export function fitModel(
  cqa: CQA,
  factors: Factor[],
  runs: DoERun[],
  modelType: ModelType = 'Quadratic',
  selectedTerms?: string[]
): StatisticalModelResult | null {
  // A 0/100 surrogate is not a binomial model.  Fail closed until a logistic
  // modelling engine is supplied rather than reporting invalid OLS p-values.
  if (cqa.dataType?.startsWith('qualitative') || cqa.objective === 'pass_category') return null;
  // Only vary factors that are controllable (or undefined for legacy data).
  // Uncontrollable noise factors are not modeled as active DoE response surface variables.
  const activeFactors = getRegressionModelFactors(factors);

  // Convert response value to numeric (handling qualitative binary / numbers)
  const parseResponse = (raw: number | string | null | undefined): number | null => {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw === 'string') {
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };

  // Filter runs with valid response for this CQA
  const validRuns = runs
    .map((r) => ({ run: r, parsedY: parseResponse(r.responses[cqa.code]) }))
    .filter((item) => item.parsedY !== null);

  const n = validRuns.length;
  const terms = buildTerms(activeFactors, modelType, selectedTerms);
  // Treat execution block as a fixed nuisance effect.  The lowest numbered
  // block is the reference; this keeps the treatment surface interpretable
  // for normal operating conditions while removing between-block shifts from
  // treatment estimates and residual diagnostics.
  const blockLevels = [...new Set(validRuns.map(({ run }) => Math.max(1, Math.floor(run.block ?? 1))))].sort((a, b) => a - b);
  const referenceBlock = blockLevels[0] ?? 1;
  const adjustedBlocks = blockLevels.slice(1);
  const blockColumnValues = validRuns.map(({ run }) => {
    const block = Math.max(1, Math.floor(run.block ?? 1));
    return adjustedBlocks.map((level) => block === level ? 1 : 0);
  });
  const p = terms.length + adjustedBlocks.length;
  const hasExplicitIntercept = terms[0]?.name === 'Intercept';

  // A valid OLS ANOVA needs a full-rank model and at least one residual degree
  // of freedom.  Do not manufacture a residual df for a saturated model.
  if (n <= p) return null;

  // Build X matrix (n x p) and Y vector (n x 1)
  const X: number[][] = validRuns.map(({ run }, index) => [
    ...terms.map((t) => t.evaluator(run.factorCoded)),
    ...blockColumnValues[index],
  ]);
  const Y: number[][] = validRuns.map(({ parsedY }) => [parsedY!]);

  const XT = matTranspose(X);
  let invXTX: number[][];
  let conditionEstimate: number;
  let betaValues: number[];
  try {
    const fit = solveLeastSquaresQR(X, Y.map((row) => row[0]));
    invXTX = fit.inverseXtX;
    conditionEstimate = fit.conditionEstimate;
    betaValues = fit.coefficients;
  } catch {
    return null;
  }
  const Beta = betaValues.map((value) => [value]); // (p x 1)

  // Compute Predictions and Residuals
  const yPred = matMul(X, Beta).map((row) => row[0]);
  const yActual = Y.map((row) => row[0]);
  const residuals = yActual.map((act, i) => act - yPred[i]);

  const yMean = yActual.reduce((a, b) => a + b, 0) / n;

  // Sum of Squares
  const ssTotal = yActual.reduce((sum, act) => sum + Math.pow(act - yMean, 2), 0);
  const ssResidual = residuals.reduce((sum, res) => sum + Math.pow(res, 2), 0);

  const dfTotal = n - 1;
  const dfResidual = n - p;
  // Both explicit intercepts and Scheffé mixture bases contain the constant.
  const treatmentDF = terms.length - 1;
  const msResidual = dfResidual > 0 ? ssResidual / dfResidual : 0;


  // Hat matrix H = X * (X^T X)^-1 * X^T for leverage & studentized residuals
  const H = matMul(matMul(X, invXTX), XT);
  const leverages = H.map((row, i) => Math.max(0, Math.min(1, row[i])));

  // Pure Error & Lack of Fit calculation (group duplicate factor combinations)
  const pointGroups: { [key: string]: number[] } = {};
  validRuns.forEach(({ run }, idx) => {
    // Replicates in different execution blocks are not pure-error replicates:
    // their fixed block effect is explicitly estimated in the fitted model.
    const key = `${Math.max(1, Math.floor(run.block ?? 1))}|${activeFactors.map((f) => run.factorCoded[f.code]?.toPrecision(12) ?? '0').join('|')}`;
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

  const fLackOfFit = dfPureError > 0 && dfLackOfFit > 0
    ? msPureError > 0 ? msLackOfFit / msPureError : msLackOfFit > 1e-12 ? Infinity : undefined
    : undefined;
  const pLackOfFit =
    fLackOfFit !== undefined ? fDistributionPValue(fLackOfFit, dfLackOfFit, dfPureError) : undefined;

  // Sequential (Type I) ANOVA blocks.  These are fitted nested models, rather
  // than distributing the model SS in proportion to the number of terms.
  const modelBlocks = getModelBlockCounts(activeFactors, modelType);
  const linearCount = modelBlocks.linear;
  const linearDF = linearCount - (hasExplicitIntercept ? 0 : 1);
  const interactionCount = modelBlocks.interactions;
  const quadraticCount = modelBlocks.quadratic;

  // Ordinary centered VIF is not identifiable for all mixture components
  // together with a constant; don't report misleading finite mixture VIFs.
  const vifs = hasExplicitIntercept ? calculateVIFs(X, 1) : new Array(p).fill(NaN);

  // Compute Term Statistics (SE, t-value, p-value)
  const regressionTerms: RegressionTerm[] = [...terms.map((t, idx) => {
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
  }), ...adjustedBlocks.map((block, offset) => {
    const idx = terms.length + offset;
    const coeff = Beta[idx][0];
    const se = Math.sqrt(msResidual * Math.max(0, invXTX[idx][idx]));
    const tVal = se > 0 ? coeff / se : 0;
    return {
      name: `Block ${block} (so với Block ${referenceBlock})`,
      factorCodes: [], power: [], coefficient: coeff, stdError: se, tValue: tVal,
      pValue: tDistributionPValue(tVal, dfResidual), vif: vifs[idx],
      significant: tDistributionPValue(tVal, dfResidual) < 0.05,
    };
  })];

  // Diagnostic Metrics
  let press = 0;
  const residualDetails = validRuns.map(({ run }, i) => {
    const act = yActual[i];
    const pred = yPred[i];
    const res = residuals[i];
    const h_ii = leverages[i];
    const press_i = 1 - h_ii > 1e-6 ? res / (1 - h_ii) : Number.POSITIVE_INFINITY;
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
  const averagePredictionError = Math.sqrt(msResidual * p / n);
  const adeqPrecision = averagePredictionError > 0 ? yRange / averagePredictionError : 0;

  const stdDev = Math.sqrt(msResidual);
  const cvPercent = yMean !== 0 ? (stdDev / Math.abs(yMean)) * 100 : Number.NaN;

  // Build ANOVA Table
  // Mixture bases omit an explicit intercept, but their components sum to one.
  // Use a constant-only baseline for sequential sums of squares rather than
  // treating the first mixture component as an intercept.
  const interceptX = hasExplicitIntercept ? X.map((row) => [row[0]]) : X.map(() => [1]);
  const blockX = interceptX.map((row, index) => [...row, ...blockColumnValues[index]]);
  const sseIntercept = calculateSSE(interceptX, Y);
  const sseBlock = adjustedBlocks.length > 0 ? calculateSSE(blockX, Y) : sseIntercept;
  if (sseIntercept === null || sseBlock === null) return null;
  const ssBlock = Math.max(0, sseIntercept - sseBlock);
  const dfBlock = adjustedBlocks.length;
  const ssModel = Math.max(0, sseBlock - ssResidual);
  const msModel = treatmentDF > 0 ? ssModel / treatmentDF : 0;
  const fModel = msResidual > 0 ? msModel / msResidual : 0;
  const pModel = treatmentDF > 0 ? fDistributionPValue(fModel, treatmentDF, dfResidual) : undefined;
  const anova: ANOVASource[] = [];
  if (dfBlock > 0) {
    const msBlock = ssBlock / dfBlock;
    anova.push({ source: 'Block (fixed effect)', ss: ssBlock, df: dfBlock, ms: msBlock,
      fValue: msResidual > 0 ? msBlock / msResidual : undefined,
      pValue: msResidual > 0 ? fDistributionPValue(msBlock / msResidual, dfBlock, dfResidual) : undefined });
  }
  anova.push({ source: 'Model (đã hiệu chỉnh block)', ss: ssModel, df: treatmentDF, ms: msModel, fValue: fModel, pValue: pModel });
  const linearEnd = (hasExplicitIntercept ? 1 : 0) + linearCount;
  // Mixture bases already contain the constant direction (components sum to
  // one), so adding the baseline intercept again creates an aliased matrix.
  const sequentialBaseline = hasExplicitIntercept ? blockX : blockColumnValues;
  const linearX = X.map((row, index) => [...sequentialBaseline[index], ...row.slice(hasExplicitIntercept ? 1 : 0, linearEnd)]);
  const interactionEnd = linearEnd + interactionCount;
  const interactionX = X.map((row, index) => [...sequentialBaseline[index], ...row.slice(hasExplicitIntercept ? 1 : 0, interactionEnd)]);
  const sseLinear = calculateSSE(linearX, Y);
  const sse2FI = interactionCount > 0 ? calculateSSE(interactionX, Y) : sseLinear;

  if (linearDF > 0 && sseLinear !== null) {
    const ssLinear = Math.max(0, sseBlock - sseLinear);
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
  if (interactionCount > 0 && sseLinear !== null && sse2FI !== null) {
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
  if (quadraticCount > 0 && sse2FI !== null) {
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
    return activeFactors.every((f) => Math.abs(item.run.factorCoded[f.code] ?? 0) <= 1e-8);
  };
  const isFactorialCorner = (item: (typeof validRuns)[number]) => activeFactors.every((factor) =>
    Math.abs(Math.abs(item.run.factorCoded[factor.code] ?? 0) - 1) <= 1e-8
  );
  const centerPointRuns = validRuns.filter(isCenterPoint);
  const factorialRuns = validRuns.filter(isFactorialCorner);
  const supportsClassicalCurvature =
    adjustedBlocks.length === 0 &&
    terms.filter((term) => term.name !== 'Intercept' && !term.power.includes(2)).every((term) =>
      factorialRuns.length > 0 && Math.abs(factorialRuns.reduce((sum, item) => sum + term.evaluator(item.run.factorCoded), 0) / factorialRuns.length) < 1e-8) &&
    !activeFactors.some((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture') &&
    !activeFactors.some(isDiscreteFactor) &&
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

    const errMS = msPureError;
    const errDF = dfPureError;

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
        : 'Chưa phát hiện độ cong có ý nghĩa; kết quả này không chứng minh mô hình tuyến tính/tương tác phù hợp.',
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
    const x0 = [...terms.map((term) => term.evaluator(coded)), ...adjustedBlocks.map(() => 0)];
    const varianceMultiplier = x0.reduce(
      (sum, value, i) => sum + value * x0.reduce((inner, other, j) => inner + invXTX[i][j] * other, 0),
      0
    );
    return Math.sqrt(Math.max(0, msResidual * varianceMultiplier));
  };

  const interceptCoeff = hasExplicitIntercept ? Beta[0][0] : 0;
  const canonicalAnalysis = modelType === 'Quadratic'
    ? calculateRSMCanonicalAnalysis(regressionTerms, activeFactors, interceptCoeff)
    : undefined;

  // Actual engineering units transformation (P3.2)
  const actualEq = convertCodedToActualEquation(regressionTerms, activeFactors, cqa.code);

  // Type III Partial Sum of Squares ANOVA (P3.5)
  const type3Anova = calculateType3ANOVA(X, Y, terms, ssResidual, msResidual, dfResidual);

  // Box-Cox transformation recommendation (P3.5)
  const boxCox = calculateBoxCoxRecommendation(yActual, X);

  return {
    cqaCode: cqa.code,
    modelType,
    predictionCovariance: invXTX.map((row) => row.map((value) => value * msResidual)),
    terms: regressionTerms,
    anova,
    type3Anova,
    boxCox: boxCox ?? undefined,
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
      conditionEstimate,
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
    actualEquationString: actualEq.equationString,
    actualEquationLatex: actualEq.latexString,
    reducedTerms: modelType === 'Reduced' ? terms.map((t) => t.name) : undefined,
    predict,
    predictStandardError,
    residualDegreesOfFreedom: dfResidual,
    canonicalAnalysis,
  };
}

/**
 * Canonical analysis of a second-order polynomial response surface:
 * y_hat = b0 + x^T * a + x^T * B * x
 * Stationary point x0 = -0.5 * B^{-1} * a
 * Predicted response y0 = b0 + 0.5 * x0^T * a
 * Eigen-decomposition: B = M * Lambda * M^T
 */
export function calculateRSMCanonicalAnalysis(
  terms: RegressionTerm[],
  factors: Factor[],
  interceptCoeff?: number
): RSMCanonicalAnalysisResult | undefined {
  const activeControllable = factors.filter((f) => f.controllability === 'controllable' || f.controllability === undefined);
  const activeFactors = activeControllable.length > 0 ? activeControllable : factors.filter((f) => f.controllability !== 'constant');
  const k = activeFactors.length;
  if (k < 1) return undefined;

  const b0 = interceptCoeff ?? terms.find((t) => t.name === 'Intercept')?.coefficient ?? 0;

  const factorIndexMap = new Map<string, number>();
  activeFactors.forEach((f, idx) => factorIndexMap.set(f.code, idx));

  // Linear coefficient vector a: k x 1
  const a: number[] = new Array(k).fill(0);
  // Quadratic symmetric matrix B: k x k
  const B: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));

  let hasQuadraticOrInteraction = false;

  terms.forEach((term) => {
    if (term.name === 'Intercept') return;
    const isQuad = term.factorCodes.length === 1 && (term.power[0] === 2 || term.power.includes(2) || term.name.includes('²'));
    const isLinear = term.factorCodes.length === 1 && !isQuad;
    const isInteraction = term.factorCodes.length === 2;

    if (isLinear) {
      const fIdx = factorIndexMap.get(term.factorCodes[0]);
      if (fIdx !== undefined) {
        a[fIdx] = term.coefficient;
      }
    } else if (isQuad) {
      const fIdx = factorIndexMap.get(term.factorCodes[0]);
      if (fIdx !== undefined) {
        B[fIdx][fIdx] = term.coefficient;
        if (Math.abs(term.coefficient) > 1e-12) hasQuadraticOrInteraction = true;
      }
    } else if (isInteraction) {
      const idx1 = factorIndexMap.get(term.factorCodes[0]);
      const idx2 = factorIndexMap.get(term.factorCodes[1]);
      if (idx1 !== undefined && idx2 !== undefined) {
        const halfCoeff = term.coefficient / 2;
        B[idx1][idx2] = halfCoeff;
        B[idx2][idx1] = halfCoeff;
        if (Math.abs(term.coefficient) > 1e-12) hasQuadraticOrInteraction = true;
      }
    }
  });

  if (!hasQuadraticOrInteraction) return undefined;

  // Invert B: x0 = -0.5 * B^{-1} * a
  const x0_coded: number[] = new Array(k).fill(0);
  let isDegenerate = false;
  try {
    const invB = matInverse(B);
    for (let i = 0; i < k; i++) {
      let sum = 0;
      for (let j = 0; j < k; j++) {
        sum += invB[i][j] * a[j];
      }
      x0_coded[i] = -0.5 * sum;
    }
  } catch {
    isDegenerate = true;
  }

  // Calculate predicted value at stationary point: y0 = b0 + 0.5 * x0^T * a
  let y0 = b0;
  for (let i = 0; i < k; i++) {
    y0 += 0.5 * x0_coded[i] * a[i];
  }

  // Eigenvalues and eigenvectors of B
  const { eigenvalues, eigenvectors } = jacobiEigenvalues(B);

  // Surface nature determination:
  const maxAbsEig = Math.max(...eigenvalues.map(Math.abs), 1e-9);
  const ridgeThreshold = Math.max(1e-5, maxAbsEig * 0.02);

  let surfaceNature: 'maximum' | 'minimum' | 'saddle' | 'ridge';
  if (isDegenerate || eigenvalues.some((ev) => Math.abs(ev) < ridgeThreshold)) {
    surfaceNature = 'ridge';
  } else {
    const allNegative = eigenvalues.every((ev) => ev < 0);
    const allPositive = eigenvalues.every((ev) => ev > 0);
    if (allNegative) surfaceNature = 'maximum';
    else if (allPositive) surfaceNature = 'minimum';
    else surfaceNature = 'saddle';
  }

  // Stationary point in coded and actual coordinates
  const stationaryPointCoded: Record<string, number> = {};
  const stationaryPointActual: Record<string, number | string> = {};
  let isInside = true;

  activeFactors.forEach((f, idx) => {
    const codedVal = Number(x0_coded[idx].toFixed(4));
    stationaryPointCoded[f.code] = codedVal;
    if (Math.abs(codedVal) > 1.05) isInside = false;
    stationaryPointActual[f.code] = codedToActual(x0_coded[idx], f);
  });

  // Build canonical equation string: ŷ = y0 + lambda1*w1^2 + ...
  const canonicalParts: string[] = [y0.toFixed(3)];
  eigenvalues.forEach((ev, idx) => {
    const sign = ev >= 0 ? '+ ' : '- ';
    canonicalParts.push(`${sign}${Math.abs(ev).toFixed(3)}·w${idx + 1}²`);
  });
  const canonicalEquation = `ŷ = ${canonicalParts.join(' ')}`;

  return {
    stationaryPointCoded,
    stationaryPointActual,
    predictedAtStationaryPoint: Number(y0.toFixed(3)),
    eigenvalues: eigenvalues.map((v) => Number(v.toFixed(4))),
    eigenvectors,
    surfaceNature,
    isInsideDesignSpace: isInside,
    canonicalEquation,
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

  if (p.some((value) => !Number.isFinite(value))) return [];
  // Euclidean projection: x_i = clip(p_i - lambda, l_i, u_i).
  // Solve the monotone sum constraint; clipping first and redistributing is
  // feasible but is not the nearest point in Euclidean distance.
  let left = Math.min(...p.map((value, i) => value - u[i]));
  let right = Math.max(...p.map((value, i) => value - l[i]));
  for (let iteration = 0; iteration < 100; iteration++) {
    const lambda = (left + right) / 2;
    const sum = p.reduce((acc, value, i) => acc + Math.max(l[i], Math.min(u[i], value - lambda)), 0);
    if (sum > total) left = lambda;
    else right = lambda;
  }
  const lambda = (left + right) / 2;
  return p.map((value, i) => Math.max(l[i], Math.min(u[i], value - lambda)));
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

/**
 * Calculate Piepel (1983) effective bounds and test feasibility / consistency
 * of a polyhedral mixture bounded simplex.
 */
export function validatePiepelBounds(
  low: number[],
  high: number[],
  total: number = 1.0
): PiepelBoundsResult {
  const q = low.length;
  const messages: string[] = [];
  const unreachableLowerIndices: number[] = [];
  const unreachableUpperIndices: number[] = [];
  const inconsistentIndices: number[] = [];

  const sumL = low.reduce((a, b) => a + b, 0);
  const sumU = high.reduce((a, b) => a + b, 0);

  if (sumL > total + 1e-8) {
    messages.push(`Tổng cận dưới (${(sumL * (total === 100 ? 1 : 100)).toFixed(1)}%) vượt quá tổng tỉ lệ ${(total * (total === 100 ? 1 : 100)).toFixed(1)}%.`);
    return {
      isFeasible: false,
      effectiveLow: [...low],
      effectiveHigh: [...high],
      inconsistentIndices: [],
      unreachableLowerIndices,
      unreachableUpperIndices,
      messages,
    };
  }
  if (sumU < total - 1e-8) {
    messages.push(`Tổng cận trên (${(sumU * (total === 100 ? 1 : 100)).toFixed(1)}%) nhỏ hơn tổng tỉ lệ ${(total * (total === 100 ? 1 : 100)).toFixed(1)}%.`);
    return {
      isFeasible: false,
      effectiveLow: [...low],
      effectiveHigh: [...high],
      inconsistentIndices: [],
      unreachableLowerIndices,
      unreachableUpperIndices,
      messages,
    };
  }

  const effectiveLow = new Array(q).fill(0);
  const effectiveHigh = new Array(q).fill(0);

  for (let i = 0; i < q; i++) {
    const otherHighSum = sumU - high[i];
    const otherLowSum = sumL - low[i];
    const impliedLow = Math.max(low[i], total - otherHighSum);
    const impliedHigh = Math.min(high[i], total - otherLowSum);

    effectiveLow[i] = Number(impliedLow.toFixed(8));
    effectiveHigh[i] = Number(impliedHigh.toFixed(8));

    if (effectiveLow[i] > low[i] + 1e-6) {
      unreachableLowerIndices.push(i);
    }
    if (effectiveHigh[i] < high[i] - 1e-6) {
      unreachableUpperIndices.push(i);
    }
    if (effectiveLow[i] > effectiveHigh[i] + 1e-8) {
      inconsistentIndices.push(i);
      messages.push(`Thành phần ${i + 1}: Cận dưới hiệu dụng (${effectiveLow[i]}) lớn hơn cận trên hiệu dụng (${effectiveHigh[i]}).`);
    }
  }

  const isFeasible = inconsistentIndices.length === 0;
  return {
    isFeasible,
    effectiveLow,
    effectiveHigh,
    inconsistentIndices,
    unreachableLowerIndices,
    unreachableUpperIndices,
    messages,
  };
}

export function isFeasibleBoundedMixture(l: number[], u: number[], total: number = 1): boolean {
  if (l.length === 0 || l.length !== u.length || !Number.isFinite(total)) return false;
  if (l.some((value, index) => !Number.isFinite(value) || !Number.isFinite(u[index]) || value > u[index])) return false;
  const sumL = l.reduce((sum, value) => sum + value, 0);
  const sumU = u.reduce((sum, value) => sum + value, 0);
  if (sumL > total + 1e-10 || sumU < total - 1e-10) return false;
  for (let i = 0; i < l.length; i++) {
    const effL = Math.max(l[i], total - (sumU - u[i]));
    const effU = Math.min(u[i], total - (sumL - l[i]));
    if (effL > effU + 1e-10) return false;
  }
  return true;
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
    const isMixture = f.role === 'mixture_component' || f.type === 'Mixture';
    if (f.controllability === 'constant' && !isMixture) continue;
    if (isMixture) {
      const lowPct = f.high <= 1.0 && f.unit !== '%' ? f.low * 100 : f.low;
      const highPct = f.high <= 1.0 && f.unit !== '%' ? f.high * 100 : f.high;
      const valProp = f.controllability === 'constant' ? actualToCoded(f.constantValue ?? f.low, f) : coded[f.code];
      if (!Number.isFinite(valProp)) return false;
      const valPct = valProp * 100;
      // Allow slight numerical tolerance 0.05%
      if (valPct < lowPct - 1e-8 || valPct > highPct + 1e-8) {
        return false;
      }
      mixtureTotal += valProp;
      mixtureCount++;
    } else {
      const c = coded[f.code] ?? 0;
      if (!Number.isFinite(c) || c < -1 - 1e-8 || c > 1 + 1e-8) {
        return false;
      }
      if (isDiscreteFactor(f) && Math.abs(snapFactorCoded(c, f) - c) > 1e-6) return false;
    }
  }
  return mixtureCount < 2 || Math.abs(mixtureTotal - 1) <= 1e-6;
}

/**
 * Continuous Metaheuristic Multi-Response Desirability Optimization (Derringer & Suich 1980)
 * Uses Hybrid Real-Coded Genetic Algorithm (RCGA) with SBX crossover, adaptive polynomial mutation,
 * Latin Hypercube initialization, and Nelder-Mead simplex local search polishing.
 */
export function optimizeDesirabilityGA(
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  lockedFactors?: Record<string, number>,
  options?: GeneticOptimizerOptions
): DesirabilitySolution | null {
  const validCQAs = cqas.filter((cqa) => models[cqa.code]);
  if (validCQAs.length === 0) return null;

  const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
  const seed = options?.seed ?? 20260827;
  const random = createSeededRandom(seed);
  const k = factors.length;

  const evaluateOverallDesirability = (coded: Record<string, number>): { dOverall: number; dMap: Record<string, number> } => {
    // Strict Survey Boundary Check: Reject any point outside experimental bounding box
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
  mixFactors.forEach((factor, index) => {
    const fixed = lockedFactors?.[factor.code] ?? (factor.controllability === 'constant'
      ? actualToCoded(factor.constantValue ?? factor.low, factor) : undefined);
    if (fixed !== undefined) {
      if (!Number.isFinite(fixed) || fixed < mixLowProps[index] || fixed > mixHighProps[index]) {
        mixLowProps[index] = Infinity;
      } else mixLowProps[index] = mixHighProps[index] = fixed;
    }
  });

  if (hasMixture && !isFeasibleBoundedMixture(mixLowProps, mixHighProps)) return null;

  // Robust set-point margin: an optimum on the boundary of the studied region
  // puts ~50% of normally distributed batches outside the knowledge space.
  // Keep continuous process factors ≥ k·processSD inside the bounds (capped at
  // half of the half-range so the search region never collapses).
  const robustSigma = Math.max(0, options?.robustMarginSigma ?? 3);
  const robustCodedMargin = new Map<string, number>();
  procFactors.forEach((f) => {
    if (isDiscreteFactor(f) || !(typeof f.processSD === 'number' && f.processSD > 0)) return;
    const half = (f.high - f.low) / 2;
    if (!(half > 0)) return;
    robustCodedMargin.set(f.code, Math.min(0.5, (robustSigma * f.processSD) / half));
  });

  const robustMixLow = [...mixLowProps];
  const robustMixHigh = [...mixHighProps];
  if (hasMixture && robustSigma > 0) {
    const candidateLow = mixFactors.map((f, i) => {
      if (typeof f.processSD === 'number' && f.processSD > 0) {
        const sdProp = f.high <= 1.0 && f.unit !== '%' ? f.processSD : f.processSD / 100;
        return mixLowProps[i] + robustSigma * sdProp;
      }
      return mixLowProps[i];
    });
    const candidateHigh = mixFactors.map((f, i) => {
      if (typeof f.processSD === 'number' && f.processSD > 0) {
        const sdProp = f.high <= 1.0 && f.unit !== '%' ? f.processSD : f.processSD / 100;
        return mixHighProps[i] - robustSigma * sdProp;
      }
      return mixHighProps[i];
    });
    if (isFeasibleBoundedMixture(candidateLow, candidateHigh)) {
      candidateLow.forEach((v, i) => { robustMixLow[i] = v; });
      candidateHigh.forEach((v, i) => { robustMixHigh[i] = v; });
    }
  }

  // Feasibility repair operator R(x)
  const repairCandidate = (raw: Record<string, number>): Record<string, number> => {
    const repaired: Record<string, number> = {};

    factors.forEach((f) => {
      if (f.controllability === 'uncontrollable_noise') {
        repaired[f.code] = 0;
      } else if (f.controllability === 'constant') {
        repaired[f.code] = actualToCoded(f.constantValue ?? f.low, f);
      } else if (lockedFactors && lockedFactors[f.code] !== undefined) {
        repaired[f.code] = isDiscreteFactor(f) ? snapFactorCoded(lockedFactors[f.code], f) : lockedFactors[f.code];
      } else if (isDiscreteFactor(f)) {
        const val = raw[f.code] ?? 0;
        repaired[f.code] = snapFactorCoded(val, f);
      } else if (f.role !== 'mixture_component' && f.type !== 'Mixture') {
        const val = raw[f.code] ?? 0;
        const margin = robustCodedMargin.get(f.code) ?? 0;
        repaired[f.code] = Math.max(-1.0 + margin, Math.min(1.0 - margin, val));
      } else {
        repaired[f.code] = raw[f.code] ?? 0;
      }
    });

    if (hasMixture) {
      const rawMix = mixFactors.map((f, i) => repaired[f.code] ?? (robustMixLow[i] + robustMixHigh[i]) / 2);
      const proj = projectToBoundedMixture(rawMix, robustMixLow, robustMixHigh, 1.0);
      mixFactors.forEach((f, i) => {
        repaired[f.code] = proj[i];
      });
    } else if (mixFactors.length === 1) {
      repaired[mixFactors[0].code] = 1.0;
    }

    return repaired;
  };

  let bestD = -1;
  let bestCoded: Record<string, number> = {};
  let bestDMap: Record<string, number> = {};

  // GA Hyperparameters
  const popSize = Math.max(20, options?.populationSize ?? 80);
  const maxGenerations = Math.max(10, options?.maxGenerations ?? 60);
  const tourSize = options?.tournamentSize ?? 3;
  const pCrossover = options?.crossoverRate ?? 0.90;
  const pMutation = options?.mutationRate ?? (1.0 / Math.max(1, k));
  const etaC = options?.crossoverDistributionIndex ?? 2;
  const etaM = options?.mutationDistributionIndex ?? 20;

  // 1. Strategic Seeding + Latin Hypercube Sampling
  const population: Record<string, number>[] = [];

  // Seed 0: Centroid / Center point
  const seedCenter: Record<string, number> = {};
  procFactors.forEach((f) => {
    seedCenter[f.code] = lockedFactors?.[f.code] ?? 0.0;
  });
  if (hasMixture) {
    const rawMid = mixFactors.map((f, i) => lockedFactors?.[f.code] ?? (robustMixLow[i] + robustMixHigh[i]) / 2);
    const projMid = projectToBoundedMixture(rawMid, robustMixLow, robustMixHigh, 1.0);
    mixFactors.forEach((f, i) => { seedCenter[f.code] = projMid[i]; });
  }
  population.push(repairCandidate(seedCenter));

  // Seed 1..2p: Axial points for continuous process factors
  procFactors.filter((f) => !isDiscreteFactor(f)).forEach((f) => {
    const axialPos = { ...seedCenter, [f.code]: 1.0 };
    const axialNeg = { ...seedCenter, [f.code]: -1.0 };
    population.push(repairCandidate(axialPos));
    population.push(repairCandidate(axialNeg));
  });

  // Seed for discrete factor combinations
  const discreteFactors = procFactors.filter(isDiscreteFactor);
  if (discreteFactors.length > 0 && discreteFactors.length <= 3) {
    discreteFactors.forEach((df) => {
      const codes = getConfiguredFactorCodes(df);
      codes.forEach((code) => {
        population.push(repairCandidate({ ...seedCenter, [df.code]: code }));
      });
    });
  }

  // Remaining slots filled with Latin Hypercube Sampling
  const remainingSlots = Math.max(0, popSize - population.length);
  if (remainingSlots > 0) {
    const lhs = latinHypercubeSample(remainingSlots, factors.length, random);
    for (let r = 0; r < remainingSlots; r++) {
      const candidate: Record<string, number> = {};
      factors.forEach((f, idx) => {
        const u = lhs[r][idx]; // in [0, 1]
        if (f.role === 'mixture_component' || f.type === 'Mixture') {
          const mIdx = mixFactors.indexOf(f);
          const low = mIdx >= 0 ? robustMixLow[mIdx] : 0;
          const high = mIdx >= 0 ? robustMixHigh[mIdx] : 1;
          candidate[f.code] = low + u * (high - low);
        } else if (isDiscreteFactor(f)) {
          const codes = getConfiguredFactorCodes(f);
          const cIdx = Math.min(codes.length - 1, Math.floor(u * codes.length));
          candidate[f.code] = codes[cIdx];
        } else {
          candidate[f.code] = -1.0 + 2.0 * u;
        }
      });
      population.push(repairCandidate(candidate));
    }
  }

  // 2. Real-Coded Genetic Algorithm (RCGA) Main Loop
  interface Individual {
    genes: Record<string, number>;
    fitness: number;
    dMap: Record<string, number>;
  }

  let currentPop: Individual[] = population.map((genes) => {
    const { dOverall, dMap } = evaluateOverallDesirability(genes);
    if (dOverall > bestD) {
      bestD = dOverall;
      bestCoded = { ...genes };
      bestDMap = { ...dMap };
    }
    return { genes, fitness: dOverall, dMap };
  });

  let stagnationCount = 0;
  let prevBestFitness = bestD;

  for (let gen = 0; gen < maxGenerations; gen++) {
    // Sort descending by fitness
    currentPop.sort((a, b) => b.fitness - a.fitness);

    if (currentPop[0].fitness > bestD) {
      bestD = currentPop[0].fitness;
      bestCoded = { ...currentPop[0].genes };
      bestDMap = { ...currentPop[0].dMap };
    }

    // Stagnation early stopping check
    if (Math.abs(currentPop[0].fitness - prevBestFitness) < 1e-7) {
      stagnationCount++;
      if (stagnationCount >= 15) break;
    } else {
      stagnationCount = 0;
      prevBestFitness = currentPop[0].fitness;
    }

    // Elitism: Preserve top 4 individuals
    const nextPop: Individual[] = currentPop.slice(0, Math.min(4, currentPop.length)).map((ind) => ({
      genes: { ...ind.genes },
      fitness: ind.fitness,
      dMap: { ...ind.dMap },
    }));

    // Tournament selection helper
    const selectParent = (): Individual => {
      let bestInd = currentPop[Math.floor(random() * currentPop.length)];
      for (let t = 1; t < tourSize; t++) {
        const candidate = currentPop[Math.floor(random() * currentPop.length)];
        if (candidate.fitness > bestInd.fitness) {
          bestInd = candidate;
        }
      }
      return bestInd;
    };

    while (nextPop.length < popSize) {
      const p1 = selectParent();
      const p2 = selectParent();

      let c1Genes: Record<string, number> = { ...p1.genes };
      let c2Genes: Record<string, number> = { ...p2.genes };

      // Simulated Binary Crossover (SBX)
      if (random() < pCrossover) {
        factors.forEach((f) => {
          if (lockedFactors && lockedFactors[f.code] !== undefined) return;
          if (f.controllability !== 'controllable') return;

          if (isDiscreteFactor(f)) {
            // Uniform discrete crossover
            if (random() < 0.5) {
              const temp = c1Genes[f.code];
              c1Genes[f.code] = c2Genes[f.code];
              c2Genes[f.code] = temp;
            }
          } else {
            // SBX on continuous genes
            const v1 = p1.genes[f.code] ?? 0;
            const v2 = p2.genes[f.code] ?? 0;
            const u = random();
            let betaQ: number;
            if (u <= 0.5) {
              betaQ = Math.pow(2.0 * u, 1.0 / (etaC + 1.0));
            } else {
              betaQ = Math.pow(1.0 / (2.0 * (1.0 - u)), 1.0 / (etaC + 1.0));
            }
            c1Genes[f.code] = 0.5 * ((1.0 + betaQ) * v1 + (1.0 - betaQ) * v2);
            c2Genes[f.code] = 0.5 * ((1.0 - betaQ) * v1 + (1.0 + betaQ) * v2);
          }
        });
      }

      // Polynomial Mutation
      [c1Genes, c2Genes].forEach((child) => {
        factors.forEach((f) => {
          if (lockedFactors && lockedFactors[f.code] !== undefined) return;
          if (f.controllability !== 'controllable') return;

          if (random() < pMutation) {
            if (isDiscreteFactor(f)) {
              const codes = getConfiguredFactorCodes(f);
              child[f.code] = codes[Math.floor(random() * codes.length)];
            } else if (f.role === 'mixture_component' || f.type === 'Mixture') {
              const mIdx = mixFactors.indexOf(f);
              const low = mIdx >= 0 ? mixLowProps[mIdx] : 0;
              const high = mIdx >= 0 ? mixHighProps[mIdx] : 1;
              const range = Math.max(1e-4, high - low);
              const r = random();
              const deltaQ = r < 0.5
                ? Math.pow(2.0 * r, 1.0 / (etaM + 1.0)) - 1.0
                : 1.0 - Math.pow(2.0 * (1.0 - r), 1.0 / (etaM + 1.0));
              child[f.code] += deltaQ * range;
            } else {
              const r = random();
              const deltaQ = r < 0.5
                ? Math.pow(2.0 * r, 1.0 / (etaM + 1.0)) - 1.0
                : 1.0 - Math.pow(2.0 * (1.0 - r), 1.0 / (etaM + 1.0));
              child[f.code] += deltaQ * 2.0; // range [-1, 1] is 2.0
            }
          }
        });
      });

      // Feasibility repair and evaluate
      const rep1 = repairCandidate(c1Genes);
      const eval1 = evaluateOverallDesirability(rep1);
      nextPop.push({ genes: rep1, fitness: eval1.dOverall, dMap: eval1.dMap });

      if (nextPop.length < popSize) {
        const rep2 = repairCandidate(c2Genes);
        const eval2 = evaluateOverallDesirability(rep2);
        nextPop.push({ genes: rep2, fitness: eval2.dOverall, dMap: eval2.dMap });
      }
    }

    currentPop = nextPop;
  }

  // 3. Local Search Polishing via Nelder-Mead Simplex
  if (options?.polishWithNelderMead !== false) {
    const contFactors = factors.filter(
      (f) => f.controllability === 'controllable' &&
        (lockedFactors === undefined || lockedFactors[f.code] === undefined) &&
        !isDiscreteFactor(f)
    );

    if (contFactors.length > 0) {
      const nmObj = (pt: number[]): number => {
        const candidate: Record<string, number> = { ...bestCoded };
        contFactors.forEach((f, i) => {
          candidate[f.code] = pt[i];
        });
        const repaired = repairCandidate(candidate);
        const { dOverall } = evaluateOverallDesirability(repaired);
        return -dOverall; // Nelder-Mead minimizes
      };

      const nmRepair = (pt: number[]): number[] => {
        const candidate: Record<string, number> = { ...bestCoded };
        contFactors.forEach((f, i) => {
          candidate[f.code] = pt[i];
        });
        const repaired = repairCandidate(candidate);
        return contFactors.map((f) => repaired[f.code]);
      };

      const initialVector = contFactors.map((f) => bestCoded[f.code] ?? 0.0);
      const nmResult = nelderMeadSimplex(nmObj, initialVector, {
        maxIterations: options?.nelderMeadMaxIterations ?? 80,
        tolerance: 1e-6,
        stepSize: 0.05,
        repair: nmRepair,
      });

      const polishedD = -nmResult.value;
      if (polishedD > bestD) {
        const polishedCoded: Record<string, number> = { ...bestCoded };
        contFactors.forEach((f, i) => {
          polishedCoded[f.code] = nmResult.point[i];
        });
        const finalRep = repairCandidate(polishedCoded);
        const finalEval = evaluateOverallDesirability(finalRep);
        if (finalEval.dOverall > bestD) {
          bestD = finalEval.dOverall;
          bestCoded = { ...finalRep };
          bestDMap = { ...finalEval.dMap };
        }
      }
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
      if ((f.dataType === 'qualitative' || f.dataType === 'quantitative_multilevel') && f.categories && f.categories.length > 0) {
        actualFactors[f.code] = codedToActual(c, f);
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
    const diag = (model as any).diagnostics;
    const seCandidates = [statisticalModel?.predictStandardError?.(bestCoded), diag?.stdDev, diag?.rmseVal, diag?.rmseOverall, 0];
    const se = seCandidates.find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ?? 0;
    const df = statisticalModel?.residualDegreesOfFreedom;
    const critical = df && df > 0 ? tDistributionCritical(0.05, df) : Number.NaN;
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
 * Multi-Response Desirability Optimization (Derringer & Suich)
 * Delegates to continuous metaheuristic optimization (Real-Coded GA + Nelder-Mead).
 */
export function optimizeDesirability(
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  lockedFactors?: Record<string, number>,
  seed: number = 20260827,
  options?: GeneticOptimizerOptions
): DesirabilitySolution | null {
  return optimizeDesirabilityGA(factors, cqas, models, lockedFactors, { ...options, seed: options?.seed ?? seed });
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
  onProgress?: (progressPercent: number) => void,
  twoStageMonteCarlo: boolean = false,
  customVariability?: MonteCarloCustomVariability
): MonteCarloResult {
  if (customVariability && customVariability.mode === 'global' && Number.isFinite(customVariability.globalRSD)) {
    variabilityPercent = customVariability.globalRSD;
  }
  simulations = Math.max(100, Math.min(100_000, Math.round(Number.isFinite(simulations) ? simulations : 10_000)));
  variabilityPercent = Math.max(0.1, Math.min(15, Number.isFinite(variabilityPercent) ? variabilityPercent : 2));
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const validCQAs = cqas.filter((c) => models[c.code]);
  if (validCQAs.length === 0) throw new Error('Monte Carlo requires at least one fitted response model.');
  const modeledCqaCodes = validCQAs.map((cqa) => cqa.code);
  const unmodeledCqaCodes = cqas.filter((cqa) => !models[cqa.code]).map((cqa) => cqa.code);
  let passCount = 0;
  let failCount = 0;
  let cqaFailCount = 0;
  let excursionCount = 0;

  const cqaValues: Record<string, number[]> = {};
  const cqaModelValues: Record<string, number[]> = {};
  const cqaResidualErrors: Record<string, number[]> = {};
  const cqaMeasurementErrors: Record<string, number[]> = {};
  validCQAs.forEach((c) => {
    cqaValues[c.code] = [];
    cqaModelValues[c.code] = [];
    cqaResidualErrors[c.code] = [];
    cqaMeasurementErrors[c.code] = [];
  });

  const mixFactors = factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const hasMixture = mixFactors.length >= 2;
  const mixLowProps = mixFactors.map((f) => (f.high <= 1 && f.unit !== '%' ? f.low : f.low / 100));
  const mixHighProps = mixFactors.map((f) => (f.high <= 1 && f.unit !== '%' ? f.high : f.high / 100));
  mixFactors.forEach((f, index) => {
    if (f.controllability !== 'constant') return;
    const value = Number(f.constantValue ?? f.low);
    const proportion = f.high <= 1 && f.unit !== '%' ? value : value / 100;
    if (!Number.isFinite(proportion) || proportion < mixLowProps[index] || proportion > mixHighProps[index]) {
      throw new Error('Constant mixture component is outside its declared bounds.');
    }
    mixLowProps[index] = mixHighProps[index] = proportion;
  });
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
  // residuals exist; otherwise assume independence (not necessarily conservative).
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

  // Stage 1 Parameter Uncertainty Preparation for Two-Stage Monte Carlo (STAT-S8)
  const batchesPerRealization = twoStageMonteCarlo ? Math.max(10, Math.floor(simulations / 50)) : 1;
  const cqaParamCholesky: (number[][] | null)[] = validCQAs.map((cqa) => {
    const model = models[cqa.code];
    if (twoStageMonteCarlo && model && 'predictionCovariance' in model && model.predictionCovariance && model.predictionCovariance.length > 0) {
      let pChol = tryCholesky(model.predictionCovariance);
      let shrink = 0.95;
      while (!pChol && shrink >= 0.05) {
        const candidate = model.predictionCovariance.map((row, i) =>
          row.map((val, j) => (i === j ? val * (1 + (1 - shrink)) : val * shrink))
        );
        pChol = tryCholesky(candidate);
        shrink *= 0.9;
      }
      return pChol;
    }
    return null;
  });
  const cqaTermEvaluators = validCQAs.map((cqa, index) => {
    const model = models[cqa.code];
    return twoStageMonteCarlo && cqaParamCholesky[index] && 'terms' in model
      ? buildRegressionTermEvaluators(factors, model.modelType, model.terms)
      : [];
  });
  let currentBetaShift: number[][] = validCQAs.map(() => []);

  const progressStep = Math.max(500, Math.floor(simulations / 20));
  for (let s = 0; s < simulations; s++) {
    if (onProgress && simulations >= 1000 && s % progressStep === 0) {
      onProgress(Math.round((s / simulations) * 100));
    }
    if (twoStageMonteCarlo && (s === 0 || s % batchesPerRealization === 0)) {
      currentBetaShift = validCQAs.map((cqa, cqaIdx) => {
        const model = models[cqa.code];
        const pChol = cqaParamCholesky[cqaIdx];
        if (pChol && 'terms' in model && model.terms) {
          const p = Math.min(model.terms.length, pChol.length);
          const z = Array.from({ length: p }, () => standardNormal());
          const delta = new Array(p).fill(0);
          for (let i = 0; i < p; i++) {
            delta[i] = pChol[i].slice(0, p).reduce((sum, coef, j) => sum + coef * z[j], 0);
          }
          return delta;
        }
        return [];
      });
    }
    // Generate randomized factor actuals and convert to coded/proportion
    const sampleCoded: Record<string, number> = {};
    let batchOutsideSurveyRegion = false;

    // 1. Process factors
    factors.forEach((f) => {
      if (f.controllability === 'constant') {
        const constNum = typeof f.constantValue === 'number' && Number.isFinite(f.constantValue)
          ? f.constantValue
          : (f.constantValue !== undefined && f.constantValue !== null && Number.isFinite(Number(f.constantValue)))
            ? Number(f.constantValue)
            : f.low;
        sampleCoded[f.code] = f.role === 'mixture_component' || f.type === 'Mixture'
          ? (f.high <= 1.0 && f.unit !== '%' ? constNum : constNum / 100)
          : 0;
        return;
      }

      if (f.role === 'mixture_component' || f.type === 'Mixture') {
        // Will handle collectively below
        return;
      }

      if (isDiscreteFactor(f)) {
        const selected = setpointActual[f.code] ?? codedToActual(0, f);
        sampleCoded[f.code] = snapFactorCoded(actualToCoded(selected, f), f);
        return;
      }

      const rawMean = setpointActual[f.code];
      const mean: number = typeof rawMean === 'number' && Number.isFinite(rawMean)
        ? rawMean
        : (rawMean !== undefined && rawMean !== null && Number.isFinite(Number(rawMean)))
          ? Number(rawMean)
          : f.center !== undefined
            ? f.center
            : (f.low + f.high) / 2;
      const scale = Math.max(Math.abs(mean), Math.abs(f.high - f.low) / 2);
      let sd: number;
      if (customVariability?.mode === 'component_wise') {
        if (customVariability.factorVariability?.[f.code]) {
          const cfg = customVariability.factorVariability[f.code];
          sd = cfg.type === 'sd' ? Math.max(1e-5, cfg.value) : Math.max(1e-5, scale * (cfg.value / 100.0));
        } else if (f.variabilityType === 'sd' && f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0) {
          sd = Math.max(1e-5, f.processSD);
        } else if (f.variabilityType === 'rsd' && f.processRSD !== undefined && Number.isFinite(f.processRSD) && f.processRSD > 0) {
          sd = Math.max(1e-5, scale * (f.processRSD / 100.0));
        } else if (f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0) {
          sd = f.processSD * (variabilityPercent / 2.0);
        } else {
          sd = Math.max(1e-5, scale * (variabilityPercent / 100.0));
        }
      } else {
        // Global RSD mode: variabilityPercent dynamically scales process variance
        sd = f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0
          ? f.processSD * (variabilityPercent / 2.0)
          : Math.max(1e-5, scale * (variabilityPercent / 100.0));
      }

      // Stochastic factor sampling (STAT-03: Normal, Lognormal, Uniform, Triangular per ICH Q9)
      // Draw the physical process without truncation. An excursion outside the
      // studied region is a failed virtual batch; clamp only the value supplied
      // to the model so the model is never extrapolated beyond its evidence.
      let rawActualVal: number;
      if (f.distribution && f.distribution !== 'Normal') {
        const distParams = {
          mean,
          sd,
          min: f.distParams?.min ?? f.low,
          mode: f.distParams?.mode ?? mean,
          max: f.distParams?.max ?? f.high,
          ...f.distParams,
        };
        rawActualVal = sampleDistribution(f.distribution, distParams, random);
      } else {
        rawActualVal = mean + standardNormal() * sd;
      }
      if (rawActualVal < f.low || rawActualVal > f.high) batchOutsideSurveyRegion = true;
      const actualVal = Math.max(f.low, Math.min(f.high, rawActualVal));

      const center = f.center !== undefined ? f.center : (f.low + f.high) / 2;
      const half = (f.high - f.low) / 2;
      sampleCoded[f.code] = half > 0 ? (actualVal - center) / half : 0;
    });

    // 2. Mixture factors (sample & normalize to maintain 100% total)
    if (mixFactors.length > 0) {
      const sampledProps: number[] = [];
      mixFactors.forEach((f) => {
        if (f.controllability === 'constant') {
          const constNum = typeof f.constantValue === 'number' && Number.isFinite(f.constantValue)
            ? f.constantValue
            : (f.constantValue !== undefined && f.constantValue !== null && Number.isFinite(Number(f.constantValue)))
              ? Number(f.constantValue)
              : f.low;
          sampledProps.push(valueToProportion(f, constNum));
          return;
        }
        const rawMean = setpointActual[f.code];
        const mean: number = typeof rawMean === 'number' && Number.isFinite(rawMean)
          ? rawMean
          : (rawMean !== undefined && rawMean !== null && Number.isFinite(Number(rawMean)))
            ? Number(rawMean)
            : (f.low + f.high) / 2; // mean in %
        let sd: number;
        if (customVariability?.mode === 'component_wise') {
          if (customVariability.factorVariability?.[f.code]) {
            const cfg = customVariability.factorVariability[f.code];
            sd = cfg.type === 'sd' ? Math.max(1e-5, cfg.value) : Math.max(1e-5, mean * (cfg.value / 100.0));
          } else if (f.variabilityType === 'sd' && f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0) {
            sd = Math.max(1e-5, f.processSD);
          } else if (f.variabilityType === 'rsd' && f.processRSD !== undefined && Number.isFinite(f.processRSD) && f.processRSD > 0) {
            sd = Math.max(1e-5, mean * (f.processRSD / 100.0));
          } else if (f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0) {
            sd = f.processSD * (variabilityPercent / 2.0);
          } else {
            sd = Math.max(1e-5, mean * (variabilityPercent / 100.0));
          }
        } else {
          // Global RSD mode
          sd = f.processSD !== undefined && Number.isFinite(f.processSD) && f.processSD > 0
            ? f.processSD * (variabilityPercent / 2.0)
            : Math.max(1e-5, mean * (variabilityPercent / 100.0));
        }

        let actualVal: number;
        if (f.distribution && f.distribution !== 'Normal') {
          const distParams = {
            mean,
            sd,
            min: f.distParams?.min ?? f.low,
            mode: f.distParams?.mode ?? mean,
            max: f.distParams?.max ?? f.high,
            ...f.distParams,
          };
          actualVal = Math.max(0, sampleDistribution(f.distribution, distParams, random));
        } else {
          actualVal = Math.max(0, mean + standardNormal() * sd);
        }
        sampledProps.push(valueToProportion(f, actualVal));
      });

      if (hasMixture) {
        const fixedTotal = sampledProps.reduce((sum, value, i) => sum + (mixFactors[i].controllability === 'constant' ? value : 0), 0);
        const sampledTotal = sampledProps.reduce((sum, value, i) => sum + (mixFactors[i].controllability === 'constant' ? 0 : value), 0);
        const normalizedProps = sampledTotal > 0
          ? sampledProps.map((value, i) => mixFactors[i].controllability === 'constant' ? value : value / sampledTotal * (1 - fixedTotal))
          : sampledProps;
        if (normalizedProps.some((value, index) => value < mixLowProps[index] - 1e-10 || value > mixHighProps[index] + 1e-10)) {
          batchOutsideSurveyRegion = true;
        }
        const boundedProps = projectToBoundedMixture(normalizedProps, mixLowProps, mixHighProps, 1.0);
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
    if (batchOutsideSurveyRegion) excursionCount++;
    let batchCqaPass = true;
    const correlatedZ = new Array(validCQAs.length).fill(0);
    const independentZ = validCQAs.map(() => standardNormal());
    for (let i = 0; i < cholesky.length; i++) {
      correlatedZ[i] = cholesky[i].reduce((sum, coefficient, j) => sum + coefficient * independentZ[j], 0);
    }
    for (let cqaIndex = 0; cqaIndex < validCQAs.length; cqaIndex++) {
      const cqa = validCQAs[cqaIndex];
      const model = models[cqa.code];
      const diag = (model.diagnostics as any) ?? {};
      const residualStdCandidates = [diag.stdDev, diag.rmseVal, diag.rmseOverall, 0.1];
      const residualStd = residualStdCandidates.find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ?? 0.1;
      const meanPredictionSE = 'predictStandardError' in model ? model.predictStandardError?.(sampleCoded) ?? 0 : 0;
      if (!Number.isFinite(residualStd) || residualStd < 0 || !Number.isFinite(meanPredictionSE)) {
        throw new Error(`Invalid uncertainty estimate for ${cqa.code}.`);
      }
      let yPredMean: number;
      let residualNoise: number;
      if (twoStageMonteCarlo) {
        // Stage 1: Response mean under realized parameter draw
        yPredMean = model.predict(sampleCoded);
        const delta = currentBetaShift[cqaIndex];
        if (delta && delta.length > 0 && cqaTermEvaluators[cqaIndex].length > 0) {
          for (let k = 0; k < delta.length; k++) {
            yPredMean += delta[k] * cqaTermEvaluators[cqaIndex][k](sampleCoded);
          }
        }
        // Stage 2: Batch process noise with residual covariance
        residualNoise = residualStd * correlatedZ[cqaIndex];
      } else {
        yPredMean = model.predict(sampleCoded);
        const noiseStd = Math.sqrt(residualStd * residualStd + meanPredictionSE * meanPredictionSE);
        residualNoise = noiseStd * correlatedZ[cqaIndex];
      }

      // 4. Analytical Measurement Noise (ICH Q14 / USP <1220>)
      let measSD = 0;
      if (customVariability?.mode === 'component_wise' && customVariability.cqaMeasurementVariability?.[cqa.code]) {
        const cqaVar = customVariability.cqaMeasurementVariability[cqa.code];
        if (cqaVar.enabled && cqaVar.value > 0) {
          measSD = cqaVar.type === 'sd' ? cqaVar.value : Math.abs(yPredMean) * (cqaVar.value / 100.0);
        }
      } else if (cqa.includeMeasurementNoise) {
        if (cqa.measurementVariabilityType === 'sd' && cqa.measurementSD !== undefined && cqa.measurementSD > 0) {
          measSD = cqa.measurementSD;
        } else if (cqa.measurementRSD !== undefined && cqa.measurementRSD > 0) {
          measSD = Math.abs(yPredMean) * (cqa.measurementRSD / 100.0);
        }
      }
      const measNoise = measSD > 0 ? standardNormal() * measSD : 0;
      const yPred = yPredMean + residualNoise + measNoise;

      if (!Number.isFinite(yPred)) throw new Error(`Non-finite prediction for ${cqa.code}.`);
      cqaValues[cqa.code].push(yPred);
      cqaModelValues[cqa.code].push(yPredMean);
      cqaResidualErrors[cqa.code].push(residualNoise);
      cqaMeasurementErrors[cqa.code].push(measNoise);

      if (cqa.lowerLimit !== undefined && yPred < cqa.lowerLimit) {
        batchCqaPass = false;
      }
      if (cqa.upperLimit !== undefined && yPred > cqa.upperLimit) {
        batchCqaPass = false;
      }
      if (cqa.objective === 'pass_category' && yPred < 90) batchCqaPass = false;
    }

    if (!batchCqaPass) cqaFailCount++;
    // Fail-closed total: a batch outside the studied region is unverified and
    // therefore counted as failed, in addition to CQA spec failures.
    if (batchCqaPass && !batchOutsideSurveyRegion) passCount++;
    else failCount++;
  }

  const defectRatePPM = Math.round((failCount / simulations) * 1_000_000);
  const cqaDefectRatePPM = Math.round((cqaFailCount / simulations) * 1_000_000);
  const reliabilityPercent = Number(((passCount / simulations) * 100).toFixed(2));
  const excursionRatePercent = Number(((excursionCount / simulations) * 100).toFixed(3));

  const cqaStats: Record<string, any> = {};
  validCQAs.forEach((cqa) => {
    const vals = cqaValues[cqa.code];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, vals.length - 1));
    let min = vals[0] ?? 0;
    let max = vals[0] ?? 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] < min) min = vals[i];
      if (vals[i] > max) max = vals[i];
    }

    let ppk: number | undefined = undefined;
    if (sd > 0) {
      if (cqa.lowerLimit !== undefined && cqa.upperLimit !== undefined) {
        const ppl = (mean - cqa.lowerLimit) / (3 * sd);
        const ppu = (cqa.upperLimit - mean) / (3 * sd);
        ppk = Number(Math.min(ppl, ppu).toFixed(2));
      } else if (cqa.lowerLimit !== undefined) {
        ppk = Number(((mean - cqa.lowerLimit) / (3 * sd)).toFixed(2));
      } else if (cqa.upperLimit !== undefined) {
        ppk = Number(((cqa.upperLimit - mean) / (3 * sd)).toFixed(2));
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
      ppk,
      cpk: ppk,
      outOfSpecPercent: Number(((oosCount / simulations) * 100).toFixed(2)),
    };
  });

  const varianceDecomposition: Record<string, MonteCarloVarianceDecomposition> = {};
  validCQAs.forEach((cqa) => {
    const vals = cqaValues[cqa.code];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, vals.length - 1));
    const varTotal = Math.pow(sd, 2);

    const modelVals = cqaModelValues[cqa.code];
    const meanModel = modelVals.reduce((a, b) => a + b, 0) / modelVals.length;
    const varProcess = modelVals.reduce((sum, v) => sum + Math.pow(v - meanModel, 2), 0) / Math.max(1, modelVals.length - 1);

    const resVals = cqaResidualErrors[cqa.code];
    const meanRes = resVals.reduce((a, b) => a + b, 0) / resVals.length;
    const varResidual = resVals.reduce((sum, v) => sum + Math.pow(v - meanRes, 2), 0) / Math.max(1, resVals.length - 1);

    const measVals = cqaMeasurementErrors[cqa.code];
    const meanMeas = measVals.reduce((a, b) => a + b, 0) / measVals.length;
    const varMeas = measVals.reduce((sum, v) => sum + Math.pow(v - meanMeas, 2), 0) / Math.max(1, measVals.length - 1);

    const varSum = varProcess + varResidual + varMeas;
    const processPercent = varSum > 0 ? Number(((varProcess / varSum) * 100).toFixed(1)) : 0;
    const modelPercent = varSum > 0 ? Number(((varResidual / varSum) * 100).toFixed(1)) : 0;
    const measurementPercent = varSum > 0 ? Number(((varMeas / varSum) * 100).toFixed(1)) : 0;

    varianceDecomposition[cqa.code] = {
      processVariance: Number(varProcess.toFixed(4)),
      modelResidualVariance: Number(varResidual.toFixed(4)),
      measurementVariance: Number(varMeas.toFixed(4)),
      totalVariance: Number(varTotal.toFixed(4)),
      processPercent,
      modelPercent,
      measurementPercent,
    };
  });

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const executionTimeMs = Number((endTime - startTime).toFixed(2));
  onProgress?.(100);

  return {
    simulations,
    seed,
    variabilityPercent,
    twoStageMonteCarlo,
    modeledCqaCodes,
    unmodeledCqaCodes,
    excursionCount,
    excursionRatePercent,
    passCount,
    failCount,
    cqaFailCount,
    cqaDefectRatePPM,
    defectRatePPM,
    reliabilityPercent,
    executionTimeMs,
    cqaStats,
    varianceDecomposition,
    customVariability,
  };
}

/**
 * Asynchronous Monte Carlo simulation runner.
 * Offloads compute to Web Worker in browser environments to avoid freezing the main UI thread,
 * with graceful fallback and abort signal support.
 */
export async function runMonteCarloSimulationAsync(
  setpointActual: Record<string, number | string>,
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  variabilityPercent: number = 2.0,
  simulations: number = 10000,
  seed: number = 20260827,
  onProgress?: (progressPercent: number) => void,
  abortSignal?: AbortSignal,
  twoStageMonteCarlo: boolean = false,
  customVariability?: MonteCarloCustomVariability
): Promise<MonteCarloResult> {
  const { runMonteCarloInWorker } = await import('./analysisWorkerClient');
  return runMonteCarloInWorker(
    setpointActual,
    factors,
    cqas,
    models,
    variabilityPercent,
    simulations,
    seed,
    onProgress,
    abortSignal,
    runMonteCarloSimulation,
    twoStageMonteCarlo,
    customVariability
  );
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
          const significantTerm = model.terms.some((t) => t.factorCodes.includes(f.code) && t.significant);
          if (significantTerm) {
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
      // Statistical significance alone never justifies reducing an FMEA risk level.
      const updatedRisk: 'Low' | 'Medium' | 'High' = initialRisk;
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
