import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getConfig } from '../db/index.js';
import { runDispatchLoop } from '../services/dispatch.js';

export function createProviderRouter({ db, clock, jwtSecret, wsManager }) {
  const router = Router();

  router.use(authenticate(jwtSecret));
  router.use(requireRole('provider'));

  // GET /api/provider/profile
  router.get('/profile', (req, res) => {
    const contributor = db.prepare('SELECT * FROM contributors WHERE user_id = ?').get(req.user.id);
    res.json({
      provider: {
        id: req.user.id,
        name: req.user.name,
        phone: req.user.phone,
        contributor: contributor || null
      },
      serverNow: req.serverNow
    });
  });

  // GET /api/provider/items
  router.get('/items', (req, res) => {
    const contributor = db.prepare('SELECT id FROM contributors WHERE user_id = ?').get(req.user.id);
    if (!contributor) {
      return res.json({ items: [], serverNow: req.serverNow });
    }

    const items = db.prepare(`
      SELECT * FROM items
      WHERE contributor_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(contributor.id);

    res.json({ items, serverNow: req.serverNow });
  });

  // POST /api/provider/items
  router.post('/items', async (req, res) => {
    const now = clock.now();
    let contributor = db.prepare('SELECT * FROM contributors WHERE user_id = ?').get(req.user.id);

    if (!contributor) {
      const contribId = crypto.randomUUID();
      const shopToken = crypto.randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO contributors (id, user_id, name, phone, shop_token, trust, strikes, delivered_count, created_via, created_at)
        VALUES (?, ?, ?, ?, ?, 'VERIFIED', 0, 0, 'ACCOUNT', ?)
      `).run(contribId, req.user.id, req.user.name, req.user.phone, shopToken, now);
      contributor = db.prepare('SELECT * FROM contributors WHERE id = ?').get(contribId);
    }

    const { meals, diet, form, hours, expiresAt, lat, lng, address } = req.body || {};
    const itemId = crypto.randomUUID();
    const trackToken = crypto.randomBytes(16).toString('hex');
    const finalExpiresAt = expiresAt ? Number(expiresAt) : (now + (Number(hours) || (form === 'packed' ? 12 : 3)) * 3600 * 1000);
    const itemLat = Number(lat || contributor.lat || 12.9716);
    const itemLng = Number(lng || contributor.lng || 77.5946);
    const title = `${meals} ${diet || 'veg'} meals (${form || 'cooked'})`;

    db.prepare(`
      INSERT INTO items (
        id, contributor_id, source, title, meals, diet, form,
        lat, lng, address, created_at, expires_at, track_token,
        trust_at_post, status
      ) VALUES (?, ?, 'ACCOUNT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', 'POOLED')
    `).run(
      itemId,
      contributor.id,
      title,
      Number(meals),
      diet === 'nonveg' ? 'nonveg' : 'veg',
      form === 'packed' ? 'packed' : 'cooked',
      itemLat,
      itemLng,
      address || contributor.address || null,
      now,
      finalExpiresAt,
      trackToken
    );

    await runDispatchLoop({ db, clock, wsManager });
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    res.json({ item, trackToken, serverNow: now });
  });

  return router;
}
