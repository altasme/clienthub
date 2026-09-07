import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { fetchAvailability, bookDiscoveryCall } from "../lib/api";

const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long",
  month: "short",
  day: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});
// "YYYY-MM-DD" in Asia/Manila — the same date-key pattern already used
// elsewhere in this app (DashboardPage.tsx's isPresentationToday) for
// comparing calendar days rather than raw instants.
const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
// Formats a Y/M/D calendar date (already resolved to its Manila day) for
// display without re-interpreting it in the viewer's own timezone — using
// "Asia/Manila" here on a `new Date(dateKey + "T00:00:00")` would parse
// that string as LOCAL midnight first, which shifts to a different
// calendar day in Manila time for a viewer far enough from UTC+8 (e.g.
// anyone east of it). Feeding a UTC-constructed date into a UTC formatter
// sidesteps any such conversion entirely.
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(iso: string): string {
  return DATE_KEY_FORMATTER.format(new Date(iso));
}

interface YearMonth {
  year: number;
  month: number; // 1-12
}

function parseDateKey(key: string): YearMonth & { day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

// Pure calendar-grid arithmetic on Y/M/D components, done via Date.UTC —
// safe here since Asia/Manila has no DST and this never touches time-of-
// day, only day-of-week/days-in-month, which are timezone-independent
// once you already have the right Y/M/D.
function daysInMonth(ym: YearMonth): number {
  return new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate();
}
function firstWeekdayOfMonth(ym: YearMonth): number {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1)).getUTCDay();
}
function addMonths(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export default function BookingModal({
  open,
  onClose,
  alreadyScheduledAt,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  alreadyScheduledAt: string | null;
  onBooked: () => void;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState<YearMonth | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlots(null);
    setSelectedDay(null);
    setSelected(null);
    setSubmitError(null);
    setLoadError(null);
    setVisibleMonth(null);
    fetchAvailability()
      .then(setSlots)
      .catch(() => setLoadError("Couldn't load available times. Please try again."));
  }, [open]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const iso of slots ?? []) {
      const key = toDateKey(iso);
      const list = map.get(key) ?? [];
      list.push(iso);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  const availableDayKeys = useMemo(() => Array.from(slotsByDay.keys()).sort(), [slotsByDay]);

  const todayKey = DATE_KEY_FORMATTER.format(new Date());
  const minMonth = availableDayKeys.length ? parseDateKey(availableDayKeys[0]) : parseDateKey(todayKey);
  const maxMonth = availableDayKeys.length ? parseDateKey(availableDayKeys[availableDayKeys.length - 1]) : parseDateKey(todayKey);

  // Default to the month of the first available slot once slots load, so
  // the client doesn't land on an empty "today" month with nothing to
  // pick while every open slot sits a few weeks ahead.
  useEffect(() => {
    if (visibleMonth || !slots) return;
    setVisibleMonth(availableDayKeys.length ? parseDateKey(availableDayKeys[0]) : parseDateKey(todayKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const month = visibleMonth ?? parseDateKey(todayKey);
  const canGoPrev = compareYearMonth(addMonths(month, -1), minMonth) >= 0;
  const canGoNext = compareYearMonth(addMonths(month, 1), maxMonth) <= 0;

  const gridCells: (string | null)[] = [];
  const leadingBlanks = firstWeekdayOfMonth(month);
  for (let i = 0; i < leadingBlanks; i++) gridCells.push(null);
  const totalDays = daysInMonth(month);
  for (let d = 1; d <= totalDays; d++) {
    gridCells.push(`${month.year}-${String(month.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  const selectedDayTimes = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  const handlePickDay = (dayKey: string) => {
    setSelectedDay(dayKey);
    setSelected(null);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await bookDiscoveryCall(selected);
      onBooked();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      // The slot we tried may have just been taken by someone else —
      // refresh the list so a stale slot doesn't sit there looking pickable.
      fetchAvailability()
        .then(setSlots)
        .catch(() => {});
      setSelected(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={alreadyScheduledAt ? "Reschedule Your Call" : "Schedule a Call"}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        {alreadyScheduledAt && (
          <p className="text-sm text-ink/60">
            Currently scheduled for{" "}
            <span className="font-semibold text-brand-navy">
              {DAY_FORMATTER.format(new Date(alreadyScheduledAt))} at {TIME_FORMATTER.format(new Date(alreadyScheduledAt))}
            </span>
            . Pick a new time below to reschedule.
          </p>
        )}

        {loadError && <p className="text-sm font-medium text-red-600">{loadError}</p>}

        {!slots && !loadError && <p className="text-sm text-ink/50">Loading available times&hellip;</p>}

        {slots && slots.length === 0 && (
          <p className="text-sm text-ink/60">No open times right now. Message us and we'll find a time together.</p>
        )}

        {slots && slots.length > 0 && (
          <div className="rounded-xl border border-ink/10 p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => setVisibleMonth(addMonths(month, -1))}
                aria-label="Previous month"
                className="rounded-full p-1.5 text-ink/50 transition hover:bg-paper-alt hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                &larr;
              </button>
              <p className="text-sm font-semibold text-brand-navy">{MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(month.year, month.month - 1, 1)))}</p>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => setVisibleMonth(addMonths(month, 1))}
                aria-label="Next month"
                className="rounded-full p-1.5 text-ink/50 transition hover:bg-paper-alt hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                &rarr;
              </button>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {gridCells.map((dayKey, i) => {
                if (!dayKey) return <div key={`blank-${i}`} />;
                const hasSlots = slotsByDay.has(dayKey);
                const isSelected = selectedDay === dayKey;
                const isToday = dayKey === todayKey;
                const dayNum = parseDateKey(dayKey).day;
                return (
                  <button
                    key={dayKey}
                    type="button"
                    disabled={!hasSlots}
                    onClick={() => handlePickDay(dayKey)}
                    className={`relative aspect-square rounded-lg text-sm font-medium transition ${
                      isSelected
                        ? "bg-brand-blue text-white"
                        : hasSlots
                          ? "text-brand-navy hover:bg-brand-blue/10"
                          : "cursor-not-allowed text-ink/20"
                    } ${isToday && !isSelected ? "ring-1 ring-inset ring-brand-blue/40" : ""}`}
                  >
                    {dayNum}
                    {hasSlots && !isSelected && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-blue" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selectedDay && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              {(() => {
                const d = parseDateKey(selectedDay);
                return DAY_LABEL_FORMATTER.format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
              })()}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedDayTimes.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelected(iso)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                    selected === iso
                      ? "border-brand-blue bg-brand-blue text-white"
                      : "border-ink/15 text-brand-navy hover:border-brand-blue hover:text-brand-blue"
                  }`}
                >
                  {TIME_FORMATTER.format(new Date(iso))}
                </button>
              ))}
            </div>
          </div>
        )}

        {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}

        <button
          type="button"
          disabled={!selected || submitting}
          onClick={handleConfirm}
          className="w-full rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0b57cc] disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/60"
        >
          {submitting ? "Booking..." : alreadyScheduledAt ? "Confirm Reschedule" : "Confirm Time"}
        </button>
      </div>
    </Modal>
  );
}
