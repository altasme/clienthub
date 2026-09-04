// Shared stage-machine module — the allowed-transition map from
// CLAUDE.md §4 / CLAUDEclienthubcrm.md §5, enforced server-side on every
// transition. Kept local to this app rather than a shared package with
// clientkeeper (see CLAUDE.md §4 for why — the two apps' server layers
// are deliberately independent; revisit only if the two copies drift).

export const FORWARD_SEQUENCE = [
  "payment_received",
  "account_created",
  "discovery",
  "building",
  "ready_for_presentation",
  "presentation",
  "post_presentation",
  "offer_unlocked",
  "conversion",
  "essential_upsell",
] as const;

export type ForwardStage = (typeof FORWARD_SEQUENCE)[number];
export type TerminalStage = "on_hold" | "cancelled" | "completed";
export type Stage = ForwardStage | TerminalStage;

const TERMINAL_STAGES: readonly TerminalStage[] = ["on_hold", "cancelled", "completed"];

/**
 * True if `to` is a legal next stage from `from` for a normal (non-admin
 * -override) transition: the next step in FORWARD_SEQUENCE, or any
 * terminal stage from any active (non-terminal) stage.
 */
export function isValidForwardTransition(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.includes(to as TerminalStage)) {
    return !TERMINAL_STAGES.includes(from as TerminalStage);
  }
  const fromIndex = FORWARD_SEQUENCE.indexOf(from as ForwardStage);
  const toIndex = FORWARD_SEQUENCE.indexOf(to as ForwardStage);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

/**
 * Writes a project's stage forward one legal step and records
 * stage_history. Throws if the transition isn't in the allowed map — call
 * sites decide how to surface that (a 409 for an admin endpoint, a log +
 * skip for an automated bridge action that shouldn't ever hit this in
 * practice). This never bypasses the map; the only way to break sequence
 * is a separate, explicitly-audited admin-override code path (ClientKeeper
 * only), not this function.
 */
export async function advanceStage(
  db: D1Database,
  projectId: string,
  toStage: Stage,
  actorId: string,
  reason: string | null = null
): Promise<void> {
  const project = await db
    .prepare(`SELECT stage FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ stage: Stage }>();
  if (!project) throw new Error(`advanceStage: project ${projectId} not found`);

  if (!isValidForwardTransition(project.stage, toStage)) {
    throw new Error(`advanceStage: illegal transition ${project.stage} -> ${toStage} for project ${projectId}`);
  }

  const now = new Date().toISOString();

  await db
    .prepare(`UPDATE projects SET stage = ?, updated_at = ? WHERE id = ?`)
    .bind(toStage, now, projectId)
    .run();

  await db
    .prepare(
      `INSERT INTO stage_history (id, project_id, from_stage, to_stage, actor_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), projectId, project.stage, toStage, actorId, reason, now)
    .run();
}
