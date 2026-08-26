import type {
  Factor,
  CQA,
  DoERun,
  DesirabilitySolution,
  StatisticalModelResult,
  NeuralNetModelResult,
} from '../types/qbd';
import { extract2DContourSegments, calculateCQAMargin } from './mathUtils';
import { codedToActual, actualToCoded } from './doeGenerator';

export interface TernaryPoint {
  u: number; // 0..1 (A proportion on normalized simplex)
  v: number; // 0..1 (B proportion on normalized simplex)
  w: number; // 0..1 (C proportion on normalized simplex)
  aPct: number; // 0..100%
  bPct: number; // 0..100%
  cPct: number; // 0..100%
  x: number; // Cartesian 2D projection x
  y: number; // Cartesian 2D projection y
  z: number;
  isInsideConstraints?: boolean;
}

export interface TernaryFacet {
  p1: { a: number; b: number; c: number };
  p2: { a: number; b: number; c: number };
  p3: { a: number; b: number; c: number };
  zAvg: number;
}

export interface TernaryContourLine {
  level: number;
  isSpecLimit?: boolean;
  specType?: 'LSL' | 'USL' | 'Target';
  segments: {
    p1: { a: number; b: number; c: number; x?: number; y?: number };
    p2: { a: number; b: number; c: number; x?: number; y?: number };
  }[];
}

export interface MixtureConstraintLine {
  factorCode: string;
  factorName: string;
  type: 'low' | 'high';
  value: number;
  label: string;
  color: string;
  dash: 'solid' | 'dash' | 'dot';
  p1: { a: number; b: number; c: number; x?: number; y?: number };
  p2: { a: number; b: number; c: number; x?: number; y?: number };
}

export interface MixtureConstraintsResult {
  lines: MixtureConstraintLine[];
  polygonVertices: { a: number; b: number; c: number; x?: number; y?: number }[];
  hasConstraints: boolean;
}

export interface TernaryContourResult {
  xGrid: number[];
  yGrid: number[];
  zGrid: (number | null)[][] & number[][];
  meshPoints: TernaryPoint[];
  facets: TernaryFacet[];
  zMin: number;
  zMax: number;
  numLevels?: number;
  contourLines: TernaryContourLine[];
  activeFraction: number;
  constraints: MixtureConstraintsResult;
}

// Equilateral triangle height for base length = 100
export const TERNARY_HEIGHT = 50 * Math.sqrt(3); // ~86.60254037844386

/**
 * Convert mixture percentages (a, b, c summing to 100) to 2D Cartesian coordinates
 * Base BC on y = 0, Vertex A at (50, H)
 */
export function ternaryToCartesian(a: number, b: number, c: number): { x: number; y: number } {
  const sum = a + b + c;
  const aNorm = sum > 0 ? (a / sum) * 100 : 0;
  const cNorm = sum > 0 ? (c / sum) * 100 : 0;
  const x = cNorm + aNorm * 0.5;
  const y = aNorm * (TERNARY_HEIGHT / 100);
  return { x, y };
}

/**
 * Convert 2D Cartesian coordinates back to ternary proportions (a, b, c in %)
 */
export function cartesianToTernary(x: number, y: number): { a: number; b: number; c: number; isInside: boolean } {
  const a = y * (100 / TERNARY_HEIGHT);
  const c = x - y * (50 / TERNARY_HEIGHT);
  const b = 100 - a - c;
  const isInside = a >= -0.05 && b >= -0.05 && c >= -0.05;
  return {
    a: Math.max(0, Math.min(100, a)),
    b: Math.max(0, Math.min(100, b)),
    c: Math.max(0, Math.min(100, c)),
    isInside,
  };
}

/**
 * Calculate constraint boundary lines and experimental polygon for 3 mixture components (L_i <= X_i <= U_i)
 */
