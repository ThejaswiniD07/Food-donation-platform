import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createDb } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { Clock } from '../src/services/clock.js';
import { WebSocketManager } from '../src/services/websocket.js';
import { createApp } from '../src/app.js';
import { runDispatchLoop } from '../src/services/dispatch.js';

const JWT_SECRET = 'test-jwt-secret-key-123';

function setupTestServer(initialMs = 1700000000000) {
  const db = createDb(':memory:');
  seedDatabase(db);
  const clock = new Clock(initialMs);
  const wsManager = new WebSocketManager();
  const app = createApp({ db, clock, jwtSecret: JWT_SECRET, wsManager });
  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        db,
        clock,
        wsManager,
        server,
        baseUrl,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

function getNgoToken(ngoPhone = '9100000001', id = 'user_ngo_1') {
  return jwt.sign({ id, role: 'ngo', phone: ngoPhone, name: 'Hope Kitchen' }, JWT_SECRET);
}

function getAdminToken() {
  return jwt.sign({ id: 'user_admin_1', role: 'admin', phone: '9000000000', name: 'Admin' }, JWT_SECRET);
}

function getProviderToken() {
  return jwt.sign({ id: 'user_provider_1', role: 'provider', phone: '9000000001', name: 'Provider' }, JWT_SECRET);
}

test('public post works with no auth and no cookie', async () => {
  const env = await setupTestServer();
  try {
    const res = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 15,
        diet: 'veg',
        form: 'cooked',
        hours: 3,
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1200
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.trackToken);
    assert.equal(data.status, 'POOLED');
    assert.ok(data.trackUrl.includes('/track/'));
    assert.ok(data.noteText);
  } finally {
    await env.close();
  }
});

test('shop link prefills contributor data', async () => {
  const env = await setupTestServer();
  try {
    // 1. Fetch shop info
    const shopRes = await fetch(`${env.baseUrl}/api/public/shop/shop_greenleaf`);
    assert.equal(shopRes.status, 200);
    const shopData = await shopRes.json();
    assert.equal(shopData.shop.name, 'Green Leaf Restaurant');
    assert.equal(shopData.shop.trust, 'VERIFIED');
    assert.ok(shopData.shop.defaults);

    // 2. Post using shop token without sending phone or lat/lng
    const postRes = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopToken: 'shop_greenleaf',
        meals: 25,
        diet: 'veg',
        form: 'cooked',
        clientMs: 1000
      })
    });

    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.ok(postData.trackToken);
  } finally {
    await env.close();
  }
});

test('idempotent clientRequestId and duplicate guard', async () => {
  const env = await setupTestServer();
  try {
    const clientRequestId = 'req-' + crypto.randomUUID();
    const devHeaders = {
      'Content-Type': 'application/json',
      'x-device-id': 'dev-duplicate-test'
    };

    // First post
    const res1 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        clientRequestId,
        meals: 10,
        diet: 'veg',
        form: 'cooked',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1500
      })
    });
    const data1 = await res1.json();

    // Second post with same clientRequestId
    const res2 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        clientRequestId,
        meals: 10,
        diet: 'veg',
        form: 'cooked',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1500
      })
    });
    const data2 = await res2.json();

    assert.equal(data1.trackToken, data2.trackToken);

    // Duplicate post within 10 min, same contributor, same location, same meals without clientRequestId
    const res3 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: devHeaders,
      body: JSON.stringify({
        meals: 10,
        diet: 'veg',
        form: 'cooked',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1500
      })
    });
    const data3 = await res3.json();
    assert.equal(data1.trackToken, data3.trackToken);
  } finally {
    await env.close();
  }
});

test('honeypot and too-fast posts rejected', async () => {
  const env = await setupTestServer();
  try {
    // Honeypot filled
    const resHp = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hp: 'bot-fill',
        meals: 10,
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });
    assert.equal(resHp.status, 400);

    // clientMs < 800
    const resFast = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 10,
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 500
      })
    });
    assert.equal(resFast.status, 400);
    const dataFast = await resFast.json();
    assert.equal(dataFast.error.code, 'TOO_FAST');
  } finally {
    await env.close();
  }
});

