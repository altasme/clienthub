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
// Required env vars: GANAP_SECRET (same signing secret as the
// /foryourbusiness checkout project), WORKOS_API_KEY. Optional: DB — a
// missing DB binding is a hard failure here (unlike the marketing site's
// best-effort D1 writes), since this webhook's entire job is writing to
// D1; there's nothing useful to do without it.

import { hmacSha256Hex, timingSafeEqual } from "../../_lib/crypto";
import { sendInvitation } from "../../_lib/workos";

interface Env {
  GANAP_SECRET: string;
  WORKOS_API_KEY: string;
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
  if (!env.GANAP_SECRET || !env.WORKOS_API_KEY || !env.DB) {
    console.error("ganap webhook: missing GANAP_SECRET, WORKOS_API_KEY, or DB binding");
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

  await db
    .prepare(
      `INSERT INTO payments (id, client_id, ganap_reference_number, external_reference, amount, currency, status, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      clientId,
      payload.referenceNumber,
      payload.externalReference,
      payload.amount,
      payload.currency,
      payload.status,
      rawBody,
      now
    )
    .run();

  // Only invite if this client has no linked WorkOS account yet — a
  // returning client paying for a second project shouldn't get a second
  // invitation to an account they already have.
  const needsInvitation = !existingClient || (!existingClient.workos_user_id && existingClient.invitation_status !== "accepted");
  if (needsInvitation) {
    try {
      const invitation = await sendInvitation(env.WORKOS_API_KEY, email);
      await db
        .prepare(`UPDATE clients SET workos_invitation_id = ?, invitation_status = 'pending', updated_at = ? WHERE id = ?`)
        .bind(invitation.id, now, clientId)
        .run();
    } catch (err) {
      // The client/project/payment rows are already committed — a failed
      // invitation is recoverable via ClientKeeper's re-issue action, not
      // a reason to fail the whole webhook (ganap.net would just retry
      // delivery and hit the idempotency check above instead of inviting
      // again).
      console.error("ganap webhook: failed to send WorkOS invitation", err);
    }
  }

  return new Response("ok", { status: 200 });
};