export function calculateMixtureConstraints(
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  activeTotal: number = 100
): MixtureConstraintsResult {
  const lines: MixtureConstraintLine[] = [];

  const lA = Math.max(0, factorA.low);
  const uA = Math.min(activeTotal, factorA.high);
  const lB = Math.max(0, factorB.low);
  const uB = Math.min(activeTotal, factorB.high);
  const lC = Math.max(0, factorC.low);
  const uC = Math.min(activeTotal, factorC.high);

  const hasConstraints =
    lA > 0 || uA < activeTotal || lB > 0 || uB < activeTotal || lC > 0 || uC < activeTotal;

  // Factor A Lines (horizontal in standard ternary)
  if (lA > 0 && lA < activeTotal) {
    const p1 = { a: lA, b: 0, c: Number((activeTotal - lA).toFixed(2)) };
    const p2 = { a: lA, b: Number((activeTotal - lA).toFixed(2)), c: 0 };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorA.code,
      factorName: factorA.name,
      type: 'low',
      value: lA,
      label: `Giới hạn dưới ${factorA.code} ≥ ${lA}%`,
      color: '#0f766e',
      dash: 'dash',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }
  if (uA > 0 && uA < activeTotal) {
    const p1 = { a: uA, b: 0, c: Number((activeTotal - uA).toFixed(2)) };
    const p2 = { a: uA, b: Number((activeTotal - uA).toFixed(2)), c: 0 };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorA.code,
      factorName: factorA.name,
      type: 'high',
      value: uA,
      label: `Giới hạn trên ${factorA.code} ≤ ${uA}%`,
      color: '#0f766e',
      dash: 'dot',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }

  // Factor B Lines
  if (lB > 0 && lB < activeTotal) {
    const p1 = { a: 0, b: lB, c: Number((activeTotal - lB).toFixed(2)) };
    const p2 = { a: Number((activeTotal - lB).toFixed(2)), b: lB, c: 0 };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorB.code,
      factorName: factorB.name,
      type: 'low',
      value: lB,
      label: `Giới hạn dưới ${factorB.code} ≥ ${lB}%`,
      color: '#0284c7',
      dash: 'dash',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }
  if (uB > 0 && uB < activeTotal) {
    const p1 = { a: 0, b: uB, c: Number((activeTotal - uB).toFixed(2)) };
    const p2 = { a: Number((activeTotal - uB).toFixed(2)), b: uB, c: 0 };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorB.code,
      factorName: factorB.name,
      type: 'high',
      value: uB,
      label: `Giới hạn trên ${factorB.code} ≤ ${uB}%`,
      color: '#0284c7',
      dash: 'dot',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }

  // Factor C Lines
  if (lC > 0 && lC < activeTotal) {
    const p1 = { a: 0, b: Number((activeTotal - lC).toFixed(2)), c: lC };
    const p2 = { a: Number((activeTotal - lC).toFixed(2)), b: 0, c: lC };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorC.code,
      factorName: factorC.name,
      type: 'low',
      value: lC,
      label: `Giới hạn dưới ${factorC.code} ≥ ${lC}%`,
      color: '#7c3aed',
      dash: 'dash',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }
  if (uC > 0 && uC < activeTotal) {
    const p1 = { a: 0, b: Number((activeTotal - uC).toFixed(2)), c: uC };
    const p2 = { a: Number((activeTotal - uC).toFixed(2)), b: 0, c: uC };
    const c1 = ternaryToCartesian((p1.a / activeTotal) * 100, (p1.b / activeTotal) * 100, (p1.c / activeTotal) * 100);
    const c2 = ternaryToCartesian((p2.a / activeTotal) * 100, (p2.b / activeTotal) * 100, (p2.c / activeTotal) * 100);
    lines.push({
      factorCode: factorC.code,
      factorName: factorC.name,
      type: 'high',
      value: uC,
      label: `Giới hạn trên ${factorC.code} ≤ ${uC}%`,
      color: '#7c3aed',
      dash: 'dot',
      p1: { ...p1, ...c1 },
      p2: { ...p2, ...c2 },
    });
  }

  // Calculate polygon intersection vertices
  const polygonVertices: { a: number; b: number; c: number; x?: number; y?: number }[] = [];
  const aVals = Array.from(new Set([0, lA, uA, activeTotal])).filter((v) => v >= 0 && v <= activeTotal);
  const bVals = Array.from(new Set([0, lB, uB, activeTotal])).filter((v) => v >= 0 && v <= activeTotal);
  const cVals = Array.from(new Set([0, lC, uC, activeTotal])).filter((v) => v >= 0 && v <= activeTotal);

  const candidatePoints: { a: number; b: number; c: number }[] = [];

  aVals.forEach((a) => {
    bVals.forEach((b) => {
      const c = Number((activeTotal - a - b).toFixed(3));
      if (c >= -1e-4 && c <= activeTotal + 1e-4) {
        candidatePoints.push({ a, b, c: Math.max(0, c) });
      }
    });
  });

  aVals.forEach((c) => {
    cVals.forEach((b) => {
      const a = Number((activeTotal - b - c).toFixed(3));
      if (a >= -1e-4 && a <= activeTotal + 1e-4) {
        candidatePoints.push({ a: Math.max(0, a), b, c });
      }
    });
  });

  bVals.forEach((b) => {
    cVals.forEach((c) => {
      const a = Number((activeTotal - b - c).toFixed(3));
      if (a >= -1e-4 && a <= activeTotal + 1e-4) {
        candidatePoints.push({ a: Math.max(0, a), b, c });
      }
    });
  });

  const validVertices = candidatePoints.filter(
    (p) =>
      p.a >= lA - 1e-4 &&
      p.a <= uA + 1e-4 &&
      p.b >= lB - 1e-4 &&
      p.b <= uB + 1e-4 &&
      p.c >= lC - 1e-4 &&
      p.c <= uC + 1e-4
  );

  const uniqueVertices: { a: number; b: number; c: number; x: number; y: number }[] = [];
  validVertices.forEach((p) => {
    const isDup = uniqueVertices.some(
      (u) => Math.abs(u.a - p.a) < 0.05 && Math.abs(u.b - p.b) < 0.05 && Math.abs(u.c - p.c) < 0.05
    );
    if (!isDup) {
      const cart = ternaryToCartesian((p.a / activeTotal) * 100, (p.b / activeTotal) * 100, (p.c / activeTotal) * 100);
      uniqueVertices.push({
        a: Number(p.a.toFixed(2)),
        b: Number(p.b.toFixed(2)),
        c: Number(p.c.toFixed(2)),
        ...cart,
      });
    }
  });

  if (uniqueVertices.length >= 3) {
    const cA = uniqueVertices.reduce((s, v) => s + v.a, 0) / uniqueVertices.length;
    const cB = uniqueVertices.reduce((s, v) => s + v.b, 0) / uniqueVertices.length;
    const cC = uniqueVertices.reduce((s, v) => s + v.c, 0) / uniqueVertices.length;
    const centerCart = ternaryToCartesian((cA / activeTotal) * 100, (cB / activeTotal) * 100, (cC / activeTotal) * 100);

    uniqueVertices.sort((v1, v2) => {
      const ang1 = Math.atan2(v1.y - centerCart.y, v1.x - centerCart.x);
      const ang2 = Math.atan2(v2.y - centerCart.y, v2.x - centerCart.x);
      return ang1 - ang2;
    });

    polygonVertices.push(...uniqueVertices);
  }

  return { lines, polygonVertices, hasConstraints };
}

/**
 * Generate Ternary Contour Surface Grid
 * Uses Native 2D Cartesian Simplex Grid (N_x=240, N_y=208) for 100% continuous, bicubic anti-aliased smoothness!
 */
