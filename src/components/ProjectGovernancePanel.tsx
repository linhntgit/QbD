import React, { useMemo, useState } from 'react';
import type { QBDProject } from '../types/qbd';
import {
  compareProjectVersions,
  getProjectHistory,
  getTraceabilitySummary,
  signProjectSnapshot,
  unlockProject,
  verifyAuditTrailIntegrity,
  verifyElectronicSignatures,
  type ElectronicSignature,
  type GxPRole,
} from '../services/projectGovernance';
import {
  ShieldCheck,
  AlertTriangle,
  Lock,
  Unlock,
  CheckCircle2,
  FileCheck,
  History,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

interface ProjectGovernancePanelProps {
  project: QBDProject;
  onRestoreSnapshot: (project: QBDProject) => void;
  onProjectUpdate?: (project: QBDProject) => void;
}

export const ProjectGovernancePanel: React.FC<ProjectGovernancePanelProps> = ({
  project,
  onRestoreSnapshot,
  onProjectUpdate,
}) => {
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const history = useMemo(() => {
    void refreshKey;
    return getProjectHistory(project.id);
  }, [project.id, refreshKey]);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = history.find((entry) => entry.id === selectedId) ?? null;
  const traceability = useMemo(() => getTraceabilitySummary(project), [project]);
  const comparison = selected ? compareProjectVersions(project, selected.project) : [];

  // Live Integrity Verification
  const integrity = useMemo(
    () => verifyAuditTrailIntegrity(history, project),
    [history, project]
  );

  // Signatures Verification
  const signatures = useMemo(
    () => (project.electronicSignatures ?? []) as ElectronicSignature[],
    [project.electronicSignatures]
  );
  const sigsVerification = useMemo(
    () => verifyElectronicSignatures(signatures),
    [signatures]
  );

  // Sign-off Form State
  const [isSigningOpen, setIsSigningOpen] = useState(false);
  const [signerName, setSignerName] = useState(project.author || '');
  const [signerDepartment, setSignerDepartment] = useState('Phòng Nghiên cứu Bào chế & Phát triển');
  
  // Determine next role in the 3-tier hierarchy
  const hasAnalyst = signatures.some((s) => s.signerRole === 'Analyst');
  const hasReviewer = signatures.some((s) => s.signerRole === 'Reviewer');
  const hasApprover = signatures.some((s) => s.signerRole === 'Approver');

  const defaultNextRole: 'Analyst' | 'Reviewer' | 'Approver' = !hasAnalyst
    ? 'Analyst'
    : !hasReviewer
      ? 'Reviewer'
      : 'Approver';

  const [signerRole, setSignerRole] = useState<'Analyst' | 'Reviewer' | 'Approver'>(defaultNextRole);

  const defaultReasons: Record<'Analyst' | 'Reviewer' | 'Approver', string> = {
    Analyst: 'Authorship: Tôi xác nhận đã thiết kế DoE, nhập dữ liệu thực nghiệm và xây dựng mô hình chính xác',
    Reviewer: 'Technical Review: Tôi xác nhận đã thẩm định thống kê ANOVA/ANN, các chẩn đoán dư sai và vùng tối ưu',
    Approver: 'Regulatory Approval: Tôi phê duyệt Không gian Thiết kế (Design Space), PAR/NOR và Chiến lược Kiểm soát',
  };

  const [signerReason, setSignerReason] = useState(defaultReasons[defaultNextRole]);
  const [customComment, setCustomComment] = useState('');

  // Unlock / Revision State
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  const [unlockJustification, setUnlockJustification] = useState('');
  const [unlockUser, setUnlockUser] = useState(project.author || 'QA Director');

  const handleRoleChange = (role: 'Analyst' | 'Reviewer' | 'Approver') => {
    setSignerRole(role);
    setSignerReason(defaultReasons[role]);
  };

  const handleExecuteSignOff = () => {
    if (!signerName.trim()) {
      alert('Vui lòng nhập họ tên người ký.');
      return;
    }
    const finalReason = customComment.trim()
      ? `${signerReason} — Ghi chú: ${customComment.trim()}`
      : signerReason;

    const updated = signProjectSnapshot(project, {
      name: signerName.trim(),
      role: signerRole,
      department: signerDepartment.trim(),
      reason: finalReason,
    });

    if (onProjectUpdate) {
      onProjectUpdate(updated);
    } else {
      onRestoreSnapshot(updated);
    }

    setIsSigningOpen(false);
    setCustomComment('');
    setRefreshKey((prev) => prev + 1);
  };

  const handleExecuteUnlock = () => {
    if (!unlockJustification.trim()) {
      alert('Bắt buộc phải nhập lý do (justification) mở khóa theo 21 CFR Part 11.');
      return;
    }
    try {
      const updated = unlockProject(project, {
        name: unlockUser.trim() || 'QA Director',
        role: 'Approver',
        justification: unlockJustification.trim(),
      });

      if (onProjectUpdate) {
        onProjectUpdate(updated);
      } else {
        onRestoreSnapshot(updated);
      }

      setIsUnlockOpen(false);
      setUnlockJustification('');
      setRefreshKey((prev) => prev + 1);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="qbd-card" style={{ borderLeft: '4px solid #1e293b' }}>
      {/* HEADER & INTEGRITY BADGE */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '0.9rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={20} color={integrity.isValid ? '#059669' : '#dc2626'} />
            <h3 style={{ fontSize: '1.05rem', margin: 0, color: '#0f172a', fontWeight: '700' }}>
              Quản trị GxP &amp; Tuân thủ 21 CFR Part 11 / EU Annex 11
            </h3>
          </div>
          <p style={{ fontSize: '0.75rem', margin: '0.2rem 0 0', color: '#64748b' }}>
            Chuỗi kiểm toán mật mã học SHA-256 (Tamper-Evident Hash Chain), xác thực toàn vẹn tức thời và chữ ký điện tử phân quyền.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            onClick={() => setRefreshKey((prev) => prev + 1)}
            title="Kiểm tra lại toàn bộ chuỗi băm mật mã học"
          >
            <RefreshCw size={13} /> Xác thực lại
          </button>
          <span className={`badge ${traceability.validation.valid ? 'badge-success' : 'badge-danger'}`}>
            {traceability.validation.valid ? 'Template hợp lệ' : 'Cần sửa template'}
          </span>
        </div>
      </div>

      {/* LIVE INTEGRITY VERIFICATION BANNER */}
      {integrity.isValid ? (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '0.45rem',
            padding: '0.65rem 0.85rem',
            marginBottom: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={18} color="#16a34a" />
            <div>
              <strong style={{ color: '#15803d', fontSize: '0.82rem' }}>
                Audit Chain: Cryptographically Verified
              </strong>
              <div style={{ fontSize: '0.72rem', color: '#166534' }}>
                Chuỗi kiểm toán nguyên vẹn, không có dấu hiệu sửa đổi trái phép ({integrity.chainLength ?? history.length} khối băm liên kết).
              </div>
            </div>
          </div>
          {integrity.rootHash && (
            <div style={{ fontSize: '0.7rem', color: '#166534', fontFamily: 'monospace' }}>
              Root Hash: <strong>{integrity.rootHash.slice(0, 16)}...</strong>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '0.45rem',
            padding: '0.65rem 0.85rem',
            marginBottom: '0.9rem',
            color: '#991b1b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <AlertTriangle size={18} color="#dc2626" />
            <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              INTEGRITY VIOLATION DETECTED — CẢNH BÁO CAN THIỆP DỮ LIỆU
            </strong>
          </div>
          <div style={{ fontSize: '0.74rem', lineHeight: '1.4' }}>
            Phát hiện sự sai lệch mã băm SHA-256 trong chuỗi kiểm toán tại khối #{integrity.tamperedIndex !== undefined ? integrity.tamperedIndex + 1 : 'N/A'}.
            {integrity.reason && <div style={{ marginTop: '0.2rem', fontFamily: 'monospace' }}>Chi tiết lỗi: {integrity.reason}</div>}
            <div style={{ marginTop: '0.2rem', fontWeight: '600' }}>
              Dữ liệu này không còn bảo đảm tính toàn vẹn (ALCOA+) theo chuẩn 21 CFR Part 11 và không đủ điều kiện nộp cơ quan quản lý.
            </div>
          </div>
        </div>
      )}

      {/* RECORD LOCK STATUS BANNER */}
      {project.isLocked && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #93c5fd',
            borderRadius: '0.45rem',
            padding: '0.75rem 0.9rem',
            marginBottom: '0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
            <Lock size={20} color="#2563eb" style={{ marginTop: '0.1rem' }} />
            <div>
              <strong style={{ color: '#1e40af', fontSize: '0.84rem' }}>
                🔒 HỒ SƠ ĐÃ ĐƯỢC PHÊ DUYỆT &amp; KHÓA (21 CFR PART 11 RECORD LOCKED)
              </strong>
              <div style={{ fontSize: '0.73rem', color: '#1e3a8a', marginTop: '0.15rem' }}>
                Được phê duyệt bởi: <strong>{project.lockDetails?.lockedBy || 'Approver'}</strong> ({project.lockDetails?.role || 'Approver'})
                {project.lockDetails?.lockedAt && ` vào lúc ${new Date(project.lockDetails.lockedAt).toLocaleString('vi-VN')}`}
              </div>
              {project.lockDetails?.reason && (
                <div style={{ fontSize: '0.71rem', color: '#3b82f6', marginTop: '0.1rem', fontStyle: 'italic' }}>
                  Lý do: &quot;{project.lockDetails.reason}&quot;
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.74rem', padding: '0.35rem 0.7rem', display: 'flex', alignItems: 'center', gap: '0.3rem', borderColor: '#93c5fd', color: '#1d4ed8' }}
            onClick={() => setIsUnlockOpen(!isUnlockOpen)}
          >
            <Unlock size={14} /> {isUnlockOpen ? 'Đóng form mở khóa' : 'Mở khóa tạo phiên bản mới'}
          </button>
        </div>
      )}

      {/* UNLOCK FORM */}
      {isUnlockOpen && project.isLocked && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '0.45rem',
            padding: '0.75rem 0.9rem',
            marginBottom: '0.9rem',
          }}
        >
          <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.82rem', color: '#0f172a' }}>
            Yêu cầu mở khóa hồ sơ theo quy trình 21 CFR Part 11
          </h4>
          <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0 0 0.5rem' }}>
            Việc mở khóa sẽ hủy bỏ trạng thái Approved và được ghi vết vĩnh viễn vào Audit Trail. Bắt buộc phải nêu rõ căn cứ khoa học / yêu cầu thẩm định.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Người mở khóa</label>
              <input
                type="text"
                className="input-field"
                style={{ width: '100%', fontSize: '0.74rem' }}
                value={unlockUser}
                onChange={(e) => setUnlockUser(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Lý do mở khóa (Justification) *</label>
              <input
                type="text"
                className="input-field"
                style={{ width: '100%', fontSize: '0.74rem' }}
                placeholder="Ví dụ: Bổ sung lô xác nhận theo khuyến nghị của Hội đồng Dược điển..."
                value={unlockJustification}
                onChange={(e) => setUnlockJustification(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}
              onClick={() => setIsUnlockOpen(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.7rem' }}
              onClick={handleExecuteUnlock}
            >
              Xác nhận mở khóa &amp; ghi vết
            </button>
          </div>
        </div>
      )}

      {/* METADATA CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem', fontSize: '0.76rem', marginBottom: '0.8rem' }}>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem', border: '1px solid #e2e8f0' }}>
          <strong>Protocol ID</strong><br />
          <span className="font-mono" style={{ color: '#0f172a' }}>{traceability.protocolId}</span>
        </div>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem', border: '1px solid #e2e8f0' }}>
          <strong>Trạng thái dữ liệu</strong><br />
          {traceability.runStatus}
        </div>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem', border: '1px solid #e2e8f0' }}>
          <strong>Tiến trình Phê duyệt</strong><br />
          <span style={{ color: hasApprover ? '#15803d' : hasReviewer ? '#0284c7' : hasAnalyst ? '#d97706' : '#64748b', fontWeight: '600' }}>
            {hasApprover
              ? '✓ Đã phê duyệt hoàn tất (Approver)'
              : hasReviewer
                ? 'Đã thẩm định kỹ thuật (Reviewer)'
                : hasAnalyst
                  ? 'Đã lập hồ sơ (Analyst)'
                  : 'Dự thảo (Chưa ký)'}
          </span>
        </div>
        <div style={{ background: '#f8fafc', padding: '0.65rem', borderRadius: '0.4rem', border: '1px solid #e2e8f0' }}>
          <strong>Chuỗi Audit Trail</strong><br />
          {history.length} snapshot mật mã học (FIPS 180-4)
        </div>
      </div>

      {traceability.validation.errors.map((message) => (
        <div key={message} style={{ marginTop: '0.4rem', color: '#b91c1c', fontSize: '0.74rem' }}>
          ⚠ {message}
        </div>
      ))}
      {traceability.validation.warnings.map((message) => (
        <div key={message} style={{ marginTop: '0.3rem', color: '#a16207', fontSize: '0.74rem' }}>
          • {message}
        </div>
      ))}

      {/* 21 CFR PART 11 ELECTRONIC SIGN-OFF SECTION */}
      <div style={{ marginTop: '1.1rem', paddingTop: '0.9rem', borderTop: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FileCheck size={17} color="#2563eb" />
            <h4 style={{ margin: 0, fontSize: '0.88rem', color: '#0f172a', fontWeight: '700' }}>
              Chữ ký điện tử 21 CFR § 11.50 (Electronic Signature Manifestations)
            </h4>
          </div>

          {!project.isLocked && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '0.74rem', padding: '0.32rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => setIsSigningOpen(!isSigningOpen)}
            >
              <UserCheck size={14} /> {isSigningOpen ? 'Đóng biểu mẫu ký' : 'Ký điện tử hồ sơ'}
            </button>
          )}
        </div>

        {!sigsVerification.isValid && (
          <div style={{ background: '#fef2f2', border: '1px solid #f87171', color: '#991b1b', padding: '0.4rem 0.6rem', borderRadius: '0.3rem', fontSize: '0.72rem', marginBottom: '0.5rem' }}>
            ⚠ <strong>Cảnh báo chữ ký:</strong> {sigsVerification.reason}
          </div>
        )}

        {/* SIGNATURES LIST */}
        {signatures.length === 0 ? (
          <div style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic', padding: '0.5rem 0' }}>
            Chưa có chữ ký điện tử nào được ghi nhận cho dự án này.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.7rem' }}>
            {signatures.map((sig, idx) => {
              const roleColors: Record<GxPRole, { bg: string; text: string; border: string }> = {
                Analyst: { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
                Reviewer: { bg: '#e0f2fe', text: '#075985', border: '#bae6fd' },
                Approver: { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
                System: { bg: '#f1f5f9', text: '#334155', border: '#e2e8f0' },
              };
              const colors = roleColors[sig.signerRole] || roleColors.System;
              return (
                <div
                  key={sig.id || idx}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderLeft: `4px solid ${colors.text}`,
                    borderRadius: '0.35rem',
                    padding: '0.55rem 0.75rem',
                    fontSize: '0.74rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div>
                      <span
                        style={{
                          background: colors.bg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`,
                          padding: '0.1rem 0.4rem',
                          borderRadius: '0.25rem',
                          fontWeight: '700',
                          fontSize: '0.68rem',
                          marginRight: '0.4rem',
                        }}
                      >
                        {sig.signerRole.toUpperCase()}
                      </span>
                      <strong style={{ color: '#0f172a' }}>{sig.signerName}</strong>
                      {sig.department && <span style={{ color: '#64748b' }}> — {sig.department}</span>}
                    </div>
                    <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                      {new Date(sig.timestamp).toLocaleString('vi-VN')}
                    </span>
                  </div>
                  <div style={{ color: '#334155', margin: '0.15rem 0' }}>
                    <strong>Ý nghĩa phê duyệt:</strong> {sig.reason}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.3rem', color: '#64748b', fontSize: '0.68rem', fontFamily: 'monospace' }}>
                    <span>Checksum: {sig.signatureChecksum.slice(0, 24)}...</span>
                    <span style={{ color: '#16a34a', fontWeight: '600' }}>✓ Mật mã học hợp lệ</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* EXECUTE SIGN-OFF FORM */}
        {isSigningOpen && !project.isLocked && (
          <div
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '0.45rem',
              padding: '0.75rem 0.9rem',
              marginTop: '0.6rem',
              marginBottom: '0.7rem',
            }}
          >
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: '#0f172a' }}>
              Ký duyệt hồ sơ điện tử theo quy định 21 CFR § 11.50
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Họ và tên người ký *</label>
                <input
                  type="text"
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.74rem' }}
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Vai trò phê duyệt *</label>
                <select
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.74rem' }}
                  value={signerRole}
                  onChange={(e) => handleRoleChange(e.target.value as 'Analyst' | 'Reviewer' | 'Approver')}
                >
                  <option value="Analyst">1. Analyst (Nghiên cứu viên / Tác giả - Authorship)</option>
                  <option value="Reviewer">2. Reviewer (Thẩm định khoa học / Thống kê - Technical Review)</option>
                  <option value="Approver">3. Approver (Giám đốc QA / Phê duyệt phát hành - Release &amp; Lock)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Phòng ban / Bộ phận</label>
                <input
                  type="text"
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.74rem' }}
                  value={signerDepartment}
                  onChange={(e) => setSignerDepartment(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Ý nghĩa pháp lý của chữ ký (Meaning of Signature per § 11.50)</label>
              <textarea
                className="input-field"
                style={{ width: '100%', fontSize: '0.74rem', minHeight: '44px' }}
                value={signerReason}
                onChange={(e) => setSignerReason(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '0.6rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569' }}>Ghi chú bổ sung (Tùy chọn)</label>
              <input
                type="text"
                className="input-field"
                style={{ width: '100%', fontSize: '0.74rem' }}
                placeholder="Ghi chú thêm về phạm vi thẩm định hoặc tài liệu đính kèm..."
                value={customComment}
                onChange={(e) => setCustomComment(e.target.value)}
              />
            </div>

            {signerRole === 'Approver' && (
              <div style={{ fontSize: '0.71rem', color: '#b45309', background: '#fef3c7', padding: '0.4rem 0.6rem', borderRadius: '0.3rem', marginBottom: '0.6rem' }}>
                ⚠ <strong>Lưu ý quan trọng:</strong> Khi Giám đốc QA ký với vai trò <strong>Approver</strong>, hồ sơ sẽ tự động chuyển sang trạng thái <strong>KHÓA (LOCKED)</strong> để ngăn chặn mọi thay đổi trái phép theo 21 CFR Part 11.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem' }}
                onClick={() => setIsSigningOpen(false)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.75rem' }}
                onClick={handleExecuteSignOff}
              >
                Ký điện tử &amp; Niêm phong mật mã học
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AUDIT TRAIL LEDGER & SNAPSHOT RESTORE */}
      <div style={{ marginTop: '1.1rem', paddingTop: '0.9rem', borderTop: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <History size={16} color="#475569" />
          <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#0f172a', fontWeight: '700' }}>
            Sổ cái kiểm toán bất biến (Cryptographic Audit Ledger)
          </h4>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>So sánh với snapshot</label>
          <select
            className="input-field"
            style={{ minWidth: '260px', fontSize: '0.75rem' }}
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Chọn phiên bản đã lưu…</option>
            {history.map((entry) => (
              <option key={entry.id} value={entry.id}>
                #{entry.sequenceNumber} — {new Date(entry.timestamp).toLocaleString('vi-VN')} — {entry.action}
              </option>
            ))}
          </select>
          {selected && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem' }}
              onClick={() => onRestoreSnapshot(selected.project)}
            >
              Khôi phục snapshot
            </button>
          )}
        </div>

        {selected && (
          <div style={{ marginTop: '0.55rem', background: '#f1f5f9', borderRadius: '0.4rem', padding: '0.6rem 0.7rem', fontSize: '0.74rem', color: '#334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', flexWrap: 'wrap', gap: '0.3rem' }}>
              <strong>So với #{selected.sequenceNumber} ({new Date(selected.timestamp).toLocaleString('vi-VN')}):</strong>
              <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#64748b' }}>
                EntryHash: {selected.entryHash?.slice(0, 16)}... | Prev: {selected.previousHash?.slice(0, 12)}...
              </span>
            </div>
            {comparison.map((item) => (
              <div key={item}>• {item}</div>
            ))}
          </div>
        )}
      </div>

      {/* REGULATORY NOTICE */}
      <div
        style={{
          marginTop: '0.9rem',
          padding: '0.65rem 0.75rem',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '0.4rem',
          color: '#334155',
          fontSize: '0.73rem',
          lineHeight: '1.45',
        }}
      >
        <strong>GxP Compliance Note (SEC-05 &amp; 21 CFR Part 11):</strong> Hệ thống ghi vết kiểm toán sử dụng chuỗi băm liên kết SHA-256 (FIPS 180-4) và chuẩn tuần tự hóa Canonical JSON (RFC 8785). Mọi hành động chỉnh sửa số liệu, cài đặt DoE và chữ ký điện tử 3 cấp đều được đóng dấu thời gian (UTC timestamp) và liên kết với khối trước đó để chống can thiệp trái phép.
      </div>
    </div>
  );
};
