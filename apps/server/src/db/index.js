import Database from 'better-sqlite3';
import webPush from 'web-push';
import { SCHEMA_SQL } from './schema.js';
import { DEFAULT_CONFIG } from '@food-rescue/engine';
import fs from 'fs';
import path from 'path';

export function createDb(dbPath = ':memory:') {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // Execute schema
  db.exec(SCHEMA_SQL);

  // Initialize config table with defaults
  const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
    insertConfig.run(k, String(v));
  }

  // Initialize VAPID keys if not present
  const getVapid = db.prepare('SELECT value FROM config WHERE key = ?');
  const pubRow = getVapid.get('VAPID_PUBLIC_KEY');
  const privRow = getVapid.get('VAPID_PRIVATE_KEY');

  if (!pubRow || !privRow) {
    const vapidKeys = webPush.generateVAPIDKeys();
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('VAPID_PUBLIC_KEY', vapidKeys.publicKey);
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('VAPID_PRIVATE_KEY', vapidKeys.privateKey);
  }

  return db;
}

export function getConfig(db) {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const cfg = { ...DEFAULT_CONFIG };
  const STRING_KEYS = new Set(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'DEFAULT_COUNTRY_CODE', 'QUICK_HOURS']);
  for (const r of rows) {
    if (STRING_KEYS.has(r.key)) {
      cfg[r.key] = String(r.value);
    } else {
      const num = Number(r.value);
      cfg[r.key] = isNaN(num) ? r.value : num;
    }
  }
  return cfg;
}

export function setConfig(db, updates) {
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  const trans = db.transaction((entries) => {
    for (const [k, v] of entries) {
      stmt.run(k, String(v));
    }
  });
  trans(Object.entries(updates));
  return getConfig(db);
}
