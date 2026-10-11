import crypto from 'crypto';
import {
  selectTrip,
  planTrip,
  computeLatestDispatchAt,
  evaluateMidTripInsertion,
  distKm,
  etaMin,
  urgency,
  reasonText,
  REASON_CODES,
  DEFAULT_WAVES
} from '@food-rescue/engine';
import { getConfig } from '../db/index.js';
import { sendPushNotification } from './push.js';

let isDispatchRunning = false;

export async function runDispatchLoop({ db, clock, wsManager }) {
  if (isDispatchRunning) return;
  isDispatchRunning = true;

  try {
    const now = clock.now();
    const config = getConfig(db);

    // Run inside transaction
    const executeTick = db.transaction(() => {
      // 1. expireItems(now)
      expireItems(db, now, config);

      // 2. advanceWaves(now)
      advanceWaves(db, now, config);

      // 3. expireRouteOffers(now)
      expireRouteOffers(db, now);

      // 4. tryMidTripInsertions(now)
      tryMidTripInsertions(db, now, config);

      // 5. formNewTrips(now)
      formNewTrips(db, now, config);

      // 6. checkActiveTrips(now)
      checkActiveTrips(db, now, config);
    });

    executeTick();
  } catch (err) {
    console.error('[Dispatch Loop Error]:', err);
  } finally {
    isDispatchRunning = false;
  }
}

function expireItems(db, now, config) {
  // A. POOLED items where now >= expiresAt -> EXPIRED
  const expiredItems = db.prepare(`
    SELECT id, title, expires_at FROM items
    WHERE status = 'POOLED' AND expires_at <= ?
  `).all(now);

  const setExpired = db.prepare(`
    UPDATE items
    SET status = 'EXPIRED',
        final_reason_code = 'EXPIRED',
        final_reason_text = ?,
        retry_at = NULL
    WHERE id = ?
  `);

  const insertEvent = db.prepare(`
    INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
    VALUES (?, ?, 'ITEM_EXPIRED', 'item', ?, ?)
  `);

  for (const it of expiredItems) {
    const text = reasonText(REASON_CODES.EXPIRED);
    setExpired.run(text, it.id);
    insertEvent.run(crypto.randomUUID(), now, it.id, `Item "${it.title}" expired`);
  }

  // B. POOLED items where now >= latestDispatchAt -> LEFT_OUT with NOT_ENOUGH_FOOD
  const pooled = db.prepare(`
    SELECT * FROM items
    WHERE status = 'POOLED' AND expires_at > ?
  `).all(now);

  const ngos = db.prepare('SELECT user_id, base_lat, base_lng FROM ngos').all();

  const setLeftOut = db.prepare(`
    UPDATE items
    SET status = 'LEFT_OUT',
        final_reason_code = 'NOT_ENOUGH_FOOD',
        final_reason_text = ?,
        retry_at = NULL
    WHERE id = ?
  `);

  for (const it of pooled) {
    // Find nearest NGO base
    let nearestBase = null;
    let minDist = Infinity;
    for (const ngo of ngos) {
      const d = distKm(it, { lat: ngo.base_lat, lng: ngo.base_lng });
      if (d < minDist) {
        minDist = d;
        nearestBase = { lat: ngo.base_lat, lng: ngo.base_lng };
      }
    }

    if (!nearestBase) {
      nearestBase = { lat: Number(config.SEED_CENTER_LAT ?? 12.9716), lng: Number(config.SEED_CENTER_LNG ?? 77.5946) };
    }

    const latestDispatchAt = computeLatestDispatchAt({
      item: it,
      ngoBase: nearestBase,
      config
    });

    if (now >= latestDispatchAt) {
      const dwell = Number(config.PICKUP_DWELL_MIN ?? 5);
      const safetyMarginMin = Number(config.SAFETY_MARGIN_MIN ?? 10);
      const dist1 = distKm(nearestBase, it);
      const dist2 = distKm(it, nearestBase);
      const need = Math.round(dwell + etaMin(dist1) + etaMin(dist2));
      const haveAtPost = Math.round((it.expires_at - safetyMarginMin * 60000 - it.created_at) / 60000);

      const isImpossibleFromStart = haveAtPost < need;
      const code = isImpossibleFromStart ? REASON_CODES.CANNOT_REACH_IN_TIME : REASON_CODES.NOT_ENOUGH_FOOD;
      const text = isImpossibleFromStart
        ? reasonText(code, { need, have: Math.max(0, Math.round((it.expires_at - safetyMarginMin * 60000 - now) / 60000)) })
        : reasonText(code, { have: it.meals, min: config.MIN_TRIP_MEALS });

      db.prepare(`
        UPDATE items
        SET status = 'LEFT_OUT',
            note_code = ?,
            note_text = ?,
            final_reason_code = ?,
            final_reason_text = ?,
            retry_at = NULL
        WHERE id = ?
      `).run(code, text, code, text, it.id);

      db.prepare(`
        INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
        VALUES (?, ?, 'ITEM_LEFT_OUT', 'item', ?, ?)
      `).run(crypto.randomUUID(), now, it.id, text);
    }
  }
}

