import React, { useState, useMemo } from 'react';
import {
  Compass,
  Sliders,
  Layers,
  ArrowRight,
  Calculator,
  BrainCircuit,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetModelResult,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { codedToActual } from '../../services/doeGenerator';

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

  // Selected Axis Factors
  const [xAxisFactor, setXAxisFactor] = useState<string>(factors[0]?.code || 'X1');
  const [yAxisFactor, setYAxisFactor] = useState<string>(factors[1]?.code || 'X2');

  // Fixed factors values (coded in [-1, 1])
  const [fixedFactorCoded, setFixedFactorCoded] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    factors.forEach((f) => {
      init[f.code] = 0; // default at center point
    });
    return init;
  });

  const [plotType, setPlotType] = useState<'3d' | 'contour' | 'ternary'>('3d');
  const [colorScale, setColorScale] = useState<string>('Viridis');

  const mixtureFactors = factors.filter((f) => f.role === 'mixture_component');
  const hasMixture = mixtureFactors.length >= 3;

  const factorX = factors.find((f) => f.code === xAxisFactor) || factors[0];
  const factorY = factors.find((f) => f.code === yAxisFactor) || factors[1];

  // Grid calculation for 3D Surface & Contour
  const surfaceGrid = useMemo(() => {
    if (!model || !factorX || !factorY) return null;

    const N = 35; // 35x35 resolution
    const xCodedArr: number[] = [];
    const yCodedArr: number[] = [];
    const xActualArr: number[] = [];
    const yActualArr: number[] = [];

    for (let i = 0; i < N; i++) {
      const coded = -1.0 + (2.0 * i) / (N - 1);
      xCodedArr.push(coded);
      yCodedArr.push(coded);
      const xAct = codedToActual(coded, factorX);
      const yAct = codedToActual(coded, factorY);
      xActualArr.push(typeof xAct === 'number' ? xAct : Number(xAct) || coded);
      yActualArr.push(typeof yAct === 'number' ? yAct : Number(yAct) || coded);
    }

    const zGrid: number[][] = [];

    for (let j = 0; j < N; j++) {
      const row: number[] = [];
      const yCoded = yCodedArr[j];

      for (let i = 0; i < N; i++) {
        const xCoded = xCodedArr[i];
        const pointCoded: Record<string, number> = { ...fixedFactorCoded };
        pointCoded[factorX.code] = xCoded;
        pointCoded[factorY.code] = yCoded;

        const pred = model.predict(pointCoded);
        row.push(Number(pred.toFixed(3)));
      }
      zGrid.push(row);
    }

    return {
      xActualArr,
      yActualArr,
      zGrid,
    };
  }, [model, factorX, factorY, fixedFactorCoded]);

  // Ternary Mesh Calculation for 3-component Mixture
  const ternaryData = useMemo(() => {
    if (!hasMixture || !model) return null;
    const fA = mixtureFactors[0];
    const fB = mixtureFactors[1];
    const fC = mixtureFactors[2];

    const N = 36;
    const aArr: number[] = [];
    const bArr: number[] = [];
    const cArr: number[] = [];
    const zArr: number[] = [];
    const textArr: string[] = [];

    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N - i; j++) {
        const a = i / N;
        const b = j / N;
        const c = Math.max(0, 1.0 - a - b);

        const pointCoded: Record<string, number> = { ...fixedFactorCoded };
        pointCoded[fA.code] = a;
        pointCoded[fB.code] = b;
        pointCoded[fC.code] = c;

        const pred = model.predict(pointCoded);
        aArr.push(Number((a * 100).toFixed(1)));
        bArr.push(Number((b * 100).toFixed(1)));
        cArr.push(Number((c * 100).toFixed(1)));
        zArr.push(Number(pred.toFixed(2)));
        textArr.push(
          `${fA.name}: ${(a * 100).toFixed(1)}%<br>${fB.name}: ${(b * 100).toFixed(1)}%<br>${fC.name}: ${(c * 100).toFixed(1)}%<br><b>${currentCQA.name}: ${pred.toFixed(2)} ${currentCQA.unit}</b>`
        );
      }
    }

    return { fA, fB, fC, aArr, bArr, cArr, zArr, textArr };
  }, [hasMixture, mixtureFactors, model, fixedFactorCoded, currentCQA]);

  if (!model || !surfaceGrid) {
    return (
      <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p>Vui lòng tạo mô hình ANOVA trước khi xem bề mặt đáp ứng.</p>
      </div>
    );
  }

  // Generate Plotly Data
  let plotlyData: any[] = [];
  let plotlyLayout: any = {};

  if (plotType === 'ternary' && ternaryData) {
    plotlyData = [
      {
        type: 'scatterternary',
        mode: 'markers',
        a: ternaryData.aArr,
        b: ternaryData.bArr,
        c: ternaryData.cArr,
        text: ternaryData.textArr,
        hoverinfo: 'text',
        marker: {
          symbol: 'circle',
          color: ternaryData.zArr,
          colorscale: colorScale,
          size: 10,
          colorbar: {
            title: `${currentCQA.code} (${currentCQA.unit})`,
            len: 0.8,
          },
          showscale: true,
        },
      },
    ];

    plotlyLayout = {
      title: `Biểu Đồ Tam Giác Hỗn Hợp (Ternary Surface): ${currentCQA.name} (${currentCQA.code})`,
      autosize: true,
      margin: { l: 40, r: 40, b: 40, t: 50 },
      ternary: {
        sum: 100,
        aaxis: { title: `${ternaryData.fA.name} (%)`, min: 0.01, linewidth: 2, ticks: 'outside' },
        baxis: { title: `${ternaryData.fB.name} (%)`, min: 0.01, linewidth: 2, ticks: 'outside' },
        caxis: { title: `${ternaryData.fC.name} (%)`, min: 0.01, linewidth: 2, ticks: 'outside' },
      },
    };
  } else {
    plotlyData = [
      plotType === '3d'
        ? {
            type: 'surface',
            x: surfaceGrid.xActualArr,
            y: surfaceGrid.yActualArr,
            z: surfaceGrid.zGrid,
            colorscale: colorScale,
            contours: {
              z: {
                show: true,
                usecolormap: true,
                highlightcolor: '#ffffff',
                project: { z: true },
              },
            },
            hoverinfo: 'x+y+z',
          }
        : {
            type: 'contour',
            x: surfaceGrid.xActualArr,
            y: surfaceGrid.yActualArr,
            z: surfaceGrid.zGrid,
            colorscale: colorScale,
            contours: {
              coloring: 'heatmap',
              showlabels: true,
              labelfont: { family: 'Inter', size: 12, color: 'white' },
            },
            hoverinfo: 'x+y+z',
          },
    ];

    plotlyLayout = {
      title: `${plotType === '3d' ? 'Bề Mặt Đáp Ứng 3D' : 'Đường Đồng Mức 2D'}: ${currentCQA.name} (${currentCQA.code})`,
      autosize: true,
      margin: { l: 40, r: 40, b: 40, t: 50 },
      scene: {
        xaxis: { title: `${factorX.name} (${factorX.unit})` },
        yaxis: { title: `${factorY.name} (${factorY.unit})` },
        zaxis: { title: `${currentCQA.name} (${currentCQA.unit})` },
        camera: {
          eye: { x: 1.6, y: 1.6, z: 1.2 },
        },
      },
      xaxis: { title: `${factorX.name} (${factorX.unit})` },
      yaxis: { title: `${factorY.name} (${factorY.unit})` },
    };
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Control Header */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Compass size={22} color="#0f766e" />
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Trực Quan Hóa Bề Mặt Đáp Ứng (Response Surface 3D & 2D Contour)
              </h2>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
              Khảo sát hình thái cực trị, độ cong và tương tác giữa các thông số công thức / quy trình.
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
                  title="Hiển thị bề mặt đáp ứng từ mô hình Hồi quy Đa thức bậc ≤ 2 (ANOVA)"
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
                  title="Hiển thị bề mặt đáp ứng từ mô hình Mạng Nơ-ron Nhân Tạo"
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

            {/* 3D / 2D / Ternary Toggle */}
            <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem', gap: '0.2rem' }}>
              <button
                onClick={() => setPlotType('3d')}
                className={`btn ${plotType === '3d' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', border: 'none' }}
              >
                3D Surface
              </button>
              <button
                onClick={() => setPlotType('contour')}
                className={`btn ${plotType === 'contour' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', border: 'none' }}
              >
                2D Contour
              </button>
              {hasMixture && (
                <button
                  onClick={() => setPlotType('ternary')}
                  className={`btn ${plotType === 'ternary' ? 'btn-teal' : 'btn-secondary'}`}
                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', border: 'none', fontWeight: '600' }}
                  title="Biểu đồ Tam Giác Hỗn Hợp (Ternary Triangular Plot)"
                >
                  🧪 Ternary
                </button>
              )}
            </div>

            {/* Colorscale */}
            <select
              className="input-field"
              style={{ width: '130px', fontSize: '0.8rem' }}
              value={colorScale}
              onChange={(e) => setColorScale(e.target.value)}
            >
              <option value="Viridis">Viridis</option>
              <option value="Jet">Jet (Rainbow)</option>
              <option value="Plasma">Plasma</option>
              <option value="Hot">Hot</option>
              <option value="Tealrose">Tealrose</option>
            </select>

            <button
              onClick={onNavigateToDesignSpace}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
            >
              <span>Vùng Thiết Kế (Design Space)</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Axis & Sliders Sidebar + Plotly Viewer */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
        
        {/* Left Control Panel: Axes & Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Axis Selector Card */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={16} color="#1e3a8a" />
              <span>Trục Tọa Độ Khảo Sát</span>
            </h3>

            <div style={{ marginBottom: '0.85rem' }}>
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

          {/* Fixed Factors Sliders Card */}
          <div className="qbd-card">
            <h3 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sliders size={16} color="#b45309" />
              <span>Cố Định Các Yếu Tố Còn Lại</span>
            </h3>

            {factors.filter((f) => f.code !== xAxisFactor && f.code !== yAxisFactor).length === 0 ? (
              <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                Tất cả các yếu tố đã được chọn trên trục X và Y.
              </p>
            ) : (
              factors
                .filter((f) => f.code !== xAxisFactor && f.code !== yAxisFactor)
                .map((f) => {
                  const coded = fixedFactorCoded[f.code] ?? 0;
                  const actual = codedToActual(coded, f);
                  return (
                    <div key={f.code} style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontWeight: '600', color: '#1e293b' }}>
                          {f.name} ({f.code}):
                        </span>
                        <span className="font-mono" style={{ fontWeight: '700', color: '#b45309' }}>
                          {actual} {f.unit} (Mã: {coded.toFixed(2)})
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={coded}
                        onChange={(e) => {
                          setFixedFactorCoded({
                            ...fixedFactorCoded,
                            [f.code]: Number(e.target.value),
                          });
                        }}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                        <span>{f.low} {f.unit} (-1)</span>
                        <span>{f.center ?? (f.low + f.high) / 2} (0)</span>
                        <span>{f.high} {f.unit} (+1)</span>
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          {/* Quick Specifications Info */}
          <div className="qbd-card" style={{ backgroundColor: '#f0fdfa', border: '1px solid #ccfbf1' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#0f766e', marginBottom: '0.35rem' }}>
              TIÊU CHUẨN CỦA {currentCQA.code}:
            </div>
            <div style={{ fontSize: '0.78rem', color: '#134e4a' }}>
              <div>• Mục tiêu: <strong>{currentCQA.target ?? 'N/A'} {currentCQA.unit}</strong></div>
              <div>• Giới hạn: <strong>{currentCQA.lowerLimit ?? '-'}</strong> đến <strong>{currentCQA.upperLimit ?? '-'} {currentCQA.unit}</strong></div>
              <div>• Hướng tối ưu: <strong>{currentCQA.objective.toUpperCase()}</strong></div>
            </div>
          </div>

        </div>

        {/* Right 3D Surface / Contour WebGL Viewer */}
        <div className="qbd-card" style={{ height: '620px', padding: '0.5rem' }}>
          <PlotlyChart data={plotlyData} layout={plotlyLayout} style={{ width: '100%', height: '100%' }} />
        </div>

      </div>

    </div>
  );
};
