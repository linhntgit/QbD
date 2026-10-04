import React, { useState, useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  X,
  Clipboard,
  Upload,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { QBDProject } from '../../../types/qbd';
import {
  parseExcelFile,
  parseClipboardExcel,
  type ParsedDoEData,
} from '../../../services/doeExcelService';

export interface DoEImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: QBDProject;
  onApplyImportedData: (parsed: ParsedDoEData) => void;
  showToast: (msg: string, type?: 'success' | 'info') => void;
  initialParsedData?: ParsedDoEData | null;
  initialTab?: 'paste' | 'file';
  initialFileError?: string | null;
}

export const DoEImportModal: React.FC<DoEImportModalProps> = ({
  isOpen,
  onClose,
  project,
  onApplyImportedData,
  showToast,
  initialParsedData = null,
  initialTab = 'paste',
  initialFileError = null,
}) => {
  const [importTab, setImportTab] = useState<'paste' | 'file'>(initialTab);
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [parsedData, setParsedData] = useState<ParsedDoEData | null>(initialParsedData);
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(initialFileError);
  const modalFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setImportTab(initialTab);
      setParsedData(initialParsedData);
      setFileError(initialFileError);
    }
  }, [isOpen, initialTab, initialParsedData, initialFileError]);

  if (!isOpen) return null;

  const handleParseClipboardText = (text: string) => {
    setRawPasteText(text);
    if (!text.trim()) {
      setParsedData(null);
      return;
    }
    const result = parseClipboardExcel(text, project.factors, project.cqas, project.runs, project.doeConfig);
    setParsedData(result);
  };

  const handleModalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsProcessingFile(true);
    setFileError(null);
    try {
      const result = await parseExcelFile(file, project.factors, project.cqas, project.runs, project.doeConfig);
      setParsedData(result);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : 'Lỗi khi đọc file CSV.');
    } finally {
      setIsProcessingFile(false);
      if (modalFileInputRef.current) {
        modalFileInputRef.current.value = '';
      }
    }
  };

  const handleApply = () => {
    if (!parsedData || parsedData.runs.length === 0) return;
    if (!parsedData.isValid) {
      showToast('Không thể nhập dữ liệu: hãy sửa các lỗi validation trước.', 'info');
      return;
    }
    onApplyImportedData(parsedData);
    setParsedData(null);
    setRawPasteText('');
    onClose();
  };

  const handleDismiss = () => {
    setParsedData(null);
    setRawPasteText('');
    setFileError(null);
    onClose();
  };

  return (
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
      <input
        type="file"
        ref={modalFileInputRef}
        style={{ display: 'none' }}
        accept=".csv,text/csv"
        onChange={handleModalFileUpload}
      />
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
            onClick={handleDismiss}
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
              onClick={() => modalFileInputRef.current?.click()}
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
                {isProcessingFile ? 'Đang đọc file CSV...' : 'Click để chọn file hoặc kéo thả CSV vào đây'}
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
            onClick={handleDismiss}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
          >
            Hủy Bỏ
          </button>

          <button
            onClick={handleApply}
            disabled={!parsedData || !parsedData.isValid || parsedData.runs.length === 0}
            className="btn btn-primary"
            style={{
              fontSize: '0.82rem',
              padding: '0.45rem 1.25rem',
              opacity: !parsedData || !parsedData.isValid || parsedData.runs.length === 0 ? 0.5 : 1,
              cursor: !parsedData || !parsedData.isValid || parsedData.runs.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <CheckCircle2 size={16} />
            <span>Áp Dụng Dữ Liệu Vào Bảng DoE</span>
          </button>
        </div>
      </div>
    </div>
  );
};
