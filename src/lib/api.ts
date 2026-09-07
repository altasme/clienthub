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
  discovery: { externalStatus: string; scheduledAt: string | null } | null;
  presentation: { externalStatus: string; scheduledAt: string | null; clientDecision: string | null } | null;
  offer: { type: string; status: string; content: Record<string, unknown> | null } | null;
}

export async function fetchMe(): Promise<MeResponse | "unauthenticated"> {
  const res = await fetch("/api/client/me", { credentials: "same-origin" });
  if (res.status === 401) return "unauthenticated";
  if (!res.ok) throw new Error(`Failed to load account: ${res.status}`);
  return (await res.json()) as MeResponse;
}

export async function submitSchedule(type: "discovery" | "presentation", preferredTimes: string[]): Promise<void> {
  const res = await fetch("/api/client/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ type, preferredTimes }),
  });
  if (!res.ok) throw new Error("Failed to submit your preferred times.");
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

export async function logout(): Promise<void> {
  await fetch("/api/auth-logout", { method: "POST", credentials: "same-origin" });
}

export async function dismissWelcome(): Promise<void> {
  await fetch("/api/client/welcome-dismiss", { method: "POST", credentials: "same-origin" });
}
