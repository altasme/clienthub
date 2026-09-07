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
//
// `pricingUnlocked` + `subscriptions` [2026-09-07]: the Pricing page and
// the Account page's plan/renewal display both need to know the same two
// things — whether the client is far enough along to see pricing at all,
// and what they've already bought — so both are computed once here rather
// than as separate endpoints. `pricingUnlocked` mirrors the same stage
// gate functions/api/client/checkout-upsell.ts enforces server-side (this
// copy is display-only; the checkout endpoint re-checks it independently,
// so hiding the UI here is a convenience, not the actual security
// boundary). `subscriptions` only ever returns 'active' rows.

import { FORWARD_SEQUENCE, type Stage } from "../../_lib/stages";

interface Env {
  DB?: D1Database;
}

const PRICING_GATE_STAGE: Stage = "post_presentation";

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

  let discovery: { externalStatus: string; scheduledAt: string | null; meetingLink: string | null } | null = null;
  let presentation: {
    externalStatus: string;
    scheduledAt: string | null;
    meetingLink: string | null;
    clientDecision: string | null;
  } | null = null;
  let offer: { type: string; status: string; content: unknown } | null = null;

  if (project) {
    const discoveryRow = await db
      .prepare(`SELECT external_status, scheduled_at, meeting_link FROM discovery_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(project.id)
      .first<{ external_status: string; scheduled_at: string | null; meeting_link: string | null }>();
    if (discoveryRow) {
      discovery = {
        externalStatus: discoveryRow.external_status,
        scheduledAt: discoveryRow.scheduled_at,
        meetingLink: discoveryRow.meeting_link,
      };
    }

    const presentationRow = await db
      .prepare(
        `SELECT external_status, scheduled_at, meeting_link, client_decision FROM presentations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .bind(project.id)
      .first<{ external_status: string; scheduled_at: string | null; meeting_link: string | null; client_decision: string | null }>();
    if (presentationRow) {
      presentation = {
        externalStatus: presentationRow.external_status,
        scheduledAt: presentationRow.scheduled_at,
        meetingLink: presentationRow.meeting_link,
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

  const stageIndex = project ? FORWARD_SEQUENCE.indexOf(project.stage as (typeof FORWARD_SEQUENCE)[number]) : -1;
  const gateIndex = FORWARD_SEQUENCE.indexOf(PRICING_GATE_STAGE);
  const pricingUnlocked = project?.stage === "completed" || (stageIndex !== -1 && stageIndex >= gateIndex);

  const subscriptionsResult = await db
    .prepare(
      `SELECT item_type, item_id, item_name, billing_cycle, amount_php, renewal_amount_php, next_renewal_date
       FROM subscriptions WHERE client_id = ? AND status = 'active' ORDER BY item_type ASC, started_at DESC`
    )
    .bind(client.id)
    .all<{
      item_type: string;
      item_id: string;
      item_name: string;
      billing_cycle: string;
      amount_php: number;
      renewal_amount_php: number | null;
      next_renewal_date: string | null;
    }>();

  const subscriptions = (subscriptionsResult.results ?? []).map((row) => ({
    itemType: row.item_type,
    itemId: row.item_id,
    itemName: row.item_name,
    billingCycle: row.billing_cycle,
    amountPhp: row.amount_php,
    renewalAmountPhp: row.renewal_amount_php,
    nextRenewalDate: row.next_renewal_date,
  }));

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
    pricingUnlocked,
    subscriptions,
  });
};