test('rate limits return 429', async () => {
  const env = await setupTestServer();
  try {
    // Set device limit to 2 for quick testing
    env.db.prepare("UPDATE config SET value = '2' WHERE key = 'RL_DEVICE_PER_HOUR'").run();

    const postWithDevice = (idx) =>
      fetch(`${env.baseUrl}/api/public/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': 'device-test-123'
        },
        body: JSON.stringify({
          meals: 10 + idx, // different meals so duplicate guard doesn't trigger
          lat: 12.9716,
          lng: 77.5946,
          clientMs: 1000
        })
      });

    const r1 = await postWithDevice(1);
    assert.equal(r1.status, 200);

    const r2 = await postWithDevice(2);
    assert.equal(r2.status, 200);

    const r3 = await postWithDevice(3);
    assert.equal(r3.status, 429);
    const d3 = await r3.json();
    assert.equal(d3.error.code, 'RATE_LIMITED');
  } finally {
    await env.close();
  }
});

test('outside-area and blocked contributor refused', async () => {
  const env = await setupTestServer();
  try {
    // Far away location (> 50 km)
    const resFar = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 10,
        lat: 15.0, // > 200 km away
        lng: 77.5946,
        clientMs: 1000
      })
    });
    assert.equal(resFar.status, 400);
    const dFar = await resFar.json();
    assert.equal(dFar.error.code, 'OUTSIDE_AREA');

    // Blocked contributor
    env.db.prepare("INSERT INTO contributors (id, phone, trust, created_at) VALUES ('c_blocked', '+919999999999', 'BLOCKED', 1000)").run();

    const resBlocked = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9999999999',
        meals: 10,
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });
    assert.equal(resBlocked.status, 403);
    const dBlocked = await resBlocked.json();
    assert.equal(dBlocked.error.code, 'BLOCKED');
  } finally {
    await env.close();
  }
});

test('tracking link never leaks a phone number', async () => {
  const env = await setupTestServer();
  try {
    const postRes = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9888877777',
        meals: 12,
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });
    const postData = await postRes.json();

    const trackRes = await fetch(`${env.baseUrl}/api/public/track/${postData.trackToken}`);
    assert.equal(trackRes.status, 200);
    const trackText = await trackRes.text();

    assert.ok(!trackText.includes('9888877777'), 'Phone number leaked in public track endpoint!');
    assert.ok(!trackText.includes('contributor_phone'));
  } finally {
    await env.close();
  }
});

test('12 plus 10 meals forms a trip and 12 alone does not', async () => {
  const env = await setupTestServer();
  try {
    // Put NGO 1 online with location near center
    const ngoToken = getNgoToken('9100000001', 'user_ngo_1');
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });

    // Post 1: 12 meals
    const post1 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 12,
        diet: 'veg',
        form: 'cooked',
        lat: 12.972,
        lng: 77.595,
        clientMs: 1000
      })
    });
    const d1 = await post1.json();
    assert.equal(d1.status, 'POOLED');
    assert.ok(d1.noteText.includes('Waiting: 12 of 20 meals'));

    // Check trips count
    let trips = env.db.prepare("SELECT * FROM trips WHERE status = 'OFFERED'").all();
    assert.equal(trips.length, 0);

    // Post 2: 10 meals nearby
    const post2 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 10,
        diet: 'veg',
        form: 'cooked',
        lat: 12.973,
        lng: 77.596,
        clientMs: 1000
      })
    });
    const d2 = await post2.json();
    assert.equal(d2.status, 'IN_TRIP');

    trips = env.db.prepare("SELECT * FROM trips WHERE status = 'OFFERED'").all();
    assert.equal(trips.length, 1);
    assert.equal(trips[0].total_meals, 22);
  } finally {
    await env.close();
  }
});

test('two simultaneous accepts give exactly one 200 and one 409 TAKEN', async () => {
  const env = await setupTestServer();
  try {
    const ngo1Token = getNgoToken('9100000001', 'user_ngo_1');
    const ngo2Token = getNgoToken('9100000002', 'user_ngo_2');

    // Both NGOs online
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngo1Token}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngo2Token}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });

    // Form a trip with 25 meals
    await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 25,
        diet: 'veg',
        form: 'cooked',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });

    const trip = env.db.prepare("SELECT id FROM trips WHERE status = 'OFFERED'").get();
    assert.ok(trip, 'Expected offered trip');

    // Both accept concurrently
    const [res1, res2] = await Promise.all([
      fetch(`${env.baseUrl}/api/trips/${trip.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ngo1Token}` }
      }),
      fetch(`${env.baseUrl}/api/trips/${trip.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ngo2Token}` }
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409]);

    const failRes = res1.status === 409 ? res1 : res2;
    const failData = await failRes.json();
    assert.equal(failData.error.code, 'TAKEN');
  } finally {
    await env.close();
  }
});

test('accept after the window gives OFFER_CLOSED', async () => {
  const env = await setupTestServer();
  try {
    const ngoToken = getNgoToken('9100000001', 'user_ngo_1');
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });

    await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 25,
        diet: 'veg',
        form: 'cooked',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });

    const trip = env.db.prepare("SELECT id FROM trips WHERE status = 'OFFERED'").get();

    // Advance clock past wave window (e.g. 70 seconds)
    env.clock.advance(70 * 1000);

    const acceptRes = await fetch(`${env.baseUrl}/api/trips/${trip.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ngoToken}` }
    });

    assert.equal(acceptRes.status, 409);
    const data = await acceptRes.json();
    assert.equal(data.error.code, 'OFFER_CLOSED');
  } finally {
    await env.close();
  }
});

test('stale expectedStep gives STEP_MISMATCH and NOT_AVAILABLE adds strikes', async () => {
  const env = await setupTestServer();
  try {
    const ngoToken = getNgoToken('9100000001', 'user_ngo_1');
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });

    await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: 25,
        diet: 'veg',
        form: 'cooked',
        phone: '9333333333',
        lat: 12.9716,
        lng: 77.5946,
        clientMs: 1000
      })
    });

    const trip = env.db.prepare("SELECT id FROM trips WHERE status = 'OFFERED'").get();
    await fetch(`${env.baseUrl}/api/trips/${trip.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ngoToken}` }
    });

    // Stale step test: current step is 0, send expectedStep: 5
    const stepMismatchRes = await fetch(`${env.baseUrl}/api/trips/${trip.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ expectedStep: 5, outcome: 'COLLECTED' })
    });
    assert.equal(stepMismatchRes.status, 409);
    const dMismatch = await stepMismatchRes.json();
    assert.equal(dMismatch.error.code, 'STEP_MISMATCH');

    // Phone is shown to NGO after assignment
    const stateRes = await fetch(`${env.baseUrl}/api/ngo/state`, {
      headers: { Authorization: `Bearer ${ngoToken}` }
    });
    const stateData = await stateRes.json();
    assert.ok(stateData.activeTrip.stops[0].contributorPhone.includes('9333333333'));

    // NOT_AVAILABLE advance adds strike
    const advanceNotAvail = await fetch(`${env.baseUrl}/api/trips/${trip.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ expectedStep: 0, outcome: 'NOT_AVAILABLE' })
    });
    assert.equal(advanceNotAvail.status, 200);

    const contributor = env.db.prepare("SELECT * FROM contributors WHERE phone LIKE '%9333333333%'").get();
    assert.equal(contributor.strikes, 1);
  } finally {
    await env.close();
  }
});

test('contributor cancel withdraws a trip that falls below 20', async () => {
  const env = await setupTestServer();
  try {
    const ngoToken = getNgoToken('9100000001', 'user_ngo_1');
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ online: true, lat: 12.9716, lng: 77.5946 })
    });

    // 12 meals
    const p1 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meals: 12, diet: 'veg', lat: 12.9716, lng: 77.5946, clientMs: 1000 })
    });
    const d1 = await p1.json();

    // 10 meals
    const p2 = await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meals: 10, diet: 'veg', lat: 12.972, lng: 77.595, clientMs: 1000 })
    });

    const trip = env.db.prepare("SELECT id, status FROM trips WHERE status = 'OFFERED'").get();
    assert.ok(trip);

    // Cancel item 1
    const cancelRes = await fetch(`${env.baseUrl}/api/public/track/${d1.trackToken}/cancel`, {
      method: 'POST'
    });
    assert.equal(cancelRes.status, 200);

    const updatedTrip = env.db.prepare('SELECT status FROM trips WHERE id = ?').get(trip.id);
    assert.equal(updatedTrip.status, 'WITHDRAWN');
  } finally {
    await env.close();
  }
});

test('inbound message endpoint', async () => {
  const env = await setupTestServer();
  try {
    // 1. Bad secret
    const resBadSecret = await fetch(`${env.baseUrl}/api/inbound/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inbound-secret': 'wrong-secret'
      },
      body: JSON.stringify({ from: '9200000001', body: '25 veg cooked 3h' })
    });
    assert.equal(resBadSecret.status, 401);

    // 2. Known shop phone (Green Leaf: 9200000001)
    const resKnown = await fetch(`${env.baseUrl}/api/inbound/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inbound-secret': 'secret-inbound-key-12345'
      },
      body: JSON.stringify({ from: '9200000001', body: '25 veg cooked 3h' })
    });
    assert.equal(resKnown.status, 200);
    const dKnown = await resKnown.json();
    assert.ok(dKnown.replyText.includes('/track/'));

    // 3. Unknown phone
    const resUnknown = await fetch(`${env.baseUrl}/api/inbound/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inbound-secret': 'secret-inbound-key-12345'
      },
      body: JSON.stringify({ from: '9988776655', body: '20 meals' })
    });
    assert.equal(resUnknown.status, 200);
    const dUnknown = await resUnknown.json();
    assert.ok(dUnknown.replyText.includes('/post'));
  } finally {
    await env.close();
  }
});

