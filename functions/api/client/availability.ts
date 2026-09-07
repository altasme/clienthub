// Cloudflare Pages Function: GET /api/client/availability
//
// Returns bookable discovery-call slots for the next BOOKING_HORIZON_DAYS,
// generated from the staff-defined weekly availability_rules (CLAUDE.md
// §10) minus every already-booked session across ALL clients — this is a
// shared, business-wide calendar (one team doing every discovery call and
// presentation), not something scoped to the caller's own client, so the
// conflict query intentionally does not filter by client_id.
//
// Only ever exposes slot start times, never who booked what — a client
// sees "this slot is taken" as its simple absence from the list, nothing
// about which other client holds it.

import { generateCandidateSlots, slotsConflict, type AvailabilityRule } from "../../_lib/scheduling";

interface Env {
  DB?: D1Database;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });
  const db = env.DB;

  const rulesResult = await db
    .prepare(`SELECT day_of_week, start_time, end_time FROM availability_rules`)
    .all<AvailabilityRule>();
  const rules = rulesResult.results ?? [];

  const bookedResult = await db
    .prepare(
      `SELECT scheduled_at FROM discovery_sessions WHERE external_status = 'scheduled' AND scheduled_at IS NOT NULL
       UNION ALL
       SELECT scheduled_at FROM presentations WHERE external_status = 'scheduled' AND scheduled_at IS NOT NULL`
    )
    .all<{ scheduled_at: string }>();
  const bookedMs = (bookedResult.results ?? []).map((r) => new Date(r.scheduled_at).getTime());

  const now = new Date();
  const candidates = generateCandidateSlots(rules, now);
  const openSlots = candidates.filter((slotMs) => !bookedMs.some((bookedAt) => slotsConflict(slotMs, bookedAt)));

  return jsonResponse(200, { slots: openSlots.map((ms) => new Date(ms).toISOString()) });
};
