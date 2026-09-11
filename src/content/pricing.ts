// Digital Growth Plans catalog — transcribed verbatim from the operator's
// supplied rate-card images (ALTAVENTURES_RATES_2.zip, 11 slides), never
// rendered as raw images per the operator's explicit instruction ("dont use
// actual images, transcribe them to an actual pricing page"). Only visible
// in Client Hub from the post-presentation stage onward (CLAUDE.md's
// Pricing page section) — this is the "internal upsell" context the
// marketing site's own CLAUDE.md guardrail #5 reserves Website Care/growth
// pricing for (never the public site, always gated to an existing client).
//
// Item `id`s are load-bearing: functions/_lib/pricing.ts (the server-side
// catalog that actually decides what a checkout charges) must carry the
// exact same ids for every purchasable item. Add/rename an id in one file,
// update the other in the same change — they're only valid as a matched
// pair, same convention as wsa.ts's PDF-coordinates pairing.
//
// Master comparison grid (slide 1) is the single source of truth for the
// included/not-included checklist below — the four individual plan slides
// (2-5) repeat much of this but occasionally disagree in small ways (e.g.
// the Starter slide's own "what's not included" list names "Support" as
// excluded, while the master grid gives Starter's Support column the value
// "Basic"); where they disagree, the master grid wins since it's the one
// head-to-head comparison meant to be read as a whole. The per-plan slides
// are used here only for tagline/case-study narrative copy, not the
// checklist itself.

export type BillingCycle = "one_time" | "annual" | "monthly";

// Plan tiers [2026-09-07], for the "clients cannot downgrade themselves"
// rule (checkout-upsell.ts enforces this server-side; the tier number here
// is what both that check and PricingPage.tsx's button logic compare
// against). Higher number = higher plan. Custom Development has no tier —
// it's quote-only and never reachable through the tier comparison at all
// (its purchasable:false already routes it to "Get a Quote" regardless).
export const PLAN_TIERS: Record<string, number> = { starter: 0, basic: 1, essential: 2, business: 3 };

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  featured?: boolean; // the rate card marks Business with a star
  priceLabel: string;
  billing: BillingCycle | "quote";
  upfrontPhp?: number;
  annualPhp?: number;
  chargeNowPhp?: number; // what the first checkout actually charges (upfront + first year for annual plans)
  domainRenewalNote?: string;
  support: string;
  included: string[];
  notIncluded?: string[];
  purchasable: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Get your business online. Fast.",
    priceLabel: "₱499 one-time",
    billing: "one_time",
    chargeNowPhp: 499,
    support: "Basic",
    included: ["Professional website (1 build)", "Altaventures subdomain", "Hosting & SSL"],
    notIncluded: [
      "Custom domain",
      "Basic SEO",
      "Business systems / domain",
      "Admin panel",
      "Business email & notifications",
      "Continuous development",
      "Done-for-you updates",
    ],
    purchasable: true,
  },
  {
    id: "basic",
    name: "Basic",
    tagline: "Get your own professional website with your own domain.",
    // Basic changed from a ₱1,500 one-time build + a separate ₱750/yr
    // domain-renewal line to a single ₱1,500/year plan that already
    // includes (basic-domain) renewal [2026-09-07 correction]. A premium
    // domain still costs more than a basic one — that's a quote, not a
    // fixed number, so it's noted in copy rather than a second SKU.
    priceLabel: "₱1,500/year",
    billing: "annual",
    chargeNowPhp: 1500,
    annualPhp: 1500,
    domainRenewalNote: "Includes domain renewal (basic domains). Premium domains subject to quote.",
    support: "Basic",
    included: ["Professional website (1 build)", "Basic .com domain", "Hosting & SSL", "Basic SEO"],
    notIncluded: ["Business systems / domain", "Admin panel", "Business email & notifications", "Continuous development", "Done-for-you updates"],
    purchasable: true,
  },
  {
    id: "essential",
    name: "Essential",
    tagline: "Start turning your website into a business system.",
    priceLabel: "₱4,200/year",
    billing: "annual",
    upfrontPhp: 1500,
    annualPhp: 4200,
    chargeNowPhp: 5700,
    domainRenewalNote: "Includes domain renewal (basic domains). Premium domains subject to quote.",
    support: "Standard",
    included: [
      "Professional website (1 build)",
      "Basic .com domain",
      "Hosting & SSL",
      "Basic SEO",
      "1 lightweight business system",
      "Admin panel",
      "Business email & notifications",
      "Continuous development",
      "2 done-for-you updates/month",
    ],
    purchasable: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "Automate and improve your business.",
    featured: true,
    priceLabel: "₱10,000/year",
    billing: "annual",
    upfrontPhp: 1500,
    annualPhp: 10000,
    chargeNowPhp: 11500,
    domainRenewalNote: "Includes domain renewal (basic domains). Premium domains subject to quote.",
    support: "Priority",
    included: [
      "Professional website (1 build)",
      "Basic .com domain",
      "Hosting & SSL",
      "Basic SEO",
      "Up to 2 advanced business systems",
      "Admin panel",
      "Business email & notifications",
      "Continuous development",
      "5 done-for-you updates/month",
    ],
    notIncluded: ["Business systems beyond 2", "Custom development & integrations"],
    purchasable: true,
  },
  {
    id: "custom",
    name: "Custom Development",
    tagline: "For businesses that need something built around a bigger scope.",
    priceLabel: "Quote (subject to scope)",
    billing: "quote",
    support: "Dedicated (subject to quote)",
    included: ["Website builds as needed", "Custom domain as needed", "Everything else subject to quote"],
    purchasable: false,
  },
];

