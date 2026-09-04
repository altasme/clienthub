// Cloudflare Pages Function: POST /api/client/schedule
//
// "Schedule a Call" / "Schedule Presentation" — the interim booking
// behavior (CLAUDE.md §1.6): logs the client's preferred times to
// ClientKeeper as a task rather than integrating a real booking system,
// which doesn't exist yet. Upserts the one discovery_sessions or
// presentations row per project (the UI only ever shows the latest).
//
// Body: { type: "discovery" | "presentation", preferredTimes: string[] }

interface Env {
  DB?: D1Database;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestPost: PagesFunction<Env, string, { clientId: string }> = async ({ request, env, data }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });
  const db = env.DB;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request body." });
  }

  const b = body as Record<string, unknown>;
  const type = b.type;
  const preferredTimes = Array.isArray(b.preferredTimes)
    ? b.preferredTimes.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 5)
    : [];

  if (type !== "discovery" && type !== "presentation") {
    return jsonResponse(400, { error: "type must be 'discovery' or 'presentation'." });
  }
  if (preferredTimes.length === 0) {
    return jsonResponse(400, { error: "At least one preferred time is required." });
  }

  const project = await db
    .prepare(`SELECT id FROM projects WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(data.clientId)
    .first<{ id: string }>();
  if (!project) return jsonResponse(404, { error: "No project found." });

  const now = new Date().toISOString();
  const preferredTimesJson = JSON.stringify(preferredTimes);

  // Table name is never interpolated from input — two fully separate,
  // hardcoded-table statements per branch, chosen only by the validated
  // `type` above.
  if (type === "discovery") {
    const existing = await db
      .prepare(`SELECT id FROM discovery_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(project.id)
      .first<{ id: string }>();
    if (existing) {
      await db
        .prepare(`UPDATE discovery_sessions SET preferred_times = ?, updated_at = ? WHERE id = ?`)
        .bind(preferredTimesJson, now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO discovery_sessions (id, project_id, external_status, preferred_times, created_at, updated_at) VALUES (?, ?, 'requested', ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), project.id, preferredTimesJson, now, now)
        .run();
    }
  } else {
    const existing = await db
      .prepare(`SELECT id FROM presentations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(project.id)
      .first<{ id: string }>();
    if (existing) {
      await db
        .prepare(`UPDATE presentations SET preferred_times = ?, updated_at = ? WHERE id = ?`)
        .bind(preferredTimesJson, now, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO presentations (id, project_id, external_status, preferred_times, created_at, updated_at) VALUES (?, ?, 'requested', ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), project.id, preferredTimesJson, now, now)
        .run();
    }
  }

  return jsonResponse(200, { ok: true });
};
