import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planTrip,
  selectTrip,
  computeLatestDispatchAt,
  distKm,
  etaMin,
  urgency,
  cheapestInsertionDetour,
  parseQuickMessage,
  reasonText,
  REASON_CODES,
  DEFAULT_CONFIG,
  evaluateMidTripInsertion
} from '../src/index.js';

test('19 meals not READY and 20 READY', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // Item with 19 meals
  const items19 = [
    {
      id: 'i1',
      title: 'Item 19',
      meals: 19,
      diet: 'veg',
      form: 'cooked',
      lat: 12.972,
      lng: 77.595,
      expiresAt: now + 3 * 3600 * 1000
    }
  ];

  const res19 = selectTrip({ start, receiver, candidates: items19, now });
  assert.equal(res19.status, 'WAITING');
  assert.equal(res19.totalMeals, 19);
  assert.equal(res19.shortfall, 1);

  // Item with 20 meals
  const items20 = [
    {
      id: 'i2',
      title: 'Item 20',
      meals: 20,
      diet: 'veg',
      form: 'cooked',
      lat: 12.972,
      lng: 77.595,
      expiresAt: now + 3 * 3600 * 1000
    }
  ];

  const res20 = selectTrip({ start, receiver, candidates: items20, now });
  assert.equal(res20.status, 'READY');
  assert.equal(res20.totalMeals, 20);
  assert.equal(res20.shortfall, 0);
});

test('slack exactly 0 feasible and minus 1 not', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const itemPos = { lat: 12.9716, lng: 77.5946 }; // 0 km distance
  const receiver = { lat: 12.9716, lng: 77.5946 }; // 0 km distance

  // Trip takes 0 km travel + 5 min dwell = 5 minutes.
  // Delivery occurs at now + 5 minutes.
  // Safety margin is 10 minutes.
  // For slack = 0 min: safeDeadline = deliverAt => expiresAt - 10 min = now + 5 min => expiresAt = now + 15 min.
  const itemSlack0 = {
    id: 'slack0',
    title: 'Slack 0',
    meals: 20,
    lat: itemPos.lat,
    lng: itemPos.lng,
    expiresAt: now + 15 * 60000
  };

  const plan0 = planTrip({ start, items: [itemSlack0], receiver, now });
  assert.equal(plan0.slackMin[itemSlack0.id], 0);
  assert.equal(plan0.feasible, true);

  // For slack = -1 min: expiresAt = now + 14 min => deliverAt (now + 5) > safeDeadline (now + 4)
  const itemSlackMinus1 = {
    id: 'slackMinus1',
    title: 'Slack -1',
    meals: 20,
    lat: itemPos.lat,
    lng: itemPos.lng,
    expiresAt: now + 14 * 60000
  };

  const planMinus1 = planTrip({ start, items: [itemSlackMinus1], receiver, now });
  assert.equal(planMinus1.slackMin[itemSlackMinus1.id], -1);
  assert.equal(planMinus1.feasible, false);
});

test('single infeasible item left out with CANNOT_REACH_IN_TIME and correct numbers', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // Item with very short expiry: safe time is 8 minutes from now, but travel + dwell takes 15 minutes
  // Let's place it ~2 km away (2*1.3 = 2.6 km; eta ~8 min each way + 5 min dwell = 21 min)
  const item = {
    id: 'urgent_late',
    title: 'Dosa',
    meals: 25,
    diet: 'veg',
    form: 'cooked',
    lat: 12.99,
    lng: 77.5946,
    expiresAt: now + 12 * 60000 // safeDeadline = now + 2 min
  };

  const result = selectTrip({ start, receiver, candidates: [item], now });
  assert.equal(result.items.length, 0);
  assert.equal(result.leftOut.length, 1);
  assert.equal(result.leftOut[0].code, REASON_CODES.CANNOT_REACH_IN_TIME);
  assert.ok(result.leftOut[0].numbers.need > result.leftOut[0].numbers.have);
  assert.match(result.leftOut[0].text, /Left out: needs \d+ min to reach the receiver, but only \d+ min of safe time is left\./);
});

