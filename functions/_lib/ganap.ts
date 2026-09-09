// Shared ganap.net checkout helpers, factored out of
// functions/api/client/checkout-upsell.ts so the Bill of Service checkout
// (functions/api/public/bill/[token]/checkout.ts) can reuse the exact same
// request-signing/response-classification logic. All three checkout call
// sites in this app now share the single consolidated ganap.net project
// (GANAP_SECRET/GANAP_PROJECT_UUID — see functions/api/webhooks/ganap.ts
// for the 2026-09-09 consolidation note).

import { hmacSha256Hex } from "./crypto";

export const GANAP_CHECKOUT_URL = "https://convex-top-api.ganap.net/v1/checkout";
export const GANAP_STATUS_URL = "https://convex-top-api.ganap.net/v1/transactions/status";

export type RedirectKind = "url" | "qr-image" | "qr-payload" | "test-placeholder";
const TEST_PLACEHOLDER_PATTERN = /^ganap-test-do-not-pay:/i;

export function classifyRedirectUrl(value: string): RedirectKind {
  if (TEST_PLACEHOLDER_PATTERN.test(value)) return "test-placeholder";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^data:image/i.test(value) || /\.(png|jpe?g|gif|webp|svg)$/i.test(value)) return "qr-image";
  return "qr-payload";
}

export interface GanapCheckoutResult {
  ok: true;
  redirectUrl: string;
  referenceNumber: string;
  kind: RedirectKind;
}

export interface GanapCheckoutError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Signs and sends a ganap.net /v1/checkout request, returning a normalized
 * result either way — callers just need to turn a failure into their own
 * jsonResponse() shape. `bodyFields` is everything ganap needs except
 * `projectUuid` (added here from `projectUuid` param) — the caller builds
 * `metadata` to fit its own purchase kind (catalog item vs. bill).
 */
export async function startGanapCheckout(
  secret: string,
  projectUuid: string,
  bodyFields: {
    amount: number;
    customerName: string;
    customerEmail: string;
    externalReference: string;
    metadata: Record<string, unknown>;
    successRedirectUrl: string;
    failureRedirectUrl: string;
  }
): Promise<GanapCheckoutResult | GanapCheckoutError> {
  const idempotencyKey = bodyFields.externalReference;

  const ganapBody = JSON.stringify({
    projectUuid,
    amount: bodyFields.amount,
    idempotencyKey,
    customerName: bodyFields.customerName,
    customerEmail: bodyFields.customerEmail,
    externalReference: bodyFields.externalReference,
    metadata: bodyFields.metadata,
    successRedirectUrl: bodyFields.successRedirectUrl,
    failureRedirectUrl: bodyFields.failureRedirectUrl,
  });

  const signature = await hmacSha256Hex(secret, ganapBody);

  let ganapResponse: Response;
  try {
    ganapResponse = await fetch(GANAP_CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ganap-Signature": signature },
      body: ganapBody,
    });
  } catch (err) {
    console.error("ganap checkout: request failed", err);
    return { ok: false, status: 502, error: "We couldn't start your payment right now. Please try again shortly." };
  }

  const ganapResponseText = await ganapResponse.text().catch(() => "");
  console.log(`ganap checkout: response (${ganapResponse.status}):`, ganapResponseText);

  if (!ganapResponse.ok) {
    return { ok: false, status: 502, error: "We couldn't start your payment right now. Please try again shortly." };
  }

  let ganapData: { referenceNumber?: string; redirectUrl?: string } | null;
  try {
    ganapData = JSON.parse(ganapResponseText) as { referenceNumber?: string; redirectUrl?: string };
  } catch {
    ganapData = null;
  }

  if (!ganapData?.redirectUrl || !ganapData.referenceNumber) {
    console.error("ganap checkout: response missing redirectUrl/referenceNumber", ganapResponseText);
    return { ok: false, status: 502, error: "We couldn't start your payment right now. Please try again shortly." };
  }

  return {
    ok: true,
    redirectUrl: ganapData.redirectUrl,
    referenceNumber: ganapData.referenceNumber,
    kind: classifyRedirectUrl(ganapData.redirectUrl),
  };
}

export interface GanapTransactionStatus {
  ok: true;
  referenceNumber: string;
  externalReference: string | null;
  status: "pending" | "paid" | "failed" | "expired";
  paid: boolean;
  amount: number;
  currency: string;
  customer: { name: string | null; email: string | null } | null;
  metadata: Record<string, unknown> | null;
  webhook: { delivered: boolean; status: string; lastResponse: string | null } | null;
}

export interface GanapStatusError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Reconciliation escape hatch (ganap's "Status & Retry API", confirmed
 * against the live project's own docs 2026-09-09) for a checkout whose
 * webhook delivery never arrived or was never trusted alone — same
 * signing recipe as /v1/checkout. Read-only on ganap's side ("safe to call
 * as often as you like"); callers decide what to do with the answer (see
 * functions/api/webhooks/ganap.ts's applyPaidGanapTransaction, which this
 * is meant to feed on a manual "check status" action).
 */
export async function checkGanapTransactionStatus(
  secret: string,
  projectUuid: string,
  referenceNumber: string
): Promise<GanapTransactionStatus | GanapStatusError> {
  const body = JSON.stringify({ projectUuid, referenceNumber });
  const signature = await hmacSha256Hex(secret, body);

  let response: Response;
  try {
    response = await fetch(GANAP_STATUS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ganap-Signature": signature },
      body,
    });
  } catch (err) {
    console.error("ganap status check: request failed", err);
    return { ok: false, status: 502, error: "Couldn't reach ganap.net to check this payment's status." };
  }

  const text = await response.text().catch(() => "");

  if (response.status === 404) return { ok: false, status: 404, error: "ganap.net doesn't recognize this reference number." };
  if (!response.ok) {
    console.error(`ganap status check: response (${response.status}):`, text);
    return { ok: false, status: 502, error: "ganap.net couldn't answer the status check right now." };
  }

  let data: Record<string, unknown> | null;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!data || typeof data.referenceNumber !== "string" || typeof data.status !== "string") {
    console.error("ganap status check: unexpected response shape", text);
    return { ok: false, status: 502, error: "ganap.net returned an unexpected response." };
  }

  const customer =
    typeof data.customer === "object" && data.customer !== null
      ? (data.customer as { name?: unknown; email?: unknown })
      : null;
  const webhook =
    typeof data.webhook === "object" && data.webhook !== null ? (data.webhook as Record<string, unknown>) : null;

  return {
    ok: true,
    referenceNumber: data.referenceNumber,
    externalReference: typeof data.externalReference === "string" ? data.externalReference : null,
    status: (["pending", "paid", "failed", "expired"] as const).includes(data.status as never)
      ? (data.status as "pending" | "paid" | "failed" | "expired")
      : "pending",
    paid: data.paid === true,
    amount: typeof data.amount === "number" ? data.amount : 0,
    currency: typeof data.currency === "string" ? data.currency : "PHP",
    customer: customer
      ? { name: typeof customer.name === "string" ? customer.name : null, email: typeof customer.email === "string" ? customer.email : null }
      : null,
    metadata: typeof data.metadata === "object" && data.metadata !== null ? (data.metadata as Record<string, unknown>) : null,
    webhook: webhook
      ? {
          delivered: webhook.delivered === true,
          status: typeof webhook.status === "string" ? webhook.status : "UNKNOWN",
          lastResponse: typeof webhook.lastResponse === "string" ? webhook.lastResponse : null,
        }
      : null,
  };
}
