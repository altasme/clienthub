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

// Shown once, on first login, by <WelcomeModal /> — see functions/api/client/
// welcome-dismiss.ts for how "once" is enforced server-side.
export const WELCOME_MODAL = {
  headline: "Welcome to ALTAVENTURES 👋",
  paragraphs: [
    "We help businesses build their online presence and use digital tools to work smarter and grow. We build websites, business systems, and custom digital solutions designed around your business.",
    "This is your Client Hub, where you can manage your projects, website, services, and requests in one place.",
    "A quick heads-up: the Client Hub is still in early development. Some features may still be simple or unavailable as we continue improving it.",
    "For now, our priority is putting our time into building great things for our clients, while we keep making this Hub better for you.",
    "We're glad to have you with us. Let's build what's next. 🚀",
  ],
  dismissCta: "Got it, thanks!",
} as const;