export const PLANS_FOOTNOTE = "Additional websites, domains and business systems are available through Pay-As-You-Go or custom quotation.";

export const PLAN_BADGES = [
  { title: "Yearly Savings", body: "All paid plans are billed annually to give you the best value." },
  { title: "Cancel Anytime", body: "No lock-in contracts. Cancel or change plans whenever you need." },
  { title: "We've Got Your Back", body: "Secure hosting, regular updates, backups and reliable support." },
  { title: "A True Partner", body: "We grow with your business and help you achieve long-term success." },
];

export interface AddonItem {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  billing: BillingCycle | "quote" | "client_handled";
  chargeNowPhp?: number; // only set for items with a concrete starting price
  startingPrice?: boolean; // true = the rate card marks this with a "+"
  purchasable: boolean;
}

export interface AddonCategory {
  id: string;
  name: string;
  tagline: string;
  items: AddonItem[];
}

export const ADDON_CATEGORIES: AddonCategory[] = [
  {
    id: "additional-development",
    name: "Additional Development",
    tagline: "Expand. Enhance. Grow.",
    items: [
      { id: "addon-website", name: "Additional Website", description: "Add another website to your account.", priceLabel: "₱8,000+", billing: "one_time", chargeNowPhp: 8000, startingPrice: true, purchasable: true },
      { id: "addon-lightweight-system", name: "Additional Lightweight Business System", description: "Add a simple business system to streamline operations.", priceLabel: "₱5,000+", billing: "one_time", chargeNowPhp: 5000, startingPrice: true, purchasable: true },
      { id: "addon-advanced-system", name: "Additional Advanced Business System", description: "Add an advanced system for more complex workflows.", priceLabel: "₱10,000+", billing: "one_time", chargeNowPhp: 10000, startingPrice: true, purchasable: true },
      { id: "addon-landing-page", name: "Additional Landing Page", description: "Add a custom landing page for campaigns or promos.", priceLabel: "₱1,500+", billing: "one_time", chargeNowPhp: 1500, startingPrice: true, purchasable: true },
      { id: "addon-redesign", name: "Major Website Redesign", description: "A fresh new look and improved user experience.", priceLabel: "₱5,000+", billing: "one_time", chargeNowPhp: 5000, startingPrice: true, purchasable: true },
      { id: "addon-dfy-update", name: "Additional Done-for-You Update", description: "Need more updates? We've got you covered.", priceLabel: "₱500+", billing: "one_time", chargeNowPhp: 500, startingPrice: true, purchasable: true },
      { id: "addon-major-custom-dev", name: "Major / Custom Development", description: "Complex features or custom solutions built just for you.", priceLabel: "Subject to quote", billing: "quote", purchasable: false },
    ],
  },
  {
    id: "media-infrastructure",
    name: "Media & Infrastructure",
    tagline: "Powerful add-ons to support your growth.",
    items: [
      { id: "addon-video-storage-monthly", name: "Video Storage / Hosting (Monthly)", description: "Host and stream your videos with reliable, high-performance infrastructure. Starting at 10GB.", priceLabel: "₱500/month", billing: "monthly", chargeNowPhp: 500, purchasable: true },
      { id: "addon-video-storage-annual", name: "Video Storage / Hosting (Annual)", description: "Host and stream your videos with reliable, high-performance infrastructure. Starting at 10GB.", priceLabel: "₱6,000/year", billing: "annual", chargeNowPhp: 6000, purchasable: true },
      { id: "addon-media-storage", name: "Additional Media Storage", description: "Need more space? We'll scale it based on your requirements.", priceLabel: "Subject to capacity", billing: "quote", purchasable: false },
      { id: "addon-bandwidth", name: "High-Bandwidth / Heavy Usage", description: "For high traffic, large delivery and heavy streaming needs.", priceLabel: "Subject to quote", billing: "quote", purchasable: false },
    ],
  },
  {
    id: "integrations-business-tools",
    name: "Integrations & Business Tools",
    tagline: "Connect. Automate. Grow.",
    items: [
      { id: "addon-payment-gateway", name: "Payment Gateway Integration", description: "Accept payments securely with trusted payment gateways.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
      { id: "addon-booking-system", name: "Advanced Booking System", description: "Enable appointments, reservations and scheduling with ease.", priceLabel: "₱5,000+", billing: "one_time", chargeNowPhp: 5000, startingPrice: true, purchasable: true },
      { id: "addon-ordering-system", name: "Advanced Ordering System", description: "Power online orders, menus, carts and order management.", priceLabel: "₱5,000+", billing: "one_time", chargeNowPhp: 5000, startingPrice: true, purchasable: true },
      { id: "addon-crm", name: "CRM / Customer Management", description: "Manage leads, customers and relationships in one organized system.", priceLabel: "₱5,000+", billing: "one_time", chargeNowPhp: 5000, startingPrice: true, purchasable: true },
      { id: "addon-automation", name: "Automation / Workflow Integration", description: "Automate tasks and workflows to save time and improve efficiency.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
      { id: "addon-api-integration", name: "Third-Party API Integration", description: "Connect your website with external services and platforms.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
      { id: "addon-analytics", name: "Custom Analytics / Reporting", description: "Custom reports and dashboards tailored to your business needs.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
      { id: "addon-data-migration", name: "Data Migration", description: "Migrate your data safely and accurately from existing platforms.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
    ],
  },
  {
    id: "domains-email",
    name: "Domains & Email",
    tagline: "Add-ons to establish your professional identity.",
    items: [
      { id: "addon-additional-domain", name: "Additional Domain", description: "Add another domain to your account.", priceLabel: "Client-paid + setup", billing: "client_handled", purchasable: false },
      { id: "addon-business-email", name: "Additional Business Email Account", description: "Get a professional email address for your team.", priceLabel: "₱500+/year", billing: "annual", chargeNowPhp: 500, startingPrice: true, purchasable: true },
      { id: "addon-email-integration", name: "External Email / Service Integration", description: "Integrate with external email services and tools.", priceLabel: "₱1,500+", billing: "one_time", chargeNowPhp: 1500, startingPrice: true, purchasable: true },
    ],
  },
  {
    id: "specialized",
    name: "Specialized",
    tagline: "Advanced solutions for growing businesses.",
    items: [
      { id: "addon-multilingual", name: "Multilingual Website", description: "Reach more customers with a multilingual website.", priceLabel: "₱3,000+", billing: "one_time", chargeNowPhp: 3000, startingPrice: true, purchasable: true },
      { id: "addon-advanced-seo", name: "Advanced SEO", description: "Boost your visibility with advanced SEO strategies.", priceLabel: "Subject to quote", billing: "quote", purchasable: false },
      { id: "addon-expedited-dev", name: "Expedited Development", description: "Fast-track your project with priority development.", priceLabel: "Subject to quote", billing: "quote", purchasable: false },
      { id: "addon-complex-systems", name: "Complex / Scaled Systems", description: "Custom systems built to scale with your business.", priceLabel: "Subject to quote", billing: "quote", purchasable: false },
    ],
  },
];

export const ADDONS_FOOTNOTE = "Prices are starting prices and may vary depending on requirements.";

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function findAddon(id: string): AddonItem | undefined {
  for (const category of ADDON_CATEGORIES) {
    const item = category.items.find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
}
