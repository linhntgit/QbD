import type {
  Factor,
  CQA,
  DoERun,
  DesirabilitySolution,
  StatisticalModelResult,
  NeuralNetModelResult,
} from '../types/qbd';
import { formatAxisTitle } from './mathUtils';
import { codedToActual, actualToCoded } from './doeGenerator';

export interface TernaryPoint {
  u: number; // 0..1 (A proportion on normalized simplex)
  v: number; // 0..1 (B proportion on normalized simplex)
  w: number; // 0..1 (C proportion on normalized simplex)
  aPct: number; // 0..100%
  bPct: number; // 0..100%
  cPct: number; // 0..100%
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
    p1: { a: number; b: number; c: number };
    p2: { a: number; b: number; c: number };
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
  p1: { a: number; b: number; c: number };
  p2: { a: number; b: number; c: number };
}

export interface MixtureConstraintsResult {
  lines: MixtureConstraintLine[];
  polygonVertices: { a: number; b: number; c: number }[];
  hasConstraints: boolean;
}

export interface TernaryContourResult {
  meshPoints: TernaryPoint[];
  facets: TernaryFacet[];
  zMin: number;
  zMax: number;
  contourLines: TernaryContourLine[];
  activeFraction: number;
  constraints: MixtureConstraintsResult;
}

/**
 * Color interpolation helper for smooth gradient polygons
 */
const PALETTES: Record<string, [number, number, number][]> = {
  Viridis: [
    [68, 1, 84],
    [72, 35, 116],
    [64, 67, 135],
    [52, 94, 141],
    [41, 120, 142],
    [32, 144, 140],
    [34, 168, 132],
    [68, 190, 112],
    [121, 209, 81],
    [189, 223, 38],
    [253, 231, 37],
  ],
  Plasma: [
    [13, 8, 135],
    [84, 2, 163],
    [139, 10, 165],
    [185, 50, 137],
    [219, 92, 104],
    [244, 136, 73],
    [254, 188, 43],
    [240, 249, 33],
  ],
  Turbo: [
    [48, 18, 59],
    [70, 134, 251],
    [27, 229, 181],
    [164, 252, 60],
    [251, 185, 56],
    [227, 68, 10],
    [122, 4, 3],
  ],
  Jet: [
    [0, 0, 131],
    [0, 60, 170],
    [5, 255, 255],
    [255, 255, 0],
    [250, 0, 0],
    [128, 0, 0],
  ],
  Emerald: [
    [240, 253, 244],
    [187, 247, 208],
    [110, 231, 183],
    [52, 211, 153],
    [16, 185, 129],
    [5, 150, 105],
    [4, 120, 87],
    [6, 78, 59],
  ],
  SweetSpot: [
    [239, 68, 68], // Red (OOS)
    [252, 165, 165], // Light Red
    [254, 240, 138], // Yellow boundary
    [134, 239, 172], // Light Green
    [34, 197, 94], // Deep Green (In-spec)
  ],
};

