import React, { useMemo, useState } from 'react';
import type { QBDProject } from '../types/qbd';
import { compareProjectVersions, getProjectHistory, getTraceabilitySummary } from '../services/projectGovernance';

interface ProjectGovernancePanelProps {
  project: QBDProject;
  onRestoreSnapshot: (project: QBDProject) => void;
}

export const ProjectGovernancePanel: React.FC<ProjectGovernancePanelProps> = ({ project, onRestoreSnapshot }) => {
  const history = useMemo(() => getProjectHistory(project.id), [project]);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = history.find((entry) => entry.id === selectedId) ?? null;
  const traceability = useMemo(() => getTraceabilitySummary(project), [project]);
  const comparison = selected ? compareProjectVersions(project, selected.project) : [];

  return (
    <div className="qbd-card" style={{ borderLeft: '4px solid #475569' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '0.7rem' }}>
        <div>
          <h3 style={{ fontSize: '0.98rem', margin: 0, color: '#0f172a' }}>Dữ liệu & quản trị project</h3>
          <p style={{ fontSize: '0.75rem', margin: '0.2rem 0 0', color: '#64748b' }}>Lưu cục bộ trong trình duyệt, lịch sử phiên bản và kiểm tra template trước khi xuất báo cáo.</p>
        </div>
        <span className={`badge ${traceability.validation.valid ? 'badge-success' : 'badge-danger'}`}>{traceability.validation.valid ? 'Template hợp lệ' : 'Cần sửa template'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem', fontSize: '0.76rem' }}>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem' }}><strong>Protocol ID</strong><br /><span className="font-mono">{traceability.protocolId}</span></div>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem' }}><strong>Trạng thái dữ liệu</strong><br />{traceability.runStatus}</div>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem' }}><strong>Audit trail cục bộ</strong><br />{history.length} snapshot gần nhất (tối đa 25)</div>
      </div>
      {traceability.validation.errors.map((message) => <div key={message} style={{ marginTop: '0.45rem', color: '#b91c1c', fontSize: '0.74rem' }}>⚠ {message}</div>)}
      {traceability.validation.warnings.map((message) => <div key={message} style={{ marginTop: '0.35rem', color: '#a16207', fontSize: '0.74rem' }}>• {message}</div>)}
      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>So sánh với snapshot</label>
        <select className="input-field" style={{ minWidth: '260px', fontSize: '0.75rem' }} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Chọn phiên bản đã lưu…</option>
          {history.map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.timestamp).toLocaleString('vi-VN')} — {entry.action}</option>)}
        </select>
        {selected && <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem' }} onClick={() => onRestoreSnapshot(selected.project)}>Khôi phục snapshot</button>}
      </div>
      {selected && <div style={{ marginTop: '0.55rem', background: '#f1f5f9', borderRadius: '0.4rem', padding: '0.6rem 0.7rem', fontSize: '0.74rem', color: '#334155' }}>
        <strong>So với {new Date(selected.timestamp).toLocaleString('vi-VN')}:</strong>
        {comparison.map((item) => <div key={item}>• {item}</div>)}
      </div>}
      <div style={{ marginTop: '0.7rem', padding: '0.55rem 0.65rem', background: '#fffbeb', borderRadius: '0.4rem', color: '#92400e', fontSize: '0.72rem' }}>
        Lưu vết này hỗ trợ R&amp;D và không phải audit trail GxP/21 CFR Part 11: chưa có xác thực người dùng, chữ ký điện tử hoặc validation package.
      </div>
    </div>
  );
};
