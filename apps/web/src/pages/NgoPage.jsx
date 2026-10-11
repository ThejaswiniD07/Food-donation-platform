import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';

const LazyMapPicker = lazy(() => import('../components/MapPicker.jsx'));

export default function NgoPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem('food_rescue_token');
  const user = JSON.parse(localStorage.getItem('food_rescue_user') || '{}');

  const [ngoState, setNgoState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverNow, setServerNow] = useState(Date.now());
  const [advancing, setAdvancing] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [historyTrips, setHistoryTrips] = useState([]);
  const [activeTab, setActiveTab] = useState('home'); // home, history, profile
  const [pageHiddenNotice, setPageHiddenNotice] = useState(false);

  // Audio Chime reference
  const audioContextRef = useRef(null);

  const playChime = () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {
      // Audio not permitted yet
    }
  };

  useEffect(() => {
    if (!token || user.role !== 'ngo') {
      navigate('/login');
      return;
    }

    fetchState();
    const interval = setInterval(() => {
      fetchState();
    }, 5000);

    const gpsInterval = setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            fetch('/api/ngo/location', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude })
            }).catch(() => {});
          },
          () => {}
        );
      }
    }, 15000);

    // Visibility change listener for Section 10/12 honest GPS notice
    const handleVisibilityChange = () => {
      setPageHiddenNotice(document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      clearInterval(gpsInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const fetchState = () => {
    fetch('/api/ngo/state', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (res.status === 401) {
          navigate('/login');
          throw new Error('Session expired');
        }
        return res.json();
      })
      .then((data) => {
        setNgoState((prev) => {
          // Play chime if new offer arrives
          if (!prev?.offer && data.offer) {
            playChime();
          } else if (!prev?.routeOffer && data.routeOffer) {
            playChime();
          }
          return data;
        });
        if (data.serverNow) setServerNow(data.serverNow);
      })
      .catch((err) => {
        console.warn('NGO state fetch error:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleToggleOnline = async () => {
    const nextOnline = !ngoState?.online;

    // Request wake lock if going online
    if (nextOnline && 'wakeLock' in navigator) {
      try {
        await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake lock error:', err);
      }
    }

    // Request Notification permission
    if (nextOnline && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Get location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          await sendOnline(nextOnline, pos.coords.latitude, pos.coords.longitude);
        },
        async () => {
          await sendOnline(nextOnline, 12.9716, 77.5946);
        }
      );
    } else {
      await sendOnline(nextOnline, 12.9716, 77.5946);
    }
  };

  const sendOnline = async (online, lat, lng) => {
    await fetch('/api/ngo/online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ online, lat, lng })
    });
    fetchState();
  };

  const handleAcceptTrip = async (tripId) => {
    try {
      const res = await fetch(`/api/trips/${tripId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error?.message || 'Could not accept trip');
      }
      fetchState();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeclineTrip = async (tripId) => {
    await fetch(`/api/trips/${tripId}/decline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchState();
  };

  const handleAdvance = async (expectedStep, outcome) => {
    if (!ngoState?.activeTrip) return;
    setAdvancing(true);

    try {
      const res = await fetch(`/api/trips/${ngoState.activeTrip.id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expectedStep, outcome })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error?.message || 'Failed to advance trip');
      }
      fetchState();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdvancing(false);
    }
  };

  const handleAcceptRouteOffer = async (offerId) => {
    await fetch(`/api/route-offers/${offerId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchState();
  };

  const handleDeclineRouteOffer = async (offerId) => {
    await fetch(`/api/route-offers/${offerId}/decline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchState();
  };

  const fetchHistory = () => {
    fetch('/api/ngo/history', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => setHistoryTrips(data.trips || []));
  };

  if (loading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading NGO dashboard...</div>
      </div>
    );
  }

  const activeTrip = ngoState?.activeTrip;
  const offer = ngoState?.offer;
  const routeOffer = ngoState?.routeOffer;

  // Next stop calculation
  let nextStop = null;
  let isAtDelivery = false;
  if (activeTrip) {
    if (activeTrip.step < activeTrip.stops.length) {
      nextStop = activeTrip.stops[activeTrip.step];
    } else {
      isAtDelivery = true;
    }
  }

  return (
    <div className="app-container" style={{ paddingBottom: '70px' }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem' }}>{user.name || 'NGO Portal'}</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            GPS Status: {ngoState?.online ? '🟢 Live & Transmitting' : '⚪ Offline'}
          </div>
        </div>

        <button
          type="button"
          id="btn-toggle-online"
          onClick={handleToggleOnline}
          className="badge"
          style={{
            background: ngoState?.online ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
            color: ngoState?.online ? '#34d399' : '#94a3b8',
            border: `1px solid ${ngoState?.online ? 'var(--primary)' : 'var(--border-subtle)'}`,
            padding: '8px 14px',
            fontSize: '0.88rem',
            cursor: 'pointer'
          }}
        >
          {ngoState?.online ? '● ONLINE' : '○ GO ONLINE'}
        </button>
      </div>

      {pageHiddenNotice && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.15)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '10px',
          padding: '10px',
          color: '#fbbf24',
          fontSize: '0.82rem',
          marginBottom: '12px'
        }}>
          ⚠️ Location pauses in the background. Keep this browser page open during active duty.
        </div>
      )}

      {/* MID-TRIP ROUTE OFFER BANNER */}
      {routeOffer && (
        <div className="glass-card" style={{
          border: '2px solid var(--accent-cyan)',
          boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge badge-blue">⚡ Quick Add Opportunity</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
              {Math.max(0, Math.ceil((routeOffer.endsAt - serverNow) / 1000))}s left
            </span>
          </div>

          <h3 style={{ fontSize: '1.2rem', margin: '8px 0 4px' }}>{routeOffer.title}</h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Contributor: {routeOffer.contributorName} • Detour: +{routeOffer.detourKm} km
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
            <button
              type="button"
              className="btn-primary"
              style={{ minHeight: '44px', fontSize: '0.95rem' }}
              onClick={() => handleAcceptRouteOffer(routeOffer.id)}
            >
              Accept Add-on
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: '44px', fontSize: '0.95rem' }}
              onClick={() => handleDeclineRouteOffer(routeOffer.id)}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* TRIP OFFER CARD */}
      {offer && !activeTrip && (
        <div className="glass-card pulsing" style={{
          border: '2px solid var(--primary)',
          boxShadow: '0 0 30px var(--primary-glow)',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge badge-green">Wave {offer.waveNo} Offer</span>
            <span style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '0.95rem' }}>
              ⏱ {Math.max(0, Math.ceil((offer.windowEndsAt - serverNow) / 1000))}s
            </span>
          </div>

          <h2 style={{ fontSize: '1.5rem', margin: '10px 0 4px' }}>
            {offer.totalMeals} Meals ({offer.stopCount} Pickups)
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '14px' }}>
            Deliver at Base by: {new Date(offer.deliverAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>

          {/* Stops with Safe Window Bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {offer.items.map((item, idx) => (
              <div key={item.id} style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '10px',
                borderRadius: '10px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                    {idx + 1}. {item.title}
                  </span>
                  {item.isUnverified && <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>Unverified</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>Safe slack: {item.slackMin} min</span>
                  <span style={{
                    color: item.slackColor === 'green' ? '#34d399' : item.slackColor === 'amber' ? '#fbbf24' : '#f87171',
                    fontWeight: 700
                  }}>
                    {item.slackColor.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Left Out list if any */}
          {offer.leftOut && offer.leftOut.length > 0 && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '10px',
              padding: '10px',
              marginBottom: '16px',
              fontSize: '0.82rem',
              color: '#f87171'
            }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Items left out:</div>
              {offer.leftOut.map((lo, i) => (
                <div key={i}>• {lo.text}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
            <button
              type="button"
              id="btn-accept-trip"
              className="btn-primary"
              onClick={() => handleAcceptTrip(offer.tripId)}
            >
              Accept Trip
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleDeclineTrip(offer.tripId)}
            >
              Not Now
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE TRIP VIEW */}
      {activeTrip && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="badge badge-green">In Progress</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Step {activeTrip.step + 1} of {activeTrip.stops.length + 1}
            </span>
          </div>

          {/* Next Action Focus Card */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius-md)',
            padding: '16px'
          }}>
            {!isAtDelivery ? (
              <>
                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Next Stop: Stop #{activeTrip.step + 1}
                </div>
                <h3 style={{ fontSize: '1.25rem', margin: '4px 0' }}>{nextStop.title}</h3>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                  Contributor: {nextStop.contributorName}
                </div>

                {/* Call & Confirmation for Unverified items */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {nextStop.contributorPhone && (
                    <a
                      href={`tel:${nextStop.contributorPhone}`}
                      className="btn-secondary"
                      style={{ flex: 1, textDecoration: 'none', fontSize: '0.88rem' }}
                    >
                      📞 Call Contributor
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAdvance(activeTrip.step, 'NOT_AVAILABLE')}
                    className="btn-secondary"
                    style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)', fontSize: '0.85rem' }}
                  >
                    Not Available
                  </button>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    id="btn-confirm-collected"
                    className="btn-primary"
                    disabled={advancing}
                    onClick={() => handleAdvance(activeTrip.step, 'COLLECTED')}
                  >
                    {advancing ? 'Updating...' : '✓ Confirm Food Collected'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', textTransform: 'uppercase', fontWeight: 700 }}>
                  Final Destination: NGO Base
                </div>
                <h3 style={{ fontSize: '1.3rem', margin: '6px 0' }}>Deliver All Meals ({activeTrip.totalMeals})</h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                  Arrived at base. Safe deadline met.
                </p>

                <button
                  type="button"
                  id="btn-complete-trip"
                  className="btn-primary"
                  disabled={advancing}
                  onClick={() => handleAdvance(activeTrip.step, 'COLLECTED')}
                >
                  {advancing ? 'Completing...' : '🏁 Confirm Trip Delivered & Done'}
                </button>
              </>
            )}
          </div>

          {/* Stops List */}
          <div>
            <div className="input-label">Trip Sequence</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {activeTrip.stops.map((s, idx) => (
                <div key={s.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: s.isCollected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)'
                }}>
                  <div style={{ fontSize: '0.88rem' }}>
                    <span style={{ fontWeight: 600 }}>{idx + 1}. {s.title}</span>
                  </div>
                  <span className={`badge ${s.isCollected ? 'badge-green' : 'badge-amber'}`}>
                    {s.isCollected ? 'Collected' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* IDLE HOME VIEW: BUILDING A TRIP PROGRESS */}
      {!activeTrip && !offer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>🍲 Building a Trip</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
              <span>Nearby food pool</span>
              <span>{ngoState?.poolProgress?.haveMeals || 0} / {ngoState?.poolProgress?.minMeals || 20} meals</span>
            </div>
            <div style={{ height: '10px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, ((ngoState?.poolProgress?.haveMeals || 0) / (ngoState?.poolProgress?.minMeals || 20)) * 100)}%`,
                background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)',
                borderRadius: '5px'
              }} />
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '8px' }}>
              Trips auto-dispatch in waves when cluster reaches 20 viable meals.
            </div>
          </div>

          {/* Today's impact stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="glass-card" style={{ textAlign: 'center', padding: '16px' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary)' }}>
                {ngoState?.stats?.todayMeals || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Meals Delivered Today
              </div>
            </div>

            <div className="glass-card" style={{ textAlign: 'center', padding: '16px' }}>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                {ngoState?.stats?.todayTrips || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Completed Trips
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowAgentModal(true)}
            style={{ width: '100%' }}
          >
            + Post on Behalf of Walk-In Contributor
          </button>
        </div>
      )}

      {/* WALK-IN AGENT POST MODAL */}
      {showAgentModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          zIndex: 9999
        }}>
          <div className="glass-card" style={{ maxWidth: '480px', width: '100%' }}>
            <h3>Post Surplus for Walk-in Shop</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.target);
              await fetch('/api/ngo/post-for-shop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  shopName: fd.get('shopName'),
                  meals: Number(fd.get('meals')),
                  diet: fd.get('diet'),
                  form: fd.get('form'),
                  hours: Number(fd.get('hours')),
                  lat: 12.9716,
                  lng: 77.5946
                })
              });
              setShowAgentModal(false);
              fetchState();
            }}>
              <input name="shopName" placeholder="Shop Name" className="input-field" style={{ margin: '8px 0' }} required />
              <input name="meals" type="number" placeholder="Meals" className="input-field" style={{ margin: '8px 0' }} required />
              <select name="diet" className="input-field" style={{ margin: '8px 0' }}>
                <option value="veg">Veg</option>
                <option value="nonveg">Non-Veg</option>
              </select>
              <select name="form" className="input-field" style={{ margin: '8px 0' }}>
                <option value="cooked">Cooked</option>
                <option value="packed">Packed</option>
              </select>
              <input name="hours" type="number" defaultValue="3" placeholder="Safe Hours" className="input-field" style={{ margin: '8px 0' }} />

              <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Submit</button>
                <button type="button" onClick={() => setShowAgentModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(9, 13, 22, 0.95)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '10px 0',
        zIndex: 1000
      }}>
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          style={{ background: 'none', border: 'none', color: activeTab === 'home' ? 'var(--primary)' : 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
        >
          🚨 Trips
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('history'); fetchHistory(); }}
          style={{ background: 'none', border: 'none', color: activeTab === 'history' ? 'var(--primary)' : 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
        >
          📜 History
        </button>
        <button
          type="button"
          onClick={() => { localStorage.clear(); navigate('/login'); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          🚪 Logout
        </button>
      </div>
    </div>
  );
}