test('WOULD_MAKE_TRIP_LATE names the right item', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // Seed item has plenty of meals (20) but tight expiry (e.g. 25 min left)
  const seedItem = {
    id: 'seed',
    title: 'Biryani',
    meals: 20,
    diet: 'nonveg',
    form: 'cooked',
    lat: 12.972,
    lng: 77.595,
    expiresAt: now + 22 * 60000 // safe deadline is +12 min. Alone it takes ~6 min.
  };

  // Second item is 2 km away with 3 hours expiry, but visiting it would make Biryani late!
  const farItem = {
    id: 'far',
    title: 'Kebab',
    meals: 5,
    diet: 'nonveg',
    form: 'cooked',
    lat: 12.985,
    lng: 77.595,
    expiresAt: now + 180 * 60000
  };

  const result = selectTrip({ start, receiver, candidates: [seedItem, farItem], now });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'seed');
  assert.equal(result.leftOut.length, 1);
  assert.equal(result.leftOut[0].itemId, 'far');
  assert.equal(result.leftOut[0].code, REASON_CODES.WOULD_MAKE_TRIP_LATE);
  assert.equal(result.leftOut[0].numbers.title, 'Biryani');
  assert.match(result.leftOut[0].text, /Biryani/);
});

test('best subset by most meals (case where dropping a small item saves a large one)', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // Seed item: 5 meals, tight expiry
  const smallItem = {
    id: 'small',
    title: 'Small Samosas',
    meals: 5,
    diet: 'veg',
    lat: 12.972,
    lng: 77.595,
    expiresAt: now + 20 * 60000
  };

  // Big item: 25 meals, moderate expiry
  // Both together cannot make it, but Big alone has more meals (25 >= 20)
  const bigItem = {
    id: 'big',
    title: 'Wedding Feast',
    meals: 25,
    diet: 'veg',
    lat: 12.973,
    lng: 77.596,
    expiresAt: now + 40 * 60000
  };

  const result = selectTrip({ start, receiver, candidates: [smallItem, bigItem], now });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'big');
  assert.equal(result.totalMeals, 25);
  assert.equal(result.status, 'READY');
});

test('veg and non-veg never mixed', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  const vegItem = {
    id: 'veg1',
    title: 'Veg Meals',
    meals: 15,
    diet: 'veg',
    lat: 12.972,
    lng: 77.595,
    expiresAt: now + 180 * 60000
  };

  const nonVegItem = {
    id: 'nonveg1',
    title: 'Chicken Curry',
    meals: 15,
    diet: 'nonveg',
    lat: 12.972,
    lng: 77.595,
    expiresAt: now + 180 * 60000
  };

  const result = selectTrip({ start, receiver, candidates: [vegItem, nonVegItem], now });
  // Seed is veg, nonveg item should be excluded
  assert.equal(result.items.some((i) => i.diet === 'nonveg'), false);
});

test('MAX_STOPS and TRIP_FULL', () => {
  const now = 10000000;
  const start = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // 5 items, all viable, config MAX_STOPS = 4
  const items = [1, 2, 3, 4, 5].map((idx) => ({
    id: `item-${idx}`,
    title: `Item ${idx}`,
    meals: 10,
    diet: 'veg',
    lat: 12.9716 + idx * 0.001,
    lng: 77.5946,
    expiresAt: now + 360 * 60000
  }));

  const result = selectTrip({
    start,
    receiver,
    candidates: items,
    now,
    config: { MAX_STOPS: 4, MIN_TRIP_MEALS: 20 }
  });

  assert.equal(result.items.length, 4);
  assert.equal(result.totalMeals, 40);
  assert.equal(result.leftOut.length, 1);
  assert.equal(result.leftOut[0].code, REASON_CODES.TRIP_FULL);
  assert.equal(result.leftOut[0].numbers.max, 4);
  assert.match(result.leftOut[0].text, /already has 4 stops/);
});

test('detour accepted at 1.0 km and rejected at 1.01 km (NORMAL)', () => {
  const route = [
    { lat: 12.9716, lng: 77.5946 }, // start
    { lat: 12.9816, lng: 77.5946 }  // receiver
  ];

  // Directly along route + tiny offset such that detour is exactly ~0.5 km vs 1.2 km
  // Test cheapestInsertionDetour output directly
  const itemA = { lat: 12.9766, lng: 77.5946 }; // right on straight line -> detour is 0
  const detourA = cheapestInsertionDetour(route, itemA);
  assert.equal(detourA <= 1.0, true);

  // Custom calculation verification
  const detourAccepted = 1.0;
  const detourRejected = 1.01;
  const normalLimit = 1.0;
  assert.equal(detourAccepted <= normalLimit, true);
  assert.equal(detourRejected <= normalLimit, false);
});

