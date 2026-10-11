import { Router } from 'express';
import crypto from 'crypto';
import { planTrip, reasonText, REASON_CODES } from '@food-rescue/engine';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getConfig } from '../db/index.js';
import { runDispatchLoop } from '../services/dispatch.js';

export function createNgoRouter({ db, clock, jwtSecret, wsManager }) {
  const router = Router();

  // Public push key endpoint
  router.get('/push/public-key', (req, res) => {
    const config = getConfig(db);
    res.json({ publicKey: config.VAPID_PUBLIC_KEY, serverNow: req.serverNow });
  });

  // Protected NGO endpoints
  router.use(authenticate(jwtSecret));
  router.use(requireRole('ngo'));

  // POST /api/ngo/online
  router.post('/online', async (req, res) => {
    const now = clock.now();
    const { online, lat, lng } = req.body || {};
    const isOnline = online ? 1 : 0;

    db.prepare(`
      UPDATE ngos
      SET online = ?,
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          last_gps_at = CASE WHEN ? = 1 THEN ? ELSE last_gps_at END
      WHERE user_id = ?
    `).run(isOnline, lat ?? null, lng ?? null, isOnline, now, req.user.id);

    await runDispatchLoop({ db, clock, wsManager });
    res.json({ success: true, online: !!isOnline, serverNow: now });
  });

  // POST /api/ngo/location
  router.post('/location', async (req, res) => {
    const now = clock.now();
    const { lat, lng } = req.body || {};
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: { code: 'INVALID_COORDINATES', message: 'lat and lng required' }, serverNow: now });
    }

    db.prepare(`
      UPDATE ngos
      SET lat = ?, lng = ?, last_gps_at = ?
      WHERE user_id = ?
    `).run(Number(lat), Number(lng), now, req.user.id);

    await runDispatchLoop({ db, clock, wsManager });
    res.json({ success: true, serverNow: now });
  });

  // PUT /api/ngo/profile
  router.put('/profile', (req, res) => {
    const { orgName, acceptsVeg, acceptsNonveg, acceptsCooked, acceptsPacked } = req.body || {};
    db.prepare(`
      UPDATE ngos
      SET org_name = COALESCE(?, org_name),
          accepts_veg = COALESCE(?, accepts_veg),
          accepts_nonveg = COALESCE(?, accepts_nonveg),
          accepts_cooked = COALESCE(?, accepts_cooked),
          accepts_packed = COALESCE(?, accepts_packed)
      WHERE user_id = ?
    `).run(
      orgName ?? null,
      acceptsVeg !== undefined ? (acceptsVeg ? 1 : 0) : null,
      acceptsNonveg !== undefined ? (acceptsNonveg ? 1 : 0) : null,
      acceptsCooked !== undefined ? (acceptsCooked ? 1 : 0) : null,
      acceptsPacked !== undefined ? (acceptsPacked ? 1 : 0) : null,
      req.user.id
    );

    const updated = db.prepare('SELECT * FROM ngos WHERE user_id = ?').get(req.user.id);
    res.json({ ngo: updated, serverNow: req.serverNow });
  });

  // POST /api/ngo/push-subscription
  router.post('/push-subscription', (req, res) => {
    const now = clock.now();
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: { code: 'INVALID_SUBSCRIPTION', message: 'Endpoint and keys are required' }, serverNow: now });
    }

    db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.user.id, endpoint, keys.p256dh, keys.auth, now);

    res.json({ success: true, serverNow: now });
  });

  // GET /api/ngo/state
  router.get('/state', (req, res) => {
    const now = clock.now();
    const config = getConfig(db);
    const ngo = db.prepare('SELECT * FROM ngos WHERE user_id = ?').get(req.user.id);

    // 1. Offer check: pending trip_notified
    let offer = null;
    const notif = db.prepare(`
      SELECT tn.*, t.*
      FROM trip_notified tn
      JOIN trips t ON tn.trip_id = t.id
      WHERE tn.ngo_id = ? AND tn.response = 'PENDING' AND tn.window_ends_at > ? AND t.status = 'OFFERED'
      ORDER BY tn.notified_at DESC
      LIMIT 1
    `).get(req.user.id, now);

    if (notif) {
      const stops = db.prepare(`
        SELECT i.*, ti.seq
        FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(notif.trip_id);

      let plan = null;
      try {
        plan = JSON.parse(notif.plan_json);
      } catch {
        // ignore
      }

      let leftOut = [];
      try {
        leftOut = JSON.parse(notif.left_out_json || '[]');
      } catch {
        // ignore
      }

      const itemsWithSlack = stops.map((item) => {
        const slack = plan?.slackMin?.[item.id] ?? 0;
        let color = 'green';
        if (slack < 10) color = 'red';
        else if (slack < 30) color = 'amber';

        return {
          id: item.id,
          title: item.title,
          meals: item.meals,
          diet: item.diet,
          form: item.form,
          lat: item.lat,
          lng: item.lng,
          address: item.address,
          expiresAt: item.expires_at,
          trustAtPost: item.trust_at_post,
          isUnverified: item.trust_at_post !== 'VERIFIED',
          slackMin: Math.round(slack),
          slackColor: color,
          arriveAt: plan?.arriveAt?.[item.id] || null
        };
      });

      offer = {
        tripId: notif.trip_id,
        waveNo: notif.wave_no,
        windowEndsAt: notif.window_ends_at,
        totalMeals: notif.total_meals,
        stopCount: stops.length,
        deliverAt: notif.deliver_at,
        receiverLat: notif.receiver_lat,
        receiverLng: notif.receiver_lng,
        items: itemsWithSlack,
        leftOut
      };
    }

    // 2. Route offer check
    let routeOffer = null;
    const rOffer = db.prepare(`
      SELECT ro.*, i.title, i.meals, i.diet, i.form, i.lat, i.lng, c.name as contributor_name
      FROM route_offers ro
      JOIN items i ON ro.item_id = i.id
      JOIN contributors c ON i.contributor_id = c.id
      WHERE ro.ngo_id = ? AND ro.status = 'PENDING' AND ro.ends_at > ?
      ORDER BY ro.ends_at ASC
      LIMIT 1
    `).get(req.user.id, now);

    if (rOffer) {
      routeOffer = {
        id: rOffer.id,
        tripId: rOffer.trip_id,
        itemId: rOffer.item_id,
        title: rOffer.title,
        meals: rOffer.meals,
        diet: rOffer.diet,
        form: rOffer.form,
        contributorName: rOffer.contributor_name,
        detourKm: rOffer.detour_km,
        endsAt: rOffer.ends_at
      };
    }

    // 3. Active trip check
    let activeTrip = null;
    const trip = db.prepare(`
      SELECT * FROM trips
      WHERE ngo_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS')
      LIMIT 1
    `).get(req.user.id);

    if (trip) {
      const stops = db.prepare(`
        SELECT i.*, ti.seq, ti.collected_at, c.name as contributor_name, c.phone as contributor_phone
        FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        JOIN contributors c ON i.contributor_id = c.id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(trip.id);

      let plan = null;
      try {
        plan = JSON.parse(trip.plan_json);
      } catch {
        // ignore
      }

      activeTrip = {
        id: trip.id,
        status: trip.status,
        step: trip.step,
        totalMeals: trip.total_meals,
        deliverAt: trip.deliver_at,
        receiverLat: trip.receiver_lat,
        receiverLng: trip.receiver_lng,
        stops: stops.map((s) => ({
          id: s.id,
          seq: s.seq,
          title: s.title,
          meals: s.meals,
          diet: s.diet,
          form: s.form,
          lat: s.lat,
          lng: s.lng,
          address: s.address,
          expiresAt: s.expires_at,
          collectedAt: s.collected_at,
          isCollected: !!s.collected_at,
          contributorName: s.contributor_name,
          contributorPhone: s.contributor_phone, // Safe to show after assignment!
          trustAtPost: s.trust_at_post,
          requiresConfirmation: s.trust_at_post !== 'VERIFIED',
          arriveAt: plan?.arriveAt?.[s.id] || null
        }))
      };
    }

    // 4. Pool progress
    const pooledMeals = db.prepare(`
      SELECT COUNT(*) as itemCount, COALESCE(SUM(meals), 0) as totalMeals
      FROM items
      WHERE status = 'POOLED'
    `).get();

    // 5. Today's stats
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const stats = db.prepare(`
      SELECT COUNT(DISTINCT t.id) as completedTrips, COALESCE(SUM(t.total_meals), 0) as deliveredMeals
      FROM trips t
      WHERE t.ngo_id = ? AND t.status = 'COMPLETED' AND t.completed_at >= ?
    `).get(req.user.id, startOfDay);

    res.json({
      online: !!ngo.online,
      lastGpsAt: ngo.last_gps_at,
      offer,
      routeOffer,
      activeTrip,
      poolProgress: {
        haveMeals: pooledMeals.totalMeals,
        minMeals: Number(config.MIN_TRIP_MEALS ?? 20)
      },
      stats: {
        todayTrips: stats.completedTrips,
        todayMeals: stats.deliveredMeals
      },
      serverNow: now
    });
  });

  // POST /api/trips/:id/accept (Section 5.G Accept Lock)
  router.post('/trips/:id/accept', (req, res) => {
    const now = clock.now();
    const tripId = req.params.id;
    const ngoId = req.user.id;
    const config = getConfig(db);

    const ngo = db.prepare('SELECT * FROM ngos WHERE user_id = ?').get(ngoId);
    if (!ngo) {
      return res.status(404).json({ error: { code: 'NGO_NOT_FOUND', message: 'NGO not found' }, serverNow: now });
    }

    const acceptTransaction = db.transaction(() => {
      // 1. Check PENDING trip_notified whose window has not ended
      const notif = db.prepare(`
        SELECT * FROM trip_notified
        WHERE trip_id = ? AND ngo_id = ?
      `).get(tripId, ngoId);

      if (!notif) {
        return { success: false, status: 404, code: 'OFFER_NOT_FOUND', message: 'Trip not found' };
      }

      if (notif.response === 'TAKEN') {
        return { success: false, status: 409, code: 'TAKEN', message: 'Trip was already accepted by another NGO' };
      }

      if (notif.response !== 'PENDING' || notif.window_ends_at < now) {
        return { success: false, status: 409, code: 'OFFER_CLOSED', message: 'Offer is no longer available or window expired' };
      }

      // 2. Re-run planTrip for this NGO now
      const tripItems = db.prepare(`
        SELECT i.* FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(tripId);

      const plan = planTrip({
        start: { lat: ngo.lat, lng: ngo.lng },
        items: tripItems,
        receiver: { lat: ngo.base_lat, lng: ngo.base_lng },
        now,
        config
      });

      if (!plan.feasible) {
        return { success: false, status: 409, code: 'NO_LONGER_SAFE', message: 'Trip is no longer feasible within food safety margin' };
      }

      // 3. Atomically update trips SET status='ASSIGNED' WHERE id=? AND status='OFFERED'
      const updateResult = db.prepare(`
        UPDATE trips
        SET status = 'ASSIGNED',
            ngo_id = ?,
            receiver_lat = ?,
            receiver_lng = ?,
            plan_json = ?,
            deliver_at = ?,
            assigned_at = ?
        WHERE id = ? AND status = 'OFFERED'
      `).run(ngoId, ngo.base_lat, ngo.base_lng, JSON.stringify(plan), plan.deliverAt, now, tripId);

      if (updateResult.changes === 0) {
        return { success: false, status: 409, code: 'TAKEN', message: 'Trip was already accepted by another NGO' };
      }

      // 4. Mark this row ACCEPTED, all other PENDING rows TAKEN
      db.prepare(`
        UPDATE trip_notified
        SET response = 'ACCEPTED'
        WHERE trip_id = ? AND ngo_id = ?
      `).run(tripId, ngoId);

      db.prepare(`
        UPDATE trip_notified
        SET response = 'TAKEN'
        WHERE trip_id = ? AND ngo_id != ? AND response = 'PENDING'
      `).run(tripId, ngoId);

      return { success: true };
    });

    const result = acceptTransaction();

    if (!result.success) {
      return res.status(result.status).json({
        error: { code: result.code, message: result.message },
        serverNow: now
      });
    }

    // 5. Notify sockets
    wsManager.broadcast({ type: 'trip_taken', tripId, winnerId: ngoId });
    wsManager.sendToUser(ngoId, { type: 'trip_assigned', tripId });
    wsManager.sendToRole('admin', { type: 'admin_refresh' });

    const updatedTrip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    res.json({ trip: updatedTrip, serverNow: now });
  });

  // POST /api/trips/:id/decline
  router.post('/trips/:id/decline', async (req, res) => {
    const now = clock.now();
    const tripId = req.params.id;
    const ngoId = req.user.id;

    db.prepare(`
      UPDATE trip_notified
      SET response = 'DECLINED'
      WHERE trip_id = ? AND ngo_id = ?
    `).run(tripId, ngoId);

    await runDispatchLoop({ db, clock, wsManager });
    res.json({ success: true, serverNow: now });
  });

  // POST /api/trips/:id/advance (Section 5.J)
  router.post('/trips/:id/advance', async (req, res) => {
    const now = clock.now();
    const tripId = req.params.id;
    const { expectedStep, outcome } = req.body || {};

    const trip = db.prepare('SELECT * FROM trips WHERE id = ? AND ngo_id = ?').get(tripId, req.user.id);
    if (!trip) {
      return res.status(404).json({ error: { code: 'TRIP_NOT_FOUND', message: 'Trip not found' }, serverNow: now });
    }

    if (trip.step !== Number(expectedStep)) {
      return res.status(409).json({
        error: { code: 'STEP_MISMATCH', message: `Step mismatch. Server step is ${trip.step}, received ${expectedStep}` },
        serverNow: now
      });
    }

    const stops = db.prepare(`
      SELECT i.*, ti.seq, ti.collected_at FROM items i
      JOIN trip_items ti ON i.id = ti.item_id
      WHERE ti.trip_id = ?
      ORDER BY ti.seq ASC
    `).all(tripId);

    const stepIndex = trip.step;

    if (stepIndex < stops.length) {
      // Current step is a pickup stop
      const currentItem = stops[stepIndex];

      if (outcome === 'COLLECTED') {
        db.prepare('UPDATE trip_items SET collected_at = ? WHERE trip_id = ? AND item_id = ?').run(now, tripId, currentItem.id);
        db.prepare("UPDATE items SET status = 'COLLECTED' WHERE id = ?").run(currentItem.id);
        db.prepare("UPDATE trips SET step = step + 1, status = 'IN_PROGRESS' WHERE id = ?").run(tripId);
      } else if (outcome === 'NOT_AVAILABLE') {
        const notAvailText = reasonText(REASON_CODES.NOT_AVAILABLE);
        db.prepare(`
          UPDATE items
          SET status = 'CANCELLED',
              note_code = 'NOT_AVAILABLE',
              note_text = ?,
              final_reason_code = 'NOT_AVAILABLE',
              final_reason_text = ?
          WHERE id = ?
        `).run(notAvailText, notAvailText, currentItem.id);

        // Contributor strikes +1
        const config = getConfig(db);
        const strikesLimit = Number(config.STRIKES_TO_BLOCK ?? 3);
        const contributor = db.prepare('SELECT * FROM contributors WHERE id = ?').get(currentItem.contributor_id);
        if (contributor) {
          const newStrikes = contributor.strikes + 1;
          const newTrust = newStrikes >= strikesLimit ? 'BLOCKED' : contributor.trust;
          db.prepare('UPDATE contributors SET strikes = ?, trust = ? WHERE id = ?').run(newStrikes, newTrust, contributor.id);
        }

        // Delete from trip_items
        db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?').run(tripId, currentItem.id);

        // Check remaining items in trip
        const remaining = db.prepare('SELECT COUNT(*) as cnt FROM trip_items WHERE trip_id = ?').get(tripId).cnt;
        if (remaining === 0) {
          db.prepare("UPDATE trips SET status = 'CANCELLED' WHERE id = ?").run(tripId);
        } else {
          // Replan remaining
          db.prepare("UPDATE trips SET step = ?, status = 'IN_PROGRESS' WHERE id = ?").run(stepIndex, tripId);
        }
      } else {
        return res.status(400).json({ error: { code: 'INVALID_OUTCOME', message: 'outcome must be COLLECTED or NOT_AVAILABLE' }, serverNow: now });
      }
    } else {
      // Final delivery step
      const tripItems = db.prepare(`
        SELECT i.* FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
      `).all(tripId);

      for (const it of tripItems) {
        db.prepare("UPDATE items SET status = 'DELIVERED' WHERE id = ?").run(it.id);
        db.prepare('UPDATE contributors SET delivered_count = delivered_count + 1 WHERE id = ?').run(it.contributor_id);

        // Auto-promote UNVERIFIED to VERIFIED after first delivered item
        const contrib = db.prepare('SELECT trust, delivered_count FROM contributors WHERE id = ?').get(it.contributor_id);
        if (contrib && contrib.trust === 'UNVERIFIED' && contrib.delivered_count >= 1) {
          db.prepare("UPDATE contributors SET trust = 'VERIFIED' WHERE id = ?").run(it.contributor_id);
        }
      }

      db.prepare("UPDATE trips SET status = 'COMPLETED', completed_at = ?, step = step + 1 WHERE id = ?").run(now, tripId);
    }

    const updated = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    wsManager.sendToUser(req.user.id, { type: 'trip_updated', tripId });
    wsManager.sendToRole('admin', { type: 'admin_refresh' });

    res.json({ trip: updated, serverNow: now });
  });

  // POST /api/route-offers/:id/accept
  router.post('/route-offers/:id/accept', (req, res) => {
    const now = clock.now();
    const offer = db.prepare('SELECT * FROM route_offers WHERE id = ? AND ngo_id = ?').get(req.params.id, req.user.id);
    if (!offer || offer.status !== 'PENDING' || offer.ends_at < now) {
      return res.status(409).json({ error: { code: 'OFFER_EXPIRED', message: 'Route offer is no longer available' }, serverNow: now });
    }

    db.prepare("UPDATE route_offers SET status = 'ACCEPTED' WHERE id = ?").run(offer.id);

    // Insert item into trip
    const countRow = db.prepare('SELECT MAX(seq) as maxSeq FROM trip_items WHERE trip_id = ?').get(offer.trip_id);
    const nextSeq = (countRow.maxSeq ?? -1) + 1;

    db.prepare('INSERT INTO trip_items (trip_id, item_id, seq) VALUES (?, ?, ?)').run(offer.trip_id, offer.item_id, nextSeq);
    db.prepare("UPDATE items SET status = 'IN_TRIP', trip_id = ?, note_code = NULL, note_text = NULL WHERE id = ?").run(offer.trip_id, offer.item_id);

    wsManager.sendToUser(req.user.id, { type: 'trip_updated', tripId: offer.trip_id });
    res.json({ success: true, serverNow: now });
  });

  // POST /api/route-offers/:id/decline
  router.post('/route-offers/:id/decline', (req, res) => {
    db.prepare("UPDATE route_offers SET status = 'DECLINED' WHERE id = ? AND ngo_id = ?").run(req.params.id, req.user.id);
    res.json({ success: true, serverNow: clock.now() });
  });

  // GET /api/ngo/history
  router.get('/history', (req, res) => {
    const trips = db.prepare(`
      SELECT * FROM trips
      WHERE ngo_id = ? AND status IN ('COMPLETED', 'CANCELLED')
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 50
    `).all(req.user.id);

    res.json({ trips, serverNow: req.serverNow });
  });

  // POST /api/ngo/post-for-shop (source: AGENT)
  router.post('/post-for-shop', async (req, res) => {
    const now = clock.now();
    const { meals, diet, form, hours, lat, lng, shopName, phone, address } = req.body || {};
    const config = getConfig(db);

    const contributorId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO contributors (id, name, phone, address, lat, lng, trust, strikes, delivered_count, created_via, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'UNVERIFIED', 0, 0, 'ADMIN', ?)
    `).run(
      contributorId,
      shopName || 'Walk-in Contributor',
      phone || null,
      address || null,
      lat ? Number(lat) : null,
      lng ? Number(lng) : null,
      now
    );

    const itemId = crypto.randomUUID();
    const trackToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = now + (Number(hours) || (form === 'packed' ? 12 : 3)) * 3600 * 1000;
    const title = `${meals} ${diet} meals (${form})`;

    db.prepare(`
      INSERT INTO items (
        id, contributor_id, source, title, meals, diet, form,
        lat, lng, address, created_at, expires_at, track_token,
        trust_at_post, status
      ) VALUES (?, ?, 'AGENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNVERIFIED', 'POOLED')
    `).run(
      itemId,
      contributorId,
      title,
      Number(meals),
      diet === 'nonveg' ? 'nonveg' : 'veg',
      form === 'packed' ? 'packed' : 'cooked',
      Number(lat),
      Number(lng),
      address || null,
      now,
      expiresAt,
      trackToken
    );

    await runDispatchLoop({ db, clock, wsManager });
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    res.json({ item, serverNow: now });
  });

  return router;
}
