import type { ClipboardEvent } from 'react';
import type { ConfirmationRun, ConfirmationStudy } from '../types/confirmation';
import { newConfirmationRun, pasteConfirmationMatrix } from '../services/confirmation';
import './ConfirmationMatrix.css';

interface Props {
  study: ConfirmationStudy;
  disabled: boolean;
  onSave: (runs: ConfirmationRun[], action: string) => void;
  onError: (message: string) => void;
}

export function ConfirmationMatrix({ study, disabled, onSave, onError }: Props) {
  const columns = ['batch', 'date', ...study.factors.map(f => f.code), ...study.responses.map(r => r.cqa.code), 'notes'];
  const update = (id: string, field: string, value: string) => {
    onSave(study.runs.map(run => {
      if (run.id !== id) return run;
      if (field === 'batch' || field === 'date' || field === 'notes') return { ...run, [field]: value };
      if (study.factors.some(f => f.code === field)) return { ...run, actualFactors: { ...run.actualFactors, [field]: value } };
      const response = study.responses.find(r => r.cqa.code === field)!;
      return { ...run, responses: { ...run.responses, [field]: response.cqa.dataType?.startsWith('qualitative') ? value || null : value === '' ? null : Number(value) } };
    }), `Sửa dữ liệu mẻ ${study.runs.find(run => run.id === id)?.batch}`);
  };
  const pasteAt = (event: ClipboardEvent<HTMLInputElement | HTMLSelectElement>, row: number, column: number) => {
    const content = event.clipboardData.getData('text');
    if (!content.includes('\t') && !content.includes('\n')) return;
    event.preventDefault();
    try { onSave(pasteConfirmationMatrix(study, content, row, column), 'Dán dữ liệu vào ma trận xác nhận'); onError(''); }
    catch (error) { onError((error as Error).message); }
  };
  const copy = async () => {
    const body = study.runs.map(run => [run.batch, run.date, ...study.factors.map(f => run.actualFactors[f.code] ?? ''), ...study.responses.map(r => run.responses[r.cqa.code] ?? ''), run.notes].join('\t'));
    try { await navigator.clipboard.writeText([columns.join('\t'), ...body].join('\n')); onError(''); }
    catch { onError('Không thể sao chép tự động. Hãy chọn ô trong bảng và dùng Ctrl+C.'); }
  };
  const add = (index: number) => {
    const run = newConfirmationRun(study);
    const used = new Set(study.runs.map(item => item.batch));
    let number = study.runs.length + 1;
    while (used.has(`Mẻ ${number}`)) number++;
    run.batch = `Mẻ ${number}`;
    onSave([...study.runs.slice(0, index), run, ...study.runs.slice(index)], 'Thêm mẻ độc lập');
  };
  return <div className="confirmation-matrix">
    <div className="confirmation-matrix-toolbar">
      <span>Mỗi dòng là một mẻ độc lập. Bấm vào ô để dán nhiều ô từ Excel; bảng tự thêm dòng khi cần.</span>
      <button type="button" className="btn btn-secondary" onClick={copy}>Sao chép bảng</button>
      <button type="button" className="btn btn-secondary" disabled={disabled || study.runs.length >= 500} onClick={() => add(study.runs.length)}>+ Thêm dòng</button>
    </div>
    <div className="confirmation-matrix-scroll" role="region" aria-label="Ma trận kết quả xác nhận" tabIndex={0}>
      <table className="confirmation-matrix-table"><thead><tr><th className="row-number">#</th><th>Mã mẻ</th><th>Ngày</th>{study.factors.map(f => <th key={f.code} title={f.name}>{f.code}<small>Thực tế ({f.unit})</small></th>)}{study.responses.map(r => <th key={r.cqa.code} className="response-header" title={r.cqa.name}>{r.cqa.code}<small>Thực nghiệm ({r.cqa.unit})</small></th>)}<th>Ghi chú</th><th>Thao tác</th></tr></thead>
        <tbody>{study.runs.map((run, rowIndex) => <tr key={run.id}>
          <td className="row-number">{rowIndex + 1}</td>
          {columns.map((column, columnIndex) => {
            const response = study.responses.find(r => r.cqa.code === column);
            const value = column === 'batch' || column === 'date' || column === 'notes' ? run[column] : study.factors.some(f => f.code === column) ? run.actualFactors[column] ?? '' : run.responses[column] ?? '';
            return <td key={column} className={response ? 'response-cell' : ''}>
              {response?.cqa.dataType?.startsWith('qualitative') ? <select aria-label={`${run.batch} ${column}`} disabled={disabled} value={value} onPaste={event => pasteAt(event, rowIndex, columnIndex)} onChange={event => update(run.id, column, event.target.value)}><option value="">Chưa nhập</option>{response.cqa.categories?.map(category => <option key={category} value={category}>{category}</option>)}</select>
                : <input aria-label={`${run.batch} ${column}`} disabled={disabled} type={column === 'date' ? 'date' : response ? 'number' : 'text'} step={response ? 'any' : undefined} value={value} placeholder={response ? 'Nhập Y…' : undefined} onPaste={event => pasteAt(event, rowIndex, columnIndex)} onChange={event => update(run.id, column, event.target.value)} />}
            </td>;
          })}
          <td className="row-actions"><button type="button" aria-label={`Thêm dòng sau ${run.batch}`} title="Thêm dòng bên dưới" disabled={disabled || study.runs.length >= 500} onClick={() => add(rowIndex + 1)}>+</button><button type="button" aria-label={`Xóa ${run.batch}`} title="Xóa dòng" disabled={disabled} onClick={() => onSave(study.runs.filter(item => item.id !== run.id), `Xóa mẻ ${run.batch}`)}>×</button></td>
        </tr>)}</tbody></table>
    </div>
    <p className="confirmation-matrix-hint">Cột Y có nền xanh để dễ nhận biết. Có thể cuộn ngang trong bảng khi số biến lớn; mã mẻ và số dòng luôn hiển thị.</p>
  </div>;
}
