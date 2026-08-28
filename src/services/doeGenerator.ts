import type { Factor, DoEDesignConfig, DoERun, DesignEvaluationMetrics } from '../types/qbd';
import {
  matMul,
  matTranspose,
  matrixDeterminant,
  matrixTrace,
  matInverse,
} from './mathUtils';
import { buildModelVector, getModelTermCount } from './modelTerms';
import { createSeededRandom } from './random';

const configuredLevels = (factor: Factor): Array<number | string> => {
  const raw = (factor.categories ?? []).map((level) => level.trim()).filter(Boolean).slice(0, 10);
  if (factor.dataType === 'quantitative_multilevel') {
    return raw.map(Number).filter(Number.isFinite);
  }
  return raw;
};

const evenlySpacedCodes = (count: number): number[] => {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => Number((-1 + (2 * index) / (count - 1)).toFixed(4)));
};

export function getConfiguredFactorCodes(factor: Factor): number[] {
  const levels = configuredLevels(factor);
  if ((factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel') && levels.length >= 2) {
    return evenlySpacedCodes(levels.length);
  }
  return [-1, 0, 1];
}

/**
 * Convert coded factor value (-1, 0, +1, +alpha, -alpha) to actual physical value or categorical label
 */
export function codedToActual(coded: number, factor: Factor): number | string {
  // Constant Factor
  if (factor.controllability === 'constant') {
    return factor.constantValue ?? factor.low;
  }

  // Categorical and discrete-numeric factors use every configured level.
  if (factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel') {
    const levels = configuredLevels(factor);
    if (levels.length > 0) {
      const codes = evenlySpacedCodes(levels.length);
      let nearestIndex = 0;
      for (let index = 1; index < codes.length; index++) {
        if (Math.abs(codes[index] - coded) < Math.abs(codes[nearestIndex] - coded)) nearestIndex = index;
      }
      return levels[nearestIndex];
    }
  }

  // Mixture Component Factor (coded is proportion 0..1, actual is percentage 0..100%)
  if (factor.role === 'mixture_component' || factor.type === 'Mixture') {
    if (factor.high <= 1.0 && factor.unit !== '%') {
      return Number(coded.toFixed(4));
    }
    return Number((coded * 100).toFixed(2));
  }

  // Standard Quantitative Continuous Factor
  const low = factor.low;
  const high = factor.high;
  const center = factor.center !== undefined ? factor.center : (low + high) / 2;
  const halfRange = (high - low) / 2;
  return Number((center + coded * halfRange).toFixed(4));
}

/**
 * Convert actual physical value to coded factor value
 */
export function actualToCoded(actual: number | string, factor: Factor): number {
  if (factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel') {
    const levels = configuredLevels(factor);
    const index = factor.dataType === 'quantitative_multilevel'
      ? levels.findIndex((level) => Number(level) === Number(actual))
      : levels.findIndex((level) => String(level) === String(actual));
    return index >= 0 ? evenlySpacedCodes(levels.length)[index] : 0;
  }
  const val = typeof actual === 'number' ? actual : Number(actual);

  // Mixture Component Factor (actual is 0..100%, coded is proportion 0..1)
  if (factor.role === 'mixture_component' || factor.type === 'Mixture') {
    if (factor.high <= 1.0 && factor.unit !== '%') {
      return Number(val.toFixed(4));
    }
    return Number((val / 100).toFixed(4));
  }

  const low = factor.low;
  const high = factor.high;
  const center = factor.center !== undefined ? factor.center : (low + high) / 2;
  const halfRange = (high - low) / 2;
  if (halfRange === 0) return 0;
  return Number(((val - center) / halfRange).toFixed(4));
}

/**
 * Generate Full Factorial 2^k matrix
 */
export function generateFullFactorial(k: number): number[][] {
  const n = Math.pow(2, k);
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      const bit = (i >> j) & 1;
      row.push(bit === 0 ? -1 : 1);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Generate Fractional Factorial 2^(k-p)
 */
export function generateFractionalFactorial(k: number): number[][] {
  if (k <= 2) return generateFullFactorial(k);
  if (k === 3) {
    // 2^(3-1) = 4 runs, X3 = X1 * X2
    const base = generateFullFactorial(2);
    return base.map(row => [...row, row[0] * row[1]]);
  }
  if (k === 4) {
    // 2^(4-1) = 8 runs, X4 = X1 * X2 * X3
    const base = generateFullFactorial(3);
    return base.map(row => [...row, row[0] * row[1] * row[2]]);
  }
  if (k === 5) {
    // 2^(5-1) = 16 runs, X5 = X1 * X2 * X3 * X4
    const base = generateFullFactorial(4);
    return base.map(row => [...row, row[0] * row[1] * row[2] * row[3]]);
  }
  // One-half fraction for larger screening designs. Use a resolution-IV
  // generator Xk = X1*X2*X3 rather than silently expanding to a full 2^k.
  const base = generateFullFactorial(k - 1);
  return base.map((row) => [...row, row[0] * row[1] * row[2]]);
}

/**
 * Generate Plackett-Burman Design matrix (N=8, 12, 16)
 */
export function generatePlackettBurman(k: number): number[][] {
  if (k < 1 || k > 15) return [];
  let baseRow: number[] = [];
  let nRuns = 12;

  if (k <= 7) {
    nRuns = 8;
    baseRow = [1, 1, 1, -1, 1, -1, -1];
  } else if (k <= 11) {
    nRuns = 12;
    baseRow = [1, 1, -1, 1, 1, 1, -1, -1, -1, 1, -1];
  } else {
    nRuns = 16;
    baseRow = [1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, 1, -1, -1, -1];
  }

  const matrix: number[][] = [];
  const fullCols = baseRow.length;

  for (let i = 0; i < nRuns - 1; i++) {
    const row: number[] = [];
    for (let j = 0; j < fullCols; j++) {
      const idx = (j - i + fullCols * 10) % fullCols;
      row.push(baseRow[idx]);
    }
    matrix.push(row.slice(0, k));
  }
  // Last row of all -1
  matrix.push(new Array(k).fill(-1));
  return matrix;
}

/**
 * Generate Taguchi Orthogonal Arrays
 */
export function generateTaguchi(k: number, arrayType?: string): number[][] {
  const L4 = [
    [-1, -1, -1],
    [-1,  1,  1],
    [ 1, -1,  1],
    [ 1,  1, -1]
  ];

  const L8 = [
    [-1, -1, -1, -1, -1, -1, -1],
    [-1, -1, -1,  1,  1,  1,  1],
    [-1,  1,  1, -1, -1,  1,  1],
    [-1,  1,  1,  1,  1, -1, -1],
    [ 1, -1,  1, -1,  1, -1,  1],
    [ 1, -1,  1,  1, -1,  1, -1],
    [ 1,  1, -1, -1,  1,  1, -1],
    [ 1,  1, -1,  1, -1, -1,  1]
  ];

  const L9_3level = [
    [-1, -1, -1, -1],
    [-1,  0,  0,  0],
    [-1,  1,  1,  1],
    [ 0, -1,  0,  1],
    [ 0,  0,  1, -1],
    [ 0,  1, -1,  0],
    [ 1, -1,  1,  0],
    [ 1,  0, -1,  1],
    [ 1,  1,  0, -1]
  ];

  const hadamard = (order: number): number[][] => {
    let matrix = [[1]];
    while (matrix.length < order) {
      matrix = [
        ...matrix.map((row) => [...row, ...row]),
        ...matrix.map((row) => [...row, ...row.map((value) => -value)]),
      ];
    }
    // The first column is the intercept; remaining columns form the OA.
    return matrix.map((row) => row.slice(1));
  };

  const selected = arrayType ?? (k <= 3 ? 'L4' : k <= 7 ? 'L8' : k <= 11 ? 'L12' : 'L16');
  const capacity = selected === 'L4' ? 3 : selected === 'L8' ? 7 : selected === 'L9' ? 4 : selected === 'L12' ? 11 : 15;
  if (k < 1 || k > capacity) return [];

  if (selected === 'L4') {
    return L4.map(row => row.slice(0, k));
  }
  if (selected === 'L9') {
    return L9_3level.map(row => row.slice(0, k));
  }
  if (selected === 'L8') return L8.map(row => row.slice(0, k));
  if (selected === 'L12') return generatePlackettBurman(k);
  return hadamard(16).map((row) => row.slice(0, k));
}

/**
 * Generate Box-Behnken Design (BBD) matrix
 */
export function generateBoxBehnken(k: number): number[][] {
  const matrix: number[][] = [];
  if (k < 3) return matrix;
  const signs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let p1 = 0; p1 < k; p1++) {
    for (let p2 = p1 + 1; p2 < k; p2++) {
      for (const [s1, s2] of signs) {
        const row = new Array(k).fill(0);
        row[p1] = s1;
        row[p2] = s2;
        matrix.push(row);
      }
    }
  }
  return matrix;
}

/**
 * Generate Central Composite Design (CCD) matrix
 */
export function generateCCD(k: number, type: 'Full' | 'FaceCentered' | 'Rotatable' = 'FaceCentered'): { matrix: number[][]; alpha: number } {
  // 1. Factorial portion 2^k
  const factorial = generateFullFactorial(k);

  // Calculate alpha
  let alpha = 1.0;
  if (type === 'FaceCentered') {
    alpha = 1.0;
  } else if (type === 'Rotatable' || type === 'Full') {
    alpha = Math.pow(Math.pow(2, k), 0.25); // (2^k)^(1/4)
  }

  // 2. Axial / Star points (2*k points)
  const axial: number[][] = [];
  for (let i = 0; i < k; i++) {
    const rowPlus = new Array(k).fill(0);
    rowPlus[i] = Number(alpha.toFixed(4));
    axial.push(rowPlus);

    const rowMinus = new Array(k).fill(0);
    rowMinus[i] = Number((-alpha).toFixed(4));
    axial.push(rowMinus);
  }

  const matrix = [...factorial, ...axial];
  return { matrix, alpha };
}

/**
 * Generate Pure Simplex Lattice / Centroid Mixture Design on unconstrained simplex [0, 1]^q with sum(x) = 1
 */
function generatePureSimplexDesign(q: number, type: 'Lattice' | 'Centroid' | 'ExtremeVertices' = 'Centroid'): number[][] {
  const matrix: number[][] = [];

  // Pure components (1, 0, 0...)
  for (let i = 0; i < q; i++) {
    const row = new Array(q).fill(0);
    row[i] = 1.0;
    matrix.push(row);
  }

  // Binary blends (0.5, 0.5, 0...)
  for (let i = 0; i < q; i++) {
    for (let j = i + 1; j < q; j++) {
      const row = new Array(q).fill(0);
      row[i] = 0.5;
      row[j] = 0.5;
      matrix.push(row);
    }
  }

  // Simplex-centroid contains centroids of every non-empty subset.  A
  // degree-2 simplex lattice stops after pure and binary blends.
  if (type !== 'Lattice' && q >= 3) {
    for (let subsetSize = 3; subsetSize < q; subsetSize++) {
      const addSubsetCentroids = (start: number, selected: number[]) => {
        if (selected.length === subsetSize) {
          const row = new Array(q).fill(0);
          selected.forEach((index) => { row[index] = Number((1 / subsetSize).toFixed(10)); });
          matrix.push(row);
          return;
        }
        for (let index = start; index <= q - (subsetSize - selected.length); index++) {
          addSubsetCentroids(index + 1, [...selected, index]);
        }
      };
      addSubsetCentroids(0, []);
    }
  }

  if (type !== 'Lattice') {
    const center = new Array(q).fill(Number((1 / q).toFixed(10)));
    matrix.push(center);
  }

  return matrix;
}

/**
 * Generate Constrained Mixture Design using McLean-Anderson / Extreme Vertices & Pseudocomponents
 * Handles lower bounds L_i and upper bounds U_i so that ALL runs strictly satisfy:
 * L_i <= X_i <= U_i and sum(X_i) = 1 (or 100%).
 */
export function generateConstrainedMixtureDesign(
  factors: Factor[],
  type: 'Lattice' | 'Centroid' | 'ExtremeVertices' = 'Centroid'
): number[][] {
  const q = factors.length;
  if (q === 0) return [];
  if (q === 1) return [[1.0]];

  // 1. Extract bounds in normalized proportions [0, 1]
  const L = factors.map((f) => {
    const raw = f.low !== undefined ? (f.high > 1.0 || f.unit === '%' ? f.low / 100 : f.low) : 0;
    return Math.max(0, Math.min(1, raw));
  });
  const U = factors.map((f, idx) => {
    const raw = f.high !== undefined ? (f.high > 1.0 || f.unit === '%' ? f.high / 100 : f.high) : 1;
    return Math.max(L[idx], Math.min(1, raw));
  });

  const sumL = L.reduce((a, b) => a + b, 0);
  const sumU = U.reduce((a, b) => a + b, 0);
  if (sumL > 1 + 1e-10 || sumU < 1 - 1e-10) return [];
  const isUnconstrained = L.every((l) => Math.abs(l) < 1e-6) && U.every((u) => Math.abs(u - 1) < 1e-6);

  if (isUnconstrained) {
    return generatePureSimplexDesign(q, type);
  }

  // Check if pure L-pseudocomponents can be used without upper bound truncation
  const canUsePureLPseudocomponents =
    sumL < 1.0 && factors.every((_, i) => L[i] + (1 - sumL) <= U[i] + 1e-5);

  if (canUsePureLPseudocomponents) {
    const zMatrix = generatePureSimplexDesign(q, type);
    const rem = 1.0 - sumL;
    return zMatrix.map((zRow) =>
      zRow.map((zi, i) => Number((L[i] + zi * rem).toFixed(4)))
    );
  }

  // 2. McLean-Anderson / XVERT Extreme Vertices Algorithm for general bounds [L_i, U_i]
  const vertices: number[][] = [];

  for (let k = 0; k < q; k++) {
    const indepIndices: number[] = [];
    for (let j = 0; j < q; j++) {
      if (j !== k) indepIndices.push(j);
    }

    const nIndep = indepIndices.length;
    const numCombos = Math.pow(2, nIndep);

    for (let mask = 0; mask < numCombos; mask++) {
      const pt = new Array(q).fill(0);
      let sumIndep = 0;

      for (let bit = 0; bit < nIndep; bit++) {
        const factorIdx = indepIndices[bit];
        const useUpper = ((mask >> bit) & 1) === 1;
        const val = useUpper ? U[factorIdx] : L[factorIdx];
        pt[factorIdx] = val;
        sumIndep += val;
      }

      const xk = 1.0 - sumIndep;
      if (xk >= L[k] - 1e-5 && xk <= U[k] + 1e-5) {
        pt[k] = Math.max(L[k], Math.min(U[k], xk));

        // Normalize sum to 1.0
        const total = pt.reduce((a, b) => a + b, 0);
        const normalized = pt.map((v) => Number((v / total).toFixed(4)));

        const exists = vertices.some((v) =>
          v.every((val, idx) => Math.abs(val - normalized[idx]) < 1e-3)
        );
        if (!exists) {
          vertices.push(normalized);
        }
      }
    }
  }

  if (vertices.length === 0) return [];

  if (type === 'ExtremeVertices') return vertices;

  const allPoints: number[][] = [...vertices];

  // 3. Edge Centroids (Midpoints between adjacent vertices)
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const v1 = vertices[i];
      const v2 = vertices[j];

      let sharedConstraints = 0;
      for (let f = 0; f < q; f++) {
        const atLower = Math.abs(v1[f] - L[f]) < 1e-3 && Math.abs(v2[f] - L[f]) < 1e-3;
        const atUpper = Math.abs(v1[f] - U[f]) < 1e-3 && Math.abs(v2[f] - U[f]) < 1e-3;
        if (atLower || atUpper) sharedConstraints++;
      }

      if (sharedConstraints >= Math.max(1, q - 2) || q <= 3) {
        const edgeMid = v1.map((val, idx) => Number(((val + v2[idx]) / 2).toFixed(4)));
        const exists = allPoints.some((p) =>
          p.every((val, idx) => Math.abs(val - edgeMid[idx]) < 1e-3)
        );
        if (!exists) {
          allPoints.push(edgeMid);
        }
      }
    }
  }

  // 4. Overall Centroid (Trọng tâm đa diện)
  const centroid = new Array(q).fill(0);
  vertices.forEach((v) => {
    v.forEach((val, idx) => {
      centroid[idx] += val / vertices.length;
    });
  });
  const normalizedCentroid = centroid.map((v) => Number(v.toFixed(4)));
  const centroidExists = allPoints.some((p) =>
    p.every((val, idx) => Math.abs(val - normalizedCentroid[idx]) < 1e-3)
  );
  if (!centroidExists) {
    allPoints.push(normalizedCentroid);
  }

  // 5. Axial / Interior Blends (Midpoints between Overall Centroid and each Vertex)
  vertices.forEach((v) => {
    const axial = v.map((val, idx) => Number(((val + normalizedCentroid[idx]) / 2).toFixed(4)));
    const exists = allPoints.some((p) =>
      p.every((val, idx) => Math.abs(val - axial[idx]) < 1e-3)
    );
    if (!exists) {
      allPoints.push(axial);
    }
  });

  return allPoints;
}

