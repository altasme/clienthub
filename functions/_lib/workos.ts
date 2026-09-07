// Shared WorkOS User Management API helpers, called via plain fetch() —
// no Node SDK, since Cloudflare Workers isn't a Node runtime. API shape
// verified against workos-node's own source on GitHub (workos.com and
// api.workos.com are both blocked by this sandbox's egress proxy, so the
// docs site itself couldn't be fetched directly) — see CLAUDE.md §1.3/§1.4
// for the full reasoning behind the specific fields sent here.
//
// Lives under functions/_lib/ (leading underscore) so Cloudflare Pages
// Functions' file-based router excludes it from routing.

const WORKOS_API_BASE = "https://api.workos.com";

export interface WorkosUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

/**
 * Exchanges an OAuth authorization_code (from the AuthKit hosted signup
 * redirect) for the authenticated user. client_secret is the WorkOS API
 * key — server-only, must never reach the client.
 */
export async function exchangeAuthorizationCode(
  apiKey: string,
  clientId: string,
  code: string
): Promise<WorkosUser> {
  const response = await fetch(`${WORKOS_API_BASE}/user_management/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: apiKey,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WorkOS authenticate failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { user?: WorkosUser };
  if (!data.user) throw new Error("WorkOS authenticate response missing user");
  return data.user;
}
