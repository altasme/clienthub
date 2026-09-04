// Cloudflare Pages Function: POST /api/client/profile
//
// The one dedicated profile-edit endpoint per CLAUDE.md §5 — touches only
// name, business name, mobile, Facebook, current website. Email is
// deliberately not editable here in V1: it's the field the account-bridge
// (functions/_lib/accountBridge.ts) matches on, and there's no
// re-verification flow yet to safely let a client change it themselves.

interface Env {
  DB?: D1Database;
}

const MAX_FIELD_LENGTH = 200;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_FIELD_LENGTH);
}

export const onRequestPost: PagesFunction<Env, string, { clientId: string }> = async ({ request, env, data }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request body." });
  }

  const b = body as Record<string, unknown>;
  const fullName = typeof b.fullName === "string" ? sanitizeLine(b.fullName) : undefined;
  const businessName = typeof b.businessName === "string" ? sanitizeLine(b.businessName) : undefined;
  const mobile = typeof b.mobile === "string" ? sanitizeLine(b.mobile) : undefined;
  const facebook = typeof b.facebook === "string" ? sanitizeLine(b.facebook) : undefined;
  const currentWebsite = typeof b.currentWebsite === "string" ? sanitizeLine(b.currentWebsite) : undefined;

  if (fullName !== undefined && fullName.length === 0) return jsonResponse(400, { error: "Full name cannot be empty." });
  if (businessName !== undefined && businessName.length === 0) return jsonResponse(400, { error: "Business name cannot be empty." });

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE clients SET
       full_name = COALESCE(?, full_name),
       business_name = COALESCE(?, business_name),
       mobile = COALESCE(?, mobile),
       facebook = COALESCE(?, facebook),
       current_website = COALESCE(?, current_website),
       updated_at = ?
     WHERE id = ?`
  )
    .bind(fullName ?? null, businessName ?? null, mobile ?? null, facebook ?? null, currentWebsite ?? null, now, data.clientId)
    .run();

  return jsonResponse(200, { ok: true });
};
