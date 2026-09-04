// Cloudflare Pages Function: GET /api/auth-callback
//
// WorkOS AuthKit redirects here with a `code` after the client completes
// hosted signup/login (this is the registered redirect_uri for both
// /api/auth-start and the accept_invitation_url WorkOS emails). Exchanges
// the code for the authenticated user, runs the shared account-bridge
// link (functions/_lib/accountBridge.ts) — the primary signal in the
// dual-signal design (CLAUDE.md §1.5); the invitation.accepted webhook is
// the secondary backstop for when this redirect never lands — and, on
// success, issues this app's own session cookie (functions/_lib/session.ts;
// see that file for why it's a home-rolled cookie and not WorkOS's native
// sealed session).
//
// Required env vars: WORKOS_API_KEY, WORKOS_CLIENT_ID, SESSION_SECRET, DB.

import { exchangeAuthorizationCode } from "../_lib/workos";
import { linkClientAccount } from "../_lib/accountBridge";
import { createSessionCookie } from "../_lib/session";

interface Env {
  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;
  SESSION_SECRET: string;
  DB?: D1Database;
}

const HOME_URL = "https://account.altasme.com/";

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const authError = url.searchParams.get("error");

  if (authError || !code || !env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID || !env.SESSION_SECRET || !env.DB) {
    if (authError) console.error("WorkOS returned an error on callback:", authError);
    return redirect(`${HOME_URL}?error=auth_failed`);
  }

  let user;
  try {
    user = await exchangeAuthorizationCode(env.WORKOS_API_KEY, env.WORKOS_CLIENT_ID, code);
  } catch (err) {
    console.error("WorkOS authenticate request failed", err);
    return redirect(`${HOME_URL}?error=auth_failed`);
  }

  let result;
  try {
    result = await linkClientAccount(env.DB, user.id, user.email);
  } catch (err) {
    console.error("Failed to link client account", err);
    return redirect(`${HOME_URL}?error=auth_failed`);
  }

  if (result.outcome === "no_matching_client") {
    // Guardrail: never provision access from a WorkOS sign-in with no
    // paid order behind it. This person authenticated successfully with
    // WorkOS but has no clients row waiting for them — most likely they
    // are staff (who sign in through a different flow entirely once
    // built) or someone who reached this URL without a real invitation.
    console.error(`auth-callback: no matching client for email ${user.email} (workos user ${user.id})`);
    return redirect(`${HOME_URL}?error=no_account`);
  }

  const cookie = await createSessionCookie(env.SESSION_SECRET, {
    clientId: result.clientId,
    workosUserId: user.id,
    issuedAt: Date.now(),
  });

  return redirect(`${HOME_URL}?welcome=1`, cookie);
};
