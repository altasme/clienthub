// Cloudflare Pages Function: POST /api/webhooks/internal-upsell
//
// Webhook for the alta_internal_upsell ganap.net project (Pricing page
// purchases — Digital Growth Plans + standalone add-ons). Separate project,
// separate signing secret, from the /foryourbusiness ₱299 checkout's
// webhook (functions/api/webhooks/ganap.ts) — same payload shape/signing
// scheme, confirmed against the vendor docs supplied specifically for this
// project (Internal_Upsell.txt).
//
// IMPORTANT — operator action needed: the ganap.net dashboard for this
// project is currently configured with webhook URL
// https://altasme.com/internalupsell (the MARKETING SITE's domain). That
// matches the URL shown in Internal_Upsell.txt, but this handler lives in
// Client Hub instead, for the same reason the /foryourbusiness webhook was
// deliberately repointed from altasme.com to account.altasme.com once
// Client Hub existed (CLAUDE.md's "CORRECTION" note in the marketing site
// repo): a payment that creates/updates a client's plan belongs with the
// client data it's updating, not duplicated into a second database the
// marketing site has no reason to own. Repoint this project's webhook URL
// in the ganap.net dashboard to
// https://account.altasme.com/api/webhooks/internal-upsell before this
// goes live — until then, no deliveries will reach this handler at all.
//
// Idempotency: checks payments.external_reference before writing, same as
// functions/api/webhooks/ganap.ts.

import { hmacSha256Hex, timingSafeEqual } from "../../_lib/crypto";
import { sendEmail, upsellPurchaseEmail } from "../../_lib/email";
import { findCatalogItem } from "../../_lib/pricing";

interface Env {
  GANAP_INTERNAL_UPSELL_SECRET: string;
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

  return {
    event: p.event,
    referenceNumber: p.referenceNumber,
    externalReference: typeof p.externalReference === "string" ? p.externalReference : null,
    amount: typeof p.amount === "number" ? p.amount : 0,
    currency: typeof p.currency === "string" ? p.currency : "PHP",
    status: typeof p.status === "string" ? p.status : "unknown",
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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GANAP_INTERNAL_UPSELL_SECRET || !env.DB) {
    console.error("internal-upsell webhook: missing GANAP_INTERNAL_UPSELL_SECRET or DB binding");
    return new Response("Not configured", { status: 500 });
  }
  const db = env.DB;

  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) || "";
  const expectedSignature = await hmacSha256Hex(env.GANAP_INTERNAL_UPSELL_SECRET, rawBody);
  if (!signature || !timingSafeEqual(signature, expectedSignature)) {
    console.error("internal-upsell webhook: signature mismatch, rejecting");
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    console.error("internal-upsell webhook: body is not valid JSON or missing required fields", rawBody);
    return new Response("Invalid body", { status: 400 });
  }

  if (payload.event !== "transaction.paid") {
    console.log(`internal-upsell webhook: ignoring event "${payload.event}"`);
    return new Response("ok", { status: 200 });
  }

  if (payload.externalReference) {
    const existing = await db
      .prepare(`SELECT id FROM payments WHERE external_reference = ?`)
      .bind(payload.externalReference)
      .first<{ id: string }>();
    if (existing) {
      console.log(`internal-upsell webhook: externalReference ${payload.externalReference} already processed, skipping`);
      return new Response("ok", { status: 200 });
    }
  }

  const clientId = metaString(payload.metadata, "clientId");
  const itemId = metaString(payload.metadata, "itemId");
  if (!clientId || !itemId) {
    console.error("internal-upsell webhook: payload missing clientId/itemId in metadata, cannot process", rawBody);
    return new Response("ok", { status: 200 });
  }

  const catalogItem = findCatalogItem(itemId);
  if (!catalogItem) {
    console.error(`internal-upsell webhook: unknown itemId "${itemId}", cannot process`, rawBody);
    return new Response("ok", { status: 200 });
  }

  const client = await db
    .prepare(`SELECT id, email, full_name, business_name FROM clients WHERE id = ?`)
    .bind(clientId)
    .first<{ id: string; email: string; full_name: string; business_name: string }>();
  if (!client) {
    console.error(`internal-upsell webhook: no client found for clientId ${clientId}`, rawBody);
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
      console.error("internal-upsell webhook: failed to send purchase confirmation email", err);
    }
  } else {
    console.error("internal-upsell webhook: RESEND_API_KEY/RESEND_FROM_EMAIL not configured; purchase confirmation email not sent");
  }

  return new Response("ok", { status: 200 });
};
