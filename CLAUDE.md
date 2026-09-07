# CLAUDE.md: Altaventures Client Hub

**Artifact type:** Build specification for Claude Code
**Functional source:** `CLAUDEclienthubcrm.md` (v2.1) is authoritative for scope, stage machine, security rules, and copy. This file documents the concrete implementation decisions made while building it — where they add detail, this file and the source spec should agree; if a future edit makes them diverge, treat the source spec as the intent and this file as the as-built record.
**Domain:** `account.altasme.com`
**Sibling app:** `clientkeeper` (`clientkeeper.altasme.com`) — the internal CRM. Separate repo, separate Cloudflare Pages deployment, **same D1 database**. See "Shared D1 database" below.
**Related:** the marketing site (`altasme/altaventureswebsite`) hosts `/foryourbusiness`, whose ₱299 ganap.net checkout is the entry trigger for this app (see "Where this sits in the ecosystem" below).

---

## 0. Where this sits in the ecosystem

- Separate application from the static marketing sites (`altasme.com`, `/foryourbusiness`, `/limitedoffer`). Those stay static and chat-first. This is a full app (D1, auth, server endpoints).
- Entry trigger: the ₱299 checkout on `/foryourbusiness` is paid via ganap.net. On confirmed payment, **this app's own webhook** (not the marketing site's) creates the client + project records and sends a payment-confirmation email (see §1 item 11 — it no longer issues a WorkOS invitation). This app owns everything from `payment_received` onward.
- **The marketing site's existing `/testpayment` + `orders`/`customers` D1 tables become legacy once this ships.** Today ganap.net's webhook for the `/foryourbusiness` project points at `https://altasme.com/testpayment` (in the marketing site repo). Once this app's own webhook handler (`functions/api/webhooks/ganap.ts`) is live and deployed, **repoint ganap.net's webhook URL** (same dashboard field already used twice for that project) to this app instead, so this app's `clients`/`projects`/`payments` tables become the one live source of truth. The marketing site's old tables and functions are deliberately left in place afterward (historical paid-order data shouldn't vanish) but stop being the active path — noted here so it isn't mistaken for an oversight later.
- Formalized flow: Payment (ganap.net) → account-creation email → account created → discovery call first → build → presentation → commercial unlock → ₱1,499 → Essential. Client stages are controlled in ClientKeeper.

---

## 1. Locked decisions (beyond the source spec)

1. **Two separate GitHub repos, two Cloudflare Pages projects, one shared D1 database.** Not a monorepo. A bug in this app's client-facing code has no code path into ClientKeeper's admin endpoints — the isolation is structural (separate deployments, separate Functions), not just a convention.
2. **This app owns every public-facing endpoint.** The ganap.net payment webhook, the WorkOS invitation-acceptance callback, and all client-scoped read/write endpoints live here. **ClientKeeper has zero public endpoints** — everything there requires a staff WorkOS session. This is the strongest version of the source spec's isolation goal (§1.1).
3. **Staff roles live in a D1 `users` table, not WorkOS Organizations/roles.** Researched WorkOS's real invitation/roles API against `workos/workos-node`'s source on GitHub (`workos.com` is blocked by this sandbox's proxy, same restriction hit building the marketing site's WorkOS integration): WorkOS *can* attach a `role_slug` to a user, but only via an Organization Membership — there is no role concept for a user outside an Organization. Standing up a WorkOS Organization purely to hang four role slugs (Owner/Developer/Admin/Sales) off it is unnecessary complexity for V1, which has no self-service "invite a staff member with a role" UI anyway. Roles are assigned by a one-time manual D1 insert per hire. This is exactly the fallback the source spec itself allows (§10: "if roles are not fully managed in WorkOS"). WorkOS is used purely to authenticate *who* is making a request; authorization (*what they can do*) is a local D1 lookup.
4. **All invitations (staff and client) are plain `POST /user_management/invitations` with just `email`** (no `organization_id`, no `role_slug`) — confirmed via the same SDK-source research: WorkOS sends the invitation email itself and also returns `accept_invitation_url` if a different delivery path is ever wanted. `expires_in_days` is available if a shorter/longer expiry than WorkOS's default is wanted later.
5. **Account-creation bridge uses two redundant signals**, mirroring the ganap.net webhook-vs-browser-redirect pattern already proven on the marketing site: the primary path is the OAuth `code` exchange at `/api/auth-callback` when the browser completes AuthKit signup and redirects back; the `invitation.accepted` webhook (confirmed as a real WorkOS event via the same SDK research) is a secondary, idempotent backstop that catches acceptance even if the browser redirect never lands (closed tab, network drop, etc.). Both signals match the WorkOS user to its `clients` row by email **case-insensitively** (`LOWER(email) = LOWER(?)`) — caught live in testing: WorkOS normalizes emails to lowercase on signup, while the email stored from ganap.net's payload is only trimmed, not lowercased (whatever capitalization the customer typed at checkout), so an exact-match comparison intermittently failed for the very same address.
6. **Booking system: interim behavior only.** Per the source spec's own default (§11 open item #2), "Schedule a Call"/"Schedule Presentation" write a client-submitted preferred-times request into `discovery_sessions`/`presentations` rather than integrating a real booking system. The user is building a separate custom scheduling engine later (spec not yet supplied) and will wire it into this integration point when ready. Do not build real booking-system scaffolding speculatively.
7. **Resource/ebook library deferred to V1.1**, per the source spec's own flag that it's the most deferrable V1 item — confirmed with the user. No `resources`/`resource_access` tables in the V1 schema; add them when this is scheduled.
8. **Chat handoff reuses the marketing site's pattern, not its code** (separate repo — no cross-repo import). `src/lib/contact.ts` here has its own `wa.me`/`viber://`/`m.me` URL builders, seeded from the same numbers as `altaventureswebsite`'s `CONTACT` constant. Keep both in sync by hand if the numbers ever change.
9. **One WorkOS login, one business — confirmed with the user.** A `clients` row is 1:1 with a `workos_user_id` (enforced by a `UNIQUE` constraint), and that's a deliberate choice, not just a schema default: if the same person pays for a second, separately-emailed order, that becomes a fully separate account, not a second business folded into their existing one. This surfaced as a real bug during testing: a client already logged into WorkOS from an earlier order clicked "Create Your Account" for a *second*, differently-emailed paid order, and WorkOS silently reused the existing browser session instead of prompting a real login — the person was invisibly logged into their *first* account, with the second paid order left sitting unlinked with no indication anything was wrong. Fixed in `functions/api/auth-start.ts` by adding `prompt=login` to the authorize URL, which forces WorkOS to always show a real login/signup screen rather than silently reusing an active session (confirmed as a genuine passthrough param via `workos-node`'s own source/tests, `workos.com` being proxy-blocked here as usual). Every account-creation attempt is now a conscious choice of which email to sign in with.
10. **`screen_hint` fix [2026-09-06]: a first-time client was landing on the sign-in screen instead of sign-up.** `/api/auth-start` never set WorkOS's `screen_hint` param, and per `workos-node`'s own SDK (its `authkit-nextjs` package's `getScreenHint()` explicitly falls back to `'sign-in'` unless told `'sign-up'`), that means AuthKit's hosted UI defaulted to sign-in for every caller — including a client's very first visit right after paying, via the marketing site's "Create Your Account" link, who has no account yet. Fixed by reading an optional `?intent=signup` query param on `/api/auth-start` and only then adding `screen_hint=sign-up` to the authorize URL; the marketing site's `ForYourBusinessThankYouPage.tsx` now links to `/api/auth-start?intent=signup`. This file's other two callers — `src/lib/MeContext.tsx`'s two "unauthenticated, bounce to login" redirects, for a session-expired *returning* client — deliberately omit `?intent`, so they keep getting the (correct, default) sign-in screen. `screen_hint` is a genuine passthrough param on the `authorize` endpoint, confirmed against `workos-node`'s own interface types and test suite (`workos.com` itself proxy-blocked here, as usual).
11. **"One way in" fix [2026-09-07]: the ganap webhook no longer sends a WorkOS invitation at all.** Item 4 above (`POST /user_management/invitations`) meant WorkOS emailed its own `accept_invitation_url` automatically the instant a payment cleared — at the same moment the marketing site's thank-you page showed its own "Create Your Account" button (item 10's `?intent=signup` link). A real client hit both at once and got confused about which was the actual way to sign up, since either one worked and completed the exact same account. Per the operator's explicit instruction, there must be exactly one entry point: the thank-you page's button. `functions/api/webhooks/ganap.ts` no longer calls WorkOS's invitations API in any form — `functions/_lib/workos.ts`'s `sendInvitation()`/`WorkosInvitation` were deleted outright as a result (zero remaining callers in this repo). In its place, the webhook sends a plain **payment-confirmation email** (`functions/_lib/email.ts`, via Resend, best-effort) whose only account-creation mention is a small footer notice linking to the same `?intent=signup` URL — never the headline of the email, and omitted entirely for a returning client who already has a linked account (they get a dashboard link instead). This required no change to the actual linking logic (`functions/_lib/accountBridge.ts`): it already matched a WorkOS user to a `clients` row purely by email against an unlinked, paid row, with no dependency on an invitation token ever having existed — so self-serve signup via `/api/auth-start?intent=signup` links correctly with no invitation in the picture at all. The `invitation.accepted` webhook (`functions/api/webhooks/workos.ts`) is left in place as a harmless, now-dormant backstop — it only ever fires for a WorkOS invitation, and none get created through this app's own flow anymore, but it costs nothing to keep for the rare case of a staff member manually inviting someone from the WorkOS dashboard directly. `clientkeeper`'s "Resend Account Invitation" action (`functions/api/app/clients/[id]/resend-invite.ts`) was changed the same way — it now re-sends the same reminder email instead of a second WorkOS invitation; see that repo's CLAUDE.md.

