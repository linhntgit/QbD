/**
 * Transformation of polynomial regression models from coded coordinates x_i in [-1, +1]
 * to actual / natural physical units X_i in [Low_i, High_i].
 *
 * For a continuous factor i:
 *   x_i = (X_i - Center_i) / Scale_i = a_i * X_i + b_i
 *   where Scale_i = (High_i - Low_i) / 2
 *         Center_i = (High_i + Low_i) / 2
 *         a_i = 1 / Scale_i
 *         b_i = -Center_i / Scale_i
 *
 * For mixture components (already 0..1 or 0..100%):
 *   If unit is '%' or high > 1, scaled accordingly.
 */

import type { Factor, RegressionTerm } from '../types/qbd';

export interface ActualModelTerm {
  name: string; // e.g., 'Intercept', 'Temperature', 'Pressure*Time', 'Temperature²'
  factorCodes: string[];
  coefficient: number;
  formattedText: string;
}

export interface ActualEquationResult {
  intercept: number;
  terms: ActualModelTerm[];
  equationString: string;
  latexString: string;
}

/**
 * Formats a numeric coefficient nicely with appropriate significant digits or decimal places.
 */
function formatCoeff(val: number): string {
  if (Math.abs(val) < 1e-6 && val !== 0) {
    return val.toExponential(4);
  }
  if (Math.abs(val) >= 10000) {
    return val.toExponential(4);
  }
  // Trim trailing zeros after decimal
  const str = val.toFixed(4);
  return str.replace(/\.?0+$/, '');
}

/**
 * Transforms regression terms from coded scale to actual engineering units.
 */
