import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function TrackingPage() {
  const { itemToken } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [serverNow, setServerNow] = useState(Date.now());

  const fetchTracking = () => {
    fetch(`/api/public/track/${itemToken}`)
      .then((res) => {
        if (!res.ok) throw new Error('Tracking record not found');
        return res.json();
      })
      .then((data) => {
        setItem(data.item);
        if (data.serverNow) setServerNow(data.serverNow);
      })
      .catch((err) => {
        console.warn('Track fetch error:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTracking();
    const interval = setInterval(fetchTracking, 8000); // 8-second poll
    return () => clearInterval(interval);
  }, [itemToken]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this food donation?')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/public/track/${itemToken}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Could not cancel');
      fetchTracking();
    } catch (err) {
      alert(err.message);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading tracking details...</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div className="glass-card">
          <h2>Tracking Link Not Found</h2>
          <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>Please check your link or post a new food batch.</p>
          <Link to="/post" className="btn-primary">Post Surplus Food</Link>
        </div>
      </div>
    );
  }

  // Safe time countdown calculation
  const msLeft = Math.max(0, item.expiresAt - serverNow);
  const hoursLeft = Math.floor(msLeft / 3600000);
  const minutesLeft = Math.floor((msLeft % 3600000) / 60000);

  const isCollected = item.status === 'COLLECTED' || item.status === 'DELIVERED';
  const isTerminal = item.status === 'DELIVERED' || item.status === 'LEFT_OUT' || item.status === 'EXPIRED' || item.status === 'CANCELLED';

  const getStatusBadge = () => {
    switch (item.status) {
      case 'POOLED':
        return <span className="badge badge-amber">Awaiting Cluster</span>;
      case 'IN_TRIP':
        return <span className="badge badge-blue">Trip Assigned</span>;
      case 'COLLECTED':
        return <span className="badge badge-green">Food Collected</span>;
      case 'DELIVERED':
        return <span className="badge badge-green">Delivered</span>;
      case 'LEFT_OUT':
        return <span className="badge badge-red">Left Out</span>;
      case 'EXPIRED':
        return <span className="badge badge-red">Expired</span>;
      case 'CANCELLED':
        return <span className="badge badge-amber">Cancelled</span>;
      default:
        return <span className="badge badge-blue">{item.status}</span>;
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
          <span>← Home</span>
        </Link>
        {getStatusBadge()}
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.45rem', marginBottom: '4px' }}>{item.title}</h2>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Batch ID: #{item.id?.substring(0, 8)}
          </div>
        </div>

        {/* Live Status Sentence */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '16px'
        }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Live Dispatch Update
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff', lineHeight: 1.4 }}>
            {item.finalReasonText || item.noteText || 'Food is safely pooled for nearby pickup dispatch.'}
          </div>
        </div>

        {/* Safe-time Countdown */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Safe Until</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: msLeft < 1800000 ? 'var(--accent-red)' : 'var(--text-main)' }}>
              {hoursLeft > 0 ? `${hoursLeft}h ${minutesLeft}m` : `${minutesLeft}m`} remaining
            </div>
          </div>
          <div style={{ fontSize: '1.5rem' }}>⏳</div>
        </div>

        {/* Assigned NGO details */}
        {item.assignedNgoName && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '14px'
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--primary)', textTransform: 'uppercase', fontWeight: 600 }}>
              Assigned NGO
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px' }}>
              {item.assignedNgoName}
            </div>
            {item.plannedPickupTime && (
              <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Estimated pickup arrival: {new Date(item.plannedPickupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        )}

        {/* Action button */}
        {!isTerminal && (
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              id="btn-cancel-item"
              onClick={handleCancel}
              disabled={isCollected || cancelling}
              className="btn-secondary"
              style={{ width: '100%', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}
            >
              {isCollected ? 'Cannot cancel: food already collected' : cancelling ? 'Cancelling...' : 'Cancel Food Post'}
            </button>
          </div>
        )}

        {/* Add to home screen hint */}
        <div style={{
          textAlign: 'center',
          fontSize: '0.8rem',
          color: 'var(--text-dim)',
          paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)'
        }}>
          💡 Tip: Add this page to your home screen for one-tap live updates.
        </div>
      </div>
    </div>
  );
}