function getGradientColor(t: number, paletteName: string = 'Viridis'): string {
  const clamped = Math.max(0, Math.min(1, t));
  const palette = PALETTES[paletteName] || PALETTES.Viridis;
  const numStops = palette.length;
  const idx = clamped * (numStops - 1);
  const lower = Math.floor(idx);
  const upper = Math.min(numStops - 1, Math.ceil(idx));
  const frac = idx - lower;

  const c1 = palette[lower];
  const c2 = palette[upper];

  const r = Math.round(c1[0] + frac * (c2[0] - c1[0]));
  const g = Math.round(c1[1] + frac * (c2[1] - c1[1]));
  const b = Math.round(c1[2] + frac * (c2[2] - c1[2]));

  return `rgb(${r},${g},${b})`;
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
    lines.push({
      factorCode: factorA.code,
      factorName: factorA.name,
      type: 'low',
      value: lA,
      label: `Giới hạn dưới ${factorA.code} ≥ ${lA}%`,
      color: '#0f766e',
      dash: 'dash',
      p1: { a: lA, b: 0, c: Number((activeTotal - lA).toFixed(2)) },
      p2: { a: lA, b: Number((activeTotal - lA).toFixed(2)), c: 0 },
    });
  }
  if (uA > 0 && uA < activeTotal) {
    lines.push({
      factorCode: factorA.code,
      factorName: factorA.name,
      type: 'high',
      value: uA,
      label: `Giới hạn trên ${factorA.code} ≤ ${uA}%`,
      color: '#0f766e',
      dash: 'dot',
      p1: { a: uA, b: 0, c: Number((activeTotal - uA).toFixed(2)) },
      p2: { a: uA, b: Number((activeTotal - uA).toFixed(2)), c: 0 },
    });
  }

  // Factor B Lines
  if (lB > 0 && lB < activeTotal) {
    lines.push({
      factorCode: factorB.code,
      factorName: factorB.name,
      type: 'low',
      value: lB,
      label: `Giới hạn dưới ${factorB.code} ≥ ${lB}%`,
      color: '#2563eb',
      dash: 'dash',
      p1: { a: 0, b: lB, c: Number((activeTotal - lB).toFixed(2)) },
      p2: { a: Number((activeTotal - lB).toFixed(2)), b: lB, c: 0 },
    });
  }
  if (uB > 0 && uB < activeTotal) {
    lines.push({
      factorCode: factorB.code,
      factorName: factorB.name,
      type: 'high',
      value: uB,
      label: `Giới hạn trên ${factorB.code} ≤ ${uB}%`,
      color: '#2563eb',
      dash: 'dot',
      p1: { a: 0, b: uB, c: Number((activeTotal - uB).toFixed(2)) },
      p2: { a: Number((activeTotal - uB).toFixed(2)), b: uB, c: 0 },
    });
  }

  // Factor C Lines
  if (lC > 0 && lC < activeTotal) {
    lines.push({
      factorCode: factorC.code,
      factorName: factorC.name,
      type: 'low',
      value: lC,
      label: `Giới hạn dưới ${factorC.code} ≥ ${lC}%`,
      color: '#d97706',
      dash: 'dash',
      p1: { a: 0, b: Number((activeTotal - lC).toFixed(2)), c: lC },
      p2: { a: Number((activeTotal - lC).toFixed(2)), b: 0, c: lC },
    });
  }
  if (uC > 0 && uC < activeTotal) {
    lines.push({
      factorCode: factorC.code,
      factorName: factorC.name,
      type: 'high',
      value: uC,
      label: `Giới hạn trên ${factorC.code} ≤ ${uC}%`,
      color: '#d97706',
      dash: 'dot',
      p1: { a: 0, b: Number((activeTotal - uC).toFixed(2)), c: uC },
      p2: { a: Number((activeTotal - uC).toFixed(2)), b: 0, c: uC },
    });
  }

  // Calculate Experimental Region Polygon Vertices
  const candA = [lA, uA];
  if (lA === 0) candA.push(0);
  const candB = [lB, uB];
  if (lB === 0) candB.push(0);
  const candC = [lC, uC];
  if (lC === 0) candC.push(0);

  const rawPts: { a: number; b: number; c: number }[] = [];

  const testAddPoint = (a: number, b: number, c: number) => {
    const eps = 1e-3;
    if (
      a >= lA - eps &&
      a <= uA + eps &&
      a >= -eps &&
      b >= lB - eps &&
      b <= uB + eps &&
      b >= -eps &&
      c >= lC - eps &&
      c <= uC + eps &&
      c >= -eps &&
      Math.abs(a + b + c - activeTotal) < 0.05
    ) {
      const cleanA = Number(Math.max(0, Math.min(activeTotal, a)).toFixed(2));
      const cleanB = Number(Math.max(0, Math.min(activeTotal, b)).toFixed(2));
      const cleanC = Number(Math.max(0, Math.min(activeTotal, activeTotal - cleanA - cleanB)).toFixed(2));

      const isDup = rawPts.some(
        (p) => Math.abs(p.a - cleanA) < 0.1 && Math.abs(p.b - cleanB) < 0.1 && Math.abs(p.c - cleanC) < 0.1
      );
      if (!isDup) {
        rawPts.push({ a: cleanA, b: cleanB, c: cleanC });
      }
    }
  };

  // Intersect A & B
  for (const a of candA) {
    for (const b of candB) {
      testAddPoint(a, b, activeTotal - a - b);
    }
  }
  // Intersect A & C
  for (const a of candA) {
    for (const c of candC) {
      testAddPoint(a, activeTotal - a - c, c);
    }
  }
  // Intersect B & C
  for (const b of candB) {
    for (const c of candC) {
      testAddPoint(activeTotal - b - c, b, c);
    }
  }

  let polygonVertices: { a: number; b: number; c: number }[] = [];

  if (rawPts.length >= 3) {
    const pts2D = rawPts.map((p) => ({
      ...p,
      x: (0.5 * p.a + p.c) / activeTotal,
      y: (p.a * Math.sqrt(3)) / (2 * activeTotal),
    }));

    const cx = pts2D.reduce((sum, p) => sum + p.x, 0) / pts2D.length;
    const cy = pts2D.reduce((sum, p) => sum + p.y, 0) / pts2D.length;

    pts2D.sort((p1, p2) => {
      const a1 = Math.atan2(p1.y - cy, p1.x - cx);
      const a2 = Math.atan2(p2.y - cy, p2.x - cx);
      return a1 - a2;
    });

    polygonVertices = pts2D.map((p) => ({ a: p.a, b: p.b, c: p.c }));
    if (polygonVertices.length > 0) {
      polygonVertices.push({ ...polygonVertices[0] });
    }
  }

  return { lines, polygonVertices, hasConstraints };
}

/**
 * Generate triangular mesh and extract contour isolines using Marching Triangles
 */
