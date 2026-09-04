// This app's own session cookie — deliberately not WorkOS's native
// sealed-session/JWT mechanism.
//
// Researched WorkOS's real session model (workos.com is proxy-blocked
// here, so this came from workos-node's actual source on GitHub, not
// guessed): access_token is a short-lived JWT verified via a JWKS
// endpoint (https://api.workos.com/sso/jwks/<client_id>), refreshed via
// POST /user_management/authenticate with grant_type=refresh_token.
// WorkOS's own SDK bundles this into a "sealed session" cookie helper
// (CookieSession, backed by `jose` + `iron-webcrypto` — both genuinely
// Web-Crypto-native, so technically Workers-compatible).
//
// Deliberately not used here: pulling in workos-node for its HTTP client
// (used elsewhere in this app only via plain fetch(), see functions/_lib/
// workos.ts) risks Node-specific bundling issues beyond just the session
// primitive, and the refresh-token dance means every session touch can
// require a live call to WorkOS. For a V1 client portal (not a banking
// app), a simple HMAC-signed cookie — reusing the same primitive already
// proven for ganap.net/WorkOS webhook verification (functions/_lib/
// crypto.ts) — is a smaller, fully self-contained, well-understood
// mechanism. The real tradeoff, stated plainly: if a client's WorkOS
// account is later suspended/revoked, this session keeps working until
// it naturally expires (SESSION_MAX_AGE_MS below), rather than being
// invalidated immediately the way a WorkOS-native session would be.
// Acceptable for V1; revisit if that gap ever actually matters.
//
// Session payload is intentionally minimal: clientId (this app's own
// clients.id) and workosUserId, plus issuedAt for expiry. No commercial
// data lives in the cookie — every request still re-reads current state
// from D1.

import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export const SESSION_COOKIE_NAME = "ch_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  clientId: string;
  workosUserId: string;
  issuedAt: number;
}

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return atob(padded);
}

export async function createSessionCookie(secret: string, payload: SessionPayload): Promise<string> {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256Hex(secret, encodedPayload);
  const value = `${encodedPayload}.${signature}`;

  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const entries = cookieHeader.split(";").map((part) => {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) return [part.trim(), ""] as const;
    return [part.slice(0, eqIndex).trim(), part.slice(eqIndex + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

export async function verifySessionCookie(secret: string, cookieHeader: string | null): Promise<SessionPayload | null> {
  const cookies = parseCookieHeader(cookieHeader);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = await hmacSha256Hex(secret, encodedPayload);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.clientId !== "string" || typeof payload.workosUserId !== "string" || typeof payload.issuedAt !== "number") {
    return null;
  }

  if (Date.now() - payload.issuedAt > SESSION_MAX_AGE_MS) return null;

  return payload;
}
