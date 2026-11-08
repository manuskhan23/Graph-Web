import React from 'react';

/**
 * Keeps one failing surface from blanking the whole window. Errors are shown,
 * never swallowed, and the rest of the app stays usable.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[nexus][ui] surface crashed:', error);
  }

  override componentDidUpdate(previous: { resetKey?: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <h3>This surface failed to render</h3>
          <div className="small muted mono">{this.state.error.message}</div>
          <div style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => this.setState({ error: null })} type="button">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