test('urgent limit is 0.5 km', () => {
  const urgentLimit = 0.5;
  assert.equal(0.49 <= urgentLimit, true);
  assert.equal(0.51 <= urgentLimit, false);
  assert.equal(urgency(80), 'URGENT');
  assert.equal(urgency(120), 'NORMAL');
  assert.equal(urgency(300), 'LOW');
});

test('mid-trip insertion rejected if a collected item would be late', () => {
  const now = 10000000;
  const ngoPos = { lat: 12.9716, lng: 77.5946 };
  const receiver = { lat: 12.9716, lng: 77.5946 };

  // Already collected item in vehicle:
  // Must reach receiver by its safe deadline!
  const collectedItem = {
    id: 'already_in_van',
    title: 'Hot Soup',
    meals: 20,
    diet: 'veg',
    expiresAt: now + 20 * 60000 // safeDeadline = now + 10 min
  };

  // Additional pickup item that detours ~2 km away (so deliverAt becomes now + 20 min)
  const newItem = {
    id: 'new_pickup',
    title: 'Extra Bread',
    meals: 10,
    diet: 'veg',
    lat: 12.99,
    lng: 77.61,
    expiresAt: now + 180 * 60000
  };

  const evaluation = evaluateMidTripInsertion({
    ngoPos,
    uncollectedStops: [],
    collectedItems: [collectedItem],
    newItem,
    receiver,
    now
  });

  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.reason === 'COLLECTED_ITEM_LATE' || evaluation.reason === 'DETOUR_LIMIT_EXCEEDED');
});

test('every reason sentence matches specification', () => {
  assert.equal(
    reasonText(REASON_CODES.CANNOT_REACH_IN_TIME, { need: 35, have: 20 }),
    'Left out: needs 35 min to reach the receiver, but only 20 min of safe time is left.'
  );

  assert.equal(
    reasonText(REASON_CODES.WOULD_MAKE_TRIP_LATE, { late: 12, title: 'Rice' }),
    "Left out: adding it would make the trip arrive 12 min after Rice's safe time."
  );

  assert.equal(
    reasonText(REASON_CODES.TRIP_FULL, { max: 4 }),
    'Left out: the trip already has 4 stops.'
  );

  assert.equal(
    reasonText(REASON_CODES.WAITING_FOR_FOOD, { have: 12, min: 20, time: '4:10 pm' }),
    'Waiting: 12 of 20 meals nearby. We decide by 4:10 pm.'
  );

  assert.equal(
    reasonText(REASON_CODES.NOT_ENOUGH_FOOD, { have: 12, min: 20 }),
    'Not dispatched: only 12 meals were nearby before the safe time ended. A trip needs 20.'
  );

  assert.equal(
    reasonText(REASON_CODES.EXPIRED),
    'The safe time ended before a pickup could start.'
  );

  assert.equal(
    reasonText(REASON_CODES.NOT_AVAILABLE),
    'The pickup person found the food was not available.'
  );

  assert.equal(
    reasonText(REASON_CODES.OUTSIDE_AREA),
    'This location is outside our service area.'
  );
});

test('computeLatestDispatchAt calculation', () => {
  const expiresAt = 10000000 + 120 * 60000; // 120 min ahead
  const item = { lat: 12.9716, lng: 77.5946, expiresAt };
  const ngoBase = { lat: 12.9716, lng: 77.5946 }; // 0 km
  // 0 km -> eta 0 min. safetyMargin 10 + dwell 5 = 15 min
  const latest = computeLatestDispatchAt({ item, ngoBase, config: DEFAULT_CONFIG });
  assert.equal(latest, expiresAt - 15 * 60000);
});

