import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('9100000001');
  const [password, setPassword] = useState('ngo123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fillDemo = (demoPhone, demoPass) => {
    setPhone(demoPhone);
    setPassword(demoPass);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      localStorage.setItem('food_rescue_token', data.token);
      localStorage.setItem('food_rescue_user', JSON.stringify(data.user));

      if (data.user.role === 'admin') {
        navigate('/admin');
      } else if (data.user.role === 'provider') {
        navigate('/provider');
      } else {
        navigate('/ngo');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ justifyContent: 'center' }}>
      <div className="glass-card" style={{ padding: '28px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <Link to="/" style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>← Back to Home</Link>
          <h2 style={{ fontSize: '1.6rem', marginTop: '10px' }}>Sign In</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            NGO Pickup Drivers, Food Providers & Admin
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            borderRadius: '10px',
            padding: '10px',
            fontSize: '0.88rem',
            marginBottom: '14px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="input-label" htmlFor="login-phone">Phone Number</label>
            <input
              id="login-phone"
              type="tel"
              className="input-field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="input-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            id="btn-login-submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Quick Demo Fill Buttons */}
        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Quick Demo Logins:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px' }}
              onClick={() => fillDemo('9100000001', 'ngo123')}
            >
              NGO 1 (Hope Kitchen)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px' }}
              onClick={() => fillDemo('9100000002', 'ngo123')}
            >
              NGO 2 (City Care)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px' }}
              onClick={() => fillDemo('9000000001', 'provider123')}
            >
              Provider (Green Leaf)
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.82rem', padding: '6px' }}
              onClick={() => fillDemo('9000000000', 'admin123')}
            >
              Super Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
