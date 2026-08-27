import React, { useState } from 'react';
import {
  ShieldAlert,
  Plus,
  Trash2,
  GitBranch,
  ArrowRight,
  HelpCircle,
} from 'lucide-react';
import type { QBDProject, FMEARiskItem } from '../../types/qbd';

interface FMEATabProps {
  project: QBDProject;
  onUpdateProject: (updated: Partial<QBDProject>) => void;
  onNavigateToDoE: () => void;
}

export const FMEATab: React.FC<FMEATabProps> = ({
  project,
  onUpdateProject,
  onNavigateToDoE,
}) => {
  const [activeSubView, setActiveSubView] = useState<'matrix' | 'fishbone'>('matrix');

  const calculateRiskLevel = (rpn: number): 'Low' | 'Medium' | 'High' => {
    if (rpn >= 100) return 'High';
    if (rpn >= 50) return 'Medium';
    return 'Low';
  };

  const handleAddRiskItem = () => {
    const defaultFactor = project.factors[0]?.id || '';
    const defaultCQA = project.cqas[0]?.id || '';
    const newItem: FMEARiskItem = {
      id: `fmea-${Date.now()}`,
      factorId: defaultFactor,
      cqaId: defaultCQA,
      failureMode: 'Mô tả nguy cơ sai lệch hoặc cơ chế ảnh hưởng',
      severity: 7,
      probability: 5,
      detectability: 3,
      rpn: 7 * 5 * 3, // 105
      riskLevel: 'High',
      justification: 'Cần khảo sát tương tác trong DoE',
      recommendedDoE: true,
    };
    onUpdateProject({ fmeaRisks: [...project.fmeaRisks, newItem] });
  };

  const handleUpdateRiskItem = (id: string, field: keyof FMEARiskItem, value: any) => {
    const updated = project.fmeaRisks.map((item) => {
      if (item.id !== id) return item;
      const mod = { ...item, [field]: value };
      if (field === 'severity' || field === 'probability' || field === 'detectability') {
        const s = field === 'severity' ? Number(value) : item.severity;
        const p = field === 'probability' ? Number(value) : item.probability;
        const d = field === 'detectability' ? Number(value) : item.detectability;
        mod.rpn = s * p * d;
        mod.riskLevel = calculateRiskLevel(mod.rpn);
        mod.recommendedDoE = mod.rpn >= 100;
      }
      return mod;
    });
    onUpdateProject({ fmeaRisks: updated });
  };

  const handleDeleteRiskItem = (id: string) => {
    onUpdateProject({ fmeaRisks: project.fmeaRisks.filter((item) => item.id !== id) });
  };

  // Summary counts
  const highRiskCount = project.fmeaRisks.filter((r) => r.riskLevel === 'High').length;
  const mediumRiskCount = project.fmeaRisks.filter((r) => r.riskLevel === 'Medium').length;
  const lowRiskCount = project.fmeaRisks.filter((r) => r.riskLevel === 'Low').length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header & Stats Bar */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <ShieldAlert size={22} color="#b45309" />
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Đánh giá Quản lý Rủi ro Chất lượng (Quality Risk Management - ICH Q9)
              </h2>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
              Áp dụng FMEA (Failure Mode and Effects Analysis) và Biểu đồ nhân quả Ishikawa để sàng lọc yếu tố đầu vào cho DoE.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem' }}>
              <button
                onClick={() => setActiveSubView('matrix')}
                className={`btn ${activeSubView === 'matrix' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', border: 'none' }}
              >
                Ma trận FMEA
              </button>
              <button
                onClick={() => setActiveSubView('fishbone')}
                className={`btn ${activeSubView === 'fishbone' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', border: 'none' }}
              >
                Sơ đồ Xương cá (Ishikawa)
              </button>
            </div>

            <button
              onClick={onNavigateToDoE}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
            >
              <span>Chuyển sang DoE</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Risk Metrics Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#991b1b' }}>RỦI RO CAO (HIGH RISK - RPN ≥ 100)</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#b91c1c', margin: '0.2rem 0' }}>{highRiskCount} yếu tố</div>
            <div style={{ fontSize: '0.75rem', color: '#7f1d1d' }}>Bắt buộc đưa vào khảo sát thực nghiệm DoE</div>
          </div>

          <div style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '0.5rem', padding: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#92400e' }}>RỦI RO TRUNG BÌNH (50 ≤ RPN &lt; 100)</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#b45309', margin: '0.2rem 0' }}>{mediumRiskCount} yếu tố</div>
            <div style={{ fontSize: '0.75rem', color: '#78350f' }}>Đánh giá dựa trên kiến thức tiền định / Kiểm soát</div>
          </div>

          <div style={{ backgroundColor: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.85rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#166534' }}>RỦI RO THẤP (RPN &lt; 50)</div>
            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#15803d', margin: '0.2rem 0' }}>{lowRiskCount} yếu tố</div>
            <div style={{ fontSize: '0.75rem', color: '#14532d' }}>Kiểm soát qua SOP & Giám sát thường quy</div>
          </div>
        </div>
      </div>

      {activeSubView === 'matrix' ? (
        /* FMEA Matrix Table */
        <div className="qbd-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
              Bảng Phân Tích Chế Độ Hư Hỏng & Tác Động (FMEA Matrix)
            </h3>
            <button onClick={handleAddRiskItem} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
              <Plus size={15} />
              <span>Thêm Hàng Đánh Giá Rủi Ro</span>
            </button>
          </div>

          <div className="table-container">
            <table className="qbd-table">
              <thead>
                <tr>
                  <th style={{ width: '15%' }}>Nhân tố (Factor)</th>
                  <th style={{ width: '15%' }}>CQA Bị Ảnh Hưởng</th>
                  <th style={{ width: '22%' }}>Chế độ sai lỗi / Cơ chế rủi ro</th>
                  <th style={{ width: '7%', textAlign: 'center' }} title="Severity (1-10)">S (Nghiêm trọng)</th>
                  <th style={{ width: '7%', textAlign: 'center' }} title="Probability (1-10)">P (Xác suất)</th>
                  <th style={{ width: '7%', textAlign: 'center' }} title="Detectability (1-10)">D (Phát hiện)</th>
                  <th style={{ width: '8%', textAlign: 'center' }} title="RPN = S x P x D">RPN</th>
                  <th style={{ width: '10%', textAlign: 'center' }}>Mức Rủi Ro</th>
                  <th style={{ width: '9%', textAlign: 'center' }}>Khảo sát DoE</th>
                  <th style={{ width: '5%', textAlign: 'center' }}>Xóa</th>
                </tr>
              </thead>
              <tbody>
                {project.fmeaRisks.map((item) => {
                  return (
                    <tr key={item.id}>
                      <td>
                        <select
                          className="input-field"
                          value={item.factorId}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'factorId', e.target.value)}
                        >
                          {project.factors.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} ({f.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="input-field"
                          value={item.cqaId}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'cqaId', e.target.value)}
                        >
                          {project.cqas.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="input-field"
                          value={item.failureMode}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'failureMode', e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="input-field"
                          style={{ textAlign: 'center' }}
                          value={item.severity}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'severity', Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="input-field"
                          style={{ textAlign: 'center' }}
                          value={item.probability}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'probability', Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="input-field"
                          style={{ textAlign: 'center' }}
                          value={item.detectability}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'detectability', Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className="font-mono"
                          style={{
                            fontWeight: '700',
                            fontSize: '0.95rem',
                            color: item.rpn >= 100 ? '#b91c1c' : item.rpn >= 50 ? '#b45309' : '#15803d',
                          }}
                        >
                          {item.rpn}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className={`badge ${
                            item.riskLevel === 'High'
                              ? 'badge-danger'
                              : item.riskLevel === 'Medium'
                              ? 'badge-warning'
                              : 'badge-success'
                          }`}
                        >
                          {item.riskLevel}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={item.recommendedDoE}
                          onChange={(e) => handleUpdateRiskItem(item.id, 'recommendedDoE', e.target.checked)}
                          style={{ width: '17px', height: '17px', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleDeleteRiskItem(item.id)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                          title="Xóa hàng rủi ro"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detailed RPN Scoring and Risk Classification Guide (ICH Q9 / FMEA Guidance) */}
          <div
            style={{
              marginTop: '1.25rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.625rem',
              padding: '1rem 1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HelpCircle size={18} color="#0f766e" />
                <h4 style={{ fontSize: '0.92rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                  💡 Ghi Chú Phân Loại Mức Rủi Ro &amp; Cách Đánh Giá Chỉ Số RPN (ICH Q9)
                </h4>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#0f766e', backgroundColor: '#ccfbf1', padding: '0.2rem 0.6rem', borderRadius: '4px', border: '1px solid #99f6e4' }}>
                Công thức: RPN = S (Nghiêm trọng) × P (Xác suất) × D (Khó phát hiện)
              </span>
            </div>

            {/* 3 Risk Level Threshold Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
              {/* High Risk Card */}
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '0.5rem',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🔴</span>
                    <span style={{ fontWeight: '700', color: '#991b1b', fontSize: '0.85rem' }}>
                      RỦI RO CAO (HIGH RISK)
                    </span>
                  </div>
                  <span style={{ fontWeight: '800', fontSize: '0.85rem', color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid #fca5a5' }}>
                    RPN ≥ 100
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#7f1d1d', margin: 0, lineHeight: 1.4 }}>
                  <strong>Khi nào là High:</strong> Nhân tố có khả năng gây sai lệch nghiêm trọng lên CQA, tần suất xuất hiện cao hoặc khó phát hiện qua kiểm tra thông thường (hoặc khi điểm nghiêm trọng <code>S ≥ 8</code>).
                </p>
                <div style={{ fontSize: '0.75rem', color: '#991b1b', backgroundColor: '#ffffff', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #fecaca', marginTop: '0.2rem' }}>
                  ⚡ <strong>Hành động:</strong> <strong>BẮT BUỘC</strong> đưa vào ma trận thực nghiệm DoE để xác định Design Space &amp; kiểm soát chặt.
                </div>
              </div>

              {/* Medium Risk Card */}
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '0.5rem',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🟡</span>
                    <span style={{ fontWeight: '700', color: '#92400e', fontSize: '0.85rem' }}>
                      RỦI RO TRUNG BÌNH (MEDIUM)
                    </span>
                  </div>
                  <span style={{ fontWeight: '800', fontSize: '0.85rem', color: '#b45309', backgroundColor: '#fef3c7', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid #fcd34d' }}>
                    50 ≤ RPN &lt; 100
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#78350f', margin: 0, lineHeight: 1.4 }}>
                  <strong>Khi nào là Medium:</strong> Nguy cơ tiềm ẩn có thể ảnh hưởng CQA nếu thông số dao động rộng, nhưng có thể bù trừ hoặc phát hiện ở mức độ vừa phải.
                </p>
                <div style={{ fontSize: '0.75rem', color: '#92400e', backgroundColor: '#ffffff', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #fde68a', marginTop: '0.2rem' }}>
                  🔍 <strong>Hành động:</strong> Đánh giá dựa trên dữ liệu tiền định / tài liệu, cân nhắc đưa vào sàng lọc sơ bộ (Screening DoE).
                </div>
              </div>

              {/* Low Risk Card */}
              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '0.5rem',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>🟢</span>
                    <span style={{ fontWeight: '700', color: '#166534', fontSize: '0.85rem' }}>
                      RỦI RO THẤP (LOW RISK)
                    </span>
                  </div>
                  <span style={{ fontWeight: '800', fontSize: '0.85rem', color: '#15803d', backgroundColor: '#dcfce7', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid #86efac' }}>
                    RPN &lt; 50
                  </span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#14532d', margin: 0, lineHeight: 1.4 }}>
                  <strong>Khi nào là Low:</strong> Tác động không đáng kể lên CQA, xác suất phát sinh lỗi rất thấp hoặc hệ thống kiểm soát tại chỗ phát hiện tức thì 100%.
                </p>
                <div style={{ fontSize: '0.75rem', color: '#166534', backgroundColor: '#ffffff', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid #bbf7d0', marginTop: '0.2rem' }}>
                  📋 <strong>Hành động:</strong> Kiểm soát thường quy qua quy trình thao tác chuẩn (SOP), không cần thiết khảo sát DoE.
                </div>
              </div>
            </div>

            {/* Explanation of S, P, D parameters */}
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '0.5rem',
                padding: '0.75rem 1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1rem',
                fontSize: '0.76rem',
                color: '#334155',
              }}
            >
              <div>
                <strong style={{ color: '#0f172a' }}>1. S (Severity - Mức độ nghiêm trọng, 1-10):</strong>
                <div style={{ marginTop: '0.2rem', color: '#64748b' }}>
                  Đánh giá hậu quả nếu lỗi xảy ra. <strong>1-3</strong>: Nhẹ, không ảnh hưởng CQA; <strong>4-6</strong>: Vừa phải; <strong>7-10</strong>: Rất nghiêm trọng, vi phạm Dược điển hoặc ảnh hưởng tính mạng/an toàn.
                </div>
              </div>
              <div>
                <strong style={{ color: '#0f172a' }}>2. P (Probability - Xác suất xảy ra, 1-10):</strong>
                <div style={{ marginTop: '0.2rem', color: '#64748b' }}>
                  Tần suất phát sinh nguyên nhân gây lỗi. <strong>1-3</strong>: Cực hiếm khi xảy ra; <strong>4-6</strong>: Thỉnh thoảng xuất hiện; <strong>7-10</strong>: Thường xuyên xảy ra liên tục nếu không kiểm soát.
                </div>
              </div>
              <div>
                <strong style={{ color: '#0f172a' }}>3. D (Detectability - Khó phát hiện, 1-10):</strong>
                <div style={{ marginTop: '0.2rem', color: '#64748b' }}>
                  Khả năng hệ thống kiểm soát phát hiện lỗi. <strong>1-3</strong>: Chắc chắn phát hiện (IPC Online 100%); <strong>4-6</strong>: Kiểm nghiệm mẫu QC; <strong>7-10</strong>: Rất khó/Không thể phát hiện.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Ishikawa Fishbone Diagram Visualization */
        <div className="qbd-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <GitBranch size={20} color="#0f766e" />
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
              Biểu Đồ Xương Cá (Ishikawa Cause-and-Effect Diagram)
            </h3>
          </div>

          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.75rem',
              padding: '1.5rem',
              position: 'relative',
              overflowX: 'auto',
            }}
          >
            <div style={{ minWidth: '700px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              
              {/* Fishbone Branches */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', width: '80%' }}>
                {/* Branch 1: Material (CMA) */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#1e3a8a', borderBottom: '2px solid #3b82f6', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    1. NGUYÊN LIỆU (Material / CMA)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    {project.factors.filter((f) => f.type === 'CMA' || f.type === 'Formulation').map((f) => (
                      <li key={f.id} style={{ marginBottom: '0.25rem' }}>
                        <strong>{f.name}</strong> ({f.low} - {f.high} {f.unit})
                      </li>
                    ))}
                    {project.factors.filter((f) => f.type === 'CMA' || f.type === 'Formulation').length === 0 && (
                      <li style={{ color: '#94a3b8' }}>Chưa có biến CMA</li>
                    )}
                  </ul>
                </div>

                {/* Branch 2: Machine / Equipment */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#0f766e', borderBottom: '2px solid #0d9488', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    2. THIẾT BỊ & THÔNG SỐ (Machine / CPP)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    {project.factors.filter((f) => f.type === 'CPP' || f.type === 'Process').map((f) => (
                      <li key={f.id} style={{ marginBottom: '0.25rem' }}>
                        <strong>{f.name}</strong> ({f.low} - {f.high} {f.unit})
                      </li>
                    ))}
                    {project.factors.filter((f) => f.type === 'CPP' || f.type === 'Process').length === 0 && (
                      <li style={{ color: '#94a3b8' }}>Chưa có biến CPP</li>
                    )}
                  </ul>
                </div>

                {/* Branch 3: Method / Quy trình */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#b45309', borderBottom: '2px solid #f59e0b', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    3. PHƯƠNG PHÁP & QUY TRÌNH (Method)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    <li>Trình tự nạp liệu & Trộn phân tán</li>
                    <li>Tốc độ gia nhiệt / Làm nguội</li>
                    <li>Thời gian ổn định hệ</li>
                  </ul>
                </div>

                {/* Branch 4: Measurement */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#6b21a8', borderBottom: '2px solid #a855f7', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    4. ĐO LƯỜNG & KIỂM NGHIỆM (Measurement)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    <li>Phương pháp HPLC / Độ hòa tan</li>
                    <li>Sai số thiết bị đo & Độ lặp lại</li>
                  </ul>
                </div>

                {/* Branch 5: Milieu / Environment */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#475569', borderBottom: '2px solid #94a3b8', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    5. MÔI TRƯỜNG (Milieu / Environment)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    <li>Nhiệt độ & Độ ẩm phòng pha chế (RH &lt; 40%)</li>
                    <li>Điều kiện bảo quản mẫu</li>
                  </ul>
                </div>

                {/* Branch 6: Man / Con người */}
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#0369a1', borderBottom: '2px solid #38bdf8', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                    6. CON NGƯỜI & THAO TÁC (Man)
                  </div>
                  <ul style={{ paddingLeft: '1.2rem', fontSize: '0.78rem', color: '#334155' }}>
                    <li>Đào tạo GMP & Thao tác dập viên</li>
                    <li>Kỹ thuật lấy mẫu đại diện</li>
                  </ul>
                </div>
              </div>

              {/* Central Spine Arrow & Fish Head */}
              <div style={{ display: 'flex', alignItems: 'center', marginLeft: '1.5rem', width: '20%' }}>
                <div style={{ flex: 1, height: '4px', backgroundColor: '#1e293b' }}></div>
                <div
                  style={{
                    backgroundColor: '#1e3a8a',
                    color: '#ffffff',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    textAlign: 'center',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                >
                  <div>CHẤT LƯỢNG THUỐC</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: '400', marginTop: '0.25rem', color: '#bfdbfe' }}>
                    (QTPP & CQAs Đạt Chuẩn)
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};