function advanceWaves(db, now, config) {
  const offeredTrips = db.prepare("SELECT * FROM trips WHERE status = 'OFFERED'").all();

  for (const trip of offeredTrips) {
    // Check pending notifications for this trip
    const notified = db.prepare(`
      SELECT * FROM trip_notified WHERE trip_id = ?
    `).all(trip.id);

    for (const notif of notified) {
      if (notif.response === 'PENDING' && notif.window_ends_at <= now) {
        db.prepare(`
          UPDATE trip_notified SET response = 'TIMEOUT' WHERE trip_id = ? AND ngo_id = ?
        `).run(trip.id, notif.ngo_id);
      }
    }

    // Refresh pending count
    const pendingCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM trip_notified WHERE trip_id = ? AND response = 'PENDING'
    `).get(trip.id).cnt;

    const waveEnded = trip.wave_ends_at <= now || pendingCount === 0;

    if (waveEnded) {
      let nextWaveNo = trip.wave_no + 1;
      let nextWaveFound = false;

      // Find trip items
      const tripItems = db.prepare(`
        SELECT i.* FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(trip.id);

      if (tripItems.length === 0) {
        db.prepare("UPDATE trips SET status = 'CANCELLED' WHERE id = ?").run(trip.id);
        continue;
      }

      const seedItem = tripItems[0];
      const minLeft = Math.floor((seedItem.expires_at - now) / 60000);
      const isUrgent = urgency(minLeft) === 'URGENT';

      while (nextWaveNo <= 4 && !nextWaveFound) {
        const waveConfig = DEFAULT_WAVES.find((w) => w.waveNo === nextWaveNo) || DEFAULT_WAVES[3];
        const waveWindowSec = isUrgent ? waveConfig.urgentSec : waveConfig.windowSec;

        // Find eligible NGOs in this nextWave
        const candidates = db.prepare(`
          SELECT n.*, u.id as user_id FROM ngos n
          JOIN users u ON n.user_id = u.id
          WHERE n.online = 1
            AND (? - n.last_gps_at) <= ?
            AND n.user_id NOT IN (
              SELECT DISTINCT ngo_id FROM trips WHERE status IN ('ASSIGNED', 'IN_PROGRESS') AND ngo_id IS NOT NULL
            )
            AND n.user_id NOT IN (
              SELECT DISTINCT ngo_id FROM trip_notified WHERE trip_id = ? AND response IN ('DECLINED', 'TIMEOUT')
            )
        `).all(now, (Number(config.GPS_FRESH_SEC) || 180) * 1000, trip.id);

        const eligible = [];
        for (const ngo of candidates) {
          // Diet & form compatibility
          if (seedItem.diet === 'veg' && !ngo.accepts_veg) continue;
          if (seedItem.diet === 'nonveg' && !ngo.accepts_nonveg) continue;
          if (seedItem.form === 'cooked' && !ngo.accepts_cooked) continue;
          if (seedItem.form === 'packed' && !ngo.accepts_packed) continue;

          // Wave radius check
          const dist = distKm({ lat: ngo.lat, lng: ngo.lng }, seedItem, Number(config.ROAD_FACTOR));
          if (dist > waveConfig.radiusKm) continue;

          // Feasibility for this NGO right now
          const plan = planTrip({
            start: { lat: ngo.lat, lng: ngo.lng },
            items: tripItems,
            receiver: { lat: ngo.base_lat, lng: ngo.base_lng },
            now,
            config
          });

          if (plan.feasible) {
            eligible.push(ngo);
          }
        }

        if (eligible.length > 0) {
          nextWaveFound = true;
          const waveEndsAt = now + waveWindowSec * 1000;
          db.prepare(`
            UPDATE trips
            SET wave_no = ?, wave_ends_at = ?
            WHERE id = ?
          `).run(nextWaveNo, waveEndsAt, trip.id);

          const insertNotif = db.prepare(`
            INSERT OR REPLACE INTO trip_notified (trip_id, ngo_id, wave_no, notified_at, window_ends_at, response)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
          `);

          for (const ngo of eligible) {
            insertNotif.run(trip.id, ngo.user_id, nextWaveNo, now, waveEndsAt);
          }
        } else {
          nextWaveNo++;
        }
      }

      if (!nextWaveFound) {
        // After wave 4 with no accept: trip becomes UNASSIGNED, items return to POOLED
        db.prepare("UPDATE trips SET status = 'UNASSIGNED' WHERE id = ?").run(trip.id);
        const retryAt = now + (Number(config.RETRY_COOLDOWN_SEC) || 120) * 1000;

        db.prepare(`
          UPDATE items
          SET status = 'POOLED', trip_id = NULL, retry_at = ?
          WHERE trip_id = ?
        `).run(retryAt, trip.id);

        // Create admin alert
        db.prepare(`
          INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
          VALUES (?, ?, 'ALERT_UNASSIGNED', 'trip', ?, 'Trip was not accepted by any NGO across 4 waves')
        `).run(crypto.randomUUID(), now, trip.id);
      }
    }
  }
}