export function generateTernaryContour(
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  allFactors: Factor[],
  fixedFactorsCoded: Record<string, number>,
  model: StatisticalModelResult | NeuralNetModelResult,
  cqa: CQA,
  resolution: number = 140,
  numContourLevels: number = 14
): TernaryContourResult {
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

  const N = Math.max(50, Math.min(200, resolution));
  const gridZ: (number | null)[][] = Array.from({ length: N + 1 }, () =>
    new Array(N + 1).fill(null)
  );
  const gridPts: ({ aPct: number; bPct: number; cPct: number } | null)[][] = Array.from(
    { length: N + 1 },
    () => new Array(N + 1).fill(null)
  );
  const meshPoints: TernaryPoint[] = [];
  const facets: TernaryFacet[] = [];

  let zMin = Infinity;
  let zMax = -Infinity;

  // 1. Calculate values on triangular simplex grid
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N - i; j++) {
      const u = i / N;
      const v = j / N;
      const w = Math.max(0, 1.0 - u - v);

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

      const zPred = model.predict(pointCoded);
      const zVal = Number(zPred.toFixed(3));

      gridZ[i][j] = zVal;
      gridPts[i][j] = { aPct, bPct, cPct };

      if (zVal < zMin) zMin = zVal;
      if (zVal > zMax) zMax = zVal;

      const isInside =
        aPct >= lA - 0.05 &&
        aPct <= uA + 0.05 &&
        bPct >= lB - 0.05 &&
        bPct <= uB + 0.05 &&
        cPct >= lC - 0.05 &&
        cPct <= uC + 0.05;

      meshPoints.push({
        u,
        v,
        w,
        aPct,
        bPct,
        cPct,
        z: zVal,
        isInsideConstraints: isInside,
      });
    }
  }

  if (zMin === Infinity) {
    zMin = 0;
    zMax = 1;
  }
  if (zMin === zMax) {
    zMax = zMin + 1;
  }

  // 2. Generate Facets for Continuous Gradient Color Fill
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      const p00 = gridPts[i][j];
      const p10 = gridPts[i + 1][j];
      const p01 = gridPts[i][j + 1];

      const z00 = gridZ[i][j];
      const z10 = gridZ[i + 1][j];
      const z01 = gridZ[i][j + 1];

      if (p00 && p10 && p01 && z00 !== null && z10 !== null && z01 !== null) {
        facets.push({
          p1: { a: p00.aPct, b: p00.bPct, c: p00.cPct },
          p2: { a: p10.aPct, b: p10.bPct, c: p10.cPct },
          p3: { a: p01.aPct, b: p01.bPct, c: p01.cPct },
          zAvg: (z00 + z10 + z01) / 3,
        });
      }

      if (i + j + 1 < N) {
        const p11 = gridPts[i + 1][j + 1];
        const z11 = gridZ[i + 1][j + 1];
        if (p10 && p11 && p01 && z10 !== null && z11 !== null && z01 !== null) {
          facets.push({
            p1: { a: p10.aPct, b: p10.bPct, c: p10.cPct },
            p2: { a: p11.aPct, b: p11.bPct, c: p11.cPct },
            p3: { a: p01.aPct, b: p01.bPct, c: p01.cPct },
            zAvg: (z10 + z11 + z01) / 3,
          });
        }
      }
    }
  }

  // 3. Determine contour level values
  const levels: { val: number; isSpecLimit?: boolean; specType?: 'LSL' | 'USL' | 'Target' }[] = [];
  const span = zMax - zMin;
  const step = span / (numContourLevels + 1);

  for (let k = 1; k <= numContourLevels; k++) {
    const val = Number((zMin + k * step).toFixed(2));
    levels.push({ val });
  }

  if (cqa.lowerLimit !== undefined && cqa.lowerLimit >= zMin && cqa.lowerLimit <= zMax) {
    levels.push({ val: cqa.lowerLimit, isSpecLimit: true, specType: 'LSL' });
  }
  if (cqa.upperLimit !== undefined && cqa.upperLimit >= zMin && cqa.upperLimit <= zMax) {
    levels.push({ val: cqa.upperLimit, isSpecLimit: true, specType: 'USL' });
  }
  if (cqa.target !== undefined && cqa.target >= zMin && cqa.target <= zMax && cqa.objective === 'target') {
    levels.push({ val: cqa.target, isSpecLimit: true, specType: 'Target' });
  }

  const interpolateEdge = (
    u1: number,
    v1: number,
    w1: number,
    z1: number,
    u2: number,
    v2: number,
    w2: number,
    z2: number,
    zIso: number
  ) => {
    if (Math.abs(z2 - z1) < 1e-12) {
      return {
        a: Number((((u1 + u2) / 2) * activeFraction * 100).toFixed(2)),
        b: Number((((v1 + v2) / 2) * activeFraction * 100).toFixed(2)),
        c: Number((((w1 + w2) / 2) * activeFraction * 100).toFixed(2)),
      };
    }
    const t = (zIso - z1) / (z2 - z1);
    const u = u1 + t * (u2 - u1);
    const v = v1 + t * (v2 - v1);
    const w = Math.max(0, 1.0 - u - v);
    return {
      a: Number((u * activeFraction * 100).toFixed(2)),
      b: Number((v * activeFraction * 100).toFixed(2)),
      c: Number((w * activeFraction * 100).toFixed(2)),
    };
  };

  const processTriangle = (
    uA: number,
    vA: number,
    zA: number,
    uB: number,
    vB: number,
    zB: number,
    uC: number,
    vC: number,
    zC: number,
    zIso: number
  ): { p1: { a: number; b: number; c: number }; p2: { a: number; b: number; c: number } } | null => {
    const wA = Math.max(0, 1.0 - uA - vA);
    const wB = Math.max(0, 1.0 - uB - vB);
    const wC = Math.max(0, 1.0 - uC - vC);

    const pts: { a: number; b: number; c: number }[] = [];

    if ((zA <= zIso && zB >= zIso) || (zB <= zIso && zA >= zIso)) {
      if (zA !== zB) {
        pts.push(interpolateEdge(uA, vA, wA, zA, uB, vB, wB, zB, zIso));
      }
    }
    if ((zB <= zIso && zC >= zIso) || (zC <= zIso && zB >= zIso)) {
      if (zB !== zC) {
        pts.push(interpolateEdge(uB, vB, wB, zB, uC, vC, wC, zC, zIso));
      }
    }
    if ((zC <= zIso && zA >= zIso) || (zA <= zIso && zC >= zIso)) {
      if (zC !== zA) {
        pts.push(interpolateEdge(uC, vC, wC, zC, uA, vA, wA, zA, zIso));
      }
    }

    if (pts.length >= 2) {
      return { p1: pts[0], p2: pts[1] };
    }
    return null;
  };

  const contourLines: TernaryContourLine[] = [];

  levels.forEach((lvl) => {
    const zIso = lvl.val;
    const segments: { p1: { a: number; b: number; c: number }; p2: { a: number; b: number; c: number } }[] = [];

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N - i; j++) {
        const z00 = gridZ[i][j];
        const z10 = gridZ[i + 1][j];
        const z01 = gridZ[i][j + 1];

        if (z00 !== null && z10 !== null && z01 !== null) {
          const seg1 = processTriangle(
            i / N,
            j / N,
            z00,
            (i + 1) / N,
            j / N,
            z10,
            i / N,
            (j + 1) / N,
            z01,
            zIso
          );
          if (seg1) segments.push(seg1);
        }

        if (i + j + 1 < N) {
          const z11 = gridZ[i + 1][j + 1];
          if (z10 !== null && z11 !== null && z01 !== null) {
            const seg2 = processTriangle(
              (i + 1) / N,
              j / N,
              z10,
              (i + 1) / N,
              (j + 1) / N,
              z11,
              i / N,
              (j + 1) / N,
              z01,
              zIso
            );
            if (seg2) segments.push(seg2);
          }
        }
      }
    }

    if (segments.length > 0) {
      contourLines.push({
        level: zIso,
        isSpecLimit: lvl.isSpecLimit,
        specType: lvl.specType,
        segments,
      });
    }
  });

  return {
    meshPoints,
    facets,
    zMin,
    zMax,
    contourLines,
    activeFraction,
    constraints,
  };
}

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
  } = options;

  const traces: any[] = [];
  const { meshPoints, facets, contourLines, constraints, zMin, zMax } = contourResult;

  // 1. Continuous Gradient Color Fill (Smooth Polygon Mesh - NO DOTS!)
  if (displayMode !== 'lines_only' && facets.length > 0) {
    const NUM_COLOR_BINS = 64;
    const span = zMax - zMin > 0 ? zMax - zMin : 1.0;
    const binSize = span / NUM_COLOR_BINS;

    for (let k = 0; k < NUM_COLOR_BINS; k++) {
      const valLow = zMin + k * binSize;
      const valHigh = k === NUM_COLOR_BINS - 1 ? zMax + 0.001 : zMin + (k + 1) * binSize;
      const t = (k + 0.5) / NUM_COLOR_BINS;
      const color = getGradientColor(t, colorScale);

      const matchingFacets = facets.filter((f) => f.zAvg >= valLow && f.zAvg < valHigh);
      if (matchingFacets.length === 0) continue;

      const aPoly: (number | null)[] = [];
      const bPoly: (number | null)[] = [];
      const cPoly: (number | null)[] = [];

      matchingFacets.forEach((f) => {
        aPoly.push(f.p1.a, f.p2.a, f.p3.a, f.p1.a, null);
        bPoly.push(f.p1.b, f.p2.b, f.p3.b, f.p1.b, null);
        cPoly.push(f.p1.c, f.p2.c, f.p3.c, f.p1.c, null);
      });

      traces.push({
        type: 'scatterternary',
        mode: 'lines',
        fill: 'toself',
        fillcolor: color,
        line: { color: color, width: 0.1 },
        a: aPoly,
        b: bPoly,
        c: cPoly,
        hoverinfo: 'skip',
        showlegend: false,
      });
    }

    // Colorbar Dummy Trace (Invisible markers to anchor the official Plotly colorbar)
    traces.push({
      type: 'scatterternary',
      mode: 'markers',
      name: `${cqa.name} (${cqa.code})`,
      a: [0, 0, 100],
      b: [0, 100, 0],
      c: [100, 0, 0],
      hoverinfo: 'skip',
      showlegend: false,
      marker: {
        size: 0.1,
        opacity: 0,
        color: [zMin, (zMin + zMax) / 2, zMax],
        colorscale: colorScale,
        cmin: zMin,
        cmax: zMax,
        colorbar: {
          title: {
            text: `${cqa.name} (${cqa.code})${cqa.unit ? ` [${cqa.unit}]` : ''}`,
            side: 'right',
            font: { size: 11, color: '#1e293b' },
          },
          len: 0.85,
          thickness: 16,
        },
        showscale: true,
      },
    });

    // Invisible Fine-Grid Hover Probing Layer (Zero opacity for smooth tooltips, NO visible circles!)
    const hA = meshPoints.map((p) => p.aPct);
    const hB = meshPoints.map((p) => p.bPct);
    const hC = meshPoints.map((p) => p.cPct);
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
      type: 'scatterternary',
      mode: 'markers',
      name: 'Hover Probe',
      a: hA,
      b: hB,
      c: hC,
      text: hText,
      hoverinfo: 'text',
      marker: {
        size: 9,
        opacity: 0.001, // Completely invisible
        color: '#000000',
      },
      showlegend: false,
    });
  }

  // 2. Crisp Contour Isolines Traces
  if (displayMode !== 'heatmap') {
    const normalLines = contourLines.filter((l) => !l.isSpecLimit);

    if (normalLines.length > 0) {
      normalLines.forEach((cl, idx) => {
        const aSegs: (number | null)[] = [];
        const bSegs: (number | null)[] = [];
        const cSegs: (number | null)[] = [];

        cl.segments.forEach((seg) => {
          aSegs.push(seg.p1.a, seg.p2.a, null);
          bSegs.push(seg.p1.b, seg.p2.b, null);
          cSegs.push(seg.p1.c, seg.p2.c, null);
        });

        traces.push({
          type: 'scatterternary',
          mode: 'lines',
          name: `Mức ${cl.level.toFixed(2)} ${cqa.unit}`,
          a: aSegs,
          b: bSegs,
          c: cSegs,
          line: {
            color: displayMode === 'lines_only' ? '#0f172a' : '#334155',
            width: displayMode === 'lines_only' ? 1.8 : 1.2,
          },
          hoverinfo: 'name',
          showlegend: idx === 0 || normalLines.length <= 6,
        });
      });
    }
  }

  // 3. Special Specification Limit Lines (LSL / USL / Target)
  if (showSpecLimits) {
    const specLines = contourLines.filter((l) => l.isSpecLimit);
    specLines.forEach((sl) => {
      const aSegs: (number | null)[] = [];
      const bSegs: (number | null)[] = [];
      const cSegs: (number | null)[] = [];

      sl.segments.forEach((seg) => {
        aSegs.push(seg.p1.a, seg.p2.a, null);
        bSegs.push(seg.p1.b, seg.p2.b, null);
        cSegs.push(seg.p1.c, seg.p2.c, null);
      });

      const isLSL = sl.specType === 'LSL';
      const isTarget = sl.specType === 'Target';

      const lineColor = isTarget ? '#059669' : isLSL ? '#dc2626' : '#b91c1c';
      const lineDash = isTarget ? 'solid' : 'dash';
      const label = isLSL
        ? `🔴 Giới Hạn Dưới (LSL = ${sl.level} ${cqa.unit})`
        : !isTarget
        ? `🔴 Giới Hạn Trên (USL = ${sl.level} ${cqa.unit})`
        : `🟢 Mục Tiêu (Target = ${sl.level} ${cqa.unit})`;

      traces.push({
        type: 'scatterternary',
        mode: 'lines',
        name: label,
        a: aSegs,
        b: bSegs,
        c: cSegs,
        line: {
          color: lineColor,
          width: 3.2,
          dash: lineDash,
        },
        hoverinfo: 'name',
        showlegend: true,
      });
    });
  }

  // 3. Constraint Boundary Lines (Vạch giới hạn khảo sát của các biến X)
  if (showConstraints && constraints.lines.length > 0) {
    constraints.lines.forEach((cl) => {
      traces.push({
        type: 'scatterternary',
        mode: 'lines',
        name: cl.label,
        a: [cl.p1.a, cl.p2.a],
        b: [cl.p1.b, cl.p2.b],
        c: [cl.p1.c, cl.p2.c],
        line: {
          color: cl.color,
          width: 2.4,
          dash: cl.dash,
        },
        hoverinfo: 'name',
        showlegend: true,
      });
    });
  }

  // 4. Experimental Region Polygon (Khung đa giác miền khảo sát)
  if (showRegionPolygon && constraints.polygonVertices.length >= 3) {
    const polyA = constraints.polygonVertices.map((p) => p.a);
    const polyB = constraints.polygonVertices.map((p) => p.b);
    const polyC = constraints.polygonVertices.map((p) => p.c);

    traces.push({
      type: 'scatterternary',
      mode: 'lines+markers',
      name: `Khung Miền Khảo Sát DoE (${factorA.low}≤${factorA.code}≤${factorA.high}, ...)`,
      a: polyA,
      b: polyB,
      c: polyC,
      line: {
        color: '#c2410c', // Bright Rust/Terracotta
        width: 3.2,
      },
      marker: {
        size: 7,
        color: '#c2410c',
        symbol: 'circle',
      },
      hoverinfo: 'name',
      showlegend: true,
    });
  }

  // 5. DoE Experimental Runs Trace
  if (showDoERuns && doeRuns.length > 0) {
    const runA: number[] = [];
    const runB: number[] = [];
    const runC: number[] = [];
    const runLabels: string[] = [];
    const runHovers: string[] = [];

    doeRuns.forEach((r, idx) => {
      const actA = typeof r.factorActual[factorA.code] === 'number' ? (r.factorActual[factorA.code] as number) : parseFloat(String(r.factorActual[factorA.code])) || 0;
      const actB = typeof r.factorActual[factorB.code] === 'number' ? (r.factorActual[factorB.code] as number) : parseFloat(String(r.factorActual[factorB.code])) || 0;
      const actC = typeof r.factorActual[factorC.code] === 'number' ? (r.factorActual[factorC.code] as number) : parseFloat(String(r.factorActual[factorC.code])) || 0;

      const sum = actA + actB + actC;
      if (sum > 0) {
        runA.push(Number(actA.toFixed(1)));
        runB.push(Number(actB.toFixed(1)));
        runC.push(Number(actC.toFixed(1)));
        runLabels.push(`R${r.runOrder || idx + 1}`);

        const respVal = r.responses[cqa.code];
        runHovers.push(
          `<b>Thí nghiệm ${r.runOrder || idx + 1} (DoE Run)</b><br>` +
          `${factorA.name}: ${actA}%<br>` +
          `${factorB.name}: ${actB}%<br>` +
          `${factorC.name}: ${actC}%<br>` +
          `<b>Kết quả thực nghiệm ${cqa.code}: ${respVal ?? 'N/A'} ${cqa.unit}</b>`
        );
      }
    });

    if (runA.length > 0) {
      traces.push({
        type: 'scatterternary',
        mode: 'markers+text',
        name: 'Điểm DoE Thực Nghiệm (◆)',
        a: runA,
        b: runB,
        c: runC,
        text: runLabels,
        textposition: 'top center',
        textfont: { family: 'Inter', size: 10, color: '#0f172a', weight: 700 },
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

  // 6. Optimum Point Trace
  if (showOptimum && optimum) {
    const rawA = optimum.actualFactors[factorA.code];
    const rawB = optimum.actualFactors[factorB.code];
    const rawC = optimum.actualFactors[factorC.code];

    const optA = typeof rawA === 'number' ? rawA : parseFloat(String(rawA)) || 0;
    const optB = typeof rawB === 'number' ? rawB : parseFloat(String(rawB)) || 0;
    const optC = typeof rawC === 'number' ? rawC : parseFloat(String(rawC)) || 0;

    const optPred = optimum.predictedResponses[cqa.code];

    traces.push({
      type: 'scatterternary',
      mode: 'markers+text',
      name: '★ Điểm Tối Ưu (Optimum)',
      a: [optA],
      b: [optB],
      c: [optC],
      text: ['★ TỐI ƯU'],
      textposition: 'bottom center',
      textfont: { family: 'Inter', size: 11, color: '#b45309', weight: 700 },
      hoverinfo: 'text',
      hovertext: [
        `<b>★ ĐIỂM TỐI ƯU DESIRABILITY (D = ${(optimum.overallDesirability * 100).toFixed(1)}%)</b><br>` +
        `${factorA.name}: ${optA}%<br>` +
        `${factorB.name}: ${optB}%<br>` +
        `${factorC.name}: ${optC}%<br>` +
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

  // Build Layout
  const layout = {
    title: {
      text: `Biểu Đồ Contour Tam Giác Hỗn Hợp: ${cqa.name} (${cqa.code})${cqa.unit ? ` [${cqa.unit}]` : ''}`,
      font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' },
    },
    autosize: true,
    margin: { l: 65, r: 65, b: 65, t: 55, pad: 4 },
    ternary: {
      sum: 100,
      aaxis: {
        title: {
          text: formatAxisTitle(factorA.name, factorA.code, factorA.unit || '%'),
          font: { size: 12, color: '#0f172a' },
        },
        min: 0.01,
        linewidth: 2,
        ticks: 'outside',
        ticklen: 5,
        gridcolor: '#e2e8f0',
        linecolor: '#475569',
      },
      baxis: {
        title: {
          text: formatAxisTitle(factorB.name, factorB.code, factorB.unit || '%'),
          font: { size: 12, color: '#0f172a' },
        },
        min: 0.01,
        linewidth: 2,
        ticks: 'outside',
        ticklen: 5,
        gridcolor: '#e2e8f0',
        linecolor: '#475569',
      },
      caxis: {
        title: {
          text: formatAxisTitle(factorC.name, factorC.code, factorC.unit || '%'),
          font: { size: 12, color: '#0f172a' },
        },
        min: 0.01,
        linewidth: 2,
        ticks: 'outside',
        ticklen: 5,
        gridcolor: '#e2e8f0',
        linecolor: '#475569',
      },
    },
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
 * Uses ULTRA-SMOOTH GRADIENT POLYGON MESH (N=85, 36 Color Bins) & MARCHING TRIANGLES EXACT BOUNDARY
 */
export function generateTernaryDesignSpace(
  factorA: Factor,
  factorB: Factor,
  factorC: Factor,
  allFactors: Factor[],
  fixedFactorsCoded: Record<string, number>,
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>,
  cqas: CQA[],
  resolution: number = 140
) {
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

  const N = Math.max(50, Math.min(180, resolution));

  const validCQAs = cqas.filter((c) => models[c.code]);
  const gridPts: ({ aPct: number; bPct: number; cPct: number } | null)[][] = Array.from(
    { length: N + 1 },
    () => new Array(N + 1).fill(null)
  );
  const gridMargin: (number | null)[][] = Array.from({ length: N + 1 }, () =>
    new Array(N + 1).fill(null)
  );

  const hoverA: number[] = [];
  const hoverB: number[] = [];
  const hoverC: number[] = [];
  const hoverText: string[] = [];
  const dsFacets: { p1: any; p2: any; p3: any; marginAvg: number }[] = [];

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N - i; j++) {
      const u = i / N;
      const v = j / N;
      const w = Math.max(0, 1.0 - u - v);

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
        let cqaMargin = 1.0;

        const L = cqa.lowerLimit;
        const U = cqa.upperLimit;
        const T = cqa.target;

        if (L !== undefined && U !== undefined) {
          const range = U - L;
          const denom = range > 0 ? range : 1.0;
          const mL = (yPred - L) / denom;
          const mU = (U - yPred) / denom;
          cqaMargin = Math.min(mL, mU);
        } else if (L !== undefined) {
          const denom = T !== undefined && T > L ? T - L : Math.abs(L) > 0 ? Math.abs(L) * 0.2 : 1.0;
          cqaMargin = (yPred - L) / denom;
        } else if (U !== undefined) {
          const denom = T !== undefined && U > T ? U - T : Math.abs(U) > 0 ? Math.abs(U) * 0.2 : 1.0;
          cqaMargin = (U - yPred) / denom;
        } else if (cqa.objective === 'target' && T !== undefined) {
          const tol = Math.abs(T) > 0 ? Math.abs(T) * 0.1 : 1.0;
          cqaMargin = 1.0 - Math.abs(yPred - T) / tol;
        }

        if (cqaMargin < minMargin) {
          minMargin = cqaMargin;
          worstCQA = cqa.name;
          worstPred = yPred;
        }
      }

      gridPts[i][j] = { aPct, bPct, cPct };
      gridMargin[i][j] = Number(minMargin.toFixed(4));

      hoverA.push(aPct);
      hoverB.push(bPct);
      hoverC.push(cPct);

      const isInside =
        aPct >= lA - 0.05 &&
        aPct <= uA + 0.05 &&
        bPct >= lB - 0.05 &&
        bPct <= uB + 0.05 &&
        cPct >= lC - 0.05 &&
        cPct <= uC + 0.05;

      const isPass = minMargin >= 0;
      hoverText.push(
        `<b>${factorA.name}</b>: ${aPct}%<br>` +
        `<b>${factorB.name}</b>: ${bPct}%<br>` +
        `<b>${factorC.name}</b>: ${cPct}%<br>` +
        `-------------------------<br>` +
        `Miền khảo sát: <b>${isInside ? '✓ Trong giới hạn DoE' : '⚠ Ngoài khoảng khảo sát'}</b><br>` +
        `Trạng thái: <b>${isPass ? '🟩 ĐẠT VÙNG THIẾT KẾ (DESIGN SPACE)' : '🟥 NGOÀI TIÊU CHUẨN (OOS)'}</b><br>` +
        `Biên an toàn (Margin): ${minMargin >= 0 ? '+' : ''}${(minMargin * 100).toFixed(1)}%<br>` +
        `Chỉ tiêu hạn chế nhất: ${worstCQA} (Dự đoán: ${worstPred.toFixed(2)})`
      );
    }
  }

  // Create Sweet Spot Micro-Facets
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      const p00 = gridPts[i][j];
      const p10 = gridPts[i + 1][j];
      const p01 = gridPts[i][j + 1];

      const m00 = gridMargin[i][j];
      const m10 = gridMargin[i + 1][j];
      const m01 = gridMargin[i][j + 1];

      if (p00 && p10 && p01 && m00 !== null && m10 !== null && m01 !== null) {
        dsFacets.push({
          p1: p00,
          p2: p10,
          p3: p01,
          marginAvg: (m00 + m10 + m01) / 3,
        });
      }

      if (i + j + 1 < N) {
        const p11 = gridPts[i + 1][j + 1];
        const m11 = gridMargin[i + 1][j + 1];
        if (p10 && p11 && p01 && m10 !== null && m11 !== null && m01 !== null) {
          dsFacets.push({
            p1: p10,
            p2: p11,
            p3: p01,
            marginAvg: (m10 + m11 + m01) / 3,
          });
        }
      }
    }
  }

  // Smooth RGB interpolation function for continuous sweet spot gradient
  function getSweetSpotColor(margin: number): string {
    if (margin < 0) {
      // Out of spec: -0.30 to 0.0
      // Interpolate from deep crimson [239, 68, 68] -> coral [248, 113, 113] -> soft salmon [252, 165, 165] -> warm peach [254, 215, 170]
      const t = Math.max(0, Math.min(1, (margin + 0.30) / 0.30));
      const r = Math.round(239 + (254 - 239) * t);
      const g = Math.round(68 + (215 - 68) * t);
      const b = Math.round(68 + (170 - 68) * t);
      return `rgb(${r},${g},${b})`;
    } else {
      // In design space: 0.0 to +0.30
      // Interpolate from soft mint [187, 247, 208] -> emerald [74, 222, 128] -> vibrant green [34, 197, 94] -> deep forest green [21, 128, 61]
      const t = Math.max(0, Math.min(1, margin / 0.30));
      const r = Math.round(187 + (21 - 187) * t);
      const g = Math.round(247 + (128 - 247) * t);
      const b = Math.round(208 + (61 - 208) * t);
      return `rgb(${r},${g},${b})`;
    }
  }

  // Build Plotly Traces for 64-Bin Continuous Sweet Spot Gradient (NO VISIBLE PIXELS/TEETH)
  const sweetSpotTraces: any[] = [];
  const NUM_BINS = 64;
  const MARGIN_MIN = -0.30;
  const MARGIN_MAX = 0.30;
  const binStep = (MARGIN_MAX - MARGIN_MIN) / NUM_BINS;

  for (let k = 0; k < NUM_BINS; k++) {
    const minVal = k === 0 ? -999 : MARGIN_MIN + k * binStep;
    const maxVal = k === NUM_BINS - 1 ? 999 : MARGIN_MIN + (k + 1) * binStep;
    const midVal = MARGIN_MIN + (k + 0.5) * binStep;
    const color = getSweetSpotColor(midVal);

    const matching = dsFacets.filter((f) => f.marginAvg >= minVal && f.marginAvg < maxVal);
    if (matching.length === 0) continue;

    const aP: (number | null)[] = [];
    const bP: (number | null)[] = [];
    const cP: (number | null)[] = [];

    matching.forEach((f) => {
      aP.push(f.p1.aPct, f.p2.aPct, f.p3.aPct, f.p1.aPct, null);
      bP.push(f.p1.bPct, f.p2.bPct, f.p3.bPct, f.p1.bPct, null);
      cP.push(f.p1.cPct, f.p2.cPct, f.p3.cPct, f.p1.cPct, null);
    });

    sweetSpotTraces.push({
      type: 'scatterternary',
      mode: 'lines',
      fill: 'toself',
      fillcolor: color,
      line: { color: color, width: 0.08 },
      a: aP,
      b: bP,
      c: cP,
      hoverinfo: 'skip',
      showlegend: false,
    });
  }

  // Extract Exact Sub-Triangle Vector Boundary Line for Margin = 0.0 (Marching Triangles)
  const interpolateMarginEdge = (
    u1: number,
    v1: number,
    m1: number,
    u2: number,
    v2: number,
    m2: number,
    mIso: number
  ) => {
    if (Math.abs(m2 - m1) < 1e-12) {
      return {
        a: Number((((u1 + u2) / 2) * activeFraction * 100).toFixed(2)),
        b: Number((((v1 + v2) / 2) * activeFraction * 100).toFixed(2)),
        c: Number(((1.0 - (u1 + u2) / 2 - (v1 + v2) / 2) * activeFraction * 100).toFixed(2)),
      };
    }
    const t = (mIso - m1) / (m2 - m1);
    const u = u1 + t * (u2 - u1);
    const v = v1 + t * (v2 - v1);
    const w = Math.max(0, 1.0 - u - v);
    return {
      a: Number((u * activeFraction * 100).toFixed(2)),
      b: Number((v * activeFraction * 100).toFixed(2)),
      c: Number((w * activeFraction * 100).toFixed(2)),
    };
  };

  const processMarginTriangle = (
    uA: number, vA: number, mA: number,
    uB: number, vB: number, mB: number,
    uC: number, vC: number, mC: number,
    mIso: number
  ): { p1: { a: number; b: number; c: number }; p2: { a: number; b: number; c: number } } | null => {
    const pts: { a: number; b: number; c: number }[] = [];
    if ((mA <= mIso && mB >= mIso) || (mB <= mIso && mA >= mIso)) {
      if (mA !== mB) pts.push(interpolateMarginEdge(uA, vA, mA, uB, vB, mB, mIso));
    }
    if ((mB <= mIso && mC >= mIso) || (mC <= mIso && mB >= mIso)) {
      if (mB !== mC) pts.push(interpolateMarginEdge(uB, vB, mB, uC, vC, mC, mIso));
    }
    if ((mC <= mIso && mA >= mIso) || (mA <= mIso && mC >= mIso)) {
      if (mC !== mA) pts.push(interpolateMarginEdge(uC, vC, mC, uA, vA, mA, mIso));
    }
    if (pts.length >= 2) return { p1: pts[0], p2: pts[1] };
    return null;
  };

  const boundarySegments: { p1: { a: number; b: number; c: number }; p2: { a: number; b: number; c: number } }[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - i; j++) {
      const m00 = gridMargin[i][j];
      const m10 = gridMargin[i + 1][j];
      const m01 = gridMargin[i][j + 1];

      if (m00 !== null && m10 !== null && m01 !== null) {
        const seg1 = processMarginTriangle(
          i / N, j / N, m00,
          (i + 1) / N, j / N, m10,
          i / N, (j + 1) / N, m01,
          0.0
        );
        if (seg1) boundarySegments.push(seg1);
      }

      if (i + j + 1 < N) {
        const m11 = gridMargin[i + 1][j + 1];
        if (m10 !== null && m11 !== null && m01 !== null) {
          const seg2 = processMarginTriangle(
            (i + 1) / N, j / N, m10,
            (i + 1) / N, (j + 1) / N, m11,
            i / N, (j + 1) / N, m01,
            0.0
          );
          if (seg2) boundarySegments.push(seg2);
        }
      }
    }
  }

  if (boundarySegments.length > 0) {
    const boundA: (number | null)[] = [];
    const boundB: (number | null)[] = [];
    const boundC: (number | null)[] = [];

    boundarySegments.forEach((seg) => {
      boundA.push(seg.p1.a, seg.p2.a, null);
      boundB.push(seg.p1.b, seg.p2.b, null);
      boundC.push(seg.p1.c, seg.p2.c, null);
    });

    sweetSpotTraces.push({
      type: 'scatterternary',
      mode: 'lines',
      name: 'Ranh Giới Vùng Thiết Kế (Design Space Margin = 0)',
      a: boundA,
      b: boundB,
      c: boundC,
      line: {
        color: '#15803d',
        width: 2.6,
      },
      hoverinfo: 'name',
      showlegend: true,
    });
  }

  // Legend Guide Indicators
  sweetSpotTraces.push({
    type: 'scatterternary',
    mode: 'lines',
    name: 'Vùng Đạt Chuẩn 100% CQAs (Design Space)',
    a: [null],
    b: [null],
    c: [null],
    line: { color: '#22c55e', width: 4 },
    showlegend: true,
  });
  sweetSpotTraces.push({
    type: 'scatterternary',
    mode: 'lines',
    name: 'Vùng Ngoài Tiêu Chuẩn (OOS)',
    a: [null],
    b: [null],
    c: [null],
    line: { color: '#f87171', width: 4 },
    showlegend: true,
  });

  // Invisible hover probe (Zero opacity for smooth tooltips)
  sweetSpotTraces.push({
    type: 'scatterternary',
    mode: 'markers',
    name: 'Sweet Spot Hover',
    a: hoverA,
    b: hoverB,
    c: hoverC,
    text: hoverText,
    hoverinfo: 'text',
    marker: {
      size: 8,
      opacity: 0.001, // Invisible
      color: '#000000',
    },
    showlegend: false,
  });

  return { sweetSpotTraces, constraints };
}

export { buildTernaryPlotlyData as buildTernaryPlotlyTraces };
