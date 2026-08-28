import React from 'react';
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
      subtitle: 'Mục tiêu chất lượng',
      icon: Target,
      tag: 'ICH Q8',
    },
    {
      key: 'fmea' as TabKey,
      label: '2. Rủi ro FMEA',
      subtitle: 'Sàng lọc CMA/CPP',
      icon: ShieldAlert,
      tag: 'ICH Q9',
    },
    {
      key: 'doe' as TabKey,
      label: '3. Thiết kế DoE',
      subtitle: 'Ma trận thí nghiệm',
      icon: LayoutGrid,
      tag: 'DoE Matrix',
    },
    {
      key: 'anova' as TabKey,
      label: '4. Thống kê ANOVA',
      subtitle: 'Hồi quy đa thức',
      icon: Calculator,
      tag: 'Models',
    },
    {
      key: 'neural' as TabKey,
      label: '5. Mạng Nơ-ron',
      subtitle: 'Mạng Nơ-ron AI',
      icon: BrainCircuit,
      tag: 'AI Models',
    },
    {
      key: 'rsm' as TabKey,
      label: '6. Bề mặt RSM',
      subtitle: '3D Surface & Contour',
      icon: Compass,
      tag: '3D Plots',
    },
    {
      key: 'design_space' as TabKey,
      label: '7. Vùng Thiết kế',
      subtitle: 'Profiler & Tối ưu',
      icon: Boxes,
      tag: 'ICH Q8/Q10',
    },
    {
      key: 'report' as TabKey,
      label: '8. Báo Cáo Hồ Sơ',
      subtitle: 'CTD 3.2.P.2 & Word',
      icon: FileCheck2,
      tag: 'Dossier',
      highlight: true,
    },
  ];

  return (
    <nav
      aria-label="Quy trình phát triển QbD"
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #cbd5e1',
        padding: '0.35rem 1rem 0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div
        role="tablist"
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          display: 'flex',
          gap: '0.35rem',
          justifyContent: 'space-between',
          alignItems: 'stretch',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const isHighlight = tab.highlight;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`${tab.label}: ${tab.subtitle}`}
              onClick={() => onTabChange(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 0.65rem',
                border: 'none',
                background: isActive
                  ? '#eff6ff'
                  : isHighlight
                  ? '#f0fdf4'
                  : 'none',
                borderRadius: '0.375rem 0.375rem 0 0',
                borderBottom: isActive
                  ? '3px solid #1e3a8a'
                  : isHighlight
                  ? '3px solid #0f766e'
                  : '3px solid transparent',
                cursor: 'pointer',
                color: isActive
                  ? '#1e3a8a'
                  : isHighlight
                  ? '#0f766e'
                  : '#64748b',
                fontWeight: isActive ? '700' : '600',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              title={`${tab.label}: ${tab.subtitle}`}
            >
              <div
                style={{
                  padding: '0.3rem',
                  borderRadius: '0.35rem',
                  backgroundColor: isActive
                    ? '#1e3a8a'
                    : isHighlight
                    ? '#ccfbf1'
                    : '#f1f5f9',
                  color: isActive ? '#ffffff' : isHighlight ? '#0f766e' : '#64748b',
                }}
              >
                <Icon size={16} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.8rem', lineHeight: '1.2' }}>{tab.label}</div>
                <div style={{ fontSize: '0.68rem', color: isActive ? '#2563eb' : isHighlight ? '#0d9488' : '#94a3b8' }}>
                  {tab.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