function expireRouteOffers(db, now) {
  db.prepare(`
    UPDATE route_offers
    SET status = 'EXPIRED'
    WHERE status = 'PENDING' AND ends_at <= ?
  `).run(now);
}

function tryMidTripInsertions(db, now, config) {
  const pooled = db.prepare(`
    SELECT * FROM items
    WHERE status = 'POOLED' AND (retry_at IS NULL OR retry_at <= ?)
  `).all(now);

  if (pooled.length === 0) return;

  const activeTrips = db.prepare(`
    SELECT t.*, n.lat as ngo_lat, n.lng as ngo_lng, n.base_lat, n.base_lng, n.last_gps_at
    FROM trips t
    JOIN ngos n ON t.ngo_id = n.user_id
    WHERE t.status IN ('ASSIGNED', 'IN_PROGRESS')
      AND (? - n.last_gps_at) <= ?
  `).all(now, (Number(config.GPS_FRESH_SEC) || 180) * 1000);

  if (activeTrips.length === 0) return;

  for (const item of pooled) {
    // Check if item already has a pending route offer
    const pendingOffer = db.prepare(`
      SELECT id FROM route_offers WHERE item_id = ? AND status = 'PENDING'
    `).get(item.id);
    if (pendingOffer) continue;

    let bestTrip = null;
    let smallestDetour = Infinity;

    for (const trip of activeTrips) {
      // Get uncollected and collected items
      const stops = db.prepare(`
        SELECT i.*, ti.collected_at FROM items i
        JOIN trip_items ti ON i.id = ti.item_id
        WHERE ti.trip_id = ?
        ORDER BY ti.seq ASC
      `).all(trip.id);

      const uncollected = stops.filter((s) => !s.collected_at);
      const collected = stops.filter((s) => !!s.collected_at);

      const evalResult = evaluateMidTripInsertion({
        ngoPos: { lat: trip.ngo_lat, lng: trip.ngo_lng },
        uncollectedStops: uncollected,
        collectedItems: collected,
        newItem: item,
        receiver: { lat: trip.receiver_lat, lng: trip.receiver_lng },
        now,
        config
      });

      if (evalResult.eligible && evalResult.detour < smallestDetour) {
        smallestDetour = evalResult.detour;
        bestTrip = trip;
      }
    }

    if (bestTrip) {
      const offerId = crypto.randomUUID();
      const endsAt = now + (Number(config.ROUTE_OFFER_SEC) || 30) * 1000;
      db.prepare(`
        INSERT INTO route_offers (id, trip_id, item_id, ngo_id, detour_km, status, ends_at)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
      `).run(offerId, bestTrip.id, item.id, bestTrip.ngo_id, smallestDetour, endsAt);
    }
  }
}

