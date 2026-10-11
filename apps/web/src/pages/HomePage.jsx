import React from 'react';
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="app-container" style={{ justifyContent: 'center', minHeight: '90vh' }}>
      <div className="glass-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <div style={{
          width: '72px',
          height: '72px',
          margin: '0 auto 18px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 30px rgba(16, 185, 129, 0.25)'
        }}>
          <img src="/icon.svg" alt="Food Rescue Icon" style={{ width: '48px', height: '48px' }} />
        </div>

        <h1 style={{ fontSize: '2.2rem', marginBottom: '8px', lineHeight: 1.15 }}>
          Food <span style={{ color: 'var(--primary)' }}>Rescue</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', marginBottom: '32px', lineHeight: 1.5 }}>
          Hyper-local surplus food dispatch.<br />
          No apps. No passwords. Under 30 seconds.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Link to="/post" className="btn-primary" id="btn-home-post">
            <span>🍲 Post Surplus Food</span>
            <span style={{ fontSize: '1.2rem' }}>→</span>
          </Link>

          <Link to="/login" className="btn-secondary" id="btn-home-login">
            <span>🔐 Sign In (NGO / Provider / Admin)</span>
          </Link>
        </div>

        <div style={{
          marginTop: '36px',
          paddingTop: '20px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-around',
          textAlign: 'center'
        }}>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>20+</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Min Meals Trip</div>
          </div>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>&lt; 30s</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Quick Post</div>
          </div>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-amber)' }}>100%</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Safe Windows</div>
          </div>
        </div>
      </div>
    </div>
  );
}
