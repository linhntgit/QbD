import React, { useState, useMemo, useEffect } from 'react';
import {
  Boxes,
  Play,
  ShieldCheck,
  ArrowRight,
  Sliders,
  Lock,
  Calculator,
  BrainCircuit,
  FlaskConical,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetModelResult,
  DesirabilitySolution,
  DesignSpaceRanges,
  MonteCarloResult,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { DesirabilityProfiler } from '../DesirabilityProfiler';
import {
  optimizeDesirability,
  runMonteCarloSimulation,
  generateControlStrategy,
} from '../../services/statistics';
import { codedToActual, actualToCoded } from '../../services/doeGenerator';
import { formatAxisTitle } from '../../services/mathUtils';
import { generateTernaryDesignSpace } from '../../services/ternaryContour';

interface DesignSpaceTabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult | NeuralNetModelResult>;
  modelingEngine?: ModelingEngine;
  onToggleEngine?: (engine: ModelingEngine) => void;
  onUpdateProject: (updated: Partial<QBDProject>) => void;
  onNavigateToReport: () => void;
}

export const DesignSpaceTab: React.FC<DesignSpaceTabProps> = ({
  project,
  models,
  modelingEngine = 'polynomial',
  onToggleEngine,
  onUpdateProject,
  onNavigateToReport,
}) => {
  const factors = project.factors;
  const cqas = project.cqas;

  // Mixture factors filter
  const mixtureFactors = useMemo(() => {
    return factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
  }, [factors]);
  const hasMixture = mixtureFactors.length >= 3;

  // Mode: 2D Cartesian Overlay vs Ternary Design Space
  const [overlayMode, setOverlayMode] = useState<'2d' | 'ternary'>(() =>
    hasMixture ? 'ternary' : '2d'
  );

  // Sync mode if project changes
  useEffect(() => {
    if (hasMixture) {
      setOverlayMode('ternary');
    }
  }, [project.id, hasMixture]);

  // Selected Axis Factors for 2D Overlay Plot
  const [xAxisFactor, setXAxisFactor] = useState<string>(factors[0]?.code || 'X1');
  const [yAxisFactor, setYAxisFactor] = useState<string>(factors[1]?.code || 'X2');

  // Selected Vertices for Ternary Design Space
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
  }, [project.id, mixtureFactors]);

  const factorX = factors.find((f) => f.code === xAxisFactor) || factors[0];
  const factorY = factors.find((f) => f.code === yAxisFactor) || factors[1];

  const factorA = factors.find((f) => f.code === ternaryA) || mixtureFactors[0] || factors[0];
  const factorB = factors.find((f) => f.code === ternaryB) || mixtureFactors[1] || factors[1];
  const factorC = factors.find((f) => f.code === ternaryC) || mixtureFactors[2] || factors[2];

  // Resolution and Smoothness state for Design Space rendering
  const [resolution, setResolution] = useState<number>(180); // 40 to 300 (grid density)
  const [smoothness, setSmoothness] = useState<number>(1.0); // 0 to 1.3 (Plotly contour line smoothing)
  const [showBoundaryLines, setShowBoundaryLines] = useState<boolean>(true);

  // Desirability Optimum State
  const [optimum, setOptimum] = useState<DesirabilitySolution | null>(() =>
    optimizeDesirability(factors, cqas, models)
  );

  // Sliced / Fixed Factors state for 2D Design Space cross-section
  const [sliceFactorsCoded, setSliceFactorsCoded] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    factors.forEach((f) => {
      init[f.code] = optimum?.codedFactors[f.code] ?? 0;
    });
    return init;
  });

  // Monte Carlo State
  const [mcVariability, setMcVariability] = useState<number>(2.0); // 2% RSD
  const mcSimulations = 10000;
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(() => {
    if (!optimum) return null;
    return runMonteCarloSimulation(
      optimum.actualFactors,
      factors,
      cqas,
      models,
      2.0,
      10000
    );
  });

  // Handle Apply Optimum from Desirability Profiler
  const handleApplyOptimumFromProfiler = (solution: DesirabilitySolution) => {
    setOptimum(solution);
    setSliceFactorsCoded({ ...solution.codedFactors });

    // Automatically update Design Space Ranges based on Optimum
    const newDesignSpace: DesignSpaceRanges[] = factors.map((f) => {
      const rawOpt = solution.actualFactors[f.code];
      const optValNum = typeof rawOpt === 'number' ? rawOpt : f.low;
      const range = f.high - f.low;
      return {
        factorCode: f.code,
        knowledgeLow: f.low,
        knowledgeHigh: f.high,
        parLow: Number(Math.max(f.low, optValNum - range * 0.15).toFixed(2)),
        parHigh: Number(Math.min(f.high, optValNum + range * 0.15).toFixed(2)),
        norLow: Number(Math.max(f.low, optValNum - range * 0.05).toFixed(2)),
        norHigh: Number(Math.min(f.high, optValNum + range * 0.05).toFixed(2)),
        target: rawOpt ?? f.low,
      };
    });
    onUpdateProject({ designSpace: newDesignSpace });

    // Run Monte Carlo
    const mc = runMonteCarloSimulation(
      solution.actualFactors,
      factors,
      cqas,
      models,
      mcVariability,
      mcSimulations
    );
    setMcResult(mc);
  };

  // Run Monte Carlo simulation manually
  const handleRunMonteCarlo = () => {
    if (!optimum) return;
    const mc = runMonteCarloSimulation(
      optimum.actualFactors,
      factors,
      cqas,
      models,
      mcVariability,
      mcSimulations
    );
    setMcResult(mc);
  };

  // Sweet Spot / Design Space Overlay Grid Computation (2D Cartesian)
  const sweetSpotGrid = useMemo(() => {
    if (overlayMode !== '2d' || !factorX || !factorY || Object.keys(models).length === 0) return null;

    const N = Math.max(40, Math.min(300, resolution));
    const xActualArr: number[] = [];
    const yActualArr: number[] = [];
    const xCodedArr: number[] = [];
    const yCodedArr: number[] = [];

    for (let i = 0; i < N; i++) {
      const coded = -1.0 + (2.0 * i) / (N - 1);
      xCodedArr.push(coded);
      yCodedArr.push(coded);
      const xAct = codedToActual(coded, factorX);
      const yAct = codedToActual(coded, factorY);
      xActualArr.push(typeof xAct === 'number' ? xAct : Number(xAct) || coded);
      yActualArr.push(typeof yAct === 'number' ? yAct : Number(yAct) || coded);
    }

    const zScoreGrid: number[][] = [];
    const validCQAs = cqas.filter((c) => models[c.code]);

    for (let j = 0; j < N; j++) {
      const row: number[] = [];
      const yCoded = yCodedArr[j];

      for (let i = 0; i < N; i++) {
        const xCoded = xCodedArr[i];
        const pointCoded: Record<string, number> = {};
        factors.forEach((f) => {
          pointCoded[f.code] = sliceFactorsCoded[f.code] ?? 0;
        });
        pointCoded[factorX.code] = xCoded;
        pointCoded[factorY.code] = yCoded;

        let minMargin = 999999;
        for (const cqa of validCQAs) {
          const model = models[cqa.code];
          const yPred = model.predict(pointCoded);
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
          }
        }

        row.push(Number(minMargin.toFixed(5)));
      }
      zScoreGrid.push(row);
    }

    return {
      xActualArr,
      yActualArr,
      zScoreGrid,
    };
  }, [overlayMode, factorX, factorY, models, cqas, factors, sliceFactorsCoded, resolution]);

  // Ternary Design Space Mesh Computation
  const ternaryDS = useMemo(() => {
    if (overlayMode !== 'ternary' || !factorA || !factorB || !factorC || Object.keys(models).length === 0) {
      return null;
    }

    return generateTernaryDesignSpace(
      factorA,
      factorB,
      factorC,
      factors,
      sliceFactorsCoded,
      models,
      cqas,
      resolution,
      {
        optimum,
        doeRuns: project.runs,
        showDoERuns: true,
        showConstraints: true,
        showRegionPolygon: true,
        showOptimum: true,
        smoothness,
      }
    );
  }, [overlayMode, factorA, factorB, factorC, factors, sliceFactorsCoded, models, cqas, resolution, smoothness, optimum, project.runs]);

  // Sweet Spot Plotly Data
  const overlayPlotData = useMemo(() => {
    if (overlayMode === 'ternary' && ternaryDS && factorA && factorB && factorC) {
      return ternaryDS.traces;
    }

    if (!sweetSpotGrid || !factorX || !factorY) return [];

    const data: any[] = [
      {
        type: 'contour',
        x: sweetSpotGrid.xActualArr,
        y: sweetSpotGrid.yActualArr,
        z: sweetSpotGrid.zScoreGrid,
        zmin: -0.15,
        zmax: 0.15,
        zmid: 0,
        colorscale: [
          [0.0, '#f87171'], // Failure / Out-of-spec (Clear Red)
          [0.499, '#fca5a5'], // Out-of-spec Near Boundary (Red)
          [0.5, '#86efac'], // Exact boundary (Z = 0) (Light Green - Design Space)
          [1.0, '#4ade80'], // Deep Inside Design Space (Vivid Green)
        ],
        showscale: false,
        line: {
          smoothing: smoothness,
          width: showBoundaryLines ? 2.5 : 0,
          color: '#1e3a8a',
        },
        contours: {
          coloring: 'heatmap',
          start: 0,
          end: 0,
          size: 0,
          showlines: showBoundaryLines,
        },
        hoverinfo: 'x+y',
        name: 'Design Space',
      },
    ];

    // Plot Optimum Target point if available
    if (optimum && optimum.actualFactors[factorX.code] !== undefined && optimum.actualFactors[factorY.code] !== undefined) {
      const optXVal = optimum.actualFactors[factorX.code];
      const optYVal = optimum.actualFactors[factorY.code];
      const optX = typeof optXVal === 'number' ? optXVal : Number(optXVal) || 0;
      const optY = typeof optYVal === 'number' ? optYVal : Number(optYVal) || 0;

      const yMin = sweetSpotGrid.yActualArr[0] ?? 0;
      const yMax = sweetSpotGrid.yActualArr[sweetSpotGrid.yActualArr.length - 1] ?? 100;
      const isNearTop = optY > yMin + 0.8 * (yMax - yMin);
      const textpos = isNearTop ? 'bottom center' : 'top center';

      data.push({
        type: 'scatter',
        mode: 'markers+text',
        x: [optX],
        y: [optY],
        marker: { size: 14, color: '#1e3a8a', symbol: 'star' },
        text: ['★ ĐIỂM VẬN HÀNH ĐỀ XUẤT'],
        textposition: textpos,
        textfont: { family: 'Inter, sans-serif', size: 11, color: '#1e3a8a', weight: 700 },
        hoverinfo: 'text',
        hovertext: [
          `<b>★ ĐIỂM VẬN HÀNH ĐỀ XUẤT (TARGET SETPOINT)</b><br>` +
          `${factorX.name} (${factorX.code}): ${optX} ${factorX.unit || ''}<br>` +
          `${factorY.name} (${factorY.code}): ${optY} ${factorY.unit || ''}`
        ],
        name: 'Target Setpoint',
      });
    }

    return data;
  }, [overlayMode, ternaryDS, factorA, factorB, factorC, sweetSpotGrid, factorX, factorY, optimum, smoothness, showBoundaryLines]);

  const overlayLayout = useMemo(() => {
    if (overlayMode === 'ternary' && ternaryDS) {
      return ternaryDS.layout;
    }

    return {
      title: {
        text: `Vùng Thiết Kế (Design Space Overlay) - Giao điểm Tất cả các CQAs`,
        font: { size: 13, color: '#0f172a', family: 'Inter' },
      },
      xaxis: {
        title: {
          text: formatAxisTitle(factorX.name, factorX.code, factorX.unit),
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        automargin: true,
      },
      yaxis: {
        title: {
          text: formatAxisTitle(factorY.name, factorY.code, factorY.unit),
          font: { size: 13, color: '#1e293b' },
          standoff: 12,
        },
        tickfont: { size: 11 },
        automargin: true,
      },
      annotations: [],
      margin: { l: 85, r: 40, t: 50, b: 75, pad: 4 },
    };
  }, [overlayMode, factorA, factorB, factorC, factorX, factorY]);

  // Determine fixed factors list based on active overlay mode
  const activeAxisCodes =
    overlayMode === 'ternary'
      ? [factorA?.code, factorB?.code, factorC?.code]
      : [factorX?.code, factorY?.code];

  const fixedFactorsList = factors.filter((f) => !activeAxisCodes.includes(f.code));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Modeling Paradigm Banner & Switcher */}
      {onToggleEngine && (
        <div
          className="qbd-card"
          style={{
            padding: '0.75rem 1.25rem',
            backgroundColor: '#ffffff',
            borderLeft: modelingEngine === 'neural' ? '4px solid #7c3aed' : '4px solid #0f766e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {modelingEngine === 'neural' ? (
              <BrainCircuit size={22} color="#7c3aed" />
            ) : (
              <Calculator size={22} color="#0f766e" />
            )}
            <div>
              <div style={{ fontWeight: '700', fontSize: '0.9rem', color: '#0f172a' }}>
                Động Cơ Mô Hình Hóa & Tối Ưu: {modelingEngine === 'neural' ? '🧠 Mạng Nơ-ron Nhân Tạo AI' : '📐 Hồi Quy Đa Thức Bậc ≤ 2 (ANOVA)'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {modelingEngine === 'neural'
                  ? 'Desirability Profiler, Sweet Spot và Mô phỏng Monte Carlo đang tính toán trực tiếp trên trọng số Mạng Nơ-ron.'
                  : 'Desirability Profiler, Sweet Spot và Mô phỏng Monte Carlo đang tính toán trực tiếp từ hệ số hồi quy Đa thức.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.2rem', gap: '0.2rem' }}>
              <button
                onClick={() => onToggleEngine('polynomial')}
                className={`btn ${modelingEngine === 'polynomial' ? 'btn-teal' : 'btn-secondary'}`}
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem' }}
              >
                📐 Hồi Quy Đa Thức
              </button>
              <button
                onClick={() => onToggleEngine('neural')}
                className={`btn ${modelingEngine === 'neural' ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  fontSize: '0.76rem',
                  padding: '0.35rem 0.75rem',
                  backgroundColor: modelingEngine === 'neural' ? '#7c3aed' : undefined,
                  borderColor: modelingEngine === 'neural' ? '#7c3aed' : undefined,
                }}
              >
                🧠 Mạng Nơ-ron AI
              </button>
            </div>

            <button
              onClick={onNavigateToReport}
              className="btn btn-teal"
              style={{ fontSize: '0.78rem', padding: '0.38rem 0.8rem', gap: '0.35rem' }}
              title="Chuyển sang Tab Báo Cáo QbD & Xuất Word"
            >
              <span>Xem Báo Cáo QbD</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 1. Prediction Profiler & Desirability Optimization */}
      <DesirabilityProfiler
        factors={factors}
        cqas={cqas}
        models={models}
        onUpdateCQAs={(updatedCQAs) => onUpdateProject({ cqas: updatedCQAs })}
        onApplyOptimum={handleApplyOptimumFromProfiler}
      />

      {/* 2. Sweet Spot / Design Space Overlay Plot */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem' }}>
        
        {/* Main Plot Area */}
        <div className="qbd-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Boxes size={20} color="#1e3a8a" />
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                  Không Gian Thiết Kế (Design Space Overlay)
                </h3>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                Miền kết hợp đa biến đảm bảo tất cả các chỉ tiêu chất lượng (CQAs) đồng thời đạt tiêu chuẩn.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              {/* Overlay Mode Toggle: 2D vs Ternary */}
              {hasMixture && (
                <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.375rem', padding: '0.15rem', gap: '0.15rem' }}>
                  <button
                    onClick={() => setOverlayMode('2d')}
                    className={`btn ${overlayMode === '2d' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                  >
                    2D Cartesian
                  </button>
                  <button
                    onClick={() => setOverlayMode('ternary')}
                    className={`btn ${overlayMode === 'ternary' ? 'btn-teal' : 'btn-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', fontWeight: '700' }}
                  >
                    <FlaskConical size={12} style={{ display: 'inline', marginRight: '0.2rem' }} />
                    <span>Tam Giác Hỗn Hợp</span>
                  </button>
                </div>
              )}

              {/* Resolution Selector (both 2D and Ternary) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: '#f8fafc', padding: '0.2rem 0.4rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.73rem', color: '#475569', fontWeight: '600' }}>Lưới:</span>
                <div style={{ display: 'flex', gap: '0.15rem' }}>
                  {[
                    { label: 'Nhanh', val: 100, desc: '100x100' },
                    { label: 'Chuẩn', val: 180, desc: '180x180' },
                    { label: 'Mịn', val: 260, desc: '260x260' },
                    { label: 'Cực Mịn', val: 320, desc: '320x320' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setResolution(preset.val)}
                      className={`btn ${resolution === preset.val ? (overlayMode === 'ternary' ? 'btn-teal' : 'btn-primary') : 'btn-secondary'}`}
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.18rem 0.4rem',
                        borderRadius: '0.25rem',
                        fontWeight: resolution === preset.val ? '700' : '500',
                      }}
                      title={preset.desc}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Smoothness Slider (both 2D and Ternary) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.73rem', fontWeight: '600', color: '#475569' }}>
                  Độ mượt:
                </span>
                <input
                  type="range"
                  min={0}
                  max={1.3}
                  step={0.05}
                  value={smoothness}
                  onChange={(e) => setSmoothness(Number(e.target.value))}
                  style={{ width: '60px', cursor: 'pointer' }}
                />
                <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: '700', color: overlayMode === 'ternary' ? '#0f766e' : '#1e40af', minWidth: '22px' }}>
                  {smoothness.toFixed(2)}
                </span>
              </div>

              {/* Boundary Lines Toggle (for 2D) */}
              {overlayMode === '2d' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem', color: '#334155', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showBoundaryLines}
                    onChange={(e) => setShowBoundaryLines(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Đường viền ranh giới</span>
                </label>
              )}
            </div>
          </div>

          {/* External Legend Bar: Clear, Unobstructed, Outside the Chart Canvas */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1.25rem',
              padding: '0.4rem 0.85rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
              marginBottom: '0.65rem',
              fontSize: '0.76rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '13px',
                  height: '13px',
                  borderRadius: '3px',
                  backgroundColor: '#4ade80',
                  border: '1px solid #16a34a',
                }}
              />
              <span style={{ fontWeight: '600', color: '#166534' }}>
                Vùng Xanh: Design Space (100% CQAs Đạt Chuẩn)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '13px',
                  height: '13px',
                  borderRadius: '3px',
                  backgroundColor: '#f87171',
                  border: '1px solid #dc2626',
                }}
              />
              <span style={{ fontWeight: '600', color: '#991b1b' }}>
                Vùng Đỏ: Không đạt tiêu chuẩn (OOS)
              </span>
            </div>

            {optimum && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: '#1e3a8a', fontSize: '1rem', lineHeight: 1 }}>★</span>
                <span style={{ fontWeight: '700', color: '#1e3a8a' }}>
                  Điểm Vận Hành Đề Xuất (Target)
                </span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '0px',
                  borderTop: '2.5px solid #1e3a8a',
                }}
              />
              <span style={{ color: '#475569', fontSize: '0.74rem' }}>
                Ranh giới tiêu chuẩn (Margin = 0)
              </span>
            </div>

            {project.runs && project.runs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    backgroundColor: '#eab308',
                    border: '1px solid #713f12',
                  }}
                />
                <span style={{ color: '#475569', fontSize: '0.74rem' }}>
                  Điểm DoE thực nghiệm
                </span>
              </div>
            )}
          </div>

          {/* Plotly Canvas */}
          <div style={{ height: '540px', width: '100%' }}>
            <PlotlyChart data={overlayPlotData} layout={overlayLayout} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Axis & Fixed Factors Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Axis / Vertices Selector Card */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
              {overlayMode === 'ternary' ? '3 Đỉnh Tam Giác Sweet Spot' : 'Trục Tọa Độ Sweet Spot'}
            </h3>

            {overlayMode === 'ternary' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#0f766e', fontWeight: '600' }}>🔺 Đỉnh A (Đỉnh Trên):</label>
                  <select className="input-field" value={ternaryA} onChange={(e) => setTernaryA(e.target.value)}>
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryB || f.code === ternaryC}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: '600' }}>◀️ Đỉnh B (Đỉnh Trái):</label>
                  <select className="input-field" value={ternaryB} onChange={(e) => setTernaryB(e.target.value)}>
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryC}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: '600' }}>▶️ Đỉnh C (Đỉnh Phải):</label>
                  <select className="input-field" value={ternaryC} onChange={(e) => setTernaryC(e.target.value)}>
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === ternaryA || f.code === ternaryB}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Trục X (Hoành):</label>
                  <select className="input-field" value={xAxisFactor} onChange={(e) => setXAxisFactor(e.target.value)}>
                    {factors.map((f) => (
                      <option key={f.code} value={f.code} disabled={f.code === yAxisFactor}>
                        {f.name} ({f.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Trục Y (Tung):</label>
                  <select className="input-field" value={yAxisFactor} onChange={(e) => setYAxisFactor(e.target.value)}>
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

          {/* Active Mixture Constraints Card */}
          {overlayMode === 'ternary' && factorA && factorB && factorC && (
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

          {/* Remaining Factors Slice Adjuster (Input Box + Range Slider) */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sliders size={16} color="#b45309" />
                <span>Điều Chỉnh Các Biến X Còn Lại</span>
              </h3>
              {optimum && fixedFactorsList.length > 0 && (
                <button
                  onClick={() => {
                    setSliceFactorsCoded({ ...optimum.codedFactors });
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', gap: '0.25rem' }}
                  title="Khôi phục toàn bộ các biến về điểm tối ưu"
                >
                  <Sparkles size={11} color="#b45309" />
                  <span>Về Điểm Tối Ưu</span>
                </button>
              )}
            </div>

            <p style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.75rem', lineHeight: '1.4' }}>
              Mặt cắt của Vùng thiết kế phụ thuộc vào giá trị cài đặt của các biến X còn lại. Nhập số hoặc kéo thanh trượt để khảo sát:
            </p>

            {fixedFactorsList.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: '#64748b', backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '0.375rem', textAlign: 'center' }}>
                Tất cả các biến đã được hiển thị trên các trục đồ thị.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {fixedFactorsList.map((f) => {
                  const coded = sliceFactorsCoded[f.code] ?? 0;
                  const actual = codedToActual(coded, f);
                  const actualNum = typeof actual === 'number' ? actual : parseFloat(String(actual)) || f.low;
                  const optActual = optimum?.actualFactors[f.code];

                  if (f.controllability === 'constant') {
                    return (
                      <div key={f.code} style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Lock size={13} color="#64748b" />
                          <span>{f.name} ({f.code}): <strong>{f.constantValue ?? f.low} {f.unit}</strong> (Hằng số)</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={f.code}
                      style={{
                        backgroundColor: '#f8fafc',
                        padding: '0.65rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {/* Header: Factor Name & Quick Reset */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b' }}>
                          {f.name} ({f.code}):
                        </span>
                        {optActual !== undefined && (
                          <button
                            onClick={() => {
                              if (optimum) {
                                setSliceFactorsCoded((prev) => ({ ...prev, [f.code]: optimum.codedFactors[f.code] ?? 0 }));
                              }
                            }}
                            style={{
                              border: 'none',
                              background: 'none',
                              fontSize: '0.7rem',
                              color: '#0284c7',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              padding: 0,
                            }}
                            title="Khôi phục thông số này về điểm tối ưu"
                          >
                            Opt: {optActual} {f.unit}
                          </button>
                        )}
                      </div>

                      {/* Numeric Input for Actual Value */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                        <label style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>Giá trị thực:</label>
                        <input
                          type="number"
                          step="any"
                          className="input-field font-mono"
                          style={{ flex: 1, padding: '0.2rem 0.45rem', fontSize: '0.8rem', fontWeight: '700', color: '#b45309' }}
                          value={actualNum}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              const newCoded = actualToCoded(val, f);
                              setSliceFactorsCoded((prev) => ({
                                ...prev,
                                [f.code]: Number(Math.max(-1.5, Math.min(1.5, newCoded)).toFixed(4)),
                              }));
                            }
                          }}
                        />
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', minWidth: '28px' }}>
                          {f.unit}
                        </span>
                      </div>

                      {/* Range Slider for Coded Value */}
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.02}
                        value={coded}
                        onChange={(e) => {
                          setSliceFactorsCoded((prev) => ({
                            ...prev,
                            [f.code]: Number(e.target.value),
                          }));
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                        <span>{f.low} {f.unit} (-1)</span>
                        <span className="font-mono">Mã: {coded >= 0 ? `+${coded.toFixed(2)}` : coded.toFixed(2)}</span>
                        <span>{f.high} {f.unit} (+1)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Control Strategy Concept Card (ICH Q10) */}
          <div className="qbd-card" style={{ backgroundColor: '#f8fafc' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#1e3a8a', marginBottom: '0.5rem' }}>
              Phân Cấp Phạm Vi (ICH Q8 / Q10)
            </h3>
            <div style={{ fontSize: '0.75rem', color: '#334155', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div>
                <strong>1. Knowledge Space:</strong> Toàn bộ miền giá trị đã được khảo sát bằng DoE.
              </div>
              <div>
                <strong>2. Design Space / PAR:</strong> Phạm vi được chứng minh đảm bảo 100% CQA đạt tiêu chuẩn.
              </div>
              <div>
                <strong>3. Normal Operating Range (NOR):</strong> Dải vận hành hàng ngày trong sản xuất (Target ± dung sai nhỏ).
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Monte Carlo Risk & Reliability Assessment (ICH Q9) */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <ShieldCheck size={20} color="#0f766e" />
              <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                Xác Minh Độ Tin Cậy Bằng Mô Phỏng Monte Carlo (ICH Q9 Risk Verification)
              </h3>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
              Mô phỏng hàng ngàn lô sản xuất ảo với sai số thông số thực tế để tính toán tỷ lệ lỗi (Defect Rate) và chỉ số năng lực quy trình (Cpk).
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.75rem', color: '#475569' }}>Dao động (RSD %):</label>
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                className="input-field"
                style={{ width: '70px', padding: '0.3rem 0.5rem' }}
                value={mcVariability}
                onChange={(e) => setMcVariability(Number(e.target.value))}
              />
            </div>

            <button onClick={handleRunMonteCarlo} className="btn btn-teal" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
              <Play size={14} />
              <span>Chạy Mô Phỏng ({mcSimulations.toLocaleString()} Lô)</span>
            </button>
          </div>
        </div>

        {mcResult && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div style={{ backgroundColor: mcResult.reliabilityPercent >= 99 ? '#dcfce7' : '#fef3c7', borderRadius: '0.5rem', padding: '0.85rem', border: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#14532d' }}>ĐỘ TIN CẬY QUY TRÌNH (RELIABILITY)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: mcResult.reliabilityPercent >= 99 ? '#15803d' : '#b45309', margin: '0.2rem 0' }}>
                {mcResult.reliabilityPercent}%
              </div>
              <div style={{ fontSize: '0.72rem', color: '#334155' }}>
                {mcResult.passCount.toLocaleString()} / {mcResult.simulations.toLocaleString()} lô đạt chuẩn 100% CQAs
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', borderRadius: '0.5rem', padding: '0.85rem', border: '1px solid #cbd5e1' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569' }}>TỶ LỆ LỖI DỰ KIẾN (DEFECT RATE)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: mcResult.defectRatePPM < 1000 ? '#15803d' : '#dc2626', margin: '0.2rem 0' }}>
                {mcResult.defectRatePPM.toLocaleString()} PPM
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Số phần triệu sản phẩm ngoài tiêu chuẩn</div>
            </div>

            {Object.entries(mcResult.cqaStats).map(([code, stats]) => {
              const cqa = cqas.find((c) => c.code === code);
              return (
                <div key={code} style={{ backgroundColor: '#ffffff', borderRadius: '0.5rem', padding: '0.85rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#1e3a8a' }}>
                    {cqa ? cqa.name : code} ({code})
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0f172a', margin: '0.15rem 0' }}>
                    Cpk = {stats.cpk !== undefined ? stats.cpk : 'N/A'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    TB: {stats.mean} ± {stats.sd} | Ngoài chuẩn: {stats.outOfSpecPercent}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Comprehensive Control Strategy Table (ICH Q10 & FDA Table 105/106/107) */}
      <div className="qbd-card" style={{ borderLeft: '4px solid #0f766e' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ClipboardList size={20} color="#0f766e" />
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
              Bảng Chiến Lược Kiểm Soát Toàn Diện (ICH Q10 Control Strategy Dashboard)
            </h3>
          </div>
          <span className="badge badge-success" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
            Chuẩn FDA Module 3 (3.2.P.2)
          </span>
        </div>

        <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.85rem' }}>
          Bảng thiết lập các mức kiểm soát từ nguyên liệu đầu vào (CMAs), thông số quy trình (CPPs), kiểm soát trong quá trình (IPCs/PAT) đến tiêu chuẩn xuất xưởng thành phẩm, phân định rõ giữa <strong>NOR</strong> (Normal Operating Range), <strong>PAR</strong> (Proven Acceptable Range) và <strong>Design Space</strong>.
        </div>

        <div className="table-container">
          <table className="qbd-table">
            <thead>
              <tr>
                <th>Phân Loại</th>
                <th>Thông Số / Thuộc Tính</th>
                <th>Đơn Vị</th>
                <th>Mục Tiêu (Target)</th>
                <th>Khoảng Vận Hành Thông Thường (NOR)</th>
                <th>Khoảng Chấp Nhận Đã Chứng Minh (PAR)</th>
                <th>Giới Hạn Design Space</th>
                <th>Phương Pháp Kiểm Soát</th>
              </tr>
            </thead>
            <tbody>
              {generateControlStrategy(project, optimum).map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <span
                      className={`badge ${
                        item.category.includes('CMA')
                          ? 'badge-primary'
                          : item.category.includes('CPP')
                          ? 'badge-warning'
                          : item.category.includes('IPC')
                          ? 'badge-teal'
                          : 'badge-success'
                      }`}
                      style={{ fontSize: '0.7rem' }}
                    >
                      {item.category}
                    </span>
                  </td>
                  <td style={{ fontWeight: '600', color: '#1e3a8a' }}>
                    {item.parameterName} {item.parameterCode ? `(${item.parameterCode})` : ''}
                  </td>
                  <td style={{ textAlign: 'center', color: '#64748b' }}>{item.unit || '-'}</td>
                  <td className="font-mono" style={{ fontWeight: '700', color: '#0f766e' }}>
                    {item.target}
                  </td>
                  <td className="font-mono" style={{ color: '#2563eb', fontWeight: '600' }}>
                    {item.nor}
                  </td>
                  <td className="font-mono" style={{ color: '#15803d', fontWeight: '600' }}>
                    {item.par}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: '#475569' }}>
                    {item.designSpaceLimit}
                  </td>
                  <td style={{ fontSize: '0.74rem', color: '#334155' }}>
                    {item.controlMethod}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