function formNewTrips(db, now, config) {
  const pool = db.prepare(`
    SELECT * FROM items
    WHERE status = 'POOLED' AND (retry_at IS NULL OR retry_at <= ?)
    ORDER BY expires_at ASC
  `).all(now);

  if (pool.length === 0) return;

  const usedItemIds = new Set();
  const MIN_TRIP_MEALS = Number(config.MIN_TRIP_MEALS ?? 20);

  for (const seed of pool) {
    if (usedItemIds.has(seed.id)) continue;

    let readyTripCreated = false;
    let bestMealsNearby = seed.meals;

    // Check candidate pool around seed
    const nearbyCandidates = pool.filter((it) => {
      if (usedItemIds.has(it.id)) return false;
      if (it.diet !== seed.diet) return false;
      const d = distKm(seed, it, Number(config.ROAD_FACTOR));
      return d <= Number(config.CLUSTER_RADIUS_KM ?? 3);
    });

    const sumNearbyMeals = nearbyCandidates.reduce((s, it) => s + it.meals, 0);
    bestMealsNearby = sumNearbyMeals;

    for (const wave of DEFAULT_WAVES) {
      if (readyTripCreated) break;

      // Online NGOs within wave radius
      const ngos = db.prepare(`
        SELECT n.*, u.id as user_id FROM ngos n
        JOIN users u ON n.user_id = u.id
        WHERE n.online = 1
          AND (? - n.last_gps_at) <= ?
          AND n.user_id NOT IN (
            SELECT DISTINCT ngo_id FROM trips WHERE status IN ('ASSIGNED', 'IN_PROGRESS') AND ngo_id IS NOT NULL
          )
      `).all(now, (Number(config.GPS_FRESH_SEC) || 180) * 1000);

      // Filter NGOs by wave radius and diet/form
      const eligibleNgos = ngos.filter((ngo) => {
        if (seed.diet === 'veg' && !ngo.accepts_veg) return false;
        if (seed.diet === 'nonveg' && !ngo.accepts_nonveg) return false;
        if (seed.form === 'cooked' && !ngo.accepts_cooked) return false;
        if (seed.form === 'packed' && !ngo.accepts_packed) return false;

        const d = distKm({ lat: ngo.lat, lng: ngo.lng }, seed, Number(config.ROAD_FACTOR));
        return d <= wave.radiusKm;
      });

      // Sort by distance to seed asc
      eligibleNgos.sort((a, b) => {
        const da = distKm({ lat: a.lat, lng: a.lng }, seed, Number(config.ROAD_FACTOR));
        const dbDist = distKm({ lat: b.lat, lng: b.lng }, seed, Number(config.ROAD_FACTOR));
        return da - dbDist;
      });

      for (const ngo of eligibleNgos) {
        const r = selectTrip({
          start: { lat: ngo.lat, lng: ngo.lng },
          receiver: { lat: ngo.base_lat, lng: ngo.base_lng },
          candidates: nearbyCandidates,
          now,
          config
        });

        if (r.status === 'READY') {
          // Create trip
          const tripId = crypto.randomUUID();
          const minLeft = Math.floor((seed.expires_at - now) / 60000);
          const isUrgent = urgency(minLeft) === 'URGENT';
          const windowSec = isUrgent ? wave.urgentSec : wave.windowSec;
          const waveEndsAt = now + windowSec * 1000;

          db.prepare(`
            INSERT INTO trips (
              id, status, reference_ngo_id, receiver_lat, receiver_lng,
              total_meals, plan_json, left_out_json, deliver_at,
              wave_no, wave_ends_at, step, created_at
            ) VALUES (?, 'OFFERED', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
          `).run(
            tripId,
            ngo.user_id,
            ngo.base_lat,
            ngo.base_lng,
            r.totalMeals,
            JSON.stringify(r.plan),
            JSON.stringify(r.leftOut),
            r.plan.deliverAt,
            wave.waveNo,
            waveEndsAt,
            now
          );

          // Update items into trip
          const setItemInTrip = db.prepare(`
            UPDATE items SET status = 'IN_TRIP', trip_id = ?, note_code = NULL, note_text = NULL WHERE id = ?
          `);
          const insertTripItem = db.prepare(`
            INSERT INTO trip_items (trip_id, item_id, seq) VALUES (?, ?, ?)
          `);

          r.items.forEach((item, idx) => {
            setItemInTrip.run(tripId, item.id);
            insertTripItem.run(tripId, item.id, idx);
            usedItemIds.add(item.id);
          });

          // Set notes on left-out items (they stay POOLED)
          const setNote = db.prepare(`
            UPDATE items
            SET note_code = ?, note_text = ?, note_json = ?
            WHERE id = ?
          `);
          for (const lo of r.leftOut) {
            setNote.run(lo.code, lo.text, JSON.stringify(lo.numbers || {}), lo.itemId);
          }

          // Offer to this NGO and other eligible NGOs in this wave
          const insertNotif = db.prepare(`
            INSERT OR REPLACE INTO trip_notified (trip_id, ngo_id, wave_no, notified_at, window_ends_at, response)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
          `);
          for (const candNgo of eligibleNgos) {
            insertNotif.run(tripId, candNgo.user_id, wave.waveNo, now, waveEndsAt);
          }

          readyTripCreated = true;
          break; // Next seed
        }
      }
    }

    if (!readyTripCreated) {
      // Calculate decide-by time = latestDispatchAt
      const nearestBase = { lat: Number(config.SEED_CENTER_LAT ?? 12.9716), lng: Number(config.SEED_CENTER_LNG ?? 77.5946) };
      const latestDispatchAt = computeLatestDispatchAt({ item: seed, ngoBase: nearestBase, config });
      const text = reasonText(REASON_CODES.WAITING_FOR_FOOD, {
        have: bestMealsNearby,
        min: MIN_TRIP_MEALS,
        time: latestDispatchAt
      });
      db.prepare(`
        UPDATE items
        SET note_code = 'WAITING_FOR_FOOD',
            note_text = ?,
            note_json = ?
        WHERE id = ?
      `).run(text, JSON.stringify({ have: bestMealsNearby, min: MIN_TRIP_MEALS, time: latestDispatchAt }), seed.id);
    }
  }
}

