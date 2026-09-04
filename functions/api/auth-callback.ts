// Cloudflare Pages Function: GET /api/auth-callback
//
// WorkOS AuthKit redirects here with a `code` after the client completes
// hosted signup/login (this is the registered redirect_uri for both
// /api/auth-start and the accept_invitation_url WorkOS emails). Exchanges
// the code for the authenticated user, then runs the shared account-bridge
// link (functions/_lib/accountBridge.ts) — the primary signal in the
// dual-signal design (CLAUDE.md §1.5); the invitation.accepted webhook is
// the secondary backstop for when this redirect never lands.
//
// Does NOT set up a session cookie yet — there's no dashboard built to
// protect (that's Phase 3: "WorkOS session validation middleware for
// Functions"). This endpoint's job for now is strictly the account link;
// wire up real session issuance (storing the access_token from the
// exchange response, verified via WorkOS's JWKS on protected routes) when
// the dashboard exists to need it. Same precedent as the marketing site's
// simpler bridge (functions/api/auth-callback.ts there).
//
// Required env vars: WORKOS_API_KEY, WORKOS_CLIENT_ID, DB.

import { exchangeAuthorizationCode } from "../_lib/workos";
import { linkClientAccount } from "../_lib/accountBridge";

interface Env {
  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;
  DB?: D1Database;
}

const HOME_URL = "https://account.altasme.com/";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const authError = url.searchParams.get("error");

  if (authError || !code || !env.WORKOS_API_KEY || !env.WORKOS_CLIENT_ID || !env.DB) {
    if (authError) console.error("WorkOS returned an error on callback:", authError);
    return Response.redirect(`${HOME_URL}?error=auth_failed`, 302);
  }

  let user;
  try {
    user = await exchangeAuthorizationCode(env.WORKOS_API_KEY, env.WORKOS_CLIENT_ID, code);
  } catch (err) {
    console.error("WorkOS authenticate request failed", err);
    return Response.redirect(`${HOME_URL}?error=auth_failed`, 302);
  }

  let result;
  try {
    result = await linkClientAccount(env.DB, user.id, user.email);
  } catch (err) {
    console.error("Failed to link client account", err);
    return Response.redirect(`${HOME_URL}?error=auth_failed`, 302);
  }

  if (result.outcome === "no_matching_client") {
    // Guardrail: never provision access from a WorkOS sign-in with no
    // paid order behind it. This person authenticated successfully with
    // WorkOS but has no clients row waiting for them — most likely they
    // are staff (who sign in through a different flow entirely once
    // built) or someone who reached this URL without a real invitation.
    console.error(`auth-callback: no matching client for email ${user.email} (workos user ${user.id})`);
    return Response.redirect(`${HOME_URL}?error=no_account`, 302);
  }

  return Response.redirect(`${HOME_URL}?welcome=1`, 302);
};
