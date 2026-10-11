import { distKm, etaMin, cheapestInsertionDetour, urgency } from './geo.js';
import { DEFAULT_CONFIG } from './constants.js';
import { REASON_CODES, reasonText } from './reasons.js';

function getExpiry(item) {
  return Number(item.expiresAt ?? item.expires_at ?? 0);
}

function getMeals(item) {
  return Number(item.meals ?? 0);
}

/**
 * Generates all permutations of an array.
 */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const subPerms = permutations(remaining);
    for (const sub of subPerms) {
      result.push([current, ...sub]);
    }
  }
  return result;
}

/**
 * Generates all non-empty combinations of an array up to maxK items.
 */
function combinations(arr, maxK) {
  const result = [];
  function fork(startIdx, current) {
    if (current.length > 0) {
      result.push([...current]);
    }
    if (current.length === maxK) return;
    for (let i = startIdx; i < arr.length; i++) {
      current.push(arr[i]);
      fork(i + 1, current);
      current.pop();
    }
  }
  fork(0, []);
  return result;
}

/**
 * Evaluates route feasibility and slack for items from start to receiver.
 */
export function planTrip({
  start,
  items = [],
  receiver,
  now,
  avgSpeedKmh,
  roadFactor,
  safetyMarginMin,
  pickupDwellMin,
  config = {}
}) {
  const speed = Number(avgSpeedKmh ?? config?.AVG_SPEED_KMH ?? DEFAULT_CONFIG.AVG_SPEED_KMH);
  const factor = Number(roadFactor ?? config?.ROAD_FACTOR ?? DEFAULT_CONFIG.ROAD_FACTOR);
  const safety = Number(safetyMarginMin ?? config?.SAFETY_MARGIN_MIN ?? DEFAULT_CONFIG.SAFETY_MARGIN_MIN);
  const dwell = Number(pickupDwellMin ?? config?.PICKUP_DWELL_MIN ?? DEFAULT_CONFIG.PICKUP_DWELL_MIN);

  if (!items || items.length === 0) {
    const directKm = distKm(start, receiver, factor);
    const deliverAt = now + etaMin(directKm, speed) * 60000;
    return {
      order: [],
      arriveAt: {},
      deliverAt,
      slackMin: {},
      minSlack: Infinity,
      feasible: true
    };
  }

  // Orderings: all permutations if <= 5 items, else earliest expiry first
  let orderings;
  if (items.length <= 5) {
    orderings = permutations(items);
  } else {
    orderings = [items.slice().sort((a, b) => getExpiry(a) - getExpiry(b))];
  }

  let bestResult = null;

  for (const ordering of orderings) {
    let t = now;
    let pos = start;
    const arriveAt = {};

    for (const item of ordering) {
      const legKm = distKm(pos, item, factor);
      t += etaMin(legKm, speed) * 60000 + dwell * 60000;
      arriveAt[item.id] = t;
      pos = item;
    }

    const finalLegKm = distKm(pos, receiver, factor);
    const deliverAt = t + etaMin(finalLegKm, speed) * 60000;

    const slackMin = {};
    for (const item of ordering) {
      const expiry = getExpiry(item);
      const safeDeadline = expiry - safety * 60000;
      slackMin[item.id] = (safeDeadline - deliverAt) / 60000;
    }

    const slackValues = Object.values(slackMin);
    const minSlack = slackValues.length === 0 ? Infinity : Math.min(...slackValues);
    const feasible = minSlack >= 0;

    const candidate = {
      order: ordering,
      arriveAt,
      deliverAt,
      slackMin,
      minSlack,
      feasible
    };

    if (!bestResult || candidate.minSlack > bestResult.minSlack) {
      bestResult = candidate;
    }
  }

  return bestResult;
}

/**
 * Selects the optimal trip from a pool of candidate items around a seed item.
 */
