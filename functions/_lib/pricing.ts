// Server-side pricing catalog — the ONLY source of truth for what a
// checkout actually charges (functions/api/client/checkout-upsell.ts looks
// up amounts here, never from a client-supplied number, same security
// pattern as the marketing site's /foryourbusiness checkout).
//
// Deliberately NOT imported from src/content/pricing.ts (the frontend
// display catalog) — this codebase's established convention is that
// functions/ and src/ keep their own copies of anything both need (see
// src/lib/api.ts's own Stage type, duplicated rather than imported from
// functions/_lib/stages.ts) rather than cross-importing between the two
// build targets. Item `id`s here MUST match src/content/pricing.ts exactly
// — add/rename one, update the other in the same change.
//
// `chargeNowPhp` is what THIS checkout call bills: for one-time items,
// that's the flat price; for annual plans, it's the upfront fee (if any)
// plus the first year combined (matching the rate card's own "Upfront
// Payment" + "/year" split shown as two numbers on one card). `renewalPhp`
// is what a later "Renew Now" charges — undefined means the item never
// renews.
//
// [2026-09-07 correction] Basic used to be a ₱1,500 one-time build plus a
// separate ₱750/year domain-renewal line; the operator corrected this —
// Basic is actually ₱1,500/year, already including (basic-domain)
// renewal, same "renewal bundled into the plan fee" shape Essential/
// Business already had. No plan has a standalone domain-renewal figure
// anymore; a premium (non-basic) domain costs more, but that's a quote,
// not a fixed number, so it isn't modeled as a catalog entry here.
//
// `tier` backs the "clients cannot downgrade themselves" rule
// (checkout-upsell.ts) — higher number = higher plan. Add-ons have no
// tier (the downgrade check only ever applies to itemType 'plan').

export type BillingCycle = "one_time" | "annual" | "monthly";
export type ItemType = "plan" | "addon";

export const PLAN_TIERS: Record<string, number> = { starter: 0, basic: 1, essential: 2, business: 3 };

export interface CatalogItem {
  id: string;
  name: string;
  itemType: ItemType;
  billing: BillingCycle;
  chargeNowPhp: number;
  renewalPhp?: number;
}

export const PRICING_CATALOG: CatalogItem[] = [
  { id: "starter", name: "Starter Plan", itemType: "plan", billing: "one_time", chargeNowPhp: 299 },
  { id: "basic", name: "Basic Plan", itemType: "plan", billing: "annual", chargeNowPhp: 1500, renewalPhp: 1500 },
  { id: "essential", name: "Essential Plan", itemType: "plan", billing: "annual", chargeNowPhp: 5700, renewalPhp: 4200 },
  { id: "business", name: "Business Plan", itemType: "plan", billing: "annual", chargeNowPhp: 11500, renewalPhp: 10000 },

  { id: "addon-website", name: "Additional Website", itemType: "addon", billing: "one_time", chargeNowPhp: 8000 },
  { id: "addon-lightweight-system", name: "Additional Lightweight Business System", itemType: "addon", billing: "one_time", chargeNowPhp: 5000 },
  { id: "addon-advanced-system", name: "Additional Advanced Business System", itemType: "addon", billing: "one_time", chargeNowPhp: 10000 },
  { id: "addon-landing-page", name: "Additional Landing Page", itemType: "addon", billing: "one_time", chargeNowPhp: 1500 },
  { id: "addon-redesign", name: "Major Website Redesign", itemType: "addon", billing: "one_time", chargeNowPhp: 5000 },
  { id: "addon-dfy-update", name: "Additional Done-for-You Update", itemType: "addon", billing: "one_time", chargeNowPhp: 500 },

  { id: "addon-video-storage-monthly", name: "Video Storage / Hosting (Monthly)", itemType: "addon", billing: "monthly", chargeNowPhp: 500, renewalPhp: 500 },
  { id: "addon-video-storage-annual", name: "Video Storage / Hosting (Annual)", itemType: "addon", billing: "annual", chargeNowPhp: 6000, renewalPhp: 6000 },

  { id: "addon-payment-gateway", name: "Payment Gateway Integration", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },
  { id: "addon-booking-system", name: "Advanced Booking System", itemType: "addon", billing: "one_time", chargeNowPhp: 5000 },
  { id: "addon-ordering-system", name: "Advanced Ordering System", itemType: "addon", billing: "one_time", chargeNowPhp: 5000 },
  { id: "addon-crm", name: "CRM / Customer Management", itemType: "addon", billing: "one_time", chargeNowPhp: 5000 },
  { id: "addon-automation", name: "Automation / Workflow Integration", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },
  { id: "addon-api-integration", name: "Third-Party API Integration", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },
  { id: "addon-analytics", name: "Custom Analytics / Reporting", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },
  { id: "addon-data-migration", name: "Data Migration", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },

  { id: "addon-business-email", name: "Additional Business Email Account", itemType: "addon", billing: "annual", chargeNowPhp: 500, renewalPhp: 500 },
  { id: "addon-email-integration", name: "External Email / Service Integration", itemType: "addon", billing: "one_time", chargeNowPhp: 1500 },

  { id: "addon-multilingual", name: "Multilingual Website", itemType: "addon", billing: "one_time", chargeNowPhp: 3000 },
];

export function findCatalogItem(id: string): CatalogItem | undefined {
  return PRICING_CATALOG.find((item) => item.id === id);
}
