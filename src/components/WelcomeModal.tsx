import { useEffect, useRef } from "react";
import { WELCOME_MODAL } from "../content/site";

// First-login welcome message. Persisted server-side (clients.
// welcome_dismissed_at, functions/api/client/welcome-dismiss.ts) rather than
// localStorage, since a client may log in from more than one device/browser
// and the point is "seen this once, ever" — not "seen this on this browser."
export default function WelcomeModal({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
      onClick={onDismiss}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 id="welcome-modal-title" className="text-xl font-bold text-brand-navy">
            {WELCOME_MODAL.headline}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="shrink-0 text-2xl leading-none text-ink/40 hover:text-ink"
          >
            &times;
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink/70">
          {WELCOME_MODAL.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="mt-6 w-full rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0b57cc]"
        >
          {WELCOME_MODAL.dismissCta}
        </button>
      </div>
    </div>
  );
}
