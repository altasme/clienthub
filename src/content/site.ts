// Brand + contact constants, seeded from the marketing site's own
// content/site.ts (altaventureswebsite repo). Kept as a separate copy
// here rather than a cross-repo import (CLAUDE.md §1.8) — keep both in
// sync by hand if the numbers ever change.

export const BRAND = {
  name: "Altaventures",
  logo: "/images/brand/altaventures-logo.png",
} as const;

export const CONTACT = {
  whatsapp: {
    number: "639212836683",
  },
  viber: {
    number: "+639212836683",
  },
  messenger: {
    handle: "vanamaranto.moto",
  },
} as const;
