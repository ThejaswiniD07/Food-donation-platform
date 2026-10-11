import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { distKm, parseQuickMessage, reasonText, REASON_CODES } from '@food-rescue/engine';
import { getConfig } from '../db/index.js';
import { checkRateLimits, recordRateLimitEvents } from '../services/rateLimit.js';
import { runDispatchLoop } from '../services/dispatch.js';

export function createPublicRouter({ db, clock, wsManager }) {
  const router = Router();

  // GET /api/public/config
  router.get('/config', (req, res) => {
    const config = getConfig(db);
    res.json({
      MIN_TRIP_MEALS: config.MIN_TRIP_MEALS,
      SAFETY_MARGIN_MIN: config.SAFETY_MARGIN_MIN,
      QUICK_HOURS: config.QUICK_HOURS,
      SEED_CENTER_LAT: config.SEED_CENTER_LAT,
      SEED_CENTER_LNG: config.SEED_CENTER_LNG,
      SERVICE_AREA_RADIUS_KM: config.SERVICE_AREA_RADIUS_KM,
      VAPID_PUBLIC_KEY: config.VAPID_PUBLIC_KEY,
      serverNow: req.serverNow
    });
  });

  // GET /api/public/shop/:token
  router.get('/shop/:token', (req, res) => {
    const contributor = db.prepare(`
      SELECT id, name, phone, address, landmark, lat, lng, trust, defaults_json
      FROM contributors
      WHERE shop_token = ?
    `).get(req.params.token);

    if (!contributor) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' }, serverNow: req.serverNow });
    }

    res.json({
      shop: {
        id: contributor.id,
        name: contributor.name,
        address: contributor.address,
        landmark: contributor.landmark,
        lat: contributor.lat,
        lng: contributor.lng,
        trust: contributor.trust,
        defaults: contributor.defaults_json ? JSON.parse(contributor.defaults_json) : null
      },
      serverNow: req.serverNow
    });
  });

  // POST /api/public/post
  router.post('/post', async (req, res) => {
    const now = clock.now();
    const config = getConfig(db);
    const body = req.body || {};

    // 1. Bot checks
    if (body.hp) {
      return res.status(400).json({ error: { code: 'BOT_DETECTED', message: 'Invalid submission' }, serverNow: now });
    }
    const clientMs = Number(body.clientMs || 0);
    if (clientMs < 800) {
      return res.status(400).json({
        error: { code: 'TOO_FAST', message: 'Submission was too fast. Please take at least a moment to verify details.' },
        serverNow: now
      });
    }

    // 2. Idempotency check
    if (body.clientRequestId) {
      const existing = db.prepare('SELECT * FROM items WHERE client_request_id = ?').get(body.clientRequestId);
      if (existing) {
        return res.json(buildPostResponse(db, existing, req, now, config));
      }
    }

    // 3. Resolve contributor
    let contributor = null;
    if (body.shopToken) {
      contributor = db.prepare('SELECT * FROM contributors WHERE shop_token = ?').get(body.shopToken);
      if (!contributor) {
        return res.status(404).json({ error: { code: 'INVALID_SHOP', message: 'Shop token not found' }, serverNow: now });
      }
    }

    let phone = body.phone ? String(body.phone).trim() : null;
    const countryCode = config.DEFAULT_COUNTRY_CODE || '+91';
    if (phone && !phone.startsWith('+')) {
      phone = `${countryCode}${phone}`;
    }

    const deviceId = req.cookies?.deviceId || req.headers['x-device-id'] || body.deviceId || null;

    if (!contributor) {
      if (phone) {
        const withPlus = phone.startsWith('+') ? phone : `+91${phone}`;
        const withoutPlus = phone.replace(/^\+91/, '');
        contributor = db.prepare('SELECT * FROM contributors WHERE phone = ? OR phone = ?').get(withPlus, withoutPlus);
      } else if (deviceId) {
        contributor = db.prepare('SELECT * FROM contributors WHERE device_id = ?').get(deviceId);
      }
      if (!contributor) {
        const contributorId = crypto.randomUUID();
        const trust = 'UNVERIFIED';
        db.prepare(`
          INSERT INTO contributors (id, name, phone, address, landmark, lat, lng, trust, strikes, delivered_count, created_via, device_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'QUICK', ?, ?)
        `).run(
          contributorId,
          body.name || 'Anonymous Donor',
          phone,
          body.address || null,
          body.landmark || null,
          body.lat ? Number(body.lat) : null,
          body.lng ? Number(body.lng) : null,
          trust,
          deviceId,
          now
        );
        contributor = db.prepare('SELECT * FROM contributors WHERE id = ?').get(contributorId);
      }
    }

    if (contributor.trust === 'BLOCKED') {
      return res.status(403).json({
        error: { code: 'BLOCKED', message: 'This contributor account is temporarily suspended from posting surplus food.' },
        serverNow: now
      });
    }

    // 4. Validate inputs
    const meals = parseInt(body.meals, 10);
    if (isNaN(meals) || meals < 1 || meals > 2000) {
      return res.status(400).json({ error: { code: 'INVALID_MEALS', message: 'Meals must be an integer between 1 and 2000' }, serverNow: now });
    }

    const diet = body.diet === 'nonveg' ? 'nonveg' : 'veg';
    const form = body.form === 'packed' ? 'packed' : 'cooked';

    const lat = Number(body.lat || contributor.lat);
    const lng = Number(body.lng || contributor.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: { code: 'MISSING_LOCATION', message: 'Valid location coordinates are required' }, serverNow: now });
    }

    // Service area check
    const seedCenter = { lat: Number(config.SEED_CENTER_LAT ?? 12.9716), lng: Number(config.SEED_CENTER_LNG ?? 77.5946) };
    const distFromCenter = distKm({ lat, lng }, seedCenter, Number(config.ROAD_FACTOR ?? 1.3));
    if (distFromCenter > Number(config.SERVICE_AREA_RADIUS_KM ?? 50)) {
      return res.status(400).json({
        error: { code: REASON_CODES.OUTSIDE_AREA, message: reasonText(REASON_CODES.OUTSIDE_AREA) },
        serverNow: now
      });
    }

    // Expiry calculation
    let expiresAt = null;
    if (body.expiresAt) {
      expiresAt = Number(body.expiresAt);
    } else if (body.hours) {
      expiresAt = now + Number(body.hours) * 3600 * 1000;
    } else if (body.minutes) {
      expiresAt = now + Number(body.minutes) * 60 * 1000;
    } else {
      expiresAt = now + (form === 'packed' ? 12 : 3) * 3600 * 1000;
    }

    if (expiresAt <= now || expiresAt > now + 24 * 3600 * 1000) {
      return res.status(400).json({
        error: { code: 'INVALID_EXPIRY', message: 'Safe until time must be between present and 24 hours ahead' },
        serverNow: now
      });
    }

    // 5. Duplicate guard (same contributor, within 100m, same meals, within 10 min)
    const recent = db.prepare(`
      SELECT * FROM items
      WHERE contributor_id = ? AND meals = ? AND (? - created_at) < 600000
    `).all(contributor.id, meals, now);

    for (const r of recent) {
      if (distKm({ lat, lng }, { lat: r.lat, lng: r.lng }) <= 0.1) {
        return res.json(buildPostResponse(db, r, req, now, config));
      }
    }

    // 6. Rate limit checks
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const rlCheck = checkRateLimits({
      db,
      clock,
      ip: clientIp,
      deviceId,
      phone: contributor.phone,
      shopToken: body.shopToken,
      config
    });

    if (!rlCheck.allowed) {
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: rlCheck.message, retryAfterSec: rlCheck.retryAfterSec },
        serverNow: now
      });
    }

    // 7. Insert Item
    const itemId = crypto.randomUUID();
    const trackToken = crypto.randomBytes(16).toString('hex');
    const source = body.shopToken ? 'SHOP_QR' : 'QUICK_LINK';
    const title = body.title || `${meals} ${diet} meals (${form})`;

    db.prepare(`
      INSERT INTO items (
        id, contributor_id, source, title, meals, diet, form,
        lat, lng, address, created_at, expires_at, track_token,
        client_request_id, post_ms, trust_at_post, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POOLED')
    `).run(
      itemId,
      contributor.id,
      source,
      title,
      meals,
      diet,
      form,
      lat,
      lng,
      body.address || contributor.address || null,
      now,
      expiresAt,
      trackToken,
      body.clientRequestId || null,
      clientMs,
      contributor.trust
    );

    // 8. Save defaults on contributor and record rate limit
    const defaults = { meals, diet, form, hours: body.hours || (form === 'packed' ? 12 : 3) };
    db.prepare('UPDATE contributors SET defaults_json = ? WHERE id = ?').run(JSON.stringify(defaults), contributor.id);

    recordRateLimitEvents({
      db,
      clock,
      ip: clientIp,
      deviceId,
      shopToken: body.shopToken
    });

    // 9. Run dispatch loop once
    await runDispatchLoop({ db, clock, wsManager });

    // 10. Fetch current state and return
    const createdItem = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    res.json(buildPostResponse(db, createdItem, req, now, config));
  });

  // GET /api/public/track/:itemToken
  router.get('/track/:itemToken', (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE track_token = ?').get(req.params.itemToken);
    if (!item) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tracking link not found' }, serverNow: req.serverNow });
    }

    let assignedNgoName = null;
    let plannedPickupTime = null;

    if (item.trip_id) {
      const trip = db.prepare(`
        SELECT t.*, n.org_name
        FROM trips t
        LEFT JOIN ngos n ON t.ngo_id = n.user_id
        WHERE t.id = ?
      `).get(item.trip_id);

      if (trip && trip.org_name) {
        assignedNgoName = trip.org_name;
      }
      if (trip && trip.plan_json) {
        try {
          const plan = JSON.parse(trip.plan_json);
          plannedPickupTime = plan.arriveAt?.[item.id] || null;
        } catch {
          // ignore
        }
      }
    }

    res.json({
      item: {
        id: item.id,
        title: item.title,
        meals: item.meals,
        diet: item.diet,
        form: item.form,
        status: item.status,
        noteCode: item.note_code,
        noteText: item.note_text,
        finalReasonCode: item.final_reason_code,
        finalReasonText: item.final_reason_text,
        expiresAt: item.expires_at,
        createdAt: item.created_at,
        assignedNgoName,
        plannedPickupTime
      },
      serverNow: req.serverNow
    });
  });

  // POST /api/public/track/:itemToken/cancel
  router.post('/track/:itemToken/cancel', async (req, res) => {
    const now = clock.now();
    const item = db.prepare('SELECT * FROM items WHERE track_token = ?').get(req.params.itemToken);
    if (!item) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' }, serverNow: now });
    }

    if (item.status === 'COLLECTED' || item.status === 'DELIVERED') {
      return res.status(409).json({
        error: { code: 'CANNOT_CANCEL', message: 'Item has already been collected by NGO' },
        serverNow: now
      });
    }

    if (item.status === 'CANCELLED') {
      return res.json({ success: true, status: 'CANCELLED', serverNow: now });
    }

    // Cancel item
    if (item.trip_id) {
      const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(item.trip_id);
      if (trip) {
        if (trip.status === 'OFFERED') {
          // Remove from trip
          db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?').run(trip.id, item.id);
          // Check remaining
          const remaining = db.prepare(`
            SELECT i.* FROM items i
            JOIN trip_items ti ON i.id = ti.item_id
            WHERE ti.trip_id = ?
          `).all(trip.id);
          const totalMeals = remaining.reduce((s, it) => s + it.meals, 0);
          if (totalMeals < 20) {
            // Withdraw trip
            db.prepare("UPDATE trips SET status = 'WITHDRAWN' WHERE id = ?").run(trip.id);
            db.prepare("UPDATE items SET status = 'POOLED', trip_id = NULL WHERE trip_id = ?").run(trip.id);
            wsManager.broadcast({ type: 'trip_withdrawn', tripId: trip.id });
          }
        } else if (trip.status === 'ASSIGNED' || trip.status === 'IN_PROGRESS') {
          db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?').run(trip.id, item.id);
          const remaining = db.prepare('SELECT COUNT(*) as cnt FROM trip_items WHERE trip_id = ?').get(trip.id).cnt;
          if (remaining === 0) {
            db.prepare("UPDATE trips SET status = 'CANCELLED' WHERE id = ?").run(trip.id);
          }
          if (trip.ngo_id) {
            wsManager.sendToUser(trip.ngo_id, { type: 'trip_updated', tripId: trip.id });
          }
        }
      }
    }

    db.prepare("UPDATE items SET status = 'CANCELLED', trip_id = NULL WHERE id = ?").run(item.id);
    res.json({ success: true, status: 'CANCELLED', serverNow: now });
  });

  // GET /api/health
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', serverNow: req.serverNow });
  });

  // POST /api/inbound/message
  router.post('/inbound/message', async (req, res) => {
    const now = clock.now();
    const config = getConfig(db);
    const secret = req.headers['x-inbound-secret'];
    const expectedSecret = process.env.INBOUND_SECRET || 'secret-inbound-key-12345';

    if (!secret || secret !== expectedSecret) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid inbound secret' }, serverNow: now });
    }

    const { from, body } = req.body || {};
    if (!from || !body) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'from and body are required' }, serverNow: now });
    }

    let phone = String(from).trim();
    const withPlus = phone.startsWith('+') ? phone : `+91${phone}`;
    const withoutPlus = phone.replace(/^\+91/, '');

    const contributor = db.prepare('SELECT * FROM contributors WHERE phone = ? OR phone = ?').get(withPlus, withoutPlus);
    const parsed = parseQuickMessage(body);

    let replyText = '';
    let resultStatus = 'REPLIED';

    if (contributor && contributor.lat && contributor.lng && parsed.ok) {
      // Create item
      const itemId = crypto.randomUUID();
      const trackToken = crypto.randomBytes(16).toString('hex');
      const expiresAt = now + parsed.minutes * 60000;
      const title = `${parsed.meals} ${parsed.diet} meals (${parsed.form})`;

      db.prepare(`
        INSERT INTO items (
          id, contributor_id, source, title, meals, diet, form,
          lat, lng, address, created_at, expires_at, track_token,
          trust_at_post, status
        ) VALUES (?, ?, 'INBOUND', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POOLED')
      `).run(
        itemId,
        contributor.id,
        title,
        parsed.meals,
        parsed.diet,
        parsed.form,
        contributor.lat,
        contributor.lng,
        contributor.address,
        now,
        expiresAt,
        trackToken,
        contributor.trust
      );

      await runDispatchLoop({ db, clock, wsManager });

      const trackUrl = `${req.protocol}://${req.get('host')}/track/${trackToken}`;
      replyText = `Food posted! Tracking: ${trackUrl}`;
      resultStatus = 'ITEM_CREATED';
    } else if (contributor && contributor.lat && contributor.lng && !parsed.ok) {
      replyText = `Could not understand request. ${parsed.hint}`;
      resultStatus = 'PARSE_FAILED';
    } else {
      // Unknown or missing location
      const postUrl = `${req.protocol}://${req.get('host')}/post`;
      replyText = `Welcome to Food Rescue! Please post your surplus food here: ${postUrl}`;
      resultStatus = 'ONBOARDING_SENT';
    }

    // Log in inbound_messages
    db.prepare(`
      INSERT INTO inbound_messages (id, ts, from_phone, body, parsed_json, result)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), now, phone, body, JSON.stringify(parsed), resultStatus);

    res.json({ replyText, serverNow: now });
  });

  return router;
}

function buildPostResponse(db, item, req, now, config) {
  const host = req.get('host') || 'localhost:4000';
  const trackUrl = `${req.protocol}://${host}/track/${item.track_token}`;

  let haveMeals = item.meals;
  let minMeals = Number(config.MIN_TRIP_MEALS ?? 20);
  let decideBy = item.expires_at - 15 * 60000;

  if (item.note_json) {
    try {
      const parsedNote = JSON.parse(item.note_json);
      if (parsedNote.have !== undefined) haveMeals = parsedNote.have;
      if (parsedNote.min !== undefined) minMeals = parsedNote.min;
      if (parsedNote.time !== undefined) decideBy = parsedNote.time;
    } catch {
      // ignore
    }
  }

  const shareText = `We just shared surplus food on Food Rescue! Help us reach ${minMeals} meals for instant pickup: ${trackUrl}`;

  return {
    trackToken: item.track_token,
    trackUrl,
    status: item.status,
    noteText: item.note_text,
    haveMeals,
    minMeals,
    decideBy,
    shareText,
    serverNow: now
  };
}
