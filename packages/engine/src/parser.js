export function parseQuickMessage(rawText) {
  const fallbackHint = 'Try: 20 veg cooked 3h';
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, hint: fallbackHint };
  }

  const text = rawText.trim();
  const lower = text.toLowerCase();

  // If text contains negative numbers like -10, reject
  if (/-\s*\d+/.test(lower)) {
    return { ok: false, hint: fallbackHint };
  }

  // Determine diet: non veg / non-veg / nonveg vs veg
  const isNonVeg = /\bnon[\s-]?veg\b/i.test(lower);
  const diet = isNonVeg ? 'nonveg' : 'veg';

  // Determine form: packed vs cooked (default: cooked)
  const isPacked = /\bpacked\b/i.test(lower);
  const form = isPacked ? 'packed' : 'cooked';

  // Find meals and duration
  // Duration patterns: e.g. 3h, 3.5 hrs, 45m, 45 mins, 2 hours, 30 min
  let durationMinutes = null;

  const timeRegex = /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;
  const timeMatch = lower.match(timeRegex);
  if (timeMatch) {
    const val = parseFloat(timeMatch[1]);
    const unit = timeMatch[2].toLowerCase();
    if (unit.startsWith('h')) {
      durationMinutes = Math.round(val * 60);
    } else if (unit.startsWith('m')) {
      durationMinutes = Math.round(val);
    }
  }

  // Remove the time match substring when looking for meals integer, so "3h" doesn't count as meals 3
  let textWithoutTime = lower;
  if (timeMatch) {
    textWithoutTime = lower.replace(timeMatch[0], ' ');
  }

  // Find first positive integer for meals
  const mealMatches = textWithoutTime.match(/\b\d+\b/g);
  if (!mealMatches || mealMatches.length === 0) {
    return { ok: false, hint: fallbackHint };
  }

  const meals = parseInt(mealMatches[0], 10);
  if (isNaN(meals) || meals <= 0 || meals > 2000) {
    return { ok: false, hint: fallbackHint };
  }

  // Default duration by form if not specified
  if (durationMinutes === null || isNaN(durationMinutes) || durationMinutes <= 0) {
    durationMinutes = form === 'packed' ? 720 : 180; // 12h for packed, 3h for cooked
  }

  return {
    ok: true,
    meals,
    diet,
    form,
    minutes: durationMinutes,
    hint: `Parsed: ${meals} ${diet} ${form} (${durationMinutes} min)`
  };
}
