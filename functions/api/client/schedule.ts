// Cloudflare Pages Function: POST /api/client/schedule
//
// The real booking engine (CLAUDE.md §10) — replaces the old interim
// "submit a few preferred times, staff calls you" behavior. Books (or
// reschedules) the caller's own project's discovery call against the
// shared weekly availability_rules. Presentation is deliberately not
// bookable here at all: per the operator's explicit split, staff set that
// date/time directly in ClientKeeper, not the client.
//
// One endpoint handles both "first booking" and "reschedule" — if the
// project already has a discovery_sessions row, this updates its
// scheduled_at in place rather than creating a second row, which is
// exactly the "can only schedule once, but can reschedule to a new future
// time" rule: there is only ever one active booking per project, and this
// is the one write path that ever changes it.
//
// Body: { startTime: string } (ISO instant, must land exactly on a real
// generated slot).

import { generateCandidateSlots, slotsConflict, type AvailabilityRule } from "../../_lib/scheduling";

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
  const startTime = typeof b.startTime === "string" ? b.startTime : null;
  if (!startTime) return jsonResponse(400, { error: "startTime is required." });

  const candidateMs = new Date(startTime).getTime();
  if (Number.isNaN(candidateMs)) return jsonResponse(400, { error: "startTime is not a valid date." });

  const project = await db
    .prepare(`SELECT id FROM projects WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(data.clientId)
    .first<{ id: string }>();
  if (!project) return jsonResponse(404, { error: "No project found." });

  const existing = await db
    .prepare(`SELECT id, scheduled_at FROM discovery_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(project.id)
    .first<{ id: string; scheduled_at: string | null }>();

  // Re-validate server-side against the live rules + current bookings —
  // never trust a client-supplied time just because it once appeared in a
  // /api/client/availability response, since time has passed and another
  // client may have taken it in the meantime.
  const rulesResult = await db
    .prepare(`SELECT day_of_week, start_time, end_time FROM availability_rules`)
    .all<AvailabilityRule>();
  const rules = rulesResult.results ?? [];
  const now = new Date();
  const validSlots = generateCandidateSlots(rules, now);
  if (!validSlots.includes(candidateMs)) {
    return jsonResponse(400, { error: "That time isn't a bookable slot. Please pick another." });
  }

  const bookedResult = await db
    .prepare(
      `SELECT scheduled_at FROM discovery_sessions WHERE external_status = 'scheduled' AND scheduled_at IS NOT NULL AND id != ?
       UNION ALL
       SELECT scheduled_at FROM presentations WHERE external_status = 'scheduled' AND scheduled_at IS NOT NULL`
    )
    .bind(existing?.id ?? "")
    .all<{ scheduled_at: string }>();
  const conflict = (bookedResult.results ?? []).some((r) => slotsConflict(candidateMs, new Date(r.scheduled_at).getTime()));
  if (conflict) {
    return jsonResponse(409, { error: "That slot was just taken. Please pick another." });
  }

  const now_iso = now.toISOString();
  const scheduledAtIso = new Date(candidateMs).toISOString();

  if (existing) {
    await db
      .prepare(`UPDATE discovery_sessions SET scheduled_at = ?, external_status = 'scheduled', updated_at = ? WHERE id = ?`)
      .bind(scheduledAtIso, now_iso, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO discovery_sessions (id, project_id, external_status, scheduled_at, created_at, updated_at) VALUES (?, ?, 'scheduled', ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), project.id, scheduledAtIso, now_iso, now_iso)
      .run();
  }

  return jsonResponse(200, { ok: true, scheduledAt: scheduledAtIso });
};
