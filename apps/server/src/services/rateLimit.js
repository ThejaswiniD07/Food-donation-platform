export function checkRateLimits({ db, clock, ip, deviceId, phone, shopToken, config }) {
  const now = clock.now();
  const oneHourAgo = now - 3600 * 1000;
  const oneDayAgo = now - 24 * 3600 * 1000;

  // 1. IP rate limit
  if (ip) {
    const ipKey = `ip:${ip}`;
    const row = db.prepare('SELECT COUNT(*) as count, MIN(ts) as oldest FROM rate_events WHERE key = ? AND ts >= ?').get(ipKey, oneHourAgo);
    const limit = Number(config.RL_IP_PER_HOUR ?? 30);
    if (row && row.count >= limit) {
      const waitSec = Math.max(1, Math.ceil((row.oldest + 3600 * 1000 - now) / 1000));
      return { allowed: false, message: `IP rate limit exceeded. Please wait ${waitSec} seconds.`, retryAfterSec: waitSec };
    }
  }

  // 2. Device rate limit
  if (deviceId) {
    const devKey = `dev:${deviceId}`;
    const row = db.prepare('SELECT COUNT(*) as count, MIN(ts) as oldest FROM rate_events WHERE key = ? AND ts >= ?').get(devKey, oneHourAgo);
    const limit = Number(config.RL_DEVICE_PER_HOUR ?? 10);
    if (row && row.count >= limit) {
      const waitSec = Math.max(1, Math.ceil((row.oldest + 3600 * 1000 - now) / 1000));
      return { allowed: false, message: `Device rate limit exceeded. Please wait ${waitSec} seconds.`, retryAfterSec: waitSec };
    }
  }

  // 3. Shop link rate limit
  if (shopToken) {
    const shopKey = `shop:${shopToken}`;
    const row = db.prepare('SELECT COUNT(*) as count, MIN(ts) as oldest FROM rate_events WHERE key = ? AND ts >= ?').get(shopKey, oneDayAgo);
    const limit = Number(config.RL_SHOP_PER_DAY ?? 20);
    if (row && row.count >= limit) {
      const waitSec = Math.max(1, Math.ceil((row.oldest + 24 * 3600 * 1000 - now) / 1000));
      return { allowed: false, message: `Shop daily limit exceeded. Please wait ${waitSec} seconds.`, retryAfterSec: waitSec };
    }
  }

  // 4. Phone active items limit
  if (phone) {
    const activeRow = db.prepare(`
      SELECT COUNT(*) as count FROM items i
      JOIN contributors c ON i.contributor_id = c.id
      WHERE c.phone = ? AND i.status IN ('POOLED', 'IN_TRIP')
    `).get(phone);
    const limit = Number(config.RL_PHONE_ACTIVE ?? 5);
    if (activeRow && activeRow.count >= limit) {
      return { allowed: false, message: `Maximum active items (${limit}) reached for this phone number.`, retryAfterSec: 60 };
    }
  }

  return { allowed: true };
}

export function recordRateLimitEvents({ db, clock, ip, deviceId, shopToken }) {
  const now = clock.now();
  const insert = db.prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)');
  const trans = db.transaction(() => {
    if (ip) insert.run(`ip:${ip}`, now);
    if (deviceId) insert.run(`dev:${deviceId}`, now);
    if (shopToken) insert.run(`shop:${shopToken}`, now);
  });
  trans();
}
