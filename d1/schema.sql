-- Shared D1 schema for the Altaventures Client Hub + ClientKeeper CRM.
--
-- This is the canonical copy (lives in the clienthub repo since clienthub
-- owns the account-creation bridge, the first writer of this data); the
-- clientkeeper repo reads/writes the same physical D1 database instance —
-- both Cloudflare Pages projects bind the same database id, they do not
-- each get their own copy of this schema.
--
-- Apply once against the shared database:
--   npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
-- (or paste into the D1 database's Console tab in the Cloudflare dashboard,
-- as separate statements if the console rejects a multi-statement paste —
-- this happened with the marketing site's simpler orders/customers schema
-- too, see altaventureswebsite/CLAUDE.md §19).
--
-- No RLS: D1 has none, and none is needed here, because the database is
-- never reachable except through this app's own Cloudflare Pages Functions
-- (see CLAUDE.md §6 in this repo). All access control lives in the server
-- layer, not in the schema.
--
-- Roles live here (`users.role`), not in WorkOS. WorkOS's User Management
-- API can attach a role to a user, but only via an Organization Membership
-- — there's no role concept for a user outside an Organization. Standing
-- up a WorkOS Organization purely to hang four role slugs off it is
-- unnecessary for V1 (no self-service "invite a staff member with a role"
-- UI yet), so staff roles are assigned here directly (a one-time insert
-- per hire) and WorkOS is used purely to authenticate *who* is making a
-- request, not *what they're allowed to do*.

-- Staff (Owner/Developer/Admin/Sales), keyed by their WorkOS user id.
-- Seeded manually — there is no self-service "add a staff member" flow in
-- V1; insert a row here after inviting someone via WorkOS and confirming
-- their workos_user_id (e.g. from the invitation.accepted webhook payload
-- or the WorkOS dashboard).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- WorkOS user id
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'developer', 'admin', 'sales')),
  created_at TEXT NOT NULL
);

-- Pre-payment records. `source` tracks where the lead came from
-- (/foryourbusiness, /limitedoffer, referral, manual, etc.) for the
-- acquisition analytics in the spec (§37/§13 of the CLAUDE.md docs).
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  full_name TEXT,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The client record itself. Rows exist from PAYMENT_RECEIVED — before any
-- auth account exists — per the account-creation bridge (CLAUDE.md §4):
-- workos_user_id stays NULL until the invitation is accepted.
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  workos_user_id TEXT UNIQUE,        -- NULL until invitation accepted
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  mobile TEXT,
  facebook TEXT,
  current_website TEXT,
  -- Invitation bookkeeping, so a paid-but-no-account client is never
  -- invisible (CLAUDE.md §4's "Paid, no account yet" list + re-issue).
  workos_invitation_id TEXT,
  invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'accepted', 'expired', 'revoked')),
  -- NULL until the client dismisses the first-login welcome modal
  -- (functions/api/client/welcome-dismiss.ts); non-NULL means never show
  -- it again. A fresh CREATE TABLE picks this up automatically, but the
  -- live database needs a manual migration — see CLAUDE.md's note on this
  -- column for the exact ALTER TABLE statement, since this file's
  -- CREATE TABLE IF NOT EXISTS is a no-op against an existing table.
  welcome_dismissed_at TEXT,
  -- Staff-set record-keeping fields (ClientKeeper's Client Detail page,
  -- "YYYY-MM-DD"), not derived from any billing/renewal logic: an admin
  -- types these in directly so domain/plan renewal dates can be tracked
  -- even for clients with no subscriptions row (a comp, a legacy client,
  -- the new no-op "free"/"299" catalog entries) or whose real domain
  -- registrar/renewal date doesn't match subscriptions.next_renewal_date's
  -- auto-computed billing-cycle math. NULL means not tracked yet.
  --
  -- domain_registered_at is the date the domain was actually registered
  -- (renamed from an earlier, briefly-drafted domain_expires_at that was
  -- never deployed — see clientkeeper's CLAUDE.md §19/§20). Expiration is
  -- NOT a stored column: it's always computed as registration + 1 year,
  -- everywhere it's shown (ClientKeeper's UI, the renewal reminder email),
  -- so there is exactly one source of truth for that date and no risk of
  -- the two drifting apart if a registration date is corrected later.
  --
  -- Same live-database migration caveat as welcome_dismissed_at above —
  -- see clientkeeper's CLAUDE.md for the exact ALTER TABLE statements.
  domain_registered_at TEXT,
  plan_renewal_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_invitation_status ON clients(invitation_status);

-- Optional richer business profile, separate from the client's own contact
-- fields (a client can in principle run more than one business, though V1
-- UI only ever shows one).
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  industry TEXT,
  created_at TEXT NOT NULL
);

