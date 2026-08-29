import React, { useMemo, useState } from 'react';
import {
  Calculator,
  BarChart3,
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  ShieldCheck,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  NeuralNetModelResult,
  ModelType,
  ModelingEngine,
} from '../../types/qbd';
import { PlotlyChart } from '../PlotlyChart';
import { normalInverseCDF, formatAxisTitle } from '../../services/mathUtils';
import { assessModelCandidates, buildConfirmationPlan, generateUpdatedRiskAssessment } from '../../services/statistics';

interface StatisticalANOVATabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult>;
  neuralModels?: Record<string, NeuralNetModelResult>;
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
  neuralModels = {},
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
  const executionBlocks = new Set(project.runs.map((run) => run.block ?? 1));
  const appliedModelType: ModelType = currentCQA
    ? (modelTypes[currentCQA.code] || model?.modelType || 'Quadratic')
    : 'Quadratic';
  const analysisWizard = useMemo(
    () => currentCQA ? assessModelCandidates(currentCQA, project.factors, project.runs) : null,
    [currentCQA, project.factors, project.runs],
  );
  const confirmationPlan = useMemo(
    () => currentCQA && model
      ? buildConfirmationPlan(currentCQA, model, project.runs)
      : null,
    [currentCQA, model, project.runs],
  );

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

        const formatTermName = (termName: string) => {
          // If pure single factor like X1
          const singleFactor = project.factors.find((f) => f.code === termName);
          if (singleFactor) {
            return `${singleFactor.code}: ${singleFactor.name}${singleFactor.unit ? ` [${singleFactor.unit}]` : ''}`;
          }
          // If squared term like X1²
          if (termName.endsWith('²')) {
            const baseCode = termName.replace('²', '');
            const f = project.factors.find((fac) => fac.code === baseCode);
            if (f) {
              return `${termName}: ${f.name}²`;
            }
          }
          // If interaction like X1*X2
          if (termName.includes('*')) {
            const parts = termName.split('*');
            const f1 = project.factors.find((fac) => fac.code === parts[0]);
            const f2 = project.factors.find((fac) => fac.code === parts[1]);
            if (f1 && f2) {
              return `${parts[0]}*${parts[1]}: ${f1.name} × ${f2.name}`;
            }
          }
          return termName;
        };

        const names = effectTerms.map((t) => formatTermName(t.name));
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
          title: `Biểu đồ Pareto các Hiệu ứng Chuẩn hóa (|t-value|) - ${currentCQA.name} (${currentCQA.code})${currentCQA.unit ? ` [${currentCQA.unit}]` : ''}`,
          xaxis: {
            title: {
              text: 'T-Value of Effect (Chuẩn hóa |t-value|)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            autorange: 'reversed',
            tickfont: { size: 11 },
            automargin: true,
          },
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
          margin: { l: 280, r: 40, t: 50, b: 70, pad: 10 },
        };

        return <PlotlyChart data={data} layout={layout} style={{ height: '380px' }} />;
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
            text: model.diagnostics.residuals.map((r) => `Run #${r.runOrder}: Thực tế=${r.actual} ${currentCQA.unit || ''}, Dự đoán=${r.predicted.toFixed(2)} ${currentCQA.unit || ''}`),
          },
        ];

        const layout = {
          title: `Phần dư Chuẩn hóa vs. Giá trị Dự đoán - ${currentCQA.name} (${currentCQA.code})`,
          xaxis: {
            title: {
              text: formatAxisTitle('Giá trị Dự đoán Ý', currentCQA.code, currentCQA.unit),
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: 'Internally Studentized Residuals (Phần dư Student hóa)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            range: [-3.5, 3.5],
            tickfont: { size: 10 },
            automargin: true,
          },
          shapes: [
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: 0, y1: 0, line: { color: '#64748b', width: 1 } },
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: 3, y1: 3, line: { color: '#dc2626', width: 1, dash: 'dot' } },
            { type: 'line', x0: Math.min(...xPred) * 0.95, x1: Math.max(...xPred) * 1.05, y0: -3, y1: -3, line: { color: '#dc2626', width: 1, dash: 'dot' } },
          ],
          margin: { l: 80, r: 40, t: 50, b: 70, pad: 4 },
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
            y: theoreticalZ, // z-scores
            marker: { size: 9, color: '#1e3a8a' },
            name: 'Residuals (Phần dư)',
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
          title: `Biểu đồ Xác suất Chuẩn của Phần dư (Normal Plot) - ${currentCQA.name} (${currentCQA.code})`,
          xaxis: {
            title: {
              text: 'Internally Studentized Residuals (Phần dư Student hóa)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            range: [-3.5, 3.5],
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: 'Theoretical Quantiles (Phân vị lý thuyết Z-score)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            range: [-3.5, 3.5],
            tickfont: { size: 10 },
            automargin: true,
          },
          margin: { l: 80, r: 40, t: 50, b: 70, pad: 4 },
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
          title: `Khoảng cách Cook (Cook's Distance - Điểm ảnh hưởng) - ${currentCQA.name} (${currentCQA.code})`,
          xaxis: {
            title: {
              text: 'Số thứ tự lần chạy thực nghiệm (Run Order)',
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
          yaxis: {
            title: {
              text: "Khoảng cách Cook (Cook's Distance)",
              font: { size: 12, color: '#1e293b' },
              standoff: 10,
            },
            tickfont: { size: 10 },
            automargin: true,
          },
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
          margin: { l: 80, r: 40, t: 50, b: 70, pad: 4 },
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

      {analysisWizard && (
        <div className="qbd-card" style={{ borderLeft: '4px solid #0f766e', background: '#f8fffc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: '800', color: '#134e4a', margin: 0 }}>Analysis Wizard — chọn mô hình và xác nhận</h3>
              <p style={{ fontSize: '0.76rem', color: '#475569', margin: '0.2rem 0 0' }}>So sánh các mô hình phân cấp hoàn chỉnh; AICc thấp hơn tốt hơn. Nếu chênh lệch ≤ 2, ưu tiên mô hình đơn giản hơn.</p>
            </div>
            {analysisWizard.recommended && <span className="badge badge-teal" style={{ fontSize: '0.72rem' }}>Đề xuất: {analysisWizard.recommended.modelType}</span>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.76rem', minWidth: '680px' }}>
              <thead><tr><th>Mô hình</th><th>Phân cấp</th><th>AICc</th><th>Q²</th><th>LOF p</th><th>df dư</th><th>Đánh giá</th><th /></tr></thead>
              <tbody>
                {analysisWizard.candidates.map((candidate) => {
                  const chosen = candidate.modelType === appliedModelType;
                  return <tr key={candidate.modelType} style={{ background: chosen ? '#ecfdf5' : undefined }}>
                    <td style={{ fontWeight: '700' }}>{candidate.modelType}</td>
                    <td>✓ Đầy đủ</td>
                    <td>{candidate.aicc?.toFixed(1) ?? '—'}</td>
                    <td>{candidate.qSquared?.toFixed(3) ?? '—'}</td>
                    <td>{candidate.lackOfFitPValue?.toFixed(3) ?? '—'}</td>
                    <td>{candidate.residualDegreesOfFreedom || '—'}</td>
                    <td style={{ color: candidate.adequate ? '#15803d' : '#b45309' }}>{candidate.model ? (candidate.adequate ? 'Đủ điều kiện' : 'Cần rà soát') : 'Chưa khớp được'}</td>
                    <td><button type="button" className={chosen ? 'btn btn-teal' : 'btn btn-secondary'} disabled={!candidate.model} onClick={() => onModelTypeChange(currentCQA.code, candidate.modelType)} style={{ fontSize: '0.7rem', padding: '0.25rem 0.45rem' }}>Áp dụng</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {analysisWizard.warnings.map((warning) => <div key={warning} style={{ marginTop: '0.5rem', fontSize: '0.74rem', color: '#a16207' }}>⚠ {warning}</div>)}
          {analysisWizard.recommended && (analysisWizard.recommended.outlierRunOrders.length > 0 || analysisWizard.recommended.influentialRunOrders.length > 0 || analysisWizard.recommended.highLeverageRunOrders.length > 0) && (
            <div style={{ marginTop: '0.55rem', padding: '0.55rem 0.65rem', borderRadius: '0.4rem', background: '#fffbeb', color: '#92400e', fontSize: '0.74rem' }}>
              <strong>Rà soát dữ liệu, không tự động loại bỏ:</strong>{' '}
              {analysisWizard.recommended.outlierRunOrders.length > 0 && `phần dư lớn: run ${analysisWizard.recommended.outlierRunOrders.join(', ')}. `}
              {analysisWizard.recommended.influentialRunOrders.length > 0 && `Cook's distance cao: run ${analysisWizard.recommended.influentialRunOrders.join(', ')}. `}
              {analysisWizard.recommended.highLeverageRunOrders.length > 0 && `leverage cao: run ${analysisWizard.recommended.highLeverageRunOrders.join(', ')}.`}
            </div>
          )}
          {confirmationPlan && (
            <div style={{ marginTop: '0.7rem', padding: '0.7rem', border: '1px solid #99f6e4', borderRadius: '0.45rem', background: '#f0fdfa' }}>
              <div style={{ fontWeight: '800', color: '#115e59', fontSize: '0.82rem' }}>Kế hoạch thí nghiệm xác nhận</div>
              <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem', lineHeight: 1.55 }}>
                Lặp <strong>{confirmationPlan.recommendedReplicates}</strong> lần tại điều kiện run #{confirmationPlan.sourceRunOrder} (block {confirmationPlan.sourceBlock}):{' '}
                {Object.entries(confirmationPlan.factorActual).map(([code, value]) => `${code}=${value}`).join(' · ')}.<br />
                Dự đoán: <strong>{confirmationPlan.predictedResponse.toFixed(3)} {currentCQA.unit}</strong>
                {confirmationPlan.meanConfidenceInterval && `; CI 95% của trung bình ${confirmationPlan.meanConfidenceInterval.low.toFixed(3)}–${confirmationPlan.meanConfidenceInterval.high.toFixed(3)}`}
                {confirmationPlan.individualPredictionInterval && `; PI 95% cá thể ${confirmationPlan.individualPredictionInterval.low.toFixed(3)}–${confirmationPlan.individualPredictionInterval.high.toFixed(3)}`}.
                <br />{confirmationPlan.acceptanceCriterion}
              </div>
            </div>
          )}
        </div>
      )}

      {!model ? (
        <div className="qbd-card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          <AlertCircle size={40} color="#f59e0b" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ fontWeight: '600', fontSize: '1rem', color: '#0f172a' }}>
            Chưa đủ số liệu thực nghiệm để khớp mô hình
          </p>
          <p style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
            Vui lòng nhập kết quả thí nghiệm trong Tab 3 (DoE Designer) hoặc bấm nút "Điền Số Liệu Mô Phỏng". Các thiết kế có {executionBlocks.size} block sẽ được hiệu chỉnh hiệu ứng block khi đủ dữ liệu.
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
                {model.diagnostics.rSquared > 0.8 ? '✓ Độ khớp cao (> 0.8)' : '⚠ Cân nhắc đổi dạng mô hình'}
              </div>
            </div>

            {/* Adjusted R-Squared */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #0f766e' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>ADJUSTED R² (R²adj)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0f766e', margin: '0.2rem 0' }}>
                {model.diagnostics.adjRSquared.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: model.diagnostics.adjRSquared > 0.8 ? '#15803d' : '#64748b' }}>
                {model.diagnostics.adjRSquared > 0.8 ? '✓ Đạt chuẩn (> 0.8)' : 'Hiệu chỉnh theo bậc tự do'}
              </div>
            </div>

            {/* Q-Squared (Cross-Validated R2 via PRESS) */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #2563eb' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>HỆ SỐ DỰ BÁO Q² (PRESS)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#2563eb', margin: '0.2rem 0' }}>
                {(model.diagnostics.qSquared ?? model.diagnostics.predRSquared).toFixed(4)}
              </div>
              <div style={{ fontSize: '0.72rem', color: (model.diagnostics.qSquared ?? model.diagnostics.predRSquared) > 0.7 ? '#15803d' : '#dc2626' }}>
                {(model.diagnostics.qSquared ?? model.diagnostics.predRSquared) > 0.7 ? '✓ Dự báo xuất sắc (> 0.7)' : '⚠ Dự báo trung bình (< 0.7)'}
              </div>
            </div>

            {/* Information Criteria AICc / BIC / -2LL */}
            <div className="qbd-card" style={{ padding: '1rem', borderLeft: '4px solid #0284c7' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>AICc / BIC / -2LL</div>
              <div style={{ fontSize: '1.15rem', fontWeight: '800', color: '#0284c7', margin: '0.2rem 0' }}>
                AICc = {model.diagnostics.aicc?.toFixed(1) ?? '-'}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#475569' }}>
                BIC: {model.diagnostics.bic?.toFixed(1) ?? '-'} | -2LL: {model.diagnostics.twoLL?.toFixed(1) ?? '-'}
              </div>
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
                    {model.anova.map((row, idx) => {
                      const isLOF = row.source === 'Lack of Fit';
                      const isPass = isLOF
                        ? (row.pValue !== undefined && row.pValue > 0.05)
                        : (row.pValue !== undefined && row.pValue < 0.05);

                      return (
                        <tr key={idx} style={{ fontWeight: row.source === 'Model' || row.source === 'Residual' ? '600' : 'normal' }}>
                          <td>
                            {row.source}
                            {isLOF && (
                              <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: '0.4rem' }}>
                                (Độ tương thích mô hình - Slide 11)
                              </span>
                            )}
                          </td>
                          <td>{row.ss.toFixed(3)}</td>
                          <td style={{ textAlign: 'center' }}>{row.df}</td>
                          <td>{row.ms.toFixed(3)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {row.fValue !== undefined ? row.fValue.toFixed(2) : '-'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {row.pValue !== undefined ? (
                              <span className={`badge ${isPass ? 'badge-success' : 'badge-danger'}`}>
                                {row.pValue < 0.001 ? '< 0.001' : row.pValue.toFixed(4)}
                                {isLOF && (isPass ? ' (✓ Đạt > 0.05)' : ' (⚠ Thiếu phù hợp)')}
                              </span>
                            ) : isLOF && row.df === 0 ? (
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  color: '#b45309',
                                  backgroundColor: '#fef3c7',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: '4px',
                                  border: '1px solid #fde68a',
                                  display: 'inline-block',
                                }}
                                title="Mô hình bão hòa (df = 0 vì số tham số p bằng tổng số mẫu N). Hãy chọn dạng mô hình Linear hoặc 2FI, hoặc thêm số lần chạy thực nghiệm để tính p-value của Lack of Fit"
                              >
                                df = 0 (Mô hình bão hòa)
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Guidance for Saturated Model Lack of Fit df=0 */}
              {model.anova.some((r) => r.source === 'Lack of Fit' && r.df === 0) && (
                <div
                  style={{
                    marginTop: '0.65rem',
                    padding: '0.55rem 0.75rem',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '0.375rem',
                    fontSize: '0.75rem',
                    color: '#1e40af',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.45rem',
                  }}
                >
                  <span style={{ fontSize: '0.95rem' }}>💡</span>
                  <div>
                    <strong>Lưu ý về Kiểm định Lack of Fit:</strong> Mô hình hiện tại có số tham số bằng đúng số mẫu thực nghiệm (mô hình bão hòa, $df_{'{'}Residual{'}'} \le df_{'{'}PureError{'}'}$ nên $df_{'{'}LOF{'}'} = 0$).
                    Để tính được <strong>p-value Lack of Fit</strong>, bạn có thể chuyển <strong>"Dạng mô hình"</strong> ở trên sang <em>Tuyến tính (Linear)</em> hoặc <em>Tương tác (2FI)</em>, hoặc thêm các lần chạy thí nghiệm mới ở Tab 3.
                  </div>
                </div>
              )}

              {/* Curvature Test (Kiểm định độ cong với Center Points) */}
              {model.curvatureTest && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.65rem 0.85rem',
                    backgroundColor: model.curvatureTest.significant ? '#fef3c7' : '#f0fdf4',
                    border: `1px solid ${model.curvatureTest.significant ? '#fde68a' : '#bbf7d0'}`,
                    borderRadius: '0.375rem',
                    fontSize: '0.78rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <strong style={{ color: model.curvatureTest.significant ? '#b45309' : '#15803d' }}>
                      {model.curvatureTest.significant ? '⚠️ KIỂM ĐỊNH ĐỘ CONG (CURVATURE TEST): CÓ Ý NGHĨA' : '✓ KIỂM ĐỊNH ĐỘ CONG (CURVATURE TEST): KHÔNG CÓ Ý NGHĨA'}
                    </strong>
                    <span className="font-mono" style={{ fontWeight: '700', color: '#1e293b' }}>
                      F = {model.curvatureTest.fValue?.toFixed(2)}, p = {model.curvatureTest.pValue !== undefined ? (model.curvatureTest.pValue < 0.001 ? '< 0.001' : model.curvatureTest.pValue.toFixed(4)) : '-'}
                    </span>
                  </div>
                  <div style={{ color: model.curvatureTest.significant ? '#92400e' : '#166534' }}>
                    {model.curvatureTest.note}
                  </div>
                </div>
              )}
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

          {/* Model Comparison Dashboard (Đa Thức vs Mạng Nơ-ron - Slide 36) */}
          <div className="qbd-card" style={{ borderLeft: '4px solid #7c3aed' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BrainCircuit size={20} color="#7c3aed" />
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                  Bảng So Sánh Đối Chiếu Hiệu Năng: Mô Hình Đa Thức vs Mạng Nơ-ron
                </h3>
              </div>
              <span className="badge badge-purple" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
                Model Comparison (SAS JMP & MODDE Standard)
              </span>
            </div>

            <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.75rem' }}>
              Đối chiếu song song các chỉ số thống kê then chốt (R², R²adj, Q², RMSE, AICc, BIC) giữa phương pháp Hồi quy Đa thức Cổ điển và Mạng Nơ-ron Nhân tạo (ANN) để lựa chọn mô hình dự đoán tối ưu cho từng chỉ tiêu chất lượng CQA.
            </div>

            <div className="table-container">
              <table className="qbd-table">
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc' }}>
                    <th rowSpan={2} style={{ verticalAlign: 'middle' }}>Chỉ Tiêu (CQA)</th>
                    <th colSpan={5} style={{ textAlign: 'center', backgroundColor: '#eff6ff', color: '#1e40af', borderBottom: '2px solid #bfdbfe' }}>
                      📐 Mô Hình Đa Thức (MLR / OLS)
                    </th>
                    <th colSpan={5} style={{ textAlign: 'center', backgroundColor: '#faf5ff', color: '#6b21a8', borderBottom: '2px solid #e9d5ff' }}>
                      🧠 Mạng Nơ-ron (ANN)
                    </th>
                    <th rowSpan={2} style={{ textAlign: 'center', verticalAlign: 'middle' }}>Khuyến Nghị Tối Ưu</th>
                  </tr>
                  <tr style={{ fontSize: '0.75rem', backgroundColor: '#f1f5f9' }}>
                    {/* MLR subheaders */}
                    <th style={{ textAlign: 'center' }}>R²</th>
                    <th style={{ textAlign: 'center' }}>R²adj</th>
                    <th style={{ textAlign: 'center' }}>Q² (PRESS)</th>
                    <th style={{ textAlign: 'center' }}>RMSE</th>
                    <th style={{ textAlign: 'center' }}>AICc</th>
                    {/* ANN subheaders */}
                    <th style={{ textAlign: 'center' }}>R² Train</th>
                    <th style={{ textAlign: 'center' }}>R² Val</th>
                    <th style={{ textAlign: 'center' }}>Validation R² (hold-out)</th>
                    <th style={{ textAlign: 'center' }}>RMSE</th>
                    <th style={{ textAlign: 'center' }}>AICc</th>
                  </tr>
                </thead>
                <tbody>
                  {project.cqas.map((cqa) => {
                    const ols = models[cqa.code];
                    const ann = neuralModels[cqa.code];

                    const olsQ2 = ols?.diagnostics.qSquared ?? ols?.diagnostics.predRSquared ?? 0;
                    const annValidationR2 = ann?.diagnostics.rSquaredVal ?? 0;
                    const olsAIC = ols?.diagnostics.aicc ?? 9999;
                    const annAIC = ann?.diagnostics.aicc ?? 9999;

                    let recommendation = 'Đang chờ dữ liệu';
                    let recBadge = 'badge-secondary';

                    if (ols && ann) {
                      if (annValidationR2 > olsQ2 + 0.05 || (annAIC < olsAIC - 2 && annValidationR2 >= olsQ2)) {
                        recommendation = '🧠 Ưu tiên Mạng Nơ-ron (ANN)';
                        recBadge = 'badge-purple';
                      } else {
                        recommendation = '📐 Ưu tiên Đa thức (MLR)';
                        recBadge = 'badge-blue';
                      }
                    } else if (ols) {
                      recommendation = '📐 Đa thức (MLR)';
                      recBadge = 'badge-blue';
                    } else if (ann) {
                      recommendation = '🧠 Mạng Nơ-ron (ANN)';
                      recBadge = 'badge-purple';
                    }

                    return (
                      <tr key={cqa.code}>
                        <td style={{ fontWeight: '600' }}>
                          {cqa.name} <span style={{ color: '#64748b' }}>({cqa.code})</span>
                        </td>
                        {/* MLR Values */}
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ols ? ols.diagnostics.rSquared.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ols ? ols.diagnostics.adjRSquared.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700', color: olsQ2 > 0.7 ? '#15803d' : '#475569' }}>
                          {ols ? olsQ2.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ols ? ols.diagnostics.stdDev.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ols?.diagnostics.aicc !== undefined ? ols.diagnostics.aicc.toFixed(1) : '-'}
                        </td>
                        {/* ANN Values */}
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ann ? ann.diagnostics.rSquaredTrain.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ann ? ann.diagnostics.rSquaredVal.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: '700', color: annValidationR2 > 0.7 ? '#15803d' : '#475569' }}>
                          {ann ? annValidationR2.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ann ? ann.diagnostics.rmseOverall.toFixed(3) : '-'}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          {ann?.diagnostics.aicc !== undefined ? ann.diagnostics.aicc.toFixed(1) : '-'}
                        </td>
                        {/* Recommendation */}
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${recBadge}`} style={{ fontSize: '0.76rem', padding: '0.25rem 0.5rem' }}>
                            {recommendation}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Updated Risk Assessment Card (ICH Q9 & US FDA ANDA Standard) */}
          <div className="qbd-card" style={{ borderLeft: '4px solid #15803d' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={20} color="#15803d" />
                <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                  Đánh Giá Rủi Ro Cập Nhật Sau DoE (Updated Risk Assessment - ICH Q9 & FDA)
                </h3>
              </div>
              <span className="badge badge-success" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
                Chuẩn Hồ sơ US FDA
              </span>
            </div>

            <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.75rem' }}>
              Bảng đối chiếu mức độ rủi ro trước và sau khi thực hiện DoE. Dựa trên ý nghĩa thống kê ANOVA (p &lt; 0.05) và dải vận hành đã được chứng minh an toàn (PAR), rủi ro được giảm thiểu và có luận giải khoa học (Justification for Reduced Risks).
            </div>

            <div className="table-container">
              <table className="qbd-table">
                <thead>
                  <tr>
                    <th>Yếu Tố (Factor)</th>
                    <th>Chỉ Tiêu (CQA)</th>
                    <th style={{ textAlign: 'center' }}>Rủi Ro Ban Đầu (Initial)</th>
                    <th style={{ textAlign: 'center' }}>Ảnh Hưởng DoE</th>
                    <th style={{ textAlign: 'center' }}>Rủi Ro Cập Nhật (Updated)</th>
                    <th>Luận Giải Khoa Học Giảm Rủi Ro (Justification for Reduced Risk)</th>
                  </tr>
                </thead>
                <tbody>
                  {generateUpdatedRiskAssessment(project, models).map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: '600', color: '#1e3a8a' }}>
                        {item.factorCode} ({item.factorName})
                      </td>
                      <td style={{ fontWeight: '600' }}>
                        {item.cqaCode} ({item.cqaName})
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${item.initialRisk === 'High' ? 'badge-danger' : item.initialRisk === 'Medium' ? 'badge-warning' : 'badge-success'}`}>
                          {item.initialRisk === 'High' ? 'Cao (High)' : item.initialRisk === 'Medium' ? 'Trung bình (Med)' : 'Thấp (Low)'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="font-mono font-bold" style={{ color: item.isSignificantInModel ? '#1e3a8a' : '#64748b' }}>
                          {item.isSignificantInModel ? 'Có (p < 0.05)' : 'Không'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge-success">
                          Thấp (Low)
                        </span>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: '#334155', lineHeight: '1.4' }}>
                        {item.justification}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  );
};
