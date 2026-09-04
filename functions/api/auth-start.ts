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

  return Response.redirect(authorizeUrl.toString(), 302);
};
