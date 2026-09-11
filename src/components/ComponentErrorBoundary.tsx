import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ComponentErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  compact?: boolean;
  onReset?: () => void;
}

interface ComponentErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  state: ComponentErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ComponentErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('[ComponentErrorBoundary] Caught component render exception:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.fallbackTitle || 'Thành phần gặp sự cố khi hiển thị';
    const message = this.state.error?.message || 'Đã xảy ra lỗi không xác định trong quá trình render.';

    if (this.props.compact) {
      return (
        <div
          role="alert"
          style={{
            padding: '0.75rem',
            borderRadius: '0.375rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            fontSize: '0.8rem',
            margin: '0.5rem 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <AlertTriangle size={16} />
            <span>{title}: {message}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={this.handleReset}
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <RotateCcw size={12} />
            <span>Thử lại</span>
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        className="qbd-card"
        style={{
          padding: '1.5rem',
          margin: '1rem 0',
          borderLeft: '4px solid #dc2626',
          backgroundColor: '#fef2f2',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#991b1b', marginBottom: '0.5rem' }}>
          <AlertTriangle size={20} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#7f1d1d', marginBottom: '1rem' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={this.handleReset}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <RotateCcw size={14} />
            <span>Khôi phục thành phần</span>
          </button>
        </div>
      </div>
    );
  }
}