---

## 2. Tech stack

Matches the marketing site's proven stack, so patterns and conventions transfer directly:

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS.
- **Server:** Cloudflare Pages Functions (`functions/`) — the only layer bound to D1.
- **Database:** Cloudflare D1 (SQLite), shared with `clientkeeper`.
- **File storage:** Cloudflare R2 — deferred until the resource library (V1.1).
- **Auth:** WorkOS AuthKit, called via plain `fetch()` against the REST API (no Node SDK — Cloudflare Workers isn't a Node runtime), same approach as the marketing site's `functions/api/auth-callback.ts`.
- **Email:** WorkOS sends whatever auth emails its own hosted signup/login flow triggers (magic auth, password reset) — it no longer sends a client-facing invitation email at all (see §1 item 11). Resend sends every app/funnel email (payment confirmed, discovery reminder, etc.), including the one account-creation nudge that exists.
- **Hosting:** Cloudflare Pages, custom domain `account.altasme.com`.

No `pdf-lib`/`qrcode` here — those are marketing-site-specific (WSA-free PDF generation, `/foryourbusiness` QR payment rendering) and don't apply to this app.

---

## 3. Shared D1 database

`d1/schema.sql` in **this repo** is the canonical schema — `clientkeeper` reads/writes the same physical database, it does not get its own copy of this file. Apply it once:

```
npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
```

(or paste into the D1 Console tab in the Cloudflare dashboard — if it rejects a multi-statement paste, split into smaller chunks, the same issue hit with the marketing site's simpler `orders`/`customers` schema).

**Both** Cloudflare Pages projects (`clienthub` and `clientkeeper`) must bind the *same* database id under variable name `DB` (Settings → Functions → D1 database bindings in each project). Every Function reads it as `env.DB`.

Tables (see `d1/schema.sql` for full definitions and comments): `users` (staff, role lives here), `leads`, `clients`, `businesses`, `project_stages` (static reference data, seeded in the schema file itself), `projects`, `stage_history`, `discovery_sessions`, `presentations`, `offers`, `offer_events`, `payments`, `subscriptions`, `client_activity`, `notifications`, `audit_log`.

No RLS — enforcement is entirely in the Functions layer of each app, per the source spec §6.

---

## 4. Stage machine

States: `payment_received, account_created, discovery, building, ready_for_presentation, presentation, post_presentation, offer_unlocked, conversion, essential_upsell`, plus `on_hold, cancelled, completed` reachable from any active state.

Allowed forward transitions: strictly the sequence above, one step at a time. The only way to break sequence is an admin override (a ClientKeeper-only action) that requires a reason and writes both `audit_log` and `stage_history`. Every transition — forward or override — writes `stage_history` with `actor_id` and (for overrides) `reason`.

The transition map is validated in application code (a shared TypeScript module, not recomputed from `project_stages` — that table is reference/display data only). Both this app and `clientkeeper` need the same map; until there's a real reason to share code across the two repos (there isn't yet — the two apps' server layers are deliberately independent per §1.2 above), keep the map duplicated in each repo's own stage-machine module rather than reaching for a shared package. Revisit only if the two copies actually drift.

---

## 5. Security (client-facing endpoints)

Every endpoint here must, per the source spec §6:

1. **Authenticate** the WorkOS AuthKit session.
2. **Authorize ownership** — the requested resource belongs to *this* authenticated client. Never trust an id from the request without checking it against the session.
3. **Stage-gate** — return commercial/offer data only when the client's stage has reached it. A locked offer returns nothing, not a hidden-in-the-UI value.

No endpoint here can change `stage`, `current_offer`, `current_plan`, or any other commercial column — those mutations exist only in `clientkeeper`. Profile edits (name, mobile, facebook, current_website) go through one dedicated endpoint that touches only those fields.

### 5.1 Session handling — a home-rolled cookie, deliberately not WorkOS's native session

Researched WorkOS's real session model against `workos-node`'s actual source (`workos.com` is proxy-blocked here): `access_token` is a short-lived JWT verified via `https://api.workos.com/sso/jwks/<client_id>`, refreshed via `POST /user_management/authenticate` with `grant_type=refresh_token`. WorkOS's own SDK wraps this in a "sealed session" cookie helper (`CookieSession`) built on `jose` + `iron-webcrypto` — both genuinely Web-Crypto-native, so technically usable in a Worker.

**Deliberately not used.** Pulling in `workos-node` for its session primitive risks dragging in its full HTTP client (used nowhere else in this app — everything else is plain `fetch()`, see `functions/_lib/workos.ts`) and Node-specific bundling issues beyond just that one piece. For a V1 client portal (not a banking app), `functions/_lib/session.ts` implements a simple HMAC-signed cookie instead, reusing the same `hmacSha256Hex`/`timingSafeEqual` primitives already proven for ganap.net/WorkOS webhook verification (`functions/_lib/crypto.ts`). Payload is minimal: `clientId`, `workosUserId`, `issuedAt` — a 30-day max age, `HttpOnly; Secure; SameSite=Lax`. **The real tradeoff, stated plainly:** if a client's WorkOS account is later suspended/revoked, this session keeps working until it naturally expires, rather than being invalidated immediately the way a WorkOS-native session would be. Acceptable for V1; revisit if that gap ever actually matters.

`/api/auth-callback` issues the cookie on successful account link (or re-link on a returning login). `/api/auth-logout` clears it. `functions/api/client/_middleware.ts` validates it on every route under `/api/client/*` (Cloudflare Pages Functions scopes a `_middleware.ts` to its own directory tree — `/api/auth-*` and `/api/webhooks/*` are untouched by it) and attaches `clientId`/`workosUserId` onto the request `data` object; every downstream client endpoint scopes its queries to that `clientId`, never to an id taken from the request itself.

**Failed-login state is surfaced, not silently retried.** `auth-callback.ts` redirects to `/?error=no_account` (no `clients` row matches the signed-in email — see guardrail below) or `/?error=auth_failed` (the code exchange or account link itself failed) rather than just bouncing back to the dashboard. `src/lib/MeContext.tsx` checks for `?error=` before doing anything else and, if present, renders a dedicated screen (headline + explanation + Try Again + Message Us) instead of its normal "unauthenticated → redirect to `/api/auth-start`" behavior. This was a real bug caught live: without this check, an error redirect immediately triggered another unauthenticated `/api/client/me` call, which redirected straight back into `/api/auth-start` — a silent, rapid infinite loop with no explanation ever shown to the customer.

---

## 6. V1 scope — implemented

Per the source spec §39/§40, one primary action per stage. All of the below is built and locally verified (see §7's testing note):

- **`GET /api/client/me`**: the one read endpoint the dashboard needs — profile, most recent project's stage, and whatever discovery/presentation/offer data is relevant. Internal fields (`discovery_sessions.internal_notes`, a locked offer's `content`) are never selected in the query at all, not filtered out after the fact.
- **`POST /api/client/schedule`**: "Schedule a Call" / "Schedule Presentation" — the interim booking behavior (§1.6), upserting the one `discovery_sessions`/`presentations` row per project with the client's preferred times.
- **`POST /api/client/profile`**: the one profile-edit endpoint per §5 above. Email is deliberately not editable in V1 — it's the field the account bridge matches on, and there's no re-verification flow yet to safely let a client change it themselves.
- **`src/pages/DashboardPage.tsx`**: renders one primary action per stage exactly per the list below. `src/components/ProgressRail.tsx` shows Payment/Account/Discovery/Build/Presentation done-or-active, and collapses every commercial stage (`post_presentation`, `offer_unlocked`, `conversion`, `essential_upsell`) into a single generic "Next Steps" pill — verified by screenshot that no commercial stage name ever renders there.
  - **Discovery (default post-account):** "Talk to Your Developer" — Schedule a Call + Chat with Your Developer (`src/components/ChatModal.tsx`, opens Messenger/Viber/WhatsApp via `src/lib/contact.ts`).
  - **Building:** status only, no action.
  - **Ready for Presentation:** Schedule Presentation.
  - **Presentation:** status only + chat fallback.
  - **Post-presentation onward:** renders the client's unlocked `offers` row generically (`headline`/`price`/`body` from its JSON `content`) if one exists, a generic "we'll be in touch" message if not (no offer exists to unlock yet until `clientkeeper`'s unlock action is built).
  - **on_hold / completed:** simple status states.
- **`src/pages/WebsitePage.tsx`**: adapts by stage (Discovery / In Development / Ready / Live with a visit link using `project.website_url`), exists from day 1 per the spec.
- **`src/pages/AccountPage.tsx`**: name, business, email (read-only), mobile, Facebook, current website, created date. No internal CRM fields.
- **Resources:** deferred to V1.1 (see §1.7 above) — not built.

---

## 7. Definition of done (V1)

- [x] ganap.net webhook creates client + project + payment and sends a payment-confirmation email with an account-signup link (idempotent on `external_reference`, signature-verified). It no longer issues a WorkOS invitation — see §1 item 11.
- [x] Client rows exist at payment; the WorkOS user links on self-serve signup via `/api/auth-callback` (or, for the rare manually-invited case, the `invitation.accepted` webhook backstop). "Paid, no account" list + re-issue action live in `clientkeeper` (`resend-invite.ts`, now email-based per §1 item 11); the underlying data (`clients.invitation_status`) drives both.
- [x] A WorkOS user is only ever linked to a client with a matching paid order — never provision access from a WorkOS sign-in with no paid order behind it (verified: an `invitation.accepted` event, or a plain self-serve signup, for an email with no paid order creates no client link — `linkClientAccount` matches by email against an unlinked `clients` row regardless of how the WorkOS user got there).
- [x] Verified locally (see below) for this app's own endpoints: locked offer returns nothing; no client endpoint can mutate stage/offer/plan (structurally true — no such endpoint exists); D1 unreachable except through Functions; unauthenticated requests rejected (401 on every `/api/client/*` route with no/invalid session cookie). Cross-client id guessing is moot by construction — no client endpoint accepts a client/project id from the request at all, every query is scoped to the session's own `clientId`. The remaining acceptance tests (ClientKeeper rejecting unauthenticated/wrong-role requests) belong to that repo.
- [x] Client Hub shows exactly one "what do I do now" action per stage; no future commercial offers before unlock (verified: a `locked` offer row returns `null` from `/api/client/me`, confirmed by directly flipping a seeded offer's status in a local D1 and re-querying).
- [x] ₱1,499 offer content is DB-configurable (the schema and read path support it — `offers.content` is free-form JSON). `clientkeeper`'s unlock action now exists (built after this was originally written) and ships with clearly-marked placeholder ₱1,499/Essential copy until real content is supplied — see that repo's CLAUDE.md §3/open item #5. This app's dashboard rendering was verified against a placeholder offer row inserted directly into local D1.
- [x] Booking uses the interim call-request behavior (`POST /api/client/schedule`, verified end to end against a local D1); chat opens Messenger/Viber/WhatsApp. Resend now sends the payment-confirmation email (§1 item 11); the rest of the app-email set (discovery reminder, build started, website ready, etc.) is still not wired up — a later phase (§12).

**How this was tested:** entirely against a local `wrangler pages dev` + local D1 instance (gitignored `.dev.vars`/`wrangler.toml`, deleted after every session, never committed), since this sandbox cannot reach `api.workos.com` (same restriction hit throughout this project). A client was seeded end to end through the real webhook handlers (signed ganap.net payload → signed `invitation.accepted` payload), then a session cookie was hand-constructed using the same HMAC algorithm as `functions/_lib/session.ts` (the real cookie can only come from a live WorkOS OAuth exchange, which this sandbox can't perform) to drive Playwright screenshots of the dashboard across the discovery and post-presentation-with-offer states, the schedule modal, the website page (both "in progress" and "live" variants), and the account page. Test the real WorkOS OAuth handshake and cookie issuance end to end once deployed.

---

## 7.1 Required Cloudflare Pages environment variables

Set on the `clienthub` Cloudflare Pages project (never committed): `GANAP_SECRET` (the same signing secret already used by the marketing site's `/foryourbusiness` checkout project — this app's webhook is meant to replace that project's webhook target, not add a second secret), `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET` (from registering `https://account.altasme.com/api/webhooks/workos` in the WorkOS dashboard, subscribed to at least `invitation.accepted` — kept only as the now-dormant backstop per §1 item 11), `SESSION_SECRET` (a new, randomly-generated secret for this app's own session cookie signing — see §5.1; not shared with any other app or secret), `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (§1 item 11's payment-confirmation email; best-effort — a missing pair just skips the email, logged, since the client/project/payment rows already committed are what actually matters). Optional: `DB` (the shared D1 binding — see §3; required in practice, since every endpoint here depends on it, but Cloudflare only calls it "optional" in the sense that a missing binding degrades gracefully rather than crashing the build). Note `WORKOS_API_KEY` is no longer read by the ganap webhook itself (only by `/api/auth-callback`'s code exchange) — it stays required at the app level, just not for that one function.

---

## 8. Guardrails

1. No client endpoint can change stage, offer, plan, or any commercial column, ever.
2. Locked offers are not returned by any client endpoint — not merely hidden in the UI.
3. The full pricing table (beyond the currently-unlocked offer) is never exposed to a client endpoint.
4. Account creation only ever links a WorkOS user to a `clients` row with a matching paid order behind it — a self-serve signup (or, rarely, an accepted invitation) for an email with no such row creates no link (§1 item 11).
5. D1 is reachable only through this app's own Functions — no public DB endpoint, no client-side credentials.
6. Do not build real booking-system scaffolding before its spec is supplied — the interim call-request behavior is the correct permanent state until then.
7. Do not build the resource/ebook library before it's scheduled for V1.1.
