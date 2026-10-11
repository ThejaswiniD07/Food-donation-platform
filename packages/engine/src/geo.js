export function haversine(a, b) {
  const R = 6371; // Earth's radius in km
  const lat1 = (Number(a.lat) * Math.PI) / 180;
  const lat2 = (Number(b.lat) * Math.PI) / 180;
  const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180;
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180;

  const sinDlat2 = Math.sin(dLat / 2);
  const sinDlng2 = Math.sin(dLng / 2);
  const h = sinDlat2 * sinDlat2 + Math.cos(lat1) * Math.cos(lat2) * sinDlng2 * sinDlng2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export function distKm(a, b, roadFactor = 1.3) {
  return haversine(a, b) * roadFactor;
}

export function etaMin(km, avgSpeedKmh = 20) {
  return Math.round((km / avgSpeedKmh) * 60);
}

export function urgency(minLeft) {
  if (minLeft < 90) return 'URGENT';
  if (minLeft < 240) return 'NORMAL';
  return 'LOW';
}

/**
 * Computes the minimum extra distance (in km) to insert an item into an existing route.
 * route is an array of points: [start, ...stops, receiver]
 */
export function cheapestInsertionDetour(route, item, roadFactor = 1.3) {
  if (!route || route.length < 2) return 0;
  let minDetour = Infinity;
  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1];
    const next = route[i];
    const direct = distKm(prev, next, roadFactor);
    const withItem = distKm(prev, item, roadFactor) + distKm(item, next, roadFactor);
    const detour = withItem - direct;
    if (detour < minDetour) {
      minDetour = detour;
    }
  }
  return Math.round(minDetour * 100) / 100;
}
