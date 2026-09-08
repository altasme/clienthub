// Shared ganap.net checkout helpers, factored out of
// functions/api/client/checkout-upsell.ts so the new Bill of Service
// checkout (functions/api/public/bill/[token]/checkout.ts) can reuse the
// exact same request-signing/response-classification logic against the
// same alta_internal_upsell ganap.net project, rather than a third copy of
// this code.

import { hmacSha256Hex } from "./crypto";

export const GANAP_CHECKOUT_URL = "https://convex-top-api.ganap.net/v1/checkout";

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
