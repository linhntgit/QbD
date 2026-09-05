import type { QBDProject, Factor, CQA, DoERun, DoEDesignConfig } from '../types/qbd';
import { actualToCoded, getFactorDesignBounds } from './doeGenerator';

export interface ColumnMappingInfo {
  headerName: string;
  matchedType: 'stdOrder' | 'runOrder' | 'factor' | 'cqa' | 'ignored';
  matchedCode?: string;
  matchedName?: string;
  columnIndex: number;
}

export interface ParseValidationError {
  row: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedDoEData {
  headers: string[];
  columnMappings: ColumnMappingInfo[];
  rawRows: any[][];
  runs: DoERun[];
  errors: ParseValidationError[];
  isValid: boolean;
  numRuns: number;
}

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Small RFC-4180-compatible parser used for the deliberately CSV-only import path. */
function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function validateImportedRuns(runs: DoERun[], factors: Factor[], config?: DoEDesignConfig): ParseValidationError[] {
  const errors: ParseValidationError[] = [];
  const runOrders = new Set<number>();
  const stdOrders = new Set<number>();
  const mixture = factors.filter((factor) => factor.role === 'mixture_component' || factor.type === 'Mixture');
  const asProportion = (value: unknown, factor: Factor): number => {
    const numeric = Number(value);
    return factor.high <= 1 && factor.unit !== '%' ? numeric : numeric / 100;
  };
  runs.forEach((run, index) => {
    const row = index + 2;
    if (runOrders.has(run.runOrder)) errors.push({ row, column: 'RunOrder', message: `RunOrder ${run.runOrder} bị trùng.`, severity: 'error' });
    runOrders.add(run.runOrder);
    if (stdOrders.has(run.stdOrder)) errors.push({ row, column: 'StdOrder', message: `StdOrder ${run.stdOrder} bị trùng.`, severity: 'error' });
    stdOrders.add(run.stdOrder);
    factors.forEach((factor) => {
      if (factor.controllability === 'constant' || factor.dataType === 'qualitative') return;
      const actual = run.factorActual[factor.code];
      const { low, high } = getFactorDesignBounds(factor, config);
      if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < low - 1e-8 || actual > high + 1e-8) {
        errors.push({ row, column: factor.code, message: `${factor.code} nằm ngoài giới hạn khảo sát hoặc không hợp lệ.`, severity: 'error' });
      }
    });
    if (mixture.length >= 2) {
      const codedTotal = mixture.reduce((sum, factor) => sum + Number(run.factorCoded[factor.code]), 0);
      const actualTotal = mixture.reduce((sum, factor) => sum + asProportion(run.factorActual[factor.code], factor), 0);
      if (!Number.isFinite(codedTotal) || Math.abs(codedTotal - 1) > 1e-6) errors.push({ row, column: 'Mixture coded', message: 'Các thành phần mixture ở coded scale phải có tổng bằng 1.', severity: 'error' });
      if (!Number.isFinite(actualTotal) || Math.abs(actualTotal - 1) > 1e-6) errors.push({ row, column: 'Mixture actual', message: 'Các thành phần mixture ở actual scale phải có tổng bằng 100%.', severity: 'error' });
    }
  });
  return errors;
}

/**
 * Match a column header text to Factor, CQA, or Run/Std Order
 */
