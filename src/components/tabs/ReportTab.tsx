import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Printer,
  FileCheck2,
  Calculator,
  BrainCircuit,
  ListOrdered,
  ArrowUp,
  BookOpen,
  Layers,
  ShieldAlert,
  Sliders,
  Boxes,
  Activity,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import type {
  QBDProject,
  StatisticalModelResult,
  DesirabilitySolution,
  MonteCarloResult,
  NeuralNetModelResult,
  ModelingEngine,
} from '../../types/qbd';
import type { NeuralTrainingMode } from '../../types/neuralNetwork';
import { exportQBDWordReport } from '../../services/reportGenerator';
import { calculateDesignEfficiency } from '../../services/doeGenerator';
import { generateUpdatedRiskAssessment, generateControlStrategy } from '../../services/statistics';
import { calculateNeuralArchitectureMetrics } from '../../services/neuralNetwork';
import { NeuralNetworkTopologyDiagram } from '../NeuralNetworkTopologyDiagram';
import { ProjectGovernancePanel } from '../ProjectGovernancePanel';
import { getReportReadiness, getTraceabilitySummary } from '../../services/projectGovernance';

interface ReportTabProps {
  project: QBDProject;
  models: Record<string, StatisticalModelResult>;
  optimum: DesirabilitySolution | null;
  monteCarlo: MonteCarloResult | null;
  neuralModels?: Record<string, NeuralNetModelResult>;
  modelingEngine?: ModelingEngine;
  onToggleEngine?: (engine: ModelingEngine) => void;
  onRestoreSnapshot: (project: QBDProject) => void;
}

