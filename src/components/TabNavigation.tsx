import {
  Target,
  ShieldAlert,
  LayoutGrid,
  Calculator,
  BrainCircuit,
  Compass,
  Boxes,
  FileCheck2,
} from 'lucide-react';

export type TabKey =
  | 'qtpp'
  | 'fmea'
  | 'doe'
  | 'anova'
  | 'neural'
  | 'rsm'
  | 'design_space'
  | 'report';

interface TabNavigationProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
}) => {
  const tabs = [
    {
      key: 'qtpp' as TabKey,
      label: '1. QTPP & CQAs',
      subtitle: 'Mục tiêu & Tiêu chuẩn',
      icon: Target,
      tag: 'ICH Q8',
    },
    {
      key: 'fmea' as TabKey,
      label: '2. Quản lý Rủi ro',
      subtitle: 'FMEA & Ishikawa',
      icon: ShieldAlert,
      tag: 'ICH Q9',
    },
    {
      key: 'doe' as TabKey,
      label: '3. Thiết kế DoE',
      subtitle: 'Screening / RSM / Mixture',
      icon: LayoutGrid,
      tag: 'DoE Matrix',
    },
    {
      key: 'anova' as TabKey,
      label: '4. Thống kê & ANOVA',
      subtitle: 'Hồi quy & Chẩn đoán',
      icon: Calculator,
      tag: 'Models',
    },
    {
      key: 'neural' as TabKey,
      label: '5. Mạng Nơ-ron (NN)',
      subtitle: 'SAS JMP Neural Platform',
      icon: BrainCircuit,
      tag: 'AI Models',
    },
    {
      key: 'rsm' as TabKey,
      label: '6. Bề mặt Đáp ứng',
      subtitle: '3D Surface & 2D Contour',
      icon: Compass,
      tag: '3D Plots',
    },
    {
      key: 'design_space' as TabKey,
      label: '7. Vùng Thiết kế',
      subtitle: 'Desirability & Design Space',
      icon: Boxes,
      tag: 'ICH Q8/Q10',
    },
    {
      key: 'report' as TabKey,
      label: '8. Báo cáo Hồ sơ',
      subtitle: 'CTD 3.2.P.2 & Xuất file',
      icon: FileCheck2,
      tag: 'Dossier',
    },
  ];

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '0.5rem 1.25rem 0',
      }}
    >
      <div
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.65rem 1rem',
                border: 'none',
                background: 'none',
                borderBottom: isActive ? '3px solid #1e3a8a' : '3px solid transparent',
                cursor: 'pointer',
                color: isActive ? '#1e3a8a' : '#64748b',
                fontWeight: isActive ? '600' : '500',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <div
                style={{
                  padding: '0.35rem',
                  borderRadius: '0.375rem',
                  backgroundColor: isActive ? '#eff6ff' : '#f1f5f9',
                  color: isActive ? '#1e3a8a' : '#64748b',
                }}
              >
                <Icon size={18} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.85rem', lineHeight: '1.2' }}>{tab.label}</div>
                <div style={{ fontSize: '0.72rem', color: isActive ? '#3b82f6' : '#94a3b8' }}>
                  {tab.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
