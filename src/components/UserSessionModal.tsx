import React, { useState } from 'react';
import { User, X, Check, Shield } from 'lucide-react';
import type { GxPRole } from '../services/projectGovernance';
import { getActiveSession, setActiveSession, type ActiveUserSession } from '../services/sessionService';

interface UserSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionChange?: (session: ActiveUserSession) => void;
}

export const UserSessionModal: React.FC<UserSessionModalProps> = ({
  isOpen,
  onClose,
  onSessionChange,
}) => {
  const currentSession = getActiveSession();
  const [name, setName] = useState<string>(currentSession.name);
  const [role, setRole] = useState<GxPRole>(currentSession.role);
  const [department, setDepartment] = useState<string>(currentSession.department);

  if (!isOpen) return null;

  const handleSave = () => {
    const updated = setActiveSession({
      name: name.trim() || 'Analyst',
      role,
      department: department.trim() || 'R&D',
    });
    onSessionChange?.(updated);
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
        zIndex: 10000,
        padding: '1rem',
      }}
    >
      <div
        className="qbd-card animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#ffffff',
          borderRadius: '0.75rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={20} color="#0f766e" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Thiết Lập Phiên Người Dùng (GxP User Session)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="btn"
            style={{ padding: '0.25rem', color: '#64748b', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Info notice */}
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '0.375rem',
            padding: '0.65rem 0.85rem',
            fontSize: '0.75rem',
            color: '#166534',
            lineHeight: '1.45',
            display: 'flex',
            gap: '0.5rem',
          }}
        >
          <Shield size={16} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Thông tin người dùng sẽ được gắn liền với mọi mục ghi vết kiểm toán (Audit Trail) và chữ ký điện tử theo nguyên tắc <strong>Attributable (Quy trách nhiệm)</strong> của ALCOA+.
          </span>
        </div>

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#334155', marginBottom: '0.3rem' }}>
              Họ và tên người thực hiện:
            </label>
            <input
              type="text"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Dược sĩ Nguyễn Văn A"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#334155', marginBottom: '0.3rem' }}>
              Vai trò trong quy trình (Role):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['Analyst', 'Reviewer', 'Approver'] as GxPRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  style={{
                    flex: 1,
                    padding: '0.45rem 0.5rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.78rem',
                    fontWeight: role === r ? '700' : '500',
                    border: role === r ? '2px solid #0f766e' : '1px solid #cbd5e1',
                    backgroundColor: role === r ? '#ccfbf1' : '#ffffff',
                    color: role === r ? '#0f766e' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {r === 'Analyst' ? 'Analyst (Tác giả)' : r === 'Reviewer' ? 'Reviewer (Thẩm định)' : 'Approver (Phê duyệt)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#334155', marginBottom: '0.3rem' }}>
              Phòng ban / Đơn vị:
            </label>
            <input
              type="text"
              className="input-field"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="VD: Viện Nghiên cứu & Bào chế"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-teal"
            style={{ fontSize: '0.8rem', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Check size={14} />
            <span>Lưu Phiên Làm Việc</span>
          </button>
        </div>
      </div>
    </div>
  );
};
