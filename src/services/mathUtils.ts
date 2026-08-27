// Numerical and statistical mathematical utilities for QbD DoE

/**
 * Matrix multiplication A (m x p) * B (p x n) -> (m x n)
 */
export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const p = A[0].length;
  const n = B[0].length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));

  for (let i = 0; i < m; i++) {
    for (let k = 0; k < p; k++) {
      const a_ik = A[i][k];
      for (let j = 0; j < n; j++) {
        C[i][j] += a_ik * B[k][j];
      }
    }
  }
  return C;
}

/**
 * Matrix transpose A (m x n) -> A^T (n x m)
 */
export function matTranspose(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const AT: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      AT[j][i] = A[i][j];
    }
  }
  return AT;
}

/**
 * Matrix inverse using Gauss-Jordan elimination with partial pivoting and ridge regularization if ill-conditioned
 */
export function matInverse(A: number[][], ridgeLambda: number = 0): number[][] {
  const n = A.length;
  if (n === 0 || A.some((row) => row.length !== n)) {
    throw new Error('Matrix inverse requires a non-empty square matrix.');
  }

  // Ridge is available only to callers that explicitly request penalised inversion.
  // Statistical OLS inference must never silently regularise a singular design.
  const M: number[][] = A.map((row, i) =>
    row.map((val, j) => (i === j ? val + ridgeLambda : val))
  );

  const I: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > maxVal) {
        maxVal = Math.abs(M[r][i]);
        maxRow = r;
      }
    }

    if (maxVal < 1e-12) {
      throw new Error('Matrix is singular or numerically rank deficient.');
    }

    // Swap rows in M and I
    if (maxRow !== i) {
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      [I[i], I[maxRow]] = [I[maxRow], I[i]];
    }

    // Normalize pivot row
    const pivot = M[i][i];
    for (let j = 0; j < n; j++) {
      M[i][j] /= pivot;
      I[i][j] /= pivot;
    }

    // Eliminate other rows
    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = M[r][i];
        if (Math.abs(factor) > 1e-15) {
          for (let c = 0; c < n; c++) {
            M[r][c] -= factor * M[i][c];
            I[r][c] -= factor * I[i][c];
          }
        }
      }
    }
  }

  return I;
}

// -------------------------------------------------------------
// Statistical Distribution Functions (Gamma, Beta, F, Student-t, Normal)
// -------------------------------------------------------------

/**
 * Log Gamma function approximation via Lanczos series (g=5, n=7)
 */
export function logGamma(z: number): number {
  if (z <= 0) return 0;
  const p = [
    1.000000000190015,
    76.18009172947146,
    -86.50532032941678,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  let x = z;
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = p[0];
  for (let j = 1; j <= 6; j++) {
    y += 1;
    ser += p[j] / y;
  }
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / x);
}

/**
 * Continued fraction evaluation for regularized incomplete beta function I_x(a, b)
 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3.0e-7;
  const FPMIN = 1.0e-30;

  const qab = a + b;
  const qap = a + 1.0;
  const qam = a - 1.0;
  let c = 1.0;
  let d = 1.0 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1.0 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1.0 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1.0 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1.0) < EPS) break;
  }
  return h;
}

/**
 * Regularized Incomplete Beta function I_x(a, b)
 */
export function incBeta(a: number, b: number, x: number): number {
  if (x < 0.0 || x > 1.0) return 0;
  if (x === 0.0) return 0.0;
  if (x === 1.0) return 1.0;

  // Factors in front of continued fraction
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1.0 - x));

  if (x < (a + 1.0) / (a + b + 2.0)) {
    return (bt * betacf(a, b, x)) / a;
  } else {
    return 1.0 - (bt * betacf(b, a, 1.0 - x)) / b;
  }
}

/**
 * P-value from F-distribution F(df1, df2)
 * Returns P(F >= fVal)
 */
export function fDistributionPValue(fVal: number, df1: number, df2: number): number {
  if (fVal <= 0 || isNaN(fVal) || df1 <= 0 || df2 <= 0) return 1.0;
  const x = df2 / (df2 + df1 * fVal);
  const p = incBeta(df2 / 2, df1 / 2, x);
  return Math.min(1.0, Math.max(0.0, p));
}

/**
 * Two-tailed P-value from Student-t distribution t(df)
 * Returns P(|T| >= |tVal|)
 */
export function tDistributionPValue(tVal: number, df: number): number {
  if (df <= 0 || isNaN(tVal)) return 1.0;
  const absT = Math.abs(tVal);
  const x = df / (df + absT * absT);
  const p = incBeta(df / 2, 0.5, x);
  return Math.min(1.0, Math.max(0.0, p));
}