export const ReportTab: React.FC<ReportTabProps> = ({
  project,
  models,
  optimum,
  monteCarlo,
  neuralModels,
  modelingEngine = 'polynomial',
  onToggleEngine,
  onRestoreSnapshot,
}) => {
  const traceability = getTraceabilitySummary(project);
  const reportModels = modelingEngine === 'neural' ? (neuralModels ?? {}) : models;
  const reportReadiness = getReportReadiness(project, reportModels, optimum, monteCarlo);

  const [activeSection, setActiveSection] = useState<string>('sec-metadata');
  const [selectedNeuralCQA, setSelectedNeuralCQA] = useState<string>(() => project.cqas[0]?.code || '');

  // Define Table of Contents Sections dynamically based on project content
  const tocSections = useMemo(() => {
    const list: Array<{ id: string; title: string; subtitle: string; icon: any; badge?: string }> = [
      { id: 'sec-metadata', title: 'Thông tin Dự Án', subtitle: 'Tổng quan & Phương pháp', icon: BookOpen, badge: 'Info' },
      { id: 'sec-0', title: '0. Protocol & Traceability', subtitle: 'Lịch sử & Phê duyệt', icon: CheckCircle2, badge: 'Trace' },
      { id: 'sec-1', title: '1. Hồ Sơ QTPP', subtitle: 'Mục tiêu chất lượng', icon: Layers, badge: 'ICH Q8' },
      { id: 'sec-2', title: '2. Thuộc Tính CQAs', subtitle: 'Chỉ tiêu & Desirability', icon: Sliders, badge: 'CQAs' },
      { id: 'sec-3', title: '3. Rủi Ro Ban Đầu (FMEA)', subtitle: 'Sàng lọc biến số', icon: ShieldAlert, badge: 'ICH Q9' },
      { id: 'sec-4', title: '4. Thiết Kế DoE', subtitle: `${project.doeConfig.designType} (${project.runs.length} runs)`, icon: FileSpreadsheet, badge: 'DoE' },
      { id: 'sec-5a', title: '5a. ANOVA & Hồi Quy Đa Thức', subtitle: 'Mô hình OLS & Lack of Fit', icon: Calculator, badge: 'ANOVA' },
    ];

    if (neuralModels && Object.keys(neuralModels).length > 0) {
      list.push({ id: 'sec-5b', title: '5b. Mạng Nơ-ron AI (ANN)', subtitle: 'MLP Architecture & Metrics', icon: BrainCircuit, badge: 'ANN' });
    }

    if (optimum) {
      list.push({ id: 'sec-6', title: '6. Tối Ưu Desirability', subtitle: `Overall D = ${optimum.overallDesirability}`, icon: Activity, badge: 'Optimum' });
    }

    list.push(
      { id: 'sec-6b', title: '6b. Rủi Ro Sau DoE', subtitle: 'Đánh giá cập nhật', icon: ShieldAlert, badge: 'ICH Q9' },
      { id: 'sec-7', title: '7. Chiến Lược Kiểm Soát', subtitle: 'ICH Q10 Comprehensive', icon: Boxes, badge: 'ICH Q10' }
    );

    if (monteCarlo) {
      list.push({ id: 'sec-8', title: '8. Độ Bền Vững Monte Carlo', subtitle: `Đạt ${monteCarlo.reliabilityPercent}%`, icon: Activity, badge: 'Risk' });
    }

    list.push(
      { id: 'sec-9', title: '9. Ký Duyệt & Phê Chuẩn', subtitle: 'Sign-off & Approval', icon: FileCheck2, badge: 'Sign' },
      { id: 'sec-governance', title: 'Quản Trị & Audit Trail', subtitle: 'Snapshots & Kiểm tra', icon: BookOpen, badge: 'Audit' }
    );

    return list;
  }, [project.doeConfig.designType, project.runs.length, neuralModels, optimum, monteCarlo]);

  // Scroll Spy logic to highlight active TOC item
  useEffect(() => {
    const handleScroll = () => {
      const scrollPos = window.scrollY + 120;
      const elements = tocSections
        .map((sec) => document.getElementById(sec.id))
        .filter((el): el is HTMLElement => el !== null);

      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el.offsetTop <= scrollPos) {
          setActiveSection(el.id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [tocSections]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setActiveSection('sec-metadata');
  };

  const handleDownloadWord = () => {
    if (!reportReadiness.readyForScientificReport) {
      window.alert(`Chưa thể xuất bản thảo báo cáo phát triển.\n${[...reportReadiness.errors, ...reportReadiness.warnings].slice(0, 8).join('\n')}`);
      return;
    }
    exportQBDWordReport(project, models, optimum, monteCarlo, neuralModels, modelingEngine);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Actions Bar */}
      <div className="qbd-card no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileCheck2 size={22} color="#0f766e" />
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
              Bản Thảo Báo Cáo Phát Triển Dược Phẩm (tham khảo CTD 3.2.P.2)
            </h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
            Tài liệu làm việc cần được chuyên gia khoa học và QA rà soát; không phải hồ sơ đã được cơ quan quản lý phê duyệt.
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
            className={`btn ${reportReadiness.readyForScientificReport ? 'btn-teal' : 'btn-secondary'}`}
            disabled={!reportReadiness.readyForScientificReport}
            style={{ fontSize: '0.82rem', padding: '0.4rem 1rem' }}
            title={reportReadiness.readyForScientificReport ? 'Xuất bản thảo để rà soát khoa học/QA' : 'Cần hoàn tất và kiểm tra dữ liệu trước khi xuất'}
          >
            <Download size={16} />
            <span>Tải Bản Thảo Word (.docx)</span>
          </button>
        </div>
      </div>

      {!reportReadiness.readyForScientificReport && (
        <div className="qbd-card no-print" style={{ borderLeft: '4px solid #d97706', color: '#92400e', fontSize: '0.82rem' }}>
          <strong>Bản thảo báo cáo đang bị khóa.</strong> Hoàn tất dữ liệu và sửa các lỗi kiểm tra trước khi xuất Word.
        </div>
      )}

      {/* Main Report Layout with Side-by-Side Interactive Table of Contents */}
      <div className="report-workspace-container">
        
        {/* Sticky Table of Contents Sidebar */}
        <aside className="report-toc-sidebar no-print" aria-label="Mục lục báo cáo">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', paddingBottom: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#1e3a8a', fontWeight: '700', fontSize: '0.82rem' }}>
              <ListOrdered size={16} color="#1e3a8a" />
              <span>MỤC LỤC BÁO CÁO</span>
            </div>
            <span style={{ fontSize: '0.68rem', backgroundColor: '#f1f5f9', color: '#64748b', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: '600' }}>
              {tocSections.length} mục
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {tocSections.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => scrollToSection(sec.id)}
                  className={`report-toc-item ${isActive ? 'active' : ''}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: isActive ? '#eff6ff' : 'transparent',
                    border: 'none',
                  }}
                  title={sec.subtitle}
                >
                  <Icon size={14} style={{ color: isActive ? '#1e40af' : '#64748b', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: isActive ? '700' : '500', color: isActive ? '#1e3a8a' : '#334155' }}>
                      {sec.title}
                    </div>
                  </div>
                  {sec.badge && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '3px',
                        backgroundColor: isActive ? '#dbeafe' : '#f1f5f9',
                        color: isActive ? '#1e40af' : '#64748b',
                        fontWeight: '600',
                        flexShrink: 0,
                      }}
                    >
                      {sec.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: '0.75rem', paddingTop: '0.55rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              onClick={scrollToTop}
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '0.72rem', padding: '0.35rem', gap: '0.3rem', justifyContent: 'center' }}
            >
              <ArrowUp size={13} />
              <span>Lên đầu trang</span>
            </button>
          </div>
        </aside>

        {/* Live Scientific Report Document View */}
        <div
          className="qbd-card report-draft"
          style={{
            backgroundColor: '#ffffff',
            padding: 'clamp(1rem, 5vw, 2.5rem)',
            width: '100%',
            boxSizing: 'border-box',
            maxWidth: '1000px',
            margin: '0 auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            border: '1px solid #cbd5e1',
          }}
        >
          {/* Document Header */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid #1e3a8a', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#0f766e', letterSpacing: '0.05em' }}>
              DEVELOPMENT REPORT DRAFT — CTD 3.2.P.2 REFERENCE STRUCTURE
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1e3a8a', margin: '0.5rem 0' }}>
              BẢN THẢO BÁO CÁO PHÁT TRIỂN DƯỢC PHẨM THEO QbD
            </h1>
            <div style={{ fontSize: '0.9rem', color: '#475569', fontStyle: 'italic' }}>
              Cần rà soát độc lập trước mọi sử dụng GxP hoặc regulatory
            </div>
          </div>


        {/* Project Metadata Table */}
        <div id="sec-metadata" className="report-section" style={{ marginBottom: '2rem' }}>
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
                    ? '🧠 Mạng Nơ-ron Nhân Tạo AI (Neural Network Platform)'
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

        <div id="sec-0" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            0. Protocol trước chạy & traceability sau chạy
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem', fontSize: '0.78rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.7rem', borderRadius: '0.4rem' }}><strong>Protocol ID</strong><br /><span className="font-mono">{traceability.protocolId}</span></div>
            <div style={{ background: '#f8fafc', padding: '0.7rem', borderRadius: '0.4rem' }}><strong>Thiết kế đã phê duyệt</strong><br />{project.doeConfig.designType} · {project.runs.length} run · {project.doeConfig.blocks ?? 1} block</div>
            <div style={{ background: '#f8fafc', padding: '0.7rem', borderRadius: '0.4rem' }}><strong>Trace sau chạy</strong><br />{traceability.runStatus}</div>
          </div>
          <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.55rem' }}>Protocol phải được chuyên gia phê duyệt trước chạy; báo cáo hiện tại chỉ tổng hợp dữ liệu có trong project tại thời điểm xuất.</p>
        </div>

        {/* 1. QTPP */}
        <div id="sec-1" className="report-section" style={{ marginBottom: '2rem' }}>
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
        <div id="sec-2" className="report-section" style={{ marginBottom: '2rem' }}>
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
                      {cqa.dataType === 'qualitative_binary' ? 'Định tính (Pass/Fail)' : cqa.dataType === 'qualitative_ordinal' ? 'Định tính (Thứ bậc)' : cqa.dataType === 'quantitative_multilevel' ? 'Định lượng (Nhiều mức)' : 'Định lượng (Liên tục)'}
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
                  <td>{cqa.categories?.length ? `${cqa.categories.join(' · ')}${cqa.targetCategory ? ` (đạt: ${cqa.targetCategory})` : ''}` : `${cqa.lowerLimit ?? '-'} / ${cqa.target ?? '-'} / ${cqa.upperLimit ?? '-'}`}</td>
                  <td className="font-mono" style={{ fontSize: '0.78rem' }}>s={cqa.sShape ?? 1}, t={cqa.tShape ?? 1}</td>
                  <td style={{ fontWeight: '700', color: '#0f766e' }}>{cqa.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 3. FMEA Risk Assessment */}
        <div id="sec-3" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            3. Đánh Giá Quản Lý Rủi Ro Ban Đầu (FMEA - ICH Q9)
          </h2>
          <table className="qbd-table">
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th>Yếu Tố</th>
                <th>CQA Bị Ảnh Hưởng</th>
                <th style={{ textAlign: 'center' }}>S</th>
                <th style={{ textAlign: 'center' }} title="Occurrence (Khả năng xảy ra)">O</th>
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
        <div id="sec-4" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            4. Thiết Kế Thí Nghiệm (DoE: {project.doeConfig.designType})
          </h2>

          <div style={{ marginBottom: '1rem' }}>
            <table className="qbd-table">
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th>Mã</th>
                  <th>Tên Biến Đầu Vào</th>
                  <th>Vai Trò (QbD Role)</th>
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
                    <td>
                      <span className={`badge ${f.role === 'mixture_component' ? 'badge-teal' : f.role === 'process_parameter' ? 'badge-primary' : 'badge-secondary'}`}>
                        {f.role === 'mixture_component'
                          ? '🧪 Thành phần hỗn hợp (Σ=100%)'
                          : f.role === 'formulation_other'
                          ? '📦 Biến công thức khác'
                          : '⚙️ Biến quy trình'}
                      </span>
                    </td>
                    <td>{f.dataType === 'qualitative' ? 'Định tính' : f.dataType === 'quantitative_multilevel' ? 'ĐL nhiều mức' : 'ĐL liên tục'}</td>
                    <td>
                      <span className={`badge ${f.controllability === 'constant' ? 'badge-primary' : f.controllability === 'uncontrollable_noise' ? 'badge-warning' : 'badge-success'}`}>
                        {f.controllability === 'constant' ? '🔒 Hằng số' : f.controllability === 'uncontrollable_noise' ? '🌪️ Nhiễu (Noise)' : '🎯 Kiểm soát được'}
                      </span>
                    </td>
                    <td>{f.unit}</td>
                    <td>{f.controllability === 'constant' ? `${f.constantValue ?? f.low}` : f.dataType !== 'quantitative' && f.categories?.length ? f.categories.join(' · ') : `${f.low} - ${f.high}`}</td>
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

          {/* DoE Matrix Table */}
          {(() => {
            const mixtureFactors = project.factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture');
            const hasMixture = mixtureFactors.length > 0;

            return (
              <div className="table-container" style={{ maxHeight: '350px' }}>
                <table className="qbd-table">
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                      <th>Std</th>
                      <th>Run</th>
                      {project.factors.map((f) => (
                        <th key={f.code}>{f.name} ({f.code}){f.unit ? ` [${f.unit}]` : ''}</th>
                      ))}
                      {hasMixture && (
                        <th style={{ backgroundColor: '#ecfdf5', color: '#065f46', textAlign: 'center' }}>Σ Hỗn Hợp (%)</th>
                      )}
                      {project.cqas.map((c) => (
                        <th key={c.code} style={{ backgroundColor: '#ccfbf1', color: '#0f766e' }}>{c.name} ({c.code}){c.unit ? ` [${c.unit}]` : ''}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {project.runs.map((r) => {
                      const sumMix = hasMixture
                        ? mixtureFactors.reduce((acc, f) => {
                            const v = Number(r.factorActual[f.code]);
                            return acc + (isNaN(v) ? 0 : v);
                          }, 0)
                        : 0;
                      const is100 = Math.abs(sumMix - 100) < 0.1;

                      return (
                        <tr key={r.id}>
                          <td style={{ textAlign: 'center' }}>{r.stdOrder}</td>
                          <td style={{ fontWeight: '700', textAlign: 'center' }}>{r.runOrder}</td>
                          {project.factors.map((f) => (
                            <td key={f.code}>
                              {typeof r.factorActual[f.code] === 'number' && (f.role === 'mixture_component' || f.type === 'Mixture')
                                ? Number(Number(r.factorActual[f.code]).toFixed(4))
                                : r.factorActual[f.code]}
                            </td>
                          ))}
                          {hasMixture && (
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge ${is100 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                                {is100 ? '✓ 100%' : `⚠ ${sumMix.toFixed(1)}%`}
                              </span>
                            </td>
                          )}
                          {project.cqas.map((c) => (
                            <td key={c.code} style={{ fontWeight: '600', color: '#0f766e' }}>{r.responses[c.code] ?? '-'}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        {/* 5a. Statistical Models & ANOVA */}
        <div id="sec-5a" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            5a. Mô Hình Hồi Quy Đa Thức & Phân Tích Phương Sai (ANOVA - Lack of Fit)
          </h2>
          {new Set(project.runs.map((run) => Math.max(1, Math.floor(run.block ?? 1)))).size > 1 && (
            <p style={{ fontSize: '0.78rem', color: '#0f766e', marginBottom: '0.75rem' }}>
              Thiết kế nhiều block: ANOVA dùng hiệu ứng block cố định; các dòng Model và hiệu ứng xử lý đã được hiệu chỉnh theo block.
            </p>
          )}
          {Object.values(models).map((m) => {
            const cqa = project.cqas.find((c) => c.code === m.cqaCode);
            return (
              <div key={m.cqaCode} style={{ backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.25rem', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: '700', color: '#1e3a8a', marginBottom: '0.3rem', fontSize: '0.95rem' }}>
                  {cqa?.name} ({m.cqaCode}) - Mô hình {m.modelType}
                </div>
                <div className="font-mono" style={{ fontSize: '0.85rem', color: '#0f766e', marginBottom: '0.5rem' }}>
                  {m.equationString}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.75rem' }}>
                  R² = <strong>{m.diagnostics.rSquared.toFixed(4)}</strong> | R² Adj = <strong>{m.diagnostics.adjRSquared.toFixed(4)}</strong> | R² Pred = <strong>{m.diagnostics.predRSquared.toFixed(4)}</strong> | Adeq Precision = <strong>{m.diagnostics.adeqPrecision.toFixed(2)}</strong> | Std Dev = <strong>{m.diagnostics.stdDev.toFixed(3)}</strong> (CV = {m.diagnostics.cvPercent.toFixed(2)}%)
                </div>

                {/* Complete ANOVA Table */}
                <div className="table-container">
                  <table className="qbd-table">
                    <thead>
                      <tr style={{ backgroundColor: '#f1f5f9' }}>
                        <th>Nguồn (Source)</th>
                        <th>Tổng bình phương (SS)</th>
                        <th style={{ textAlign: 'center' }}>df</th>
                        <th>Bình phương trung bình (MS)</th>
                        <th style={{ textAlign: 'center' }}>F-value</th>
                        <th style={{ textAlign: 'center' }}>p-value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.anova.map((row, rIdx) => {
                        const isLOF = row.source === 'Lack of Fit';
                        const isPass = isLOF
                          ? (row.pValue !== undefined && row.pValue > 0.05)
                          : (row.pValue !== undefined && row.pValue < 0.05);

                        return (
                          <tr key={rIdx} style={{ fontWeight: row.source === 'Model' || row.source === 'Residual' ? '600' : 'normal' }}>
                            <td>
                              {row.source}
                              {isLOF && <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '0.35rem' }}>(Độ thiếu phù hợp)</span>}
                            </td>
                            <td>{row.ss.toFixed(3)}</td>
                            <td style={{ textAlign: 'center' }}>{row.df}</td>
                            <td>{row.ms.toFixed(3)}</td>
                            <td style={{ textAlign: 'center' }}>{row.fValue !== undefined ? row.fValue.toFixed(2) : '-'}</td>
                            <td style={{ textAlign: 'center' }}>
                              {row.pValue !== undefined ? (
                                <span className={`badge ${isPass ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.72rem' }}>
                                  {row.pValue < 0.001 ? '< 0.001' : row.pValue.toFixed(4)}
                                  {isLOF && (isPass ? ' (✓ Đạt > 0.05)' : ' (⚠ Thiếu phù hợp)')}
                                </span>
                              ) : isLOF && row.df === 0 ? (
                                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>df = 0 (Bão hòa)</span>
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

                {m.curvatureTest && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.76rem', color: m.curvatureTest.significant ? '#b45309' : '#15803d' }}>
                    <strong>Kiểm định độ cong (Curvature Test):</strong> F = {m.curvatureTest.fValue?.toFixed(2)}, p = {m.curvatureTest.pValue !== undefined ? (m.curvatureTest.pValue < 0.001 ? '< 0.001' : m.curvatureTest.pValue.toFixed(4)) : '-'} ({m.curvatureTest.note})
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 5b. Neural Network Models */}
        {neuralModels && Object.keys(neuralModels).length > 0 && (() => {
          const availableCodes = Object.keys(neuralModels);
          const firstNM = Object.values(neuralModels)[0];
          if (!firstNM) return null;

          const currentCQA = (selectedNeuralCQA && availableCodes.includes(selectedNeuralCQA))
            ? selectedNeuralCQA
            : availableCodes[0];
          const displayNM = neuralModels[currentCQA] ?? firstNM;
          const actualTrainingMode: NeuralTrainingMode =
            displayNM.architectureMode ??
            firstNM.architectureMode ??
            (project.analysisSettings?.neuralTrainingMode ?? 'independent');

          const activeFactors = project.factors.filter((f) => f.controllability !== 'constant');
          const numInputs = activeFactors.length;
          const numOutputs = actualTrainingMode === 'shared' ? project.cqas.length : 1;
          const archMetrics = calculateNeuralArchitectureMetrics(
            numInputs,
            displayNM.config.hiddenNodes1 || 3,
            displayNM.config.hiddenNodes2 || 0,
            numOutputs,
            project.runs.length
          );

          return (
            <div id="sec-5b" className="report-section" style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#7c3aed', margin: 0 }}>
                  5b. Mô Hình Mạng Nơ-ron Nhân Tạo AI (Artificial Neural Network - ANN)
                </h2>
                <span className="badge" style={{ backgroundColor: actualTrainingMode === 'shared' ? '#0284c7' : '#0f766e', color: '#ffffff', fontSize: '0.74rem', padding: '0.25rem 0.55rem' }}>
                  {actualTrainingMode === 'shared' ? '🌐 Mạng Hợp Nhất (Multi-Output MLP)' : '🎯 Mạng Độc Lập Từng Biến Y (Per-CQA MLP)'}
                </span>
              </div>

              <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.5 }}>
                {actualTrainingMode === 'shared' ? (
                  <span>Mô hình áp dụng kiến trúc <strong>Multi-Output Shared MLP</strong>, tối ưu hóa đồng thời toàn bộ các biến đáp ứng CQA trên cùng một mạng nơ-ron chia sẻ các tầng ẩn.</span>
                ) : (
                  <span>Mô hình áp dụng kiến trúc <strong>Mạng Nơ-ron Độc Lập Cho Từng Biến Y</strong>, cho phép tối ưu hóa riêng biệt số nơ-ron ẩn và hàm kích hoạt phù hợp nhất với đặc tính phi tuyến của từng CQA.</span>
                )}
              </div>

              {/* Neural Network Architecture Diagram */}
              <div style={{ marginBottom: '1.25rem' }}>
                {actualTrainingMode === 'independent' && project.cqas.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#475569' }}>
                      Xem kiến trúc CQA:
                    </span>
                    {project.cqas.map((cqa) => {
                      const isSel = cqa.code === currentCQA;
                      if (!neuralModels[cqa.code]) return null;
                      return (
                        <button
                          key={cqa.code}
                          type="button"
                          onClick={() => setSelectedNeuralCQA(cqa.code)}
                          style={{
                            padding: '0.25rem 0.65rem',
                            fontSize: '0.74rem',
                            fontWeight: isSel ? '700' : '500',
                            borderRadius: '0.375rem',
                            border: isSel ? '1.5px solid #7c3aed' : '1px solid #cbd5e1',
                            backgroundColor: isSel ? '#f5f3ff' : '#ffffff',
                            color: isSel ? '#6d28d9' : '#475569',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span>🎯 {cqa.name} ({cqa.code})</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <NeuralNetworkTopologyDiagram
                  factors={project.factors}
                  cqas={project.cqas}
                  selectedCQA={currentCQA}
                  config={displayNM.config}
                  trainingMode={actualTrainingMode}
                  archMetrics={archMetrics}
                />
              </div>

              {Object.values(neuralModels).map((nm) => {
                const cqa = project.cqas.find((c) => c.code === nm.cqaCode);
                return (
                  <div key={nm.cqaCode} style={{ backgroundColor: '#faf5ff', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontWeight: '700', color: '#6b21a8', marginBottom: '0.3rem' }}>
                      {cqa?.name} ({nm.cqaCode}) — Kiến trúc MLP [{nm.config.hiddenNodes1}{nm.config.hiddenNodes2 > 0 ? `, ${nm.config.hiddenNodes2}` : ''}] ({nm.config.activation.toUpperCase()}) {nm.architectureMode === 'shared' ? '(Mạng Hợp Nhất)' : '(Mạng Độc Lập)'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.4rem' }}>
                      Train R² = <strong style={{ color: '#1e3a8a' }}>{nm.diagnostics.rSquaredTrain}</strong> | Val R² = <strong style={{ color: '#dc2626' }}>{nm.diagnostics.rSquaredVal}</strong> | Overall R² = <strong style={{ color: '#7c3aed' }}>{nm.diagnostics.rSquaredOverall}</strong> | RMSE = <strong>{nm.diagnostics.rmseOverall}</strong> (Tour #{nm.diagnostics.bestTourIndex})
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b21a8', marginBottom: '0.4rem' }}>
                      <strong>Validation:</strong> {nm.config.validationMethod === 'kfold' ? `K-fold (K=${nm.config.kFolds ?? 5})` : `Holdout ${Math.round(nm.config.holdoutRatio * 100)}%`}; số run dùng Carpenter đã trừ tập validation.
                      {new Set(project.runs.map((run) => Math.max(1, Math.floor(run.block ?? 1)))).size > 1 && ' Block là biến nuisance khi huấn luyện; dự báo/tối ưu hóa dùng Block 1 làm mốc.'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b21a8' }}>
                      <strong>Độ quan trọng yếu tố (Variable Importance): </strong>
                      {nm.diagnostics.variableImportance.map((v) => `${v.factorCode}: ${v.relativeImportance}%`).join(' • ')}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* 6. Optimum & Prediction Profiler */}
        {optimum && (
          <div id="sec-6" className="report-section" style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
              6. Tối Ưu Hóa Đa Mục Tiêu (Desirability Profiler: Overall D = {optimum.overallDesirability})
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
                      <span style={{ color: '#475569' }}>{cqa.name} ({cqa.code}):</span>
                      <span>
                        <strong style={{ color: '#0f766e', marginRight: '0.5rem' }}>
                          {pred ? `${pred.value} ${cqa.unit}` : '-'}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {pred ? (Number.isFinite(pred.ciLow) ? `[${pred.ciLow} - ${pred.ciHigh}]` : 'CI chưa khả dụng') + ` (d=${pred.desirability})` : ''}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 6. Updated Risk Assessment Table (ICH Q9 & FDA ANDA) */}
        <div id="sec-6b" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            6. Đánh Giá Rủi Ro Cập Nhật Sau DoE (Updated Risk Assessment - ICH Q9 & FDA)
          </h2>
          <div className="table-container">
            <table className="qbd-table">
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th>Yếu Tố (Factor)</th>
                  <th>Chỉ Tiêu (CQA)</th>
                  <th style={{ textAlign: 'center' }}>Rủi Ro Ban Đầu</th>
                  <th style={{ textAlign: 'center' }}>Ý Nghĩa DoE</th>
                  <th style={{ textAlign: 'center' }}>Rủi Ro Cập Nhật</th>
                  <th>Luận Giải Khoa Học Giảm Rủi Ro</th>
                </tr>
              </thead>
              <tbody>
                {generateUpdatedRiskAssessment(project, reportModels).map((item, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: '600' }}>{item.factorCode} ({item.factorName})</td>
                    <td style={{ fontWeight: '600' }}>{item.cqaCode} ({item.cqaName})</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${item.initialRisk === 'High' ? 'badge-danger' : item.initialRisk === 'Medium' ? 'badge-warning' : 'badge-success'}`}>
                        {item.initialRisk === 'High' ? 'Cao' : item.initialRisk === 'Medium' ? 'Trung bình' : 'Thấp'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="font-mono font-bold" style={{ color: item.isSignificantInModel ? '#1e3a8a' : '#64748b' }}>
                        {item.isSignificantInModel ? 'Có (p < 0.05)' : 'Không'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${item.updatedRisk === 'Low' ? 'badge-success' : 'badge-warning'}`}>
                        {item.updatedRisk === 'Low' ? 'Thấp (Low)' : 'Trung bình (Medium)'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: '#334155' }}>{item.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 7. Comprehensive Control Strategy (ICH Q10) */}
        <div id="sec-7" className="report-section" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            7. Bảng Chiến Lược Kiểm Soát Toàn Diện (ICH Q10 Comprehensive Control Strategy)
          </h2>
          <div className="table-container">
            <table className="qbd-table">
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th>Phân Loại</th>
                  <th>Thông Số / Thuộc Tính</th>
                  <th>Mục Tiêu (Target)</th>
                  <th>Khoảng NOR</th>
                  <th>Khoảng PAR</th>
                  <th>Phương Pháp Kiểm Soát</th>
                </tr>
              </thead>
              <tbody>
                {generateControlStrategy(project, optimum).map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <span className={`badge ${item.category.includes('CMA') ? 'badge-primary' : item.category.includes('CPP') ? 'badge-warning' : item.category.includes('IPC') ? 'badge-teal' : 'badge-success'}`} style={{ fontSize: '0.7rem' }}>
                        {item.category}
                      </span>
                    </td>
                    <td style={{ fontWeight: '600' }}>{item.parameterName} {item.parameterCode ? `(${item.parameterCode})` : ''}</td>
                    <td className="font-mono font-bold" style={{ color: '#0f766e' }}>{item.target}</td>
                    <td className="font-mono" style={{ color: '#2563eb' }}>{item.nor}</td>
                    <td className="font-mono" style={{ color: '#15803d' }}>{item.par}</td>
                    <td style={{ fontSize: '0.75rem', color: '#334155' }}>{item.controlMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 8. Monte Carlo Reliability */}
        {monteCarlo && (
          <div id="sec-8" className="report-section" style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
              8. Đánh Giá Độ Bền Vững Miền Dự Báo (Mô Phỏng Monte Carlo, tham chiếu ICH Q9)
            </h2>
            <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '1rem', fontSize: '0.85rem', color: '#14532d' }}>
              <div style={{ marginBottom: '0.3rem' }}>• Tổng số lô mô phỏng ảo: <strong>{monteCarlo.simulations.toLocaleString()} lô</strong></div>
              <div style={{ marginBottom: '0.3rem' }}>• Tỷ lệ mẫu đạt tiêu chí của các CQA đã mô hình hóa: <strong style={{ color: '#15803d', fontSize: '0.95rem' }}>{monteCarlo.reliabilityPercent}%</strong></div>
              <div style={{ marginBottom: '0.3rem' }}>• CQA đã mô hình hóa: <strong>{monteCarlo.modeledCqaCodes.join(', ') || 'Không có'}</strong></div>
              <div style={{ marginBottom: '0.3rem', color: monteCarlo.unmodeledCqaCodes.length ? '#b45309' : 'inherit' }}>• CQA chưa được bao phủ: <strong>{monteCarlo.unmodeledCqaCodes.join(', ') || 'Không có'}</strong></div>
              <div style={{ marginBottom: '0.3rem' }}>• Mẫu vượt miền khảo sát: <strong>{monteCarlo.excursionCount.toLocaleString()} ({monteCarlo.excursionRatePercent}%)</strong></div>
              <div>• Tỷ lệ lỗi dự kiến trong điều kiện mô phỏng (Defect Rate): <strong>{monteCarlo.defectRatePPM.toLocaleString()} PPM</strong></div>
            </div>
          </div>
        )}

        {/* 9. Sign-off & Regulatory Approval Block */}
        <div id="sec-9" className="report-section">
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.4rem', marginBottom: '0.75rem' }}>
            9. Ký Duyệt & Phê Chuẩn Hồ Sơ Phát Triển Dược Phẩm (Sign-off & Approval)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '1rem', marginTop: '1rem' }}>
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

        <div id="sec-governance" className="report-section" style={{ marginTop: '2rem' }}>
          <ProjectGovernancePanel project={project} onRestoreSnapshot={onRestoreSnapshot} />
        </div>

      </div>

    </div>

  </div>
);
};
