// Shared HMAC helpers for verifying/signing ganap.net requests. Uses the
// Web Crypto API rather than Node's `crypto` module, since Cloudflare
// Workers isn't a Node runtime — same approach already proven in the
// marketing site's functions/api/checkout.ts and functions/testpayment.ts.
//
// Lives under functions/_lib/ (leading underscore) so Cloudflare Pages
// Functions' file-based router excludes it — a plain functions/lib/ dir
// would otherwise become a routable /lib/... path.

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// WorkOS webhook signature verification. Algorithm confirmed against
// workos-node's actual source (signature-provider.ts / webhooks.ts —
// workos.com is proxy-blocked in this sandbox, so this was verified via
// raw GitHub source, not the docs site): header value is
// "t=<timestamp>, v1=<hex_hmac>", the signed string is
// "<timestamp>.<rawBody>" (HMAC-SHA256, hex), and WorkOS's own SDK
// rejects anything older than a 180000ms (3 minute) tolerance window.
//
// The header *name* itself ("WorkOS-Signature") could not be verified
// byte-for-byte from source (the Node SDK is header-agnostic — callers
// extract it themselves) — this is the documented/conventional name, not
// a confirmed one. functions/api/webhooks/workos.ts reads it
// case-insensitively and logs the full header set on any verification
// failure so the real name can be confirmed against a live event if this
// guess turns out wrong.
export interface WorkosSignatureCheck {
  valid: boolean;
  reason?: string;
}

export async function verifyWorkosSignature(
  secret: string,
  rawBody: string,
  headerValue: string,
  toleranceMs = 180000
): Promise<WorkosSignatureCheck> {
  const parts = Object.fromEntries(
    headerValue.split(",").map((part) => {
      const [key, value] = part.trim().split("=");
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const providedSignature = parts.v1;
  if (!timestamp || !providedSignature) {
    return { valid: false, reason: "header missing t= or v1=" };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs < Date.now() - toleranceMs) {
    return { valid: false, reason: "timestamp missing or outside tolerance window" };
  }

  const expectedSignature = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return { valid: false, reason: "signature mismatch" };
  }

  return { valid: true };
}