-- Static reference data: the allowed stage set and its canonical order.
-- The transition map itself (which stage can move to which) is enforced
-- in application code (see clienthub's shared stage-machine module), not
-- recomputed from this table — this table exists so both apps can render
-- a consistent progress rail/label without hardcoding the list twice.
CREATE TABLE IF NOT EXISTS project_stages (
  stage TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL
);

INSERT OR IGNORE INTO project_stages (stage, sort_order, label) VALUES
  ('payment_received', 1, 'Payment Received'),
  ('account_created', 2, 'Account Created'),
  ('discovery', 3, 'Discovery'),
  ('building', 4, 'Building'),
  ('ready_for_presentation', 5, 'Ready for Presentation'),
  ('presentation', 6, 'Presentation'),
  ('post_presentation', 7, 'Post-Presentation'),
  ('offer_unlocked', 8, 'Offer Unlocked'),
  ('conversion', 9, 'Conversion (1499)'),
  ('essential_upsell', 10, 'Essential Upsell'),
  ('on_hold', 99, 'On Hold'),
  ('cancelled', 99, 'Cancelled'),
  ('completed', 99, 'Completed');

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  business_id TEXT REFERENCES businesses(id),
  stage TEXT NOT NULL DEFAULT 'payment_received' REFERENCES project_stages(stage),
  assigned_developer_id TEXT REFERENCES users(id),
  website_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

-- Every stage transition, whether a normal forward move or an audited
-- admin override (CLAUDE.md §5). actor_id is a users.id for staff actions
-- or the literal string 'system' for the payment webhook's initial write.
CREATE TABLE IF NOT EXISTS stage_history (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  actor_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stage_history_project_id ON stage_history(project_id);

-- Internal discovery fields + the client-visible external status; the
-- client endpoint only ever returns external_status, never internal_notes
-- (CLAUDE.md §6's "internal data is never returned by a client endpoint").
-- preferred_times is legacy from the interim call-request behavior this
-- table originally shipped with (§11 open item #2) — kept, unused, rather
-- than dropped, now that the real booking engine (functions/_lib/
-- scheduling.ts, CLAUDE.md §10) writes scheduled_at directly instead.
-- meeting_link is staff-set, client-visible (client.hasSeenWelcome-style
-- exposure via /api/client/me) — never writable by the client themselves.
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  external_status TEXT NOT NULL DEFAULT 'requested' CHECK (external_status IN ('requested', 'scheduled', 'completed')),
  internal_notes TEXT,
  preferred_times TEXT,               -- legacy, unused by the real booking engine
  scheduled_at TEXT,
  meeting_link TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project_id ON discovery_sessions(project_id);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  external_status TEXT NOT NULL DEFAULT 'requested' CHECK (external_status IN ('requested', 'scheduled', 'completed')),
  internal_notes TEXT,
  preferred_times TEXT,               -- legacy, unused by the real booking engine
  scheduled_at TEXT,
  meeting_link TEXT,
  client_decision TEXT CHECK (client_decision IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presentations_project_id ON presentations(project_id);

-- The booking engine's source of truth for staff availability
-- (CLAUDE.md §10): a recurring weekly template, not individual dates.
-- start_time/end_time are "HH:MM" 24-hour, in Asia/Manila local time (the
-- business's fixed timezone — no per-client conversion, no DST since the
-- Philippines doesn't observe it). A day can have more than one rule (e.g.
-- a lunch-break split into a morning and afternoon window).
CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday .. 6=Saturday
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_availability_rules_day ON availability_rules(day_of_week);

-- Commercial offers. `content` is a JSON blob so offer copy/price is
-- DB-configurable rather than hardcoded (CLAUDE.md §9) — ships with a
-- clearly-marked placeholder for the ₱1,499 offer until real content is
-- provided (open item #5).
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,                 -- e.g. '1499', 'essential'
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'unlocked', 'viewed', 'accepted', 'declined')),
  content TEXT NOT NULL,              -- JSON: headline, price, copy, etc.
  unlocked_by TEXT REFERENCES users(id),
  unlocked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offers_client_id ON offers(client_id);

CREATE TABLE IF NOT EXISTS offer_events (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  event TEXT NOT NULL CHECK (event IN ('unlocked', 'viewed', 'accepted', 'declined')),
  actor_id TEXT,                      -- users.id for staff, clients.id for client actions
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offer_events_offer_id ON offer_events(offer_id);

-- ganap.net payment confirmations. The row that kicks off the whole
-- account-creation bridge (CLAUDE.md §4). `external_reference` is the
-- idempotency key ganap.net echoes back, used to make webhook processing
-- idempotent on retry (ganap's deliveries are at-least-once, same as the
-- marketing site's existing integration).
-- `source` distinguishes which ganap.net project a payment came from:
-- 'foryourbusiness_299' (the public /foryourbusiness checkout, the only
-- source until 2026-09-07), 'internal_upsell' (the Pricing page's Digital
-- Growth Plans checkout, CLAUDE.md's "Pricing page" section), or
-- 'bill_of_service' (a staff-generated Bill of Service paid through the
-- same alta_internal_upsell ganap.net project — see the `bills` table
-- below and CLAUDE.md's Bill of Service section) — the two ganap.net
-- projects have separate signing secrets, but bills share
-- alta_internal_upsell's rather than needing a third project/secret.
-- Existing rows predate this column and are all 'foryourbusiness_299',
-- which the DEFAULT below correctly backfills for a fresh database; an
-- *already-deployed* database needs the manual migration documented in
-- CLAUDE.md (this file's CREATE TABLE IF NOT EXISTS is a no-op against it,
-- and a CHECK constraint change needs the table recreated — see CLAUDE.md
-- for the exact migration SQL, both for the original 2-value CHECK and
-- this 3-value one).
--
-- client_id deliberately has NO `REFERENCES clients(id)` (unlike bills.
-- client_id below) — an earlier version of this file declared one, but
-- running the recreate-table migration against the real production
-- database (2026-09-09) hit a real orphaned client_id from this table's
-- long ALTER-TABLE history, which a declared-but-never-truly-enforced FK
-- had been silently tolerating for who knows how long. Nothing in the app
-- relies on FK enforcement here (every query already checks a client
-- exists before touching it, per this file's own "No RLS" note up top),
-- so the annotation was dropped rather than chasing down and fixing
-- historical data for a constraint nothing needs.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  ganap_reference_number TEXT NOT NULL,
  external_reference TEXT UNIQUE,
  amount INTEGER NOT NULL,            -- whole pesos
  currency TEXT NOT NULL DEFAULT 'PHP',
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'foryourbusiness_299' CHECK (source IN ('foryourbusiness_299', 'internal_upsell', 'bill_of_service')),
  raw_payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);

-- Bill of Service: a staff-generated, one-off payment request with its own
-- branded public page (CLAUDE.md's "Bill of Service" section). Created
-- entirely in ClientKeeper (no ganap.net credentials needed for that —
-- generating a bill is just a D1 write); the resulting `token` is the
-- unguessable id in the public link ClientKeeper shows staff
-- (https://account.altasme.com/bill/<token>) — deliberately NOT the
-- human-readable `bill_number`, so a client can't guess adjacent bills by
-- editing the URL. `client_id` is optional: a bill can be raised against
-- an existing tracked client, but doesn't have to be (a brand-new
-- prospect who hasn't been added as a client yet can still be billed;
-- `recipient_name`/`recipient_email` carry the "To:" info independently
-- either way). `client_type` is chosen fresh per bill, not stored on the
-- `clients` row itself, since in principle the same client could
-- conceivably be billed once personally and once through a company.
-- `total_amount` is a stored snapshot (sum of `bill_line_items.amount` at
-- creation time), not recomputed on read, so the number on an old bill
-- never silently changes if line-item math logic changes later.
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  bill_number TEXT NOT NULL UNIQUE,   -- e.g. "ALTAV-BOS-2026-002"
  token TEXT NOT NULL UNIQUE,         -- unguessable id used in the public URL
  client_id TEXT REFERENCES clients(id),
  client_type TEXT NOT NULL CHECK (client_type IN ('individual', 'corporate')),
  recipient_name TEXT NOT NULL,       -- individual: person's name. corporate: company name.
  recipient_contact_person TEXT,      -- corporate only, optional ("Attn: ...")
  recipient_tin TEXT,                 -- corporate only, optional — the client's own TIN, not Altaventures'
  recipient_email TEXT,
  scope_description TEXT,             -- optional narrative shown above the line items
  currency TEXT NOT NULL DEFAULT 'PHP',
  total_amount INTEGER NOT NULL,      -- whole pesos, snapshot of line items at creation
  validity_days INTEGER NOT NULL DEFAULT 7,
  issue_date TEXT NOT NULL,           -- "YYYY-MM-DD", for display
  expires_at TEXT NOT NULL,           -- full ISO timestamp: created_at + validity_days
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  notes TEXT,                         -- optional freeform terms/instructions
  paid_at TEXT,
  payment_id TEXT REFERENCES payments(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- The referenceNumber ganap.net returned from the MOST RECENT checkout
  -- attempt for this bill (functions/api/public/bill/[token]/checkout.ts).
  -- Not the payment's own record — a bill can be checked out more than
  -- once (retries) and only the latest attempt is worth reconciling.
  -- Nullable: a bill that's never had anyone click "pay" has none yet.
  -- Added 2026-09-09 for the manual "Check Payment Status" reconciliation
  -- action (functions/api/public/bill/[token]/reconcile.ts) — a plain
  -- ALTER TABLE ADD COLUMN is safe here (nullable, no CHECK/FK/DEFAULT
  -- complications), unlike the payments.source CHECK-constraint migration
  -- earlier in this file's history, which needed a full table rebuild.
  last_checkout_reference TEXT
);

CREATE INDEX IF NOT EXISTS idx_bills_token ON bills(token);
CREATE INDEX IF NOT EXISTS idx_bills_client_id ON bills(client_id);

CREATE TABLE IF NOT EXISTS bill_line_items (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,            -- whole pesos
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bill_line_items_bill_id ON bill_line_items(bill_id);

-- Real plan/add-on purchase tracking (CLAUDE.md's "Pricing page" section,
-- 2026-09-07) — replaces the original placeholder shape (id/client_id/
-- plan/status/started_at/ended_at only). A client can have several active
-- rows at once (one plan + any number of standalone add-ons); `item_type`
-- distinguishes the two so a new plan purchase can supersede the prior
-- plan row without touching add-on rows.
--
-- next_renewal_date/renewal_amount_php are set regardless of billing_cycle
-- — even a one_time row (Basic) can carry an ongoing renewal (its ₱750/yr
-- domain fee), which is why these aren't folded into billing_cycle itself.
-- Renewal is manual (Q2 decision, 2026-09-07): ganap.net's documented API
-- is a one-time checkout session with no subscription/auto-charge
-- endpoint, so nothing auto-bills — the client sees next_renewal_date on
-- their Account page and clicks "Renew Now" to start a fresh checkout for
-- renewal_amount_php when they're ready.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  plan TEXT NOT NULL,                 -- legacy label column, mirrors item_name
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  item_type TEXT NOT NULL DEFAULT 'plan' CHECK (item_type IN ('plan', 'addon')),
  item_id TEXT NOT NULL DEFAULT '',   -- functions/_lib/pricing.ts catalog id
  item_name TEXT NOT NULL DEFAULT '', -- display name snapshot at purchase time
  billing_cycle TEXT NOT NULL DEFAULT 'one_time' CHECK (billing_cycle IN ('one_time', 'annual', 'monthly')),
  amount_php INTEGER NOT NULL DEFAULT 0,   -- what was actually charged at purchase
  renewal_amount_php INTEGER,              -- what a future "Renew Now" would charge
  next_renewal_date TEXT,                  -- NULL if this item never renews
  payment_id TEXT REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id ON subscriptions(client_id);

-- Unified per-client timeline (CLAUDE.md §8's ClientKeeper activity view).
CREATE TABLE IF NOT EXISTS client_activity (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_activity_client_id ON client_activity(client_id);

-- Resend transactional email log (payment confirmed, discovery reminder,
-- build started, website ready, presentation reminder, offer unlocked,
-- offer accepted — CLAUDE.md §12). WorkOS auth emails are not logged here
-- since WorkOS sends and tracks those itself.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  payload TEXT,
  created_at TEXT NOT NULL
);

-- Every sensitive/admin action (stage override, offer unlock, invitation
-- reissue) per CLAUDE.md §6/§8's audit requirement.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,                        -- JSON
  after TEXT,                         -- JSON
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- =====================================================================
-- Proposals & Questionnaires (CLAUDEproposalquestionnaire.md)
--
-- ClientKeeper owns creating/editing/publishing these (staff-only, same
-- audit_log/client_activity reuse as every other sensitive write in that
-- app -- no new audit table needed here). The public, client-facing
-- signing/filling pages live in the marketing site repo
-- (altasme/altaventureswebsite) at www.altasme.com/proposal/{slug} and
-- /questions/{slug} -- a deliberate exception to this schema's usual
-- "only clienthub/clientkeeper read this database" boundary, confirmed
-- directly with the operator (the literal apex-domain URL was requested
-- over the account.altasme.com/clienthub-hosted alternative that would
-- have kept that boundary intact, mirroring the Bill of Service
-- precedent above). The marketing site needs its own DB binding to this
-- same database, set up in the Cloudflare Pages dashboard like every
-- other binding note in this file, to read/write these tables directly.
--
-- slug is a readable, client-name-derived identifier (NOT a secret) --
-- access_token is the real gate, carried as a query param alongside the
-- friendly path (?t=...), since a slug alone is guessable/predictable
-- and must never be treated as authentication (same reasoning already
-- applied to bills.token above, just carried differently in the URL
-- since the spec for this feature explicitly asked for a readable path
-- segment rather than the token being the whole path).
-- =====================================================================

-- Questionnaires first (proposals.questionnaire_id references this),
-- each with its own client-facing slug/token pair. title/description are
-- the live DRAFT buffer -- the thing the admin editor reads/writes while
-- composing, before and between publishes; questionnaire_versions holds
-- the frozen, published snapshots (see the questions table's comment
-- below for how the draft/published split works for the question list
-- itself, which is the part that actually matters for "don't disturb a
-- submitted response's original questions").
CREATE TABLE IF NOT EXISTS questionnaires (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  slug TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'submitted', 'closed')),
  current_version INTEGER NOT NULL DEFAULT 0,  -- 0 until first publish; matches the live questionnaire_versions.version_number
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaires_client_id ON questionnaires(client_id);
CREATE INDEX IF NOT EXISTS idx_questionnaires_slug ON questionnaires(slug);

-- A version is an immutable snapshot of the title/description text at
-- the moment of publish (the question snapshot itself lives in
-- questionnaire_questions rows carrying this version's id, copied from
-- the draft set at that same moment -- see below).
CREATE TABLE IF NOT EXISTS questionnaire_versions (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id),
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_versions_questionnaire_id ON questionnaire_versions(questionnaire_id);

-- Question definitions. version_id NULL means "the live draft buffer"
-- (what the admin question-builder UI reads/writes freely -- add, edit,
-- delete, duplicate, reorder, no versioning concern); a non-NULL
-- version_id means "frozen as part of that published snapshot, never
-- touched again." Publishing copies every current NULL-version_id row
-- into fresh rows stamped with the new version's id, leaving the
-- draft (NULL) rows in place as the ongoing editable set for the next
-- edit cycle -- so a previously-submitted response's version_id always
-- resolves to the exact question set it was answered against, even
-- after the admin edits the draft again afterward.
--
-- options_json is a JSON string[] for the choice-based field types;
-- NULL for every other type. field_type is deliberately a CHECK'd open
-- set (not a separate lookup table like project_stages) so adding a new
-- type later is a one-line CHECK-constraint change plus a client-side
-- renderer addition, matching the spec's own "design the question
-- system so additional field types can be added later without major
-- architectural changes" instruction.
CREATE TABLE IF NOT EXISTS questionnaire_questions (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id),
  version_id TEXT REFERENCES questionnaire_versions(id),
  section_heading TEXT,
  section_description TEXT,
  prompt TEXT NOT NULL,
  help_text TEXT,
  field_type TEXT NOT NULL CHECK (field_type IN ('short_text', 'long_text', 'single_choice', 'multi_choice', 'dropdown', 'yes_no', 'date', 'url', 'file')),
  is_required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_questions_questionnaire_id ON questionnaire_questions(questionnaire_id);
CREATE INDEX IF NOT EXISTS idx_questionnaire_questions_version_id ON questionnaire_questions(version_id);

-- One proposal per engagement; a client can have several over time (a
-- revision, a different scope offered later) -- each gets its own
-- slug/token, never overwriting a prior proposal's record. title/
-- content_html is the live draft buffer (same draft/published split
-- rationale as questionnaires above); proposal_versions holds the
-- frozen, immutable published snapshots.
--
-- [2026-10-15] client_id is now nullable and a sibling lead_id was
-- added, per the operator's direct request for a proposal generator
-- that "doesn't need a client to be generated" -- staff can send a
-- proposal to a prospect (a `leads` row) before any client record
-- exists, exactly as the existing Leads page already models
-- pre-payment contacts. Exactly one of client_id/lead_id is expected to
-- be set, enforced in application logic (not a DB CHECK -- SQLite can't
-- add one to client_id's existing column without a table rebuild, and
-- the app-level check in ClientKeeper's creation endpoints costs
-- nothing). A questionnaire can only ever be linked to a client-backed
-- proposal (questionnaires.client_id is still required below), so a
-- lead-backed proposal's "send to questionnaire after signing" option
-- stays unavailable until it's re-pointed at a real client. This is a
-- clean pre-launch edit to the shape, not a migration against live
-- data -- this table had never actually been created in the live
-- database (§24 below; the marketing site's own CLAUDE.md §59.5 flagged
-- the same "schema not run against the live database yet" gap), so the
-- `CREATE TABLE IF NOT EXISTS` below is simply correct going forward,
-- with no ALTER TABLE/rebuild required.
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  lead_id TEXT REFERENCES leads(id),
  -- [2026-10-16] A proposal can now have BOTH client_id and lead_id NULL
  -- ("standalone" -- no lead, no client at all, CLAUDE.md §63). The
  -- prospect_* fields below are only ever populated for that case: staff
  -- type them in directly when creating a standalone proposal (there's no
  -- lead/client row to read a name/business/email off of), and the
  -- public proposal-sign endpoint (altaventureswebsite's
  -- functions/api/public/proposal/[slug]/sign.ts) reads them to
  -- auto-create a real clients row the moment the prospect signs --
  -- never edited after creation, so there's no PATCH support for these.
  -- A lead-backed or client-backed proposal leaves all four NULL.
  prospect_full_name TEXT,
  prospect_business_name TEXT,
  prospect_email TEXT,
  prospect_phone TEXT,
  slug TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'sent', 'signed', 'declined', 'expired', 'revoked')),
  current_version INTEGER NOT NULL DEFAULT 0,
  questionnaire_id TEXT REFERENCES questionnaires(id),  -- the questionnaire the client is sent to after signing
  expires_at TEXT,
  -- [2026-10-29] Payment-request fields, configured by staff per proposal
  -- in ClientKeeper's editor (not versioned alongside content_html --
  -- these are operational details, not contractual terms requiring a
  -- fresh signature, so they can be corrected post-signing without
  -- invalidating the client's acceptance). The three GCash/bank fields
  -- default to Altaventures' own real, current payment details so a new
  -- proposal starts pre-filled and usable without staff having to type
  -- them every time; payment_amount_label has no sensible default (it's
  -- always proposal-specific) and publish.ts blocks publishing with it
  -- blank when payment_enabled is on. payment_marked_paid_at is set by
  -- the public payment screen's "Done Paying" button -- a client's own
  -- unverified claim, not a confirmed payment (there's no payment
  -- gateway here, same manual-GCash/bank-transfer reality as every other
  -- "send us a screenshot" flow already documented across this
  -- ecosystem) -- and is cleared on republish of a previously-signed
  -- proposal (publish.ts), same reasoning as why a material revision
  -- requires a fresh signature: a stale "I paid" claim against terms
  -- that just changed isn't meaningful anymore.
  payment_enabled INTEGER NOT NULL DEFAULT 1,
  payment_amount_label TEXT NOT NULL DEFAULT '',
  payment_gcash_number TEXT NOT NULL DEFAULT '09212836683',
  payment_gcash_account_name TEXT NOT NULL DEFAULT 'Van Da Vinci Amaranto',
  payment_bank_note TEXT NOT NULL DEFAULT 'Bank transfer available upon request.',
  payment_marked_paid_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_client_id ON proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_slug ON proposals(slug);

-- Migration [2026-10-29], for the six payment_* columns above: run this
-- against an already-deployed database that created `proposals` before
-- this round -- the CREATE TABLE above only applies to a fresh install.
-- D1/SQLite supports adding columns with a default without rebuilding
-- the table. Run once (same DB the Pages projects for altaventureswebsite
-- and clientkeeper both bind as DB):
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_enabled INTEGER NOT NULL DEFAULT 1;"
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_amount_label TEXT NOT NULL DEFAULT '';"
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_gcash_number TEXT NOT NULL DEFAULT '09212836683';"
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_gcash_account_name TEXT NOT NULL DEFAULT 'Van Da Vinci Amaranto';"
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_bank_note TEXT NOT NULL DEFAULT 'Bank transfer available upon request.';"
--   npx wrangler d1 execute <database-name> --remote --command "ALTER TABLE proposals ADD COLUMN payment_marked_paid_at TEXT;"
-- Until this runs, any GET/PATCH on an existing proposal (clientkeeper's
-- functions/api/app/proposals/[proposalId].ts, which SELECTs all six
-- columns unconditionally) 500s with "no such column" -- this is the
-- known open item CLAUDE.md §67.7 flagged ("still needs to be applied to
-- the live production database"), not a new bug.

-- Immutable content snapshots -- a signed version is never edited in
-- place; a material revision after signing writes a new version and
-- (in application logic) clears the proposal back to 'published',
-- requiring a fresh signature rather than silently altering what was
-- already accepted.
CREATE TABLE IF NOT EXISTS proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposal_versions_proposal_id ON proposal_versions(proposal_id);

-- The e-signature event + audit evidence. One per proposal in V1 (a
-- fresh version after signing requires a new signature here, it does
-- not overwrite this row -- the original acceptance record is kept).
CREATE TABLE IF NOT EXISTS proposal_signatures (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  version_id TEXT NOT NULL REFERENCES proposal_versions(id),  -- the exact version that was signed
  signer_name TEXT NOT NULL,
  signer_title TEXT,
  signature_data_url TEXT NOT NULL,  -- data:image/png;base64,... drawn signature image
  ip_address TEXT,
  user_agent TEXT,
  signed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposal_signatures_proposal_id ON proposal_signatures(proposal_id);

-- One row per real client submission. Locked after creation (no
-- resubmission in V1, per the spec's "prevent duplicate submissions"
-- guardrail) -- questionnaires.status flips to 'submitted' on insert.
-- version_id snapshots exactly which question set this response
-- answers, independent of any later edits to the questionnaire.
CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id TEXT PRIMARY KEY,
  questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id),
  version_id TEXT NOT NULL REFERENCES questionnaire_versions(id),
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_questionnaire_id ON questionnaire_responses(questionnaire_id);

-- One row per answered question. value_text covers every scalar type
-- (short_text/long_text/dropdown/single_choice/yes_no/date/url);
-- value_json is a JSON string[] for multi_choice; file_url/file_name are
-- only set for the file field type (uploaded via the marketing site's
-- existing Cloudinary archival pattern, same credentials already
-- documented there for WSA signed-PDF archival).
CREATE TABLE IF NOT EXISTS questionnaire_answers (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES questionnaire_responses(id),
  question_id TEXT NOT NULL REFERENCES questionnaire_questions(id),
  value_text TEXT,
  value_json TEXT,
  file_url TEXT,
  file_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_answers_response_id ON questionnaire_answers(response_id);

-- Service Agreement Generator (a staff-authored, e-signed legal
-- agreement per client/engagement), cloned from the Proposals schema
-- above -- same mechanics (draft buffer -> immutable published
-- versions -> e-signature, a standalone agreement with no lead/client
-- yet auto-creates a real client on signing), but a deliberately
-- separate set of tables rather than a `document_type` column on
-- `proposals` itself. Reasoning: a proposal is a sales pitch (open,
-- revisable, sent before money or trust exist); a service agreement is
-- the binding contract (the thing /WSA-free and /WSA-pro already are
-- for Altaventures' own two fixed offers, CLAUDE.md §17/§57) -- mixing
-- both into one `status`/`content_html` table would make every future
-- proposal-only or agreement-only feature (e.g. the proposal payment-
-- request fields below) need a conditional check on which kind of row
-- it is. Two differences from `proposals`, both the operator's own
-- confirmed decision: no payment_* columns (signature only, no
-- payment-request step), and no questionnaire_id (sending a client to
-- an intake questionnaire after signing is a sales-funnel concept that
-- belongs to the proposal that precedes a contract, not the contract
-- itself -- can be added later if a real need for it shows up).
-- [2026-10-31] Corrected from the first version of this table: a
-- service agreement is a binding legal contract, not a sales pitch, so
-- unlike `proposals` it must always belong to a real, already-onboarded
-- client -- never a bare lead and never a standalone prospect with no
-- client record at all. `client_id` is NOT NULL here (proposals' own
-- `client_id` is nullable); there is no `lead_id` and no
-- `prospect_*`/auto-client-creation-on-signing mechanism, since there's
-- no case where a signer isn't already a real client. This table had
-- never been deployed to production, so this is a clean rewrite of the
-- original `CREATE TABLE`, not a migration against live data.
CREATE TABLE IF NOT EXISTS service_agreements (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  slug TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'sent', 'signed', 'declined', 'expired', 'revoked')),
  current_version INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_agreements_client_id ON service_agreements(client_id);
CREATE INDEX IF NOT EXISTS idx_service_agreements_slug ON service_agreements(slug);

-- Immutable content snapshots, identical shape/purpose to
-- proposal_versions -- a signed version is never edited in place; a
-- material revision after signing writes a new version and (in
-- application logic) resets status back to 'published', requiring a
-- fresh signature rather than silently altering what was already
-- accepted.
CREATE TABLE IF NOT EXISTS service_agreement_versions (
  id TEXT PRIMARY KEY,
  service_agreement_id TEXT NOT NULL REFERENCES service_agreements(id),
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_agreement_versions_agreement_id ON service_agreement_versions(service_agreement_id);

-- The e-signature event + audit evidence, identical shape to
-- proposal_signatures. One per agreement in V1 -- a fresh version after
-- signing requires a new signature here, it does not overwrite this
-- row (the original acceptance record is kept).
CREATE TABLE IF NOT EXISTS service_agreement_signatures (
  id TEXT PRIMARY KEY,
  service_agreement_id TEXT NOT NULL REFERENCES service_agreements(id),
  version_id TEXT NOT NULL REFERENCES service_agreement_versions(id),
  signer_name TEXT NOT NULL,
  signer_title TEXT,
  signature_data_url TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_agreement_signatures_agreement_id ON service_agreement_signatures(service_agreement_id);

-- =====================================================================
-- Webmail module (ClientKeeper's /mail workspace) [2026-11-24]
--
-- Altaventures' own staff mailboxes (hello@/support@/sales@/billing@
-- altasme.com are the suggested starting set -- which addresses exist is
-- data in mail_accounts below, never hardcoded in either app). This is
-- NOT per-client/multi-tenant mail: every mail_accounts row belongs to
-- this one business, so there is no tenant_id anywhere in this block --
-- `account_id` (the mailbox identity) is the scoping unit for every
-- message/thread/label/draft, and mail_account_access is the explicit,
-- grantable list of which staff `users` may read (and optionally send
-- from) which mailbox. Default is nobody: owner/admin grant access from
-- ClientKeeper's Mail settings, including to themselves -- a staff role
-- alone never implies mailbox access.
--
-- Writers: ClientKeeper's Pages Functions (functions/api/app/mail/*,
-- staff-authenticated) and ClientKeeper's separate inbound Email Worker
-- (clientkeeper/mail-worker/, a standalone Workers script bound to this
-- same database as DB, since Cloudflare Email Routing's email() handler
-- can't be a Pages Function). clienthub and altaventureswebsite never
-- read or write these tables.
--
-- Attachment bytes and raw .eml copies live in a PRIVATE Cloudflare R2
-- bucket (binding MAIL_ATTACHMENTS on both the ClientKeeper Pages project
-- and the mail worker) -- these tables only hold the object keys. There
-- are no public URLs: every download goes through an authenticated,
-- access-checked ClientKeeper route.
--
-- All brand-new tables: running this whole schema.sql again against the
-- already-deployed database is safe (every statement in this file is
-- CREATE ... IF NOT EXISTS / INSERT OR IGNORE), so no ALTER TABLE is
-- needed for this round. See the migration note at the end of this block
-- for the exact commands.
-- =====================================================================

-- A mailbox identity: the address mail is received at and sent from.
-- smtp_profile names an optional per-identity SMTP credential set held
-- server-side in the MAIL_SMTP_PROFILES_JSON secret (NULL = the default
-- MAIL_SMTP_* relay, which must be authorized to send as this address).
-- No credential of any kind is ever stored in this table.
CREATE TABLE IF NOT EXISTS mail_accounts (
  id TEXT PRIMARY KEY,
  email_address TEXT NOT NULL UNIQUE,        -- stored lowercased
  display_name TEXT NOT NULL,
  reply_to TEXT,                             -- optional Reply-To header for mail sent from this identity
  smtp_profile TEXT,
  inbound_enabled INTEGER NOT NULL DEFAULT 1, -- 0 = the mail worker rejects mail to this address
  outbound_enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Explicit per-staff mailbox access. can_send = 0 is read-only access
-- (the identity never appears in that person's composer From list).
CREATE TABLE IF NOT EXISTS mail_account_access (
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  can_send INTEGER NOT NULL DEFAULT 1,
  granted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_account_access_user_id ON mail_account_access(user_id);

-- Per-identity signatures. use_for_new/use_for_reply pick which one the
-- composer inserts automatically (at most one of each per account,
-- enforced in application code); an account with no use_for_reply
-- signature simply inserts none on replies ("disable signature on reply").
CREATE TABLE IF NOT EXISTS mail_signatures (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  name TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  use_for_new INTEGER NOT NULL DEFAULT 0,
  use_for_reply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_signatures_account_id ON mail_signatures(account_id);

-- A conversation. Thread membership is resolved from standard headers
-- (Message-ID / In-Reply-To / References), never from subject alone.
-- participants is a JSON string[] of lowercased addresses.
CREATE TABLE IF NOT EXISTS mail_threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  subject TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,
  latest_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_threads_account_latest ON mail_threads(account_id, latest_message_at);

-- One row per real email (inbound or outbound). Drafts are NOT here --
-- they live in mail_drafts until sent. `folder` is persistent server
-- state (inbox/sent/archive/junk/trash); previous_folder remembers where a
-- message was before Junk/Trash so Restore puts it back. `status` tracks
-- the outbound lifecycle honestly: 'sent' means the SMTP server accepted
-- it (250 after DATA), never "delivered". dedupe_key makes inbound
-- processing idempotent per mailbox: normalized Message-ID when present,
-- otherwise a SHA-256 over sender/date/subject/body (see the mail
-- worker's computeDedupeKey()).
CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  thread_id TEXT NOT NULL REFERENCES mail_threads(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'archive', 'junk', 'trash')),
  previous_folder TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'queued', 'sending', 'sent', 'failed', 'retry_scheduled')),
  message_id_header TEXT,                    -- as sent/received, with angle brackets
  message_id_normalized TEXT,                -- lowercased, no brackets; lookup key for threading
  in_reply_to TEXT,
  references_header TEXT,
  dedupe_key TEXT NOT NULL,
  from_name TEXT,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',        -- untrusted for inbound; only ever rendered after server-side sanitization
  snippet TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  raw_storage_key TEXT,                      -- R2 key of the original .eml (inbound) when stored
  auth_results TEXT,                         -- raw Authentication-Results header, display only
  trashed_at TEXT,
  received_at TEXT,
  sent_at TEXT,
  created_by TEXT REFERENCES users(id),     -- staff sender for outbound; NULL for inbound
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_folder ON mail_messages(account_id, folder, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread_id ON mail_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_msgid ON mail_messages(account_id, message_id_normalized);
CREATE INDEX IF NOT EXISTS idx_mail_messages_starred ON mail_messages(account_id, is_starred);

CREATE TABLE IF NOT EXISTS mail_recipients (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES mail_messages(id),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('to', 'cc', 'bcc')),
  display_name TEXT,
  email TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_message_id ON mail_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_recipients_email ON mail_recipients(email);

-- Unsent work. to/cc/bcc are JSON arrays of {name, email}. `version` is
-- an optimistic-concurrency counter so a stale autosave from a second
-- tab can't silently overwrite newer content (PATCH with an old version
-- -> 409). compose_mode/source_message_id remember what a reply/forward
-- draft is attached to so threading headers survive a page refresh.
CREATE TABLE IF NOT EXISTS mail_drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  thread_id TEXT REFERENCES mail_threads(id),
  compose_mode TEXT NOT NULL DEFAULT 'new' CHECK (compose_mode IN ('new', 'reply', 'reply_all', 'forward')),
  source_message_id TEXT REFERENCES mail_messages(id),
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_account_id ON mail_drafts(account_id, updated_at);

-- Attachment metadata; bytes live in R2 under storage_key. A row belongs
-- to a message (received/sent) or a draft (still being composed), never
-- both. Forwarding re-references the same storage_key in a new row, so
-- R2 objects are only deleted once no row references them any more.
-- storage_status = 'failed' records an inbound attachment whose R2 write
-- failed -- the message itself is still stored (never discarded) and the
-- original bytes remain recoverable from the raw .eml copy.
CREATE TABLE IF NOT EXISTS mail_attachments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  message_id TEXT REFERENCES mail_messages(id),
  draft_id TEXT REFERENCES mail_drafts(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  content_id TEXT,                           -- for cid: inline images
  is_inline INTEGER NOT NULL DEFAULT 0,
  storage_status TEXT NOT NULL DEFAULT 'stored' CHECK (storage_status IN ('stored', 'failed')),
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_message_id ON mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_draft_id ON mail_attachments(draft_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_storage_key ON mail_attachments(storage_key);

CREATE TABLE IF NOT EXISTS mail_labels (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0D68EF',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS mail_message_labels (
  message_id TEXT NOT NULL REFERENCES mail_messages(id),
  label_id TEXT NOT NULL REFERENCES mail_labels(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_message_labels_label_id ON mail_message_labels(label_id);

-- The outbound send pipeline. A job is created in the SAME D1 batch as
-- its mail_messages row, before any SMTP traffic, so an email can never
-- be sent without a record of it. idempotency_key (client-supplied per
-- compose session) makes a double-click / retried request return the
-- existing job instead of sending twice. locked_until is a lease: a job
-- found still 'sending' after its lease expired (a crash mid-SMTP) is
-- marked failed with an "outcome unknown" error rather than auto-resent,
-- because the server may already have accepted it -- a human decides.
CREATE TABLE IF NOT EXISTS mail_send_jobs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES mail_messages(id),
  account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'retry_scheduled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  locked_until TEXT,
  last_error TEXT,                           -- redacted, human-readable; never an SMTP transcript
  last_attempted_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_due ON mail_send_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_created_by ON mail_send_jobs(created_by, created_at);

CREATE TABLE IF NOT EXISTS mail_send_attempts (
  id TEXT PRIMARY KEY,
  send_job_id TEXT NOT NULL REFERENCES mail_send_jobs(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'transient_failure', 'permanent_failure', 'unknown')),
  smtp_code INTEGER,
  error TEXT,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_send_attempts_job_id ON mail_send_attempts(send_job_id);

-- Mailbox audit trail (moves, label changes, sends, deletions, settings
-- and access changes). message_id deliberately has no REFERENCES so the
-- trail survives a permanent delete of the message it describes.
CREATE TABLE IF NOT EXISTS mail_events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  message_id TEXT,
  event_type TEXT NOT NULL,
  event_data TEXT,                           -- JSON
  actor_id TEXT,                             -- users.id, or 'mail-worker' for inbound processing
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_events_account_id ON mail_events(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mail_events_message_id ON mail_events(message_id);

-- Inbound mail the worker could not fully process. The raw message is
-- kept in R2 (raw_storage_key) so nothing is ever lost; resolved_at is
-- set once a human has dealt with it.
CREATE TABLE IF NOT EXISTS mail_inbound_failures (
  id TEXT PRIMARY KEY,
  envelope_from TEXT,
  envelope_to TEXT,
  raw_storage_key TEXT,
  error TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Per-staff webmail preferences (default account/folder, sort, density,
-- refresh interval, notification toggles). JSON, validated/whitelisted in
-- application code on write.
CREATE TABLE IF NOT EXISTS mail_user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Business-wide webmail policy (attachment limits, send rate limits,
-- remote image policy). Owner/admin only. Keys are whitelisted in
-- application code; values are JSON-encoded.
CREATE TABLE IF NOT EXISTS mail_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- Full-text search index (SQLite FTS5, which D1 supports). Maintained by
-- application code on insert/delete, not triggers, so both writers (the
-- Pages Functions and the mail worker) control exactly what's indexed.
-- message_id/account_id are UNINDEXED join/scoping keys -- every search
-- query also filters by the caller's accessible account ids. The API
-- falls back to LIKE matching if this table is unavailable.
-- Note: `wrangler d1 export` does not export virtual tables; this index
-- can be rebuilt from mail_messages at any time.
CREATE VIRTUAL TABLE IF NOT EXISTS mail_messages_fts USING fts5(
  message_id UNINDEXED,
  account_id UNINDEXED,
  sender,
  recipients,
  subject,
  body,
  attachments,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Migration [2026-11-24], webmail: every object in this block is new, so
-- it's applied by re-running this whole file against the shared database
-- (every other statement here is IF NOT EXISTS / INSERT OR IGNORE and is a
-- no-op on the existing tables):
--   npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
-- (or paste just this webmail block into the D1 Console, one statement at
-- a time if the console rejects a multi-statement paste.) Run it BEFORE
-- deploying the ClientKeeper webmail code: every /api/app/mail/* route and
-- the mail worker query these tables unconditionally and fail with "no
-- such table" until it has run.
--
-- Then create at least one mailbox and grant yourself access (or do it
-- from ClientKeeper -> Mail -> Settings -> Accounts once the code is live;
-- the SQL is here for a first bootstrap, since granting access through the
-- UI requires being owner/admin, which you already are):
--   INSERT INTO mail_accounts (id, email_address, display_name, created_at, updated_at)
--     VALUES ('<uuid>', 'hello@altasme.com', 'Altaventures', '<iso-now>', '<iso-now>');
--   INSERT INTO mail_account_access (account_id, user_id, can_send, created_at)
--     VALUES ('<that uuid>', '<your users.id>', 1, '<iso-now>');
-- Suggested starting identities (examples, not requirements):
-- hello@, support@, sales@, billing@ altasme.com.

-- =====================================================================
-- Email Services: client email hosting managed from ClientKeeper
-- [2026-11-25]
--
-- A DIFFERENT system from the webmail block above. The webmail tables
-- (mail_*) hold Altaventures' own staff mailboxes on altasme.com, received
-- through Cloudflare Email Routing. The tables below hold email-hosting
-- SUBSCRIPTIONS that Altaventures sells to its clients: a plan, a mailbox
-- allowance, the client's domain(s), and the mailboxes created at a
-- third-party hosting provider (Z.com initially) on the client's behalf.
-- No row here points at a mail_* row and vice versa.
--
-- ClientKeeper is the source of truth and the only writer this round
-- (functions/api/app/email-services/*, staff-only). A later round adds a
-- client-facing "Email Management" module in clienthub that reads these
-- same tables scoped by clients.id and creates mailboxes through the SAME
-- entitlement rules (actor_type = 'client' in the logs below).
--
-- Mailbox passwords are NEVER stored anywhere in this database. A password
-- is passed straight through to the provider and forgotten. Provider API
-- credentials live only in Pages env/secrets, never in a table.
--
-- All brand-new tables: re-running this whole file is safe (IF NOT EXISTS
-- / INSERT OR IGNORE), no ALTER TABLE needed. See the migration note at
-- the end of this block.
-- =====================================================================

-- Centrally managed plan catalog, editable by owner/admin in ClientKeeper.
-- id is a stable slug rather than a random UUID so the seed below is
-- idempotent (INSERT OR IGNORE on a fixed key) and so a plan can be named
-- in support conversations; new plans created from the UI get a random id.
-- Plan values are SNAPSHOTTED onto email_services when a plan is assigned
-- (see below), so editing a plan's price or allowance here never silently
-- changes what an existing customer already has.
-- storage_quota_mb is the figure the operator published per plan, as a
-- plain integer (MB, so any value fits). Z.com sizes quota in 5 GB steps
-- at the mail-service level, which 3/10/30/100 GB don't all match; that is
-- an open business question, so nothing here assumes a multiple of 5 GB
-- and nothing enforces the quota locally. It is display/record data only.
CREATE TABLE IF NOT EXISTS email_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_php INTEGER NOT NULL CHECK (price_php >= 0),
  billing_interval TEXT NOT NULL DEFAULT 'annual' CHECK (billing_interval IN ('annual', 'monthly')),
  included_mailboxes INTEGER NOT NULL CHECK (included_mailboxes >= 1),
  storage_quota_mb INTEGER NOT NULL CHECK (storage_quota_mb > 0),
  additional_mailbox_price_php INTEGER NOT NULL CHECK (additional_mailbox_price_php >= 0),
  features_json TEXT NOT NULL DEFAULT '[]',   -- JSON array of display strings
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO email_plans (id, name, price_php, billing_interval, included_mailboxes, storage_quota_mb, additional_mailbox_price_php, features_json, status, sort_order, created_at, updated_at) VALUES
  ('solo',       'Solo',        1500, 'annual',  1,   3072, 250, '["Lite Business Webmail access","Imunify360 security","Virus protection","Spam protection"]', 'active', 10, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  ('team',       'Team',        1999, 'annual',  3,   3072, 250, '["Lite Business Webmail access","Imunify360 security","Virus protection","Spam protection"]', 'active', 20, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  ('growth',     'Growth',      4199, 'annual', 10,  10240, 250, '["Lite Business Webmail access","Imunify360 security","Virus protection","Spam protection"]', 'active', 30, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  ('business',   'Business',    5499, 'annual', 15,  30720, 250, '["Lite Business Webmail access","Imunify360 security","Virus protection","Spam protection"]', 'active', 40, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z'),
  ('enterprise', 'Enterprise', 10999, 'annual', 20, 102400, 250, '["Lite Business Webmail access","Imunify360 security","Virus protection","Spam protection"]', 'active', 50, '2026-11-25T00:00:00.000Z', '2026-11-25T00:00:00.000Z');

-- One email-hosting subscription, always belonging to an existing client
-- (client identity is never duplicated here). A client may hold more than
-- one service (e.g. two unrelated domains billed separately).
--
-- plan_id is NULL while the service is pending setup. The four *_snapshot
-- columns are copied from email_plans at assignment time and are what the
-- entitlement engine actually reads.
--
-- Total mailbox allowance is never stored: it is always computed as
--   included_mailboxes + SUM(email_service_entitlements.quantity)
-- in the same SQL statement that reserves a slot, so it can't drift.
--
-- status is the stored lifecycle state. "Expired" is ALSO enforced by
-- expires_at directly in every provisioning check, so a service whose date
-- has passed is treated as expired even before anything rewrites its
-- status (ClientKeeper sweeps active -> expired on read).
CREATE TABLE IF NOT EXISTS email_services (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  provider TEXT NOT NULL DEFAULT 'zcom' CHECK (provider IN ('zcom')),
  provider_service_id TEXT,
  plan_id TEXT REFERENCES email_plans(id),
  plan_name_snapshot TEXT,
  included_mailboxes INTEGER NOT NULL DEFAULT 0 CHECK (included_mailboxes >= 0),
  storage_quota_mb INTEGER,
  price_php INTEGER,
  additional_mailbox_price_php INTEGER,
  status TEXT NOT NULL DEFAULT 'pending_setup' CHECK (status IN ('pending_setup', 'active', 'suspended', 'expired', 'cancelled', 'provisioning_error')),
  status_reason TEXT,
  starts_at TEXT,
  expires_at TEXT,
  -- Provider-reported data, NULL until a real provider sync has run.
  provider_status TEXT,
  storage_used_mb INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'never' CHECK (sync_status IN ('never', 'ok', 'discrepancies', 'error')),
  last_sync_at TEXT,
  last_sync_error TEXT,
  internal_notes TEXT,
  created_by TEXT REFERENCES users(id),
  decommissioned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_services_client_id ON email_services(client_id);
CREATE INDEX IF NOT EXISTS idx_email_services_plan_id ON email_services(plan_id);
CREATE INDEX IF NOT EXISTS idx_email_services_status ON email_services(status);

-- Entitlement ledger: purchased additional mailboxes ('addon') and staff
-- overrides ('override'), as signed quantities. Removing allowance is a
-- negative row, never an UPDATE/DELETE, so the history of every change
-- (who, when, why, at what unit price) is kept. The engine refuses any
-- row that would push the allowance below the mailboxes already counted
-- against it, or the add-on total below zero.
CREATE TABLE IF NOT EXISTS email_service_entitlements (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  kind TEXT NOT NULL CHECK (kind IN ('addon', 'override')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  unit_price_php INTEGER,                    -- addon price at the time (snapshot); NULL for overrides
  reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_service_entitlements_service_id ON email_service_entitlements(service_id);

-- Domains assigned to a service. A domain can be live (status 'active')
-- on at most one service at a time; a removed row is kept for history.
CREATE TABLE IF NOT EXISTS email_domains (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  domain TEXT NOT NULL,                      -- stored lowercased, no trailing dot
  provider_domain_id TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by TEXT REFERENCES users(id),
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_domains_service_id ON email_domains(service_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_domains_live_domain ON email_domains(domain) WHERE status = 'active';

-- Mailboxes managed for a service. The row IS the provisioning state
-- machine and the reservation: there is no separate reservations table.
--   reserved      a slot is held; the provider has not been called yet.
--                 reserved_until is a lease: a 'reserved' row past its
--                 lease never reached the provider, so it stops counting
--                 and is swept to 'failed'.
--   provisioning  the provider call is in flight.
--   active        the provider confirmed the mailbox exists. The ONLY
--                 state shown to anyone as a working mailbox.
--   failed        the provider definitely did not create it. Slot released.
--   needs_review  outcome unknown (timeout/crash mid-call): the mailbox may
--                 or may not exist at the provider, so the slot stays held
--                 until a human resolves it (same reasoning as
--                 mail_send_jobs' "outcome unknown" above).
--   deleting      a delete call is in flight; still counts until confirmed.
--   deleted       the provider confirmed deletion. Slot released.
--   discarded     a failed attempt staff dismissed. Kept for history.
-- Counted against the allowance: provisioning, active, needs_review,
-- deleting, and reserved while its lease is live.
--
-- idempotency_key (UNIQUE, NULLs allowed) makes a repeated create request
-- return the existing row instead of reserving a second slot or calling
-- the provider twice. The partial unique index on address means one live
-- record per address at a time (a failed row is retried in place).
-- No password column, by design.
--
-- Webmail bridge (confirmed requirement, NOT built yet): client mailboxes
-- will eventually be read/sent through ClientKeeper's own webmail (the
-- mail_* block above), not the provider's bundled webmail. Room is left
-- for that here; no sync logic exists yet:
--   inbound_source      how new mail for this mailbox will reach our
--                       webmail. Provider-hosted (Z.com) mailboxes need a
--                       polling sync against the provider API (Z.com has no
--                       generic new-mail push); 'cloudflare_email_routing'
--                       is the existing mail-worker path.
--   provider_service_id / provider_mailbox_id
--                       the provider's own opaque ids for this mailbox
--                       (Z.com's service_id and email_id). Plain TEXT, not
--                       assumed to be UUIDs.
--   mail_account_id     the mail_accounts row this mailbox is bridged to,
--                       once the bridge exists (outbound will then use that
--                       row's smtp_profile against the provider's SMTP host,
--                       since Z.com's API has no send endpoint). NULL today.
CREATE TABLE IF NOT EXISTS email_mailboxes (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  domain_id TEXT NOT NULL REFERENCES email_domains(id),
  local_part TEXT NOT NULL,
  address TEXT NOT NULL,                     -- local_part@domain, lowercased
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'provisioning', 'active', 'failed', 'needs_review', 'deleting', 'deleted', 'discarded')),
  inbound_source TEXT NOT NULL DEFAULT 'zcom_poll_sync' CHECK (inbound_source IN ('cloudflare_email_routing', 'zcom_poll_sync')),
  provider_service_id TEXT,
  provider_mailbox_id TEXT,
  mail_account_id TEXT REFERENCES mail_accounts(id),
  failure_code TEXT,                         -- normalized provider error code of the last failure
  last_error TEXT,                           -- redacted, human-readable
  idempotency_key TEXT UNIQUE,
  reserved_until TEXT,
  created_by TEXT,                           -- users.id or clients.id, see created_by_type
  created_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (created_by_type IN ('staff', 'client', 'system')),
  provisioned_at TEXT,
  deleted_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_service_status ON email_mailboxes(service_id, status);
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_domain_id ON email_mailboxes(domain_id);
CREATE INDEX IF NOT EXISTS idx_email_mailboxes_mail_account_id ON email_mailboxes(mail_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_mailboxes_live_address ON email_mailboxes(address) WHERE status NOT IN ('deleted', 'discarded');
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_mailboxes_live_primary ON email_mailboxes(service_id) WHERE is_primary = 1 AND status NOT IN ('failed', 'deleted', 'discarded');

-- One row per provider operation attempt (create, delete, sync, ...):
-- outcome, normalized error code, whether it is safe to retry. Never holds
-- a password, token, or raw request body. mailbox_id has no REFERENCES so
-- the log reads the same whatever happens to the mailbox row later.
CREATE TABLE IF NOT EXISTS email_provisioning_logs (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  mailbox_id TEXT,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'unknown')),
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  details_json TEXT,                         -- normalized, redacted (e.g. reconciliation discrepancies)
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'client', 'system')),
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_provisioning_logs_service ON email_provisioning_logs(service_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_provisioning_logs_outcome ON email_provisioning_logs(outcome, created_at);

-- Security-relevant actions on a service (plan/entitlement/domain/status
-- changes, mailbox create/delete requests, resolutions). A dedicated table
-- rather than the shared audit_log because these need to be listed per
-- service and must record client actors (actor_type) once the client-
-- facing module exists; audit_log.actor_id assumes a staff user.
CREATE TABLE IF NOT EXISTS email_audit_logs (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  mailbox_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'client', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_audit_logs_service ON email_audit_logs(service_id, created_at);

-- Migration [2026-11-25], email services: every object in this block is
-- new, so it is applied by re-running this whole file against the shared
-- database (everything else is IF NOT EXISTS / INSERT OR IGNORE):
--   npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
-- Run it BEFORE deploying ClientKeeper's Email Services module, whose
-- routes query these tables unconditionally.

-- One-time, token-gated links that let a client ask for a mailbox on a
-- specific email service without logging in to anything [2026-11-26].
-- Staff generate one in ClientKeeper (EmailServiceDetailPage, "Mailbox
-- request links") and send it by hand (chat, email); the client opens
-- www.altasme.com/mailbox-request/:slug?t=... on the marketing site
-- (altaventureswebsite's functions/api/public/mailbox-request/*), picks a
-- name, and that creates the same client-requested 'reserved' row
-- requestMailboxByClient creates (reserved_until NULL, created_by_type
-- 'client', created_by = the service's client_id), which staff then
-- fulfill or decline exactly as before. clienthub's own app is not
-- involved.
--
-- Same slug + access_token design as proposals/questionnaires/
-- service_agreements: the slug is readable and predictable, the
-- access_token is the real gate, compared in constant time by the public
-- route, and a bad token, a revoked link and a used link all answer the
-- same 404 so a stranger can't tell which.
--
-- service_id IS the authorization: a link can only ever reserve against
-- its own service, checked inside the single INSERT that reserves the
-- slot (the link's own status = 'open' is in that same statement too, so
-- two submissions of one link can't both get in). A link is single-use:
-- 'open' -> 'used' in the same batch as the reservation, with
-- used_mailbox_id pointing at the email_mailboxes row it created, so
-- staff can trace a link straight to its request. 'revoked' is a staff
-- action, refused once the link has been used. Not touched when staff
-- later fulfill or decline that request: the link's job ended when the
-- request was made.
CREATE TABLE IF NOT EXISTS mail_request_links (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES email_services(id),
  slug TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'used', 'revoked')),
  created_by TEXT REFERENCES users(id),
  used_at TEXT,
  used_mailbox_id TEXT,                      -- email_mailboxes.id; no REFERENCES, same reasoning as email_provisioning_logs.mailbox_id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_request_links_service_id ON mail_request_links(service_id);
CREATE INDEX IF NOT EXISTS idx_mail_request_links_slug ON mail_request_links(slug);

-- Migration [2026-11-26], mailbox request links: a brand-new table, so
-- re-running this whole file is enough (everything else is IF NOT EXISTS
-- / INSERT OR IGNORE and a no-op on the existing tables):
--   npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
-- or run just the three statements above. Run it BEFORE deploying the
-- ClientKeeper request-link routes and the marketing site's
-- /mailbox-request page: both query this table unconditionally and fail
-- with "no such table" until it has run.

-- =====================================================================
-- Webmail Connect: single sign-on from a client's OWN admin panel into
-- ClientKeeper's webmail [2026-11-27]
--
-- Forward-looking: no client admin panel uses this yet. A future
-- Altaventures-built admin panel installs @altasme/webmail-connect (its
-- own repo), and its logged-in users open the mailboxes they've been
-- assigned inside mail.altasme.com without ever typing a mailbox
-- password. Nothing here touches the webmail tables' own rows: it only
-- decides WHO (an outside panel's user) may open WHICH existing
-- mail_accounts row, and how that person gets a session.
--
-- The identity is the MAILBOX (mail_accounts), never the panel's user.
-- A panel user is an opaque `external_user_id` that the integration
-- assigns; it is only unique WITHIN one integration and is never a
-- webmail account of its own. Many panel users may share one mailbox;
-- one panel user may have many mailboxes.
--
-- Three layers of authorization, all checked server-side on every
-- request by ClientKeeper (functions/_lib/mailConnect/*):
--   1. the integration itself: a row below, status 'active', proven by a
--      bearer secret whose SHA-256 is stored here (never the secret);
--   2. which mailboxes that integration may hand out at all (the tenant
--      boundary): its own client's hosted mailboxes (email_mailboxes ->
--      email_services.client_id), plus any mailbox Altaventures staff
--      explicitly attached in mail_client_integration_mailboxes;
--   3. which of those this particular panel user was granted, with which
--      permissions (mail_external_mailbox_access, set by the client's own
--      Super Admin through the integration's API).
-- A grant that falls outside layer 2 later (service suspended, mailbox
-- deleted, staff detached it) stops working on the next request; it is
-- not deleted, so it comes back if the mailbox does.
--
-- No mailbox password is involved anywhere in this block. Writers:
-- ClientKeeper only (staff routes for the first two tables, the
-- integration's bearer-authenticated API for the last two).
-- =====================================================================

-- One registered client admin panel. client_id is the Altaventures client
-- whose panel this is. secret_hash = lowercase hex SHA-256 of the full
-- API secret (wmc_<id>_<64 hex>); the secret is shown to staff once at
-- creation/rotation and can never be retrieved again. Rotating replaces
-- the hash, so the old secret stops working immediately. 'disabled'
-- refuses the secret, every pending launch code and every live session
-- on their next use.
CREATE TABLE IF NOT EXISTS mail_client_integrations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_client_integrations_client_id ON mail_client_integrations(client_id);

-- Mailboxes Altaventures staff explicitly allow an integration to grant,
-- on top of its own client's hosted mailboxes. Exists because some real
-- mailboxes have no email_mailboxes row and must not get one: e.g.
-- Altaventures' own altasme.com mailboxes, which would otherwise become
-- eligible for the mailbox-password login (ClientKeeper CLAUDE.md §37).
-- Staff-only writes; an integration can never add to this list itself.
CREATE TABLE IF NOT EXISTS mail_client_integration_mailboxes (
  integration_id TEXT NOT NULL REFERENCES mail_client_integrations(id),
  mail_account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (integration_id, mail_account_id)
);

-- Which panel user may open which mailbox, with what permissions.
-- Revoking deletes the row. can_read = 0 grants nothing at all (a grant
-- must at least allow reading to be usable). is_default picks the
-- mailbox opened first when a user has several; at most one per user
-- (partial unique index below).
-- granted_by is free text: whatever external_user_id the integration said
-- made the change. Altaventures does NOT verify that person's real-world
-- identity or role, only that the call carried that integration's valid
-- secret. That is the deliberate trust boundary: inside its own tenant,
-- the integration (the client's own panel) is the authority on its users.
CREATE TABLE IF NOT EXISTS mail_external_mailbox_access (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES mail_client_integrations(id),
  external_user_id TEXT NOT NULL,
  mail_account_id TEXT NOT NULL REFERENCES mail_accounts(id),
  can_read INTEGER NOT NULL DEFAULT 1,
  can_send INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  can_manage_settings INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (integration_id, external_user_id, mail_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_external_mailbox_access_default ON mail_external_mailbox_access(integration_id, external_user_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_mail_external_mailbox_access_account ON mail_external_mailbox_access(mail_account_id);

-- Short-lived, single-use codes that carry a panel user from their panel
-- into webmail. The integration's backend asks for one (bearer secret),
-- the browser is sent to mail.altasme.com/api/mail-connect/exchange?code=,
-- and that route claims it with ONE conditional UPDATE (status 'pending'
-- and not expired -> 'used'), so a code can never be redeemed twice, even
-- concurrently. expires_at is ~60 s after issue: the code is consumed by a
-- redirect a second later, never typed. `code` is the raw value (same
-- convention as mail_request_links.access_token), compared in constant
-- time; it is also the whole credential, so it's 256 bits of randomness.
-- return_url is the integration's own "back to the panel" URL (absolute
-- http/https; its host is the integration's business, not ours).
CREATE TABLE IF NOT EXISTS mail_launch_codes (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES mail_client_integrations(id),
  external_user_id TEXT NOT NULL,
  return_url TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_launch_codes_integration ON mail_launch_codes(integration_id, created_at);

-- Migration [2026-11-27], Webmail Connect: four brand-new tables, so
-- re-running this whole file is enough (everything else is IF NOT EXISTS
-- / INSERT OR IGNORE and a no-op on the existing tables):
--   npx wrangler d1 execute <database-name> --remote --file=./d1/schema.sql
-- or run just the statements in this block. Run it BEFORE deploying
-- ClientKeeper's /api/mail-connect/* and /api/app/mail-integrations/*
-- routes: they query these tables unconditionally and fail with "no such
-- table" until it has run. No ALTER TABLE is needed.
