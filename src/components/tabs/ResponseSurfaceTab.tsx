import React, { useState, useMemo, useEffect } from 'react';
import {
  Compass,
  Sliders,
  Layers,
  ArrowRight,
  Calculator,
  BrainCircuit,
  Sparkles,
  FlaskConical,
  Target,
  Eye,
  RotateCcw,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetModelResult,
  ModelingEngine,
  Factor,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { codedToActual, actualToCoded, getConfiguredFactorCodes, getConfiguredFactorLevels, getFactorGridCodes, isDiscreteFactor } from '../../services/doeGenerator';
import { formatAxisTitle, extract2DContourSegments, calculateCQAMargin } from '../../services/mathUtils';
import { optimizeDesirability } from '../../services/statistics';
import { generateTernaryContour, buildTernaryPlotlyData, getEvenContourSettings } from '../../services/ternaryContour';

interface ResponseSurfaceTabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>;
  selectedCQA: string;
  onSelectCQA: (cqaCode: string) => void;
  modelingEngine?: ModelingEngine;
  onToggleEngine?: (engine: ModelingEngine) => void;
  onNavigateToDesignSpace: () => void;
}

export const ResponseSurfaceTab: React.FC<ResponseSurfaceTabProps> = ({
  project,
  models,
  selectedCQA,
  onSelectCQA,
  modelingEngine = 'polynomial',
  onToggleEngine,
  onNavigateToDesignSpace,
}) => {
  const factors = project.factors;
  const currentCQA = project.cqas.find((c) => c.code === selectedCQA) || project.cqas[0];
  const model = currentCQA ? models[currentCQA.code] : null;

  // Mixture factors filter
  const mixtureFactors = useMemo(() => {
    return factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  }, [factors]);

  const hasMixture = mixtureFactors.length >= 3;

  // Plot Type: 3D Surface | 2D Contour | Ternary (3-component Mixture)
  const [plotType, setPlotType] = useState<'3d' | 'contour' | 'ternary'>(() =>
    hasMixture ? 'ternary' : '3d'
  );

  // Cartesian grids vary their axes independently.  For mixture projects this
  // leaves the simplex, so only the ternary representation is permitted.
  useEffect(() => {
    if (hasMixture && plotType !== 'ternary') {
      setPlotType('ternary');
    } else if (!hasMixture && plotType === 'ternary') {
      setPlotType('3d');
    }
  }, [project.id, hasMixture, plotType]);

  // Selected Axis Factors for 2D / 3D Cartesian
  const [xAxisFactor, setXAxisFactor] = useState<string>(factors[0]?.code || 'X1');
  const [yAxisFactor, setYAxisFactor] = useState<string>(factors[1]?.code || 'X2');

  // Selected Vertices for 3-Component Mixture Triangle
  const [ternaryA, setTernaryA] = useState<string>(() => mixtureFactors[0]?.code || factors[0]?.code || 'X1');
  const [ternaryB, setTernaryB] = useState<string>(() => mixtureFactors[1]?.code || factors[1]?.code || 'X2');
  const [ternaryC, setTernaryC] = useState<string>(() => mixtureFactors[2]?.code || factors[2]?.code || 'X3');

  // Sync ternary factors when project or factors change
  useEffect(() => {
    if (mixtureFactors.length >= 3) {
      setTernaryA(mixtureFactors[0].code);
      setTernaryB(mixtureFactors[1].code);
      setTernaryC(mixtureFactors[2].code);
    }
  }, [project.id, factors, mixtureFactors]);

  // Ternary Contour Options
  const [ternaryDisplayMode, setTernaryDisplayMode] = useState<'both' | 'lines_only' | 'heatmap'>('both');
  const [ternaryLevels, setTernaryLevels] = useState<number>(12);
  const [contourLineWidth, setContourLineWidth] = useState<number>(1.5);
  const [showContourLabels, setShowContourLabels] = useState<boolean>(true);
  const [showDoERuns, setShowDoERuns] = useState<boolean>(true);
  const [showOptimum, setShowOptimum] = useState<boolean>(true);
  const [showConstraints, setShowConstraints] = useState<boolean>(true);
  const [showRegionPolygon, setShowRegionPolygon] = useState<boolean>(true);
  const [showSpecLimits, setShowSpecLimits] = useState<boolean>(true);
  const [ternaryResolution, setTernaryResolution] = useState<number>(180);
  const [ternarySmoothness, setTernarySmoothness] = useState<number>(1.0);

  // Color Scale
  const [colorScale, setColorScale] = useState<string>('Viridis');

  // Optimum from Desirability
  const optimum = useMemo(() => {
    if (Object.keys(models).length === 0) return null;
    return optimizeDesirability(project.factors, project.cqas, models);
  }, [project.factors, project.cqas, models]);

  // Fixed factors values (coded in [-1, 1] or proportion for mixture)
  const [fixedFactorCoded, setFixedFactorCoded] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    factors.forEach((f) => {
      init[f.code] = 0; // default at center point
    });
    return init;
  });

  // Active factors for 2D/3D
  const factorX = factors.find((f) => f.code === xAxisFactor) || factors[0];
  const factorY = factors.find((f) => f.code === yAxisFactor) || factors[1];

  // Active factors for Ternary
  const factorA = factors.find((f) => f.code === ternaryA) || mixtureFactors[0] || factors[0];
  const factorB = factors.find((f) => f.code === ternaryB) || mixtureFactors[1] || factors[1];
  const factorC = factors.find((f) => f.code === ternaryC) || mixtureFactors[2] || factors[2];

  // Helper to handle fixed factor changes via actual physical number input
  const handleActualValueChange = (factor: Factor, newActual: number) => {
    const clampedActual = Math.max(factor.low, Math.min(factor.high, newActual));
    const newCoded = actualToCoded(clampedActual, factor);
    setFixedFactorCoded((prev) => ({
      ...prev,
      [factor.code]: newCoded,
    }));
  };

  // Helper to handle fixed factor changes via slider (coded value)
  const handleCodedValueChange = (factorCode: string, newCoded: number) => {
    setFixedFactorCoded((prev) => ({
      ...prev,
      [factorCode]: newCoded,
    }));
  };

  // Helper to set all fixed factors to Optimum
  const handleSetAllToOptimum = () => {
    if (!optimum) return;
    const updated: Record<string, number> = { ...fixedFactorCoded };
    factors.forEach((f) => {
      if (optimum.codedFactors[f.code] !== undefined) {
        updated[f.code] = optimum.codedFactors[f.code];
      }
    });
    setFixedFactorCoded(updated);
  };

  // Helper to reset fixed factors to center (0)
  const handleResetToCenter = () => {
    const updated: Record<string, number> = {};
    factors.forEach((f) => {
      updated[f.code] = 0;
    });
    setFixedFactorCoded(updated);
  };

  // Grid calculation for 3D Surface & 2D Cartesian Contour
  const surfaceGrid = useMemo(() => {
    if (hasMixture || !model || !factorX || !factorY) return null;

    const xCodedArr = getFactorGridCodes(factorX, 35);
    const yCodedArr = getFactorGridCodes(factorY, 35);
    const xActualArr: number[] = [];
    const yActualArr: number[] = [];
    const xDisplayArr: Array<number | string> = [];
    const yDisplayArr: Array<number | string> = [];

    xCodedArr.forEach((coded, index) => {
      const actual = codedToActual(coded, factorX);
      xDisplayArr.push(actual);
      xActualArr.push(typeof actual === 'number' ? actual : index);
    });
    yCodedArr.forEach((coded, index) => {
      const actual = codedToActual(coded, factorY);
      yDisplayArr.push(actual);
      yActualArr.push(typeof actual === 'number' ? actual : index);
    });

    const zGrid: number[][] = [];
    const hoverX: Array<number | string> = [];
    const hoverY: Array<number | string> = [];
    const hoverText: string[] = [];

    for (let j = 0; j < yCodedArr.length; j++) {
      const row: number[] = [];
      const yCoded = yCodedArr[j];
      const yAct = yDisplayArr[j];

      for (let i = 0; i < xCodedArr.length; i++) {
        const xCoded = xCodedArr[i];
        const xAct = xDisplayArr[i];
        const pointCoded: Record<string, number> = { ...fixedFactorCoded };
        pointCoded[factorX.code] = xCoded;
        pointCoded[factorY.code] = yCoded;

        const pred = model.predict(pointCoded);
        // Preserve raw predictions in the surface grid.  Formatting is applied
        // only in hover text so low-range CQAs are not rendered as terraces.
        row.push(pred);

        const cqaMargin = calculateCQAMargin(
          pred,
          currentCQA.objective,
          currentCQA.lowerLimit,
          currentCQA.upperLimit,
          currentCQA.target
        );
        const isPass = cqaMargin >= 0;

        hoverX.push(xAct);
        hoverY.push(yAct);

        const statusBadge = isPass
          ? `<span style="color:#16a34a;font-weight:700">✓ ĐẠT TIÊU CHUẨN (${currentCQA.lowerLimit !== undefined ? `>= ${currentCQA.lowerLimit}` : ''}${currentCQA.lowerLimit !== undefined && currentCQA.upperLimit !== undefined ? ', ' : ''}${currentCQA.upperLimit !== undefined ? `<= ${currentCQA.upperLimit}` : ''} ${currentCQA.unit || ''})</span>`
          : `<span style="color:#dc2626;font-weight:700">⚠ NGOÀI TIÊU CHUẨN (Không đạt tiêu chuẩn ${currentCQA.code})</span>`;

        hoverText.push(
          `<b>${factorX.name} (${factorX.code})</b>: ${typeof xAct === 'number' ? xAct.toFixed(2) : xAct} ${factorX.unit || ''}<br>` +
          `<b>${factorY.name} (${factorY.code})</b>: ${typeof yAct === 'number' ? yAct.toFixed(2) : yAct} ${factorY.unit || ''}<br>` +
          `-------------------------<br>` +
          `${statusBadge}<br>` +
          `<span style="color:#0f766e;font-weight:700">Dự đoán ${currentCQA.name} (${currentCQA.code}): ${pred.toFixed(3)} ${currentCQA.unit || ''}</span>`
        );
      }
      zGrid.push(row);
    }

    return {
      xActualArr,
      yActualArr,
      zGrid,
      hoverX,
      hoverY,
      hoverText,
      xDisplayArr,
      yDisplayArr,
    };
  }, [hasMixture, model, factorX, factorY, fixedFactorCoded, currentCQA]);

  // Ternary Mesh & Contour Calculation
  const ternaryResult = useMemo(() => {
    if (plotType !== 'ternary' || !model || !factorA || !factorB || !factorC || !currentCQA) {
      return null;
    }

    return generateTernaryContour(
      factorA,
      factorB,
      factorC,
      factors,
      fixedFactorCoded,
      model,
      currentCQA,
      ternaryResolution,
      ternaryLevels
    );
  }, [
    plotType,
    model,
    factorA,
    factorB,
    factorC,
    factors,
    fixedFactorCoded,
    currentCQA,
    ternaryResolution,
    ternaryLevels,
  ]);

  if (!model) {
    return (
      <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p>Vui lòng tạo mô hình ANOVA hoặc Mạng Nơ-ron trước khi xem mặt đáp.</p>
      </div>
    );
  }

  // Generate Plotly Data & Layout
  let plotlyData: any[] = [];
  let plotlyLayout: any = {};

  if (plotType === 'ternary' && ternaryResult && factorA && factorB && factorC && currentCQA) {
    const ternaryPlotly = buildTernaryPlotlyData(
      ternaryResult,
      factorA,
      factorB,
      factorC,
      currentCQA,
      {
        colorScale,
        displayMode: ternaryDisplayMode,
        showDoERuns,
        doeRuns: project.runs,
        showOptimum,
        optimum,
        showConstraints,
        showRegionPolygon,
        showSpecLimits,
        ternaryLevels,
        smoothness: ternarySmoothness,
        contourLineWidth,
        showContourLabels,
      }
    );
    plotlyData = ternaryPlotly.traces;
    plotlyLayout = ternaryPlotly.layout;
  } else if (surfaceGrid && factorX && factorY && currentCQA) {
    const traces: any[] = [];

    if (plotType === '3d') {
      traces.push({
        type: 'surface',
        x: surfaceGrid.xActualArr,
        y: surfaceGrid.yActualArr,
        z: surfaceGrid.zGrid,
        colorscale: colorScale,
        colorbar: {
          title: {
            text: `${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
            side: 'right',
            font: { size: 11, color: '#1e293b' },
          },
          len: 0.85,
          thickness: 18,
        },
        contours: {
          z: {
            show: true,
            usecolormap: true,
            highlightcolor: '#ffffff',
            project: { z: true },
          },
        },
        line: { width: contourLineWidth },
        hoverinfo: 'x+y+z',
      });

      // 3D Spec Limit Horizontal Planes & Intersection Curves
      if (showSpecLimits && !isDiscreteFactor(factorX) && !isDiscreteFactor(factorY)) {
        const xMin = surfaceGrid.xActualArr[0];
        const xMax = surfaceGrid.xActualArr[surfaceGrid.xActualArr.length - 1];
        const yMin = surfaceGrid.yActualArr[0];
        const yMax = surfaceGrid.yActualArr[surfaceGrid.yActualArr.length - 1];

        // LSL Plane & Curve
        if (currentCQA.lowerLimit !== undefined) {
          const LSL = currentCQA.lowerLimit;
          traces.push({
            type: 'surface',
            name: `🔴 Giới Hạn Dưới (LSL = ${LSL} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [LSL, LSL],
              [LSL, LSL],
            ],
            opacity: 0.35,
            showscale: false,
            colorscale: [
              [0, 'rgba(239, 68, 68, 0.45)'],
              [1, 'rgba(239, 68, 68, 0.45)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });

          const lslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            LSL
          );
          if (lslSegs.length > 0) {
            traces.push({
              type: 'scatter3d',
              mode: 'lines',
              name: `🔴 Đường Cắt LSL = ${LSL} ${currentCQA.unit || ''}`,
              x: lslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: lslSegs.flatMap((s) => [s.y1, s.y2, null]),
              z: lslSegs.flatMap(() => [LSL, LSL, null]),
              line: { color: '#dc2626', width: 6 },
              hoverinfo: 'name',
              showlegend: false,
            });
          }
        }

        // USL Plane & Curve
        if (currentCQA.upperLimit !== undefined) {
          const USL = currentCQA.upperLimit;
          traces.push({
            type: 'surface',
            name: `🔴 Giới Hạn Trên (USL = ${USL} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [USL, USL],
              [USL, USL],
            ],
            opacity: 0.35,
            showscale: false,
            colorscale: [
              [0, 'rgba(185, 28, 28, 0.45)'],
              [1, 'rgba(185, 28, 28, 0.45)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });

          const uslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            USL
          );
          if (uslSegs.length > 0) {
            traces.push({
              type: 'scatter3d',
              mode: 'lines',
              name: `🔴 Đường Cắt USL = ${USL} ${currentCQA.unit || ''}`,
              x: uslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: uslSegs.flatMap((s) => [s.y1, s.y2, null]),
              z: uslSegs.flatMap(() => [USL, USL, null]),
              line: { color: '#b91c1c', width: 6 },
              hoverinfo: 'name',
              showlegend: false,
            });
          }
        }

        // Target Plane
        if (currentCQA.target !== undefined) {
          const T = currentCQA.target;
          traces.push({
            type: 'surface',
            name: `🟢 Mục Tiêu (Target = ${T} ${currentCQA.unit || ''})`,
            x: [xMin, xMax],
            y: [yMin, yMax],
            z: [
              [T, T],
              [T, T],
            ],
            opacity: 0.25,
            showscale: false,
            colorscale: [
              [0, 'rgba(5, 150, 105, 0.35)'],
              [1, 'rgba(5, 150, 105, 0.35)'],
            ],
            hoverinfo: 'name',
            showlegend: true,
          });
        }
      }
    } else {
      // 2D Contour
      const zValues = surfaceGrid.zGrid.flat().filter(Number.isFinite);
      const evenContours = getEvenContourSettings(Math.min(...zValues), Math.max(...zValues), ternaryLevels);
      traces.push({
        type: isDiscreteFactor(factorX) || isDiscreteFactor(factorY) ? 'heatmap' : 'contour',
        x: surfaceGrid.xActualArr,
        y: surfaceGrid.yActualArr,
        z: surfaceGrid.zGrid,
        colorscale: colorScale,
        autocontour: !evenContours,
        ncontours: ternaryLevels,
        colorbar: {
          title: {
            text: `${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
            side: 'right',
            font: { size: 11, color: '#1e293b' },
          },
          len: 0.85,
          thickness: 18,
        },
        contours: {
          coloring: 'heatmap',
          showlabels: showContourLabels,
          labelfont: { family: 'Inter', size: 12, color: 'white' },
          ...evenContours,
        },
        line: { width: contourLineWidth, color: '#334155' },
        hoverinfo: 'none',
      });

      // 2D Fine Hover Probing Layer
      if (surfaceGrid.hoverX && surfaceGrid.hoverX.length > 0) {
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: 'Hover Probe',
          x: surfaceGrid.hoverX,
          y: surfaceGrid.hoverY,
          text: surfaceGrid.hoverText,
          hoverinfo: 'text',
          marker: {
            size: 10,
            opacity: 0.001,
            color: '#000000',
          },
          showlegend: false,
        });
      }

      // 2D Spec Limit Isolines
      if (showSpecLimits && !isDiscreteFactor(factorX) && !isDiscreteFactor(factorY)) {
        const addSpecLabel = (
          segments: Array<{ x1: number; x2: number; y1: number; y2: number }>,
          text: string,
          color: string
        ) => {
          const segment = segments.reduce((longest, candidate) => {
            const candidateLength = (candidate.x2 - candidate.x1) ** 2 + (candidate.y2 - candidate.y1) ** 2;
            const longestLength = (longest.x2 - longest.x1) ** 2 + (longest.y2 - longest.y1) ** 2;
            return candidateLength > longestLength ? candidate : longest;
          }, segments[0]);
          traces.push({
            type: 'scatter',
            mode: 'text',
            x: [(segment.x1 + segment.x2) / 2],
            y: [(segment.y1 + segment.y2) / 2],
            text: [text],
            textposition: 'middle center',
            textfont: { family: 'Inter', size: 11, color },
            hoverinfo: 'skip',
            showlegend: false,
          });
        };
        if (currentCQA.lowerLimit !== undefined) {
          const LSL = currentCQA.lowerLimit;
          const lslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            LSL
          );
          if (lslSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🔴 Giới Hạn Dưới (LSL = ${LSL} ${currentCQA.unit || ''})`,
              x: lslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: lslSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#dc2626', width: contourLineWidth + 1, dash: 'dash' },
              hoverinfo: 'name',
              showlegend: true,
            });
            if (showContourLabels) addSpecLabel(lslSegs, `LSL: ${LSL}`, '#dc2626');
          }
        }

        if (currentCQA.upperLimit !== undefined) {
          const USL = currentCQA.upperLimit;
          const uslSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            USL
          );
          if (uslSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🔴 Giới Hạn Trên (USL = ${USL} ${currentCQA.unit || ''})`,
              x: uslSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: uslSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#b91c1c', width: contourLineWidth + 1, dash: 'dash' },
              hoverinfo: 'name',
              showlegend: true,
            });
            if (showContourLabels) addSpecLabel(uslSegs, `USL: ${USL}`, '#b91c1c');
          }
        }

        if (currentCQA.target !== undefined) {
          const T = currentCQA.target;
          const targetSegs = extract2DContourSegments(
            surfaceGrid.xActualArr,
            surfaceGrid.yActualArr,
            surfaceGrid.zGrid,
            T
          );
          if (targetSegs.length > 0) {
            traces.push({
              type: 'scatter',
              mode: 'lines',
              name: `🟢 Mục Tiêu (Target = ${T} ${currentCQA.unit || ''})`,
              x: targetSegs.flatMap((s) => [s.x1, s.x2, null]),
              y: targetSegs.flatMap((s) => [s.y1, s.y2, null]),
              line: { color: '#059669', width: contourLineWidth + 1, dash: 'solid' },
              hoverinfo: 'name',
              showlegend: true,
            });
            if (showContourLabels) addSpecLabel(targetSegs, `Target: ${T}`, '#059669');
          }
        }
      }
    }

    plotlyData = traces;

    plotlyLayout = {
      title: {
        text: `${plotType === '3d' ? 'Mặt Đáp 3D' : 'Đường Đồng Mức 2D'}: ${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
        font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' },
      },
      autosize: true,
      margin: plotType === '3d' ? { l: 40, r: 40, b: 40, t: 50 } : { l: 85, r: 60, t: 60, b: 75, pad: 4 },
      scene: {
        xaxis: {
          title: {
            text: formatAxisTitle(factorX.name, factorX.code, factorX.unit),
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
          ...(factorX.dataType === 'qualitative' ? { tickmode: 'array', tickvals: surfaceGrid.xActualArr, ticktext: surfaceGrid.xDisplayArr.map(String) } : {}),
        },
        yaxis: {
          title: {
            text: formatAxisTitle(factorY.name, factorY.code, factorY.unit),
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
          ...(factorY.dataType === 'qualitative' ? { tickmode: 'array', tickvals: surfaceGrid.yActualArr, ticktext: surfaceGrid.yDisplayArr.map(String) } : {}),
        },
        zaxis: {
          title: {
            text: formatAxisTitle(currentCQA.name, currentCQA.code, currentCQA.unit),
            font: { size: 12, color: '#1e293b' },
          },
          tickfont: { size: 10 },
        },
        camera: {
          eye: { x: 1.6, y: 1.6, z: 1.2 },
        },
      },
      xaxis: {
        title: {
          text: formatAxisTitle(factorX.name, factorX.code, factorX.unit),
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        ...(factorX.dataType === 'qualitative' ? { tickmode: 'array', tickvals: surfaceGrid.xActualArr, ticktext: surfaceGrid.xDisplayArr.map(String) } : {}),
        automargin: true,
      },
      yaxis: {
        title: {
          text: formatAxisTitle(factorY.name, factorY.code, factorY.unit),
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        ...(factorY.dataType === 'qualitative' ? { tickmode: 'array', tickvals: surfaceGrid.yActualArr, ticktext: surfaceGrid.yDisplayArr.map(String) } : {}),
        automargin: true,
      },
    };
  }

  // Determine which factors are fixed depending on current plot type
  const activeAxisCodes =
    plotType === 'ternary'
      ? [factorA?.code, factorB?.code, factorC?.code]
      : [factorX?.code, factorY?.code];

  const fixedFactorsList = factors.filter((f) => !activeAxisCodes.includes(f.code));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Control Header */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Compass size={22} color="#0f766e" />
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Trực Quan Hóa Mặt Đáp & Contour Plots (Response Surface 3D & 2D Contour)
              </h2>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
              Khảo sát hình thái cực trị, độ cong, tương tác quy trình và đồ thị contour tam giác 3 thành phần hỗn hợp (Ternary Contour).
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Modeling Engine Toggle */}
            {onToggleEngine && (
              <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.2rem', gap: '0.2rem' }}>
                <button
                  onClick={() => onToggleEngine('polynomial')}
                  className={`btn ${modelingEngine === 'polynomial' ? 'btn-teal' : 'btn-secondary'}`}
                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', border: 'none', fontWeight: '700' }}
                  title="Hiển thị mặt đáp từ mô hình Hồi quy Đa thức bậc ≤ 2 (ANOVA)"
                >
                  <Calculator size={14} />
                  <span>Đa Thức (ANOVA)</span>
                </button>
                <button
                  onClick={() => onToggleEngine('neural')}
                  className={`btn ${modelingEngine === 'neural' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{
                    padding: '0.35rem 0.65rem',
                    fontSize: '0.78rem',
                    border: 'none',
                    fontWeight: '700',
                    backgroundColor: modelingEngine === 'neural' ? '#7c3aed' : undefined,
                    borderColor: modelingEngine === 'neural' ? '#7c3aed' : undefined,
                  }}
                  title="Hiển thị mặt đáp từ mô hình Mạng Nơ-ron Nhân Tạo"
                >
                  <BrainCircuit size={14} />
                  <span>Mạng Nơ-ron AI</span>
                </button>
              </div>
            )}

            {/* CQA Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#475569' }}>Đáp ứng CQA:</label>
              <select
                className="input-field"
                style={{ width: '180px', fontWeight: '600', color: modelingEngine === 'neural' ? '#7c3aed' : '#0f766e' }}
                value={selectedCQA}
                onChange={(e) => onSelectCQA(e.target.value)}
              >
                {project.cqas.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}: {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Plot Type Selector: 3D / 2D / Ternary */}
            <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem', gap: '0.2rem' }}>
              {!hasMixture && <>
                <button
                  onClick={() => setPlotType('3d')}
                  className={`btn ${plotType === '3d' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', border: 'none' }}
                  title="Mặt đáp 3 chiều trong không gian"
                >
                  3D Surface
                </button>
                <button
                  onClick={() => setPlotType('contour')}
                  className={`btn ${plotType === 'contour' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', border: 'none' }}
                  title="Đường đồng mức 2D trên hệ tọa độ Descartes"
                >
                  2D Contour
                </button>
              </>}
              {hasMixture && (
                <button
                  onClick={() => setPlotType('ternary')}
                  className={`btn ${plotType === 'ternary' ? 'btn-teal' : 'btn-secondary'}`}
                  style={{
                    padding: '0.35rem 0.65rem',
                    fontSize: '0.8rem',
                    border: 'none',
                    fontWeight: '700',
                    backgroundColor: plotType === 'ternary' ? '#0f766e' : undefined,
                    color: plotType === 'ternary' ? '#ffffff' : undefined,
                  }}
                  title="Đồ thị Contour Tam Giác Hỗn Hợp 3 Thành Phần (Ternary 3-Component Mixture Plot)"
                >
                  <FlaskConical size={14} style={{ display: 'inline', marginRight: '0.2rem' }} />
                  <span>Tam Giác Hỗn Hợp</span>
                </button>
              )}
            </div>

            {/* Colorscale */}
            <select
              className="input-field"
              style={{ width: '130px', fontSize: '0.8rem' }}
              value={colorScale}
              onChange={(e) => setColorScale(e.target.value)}
              title="Bảng phối màu (Colormap)"
            >
              <option value="Viridis">Viridis</option>
              <option value="Jet">Jet (Rainbow)</option>
              <option value="Plasma">Plasma</option>
              <option value="Hot">Hot</option>
              <option value="Tealrose">Tealrose</option>
              <option value="Turbo">Turbo</option>
            </select>

            <button
              onClick={onNavigateToDesignSpace}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
            >
              <span>Không Gian Thiết Kế (Design Space)</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Layout Grid: Left Sidebar Controls + Right Plotly Viewer */}
      <div className="rsm-workspace-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: '1.5rem' }}>
        
        {/* Left Control Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Axis / Vertex Selector Card */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={16} color="#1e3a8a" />
              <span>{plotType === 'ternary' ? '3 Đỉnh Tam Giác Hỗn Hợp' : 'Trục Tọa Độ Khảo Sát'}</span>
            </h3>

            {plotType === 'ternary' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#0f766e', backgroundColor: '#f0fdfa', padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: '1px solid #ccfbf1' }}>
                  🧪 <strong>Hệ hỗn hợp 3 thành phần (Σ = 100%):</strong> Chọn 3 biến thành phần cho 3 đỉnh tam giác.
                </div>

                {/* Vertex A */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.2rem' }}>
                    🔺 Đỉnh A (Vertex A - Đỉnh Trên):
                  </label>
                  <select
                    className="input-field"
                    style={{ fontSize: '0.8rem', fontWeight: '600', color: '#0f766e' }}
                    value={ternaryA}
                    onChange={(e) => setTernaryA(e.target.value)}
                  >
                    {mixtureFactors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryB || f.code === ternaryC}>
                        {f.name} ({f.code}){f.role === 'mixture_component' ? ' [Hỗn hợp]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Vertex B */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.2rem' }}>
                    ◀️ Đỉnh B (Vertex B - Đỉnh Trái):
                  </label>
                  <select
                    className="input-field"
                    style={{ fontSize: '0.8rem', fontWeight: '600', color: '#1e40af' }}
                    value={ternaryB}
                    onChange={(e) => setTernaryB(e.target.value)}
                  >
                    {mixtureFactors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryC}>
                        {f.name} ({f.code}){f.role === 'mixture_component' ? ' [Hỗn hợp]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Vertex C */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.2rem' }}>
                    ▶️ Đỉnh C (Vertex C - Đỉnh Phải):
                  </label>
                  <select
                    className="input-field"
                    style={{ fontSize: '0.8rem', fontWeight: '600', color: '#b45309' }}
                    value={ternaryC}
                    onChange={(e) => setTernaryC(e.target.value)}
                  >
                    {mixtureFactors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryB}>
                        {f.name} ({f.code}){f.role === 'mixture_component' ? ' [Hỗn hợp]' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
                    Trục Hoành X (X-Axis):
                  </label>
                  <select
                    className="input-field"
                    value={xAxisFactor}
                    onChange={(e) => setXAxisFactor(e.target.value)}
                  >
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === yAxisFactor}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
                    Trục Tung Y (Y-Axis):
                  </label>
                  <select
                    className="input-field"
                    value={yAxisFactor}
                    onChange={(e) => setYAxisFactor(e.target.value)}
                  >
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === xAxisFactor}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Ternary Contour Visualization Settings Card (Visible when Ternary mode is active) */}
          {plotType === 'ternary' && (
            <div className="qbd-card" style={{ borderLeft: '4px solid #0f766e' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Eye size={16} color="#0f766e" />
                <span>Tùy Chọn Đồ Thị Tam Giác</span>
              </h3>

              {/* Display Mode */}
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#475569', marginBottom: '0.25rem' }}>
                  Kiểu hiển thị Contour:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                  <button
                    onClick={() => setTernaryDisplayMode('both')}
                    className={`btn ${ternaryDisplayMode === 'both' ? 'btn-teal' : 'btn-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.4rem', justifyContent: 'center' }}
                  >
                    Đường + Phủ màu
                  </button>
                  <button
                    onClick={() => setTernaryDisplayMode('lines_only')}
                    className={`btn ${ternaryDisplayMode === 'lines_only' ? 'btn-teal' : 'btn-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.4rem', justifyContent: 'center' }}
                  >
                    Chỉ Đường Isolines
                  </button>
                </div>
              </div>

              {/* Contour Levels Density */}
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: '600', color: '#475569' }}>Số mức đường đồng mức:</span>
                  <span className="font-mono font-bold" style={{ color: '#0f766e' }}>{ternaryLevels} mức</span>
                </div>
                <input
                  type="range"
                  min={6}
                  max={20}
                  step={2}
                  value={ternaryLevels}
                  onChange={(e) => setTernaryLevels(Number(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Shared contour styling controls: keep them with ternary options. */}
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: '600', color: '#475569' }}>Độ dày đường đồng mức:</span>
                  <span className="font-mono font-bold" style={{ color: '#0f766e' }}>{contourLineWidth.toFixed(1)}px</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={contourLineWidth}
                  onChange={(e) => setContourLineWidth(Number(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Ternary Grid Resolution Selector */}
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: '600', color: '#475569' }}>Độ mịn lưới tam giác (Anti-alias):</span>
                  <span className="font-mono font-bold" style={{ color: '#0f766e' }}>{ternaryResolution}x{ternaryResolution}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  {[
                    { label: 'Nhanh', val: 100, desc: '100x100' },
                    { label: 'Chuẩn', val: 180, desc: '180x180' },
                    { label: 'Mịn', val: 260, desc: '260x260' },
                    { label: 'Cực Mịn', val: 320, desc: '320x320' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setTernaryResolution(preset.val)}
                      className={`btn ${ternaryResolution === preset.val ? 'btn-teal' : 'btn-secondary'}`}
                      style={{ fontSize: '0.68rem', padding: '0.2rem 0.35rem', flex: 1, justifyContent: 'center' }}
                      title={preset.desc}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ternary Smoothness Slider */}
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: '600', color: '#475569' }}>Độ mượt đường đồng mức:</span>
                  <span className="font-mono font-bold" style={{ color: '#0f766e' }}>{ternarySmoothness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.3}
                  step={0.05}
                  value={ternarySmoothness}
                  onChange={(e) => setTernarySmoothness(Number(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Toggle Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.78rem', fontWeight: '500', color: '#1e293b', lineHeight: 1.45 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showContourLabels}
                    onChange={(e) => setShowContourLabels(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Hiện nhãn đường đồng mức</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showConstraints}
                    onChange={(e) => setShowConstraints(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>📏 Vạch giới hạn biến X ({factorA.low} ≤ {factorA.code} ≤ {factorA.high}...)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showRegionPolygon}
                    onChange={(e) => setShowRegionPolygon(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>🔶 Viền đa giác miền khảo sát DoE (Viền cam)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showSpecLimits}
                    onChange={(e) => setShowSpecLimits(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>
                    🏷️ Vạch giới hạn CQA ({currentCQA.code})
                    {currentCQA.lowerLimit !== undefined || currentCQA.upperLimit !== undefined ? (
                      <span style={{ color: '#dc2626', marginLeft: '0.25rem', fontWeight: '600' }}>
                        ({currentCQA.lowerLimit !== undefined ? `${currentCQA.lowerLimit} ≤ ` : ''}{currentCQA.code}{currentCQA.upperLimit !== undefined ? ` ≤ ${currentCQA.upperLimit}` : ''} {currentCQA.unit || ''})
                      </span>
                    ) : ''}
                  </span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showDoERuns}
                    onChange={(e) => setShowDoERuns(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Hiện các điểm DoE thực nghiệm (◆)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showOptimum}
                    onChange={(e) => setShowOptimum(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Hiện Điểm Tối Ưu Desirability (★)</span>
                </label>
              </div>
            </div>
          )}

          {/* 2D/3D Spec Limit Toggle Card (when not in Ternary mode) */}
          {plotType !== 'ternary' && (
            <div className="qbd-card" style={{ borderLeft: '4px solid #dc2626' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Target size={15} color="#dc2626" />
                  <span>Tiêu Chuẩn Giới Hạn CQA ({currentCQA.code})</span>
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.5rem' }}>
                {currentCQA.lowerLimit !== undefined || currentCQA.upperLimit !== undefined ? (
                  <span style={{ fontWeight: '600' }}>
                    Khoảng đạt yêu cầu: <strong style={{ color: '#15803d' }}>{currentCQA.lowerLimit !== undefined ? `${currentCQA.lowerLimit} ` : ''}≤ {currentCQA.code} ≤ {currentCQA.upperLimit !== undefined ? ` ${currentCQA.upperLimit}` : ''} {currentCQA.unit}</strong>
                  </span>
                ) : (
                  <span>Chưa cài đặt giới hạn LSL/USL trong Tab 1.</span>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.78rem' }}>
                <input
                  type="checkbox"
                  checked={showSpecLimits}
                  onChange={(e) => setShowSpecLimits(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span>
                  🔴 <strong>Vạch đường / mặt phẳng giới hạn</strong> (LSL / USL / Target)
                </span>
              </label>
              {plotType === 'contour' && (
                <>
                  <div style={{ marginTop: '0.7rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: '600', color: '#475569' }}>Độ dày đường đồng mức:</span>
                      <span className="font-mono font-bold" style={{ color: '#dc2626' }}>{contourLineWidth.toFixed(1)}px</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={4}
                      step={0.5}
                      value={contourLineWidth}
                      onChange={(e) => setContourLineWidth(Number(e.target.value))}
                      style={{ width: '100%', cursor: 'pointer' }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.78rem', marginTop: '0.55rem' }}>
                    <input
                      type="checkbox"
                      checked={showContourLabels}
                      onChange={(e) => setShowContourLabels(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Hiện nhãn đường đồng mức</span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* Active Mixture Constraints Card */}
          {plotType === 'ternary' && factorA && factorB && factorC && (
            <div className="qbd-card" style={{ backgroundColor: '#fffbeb', border: '1px solid #fef3c7' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#b45309', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <FlaskConical size={14} />
                <span>GIỚI HẠN KHẢO SÁT 3 BIẾN HỖN HỢP:</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: '#92400e', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>• <strong>{factorA.code}</strong> ({factorA.name}):</span>
                  <span className="font-mono font-bold">{factorA.low}% ≤ {factorA.code} ≤ {factorA.high}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>• <strong>{factorB.code}</strong> ({factorB.name}):</span>
                  <span className="font-mono font-bold">{factorB.low}% ≤ {factorB.code} ≤ {factorB.high}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>• <strong>{factorC.code}</strong> ({factorC.name}):</span>
                  <span className="font-mono font-bold">{factorC.low}% ≤ {factorC.code} ≤ {factorC.high}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Fixed Factors Control Card (Dual Inputs: Number Box + Slider) */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sliders size={16} color="#b45309" />
                <span>Cố Định Các Yếu Tố Còn Lại</span>
              </h3>

              {fixedFactorsList.length > 0 && (
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  {optimum && (
                    <button
                      onClick={handleSetAllToOptimum}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem', color: '#b45309' }}
                      title="Gán tất cả các biến cố định theo giá trị tối ưu của Desirability"
                    >
                      <Sparkles size={12} />
                      <span>Gán Tối Ưu</span>
                    </button>
                  )}
                  <button
                    onClick={handleResetToCenter}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem' }}
                    title="Đặt lại về tâm (Mức mã hóa 0)"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              )}
            </div>

            {fixedFactorsList.length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                Tất cả các biến đã được chọn trên các trục đồ thị. Không có biến nào cần cố định.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {fixedFactorsList.map((f) => {
                  const coded = fixedFactorCoded[f.code] ?? 0;
                  const actual = codedToActual(coded, f);
                  const actualNum = typeof actual === 'number' ? actual : parseFloat(String(actual)) || f.low;
                  const isMixture = f.role === 'mixture_component' || f.type === 'Mixture';

                  const stepSize = Math.max(0.01, Number(((f.high - f.low) / 100).toFixed(2)));

                  if (isDiscreteFactor(f)) {
                    const levels = getConfiguredFactorLevels(f);
                    const codes = getConfiguredFactorCodes(f);
                    return (
                      <div key={f.code} style={{ padding: '0.65rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: '700', fontSize: '0.8rem', color: '#1e293b', marginBottom: '0.4rem' }}>{f.name} ({f.code})</div>
                        <select className="input-field" style={{ width: '100%' }} value={String(actual)} onChange={(event) => {
                          const index = levels.findIndex((level) => String(level) === event.target.value);
                          handleCodedValueChange(f.code, codes[index] ?? codes[0] ?? 0);
                        }}>
                          {levels.map((level) => <option key={String(level)} value={String(level)}>{String(level)} {f.unit}</option>)}
                        </select>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={f.code}
                      style={{
                        padding: '0.65rem',
                        backgroundColor: '#f8fafc',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {/* Factor Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div>
                          <span style={{ fontWeight: '700', fontSize: '0.8rem', color: '#1e293b' }}>
                            {f.name}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.3rem' }}>
                            ({f.code})
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: '600',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '0.25rem',
                            backgroundColor: isMixture ? '#ccfbf1' : '#e0e7ff',
                            color: isMixture ? '#0f766e' : '#3730a3',
                          }}
                        >
                          {isMixture ? 'Hỗn hợp' : f.controllability === 'constant' ? 'Hằng số' : 'Quy trình'}
                        </span>
                      </div>

                      {/* Value Controls: Number Input + Unit + Coded Badge */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <input
                            type="number"
                            className="input-field"
                            style={{
                              padding: '0.25rem 0.45rem',
                              fontSize: '0.8rem',
                              fontWeight: '700',
                              color: '#0f766e',
                              width: '100%',
                            }}
                            min={f.low}
                            max={f.high}
                            step={stepSize}
                            value={actualNum}
                            onChange={(e) => handleActualValueChange(f, parseFloat(e.target.value) || f.low)}
                          />
                          <span style={{ fontSize: '0.75rem', color: '#64748b', minWidth: '28px' }}>
                            {f.unit || ''}
                          </span>
                        </div>

                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: '600',
                            color: '#b45309',
                            backgroundColor: '#fef3c7',
                            padding: '0.2rem 0.4rem',
                            borderRadius: '0.25rem',
                            whiteSpace: 'nowrap',
                          }}
                          title="Giá trị mã hóa [-1, 1]"
                        >
                          Mã: {coded.toFixed(2)}
                        </span>
                      </div>

                      {/* Smooth Slider */}
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.02}
                        value={coded}
                        onChange={(e) => handleCodedValueChange(f.code, Number(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', margin: '0.2rem 0' }}
                      />

                      {/* Min / Center / Max Quick Buttons */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
                        <button
                          onClick={() => handleCodedValueChange(f.code, -1)}
                          style={{ border: 'none', background: 'none', fontSize: '0.68rem', color: '#64748b', cursor: 'pointer', padding: 0 }}
                          title={`Đặt về giá trị nhỏ nhất: ${f.low} ${f.unit}`}
                        >
                          Min ({f.low})
                        </button>
                        <button
                          onClick={() => handleCodedValueChange(f.code, 0)}
                          style={{ border: 'none', background: 'none', fontSize: '0.68rem', color: '#0f766e', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                          title={`Đặt về tâm: ${(f.center ?? (f.low + f.high) / 2)} ${f.unit}`}
                        >
                          Tâm (0)
                        </button>
                        <button
                          onClick={() => handleCodedValueChange(f.code, 1)}
                          style={{ border: 'none', background: 'none', fontSize: '0.68rem', color: '#64748b', cursor: 'pointer', padding: 0 }}
                          title={`Đặt về giá trị lớn nhất: ${f.high} ${f.unit}`}
                        >
                          Max ({f.high})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Specifications Info */}
          <div className="qbd-card" style={{ backgroundColor: '#f0fdfa', border: '1px solid #ccfbf1' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#0f766e', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Target size={14} />
              <span>TIÊU CHUẨN CỦA {currentCQA.code} ({currentCQA.name}):</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#134e4a', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div>• Mục tiêu (Target): <strong>{currentCQA.target !== undefined ? `${currentCQA.target} ${currentCQA.unit}` : 'N/A'}</strong></div>
              <div>• Khoảng chấp nhận: <strong>{currentCQA.lowerLimit !== undefined ? currentCQA.lowerLimit : '-'}</strong> đến <strong>{currentCQA.upperLimit !== undefined ? currentCQA.upperLimit : '-'} {currentCQA.unit}</strong></div>
              <div>• Hướng tối ưu: <strong>{currentCQA.objective.toUpperCase()}</strong> (Trọng số: {currentCQA.weight}★)</div>
            </div>
          </div>

        </div>

        {/* Right 3D Surface / Contour WebGL Viewer */}
        <div className="qbd-card" style={{ height: plotType === 'ternary' ? '700px' : '660px', padding: '0.5rem', display: 'flex', flexDirection: 'column' }}>
          <PlotlyChart data={plotlyData} layout={plotlyLayout} style={{ width: '100%', height: '100%' }} />
        </div>

      </div>

    </div>
  );
};
