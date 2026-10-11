import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function MapPicker({ lat, lng, onSelectLocation, onClose }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialLat = lat || 12.9716;
    const initialLng = lng || 77.5946;

    const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], 14);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Custom DivIcon pin - NO DEFAULT LEAFLET IMAGES!
    const customPin = L.divIcon({
      className: 'custom-map-pin',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          background: #10b981;
          border: 3px solid #ffffff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="width: 10px; height: 10px; background: #ffffff; border-radius: 50%; transform: rotate(45deg);"></div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });

    const marker = L.marker([initialLat, initialLng], {
      icon: customPin,
      draggable: true
    }).addTo(map);
    markerRef.current = marker;

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      if (onSelectLocation) {
        onSelectLocation(pos.lat, pos.lng);
      }
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      if (onSelectLocation) {
        onSelectLocation(e.latlng.lat, e.latlng.lng);
      }
    });

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div style={{
      position: 'relative',
      borderRadius: '16px',
      overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      marginTop: '12px'
    }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '240px' }} />
      <div style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        zIndex: 1000
      }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        background: 'rgba(0,0,0,0.8)',
        color: '#f8fafc',
        padding: '4px 10px',
        borderRadius: '8px',
        fontSize: '0.78rem',
        zIndex: 1000
      }}>
        Tap or drag marker to set exact location
      </div>
    </div>
  );
}
