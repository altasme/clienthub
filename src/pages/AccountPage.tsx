import { useState } from "react";
import { useMe } from "../lib/MeContext";
import { updateProfile } from "../lib/api";

const inputClasses =
  "w-full rounded-xl border border-ink/15 px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20";

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
