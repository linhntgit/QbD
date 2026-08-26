import React, { useState } from 'react';
import {
  Calculator,
  BarChart3,
  AlertCircle,
  ArrowRight,
  BrainCircuit,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  ModelType,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { normalInverseCDF } from '../../services/mathUtils';

interface StatisticalANOVATabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult>;
  selectedCQA: string;
  onSelectCQA: (cqaCode: string) => void;
  modelTypes: Record<string, ModelType>;
  onModelTypeChange: (cqaCode: string, type: ModelType) => void;
  modelingEngine?: ModelingEngine;
  onSelectEngine?: (engine: ModelingEngine) => void;
  onNavigateToRSM: () => void;
  onNavigateToNeural?: () => void;
}

export const StatisticalANOVATab: React.FC<StatisticalANOVATabProps> = ({
  project,
  models,
  selectedCQA,
  onSelectCQA,
  modelTypes,
  onModelTypeChange,
  modelingEngine,
  onSelectEngine,
  onNavigateToRSM,
  onNavigateToNeural,
}) => {
  const [activeDiagPlot, setActiveDiagPlot] = useState<'pareto' | 'resPred' | 'normProb' | 'cooks'>('pareto');

  const currentCQA = project.cqas.find((c) => c.code === selectedCQA) || project.cqas[0];
  const model = currentCQA ? models[currentCQA.code] : null;

  if (!currentCQA) {
    return (
      <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <p>Vui lòng thêm ít nhất một chỉ tiêu CQA ở Tab 1.</p>
      </div>
    );
  }

  // Diagnostic Plots Data Preparation
  const renderDiagnosticPlot = () => {
    if (!model) return null;

    switch (activeDiagPlot) {
      case 'pareto': {
        // Exclude intercept and sort terms by |tValue| descending
        const effectTerms = model.terms
          .filter((t) => t.name !== 'Intercept')
          .sort((a, b) => Math.abs(b.tValue) - Math.abs(a.tValue));

        const names = effectTerms.map((t) => t.name);
        const tVals = effectTerms.map((t) => Math.abs(t.tValue));
        const colors = effectTerms.map((t) => (t.significant ? '#1e3a8a' : '#94a3b8'));

        const data = [
          {
            type: 'bar',
            x: tVals,
            y: names,
            orientation: 'h',
            marker: { color: colors },
            text: tVals.map((v) => v.toFixed(2)),
            textposition: 'auto',
          },
        ];

        const layout = {
          title: `Biểu đồ Pareto các Hiệu ứng Chuẩn hóa (|t-value|) - ${currentCQA.name}`,
          xaxis: { title: 'T-Value of Effect (Standardized)' },
          yaxis: { autorange: 'reversed' },
          shapes: [
            {
              type: 'line',
              x0: 2.086, // ~ t critical alpha=0.05
              x1: 2.086,
              y0: -0.5,
              y1: names.length - 0.5,
              line: { color: '#dc2626', width: 2, dash: 'dash' },
            },
          ],
          annotations: [
            {
              x: 2.086,
              y: 0,
              text: 'Ngưỡng p = 0.05 (t-Critical)',
              showarrow: true,
              arrowhead: 2,
              ax: 40,
              ay: -20,
              font: { color: '#dc2626', size: 11 },
            },
          ],
          margin: { l: 80, r: 40, t: 40, b: 40 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '350px' }} />;
      }

      case 'resPred': {
        const xPred = model.diagnostics.residuals.map((r) => r.predicted);
        const yRes = model.diagnostics.residuals.map((r) => r.studentizedResidual);

        const data = [
          {
            type: 'scatter',
            mode: 'markers',
            x: xPred,
            y: yRes,
            marker: { size: 9, color: '#0f766e' },
            text: model.diagnostics.residuals.map((r) => `Run #${r.runOrder}: Act=${r.actual}, Pred=${r.predicted.toFixed(2)}`),
          },
        ];

        const layout = {
          title: `Phần dư Chuẩn hóa vs. Giá trị Dự đoán (Residuals vs. Predicted)`,
          xaxis: { title: `Giá trị Dự đoán (${currentCQA.unit})` },
          yaxis: { title: 'Internally Studentized Residuals', range: [-3.5, 3.5] },
          shapes: [
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: 0, y1: 0, line: { color: '#64748b', width: 1 } },
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: 3, y1: 3, line: { color: '#dc2626', width: 1, dash: 'dot' } },
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: -3, y1: -3, line: { color: '#dc2626', width: 1, dash: 'dot' } },
          ],
          margin: { l: 60, r: 40, t: 40, b: 40 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '350px' }} />;
      }

      case 'normProb': {
        // Sort studentized residuals
        const sortedRes = [...model.diagnostics.residuals]
          .map((r) => r.studentizedResidual)
          .sort((a, b) => a - b);
        const n = sortedRes.length;
        const theoreticalZ = sortedRes.map((_, i) => normalInverseCDF((i + 0.5) / n));

        const data = [
          {
            type: 'scatter',
            mode: 'markers',
            x: sortedRes,
            y: theoreticalZ.map((z) => normalInverseCDF(normalInverseCDF(z)) * 0 + z), // z-scores
            marker: { size: 9, color: '#1e3a8a' },
            name: 'Residuals',
          },
          {
            type: 'line',
            x: [-3, 3],
            y: [-3, 3],
            line: { color: '#dc2626', width: 2 },
            name: 'Đường Chuẩn (Normal Line)',
          },
        ];

        const layout = {
          title: `Biểu đồ Xác suất Chuẩn của Phần dư (Normal Probability Plot)`,
          xaxis: { title: 'Internally Studentized Residuals', range: [-3.5, 3.5] },
          yaxis: { title: 'Theoretical Quantiles (Z-score)', range: [-3.5, 3.5] },
          margin: { l: 60, r: 40, t: 40, b: 40 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '350px' }} />;
      }

      case 'cooks': {
        const runs = model.diagnostics.residuals.map((r) => r.runOrder);
        const cooks = model.diagnostics.residuals.map((r) => r.cooksDistance);

        const data = [
          {
            type: 'bar',
            x: runs,
            y: cooks,
            marker: { color: '#b45309' },
            text: cooks.map((c) => c.toFixed(3)),
          },
        ];

        const layout = {
          title: `Khoảng cách Cook (Cook's Distance - Đánh giá Điểm Ngoại lai / Ảnh hưởng)`,
          xaxis: { title: 'Số thứ tự lần chạy (Run Order)' },
          yaxis: { title: "Cook's Distance" },
          shapes: [
            {
              type: 'line',
              x0: 0.5,
              x1: runs.length + 0.5,
              y0: 1.0,
              y1: 1.0,
              line: { color: '#dc2626', width: 2, dash: 'dash' },
            },
          ],
          margin: { l: 60, r: 40, t: 40, b: 40 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '350px' }} />;
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Top Header Card */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Calculator size={22} color="#1e3a8a" />
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Phân Tích Thống Kê & Mô Hình Hóa ANOVA
              </h2>
              {modelingEngine === 'polynomial' && (
                <span className="badge badge-teal" style={{ fontSize: '0.72rem' }}>
                  ✓ Đang Chọn Làm Mô Hình Chính (Bước 6, 7, 8)
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
              Ước lượng hồi quy đa thức, kiểm định mức ý nghĩa F-test, p-value và đánh giá độ phù hợp của mô hình theo ICH Q8.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* CQA Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#475569' }}>Đáp ứng CQA:</label>
              <select
                className="input-field"
                style={{ width: '180px', fontWeight: '600', color: '#1e3a8a' }}
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

            {/* Model Type Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#475569' }}>Dạng mô hình:</label>
              <select
                className="input-field"
                style={{ width: '170px' }}
                value={modelTypes[selectedCQA] || 'Quadratic'}
                onChange={(e) => onModelTypeChange(selectedCQA, e.target.value as ModelType)}
              >
                <option value="Quadratic">Đa thức Bậc 2 (Quadratic)</option>
                <option value="2FI">Tương tác 2 Nhân tố (2FI)</option>
                <option value="Linear">Tuyến tính (Linear)</option>
              </select>
            </div>

            {onNavigateToNeural && (
              <button
                onClick={onNavigateToNeural}
                className="btn btn-secondary"
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
                title="Chuyển sang Tab Mạng Nơ-ron AI để thử nghiệm mô hình học sâu"
              >
                <BrainCircuit size={16} color="#7c3aed" />
                <span>Thử Mạng Nơ-ron</span>
              </button>
            )}

            <button
              onClick={() => {
                onSelectEngine?.('polynomial');
                onNavigateToRSM();
              }}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem', fontWeight: '700' }}
              title="Chọn mô hình Hồi quy Đa thức bậc ≤ 2 làm phương pháp chính cho các bước tiếp theo (Bước 6: Bề mặt, Bước 7: Vùng thiết kế, Bước 8: Báo cáo)"
            >
              <span>Tiếp Tục Với Đa Thức (Bước 6, 7, 8)</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {!model ? (
        <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          <AlertCircle size={40} color="#f59e0b" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ fontWeight: '600', fontSize: '1rem', color: '#0f172a' }}>
            Chưa đủ số liệu thực nghiệm để khớp mô hình
          </p>
          <p style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
            Vui lòng nhập kết quả thí nghiệm trong Tab 3 (DoE Designer) hoặc bấm nút "Điền Số Liệu Mô Phỏng".
          </p>
        </div>
      ) : (
        <>
          {/* Fit Metrics Summary Gauges */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            {/* R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #1e3a8a' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>R-SQUARED (R²)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1e3a8a', margin: '0.2rem 0' }}>
                {model.diagnostics.rSquared.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: model.diagnostics.rSquared > 0.8 ? '#15803d' : '#b45309' }}>
                {model.diagnostics.rSquared > 0.8 ? '✓ Độ khớp mô hình cao' : '⚠ Cân nhắc đổi dạng mô hình'}
              </div>
            </div>

            {/* Adjusted R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #0f766e' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>ADJUSTED R²</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0f766e', margin: '0.2rem 0' }}>
                {model.diagnostics.adjRSquared.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Hiệu chỉnh theo số bậc tự do</div>
            </div>

            {/* Predicted R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #3b82f6' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>PREDICTED R² (PRESS)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#3b82f6', margin: '0.2rem 0' }}>
                {model.diagnostics.predRSquared.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Khả năng dự đoán điểm mới</div>
            </div>

            {/* Adequate Precision */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #8b5cf6' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>ADEQUATE PRECISION</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#8b5cf6', margin: '0.2rem 0' }}>
                {model.diagnostics.adeqPrecision.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.72rem', color: model.diagnostics.adeqPrecision >= 4.0 ? '#15803d' : '#dc2626' }}>
                {model.diagnostics.adeqPrecision >= 4.0 ? '✓ Đạt chuẩn (> 4.0)' : '⚠ Không đạt (< 4.0)'}
              </div>
            </div>

            {/* Std Dev & CV */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>ĐỘ LỆCH CHUẨN / CV %</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#f59e0b', margin: '0.2rem 0' }}>
                {model.diagnostics.stdDev.toFixed(3)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>CV = {model.diagnostics.cvPercent.toFixed(2)}%</div>
            </div>
          </div>

          {/* Mathematical Regression Equation Box */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '0.5rem',
              padding: '1rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#475569', marginBottom: '0.35rem' }}>
              PHƯƠNG TRÌNH HỒI QUY TOÁN HỌC (THEO GIÁ TRỊ MÃ HÓA CODED FACTORS):
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: '0.92rem',
                color: '#1e3a8a',
                fontWeight: '600',
                lineHeight: '1.6',
                overflowX: 'auto',
              }}
            >
              {model.equationString}
            </div>
          </div>

          {/* ANOVA Table & Term Estimates Side-by-Side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1.5rem' }}>
            
            {/* ANOVA Table */}
            <div className="qbd-card">
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
                Bảng Phân Tích Phương Sai (ANOVA Table)
              </h3>
              <div className="table-container">
                <table className="qbd-table">
                  <thead>
                    <tr>
                      <th>Nguồn (Source)</th>
                      <th>Tổng BP (SS)</th>
                      <th style={{ textAlign: 'center' }}>df</th>
                      <th>TB BP (MS)</th>
                      <th style={{ textAlign: 'center' }}>F-value</th>
                      <th style={{ textAlign: 'center' }}>p-value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.anova.map((row, idx) => (
                      <tr key={idx} style={{ fontWeight: row.source === 'Model' || row.source === 'Residual' ? '600' : 'normal' }}>
                        <td>{row.source}</td>
                        <td>{row.ss.toFixed(3)}</td>
                        <td style={{ textAlign: 'center' }}>{row.df}</td>
                        <td>{row.ms.toFixed(3)}</td>
                        <td style={{ textAlign: 'center' }}>
                          {row.fValue !== undefined ? row.fValue.toFixed(2) : '-'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {row.pValue !== undefined ? (
                            <span
                              className={`badge ${row.pValue < 0.05 ? 'badge-success' : 'badge-danger'}`}
                            >
                              {row.pValue < 0.001 ? '< 0.001' : row.pValue.toFixed(4)}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Regression Term Estimates */}
            <div className="qbd-card">
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.75rem' }}>
                Hệ Số Hồi Quy (Coefficients & Significance)
              </h3>
              <div className="table-container">
                <table className="qbd-table">
                  <thead>
                    <tr>
                      <th>Số Hạng (Term)</th>
                      <th>Hệ số (β)</th>
                      <th>Sai số (SE)</th>
                      <th style={{ textAlign: 'center' }}>t-value</th>
                      <th style={{ textAlign: 'center' }}>p-value</th>
                      <th style={{ textAlign: 'center' }}>Ý Nghĩa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.terms.map((term, idx) => (
                      <tr key={idx}>
                        <td className="font-mono" style={{ fontWeight: '600', color: '#1e3a8a' }}>
                          {term.name}
                        </td>
                        <td style={{ fontWeight: '600' }}>{term.coefficient.toFixed(4)}</td>
                        <td>{term.stdError.toFixed(4)}</td>
                        <td style={{ textAlign: 'center' }}>{term.tValue.toFixed(2)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`badge ${term.significant ? 'badge-success' : 'badge-warning'}`}
                          >
                            {term.pValue < 0.001 ? '< 0.001' : term.pValue.toFixed(4)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {term.significant ? (
                            <span style={{ color: '#15803d', fontWeight: '600' }}>✓ p &lt; 0.05</span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Không</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Diagnostic Plots Card */}
          <div className="qbd-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BarChart3 size={19} color="#1e3a8a" />
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                  Đồ Thị Chẩn Đoán Mô Hình (Model Diagnostic Plots)
                </h3>
              </div>

              <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem' }}>
                <button
                  onClick={() => setActiveDiagPlot('pareto')}
                  className={`btn ${activeDiagPlot === 'pareto' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Biểu đồ Pareto
                </button>
                <button
                  onClick={() => setActiveDiagPlot('resPred')}
                  className={`btn ${activeDiagPlot === 'resPred' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Phần dư vs Dự đoán
                </button>
                <button
                  onClick={() => setActiveDiagPlot('normProb')}
                  className={`btn ${activeDiagPlot === 'normProb' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Xác suất Chuẩn (Normal Plot)
                </button>
                <button
                  onClick={() => setActiveDiagPlot('cooks')}
                  className={`btn ${activeDiagPlot === 'cooks' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', border: 'none' }}
                >
                  Khoảng cách Cook
                </button>
              </div>
            </div>

            {renderDiagnosticPlot()}
          </div>
        </>
      )}

    </div>
  );
};