/**
 * Standard Normal (Gaussian) Cumulative Distribution Function CDF
 */
export function normalCDF(x: number, mean: number = 0, sd: number = 1): number {
  const z = (x - mean) / sd;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}

/**
 * Standard Normal Quantile Function (probit / inverse CDF)
 */
export function normalInverseCDF(p: number): number {
  if (p <= 0) return -6;
  if (p >= 1) return 6;
  if (p === 0.5) return 0;

  // Rational approximation by Abramowitz and Stegun
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

  const q = p < 0.5 ? p : 1 - p;
  let r: number;

  if (q > 0.02425) {
    const u = q - 0.5;
    const u2 = u * u;
    r =
      (u *
        (((((a[0] * u2 + a[1]) * u2 + a[2]) * u2 + a[3]) * u2 + a[4]) * u2 +
          a[5])) /
      (((((b[0] * u2 + b[1]) * u2 + b[2]) * u2 + b[3]) * u2 + b[4]) * u2 + 1);
  } else {
    const v = Math.sqrt(-2 * Math.log(q));
    r =
      (((((c[0] * v + c[1]) * v + c[2]) * v + c[3]) * v + c[4]) * v + c[5]) /
      ((((d[0] * v + d[1]) * v + d[2]) * v + d[3]) * v + 1);
  }

  // The lower-tail rational approximation is already negative.  The previous
  // sign reversal mirrored Q-Q plots about the origin.
  return p < 0.5 ? r : -r;
}

/**
 * Positive two-sided Student-t critical value, solved from the existing
 * accurate survival-probability routine.  It avoids a second approximation
 * family and is sufficient for confidence-interval calculations.
 */
export function tDistributionCritical(alpha: number, df: number): number {
  if (!(alpha > 0 && alpha < 1) || df <= 0) return Number.NaN;
  let low = 0;
  let high = 1;
  while (tDistributionPValue(high, df) > alpha && high < 1e6) high *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (tDistributionPValue(mid, df) > alpha) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Derringer and Suich Individual Desirability Calculation d_i (Slide 24-27)
 */
export function calculateIndividualDesirability(
  y: number,
  objective: string,
  lowLimit?: number,
  highLimit?: number,
  target?: number,
  s: number = 1.0,
  t: number = 1.0
): number {
  if (isNaN(y) || y === null || y === undefined) return 0;

  switch (objective) {
    case 'pass_category': {
      // 100% or >= 90% is pass
      if (y >= 90) return 1.0;
      if (y <= 0) return 0.0;
      return Math.max(0, Math.min(1.0, y / 100.0));
    }
    case 'maximize': {
      // Ramp Up (Slide 24, 25): d=0 when y <= L (0% satisfaction), d=1 when y >= T (100% satisfaction)
      const L = lowLimit !== undefined ? lowLimit : target !== undefined ? target * 0.8 : 0;
      const T = target !== undefined ? target : highLimit !== undefined ? highLimit : L !== 0 ? L * 1.5 : 100;
      if (T <= L) return y >= L ? 1.0 : 0.0;
      if (y <= L) return 0.0;
      if (y >= T) return 1.0;
      const frac = (y - L) / (T - L);
      return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, s));
    }

    case 'minimize': {
      // Ramp Down (Slide 25, 26): d=1 when y <= T (100% satisfaction), d=0 when y >= U (0% satisfaction)
      const T = target !== undefined ? target : lowLimit !== undefined ? lowLimit : 0;
      const U = highLimit !== undefined ? highLimit : T !== 0 ? T * 1.5 : 100;
      const power = t !== undefined && t !== 1.0 ? t : s;
      if (U <= T) return y <= U ? 1.0 : 0.0;
      if (y <= T) return 1.0;
      if (y >= U) return 0.0;
      const frac = (U - y) / (U - T);
      return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, power));
    }

    case 'target': {
      // Tent / Trapezoid Shape (Slide 26, 27): d=0 outside [L, U], d=1 at Target T
      const L = lowLimit !== undefined ? lowLimit : target !== undefined ? target * 0.9 : 0;
      const U = highLimit !== undefined ? highLimit : target !== undefined ? target * 1.1 : 100;
      const T = target !== undefined ? target : (L + U) / 2;
      if (y < L || y > U) return 0.0;
      if (T <= L && U <= T) return y === T ? 1.0 : 0.0;
      if (T <= L) {
        // Lower limit equals Target (e.g. L = T = 78, U = 85)
        if (y < T) return 0.0;
        if (U <= T) return 1.0;
        const frac = (U - y) / (U - T);
        return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, t));
      }
      if (U <= T) {
        // Upper limit equals Target
        if (y > T) return 0.0;
        if (T <= L) return 1.0;
        const frac = (y - L) / (T - L);
        return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, s));
      }
      if (y <= T) {
        const frac = (y - L) / (T - L);
        return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, s));
      } else {
        const frac = (U - y) / (U - T);
        return Math.pow(Math.max(0, Math.min(1.0, frac)), Math.max(0.01, t));
      }
    }

    case 'range': {
      const L = lowLimit !== undefined ? lowLimit : 0;
      const U = highLimit !== undefined ? highLimit : 100;
      if (y >= L && y <= U) return 1.0;
      return 0.0;
    }

    default:
      return 1.0;
  }
}

