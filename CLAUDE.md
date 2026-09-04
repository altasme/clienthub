# CLAUDE.md: Altaventures Client Hub

**Artifact type:** Build specification for Claude Code
**Functional source:** `CLAUDEclienthubcrm.md` (v2.1) is authoritative for scope, stage machine, security rules, and copy. This file documents the concrete implementation decisions made while building it — where they add detail, this file and the source spec should agree; if a future edit makes them diverge, treat the source spec as the intent and this file as the as-built record.
**Domain:** `account.altasme.com`
**Sibling app:** `clientkeeper` (`clientkeeper.altasme.com`) — the internal CRM. Separate repo, separate Cloudflare Pages deployment, **same D1 database**. See "Shared D1 database" below.
**Related:** the marketing site (`altasme/altaventureswebsite`) hosts `/foryourbusiness`, whose ₱299 ganap.net checkout is the entry trigger for this app (see "Where this sits in the ecosystem" below).

---

## 0. Where this sits in the ecosystem

- Separate application from the static marketing sites (`altasme.com`, `/foryourbusiness`, `/limitedoffer`). Those stay static and chat-first. This is a full app (D1, auth, server endpoints).
- Entry trigger: the ₱299 checkout on `/foryourbusiness` is paid via ganap.net. On confirmed payment, **this app's own webhook** (not the marketing site's) creates the client + project records and issues the WorkOS invitation. This app owns everything from `payment_received` onward.
- **The marketing site's existing `/testpayment` + `orders`/`customers` D1 tables become legacy once this ships.** Today ganap.net's webhook for the `/foryourbusiness` project points at `https://altasme.com/testpayment` (in the marketing site repo). Once this app's own webhook handler (`functions/api/webhooks/ganap.ts`) is live and deployed, **repoint ganap.net's webhook URL** (same dashboard field already used twice for that project) to this app instead, so this app's `clients`/`projects`/`payments` tables become the one live source of truth. The marketing site's old tables and functions are deliberately left in place afterward (historical paid-order data shouldn't vanish) but stop being the active path — noted here so it isn't mistaken for an oversight later.
- Formalized flow: Payment (ganap.net) → account-creation email → account created → discovery call first → build → presentation → commercial unlock → ₱1,499 → Essential. Client stages are controlled in ClientKeeper.

---

## 1. Locked decisions (beyond the source spec)

1. **Two separate GitHub repos, two Cloudflare Pages projects, one shared D1 database.** Not a monorepo. A bug in this app's client-facing code has no code path into ClientKeeper's admin endpoints — the isolation is structural (separate deployments, separate Functions), not just a convention.
2. **This app owns every public-facing endpoint.** The ganap.net payment webhook, the WorkOS invitation-acceptance callback, and all client-scoped read/write endpoints live here. **ClientKeeper has zero public endpoints** — everything there requires a staff WorkOS session. This is the strongest version of the source spec's isolation goal (§1.1).
3. **Staff roles live in a D1 `users` table, not WorkOS Organizations/roles.** Researched WorkOS's real invitation/roles API against `workos/workos-node`'s source on GitHub (`workos.com` is blocked by this sandbox's proxy, same restriction hit building the marketing site's WorkOS integration): WorkOS *can* attach a `role_slug` to a user, but only via an Organization Membership — there is no role concept for a user outside an Organization. Standing up a WorkOS Organization purely to hang four role slugs (Owner/Developer/Admin/Sales) off it is unnecessary complexity for V1, which has no self-service "invite a staff member with a role" UI anyway. Roles are assigned by a one-time manual D1 insert per hire. This is exactly the fallback the source spec itself allows (§10: "if roles are not fully managed in WorkOS"). WorkOS is used purely to authenticate *who* is making a request; authorization (*what they can do*) is a local D1 lookup.
4. **All invitations (staff and client) are plain `POST /user_management/invitations` with just `email`** (no `organization_id`, no `role_slug`) — confirmed via the same SDK-source research: WorkOS sends the invitation email itself and also returns `accept_invitation_url` if a different delivery path is ever wanted. `expires_in_days` is available if a shorter/longer expiry than WorkOS's default is wanted later.
5. **Account-creation bridge uses two redundant signals**, mirroring the ganap.net webhook-vs-browser-redirect pattern already proven on the marketing site: the primary path is the OAuth `code` exchange at `/api/auth-callback` when the browser completes AuthKit signup and redirects back; the `invitation.accepted` webhook (confirmed as a real WorkOS event via the same SDK research) is a secondary, idempotent backstop that catches acceptance even if the browser redirect never lands (closed tab, network drop, etc.).
6. **Booking system: interim behavior only.** Per the source spec's own default (§11 open item #2), "Schedule a Call"/"Schedule Presentation" write a client-submitted preferred-times request into `discovery_sessions`/`presentations` rather than integrating a real booking system. The user is building a separate custom scheduling engine later (spec not yet supplied) and will wire it into this integration point when ready. Do not build real booking-system scaffolding speculatively.
7. **Resource/ebook library deferred to V1.1**, per the source spec's own flag that it's the most deferrable V1 item — confirmed with the user. No `resources`/`resource_access` tables in the V1 schema; add them when this is scheduled.
8. **Chat handoff reuses the marketing site's pattern, not its code** (separate repo — no cross-repo import). `src/lib/contact.ts` here has its own `wa.me`/`viber://`/`m.me` URL builders, seeded from the same numbers as `altaventureswebsite`'s `CONTACT` constant. Keep both in sync by hand if the numbers ever change.

---

## 2. Tech stack

Matches the marketing site's proven stack, so patterns and conventions transfer directly:

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS.
- **Server:** Cloudflare Pages Functions (`functions/`) — the only layer bound to D1.
- **Database:** Cloudflare D1 (SQLite), shared with `clientkeeper`.
- **File storage:** Cloudflare R2 — deferred until the resource library (V1.1).
- **Auth:** WorkOS AuthKit, called via plain `fetch()` against the REST API (no Node SDK — Cloudflare Workers isn't a Node runtime), same approach as the marketing site's `functions/api/auth-callback.ts`.
- **Email:** WorkOS sends its own auth emails (invitation, magic auth, password reset); Resend sends app/funnel emails (payment confirmed, discovery reminder, etc.).
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

---

## 6. V1 scope

Per the source spec §39/§40, one primary action per stage:

- **Discovery (default post-account):** project card, "Talk to Your Developer" (Schedule a Call via the interim booking behavior above; Chat with Your Developer via Messenger/Viber/WhatsApp). Progress rail shows Payment/Account done, Discovery active, Build/Presentation/Next Steps upcoming — no commercial stages visible yet.
- **Building:** status only, no action.
- **Ready for Presentation:** Schedule Presentation (interim booking behavior).
- **Post-presentation:** the ₱1,499 offer appears for the first time.
- **Website page:** exists from day 1, adapts by stage (Discovery / In Development / Ready / Live with a visit link).
- **Account page:** name, business, email, mobile, Facebook, current website, created date, security. No internal CRM fields ever surface here.
- **Resources:** deferred to V1.1 (see §1.7 above).

---

## 7. Definition of done (V1)

- [ ] ganap.net webhook creates client + project + payment and issues a WorkOS invitation (idempotent on `external_reference`, signature-verified).
- [ ] Client rows exist at payment; the WorkOS user links on invitation acceptance (via `/api/auth-callback` and the `invitation.accepted` webhook backstop); "paid, no account" is queryable and re-issuable (the query/action lives in `clientkeeper`, but the underlying data comes from here).
- [ ] A WorkOS user is only ever linked to a client with a matching paid order — never provision access from a WorkOS sign-in with no paid order behind it.
- [ ] The five security acceptance tests from the source spec §6 all pass (locked offer returns nothing; no client endpoint can mutate stage/offer/plan; cross-client id guessing returns 403/empty; D1 unreachable except through Functions; unauthenticated requests rejected).
- [ ] Client Hub shows exactly one "what do I do now" action per stage; no future commercial offers before unlock.
- [ ] ₱1,499 offer content is DB-configurable, not hardcoded — ships with placeholder copy until the real price/copy is provided.
- [ ] Booking uses the interim call-request behavior; chat opens Messenger/Viber/WhatsApp; Resend sends app emails; WorkOS sends auth emails.

---

## 8. Guardrails

1. No client endpoint can change stage, offer, plan, or any commercial column, ever.
2. Locked offers are not returned by any client endpoint — not merely hidden in the UI.
3. The full pricing table (beyond the currently-unlocked offer) is never exposed to a client endpoint.
4. Account creation requires a paid, unconsumed, unexpired, order-bound invitation.
5. D1 is reachable only through this app's own Functions — no public DB endpoint, no client-side credentials.
6. Do not build real booking-system scaffolding before its spec is supplied — the interim call-request behavior is the correct permanent state until then.
7. Do not build the resource/ebook library before it's scheduled for V1.1.
