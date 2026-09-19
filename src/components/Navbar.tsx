import React, { useRef } from 'react';
import {
  FlaskConical,
  Save,
  FolderOpen,
  PlusCircle,
  BookOpen,
  Calculator,
  BrainCircuit,
  HelpCircle,
} from 'lucide-react';
import type { QBDProject, ModelingEngine } from '../types/qbd';
import { CASE_STUDIES } from '../data/caseStudies';

interface NavbarProps {
  project: QBDProject;
  modelingEngine?: ModelingEngine;
  onToggleEngine?: (engine: ModelingEngine) => void;
  hasTrainedNeuralModels?: boolean;
  onLoadProject: (project: QBDProject) => void;
  onSaveJSON: () => void;
  onNewProject: () => void;
  onToggleHelp?: () => void;
  isHelpOpen?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  project,
  modelingEngine = 'polynomial',
  onToggleEngine,
  hasTrainedNeuralModels = true,
  onLoadProject,
  onSaveJSON,
  onNewProject,
  onToggleHelp,
  isHelpOpen = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleJSONUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('File JSON vượt quá giới hạn 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        onLoadProject(data);
      } catch (err) {
        alert('Lỗi đọc file JSON: ' + (err as Error).message);
      }
    };
    reader.onerror = () => alert('Không thể đọc file JSON. Hãy thử chọn lại file.');
    reader.readAsText(file);
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm" style={{ borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0.75rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          
          {/* Brand & Project Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '0.6rem',
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 4px rgba(30, 58, 138, 0.25)',
              }}
            >
              <FlaskConical size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h1 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a', letterSpacing: '-0.01em' }}>
                  QbD Studio™
                </h1>
                <span className="badge badge-primary">v2.5 ICH-aligned workflow</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Thiết kế Thí nghiệm & Tối ưu hóa Đáp ứng Dược phẩm (ICH Q8, Q9, Q10, Q11)
              </p>
            </div>
          </div>

          {/* Author Copyright, Modeling Engine & ICH Compliance Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span
              className="badge"
              style={{
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                fontWeight: '700',
                fontSize: '0.75rem',
                padding: '0.2rem 0.55rem',
                borderRadius: '0.375rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              © Tran Linh Nguyen
            </span>

            {/* Global Modeling Paradigm Switcher */}
            {onToggleEngine && (
              <div
                style={{
                  display: 'flex',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '0.375rem',
                  padding: '0.15rem',
                  border: '1px solid #cbd5e1',
                  gap: '0.15rem',
                }}
              >
                <button
                  onClick={() => onToggleEngine('polynomial')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.15rem 0.45rem',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    backgroundColor: modelingEngine === 'polynomial' ? '#0f766e' : 'transparent',
                    color: modelingEngine === 'polynomial' ? '#ffffff' : '#64748b',
                  }}
                  title="Chuyển toàn bộ phân tích sang Hồi quy Đa thức bậc ≤ 2"
                >
                  <Calculator size={12} />
                  <span>Đa Thức</span>
                </button>
                <button
                  disabled={!hasTrainedNeuralModels}
                  onClick={() => {
                    if (hasTrainedNeuralModels) {
                      onToggleEngine('neural');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.15rem 0.45rem',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: hasTrainedNeuralModels ? 'pointer' : 'not-allowed',
                    opacity: hasTrainedNeuralModels ? 1 : 0.45,
                    backgroundColor: modelingEngine === 'neural' ? '#7c3aed' : 'transparent',
                    color: modelingEngine === 'neural' ? '#ffffff' : '#64748b',
                  }}
                  title={
                    hasTrainedNeuralModels
                      ? 'Chuyển toàn bộ phân tích sang Mạng Nơ-ron Nhân Tạo'
                      : 'Cần huấn luyện Mạng Nơ-ron tại Bước 5 trước khi kích hoạt'
                  }
                >
                  <BrainCircuit size={12} />
                  <span>Mạng Nơ-ron</span>
                </button>
              </div>
            )}

            <span className="badge badge-teal" title="Pharmaceutical Development & Design Space">ICH Q8(R2)</span>
            <span className="badge badge-warning" title="Quality Risk Management & FMEA">ICH Q9</span>
            <span className="badge badge-success" title="Pharmaceutical Quality System & Control Strategy">ICH Q10</span>
            <span className="badge badge-primary" title="Development & Manufacture of Drug Substances">ICH Q11</span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Case Study Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <BookOpen size={16} color="#0f766e" />
              <select
                aria-label="Chọn case study mẫu"
                className="input-field"
                style={{ width: '200px', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                value={project.id}
                onChange={(e) => {
                  const selected = CASE_STUDIES.find((cs) => cs.id === e.target.value);
                  if (selected) onLoadProject(selected);
                }}
              >
                <option value="" disabled>-- Chọn Case Study mẫu --</option>
                {CASE_STUDIES.map((cs) => (
                  <option key={cs.id} value={cs.id}>
                    {cs.moleculeName} ({cs.doeConfig.designType})
                  </option>
                ))}
              </select>
            </div>

            {/* Save JSON */}
            <button
              onClick={onSaveJSON}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.65rem' }}
              title="Lưu toàn bộ dữ liệu dự án vào file .json"
            >
              <Save size={15} />
              <span>Lưu</span>
            </button>

            {/* Load JSON */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.65rem' }}
              title="Mở dự án từ file .json"
            >
              <FolderOpen size={15} />
              <span>Mở</span>
            </button>
            <input
              type="file"
              aria-label="Mở project QbD từ file JSON"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".json"
              onChange={handleJSONUpload}
            />

            {/* New Project */}
            <button
              onClick={onNewProject}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.65rem' }}
              title="Tạo dự án thiết kế mới"
            >
              <PlusCircle size={15} />
              <span>Mới</span>
            </button>

            {/* Help / Contextual Guide Button */}
            {onToggleHelp && (
              <button
                onClick={onToggleHelp}
                className={`btn ${isHelpOpen ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  fontSize: '0.82rem',
                  padding: '0.4rem 0.75rem',
                  gap: '0.35rem',
                  fontWeight: '700',
                  backgroundColor: isHelpOpen ? '#1e3a8a' : '#f8fafc',
                  color: isHelpOpen ? '#ffffff' : '#1e3a8a',
                  border: isHelpOpen ? '1px solid #1e3a8a' : '1px solid #bfdbfe',
                }}
                title="Mở thanh trợ giúp & hướng dẫn chi tiết theo ngữ cảnh hiện tại"
              >
                <HelpCircle size={16} color={isHelpOpen ? '#ffffff' : '#2563eb'} />
                <span>Trợ Giúp</span>
              </button>
            )}
          </div>

        </div>
      </div>
    </header>
  );
};
