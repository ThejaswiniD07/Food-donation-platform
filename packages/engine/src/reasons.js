export const REASON_CODES = {
  CANNOT_REACH_IN_TIME: 'CANNOT_REACH_IN_TIME',
  WOULD_MAKE_TRIP_LATE: 'WOULD_MAKE_TRIP_LATE',
  TRIP_FULL: 'TRIP_FULL',
  WAITING_FOR_FOOD: 'WAITING_FOR_FOOD',
  NOT_ENOUGH_FOOD: 'NOT_ENOUGH_FOOD',
  EXPIRED: 'EXPIRED',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  OUTSIDE_AREA: 'OUTSIDE_AREA'
};

export function formatTime(ms) {
  if (!ms || isNaN(ms)) return '';
  const d = new Date(Number(ms));
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
}

export function reasonText(code, numbers = {}) {
  switch (code) {
    case REASON_CODES.CANNOT_REACH_IN_TIME:
      return `Left out: needs ${numbers.need ?? 0} min to reach the receiver, but only ${numbers.have ?? 0} min of safe time is left.`;

    case REASON_CODES.WOULD_MAKE_TRIP_LATE:
      return `Left out: adding it would make the trip arrive ${numbers.late ?? 0} min after ${numbers.title ?? 'food'}'s safe time.`;

    case REASON_CODES.TRIP_FULL:
      return `Left out: the trip already has ${numbers.max ?? 4} stops.`;

    case REASON_CODES.WAITING_FOR_FOOD: {
      const timeStr = typeof numbers.time === 'string' ? numbers.time : (numbers.time ? formatTime(numbers.time) : '');
      return `Waiting: ${numbers.have ?? 0} of ${numbers.min ?? 20} meals nearby. We decide by ${timeStr}.`;
    }

    case REASON_CODES.NOT_ENOUGH_FOOD:
      return `Not dispatched: only ${numbers.have ?? 0} meals were nearby before the safe time ended. A trip needs ${numbers.min ?? 20}.`;

    case REASON_CODES.EXPIRED:
      return 'The safe time ended before a pickup could start.';

    case REASON_CODES.NOT_AVAILABLE:
      return 'The pickup person found the food was not available.';

    case REASON_CODES.OUTSIDE_AREA:
      return 'This location is outside our service area.';

    default:
      return numbers.custom || 'Status updated.';
  }
}
