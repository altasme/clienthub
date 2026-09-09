// Cloudflare Pages Function: POST /api/public/bill/:token/checkout
//
// Starts a ganap.net checkout for a Bill of Service's exact total —
// reuses the SAME alta_internal_upsell ganap.net project/secret as
// functions/api/client/checkout-upsell.ts (the Pricing page), rather than
// standing up a third ganap.net project just for this. The webhook
// (functions/api/webhooks/internal-upsell.ts) branches on
// `metadata.kind === "bill_of_service"` to tell a bill payment apart from
// a catalog-item purchase.
//
// No auth (see the sibling [token].ts for why) — the token itself, plus
// the pending/not-expired checks below, are the only gate. Amount is
// always read from the bill row server-side, never trusted from the
// client, same security posture as every other checkout in this project.

import { startGanapCheckout } from "../../../../_lib/ganap";

interface Env {
  GANAP_INTERNAL_UPSELL_SECRET: string;
  GANAP_INTERNAL_UPSELL_PROJECT_UUID: string;
  DB?: D1Database;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestPost: PagesFunction<Env, "token"> = async ({ env, params }) => {
  if (!env.GANAP_INTERNAL_UPSELL_SECRET || !env.GANAP_INTERNAL_UPSELL_PROJECT_UUID || !env.DB) {
    const missing = [
      !env.GANAP_INTERNAL_UPSELL_SECRET && "GANAP_INTERNAL_UPSELL_SECRET",
      !env.GANAP_INTERNAL_UPSELL_PROJECT_UUID && "GANAP_INTERNAL_UPSELL_PROJECT_UUID",
      !env.DB && "DB binding",
    ].filter(Boolean);
    console.error(`bill checkout: not configured, missing: ${missing.join(", ")}`);
    return jsonResponse(500, { error: "Payment is not configured yet. Please contact us directly." });
  }
  const db = env.DB;
  const token = params.token;

  const bill = await db
    .prepare(
      `SELECT b.id, b.bill_number, b.recipient_name, b.recipient_email, b.total_amount, b.currency, b.status, b.expires_at,
              c.email AS client_email, c.full_name AS client_full_name
       FROM bills b
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.token = ?`
    )
    .bind(token)
    .first<{
      id: string;
      bill_number: string;
      recipient_name: string;
      recipient_email: string | null;
      total_amount: number;
      currency: string;
      status: string;
      expires_at: string;
      client_email: string | null;
      client_full_name: string | null;
    }>();

  if (!bill) return jsonResponse(404, { error: "This bill of service link isn't valid." });

  if (bill.status !== "pending") {
    return jsonResponse(400, { error: bill.status === "paid" ? "This bill has already been paid." : "This bill is no longer available for payment." });
  }
  if (new Date(bill.expires_at).getTime() < Date.now()) {
    await db.prepare(`UPDATE bills SET status = 'expired', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), bill.id).run();
    return jsonResponse(400, { error: "This bill has expired. Please ask us for a new one." });
  }

  // An explicit recipient_email (set at bill-creation time) wins over the
  // linked client's own email — staff may deliberately want a bill routed
  // to a different contact (e.g. a client's accounting inbox) than the
  // client's main account email. Recipient email is optional on bill
  // creation (ClientKeeper CLAUDE.md §12 — operator decision, 2026-09-09:
  // staff share the link manually, an email isn't required to do that),
  // so this falls back to a generic placeholder rather than blocking
  // payment outright — ganap.net's checkout API requires *some*
  // customerEmail string, but nothing in this app's own flow depends on
  // it being a real, deliverable address.
  const customerEmail = bill.recipient_email || bill.client_email || "billing@altasme.com";

  const idempotencyKey = crypto.randomUUID();
  const publicBillUrl = `https://account.altasme.com/bill/${token}`;

  const result = await startGanapCheckout(env.GANAP_INTERNAL_UPSELL_SECRET, env.GANAP_INTERNAL_UPSELL_PROJECT_UUID, {
    amount: bill.total_amount,
    customerName: bill.client_full_name || bill.recipient_name,
    customerEmail,
    externalReference: idempotencyKey,
    metadata: {
      kind: "bill_of_service",
      billId: bill.id,
      billNumber: bill.bill_number,
    },
    successRedirectUrl: `${publicBillUrl}?paid=1`,
    failureRedirectUrl: `${publicBillUrl}?retry=1`,
  });

  if (!result.ok) return jsonResponse(result.status, { error: result.error });

  return jsonResponse(200, { redirectUrl: result.redirectUrl, referenceNumber: result.referenceNumber, kind: result.kind });
};