export function matchHeaderToEntity(
  header: string,
  factors: Factor[],
  cqas: CQA[]
): { type: 'stdOrder' | 'runOrder' | 'factor' | 'cqa' | 'ignored'; code?: string; name?: string } {
  if (!header || typeof header !== 'string') return { type: 'ignored' };

  const clean = header.trim().toLowerCase();

  // Match StdOrder / RunOrder
  if (['std', 'stdorder', 'std order', 'standard order', 'số tt', 'stt'].includes(clean)) {
    return { type: 'stdOrder', name: 'StdOrder' };
  }
  if (['run', 'runorder', 'run order', 'run no', 'lần chạy', 'thí nghiệm', 'tn'].includes(clean)) {
    return { type: 'runOrder', name: 'RunOrder' };
  }

  // Match Factors (by code like X1, X2 or by name)
  for (const factor of factors) {
    const fCode = factor.code.toLowerCase();
    const fName = factor.name.toLowerCase();
    if (
      clean === fCode ||
      clean.startsWith(`${fCode}(`) ||
      clean.startsWith(`${fCode} `) ||
      clean.includes(`(${fCode})`) ||
      clean === fName ||
      clean.includes(fName)
    ) {
      return { type: 'factor', code: factor.code, name: factor.name };
    }
  }

  // Match CQAs (by code like Y1, Y2 or by name)
  for (const cqa of cqas) {
    const cCode = cqa.code.toLowerCase();
    const cName = cqa.name.toLowerCase();
    if (
      clean === cCode ||
      clean.startsWith(`${cCode}(`) ||
      clean.startsWith(`${cCode} `) ||
      clean.includes(`(${cCode})`) ||
      clean === cName ||
      clean.includes(cName)
    ) {
      return { type: 'cqa', code: cqa.code, name: cqa.name };
    }
  }

  return { type: 'ignored' };
}

/**
 * Parse rows matrix into structured DoE Runs with full validation
 */
export function processRawTableData(
  headers: string[],
  rows: any[][],
  factors: Factor[],
  cqas: CQA[],
  existingRuns: DoERun[] = [],
  config?: DoEDesignConfig
): ParsedDoEData {
  const columnMappings: ColumnMappingInfo[] = headers.map((h, idx) => {
    const match = matchHeaderToEntity(h, factors, cqas);
    return {
      headerName: h,
      matchedType: match.type,
      matchedCode: match.code,
      matchedName: match.name,
      columnIndex: idx,
    };
  });

  const errors: ParseValidationError[] = [];
  const parsedRuns: DoERun[] = [];

  // Check if at least some columns are matched
  const matchedFactors = columnMappings.filter((m) => m.matchedType === 'factor');
  const matchedCQAs = columnMappings.filter((m) => m.matchedType === 'cqa');

  if (matchedFactors.length === 0 && matchedCQAs.length === 0) {
    errors.push({
      row: 1,
      column: 'Tiêu đề (Headers)',
      message: 'Không nhận diện được cột Yếu tố (X) hoặc Chỉ tiêu đáp ứng (Y) nào. Vui lòng kiểm tra tiêu đề cột.',
      severity: 'error',
    });
  }

  rows.forEach((row, rowIdx) => {
    if (!row || row.length === 0 || row.every((c) => c === undefined || c === null || String(c).trim() === '')) {
      return; // skip empty rows
    }

    const rowNumber = rowIdx + 2; // +1 for 0-index, +1 for header row
    const existingRun = existingRuns[rowIdx] || null;

    let stdOrder = rowIdx + 1;
    let runOrder = rowIdx + 1;

    const factorActual: Record<string, number | string> = existingRun ? { ...existingRun.factorActual } : {};
    const factorCoded: Record<string, number> = existingRun ? { ...existingRun.factorCoded } : {};
    const responses: Record<string, number | string | null> = existingRun ? { ...existingRun.responses } : {};

    columnMappings.forEach((map) => {
      const cellVal = row[map.columnIndex];
      if (cellVal === undefined || cellVal === null || String(cellVal).trim() === '') {
        return;
      }

      if (map.matchedType === 'stdOrder') {
        const parsed = parseInt(String(cellVal), 10);
        if (!isNaN(parsed)) stdOrder = parsed;
      } else if (map.matchedType === 'runOrder') {
        const parsed = parseInt(String(cellVal), 10);
        if (!isNaN(parsed)) runOrder = parsed;
      } else if (map.matchedType === 'factor' && map.matchedCode) {
        const factor = factors.find((f) => f.code === map.matchedCode);
        if (factor) {
          if (factor.dataType === 'qualitative') {
            factorActual[factor.code] = String(cellVal).trim();
            factorCoded[factor.code] = actualToCoded(String(cellVal).trim(), factor);
          } else {
            const num = parseFloat(String(cellVal).replace(/,/g, '.'));
            if (isNaN(num)) {
              errors.push({
                row: rowNumber,
                column: map.headerName,
                message: `Giá trị '${cellVal}' của yếu tố ${factor.name} (${factor.code}) không phải số thực hợp lệ.`,
                severity: 'error',
              });
            } else {
              factorActual[factor.code] = num;
              factorCoded[factor.code] = actualToCoded(num, factor);
            }
          }
        }
      } else if (map.matchedType === 'cqa' && map.matchedCode) {
        const cqa = cqas.find((c) => c.code === map.matchedCode);
        if (cqa) {
          if (cqa.dataType?.startsWith('qualitative')) {
            responses[cqa.code] = String(cellVal).trim();
          } else {
            const num = parseFloat(String(cellVal).replace(/,/g, '.'));
            if (isNaN(num)) {
              errors.push({
                row: rowNumber,
                column: map.headerName,
                message: `Giá trị '${cellVal}' của chỉ tiêu ${cqa.name} (${cqa.code}) không phải số thực.`,
                severity: 'error',
              });
            } else {
              responses[cqa.code] = num;
            }
          }
        }
      }
    });

    // Ensure all factors have coded values
    factors.forEach((f) => {
      if (factorActual[f.code] === undefined) {
        if (f.controllability === 'constant') {
          factorActual[f.code] = f.constantValue ?? f.center ?? 0;
          factorCoded[f.code] = 0;
        } else {
          factorActual[f.code] = f.center ?? (f.low + f.high) / 2;
          factorCoded[f.code] = 0;
        }
      }
    });

    parsedRuns.push({
      id: existingRun?.id || `run-imported-${Date.now()}-${rowIdx}`,
      stdOrder,
      runOrder,
      block: existingRun?.block || 1,
      factorActual,
      factorCoded,
      responses,
    });
  });

  errors.push(...validateImportedRuns(parsedRuns, factors, config));
  const hasCriticalErrors = errors.some((e) => e.severity === 'error');

  return {
    headers,
    columnMappings,
    rawRows: rows,
    runs: parsedRuns,
    errors,
    isValid: !hasCriticalErrors && parsedRuns.length > 0,
    numRuns: parsedRuns.length,
  };
}

