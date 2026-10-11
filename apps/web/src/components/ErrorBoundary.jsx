import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[ErrorBoundary caught]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          color: '#f87171',
          fontSize: '0.9rem',
          textAlign: 'center',
          margin: '10px 0'
        }}>
          <p style={{ fontWeight: 600 }}>Map display unavailable.</p>
          <p style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '4px' }}>
            {this.props.fallbackText || 'Coordinates are active. Turn-by-turn text navigation is available below.'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
