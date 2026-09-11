// Cloudflare Pages Function: POST /api/webhooks/ganap
//
// The single ganap.net webhook for the whole ecosystem [consolidated
// 2026-09-09]. Previously there were two separate ganap.net projects with
// two separate webhook handlers here (this file for the /foryourbusiness
// ₱299 project, functions/api/webhooks/internal-upsell.ts for a second
// alta_internal_upsell project covering Pricing-page upsells and Bill of
// Service). Collapsed to one project/one secret since ganap's checkout API
// takes amount/redirects/metadata per request rather than tying them to a
// project — there was no functional reason two projects existed, only
// historical accretion (the upsell project was added later, then Bill of
// Service just reused it rather than adding a third). This is now the ONE
// webhook URL configured on the ONE remaining ganap.net project's
// dashboard; the old alta_internal_upsell project should be retired there
// once this ships, and GANAP_INTERNAL_UPSELL_SECRET/
// GANAP_INTERNAL_UPSELL_PROJECT_UUID removed from this app's Cloudflare
// Pages environment variables (they're no longer read anywhere).
//
// Routing: every checkout that starts a payment now tags its own kind in
// `metadata`, so this handler branches on that rather than needing three
// separate webhook URLs:
//   - metadata.kind === "bill_of_service"          -> bill flow
//   - metadata.clientId && metadata.itemId present  -> internal-upsell/
//                                                       catalog-item flow
//   - neither of the above                          -> /foryourbusiness
//                                                       ₱499 signup flow
//                                                       (the original,
//                                                       untagged shape —
//                                                       kept untagged
//                                                       deliberately so the
//                                                       marketing site's
//                                                       functions/api/
//                                                       checkout.ts didn't
//                                                       need a matching
//                                                       edit for this
//                                                       consolidation)
//
// Payload shape and signing match the marketing site's already-confirmed
// real ganap.net contract (functions/testpayment.ts there, verified
// against the vendor's own "Webhooks & API" documentation):
//   X-Ganap-Signature: HMAC-SHA256 hex of the raw body, same signing
//   secret used to sign the outgoing /v1/checkout call.
//   {
//     "event": "transaction.paid",       // the only event sent today
//     "referenceNumber": "...",
//     "externalReference": "..." | null, // the idempotencyKey from checkout
//     "amount": 499,                     // gross, in whole pesos
//     "currency": "PHP",
//     "status": "paid",
//     "customer": { "name": "...", "email": "..." } | null,
//     "metadata": { ... } | null,        // shape depends on which checkout
//                                         // started the payment, see above
//     "timestamp": "..."
//   }
//
// Idempotency: every branch checks `payments.external_reference` first and
// no-ops if that reference has already been recorded — reprocessing a
// retried delivery on the signup flow would create a duplicate client and
// project, not just a duplicate email.
//
// This webhook does NOT send a WorkOS invitation on the signup flow
// [2026-09-07 fix, unchanged by this consolidation]. See the git history
// on this file for the original explanation: the only account-creation
// entry point is the thank-you page's button (/api/auth-start?intent=
// signup); this webhook sends a payment-confirmation email instead.
//
// Required env vars: GANAP_SECRET (the one shared signing secret, used by
// every checkout in this app and the marketing site's /foryourbusiness
// checkout — all three must be configured with the SAME ganap.net
// project's secret across both Cloudflare Pages projects for signatures to
// verify). Optional: DB — a missing DB binding is a hard failure here
// (unlike the marketing site's best-effort D1 writes), since this
// webhook's entire job is writing to D1; there's nothing useful to do
// without it. RESEND_API_KEY/RESEND_FROM_EMAIL are best-effort — a missing
// pair just skips confirmation emails (logged), since the rows already
// committed are the part that actually matters.
//
// Auto-assigns the Starter Plan on the signup flow only [2026-09-07,
// unchanged]: a brand-new client (never seen this email before) gets an
// active `subscriptions` row for "starter" (functions/_lib/pricing.ts,
// ₱499, raised from ₱299 on 2026-09-11). A returning client (matched by
// email) does NOT get this.

import { hmacSha256Hex, timingSafeEqual } from "../../_lib/crypto";
import { sendEmail, paymentConfirmationEmail, upsellPurchaseEmail } from "../../_lib/email";
import { findCatalogItem } from "../../_lib/pricing";

export interface Env {
  GANAP_SECRET: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  DB?: D1Database;
}