export function generateTernaryContour(
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  allFactors: Factor[],
  fixedFactorsCoded: Record<string, number>,
  model: StatisticalModelResult | NeuralNetModelResult,
  cqa: CQA,
  numContourLevelsOrRes: number = 14,
  resolutionOrLevels: number = 240
): TernaryContourResult {
  const numContourLevels = numContourLevelsOrRes > 40 ? resolutionOrLevels : numContourLevelsOrRes;
  const resolution = numContourLevelsOrRes > 40 ? numContourLevelsOrRes : resolutionOrLevels;

  const otherMixFactors = allFactors.filter(
    (f) =>
      (f.role === 'mixture_component' || f.type === 'Mixture') &&
      f.code !== factorA.code &&
      f.code !== factorB.code &&
      f.code !== factorC.code
  );

  let sumOtherPct = 0;
  otherMixFactors.forEach((f) => {
    const c = fixedFactorsCoded[f.code] ?? 0;
    const act = codedToActual(c, f);
    const val = typeof act === 'number' ? act : parseFloat(String(act)) || 0;
    sumOtherPct += Math.max(0, val);
  });

  const activeFraction = Math.max(0.01, Math.min(1.0, (100 - sumOtherPct) / 100));
  const activeTotal = Number((activeFraction * 100).toFixed(2));
  const constraints = calculateMixtureConstraints(factorA, factorB, factorC, activeTotal);

  const lA = Math.max(0, factorA.low);
  const uA = Math.min(activeTotal, factorA.high);
  const lB = Math.max(0, factorB.low);
  const uB = Math.min(activeTotal, factorB.high);
  const lC = Math.max(0, factorC.low);
  const uC = Math.min(activeTotal, factorC.high);

  const Nx = Math.max(160, Math.min(320, resolution));
  const Ny = Math.round(Nx * (TERNARY_HEIGHT / 100));

  const xGrid: number[] = [];
  for (let i = 0; i < Nx; i++) {
    xGrid.push((i / (Nx - 1)) * 100);
  }

  const yGrid: number[] = [];
  for (let j = 0; j < Ny; j++) {
    yGrid.push((j / (Ny - 1)) * TERNARY_HEIGHT);
  }

  const zGrid: (number | null)[][] = Array.from({ length: Ny }, () => new Array(Nx).fill(null));
  const meshPoints: TernaryPoint[] = [];

  let zMin = Infinity;
  let zMax = -Infinity;

  for (let j = 0; j < Ny; j++) {
    const y = yGrid[j];
    for (let i = 0; i < Nx; i++) {
      const x = xGrid[i];
      const { a, b, c, isInside } = cartesianToTernary(x, y);

      if (isInside) {
        const u = a / 100;
        const v = b / 100;
        const w = c / 100;

        const aProp = u * activeFraction;
        const bProp = v * activeFraction;
        const cProp = w * activeFraction;

        const aPct = Number((aProp * 100).toFixed(2));
        const bPct = Number((bProp * 100).toFixed(2));
        const cPct = Number((cProp * 100).toFixed(2));

        const pointCoded: Record<string, number> = { ...fixedFactorsCoded };
        pointCoded[factorA.code] = factorA.role === 'mixture_component' ? aProp : actualToCoded(aPct, factorA);
        pointCoded[factorB.code] = factorB.role === 'mixture_component' ? bProp : actualToCoded(bPct, factorB);
        pointCoded[factorC.code] = factorC.role === 'mixture_component' ? cProp : actualToCoded(cPct, factorC);

        const zVal = Number(model.predict(pointCoded).toFixed(3));
        zGrid[j][i] = zVal;

        if (zVal < zMin) zMin = zVal;
        if (zVal > zMax) zMax = zVal;

        const insideSurvey =
          aPct >= lA - 0.05 &&
          aPct <= uA + 0.05 &&
          bPct >= lB - 0.05 &&
          bPct <= uB + 0.05 &&
          cPct >= lC - 0.05 &&
          cPct <= uC + 0.05;

        if (i % 3 === 0 && j % 3 === 0) {
          meshPoints.push({
            u,
            v,
            w,
            aPct,
            bPct,
            cPct,
            x,
            y,
            z: zVal,
            isInsideConstraints: insideSurvey,
          });
        }
      }
    }
  }

  if (zMin === Infinity) {
    zMin = 0;
    zMax = 100;
  }

  // Extract CQA Spec Limit Contour Lines (LSL / USL / Target) using 2D Marching Squares
  const contourLines: TernaryContourLine[] = [];
  const zGridClean: number[][] = zGrid.map((row) => row.map((v) => (v === null ? -999999 : v)));

  if (cqa.lowerLimit !== undefined && cqa.lowerLimit >= zMin && cqa.lowerLimit <= zMax) {
    const segs = extract2DContourSegments(xGrid, yGrid, zGridClean, cqa.lowerLimit);
    if (segs.length > 0) {
      contourLines.push({
        level: cqa.lowerLimit,
        isSpecLimit: true,
        specType: 'LSL',
        segments: segs.map((s) => {
          const t1 = cartesianToTernary(s.x1, s.y1);
          const t2 = cartesianToTernary(s.x2, s.y2);
          return {
            p1: { a: t1.a, b: t1.b, c: t1.c, x: s.x1, y: s.y1 },
            p2: { a: t2.a, b: t2.b, c: t2.c, x: s.x2, y: s.y2 },
          };
        }),
      });
    }
  }

  if (cqa.upperLimit !== undefined && cqa.upperLimit >= zMin && cqa.upperLimit <= zMax) {
    const segs = extract2DContourSegments(xGrid, yGrid, zGridClean, cqa.upperLimit);
    if (segs.length > 0) {
      contourLines.push({
        level: cqa.upperLimit,
        isSpecLimit: true,
        specType: 'USL',
        segments: segs.map((s) => {
          const t1 = cartesianToTernary(s.x1, s.y1);
          const t2 = cartesianToTernary(s.x2, s.y2);
          return {
            p1: { a: t1.a, b: t1.b, c: t1.c, x: s.x1, y: s.y1 },
            p2: { a: t2.a, b: t2.b, c: t2.c, x: s.x2, y: s.y2 },
          };
        }),
      });
    }
  }

  if (cqa.target !== undefined && cqa.target >= zMin && cqa.target <= zMax && cqa.objective === 'target') {
    const segs = extract2DContourSegments(xGrid, yGrid, zGridClean, cqa.target);
    if (segs.length > 0) {
      contourLines.push({
        level: cqa.target,
        isSpecLimit: true,
        specType: 'Target',
        segments: segs.map((s) => {
          const t1 = cartesianToTernary(s.x1, s.y1);
          const t2 = cartesianToTernary(s.x2, s.y2);
          return {
            p1: { a: t1.a, b: t1.b, c: t1.c, x: s.x1, y: s.y1 },
            p2: { a: t2.a, b: t2.b, c: t2.c, x: s.x2, y: s.y2 },
          };
        }),
      });
    }
  }

  return {
    xGrid,
    yGrid,
    zGrid: zGrid as any,
    meshPoints,
    facets: [],
    zMin,
    zMax,
    numLevels: numContourLevels,
    contourLines,
    activeFraction,
    constraints,
  };
}

/**
 * Build Plotly Traces and Layout for Ternary Contour
 * Uses Native Plotly 2D Contour with Simplex Projection - 100% Bicubic Smoothness!
 */