/**
 * Calculate QbD Acceptance Criterion Margin for a given predicted response.
 * Margin >= 0 indicates PASS (within specification / Design Space).
 * Margin < 0 indicates FAIL (Out of Specification - OOS).
 */
export function calculateCQAMargin(
  yPred: number,
  objective: string,
  lowerLimit?: number,
  upperLimit?: number,
  target?: number
): number {
  if (isNaN(yPred)) return -1;

  if (objective === 'minimize') {
    // For minimize, specification is y <= upperLimit (USL)
    if (upperLimit !== undefined) {
      const range = lowerLimit !== undefined && upperLimit > lowerLimit ? upperLimit - lowerLimit : Math.abs(upperLimit) || 1.0;
      return (upperLimit - yPred) / range;
    }
    if (lowerLimit !== undefined) {
      return (lowerLimit - yPred) / (Math.abs(lowerLimit) || 1.0);
    }
  } else if (objective === 'maximize') {
    // For maximize, specification is y >= lowerLimit (LSL)
    if (lowerLimit !== undefined) {
      const range = upperLimit !== undefined && upperLimit > lowerLimit ? upperLimit - lowerLimit : Math.abs(lowerLimit) || 1.0;
      return (yPred - lowerLimit) / range;
    }
    if (upperLimit !== undefined) {
      return (yPred - upperLimit) / (Math.abs(upperLimit) || 1.0);
    }
  } else if (objective === 'target') {
    // For target, specification is within [lowerLimit, upperLimit]
    if (lowerLimit !== undefined && upperLimit !== undefined) {
      const range = upperLimit - lowerLimit || 1.0;
      const distLower = (yPred - lowerLimit) / range;
      const distUpper = (upperLimit - yPred) / range;
      return Math.min(distLower, distUpper);
    }
    if (target !== undefined) {
      const tol = Math.abs(target) > 0 ? Math.abs(target) * 0.1 : 1.0;
      return 1.0 - Math.abs(yPred - target) / tol;
    }
  } else {
    // Default dual limit
    if (lowerLimit !== undefined && upperLimit !== undefined) {
      const range = upperLimit - lowerLimit || 1.0;
      const distLower = (yPred - lowerLimit) / range;
      const distUpper = (upperLimit - yPred) / range;
      return Math.min(distLower, distUpper);
    }
    if (lowerLimit !== undefined) return (yPred - lowerLimit) / (Math.abs(lowerLimit) || 1.0);
    if (upperLimit !== undefined) return (upperLimit - yPred) / (Math.abs(upperLimit) || 1.0);
  }

  return 1.0;
}

/**
 * Compute the Determinant of a square matrix |M| using LU / Gaussian elimination with partial pivoting
 */
export function matrixDeterminant(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 0) return 0;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];

  // Deep clone
  const A = matrix.map((row) => [...row]);
  let det = 1.0;
  let swaps = 0;

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(A[i][i]);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > maxVal) {
        maxVal = Math.abs(A[r][i]);
        maxRow = r;
      }
    }

    if (maxVal < 1e-18) {
      return 0; // Singular matrix
    }

    if (maxRow !== i) {
      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      swaps++;
    }

    det *= A[i][i];

    for (let r = i + 1; r < n; r++) {
      const factor = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) {
        A[r][c] -= factor * A[i][c];
      }
    }
  }

  return swaps % 2 === 1 ? -det : det;
}

/**
 * Compute the trace of a square matrix (sum of diagonal elements)
 */
export function matrixTrace(matrix: number[][]): number {
  let tr = 0;
  const n = Math.min(matrix.length, matrix[0]?.length || 0);
  for (let i = 0; i < n; i++) {
    tr += matrix[i][i];
  }
  return tr;
}

/**
 * Format an axis title cleanly.
 * If the total string length exceeds `maxSingleLine` (default: 24 characters),
 * it smartly splits into 2 lines using `<br>`:
 * Line 1: Variable Name
 * Line 2: (Code) [Unit]
 */
