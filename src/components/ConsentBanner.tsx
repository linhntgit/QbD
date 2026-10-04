import React, { useState, useEffect } from 'react';
import { Shield, Check, X } from 'lucide-react';
import { getAnalyticsConsent, setAnalyticsConsent, type ConsentStatus } from '../services/analytics';

export const ConsentBanner: React.FC = () => {
  const [status, setStatus] = useState<ConsentStatus>('denied');
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    const current = getAnalyticsConsent();
    setStatus(current);
    if (current === 'pending') {
      setIsVisible(true);
    }
  }, []);

  if (!isVisible || status !== 'pending') {
    return null;
  }

  const handleAccept = () => {
    setAnalyticsConsent('granted');
    setStatus('granted');
    setIsVisible(false);
  };

  const handleDecline = () => {
    setAnalyticsConsent('denied');
    setStatus('denied');
    setIsVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Tùy chọn quyền riêng tư và phân tích"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        maxWidth: '420px',
        backgroundColor: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '0.65rem',
        padding: '0.85rem 1rem',
        boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
        zIndex: 9999,
        fontSize: '0.78rem',
        color: '#334155',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        animation: 'fadeIn 0.3s ease-in-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <Shield size={18} color="#0f766e" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ color: '#0f172a', fontSize: '0.82rem', display: 'block', marginBottom: '0.2rem' }}>
            Quyền Riêng Tư &amp; Dữ Liệu Nghiên Cứu (R&amp;D Privacy)
          </strong>
          <span>
            QbD Studio bảo mật toàn bộ dữ liệu công thức trên trình duyệt của bạn. Bạn có cho phép gửi thống kê ẩn danh về việc sử dụng tính năng để cải tiến công cụ không?
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.2rem' }}>
        <button
          type="button"
          onClick={handleDecline}
          className="btn btn-secondary"
          style={{
            fontSize: '0.75rem',
            padding: '0.3rem 0.65rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <X size={13} />
          <span>Từ Chối</span>
        </button>
        <button
          type="button"
          onClick={handleAccept}
          className="btn btn-teal"
          style={{
            fontSize: '0.75rem',
            padding: '0.3rem 0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <Check size={13} />
          <span>Đồng Ý</span>
        </button>
      </div>
    </div>
  );
};
