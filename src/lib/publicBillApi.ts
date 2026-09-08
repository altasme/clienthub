// Fetch helpers for the public Bill of Service page (src/pages/BillPage.tsx).
// Kept separate from src/lib/api.ts deliberately: that module is used only
// from inside MeProvider's authenticated tree, and BillPage.tsx is
// reachable with no session at all (see App.tsx) — these calls hit
// different (unauthenticated) endpoints and shouldn't get tangled up with
// the client-session API surface.

export interface PublicBillLineItem {
  description: string;
  amount: number;
}

export interface PublicBill {
  billNumber: string;
  clientType: "individual" | "corporate";
  recipientName: string;
  recipientContactPerson: string | null;
  recipientTin: string | null;
  scopeDescription: string | null;
  currency: string;
  totalAmount: number;
  issueDate: string;
  expiresAt: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  notes: string | null;
  paidAt: string | null;
  lineItems: PublicBillLineItem[];
}

export class PublicBillApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchPublicBill(token: string): Promise<PublicBill> {
  const res = await fetch(`/api/public/bill/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PublicBillApiError(res.status, (body as { error?: string } | null)?.error || `Request failed: ${res.status}`);
  return body as PublicBill;
}

export async function startBillCheckout(token: string): Promise<{ redirectUrl: string; kind: "url" | "qr-image" | "qr-payload" | "test-placeholder" }> {
  const res = await fetch(`/api/public/bill/${encodeURIComponent(token)}/checkout`, { method: "POST" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PublicBillApiError(res.status, (body as { error?: string } | null)?.error || `Request failed: ${res.status}`);
  return body as { redirectUrl: string; kind: "url" | "qr-image" | "qr-payload" | "test-placeholder" };
}
