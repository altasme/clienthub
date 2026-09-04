import { useState } from "react";
import Modal from "./Modal";
import { submitSchedule } from "../lib/api";

export default function ScheduleModal({
  open,
  onClose,
  type,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  type: "discovery" | "presentation";
  onSubmitted: () => void;
}) {
  const [times, setTimes] = useState(["", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = type === "discovery" ? "Schedule a Call" : "Schedule Presentation";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const preferredTimes = times.map((t) => t.trim()).filter(Boolean);
    if (preferredTimes.length === 0) {
      setError("Please enter at least one preferred time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitSchedule(type, preferredTimes);
      onSubmitted();
      onClose();
      setTimes(["", "", ""]);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-ink/60">
          Tell us a few times that work for you and we'll follow up to confirm.
        </p>
        {times.map((value, i) => (
          <input
            key={i}
            type="text"
            value={value}
            onChange={(e) => setTimes((prev) => prev.map((t, idx) => (idx === i ? e.target.value : t)))}
            placeholder={`Option ${i + 1} (e.g. Tue 2-4pm)`}
            className="w-full rounded-xl border border-ink/15 px-4 py-2.5 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
          />
        ))}
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#0b57cc] disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </form>
    </Modal>
  );
}
