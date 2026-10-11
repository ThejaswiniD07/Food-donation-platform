import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getConfig, setConfig } from '../db/index.js';

export function createAdminRouter({ db, clock, jwtSecret, wsManager }) {
  const router = Router();

  router.use(authenticate(jwtSecret));
  router.use(requireRole('admin'));

  // GET /api/admin/overview
  router.get('/overview', (req, res) => {
    const pooledItems = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(meals), 0) as meals FROM items WHERE status = 'POOLED'").get();
    const activeTrips = db.prepare("SELECT COUNT(*) as count FROM trips WHERE status IN ('OFFERED', 'ASSIGNED', 'IN_PROGRESS')").get();
    const completedTrips = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_meals), 0) as meals FROM trips WHERE status = 'COMPLETED'").get();
    const onlineNgos = db.prepare('SELECT COUNT(*) as count FROM ngos WHERE online = 1').get();
    const unresolvedAlerts = db.prepare("SELECT COUNT(*) as count FROM events WHERE kind LIKE 'ALERT_%'").get();

    // Time-to-post metrics
    const posts = db.prepare('SELECT post_ms FROM items WHERE post_ms IS NOT NULL AND post_ms > 0 ORDER BY post_ms ASC').all();
    let median = 0;
    let p90 = 0;
    let pctUnder30s = 100;

    if (posts.length > 0) {
      const times = posts.map((p) => p.post_ms);
      const mid = Math.floor(times.length / 2);
      median = times.length % 2 === 0 ? Math.round((times[mid - 1] + times[mid]) / 2) : times[mid];
      const p90Index = Math.min(times.length - 1, Math.floor(times.length * 0.9));
      p90 = times[p90Index];
      const under30sCount = times.filter((t) => t <= 30000).length;
      pctUnder30s = Math.round((under30sCount / times.length) * 100);
    }

    res.json({
      metrics: {
        pooledItemsCount: pooledItems.count,
        pooledMeals: pooledItems.meals,
        activeTripsCount: activeTrips.count,
        completedTripsCount: completedTrips.count,
        totalDeliveredMeals: completedTrips.meals,
        onlineNgosCount: onlineNgos.count,
        unresolvedAlertsCount: unresolvedAlerts.count,
        timeToPost: {
          medianMs: median,
          p90Ms: p90,
          pctUnder30s,
          sampleCount: posts.length
        }
      },
      serverNow: req.serverNow
    });
  });

  // GET /api/admin/items
  router.get('/items', (req, res) => {
    const items = db.prepare(`
      SELECT i.*, c.name as contributor_name, c.phone as contributor_phone, c.trust as contributor_trust
      FROM items i
      LEFT JOIN contributors c ON i.contributor_id = c.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `).all();
    res.json({ items, serverNow: req.serverNow });
  });

  // GET /api/admin/trips
  router.get('/trips', (req, res) => {
    const trips = db.prepare(`
      SELECT t.*, n.org_name, u.phone as ngo_phone
      FROM trips t
      LEFT JOIN ngos n ON t.ngo_id = n.user_id
      LEFT JOIN users u ON t.ngo_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 100
    `).all();

    const tripsWithDetails = trips.map((t) => {
      const stops = db.prepare(`
        SELECT i.*, ti.seq, ti.collected_at
        FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(t.id);

      const notifications = db.prepare(`
        SELECT tn.*, n.org_name
        FROM trip_notified tn
        JOIN ngos n ON tn.ngo_id = n.user_id
        WHERE tn.trip_id = ?
        ORDER BY tn.notified_at ASC
      `).all(t.id);

      let plan = null;
      try {
        plan = JSON.parse(t.plan_json);
      } catch {
        // ignore
      }

      let leftOut = [];
      try {
        leftOut = JSON.parse(t.left_out_json || '[]');
      } catch {
        // ignore
      }

      return {
        ...t,
        stops,
        notifications,
        plan,
        leftOut
      };
    });

    res.json({ trips: tripsWithDetails, serverNow: req.serverNow });
  });

  // GET /api/admin/ngos
  router.get('/ngos', (req, res) => {
    const ngos = db.prepare(`
      SELECT n.*, u.name, u.phone
      FROM ngos n
      JOIN users u ON n.user_id = u.id
      ORDER BY n.online DESC, n.org_name ASC
    `).all();
    res.json({ ngos, serverNow: req.serverNow });
  });

  // GET /api/admin/contributors
  router.get('/contributors', (req, res) => {
    const contributors = db.prepare(`
      SELECT * FROM contributors
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    res.json({ contributors, serverNow: req.serverNow });
  });

  // POST /api/admin/contributors
  router.post('/contributors', (req, res) => {
    const now = clock.now();
    const { name, phone, address, landmark, lat, lng, trust } = req.body || {};
    const contribId = crypto.randomUUID();
    const shopToken = crypto.randomBytes(8).toString('hex');

    db.prepare(`
      INSERT INTO contributors (id, name, phone, address, landmark, lat, lng, shop_token, trust, strikes, delivered_count, created_via, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'ADMIN', ?)
    `).run(
      contribId,
      name || 'Shop Contributor',
      phone || null,
      address || null,
      landmark || null,
      lat ? Number(lat) : null,
      lng ? Number(lng) : null,
      shopToken,
      trust || 'VERIFIED',
      now
    );

    const contributor = db.prepare('SELECT * FROM contributors WHERE id = ?').get(contribId);
    res.json({ contributor, serverNow: now });
  });

  // PATCH /api/admin/contributors/:id
  router.patch('/contributors/:id', (req, res) => {
    const { trust, strikes, reissueLink, revokeLink } = req.body || {};
    const contrib = db.prepare('SELECT * FROM contributors WHERE id = ?').get(req.params.id);
    if (!contrib) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contributor not found' }, serverNow: req.serverNow });
    }

    let shopToken = contrib.shop_token;
    if (reissueLink) {
      shopToken = crypto.randomBytes(8).toString('hex');
    } else if (revokeLink) {
      shopToken = null;
    }

    db.prepare(`
      UPDATE contributors
      SET trust = COALESCE(?, trust),
          strikes = COALESCE(?, strikes),
          shop_token = ?
      WHERE id = ?
    `).run(
      trust ?? null,
      strikes !== undefined ? Number(strikes) : null,
      shopToken,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM contributors WHERE id = ?').get(req.params.id);
    res.json({ contributor: updated, serverNow: req.serverNow });
  });

  // GET /api/admin/alerts
  router.get('/alerts', (req, res) => {
    const alerts = db.prepare(`
      SELECT * FROM events
      WHERE kind LIKE 'ALERT_%'
      ORDER BY ts DESC
      LIMIT 100
    `).all();
    res.json({ alerts, serverNow: req.serverNow });
  });

  // POST /api/admin/alerts/:id/resolve
  router.post('/alerts/:id/resolve', (req, res) => {
    db.prepare("UPDATE events SET kind = 'RESOLVED_' || kind WHERE id = ?").run(req.params.id);
    res.json({ success: true, serverNow: req.serverNow });
  });

  // GET /api/admin/config
  router.get('/config', (req, res) => {
    const config = getConfig(db);
    res.json({ config, serverNow: req.serverNow });
  });

  // PUT /api/admin/config
  router.put('/config', (req, res) => {
    const updates = req.body || {};
    const updatedConfig = setConfig(db, updates);
    wsManager.broadcast({ type: 'admin_refresh' });
    res.json({ config: updatedConfig, serverNow: req.serverNow });
  });

  // GET /api/admin/events
  router.get('/events', (req, res) => {
    const events = db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT 100').all();
    res.json({ events, serverNow: req.serverNow });
  });

  // GET /api/admin/inbound-messages
  router.get('/inbound-messages', (req, res) => {
    const messages = db.prepare('SELECT * FROM inbound_messages ORDER BY ts DESC LIMIT 100').all();
    res.json({ messages, serverNow: req.serverNow });
  });

  return router;
}
