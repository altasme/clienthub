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

function groupByDay(slots: string[]): { dayLabel: string; slots: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const iso of slots) {
    const dayLabel = DAY_FORMATTER.format(new Date(iso));
    const list = groups.get(dayLabel) ?? [];
    list.push(iso);
    groups.set(dayLabel, list);
  }
  return Array.from(groups.entries()).map(([dayLabel, daySlots]) => ({ dayLabel, slots: daySlots }));
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
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlots(null);
    setSelected(null);
    setSubmitError(null);
    setLoadError(null);
    fetchAvailability()
      .then(setSlots)
      .catch(() => setLoadError("Couldn't load available times. Please try again."));
  }, [open]);

  const grouped = useMemo(() => (slots ? groupByDay(slots) : []), [slots]);

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
      <div className="max-h-[60vh] space-y-4 overflow-y-auto">
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
          <p className="text-sm text-ink/60">No open times right now — message us and we'll find a time together.</p>
        )}

        {grouped.map((group) => (
          <div key={group.dayLabel}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{group.dayLabel}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.slots.map((iso) => (
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
        ))}

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
