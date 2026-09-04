// Cloudflare Pages Functions middleware, scoped to everything under
// /api/client/* by directory placement (the file-based router applies a
// _middleware.ts to its own directory and subdirectories only — routes
// under /api/auth-*, /api/webhooks/* are untouched by this).
//
// Validates this app's own session cookie (functions/_lib/session.ts) and
// attaches the authenticated client's id onto the request context via
// `data`, per CLAUDE.md §5's security rules: every client-facing endpoint
// must authenticate first, and ownership checks downstream use this id —
// never an id taken from the request body/query.

import { verifySessionCookie } from "../../_lib/session";

interface Env {
  SESSION_SECRET: string;
}

export const onRequest: PagesFunction<Env, string, { clientId: string; workosUserId: string }> = async ({
  request,
  env,
  data,
  next,
}) => {
  if (!env.SESSION_SECRET) {
    return new Response(JSON.stringify({ error: "Not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const session = await verifySessionCookie(env.SESSION_SECRET, request.headers.get("Cookie"));
  if (!session) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  data.clientId = session.clientId;
  data.workosUserId = session.workosUserId;

  return next();
};