export function buildTernaryPlotlyData(
  contourResult: TernaryContourResult,
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  cqa: CQA,
  options: {
    colorScale?: string;
    displayMode?: 'both' | 'lines_only' | 'heatmap';
    showDoERuns?: boolean;
    doeRuns?: DoERun[];
    showOptimum?: boolean;
    optimum?: DesirabilitySolution | null;
    showConstraints?: boolean;
    showRegionPolygon?: boolean;
    showSpecLimits?: boolean;
    ternaryLevels?: number;
    smoothness?: number;
  } = {}
) {
  const {
    colorScale = 'Viridis',
    displayMode = 'both',
    showDoERuns = true,
    doeRuns = [],
    showOptimum = true,
    optimum = null,
    showConstraints = true,
    showRegionPolygon = true,
    showSpecLimits = true,
    ternaryLevels = 14,
    smoothness = 1.0,
  } = options;

  const traces: any[] = [];
  const { xGrid, yGrid, zGrid, meshPoints, contourLines, constraints } = contourResult;
  const H = TERNARY_HEIGHT;

  // 1. Native Plotly 2D Contour (Continuous Bicubic Vector Gradient - 100% Smooth identical to 2D Contour!)
  traces.push({
    type: 'contour',
    x: xGrid,
    y: yGrid,
    z: zGrid,
    colorscale: colorScale,
    ncontours: ternaryLevels,
    contours: {
      coloring: displayMode === 'lines_only' ? 'none' : 'heatmap',
      showlabels: displayMode !== 'heatmap',
      labelfont: { family: 'Inter, sans-serif', size: 11, color: '#ffffff' },
    },
    line: {
      smoothing: smoothness,
      width: displayMode === 'lines_only' ? 2.0 : 1.1,
      color: displayMode === 'lines_only' ? '#0f172a' : 'rgba(255, 255, 255, 0.45)',
    },
    colorbar: {
      title: {
        text: `${cqa.name} (${cqa.code})${cqa.unit ? ` [${cqa.unit}]` : ''}`,
        side: 'right',
        font: { size: 11, color: '#1e293b' },
      },
      len: 0.85,
      thickness: 18,
    },
    hoverinfo: 'none',
    showscale: displayMode !== 'lines_only',
  });

  // 2. Simplex Outer Boundary Frame
  traces.push({
    type: 'scatter',
    mode: 'lines',
    name: 'Biên Tam Giác Simplex',
    x: [0, 100, 50, 0],
    y: [0, 0, H, 0],
    line: { color: '#0f172a', width: 2.8 },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 3. Ternary Gridlines (10% to 90% in light gray dot)
  const gridX: (number | null)[] = [];
  const gridY: (number | null)[] = [];
  for (let p = 10; p <= 90; p += 10) {
    // Constant A = p (horizontal lines)
    gridX.push(p / 2, 100 - p / 2, null);
    gridY.push(p * (H / 100), p * (H / 100), null);

    // Constant B = p (lines parallel to AC)
    gridX.push(100 - p, (100 - p) / 2, null);
    gridY.push(0, (100 - p) * (H / 100), null);

    // Constant C = p (lines parallel to AB)
    gridX.push(p, 50 + p / 2, null);
    gridY.push(0, (100 - p) * (H / 100), null);
  }

  traces.push({
    type: 'scatter',
    mode: 'lines',
    name: 'Lưới Tam Giác (%)',
    x: gridX,
    y: gridY,
    line: { color: 'rgba(148, 163, 184, 0.45)', width: 0.9, dash: 'dot' },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 4. Tick Labels along the 3 Edges
  const tickX: number[] = [];
  const tickY: number[] = [];
  const tickTexts: string[] = [];

  // Base BC (Axis C: 0 to 100%)
  for (let c = 20; c <= 80; c += 20) {
    tickX.push(c);
    tickY.push(-3.2);
    tickTexts.push(`${c}%`);
  }
  // Right Edge CA (Axis A: 0 to 100%)
  for (let a = 20; a <= 80; a += 20) {
    tickX.push(100 - a / 2 + 4.2);
    tickY.push(a * (H / 100));
    tickTexts.push(`${a}%`);
  }
  // Left Edge AB (Axis B: 0 to 100%)
  for (let b = 20; b <= 80; b += 20) {
    tickX.push((100 - b) / 2 - 4.2);
    tickY.push((100 - b) * (H / 100));
    tickTexts.push(`${b}%`);
  }

  traces.push({
    type: 'scatter',
    mode: 'text',
    name: 'Chỉ số %',
    x: tickX,
    y: tickY,
    text: tickTexts,
    textposition: 'middle center',
    textfont: { family: 'Inter, sans-serif', size: 9.5, color: '#64748b', weight: 600 },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 5. Survey Constraint Lines (Li <= Xi <= Ui)
  if (showConstraints && constraints.lines.length > 0) {
    constraints.lines.forEach((cl) => {
      if (cl.p1.x !== undefined && cl.p1.y !== undefined && cl.p2.x !== undefined && cl.p2.y !== undefined) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: cl.label,
          x: [cl.p1.x, cl.p2.x],
          y: [cl.p1.y, cl.p2.y],
          line: {
            color: cl.color,
            width: 2.4,
            dash: cl.dash,
          },
          hoverinfo: 'name',
          showlegend: true,
        });
      }
    });
  }

  // 6. Feasible DoE Region Polygon (Viền cam)
  if (showRegionPolygon && constraints.polygonVertices.length >= 3) {
    const polyX = constraints.polygonVertices.map((v) => v.x ?? 0);
    const polyY = constraints.polygonVertices.map((v) => v.y ?? 0);
    polyX.push(polyX[0]);
    polyY.push(polyY[0]);

    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: '🔶 Vùng Thực Nghiệm DoE (Khả Thi)',
      x: polyX,
      y: polyY,
      line: {
        color: '#ea580c',
        width: 3.0,
      },
      hoverinfo: 'name',
      showlegend: true,
    });
  }

  // 7. CQA Specification Limits Lines (LSL / USL / Target)
  if (showSpecLimits && contourLines.length > 0) {
    contourLines.forEach((sl) => {
      const segX: (number | null)[] = [];
      const segY: (number | null)[] = [];

      sl.segments.forEach((seg) => {
        if (seg.p1.x !== undefined && seg.p1.y !== undefined && seg.p2.x !== undefined && seg.p2.y !== undefined) {
          segX.push(seg.p1.x, seg.p2.x, null);
          segY.push(seg.p1.y, seg.p2.y, null);
        }
      });

      if (segX.length > 0) {
        const isLSL = sl.specType === 'LSL';
        const isTarget = sl.specType === 'Target';
        const lineColor = isTarget ? '#059669' : isLSL ? '#dc2626' : '#b91c1c';
        const lineDash = isTarget ? 'solid' : 'dash';
        const label = isLSL
          ? `🔴 Giới Hạn Dưới (LSL = ${sl.level} ${cqa.unit || ''})`
          : !isTarget
          ? `🔴 Giới Hạn Trên (USL = ${sl.level} ${cqa.unit || ''})`
          : `🟢 Mục Tiêu (Target = ${sl.level} ${cqa.unit || ''})`;

        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: label,
          x: segX,
          y: segY,
          line: {
            color: lineColor,
            width: 3.4,
            dash: lineDash,
          },
          hoverinfo: 'name',
          showlegend: true,
        });
      }
    });
  }

  // 8. Fine Hover Probing Layer
  const hX = meshPoints.map((p) => p.x);
  const hY = meshPoints.map((p) => p.y);
  const hText = meshPoints.map((p) => {
    const constraintBadge = p.isInsideConstraints
      ? `<span style="color:#059669;font-weight:700">✓ Trong khoảng khảo sát DoE</span>`
      : `<span style="color:#dc2626;font-weight:700">⚠ Ngoài giới hạn khảo sát</span>`;

    return (
      `<b>${factorA.name} (${factorA.code})</b>: ${p.aPct}%<br>` +
      `<b>${factorB.name} (${factorB.code})</b>: ${p.bPct}%<br>` +
      `<b>${factorC.name} (${factorC.code})</b>: ${p.cPct}%<br>` +
      `-------------------------<br>` +
      `${constraintBadge}<br>` +
      `<span style="color:#0f766e;font-weight:700">Dự đoán ${cqa.name} (${cqa.code}): ${p.z} ${cqa.unit}</span>`
    );
  });

  traces.push({
    type: 'scatter',
    mode: 'markers',
    name: 'Hover Probe',
    x: hX,
    y: hY,
    text: hText,
    hoverinfo: 'text',
    marker: {
      size: 8,
      opacity: 0.001,
      color: '#000000',
    },
    showlegend: false,
  });

  // 9. Experimental DoE Runs (◆)
  if (showDoERuns && doeRuns.length > 0) {
    const runX: number[] = [];
    const runY: number[] = [];
    const runTexts: string[] = [];
    const runHovers: string[] = [];

    doeRuns.forEach((run, idx) => {
      const valA = run.factorActual[factorA.code];
      const valB = run.factorActual[factorB.code];
      const valC = run.factorActual[factorC.code];

      if (valA !== undefined && valB !== undefined && valC !== undefined) {
        const rawA = typeof valA === 'number' ? valA : parseFloat(String(valA)) || 0;
        const rawB = typeof valB === 'number' ? valB : parseFloat(String(valB)) || 0;
        const rawC = typeof valC === 'number' ? valC : parseFloat(String(valC)) || 0;

        const aPct = rawA <= 1.0 && factorA.unit !== '%' ? rawA * 100 : rawA;
        const bPct = rawB <= 1.0 && factorB.unit !== '%' ? rawB * 100 : rawB;
        const cPct = rawC <= 1.0 && factorC.unit !== '%' ? rawC * 100 : rawC;

        const sum = aPct + bPct + cPct;
        const aNorm = sum > 0 ? (aPct / sum) * 100 : 0;
        const bNorm = sum > 0 ? (bPct / sum) * 100 : 0;
        const cNorm = sum > 0 ? (cPct / sum) * 100 : 0;

        const cart = ternaryToCartesian(aNorm, bNorm, cNorm);
        runX.push(cart.x);
        runY.push(cart.y);
        runTexts.push(`R${run.runOrder || idx + 1}`);

        const yVal = run.responses[cqa.code];
        runHovers.push(
          `<b>Thí nghiệm ${run.runOrder || idx + 1} (DoE Run)</b><br>` +
          `${factorA.name}: ${aPct.toFixed(1)}%<br>` +
          `${factorB.name}: ${bPct.toFixed(1)}%<br>` +
          `${factorC.name}: ${cPct.toFixed(1)}%<br>` +
          `<b>Thực nghiệm ${cqa.code}: ${yVal !== undefined ? yVal : 'N/A'} ${cqa.unit || ''}</b>`
        );
      }
    });

    if (runX.length > 0) {
      traces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: 'Điểm Thực Nghiệm DoE (◆)',
        x: runX,
        y: runY,
        text: runTexts,
        textposition: 'top center',
        textfont: { family: 'Inter, sans-serif', size: 10, color: '#0f172a', weight: 700 },
        hoverinfo: 'text',
        hovertext: runHovers,
        marker: {
          symbol: 'diamond',
          color: '#fbbf24',
          line: { color: '#0f172a', width: 2 },
          size: 11,
        },
        showlegend: true,
      });
    }
  }

  // 10. Optimum Point Trace (★)
  if (showOptimum && optimum) {
    const rawA = optimum.actualFactors[factorA.code];
    const rawB = optimum.actualFactors[factorB.code];
    const rawC = optimum.actualFactors[factorC.code];

    const optA = typeof rawA === 'number' ? rawA : parseFloat(String(rawA)) || 0;
    const optB = typeof rawB === 'number' ? rawB : parseFloat(String(rawB)) || 0;
    const optC = typeof rawC === 'number' ? rawC : parseFloat(String(rawC)) || 0;

    const aPct = optA <= 1.0 && factorA.unit !== '%' ? optA * 100 : optA;
    const bPct = optB <= 1.0 && factorB.unit !== '%' ? optB * 100 : optB;
    const cPct = optC <= 1.0 && factorC.unit !== '%' ? optC * 100 : optC;

    const sum = aPct + bPct + cPct;
    const aNorm = sum > 0 ? (aPct / sum) * 100 : 0;
    const bNorm = sum > 0 ? (bPct / sum) * 100 : 0;
    const cNorm = sum > 0 ? (cPct / sum) * 100 : 0;

    const cart = ternaryToCartesian(aNorm, bNorm, cNorm);
    const optPred = optimum.predictedResponses[cqa.code];

    traces.push({
      type: 'scatter',
      mode: 'markers+text',
      name: '★ Điểm Tối Ưu (Optimum)',
      x: [cart.x],
      y: [cart.y],
      text: ['★ TỐI ƯU'],
      textposition: 'bottom center',
      textfont: { family: 'Inter, sans-serif', size: 11, color: '#b45309', weight: 700 },
      hoverinfo: 'text',
      hovertext: [
        `<b>★ ĐIỂM TỐI ƯU DESIRABILITY (D = ${(optimum.overallDesirability * 100).toFixed(1)}%)</b><br>` +
        `${factorA.name}: ${aPct.toFixed(1)}%<br>` +
        `${factorB.name}: ${bPct.toFixed(1)}%<br>` +
        `${factorC.name}: ${cPct.toFixed(1)}%<br>` +
        `<b>Dự đoán ${cqa.code}: ${optPred ? optPred.value.toFixed(2) : 'N/A'} ${cqa.unit}</b>`
      ],
      marker: {
        symbol: 'star',
        color: '#e11d48',
        line: { color: '#ffffff', width: 2 },
        size: 15,
      },
      showlegend: true,
    });
  }

  // Layout with 1:1 Aspect Ratio and Apex Annotations
  const layout = {
    title: {
      text: `Biểu Đồ Contour Tam Giác Hỗn Hợp: ${cqa.name} (${cqa.code})${cqa.unit ? ` [${cqa.unit}]` : ''}`,
      font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' },
    },
    autosize: true,
    margin: { l: 65, r: 65, b: 65, t: 55, pad: 4 },
    xaxis: {
      range: [-15, 115],
      fixedrange: true,
      zeroline: false,
      showgrid: false,
      showline: false,
      showticklabels: false,
    },
    yaxis: {
      range: [-10, 98],
      fixedrange: true,
      zeroline: false,
      showgrid: false,
      showline: false,
      showticklabels: false,
      scaleanchor: 'x',
      scaleratio: 1,
    },
    annotations: [
      // Apex A (Top)
      {
        x: 50,
        y: H + 5.5,
        text: `<b>▲ ${factorA.name} (${factorA.code})</b>`,
        showarrow: false,
        font: { size: 12.5, color: '#0f172a', family: 'Inter, sans-serif' },
      },
      // Apex B (Bottom-Left)
      {
        x: -4,
        y: -6.5,
        text: `<b>◀ ${factorB.name} (${factorB.code})</b>`,
        showarrow: false,
        font: { size: 12.5, color: '#0f172a', family: 'Inter, sans-serif' },
      },
      // Apex C (Bottom-Right)
      {
        x: 104,
        y: -6.5,
        text: `<b>▶ ${factorC.name} (${factorC.code})</b>`,
        showarrow: false,
        font: { size: 12.5, color: '#0f172a', family: 'Inter, sans-serif' },
      },
    ],
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: -0.14,
      font: { size: 10.5 },
    },
  };

  return { traces, layout };
}

