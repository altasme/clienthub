// The booking engine's core math (CLAUDE.md §10). Pure functions, no D1 —
// callers combine this with a query for already-booked sessions.
//
// Fixed business rules (confirmed with the operator, not configurable
// per-request): every session is 45 minutes with a mandatory 15-minute
// buffer after it before the next one can start, so the effective grid
// cadence is 60 minutes. All times are Asia/Manila (UTC+8, fixed — the
// Philippines does not observe DST), computed with plain UTC-ms math
// rather than an Intl/timezone-data lookup, since a fixed offset needs
// none of that.
//
// Conflict rule, derived once and reused everywhere (clienthub's own
// booking validation, clientkeeper's presentation scheduling): two
// sessions conflict iff their start times are less than 60 minutes apart
// in either direction. This is exactly equivalent to "no session may start
// inside another session's [start, start+45min) occupied window AND at
// least a 15-minute gap is kept on both sides" — treating every session as
// reserving a full 60-minute block starting at its own start time makes
// the two-sided gap requirement fall out of a single symmetric check
// rather than needing separate before/after interval-overlap logic.

export const SESSION_DURATION_MINUTES = 45;
export const BUFFER_MINUTES = 15;
export const SLOT_INTERVAL_MINUTES = SESSION_DURATION_MINUTES + BUFFER_MINUTES; // 60

// How far into the future a client can see/book open slots.
export const BOOKING_HORIZON_DAYS = 21;

// A slot can't be booked less than this far from now — gives staff a
// minimum amount of notice before a call starts.
export const MIN_LEAD_MINUTES = 120;

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface AvailabilityRule {
  day_of_week: number; // 0=Sunday..6=Saturday, Manila-local
  start_time: string; // "HH:MM", Manila-local
  end_time: string; // "HH:MM", Manila-local
}

interface ManilaParts {
  year: number;
  month: number; // 0-indexed, matches Date's convention
  date: number;
  dayOfWeek: number; // 0=Sunday
}

/** The Manila-local calendar date/day-of-week for a given instant. */
function toManilaParts(utcMs: number): ManilaParts {
  const shifted = new Date(utcMs + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

/** UTC ms for a given Manila-local calendar date + "HH:MM" time. */
function manilaToUtcMs(year: number, month: number, date: number, hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return Date.UTC(year, month, date, hour, minute) - MANILA_OFFSET_MS;
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** true iff HH:MM is well-formed and 00:00–23:59. */
export function isValidHHMM(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Every bookable slot start (as UTC ms) within the booking horizon that
 * satisfies the minimum lead time — before excluding already-booked
 * times, which the caller does separately (it needs a live D1 query to
 * know what's booked, which this pure function can't do).
 */
export function generateCandidateSlots(rules: AvailabilityRule[], now: Date): number[] {
  const nowMs = now.getTime();
  const earliestBookableMs = nowMs + MIN_LEAD_MINUTES * MINUTE_MS;
  const slots: number[] = [];

  const rulesByDay = new Map<number, AvailabilityRule[]>();
  for (const rule of rules) {
    const list = rulesByDay.get(rule.day_of_week) ?? [];
    list.push(rule);
    rulesByDay.set(rule.day_of_week, list);
  }

  for (let dayOffset = 0; dayOffset <= BOOKING_HORIZON_DAYS; dayOffset++) {
    const dayInstant = nowMs + dayOffset * 24 * 60 * MINUTE_MS;
    const { year, month, date, dayOfWeek } = toManilaParts(dayInstant);
    const dayRules = rulesByDay.get(dayOfWeek);
    if (!dayRules) continue;

    for (const rule of dayRules) {
      const windowStartMin = parseHHMM(rule.start_time);
      const windowEndMin = parseHHMM(rule.end_time);
      // Last slot must fully fit the 45-minute session before the window
      // closes; the buffer afterward is allowed to spill past end_time.
      for (
        let slotStartMin = windowStartMin;
        slotStartMin + SESSION_DURATION_MINUTES <= windowEndMin;
        slotStartMin += SLOT_INTERVAL_MINUTES
      ) {
        const hh = String(Math.floor(slotStartMin / 60)).padStart(2, "0");
        const mm = String(slotStartMin % 60).padStart(2, "0");
        const slotUtcMs = manilaToUtcMs(year, month, date, `${hh}:${mm}`);
        if (slotUtcMs >= earliestBookableMs) slots.push(slotUtcMs);
      }
    }
  }

  return slots.sort((a, b) => a - b);
}

/** Two session start times (UTC ms) conflict iff less than 60 min apart. */
export function slotsConflict(aMs: number, bMs: number): boolean {
  return Math.abs(aMs - bMs) < SLOT_INTERVAL_MINUTES * MINUTE_MS;
}

/** True iff candidateMs lands exactly on a real generated slot boundary. */
export function isValidSlot(rules: AvailabilityRule[], candidateMs: number, now: Date): boolean {
  return generateCandidateSlots(rules, now).includes(candidateMs);
}
