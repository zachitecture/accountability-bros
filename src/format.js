// Dates and money, always shown in the member's own time zone.

function partsOf(date, timeZone, options) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-AU', { timeZone, ...options }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

function clock(date, timeZone) {
  const p = partsOf(date, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}:${p.minute} ${String(p.dayPeriod || '').toLowerCase().replace(/\./g, '')}`.trim();
}

// "Tue 10 Nov 2026, 6:14 pm"
export function fmtStamp(iso, timeZone) {
  const d = new Date(iso);
  const p = partsOf(d, timeZone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${clock(d, timeZone)}`;
}

// "Tue 10 Nov, 6:14 pm"
export function fmtDayTime(iso, timeZone) {
  const d = new Date(iso);
  const p = partsOf(d, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month}, ${clock(d, timeZone)}`;
}

// A plain calendar date such as "2026-11-09" becomes "Mon 9 Nov".
export function fmtDate(dateStr, withWeekday = true) {
  if (!dateStr) return '';
  const p = partsOf(new Date(`${dateStr}T12:00:00Z`), 'UTC', { weekday: 'short', day: 'numeric', month: 'short' });
  return withWeekday ? `${p.weekday} ${p.day} ${p.month}` : `${p.day} ${p.month}`;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function money(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

// 52 -> "52 min", 60 -> "1 h", 90 -> "1 h 30 min"
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export const CATEGORY_LABEL = { physical: 'Physical', lifestyle: 'Lifestyle', recovery: 'Recovery' };

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
