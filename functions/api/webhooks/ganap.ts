// Cloudflare Pages Function: POST /api/webhooks/ganap
//
// The account-creation bridge's entry point (CLAUDE.md §0/§1.2/§1.5). This
// app owns the ganap.net webhook for the /foryourbusiness ₱299 project —
// once this is deployed, repoint that project's webhook URL (currently
// https://altasme.com/testpayment, in the marketing site repo) here, so
// this app's clients/projects/payments tables become the live source of
// truth "from payment_received onward" per the spec.
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
//     "amount": 299,                     // gross, in whole pesos
//     "currency": "PHP",
//     "status": "paid",
//     "customer": { "name": "...", "email": "..." } | null,
//     "metadata": { businessName, phone, facebook, instagram,
//                   existingWebsite, offer } | null,
//     "timestamp": "..."
//   }
//
// Idempotency: unlike the marketing site's webhook (which only sends a
// notification email on every delivery), this handler creates real
// clients/projects/payments rows — reprocessing a retried delivery would
// create a duplicate client and project, not just a duplicate email. This
// checks `payments.external_reference` first and no-ops if that reference
// has already been recorded.
//
// This webhook does NOT send a WorkOS invitation anymore [2026-09-07 fix].
// It used to call sendInvitation() here, which made WorkOS email its own
// accept_invitation_url immediately on payment — at the same moment the
// marketing site's thank-you page showed its own "Create Your Account"
// button. A real client hit both at once (one via email, one via the
// button) and got confused about which was the actual way in. Per the
// operator's explicit "only one way in" decision, the ONLY account-
// creation entry point is now the thank-you page's button
// (/api/auth-start?intent=signup); this webhook instead sends a payment-
// confirmation email (functions/_lib/email.ts) with that same link as a
// small footer notice, not a second race to complete signup.
//
// Required env vars: GANAP_SECRET (same signing secret as the
// /foryourbusiness checkout project). Optional: DB — a missing DB binding
// is a hard failure here (unlike the marketing site's best-effort D1
// writes), since this webhook's entire job is writing to D1; there's
// nothing useful to do without it. RESEND_API_KEY/RESEND_FROM_EMAIL are
// best-effort — a missing pair just skips the confirmation email (logged),
// since the client/project/payment rows already committed are the part
// that actually matters.
//
// Auto-assigns the Starter Plan [2026-09-07]: a brand-new client (never
// seen this email before) gets an active `subscriptions` row for
// "starter" (functions/_lib/pricing.ts, ₱299), so the Account page's
// "Your Plan" card and ClientKeeper's client view have something to show
// from day one, not just after a Digital Growth Plans purchase. Staff can
// override this from ClientKeeper (functions/api/app/clients/[id]/
// set-plan.ts there). A returning client (an existing row matched by
// email) does NOT get this — a second ₱299 payment for a second project
// shouldn't silently reset whatever plan they've already been set to.

import { hmacSha256Hex, timingSafeEqual } from "../../_lib/crypto";
import { sendEmail, paymentConfirmationEmail } from "../../_lib/email";
import { findCatalogItem } from "../../_lib/pricing";

interface Env {
  GANAP_SECRET: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  DB?: D1Database;
}

interface GanapWebhookPayload {
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

  const db = env.DB;

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

  const email = payload.customer?.email;
  if (!email) {
    console.error("ganap webhook: payload has no customer email, cannot create a client", rawBody);
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

  // Every new client starts on the Starter Plan (₱299, the /foryourbusiness
  // offer they just paid for) — staff can override this later from
  // ClientKeeper (functions/api/app/clients/[id]/set-plan.ts there). Only
  // for a genuinely NEW client: a returning client paying for a second
  // project already has their own plan history, which a second ₱299
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
      console.error("ganap webhook: failed to send payment confirmation email", err);
    }
  } else {
    console.error("ganap webhook: RESEND_API_KEY/RESEND_FROM_EMAIL not configured; payment confirmation email not sent");
  }

  return new Response("ok", { status: 200 });
};