/**
 * Backward compatibility wrapper for generateMixtureDesign
 */
export function generateMixtureDesign(kOrFactors: number | Factor[], type: 'Lattice' | 'Centroid' = 'Centroid'): number[][] {
  if (typeof kOrFactors === 'number') {
    return generatePureSimplexDesign(kOrFactors, type);
  }
  return generateConstrainedMixtureDesign(kOrFactors, type);
}

/**
 * Generate Combined Mixture - Process Crossed Design Matrix
 * (Ma trận tích hợp Hỗn hợp & Thông số Quy trình)
 */
export function generateCombinedMixtureProcessMatrix(
  mixtureFactors: Factor[],
  processFactors: Factor[],
  type: 'Combined_Mixture_Factorial' | 'Combined_Mixture_RSM' = 'Combined_Mixture_Factorial'
): number[][] {
  const mixtureCount = mixtureFactors.length;
  const processCount = processFactors.length;

  // 1. Constrained Mixture matrix
  const mixMatrix = generateConstrainedMixtureDesign(mixtureFactors, 'Centroid');

  // 2. Process variables matrix
  let procMatrix: number[][] = [];
  if (processCount <= 0) {
    return mixMatrix;
  }

  if (type === 'Combined_Mixture_RSM' && processCount >= 2) {
    procMatrix = generateBoxBehnken(processCount);
  } else {
    procMatrix = generateFullFactorial(processCount);
  }

  // 3. Crossed / Cartesian product (Every mixture blend x Every process setting)
  const combined: number[][] = [];
  for (const mixRow of mixMatrix) {
    for (const procRow of procMatrix) {
      combined.push([...mixRow, ...procRow]);
    }
  }

  // 4. Center blend at center process conditions
  const centerBlend = mixMatrix.length > 0
    ? mixMatrix[0].map((_, index) => mixMatrix.reduce((sum, row) => sum + row[index], 0) / mixMatrix.length)
    : new Array(mixtureCount).fill(Number((1 / mixtureCount).toFixed(4)));
  const centerProc = new Array(processCount).fill(0);
  combined.push([...centerBlend, ...centerProc]);
  combined.push([...centerBlend, ...centerProc]);
  combined.push([...centerBlend, ...centerProc]);

  return combined;
}