export interface GanapWebhookPayload {
  event: string;
  referenceNumber: string;
  externalReference: string | null;
  amount: number;
  currency: string;
  status: string;
  customer: { name: string | null; email: string | null } | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

const SIGNATURE_HEADER = "X-Ganap-Signature";

function parsePayload(rawBody: string): GanapWebhookPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  if (typeof p.referenceNumber !== "string" || typeof p.event !== "string") return null;

  const customer =
    typeof p.customer === "object" && p.customer !== null
      ? (p.customer as { name?: unknown; email?: unknown })
      : null;

  return {
    event: p.event,
    referenceNumber: p.referenceNumber,
    externalReference: typeof p.externalReference === "string" ? p.externalReference : null,
    amount: typeof p.amount === "number" ? p.amount : 0,
    currency: typeof p.currency === "string" ? p.currency : "PHP",
    status: typeof p.status === "string" ? p.status : "unknown",
    customer: customer
      ? {
          name: typeof customer.name === "string" ? customer.name : null,
          email: typeof customer.email === "string" ? customer.email : null,
        }
      : null,
    metadata: typeof p.metadata === "object" && p.metadata !== null ? (p.metadata as Record<string, unknown>) : null,
    timestamp: typeof p.timestamp === "string" ? p.timestamp : "",
  };
}

