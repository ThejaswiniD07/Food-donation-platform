export const DEFAULT_CONFIG = {
  MIN_TRIP_MEALS: 20,
  SAFETY_MARGIN_MIN: 10,
  PICKUP_DWELL_MIN: 5,
  AVG_SPEED_KMH: 20,
  ROAD_FACTOR: 1.3,
  CLUSTER_RADIUS_KM: 3,
  MAX_STOPS: 4,
  MAX_CANDIDATES: 8,
  GPS_FRESH_SEC: 180,
  DETOUR_LIMIT_KM: 1,
  ROUTE_OFFER_SEC: 30,
  RETRY_COOLDOWN_SEC: 120,
  SERVICE_AREA_RADIUS_KM: 50,
  RL_DEVICE_PER_HOUR: 10,
  RL_IP_PER_HOUR: 30,
  RL_PHONE_ACTIVE: 5,
  RL_SHOP_PER_DAY: 20,
  STRIKES_TO_BLOCK: 3,
  DEFAULT_COUNTRY_CODE: '+91',
  QUICK_HOURS: '2,3,6,12',
  SEED_CENTER_LAT: 12.9716,
  SEED_CENTER_LNG: 77.5946
};

export const DEFAULT_WAVES = [
  { waveNo: 1, radiusKm: 2, windowSec: 60, urgentSec: 30 },
  { waveNo: 2, radiusKm: 4, windowSec: 60, urgentSec: 30 },
  { waveNo: 3, radiusKm: 7, windowSec: 60, urgentSec: 30 },
  { waveNo: 4, radiusKm: 10, windowSec: 90, urgentSec: 45 }
];
