import * as XLSX from 'xlsx';
import type { QBDProject, Factor, CQA, DoERun } from '../types/qbd';
import { actualToCoded } from './doeGenerator';

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
  existingRuns: DoERun[] = []
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
  existingRuns: DoERun[] = []
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
  const lines = clipboardText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split('\t').map((c) => c.trim()));

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

  return processRawTableData(headers, dataRows, factors, cqas, existingRuns);
}

/**
 * Parse Excel (.xlsx, .xls) or CSV File
 */
export async function parseExcelFile(
  file: File,
  factors: Factor[],
  cqas: CQA[],
  existingRuns: DoERun[] = []
): Promise<ParsedDoEData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        if (!worksheet) {
          throw new Error('File Excel không có trang tính (Sheet) nào hợp lệ.');
        }

        // Convert to 2D array of strings
        const jsonSheet = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });

        if (!jsonSheet || jsonSheet.length === 0) {
          throw new Error('Trang tính rỗng.');
        }

        const headers = (jsonSheet[0] || []).map((h) => String(h || '').trim());
        const dataRows = jsonSheet.slice(1);

        const result = processRawTableData(headers, dataRows, factors, cqas, existingRuns);
        resolve(result);
      } catch (err: any) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Không thể đọc file. Vui lòng thử lại.'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Export DoE matrix to Excel file (.xlsx)
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

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  // Set column widths
  const colWidths = headers.map((h) => ({ wch: Math.max(h.length + 4, 12) }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DoE_Matrix');

  const cleanName = (filename || `${project.name || 'QbD_Project'}_DoE_Runs`).replace(/\s+/g, '_');
  XLSX.writeFile(wb, `${cleanName}.xlsx`);
}

/**
 * Export Excel Template for laboratory entry
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

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  const colWidths = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mau_Nhap_Ket_Qua');

  const cleanName = `${(project.name || 'QbD').replace(/\s+/g, '_')}_Mau_Nhap_Lab`;
  XLSX.writeFile(wb, `${cleanName}.xlsx`);
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

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' +
    [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join(
      '\n'
    );

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  const cleanName = (filename || `${project.name || 'QbD_Project'}_DoE_Matrix`).replace(/\s+/g, '_');
  link.setAttribute('download', `${cleanName}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
