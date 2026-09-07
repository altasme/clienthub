// Cloudflare Pages Function: GET /api/client/me
//
// The one read endpoint the dashboard needs: the authenticated client's
// own profile, their most recent project's stage, and whatever
// discovery/presentation/offer data is relevant to that stage. Ownership
// is enforced structurally — every query below is scoped to
// data.clientId from the session middleware, never an id from the
// request. Internal fields (discovery_sessions.internal_notes,
// presentations.internal_notes, a locked offer's content) are never
// selected here at all — not filtered out after the fact, simply never
// read, per CLAUDE.md §5's "internal data is never returned by a client
// endpoint" rule.

interface Env {
  DB?: D1Database;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestGet: PagesFunction<Env, string, { clientId: string }> = async ({ env, data }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });
  const db = env.DB;

  const client = await db
    .prepare(
      `SELECT id, email, full_name, business_name, mobile, facebook, current_website, created_at, welcome_dismissed_at
       FROM clients WHERE id = ?`
    )
    .bind(data.clientId)
    .first<{
      id: string;
      email: string;
      full_name: string;
      business_name: string;
      mobile: string | null;
      facebook: string | null;
      current_website: string | null;
      created_at: string;
      welcome_dismissed_at: string | null;
    }>();

  if (!client) return jsonResponse(404, { error: "Client not found" });

  const project = await db
    .prepare(`SELECT id, stage, website_url FROM projects WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(client.id)
    .first<{ id: string; stage: string; website_url: string | null }>();

  let discovery: { externalStatus: string; scheduledAt: string | null } | null = null;
  let presentation: { externalStatus: string; scheduledAt: string | null; clientDecision: string | null } | null = null;
  let offer: { type: string; status: string; content: unknown } | null = null;

  if (project) {
    const discoveryRow = await db
      .prepare(`SELECT external_status, scheduled_at FROM discovery_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(project.id)
      .first<{ external_status: string; scheduled_at: string | null }>();
    if (discoveryRow) discovery = { externalStatus: discoveryRow.external_status, scheduledAt: discoveryRow.scheduled_at };

    const presentationRow = await db
      .prepare(
        `SELECT external_status, scheduled_at, client_decision FROM presentations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .bind(project.id)
      .first<{ external_status: string; scheduled_at: string | null; client_decision: string | null }>();
    if (presentationRow) {
      presentation = {
        externalStatus: presentationRow.external_status,
        scheduledAt: presentationRow.scheduled_at,
        clientDecision: presentationRow.client_decision,
      };
    }

    // Only ever selects non-locked offers — a locked offer is invisible
    // at the query level, not filtered client-side.
    const offerRow = await db
      .prepare(`SELECT type, status, content FROM offers WHERE project_id = ? AND status != 'locked' ORDER BY created_at DESC LIMIT 1`)
      .bind(project.id)
      .first<{ type: string; status: string; content: string }>();
    if (offerRow) {
      let content: unknown = null;
      try {
        content = JSON.parse(offerRow.content);
      } catch {
        content = null;
      }
      offer = { type: offerRow.type, status: offerRow.status, content };
    }
  }

  return jsonResponse(200, {
    client: {
      email: client.email,
      fullName: client.full_name,
      businessName: client.business_name,
      mobile: client.mobile,
      facebook: client.facebook,
      currentWebsite: client.current_website,
      createdAt: client.created_at,
      hasSeenWelcome: Boolean(client.welcome_dismissed_at),
    },
    project: project ? { stage: project.stage, websiteUrl: project.website_url } : null,
    discovery,
    presentation,
    offer,
  });
};
