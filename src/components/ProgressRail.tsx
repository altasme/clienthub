import type { Stage } from "../lib/api";

// Deliberately generic — no commercial stages (offer_unlocked, conversion,
// essential_upsell) are ever named here, per CLAUDE.md §6: "no commercial
// stages shown" on the progress rail. Anything post-presentation just
// reads "Next Steps".
const RAIL_ITEMS: { label: string; stages: Stage[] }[] = [
  { label: "Payment", stages: ["payment_received"] },
  { label: "Account", stages: ["account_created"] },
  { label: "Discovery", stages: ["discovery"] },
  { label: "Build", stages: ["building"] },
  { label: "Presentation", stages: ["ready_for_presentation", "presentation"] },
  { label: "Next Steps", stages: ["post_presentation", "offer_unlocked", "conversion", "essential_upsell"] },
];

export default function ProgressRail({ stage }: { stage: Stage }) {
  const currentIndex = RAIL_ITEMS.findIndex((item) => item.stages.includes(stage));

  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {RAIL_ITEMS.map((item, i) => {
        const state = currentIndex === -1 ? "upcoming" : i < currentIndex ? "done" : i === currentIndex ? "active" : "upcoming";
        return (
          <li key={item.label} className="flex shrink-0 items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                state === "done"
                  ? "bg-brand-blue/10 text-brand-blue"
                  : state === "active"
                    ? "bg-brand-blue text-white"
                    : "bg-ink/5 text-ink/40"
              }`}
            >
              {item.label}
            </span>
            {i < RAIL_ITEMS.length - 1 && <span className="text-ink/20">&rarr;</span>}
          </li>
        );
      })}
    </ol>
  );
}
