import React, { useRef } from 'react';
import {
  FlaskConical,
  FileText,
  Save,
  FolderOpen,
  PlusCircle,
  BookOpen,
} from 'lucide-react';
import type { QBDProject } from '../types/qbd';
import { CASE_STUDIES } from '../data/caseStudies';

interface NavbarProps {
  project: QBDProject;
  onLoadProject: (project: QBDProject) => void;
  onExportWord: () => void;
  onSaveJSON: () => void;
  onNewProject: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  project,
  onLoadProject,
  onExportWord,
  onSaveJSON,
  onNewProject,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleJSONUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.cqas && data.factors && data.doeConfig) {
          onLoadProject(data);
        } else {
          alert('File JSON không hợp lệ theo chuẩn cấu trúc QbD Project.');
        }
      } catch (err) {
        alert('Lỗi đọc file JSON: ' + (err as Error).message);
      }
    };
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
                <span className="badge badge-primary">v2.5 ICH Standard</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Thiết kế Thí nghiệm & Tối ưu hóa Đáp ứng Dược phẩm (ICH Q8, Q9, Q10, Q11)
              </p>
            </div>
          </div>

          {/* Author Copyright & ICH Compliance Badges */}
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
                className="input-field"
                style={{ width: '220px', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
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

            {/* Export Word */}
            <button
              onClick={onExportWord}
              className="btn btn-teal"
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
              title="Xuất hồ sơ phát triển thuốc ICH CTD Module 3.2.P.2 sang định dạng MS Word"
            >
              <FileText size={16} />
              <span>Xuất Báo cáo Word</span>
            </button>

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
          </div>

        </div>
      </div>
    </header>
  );
};
