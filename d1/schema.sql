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
