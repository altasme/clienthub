// Shared account-creation-bridge logic (CLAUDE.md §1.5 / CLAUDEclienthubcrm.md
// §4 step 4): links a WorkOS user to the pre-created `clients` row from the
// ganap.net payment webhook, then advances that client's in-flight
// project(s) from payment_received through account_created into
// discovery — the source spec's own wording ("advances stage
// account_created > discovery") treats both as one bridge event, not two
// separately-gated admin actions.
//
// Used by both signals in the dual-signal design: the primary OAuth
// /api/auth-callback redirect, and the secondary invitation.accepted
// webhook backstop. Idempotent — calling this twice for the same WorkOS
// user (once from each signal, whichever arrives first) is safe; the
// second call sees workos_user_id already set and returns "already_linked"
// without re-writing anything.

import { advanceStage } from "./stages";

export type LinkResult =
  | { outcome: "linked"; clientId: string }
  | { outcome: "already_linked"; clientId: string }
  | { outcome: "no_matching_client" };

export async function linkClientAccount(db: D1Database, workosUserId: string, email: string): Promise<LinkResult> {
  const byWorkosId = await db
    .prepare(`SELECT id FROM clients WHERE workos_user_id = ?`)
    .bind(workosUserId)
    .first<{ id: string }>();
  if (byWorkosId) return { outcome: "already_linked", clientId: byWorkosId.id };

  // The pre-created, unlinked client row for this email — per the
  // guardrail, a WorkOS user is only ever linked to a client with a
  // matching paid order behind it. No row here means no paid order: never
  // provision access.
  const client = await db
    .prepare(`SELECT id FROM clients WHERE email = ? AND workos_user_id IS NULL`)
    .bind(email)
    .first<{ id: string }>();
  if (!client) return { outcome: "no_matching_client" };

  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE clients SET workos_user_id = ?, invitation_status = 'accepted', updated_at = ? WHERE id = ?`)
    .bind(workosUserId, now, client.id)
    .run();

  const projects = await db
    .prepare(`SELECT id FROM projects WHERE client_id = ? AND stage = 'payment_received'`)
    .bind(client.id)
    .all<{ id: string }>();

  for (const project of projects.results ?? []) {
    try {
      await advanceStage(db, project.id, "account_created", "system");
      await advanceStage(db, project.id, "discovery", "system");
    } catch (err) {
      // A stage-advance failure shouldn't undo the account link that
      // already succeeded above — log and leave the project at whatever
      // stage it reached; staff can move it forward manually in
      // ClientKeeper if this ever actually happens.
      console.error(`linkClientAccount: failed to advance project ${project.id}`, err);
    }
  }

  return { outcome: "linked", clientId: client.id };
}
