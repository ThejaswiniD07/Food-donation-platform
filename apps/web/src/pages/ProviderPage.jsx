import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function ProviderPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem('food_rescue_token');
  const user = JSON.parse(localStorage.getItem('food_rescue_user') || '{}');

  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qrUrl, setQrUrl] = useState('');

  // Quick post form in provider portal
  const [meals, setMeals] = useState(25);
  const [diet, setDiet] = useState('veg');
  const [form, setForm] = useState('cooked');
  const [hours, setHours] = useState(3);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!token || user.role !== 'provider') {
      navigate('/login');
      return;
    }

    // Load profile
    fetch('/api/provider/profile', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        setProfile(data.provider);
        if (data.provider.contributor?.shop_token) {
          const shopUrl = `${window.location.origin}/s/${data.provider.contributor.shop_token}`;
          import('qrcode').then((QRCode) => {
            QRCode.toDataURL(shopUrl, { width: 180, margin: 1 }, (err, url) => {
              if (!err) setQrUrl(url);
            });
          });
        }
      });

    // Load items
    fetch('/api/provider/items', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        setItems(data.items || []);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handlePost = async (e) => {
    e.preventDefault();
    setPosting(true);
    try {
      const res = await fetch('/api/provider/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meals, diet, form, hours })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to post');
      // Refresh items
      const updatedRes = await fetch('/api/provider/items', { headers: { Authorization: `Bearer ${token}` } });
      const updatedData = await updatedRes.json();
      setItems(updatedData.items || []);
      alert('Surplus food posted successfully!');
    } catch (err) {
      alert(err.message);
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading provider dashboard...</div>
      </div>
    );
  }

  const shopToken = profile?.contributor?.shop_token;
  const shopUrl = shopToken ? `${window.location.origin}/s/${shopToken}` : '';

  return (
    <div className="app-container" style={{ maxWidth: '800px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h2>{profile?.contributor?.name || user.name || 'Provider Portal'}</h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Verified Food Donor Account</div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { localStorage.clear(); navigate('/login'); }}
        >
          Logout
        </button>
      </div>

      {/* QR Code and Quick Link Card */}
      {shopToken && (
        <div className="glass-card" style={{ marginBottom: '18px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          {qrUrl && (
            <div style={{ background: '#ffffff', padding: '8px', borderRadius: '12px' }}>
              <img src={qrUrl} alt="Quick Post QR Code" style={{ display: 'block', width: '130px', height: '130px' }} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: '240px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '6px' }}>Your Shop Quick-Post QR</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Print this QR code at your kitchen or billing counter for staff to donate excess food in 3 taps without any login!
            </p>
            <a
              href={shopUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--primary)',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                wordBreak: 'break-all'
              }}
            >
              {shopUrl}
            </a>
          </div>
        </div>
      )}

      {/* Post Food Batch Form */}
      <div className="glass-card" style={{ marginBottom: '18px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '14px' }}>🍲 Post Surplus Food Batch</h3>
        <form onSubmit={handlePost} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="input-label">Meals Quantity</label>
              <input
                type="number"
                className="input-field"
                value={meals}
                onChange={(e) => setMeals(Number(e.target.value))}
                required
              />
            </div>
            <div>
              <label className="input-label">Safe for (Hours)</label>
              <input
                type="number"
                className="input-field"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="input-label">Diet</label>
              <select className="input-field" value={diet} onChange={(e) => setDiet(e.target.value)}>
                <option value="veg">Vegetarian 🥬</option>
                <option value="nonveg">Non-Vegetarian 🍗</option>
              </select>
            </div>
            <div>
              <label className="input-label">Form</label>
              <select className="input-field" value={form} onChange={(e) => setForm(e.target.value)}>
                <option value="cooked">Fresh Cooked 🍲</option>
                <option value="packed">Packed & Sealed 📦</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={posting}>
            {posting ? 'Posting...' : 'Post Surplus Batch'}
          </button>
        </form>
      </div>

      {/* History Table */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>Donation History</h3>
        {items.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>No donations posted yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Meals</th>
                  <th>Status</th>
                  <th>Notes & Reasons</th>
                  <th>Track</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ fontWeight: 600 }}>{it.title}</td>
                    <td>{it.meals}</td>
                    <td>
                      <span className={`badge ${it.status === 'DELIVERED' ? 'badge-green' : it.status === 'LEFT_OUT' || it.status === 'EXPIRED' ? 'badge-red' : 'badge-amber'}`}>
                        {it.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {it.final_reason_text || it.note_text || 'Active in pool'}
                    </td>
                    <td>
                      <Link to={`/track/${it.track_token}`} style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>
                        Track →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