function checkActiveTrips(db, now, config) {
  const activeTrips = db.prepare(`
    SELECT t.*, n.lat as ngo_lat, n.lng as ngo_lng, n.base_lat, n.base_lng, n.online, n.last_gps_at
    FROM trips t
    LEFT JOIN ngos n ON t.ngo_id = n.user_id
    WHERE t.status IN ('ASSIGNED', 'IN_PROGRESS')
  `).all();

  for (const trip of activeTrips) {
    // Alert: NGO went offline mid-trip
    if (trip.online === 0) {
      db.prepare(`
        INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
        VALUES (?, ?, 'ALERT_NGO_OFFLINE', 'trip', ?, 'Assigned NGO went offline mid-trip')
      `).run(crypto.randomUUID(), now, trip.id);
    }

    // Alert: No progress for 10 min after accepting
    if (trip.step === 0 && trip.assigned_at && (now - trip.assigned_at > 10 * 60 * 1000)) {
      db.prepare(`
        INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
        VALUES (?, ?, 'ALERT_NO_PROGRESS', 'trip', ?, 'No progress made 10 minutes after accepting trip')
      `).run(crypto.randomUUID(), now, trip.id);
    }

    // Check item feasibility
    const stops = db.prepare(`
      SELECT i.*, ti.collected_at FROM items i
      JOIN trip_items ti ON i.id = ti.item_id
      WHERE ti.trip_id = ?
      ORDER BY ti.seq ASC
    `).all(trip.id);

    const uncollected = stops.filter((s) => !s.collected_at);
    const collected = stops.filter((s) => !!s.collected_at);

    if (uncollected.length === 0 && collected.length === 0) continue;

    const ngoPos = { lat: trip.ngo_lat || trip.receiver_lat, lng: trip.ngo_lng || trip.receiver_lng };
    const receiverPos = { lat: trip.receiver_lat, lng: trip.receiver_lng };

    const plan = planTrip({
      start: ngoPos,
      items: uncollected,
      receiver: receiverPos,
      now,
      config
    });

    // Check collected items
    for (const c of collected) {
      const safeDeadline = c.expires_at - (Number(config.SAFETY_MARGIN_MIN) || 10) * 60000;
      if (safeDeadline < plan.deliverAt) {
        db.prepare(`
          INSERT INTO events (id, ts, kind, ref_type, ref_id, text)
          VALUES (?, ?, 'ALERT_AT_RISK', 'trip', ?, 'Collected food may arrive late at receiver')
        `).run(crypto.randomUUID(), now, trip.id);
      }
    }

    // If an uncollected item became infeasible, remove it automatically
    for (const u of uncollected) {
      if (plan.slackMin[u.id] !== undefined && plan.slackMin[u.id] < 0) {
        db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND item_id = ?').run(trip.id, u.id);
        const code = REASON_CODES.WOULD_MAKE_TRIP_LATE;
        const text = reasonText(code, { late: Math.round(Math.abs(plan.slackMin[u.id])), title: u.title });
        db.prepare(`
          UPDATE items
          SET status = 'POOLED', trip_id = NULL, note_code = ?, note_text = ?
          WHERE id = ?
        `).run(code, text, u.id);
      }
    }
  }
}
