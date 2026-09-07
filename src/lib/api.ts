export type Stage =
  | "payment_received"
  | "account_created"
  | "discovery"
  | "building"
  | "ready_for_presentation"
  | "presentation"
  | "post_presentation"
  | "offer_unlocked"
  | "conversion"
  | "essential_upsell"
  | "on_hold"
  | "cancelled"
  | "completed";

export interface Subscription {
  itemType: "plan" | "addon";
  itemId: string;
  itemName: string;
  billingCycle: "one_time" | "annual" | "monthly";
  amountPhp: number;
  renewalAmountPhp: number | null;
  nextRenewalDate: string | null;
}

export interface MeResponse {
  client: {
    email: string;
    fullName: string;
    businessName: string;
    mobile: string | null;
    facebook: string | null;
    currentWebsite: string | null;
    createdAt: string;
    hasSeenWelcome: boolean;
  };
  project: { stage: Stage; websiteUrl: string | null } | null;
  discovery: { externalStatus: string; scheduledAt: string | null; meetingLink: string | null } | null;
  presentation: {
    externalStatus: string;
    scheduledAt: string | null;
    meetingLink: string | null;
    clientDecision: string | null;
  } | null;
  offer: { type: string; status: string; content: Record<string, unknown> | null } | null;
  pricingUnlocked: boolean;
  subscriptions: Subscription[];
}

export async function fetchMe(): Promise<MeResponse | "unauthenticated"> {
  const res = await fetch("/api/client/me", { credentials: "same-origin" });
  if (res.status === 401) return "unauthenticated";
  if (!res.ok) throw new Error(`Failed to load account: ${res.status}`);
  return (await res.json()) as MeResponse;
}

export async function fetchAvailability(): Promise<string[]> {
  const res = await fetch("/api/client/availability", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Failed to load available times.");
  const data = (await res.json()) as { slots: string[] };
  return data.slots;
}

export async function bookDiscoveryCall(startTime: string): Promise<void> {
  const res = await fetch("/api/client/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ startTime }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error || "Failed to book that time.");
  }
}

export async function updateProfile(fields: {
  fullName?: string;
  businessName?: string;
  mobile?: string;
  facebook?: string;
  currentWebsite?: string;
}): Promise<void> {
  const res = await fetch("/api/client/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("Failed to save your changes.");
}

export type RedirectKind = "url" | "qr-image" | "qr-payload" | "test-placeholder";

export async function purchaseItem(itemId: string, isRenewal = false): Promise<{ redirectUrl: string; kind: RedirectKind }> {
  const res = await fetch("/api/client/checkout-upsell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ itemId, isRenewal }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error || "We couldn't start your payment right now.");
  }
  return (await res.json()) as { redirectUrl: string; kind: RedirectKind };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth-logout", { method: "POST", credentials: "same-origin" });
}

export async function dismissWelcome(): Promise<void> {
  await fetch("/api/client/welcome-dismiss", { method: "POST", credentials: "same-origin" });
}