/**
 * Parse Clipboard Text from Excel (Tab-separated)
 */
export function parseClipboardExcel(
  clipboardText: string,
  factors: Factor[],
  cqas: CQA[],
  existingRuns: DoERun[] = [],
  config?: DoEDesignConfig
): ParsedDoEData {
  if (!clipboardText || clipboardText.trim() === '') {
    return {
      headers: [],
      columnMappings: [],
      rawRows: [],
      runs: [],
      errors: [{ row: 1, column: 'Dữ liệu', message: 'Vùng sao chép trống.', severity: 'error' }],
      isValid: false,
      numRuns: 0,
    };
  }

  // Split lines
  const lines = parseDelimitedRows(clipboardText.trim(), '\t');

  if (lines.length === 0) {
    return {
      headers: [],
      columnMappings: [],
      rawRows: [],
      runs: [],
      errors: [{ row: 1, column: 'Dữ liệu', message: 'Không tìm thấy dòng dữ liệu nào.', severity: 'error' }],
      isValid: false,
      numRuns: 0,
    };
  }

  // Check if first row is header
  const firstRow = lines[0];
  const looksLikeHeader = firstRow.some((cell) => {
    const clean = cell.toLowerCase();
    return (
      clean.includes('std') ||
      clean.includes('run') ||
      factors.some((f) => clean.includes(f.code.toLowerCase()) || clean.includes(f.name.toLowerCase())) ||
      cqas.some((c) => clean.includes(c.code.toLowerCase()) || clean.includes(c.name.toLowerCase()))
    );
  });

  let headers: string[] = [];
  let dataRows: any[][] = [];

  if (looksLikeHeader) {
    headers = firstRow;
    dataRows = lines.slice(1);
  } else {
    // If no header, infer headers based on default column order: StdOrder, RunOrder, Factors..., CQAs...
    headers = [
      'StdOrder',
      'RunOrder',
      ...factors.map((f) => `${f.name} (${f.code})`),
      ...cqas.map((c) => `${c.name} (${c.code})`),
    ];
    dataRows = lines;
  }

  return processRawTableData(headers, dataRows, factors, cqas, existingRuns, config);
}

