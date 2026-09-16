// Cloudflare Pages Function: POST /api/client/checkout-upsell
//
// Starts a ganap.net checkout for one Pricing-page item (a Digital Growth
// Plan or a standalone add-on). Body: { itemId: string }.
//
// Consolidated onto the single shared ganap.net project [2026-09-09] — this
// used to run through a separate alta_internal_upsell project/secret with
// its own webhook (functions/api/webhooks/internal-upsell.ts), but ganap's
// checkout API takes amount/redirects/metadata per request rather than
// tying them to a project, so there was no functional reason to keep two
// projects around. Now shares GANAP_SECRET/GANAP_PROJECT_UUID with the
// /foryourbusiness ₱299 checkout and the Bill of Service checkout, and its
// webhook is handled by the merged functions/api/webhooks/ganap.ts
// (branches on metadata.clientId/itemId vs metadata.kind ===
// "bill_of_service" vs neither). See that file's header comment for the
// full routing logic and CLAUDE.md's consolidation note for the operator
// steps this required (retiring the old project + one shared secret pair
// across both Cloudflare Pages projects).
//
// The amount charged is looked up server-side from
// functions/_lib/pricing.ts — never trusted from the request body, same
// security posture as the marketing site's checkout function. The caller
// must already be authenticated (functions/api/client/_middleware.ts) and
// their project must have reached post_presentation or later; a client
// who somehow calls this before that gate is rejected here too, not just
// hidden in the UI, per CLAUDE.md §5/§6's "every client endpoint enforces
// its own access rules server-side" rule.

import { findCatalogItem, PLAN_TIERS } from "../../_lib/pricing";
import { FORWARD_SEQUENCE, type Stage } from "../../_lib/stages";
import { startGanapCheckout } from "../../_lib/ganap";

interface Env {
  GANAP_SECRET: string;
  GANAP_PROJECT_UUID: string;
  DB?: D1Database;
}

const SUCCESS_REDIRECT_URL = "https://account.altasme.com/pricing";
const FAILURE_REDIRECT_URL = "https://account.altasme.com/pricing?retry=1";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PRICING_GATE_STAGE: Stage = "post_presentation";

export const onRequestPost: PagesFunction<Env, string, { clientId: string }> = async ({ request, env, data }) => {
  if (!env.GANAP_SECRET || !env.GANAP_PROJECT_UUID || !env.DB) {
    const missing = [
      !env.GANAP_SECRET && "GANAP_SECRET",
      !env.GANAP_PROJECT_UUID && "GANAP_PROJECT_UUID",
      !env.DB && "DB binding",
    ].filter(Boolean);
    console.error(`checkout-upsell: not configured, missing: ${missing.join(", ")}`);
    return jsonResponse(500, { error: "Payment is not configured yet. Please contact us directly." });
  }
  const db = env.DB;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid request body." });
  }
  const itemId = typeof (body as Record<string, unknown>)?.itemId === "string" ? ((body as Record<string, unknown>).itemId as string) : "";
  const isRenewal = (body as Record<string, unknown>)?.isRenewal === true;
  const item = findCatalogItem(itemId);
  if (!item) return jsonResponse(400, { error: "Unknown item." });

  // A renewal charges renewalPhp, never chargeNowPhp — chargeNowPhp for an
  // annual plan bundles the upfront fee plus the first year (Essential:
  // ₱1,500 + ₱4,200 = ₱5,700), and re-billing that every year would
  // silently double-charge the upfront fee forever. isRenewal only has an
  // effect when the item actually has a renewalPhp; requesting a renewal
  // on an item that doesn't renew falls back to chargeNowPhp (a plain
  // repeat purchase), which only matters for a client hitting this
  // directly rather than through the UI's own gated "Renew Now" button.
  const amountPhp = isRenewal && item.renewalPhp ? item.renewalPhp : item.chargeNowPhp;

  const client = await db
    .prepare(`SELECT id, email, full_name, business_name FROM clients WHERE id = ?`)
    .bind(data.clientId)
    .first<{ id: string; email: string; full_name: string; business_name: string }>();
  if (!client) return jsonResponse(404, { error: "Client not found." });

  // Clients cannot downgrade themselves — every client already starts on
  // (at least) the Starter Plan, so a plan-to-plan move to a lower tier is
  // only ever a downgrade, never a first purchase. Only staff can do this
  // (ClientKeeper's set-plan endpoint, which bypasses this check entirely
  // since it never calls this endpoint). Renewing your own current plan
  // is never blocked — its tier always equals itself, never less than.
  if (item.itemType === "plan" && item.id in PLAN_TIERS) {
    const currentPlan = await db
      .prepare(`SELECT item_id FROM subscriptions WHERE client_id = ? AND item_type = 'plan' AND status = 'active'`)
      .bind(client.id)
      .first<{ item_id: string }>();
    const currentTier = currentPlan && currentPlan.item_id in PLAN_TIERS ? PLAN_TIERS[currentPlan.item_id] : -1;
    if (PLAN_TIERS[item.id] < currentTier) {
      // Deliberately generic wording — the UI never shows this plan as an
      // option in the first place (PricingPage.tsx filters it out), so the
      // only way to hit this is a direct API call; the message shouldn't
      // name "downgrade" as a concept the client could push back on.
      return jsonResponse(403, { error: "This plan isn't available for your account right now. Please message us if you have questions." });
    }
  }

  const project = await db
    .prepare(`SELECT stage FROM projects WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(client.id)
    .first<{ stage: Stage }>();

  const stageIndex = project ? FORWARD_SEQUENCE.indexOf(project.stage as (typeof FORWARD_SEQUENCE)[number]) : -1;
  const gateIndex = FORWARD_SEQUENCE.indexOf(PRICING_GATE_STAGE);
  const unlocked = project?.stage === "completed" || (stageIndex !== -1 && stageIndex >= gateIndex);
  if (!unlocked) {
    return jsonResponse(403, { error: "Pricing isn't available for your project yet." });
  }

  const idempotencyKey = crypto.randomUUID();

  const result = await startGanapCheckout(env.GANAP_SECRET, env.GANAP_PROJECT_UUID, {
    amount: amountPhp,
    customerName: client.full_name,
    customerEmail: client.email,
    externalReference: idempotencyKey,
    metadata: {
      clientId: client.id,
      itemId: item.id,
      itemType: item.itemType,
      itemName: item.name,
      billing: item.billing,
      renewalPhp: item.renewalPhp ?? null,
      isRenewal,
    },
    successRedirectUrl: SUCCESS_REDIRECT_URL,
    failureRedirectUrl: FAILURE_REDIRECT_URL,
  });

  if (!result.ok) return jsonResponse(result.status, { error: result.error });

  return jsonResponse(200, { redirectUrl: result.redirectUrl, referenceNumber: result.referenceNumber, kind: result.kind });
};