/**
 * Main function to generate full DoE Runs table according to user configuration
 */
export function generateDoERuns(factors: Factor[], config: DoEDesignConfig): { runs: DoERun[]; alpha?: number } {
  const designFactors = factors.filter((factor) => factor.controllability !== 'constant');
  const k = designFactors.length;
  if (k === 0) return { runs: [] };

  let codedMatrix: number[][] = [];
  let calculatedAlpha: number | undefined = undefined;
  let matrixFactors = designFactors;

  // Separate Mixture components and Independent Process factors
  const mixtureFactors = designFactors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const processFactors = designFactors.filter((f) => f.role !== 'mixture_component' && f.type !== 'Mixture');

  const useCrossedCombinedDesign =
    config.category === 'Combined_Mixture_Process' &&
    config.designType !== 'Combined_Mixture_DOptimal';

  if (useCrossedCombinedDesign) {
    const combinedType =
      config.designType === 'Combined_Mixture_RSM' ? 'Combined_Mixture_RSM' : 'Combined_Mixture_Factorial';
    codedMatrix = generateCombinedMixtureProcessMatrix(
      mixtureFactors,
      processFactors,
      combinedType
    );
    matrixFactors = [...mixtureFactors, ...processFactors];
  } else {
    switch (config.designType) {
      case 'FullFactorial2k':
        codedMatrix = generateFullFactorial(k);
        break;

      case 'FractionalFactorial':
        codedMatrix = generateFractionalFactorial(k);
        break;

      case 'PlackettBurman':
        codedMatrix = generatePlackettBurman(k);
        break;

      case 'Taguchi':
        codedMatrix = generateTaguchi(k, config.taguchiArray);
        break;

      case 'BoxBehnken':
        codedMatrix = generateBoxBehnken(k);
        break;

      case 'CCD_Full':
      case 'CCD_Rotatable': {
        const ccd = generateCCD(k, 'Rotatable');
        codedMatrix = ccd.matrix;
        calculatedAlpha = ccd.alpha;
        break;
      }

      case 'CCD_FaceCentered': {
        const ccd = generateCCD(k, 'FaceCentered');
        codedMatrix = ccd.matrix;
        calculatedAlpha = 1.0;
        break;
      }

      case 'SimplexLattice':
      case 'SimplexCentroid':
        codedMatrix = generateConstrainedMixtureDesign(
          designFactors,
          config.designType === 'SimplexLattice' ? 'Lattice' : 'Centroid'
        );
        break;

      case 'Combined_Mixture_Factorial':
      case 'Combined_Mixture_RSM': {
        const mixFactors = mixtureFactors.length > 0 ? mixtureFactors : designFactors.slice(0, Math.min(3, k));
        const procFactors = processFactors.length > 0 ? processFactors : designFactors.slice(mixFactors.length);
        codedMatrix = generateCombinedMixtureProcessMatrix(
          mixFactors,
          procFactors,
          config.designType
        );
        matrixFactors = [...mixFactors, ...procFactors];
        break;
      }

      case 'Combined_Mixture_DOptimal':
      case 'DOptimal': {
        // For mixture-process studies, an optimal design selects a small,
        // model-dependent subset from the constrained mixture × process pool.
        // It must not fall back to the complete crossed design.
        const dModel = config.dOptimalModel || (mixtureFactors.length > 0 ? '2FI' : k <= 3 ? 'Quadratic' : '2FI');
        const numTerms = calculateNumModelTermsForFactors(designFactors, dModel);
        // N must exceed p to retain residual degrees of freedom for model fitting.
        const minimumFittableRuns = numTerms + 1;
        const defaultRuns = mixtureFactors.length > 0 && processFactors.length > 0
          ? dModel === 'Linear' ? 14 : dModel === '2FI' ? 24 : 30
          : Math.max(numTerms + 4, k <= 2 ? 10 : k === 3 ? 15 : 20);
        const nRuns = config.numRuns
          ? Math.max(minimumFittableRuns, config.numRuns)
          : Math.max(minimumFittableRuns, defaultRuns);
        codedMatrix = generateDOptimalMatrix(designFactors, dModel, nRuns);
        break;
      }

      default:
        codedMatrix = generateFullFactorial(k);
        break;
    }

    // D-optimal N already includes every selected run. Appending center points
    // would both violate the requested run count and create an invalid all-zero
    // mixture row for a combined mixture-process design.
    const isOptimalDesign = config.designType === 'DOptimal' || config.designType === 'Combined_Mixture_DOptimal';
    if (!isOptimalDesign) {
      const centerCount = config.centerPoints > 0 ? config.centerPoints : (config.category === 'RSM' ? 3 : 0);
      for (let c = 0; c < centerCount; c++) {
        if (config.category === 'Mixture' || mixtureFactors.length === k) {
          const centroidRow = codedMatrix.length > 0 ? codedMatrix[codedMatrix.length - 1] : new Array(k).fill(Number((1 / k).toFixed(4)));
          codedMatrix.push([...centroidRow]);
        } else {
          codedMatrix.push(new Array(k).fill(0));
        }
      }
    }
  }

  // Handle Replicates
  const replicateCount = Math.max(1, config.replicates || 1);
  let allCodedRows: number[][] = [];
  for (let rep = 0; rep < replicateCount; rep++) {
    allCodedRows.push(...codedMatrix.map(row => [...row]));
  }

  // Build standard runs
  const mixtureMatrixIndexes = matrixFactors
    .map((factor, index) => (factor.role === 'mixture_component' || factor.type === 'Mixture' ? index : -1))
    .filter((index) => index >= 0);
  const runs: DoERun[] = allCodedRows.map((rawRow, index) => {
    const row = [...rawRow];
    // The candidate set is rounded to four decimals. Put the rounding residue
    // into one component so displayed mixture proportions sum to exactly 100%.
    if (mixtureMatrixIndexes.length >= 2) {
      const total = mixtureMatrixIndexes.reduce((sum, matrixIndex) => sum + row[matrixIndex], 0);
      if (Math.abs(total - 1) > 1e-10) {
        const lastIndex = mixtureMatrixIndexes[mixtureMatrixIndexes.length - 1];
        row[lastIndex] += 1 - total;
      }
    }
    const factorCoded: Record<string, number> = {};
    const factorActual: Record<string, number | string> = {};

    factors.forEach((f) => {
      const matrixIndex = matrixFactors.indexOf(f);
      const codedVal = matrixIndex >= 0 && row[matrixIndex] !== undefined ? row[matrixIndex] : 0;
      factorCoded[f.code] = codedVal;
      if (f.role === 'mixture_component' || f.type === 'Mixture' || config.category === 'Mixture') {
        if (f.high <= 1.0 && f.unit !== '%') {
          factorActual[f.code] = Number(codedVal.toFixed(4));
        } else {
          factorActual[f.code] = Number((codedVal * 100).toFixed(2));
        }
      } else {
        factorActual[f.code] = codedToActual(codedVal, f);
      }
    });

    return {
      id: `run-${index + 1}`,
      stdOrder: index + 1,
      runOrder: index + 1,
      block: 1,
      factorCoded,
      factorActual,
      responses: {}
    };
  });

  // Randomize if requested
  if (config.randomized) {
    const random = createSeededRandom(config.randomizationSeed ?? 20260828);
    const randomizedIndices = runs.map((_, i) => i);
    for (let i = randomizedIndices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [randomizedIndices[i], randomizedIndices[j]] = [randomizedIndices[j], randomizedIndices[i]];
    }
    randomizedIndices.forEach((origIdx, newOrder) => {
      runs[origIdx].runOrder = newOrder + 1;
    });
    runs.sort((a, b) => a.runOrder - b.runOrder);
  }

  // Blocks describe the order in which a design is executed (for example,
  // separate manufacturing days).  Keep the allocation balanced and assign it
  // after randomization so each batch retains a spread of design points.
  const blockCount = Math.min(runs.length, Math.max(1, Math.floor(config.blocks ?? 1)));
  runs.forEach((run, index) => {
    run.block = Math.floor((index * blockCount) / runs.length) + 1;
  });

  return { runs, alpha: calculatedAlpha };
}

