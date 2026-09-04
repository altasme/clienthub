import { useMe } from "../lib/MeContext";

const WEBSITE_STAGES: Record<string, { badge: string; headline: string; body: string }> = {
  payment_received: { badge: "Discovery", headline: "We're learning about your business.", body: "Once we understand your business, we'll start planning your website." },
  account_created: { badge: "Discovery", headline: "We're learning about your business.", body: "Once we understand your business, we'll start planning your website." },
  discovery: { badge: "Discovery", headline: "We're learning about your business.", body: "Once we understand your business, we'll start planning your website." },
  building: { badge: "In Development", headline: "Your website is being built.", body: "We're actively working on it — check back for updates." },
  ready_for_presentation: { badge: "Ready", headline: "Your website is ready.", body: "We'll walk through it together at your presentation." },
  presentation: { badge: "Ready", headline: "Your website is ready.", body: "We'll walk through it together at your presentation." },
};

export default function WebsitePage() {
  const { me } = useMe();
  const stage = me.project?.stage;
  const isLive = stage && ["post_presentation", "offer_unlocked", "conversion", "essential_upsell", "completed"].includes(stage);
  const info = stage ? WEBSITE_STAGES[stage] : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-navy">Your Website</h1>

      <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
        {isLive ? (
          <>
            <p className="text-sm font-semibold text-brand-blue">Live</p>
            <h2 className="mt-1 text-xl font-bold text-brand-navy">Your website is live.</h2>
            {me.project?.websiteUrl ? (
              <a
                href={me.project.websiteUrl}
                target="_blank"
                rel="noopener"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0b57cc]"
              >
                Visit Your Website &rarr;
              </a>
            ) : (
              <p className="mt-2 text-sm text-ink/60">We'll add your website link here shortly.</p>
            )}
          </>
        ) : info ? (
          <>
            <p className="text-sm font-semibold text-brand-blue">{info.badge}</p>
            <h2 className="mt-1 text-xl font-bold text-brand-navy">{info.headline}</h2>
            <p className="mt-2 text-sm text-ink/60">{info.body}</p>
          </>
        ) : (
          <p className="text-sm text-ink/60">We're getting your project set up.</p>
        )}
      </div>
    </div>
  );
}
