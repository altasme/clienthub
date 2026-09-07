// Cloudflare Pages Function: POST /api/client/welcome-dismiss
//
// Marks the first-login welcome modal as seen for the authenticated
// client, scoped to data.clientId from the session middleware (never a
// client-supplied id, same ownership pattern as every other /api/client/*
// endpoint). Idempotent — calling this more than once just re-stamps
// welcome_dismissed_at, which is harmless since the frontend only ever
// checks whether it's non-NULL.

interface Env {
  DB?: D1Database;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestPost: PagesFunction<Env, string, { clientId: string }> = async ({ env, data }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });

  await env.DB.prepare(`UPDATE clients SET welcome_dismissed_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), data.clientId)
    .run();

  return jsonResponse(200, { ok: true });
};