export function formatAxisTitle(
  name: string,
  code: string,
  unit?: string,
  maxSingleLine: number = 24
): string {
  const cleanUnit = unit && unit.trim() ? ` [${unit.trim()}]` : '';
  const singleLine = `${name} (${code})${cleanUnit}`;

  if (singleLine.length <= maxSingleLine) {
    return singleLine;
  }

  // Split into 2 lines: Name on line 1, (Code) [Unit] on line 2
  return `${name}<br>(${code})${cleanUnit}`;
}

/**
 * 2D Marching Squares Contour Line Segment Extractor
 * Extracts vector segments (x1, y1, x2, y2) where a 2D scalar field zGrid(y, x) equals isoValue.
 */
export interface Contour2DSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function extract2DContourSegments(
  xArr: number[],
  yArr: number[],
  zGrid: number[][],
  isoValue: number
): Contour2DSegment[] {
  const segments: Contour2DSegment[] = [];
  const Ny = yArr.length;
  const Nx = xArr.length;
  if (Ny < 2 || Nx < 2 || zGrid.length < 2) return segments;

  const interp = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    if (Math.abs(z2 - z1) < 1e-12) return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    const t = Math.max(0, Math.min(1, (isoValue - z1) / (z2 - z1)));
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  };

  // Process each quad by splitting into 2 triangles
  for (let j = 0; j < Ny - 1; j++) {
    const y0 = yArr[j];
    const y1 = yArr[j + 1];

    for (let i = 0; i < Nx - 1; i++) {
      const x0 = xArr[i];
      const x1 = xArr[i + 1];

      const z00 = zGrid[j][i];
      const z10 = zGrid[j][i + 1];
      const z01 = zGrid[j + 1][i];
      const z11 = zGrid[j + 1][i + 1];

      if (
        z00 === undefined ||
        z10 === undefined ||
        z01 === undefined ||
        z11 === undefined
      ) {
        continue;
      }

      // Triangle 1: (x0, y0), (x1, y0), (x0, y1)
      const pts1: { x: number; y: number }[] = [];
      if ((z00 <= isoValue && z10 >= isoValue) || (z10 <= isoValue && z00 >= isoValue)) {
        if (z00 !== z10) pts1.push(interp(x0, y0, z00, x1, y0, z10));
      }
      if ((z10 <= isoValue && z01 >= isoValue) || (z01 <= isoValue && z10 >= isoValue)) {
        if (z10 !== z01) pts1.push(interp(x1, y0, z10, x0, y1, z01));
      }
      if ((z01 <= isoValue && z00 >= isoValue) || (z00 <= isoValue && z01 >= isoValue)) {
        if (z01 !== z00) pts1.push(interp(x0, y1, z01, x0, y0, z00));
      }
      if (pts1.length >= 2) {
        segments.push({ x1: pts1[0].x, y1: pts1[0].y, x2: pts1[1].x, y2: pts1[1].y });
      }

      // Triangle 2: (x1, y0), (x1, y1), (x0, y1)
      const pts2: { x: number; y: number }[] = [];
      if ((z10 <= isoValue && z11 >= isoValue) || (z11 <= isoValue && z10 >= isoValue)) {
        if (z10 !== z11) pts2.push(interp(x1, y0, z10, x1, y1, z11));
      }
      if ((z11 <= isoValue && z01 >= isoValue) || (z01 <= isoValue && z11 >= isoValue)) {
        if (z11 !== z01) pts2.push(interp(x1, y1, z11, x0, y1, z01));
      }
      if ((z01 <= isoValue && z10 >= isoValue) || (z10 <= isoValue && z01 >= isoValue)) {
        if (z01 !== z10) pts2.push(interp(x0, y1, z01, x1, y0, z10));
      }
      if (pts2.length >= 2) {
        segments.push({ x1: pts2[0].x, y1: pts2[0].y, x2: pts2[1].x, y2: pts2[1].y });
      }
    }
  }

  return segments;
}

/**
 * Calculate Information Criteria (AICc, BIC, -2LL, Log-Likelihood)
 * According to Pharmaceutical Formulation DoE Standards (Slide 12)
 */
export interface InformationCriteria {
  aicc: number;
  bic: number;
  twoLL: number;
  logLikelihood: number;
}

