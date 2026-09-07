import { useState } from "react";
import { useMe } from "../lib/MeContext";
import { purchaseItem } from "../lib/api";
import { PLANS, PLANS_FOOTNOTE, PLAN_BADGES, ADDON_CATEGORIES, ADDONS_FOOTNOTE } from "../content/pricing";
import ChatModal from "../components/ChatModal";

function Check() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-shrink-0 text-brand-blue">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function PricingPage() {
  // No auto-refresh-on-mount here: ganap.net's successRedirectUrl is a real
  // browser navigation (not client-side routing), so MeProvider already
  // fetches fresh `me` on that load. An unconditional refresh() call here
  // previously caused an infinite loop — MeProvider unmounts its children
  // while status is 'loading', which unmounts this page, whose mount
  // effect then fired refresh() again on every remount, forever. The
  // webhook can still land a few seconds after the redirect (same lag as
  // the marketing site's /foryourbusiness thank-you page), so a manual
  // "Refresh" control below covers that gap instead.
  const { me, refresh } = useMe();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);

  const retry = new URLSearchParams(window.location.search).get("retry") === "1";

  const activeByItemId = new Map(me.subscriptions.map((s) => [s.itemId, s]));

  const handleBuy = async (itemId: string) => {
    setError(null);
    setPending(itemId);
    try {
      const { redirectUrl, kind } = await purchaseItem(itemId);
      if (kind === "url") {
        window.location.href = redirectUrl;
      } else {
        // Test-mode / QR fallbacks mirror the /foryourbusiness checkout
        // precedent — not expected in production once this project is on
        // a real Payment Portal, but kept so a test-mode ganap project
        // never surfaces a raw console error or dead custom-scheme link.
        setError(
          kind === "test-placeholder"
            ? "This project is in ganap test mode. Complete the payment from the ganap.net dashboard (Test Mode → Simulate successful payment)."
            : "This payment needs a QR scan that isn't supported here yet. Please message us instead."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const openQuoteChat = (itemName: string) => {
    setChatPrefill(`Hi Altaventures! I'd like a quote for: ${itemName}.`);
    setChatOpen(true);
  };

  // Add-ons are chat-only, not self-checkout (walked back from an earlier
  // "all purchasable" decision) — the price is still shown for
  // transparency, but every add-on's CTA opens a chat with a
  // price-aware prefill instead of a checkout, regardless of
  // `item.purchasable`.
  const openAddonChat = (itemName: string, priceLabel: string) => {
    setChatPrefill(`Hi Altaventures! I'm interested in adding "${itemName}" (${priceLabel}) to my plan. Can we talk about this?`);
    setChatOpen(true);
  };

  if (!me.pricingUnlocked) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-brand-navy">Pricing</h1>
        <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
          <p className="text-sm text-ink/60">Growth plans and add-ons become available once your presentation is complete.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Digital Growth Plans</h1>
        <p className="mt-1 text-sm text-ink/60">Turn your website into an evolving business system.</p>
      </div>

      {retry && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">Your payment didn't go through. Please try again.</p>}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <p className="text-xs text-ink/40">
        Just completed a purchase? It can take a few seconds to appear here.{" "}
        <button type="button" onClick={refresh} className="font-semibold text-brand-blue hover:underline">
          Refresh
        </button>
      </p>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const owned = activeByItemId.has(plan.id);
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 ${plan.featured ? "border-brand-blue bg-brand-blue/5" : "border-ink/10 bg-white"}`}
            >
              {plan.featured && <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-blue">★ Most Popular</p>}
              <h2 className="text-lg font-bold text-brand-navy">{plan.name}</h2>
              <p className="mt-1 text-sm text-ink/60">{plan.tagline}</p>
              <p className="mt-4 text-2xl font-extrabold text-brand-navy">{plan.priceLabel}</p>
              {plan.upfrontPhp && <p className="text-xs text-ink/40">+ ₱{plan.upfrontPhp} upfront</p>}
              {plan.domainRenewalNote && <p className="mt-1 text-xs text-ink/40">{plan.domainRenewalNote}</p>}

              <ul className="mt-4 flex-1 space-y-2">
                {plan.included.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink/70">
                    <Check /> {f}
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/40">{plan.support} Support</p>

              {owned ? (
                <p className="mt-4 rounded-full bg-brand-blue/10 px-4 py-2 text-center text-sm font-semibold text-brand-blue">Your Current Plan</p>
              ) : plan.purchasable ? (
                <button
                  type="button"
                  disabled={pending === plan.id}
                  onClick={() => handleBuy(plan.id)}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0b57cc] disabled:opacity-50"
                >
                  {pending === plan.id ? "Starting checkout..." : "Get Started"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openQuoteChat(plan.name)}
                  className="mt-4 inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
                >
                  Get a Quote
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-ink/40">{PLANS_FOOTNOTE}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_BADGES.map((b) => (
          <div key={b.title} className="rounded-xl border border-ink/10 bg-paper-alt p-4">
            <p className="text-sm font-bold text-brand-navy">{b.title}</p>
            <p className="mt-1 text-xs text-ink/60">{b.body}</p>
          </div>
        ))}
      </div>

      <div className="space-y-8">
        <h2 className="text-xl font-bold text-brand-navy">Add-Ons</h2>
        {ADDON_CATEGORIES.map((category) => (
          <div key={category.id}>
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-blue">{category.name}</h3>
            <p className="text-xs text-ink/40">{category.tagline}</p>
            <div className="mt-3 divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white">
              {category.items.map((item) => {
                const owned = activeByItemId.has(item.id);
                return (
                  <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">{item.name}</p>
                      <p className="text-xs text-ink/60">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="whitespace-nowrap text-sm font-bold text-brand-navy">{item.priceLabel}</p>
                      {owned ? (
                        <span className="whitespace-nowrap rounded-full bg-brand-blue/10 px-4 py-2 text-xs font-semibold text-brand-blue">Active</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAddonChat(item.name, item.priceLabel)}
                          className="whitespace-nowrap rounded-full border border-ink/15 px-4 py-2 text-xs font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
                        >
                          Chat with Developer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-ink/40">{ADDONS_FOOTNOTE}</p>

      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} prefill={chatPrefill} />
    </div>
  );
}