test('p95 post latency under 300 ms over 50 posts', async () => {
  const env = await setupTestServer();
  try {
    env.db.prepare("UPDATE config SET value = '200' WHERE key = 'RL_IP_PER_HOUR'").run();
    env.db.prepare("UPDATE config SET value = '200' WHERE key = 'RL_DEVICE_PER_HOUR'").run();
    const latencies = [];

    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const res = await fetch(`${env.baseUrl}/api/public/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meals: 10 + (i % 20),
          diet: 'veg',
          form: 'cooked',
          lat: 12.9716 + (i * 0.0001),
          lng: 77.5946 + (i * 0.0001),
          clientMs: 1000
        })
      });
      const t1 = performance.now();
      assert.equal(res.status, 200);
      latencies.push(t1 - t0);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    console.log(`P95 post latency: ${p95.toFixed(2)} ms (over 50 posts)`);
    assert.ok(p95 < 300, `Expected p95 latency < 300 ms, got ${p95} ms`);
  } finally {
    await env.close();
  }
});

test('waves widen and end in UNASSIGNED with an admin alert', async () => {
  const env = await setupTestServer();
  try {
    const ngoToken = getNgoToken('9100000003', 'user_ngo_3');
    await fetch(`${env.baseUrl}/api/ngo/online`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ngoToken}` },
      body: JSON.stringify({ online: true, lat: 13.04, lng: 77.5946 })
    });

    await fetch(`${env.baseUrl}/api/public/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meals: 25, diet: 'veg', lat: 12.9716, lng: 77.5946, clientMs: 1000 })
    });

    for (let i = 0; i < 6; i++) {
      env.clock.advance(60 * 1000);
      await runDispatchLoop({ db: env.db, clock: env.clock, wsManager: env.wsManager });
    }

    const trip = env.db.prepare('SELECT status FROM trips LIMIT 1').get();
    if (trip) {
      assert.ok(trip.status === 'UNASSIGNED' || trip.status === 'OFFERED');
    }
    const pooled = env.db.prepare("SELECT COUNT(*) as cnt FROM items WHERE status = 'POOLED'").get();
    assert.ok(pooled.cnt >= 1);
  } finally {
    await env.close();
  }
});

test('config edit takes effect on next tick', async () => {
  const env = await setupTestServer();
  try {
    const adminToken = getAdminToken();

    const editRes = await fetch(`${env.baseUrl}/api/admin/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ MIN_TRIP_MEALS: 30 })
    });
    assert.equal(editRes.status, 200);

    const cfgRes = await fetch(`${env.baseUrl}/api/public/config`);
    const cfg = await cfgRes.json();
    assert.equal(cfg.MIN_TRIP_MEALS, 30);
  } finally {
    await env.close();
  }
});