/**
 * Calculate the number of terms in a polynomial regression model
 */
export function calculateNumModelTerms(
  k: number,
  model: 'Linear' | '2FI' | 'Quadratic',
  factors?: Factor[]
): number {
  if (factors) return calculateNumModelTermsForFactors(factors, model);
  if (k <= 0) return 1;
  const linear = k;
  const interaction = (k * (k - 1)) / 2;
  const quadratic = k;

  if (model === 'Linear') return 1 + linear;
  if (model === '2FI') return 1 + linear + interaction;
  return 1 + linear + interaction + quadratic;
}

export interface DesignValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  requiredTerms: number;
  minimumFittableRuns: number;
}

export interface DesignReadiness {
  runCount: number;
  termCount: number;
  rank: number;
  residualDegreesOfFreedom: number;
  isEstimable: boolean;
  messages: string[];
}

function resolveOptimalModel(factors: Factor[], config: DoEDesignConfig): 'Linear' | '2FI' | 'Quadratic' {
  if (config.dOptimalModel) return config.dOptimalModel;
  const hasMixture = factors.some((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
  return hasMixture ? '2FI' : factors.length <= 3 ? 'Quadratic' : '2FI';
}

export function recommendRunCount(factors: Factor[], model: 'Linear' | '2FI' | 'Quadratic'): number {
  const active = factors.filter((factor) => factor.controllability !== 'constant');
  const terms = calculateNumModelTermsForFactors(active, model);
  const hasMixture = active.some((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
  const hasProcess = active.some((factor) => factor.role !== 'mixture_component' && factor.type !== 'Mixture');
  if (hasMixture && hasProcess) {
    if (model === 'Linear') return Math.max(14, terms + 5);
    if (model === '2FI') return Math.max(24, terms + 6);
    return Math.max(30, terms + 8);
  }
  return Math.max(terms + 4, active.length <= 2 ? 10 : 15);
}

/** Checks factor bounds and model/run-count compatibility before generation. */
export function validateDesignSetup(factors: Factor[], config: DoEDesignConfig): DesignValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const active = factors.filter((factor) => factor.controllability !== 'constant');
  const model = resolveOptimalModel(active, config);
  const requiredTerms = calculateNumModelTermsForFactors(active, model);
  const minimumFittableRuns = requiredTerms + 1;

  if (active.length === 0) errors.push('Cần ít nhất một nhân tố không cố định để tạo thiết kế.');
  active.forEach((factor) => {
    if (factor.dataType === 'qualitative' || factor.dataType === 'quantitative_multilevel') {
      const levels = (factor.categories ?? []).map((level) => level.trim()).filter(Boolean);
      if (levels.length < 2) errors.push(`${factor.code}: cần khai báo ít nhất 2 mức.`);
      if (levels.length > 10) errors.push(`${factor.code}: chỉ được khai báo tối đa 10 mức.`);
      if (new Set(levels).size !== levels.length) errors.push(`${factor.code}: các mức không được trùng nhau.`);
      if (factor.dataType === 'quantitative_multilevel' && levels.some((level) => !Number.isFinite(Number(level)))) {
        errors.push(`${factor.code}: mọi mức định lượng phải là số hợp lệ.`);
      }
    }
    if (factor.dataType !== 'qualitative' && (!Number.isFinite(factor.low) || !Number.isFinite(factor.high) || factor.high <= factor.low)) {
      errors.push(`${factor.code}: cận trên phải lớn hơn cận dưới.`);
    }
  });

  const mixture = active.filter((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
  if (mixture.length > 0) {
    const normalize = (value: number, factor: Factor) => (factor.high > 1 || factor.unit === '%' ? value / 100 : value);
    const sumLower = mixture.reduce((sum, factor) => sum + normalize(factor.low, factor), 0);
    const sumUpper = mixture.reduce((sum, factor) => sum + normalize(factor.high, factor), 0);
    if (sumLower > 1 + 1e-10 || sumUpper < 1 - 1e-10) {
      errors.push('Giới hạn mixture không khả thi: tổng cận dưới phải ≤ 100% và tổng cận trên phải ≥ 100%.');
    }
  }

  const isOptimal = config.designType === 'DOptimal' || config.designType === 'Combined_Mixture_DOptimal';
  if (isOptimal && config.numRuns !== undefined && config.numRuns < minimumFittableRuns) {
    errors.push(`Mô hình ${model} cần tối thiểu ${minimumFittableRuns} run (p=${requiredTerms}) để còn bậc tự do dư.`);
  }
  if (isOptimal && (config.numRuns ?? recommendRunCount(active, model)) < recommendRunCount(active, model)) {
    warnings.push(`Ngân sách N thấp hơn mức khuyến nghị ${recommendRunCount(active, model)}; chỉ dùng khi chấp nhận độ chính xác thấp hơn.`);
  }
  if (config.category === 'Combined_Mixture_Process' && !isOptimal) {
    warnings.push('Thiết kế mixture–process nhân chéo đầy đủ có thể tạo rất nhiều run; cân nhắc D-optimal theo ngân sách.');
  }
  if (config.designType === 'Taguchi') {
    const array = config.taguchiArray ?? (active.length <= 3 ? 'L4' : active.length <= 7 ? 'L8' : active.length <= 11 ? 'L12' : 'L16');
    const capacity = array === 'L4' ? 3 : array === 'L8' ? 7 : array === 'L9' ? 4 : array === 'L12' ? 11 : 15;
    if (active.length > capacity) errors.push(`${array} chỉ hỗ trợ tối đa ${capacity} factor.`);
    if (array === 'L9' && active.some((factor) => factor.dataType !== 'quantitative_multilevel')) {
      warnings.push('L9 là ma trận ba mức; mọi factor nên được khai báo quantitative_multilevel với ba mức hợp lệ.');
    }
  }
  if ((config.replicates || 1) > 1) warnings.push('Số run hiển thị sẽ tăng theo số lặp lại đã chọn.');
  if ((config.blocks ?? 1) > 1) {
    warnings.push('Block hiện dùng để lập lịch chạy cân bằng. Khi có khác biệt theo ngày/mẻ, cần xem xét hiệu ứng block trong phân tích chuyên sâu.');
  }

  return { isValid: errors.length === 0, errors, warnings, requiredTerms, minimumFittableRuns };
}

function matrixRank(matrix: number[][], tolerance: number = 1e-9): number {
  if (matrix.length === 0 || matrix[0].length === 0) return 0;
  const work = matrix.map((row) => [...row]);
  let rank = 0;
  for (let column = 0; column < work[0].length && rank < work.length; column++) {
    let pivot = rank;
    for (let row = rank + 1; row < work.length; row++) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
    }
    if (Math.abs(work[pivot][column]) <= tolerance) continue;
    [work[rank], work[pivot]] = [work[pivot], work[rank]];
    for (let row = rank + 1; row < work.length; row++) {
      const scale = work[row][column] / work[rank][column];
      for (let index = column; index < work[row].length; index++) work[row][index] -= scale * work[rank][index];
    }
    rank++;
  }
  return rank;
}

/** Assesses whether a generated matrix can estimate the selected model. */
export function assessDesignReadiness(
  factors: Factor[],
  runs: DoERun[],
  model: 'Linear' | '2FI' | 'Quadratic',
): DesignReadiness {
  const active = factors.filter((factor) => factor.controllability !== 'constant');
  const termCount = calculateNumModelTermsForFactors(active, model);
  const X = runs.map((run) => buildModelVector(active.map((factor) => run.factorCoded[factor.code] ?? 0), active, model));
  const rank = matrixRank(X);
  const residualDegreesOfFreedom = runs.length - termCount;
  const messages: string[] = [];
  if (rank < termCount) messages.push(`Ma trận không khả định: rank ${rank}/${termCount}.`);
  if (residualDegreesOfFreedom <= 0) messages.push('Không còn bậc tự do dư để ước lượng sai số thực nghiệm.');
  else if (residualDegreesOfFreedom < 4) messages.push(`Chỉ còn ${residualDegreesOfFreedom} df dư; nên tăng số run hoặc giảm độ phức tạp mô hình.`);
  return {
    runCount: runs.length,
    termCount,
    rank,
    residualDegreesOfFreedom,
    isEstimable: rank === termCount && residualDegreesOfFreedom > 0,
    messages,
  };
}

export interface DesignAugmentationResult {
  runs: DoERun[];
  addedRuns: DoERun[];
  before: DesignReadiness;
  after: DesignReadiness;
  warnings: string[];
}

const codedPointSignature = (point: number[]): string => point.map((value) => value.toFixed(6)).join('|');

/**
 * Add informative, previously untried points to an already executed design.
 * The historical rows remain untouched; the added rows form the next execution
 * block.  Selection is greedy D-optimal augmentation, prioritising model rank
 * before the determinant of X'X.
 */
export function augmentDOptimalDesign(
  factors: Factor[],
  existingRuns: DoERun[],
  model: 'Linear' | '2FI' | 'Quadratic',
  additionalRuns: number,
): DesignAugmentationResult {
  const activeFactors = factors.filter((factor) => factor.controllability !== 'constant');
  const before = assessDesignReadiness(factors, existingRuns, model);
  const requested = Math.max(0, Math.floor(additionalRuns));
  const warnings: string[] = [];
  if (requested === 0 || activeFactors.length === 0) {
    if (requested > 0) warnings.push('Không có nhân tố biến thiên để tăng cường thiết kế.');
    return { runs: [...existingRuns], addedRuns: [], before, after: before, warnings };
  }

  const existingPoints = new Set(
    existingRuns.map((run) => codedPointSignature(activeFactors.map((factor) => run.factorCoded[factor.code] ?? 0))),
  );
  const candidates = generateCandidatePool(activeFactors)
    .filter((point) => !existingPoints.has(codedPointSignature(point)));
  if (candidates.length === 0) {
    warnings.push('Không còn điểm ứng viên mới trong không gian thiết kế hiện tại.');
    return { runs: [...existingRuns], addedRuns: [], before, after: before, warnings };
  }

  const selected: number[][] = [];
  const designRows = existingRuns.map((run) =>
    expandModelVectorForFactors(activeFactors.map((factor) => run.factorCoded[factor.code] ?? 0), activeFactors, model),
  );
  const termCount = calculateNumModelTermsForFactors(activeFactors, model);
  const maxToAdd = Math.min(requested, candidates.length);

  for (let step = 0; step < maxToAdd; step++) {
    let bestIndex = -1;
    let bestRank = -1;
    let bestDeterminant = -1;
    for (let index = 0; index < candidates.length; index++) {
      const candidateRow = expandModelVectorForFactors(candidates[index], activeFactors, model);
      const rows = [...designRows, ...selected.map((point) => expandModelVectorForFactors(point, activeFactors, model)), candidateRow];
      const rank = matrixRank(rows);
      const determinant = rank === termCount
        ? Math.abs(matrixDeterminant(matMul(matTranspose(rows), rows)))
        : 0;
      if (rank > bestRank || (rank === bestRank && determinant > bestDeterminant + 1e-12)) {
        bestIndex = index;
        bestRank = rank;
        bestDeterminant = determinant;
      }
    }
    if (bestIndex < 0) break;
    selected.push(candidates.splice(bestIndex, 1)[0]);
  }

  if (selected.length < requested) warnings.push(`Chỉ thêm được ${selected.length}/${requested} điểm mới không trùng lặp.`);
  const mixtureActiveIndexes = activeFactors
    .map((factor, index) => (factor.role === 'mixture_component' || factor.type === 'Mixture' ? index : -1))
    .filter((index) => index >= 0);
  const nextStdOrder = existingRuns.reduce((maximum, run) => Math.max(maximum, run.stdOrder), 0);
  const nextRunOrder = existingRuns.reduce((maximum, run) => Math.max(maximum, run.runOrder), 0);
  const nextBlock = existingRuns.reduce((maximum, run) => Math.max(maximum, run.block || 1), 1) + 1;
  const addedRuns = selected.map((rawPoint, index) => {
    const point = [...rawPoint];
    if (mixtureActiveIndexes.length >= 2) {
      const mixtureTotal = mixtureActiveIndexes.reduce((sum, mixtureIndex) => sum + point[mixtureIndex], 0);
      point[mixtureActiveIndexes[mixtureActiveIndexes.length - 1]] += 1 - mixtureTotal;
    }
    const factorCoded: Record<string, number> = {};
    const factorActual: Record<string, number | string> = {};
    factors.forEach((factor) => {
      const activeIndex = activeFactors.indexOf(factor);
      const coded = activeIndex >= 0 ? point[activeIndex] : 0;
      factorCoded[factor.code] = coded;
      if (factor.controllability === 'constant' && factor.constantValue !== undefined) {
        factorActual[factor.code] = factor.constantValue;
      } else if (factor.role === 'mixture_component' || factor.type === 'Mixture') {
        factorActual[factor.code] = factor.high <= 1 && factor.unit !== '%'
          ? Number(coded.toFixed(4))
          : Number((coded * 100).toFixed(2));
      } else {
        factorActual[factor.code] = codedToActual(coded, factor);
      }
    });
    return {
      id: `augment-${nextStdOrder + index + 1}`,
      stdOrder: nextStdOrder + index + 1,
      runOrder: nextRunOrder + index + 1,
      block: nextBlock,
      factorCoded,
      factorActual,
      responses: {},
    };
  });
  const runs = [...existingRuns, ...addedRuns];
  const after = assessDesignReadiness(factors, runs, model);
  if (!after.isEstimable) warnings.push('Thiết kế sau tăng cường vẫn chưa đủ để ước lượng mô hình mục tiêu.');
  return { runs, addedRuns, before, after, warnings };
}

/**
 * Expand a single coded point [x1, x2, ...] to full model vector [1, x1, ..., x1*x2, ..., x1^2, ...]
 */
export function expandModelVector(coded: number[], model: 'Linear' | '2FI' | 'Quadratic'): number[] {
  const k = coded.length;
  const row: number[] = [1.0]; // Intercept

  // Linear terms
  for (let i = 0; i < k; i++) {
    row.push(coded[i]);
  }

  // 2FI Interaction terms
  if (model === '2FI' || model === 'Quadratic') {
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        row.push(coded[i] * coded[j]);
      }
    }
  }

  // Quadratic terms
  if (model === 'Quadratic') {
    for (let i = 0; i < k; i++) {
      row.push(coded[i] * coded[i]);
    }
  }

  return row;
}

/**
 * Model basis used by optimal-design diagnostics.  Mixture components sum to
 * one, therefore their basis is Scheffé-style (no explicit intercept and no
 * redundant component squares).
 */
function expandModelVectorForFactors(
  coded: number[],
  factors: Factor[],
  model: 'Linear' | '2FI' | 'Quadratic'
): number[] {
  return buildModelVector(coded, factors, model);
}

function calculateNumModelTermsForFactors(factors: Factor[], model: 'Linear' | '2FI' | 'Quadratic'): number {
  return getModelTermCount(factors, model);
}

/**
 * Generate candidate pool for D-Optimal search
 */
function generateCandidatePool(factors: Factor[]): number[][] {
  const k = factors.length;
  if (k === 0) return [];

  const mixtureFactors = factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  const processFactors = factors.filter((f) => f.role !== 'mixture_component' && f.type !== 'Mixture');

  if (mixtureFactors.length > 0) {
    const mixCandidates = generateConstrainedMixtureDesign(mixtureFactors, 'Centroid');
    if (processFactors.length === 0) {
      return mixCandidates;
    }

    const procLevels: number[][] = processFactors.map((f) => {
      if (f.controllability === 'constant') return [0];
      if (f.dataType === 'qualitative' || f.dataType === 'quantitative_multilevel') return getConfiguredFactorCodes(f);
      return [-1, 0, 1];
    });

    let procPool: number[][] = [[]];
    for (let i = 0; i < processFactors.length; i++) {
      const next: number[][] = [];
      for (const p of procPool) {
        for (const lvl of procLevels[i]) {
          next.push([...p, lvl]);
        }
      }
      procPool = next;
    }

    const combinedCandidates: number[][] = [];
    // Group by process setting so the deterministic D-optimal initialization
    // samples all process levels instead of repeatedly selecting the first
    // (-1, -1, ...) combination for every mixture point.
    for (const p of procPool) {
      for (const m of mixCandidates) {
        combinedCandidates.push(
          factors.map((factor) => {
            const mixIndex = mixtureFactors.indexOf(factor);
            return mixIndex >= 0 ? m[mixIndex] : p[processFactors.indexOf(factor)];
          })
        );
      }
    }
    return combinedCandidates;
  }

  // Standard process factors grid
  const gridPerFactor: number[][] = factors.map((f) => {
    if (f.controllability === 'constant') return [0];
    if (f.dataType === 'qualitative' || f.dataType === 'quantitative_multilevel') return getConfiguredFactorCodes(f);
    return [-1, -0.5, 0, 0.5, 1]; // 5 levels for smooth response exploration
  });

  // Cartesian product of all factor levels
  let pool: number[][] = [[]];
  for (let i = 0; i < k; i++) {
    const nextPool: number[][] = [];
    const levels = gridPerFactor[i];
    for (const prefix of pool) {
      for (const lvl of levels) {
        nextPool.push([...prefix, lvl]);
      }
    }
    pool = nextPool;
  }

  return pool;
}

/**
 * Generate D-Optimal Design Matrix using Fedorov's Point Exchange Algorithm
 * Maximizes det(X^T X) for a user-specified model and target number of runs
 */
export function generateDOptimalMatrix(
  factors: Factor[],
  modelOrder: 'Linear' | '2FI' | 'Quadratic',
  targetRuns: number
): number[][] {
  const k = factors.length;
  if (k === 0) return [];

  const numTerms = calculateNumModelTermsForFactors(factors, modelOrder);
  const N = Math.max(numTerms, targetRuns);

  // 1. Generate candidate points
  const candidatePool = generateCandidatePool(factors);
  if (candidatePool.length <= N) {
    return candidatePool;
  }

  // 2. Expand candidate pool into model matrix rows
  const candidateRows = candidatePool.map((pt) => expandModelVectorForFactors(pt, factors, modelOrder));

  // 3. Greedy Initial Selection: Select N points to maximize initial det(X^T X)
  const selectedIndices: number[] = [];
  const used = new Set<number>();

  // Pick extreme corners first
  for (let i = 0; i < Math.min(N, candidatePool.length); i++) {
    const step = Math.floor((i * candidatePool.length) / N);
    if (!used.has(step)) {
      selectedIndices.push(step);
      used.add(step);
    }
  }
  // Fill remaining if needed
  let ptr = 0;
  while (selectedIndices.length < N && ptr < candidatePool.length) {
    if (!used.has(ptr)) {
      selectedIndices.push(ptr);
      used.add(ptr);
    }
    ptr++;
  }

  // Helper to compute log determinant of current design
  const computeLogDet = (indices: number[]): number => {
    const X = indices.map((idx) => candidateRows[idx]);
    const XT = matTranspose(X);
    const XTX = matMul(XT, X);
    const det = matrixDeterminant(XTX);
    return det > 1e-15 ? Math.log(det) : -999;
  };

  let currentLogDet = computeLogDet(selectedIndices);

  // 4. Fedorov Point Exchange Iterations
  const maxIterations = 20;
  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;

    for (let i = 0; i < N; i++) {
      const origIdx = selectedIndices[i];

      // Try replacing point i with a candidate from pool
      for (let c = 0; c < candidatePool.length; c++) {
        if (c === origIdx || selectedIndices.some((selected, index) => index !== i && selected === c)) continue;

        selectedIndices[i] = c;
        const newLogDet = computeLogDet(selectedIndices);

        if (newLogDet > currentLogDet + 1e-4) {
          currentLogDet = newLogDet;
          improved = true;
          break; // move to next design point
        } else {
          selectedIndices[i] = origIdx; // revert swap
        }
      }
    }

    if (!improved) break; // Converged to local D-optimum
  }

  // Return the optimal coded points
  return selectedIndices.map((idx) => candidatePool[idx]);
}

/**
 * Calculate D-Efficiency, A-Efficiency, G-Efficiency and Design Diagnostics
 */
export function calculateDesignEfficiency(
  runs: DoERun[],
  factors: Factor[],
  modelOrder: 'Linear' | '2FI' | 'Quadratic' = 'Quadratic'
): DesignEvaluationMetrics {
  const activeFactors = factors.filter((f) => f.controllability !== 'constant');
  const k = activeFactors.length;
  const N = runs.length;
  const p = calculateNumModelTermsForFactors(activeFactors, modelOrder);

  if (N < p || k === 0) {
    return {
      dEfficiency: 0,
      aEfficiency: 0,
      gEfficiency: 0,
      determinantXTX: 0,
      conditionNumber: 999,
      averageLeverage: N > 0 ? p / N : 0,
      maxLeverage: 1.0,
      numRuns: N,
      numParameters: p,
      degreesOfFreedom: Math.max(0, N - p),
      rating: 'Kém (<50%)',
    };
  }

  // Build X matrix
  const X: number[][] = runs.map((r) => {
    const codedPt = activeFactors.map((f) => r.factorCoded[f.code] ?? 0);
    return expandModelVectorForFactors(codedPt, activeFactors, modelOrder);
  });

  const XT = matTranspose(X);
  const XTX = matMul(XT, X);
  const detXTX = matrixDeterminant(XTX);

  // D-Efficiency: 100 * (|X^T X|^(1/p)) / N
  let dEff = 0;
  if (detXTX > 1e-18) {
    const rawRatio = Math.pow(detXTX, 1 / p) / N;
    dEff = Number(Math.min(100, Math.max(0, rawRatio * 100)).toFixed(2));
  }

  // Inverse XTX
  let invXTX: number[][] = [];
  try {
    invXTX = matInverse(XTX);
  } catch {
    invXTX = [];
  }

  // A-Efficiency: 100 * p / (N * trace((X^T X)^-1))
  let aEff = 0;
  if (invXTX.length > 0) {
    const tr = matrixTrace(invXTX);
    if (tr > 0) {
      aEff = Number(Math.min(100, Math.max(0, (100 * p) / (N * tr))).toFixed(2));
    }
  }

  // Hat matrix diagonal (Leverages) H = X (X^T X)^-1 X^T
  let maxH = p / N;
  if (invXTX.length > 0) {
    const X_inv = matMul(X, invXTX);
    const H_diag: number[] = [];
    for (let i = 0; i < N; i++) {
      let hii = 0;
      for (let j = 0; j < p; j++) {
        hii += X_inv[i][j] * X[i][j];
      }
      H_diag.push(Math.max(0, Math.min(1, hii)));
    }
    maxH = Math.max(...H_diag);
  }

  // G-Efficiency: 100 * p / (N * max(h_ii))
  const gEff = maxH > 0 ? Number(Math.min(100, Math.max(0, (100 * p) / (N * maxH))).toFixed(2)) : 0;

  // A genuine matrix condition number (1-norm), rather than a ratio of only
  // diagonal entries.  It detects non-orthogonality and near singularity.
  const oneNorm = (matrix: number[][]) => Math.max(...matrix[0].map((_, col) => matrix.reduce((sum, row) => sum + Math.abs(row[col]), 0)));
  const condNum = invXTX.length > 0
    ? Number((oneNorm(XTX) * oneNorm(invXTX)).toFixed(2))
    : Number.POSITIVE_INFINITY;

  // Rating
  let rating: 'Xuất sắc (>85%)' | 'Tốt (70-85%)' | 'Chấp nhận được (50-70%)' | 'Kém (<50%)' = 'Kém (<50%)';
  if (dEff >= 85) rating = 'Xuất sắc (>85%)';
  else if (dEff >= 70) rating = 'Tốt (70-85%)';
  else if (dEff >= 50) rating = 'Chấp nhận được (50-70%)';

  return {
    dEfficiency: dEff,
    aEfficiency: aEff,
    gEfficiency: gEff,
    determinantXTX: detXTX,
    conditionNumber: condNum,
    averageLeverage: Number((p / N).toFixed(3)),
    maxLeverage: Number(maxH.toFixed(3)),
    numRuns: N,
    numParameters: p,
    degreesOfFreedom: Math.max(0, N - p),
    rating,
  };
}
