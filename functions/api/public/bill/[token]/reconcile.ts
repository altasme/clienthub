// Cloudflare Pages Function: POST /api/public/bill/:token/reconcile
//
// Manual "Check Payment Status" action for a bill stuck showing `pending`
// after someone clicked "pay" — ganap.net's webhook delivery is
// best-effort (retried, but not guaranteed to ever land), so this asks
// ganap directly via its Status & Retry API (confirmed against the live
// project's own docs, 2026-09-09) rather than waiting indefinitely. If
// ganap says the transaction actually paid, this applies the exact same
// DB mutations the real webhook would have — functions/api/webhooks/
// ganap.ts's applyPaidGanapTransaction(), so there is exactly one place
// that ever decides what "a bill got paid" does to the database.
//
// No auth, same posture as the sibling [token].ts/checkout.ts — the bill's
// own token is the only gate. This is read-mostly on ganap's side ("safe
// to call as often as you like" per their docs) and idempotent on ours
// (applyPaidGanapTransaction's own external_reference check), so there's
// no meaningful abuse surface even without a staff-only gate; ClientKeeper
// calls this directly from the browser (cross-origin) rather than through
// any shared staff-auth plumbing, since ClientKeeper deliberately holds no
// ganap.net credentials of its own (CLAUDE.md §0's isolation goal).

import { checkGanapTransactionStatus } from "../../../../_lib/ganap";
import { applyPaidGanapTransaction, type GanapWebhookPayload, type Env as GanapEnv } from "../../../webhooks/ganap";

interface Env extends GanapEnv {
  GANAP_PROJECT_UUID: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestPost: PagesFunction<Env, "token"> = async ({ env, params }) => {
  if (!env.GANAP_SECRET || !env.GANAP_PROJECT_UUID || !env.DB) {
    const missing = [!env.GANAP_SECRET && "GANAP_SECRET", !env.GANAP_PROJECT_UUID && "GANAP_PROJECT_UUID", !env.DB && "DB binding"].filter(Boolean);
    console.error(`bill reconcile: not configured, missing: ${missing.join(", ")}`);
    return jsonResponse(500, { error: "Not configured." });
  }
  const db = env.DB;
  const token = params.token;

  const bill = await db
    .prepare(`SELECT id, status, last_checkout_reference FROM bills WHERE token = ?`)
    .bind(token)
    .first<{ id: string; status: string; last_checkout_reference: string | null }>();

  if (!bill) return jsonResponse(404, { error: "This bill of service link isn't valid." });

  if (bill.status === "paid") {
    return jsonResponse(200, { reconciled: false, billStatus: "paid", message: "This bill is already marked paid." });
  }
  if (!bill.last_checkout_reference) {
    return jsonResponse(400, { error: "No payment attempt has been recorded for this bill yet — nothing to check." });
  }

  const result = await checkGanapTransactionStatus(env.GANAP_SECRET, env.GANAP_PROJECT_UUID, bill.last_checkout_reference);
  if (!result.ok) return jsonResponse(result.status, { error: result.error });

  if (!result.paid) {
    return jsonResponse(200, {
      reconciled: false,
      billStatus: bill.status,
      ganapStatus: result.status,
      webhookDelivered: result.webhook?.delivered ?? null,
      webhookLastResponse: result.webhook?.lastResponse ?? null,
      message: `ganap.net reports this payment as "${result.status}" — not yet paid.`,
    });
  }

  // ganap confirms paid but our own row still shows pending — the webhook
  // either never arrived or failed. Apply the same mutation a real
  // delivery would, through the one shared code path.
  const payload: GanapWebhookPayload = {
    event: "transaction.paid",
    referenceNumber: result.referenceNumber,
    externalReference: result.externalReference,
    amount: result.amount,
    currency: result.currency,
    status: result.status,
    customer: result.customer,
    metadata: result.metadata,
    timestamp: new Date().toISOString(),
  };

  await applyPaidGanapTransaction(db, env, payload, JSON.stringify({ source: "manual-reconcile", statusCheck: result }));

  return jsonResponse(200, {
    reconciled: true,
    billStatus: "paid",
    ganapStatus: result.status,
    webhookDelivered: result.webhook?.delivered ?? null,
    webhookLastResponse: result.webhook?.lastResponse ?? null,
    message: "ganap.net confirmed this payment as paid — the bill has been marked paid.",
  });
};
