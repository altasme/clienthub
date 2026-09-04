// Cloudflare Pages Function: POST /api/auth-logout
//
// Clears this app's session cookie (functions/_lib/session.ts). Not
// scoped under /api/client/ — logging out doesn't require a currently
// valid session (an already-expired cookie should still be clearable).

import { clearSessionCookie } from "../_lib/session";

export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
};
