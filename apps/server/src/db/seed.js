import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDb } from './index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function seedDatabase(db, customCenter = null) {
  const centerLat = Number(customCenter?.lat ?? process.env.SEED_CENTER_LAT ?? 12.9716);
  const centerLng = Number(customCenter?.lng ?? process.env.SEED_CENTER_LNG ?? 77.5946);

  const hashAdmin = bcrypt.hashSync('admin123', 8);
  const hashNgo = bcrypt.hashSync('ngo123', 8);
  const hashProvider = bcrypt.hashSync('provider123', 8);

  const now = Date.now();

  const insertUser = db.prepare(`
    INSERT INTO users (id, role, name, phone, password_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      password_hash = excluded.password_hash,
      name = excluded.name,
      role = excluded.role
  `);

  const insertNgo = db.prepare(`
    INSERT INTO ngos (
      user_id, org_name, base_lat, base_lng,
      accepts_veg, accepts_nonveg, accepts_cooked, accepts_packed,
      online, lat, lng, last_gps_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      org_name = excluded.org_name,
      base_lat = excluded.base_lat,
      base_lng = excluded.base_lng,
      accepts_veg = excluded.accepts_veg,
      accepts_nonveg = excluded.accepts_nonveg,
      accepts_cooked = excluded.accepts_cooked,
      accepts_packed = excluded.accepts_packed
  `);

  const insertContributor = db.prepare(`
    INSERT INTO contributors (
      id, user_id, name, phone, address, landmark, lat, lng,
      shop_token, trust, strikes, delivered_count, created_via, created_at, defaults_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'QR', ?, ?)
    ON CONFLICT(shop_token) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      phone = excluded.phone,
      address = excluded.address,
      landmark = excluded.landmark,
      lat = excluded.lat,
      lng = excluded.lng,
      trust = excluded.trust
  `);

  const seedTx = db.transaction(() => {
    // 0. Reset operational tables for clean test/demo state
    db.prepare('DELETE FROM route_offers').run();
    db.prepare('DELETE FROM trip_items').run();
    db.prepare('DELETE FROM trip_notified').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM trips').run();
    db.prepare('DELETE FROM rate_events').run();

    // 1. Admin
    const adminId = 'user_admin_1';
    insertUser.run(adminId, 'admin', 'Super Admin', '9000000000', hashAdmin);

    // 2. NGOs
    const ngosData = [
      {
        id: 'user_ngo_1',
        phone: '9100000001',
        orgName: 'Hope Kitchen',
        offsetLat: 0.012, // ~1.3 km
        offsetLng: 0.005,
        veg: 1, nonveg: 1, cooked: 1, packed: 1
      },
      {
        id: 'user_ngo_2',
        phone: '9100000002',
        orgName: 'City Care Foundation',
        offsetLat: -0.015, // ~2.2 km
        offsetLng: 0.018,
        veg: 1, nonveg: 1, cooked: 1, packed: 1
      },
      {
        id: 'user_ngo_3',
        phone: '9100000003',
        orgName: 'Feed Bangalore',
        offsetLat: 0.035, // ~4.5 km
        offsetLng: -0.020,
        veg: 1, nonveg: 1, cooked: 1, packed: 1
      },
      {
        id: 'user_ngo_4',
        phone: '9100000004',
        orgName: 'Pure Veg Seva',
        offsetLat: -0.020, // ~2.5 km
        offsetLng: -0.008,
        veg: 1, nonveg: 0, cooked: 1, packed: 1 // VEG ONLY!
      }
    ];

    for (const ngo of ngosData) {
      insertUser.run(ngo.id, 'ngo', ngo.orgName, ngo.phone, hashNgo);
      insertNgo.run(
        ngo.id,
        ngo.orgName,
        centerLat + ngo.offsetLat,
        centerLng + ngo.offsetLng,
        ngo.veg,
        ngo.nonveg,
        ngo.cooked,
        ngo.packed,
        centerLat + ngo.offsetLat,
        centerLng + ngo.offsetLng
      );
    }

    // 3. Provider Account
    const providerId = 'user_provider_1';
    insertUser.run(providerId, 'provider', 'Green Leaf Manager', '9000000001', hashProvider);

    // 4. Shops
    const shopsData = [
      {
        id: 'contrib_greenleaf',
        userId: providerId,
        name: 'Green Leaf Restaurant',
        phone: '9200000001',
        address: '12 Brigade Road, Central Bangalore',
        landmark: 'Opposite Metro Station',
        offsetLat: 0.003,
        offsetLng: 0.004,
        shopToken: 'shop_greenleaf',
        trust: 'VERIFIED',
        defaults: JSON.stringify({ meals: 25, diet: 'veg', form: 'cooked', hours: 3 })
      },
      {
        id: 'contrib_sunrise',
        userId: null,
        name: 'Sunrise Bakery',
        phone: '9200000002',
        address: '45 Commercial Street',
        landmark: 'Near Clock Tower',
        offsetLat: 0.008,
        offsetLng: -0.003,
        shopToken: 'shop_sunrise',
        trust: 'VERIFIED',
        defaults: JSON.stringify({ meals: 15, diet: 'veg', form: 'packed', hours: 12 })
      },
      {
        id: 'contrib_royal',
        userId: null,
        name: 'Royal Banquet Hall',
        phone: '9200000003',
        address: '88 MG Road',
        landmark: 'Next to Trinity Circle',
        offsetLat: -0.005,
        offsetLng: 0.010,
        shopToken: 'shop_royal',
        trust: 'VERIFIED',
        defaults: JSON.stringify({ meals: 40, diet: 'nonveg', form: 'cooked', hours: 4 })
      },
      {
        id: 'contrib_corner',
        userId: null,
        name: 'Corner Tea Stall',
        phone: '9200000004',
        address: '22 Residency Road',
        landmark: 'Near Bus Stop',
        offsetLat: 0.001,
        offsetLng: 0.002,
        shopToken: 'shop_corner',
        trust: 'UNVERIFIED',
        defaults: JSON.stringify({ meals: 10, diet: 'veg', form: 'cooked', hours: 2 })
      }
    ];

    for (const shop of shopsData) {
      insertContributor.run(
        shop.id,
        shop.userId,
        shop.name,
        shop.phone,
        shop.address,
        shop.landmark,
        centerLat + shop.offsetLat,
        centerLng + shop.offsetLng,
        shop.shopToken,
        shop.trust,
        now,
        shop.defaults
      );
    }
  });

  seedTx();
  console.log('Database successfully seeded with Admin, NGOs, Provider, and Shops.');
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../../data/app.db');
  const db = createDb(dbPath);
  seedDatabase(db);
  process.exit(0);
}
