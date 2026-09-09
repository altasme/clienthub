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