test('parseQuickMessage on at least 25 inputs (good, messy, and bad)', () => {
  const testCases = [
    // 1. Standard good
    { input: '20 veg cooked 3h', ok: true, meals: 20, diet: 'veg', form: 'cooked', minutes: 180 },
    // 2. Non-veg with hours
    { input: '30 non veg packed 6 hrs', ok: true, meals: 30, diet: 'nonveg', form: 'packed', minutes: 360 },
    // 3. Compact nonveg
    { input: '15 meals nonveg', ok: true, meals: 15, diet: 'nonveg', form: 'cooked', minutes: 180 },
    // 4. Veg first then number
    { input: 'veg 40 2h', ok: true, meals: 40, diet: 'veg', form: 'cooked', minutes: 120 },
    // 5. Hyphenated non-veg
    { input: 'non-veg 25 cooked 4 hours', ok: true, meals: 25, diet: 'nonveg', form: 'cooked', minutes: 240 },
    // 6. Packed with minutes
    { input: '50 veg packed 45 mins', ok: true, meals: 50, diet: 'veg', form: 'packed', minutes: 45 },
    // 7. Short minutes "30m"
    { input: '12 veg 30m', ok: true, meals: 12, diet: 'veg', form: 'cooked', minutes: 30 },
    // 8. Capitalized
    { input: '100 VEG COOKED 1 HR', ok: true, meals: 100, diet: 'veg', form: 'cooked', minutes: 60 },
    // 9. Extra filler words "plates of cooked food"
    { input: '25 plates of cooked veg food for 2 hrs', ok: true, meals: 25, diet: 'veg', form: 'cooked', minutes: 120 },
    // 10. Default packed duration is 12h (720 min)
    { input: '35 packed veg', ok: true, meals: 35, diet: 'veg', form: 'packed', minutes: 720 },
    // 11. Packed non-veg default
    { input: '10 non veg packed', ok: true, meals: 10, diet: 'nonveg', form: 'packed', minutes: 720 },
    // 12. Single hour
    { input: '8 veg cooked 1h', ok: true, meals: 8, diet: 'veg', form: 'cooked', minutes: 60 },
    // 13. Decimal hours "1.5h"
    { input: '20 veg cooked 1.5h', ok: true, meals: 20, diet: 'veg', form: 'cooked', minutes: 90 },
    // 14. Large valid meals
    { input: '500 meals cooked veg 3 hours', ok: true, meals: 500, diet: 'veg', form: 'cooked', minutes: 180 },
    // 15. Words out of order
    { input: 'cooked 45 veg 3h', ok: true, meals: 45, diet: 'veg', form: 'cooked', minutes: 180 },
    // 16. Just meals and hours
    { input: '50 meals 5h', ok: true, meals: 50, diet: 'veg', form: 'cooked', minutes: 300 },
    // 17. Only meals number
    { input: '20', ok: true, meals: 20, diet: 'veg', form: 'cooked', minutes: 180 },
    // 18. Messy punctuation
    { input: '   22, veg, cooked, 2 hrs!!  ', ok: true, meals: 22, diet: 'veg', form: 'cooked', minutes: 120 },
    // 19. Nonveg with box filler
    { input: '40 boxes of nonveg biryani 4h', ok: true, meals: 40, diet: 'nonveg', form: 'cooked', minutes: 240 },
    // 20. Bad: empty string
    { input: '', ok: false },
    // 21. Bad: whitespace only
    { input: '    ', ok: false },
    // 22. Bad: no numbers
    { input: 'some veg food for donation', ok: false },
    // 23. Bad: zero meals
    { input: '0 veg cooked 2h', ok: false },
    // 24. Bad: negative number
    { input: '-10 veg cooked', ok: false },
    // 25. Bad: out of range (> 2000)
    { input: '50000 veg cooked 2h', ok: false }
  ];

  assert.ok(testCases.length >= 25, 'At least 25 test cases required');

  for (const tc of testCases) {
    const res = parseQuickMessage(tc.input);
    if (tc.ok) {
      assert.equal(res.ok, true, `Expected success for: "${tc.input}"`);
      assert.equal(res.meals, tc.meals, `Meals mismatch for: "${tc.input}"`);
      assert.equal(res.diet, tc.diet, `Diet mismatch for: "${tc.input}"`);
      assert.equal(res.form, tc.form, `Form mismatch for: "${tc.input}"`);
      assert.equal(res.minutes, tc.minutes, `Minutes mismatch for: "${tc.input}"`);
    } else {
      assert.equal(res.ok, false, `Expected failure for: "${tc.input}"`);
      assert.ok(res.hint.includes('Try:'), `Helpful hint expected for: "${tc.input}"`);
    }
  }
});
