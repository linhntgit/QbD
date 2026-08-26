import React, { useState, useMemo } from 'react';
import {
  Boxes,
  Play,
  ShieldCheck,
  ArrowRight,
  Sliders,
  RotateCcw,
  Lock,
  Settings2,
  Calculator,
  BrainCircuit,
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
} from '../../services/statistics';
import { codedToActual, actualToCoded } from '../../services/doeGenerator';

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

  // Selected Axis Factors for Overlay Plot
  const [xAxisFactor, setXAxisFactor] = useState<string>(factors[0]?.code || 'X1');
  const [yAxisFactor, setYAxisFactor] = useState<string>(factors[1]?.code || 'X2');

  const factorX = factors.find((f) => f.code === xAxisFactor) || factors[0];
  const factorY = factors.find((f) => f.code === yAxisFactor) || factors[1];

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

  // Sweet Spot / Design Space Overlay Grid Computation (Continuous Signed Margin Field)
  const sweetSpotGrid = useMemo(() => {
    if (!factorX || !factorY || Object.keys(models).length === 0) return null;

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

    const zScoreGrid: number[][] = []; // Continuous signed margin (>= 0 inside Design Space, < 0 outside)
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
  }, [factorX, factorY, models, cqas, factors, sliceFactorsCoded, resolution]);

  // Sweet Spot Plotly Data (Continuous Sub-Pixel Interpolation)
  const overlayPlotData = useMemo(() => {
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
      data.push({
        type: 'scatter',
        mode: 'markers+text',
        x: [typeof optimum.actualFactors[factorX.code] === 'number' ? optimum.actualFactors[factorX.code] : Number(optimum.actualFactors[factorX.code]) || 0],
        y: [typeof optimum.actualFactors[factorY.code] === 'number' ? optimum.actualFactors[factorY.code] : Number(optimum.actualFactors[factorY.code]) || 0],
        marker: { size: 14, color: '#1e3a8a', symbol: 'star' },
        text: ['Điểm Vận Hành Đề Xuất (Target)'],
        textposition: 'top center',
        name: 'Target Setpoint',
      });
    }

    return data;
  }, [sweetSpotGrid, factorX, factorY, optimum, smoothness, showBoundaryLines]);

  const overlayLayout = {
    title: `Vùng Thiết Kế (Design Space Overlay) - Giao điểm Tất cả các CQAs`,
    xaxis: {
      title: {
        text: `${factorX.name} (${factorX.code})${factorX.unit ? ` [${factorX.unit}]` : ''}`,
        font: { size: 13, color: '#1e293b' },
        standoff: 12,
      },
      tickfont: { size: 11 },
      automargin: true,
    },
    yaxis: {
      title: {
        text: `${factorY.name} (${factorY.code})${factorY.unit ? ` [${factorY.unit}]` : ''}`,
        font: { size: 13, color: '#1e293b' },
        standoff: 12,
      },
      tickfont: { size: 11 },
      automargin: true,
    },
    annotations: [
      {
        xref: 'paper',
        yref: 'paper',
        x: 0.05,
        y: 0.95,
        text: '🟩 Vùng Xanh: Design Space (100% CQAs Đạt Chuẩn)<br>🟥 Vùng Đỏ: Không đạt tiêu chuẩn (OOS)',
        showarrow: false,
        bgcolor: '#ffffff',
        bordercolor: '#cbd5e1',
        borderwidth: 1,
        font: { size: 11 },
      },
    ],
    margin: { l: 85, r: 40, t: 50, b: 75, pad: 4 },
  };

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
                  ? 'Desirability Profiler, Sweet Spot 2D và Mô phỏng Monte Carlo đang tính toán trực tiếp trên trọng số Mạng Nơ-ron.'
                  : 'Desirability Profiler, Sweet Spot 2D và Mô phỏng Monte Carlo đang tính toán trực tiếp từ hệ số hồi quy Đa thức.'}
              </div>
            </div>
          </div>

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

      {/* 2. Sweet Spot / Design Space 2D Overlay Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Boxes size={22} color="#1e3a8a" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
            Mặt Cắt 2D Vùng Thiết Kế (Design Space Overlay Sweet Spot - ICH Q8/Q10)
          </h2>
        </div>
        <button
          onClick={onNavigateToReport}
          className="btn btn-teal"
          style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem' }}
        >
          <span>Xem Báo Cáo Hồ Sơ</span>
          <ArrowRight size={15} />
        </button>
      </div>

      {/* Sweet Spot Overlay & Range Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem' }}>
        
        {/* Sweet Spot Plotly Chart with Resolution & Smoothness Toolbar */}
        <div className="qbd-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.75rem' }}>
          {/* Resolution & Smoothness Controls Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.6rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#f8fafc',
              borderRadius: '0.5rem',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Settings2 size={16} color="#1e3a8a" />
              <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#0f172a' }}>
                Độ phân giải & Đường đồng mức:
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              {/* Resolution Buttons & Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.73rem', fontWeight: '600', color: '#475569' }}>
                  Lưới (Resolution):
                </span>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  {[
                    { label: '60×60', val: 60, desc: 'Nhanh' },
                    { label: '120×120', val: 120, desc: 'Chuẩn' },
                    { label: '180×180', val: 180, desc: 'Mịn (Khuyến nghị)' },
                    { label: '250×250', val: 250, desc: 'Siêu Mịn (Ultra HD)' },
                    { label: '300×300', val: 300, desc: 'Vector Smooth (Siêu Nét)' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => setResolution(preset.val)}
                      className={`btn ${resolution === preset.val ? 'btn-primary' : 'btn-secondary'}`}
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.18rem 0.4rem',
                        borderRadius: '0.25rem',
                        fontWeight: resolution === preset.val ? '700' : '500',
                      }}
                      title={`Độ phân giải lưới ${preset.label} (${preset.desc})`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Smoothness Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.73rem', fontWeight: '600', color: '#475569' }}>
                  Độ mượt (Smooth):
                </span>
                <input
                  type="range"
                  min={0}
                  max={1.3}
                  step={0.05}
                  value={smoothness}
                  onChange={(e) => setSmoothness(Number(e.target.value))}
                  style={{ width: '70px', cursor: 'pointer' }}
                  title={`Độ mượt: ${smoothness.toFixed(2)}`}
                />
                <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: '700', color: '#1e40af', minWidth: '24px' }}>
                  {smoothness.toFixed(2)}
                </span>
              </div>

              {/* Boundary Lines Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem', color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showBoundaryLines}
                  onChange={(e) => setShowBoundaryLines(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span>Đường viền ranh giới</span>
              </label>
            </div>
          </div>

          {/* Plotly Canvas */}
          <div style={{ height: '520px', width: '100%' }}>
            <PlotlyChart data={overlayPlotData} layout={overlayLayout} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Axis & Control Strategy Ranges */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Axis Selector */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
              Trục Tọa Độ Sweet Spot
            </h3>
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

          {/* Remaining Factors Slice Adjuster (Input Box + Range Slider) */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <h3 style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sliders size={16} color="#b45309" />
                <span>Điều Chỉnh Các Biến X Còn Lại</span>
              </h3>
              {optimum && factors.length > 2 && (
                <button
                  onClick={() => {
                    setSliceFactorsCoded({ ...optimum.codedFactors });
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', gap: '0.25rem' }}
                  title="Khôi phục toàn bộ các biến về điểm tối ưu"
                >
                  <RotateCcw size={11} />
                  <span>Về Điểm Tối Ưu</span>
                </button>
              )}
            </div>

            <p style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.75rem', lineHeight: '1.4' }}>
              Mặt cắt 2D của Vùng thiết kế phụ thuộc vào giá trị cài đặt của các biến X còn lại. Nhập số hoặc kéo thanh trượt để khảo sát không gian đa chiều:
            </p>

            {factors.filter((f) => f.code !== xAxisFactor && f.code !== yAxisFactor).length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: '#64748b', backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '0.375rem', textAlign: 'center' }}>
                Tất cả các biến đã được hiển thị trên Trục X và Trục Y.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {factors
                  .filter((f) => f.code !== xAxisFactor && f.code !== yAxisFactor)
                  .map((f) => {
                    const coded = sliceFactorsCoded[f.code] ?? 0;
                    const actual = codedToActual(coded, f);
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

                    if (f.dataType === 'qualitative' && f.categories && f.categories.length > 0) {
                      return (
                        <div key={f.code} style={{ backgroundColor: '#f8fafc', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.3rem' }}>
                            {f.name} ({f.code}):
                          </div>
                          <select
                            className="input-field"
                            style={{ fontSize: '0.78rem' }}
                            value={typeof actual === 'string' ? actual : f.categories[0]}
                            onChange={(e) => {
                              const newCoded = actualToCoded(e.target.value, f);
                              setSliceFactorsCoded((prev) => ({ ...prev, [f.code]: newCoded }));
                            }}
                          >
                            {f.categories.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={f.code}
                        style={{
                          backgroundColor: '#f8fafc',
                          padding: '0.75rem',
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                          <label style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>Giá trị thực:</label>
                          <input
                            type="number"
                            step="any"
                            className="input-field font-mono"
                            style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.82rem', fontWeight: '700', color: '#b45309' }}
                            value={typeof actual === 'number' ? actual : Number(actual) || 0}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (!isNaN(val)) {
                                const center = f.center !== undefined ? f.center : (f.low + f.high) / 2;
                                const half = (f.high - f.low) / 2;
                                const newCoded = half > 0 ? (val - center) / half : 0;
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
                        <div style={{ marginTop: '0.2rem' }}>
                          <input
                            type="range"
                            min={-1}
                            max={1}
                            step={0.01}
                            value={coded}
                            onChange={(e) => {
                              setSliceFactorsCoded((prev) => ({
                                ...prev,
                                [f.code]: Number(e.target.value),
                              }));
                            }}
                            style={{ width: '100%', cursor: 'pointer' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8' }}>
                            <span>{f.low} {f.unit} (-1)</span>
                            <span className="font-mono">Mã: {coded >= 0 ? `+${coded.toFixed(2)}` : coded.toFixed(2)}</span>
                            <span>{f.high} {f.unit} (+1)</span>
                          </div>
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

    </div>
  );
};
