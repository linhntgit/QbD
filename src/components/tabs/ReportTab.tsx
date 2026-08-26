import React from 'react';
import {
  Download,
  Printer,
  FileCheck2,
  Calculator,
  BrainCircuit,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  DesirabilitySolution,
  MonteCarloResult,
  NeuralNetModelResult,
  ModelingEngine,
} from '../../types/qbd';
import { exportQBDWordReport } from '../../services/reportGenerator';
import { calculateDesignEfficiency } from '../../services/doeGenerator';

interface ReportTabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult>;
  optimum: DesirabilitySolution | null;
  monteCarlo: MonteCarloResult | null;
  neuralModels?: Record<string, NeuralNetModelResult>;
  modelingEngine?: ModelingEngine;
  onToggleEngine?: (engine: ModelingEngine) => void;
}

export const ReportTab: React.FC<ReportTabProps> = ({
  project,
  models,
  optimum,
  monteCarlo,
  neuralModels,
  modelingEngine = 'polynomial',
  onToggleEngine,
}) => {
  const handleDownloadWord = () => {
    exportQBDWordReport(project, models, optimum, monteCarlo, neuralModels, modelingEngine);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Actions Bar */}
      <div className="qbd-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileCheck2 size={22} color="#0f766e" />
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
              Báo Cáo Hồ Sơ Phát Triển Dược Phẩm (ICH CTD Module 3.2.P.2)
            </h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
            Tổng hợp toàn diện dữ liệu QTPP, FMEA, DoE, ANOVA, Design Space và Chiến lược kiểm soát chất lượng.
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
              >
                <BrainCircuit size={14} />
                <span>Mạng Nơ-ron AI</span>
              </button>
            </div>
          )}

          <button
            onClick={handlePrint}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
          >
            <Printer size={16} />
            <span>In / Xuất PDF</span>
          </button>

          <button
            onClick={handleDownloadWord}
            className="btn btn-teal"
            style={{ fontSize: '0.82rem', padding: '0.4rem 1rem' }}
          >
            <Download size={16} />
            <span>Tải Báo Cáo Word (.docx)</span>
          </button>
        </div>
      </div>

      {/* Live Scientific Report Document View */}
      <div
        className="qbd-card"
        style={{
          backgroundColor: '#ffffff',
          padding: '2.5rem',
          maxWidth: '1000px',
          margin: '0 auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          border: '1px solid #cbd5e1',
        }}
      >
        {/* Document Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #1e3a8a', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#0f766e', letterSpacing: '0.05em' }}>
            COMMON TECHNICAL DOCUMENT (ICH CTD MODULE 3.2.P.2)
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1e3a8a', margin: '0.5rem 0' }}>
            BÁO CÁO PHÁT TRIỂN DƯỢC PHẨM THEO QUALITY BY DESIGN (QbD)
          </h1>
          <div style={{ fontSize: '0.9rem', color: '#475569', fontStyle: 'italic' }}>
            Tuân thủ hướng dẫn ICH Q8 (R2), ICH Q9, ICH Q10 và ICH Q11
          </div>
        </div>

        {/* Project Metadata Table */}
        <div style={{ marginBottom: '2rem' }}>
          <table className="qbd-table" style={{ border: '1px solid #cbd5e1' }}>
            <tbody>
              <tr>
                <td style={{ width: '30%', fontWeight: '700', backgroundColor: '#f8fafc' }}>Tên Dự Án</td>
                <td style={{ fontWeight: '600', color: '#1e3a8a' }}>{project.name}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: '700', backgroundColor: '#f8fafc' }}>Hoạt Chất (API)</td>
                <td>{project.moleculeName}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: '700', backgroundColor: '#f8fafc' }}>Dạng Bào Chế</td>
                <td>{project.dosageForm}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: '700', backgroundColor: '#f8fafc' }}>Nhóm Nghiên Cứu</td>
                <td>{project.author}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: '700', backgroundColor: '#f8fafc' }}>Phương Pháp Mô Hình Hóa</td>
                <td style={{ fontWeight: '700', color: modelingEngine === 'neural' ? '#7c3aed' : '#0f766e' }}>
                  {modelingEngine === 'neural'
                    ? '🧠 Mạng Nơ-ron Nhân Tạo AI (SAS JMP Neural Network Platform)'
                    : '📐 Hồi Quy Đa Thức Bậc ≤ 2 (Classical ANOVA / Response Surface)'}
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: '700', backgroundColor: '#f8fafc' }}>Ngày Lập Báo Cáo</td>
                <td>{new Date().toLocaleDateString('vi-VN')}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 1. QTPP */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            1. Hồ Sơ Chất Lượng Sản Phẩm Mục Tiêu (QTPP - ICH Q8)
          </h2>
          <table className="qbd-table">
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={{ width: '30%' }}>Yếu Tố QTPP</th>
                <th style={{ width: '35%' }}>Mục Tiêu Đích</th>
                <th style={{ width: '35%' }}>Căn Cứ Khoa Học</th>
              </tr>
            </thead>
            <tbody>
              {project.qtpp.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: '600' }}>{item.element}</td>
                  <td style={{ color: '#0f766e', fontWeight: '600' }}>{item.target}</td>
                  <td>{item.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 2. CQAs & Desirability Configuration */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            2. Thuộc Tính Chất Lượng Trọng Yếu (CQAs) & Cấu Hình Hàm Thỏa Dụng
          </h2>
          <table className="qbd-table">
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th>Mã</th>
                <th>Tên CQA</th>
                <th>Bản Chất</th>
                <th>Đơn Vị</th>
                <th>Mục Tiêu (Goal)</th>
                <th>Giới Hạn (LSL - Target - USL)</th>
                <th>Hình Dạng (s, t)</th>
                <th>Trọng Số (w)</th>
              </tr>
            </thead>
            <tbody>
              {project.cqas.map((cqa) => (
                <tr key={cqa.id}>
                  <td className="font-mono font-bold" style={{ color: '#1e3a8a' }}>{cqa.code}</td>
                  <td style={{ fontWeight: '600' }}>{cqa.name}</td>
                  <td>
                    <span className="badge badge-primary" style={{ fontSize: '0.72rem' }}>
                      {cqa.dataType === 'qualitative_binary' ? 'Định tính (Pass/Fail)' : cqa.dataType === 'qualitative_ordinal' ? 'Định tính (Thứ bậc)' : 'Định lượng (Quantitative)'}
                    </span>
                  </td>
                  <td>{cqa.unit}</td>
                  <td>
                    <span className="badge badge-teal">
                      {cqa.objective === 'maximize' ? '📈 Maximize' :
                       cqa.objective === 'minimize' ? '📉 Minimize' :
                       cqa.objective === 'target' ? '🎯 Target' :
                       cqa.objective === 'range' ? '📏 Range' : 'None'}
                    </span>
                  </td>
                  <td>{cqa.lowerLimit ?? '-'} / {cqa.target ?? '-'} / {cqa.upperLimit ?? '-'}</td>
                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>s={cqa.sShape ?? 1}, t={cqa.tShape ?? 1}</td>
                  <td style={{ fontWeight: '700', color: '#0f766e' }}>{cqa.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 3. FMEA Risk Assessment */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            3. Đánh Giá Quản Lý Rủi Ro Ban Đầu (FMEA - ICH Q9)
          </h2>
          <table className="qbd-table">
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th>Nhân Tố</th>
                <th>CQA Bị Ảnh Hưởng</th>
                <th style={{ textAlign: 'center' }}>S</th>
                <th style={{ textAlign: 'center' }}>P</th>
                <th style={{ textAlign: 'center' }}>D</th>
                <th style={{ textAlign: 'center' }}>RPN</th>
                <th style={{ textAlign: 'center' }}>Mức Rủi Ro</th>
                <th style={{ textAlign: 'center' }}>Khảo Sát DoE</th>
              </tr>
            </thead>
            <tbody>
              {project.fmeaRisks.map((item) => {
                const factor = project.factors.find((f) => f.id === item.factorId);
                const cqa = project.cqas.find((c) => c.id === item.cqaId);
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: '600' }}>{factor?.name} ({factor?.code})</td>
                    <td>{cqa?.name} ({cqa?.code})</td>
                    <td style={{ textAlign: 'center' }}>{item.severity}</td>
                    <td style={{ textAlign: 'center' }}>{item.probability}</td>
                    <td style={{ textAlign: 'center' }}>{item.detectability}</td>
                    <td style={{ textAlign: 'center', fontWeight: '700' }}>{item.rpn}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${item.riskLevel === 'High' ? 'badge-danger' : item.riskLevel === 'Medium' ? 'badge-warning' : 'badge-success'}`}>
                        {item.riskLevel}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.recommendedDoE ? '✓ Có' : 'Không'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 4. DoE Matrix */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            4. Thiết Kế Thí Nghiệm (DoE: {project.doeConfig.designType})
          </h2>

          <div style={{ marginBottom: '1rem' }}>
            <table className="qbd-table">
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th>Mã</th>
                  <th>Tên Biến Đầu Vào</th>
                  <th>Phân Loại</th>
                  <th>Bản Chất Dữ Liệu</th>
                  <th>Khả Năng Kiểm Soát</th>
                  <th>Đơn Vị</th>
                  <th>Phạm Vi Khảo Sát / Hằng Số</th>
                </tr>
              </thead>
              <tbody>
                {project.factors.map((f) => (
                  <tr key={f.code}>
                    <td className="font-mono font-bold" style={{ color: '#b45309' }}>{f.code}</td>
                    <td style={{ fontWeight: '600' }}>{f.name}</td>
                    <td>{f.type}</td>
                    <td>{f.dataType === 'qualitative' ? 'Định tính' : f.dataType === 'quantitative_multilevel' ? 'ĐL nhiều mức' : 'ĐL liên tục'}</td>
                    <td>
                      <span className={`badge ${f.controllability === 'constant' ? 'badge-primary' : f.controllability === 'uncontrollable_noise' ? 'badge-warning' : 'badge-success'}`}>
                        {f.controllability === 'constant' ? '🔒 Hằng số' : f.controllability === 'uncontrollable_noise' ? '🌪️ Nhiễu (Noise)' : '🎯 Kiểm soát được'}
                      </span>
                    </td>
                    <td>{f.unit}</td>
                    <td>{f.controllability === 'constant' ? `${f.constantValue ?? f.low}` : `${f.low} - ${f.high}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Design Efficiency Metrics */}
          {project.runs.length > 0 && (() => {
            const metrics = calculateDesignEfficiency(
              project.runs,
              project.factors,
              project.doeConfig.dOptimalModel || 'Quadratic'
            );
            return (
              <div style={{ marginBottom: '1rem', backgroundColor: '#f8fafc', padding: '0.85rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: '700', color: '#0369a1', marginBottom: '0.5rem' }}>
                  ⚡ Đánh Giá Hiệu Quả Thiết Kế (Design Optimality Diagnostics)
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                  <div><strong>D-Efficiency:</strong> <span style={{ color: '#0284c7', fontWeight: '700' }}>{metrics.dEfficiency}%</span> ({metrics.rating})</div>
                  <div><strong>A-Efficiency:</strong> {metrics.aEfficiency}%</div>
                  <div><strong>G-Efficiency:</strong> {metrics.gEfficiency}%</div>
                  <div><strong>Số hệ số p:</strong> {metrics.numParameters} (df={metrics.degreesOfFreedom})</div>
                </div>
              </div>
            );
          })()}

          <div className="table-container" style={{ maxHeight: '350px' }}>
            <table className="qbd-table">
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th>Std</th>
                  <th>Run</th>
                  {project.factors.map((f) => (
                    <th key={f.code}>{f.code} ({f.unit})</th>
                  ))}
                  {project.cqas.map((c) => (
                    <th key={c.code}>{c.code} ({c.unit})</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {project.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.stdOrder}</td>
                    <td style={{ fontWeight: '700' }}>{r.runOrder}</td>
                    {project.factors.map((f) => (
                      <td key={f.code}>{r.factorActual[f.code]}</td>
                    ))}
                    {project.cqas.map((c) => (
                      <td key={c.code} style={{ fontWeight: '600', color: '#0f766e' }}>{r.responses[c.code] ?? '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Statistical Models & ANOVA */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            5. Phương Trình Hồi Quy & Kết Quả Thống Kê ANOVA
          </h2>
          {Object.values(models).map((m) => {
            const cqa = project.cqas.find((c) => c.code === m.cqaCode);
            return (
              <div key={m.cqaCode} style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: '700', color: '#1e3a8a', marginBottom: '0.3rem' }}>
                  {cqa?.name} ({m.cqaCode}) - Mô hình {m.modelType}
                </div>
                <div className="font-mono" style={{ fontSize: '0.85rem', color: '#0f766e', marginBottom: '0.5rem' }}>
                  {m.equationString}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                  R² = <strong>{m.diagnostics.rSquared.toFixed(4)}</strong> | R² Adj = <strong>{m.diagnostics.adjRSquared.toFixed(4)}</strong> | R² Pred = <strong>{m.diagnostics.predRSquared.toFixed(4)}</strong> | Adeq Precision = <strong>{m.diagnostics.adeqPrecision.toFixed(2)}</strong> | Std Dev = <strong>{m.diagnostics.stdDev.toFixed(3)}</strong>
                </div>
              </div>
            );
          })}
        </div>

        {/* 5b. Neural Network Models (SAS JMP Style) */}
        {neuralModels && Object.keys(neuralModels).length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#7c3aed', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
              5b. Mô hình Mạng Nơ-ron AI (SAS JMP Neural Network Platform)
            </h2>
            {Object.values(neuralModels).map((nm) => {
              const cqa = project.cqas.find((c) => c.code === nm.cqaCode);
              return (
                <div key={nm.cqaCode} style={{ backgroundColor: '#faf5ff', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #e9d5ff' }}>
                  <div style={{ fontWeight: '700', color: '#6b21a8', marginBottom: '0.3rem' }}>
                    {cqa?.name} ({nm.cqaCode}) — Kiến trúc MLP [{nm.config.hiddenNodes1}{nm.config.hiddenNodes2 > 0 ? `, ${nm.config.hiddenNodes2}` : ''}] ({nm.config.activation.toUpperCase()})
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.4rem' }}>
                    Train R² = <strong style={{ color: '#1e3a8a' }}>{nm.diagnostics.rSquaredTrain}</strong> | Val R² = <strong style={{ color: '#dc2626' }}>{nm.diagnostics.rSquaredVal}</strong> | Overall R² = <strong style={{ color: '#7c3aed' }}>{nm.diagnostics.rSquaredOverall}</strong> | RMSE = <strong>{nm.diagnostics.rmseOverall}</strong> (Tour #{nm.diagnostics.bestTourIndex})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b21a8' }}>
                    <strong>Độ quan trọng yếu tố (Variable Importance): </strong>
                    {nm.diagnostics.variableImportance.map((v) => `${v.factorCode}: ${v.relativeImportance}%`).join(' • ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 6. Optimum & SAS JMP Prediction Profiler */}
        {optimum && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
              6. Tối Ưu Hóa Đa Mục Tiêu (SAS JMP Desirability Profiler: Overall D = {optimum.overallDesirability})
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {/* Factors setpoints */}
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.75rem', backgroundColor: '#f8fafc' }}>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#1e3a8a', marginBottom: '0.5rem' }}>
                  Thông Số Cài Đặt Tối Ưu (Coded & Actual Setpoint):
                </div>
                {project.factors.map((f) => (
                  <div key={f.code} style={{ fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ color: '#475569' }}>{f.name} ({f.code}):</span>
                    <span>
                      <span className="font-mono" style={{ color: '#64748b', marginRight: '0.5rem' }}>[{optimum.codedFactors[f.code]}]</span>
                      <strong style={{ color: '#0f172a' }}>{optimum.actualFactors[f.code]} {f.unit}</strong>
                    </span>
                  </div>
                ))}
              </div>

              {/* CQAs predictions with SE, 95% CI, and individual desirability */}
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '0.75rem', backgroundColor: '#f8fafc' }}>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#0f766e', marginBottom: '0.5rem' }}>
                  Đáp Ứng CQAs Dự Đoán & Thỏa Dụng Từng Phần (d_i):
                </div>
                {project.cqas.map((cqa) => {
                  const pred = optimum.predictedResponses[cqa.code];
                  return (
                    <div key={cqa.code} style={{ fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <span style={{ color: '#475569' }}>{cqa.name}:</span>
                      <span>
                        <strong style={{ color: '#0f766e', marginRight: '0.5rem' }}>
                          {pred ? `${pred.value} ${cqa.unit}` : '-'}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {pred ? `[${pred.ciLow} - ${pred.ciHigh}] (d=${pred.desirability})` : ''}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 7. Control Strategy & Ranges */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            7. Chiến Lược Kiểm Soát & Vùng Thiết Kế Liên Tục (Design Space - ICH Q8/Q10)
          </h2>
          <table className="qbd-table">
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th>Thông Số (Factor)</th>
                <th>Miền Khảo Sát (Knowledge Space)</th>
                <th>Phạm Vi Chấp Nhận (PAR)</th>
                <th>Phạm Vi Vận Hành Thường Quy (NOR)</th>
              </tr>
            </thead>
            <tbody>
              {project.designSpace.map((ds) => {
                const factor = project.factors.find((f) => f.code === ds.factorCode);
                const unit = factor ? factor.unit : '';
                return (
                  <tr key={ds.factorCode}>
                    <td style={{ fontWeight: '600' }}>{factor?.name} ({ds.factorCode})</td>
                    <td>{ds.knowledgeLow} - {ds.knowledgeHigh} {unit}</td>
                    <td style={{ color: '#1e40af', fontWeight: '600' }}>{ds.parLow} - {ds.parHigh} {unit}</td>
                    <td style={{ color: '#0f766e', fontWeight: '700' }}>{ds.norLow} - {ds.norHigh} {unit} (Mục tiêu: {ds.target})</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 8. Monte Carlo Reliability */}
        {monteCarlo && (
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
              8. Xác Minh Độ Tin Cậy Vùng Thiết Kế (Mô Phỏng Monte Carlo - ICH Q9)
            </h2>
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '1rem', fontSize: '0.85rem', color: '#14532d' }}>
              <div style={{ marginBottom: '0.3rem' }}>• Tổng số lô mô phỏng ảo: <strong>{monteCarlo.simulations.toLocaleString()} lô</strong></div>
              <div style={{ marginBottom: '0.3rem' }}>• Tỷ lệ độ tin cậy đạt chuẩn 100% CQAs: <strong style={{ color: '#15803d', fontSize: '0.95rem' }}>{monteCarlo.reliabilityPercent}%</strong></div>
              <div>• Tỷ lệ lỗi dự kiến (Defect Rate): <strong>{monteCarlo.defectRatePPM.toLocaleString()} PPM</strong></div>
            </div>
          </div>
        )}

        {/* 9. Sign-off & Regulatory Approval Block */}
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            9. Ký Duyệt & Phê Chuẩn Hồ Sơ Phát Triển Dược Phẩm (Sign-off & Approval)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#1e3a8a', marginBottom: '3rem' }}>
                NGƯỜI LẬP BÁO CÁO (Scientist)
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Ký & Ghi rõ họ tên</div>
              <div style={{ fontWeight: '600', color: '#0f172a', marginTop: '0.25rem' }}>{project.author || 'Nghiên cứu viên'}</div>
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#1e3a8a', marginBottom: '3rem' }}>
                TRƯỞNG PHÒNG R&D (Formulation Lead)
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Ký & Ghi rõ họ tên</div>
              <div style={{ fontWeight: '600', color: '#0f172a', marginTop: '0.25rem' }}>..........................................</div>
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center', backgroundColor: '#f8fafc' }}>
              <div style={{ fontWeight: '700', fontSize: '0.82rem', color: '#1e3a8a', marginBottom: '3rem' }}>
                GIÁM ĐỐC QA (Quality Assurance)
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Ký & Ghi rõ họ tên</div>
              <div style={{ fontWeight: '600', color: '#0f172a', marginTop: '0.25rem' }}>..........................................</div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