export function selectTrip({
  start,
  receiver,
  candidates = [],
  now,
  config = {}
}) {
  const MIN_TRIP_MEALS = Number(config.MIN_TRIP_MEALS ?? DEFAULT_CONFIG.MIN_TRIP_MEALS);
  const SAFETY_MARGIN_MIN = Number(config.SAFETY_MARGIN_MIN ?? DEFAULT_CONFIG.SAFETY_MARGIN_MIN);
  const PICKUP_DWELL_MIN = Number(config.PICKUP_DWELL_MIN ?? DEFAULT_CONFIG.PICKUP_DWELL_MIN);
  const AVG_SPEED_KMH = Number(config.AVG_SPEED_KMH ?? DEFAULT_CONFIG.AVG_SPEED_KMH);
  const ROAD_FACTOR = Number(config.ROAD_FACTOR ?? DEFAULT_CONFIG.ROAD_FACTOR);
  const CLUSTER_RADIUS_KM = Number(config.CLUSTER_RADIUS_KM ?? DEFAULT_CONFIG.CLUSTER_RADIUS_KM);
  const MAX_STOPS = Number(config.MAX_STOPS ?? DEFAULT_CONFIG.MAX_STOPS);
  const MAX_CANDIDATES = Number(config.MAX_CANDIDATES ?? DEFAULT_CONFIG.MAX_CANDIDATES);

  if (!candidates || candidates.length === 0) {
    return {
      status: 'WAITING',
      items: [],
      plan: null,
      leftOut: [],
      totalMeals: 0,
      shortfall: MIN_TRIP_MEALS
    };
  }

  const seed = candidates[0];
  const leftOut = [];

  // Step 1: Filter candidates by same diet and within CLUSTER_RADIUS_KM of seed
  const filtered = candidates.filter((item) => {
    if (item.diet !== seed.diet) {
      return false;
    }
    const distanceToSeed = distKm(seed, item, ROAD_FACTOR);
    return distanceToSeed <= CLUSTER_RADIUS_KM;
  });

  // Sort by expiresAt asc, then distance to seed asc
  filtered.sort((a, b) => {
    const expA = getExpiry(a);
    const expB = getExpiry(b);
    if (expA !== expB) return expA - expB;
    const distA = distKm(seed, a, ROAD_FACTOR);
    const distB = distKm(seed, b, ROAD_FACTOR);
    return distA - distB;
  });

  const cappedCandidates = filtered.slice(0, MAX_CANDIDATES);

  // Step 2: Test each candidate alone
  const soloFeasible = [];
  for (const candidate of cappedCandidates) {
    const soloPlan = planTrip({
      start,
      items: [candidate],
      receiver,
      now,
      avgSpeedKmh: AVG_SPEED_KMH,
      roadFactor: ROAD_FACTOR,
      safetyMarginMin: SAFETY_MARGIN_MIN,
      pickupDwellMin: PICKUP_DWELL_MIN
    });

    if (!soloPlan.feasible) {
      const leg1 = etaMin(distKm(start, candidate, ROAD_FACTOR), AVG_SPEED_KMH);
      const leg2 = etaMin(distKm(candidate, receiver, ROAD_FACTOR), AVG_SPEED_KMH);
      const need = leg1 + PICKUP_DWELL_MIN + leg2;
      const safeDeadline = getExpiry(candidate) - SAFETY_MARGIN_MIN * 60000;
      const have = Math.max(0, Math.floor((safeDeadline - now) / 60000));
      const numbers = { need, have };
      const code = REASON_CODES.CANNOT_REACH_IN_TIME;
      const text = reasonText(code, numbers);
      leftOut.push({ itemId: candidate.id, code, text, numbers });
    } else {
      soloFeasible.push(candidate);
    }
  }

  // Step 3 & 4: Find feasible subset with most meals
  const allSubsets = combinations(soloFeasible, MAX_STOPS);
  let best = [];
  let bestPlan = null;
  let bestScore = -1;

  for (const subset of allSubsets) {
    const plan = planTrip({
      start,
      items: subset,
      receiver,
      now,
      avgSpeedKmh: AVG_SPEED_KMH,
      roadFactor: ROAD_FACTOR,
      safetyMarginMin: SAFETY_MARGIN_MIN,
      pickupDwellMin: PICKUP_DWELL_MIN
    });

    if (plan.feasible) {
      const score = subset.reduce((sum, item) => sum + getMeals(item), 0);
      let isBetter = false;

      if (score > bestScore) {
        isBetter = true;
      } else if (score === bestScore) {
        // Tie breaker 1: fewer stops
        if (subset.length < best.length) {
          isBetter = true;
        } else if (subset.length === best.length) {
          // Tie breaker 2: larger minSlack
          if (plan.minSlack > (bestPlan?.minSlack ?? -Infinity)) {
            isBetter = true;
          }
        }
      }

      if (isBetter) {
        best = subset;
        bestPlan = plan;
        bestScore = score;
      }
    }
  }

  // Step 5: Check every candidate not in best
  const bestIdSet = new Set(best.map((b) => b.id));
  for (const candidate of soloFeasible) {
    if (!bestIdSet.has(candidate.id)) {
      if (best.length >= MAX_STOPS) {
        const code = REASON_CODES.TRIP_FULL;
        const numbers = { max: MAX_STOPS };
        const text = reasonText(code, numbers);
        leftOut.push({ itemId: candidate.id, code, text, numbers });
      } else {
        // WOULD_MAKE_TRIP_LATE
        const testPlan = planTrip({
          start,
          items: [...best, candidate],
          receiver,
          now,
          avgSpeedKmh: AVG_SPEED_KMH,
          roadFactor: ROAD_FACTOR,
          safetyMarginMin: SAFETY_MARGIN_MIN,
          pickupDwellMin: PICKUP_DWELL_MIN
        });

        let mostLateItem = null;
        let maxLateMin = 0;
        for (const it of [...best, candidate]) {
          const slack = testPlan.slackMin[it.id];
          if (slack < 0) {
            const late = Math.round(Math.abs(slack));
            if (late > maxLateMin) {
              maxLateMin = late;
              mostLateItem = it;
            }
          }
        }

        const late = maxLateMin || 1;
        const title = mostLateItem ? (mostLateItem.title || 'food') : (candidate.title || 'food');
        const numbers = { late, title };
        const code = REASON_CODES.WOULD_MAKE_TRIP_LATE;
        const text = reasonText(code, numbers);
        leftOut.push({ itemId: candidate.id, code, text, numbers });
      }
    }
  }

  const totalMeals = best.reduce((sum, item) => sum + getMeals(item), 0);
  const status = totalMeals >= MIN_TRIP_MEALS ? 'READY' : 'WAITING';
  const shortfall = Math.max(0, MIN_TRIP_MEALS - totalMeals);

  return {
    status,
    items: best,
    plan: bestPlan,
    leftOut,
    totalMeals,
    shortfall
  };
}

