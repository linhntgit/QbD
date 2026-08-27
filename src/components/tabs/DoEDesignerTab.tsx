import React, { useState, useMemo, useRef } from 'react';
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
  Clipboard,
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  FileDown,
  Check,
  ChevronDown,
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
import {
  exportToExcel,
  exportToCSV,
  exportTemplateExcel,
  parseExcelFile,
  parseClipboardExcel,
  type ParsedDoEData,
} from '../../services/doeExcelService';

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

  // Excel / CSV / Clipboard import & export states
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importTab, setImportTab] = useState<'paste' | 'file'>('paste');
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [parsedData, setParsedData] = useState<ParsedDoEData | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Direct paste into table cells (handles multi-cell copy from Excel)
  const handleCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startRunIdx: number,
    startColType: 'factor' | 'cqa',
    startColCode: string
  ) => {
    const clipboardData = e.clipboardData.getData('text');
    if (!clipboardData || (!clipboardData.includes('\t') && !clipboardData.includes('\n'))) {
      return; // Regular single-cell paste handled by browser
    }
    e.preventDefault();

    const lines = clipboardData
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split('\t'));

    if (lines.length === 0) return;

    const allEditableCols: { type: 'factor' | 'cqa'; code: string }[] = [
      ...project.factors.map((f) => ({ type: 'factor' as const, code: f.code })),
      ...project.cqas.map((c) => ({ type: 'cqa' as const, code: c.code })),
    ];

    let startColIdx = 0;
    if (startColType === 'factor') {
      startColIdx = project.factors.findIndex((f) => f.code === startColCode);
      if (startColIdx === -1) startColIdx = 0;
    } else {
      const cqaIdx = project.cqas.findIndex((c) => c.code === startColCode);
      startColIdx = project.factors.length + (cqaIdx >= 0 ? cqaIdx : 0);
    }

    const updatedRuns = [...project.runs];

    lines.forEach((line, rOffset) => {
      const targetRunIdx = startRunIdx + rOffset;
      if (targetRunIdx >= updatedRuns.length) return;

      const run = { ...updatedRuns[targetRunIdx] };
      const factorActual = { ...run.factorActual };
      const factorCoded = { ...run.factorCoded };
      const responses = { ...run.responses };

      line.forEach((cellVal, cOffset) => {
        const targetColIdx = startColIdx + cOffset;
        if (targetColIdx >= allEditableCols.length) return;

        const col = allEditableCols[targetColIdx];
        const trimmedVal = cellVal.trim();
        if (trimmedVal === '') return;

        if (col.type === 'factor') {
          const factor = project.factors.find((f) => f.code === col.code);
          if (factor) {
            if (factor.dataType === 'qualitative') {
              factorActual[factor.code] = trimmedVal;
              factorCoded[factor.code] = actualToCoded(trimmedVal, factor);
            } else {
              const num = parseFloat(trimmedVal.replace(/,/g, '.'));
              if (!isNaN(num)) {
                factorActual[factor.code] = num;
                factorCoded[factor.code] = actualToCoded(num, factor);
              }
            }
          }
        } else {
          const cqa = project.cqas.find((c) => c.code === col.code);
          if (cqa) {
            if (cqa.dataType?.startsWith('qualitative')) {
              responses[cqa.code] = trimmedVal;
            } else {
              const num = parseFloat(trimmedVal.replace(/,/g, '.'));
              if (!isNaN(num)) {
                responses[cqa.code] = num;
              }
            }
          }
        }
      });

      run.factorActual = factorActual;
      run.factorCoded = factorCoded;
      run.responses = responses;
      updatedRuns[targetRunIdx] = run;
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
          const pass = Math.random() > 0.15;
          resp[cqa.code] = pass ? 'Đạt' : 'Không đạt';
          return;
        }

        const base = cqa.target ?? (cqa.lowerLimit ? (cqa.lowerLimit + (cqa.upperLimit || 100)) / 2 : 50);
        let effect = 0;

        project.factors.forEach((f, idx) => {
          if (f.controllability === 'constant') return;
          const coded = run.factorCoded[f.code] ?? 0;
          const weight = ((idx % 3) + 1) * 3.5;
          effect += coded * weight - 0.5 * coded * coded * weight;
        });

        if (project.factors.length >= 2) {
          const x1 = run.factorCoded[project.factors[0]?.code] ?? 0;
          const x2 = run.factorCoded[project.factors[1]?.code] ?? 0;
          effect += x1 * x2 * 4.2;
        }

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

  // Parse clipboard text from Textarea
  const handleParseClipboardText = (text: string) => {
    setRawPasteText(text);
    if (!text.trim()) {
      setParsedData(null);
      return;
    }
    const result = parseClipboardExcel(text, project.factors, project.cqas, project.runs);
    setParsedData(result);
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsProcessingFile(true);
    setFileError(null);
    try {
      const result = await parseExcelFile(file, project.factors, project.cqas, project.runs);
      setParsedData(result);
      setShowImportModal(true);
      setImportTab('file');
    } catch (err: any) {
      setFileError(err.message || 'Lỗi khi đọc file Excel/CSV.');
      setShowImportModal(true);
      setImportTab('file');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Apply parsed data into project runs
  const handleApplyImportedData = () => {
    if (!parsedData || parsedData.runs.length === 0) return;
    onUpdateProject({ runs: parsedData.runs });
    setShowImportModal(false);
    setParsedData(null);
    setRawPasteText('');
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Hidden File Input for Excel/CSV */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
            />

            {/* Smart Paste from Excel */}
            <button
              onClick={() => {
                setShowImportModal(true);
                setImportTab('paste');
                setFileError(null);
              }}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', backgroundColor: '#1d4ed8' }}
              title="Mở hộp thoại dán số liệu trực tiếp từ bảng tính MS Excel"
            >
              <Clipboard size={14} />
              <span>📋 Dán từ Excel</span>
            </button>

            {/* Upload Excel / CSV */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', backgroundColor: '#0284c7' }}
              title="Tải lên file dữ liệu MS Excel (.xlsx) hoặc CSV (.csv)"
              disabled={isProcessingFile}
            >
              <Upload size={14} />
              <span>{isProcessingFile ? 'Đang đọc file...' : '📤 Tải Lên (.xlsx/.csv)'}</span>
            </button>

            {/* Auto-fill Simulation Demo */}
            <button
              onClick={handleAutoSimulateData}
              className="btn btn-teal"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              title="Tự động sinh số liệu thực nghiệm mô phỏng dựa trên mô hình hóa dược phẩm để test nhanh"
            >
              <Sparkles size={14} />
              <span>Điền Mô Phỏng</span>
            </button>

            {/* Export Dropdown Menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                title="Tải bảng số liệu về máy tính dưới các định dạng"
              >
                <Download size={14} />
                <span>Xuất Dữ Liệu</span>
                <ChevronDown size={12} />
              </button>

              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.25rem',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    zIndex: 50,
                    minWidth: '220px',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => {
                      exportToExcel(project);
                      setShowExportMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.85rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.8rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <FileSpreadsheet size={15} color="#16a34a" />
                    <div>
                      <div style={{ fontWeight: '600' }}>Xuất File Excel (.xlsx)</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Đầy đủ biến X, mã hóa, đáp ứng Y</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      exportToCSV(project);
                      setShowExportMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.85rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.8rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <FileText size={15} color="#0284c7" />
                    <div>
                      <div style={{ fontWeight: '600' }}>Xuất File CSV (.csv)</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Chuẩn UTF-8 BOM tiếng Việt</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      exportTemplateExcel(project);
                      setShowExportMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.85rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      fontSize: '0.8rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <FileDown size={15} color="#d97706" />
                    <div>
                      <div style={{ fontWeight: '600' }}>Tải Mẫu Nhập Liệu Lab</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>File Excel mẫu để kỹ thuật viên điền</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
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
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.4rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span>💡</span>
                <span>
                  <strong>Hỗ trợ dán trực tiếp (Copy/Paste):</strong> Bạn có thể copy một vùng ô số liệu từ Excel và nhấn <code>Ctrl+V</code> trực tiếp vào bất kỳ ô nào trong bảng.
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', color: '#0d9488', fontWeight: '600' }}>
                ✓ Tự động chuẩn hóa Coded &amp; cập nhật phân tích
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
                  {project.runs.map((run, runIdx) => (
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
                                onPaste={(e) => handleCellPaste(e, runIdx, 'factor', f.code)}
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
                              onPaste={(e) => handleCellPaste(e, runIdx, 'cqa', c.code)}
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

      {/* Modal: Smart Excel / CSV Import & Validation */}
      {showImportModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="qbd-card animate-fade-in"
            style={{
              width: '100%',
              maxWidth: '850px',
              maxHeight: '90vh',
              overflowY: 'auto',
              backgroundColor: '#ffffff',
              borderRadius: '0.75rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileSpreadsheet size={22} color="#1d4ed8" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                  Nhập &amp; Đối Soát Bảng Số Liệu Thực Nghiệm Từ Excel / CSV
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setParsedData(null);
                }}
                className="btn"
                style={{ padding: '0.35rem', color: '#64748b', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <button
                onClick={() => setImportTab('paste')}
                className={`btn ${importTab === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem', borderRadius: '0.375rem 0.375rem 0 0' }}
              >
                <Clipboard size={14} />
                <span>1. Dán từ Clipboard (Copy/Paste)</span>
              </button>

              <button
                onClick={() => setImportTab('file')}
                className={`btn ${importTab === 'file' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem', borderRadius: '0.375rem 0.375rem 0 0' }}
              >
                <Upload size={14} />
                <span>2. Tải Lên File (.xlsx / .csv)</span>
              </button>
            </div>

            {/* Tab 1: Paste Textarea */}
            {importTab === 'paste' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                  Sao chép vùng bảng trong <strong>MS Excel</strong> (kèm tiêu đề cột hoặc chỉ các cột số liệu) rồi dán <strong>(Ctrl+V)</strong> vào ô dưới đây:
                </div>
                <textarea
                  className="input-field font-mono"
                  rows={6}
                  style={{ width: '100%', fontSize: '0.78rem', lineHeight: '1.4', padding: '0.6rem', resize: 'vertical' }}
                  placeholder="Dán dữ liệu bảng từ Excel vào đây (Tab-separated)..."
                  value={rawPasteText}
                  onChange={(e) => handleParseClipboardText(e.target.value)}
                />
              </div>
            )}

            {/* Tab 2: File Upload Area */}
            {importTab === 'file' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed #93c5fd',
                    backgroundColor: '#eff6ff',
                    borderRadius: '0.5rem',
                    padding: '1.75rem 1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#93c5fd')}
                >
                  <Upload size={32} color="#2563eb" style={{ margin: '0 auto 0.5rem' }} />
                  <div style={{ fontWeight: '600', color: '#1e40af', fontSize: '0.9rem' }}>
                    Click để chọn file hoặc kéo thả file Excel / CSV vào đây
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    Hỗ trợ định dạng: .xlsx, .xls, .csv
                  </div>
                </div>

                {fileError && (
                  <div
                    style={{
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '0.375rem',
                      padding: '0.6rem',
                      color: '#b91c1c',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <AlertCircle size={16} />
                    <span>{fileError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Validation & Column Matching Inspection Results */}
            {parsedData && (
              <div
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: '0.5rem',
                  backgroundColor: '#f8fafc',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {parsedData.isValid ? (
                      <CheckCircle2 size={18} color="#16a34a" />
                    ) : (
                      <AlertCircle size={18} color="#dc2626" />
                    )}
                    <span style={{ fontSize: '0.88rem', fontWeight: '700', color: parsedData.isValid ? '#15803d' : '#b91c1c' }}>
                      {parsedData.isValid
                        ? `✓ Đã nhận diện thành công ${parsedData.numRuns} lần chạy thực nghiệm`
                        : `⚠ Phát hiện lỗi trong cấu trúc dữ liệu`}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Tìm thấy {parsedData.headers.length} cột
                  </span>
                </div>

                {/* Column Mappings Badges */}
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                    Đối Soát Ánh Xạ Cột (Column Schema Matching):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {parsedData.columnMappings.map((map, idx) => {
                      const isMatched = map.matchedType !== 'ignored';
                      return (
                        <span
                          key={`map-${idx}`}
                          style={{
                            fontSize: '0.72rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '0.25rem',
                            backgroundColor: isMatched ? '#dcfce7' : '#f1f5f9',
                            color: isMatched ? '#166534' : '#64748b',
                            border: `1px solid ${isMatched ? '#86efac' : '#cbd5e1'}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          {isMatched ? '✓' : '•'} <strong>{map.headerName || `Cột ${idx + 1}`}</strong> →{' '}
                          {map.matchedCode ? `${map.matchedCode} (${map.matchedName})` : map.matchedName || 'Bỏ qua'}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Data Errors / Warnings list */}
                {parsedData.errors.length > 0 && (
                  <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {parsedData.errors.map((err, eIdx) => (
                      <div
                        key={`err-${eIdx}`}
                        style={{
                          fontSize: '0.73rem',
                          color: err.severity === 'error' ? '#b91c1c' : '#b45309',
                          backgroundColor: err.severity === 'error' ? '#fef2f2' : '#fffbeb',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          border: `1px solid ${err.severity === 'error' ? '#fecaca' : '#fde68a'}`,
                        }}
                      >
                        <strong>[Dòng {err.row} - Cột {err.column}]:</strong> {err.message}
                      </div>
                    ))}
                  </div>
                )}

                {/* Data Preview Table (First 5 Rows) */}
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                    Xem Trước Dữ Liệu Sau Khi Chuyển Đổi (5 dòng đầu):
                  </div>
                  <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.375rem' }}>
                    <table className="qbd-table" style={{ fontSize: '0.72rem' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '35px' }}>Run</th>
                          {project.factors.map((f) => (
                            <th key={`prev-f-${f.id}`}>{f.code}</th>
                          ))}
                          {project.cqas.map((c) => (
                            <th key={`prev-c-${c.id}`}>{c.code}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedData.runs.slice(0, 5).map((r, rIdx) => (
                          <tr key={`prev-row-${rIdx}`}>
                            <td style={{ fontWeight: '700', textAlign: 'center' }}>{r.runOrder}</td>
                            {project.factors.map((f) => (
                              <td key={`prev-f-val-${f.id}`}>{r.factorActual[f.code] ?? '-'}</td>
                            ))}
                            {project.cqas.map((c) => (
                              <td key={`prev-c-val-${c.id}`} style={{ fontWeight: '600', color: '#0f766e' }}>
                                {r.responses[c.code] ?? '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setParsedData(null);
                  setRawPasteText('');
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
              >
                Hủy Bỏ
              </button>

              <button
                onClick={handleApplyImportedData}
                disabled={!parsedData || !parsedData.isValid || parsedData.runs.length === 0}
                className="btn btn-primary"
                style={{
                  fontSize: '0.82rem',
                  padding: '0.45rem 1.25rem',
                  backgroundColor: !parsedData || !parsedData.isValid ? '#94a3b8' : '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <Check size={16} />
                <span>✓ Xác Nhận &amp; Cập Nhật Vào Ma Trận Thí Nghiệm</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

