import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  Sparkles,
  RefreshCw,
  Download,
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
  Copy,
  ArrowUpDown,
  Trash2,
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

  // --- Excel Spreadsheet Selection & Bi-directional Clipboard Sync ---
  interface CellCoord {
    r: number;
    c: number;
  }
  interface SelectionRange {
    start: CellCoord;
    end: CellCoord;
  }

  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const activeFactors = useMemo(
    () => project.factors.filter((f) => f.controllability !== 'constant'),
    [project.factors]
  );
  const mixtureFactors = useMemo(
    () => project.factors.filter((f) => f.role === 'mixture_component' || f.type === 'Mixture'),
    [project.factors]
  );

  // Define dynamic Excel spreadsheet columns (A, B, C, D...)
  const spreadsheetCols = useMemo(() => {
    const cols: {
      id: string;
      letter: string;
      title: string;
      subTitle?: string;
      type: 'std' | 'run' | 'factor' | 'mixture_sum' | 'coded' | 'cqa';
      code: string;
      factor?: typeof project.factors[0];
      cqa?: typeof project.cqas[0];
      isEditable: boolean;
      headerBg: string;
      headerColor: string;
    }[] = [];

    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const getLetter = (index: number) => {
      if (index < 26) return colLetters[index];
      const first = Math.floor(index / 26) - 1;
      const second = index % 26;
      return colLetters[first] + colLetters[second];
    };

    let colIdx = 0;

    // 1. Std Order
    cols.push({
      id: 'col-std',
      letter: getLetter(colIdx++),
      title: 'Std',
      type: 'std',
      code: 'std',
      isEditable: false,
      headerBg: '#f8fafc',
      headerColor: '#64748b',
    });

    // 2. Run Order
    cols.push({
      id: 'col-run',
      letter: getLetter(colIdx++),
      title: 'Run',
      subTitle: '(Sửa)',
      type: 'run',
      code: 'run',
      isEditable: true,
      headerBg: '#eff6ff',
      headerColor: '#1d4ed8',
    });

    // 3. Factor Actual Columns
    project.factors.forEach((f) => {
      const isMix = f.role === 'mixture_component';
      const isConstant = f.controllability === 'constant';
      const isUncontrolled = f.controllability === 'uncontrollable_noise';
      cols.push({
        id: `col-fac-${f.id}`,
        letter: getLetter(colIdx++),
        title: `${f.name} (${f.code}) [${f.unit}]`,
        subTitle: isMix ? '(Hỗn hợp)' : isUncontrolled ? '(Nhiễu)' : isConstant ? '(Hằng số)' : '(Thực tế)',
        type: 'factor',
        code: f.code,
        factor: f,
        isEditable: f.controllability !== 'constant',
        headerBg: isMix ? '#f0fdfa' : isConstant ? '#f1f5f9' : isUncontrolled ? '#fef3c7' : '#eff6ff',
        headerColor: isMix ? '#0f766e' : isConstant ? '#475569' : isUncontrolled ? '#92400e' : '#1e40af',
      });
    });

    // 4. Mixture Sum Column (if mixture factors exist)
    if (mixtureFactors.length > 0) {
      cols.push({
        id: 'col-mix-sum',
        letter: getLetter(colIdx++),
        title: 'Σ Hỗn Hợp',
        subTitle: '(Chuẩn 100%)',
        type: 'mixture_sum',
        code: 'mix_sum',
        isEditable: false,
        headerBg: '#ecfdf5',
        headerColor: '#065f46',
      });
    }

    // 5. Coded Columns
    project.factors.forEach((f) => {
      cols.push({
        id: `col-coded-${f.id}`,
        letter: getLetter(colIdx++),
        title: `${f.code} (Mã)`,
        type: 'coded',
        code: f.code,
        factor: f,
        isEditable: false,
        headerBg: '#f8fafc',
        headerColor: '#64748b',
      });
    });

    // 6. CQA Columns
    project.cqas.forEach((c) => {
      cols.push({
        id: `col-cqa-${c.id}`,
        letter: getLetter(colIdx++),
        title: `${c.name} (${c.code}) [${c.unit || ''}]`,
        type: 'cqa',
        code: c.code,
        cqa: c,
        isEditable: true,
        headerBg: '#ccfbf1',
        headerColor: '#0f766e',
      });
    });

    return cols;
  }, [project.factors, project.cqas, mixtureFactors]);

  const getCellValue = (run: typeof project.runs[0], col: typeof spreadsheetCols[0]): string | number => {
    switch (col.type) {
      case 'std':
        return run.stdOrder;
      case 'run':
        return run.runOrder;
      case 'factor':
        return run.factorActual[col.code] ?? '';
      case 'mixture_sum': {
        const sum = mixtureFactors.reduce((acc, f) => {
          const v = Number(run.factorActual[f.code]);
          return acc + (isNaN(v) ? 0 : v);
        }, 0);
        return Number(sum.toFixed(2));
      }
      case 'coded': {
        const v = run.factorCoded[col.code];
        return col.factor?.controllability === 'constant'
          ? '🔒 C'
          : typeof v === 'number'
          ? Number(v.toFixed(2))
          : (v ?? '-');
      }
      case 'cqa':
        return run.responses[col.code] ?? '';
    }
  };

  const normalizedRange = useMemo(() => {
    if (!selection) return null;
    const minR = Math.min(selection.start.r, selection.end.r);
    const maxR = Math.max(selection.start.r, selection.end.r);
    const minC = Math.min(selection.start.c, selection.end.c);
    const maxC = Math.max(selection.start.c, selection.end.c);
    return { minR, maxR, minC, maxC };
  }, [selection]);

  const selectionStats = useMemo(() => {
    if (!normalizedRange || project.runs.length === 0) return null;
    const { minR, maxR, minC, maxC } = normalizedRange;

    let totalCount = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let r = minR; r <= maxR; r++) {
      const run = project.runs[r];
      if (!run) continue;
      for (let c = minC; c <= maxC; c++) {
        totalCount++;
        const val = getCellValue(run, spreadsheetCols[c]);
        if (typeof val === 'number' && !isNaN(val)) {
          numericCount++;
          sum += val;
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
    }

    const startColLetter = spreadsheetCols[minC]?.letter || 'A';
    const endColLetter = spreadsheetCols[maxC]?.letter || 'A';
    const rangeName =
      minR === maxR && minC === maxC
        ? `${startColLetter}${minR + 1}`
        : `${startColLetter}${minR + 1}:${endColLetter}${maxR + 1}`;

    return {
      rangeName,
      totalCount,
      numericCount,
      sum: numericCount > 0 ? Number(sum.toFixed(2)) : 0,
      avg: numericCount > 0 ? Number((sum / numericCount).toFixed(2)) : 0,
      min: numericCount > 0 ? min : 0,
      max: numericCount > 0 ? max : 0,
    };
  }, [normalizedRange, project.runs, spreadsheetCols]);

  const handleCopySelection = () => {
    if (project.runs.length === 0) return;
    const range = normalizedRange || {
      minR: 0,
      maxR: project.runs.length - 1,
      minC: 0,
      maxC: spreadsheetCols.length - 1,
    };

    const rowsText: string[] = [];
    for (let r = range.minR; r <= range.maxR; r++) {
      const run = project.runs[r];
      if (!run) continue;
      const rowVals: (string | number)[] = [];
      for (let c = range.minC; c <= range.maxC; c++) {
        rowVals.push(getCellValue(run, spreadsheetCols[c]));
      }
      rowsText.push(rowVals.join('\t'));
    }

    const tsv = rowsText.join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      const startLetter = spreadsheetCols[range.minC]?.letter;
      const endLetter = spreadsheetCols[range.maxC]?.letter;
      const name = `${startLetter}${range.minR + 1}:${endLetter}${range.maxR + 1}`;
      showToast(`✓ Đã sao chép vùng ${name} (${(range.maxR - range.minR + 1) * (range.maxC - range.minC + 1)} ô) vào Clipboard!`);
    });
  };

  const handlePasteMatrix = (clipboardText: string, anchorRow?: number, anchorCol?: number) => {
    if (!clipboardText || project.runs.length === 0) return;
    const startR = anchorRow !== undefined ? anchorRow : (normalizedRange ? normalizedRange.minR : (activeCell ? activeCell.r : 0));
    const startC = anchorCol !== undefined ? anchorCol : (normalizedRange ? normalizedRange.minC : (activeCell ? activeCell.c : 0));

    const lines = clipboardText
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split('\t'));

    if (lines.length === 0) return;

    const updatedRuns = [...project.runs];
    let pastedCount = 0;

    lines.forEach((line, rOffset) => {
      const targetR = startR + rOffset;
      if (targetR >= updatedRuns.length) return;

      const run = { ...updatedRuns[targetR] };
      const factorActual = { ...run.factorActual };
      const factorCoded = { ...run.factorCoded };
      const responses = { ...run.responses };
      let runOrder = run.runOrder;

      line.forEach((cellVal, cOffset) => {
        const targetC = startC + cOffset;
        if (targetC >= spreadsheetCols.length) return;

        const col = spreadsheetCols[targetC];
        if (!col.isEditable) return;

        const trimmed = cellVal.trim();
        if (trimmed === '') return;

        if (col.type === 'run') {
          const num = parseInt(trimmed);
          if (!isNaN(num)) {
            runOrder = num;
            pastedCount++;
          }
        } else if (col.type === 'factor' && col.factor) {
          const f = col.factor;
          if (f.dataType === 'qualitative') {
            factorActual[f.code] = trimmed;
            factorCoded[f.code] = actualToCoded(trimmed, f);
            pastedCount++;
          } else {
            const num = parseFloat(trimmed.replace(/,/g, '.'));
            if (!isNaN(num)) {
              factorActual[f.code] = num;
              factorCoded[f.code] = actualToCoded(num, f);
              pastedCount++;
            }
          }
        } else if (col.type === 'cqa' && col.cqa) {
          const c = col.cqa;
          if (c.dataType === 'qualitative_binary') {
            responses[c.code] = trimmed.toLowerCase().includes('đạt') || trimmed.toLowerCase() === 'pass' || trimmed === '1' ? 'Đạt' : 'Không đạt';
            pastedCount++;
          } else {
            const num = parseFloat(trimmed.replace(/,/g, '.'));
            if (!isNaN(num)) {
              responses[c.code] = num;
              pastedCount++;
            } else {
              responses[c.code] = trimmed;
              pastedCount++;
            }
          }
        }
      });

      updatedRuns[targetR] = {
        ...run,
        runOrder,
        factorActual,
        factorCoded,
        responses,
      };
    });

    onUpdateProject({ runs: updatedRuns });

    const endR = Math.min(updatedRuns.length - 1, startR + lines.length - 1);
    const endC = Math.min(spreadsheetCols.length - 1, startC + Math.max(...lines.map((l) => l.length)) - 1);
    setSelection({
      start: { r: startR, c: startC },
      end: { r: endR, c: endC },
    });
    showToast(`✓ Đã dán thành công ${pastedCount} ô từ Excel!`);
  };

  const handlePasteFromClipboard = () => {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          handlePasteMatrix(text);
        } else {
          setShowImportModal(true);
          setImportTab('paste');
        }
      }).catch(() => {
        setShowImportModal(true);
        setImportTab('paste');
      });
    } else {
      setShowImportModal(true);
      setImportTab('paste');
    }
  };

  const handleClearSelection = () => {
    if (!normalizedRange || project.runs.length === 0) return;
    const { minR, maxR, minC, maxC } = normalizedRange;
    const updatedRuns = [...project.runs];
    let clearedCount = 0;

    for (let r = minR; r <= maxR; r++) {
      const run = { ...updatedRuns[r] };
      const factorActual = { ...run.factorActual };
      const responses = { ...run.responses };

      for (let c = minC; c <= maxC; c++) {
        const col = spreadsheetCols[c];
        if (!col.isEditable) continue;
        if (col.type === 'factor') {
          factorActual[col.code] = '';
          clearedCount++;
        } else if (col.type === 'cqa') {
          responses[col.code] = '';
          clearedCount++;
        }
      }
      updatedRuns[r] = { ...run, factorActual, responses };
    }

    onUpdateProject({ runs: updatedRuns });
    showToast(`✓ Đã xóa dữ liệu ${clearedCount} ô trong vùng chọn!`);
  };
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

  // Manual Edit for Randomized Run Order
  const handleRunOrderChange = (runId: string, newOrder: number) => {
    const updatedRuns = project.runs.map((r) => {
      if (r.id !== runId) return r;
      return { ...r, runOrder: newOrder };
    });
    onUpdateProject({ runs: updatedRuns });
  };

  // Re-randomize Run Order (Fisher-Yates)
  const handleRandomizeRunOrder = () => {
    if (project.runs.length === 0) return;
    const n = project.runs.length;
    const orders = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orders[i], orders[j]] = [orders[j], orders[i]];
    }
    const updatedRuns = project.runs.map((r, idx) => ({
      ...r,
      runOrder: orders[idx],
    }));
    onUpdateProject({ runs: updatedRuns });
  };

  // Sort Runs by Run Order or Std Order
  const handleSortRuns = (by: 'run' | 'std') => {
    const sorted = [...project.runs].sort((a, b) => {
      return by === 'run' ? a.runOrder - b.runOrder : a.stdOrder - b.stdOrder;
    });
    onUpdateProject({ runs: sorted });
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

      {/* Experimental Matrix & Runs Table (Excel-like Interactive Spreadsheet) */}
      <div className="qbd-card" style={{ padding: '1rem', border: '1px solid #cbd5e1' }}>
        
        {/* Top Header & Action Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <FileSpreadsheet size={22} color="#16a34a" />
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                Bảng Tính Ma Trận Thực Nghiệm &amp; Kết Quả ({project.runs.length} lần chạy)
              </h3>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0, marginTop: '0.1rem' }}>
                Hỗ trợ chọn/bôi đen vùng dữ liệu 2D, Copy (Ctrl+C), Paste 2 chiều từ MS Excel (Ctrl+V) &amp; Xóa (Del).
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {/* Hidden File Input for Excel/CSV */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
            />

            {/* Copy Selected Range / Entire Table */}
            <button
              onClick={handleCopySelection}
              className="btn btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.35rem 0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: '#ffffff',
                borderColor: '#cbd5e1',
              }}
              title="Sao chép vùng ô đang chọn (hoặc toàn bộ bảng nếu chưa chọn) sang Clipboard (Ctrl+C)"
            >
              <Copy size={14} color="#2563eb" />
              <span>📋 Copy Vùng (Ctrl+C)</span>
            </button>

            {/* Paste from Clipboard */}
            <button
              onClick={handlePasteFromClipboard}
              className="btn btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.35rem 0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                backgroundColor: '#ffffff',
                borderColor: '#cbd5e1',
              }}
              title="Dán dữ liệu từ Clipboard vào ô/vùng đang chọn (Ctrl+V)"
            >
              <Clipboard size={14} color="#16a34a" />
              <span>📥 Dán Dữ Liệu (Ctrl+V)</span>
            </button>

            {/* Clear Selected Cells */}
            <button
              onClick={handleClearSelection}
              className="btn btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.35rem 0.6rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                backgroundColor: '#ffffff',
                borderColor: '#cbd5e1',
                color: '#dc2626',
              }}
              title="Xóa giá trị trong các ô đang chọn (Delete)"
            >
              <Trash2 size={13} />
              <span>Xóa Ô (Del)</span>
            </button>

            {/* Upload Excel / CSV */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', backgroundColor: '#0284c7' }}
              title="Tải lên file dữ liệu MS Excel (.xlsx) hoặc CSV (.csv)"
              disabled={isProcessingFile}
            >
              <Upload size={14} />
              <span>{isProcessingFile ? 'Đang đọc...' : '📤 Tải Lên'}</span>
            </button>

            {/* Randomize Run Order */}
            <button
              onClick={handleRandomizeRunOrder}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              title="Sinh ngẫu nhiên số thứ tự thực hiện thí nghiệm (Randomized Run Order) theo chuẩn DoE"
            >
              <Shuffle size={13} />
              <span>🎲 Xáo Run</span>
            </button>

            {/* Sort Runs by Run Order */}
            <button
              onClick={() => handleSortRuns('run')}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
              title="Sắp xếp danh sách bảng theo thứ tự thực hiện ngẫu nhiên (Run Order)"
            >
              <ArrowUpDown size={13} />
              <span>Sắp (Run)</span>
            </button>

            {/* Auto-fill Simulation Demo */}
            <button
              onClick={handleAutoSimulateData}
              className="btn btn-teal"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              title="Tự động sinh số liệu thực nghiệm mô phỏng dựa trên mô hình hóa dược phẩm để test nhanh"
            >
              <Sparkles size={13} />
              <span>Điền Mô Phỏng</span>
            </button>

            {/* Export Dropdown Menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                title="Tải bảng số liệu về máy tính dưới các định dạng"
              >
                <Download size={13} />
                <span>Xuất File</span>
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

        {/* Excel Formula / Name Box & Statistics Status Bar */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            padding: '0.35rem 0.65rem',
            marginBottom: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Excel Name Box */}
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #94a3b8',
                borderRadius: '3px',
                padding: '0.15rem 0.5rem',
                fontWeight: '700',
                fontFamily: 'monospace',
                color: '#0f172a',
                minWidth: '70px',
                textAlign: 'center',
              }}
              title="Tọa độ ô hoặc vùng chọn hiện tại (theo chuẩn bảng tính Excel)"
            >
              {selectionStats ? selectionStats.rangeName : 'A1'}
            </div>

            {/* Formula fx symbol */}
            <span style={{ fontWeight: '800', fontStyle: 'italic', color: '#16a34a', fontSize: '0.9rem' }}>
              fx
            </span>

            {/* Selection Summary Statistics */}
            {selectionStats && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#334155' }}>
                <span style={{ fontWeight: '600', color: '#0f172a' }}>
                  {selectionStats.totalCount > 1
                    ? `Đã chọn ${selectionStats.totalCount} ô`
                    : '1 ô'}
                </span>
                {selectionStats.numericCount > 0 && (
                  <>
                    <span style={{ color: '#94a3b8' }}>|</span>
                    <span><strong>Tổng:</strong> {selectionStats.sum}</span>
                    <span style={{ color: '#94a3b8' }}>|</span>
                    <span><strong>TB:</strong> {selectionStats.avg}</span>
                    <span style={{ color: '#94a3b8' }}>|</span>
                    <span><strong>Min:</strong> {selectionStats.min}</span>
                    <span style={{ color: '#94a3b8' }}>|</span>
                    <span><strong>Max:</strong> {selectionStats.max}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Toast Notification Pill */}
          {toastMsg && (
            <div
              className="animate-fade-in"
              style={{
                backgroundColor: toastMsg.type === 'success' ? '#dcfce7' : '#e0f2fe',
                color: toastMsg.type === 'success' ? '#15803d' : '#0369a1',
                border: `1px solid ${toastMsg.type === 'success' ? '#86efac' : '#7dd3fc'}`,
                padding: '0.15rem 0.6rem',
                borderRadius: '4px',
                fontWeight: '700',
                fontSize: '0.75rem',
              }}
            >
              {toastMsg.text}
            </div>
          )}

          {/* Mixture Constraint Audit Indicator */}
          {mixtureFactors.length > 0 && (
            <div>
              {(() => {
                const allPass = project.runs.every((r) => {
                  const sum = mixtureFactors.reduce((acc, f) => acc + (Number(r.factorActual[f.code]) || 0), 0);
                  return Math.abs(sum - 100) < 0.1;
                });
                return (
                  <span
                    style={{
                      fontWeight: '700',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      backgroundColor: allPass ? '#dcfce7' : '#fee2e2',
                      color: allPass ? '#15803d' : '#b91c1c',
                      border: `1px solid ${allPass ? '#86efac' : '#fca5a5'}`,
                    }}
                  >
                    {allPass ? `✓ Ràng buộc Hỗn Hợp: Σ = 100%` : `⚠ Chú ý: Có hàng chưa đạt Σ = 100%`}
                  </span>
                );
              })()}
            </div>
          )}
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
          /* Excel Spreadsheet Interactive Grid */
          <div
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                const sel = window.getSelection();
                if (!sel || sel.toString() === '') {
                  e.preventDefault();
                  handleCopySelection();
                }
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setSelection({
                  start: { r: 0, c: 0 },
                  end: { r: project.runs.length - 1, c: spreadsheetCols.length - 1 },
                });
              } else if (e.key === 'Delete') {
                const activeEl = document.activeElement;
                if (!activeEl || activeEl.tagName !== 'INPUT') {
                  e.preventDefault();
                  handleClearSelection();
                }
              }
            }}
            style={{
              maxHeight: '560px',
              overflow: 'auto',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              backgroundColor: '#ffffff',
              outline: 'none',
              userSelect: isDragging ? 'none' : 'text',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.82rem',
                tableLayout: 'auto',
              }}
            >
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                {/* Header Row 1: Excel Column Letters (A, B, C, D...) */}
                <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                  {/* Select All Top-Left Cell */}
                  <th
                    onClick={() => {
                      setSelection({
                        start: { r: 0, c: 0 },
                        end: { r: project.runs.length - 1, c: spreadsheetCols.length - 1 },
                      });
                    }}
                    style={{
                      width: '36px',
                      minWidth: '36px',
                      backgroundColor: '#e2e8f0',
                      borderRight: '1px solid #cbd5e1',
                      borderBottom: '1px solid #cbd5e1',
                      cursor: 'pointer',
                      textAlign: 'center',
                      padding: '0.2rem',
                    }}
                    title="Chọn toàn bộ bảng tính"
                  >
                    <div style={{ width: '8px', height: '8px', borderRight: '2px solid #94a3b8', borderBottom: '2px solid #94a3b8', margin: '0 auto' }} />
                  </th>

                  {spreadsheetCols.map((col, colIdx) => (
                    <th
                      key={`letter-${col.id}`}
                      onClick={() => {
                        setSelection({
                          start: { r: 0, c: colIdx },
                          end: { r: project.runs.length - 1, c: colIdx },
                        });
                        setActiveCell({ r: 0, c: colIdx });
                      }}
                      style={{
                        backgroundColor: '#f1f5f9',
                        color: '#475569',
                        fontWeight: '700',
                        fontSize: '0.72rem',
                        textAlign: 'center',
                        padding: '0.2rem 0.4rem',
                        borderRight: '1px solid #cbd5e1',
                        borderBottom: '1px solid #cbd5e1',
                        cursor: 'pointer',
                      }}
                      title={`Bấm để chọn toàn bộ Cột ${col.letter} (${col.title})`}
                    >
                      {col.letter}
                    </th>
                  ))}
                </tr>

                {/* Header Row 2: Variable & CQA Titles */}
                <tr style={{ borderBottom: '2px solid #94a3b8' }}>
                  <th
                    style={{
                      backgroundColor: '#f8fafc',
                      color: '#64748b',
                      borderRight: '1px solid #cbd5e1',
                      textAlign: 'center',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      padding: '0.35rem 0.2rem',
                    }}
                  >
                    #
                  </th>

                  {spreadsheetCols.map((col, colIdx) => (
                    <th
                      key={`title-${col.id}`}
                      onClick={() => {
                        setSelection({
                          start: { r: 0, c: colIdx },
                          end: { r: project.runs.length - 1, c: colIdx },
                        });
                        setActiveCell({ r: 0, c: colIdx });
                      }}
                      style={{
                        backgroundColor: col.headerBg,
                        color: col.headerColor,
                        padding: '0.45rem 0.5rem',
                        textAlign: col.type === 'std' || col.type === 'run' || col.type === 'mixture_sum' || col.type === 'coded' ? 'center' : 'left',
                        fontWeight: '700',
                        fontSize: '0.78rem',
                        borderRight: '1px solid #cbd5e1',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span>{col.title}</span>
                        {col.subTitle && (
                          <span style={{ fontSize: '0.66rem', fontWeight: 'normal', opacity: 0.85 }}>
                            {col.subTitle}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {project.runs.map((run, runIdx) => {
                  const sumMix = mixtureFactors.reduce((acc, f) => {
                    const v = Number(run.factorActual[f.code]);
                    return acc + (isNaN(v) ? 0 : v);
                  }, 0);
                  const is100 = Math.abs(sumMix - 100) < 0.1;

                  return (
                    <tr key={run.id} style={{ height: '32px' }}>
                      {/* Excel Row Header Number (1, 2, 3...) */}
                      <td
                        onClick={() => {
                          setSelection({
                            start: { r: runIdx, c: 0 },
                            end: { r: runIdx, c: spreadsheetCols.length - 1 },
                          });
                          setActiveCell({ r: runIdx, c: 0 });
                        }}
                        style={{
                          backgroundColor: '#f8fafc',
                          color: '#64748b',
                          fontWeight: '700',
                          textAlign: 'center',
                          fontSize: '0.72rem',
                          borderRight: '1px solid #cbd5e1',
                          borderBottom: '1px solid #cbd5e1',
                          cursor: 'pointer',
                          padding: '0.2rem',
                          userSelect: 'none',
                        }}
                        title={`Bấm để chọn toàn bộ Hàng ${runIdx + 1}`}
                      >
                        {runIdx + 1}
                      </td>

                      {/* Excel Data Cells */}
                      {spreadsheetCols.map((col, colIdx) => {
                        const inRange =
                          normalizedRange &&
                          runIdx >= normalizedRange.minR &&
                          runIdx <= normalizedRange.maxR &&
                          colIdx >= normalizedRange.minC &&
                          colIdx <= normalizedRange.maxC;

                        const isActive =
                          activeCell &&
                          activeCell.r === runIdx &&
                          activeCell.c === colIdx;

                        const isEdgeTop = inRange && runIdx === normalizedRange.minR;
                        const isEdgeBottom = inRange && runIdx === normalizedRange.maxR;
                        const isEdgeLeft = inRange && colIdx === normalizedRange.minC;
                        const isEdgeRight = inRange && colIdx === normalizedRange.maxC;

                        return (
                          <td
                            key={`cell-${run.id}-${col.id}`}
                            onMouseDown={(e) => {
                              if (e.shiftKey && activeCell) {
                                setSelection({
                                  start: activeCell,
                                  end: { r: runIdx, c: colIdx },
                                });
                              } else {
                                setActiveCell({ r: runIdx, c: colIdx });
                                setSelection({
                                  start: { r: runIdx, c: colIdx },
                                  end: { r: runIdx, c: colIdx },
                                });
                                setIsDragging(true);
                              }
                            }}
                            onMouseEnter={() => {
                              if (isDragging && selection) {
                                setSelection({
                                  ...selection,
                                  end: { r: runIdx, c: colIdx },
                                });
                              }
                            }}
                            style={{
                              padding: 0,
                              backgroundColor: inRange
                                ? '#dbeafe'
                                : col.type === 'mixture_sum'
                                ? '#f0fdf4'
                                : col.type === 'coded'
                                ? '#f8fafc'
                                : col.factor?.role === 'mixture_component'
                                ? '#f0fdfa'
                                : col.factor?.controllability === 'constant'
                                ? '#f8fafc'
                                : col.factor?.controllability === 'uncontrollable_noise'
                                ? '#fffbeb'
                                : col.type === 'cqa'
                                ? '#f0fdfa'
                                : '#ffffff',
                              borderTop: isEdgeTop ? '2px solid #2563eb' : '1px solid #cbd5e1',
                              borderBottom: isEdgeBottom ? '2px solid #2563eb' : '1px solid #cbd5e1',
                              borderLeft: isEdgeLeft ? '2px solid #2563eb' : '1px solid #cbd5e1',
                              borderRight: isEdgeRight ? '2px solid #2563eb' : '1px solid #cbd5e1',
                              boxShadow: isActive ? 'inset 0 0 0 2px #1d4ed8' : undefined,
                              textAlign: col.type === 'std' || col.type === 'run' || col.type === 'mixture_sum' || col.type === 'coded' ? 'center' : 'left',
                              position: 'relative',
                            }}
                          >
                            {/* 1. Std Order (Read-only) */}
                            {col.type === 'std' && (
                              <div style={{ padding: '0.35rem', fontWeight: '600', color: '#64748b', textAlign: 'center' }}>
                                {run.stdOrder}
                              </div>
                            )}

                            {/* 2. Run Order (Editable) */}
                            {col.type === 'run' && (
                              <input
                                type="number"
                                min={1}
                                max={999}
                                style={{
                                  width: '100%',
                                  height: '32px',
                                  border: 'none',
                                  outline: 'none',
                                  textAlign: 'center',
                                  fontWeight: '700',
                                  color: '#1d4ed8',
                                  backgroundColor: 'transparent',
                                  fontSize: '0.82rem',
                                  padding: '0.2rem',
                                }}
                                value={run.runOrder}
                                onFocus={() => {
                                  setActiveCell({ r: runIdx, c: colIdx });
                                  setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                }}
                                onChange={(e) => handleRunOrderChange(run.id, parseInt(e.target.value) || 1)}
                                onPaste={(e) => {
                                  const text = e.clipboardData.getData('text');
                                  if (text && (text.includes('\t') || text.includes('\n'))) {
                                    e.preventDefault();
                                    handlePasteMatrix(text, runIdx, colIdx);
                                  }
                                }}
                              />
                            )}

                            {/* 3. Factor Actual (Editable) */}
                            {col.type === 'factor' && col.factor && (
                              col.factor.dataType === 'qualitative' ? (
                                <select
                                  style={{
                                    width: '100%',
                                    height: '32px',
                                    border: 'none',
                                    outline: 'none',
                                    backgroundColor: 'transparent',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    color: '#1e3a8a',
                                    padding: '0 0.4rem',
                                  }}
                                  value={typeof run.factorActual[col.code] === 'string' ? run.factorActual[col.code] : ''}
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleFactorActualChange(run.id, col.code, e.target.value)}
                                >
                                  {col.factor.categories && col.factor.categories.length > 0 ? (
                                    col.factor.categories.map((cat) => (
                                      <option key={cat} value={cat}>{cat}</option>
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
                                  disabled={col.factor.controllability === 'constant'}
                                  style={{
                                    width: '100%',
                                    height: '32px',
                                    border: 'none',
                                    outline: 'none',
                                    backgroundColor: 'transparent',
                                    fontSize: '0.82rem',
                                    fontWeight: '600',
                                    color: col.factor.role === 'mixture_component'
                                      ? '#0f766e'
                                      : col.factor.controllability === 'uncontrollable_noise'
                                      ? '#b45309'
                                      : col.factor.controllability === 'constant'
                                      ? '#64748b'
                                      : '#1e3a8a',
                                    padding: '0 0.5rem',
                                    textAlign: 'center',
                                  }}
                                  value={run.factorActual[col.code] !== undefined && run.factorActual[col.code] !== null ? run.factorActual[col.code] : ''}
                                  placeholder="Nhập..."
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleFactorActualChange(run.id, col.code, e.target.value)}
                                  onPaste={(e) => {
                                    const text = e.clipboardData.getData('text');
                                    if (text && (text.includes('\t') || text.includes('\n'))) {
                                      e.preventDefault();
                                      handlePasteMatrix(text, runIdx, colIdx);
                                    }
                                  }}
                                />
                              )
                            )}

                            {/* 4. Mixture Sum (Read-only calculated) */}
                            {col.type === 'mixture_sum' && (
                              <div style={{ textAlign: 'center', padding: '0.2rem' }}>
                                <span
                                  style={{
                                    fontSize: '0.74rem',
                                    fontWeight: '700',
                                    padding: '0.12rem 0.45rem',
                                    borderRadius: '4px',
                                    backgroundColor: is100 ? '#dcfce7' : '#fee2e2',
                                    color: is100 ? '#15803d' : '#b91c1c',
                                    border: `1px solid ${is100 ? '#86efac' : '#fca5a5'}`,
                                    display: 'inline-block',
                                  }}
                                  title={is100 ? 'Đạt chuẩn 100%' : `Tổng = ${sumMix.toFixed(2)}%, không đạt 100%`}
                                >
                                  {is100 ? '✓ 100%' : `⚠ ${sumMix.toFixed(1)}%`}
                                </span>
                              </div>
                            )}

                            {/* 5. Coded Value (Read-only) */}
                            {col.type === 'coded' && (
                              <div style={{ textAlign: 'center', color: '#64748b', fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.35rem' }}>
                                {col.factor?.controllability === 'constant'
                                  ? '🔒 C'
                                  : typeof run.factorCoded[col.code] === 'number'
                                  ? Number(run.factorCoded[col.code]).toFixed(2)
                                  : run.factorCoded[col.code] ?? '-'}
                              </div>
                            )}

                            {/* 6. CQA Responses (Editable) */}
                            {col.type === 'cqa' && col.cqa && (
                              col.cqa.dataType === 'qualitative_binary' ? (
                                <select
                                  style={{
                                    width: '100%',
                                    height: '32px',
                                    border: 'none',
                                    outline: 'none',
                                    backgroundColor: 'transparent',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    color: '#0f766e',
                                    padding: '0 0.4rem',
                                  }}
                                  value={run.responses[col.code] ?? 'Đạt'}
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleResponseChange(run.id, col.code, e.target.value)}
                                >
                                  <option value="Đạt">✓ Đạt (Pass)</option>
                                  <option value="Không đạt">✗ Không đạt (Fail)</option>
                                </select>
                              ) : (
                                <input
                                  type="number"
                                  step="any"
                                  style={{
                                    width: '100%',
                                    height: '32px',
                                    border: 'none',
                                    outline: 'none',
                                    backgroundColor: 'transparent',
                                    fontSize: '0.82rem',
                                    fontWeight: '600',
                                    color: '#0f766e',
                                    padding: '0 0.5rem',
                                    textAlign: 'center',
                                  }}
                                  value={run.responses[col.code] ?? ''}
                                  placeholder="Nhập..."
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleResponseChange(run.id, col.code, e.target.value)}
                                  onPaste={(e) => {
                                    const text = e.clipboardData.getData('text');
                                    if (text && (text.includes('\t') || text.includes('\n'))) {
                                      e.preventDefault();
                                      handlePasteMatrix(text, runIdx, colIdx);
                                    }
                                  }}
                                />
                              )
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

