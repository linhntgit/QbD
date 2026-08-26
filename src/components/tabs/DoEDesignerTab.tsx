import React, { useState, useMemo } from 'react';
import {
  LayoutGrid,
  Sparkles,
  RefreshCw,
  Download,
  Layers,
  ArrowRight,
  Shuffle,
  Gauge,
  Award,
} from 'lucide-react';
import type {
  QBDProject,
  DoEDesignConfig,
  DoEDesignType,
  DoECategory,
} from '../../types/qbd';
import {
  generateDoERuns,
  calculateDesignEfficiency,
  calculateNumModelTerms,
  actualToCoded,
} from '../../services/doeGenerator';

interface DoEDesignerTabProps {
  project: QBDProject;
  onUpdateProject: (updated: Partial<QBDProject>) => void;
  onNavigateToANOVA: () => void;
}

export const DoEDesignerTab: React.FC<DoEDesignerTabProps> = ({
  project,
  onUpdateProject,
  onNavigateToANOVA,
}) => {
  const [designConfig, setDesignConfig] = useState<DoEDesignConfig>(
    project.doeConfig || {
      category: 'RSM',
      designType: 'BoxBehnken',
      centerPoints: 3,
      replicates: 1,
      randomized: true,
      dOptimalModel: 'quadratic',
    }
  );

  const activeFactors = useMemo(
    () => project.factors.filter((f) => f.controllability !== 'constant'),
    [project.factors]
  );
  const minRequiredTerms = useMemo(
    () => calculateNumModelTerms(activeFactors.length, designConfig.dOptimalModel || 'Quadratic'),
    [activeFactors.length, designConfig.dOptimalModel]
  );

  // Calculate D-Efficiency and Matrix Metrics dynamically
  const designMetrics = useMemo(() => {
    return calculateDesignEfficiency(
      project.runs,
      project.factors,
      (designConfig.dOptimalModel as any) || 'Quadratic'
    );
  }, [project.runs, project.factors, designConfig.dOptimalModel]);

  const handleGenerateMatrix = () => {
    const { runs, alpha } = generateDoERuns(project.factors, designConfig);
    const updatedConfig = { ...designConfig, alpha };
    onUpdateProject({ doeConfig: updatedConfig, runs });
  };

  const handleFactorActualChange = (runId: string, factorCode: string, rawVal: string) => {
    const factor = project.factors.find((f) => f.code === factorCode);
    if (!factor) return;

    let parsedVal: number | string = rawVal;
    let codedVal = 0;

    if (factor.dataType === 'qualitative') {
      parsedVal = rawVal;
      codedVal = actualToCoded(rawVal, factor);
    } else {
      // Quantitative factor
      if (rawVal.trim() === '') {
        parsedVal = '';
        codedVal = 0;
      } else {
        const num = parseFloat(rawVal);
        if (!isNaN(num)) {
          parsedVal = num;
          codedVal = actualToCoded(num, factor);
        } else {
          parsedVal = rawVal;
          codedVal = 0;
        }
      }
    }

    const updatedRuns = project.runs.map((r) => {
      if (r.id !== runId) return r;
      return {
        ...r,
        factorActual: {
          ...r.factorActual,
          [factorCode]: parsedVal,
        },
        factorCoded: {
          ...r.factorCoded,
          [factorCode]: codedVal,
        },
      };
    });

    onUpdateProject({ runs: updatedRuns });
  };

  const handleResponseChange = (runId: string, cqaCode: string, value: string) => {
    const numVal = value === '' ? null : Number(value);
    const updatedRuns = project.runs.map((r) => {
      if (r.id !== runId) return r;
      return {
        ...r,
        responses: {
          ...r.responses,
          [cqaCode]: isNaN(numVal as any) ? value : numVal,
        },
      };
    });
    onUpdateProject({ runs: updatedRuns });
  };

  // Smart Auto-Fill simulated pharma response data based on factor interactions
  const handleAutoSimulateData = () => {
    if (project.runs.length === 0) return;

    const simulatedRuns = project.runs.map((run) => {
      const resp: Record<string, number | string> = {};

      project.cqas.forEach((cqa) => {
        if (cqa.dataType === 'qualitative_binary') {
          // Pass/fail simulation
          const pass = Math.random() > 0.15;
          resp[cqa.code] = pass ? 'Đạt' : 'Không đạt';
          return;
        }

        const base = cqa.target ?? (cqa.lowerLimit ? (cqa.lowerLimit + (cqa.upperLimit || 100)) / 2 : 50);
        let effect = 0;

        // Nonlinear response generation based on factors
        project.factors.forEach((f, idx) => {
          if (f.controllability === 'constant') return;
          const coded = run.factorCoded[f.code] ?? 0;
          const weight = ((idx % 3) + 1) * 3.5;
          effect += coded * weight - 0.5 * coded * coded * weight;
        });

        // 2FI interaction term
        if (project.factors.length >= 2) {
          const x1 = run.factorCoded[project.factors[0]?.code] ?? 0;
          const x2 = run.factorCoded[project.factors[1]?.code] ?? 0;
          effect += x1 * x2 * 4.2;
        }

        // Small Gaussian noise
        const noise = (Math.random() - 0.5) * (base * 0.03);
        const val = Number((base + effect + noise).toFixed(2));
        resp[cqa.code] = val;
      });

      return {
        ...run,
        responses: resp,
      };
    });

    onUpdateProject({ runs: simulatedRuns });
  };

  const handleExportCSV = () => {
    if (project.runs.length === 0) return;

    const headers = [
      'StdOrder',
      'RunOrder',
      ...project.factors.map((f) => `${f.name}(${f.code})`),
      ...project.cqas.map((c) => `${c.name}(${c.code})`),
    ];

    const rows = project.runs.map((r) => [
      r.stdOrder,
      r.runOrder,
      ...project.factors.map((f) => r.factorActual[f.code] ?? ''),
      ...project.cqas.map((c) => r.responses[c.code] ?? ''),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${project.name.replace(/\s+/g, '_')}_DoE_Matrix.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Design Selector Header */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <LayoutGrid size={22} color="#0284c7" />
              <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
                Thiết Kế Thí Nghiệm (Design of Experiments - DoE)
              </h2>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
              Lựa chọn mô hình thiết kế: <strong>RSM, D-Optimal, Combined Mixture-Process, Sàng lọc</strong> và đánh giá hiệu quả tối ưu <strong>D-Efficiency (D-eff)</strong>.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleGenerateMatrix}
              className="btn btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
            >
              <RefreshCw size={15} />
              <span>Tạo Ma Trận Thí Nghiệm</span>
            </button>

            <button
              onClick={onNavigateToANOVA}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
            >
              <span>Phân Tích ANOVA</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Configuration Selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Nhóm Thiết Kế (Category)
            </label>
            <select
              className="input-field"
              value={designConfig.category}
              onChange={(e) => {
                const cat = e.target.value as DoECategory;
                let defaultType: DoEDesignType = 'BoxBehnken';
                if (cat === 'Custom_Optimal') defaultType = 'DOptimal';
                if (cat === 'Combined_Mixture_Process') defaultType = 'Combined_Mixture_Factorial';
                if (cat === 'Screening') defaultType = 'FullFactorial2k';
                if (cat === 'Mixture') defaultType = 'SimplexCentroid';
                setDesignConfig({ ...designConfig, category: cat, designType: defaultType });
              }}
            >
              <option value="RSM">Bề mặt Đáp ứng (RSM - Tối ưu hóa)</option>
              <option value="Custom_Optimal">⚡ D-Optimal Design (D-Tối ưu / Thuật toán Fedorov)</option>
              <option value="Combined_Mixture_Process">🧪 Hỗn Hợp + Quy Trình (Combined Mixture-Process)</option>
              <option value="Mixture">Thiết kế Hỗn hợp (Mixture / Tá dược)</option>
              <option value="Screening">Sàng lọc Nhân tố (Screening)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Kiểu Thiết Kế Cụ Thể (Design Type)
            </label>
            <select
              className="input-field"
              value={designConfig.designType}
              onChange={(e) => setDesignConfig({ ...designConfig, designType: e.target.value as DoEDesignType })}
            >
              {designConfig.category === 'Custom_Optimal' && (
                <option value="DOptimal">D-Optimal Design (Tối đa hóa định thức |X^T X|)</option>
              )}
              {designConfig.category === 'Combined_Mixture_Process' && (
                <>
                  <option value="Combined_Mixture_Factorial">Combined Simplex x Factorial 2^p (Tích Hỗn hợp - Yếu tố)</option>
                  <option value="Combined_Mixture_RSM">Combined Simplex x Box-Behnken RSM (Tích Hỗn hợp - Bề mặt đáp ứng)</option>
                </>
              )}
              {designConfig.category === 'RSM' && (
                <>
                  <option value="BoxBehnken">Box-Behnken Design (BBD - Tiết kiệm số lần chạy)</option>
                  <option value="CCD_FaceCentered">Central Composite Face-Centered (CCF, α = 1.0)</option>
                  <option value="CCD_Rotatable">Central Composite Rotatable (CCR, α = (2^k)^1/4)</option>
                  <option value="CCD_Full">Central Composite Full (CCD Spherical)</option>
                </>
              )}
              {designConfig.category === 'Screening' && (
                <>
                  <option value="FullFactorial2k">Yếu tố Toàn phần (Full Factorial 2^k)</option>
                  <option value="FractionalFactorial">Yếu tố Bán phần (Fractional Factorial 2^(k-p))</option>
                  <option value="PlackettBurman">Plackett-Burman Design (PBD)</option>
                  <option value="Taguchi">Taguchi Orthogonal Array (L4/L8/L9/L12/L16)</option>
                </>
              )}
              {designConfig.category === 'Mixture' && (
                <>
                  <option value="SimplexCentroid">Simplex Centroid Design (Hỗn hợp Đa tâm)</option>
                  <option value="SimplexLattice">Simplex Lattice Design (Hỗn hợp Mạng lưới)</option>
                </>
              )}
            </select>
          </div>

          {/* D-Optimal Target Model & Run Count */}
          {designConfig.designType === 'DOptimal' ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#0369a1', marginBottom: '0.3rem' }}>
                  Bậc Mô Hình Mục Tiêu (Target Model)
                </label>
                <select
                  className="input-field"
                  value={designConfig.dOptimalModel || 'Quadratic'}
                  onChange={(e) => setDesignConfig({ ...designConfig, dOptimalModel: e.target.value as any })}
                >
                  <option value="Quadratic">Bậc 2 Toàn phần (Quadratic: Linear + 2FI + Quadratic)</option>
                  <option value="2FI">Tương tác 2 nhân tố (2FI: Linear + Interactions)</option>
                  <option value="Linear">Tuyến tính bậc 1 (Linear: Chỉ các hiệu ứng chính)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#0369a1', marginBottom: '0.3rem' }}>
                  Tổng Số Lần Chạy N (Tối thiểu {minRequiredTerms})
                </label>
                <input
                  type="number"
                  min={minRequiredTerms}
                  max={60}
                  className="input-field"
                  value={designConfig.numRuns || Math.max(minRequiredTerms + 4, 15)}
                  onChange={(e) => setDesignConfig({ ...designConfig, numRuns: Math.max(minRequiredTerms, Number(e.target.value)) })}
                />
              </div>
            </>
          ) : (
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
                Số Điểm Tâm (Center Points)
              </label>
              <input
                type="number"
                min={0}
                max={10}
                className="input-field"
                value={designConfig.centerPoints}
                onChange={(e) => setDesignConfig({ ...designConfig, centerPoints: Number(e.target.value) })}
              />
            </div>
          )}

          {/* Randomization */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.2rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={designConfig.randomized}
                onChange={(e) => setDesignConfig({ ...designConfig, randomized: e.target.checked })}
                style={{ width: '16px', height: '16px' }}
              />
              <Shuffle size={15} color="#475569" />
              <span>Ngẫu nhiên hóa (Randomize)</span>
            </label>
          </div>
        </div>
      </div>

      {/* D-Efficiency & Design Diagnostics Panel */}
      {designMetrics && (
        <div className="qbd-card" style={{ backgroundColor: '#ffffff', borderLeft: '4px solid #0284c7' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Gauge size={20} color="#0284c7" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
                Đánh Giá Hiệu Quả Thiết Kế (D-Efficiency & Design Diagnostics)
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Đánh giá chất lượng:</span>
              <span
                className={`badge ${
                  designMetrics.rating.includes('Xuất sắc')
                    ? 'badge-success'
                    : designMetrics.rating.includes('Tốt')
                    ? 'badge-teal'
                    : designMetrics.rating.includes('Chấp nhận')
                    ? 'badge-warning'
                    : 'badge-danger'
                }`}
                style={{ fontSize: '0.82rem', padding: '0.25rem 0.6rem' }}
              >
                <Award size={13} style={{ display: 'inline', marginRight: '4px' }} />
                {designMetrics.rating}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ backgroundColor: '#f0f9ff', padding: '0.85rem', borderRadius: '0.5rem', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#0369a1', textTransform: 'uppercase' }}>
                Hiệu Quả D (D-Efficiency)
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#0284c7', marginTop: '0.2rem' }}>
                {designMetrics.dEfficiency}%
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                Tối đa hóa |X<sup>T</sup>X|<sup>1/p</sup> / N
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '0.85rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', textTransform: 'uppercase' }}>
                Hiệu Quả A (A-Efficiency)
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#334155', marginTop: '0.2rem' }}>
                {designMetrics.aEfficiency}%
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                Giảm thiểu phương sai ước lượng hệ số
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '0.85rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', textTransform: 'uppercase' }}>
                Hiệu Quả G (G-Efficiency)
              </div>
              <div style={{ fontSize: '1.45rem', fontWeight: '800', color: '#334155', marginTop: '0.2rem' }}>
                {designMetrics.gEfficiency}%
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                Kiểm soát phương sai dự đoán cực đại
              </div>
            </div>

            <div style={{ backgroundColor: '#f8fafc', padding: '0.85rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', textTransform: 'uppercase' }}>
                Thông Số Ma Trận (Matrix)
              </div>
              <div style={{ fontSize: '0.82rem', marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div><strong>Số lần chạy (N):</strong> {designMetrics.numRuns}</div>
                <div><strong>Số hệ số (p):</strong> {designMetrics.numParameters} (Bậc tự do df={designMetrics.degreesOfFreedom})</div>
                <div><strong>Leverage max (h<sub>ii</sub>):</strong> {designMetrics.maxLeverage}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Experimental Matrix & Runs Table */}
      <div className="qbd-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Layers size={19} color="#0f766e" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
              Ma Trận Thực Nghiệm & Bảng Nhập Kết Quả ({project.runs.length} lần chạy)
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={handleAutoSimulateData}
              className="btn btn-teal"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              title="Tự động sinh số liệu thực nghiệm mô phỏng dựa trên mô hình hóa dược phẩm để test nhanh"
            >
              <Sparkles size={15} />
              <span>Điền Số Liệu Mô Phỏng (Demo)</span>
            </button>

            <button
              onClick={handleExportCSV}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              title="Tải bảng ma trận dưới dạng file CSV"
            >
              <Download size={15} />
              <span>Xuất CSV</span>
            </button>
          </div>
        </div>

        {project.runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
            <LayoutGrid size={40} color="#cbd5e1" style={{ margin: '0 auto 0.75rem' }} />
            <p style={{ fontWeight: '600' }}>Chưa có ma trận thí nghiệm</p>
            <p style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
              Vui lòng nhấn nút <strong>"Tạo Ma Trận Thí Nghiệm"</strong> ở phía trên để sinh bảng chạy.
            </p>
          </div>
        ) : (
          <div>
            <div
              style={{
                backgroundColor: '#f0fdfa',
                border: '1px solid #ccfbf1',
                borderRadius: '0.375rem',
                padding: '0.45rem 0.75rem',
                marginBottom: '0.65rem',
                fontSize: '0.76rem',
                color: '#0f766e',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <span>💡</span>
              <span>
                <strong>Hiệu chỉnh thực nghiệm:</strong> Bạn có thể sửa trực tiếp số liệu các biến X thực tế (đặc biệt là biến nhiễu <em>Uncontrolled Noise</em> hoặc khi điều kiện vận hành thực tế bị lệch so với thiết kế). Hệ thống sẽ tự động cập nhật mức mã hóa (Coded) và truyền số liệu này sang mô hình ANOVA / Mạng nơ-ron.
              </span>
            </div>

            <div className="table-container" style={{ maxHeight: '550px' }}>
              <table className="qbd-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ width: '45px', textAlign: 'center' }}>Std</th>
                    <th style={{ width: '45px', textAlign: 'center' }}>Run</th>
                    {/* Factor Actual Headers */}
                    {project.factors.map((f) => (
                      <th
                        key={`head-fac-${f.id}`}
                        style={{
                          backgroundColor: f.controllability === 'constant' ? '#f1f5f9' : f.controllability === 'uncontrollable_noise' ? '#fef3c7' : '#eff6ff',
                          color: f.controllability === 'constant' ? '#475569' : f.controllability === 'uncontrollable_noise' ? '#92400e' : '#1e40af',
                          minWidth: '130px',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span>{f.controllability === 'constant' ? '🔒' : f.controllability === 'uncontrollable_noise' ? '🌪️' : '🎯'}</span>
                            <span>{f.name} ({f.code}) [{f.unit}]</span>
                          </div>
                          <span style={{ fontSize: '0.68rem', fontWeight: 'normal', opacity: 0.85 }}>
                            {f.controllability === 'uncontrollable_noise' ? '(Biến nhiễu - Đo thực tế)' : '(Giá trị thực tế)'}
                          </span>
                        </div>
                      </th>
                    ))}
                    {/* Coded Headers */}
                    {project.factors.map((f) => (
                      <th key={`head-coded-${f.id}`} style={{ backgroundColor: '#f1f5f9', color: '#475569', textAlign: 'center', minWidth: '70px' }}>
                        {f.code} (Mã)
                      </th>
                    ))}
                    {/* CQA Response Headers */}
                    {project.cqas.map((c) => (
                      <th key={`head-cqa-${c.id}`} style={{ backgroundColor: '#ccfbf1', color: '#0f766e', minWidth: '120px' }}>
                        {c.name} ({c.code}) {c.dataType?.startsWith('qualitative') ? '[Định tính]' : `[${c.unit}]`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.runs.map((run) => (
                    <tr key={run.id}>
                      <td style={{ textAlign: 'center', fontWeight: '600', color: '#64748b' }}>
                        {run.stdOrder}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: '700', color: '#1e3a8a' }}>
                        {run.runOrder}
                      </td>

                      {/* Editable Factor Actual Inputs */}
                      {project.factors.map((f) => {
                        const isConstant = f.controllability === 'constant';
                        const isUncontrolled = f.controllability === 'uncontrollable_noise';
                        const val = run.factorActual[f.code];

                        return (
                          <td
                            key={`actual-${run.id}-${f.code}`}
                            style={{
                              backgroundColor: isConstant ? '#f8fafc' : isUncontrolled ? '#fffbeb' : '#ffffff',
                              padding: '0.25rem 0.35rem',
                            }}
                          >
                            {f.dataType === 'qualitative' ? (
                              <select
                                className="input-field"
                                style={{
                                  padding: '0.2rem 0.35rem',
                                  fontSize: '0.8rem',
                                  fontWeight: '600',
                                  color: '#1e3a8a',
                                  width: '100%',
                                }}
                                value={typeof val === 'string' ? val : ''}
                                onChange={(e) => handleFactorActualChange(run.id, f.code, e.target.value)}
                              >
                                {f.categories && f.categories.length > 0 ? (
                                  f.categories.map((cat) => (
                                    <option key={cat} value={cat}>
                                      {cat}
                                    </option>
                                  ))
                                ) : (
                                  <>
                                    <option value="Mức 1">Mức 1</option>
                                    <option value="Mức 2">Mức 2</option>
                                  </>
                                )}
                              </select>
                            ) : (
                              <input
                                type="number"
                                step="any"
                                className="input-field"
                                style={{
                                  padding: '0.25rem 0.4rem',
                                  fontSize: '0.82rem',
                                  fontWeight: '600',
                                  width: '100%',
                                  color: isUncontrolled ? '#b45309' : isConstant ? '#475569' : '#1e3a8a',
                                  backgroundColor: isConstant ? '#f1f5f9' : isUncontrolled ? '#fef3c7' : '#ffffff',
                                  borderColor: isUncontrolled ? '#f59e0b' : undefined,
                                }}
                                value={val !== undefined && val !== null ? val : ''}
                                placeholder="Nhập số..."
                                title={isUncontrolled ? 'Biến nhiễu không kiểm soát (Uncontrolled Noise) - Nhập giá trị thực tế đo được' : `${f.name} [${f.unit}]`}
                                onChange={(e) => handleFactorActualChange(run.id, f.code, e.target.value)}
                              />
                            )}
                          </td>
                        );
                      })}

                      {/* Recalculated Coded Values */}
                      {project.factors.map((f) => (
                        <td key={`coded-${run.id}-${f.code}`} style={{ textAlign: 'center', color: '#64748b' }} className="font-mono">
                          {f.controllability === 'constant'
                            ? '🔒 C'
                            : typeof run.factorCoded[f.code] === 'number'
                            ? Number(run.factorCoded[f.code]).toFixed(2)
                            : run.factorCoded[f.code] ?? '-'}
                        </td>
                      ))}

                      {/* CQA Responses (Editable Input) */}
                      {project.cqas.map((c) => (
                        <td key={`resp-${run.id}-${c.code}`} style={{ backgroundColor: '#f0fdfa' }}>
                          {c.dataType === 'qualitative_binary' ? (
                            <select
                              className="input-field"
                              style={{ padding: '0.2rem 0.4rem', fontWeight: '600', color: '#0f766e', fontSize: '0.8rem' }}
                              value={run.responses[c.code] ?? 'Đạt'}
                              onChange={(e) => handleResponseChange(run.id, c.code, e.target.value)}
                            >
                              <option value="Đạt">✓ Đạt (Pass)</option>
                              <option value="Không đạt">✗ Không đạt (Fail)</option>
                            </select>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              className="input-field"
                              style={{
                                padding: '0.25rem 0.5rem',
                                fontWeight: '600',
                                color: '#0f766e',
                                backgroundColor: '#ffffff',
                              }}
                              value={run.responses[c.code] ?? ''}
                              placeholder="Nhập..."
                              onChange={(e) => handleResponseChange(run.id, c.code, e.target.value)}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
