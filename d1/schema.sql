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
-- preferred_times holds the client's submitted call-request until the real
-- Altaventures booking system replaces this interim behavior (§11 open
-- item #2 — booking system spec not yet supplied).
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  external_status TEXT NOT NULL DEFAULT 'requested' CHECK (external_status IN ('requested', 'scheduled', 'completed')),
  internal_notes TEXT,
  preferred_times TEXT,               -- JSON array of client-submitted slots
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_project_id ON discovery_sessions(project_id);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  external_status TEXT NOT NULL DEFAULT 'requested' CHECK (external_status IN ('requested', 'scheduled', 'completed')),
  internal_notes TEXT,
  preferred_times TEXT,               -- JSON array of client-submitted slots
  scheduled_at TEXT,
  client_decision TEXT CHECK (client_decision IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presentations_project_id ON presentations(project_id);

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
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  ganap_reference_number TEXT NOT NULL,
  external_reference TEXT UNIQUE,
  amount INTEGER NOT NULL,            -- whole pesos
  currency TEXT NOT NULL DEFAULT 'PHP',
  status TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);

-- Recurring commercial state after Essential upsell (kept minimal in V1 —
-- no billing logic lives here yet, just enough to track that a client has
-- an active recurring plan once one exists).
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);

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