export function convertCodedToActualEquation(
  terms: RegressionTerm[],
  factors: Factor[],
  responseCode = 'Y'
): ActualEquationResult {
  const factorMap = new Map<string, Factor>();
  factors.forEach((f) => factorMap.set(f.code, f));

  // Precompute linear transform parameters: x_i = a_i * X_i + b_i
  const a: Record<string, number> = {};
  const b: Record<string, number> = {};

  factors.forEach((f) => {
    if (f.dataType === 'qualitative') {
      // Categorical indicator contrasts remain 0 or 1
      a[f.code] = 1;
      b[f.code] = 0;
      return;
    }

    const isMixture = f.role === 'mixture_component' || f.type === 'Mixture';
    if (isMixture) {
      // Mixture factors in coded coordinates are typically fractions [0, 1]
      // In actual units, if unit is %, X_i = x_i * 100 => x_i = 0.01 * X_i
      if (f.unit === '%' || f.high > 1.0) {
        a[f.code] = 0.01;
        b[f.code] = 0;
      } else {
        a[f.code] = 1;
        b[f.code] = 0;
      }
      return;
    }

    const low = f.low;
    const high = f.high;
    const scale = (high - low) / 2;
    const center = f.center !== undefined ? f.center : (high + low) / 2;

    if (Math.abs(scale) < 1e-12) {
      a[f.code] = 1;
      b[f.code] = 0;
    } else {
      a[f.code] = 1 / scale;
      b[f.code] = -center / scale;
    }
  });

  // Accumulators for actual polynomial coefficients
  let actualIntercept = 0;
  const actualLinear: Record<string, number> = {};
  const actualInteractions: Record<string, number> = {}; // key: 'X1*X2'
  const actualQuadratic: Record<string, number> = {}; // key: 'X1'

  // Initialize linear & quadratic maps
  factors.forEach((f) => {
    actualLinear[f.code] = 0;
    actualQuadratic[f.code] = 0;
  });

  for (const term of terms) {
    const coeff = term.coefficient;
    const codes = term.factorCodes;

    // 1. Intercept term
    if (codes.length === 0 || term.name === 'Intercept') {
      actualIntercept += coeff;
      continue;
    }

    // 2. Linear term: beta_i * (a_i * X_i + b_i)
    if (codes.length === 1 && (term.power.length === 0 || term.power.reduce((s, p) => s + p, 0) === 1)) {
      const code = codes[0];
      const a_i = a[code] ?? 1;
      const b_i = b[code] ?? 0;

      actualIntercept += coeff * b_i;
      actualLinear[code] = (actualLinear[code] ?? 0) + coeff * a_i;
      continue;
    }

    // 3. Quadratic term: beta_ii * (a_i * X_i + b_i)^2
    //    = beta_ii * (b_i^2 + 2*a_i*b_i*X_i + a_i^2*X_i^2)
    if (codes.length === 1 && term.power.some((p) => p === 2)) {
      const code = codes[0];
      const a_i = a[code] ?? 1;
      const b_i = b[code] ?? 0;

      actualIntercept += coeff * b_i * b_i;
      actualLinear[code] = (actualLinear[code] ?? 0) + coeff * 2 * a_i * b_i;
      actualQuadratic[code] = (actualQuadratic[code] ?? 0) + coeff * a_i * a_i;
      continue;
    }

    // 4. Two-Factor Interaction term: beta_ij * (a_i * X_i + b_i) * (a_j * X_j + b_j)
    //    = beta_ij * [b_i*b_j + b_j*a_i*X_i + b_i*a_j*X_j + a_i*a_j*X_i*X_j]
    if (codes.length === 2) {
      const code1 = codes[0];
      const code2 = codes[1];
      const a_1 = a[code1] ?? 1;
      const b_1 = b[code1] ?? 0;
      const a_2 = a[code2] ?? 1;
      const b_2 = b[code2] ?? 0;

      // Ensure consistent canonical ordering for interaction keys
      const sortedKey = [code1, code2].sort().join('*');

      actualIntercept += coeff * b_1 * b_2;
      actualLinear[code1] = (actualLinear[code1] ?? 0) + coeff * a_1 * b_2;
      actualLinear[code2] = (actualLinear[code2] ?? 0) + coeff * a_2 * b_1;
      actualInteractions[sortedKey] = (actualInteractions[sortedKey] ?? 0) + coeff * a_1 * a_2;
      continue;
    }
  }

  // Construct structured result
  const resultTerms: ActualModelTerm[] = [];

  // Add linear terms
  factors.forEach((f) => {
    const val = actualLinear[f.code];
    if (val !== undefined && Math.abs(val) > 1e-8) {
      resultTerms.push({
        name: f.name || f.code,
        factorCodes: [f.code],
        coefficient: val,
        formattedText: `${formatCoeff(val)} * ${f.name || f.code}`,
      });
    }
  });

  // Add interaction terms
  Object.entries(actualInteractions).forEach(([key, val]) => {
    if (Math.abs(val) > 1e-8) {
      const [c1, c2] = key.split('*');
      const name1 = factorMap.get(c1)?.name || c1;
      const name2 = factorMap.get(c2)?.name || c2;
      resultTerms.push({
        name: `${name1} * ${name2}`,
        factorCodes: [c1, c2],
        coefficient: val,
        formattedText: `${formatCoeff(val)} * ${name1} * ${name2}`,
      });
    }
  });

  // Add quadratic terms
  factors.forEach((f) => {
    const val = actualQuadratic[f.code];
    if (val !== undefined && Math.abs(val) > 1e-8) {
      const name = f.name || f.code;
      resultTerms.push({
        name: `${name}²`,
        factorCodes: [f.code],
        coefficient: val,
        formattedText: `${formatCoeff(val)} * (${name})²`,
      });
    }
  });

  // Build Equation String
  const parts: string[] = [formatCoeff(actualIntercept)];
  resultTerms.forEach((t) => {
    const sign = t.coefficient >= 0 ? '+ ' : '- ';
    const absVal = Math.abs(t.coefficient);
    parts.push(`${sign}${formatCoeff(absVal)} * ${t.name}`);
  });
  const equationString = `${responseCode} = ${parts.join(' ')}`;

  // Build LaTeX String
  const latexParts: string[] = [formatCoeff(actualIntercept)];
  resultTerms.forEach((t) => {
    const sign = t.coefficient >= 0 ? '+ ' : '- ';
    const absVal = Math.abs(t.coefficient);
    const escapedName = t.name.replace(/_/g, '\\_').replace(/²/g, '^2');
    latexParts.push(`${sign}${formatCoeff(absVal)} \\cdot \\text{${escapedName}}`);
  });
  const latexString = `${responseCode} = ${latexParts.join(' ')}`;

  return {
    intercept: actualIntercept,
    terms: resultTerms,
    equationString,
    latexString,
  };
}