function metaString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addInterval(fromIso: string, cycle: "one_time" | "annual" | "monthly"): string | null {
  const d = new Date(fromIso);
  if (cycle === "monthly") {
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  }
  // 'one_time' items can still carry a renewal (Basic's domain fee) on a
  // yearly cadence, same as 'annual' billing — both step forward one year.
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

async function handleBillOfService(db: D1Database, payload: GanapWebhookPayload, rawBody: string): Promise<Response> {
  const billId = metaString(payload.metadata, "billId");
  if (!billId) {
    console.error("ganap webhook (bill_of_service): payload missing billId in metadata, cannot process", rawBody);
    return new Response("ok", { status: 200 });
  }

  const bill = await db.prepare(`SELECT id, client_id, status FROM bills WHERE id = ?`).bind(billId).first<{ id: string; client_id: string | null; status: string }>();
  if (!bill) {
    console.error(`ganap webhook (bill_of_service): no bill found for billId ${billId}`, rawBody);
    return new Response("ok", { status: 200 });
  }
  if (bill.status === "paid") {
    console.log(`ganap webhook (bill_of_service): bill ${billId} already marked paid, skipping`);
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();
  const paymentId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO payments (id, client_id, ganap_reference_number, external_reference, amount, currency, status, source, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'bill_of_service', ?, ?)`
    )
    .bind(paymentId, bill.client_id, payload.referenceNumber, payload.externalReference, payload.amount, payload.currency, payload.status, rawBody, now)
    .run();

  await db.prepare(`UPDATE bills SET status = 'paid', paid_at = ?, payment_id = ?, updated_at = ? WHERE id = ?`).bind(now, paymentId, now, bill.id).run();

  if (bill.client_id) {
    await db
      .prepare(`INSERT INTO client_activity (id, client_id, type, description, actor_id, created_at) VALUES (?, ?, 'bill_paid', ?, NULL, ?)`)
      .bind(crypto.randomUUID(), bill.client_id, `Bill of Service paid (₱${payload.amount})`, now)
      .run();
  }

  return new Response("ok", { status: 200 });
}

async function handleInternalUpsell(
  db: D1Database,
  payload: GanapWebhookPayload,
  rawBody: string,
  env: Env
): Promise<Response> {
  const clientId = metaString(payload.metadata, "clientId");
  const itemId = metaString(payload.metadata, "itemId");
  if (!clientId || !itemId) {
    console.error("ganap webhook (internal_upsell): payload missing clientId/itemId in metadata, cannot process", rawBody);
    return new Response("ok", { status: 200 });
  }

  const catalogItem = findCatalogItem(itemId);
  if (!catalogItem) {
    console.error(`ganap webhook (internal_upsell): unknown itemId "${itemId}", cannot process`, rawBody);
    return new Response("ok", { status: 200 });
  }

  const client = await db
    .prepare(`SELECT id, email, full_name, business_name FROM clients WHERE id = ?`)
    .bind(clientId)
    .first<{ id: string; email: string; full_name: string; business_name: string }>();
  if (!client) {
    console.error(`ganap webhook (internal_upsell): no client found for clientId ${clientId}`, rawBody);
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();

  const paymentId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO payments (id, client_id, ganap_reference_number, external_reference, amount, currency, status, source, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'internal_upsell', ?, ?)`
    )
    .bind(paymentId, client.id, payload.referenceNumber, payload.externalReference, payload.amount, payload.currency, payload.status, rawBody, now)
    .run();

  // A new plan purchase supersedes any existing active plan — a client has
  // one active plan at a time. Add-ons stack (never superseded).
  if (catalogItem.itemType === "plan") {
    await db
      .prepare(`UPDATE subscriptions SET status = 'cancelled', ended_at = ? WHERE client_id = ? AND item_type = 'plan' AND status = 'active'`)
      .bind(now, client.id)
      .run();
  }

  const nextRenewalDate = catalogItem.renewalPhp ? addInterval(now, catalogItem.billing) : null;

  await db
    .prepare(
      `INSERT INTO subscriptions (id, client_id, plan, status, started_at, item_type, item_id, item_name, billing_cycle, amount_php, renewal_amount_php, next_renewal_date, payment_id)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      client.id,
      catalogItem.name,
      now,
      catalogItem.itemType,
      catalogItem.id,
      catalogItem.name,
      catalogItem.billing,
      payload.amount,
      catalogItem.renewalPhp ?? null,
      nextRenewalDate,
      paymentId
    )
    .run();

  await db
    .prepare(`INSERT INTO client_activity (id, client_id, type, description, actor_id, created_at) VALUES (?, ?, 'purchase', ?, NULL, ?)`)
    .bind(crypto.randomUUID(), client.id, `Purchased ${catalogItem.name} (₱${payload.amount})`, now)
    .run();

  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    try {
      const { subject, html } = upsellPurchaseEmail({
        clientName: client.full_name,
        businessName: client.business_name,
        itemName: catalogItem.name,
        amount: payload.amount,
        currency: payload.currency,
        renewalAmount: catalogItem.renewalPhp ?? null,
        nextRenewalDate,
      });
      await sendEmail({ RESEND_API_KEY: env.RESEND_API_KEY, RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL }, { to: client.email, subject, html });
    } catch (err) {
      console.error("ganap webhook (internal_upsell): failed to send purchase confirmation email", err);
    }
  } else {
    console.error("ganap webhook (internal_upsell): RESEND_API_KEY/RESEND_FROM_EMAIL not configured; purchase confirmation email not sent");
  }

  return new Response("ok", { status: 200 });
}

async function handleForYourBusinessSignup(db: D1Database, payload: GanapWebhookPayload, rawBody: string, env: Env): Promise<Response> {
  const email = payload.customer?.email;
  if (!email) {
    console.error("ganap webhook (foryourbusiness_299): payload has no customer email, cannot create a client", rawBody);
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();
  const fullName = payload.customer?.name || "";
  const businessName = metaString(payload.metadata, "businessName") || "";
  const phone = metaString(payload.metadata, "phone");
  const facebook = metaString(payload.metadata, "facebook");
  const existingWebsite = metaString(payload.metadata, "existingWebsite");

  let clientId: string;
  const existingClient = await db
    .prepare(`SELECT id, workos_user_id, invitation_status FROM clients WHERE LOWER(email) = LOWER(?)`)
    .bind(email)
    .first<{ id: string; workos_user_id: string | null; invitation_status: string }>();

  if (existingClient) {
    clientId = existingClient.id;
    await db
      .prepare(`UPDATE clients SET mobile = COALESCE(?, mobile), facebook = COALESCE(?, facebook), current_website = COALESCE(?, current_website), updated_at = ? WHERE id = ?`)
      .bind(phone, facebook, existingWebsite, now, clientId)
      .run();
  } else {
    clientId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO clients (id, email, full_name, business_name, mobile, facebook, current_website, invitation_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(clientId, email, fullName, businessName, phone, facebook, existingWebsite, now, now)
      .run();
  }

  const projectId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO projects (id, client_id, stage, created_at, updated_at) VALUES (?, ?, 'payment_received', ?, ?)`
    )
    .bind(projectId, clientId, now, now)
    .run();

  await db
    .prepare(
      `INSERT INTO stage_history (id, project_id, from_stage, to_stage, actor_id, reason, created_at)
       VALUES (?, ?, NULL, 'payment_received', 'system', NULL, ?)`
    )
    .bind(crypto.randomUUID(), projectId, now)
    .run();

  const paymentId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO payments (id, client_id, ganap_reference_number, external_reference, amount, currency, status, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(paymentId, clientId, payload.referenceNumber, payload.externalReference, payload.amount, payload.currency, payload.status, rawBody, now)
    .run();

  // Every new client starts on the Starter Plan (₱499, the /foryourbusiness
  // offer they just paid for) — staff can override this later from
  // ClientKeeper (functions/api/app/clients/[id]/set-plan.ts there). Only
  // for a genuinely NEW client: a returning client paying for a second
  // project already has their own plan history, which a second ₱499
  // payment shouldn't silently reset.
  if (!existingClient) {
    const starterPlan = findCatalogItem("starter");
    if (starterPlan) {
      await db
        .prepare(
          `INSERT INTO subscriptions (id, client_id, plan, status, started_at, item_type, item_id, item_name, billing_cycle, amount_php, payment_id)
           VALUES (?, ?, ?, 'active', ?, 'plan', ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), clientId, starterPlan.name, now, starterPlan.id, starterPlan.name, starterPlan.billing, starterPlan.chargeNowPhp, paymentId)
        .run();
    }
  }

  // Payment confirmation email — the only client-facing touch this
  // webhook makes now. hasAccount decides the footer: a brand-new client
  // (or one whose invitation was never accepted) gets the account-signup
  // link; a returning client who already linked WorkOS gets a dashboard
  // link instead, since re-showing "create your account" to someone who
  // already has one would just recreate the exact confusion this fix is
  // for.
  const hasAccount = Boolean(existingClient?.workos_user_id);
  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    try {
      const { subject, html } = paymentConfirmationEmail({
        clientName: fullName,
        businessName,
        amount: payload.amount,
        currency: payload.currency,
        hasAccount,
      });
      await sendEmail({ RESEND_API_KEY: env.RESEND_API_KEY, RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL }, { to: email, subject, html });
    } catch (err) {
      // The client/project/payment rows are already committed — a failed
      // email isn't a reason to fail the whole webhook (ganap.net would
      // just retry delivery and hit the idempotency check above instead
      // of re-sending). Staff can nudge the client manually via
      // ClientKeeper's resend action if this happens.
      console.error("ganap webhook (foryourbusiness_299): failed to send payment confirmation email", err);
    }
  } else {
    console.error("ganap webhook (foryourbusiness_299): RESEND_API_KEY/RESEND_FROM_EMAIL not configured; payment confirmation email not sent");
  }

  return new Response("ok", { status: 200 });
}

/**
 * The shared dispatch core, used by both the real webhook below AND the
 * manual reconciliation endpoint (functions/api/public/bill/[token]/
 * reconcile.ts) for a payment whose webhook delivery never arrived —
 * ganap's own Status & Retry API confirms `paid: true` server-to-server,
 * and this applies the exact same DB mutations a real delivery would have,
 * idempotency check included. Callers are responsible for having already
 * confirmed the transaction is actually paid (this does not re-verify a
 * signature — the reconciliation caller authenticates the status-check
 * call itself, not this function).
 */
export async function applyPaidGanapTransaction(db: D1Database, env: Env, payload: GanapWebhookPayload, rawBody: string): Promise<Response> {
  if (payload.externalReference) {
    const existing = await db
      .prepare(`SELECT id FROM payments WHERE external_reference = ?`)
      .bind(payload.externalReference)
      .first<{ id: string }>();
    if (existing) {
      console.log(`ganap webhook: externalReference ${payload.externalReference} already processed, skipping`);
      return new Response("ok", { status: 200 });
    }
  }

  if (metaString(payload.metadata, "kind") === "bill_of_service") {
    return handleBillOfService(db, payload, rawBody);
  }

  if (metaString(payload.metadata, "clientId") && metaString(payload.metadata, "itemId")) {
    return handleInternalUpsell(db, payload, rawBody, env);
  }

  return handleForYourBusinessSignup(db, payload, rawBody, env);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GANAP_SECRET || !env.DB) {
    console.error("ganap webhook: missing GANAP_SECRET or DB binding");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) || "";

  const expectedSignature = await hmacSha256Hex(env.GANAP_SECRET, rawBody);
  if (!signature || !timingSafeEqual(signature, expectedSignature)) {
    console.error("ganap webhook: signature mismatch, rejecting");
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    console.error("ganap webhook: body is not valid JSON or missing required fields", rawBody);
    return new Response("Invalid body", { status: 400 });
  }

  if (payload.event !== "transaction.paid") {
    console.log(`ganap webhook: ignoring event "${payload.event}"`);
    return new Response("ok", { status: 200 });
  }

  return applyPaidGanapTransaction(env.DB, env, payload, rawBody);
};