/**
 * Evaluates whether an item can be inserted mid-trip (Section 5.H).
 */
export function evaluateMidTripInsertion({
  ngoPos,
  uncollectedStops = [],
  collectedItems = [],
  newItem,
  receiver,
  now,
  config = {}
}) {
  const ROAD_FACTOR = Number(config.ROAD_FACTOR ?? DEFAULT_CONFIG.ROAD_FACTOR);
  const DETOUR_LIMIT_KM = Number(config.DETOUR_LIMIT_KM ?? DEFAULT_CONFIG.DETOUR_LIMIT_KM);
  const MAX_STOPS = Number(config.MAX_STOPS ?? DEFAULT_CONFIG.MAX_STOPS);
  const SAFETY_MARGIN_MIN = Number(config.SAFETY_MARGIN_MIN ?? DEFAULT_CONFIG.SAFETY_MARGIN_MIN);
  const AVG_SPEED_KMH = Number(config.AVG_SPEED_KMH ?? DEFAULT_CONFIG.AVG_SPEED_KMH);
  const PICKUP_DWELL_MIN = Number(config.PICKUP_DWELL_MIN ?? DEFAULT_CONFIG.PICKUP_DWELL_MIN);

  // 1. Diet compatibility
  const activeDiet = uncollectedStops[0]?.diet || collectedItems[0]?.diet;
  if (activeDiet && newItem.diet !== activeDiet) {
    return { eligible: false, reason: 'DIET_MISMATCH' };
  }

  // 2. Stop limit
  if (uncollectedStops.length + 1 > MAX_STOPS) {
    return { eligible: false, reason: 'MAX_STOPS_EXCEEDED' };
  }

  // 3. Detour calculation
  const route = [ngoPos, ...uncollectedStops, receiver];
  const detour = cheapestInsertionDetour(route, newItem, ROAD_FACTOR);
  const minLeft = Math.floor((getExpiry(newItem) - now) / 60000);
  const limit = urgency(minLeft) === 'URGENT' ? 0.5 : DETOUR_LIMIT_KM;

  if (detour > limit) {
    return { eligible: false, reason: 'DETOUR_LIMIT_EXCEEDED', detour, limit };
  }

  // 4. Plan with new uncollected stop
  const plan = planTrip({
    start: ngoPos,
    items: [...uncollectedStops, newItem],
    receiver,
    now,
    avgSpeedKmh: AVG_SPEED_KMH,
    roadFactor: ROAD_FACTOR,
    safetyMarginMin: SAFETY_MARGIN_MIN,
    pickupDwellMin: PICKUP_DWELL_MIN
  });

  if (!plan.feasible) {
    return { eligible: false, reason: 'UNCOLLECTED_STOP_INFEASIBLE', detour, plan };
  }

  // 5. Collected items must still arrive in time
  for (const collected of collectedItems) {
    const safeDeadline = getExpiry(collected) - SAFETY_MARGIN_MIN * 60000;
    const slack = (safeDeadline - plan.deliverAt) / 60000;
    if (slack < 0) {
      return {
        eligible: false,
        reason: 'COLLECTED_ITEM_LATE',
        lateItem: collected,
        slack,
        detour
      };
    }
  }

  return { eligible: true, detour, plan };
}

/**
 * Computes the latest time a dispatch can begin before the item can no longer reach an NGO base in time.
 */
export function computeLatestDispatchAt({
  item,
  ngoBase,
  config = {}
}) {
  const SAFETY_MARGIN_MIN = Number(config.SAFETY_MARGIN_MIN ?? DEFAULT_CONFIG.SAFETY_MARGIN_MIN);
  const PICKUP_DWELL_MIN = Number(config.PICKUP_DWELL_MIN ?? DEFAULT_CONFIG.PICKUP_DWELL_MIN);
  const AVG_SPEED_KMH = Number(config.AVG_SPEED_KMH ?? DEFAULT_CONFIG.AVG_SPEED_KMH);
  const ROAD_FACTOR = Number(config.ROAD_FACTOR ?? DEFAULT_CONFIG.ROAD_FACTOR);

  const etaNgoToItem = etaMin(distKm(ngoBase, item, ROAD_FACTOR), AVG_SPEED_KMH);
  const etaItemToNgo = etaMin(distKm(item, ngoBase, ROAD_FACTOR), AVG_SPEED_KMH);

  const totalMinNeeded = SAFETY_MARGIN_MIN + PICKUP_DWELL_MIN + etaNgoToItem + etaItemToNgo;
  return getExpiry(item) - totalMinNeeded * 60000;
}
