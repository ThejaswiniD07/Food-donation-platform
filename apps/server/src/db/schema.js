export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('provider', 'ngo', 'admin')),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributors (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  address TEXT,
  landmark TEXT,
  lat REAL,
  lng REAL,
  shop_token TEXT UNIQUE,
  trust TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(trust IN ('UNVERIFIED', 'VERIFIED', 'BLOCKED')),
  strikes INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  created_via TEXT NOT NULL DEFAULT 'QUICK' CHECK(created_via IN ('QUICK', 'QR', 'ADMIN', 'ACCOUNT')),
  device_id TEXT,
  created_at INTEGER NOT NULL,
  defaults_json TEXT
);

CREATE TABLE IF NOT EXISTS ngos (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_name TEXT NOT NULL,
  base_lat REAL NOT NULL,
  base_lng REAL NOT NULL,
  accepts_veg INTEGER NOT NULL DEFAULT 1,
  accepts_nonveg INTEGER NOT NULL DEFAULT 1,
  accepts_cooked INTEGER NOT NULL DEFAULT 1,
  accepts_packed INTEGER NOT NULL DEFAULT 1,
  online INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  last_gps_at INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('OFFERED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'WITHDRAWN', 'UNASSIGNED', 'CANCELLED')),
  ngo_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reference_ngo_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  receiver_lat REAL NOT NULL,
  receiver_lng REAL NOT NULL,
  total_meals INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  left_out_json TEXT,
  deliver_at INTEGER NOT NULL,
  wave_no INTEGER NOT NULL DEFAULT 1,
  wave_ends_at INTEGER NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  assigned_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('QUICK_LINK', 'SHOP_QR', 'ACCOUNT', 'AGENT', 'INBOUND')),
  title TEXT NOT NULL,
  meals INTEGER NOT NULL,
  diet TEXT NOT NULL CHECK(diet IN ('veg', 'nonveg')),
  form TEXT NOT NULL CHECK(form IN ('cooked', 'packed')),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  track_token TEXT UNIQUE NOT NULL,
  client_request_id TEXT UNIQUE,
  post_ms INTEGER,
  trust_at_post TEXT NOT NULL CHECK(trust_at_post IN ('UNVERIFIED', 'VERIFIED', 'BLOCKED')),
  status TEXT NOT NULL CHECK(status IN ('POOLED', 'IN_TRIP', 'COLLECTED', 'DELIVERED', 'LEFT_OUT', 'EXPIRED', 'CANCELLED')),
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  retry_at INTEGER,
  note_code TEXT,
  note_text TEXT,
  note_json TEXT,
  final_reason_code TEXT,
  final_reason_text TEXT
);

CREATE TABLE IF NOT EXISTS trip_items (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  collected_at INTEGER,
  PRIMARY KEY (trip_id, item_id)
);

CREATE TABLE IF NOT EXISTS trip_notified (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ngo_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wave_no INTEGER NOT NULL,
  notified_at INTEGER NOT NULL,
  window_ends_at INTEGER NOT NULL,
  response TEXT NOT NULL CHECK(response IN ('PENDING', 'DECLINED', 'TIMEOUT', 'TAKEN', 'ACCEPTED')),
  PRIMARY KEY (trip_id, ngo_id)
);

CREATE TABLE IF NOT EXISTS route_offers (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  ngo_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detour_km REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  ends_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_events (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  from_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  parsed_json TEXT,
  result TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  text TEXT NOT NULL,
  json TEXT
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trip_notified ON trip_notified(trip_id, ngo_id);
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(key, ts);
CREATE INDEX IF NOT EXISTS idx_contributors_phone ON contributors(phone);
`;
