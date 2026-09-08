import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPublicBill, startBillCheckout, PublicBillApiError, type PublicBill } from "../lib/publicBillApi";
import ChatModal from "../components/ChatModal";

// Altaventures' own TIN, printed on every Bill of Service's "From:" line —
// given to us as "717-659--00000" (note the double dash); reproduced
// verbatim rather than guessed-and-"corrected", since inventing digits on
// a tax id would be worse than a visibly-odd string. Confirm the real
// number and fix this constant if it's wrong.
const ALTAVENTURES_TIN = "717-659--00000";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const MONEY_FORMATTER = new Intl.NumberFormat("en-US");

function formatMoney(amount: number): string {
  return `₱${MONEY_FORMATTER.format(amount)}`;
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value));
}

function StatusBadge({ status }: { status: PublicBill["status"] }) {
  const styles: Record<PublicBill["status"], string> = {
    pending: "bg-amber-100 text-amber-700",
    paid: "bg-green-100 text-green-700",
    expired: "bg-ink/10 text-ink/60",
    cancelled: "bg-red-100 text-red-700",
  };
  const labels: Record<PublicBill["status"], string> = {
    pending: "Pending",
    paid: "Paid",
    expired: "Expired",
    cancelled: "Cancelled",
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${styles[status]}`}>{labels[status]}</span>;
}

export default function BillPage() {
  const { token } = useParams<{ token: string }>();
  const [bill, setBill] = useState<PublicBill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const retry = new URLSearchParams(window.location.search).get("retry") === "1";
  const justPaid = new URLSearchParams(window.location.search).get("paid") === "1";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchPublicBill(token)
      .then((result) => {
        if (cancelled) return;
        setBill(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "This bill of service link isn't valid.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // If we've just been redirected back from ganap.net but the bill is
  // still "pending" here, the webhook likely just hasn't landed yet
  // (async, at-least-once delivery — same gap this project always hedges
  // for on a payment-return page). Poll a few times rather than making
  // the client refresh manually.
  useEffect(() => {
    if (!justPaid || !token || !bill || bill.status !== "pending") return;
    setConfirming(true);
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const fresh = await fetchPublicBill(token);
        if (fresh.status !== "pending") {
          setBill(fresh);
          setConfirming(false);
          clearInterval(interval);
        } else if (attempts >= 10) {
          setConfirming(false);
          clearInterval(interval);
        }
      } catch {
        // transient fetch failure during polling — just try again next tick
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPaid, token, bill?.status]);

  const handlePay = async () => {
    if (!token) return;
    setPayError(null);
    setPaying(true);
    try {
      const { redirectUrl, kind } = await startBillCheckout(token);
      if (kind === "url") {
        window.location.href = redirectUrl;
      } else {
        setPayError(
          kind === "test-placeholder"
            ? "This project is in ganap test mode. Complete the payment from the ganap.net dashboard (Test Mode → Simulate successful payment)."
            : "This payment needs a QR scan that isn't supported here yet. Please message us instead."
        );
      }
    } catch (err) {
      setPayError(err instanceof PublicBillApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm rounded-2xl border border-ink/10 bg-white p-6 text-center sm:p-8">
          <p className="text-sm font-semibold text-brand-blue">Bill of Service</p>
          <h1 className="mt-1 text-xl font-bold text-brand-navy">Link Not Found</h1>
          <p className="mt-2 text-sm text-ink/60">{loadError}</p>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="mt-5 inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
          >
            Message Us
          </button>
        </div>
        <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink/50">Loading your bill of service&hellip;</p>
      </div>
    );
  }

  const canPay = bill.status === "pending" && !confirming;

  return (
    <div className="min-h-screen bg-paper-alt px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">Altaventures</p>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold text-brand-navy">Bill of Service</h1>
              <p className="mt-1 text-sm text-ink/60">
                No: <span className="font-semibold text-ink">{bill.billNumber}</span> | Date: <span className="font-semibold text-ink">{formatDate(bill.issueDate)}</span>
              </p>
              <p className="text-sm text-ink/60">Terms: Valid until {formatDate(bill.expiresAt)}</p>
            </div>
            <StatusBadge status={bill.status} />
          </div>

          <div className="mt-6 grid gap-4 border-y border-ink/10 py-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">From</p>
              <p className="mt-1 text-sm font-semibold text-brand-navy">Altaventures</p>
              <p className="text-xs text-ink/50">TIN: {ALTAVENTURES_TIN}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">To</p>
              <p className="mt-1 text-sm font-semibold text-brand-navy">{bill.recipientName}</p>
              {bill.clientType === "corporate" && bill.recipientContactPerson && <p className="text-xs text-ink/50">Attn: {bill.recipientContactPerson}</p>}
              {bill.clientType === "corporate" && bill.recipientTin && <p className="text-xs text-ink/50">TIN: {bill.recipientTin}</p>}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Service Scope and Description</p>
            {bill.scopeDescription && <p className="mt-2 max-w-prose text-sm text-ink/70">{bill.scopeDescription}</p>}

            <div className="mt-4 divide-y divide-ink/10">
              {bill.lineItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                  <p className="text-ink/80">{item.description}</p>
                  <p className="font-semibold text-brand-navy">{formatMoney(item.amount)}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between border-t-2 border-brand-navy pt-3">
              <p className="text-sm font-bold text-brand-navy">Total Amount Payable</p>
              <p className="text-xl font-extrabold text-brand-navy">{formatMoney(bill.totalAmount)}</p>
            </div>
          </div>

          {bill.notes && (
            <div className="mt-5 rounded-lg bg-paper-alt p-3">
              <p className="text-xs text-ink/60">{bill.notes}</p>
            </div>
          )}

          <div className="mt-8">
            {retry && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">Your payment didn't go through. Please try again.</p>}
            {payError && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{payError}</p>}

            {confirming && <p className="text-sm text-ink/60">Thanks! We're confirming your payment now. This will update automatically&hellip;</p>}

            {bill.status === "paid" && (
              <p className="flex items-center gap-2 text-sm font-semibold text-green-700">
                &#10003; This bill has been paid{bill.paidAt ? ` on ${formatDate(bill.paidAt)}` : ""}. Thank you!
              </p>
            )}

            {bill.status === "expired" && (
              <div>
                <p className="text-sm text-ink/60">This bill of service has expired. Please message us for a new one.</p>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="mt-3 inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
                >
                  Message Us
                </button>
              </div>
            )}

            {bill.status === "cancelled" && (
              <div>
                <p className="text-sm text-ink/60">This bill of service has been cancelled. Please message us if you have questions.</p>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="mt-3 inline-flex items-center justify-center rounded-full border border-ink/15 px-6 py-3 text-sm font-semibold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
                >
                  Message Us
                </button>
              </div>
            )}

            {canPay && (
              <button
                type="button"
                disabled={paying}
                onClick={handlePay}
                className="inline-flex w-full items-center justify-center rounded-full bg-brand-blue px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-[#0b57cc] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {paying ? "Starting checkout..." : "Make a Payment Now →"}
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-ink/40">Issued by Altaventures Business Development Services. This link is unique to this bill of service.</p>
      </div>

      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
