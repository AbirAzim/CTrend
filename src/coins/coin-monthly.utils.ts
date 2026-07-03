/** UTC month key helpers for the monthly engagement-coin cycle. */

/** `YYYY-MM` for a date in UTC. */
export function monthKeyFromDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** The month users are currently earning coins in (UTC). */
export function currentCompetingMonthKey(): string {
  return monthKeyFromDate(new Date());
}

/** Inclusive start, exclusive end for ledger aggregation. */
export function monthBoundsUtc(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Invalid month key: ${monthKey}`);
  }
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0),
  );
  return { start, end };
}

export function nextMonthKey(monthKey: string): string {
  const { end } = monthBoundsUtc(monthKey);
  return monthKeyFromDate(end);
}

/** Human label e.g. "July 2026". */
export function formatCoinMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