/**
 * Generate Ternary Design Space Sweet Spot (Multi-CQA Overlay on Simplex)
 * Uses Native 2D Cartesian Simplex Grid for 100% Smooth Continuous Sweet Spot Heatmap!
 */
export function generateTernaryDesignSpace(
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  allFactors: Factor[],
  fixedFactorsCoded: Record<string, number>,
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  cqas: CQA[],
  resolution: number = 240,
  options?: {
    optimum?: DesirabilitySolution | null;
    doeRuns?: DoERun[];
    showDoERuns?: boolean;
    showConstraints?: boolean;
    showRegionPolygon?: boolean;
    showOptimum?: boolean;
    smoothness?: number;
  }
) {
  const {
    optimum = null,
    doeRuns = [],
    showDoERuns = true,
    showConstraints = true,
    showRegionPolygon = true,
    showOptimum = true,
    smoothness = 1.0,
  } = options || {};

  const otherMixFactors = allFactors.filter(
    (f) =>
      (f.role === 'mixture_component' || f.type === 'Mixture') &&
      f.code !== factorA.code &&
      f.code !== factorB.code &&
      f.code !== factorC.code
  );

  let sumOtherPct = 0;
  otherMixFactors.forEach((f) => {
    const c = fixedFactorsCoded[f.code] ?? 0;
    const act = codedToActual(c, f);
    const val = typeof act === 'number' ? act : parseFloat(String(act)) || 0;
    sumOtherPct += Math.max(0, val);
  });

  const activeFraction = Math.max(0.01, Math.min(1.0, (100 - sumOtherPct) / 100));
  const activeTotal = Number((activeFraction * 100).toFixed(2));
  const constraints = calculateMixtureConstraints(factorA, factorB, factorC, activeTotal);

  const lA = Math.max(0, factorA.low);
  const uA = Math.min(activeTotal, factorA.high);
  const lB = Math.max(0, factorB.low);
  const uB = Math.min(activeTotal, factorB.high);
  const lC = Math.max(0, factorC.low);
  const uC = Math.min(activeTotal, factorC.high);

  const Nx = Math.max(160, Math.min(320, resolution));
  const Ny = Math.round(Nx * (TERNARY_HEIGHT / 100));
  const H = TERNARY_HEIGHT;

  const validCQAs = cqas.filter((c) => models[c.code]);

  const xGrid: number[] = [];
  for (let i = 0; i < Nx; i++) xGrid.push((i / (Nx - 1)) * 100);

  const yGrid: number[] = [];
  for (let j = 0; j < Ny; j++) yGrid.push((j / (Ny - 1)) * H);

  const marginGrid: (number | null)[][] = Array.from({ length: Ny }, () => new Array(Nx).fill(null));

  const hoverX: number[] = [];
  const hoverY: number[] = [];
  const hoverText: string[] = [];

  let totalSimplexPoints = 0;
  let inSpecPoints = 0;

  for (let j = 0; j < Ny; j++) {
    const y = yGrid[j];
    for (let i = 0; i < Nx; i++) {
      const x = xGrid[i];
      const { a, b, c, isInside } = cartesianToTernary(x, y);

      if (isInside) {
        totalSimplexPoints++;
        const u = a / 100;
        const v = b / 100;
        const w = c / 100;

        const aProp = u * activeFraction;
        const bProp = v * activeFraction;
        const cProp = w * activeFraction;

        const aPct = Number((aProp * 100).toFixed(2));
        const bPct = Number((bProp * 100).toFixed(2));
        const cPct = Number((cProp * 100).toFixed(2));

        const pointCoded: Record<string, number> = { ...fixedFactorsCoded };
        pointCoded[factorA.code] = factorA.role === 'mixture_component' ? aProp : actualToCoded(aPct, factorA);
        pointCoded[factorB.code] = factorB.role === 'mixture_component' ? bProp : actualToCoded(bPct, factorB);
        pointCoded[factorC.code] = factorC.role === 'mixture_component' ? cProp : actualToCoded(cPct, factorC);

        let minMargin = 999999;
        let worstCQA = '';
        let worstPred = 0;

        for (const cqa of validCQAs) {
          const m = models[cqa.code];
          if (!m) continue;
          const yPred = m.predict(pointCoded);
          const cqaMargin = calculateCQAMargin(yPred, cqa.objective, cqa.lowerLimit, cqa.upperLimit, cqa.target);

          if (cqaMargin < minMargin) {
            minMargin = cqaMargin;
            worstCQA = `${cqa.name} (${cqa.code})`;
            worstPred = yPred;
          }
        }

        const clampedMargin = Number(Math.max(-0.35, Math.min(0.35, minMargin)).toFixed(4));
        marginGrid[j][i] = clampedMargin;

        const isInsideSurvey =
          aPct >= lA - 0.05 &&
          aPct <= uA + 0.05 &&
          bPct >= lB - 0.05 &&
          bPct <= uB + 0.05 &&
          cPct >= lC - 0.05 &&
          cPct <= uC + 0.05;

        if (minMargin >= 0 && isInsideSurvey) inSpecPoints++;

        if (i % 3 === 0 && j % 3 === 0) {
          hoverX.push(x);
          hoverY.push(y);
          const statusText =
            minMargin >= 0
              ? `<span style="color:#16a34a;font-weight:700">✓ ĐẠT DESIGN SPACE (+${(minMargin * 100).toFixed(1)}% Margin)</span>`
              : `<span style="color:#dc2626;font-weight:700">⚠ KHÔNG ĐẠT: ${worstCQA} = ${worstPred.toFixed(2)}</span>`;

          hoverText.push(
            `<b>${factorA.name}</b>: ${aPct}%<br>` +
            `<b>${factorB.name}</b>: ${bPct}%<br>` +
            `<b>${factorC.name}</b>: ${cPct}%<br>` +
            `-------------------------<br>` +
            `${statusText}`
          );
        }
      }
    }
  }

  const sweetSpotFraction = totalSimplexPoints > 0 ? inSpecPoints / totalSimplexPoints : 0;
  const sweetSpotTraces: any[] = [];

  // 1. Continuous Sweet Spot Contour Heatmap
  sweetSpotTraces.push({
    type: 'contour',
    x: xGrid,
    y: yGrid,
    z: marginGrid,
    zmin: -0.35,
    zmax: 0.35,
    zmid: 0.0,
    colorscale: [
      [0.0, 'rgba(239, 68, 68, 0.75)'],
      [0.499, 'rgba(254, 240, 138, 0.65)'],
      [0.5, 'rgba(187, 247, 208, 0.85)'],
      [1.0, 'rgba(22, 163, 74, 0.95)'],
    ],
    ncontours: 20,
    contours: {
      coloring: 'heatmap',
      showlabels: false,
    },
    line: {
      smoothing: smoothness,
      width: 0.8,
      color: 'rgba(255, 255, 255, 0.35)',
    },
    colorbar: {
      title: {
        text: 'Margin Chất Lượng (≥ 0 là Đạt)',
        side: 'right',
        font: { size: 10.5, color: '#1e293b' },
      },
      len: 0.75,
      thickness: 16,
      x: 1.02,
    },
    hoverinfo: 'none',
  });

  // 2. Simplex Outer Frame
  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'lines',
    name: 'Biên Tam Giác',
    x: [0, 100, 50, 0],
    y: [0, 0, H, 0],
    line: { color: '#0f172a', width: 2.8 },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 3. Triangle Grid (%) Lines
  const gridX: (number | null)[] = [];
  const gridY: (number | null)[] = [];

  for (let p = 10; p <= 90; p += 10) {
    // Constant A = p (horizontal lines)
    gridX.push(p / 2, 100 - p / 2, null);
    gridY.push(p * (H / 100), p * (H / 100), null);

    // Constant B = p (lines parallel to AC)
    gridX.push(100 - p, (100 - p) / 2, null);
    gridY.push(0, (100 - p) * (H / 100), null);

    // Constant C = p (lines parallel to AB)
    gridX.push(p, 50 + p / 2, null);
    gridY.push(0, (100 - p) * (H / 100), null);
  }

  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'lines',
    name: 'Lưới Tam Giác (%)',
    x: gridX,
    y: gridY,
    line: { color: 'rgba(148, 163, 184, 0.45)', width: 0.9, dash: 'dot' },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 4. Tick Labels along the 3 Edges
  const tickX: number[] = [];
  const tickY: number[] = [];
  const tickTexts: string[] = [];

  // Base BC (Axis C: 0 to 100%)
  for (let c = 20; c <= 80; c += 20) {
    tickX.push(c);
    tickY.push(-3.2);
    tickTexts.push(`${c}%`);
  }
  // Right Edge CA (Axis A: 0 to 100%)
  for (let a = 20; a <= 80; a += 20) {
    tickX.push(100 - a / 2 + 4.2);
    tickY.push(a * (H / 100));
    tickTexts.push(`${a}%`);
  }
  // Left Edge AB (Axis B: 0 to 100%)
  for (let b = 20; b <= 80; b += 20) {
    tickX.push((100 - b) / 2 - 4.2);
    tickY.push((100 - b) * (H / 100));
    tickTexts.push(`${b}%`);
  }

  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'text',
    name: 'Chỉ số %',
    x: tickX,
    y: tickY,
    text: tickTexts,
    textposition: 'middle center',
    textfont: { family: 'Inter, sans-serif', size: 9.5, color: '#64748b', weight: 600 },
    hoverinfo: 'none',
    showlegend: false,
  });

  // 5. Exact Design Space Boundary Line (Margin = 0.0) using Marching Squares
  const marginGridClean: number[][] = marginGrid.map((row) => row.map((v) => (v === null ? -999999 : v)));
  const boundarySegs = extract2DContourSegments(xGrid, yGrid, marginGridClean, 0.0);

  if (boundarySegs.length > 0) {
    const boundX: (number | null)[] = [];
    const boundY: (number | null)[] = [];

    boundarySegs.forEach((seg) => {
      boundX.push(seg.x1, seg.x2, null);
      boundY.push(seg.y1, seg.y2, null);
    });

    sweetSpotTraces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'Ranh Giới Vùng Thiết Kế (Design Space Margin = 0)',
      x: boundX,
      y: boundY,
      line: {
        color: '#15803d',
        width: 3.4,
      },
      hoverinfo: 'name',
      showlegend: true,
    });
  }

  // 6. Constraint Boundary Lines (Li <= Xi <= Ui)
  if (showConstraints && constraints.lines.length > 0) {
    constraints.lines.forEach((cl) => {
      if (cl.p1.x !== undefined && cl.p1.y !== undefined && cl.p2.x !== undefined && cl.p2.y !== undefined) {
        sweetSpotTraces.push({
          type: 'scatter',
          mode: 'lines',
          name: cl.label,
          x: [cl.p1.x, cl.p2.x],
          y: [cl.p1.y, cl.p2.y],
          line: {
            color: cl.color,
            width: 2.4,
            dash: cl.dash,
          },
          hoverinfo: 'name',
          showlegend: true,
        });
      }
    });
  }

  // 7. Feasible DoE Region Polygon
  if (showRegionPolygon && constraints.polygonVertices.length >= 3) {
    const polyX = constraints.polygonVertices.map((v) => v.x ?? 0);
    const polyY = constraints.polygonVertices.map((v) => v.y ?? 0);
    polyX.push(polyX[0]);
    polyY.push(polyY[0]);

    sweetSpotTraces.push({
      type: 'scatter',
      mode: 'lines',
      name: `Khung Khảo Sát DoE (${factorA.low}≤${factorA.code}≤${factorA.high}...)`,
      x: polyX,
      y: polyY,
      line: {
        color: '#c2410c',
        width: 3.0,
      },
      hoverinfo: 'name',
      showlegend: true,
    });
  }

  // 8. Legend Indicators
  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'lines',
    name: `Vùng Đạt Chuẩn 100% CQAs (${(sweetSpotFraction * 100).toFixed(1)}% Simplex)`,
    x: [null],
    y: [null],
    line: { color: '#22c55e', width: 4 },
    showlegend: true,
  });

  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'lines',
    name: 'Vùng Ngoài Tiêu Chuẩn (OOS)',
    x: [null],
    y: [null],
    line: { color: '#f87171', width: 4 },
    showlegend: true,
  });

  // 9. Experimental DoE Runs (◆)
  if (showDoERuns && doeRuns && doeRuns.length > 0) {
    const runX: number[] = [];
    const runY: number[] = [];
    const runTexts: string[] = [];
    const runHovers: string[] = [];

    doeRuns.forEach((run, idx) => {
      const valA = run.factorActual[factorA.code];
      const valB = run.factorActual[factorB.code];
      const valC = run.factorActual[factorC.code];

      if (valA !== undefined && valB !== undefined && valC !== undefined) {
        const rawA = typeof valA === 'number' ? valA : parseFloat(String(valA)) || 0;
        const rawB = typeof valB === 'number' ? valB : parseFloat(String(valB)) || 0;
        const rawC = typeof valC === 'number' ? valC : parseFloat(String(valC)) || 0;

        const aPct = rawA <= 1.0 && factorA.unit !== '%' ? rawA * 100 : rawA;
        const bPct = rawB <= 1.0 && factorB.unit !== '%' ? rawB * 100 : rawB;
        const cPct = rawC <= 1.0 && factorC.unit !== '%' ? rawC * 100 : rawC;

        const sum = aPct + bPct + cPct;
        const aNorm = sum > 0 ? (aPct / sum) * 100 : 0;
        const bNorm = sum > 0 ? (bPct / sum) * 100 : 0;
        const cNorm = sum > 0 ? (cPct / sum) * 100 : 0;

        const cart = ternaryToCartesian(aNorm, bNorm, cNorm);
        runX.push(cart.x);
        runY.push(cart.y);
        runTexts.push(`R${run.runOrder || idx + 1}`);

        runHovers.push(
          `<b>Thí nghiệm ${run.runOrder || idx + 1} (DoE Run)</b><br>` +
          `${factorA.name}: ${aPct.toFixed(1)}%<br>` +
          `${factorB.name}: ${bPct.toFixed(1)}%<br>` +
          `${factorC.name}: ${cPct.toFixed(1)}%`
        );
      }
    });

    if (runX.length > 0) {
      sweetSpotTraces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: 'Điểm Thực Nghiệm DoE (◆)',
        x: runX,
        y: runY,
        text: runTexts,
        textposition: 'top center',
        textfont: { family: 'Inter, sans-serif', size: 10, color: '#0f172a', weight: 700 },
        hoverinfo: 'text',
        hovertext: runHovers,
        marker: {
          symbol: 'diamond',
          color: '#fbbf24',
          line: { color: '#0f172a', width: 2 },
          size: 11,
        },
        showlegend: true,
      });
    }
  }

  // 10. Optimum Target Point (★)
  if (showOptimum && optimum) {
    const rawA = optimum.actualFactors[factorA.code];
    const rawB = optimum.actualFactors[factorB.code];
    const rawC = optimum.actualFactors[factorC.code];

    const optA = typeof rawA === 'number' ? rawA : parseFloat(String(rawA)) || 0;
    const optB = typeof rawB === 'number' ? rawB : parseFloat(String(rawB)) || 0;
    const optC = typeof rawC === 'number' ? rawC : parseFloat(String(rawC)) || 0;

    const aPct = optA <= 1.0 && factorA.unit !== '%' ? optA * 100 : optA;
    const bPct = optB <= 1.0 && factorB.unit !== '%' ? optB * 100 : optB;
    const cPct = optC <= 1.0 && factorC.unit !== '%' ? optC * 100 : optC;

    const sum = aPct + bPct + cPct;
    const aNorm = sum > 0 ? (aPct / sum) * 100 : 0;
    const bNorm = sum > 0 ? (bPct / sum) * 100 : 0;
    const cNorm = sum > 0 ? (cPct / sum) * 100 : 0;

    const cart = ternaryToCartesian(aNorm, bNorm, cNorm);

    sweetSpotTraces.push({
      type: 'scatter',
      mode: 'markers+text',
      name: '★ Target Setpoint (Optimum)',
      x: [cart.x],
      y: [cart.y],
      text: ['★ ĐIỂM TỐI ƯU'],
      textposition: 'bottom center',
      textfont: { family: 'Inter, sans-serif', size: 11, color: '#1e3a8a', weight: 700 },
      hoverinfo: 'text',
      hovertext: [
        `<b>★ ĐIỂM TỐI ƯU DESIRABILITY (D = ${(optimum.overallDesirability * 100).toFixed(1)}%)</b><br>` +
        `${factorA.name}: ${aPct.toFixed(1)}%<br>` +
        `${factorB.name}: ${bPct.toFixed(1)}%<br>` +
        `${factorC.name}: ${cPct.toFixed(1)}%`
      ],
      marker: {
        symbol: 'star',
        color: '#1e3a8a',
        line: { color: '#ffffff', width: 2 },
        size: 16,
      },
      showlegend: true,
    });
  }

  // 11. Hover Probing Layer
  sweetSpotTraces.push({
    type: 'scatter',
    mode: 'markers',
    name: 'Sweet Spot Hover',
    x: hoverX,
    y: hoverY,
    text: hoverText,
    hoverinfo: 'text',
    marker: {
      size: 8,
      opacity: 0.001,
      color: '#000000',
    },
    showlegend: false,
  });

  // 12. Complete 2D Cartesian Simplex Projection Layout
  const layout = {
    title: {
      text: `Vùng Thiết Kế Tam Giác Hỗn Hợp (Ternary Sweet Spot) - 100% CQAs Đạt Chuẩn`,
      font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' },
    },
    autosize: true,
    margin: { l: 65, r: 65, b: 75, t: 55, pad: 4 },
    xaxis: {
      range: [-15, 115],
      fixedrange: true,
      zeroline: false,
      showgrid: false,
      showline: false,
      showticklabels: false,
    },
    yaxis: {
      range: [-10, 98],
      fixedrange: true,
      zeroline: false,
      showgrid: false,
      showline: false,
      showticklabels: false,
      scaleanchor: 'x',
      scaleratio: 1,
    },
    annotations: [
      // Apex A (Top)
      {
        x: 50,
        y: H + 5.5,
        text: `<b>▲ ${factorA.name} (${factorA.code})</b>`,
        showarrow: false,
        font: { size: 12, color: '#0f172a', family: 'Inter, sans-serif' },
      },
      // Apex B (Bottom-Left)
      {
        x: -4,
        y: -6.5,
        text: `<b>◀ ${factorB.name} (${factorB.code})</b>`,
        showarrow: false,
        font: { size: 12, color: '#0f172a', family: 'Inter, sans-serif' },
      },
      // Apex C (Bottom-Right)
      {
        x: 104,
        y: -6.5,
        text: `<b>▶ ${factorC.name} (${factorC.code})</b>`,
        showarrow: false,
        font: { size: 12, color: '#0f172a', family: 'Inter, sans-serif' },
      },
    ],
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: -0.16,
      font: { size: 10 },
    },
  };

  return { traces: sweetSpotTraces, sweetSpotTraces, layout, constraints, sweetSpotFraction };
}

export { buildTernaryPlotlyData as buildTernaryPlotlyTraces };
