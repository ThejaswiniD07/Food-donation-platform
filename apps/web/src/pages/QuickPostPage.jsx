import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { parseQuickMessage } from '@food-rescue/engine';
import { getTranslation } from '../utils/i18n.js';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';

// Lazy-load MapPicker so Leaflet is never bundled in initial /post chunk!
const LazyMapPicker = lazy(() => import('../components/MapPicker.jsx'));

export default function QuickPostPage() {
  const { shopToken } = useParams();
  const navigate = useNavigate();

  const [lang, setLang] = useState(() => localStorage.getItem('food_rescue_lang') || 'en');
  const t = (key, params) => getTranslation(lang, key, params);

  // Time-to-post measurement
  const loadTimeRef = useRef(Date.now());

  // Shop state (if /s/:shopToken)
  const [shop, setShop] = useState(null);
  const [loadingShop, setLoadingShop] = useState(!!shopToken);

  // Form states
  const [smartText, setSmartText] = useState('');
  const [meals, setMeals] = useState(20);
  const [customMeals, setCustomMeals] = useState('');
  const [showCustomMeals, setShowCustomMeals] = useState(false);
  const [diet, setDiet] = useState('veg');
  const [form, setForm] = useState('cooked');
  const [readyDuration, setReadyDuration] = useState({ value: 3, unit: 'h' }); // 3 hours default for cooked

  // Location (default to Bangalore center, refined by geolocation)
  const [coords, setCoords] = useState({ lat: 12.9716, lng: 77.5946 });
  const [accuracy, setAccuracy] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [showMapPicker, setShowMapPicker] = useState(false);

  // Contact details (remembered in browser)
  const [phone, setPhone] = useState(() => localStorage.getItem('food_rescue_phone') || '');
  const [shopName, setShopName] = useState(() => localStorage.getItem('food_rescue_shop_name') || '');

  // Submission & Post Status
  const [submitting, setSubmitting] = useState(false);
  const [postedResult, setPostedResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [offlineNotice, setOfflineNotice] = useState(false);

  // Honeypot for bot protection
  const [hp, setHp] = useState('');

  // Change language and persist
  const changeLang = (newLang) => {
    setLang(newLang);
    localStorage.setItem('food_rescue_lang', newLang);
  };

  // Load shop if shopToken exists
  useEffect(() => {
    if (shopToken) {
      fetch(`/api/public/shop/${shopToken}`)
        .then((res) => {
          if (!res.ok) throw new Error('Shop not found');
          return res.json();
        })
        .then((data) => {
          setShop(data.shop);
          if (data.shop.lat && data.shop.lng) {
            setCoords({ lat: data.shop.lat, lng: data.shop.lng });
          }
          if (data.shop.defaults) {
            if (data.shop.defaults.meals) setMeals(data.shop.defaults.meals);
            if (data.shop.defaults.diet) setDiet(data.shop.defaults.diet);
            if (data.shop.defaults.form) setForm(data.shop.defaults.form);
            if (data.shop.defaults.hours) setReadyDuration({ value: data.shop.defaults.hours, unit: 'h' });
          }
        })
        .catch((err) => {
          setErrorMsg(err.message);
        })
        .finally(() => {
          setLoadingShop(false);
        });
    } else {
      // Auto-attempt geolocation once on load if not a shop link
      attemptGeolocation();
    }
  }, [shopToken]);

  // Offline retry handling
  useEffect(() => {
    const handleOnline = () => {
      const draft = localStorage.getItem('food_rescue_draft');
      if (draft) {
        setOfflineNotice(false);
        try {
          const parsedDraft = JSON.parse(draft);
          handleSubmit(null, parsedDraft);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const attemptGeolocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
        // Fallback to Bangalore seed center
        setCoords({ lat: 12.9716, lng: 77.5946 });
        setLocating(false);
        setLocationError('Using default city center. Tap map to adjust.');
      },
      { timeout: 7000, enableHighAccuracy: true }
    );
  };

  // Smart one-line input handler
  const handleSmartInputChange = (e) => {
    const text = e.target.value;
    setSmartText(text);

    if (text.trim().length > 2) {
      const parsed = parseQuickMessage(text);
      if (parsed.ok) {
        setMeals(parsed.meals);
        setShowCustomMeals(false);
        setDiet(parsed.diet);
        setForm(parsed.form);
        if (parsed.minutes >= 60) {
          setReadyDuration({ value: Math.round(parsed.minutes / 60), unit: 'h' });
        } else {
          setReadyDuration({ value: parsed.minutes, unit: 'm' });
        }
      }
    }
  };

  // Validate form
  const activeMeals = showCustomMeals ? parseInt(customMeals, 10) : meals;
  const isShopLink = !!shopToken;
  const hasPhone = isShopLink || phone.trim().length >= 10;
  const hasLocation = !!coords;
  const isValid = activeMeals > 0 && activeMeals <= 2000 && hasLocation && hasPhone;

  let missingReason = '';
  if (!activeMeals || activeMeals <= 0) missingReason = 'Select meal count';
  else if (!hasLocation) missingReason = 'Location required';
  else if (!hasPhone) missingReason = '10-digit phone required';

  const handleSubmit = async (e, draftData = null) => {
    if (e) e.preventDefault();
    if (!isValid && !draftData) return;

    setSubmitting(true);
    setErrorMsg('');

    const clientMs = Math.max(850, Date.now() - loadTimeRef.current);
    const clientRequestId = 'req_' + Math.random().toString(36).substring(2) + Date.now();

    // Persist details locally for returning contributor
    if (phone) localStorage.setItem('food_rescue_phone', phone);
    if (shopName) localStorage.setItem('food_rescue_shop_name', shopName);

    const postPayload = draftData || {
      meals: activeMeals,
      diet,
      form,
      hours: readyDuration.unit === 'h' ? readyDuration.value : null,
      minutes: readyDuration.unit === 'm' ? readyDuration.value : null,
      lat: coords?.lat ?? 12.9716,
      lng: coords?.lng ?? 77.5946,
      phone: phone || null,
      name: shopName || null,
      shopToken: shopToken || null,
      clientRequestId,
      clientMs,
      hp: hp || null
    };

    if (!navigator.onLine) {
      localStorage.setItem('food_rescue_draft', JSON.stringify(postPayload));
      setOfflineNotice(true);
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/public/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postPayload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to post food');
      }

      localStorage.removeItem('food_rescue_draft');
      setPostedResult(data);
    } catch (err) {
      if (!navigator.onLine || err.message.includes('fetch')) {
        localStorage.setItem('food_rescue_draft', JSON.stringify(postPayload));
        setOfflineNotice(true);
      } else {
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingShop) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading shop details...</div>
      </div>
    );
  }

  // POSTED SUCCESS STATE
  if (postedResult) {
    return (
      <div className="app-container">
        <div className="glass-card" style={{ textAlign: 'center', padding: '28px 16px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.2)',
            border: '2px solid var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '2rem'
          }}>
            ✓
          </div>

          <h2 style={{ fontSize: '1.6rem', marginBottom: '8px' }}>{t('postedSuccess')}</h2>

          <div style={{
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            margin: '18px 0',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Status
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--primary)' }}>
              {postedResult.noteText || 'Waiting for nearby pickups...'}
            </div>

            {postedResult.haveMeals !== undefined && postedResult.minMeals !== undefined && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Cluster meals: {postedResult.haveMeals} / {postedResult.minMeals}</span>
                  <span>{Math.min(100, Math.round((postedResult.haveMeals / postedResult.minMeals) * 100))}%</span>
                </div>
                <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (postedResult.haveMeals / postedResult.minMeals) * 100)}%`,
                    background: 'var(--primary)',
                    borderRadius: '4px'
                  }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
            <button
              type="button"
              id="btn-track-status"
              className="btn-primary"
              onClick={() => navigate(`/track/${postedResult.trackToken}`)}
            >
              <span>📍 View Live Tracking</span>
            </button>

            {postedResult.shareText && (
              <a
                id="btn-share-whatsapp"
                href={`https://wa.me/?text=${encodeURIComponent(postedResult.shareText)}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
                style={{ background: 'rgba(37, 211, 102, 0.15)', color: '#25D366', borderColor: 'rgba(37, 211, 102, 0.3)' }}
              >
                <span>📲 {t('shareNeighbors')}</span>
              </a>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPostedResult(null);
                setSmartText('');
                loadTimeRef.current = Date.now();
              }}
            >
              <span>+ {t('postAnother')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ACTIVE POST FORM
  return (
    <div className="app-container" style={{ paddingBottom: '32px' }}>
      {/* Header bar with Language Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/icon.svg" alt="logo" style={{ width: '28px', height: '28px' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.1rem' }}>
            {shop ? shop.name : t('appTitle')}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '20px', padding: '2px' }}>
          <button
            type="button"
            onClick={() => changeLang('en')}
            style={{
              background: lang === 'en' ? 'var(--primary)' : 'transparent',
              color: lang === 'en' ? '#000' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '16px',
              padding: '3px 9px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => changeLang('hi')}
            style={{
              background: lang === 'hi' ? 'var(--primary)' : 'transparent',
              color: lang === 'hi' ? '#000' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '16px',
              padding: '3px 9px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            HI
          </button>
        </div>
      </div>

      {offlineNotice && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.15)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '12px',
          padding: '12px',
          color: '#fbbf24',
          fontSize: '0.88rem',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>📶</span>
          <span>{t('offlineDraftSaved')}</span>
        </div>
      )}

      {errorMsg && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '12px',
          padding: '12px',
          color: '#f87171',
          fontSize: '0.88rem',
          marginBottom: '12px'
        }}>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Honeypot field (hidden) */}
        <input
          type="text"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          style={{ display: 'none' }}
          tabIndex={-1}
          autoComplete="off"
        />

        {/* 1. Smart One-line Input */}
        <div>
          <label className="input-label" htmlFor="smart-input">{t('smartInputLabel')}</label>
          <input
            id="smart-input"
            type="text"
            className="input-field"
            placeholder={t('oneLinePlaceholder')}
            value={smartText}
            onChange={handleSmartInputChange}
            autoComplete="off"
          />
        </div>

        {/* 2. Meals Chips */}
        <div>
          <label className="input-label">{t('mealsCount')}</label>
          <div className="chip-group">
            {[10, 20, 30, 50].map((num) => (
              <button
                type="button"
                key={num}
                className={`chip ${!showCustomMeals && meals === num ? 'active' : ''}`}
                onClick={() => {
                  setMeals(num);
                  setShowCustomMeals(false);
                }}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${showCustomMeals ? 'active' : ''}`}
              onClick={() => setShowCustomMeals(true)}
            >
              {t('other')}
            </button>
          </div>

          {showCustomMeals && (
            <div style={{ marginTop: '8px' }}>
              <input
                id="input-custom-meals"
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                className="input-field"
                placeholder="Enter meal quantity (e.g. 75)"
                value={customMeals}
                onChange={(e) => setCustomMeals(e.target.value)}
                autoFocus
              />
            </div>
          )}
        </div>

        {/* 3. Veg / Non-veg & Cooked / Packed toggles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label className="input-label">Diet</label>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-option ${diet === 'veg' ? 'active' : ''}`}
                onClick={() => setDiet('veg')}
              >
                {t('dietVeg')}
              </button>
              <button
                type="button"
                className={`segmented-option ${diet === 'nonveg' ? 'active' : ''}`}
                onClick={() => setDiet('nonveg')}
              >
                {t('dietNonVeg')}
              </button>
            </div>
          </div>

          <div>
            <label className="input-label">Form</label>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-option ${form === 'cooked' ? 'active' : ''}`}
                onClick={() => {
                  setForm('cooked');
                  if (readyDuration.value === 12) setReadyDuration({ value: 3, unit: 'h' });
                }}
              >
                {t('formCooked')}
              </button>
              <button
                type="button"
                className={`segmented-option ${form === 'packed' ? 'active' : ''}`}
                onClick={() => {
                  setForm('packed');
                  if (readyDuration.value === 3) setReadyDuration({ value: 12, unit: 'h' });
                }}
              >
                {t('formPacked')}
              </button>
            </div>
          </div>
        </div>

        {/* 4. Ready For Chips */}
        <div>
          <label className="input-label">{t('readyFor')}</label>
          <div className="chip-group">
            {[
              { val: 30, unit: 'm', label: '30m' },
              { val: 2, unit: 'h', label: `2${t('hoursSuffix')}` },
              { val: 3, unit: 'h', label: `3${t('hoursSuffix')}` },
              { val: 6, unit: 'h', label: `6${t('hoursSuffix')}` },
              { val: 12, unit: 'h', label: `12${t('hoursSuffix')}` }
            ].map((d) => (
              <button
                type="button"
                key={d.label}
                className={`chip ${readyDuration.value === d.val && readyDuration.unit === d.unit ? 'active' : ''}`}
                onClick={() => setReadyDuration({ value: d.val, unit: d.unit })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* 5. Location Row (hidden if shopToken already has location) */}
        {!shop && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="input-label" style={{ marginBottom: 0 }}>{t('location')}</label>
              <button
                type="button"
                onClick={() => setShowMapPicker(!showMapPicker)}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.82rem', cursor: 'pointer' }}
              >
                {showMapPicker ? 'Hide map' : t('changeLocation')}
              </button>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              marginTop: '6px'
            }}>
              <div style={{ fontSize: '0.88rem' }}>
                {locating ? (
                  <span style={{ color: 'var(--accent-cyan)' }}>{t('locating')}</span>
                ) : coords ? (
                  <span>
                    📍 Location detected {accuracy ? `(${t('locationAccurate', { acc: accuracy })})` : ''}
                  </span>
                ) : (
                  <span style={{ color: 'var(--accent-red)' }}>{locationError || 'No location set'}</span>
                )}
              </div>

              <button
                type="button"
                onClick={attemptGeolocation}
                disabled={locating}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                {t('useMyLocation')}
              </button>
            </div>

            {showMapPicker && (
              <ErrorBoundary fallbackText="Map picker unavailable. Using auto-detected GPS coordinates.">
                <Suspense fallback={<div style={{ padding: '16px', color: 'var(--text-muted)' }}>Loading map...</div>}>
                  <LazyMapPicker
                    lat={coords?.lat}
                    lng={coords?.lng}
                    onSelectLocation={(pickedLat, pickedLng) => {
                      setCoords({ lat: pickedLat, lng: pickedLng });
                      setAccuracy(null);
                    }}
                    onClose={() => setShowMapPicker(false)}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        )}

        {/* 6. First-time Contact Details (Hidden for Shop Links) */}
        {!shop && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            <div>
              <label className="input-label" htmlFor="input-phone">{t('phoneLabel')}</label>
              <input
                id="input-phone"
                type="tel"
                inputMode="numeric"
                className="input-field"
                placeholder={t('phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>

            <div>
              <label className="input-label" htmlFor="input-shop-name">{t('shopNameLabel')}</label>
              <input
                id="input-shop-name"
                type="text"
                className="input-field"
                placeholder="e.g. Anand Sweets"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                autoComplete="organization"
              />
            </div>
          </div>
        )}

        {/* 7. Big Post Button (at least 54px high) */}
        <div style={{ marginTop: '8px' }}>
          <button
            type="submit"
            id="btn-post-food"
            className="btn-primary"
            disabled={!isValid || submitting}
          >
            {submitting ? 'Posting...' : isValid ? t('postButton') : `Incomplete: ${missingReason}`}
          </button>
        </div>
      </form>
    </div>
  );
}
