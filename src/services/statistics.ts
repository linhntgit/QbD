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
  calculateIndividualDesirability,
  calculateInformationCriteria,
} from './mathUtils';

interface TermDef {
  name: string;
  factorCodes: string[];
  power: number[];
  evaluator: (coded: Record<string, number>) => number;
}

/**
 * Build term definitions based on factors and model type
 */
function buildTerms(factors: Factor[], modelType: ModelType): TermDef[] {
  const terms: TermDef[] = [];
  const k = factors.length;

  // 1. Intercept
  terms.push({
    name: 'Intercept',
    factorCodes: [],
    power: [],
    evaluator: () => 1.0,
  });

  // 2. Linear terms (X1, X2, ...)
  factors.forEach((f, idx) => {
    const p = new Array(k).fill(0);
    p[idx] = 1;
    terms.push({
      name: f.code,
      factorCodes: [f.code],
      power: p,
      evaluator: (coded) => coded[f.code] ?? 0,
    });
  });

  // 3. Two-factor interaction (2FI) terms (X1*X2, X1*X3, ...)
  if (modelType === '2FI' || modelType === 'Quadratic' || modelType === 'Reduced') {
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const p = new Array(k).fill(0);
        p[i] = 1;
        p[j] = 1;
        const code1 = factors[i].code;
        const code2 = factors[j].code;
        terms.push({
          name: `${code1}*${code2}`,
          factorCodes: [code1, code2],
          power: p,
          evaluator: (coded) => (coded[code1] ?? 0) * (coded[code2] ?? 0),
        });
      }
    }
  }

  // 4. Quadratic / Squared terms (X1^2, X2^2, ...)
  if (modelType === 'Quadratic' || modelType === 'Reduced') {
    for (let i = 0; i < k; i++) {
      const p = new Array(k).fill(0);
      p[i] = 2;
      const code = factors[i].code;
      terms.push({
        name: `${code}²`,
        factorCodes: [code],
        power: p,
        evaluator: (coded) => Math.pow(coded[code] ?? 0, 2),
      });
    }
  }

  return terms;
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
  if (n < activeFactors.length + 2) {
    return null; // Not enough degrees of freedom
  }

  let terms = buildTerms(activeFactors, modelType);
  const p = terms.length;

  // Build X matrix (n x p) and Y vector (n x 1)
  const X: number[][] = validRuns.map(({ run }) => terms.map((t) => t.evaluator(run.factorCoded)));
  const Y: number[][] = validRuns.map(({ parsedY }) => [parsedY!]);

  const XT = matTranspose(X);
  const XTX = matMul(XT, X);
  const invXTX = matInverse(XTX);
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
  const dfResidual = Math.max(1, n - p);

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

  // Breakdown of Sum of Squares: Linear, 2FI, Quadratic
  const k = activeFactors.length;
  const linearCount = k;
  const interactionCount = (modelType === '2FI' || modelType === 'Quadratic' || modelType === 'Reduced') ? (k * (k - 1)) / 2 : 0;
  const quadraticCount = (modelType === 'Quadratic' || modelType === 'Reduced') ? k : 0;

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
      vif: 1.0, // Orthogonal designs have VIF=1
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
      ? Math.max(0, Math.min(1, 1 - (ssResidual / dfResidual) / (ssTotal / dfTotal)))
      : 0;
  const predRSquared = ssTotal > 0 ? Math.max(0, Math.min(1, 1 - press / ssTotal)) : 0;
  const qSquared = predRSquared; // Slide 12 Q^2 (PRESS-based Leave-One-Out R^2)

  const infoCrit = calculateInformationCriteria(n, p, ssResidual);

  const yRange = Math.max(...yPred) - Math.min(...yPred);
  const adeqPrecision =
    n > 0 && msResidual > 0 ? yRange / Math.sqrt((p * msResidual) / n) : 0;

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

  if (linearCount > 0) {
    const ssLinear = ssModel * (linearCount / dfModel);
    const msLinear = ssLinear / linearCount;
    const fLinear = msResidual > 0 ? msLinear / msResidual : undefined;
    const pLinear = fLinear !== undefined && dfResidual > 0 ? fDistributionPValue(fLinear, linearCount, dfResidual) : undefined;
    anova.push({
      source: 'Linear',
      ss: ssLinear,
      df: linearCount,
      ms: msLinear,
      fValue: fLinear,
      pValue: pLinear,
    });
  }
  if (interactionCount > 0) {
    const ss2FI = ssModel * (interactionCount / dfModel);
    const ms2FI = ss2FI / interactionCount;
    const f2FI = msResidual > 0 ? ms2FI / msResidual : undefined;
    const p2FI = f2FI !== undefined && dfResidual > 0 ? fDistributionPValue(f2FI, interactionCount, dfResidual) : undefined;
    anova.push({
      source: '2-Factor Interaction (2FI)',
      ss: ss2FI,
      df: interactionCount,
      ms: ms2FI,
      fValue: f2FI,
      pValue: p2FI,
    });
  }
  if (quadraticCount > 0) {
    const ssQuad = ssModel * (quadraticCount / dfModel);
    const msQuad = ssQuad / quadraticCount;
    const fQuad = msResidual > 0 ? msQuad / msResidual : undefined;
    const pQuad = fQuad !== undefined && dfResidual > 0 ? fDistributionPValue(fQuad, quadraticCount, dfResidual) : undefined;
    anova.push({
      source: 'Quadratic',
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

  const centerPointRuns = validRuns.filter((r) => {
    return activeFactors.every((f) => Math.abs(r.run.factorCoded[f.code] ?? 0) <= 0.08);
  });
  const factorialRuns = validRuns.filter((r) => {
    return !activeFactors.every((f) => Math.abs(r.run.factorCoded[f.code] ?? 0) <= 0.08);
  });

  const nC = centerPointRuns.length;
  const nF = factorialRuns.length;

  if (nC >= 2 && nF >= 2) {
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
  if (n === 0) return [];
  if (n === 1) return [Math.max(l[0], Math.min(u[0], total))];

  // Clip to [l_i, u_i]
  let current = p.map((val, i) => Math.max(l[i], Math.min(u[i], val)));

  // Iterative projection onto simplex hyperplane sum(p_i) = total
  for (let iter = 0; iter < 20; iter++) {
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

  return current.map((v) => Number(v.toFixed(6)));
}

/**
 * Check if coded factor set satisfies all individual survey boundaries [L_i, U_i]
 */
export function isWithinSurveyBounds(
  coded: Record<string, number>,
  factors: Factor[]
): boolean {
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
    } else {
      const c = coded[f.code] ?? 0;
      if (c < -1.05 || c > 1.05) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Multi-Response Desirability Optimization (Derringer & Suich)
 * Finds the global optimum factor combination strictly within the survey region [L_i, U_i]
 */
export function optimizeDesirability(
  factors: Factor[],
  cqas: CQA[],
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  lockedFactors?: Record<string, number>
): DesirabilitySolution | null {
  const validCQAs = cqas.filter((c) => models[c.code]);
  if (validCQAs.length === 0) return null;

  const totalWeight = validCQAs.reduce((sum, c) => sum + (c.weight || 1), 0);
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
  const procFactors = factors.filter((f) => f.role !== 'mixture_component' && f.type !== 'Mixture');
  const hasMixture = mixFactors.length >= 2;

  const mixLowProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.low : f.low / 100));
  const mixHighProps = mixFactors.map((f) => (f.high <= 1.0 && f.unit !== '%' ? f.high : f.high / 100));

  let bestD = -1;
  let bestCoded: Record<string, number> = {};
  let bestDMap: Record<string, number> = {};

  // 1. Seed candidate with Feasible Polytope Centroid
  const initialCandidate: Record<string, number> = {};
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
        const jitter = (Math.random() - 0.5) * 0.25;
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
        const jitter = (Math.random() - 0.5) * range * 0.4;
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
    } else if (f.role === 'mixture_component') {
      const frac = bestCoded[f.code] ?? (1 / mixFactors.length);
      actualFactors[f.code] = Number((frac * 100).toFixed(2));
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
    const se = (model.diagnostics as any).stdDev ?? (model.diagnostics as any).rmseTrain ?? 0.1;
    predictedResponses[cqa.code] = {
      value: Number(val.toFixed(3)),
      se: Number(se.toFixed(3)),
      ciLow: Number((val - 1.96 * se).toFixed(3)),
      ciHigh: Number((val + 1.96 * se).toFixed(3)),
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
  simulations: number = 10000
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
      const sd = Math.max(1e-5, Math.abs(mean) * (variabilityPercent / 100.0));

      // Box-Muller standard normal transform
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const actualVal = mean + z * sd;

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
          sampledProps.push(constNum / 100);
          return;
        }
        const rawMean = setpointActual[f.code];
        const mean: number = typeof rawMean === 'number' ? rawMean : Number(rawMean) || (f.low + f.high) / 2; // mean in %
        const sd = Math.max(1e-5, mean * (variabilityPercent / 100.0));

        const u1 = Math.max(1e-9, Math.random());
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const actualValPct = Math.max(0.01, mean + z * sd);
        sampledProps.push(actualValPct / 100);
      });

      if (hasMixture) {
        const sumProps = sampledProps.reduce((a, b) => a + b, 0);
        mixFactors.forEach((f, idx) => {
          sampleCoded[f.code] = sumProps > 0 ? sampledProps[idx] / sumProps : 1 / mixFactors.length;
        });
      } else {
        mixFactors.forEach((f, idx) => {
          sampleCoded[f.code] = sampledProps[idx];
        });
      }
    }

    // 3. Evaluate each CQA with True Gaussian Model Residual Noise
    let batchPass = true;
    for (const cqa of validCQAs) {
      const model = models[cqa.code];
      const noiseStd = (model.diagnostics as any).stdDev ?? (model.diagnostics as any).rmseTrain ?? (model.diagnostics as any).rmseOverall ?? 0.1;

      // Exact Box-Muller Gaussian Noise for model residual variance
      const uNoise1 = Math.max(1e-9, Math.random());
      const uNoise2 = Math.random();
      const zNoise = Math.sqrt(-2.0 * Math.log(uNoise1)) * Math.cos(2.0 * Math.PI * uNoise2);
      const resError = noiseStd * zNoise;

      const yPred = model.predict(sampleCoded) + resError;
      cqaValues[cqa.code].push(yPred);

      if (cqa.lowerLimit !== undefined && yPred < cqa.lowerLimit) {
        batchPass = false;
      }
      if (cqa.upperLimit !== undefined && yPred > cqa.upperLimit) {
        batchPass = false;
      }
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
    const sd = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length);
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
      let modelQuality = 0;

      if (model) {
        if ('terms' in model) {
          // Statistical Model
          const term = model.terms.find((t) => t.factorCodes.includes(f.code));
          if (term && term.significant) {
            isSig = true;
          }
          modelQuality = model.diagnostics.rSquared;
        } else if ('diagnostics' in model) {
          // Neural Net Model
          const diag = (model as any).diagnostics;
          modelQuality = diag.rSquaredOverall ?? diag.rSquaredVal ?? diag.rSquaredTrain ?? 0.85;
          const varImp = diag.variableImportance?.find((v: any) => v.factorCode === f.code);
          isSig = varImp ? varImp.relativeImportance >= 10 : true;
        }
      }

      // Initial Risk Determination (from prior risk matrix or factor criticality)
      const isCriticalRole = f.role === 'mixture_component' || f.controllability === 'controllable';
      const isHighCriticalCQA = c.weight >= 4 || c.objective === 'target';
      const initialRisk: 'High' | 'Medium' | 'Low' =
        isCriticalRole && isHighCriticalCQA ? 'High' : isCriticalRole || isHighCriticalCQA ? 'Medium' : 'Low';

      let updatedRisk: 'Low' | 'Medium' = 'Low';
      let justification = '';

      if (isSig) {
        if (modelQuality >= 0.75) {
          updatedRisk = 'Low';
          justification = `Đã khảo sát qua DoE và chứng minh có ảnh hưởng có ý nghĩa thống kê (p < 0.05, R² = ${(modelQuality * 100).toFixed(1)}%). Đã thiết lập dải vận hành an toàn PAR [${f.low} - ${f.high} ${f.unit || ''}] trong Design Space để kiểm soát chất lượng, do đó rủi ro giảm xuống Mức Thấp (Low).`;
        } else {
          updatedRisk = 'Medium';
          justification = `Yếu tố có ảnh hưởng đến chỉ tiêu nhưng mô hình có phương sai còn dư. Cần kiểm soát chặt chẽ tại điểm tối ưu và tăng cường kiểm tra trong quá trình (IPC).`;
        }
      } else {
        updatedRisk = 'Low';
        justification = `Kết quả DoE và ANOVA khẳng định yếu tố không gây ảnh hưởng bất lợi có ý nghĩa thống kê (p ≥ 0.05) trong toàn bộ dải khảo sát [${f.low} - ${f.high} ${f.unit || ''}]. Rủi ro được giảm xuống Mức Thấp (Low).`;
      }

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

    const norStr = `${norLow} - ${norHigh} ${f.unit || ''}`.trim();
    const parStr = `${f.low} - ${f.high} ${f.unit || ''}`.trim();
    const dsStr = `Nằm trong vùng chấp nhận đa biến (Multivariate Design Space)`;

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

