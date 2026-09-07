import { useState } from "react";
import { useMe } from "../lib/MeContext";
import { updateProfile, purchaseItem } from "../lib/api";

const inputClasses =
  "w-full rounded-xl border border-ink/15 px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

function YourPlanCard() {
  const { me } = useMe();
  const [renewing, setRenewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = me.subscriptions.find((s) => s.itemType === "plan");
  const addons = me.subscriptions.filter((s) => s.itemType === "addon");

  if (!me.pricingUnlocked || me.subscriptions.length === 0) return null;

  const handleRenew = async (itemId: string) => {
    setError(null);
    setRenewing(itemId);
    try {
      const { redirectUrl, kind } = await purchaseItem(itemId, true);
      if (kind === "url") {
        window.location.href = redirectUrl;
      } else {
        setError("Please message us to complete this renewal.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setRenewing(null);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
      <h2 className="text-lg font-bold text-brand-navy">Your Plan</h2>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      {plan && (
        <div className="rounded-xl border border-ink/10 bg-paper-alt p-4">
          <p className="text-sm font-semibold text-brand-navy">{plan.itemName}</p>
          <p className="text-xs text-ink/60">
            {plan.billingCycle === "one_time" ? "One-time purchase" : `₱${plan.amountPhp} — billed ${plan.billingCycle}`}
          </p>
          {plan.nextRenewalDate && plan.renewalAmountPhp && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-3">
              <p className="text-xs text-ink/60">
                Renews {DATE_FORMATTER.format(new Date(plan.nextRenewalDate))} &mdash; ₱{plan.renewalAmountPhp}
              </p>
              <button
                type="button"
                disabled={renewing === plan.itemId}
                onClick={() => handleRenew(plan.itemId)}
                className="rounded-full bg-brand-blue px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0b57cc] disabled:opacity-50"
              >
                {renewing === plan.itemId ? "Starting..." : "Renew Now"}
              </button>
            </div>
          )}
        </div>
      )}

      {addons.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">Add-Ons</p>
          <div className="space-y-2">
            {addons.map((a) => (
              <div key={a.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/10 bg-paper-alt p-3">
                <div>
                  <p className="text-sm font-semibold text-brand-navy">{a.itemName}</p>
                  {a.nextRenewalDate && a.renewalAmountPhp && (
                    <p className="text-xs text-ink/60">
                      Renews {DATE_FORMATTER.format(new Date(a.nextRenewalDate))} &mdash; ₱{a.renewalAmountPhp}
                    </p>
                  )}
                </div>
                {a.nextRenewalDate && a.renewalAmountPhp && (
                  <button
                    type="button"
                    disabled={renewing === a.itemId}
                    onClick={() => handleRenew(a.itemId)}
                    className="rounded-full border border-ink/15 px-4 py-2 text-xs font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                  >
                    {renewing === a.itemId ? "Starting..." : "Renew"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  const { me, refresh } = useMe();
  const [fullName, setFullName] = useState(me.client.fullName);
  const [businessName, setBusinessName] = useState(me.client.businessName);
  const [mobile, setMobile] = useState(me.client.mobile ?? "");
  const [facebook, setFacebook] = useState(me.client.facebook ?? "");
  const [currentWebsite, setCurrentWebsite] = useState(me.client.currentWebsite ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateProfile({ fullName, businessName, mobile, facebook, currentWebsite });
      refresh();
      setSaved(true);
    } catch {
      setError("Something went wrong saving your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-navy">Account</h1>

      <YourPlanCard />

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Full Name</label>
            <input className={inputClasses} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Business Name</label>
            <input className={inputClasses} value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Email</label>
            <input className={`${inputClasses} bg-paper-alt text-ink/50`} value={me.client.email} disabled readOnly />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Mobile</label>
            <input className={inputClasses} value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Facebook</label>
            <input className={inputClasses} value={facebook} onChange={(e) => setFacebook(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">Current Website</label>
            <input className={inputClasses} value={currentWebsite} onChange={(e) => setCurrentWebsite(e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-ink/40">Client since {new Date(me.client.createdAt).toLocaleDateString()}</p>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        {saved && <p className="text-sm font-medium text-brand-blue">Saved.</p>}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-full bg-brand-blue px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0b57cc] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
