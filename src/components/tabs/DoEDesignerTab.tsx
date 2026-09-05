import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
  Plus,
  PlusCircle,
  CopyPlus,
  ListPlus,
} from 'lucide-react';
import type {
  QBDProject,
  DoERun,
  DoEDesignConfig,
  DoEDesignType,
  DoECategory,
  DoEDesignGoal,
} from '../../types/qbd';
import {
  generateDoERuns,
  calculateDesignEfficiency,
  calculateNumModelTerms,
  actualToCoded,
  assessDesignReadiness,
  augmentDOptimalDesign,
  recommendRunCount,
  validateDesignSetup,
  roundMixtureComponents,
} from '../../services/doeGenerator';
import { simulateDemoResponses } from '../../services/demoDataSimulator';
import { createSeededRandom, stableSeedFromText } from '../../services/random';
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
      dOptimalModel: 'Quadratic',
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
  const [showAddRowMenu, setShowAddRowMenu] = useState<boolean>(false);
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
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [augmentationRuns, setAugmentationRuns] = useState<number>(4);

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
      type: 'std' | 'run' | 'block' | 'factor' | 'mixture_sum' | 'coded' | 'cqa';
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

    // Execution block is editable per run so a practical run plan can be
    // corrected after generation (or pasted in from a manufacturing schedule).
    cols.push({
      id: 'col-block',
      letter: getLetter(colIdx++),
      title: 'Block',
      subTitle: '(Sửa)',
      type: 'block',
      code: 'block',
      isEditable: true,
      headerBg: '#f5f3ff',
      headerColor: '#6d28d9',
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

  const getCellValue = useCallback((run: typeof project.runs[0], col: typeof spreadsheetCols[0]): string | number => {
    switch (col.type) {
      case 'std':
        return run.stdOrder;
      case 'run':
        return run.runOrder;
      case 'block':
        return run.block ?? 1;
      case 'factor': {
        const v = run.factorActual[col.code];
        if (typeof v === 'number' && (col.factor?.role === 'mixture_component' || col.factor?.type === 'Mixture')) {
          return Number(Number(v).toFixed(4));
        }
        return v ?? '';
      }
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
  }, [mixtureFactors]);

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
  }, [normalizedRange, project.runs, spreadsheetCols, getCellValue]);

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

  // Helper to create a fully-initialized default DoERun with correct factors and coded values
  const createDefaultRun = (order: number): DoERun => {
    const newId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const factorActual: Record<string, number | string> = {};
    const factorCoded: Record<string, number> = {};

    const mixtureCount = mixtureFactors.length;
    const isMixturePercentage = mixtureCount > 0 && !mixtureFactors.every((f) => f.high <= 1.0 && f.unit !== '%');
    const targetSum = isMixturePercentage ? 100 : 1.0;
    const cleanDefaultMix = mixtureCount > 0
      ? roundMixtureComponents(new Array(mixtureCount).fill(targetSum / mixtureCount), targetSum, isMixturePercentage ? 2 : 4)
      : [];
    let mixIdx = 0;
    project.factors.forEach((f) => {
      if (f.dataType === 'qualitative' || f.dataType === 'quantitative_multilevel') {
        const defaultLevel = f.categories?.[0] || (f.dataType === 'qualitative' ? 'Mức 1' : String(f.low));
        factorActual[f.code] = f.dataType === 'quantitative_multilevel' ? Number(defaultLevel) : defaultLevel;
        factorCoded[f.code] = actualToCoded(defaultLevel, f);
      } else if (f.role === 'mixture_component' || f.type === 'Mixture') {
        const defaultVal = cleanDefaultMix[mixIdx++] ?? (f.center ?? f.low);
        factorActual[f.code] = defaultVal;
        factorCoded[f.code] = actualToCoded(defaultVal, f);
      } else {
        const defaultVal = f.center !== undefined ? f.center : Number(((f.low + f.high) / 2).toFixed(2));
        factorActual[f.code] = defaultVal;
        factorCoded[f.code] = actualToCoded(defaultVal, f);
      }
    });

    const responses: Record<string, number | string | null> = {};
    project.cqas.forEach((cqa) => {
      responses[cqa.code] = '';
    });

    return {
      id: newId,
      stdOrder: order,
      runOrder: order,
      block: 1,
      factorCoded,
      factorActual,
      responses,
    };
  };

  // Add a single new row (optionally at specified index)
  const handleAddRow = (insertAtIndex?: number) => {
    const targetIdx =
      insertAtIndex !== undefined && insertAtIndex >= 0 && insertAtIndex <= project.runs.length
        ? insertAtIndex
        : activeCell !== null
        ? activeCell.r + 1
        : project.runs.length;

    const newRun = createDefaultRun(targetIdx + 1);
    const nextRuns = [...project.runs];
    nextRuns.splice(targetIdx, 0, newRun);

    const updatedRuns = nextRuns.map((r, idx) => ({
      ...r,
      stdOrder: idx + 1,
      runOrder: r.runOrder ?? idx + 1,
    }));

    onUpdateProject({ runs: updatedRuns });
    setActiveCell({ r: targetIdx, c: 1 });
    setSelection({ start: { r: targetIdx, c: 0 }, end: { r: targetIdx, c: spreadsheetCols.length - 1 } });
    showToast(`✓ Đã thêm 1 dòng thí nghiệm mới (Hàng ${targetIdx + 1})`);
  };

  // Add multiple rows
  const handleAddMultipleRows = (count: number) => {
    if (count <= 0) return;
    const currentLen = project.runs.length;
    const newRuns: DoERun[] = [];
    for (let i = 0; i < count; i++) {
      newRuns.push(createDefaultRun(currentLen + i + 1));
    }
    const updatedRuns = [...project.runs, ...newRuns].map((r, idx) => ({
      ...r,
      stdOrder: idx + 1,
      runOrder: r.runOrder ?? idx + 1,
    }));
    onUpdateProject({ runs: updatedRuns });
    const newFirstIdx = currentLen;
    setActiveCell({ r: newFirstIdx, c: 1 });
    setSelection({ start: { r: newFirstIdx, c: 0 }, end: { r: updatedRuns.length - 1, c: spreadsheetCols.length - 1 } });
    showToast(`✓ Đã thêm ${count} dòng thí nghiệm mới vào bảng!`);
  };

  // Duplicate a specific row
  const handleDuplicateRow = (runIndex: number) => {
    if (runIndex < 0 || runIndex >= project.runs.length) return;
    const sourceRun = project.runs[runIndex];
    const newId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const clonedRun: DoERun = {
      ...sourceRun,
      id: newId,
      stdOrder: runIndex + 2,
      runOrder: runIndex + 2,
      factorActual: { ...sourceRun.factorActual },
      factorCoded: { ...sourceRun.factorCoded },
      responses: { ...sourceRun.responses },
    };

    const nextRuns = [...project.runs];
    nextRuns.splice(runIndex + 1, 0, clonedRun);

    const updatedRuns = nextRuns.map((r, idx) => ({
      ...r,
      stdOrder: idx + 1,
      runOrder: r.runOrder ?? idx + 1,
    }));

    onUpdateProject({ runs: updatedRuns });
    setActiveCell({ r: runIndex + 1, c: 1 });
    setSelection({ start: { r: runIndex + 1, c: 0 }, end: { r: runIndex + 1, c: spreadsheetCols.length - 1 } });
    showToast(`✓ Đã nhân bản Hàng ${runIndex + 1} thành Hàng ${runIndex + 2}!`);
  };

  // Delete a specific row
  const handleDeleteRow = (runIndex: number) => {
    if (runIndex < 0 || runIndex >= project.runs.length) return;
    const updatedRuns = project.runs
      .filter((_, idx) => idx !== runIndex)
      .map((r, idx) => ({
        ...r,
        stdOrder: idx + 1,
        runOrder: r.runOrder ?? idx + 1,
      }));

    onUpdateProject({ runs: updatedRuns });

    if (updatedRuns.length === 0) {
      setActiveCell(null);
      setSelection(null);
    } else {
      const nextR = Math.min(runIndex, updatedRuns.length - 1);
      setActiveCell({ r: nextR, c: 0 });
      setSelection({ start: { r: nextR, c: 0 }, end: { r: nextR, c: spreadsheetCols.length - 1 } });
    }
    showToast(`✓ Đã xóa dòng thí nghiệm (Hàng ${runIndex + 1})`);
  };

  // Delete selected rows
  const handleDeleteSelectedRows = () => {
    if (!normalizedRange || project.runs.length === 0) return;
    const minR = normalizedRange.minR;
    const maxR = normalizedRange.maxR;
    const countToDelete = maxR - minR + 1;

    const updatedRuns = project.runs
      .filter((_, idx) => idx < minR || idx > maxR)
      .map((r, idx) => ({
        ...r,
        stdOrder: idx + 1,
        runOrder: r.runOrder ?? idx + 1,
      }));

    onUpdateProject({ runs: updatedRuns });

    if (updatedRuns.length === 0) {
      setActiveCell(null);
      setSelection(null);
    } else {
      const nextR = Math.min(minR, updatedRuns.length - 1);
      setActiveCell({ r: nextR, c: 0 });
      setSelection({ start: { r: nextR, c: 0 }, end: { r: nextR, c: spreadsheetCols.length - 1 } });
    }
    showToast(`✓ Đã xóa ${countToDelete} dòng thí nghiệm đã chọn!`);
  };

  const handlePasteMatrix = (clipboardText: string, anchorRow?: number, anchorCol?: number) => {
    if (!clipboardText) return;
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
      // Auto-expand runs if targetR is beyond current length
      while (targetR >= updatedRuns.length) {
        updatedRuns.push(createDefaultRun(updatedRuns.length + 1));
      }

      const run = { ...updatedRuns[targetR] };
      const factorActual = { ...run.factorActual };
      const factorCoded = { ...run.factorCoded };
      const responses = { ...run.responses };
      let runOrder = run.runOrder;
      let block = run.block ?? 1;

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
        } else if (col.type === 'block') {
          const num = parseInt(trimmed);
          if (!isNaN(num) && num >= 1) {
            block = num;
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
          if (c.dataType === 'qualitative_binary' || c.dataType === 'qualitative_ordinal') {
            responses[c.code] = trimmed;
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
        block,
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
  const hasMixtureProcessFactors = useMemo(() => {
    const hasMixture = activeFactors.some((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
    const hasProcess = activeFactors.some((factor) => factor.role !== 'mixture_component' && factor.type !== 'Mixture');
    return hasMixture && hasProcess;
  }, [activeFactors]);
  const isOptimalDesign = designConfig.designType === 'DOptimal' || designConfig.designType === 'Combined_Mixture_DOptimal';
  const selectedOptimalModel = designConfig.dOptimalModel || (hasMixtureProcessFactors ? '2FI' : 'Quadratic');
  const minRequiredTerms = useMemo(
    () => calculateNumModelTerms(activeFactors.length, selectedOptimalModel, activeFactors),
    [activeFactors, selectedOptimalModel]
  );
  const recommendedOptimalRuns = useMemo(
    () => recommendRunCount(activeFactors, selectedOptimalModel),
    [activeFactors, selectedOptimalModel]
  );
  const designGoal: DoEDesignGoal = designConfig.designGoal || 'optimization';
  const runBudget = Math.max(1, designConfig.runBudget || recommendedOptimalRuns);
  const designValidation = useMemo(
    () => validateDesignSetup(project.factors, designConfig),
    [project.factors, designConfig]
  );
  const currentReadiness = useMemo(
    () => assessDesignReadiness(project.factors, project.runs, selectedOptimalModel),
    [project.factors, project.runs, selectedOptimalModel]
  );
  const wizardOptions = useMemo(() => {
    const category: DoECategory = hasMixtureProcessFactors ? 'Combined_Mixture_Process' : 'Custom_Optimal';
    const designType: DoEDesignType = hasMixtureProcessFactors ? 'Combined_Mixture_DOptimal' : 'DOptimal';
    const definitions: Array<{ goal: DoEDesignGoal; label: string; model: 'Linear' | '2FI' | 'Quadratic'; description: string }> = [
      { goal: 'screening', label: 'Sàng lọc', model: 'Linear', description: 'Xác định xu hướng chính với số run thấp nhất còn khả định.' },
      { goal: 'optimization', label: 'Tối ưu cân bằng', model: '2FI', description: 'Ước lượng tương tác quan trọng với bậc tự do dư cho sai số.' },
      { goal: 'robustness', label: 'Robustness / RSM', model: 'Quadratic', description: 'Đánh giá độ cong và biên vận hành với mức chính xác cao hơn.' },
    ];
    return definitions.map((definition) => {
      const numRuns = recommendRunCount(activeFactors, definition.model);
      const config: DoEDesignConfig = {
        category,
        designType,
        dOptimalModel: definition.model,
        numRuns,
        centerPoints: 0,
        replicates: 1,
        // The preview must be deterministic. Randomisation and execution
        // blocks affect run order only, not the D-optimal calculation.
        randomized: false,
        designGoal: definition.goal,
      };
      const setup = validateDesignSetup(project.factors, config);
      const runs = setup.isValid ? generateDoERuns(project.factors, { ...config, randomized: false }).runs : [];
      const readiness = assessDesignReadiness(project.factors, runs, definition.model);
      return { ...definition, category, designType, numRuns, readiness };
    });
  // A budget only changes whether an already-computed option is affordable;
  // it must not regenerate three D-optimal candidate designs per keystroke.
  }, [activeFactors, hasMixtureProcessFactors, project.factors]);

  // Calculate D-Efficiency and Matrix Metrics dynamically
  const designMetrics = useMemo(() => {
    return calculateDesignEfficiency(
      project.runs,
      project.factors,
      selectedOptimalModel
    );
  }, [project.runs, project.factors, selectedOptimalModel]);

  const handleGenerateMatrix = () => {
    if (!designValidation.isValid) {
      showToast(`⚠ Không thể tạo thiết kế: ${designValidation.errors[0]}`, 'info');
      return;
    }
    const { runs, alpha } = generateDoERuns(project.factors, designConfig);
    const readiness = assessDesignReadiness(project.factors, runs, selectedOptimalModel);
    if (!readiness.isEstimable) {
      showToast(`⚠ Thiết kế chưa đủ cho mô hình: ${readiness.messages[0] || 'không khả định'}`, 'info');
      return;
    }
    const updatedConfig = { ...designConfig, alpha };
    onUpdateProject({ doeConfig: updatedConfig, runs });
    const warning = designValidation.warnings[0] ? ` ${designValidation.warnings[0]}` : '';
    showToast(`✓ Đã tạo ${runs.length} run; p=${readiness.termCount}, df dư=${readiness.residualDegreesOfFreedom}.${warning}`, 'success');
  };

  const handleAugmentDesign = () => {
    if (project.runs.length === 0) {
      showToast('Hãy tạo hoặc nhập ma trận ban đầu trước khi bổ sung tuần tự.', 'info');
      return;
    }
    const result = augmentDOptimalDesign(project.factors, project.runs, selectedOptimalModel, augmentationRuns);
    if (result.addedRuns.length === 0) {
      showToast(result.warnings[0] || 'Không tìm thấy điểm mới phù hợp để bổ sung.', 'info');
      return;
    }
    onUpdateProject({ runs: result.runs });
    const note = result.warnings[0] ? ` ${result.warnings[0]}` : '';
    showToast(`✓ Đã thêm ${result.addedRuns.length} run vào Block ${result.addedRuns[0].block}; rank ${result.after.rank}/${result.after.termCount}, df dư ${result.after.residualDegreesOfFreedom}.${note}`, 'success');
  };

  // Manual Edit for Randomized Run Order
  const handleRunOrderChange = (runId: string, newOrder: number) => {
    const updatedRuns = project.runs.map((r) => {
      if (r.id !== runId) return r;
      return { ...r, runOrder: newOrder };
    });
    onUpdateProject({ runs: updatedRuns });
  };

  const handleBlockChange = (runId: string, block: number) => {
    const safeBlock = Math.max(1, Math.floor(block) || 1);
    onUpdateProject({ runs: project.runs.map((run) => run.id === runId ? { ...run, block: safeBlock } : run) });
  };

  // Re-randomize Run Order (Fisher-Yates)
  const handleRandomizeRunOrder = () => {
    if (project.runs.length === 0) return;
    const n = project.runs.length;
    const nextSeed = (designConfig.randomizationSeed ?? 20260828) + 1;
    const random = createSeededRandom(nextSeed);
    const orders = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [orders[i], orders[j]] = [orders[j], orders[i]];
    }
    const updatedRuns = project.runs.map((r, idx) => ({
      ...r,
      runOrder: orders[idx],
    }));
    const nextConfig = { ...designConfig, randomized: true, randomizationSeed: nextSeed };
    setDesignConfig(nextConfig);
    onUpdateProject({ runs: updatedRuns, doeConfig: nextConfig });
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

  // Simulate plausible measurements with scientific response-specific constraints.
  const handleAutoSimulateData = () => {
    if (project.runs.length === 0 || isSimulating) return;
    setIsSimulating(true);
    // Give React one paint frame before generating data so the user sees an
    // immediate busy state even for large multi-level designs.
    window.setTimeout(() => {
      try {
        const seed = project.analysisProvenance?.demoDataSeed ?? stableSeedFromText(project.id, 'demo-data');
        const random = createSeededRandom(seed);
        const simulatedRuns = project.runs.map((run) => ({
          ...run,
          responses: simulateDemoResponses(project, run, random),
        }));
        onUpdateProject({ runs: simulatedRuns });
      } finally {
        setIsSimulating(false);
      }
    }, 0);
  };

  // Parse clipboard text from Textarea
  const handleParseClipboardText = (text: string) => {
    setRawPasteText(text);
    if (!text.trim()) {
      setParsedData(null);
      return;
    }
    const result = parseClipboardExcel(text, project.factors, project.cqas, project.runs, project.doeConfig);
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
      const result = await parseExcelFile(file, project.factors, project.cqas, project.runs, project.doeConfig);
      setParsedData(result);
      setShowImportModal(true);
      setImportTab('file');
    } catch (err: any) {
      setFileError(err.message || 'Lỗi khi đọc file CSV.');
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
    if (!parsedData.isValid) {
      showToast('Không thể nhập dữ liệu: hãy sửa các lỗi validation trước.', 'info');
      return;
    }
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

        {/* Model-first Design Wizard */}
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.65rem', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: '800', color: '#0c4a6e', fontSize: '0.96rem' }}>Design Wizard — mục tiêu, mô hình, ngân sách</div>
              <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: '0.2rem' }}>Chọn phương án theo số hệ số có thể ước lượng và số run bạn thực sự có thể thực hiện.</div>
            </div>
            <span className="badge badge-primary" style={{ fontSize: '0.72rem' }}>Model-first</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', marginBottom: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: '#075985', marginBottom: '0.25rem' }}>Mục tiêu nghiên cứu</label>
              <select className="input-field" value={designGoal} onChange={(e) => setDesignConfig({ ...designConfig, designGoal: e.target.value as DoEDesignGoal })}>
                <option value="screening">Sàng lọc yếu tố</option>
                <option value="optimization">Tối ưu hóa đa đáp ứng</option>
                <option value="robustness">Robustness / Design Space</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: '700', color: '#075985', marginBottom: '0.25rem' }}>Ngân sách tối đa (run)</label>
              <input type="number" min={1} max={500} className="input-field" value={runBudget} onChange={(e) => setDesignConfig({ ...designConfig, runBudget: Math.max(1, Number(e.target.value)) })} />
            </div>
            <div style={{ fontSize: '0.76rem', color: '#334155', paddingTop: '1.35rem' }}>
              Mô hình hiện chọn: <strong>{selectedOptimalModel}</strong> · p={minRequiredTerms} · N tối thiểu={minRequiredTerms + 1}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem' }}>
            {wizardOptions.map((option) => {
              const isRecommended = option.goal === designGoal;
              const withinBudget = option.numRuns <= runBudget;
              const canApply = withinBudget && option.readiness.isEstimable;
              return (
                <div key={option.goal} style={{ background: '#ffffff', border: `1px solid ${isRecommended ? '#0284c7' : '#cbd5e1'}`, borderRadius: '0.5rem', padding: '0.75rem', boxShadow: isRecommended ? '0 1px 4px rgba(2,132,199,0.15)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                    <strong style={{ color: '#0f172a', fontSize: '0.84rem' }}>{option.label}</strong>
                    {isRecommended && <span className="badge badge-primary" style={{ fontSize: '0.66rem' }}>Khuyến nghị</span>}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: '#475569', minHeight: '2.2rem', margin: '0.35rem 0' }}>{option.description}</div>
                  <div style={{ fontSize: '0.74rem', color: '#0f172a', lineHeight: 1.5 }}>
                    <div><strong>{option.numRuns} run</strong> · {option.model} · p={option.readiness.termCount}</div>
                    <div>rank {option.readiness.rank}/{option.readiness.termCount} · df phần dư {option.readiness.residualDegreesOfFreedom}</div>
                  </div>
                  {!withinBudget && <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: '0.35rem' }}>Vượt ngân sách {runBudget} run.</div>}
                  {!option.readiness.isEstimable && <div style={{ fontSize: '0.7rem', color: '#b91c1c', marginTop: '0.35rem' }}>{option.readiness.messages[0]}</div>}
                  <button type="button" className={canApply ? 'btn btn-primary' : 'btn'} disabled={!canApply} onClick={() => {
                    // Preserve execution settings that do not alter model
                    // selection (for example, seed and blocks). As before,
                    // a wizard recommendation enables randomisation.
                    setDesignConfig({
                      ...designConfig,
                      category: option.category,
                      designType: option.designType,
                      dOptimalModel: option.model,
                      numRuns: option.numRuns,
                      centerPoints: 0,
                      replicates: 1,
                      randomized: true,
                      designGoal: option.goal,
                      runBudget,
                    });
                    showToast(`Đã chọn ${option.label}: ${option.numRuns} run, mô hình ${option.model}.`, 'info');
                  }} style={{ width: '100%', marginTop: '0.55rem', fontSize: '0.74rem', padding: '0.35rem 0.5rem', opacity: canApply ? 1 : 0.5 }}>
                    Chọn phương án
                  </button>
                </div>
              );
            })}
          </div>
          {!designValidation.isValid && <div style={{ marginTop: '0.7rem', color: '#b91c1c', fontSize: '0.76rem', fontWeight: '600' }}>⚠ {designValidation.errors[0]}</div>}
          {designValidation.warnings.map((warning) => <div key={warning} style={{ marginTop: '0.35rem', color: '#a16207', fontSize: '0.74rem' }}>• {warning}</div>)}
        </div>

        {/* Sequential design augmentation keeps completed runs immutable. */}
        {project.runs.length > 0 && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.65rem', padding: '0.9rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: '800', color: '#166534', fontSize: '0.9rem' }}>Bổ sung tuần tự D-optimal</div>
                <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.2rem', maxWidth: '640px' }}>
                  Giữ nguyên run đã thực hiện, chọn các điểm chưa lặp để tăng thông tin cho mô hình {selectedOptimalModel}. Các run mới được đặt trong block kế tiếp để dễ lập lịch và truy vết.
                </div>
              </div>
              <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Sequential DoE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'end', gap: '0.55rem', flexWrap: 'wrap', marginTop: '0.65rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#166534' }}>
                Số run bổ sung
                <input type="number" min={1} max={30} className="input-field" style={{ width: '100px', marginLeft: '0.4rem' }} value={augmentationRuns} onChange={(e) => setAugmentationRuns(Math.max(1, Math.min(30, Number(e.target.value))))} />
              </label>
              <button type="button" className="btn btn-teal" style={{ fontSize: '0.78rem', padding: '0.4rem 0.7rem' }} onClick={handleAugmentDesign}>
                <PlusCircle size={15} /> Thêm run thông tin nhất
              </button>
              <span style={{ fontSize: '0.73rem', color: '#475569' }}>Hiện tại: rank {currentReadiness.rank}/{currentReadiness.termCount}, df phần dư {currentReadiness.residualDegreesOfFreedom}.</span>
            </div>
          </div>
        )}

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
              <option value="RSM">Mặt Đáp (RSM - Tối ưu hóa)</option>
              <option value="Custom_Optimal">⚡ D-Optimal Design (D-Tối ưu / Thuật toán Fedorov)</option>
              <option value="Combined_Mixture_Process">🧪 Hỗn Hợp + Quy Trình (Combined Mixture-Process)</option>
              <option value="Mixture">Thiết kế Hỗn hợp (Mixture / Tá dược)</option>
              <option value="Screening">Sàng lọc Yếu tố (Screening)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
              Kiểu Thiết Kế Cụ Thể (Design Type)
            </label>
            <select
              className="input-field"
              value={designConfig.designType}
              onChange={(e) => {
                const nextType = e.target.value as DoEDesignType;
                const isCombinedOptimal = nextType === 'Combined_Mixture_DOptimal';
                setDesignConfig({
                  ...designConfig,
                  designType: nextType,
                  ...(isCombinedOptimal
                    ? {
                        dOptimalModel: designConfig.dOptimalModel || '2FI',
                        numRuns: designConfig.numRuns || 24,
                      }
                    : {}),
                });
              }}
            >
              {designConfig.category === 'Custom_Optimal' && (
                <option value="DOptimal">D-Optimal Design (Tối đa hóa định thức |X^T X|)</option>
              )}
              {designConfig.category === 'Combined_Mixture_Process' && (
                <>
                  <option value="Combined_Mixture_Factorial">Combined Simplex x Factorial 2^p (Tích Hỗn hợp - Yếu tố)</option>
                  <option value="Combined_Mixture_RSM">Combined Simplex x Box-Behnken RSM (Tích Hỗn hợp - Mặt đáp)</option>
                  <option value="Combined_Mixture_DOptimal">D-Optimal Mixture–Process (Giảm số run, chọn theo mô hình)</option>
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

          {designConfig.designType === 'Taguchi' && (
            <div>
              <label htmlFor="taguchi-array" style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#475569', marginBottom: '0.3rem' }}>
                Ma trận trực giao Taguchi
              </label>
              <select
                id="taguchi-array"
                className="input-field"
                value={designConfig.taguchiArray ?? (project.factors.filter((factor) => factor.controllability !== 'constant').length <= 3 ? 'L4' : 'L8')}
                onChange={(event) => setDesignConfig({ ...designConfig, taguchiArray: event.target.value as 'L4' | 'L8' | 'L9' | 'L12' | 'L16' })}
              >
                <option value="L4">L4 · 3 factor hai mức</option>
                <option value="L8">L8 · 7 factor hai mức</option>
                <option value="L9">L9 · 4 factor ba mức</option>
                <option value="L12">L12 · 11 factor hai mức</option>
                <option value="L16">L16 · 15 factor hai mức</option>
              </select>
            </div>
          )}

          {/* D-Optimal Target Model & Run Count */}
          {isOptimalDesign ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#0369a1', marginBottom: '0.3rem' }}>
                  Bậc Mô Hình Mục Tiêu (Target Model)
                </label>
                <select
                  className="input-field"
                  value={selectedOptimalModel}
                  onChange={(e) => setDesignConfig({ ...designConfig, dOptimalModel: e.target.value as 'Linear' | '2FI' | 'Quadratic' })}
                >
                  <option value="Quadratic">Bậc 2 Toàn phần (Quadratic: Linear + 2FI + Quadratic)</option>
                  <option value="2FI">Tương tác 2 yếu tố (2FI: Linear + Interactions)</option>
                  <option value="Linear">Tuyến tính bậc 1 (mixture–process: gồm xᵢ·zⱼ)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#0369a1', marginBottom: '0.3rem' }}>
                  Tổng Số Lần Chạy N (tối thiểu {minRequiredTerms + 1}; khuyến nghị {recommendedOptimalRuns})
                </label>
                <input
                  type="number"
                  min={minRequiredTerms + 1}
                  max={60}
                  className="input-field"
                  value={designConfig.numRuns || recommendedOptimalRuns}
                  onChange={(e) => setDesignConfig({ ...designConfig, numRuns: Math.max(minRequiredTerms + 1, Number(e.target.value)) })}
                />
              </div>
              {designConfig.designType === 'Combined_Mixture_DOptimal' && hasMixtureProcessFactors && (
                <div style={{ gridColumn: '1 / -1', fontSize: '0.76rem', color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '0.4rem', padding: '0.6rem 0.7rem' }}>
                  Chọn nhanh: <button type="button" className="btn btn-teal" style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem', marginLeft: '0.4rem' }} onClick={() => setDesignConfig({ ...designConfig, dOptimalModel: 'Linear', numRuns: 14 })}>Sàng lọc 14</button>
                  <button type="button" className="btn btn-teal" style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem', marginLeft: '0.35rem' }} onClick={() => setDesignConfig({ ...designConfig, dOptimalModel: '2FI', numRuns: 24 })}>Cân bằng 24</button>
                  <button type="button" className="btn btn-teal" style={{ fontSize: '0.72rem', padding: '0.2rem 0.45rem', marginLeft: '0.35rem' }} onClick={() => setDesignConfig({ ...designConfig, dOptimalModel: 'Quadratic', numRuns: 30 })}>RSM 30</button>
                  <span style={{ marginLeft: '0.55rem' }}>N phải lớn hơn số hệ số p để còn bậc tự do ước lượng sai số.</span>
                </div>
              )}
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

          {/* Randomization and balanced execution blocks */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1.2rem', flexWrap: 'wrap' }}>
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
            {designConfig.randomized && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#475569' }}>
                Seed
                <input
                  aria-label="Seed ngẫu nhiên hóa run order"
                  type="number"
                  className="input-field"
                  style={{ width: '110px', padding: '0.25rem 0.35rem' }}
                  value={designConfig.randomizationSeed ?? 20260828}
                  onChange={(event) => setDesignConfig({ ...designConfig, randomizationSeed: Number(event.target.value) || 20260828 })}
                />
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#475569' }}>
              Chia lịch thành
              <input type="number" min={1} max={10} className="input-field" style={{ width: '64px', padding: '0.25rem 0.35rem' }} value={designConfig.blocks ?? 1} onChange={(e) => setDesignConfig({ ...designConfig, blocks: Math.max(1, Math.min(10, Number(e.target.value))) })} />
              block
            </label>
            <span style={{ fontSize: '0.7rem', color: '#0f766e' }}>Khi có nhiều block, ANOVA và mạng nơ-ron sẽ hiệu chỉnh hiệu ứng block; bạn có thể sửa Block của từng run trong bảng bên dưới.</span>
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
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '0.45rem', background: currentReadiness.isEstimable ? '#f0fdf4' : '#fef2f2', color: currentReadiness.isEstimable ? '#166534' : '#b91c1c', fontSize: '0.78rem' }}>
            <strong>{currentReadiness.isEstimable ? '✓ Mô hình khả định' : '⚠ Mô hình chưa khả định'}</strong>
            {' '}rank {currentReadiness.rank}/{currentReadiness.termCount}; df phần dư {currentReadiness.residualDegreesOfFreedom}.
            {currentReadiness.messages.length > 0 && ` ${currentReadiness.messages.join(' ')}`}
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
            {/* CSV-only import avoids parsing untrusted binary Excel workbooks. */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".csv,text/csv"
              onChange={handleFileUpload}
            />

            {/* Add Row Dropdown Menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowAddRowMenu(!showAddRowMenu)}
                className="btn btn-primary"
                style={{
                  fontSize: '0.8rem',
                  padding: '0.35rem 0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  backgroundColor: '#16a34a',
                  borderColor: '#15803d',
                }}
                title="Thêm các dòng thí nghiệm mới vào ma trận"
              >
                <Plus size={14} />
                <span>Thêm Dòng</span>
                <ChevronDown size={12} />
              </button>

              {showAddRowMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '0.25rem',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    zIndex: 50,
                    minWidth: '230px',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => {
                      handleAddRow();
                      setShowAddRowMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0fdf4')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Plus size={14} color="#16a34a" />
                    <div>
                      <div style={{ fontWeight: '600' }}>+ Thêm 1 dòng ở cuối</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Thêm 1 thí nghiệm mới vào cuối bảng</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleAddRow(activeCell ? activeCell.r + 1 : undefined);
                      setShowAddRowMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0fdf4')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <ListPlus size={14} color="#0d9488" />
                    <div>
                      <div style={{ fontWeight: '600' }}>+ Chèn 1 dòng tại vị trí chọn</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Chèn ngay dưới hàng đang kích hoạt</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleDuplicateRow(activeCell ? activeCell.r : project.runs.length - 1);
                      setShowAddRowMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eff6ff')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <CopyPlus size={14} color="#2563eb" />
                    <div>
                      <div style={{ fontWeight: '600' }}>📑 Nhân bản dòng đang chọn</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Nhân bản giá trị biến để làm điểm lặp</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleAddMultipleRows(5);
                      setShowAddRowMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <PlusCircle size={14} color="#0284c7" />
                    <div>
                      <div style={{ fontWeight: '600' }}>+ Thêm 5 dòng thí nghiệm</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Thêm hàng loạt 5 dòng mới</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      handleAddMultipleRows(10);
                      setShowAddRowMenu(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <PlusCircle size={14} color="#0284c7" />
                    <div>
                      <div style={{ fontWeight: '600' }}>+ Thêm 10 dòng thí nghiệm</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Thêm hàng loạt 10 dòng mới</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Delete Selected Row(s) Button */}
            {normalizedRange && (
              <button
                onClick={handleDeleteSelectedRows}
                className="btn btn-secondary"
                style={{
                  fontSize: '0.8rem',
                  padding: '0.35rem 0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: '#fee2e2',
                  borderColor: '#fca5a5',
                  color: '#b91c1c',
                  fontWeight: '600',
                }}
                title="Xóa toàn bộ các dòng thí nghiệm đang được chọn"
              >
                <Trash2 size={14} />
                <span>
                  Xóa {normalizedRange.maxR - normalizedRange.minR + 1 > 1
                    ? `${normalizedRange.maxR - normalizedRange.minR + 1} Dòng`
                    : `Hàng ${normalizedRange.minR + 1}`}
                </span>
              </button>
            )}

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

            {/* Upload CSV */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', backgroundColor: '#0284c7' }}
              title="Tải lên file CSV UTF-8 (xuất từ Excel nếu cần)"
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
              disabled={isSimulating}
              className="btn btn-teal"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
              title="Tự động sinh số liệu thực nghiệm mô phỏng dựa trên mô hình hóa dược phẩm để test nhanh"
            >
              <Sparkles size={13} />
              <span>{isSimulating ? 'Đang mô phỏng…' : 'Điền Mô Phỏng'}</span>
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
                      <div style={{ fontWeight: '600' }}>Xuất CSV tương thích Excel</div>
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

                  <th
                    style={{
                      backgroundColor: '#f1f5f9',
                      color: '#475569',
                      fontWeight: '700',
                      fontSize: '0.72rem',
                      textAlign: 'center',
                      padding: '0.2rem 0.4rem',
                      borderRight: '1px solid #cbd5e1',
                      borderBottom: '1px solid #cbd5e1',
                      width: '96px',
                      minWidth: '96px',
                    }}
                  >
                    Thao Tác
                  </th>
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

                  <th
                    style={{
                      backgroundColor: '#f8fafc',
                      color: '#64748b',
                      padding: '0.45rem 0.5rem',
                      textAlign: 'center',
                      fontWeight: '700',
                      fontSize: '0.76rem',
                      borderRight: '1px solid #cbd5e1',
                      width: '96px',
                      minWidth: '96px',
                    }}
                  >
                    Hành động
                  </th>
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
                              textAlign: col.type === 'std' || col.type === 'run' || col.type === 'block' || col.type === 'mixture_sum' || col.type === 'coded' ? 'center' : 'left',
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

                            {col.type === 'block' && (
                              <input
                                type="number"
                                min={1}
                                max={999}
                                aria-label={`Block của run ${run.runOrder}`}
                                style={{ width: '100%', height: '32px', border: 'none', outline: 'none', textAlign: 'center', fontWeight: '700', color: '#6d28d9', backgroundColor: 'transparent', fontSize: '0.82rem', padding: '0.2rem' }}
                                value={run.block ?? 1}
                                onFocus={() => { setActiveCell({ r: runIdx, c: colIdx }); setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } }); }}
                                onChange={(e) => handleBlockChange(run.id, parseInt(e.target.value) || 1)}
                                onPaste={(e) => { const text = e.clipboardData.getData('text'); if (text && (text.includes('\t') || text.includes('\n'))) { e.preventDefault(); handlePasteMatrix(text, runIdx, colIdx); } }}
                              />
                            )}

                            {/* 3. Factor Actual (Editable) */}
                            {col.type === 'factor' && col.factor && (
                              col.factor.dataType === 'qualitative' || col.factor.dataType === 'quantitative_multilevel' ? (
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
                                  value={String(run.factorActual[col.code] ?? '')}
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleFactorActualChange(run.id, col.code, e.target.value)}
                                >
                                  {col.factor.categories && col.factor.categories.filter(Boolean).length > 0 ? (
                                    col.factor.categories.filter(Boolean).map((level) => (
                                      <option key={level} value={level}>{level}</option>
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
                                  value={
                                    run.factorActual[col.code] !== undefined && run.factorActual[col.code] !== null
                                      ? (typeof run.factorActual[col.code] === 'number' && (col.factor.role === 'mixture_component' || col.factor.type === 'Mixture')
                                          ? Number(Number(run.factorActual[col.code]).toFixed(4))
                                          : run.factorActual[col.code])
                                      : ''
                                  }
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
                              col.cqa.dataType !== 'quantitative' && col.cqa.dataType !== undefined ? (
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
                                  value={String(run.responses[col.code] ?? col.cqa.categories?.[0] ?? '')}
                                  onFocus={() => {
                                    setActiveCell({ r: runIdx, c: colIdx });
                                    setSelection({ start: { r: runIdx, c: colIdx }, end: { r: runIdx, c: colIdx } });
                                  }}
                                  onChange={(e) => handleResponseChange(run.id, col.code, e.target.value)}
                                >
                                  {(col.cqa.categories?.filter(Boolean).length
                                    ? col.cqa.categories.filter(Boolean)
                                    : col.cqa.dataType === 'qualitative_binary' ? ['Không đạt', 'Đạt'] : ['Mức 1', 'Mức 2']
                                  ).map((level) => (
                                    <option key={level} value={level}>{level}</option>
                                  ))}
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

                      {/* Row Operations Actions */}
                      <td
                        style={{
                          textAlign: 'center',
                          padding: '0.15rem 0.35rem',
                          borderBottom: '1px solid #cbd5e1',
                          borderRight: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddRow(runIdx + 1);
                            }}
                            style={{
                              border: '1px solid #bbf7d0',
                              backgroundColor: '#f0fdf4',
                              cursor: 'pointer',
                              padding: '0.2rem 0.35rem',
                              borderRadius: '3px',
                              color: '#16a34a',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title={`Chèn thêm 1 dòng mới bên dưới Hàng ${runIdx + 1}`}
                          >
                            <Plus size={13} />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateRow(runIdx);
                            }}
                            style={{
                              border: '1px solid #bfdbfe',
                              backgroundColor: '#eff6ff',
                              cursor: 'pointer',
                              padding: '0.2rem 0.35rem',
                              borderRadius: '3px',
                              color: '#2563eb',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title={`Nhân bản Hàng ${runIdx + 1} (Duplicate Run)`}
                          >
                            <CopyPlus size={13} />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRow(runIdx);
                            }}
                            style={{
                              border: '1px solid #fecaca',
                              backgroundColor: '#fef2f2',
                              cursor: 'pointer',
                              padding: '0.2rem 0.35rem',
                              borderRadius: '3px',
                              color: '#dc2626',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title={`Xóa Hàng ${runIdx + 1}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Interactive Bottom Bar: Quick Add Row & Stats */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#f8fafc',
                borderTop: '1px solid #cbd5e1',
                fontSize: '0.78rem',
                flexWrap: 'wrap',
                gap: '0.5rem',
                position: 'sticky',
                bottom: 0,
                zIndex: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleAddRow()}
                  className="btn btn-primary"
                  style={{
                    fontSize: '0.76rem',
                    padding: '0.3rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    backgroundColor: '#16a34a',
                    borderColor: '#15803d',
                  }}
                  title="Thêm 1 dòng thí nghiệm mới vào cuối bảng"
                >
                  <Plus size={14} />
                  <span>+ Thêm 1 Dòng Mới (Add Run)</span>
                </button>

                <button
                  onClick={() => handleAddMultipleRows(5)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.76rem', padding: '0.3rem 0.6rem', backgroundColor: '#ffffff', borderColor: '#cbd5e1' }}
                  title="Thêm 5 dòng thí nghiệm cùng lúc"
                >
                  +5 Dòng
                </button>

                <button
                  onClick={() => handleAddMultipleRows(10)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.76rem', padding: '0.3rem 0.6rem', backgroundColor: '#ffffff', borderColor: '#cbd5e1' }}
                  title="Thêm 10 dòng thí nghiệm cùng lúc"
                >
                  +10 Dòng
                </button>

                {normalizedRange && (
                  <button
                    onClick={handleDeleteSelectedRows}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.76rem',
                      padding: '0.3rem 0.7rem',
                      backgroundColor: '#fee2e2',
                      color: '#b91c1c',
                      borderColor: '#fca5a5',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                    title="Xóa toàn bộ các dòng đang được chọn"
                  >
                    <Trash2 size={13} />
                    <span>
                      Xóa {normalizedRange.maxR - normalizedRange.minR + 1 > 1
                        ? `${normalizedRange.maxR - normalizedRange.minR + 1} Dòng Đã Chọn`
                        : `Dòng ${normalizedRange.minR + 1}`}
                    </span>
                  </button>
                )}
              </div>

              <div style={{ color: '#475569', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Tổng cộng: <strong style={{ color: '#0f172a' }}>{project.runs.length}</strong> lần chạy thí nghiệm</span>
                <span style={{ color: '#94a3b8' }}>|</span>
                <span style={{ color: '#16a34a', fontWeight: '600' }}>
                  ✓ Tự động đồng bộ sang ANOVA &amp; Mạng Nơ-ron AI
                </span>
              </div>
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
                <span>2. Tải Lên File CSV</span>
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
                    Click để chọn file hoặc kéo thả CSV vào đây
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    Hỗ trợ CSV UTF-8; với Excel, chọn <strong>Save As → CSV UTF-8</strong> trước khi tải lên.
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