export function calculateInformationCriteria(n: number, p: number, sse: number): InformationCriteria {
  if (n <= 0 || sse <= 0) {
    return { aicc: 0, bic: 0, twoLL: 0, logLikelihood: 0 };
  }
  const safeSSE = Math.max(1e-12, sse);
  const logTerm = n * Math.log(safeSSE / n);
  const constTerm = n * Math.log(2 * Math.PI) + n;

  const twoLL = logTerm + constTerm;
  const logLikelihood = -twoLL / 2;

  // AICc with Hurvich & Tsai small-sample correction
  const denom = n - p - 1;
  const aiccPenalty = 2 * p + (denom > 0 ? (2 * p * (p + 1)) / denom : 2 * p);
  const aicc = twoLL + aiccPenalty;

  // BIC penalty (Schwarz Criterion)
  const bicPenalty = p * Math.log(n);
  const bic = twoLL + bicPenalty;

  return {
    aicc: Number(aicc.toFixed(3)),
    bic: Number(bic.toFixed(3)),
    twoLL: Number(twoLL.toFixed(3)),
    logLikelihood: Number(logLikelihood.toFixed(3)),
  };
}

/**
 * Calculate Carpenter (1995) Neural Architecture and Empirical Rules
 * According to Pharmaceutical Formulation ANN Guidelines (Slide 31-32)
 */
export interface CarpenterArchitectureResult {
  carpenterRecommended: number;
  totalWeights: number;
  totalNodes: number;
  totalDegrees: number;
  isSafe: boolean; // totalWeights + totalNodes < N
  overfittingRisk: 'safe' | 'warning' | 'danger';
  rules: { name: string; value: number; description: string }[];
  recommendation: string;
}

export function calculateCarpenterArchitecture(
  nInputs: number,
  nOutputs: number,
  nSamples: number,
  beta: number = 1.2
): CarpenterArchitectureResult {
  const n = Math.max(1, nInputs);
  const m = Math.max(1, nOutputs);
  const N = Math.max(1, nSamples);

  // Carpenter (1995) formula: h = (N/beta - m) / (n + m + 1)
  const rawH = (N / Math.max(1.0, beta) - m) / (n + m + 1);
  const hCarpenter = Math.max(1, Math.min(Math.max(1, 2 * n), Math.round(rawH)));

  // Parameter calculation for 1 hidden layer
  const weights = n * hCarpenter + hCarpenter * m;
  const biases = hCarpenter + m;
  const totalParams = weights + biases;
  const isSafe = totalParams < N;

  const rules = [
    {
      name: 'Carpenter (1995)',
      value: hCarpenter,
      description: `Công thức Carpenter với β=${beta}: h = (N/β - m)/(n + m + 1)`,
    },
    {
      name: 'Quy tắc 2/3 (Two-Thirds Rule)',
      value: Math.max(1, Math.round(n + (2 / 3) * m)),
      description: `h = n + 2/3 * m = ${n} + 2/3 * ${m}`,
    },
    {
      name: 'Quy tắc Trung bình (Between Inputs & Outputs)',
      value: Math.max(1, Math.round((n + m) / 2)),
      description: `h = (n + m) / 2 = (${n} + ${m}) / 2`,
    },
    {
      name: 'Quy tắc Logarithm mẫu',
      value: Math.max(1, Math.round(Math.log(N))),
      description: `h ≈ ln(N) = ln(${N})`,
    },
    {
      name: 'Giới hạn trên (Max 2n)',
      value: 2 * n,
      description: `h ≤ 2 * n = ${2 * n}`,
    },
  ];

  let overfittingRisk: 'safe' | 'warning' | 'danger' = 'safe';
  let recommendation = '';

  if (totalParams >= N) {
    overfittingRisk = 'danger';
    recommendation = `⚠️ Cảnh báo Overfitting: Tổng số tham số (${totalParams}) vượt quá số mẫu thí nghiệm (${N}). Khuyến nghị giảm số nơ-ron ẩn xuống ${Math.max(1, Math.floor(hCarpenter / 2))} hoặc tăng số thí nghiệm.`;
  } else if (totalParams >= N * 0.75) {
    overfittingRisk = 'warning';
    recommendation = `⚡ Cảnh báo: Tỷ lệ tham số / mẫu khá cao (${totalParams}/${N}). Nên áp dụng Dropout hoặc Weight Decay L2 >= 0.01.`;
  } else {
    overfittingRisk = 'safe';
    recommendation = `✓ Cấu trúc tối ưu: Kiến trúc [${n} → ${hCarpenter} → ${m}] cân bằng hoàn hảo giữa độ chính xác và khả năng tổng quát hóa (Tổng tham số = ${totalParams} < N = ${N}).`;
  }

  return {
    carpenterRecommended: hCarpenter,
    totalWeights: weights,
    totalNodes: biases,
    totalDegrees: totalParams,
    isSafe,
    overfittingRisk,
    rules,
    recommendation,
  };
}