/**
 * Parse a CSV file. Binary Excel import is intentionally disabled: the prior
 * parser depended on a package with unresolved high-severity advisories.
 */
export async function parseExcelFile(
  file: File,
  factors: Factor[],
  cqas: CQA[],
  existingRuns: DoERun[] = [],
  config?: DoEDesignConfig
): Promise<ParsedDoEData> {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    throw new Error('Chỉ nhận CSV UTF-8. Hãy mở file Excel bằng Excel và Save As CSV trước khi nhập.');
  }
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File CSV vượt quá giới hạn 10 MB.');
  const text = await file.text();
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = parseDelimitedRows(text.replace(/^\uFEFF/, ''), delimiter);
  if (rows.length === 0) throw new Error('File CSV rỗng.');
  return processRawTableData(rows[0], rows.slice(1), factors, cqas, existingRuns, config);
}

function downloadCSV(headers: string[], rows: Array<Array<string | number | null | undefined>>, filename: string): void {
  const escape = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const contents = `\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export DoE matrix as an Excel-compatible CSV without a binary workbook parser.
 */
export function exportToExcel(project: QBDProject, filename?: string) {
  if (project.runs.length === 0) return;

  const headers = [
    'StdOrder',
    'RunOrder',
    ...project.factors.map((f) => `${f.name} (${f.code}) [${f.unit || ''}]`),
    ...project.factors.map((f) => `${f.code}_Coded`),
    ...project.cqas.map((c) => `${c.name} (${c.code}) [${c.unit || ''}]`),
  ];

  const dataRows = project.runs.map((r) => [
    r.stdOrder,
    r.runOrder,
    ...project.factors.map((f) => r.factorActual[f.code] ?? ''),
    ...project.factors.map((f) =>
      typeof r.factorCoded[f.code] === 'number' ? Number(r.factorCoded[f.code]).toFixed(2) : r.factorCoded[f.code] ?? ''
    ),
    ...project.cqas.map((c) => r.responses[c.code] ?? ''),
  ]);

  const cleanName = (filename || `${project.name || 'QbD_Project'}_DoE_Runs`).replace(/\s+/g, '_');
  downloadCSV(headers, dataRows, `${cleanName}.csv`);
}

/**
 * Export a laboratory-entry template as Excel-compatible CSV.
 */
export function exportTemplateExcel(project: QBDProject) {
  if (project.runs.length === 0) return;

  const headers = [
    'StdOrder',
    'RunOrder',
    ...project.factors.map((f) => `${f.name} (${f.code})`),
    ...project.cqas.map((c) => `${c.name} (${c.code})`),
  ];

  const dataRows = project.runs.map((r) => [
    r.stdOrder,
    r.runOrder,
    ...project.factors.map((f) => r.factorActual[f.code] ?? ''),
    ...project.cqas.map((c) => r.responses[c.code] ?? ''),
  ]);

  const cleanName = `${(project.name || 'QbD').replace(/\s+/g, '_')}_Mau_Nhap_Lab`;
  downloadCSV(headers, dataRows, `${cleanName}.csv`);
}

/**
 * Export CSV file with UTF-8 BOM
 */
export function exportToCSV(project: QBDProject, filename?: string) {
  if (project.runs.length === 0) return;

  const headers = [
    'StdOrder',
    'RunOrder',
    ...project.factors.map((f) => `${f.name} (${f.code})`),
    ...project.cqas.map((c) => `${c.name} (${c.code})`),
  ];

  const rows = project.runs.map((r) => [
    r.stdOrder,
    r.runOrder,
    ...project.factors.map((f) => r.factorActual[f.code] ?? ''),
    ...project.cqas.map((c) => r.responses[c.code] ?? ''),
  ]);

  const cleanName = (filename || `${project.name || 'QbD_Project'}_DoE_Matrix`).replace(/\s+/g, '_');
  downloadCSV(headers, rows, `${cleanName}.csv`);
}
