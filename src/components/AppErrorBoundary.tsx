import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ứng dụng gặp lỗi không thể phục hồi tại chỗ.', error, info);
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
          background: '#f8fafc',
        }}
      >
        <section className="qbd-card" style={{ width: 'min(520px, 100%)', borderLeft: '4px solid #dc2626' }}>
          <h1 style={{ fontSize: '1.1rem', color: '#991b1b', marginBottom: '0.5rem' }}>Không thể hiển thị ứng dụng</h1>
          <p style={{ color: '#475569', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Dữ liệu của bạn vẫn được giữ trong trình duyệt. Hãy tải lại trang; nếu lỗi lặp lại, xuất project JSON và gửi cho nhóm hỗ trợ để kiểm tra.
          </p>
          <button className="btn btn-primary" type="button" onClick={this.reload}>Tải lại ứng dụng</button>
        </section>
      </main>
    );
  }
}
