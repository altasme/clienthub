// Cloudflare Pages Function: GET /api/auth-start
//
// Redirects to WorkOS AuthKit's hosted authorize URL. Handles both a
// brand-new client accepting their invitation email (WorkOS's own
// accept_invitation_url completes signup and then redirects through this
// same flow) and a returning client logging back in — one endpoint for
// both, same pattern as the marketing site's functions/api/auth-start.ts.
//
// client_id isn't secret (same idea as a Stripe publishable key) but is
// still read from env.WORKOS_CLIENT_ID so there's one source of truth.
//
// prompt=login forces WorkOS to always show a real login/signup screen,
// never silently reusing an existing AuthKit browser session. Reproduced
// live without this: a client already logged in from an earlier order
// clicked "Create Your Account" for a *second*, differently-emailed
// paid order and was invisibly logged straight into their first
// account — the new order sat unlinked with no indication anything was
// wrong. Per CLAUDE.md's "one login, one business" decision, every
// account-creation attempt must be a conscious choice of which email to
// use, not a silent session carry-over. Confirmed via workos-node's own
// source/tests (workos.com is proxy-blocked here) that `prompt` is a
// genuine passthrough OIDC-style param on this endpoint, with `login`
// and `consent` as the two values its own test suite exercises.
//
// Required env vars: WORKOS_CLIENT_ID.

interface Env {
  WORKOS_CLIENT_ID: string;
}

const REDIRECT_URI = "https://account.altasme.com/api/auth-callback";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.WORKOS_CLIENT_ID) {
    return new Response("Auth is not configured yet. Please contact us directly.", { status: 500 });
  }

  const authorizeUrl = new URL("https://api.workos.com/user_management/authorize");
  authorizeUrl.searchParams.set("client_id", env.WORKOS_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("provider", "authkit");
  authorizeUrl.searchParams.set("prompt", "login");

  return Response.redirect(authorizeUrl.toString(), 302);
};
