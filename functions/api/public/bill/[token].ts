// Cloudflare Pages Function: GET /api/public/bill/:token
//
// Deliberately outside functions/api/client/ (whose _middleware.ts
// requires a session cookie) — a Bill of Service link is sent to people
// who have never logged in and may never have a Client Hub account at
// all, so this route (and its sibling checkout.ts) must be reachable with
// no auth. Returns only what the public invoice page needs to render;
// never client_id, created_by, or any other internal bookkeeping field.
//
// Lazily flips a `pending` bill to `expired` on read if `expires_at` has
// passed — no cron job needed for a feature this low-volume, and the
// public page is the only thing that ever reads a bill's status, so
// "flip on the read that would show it" is sufficient.

interface Env {
  DB?: D1Database;
}

interface BillRow {
  id: string;
  bill_number: string;
  client_type: "individual" | "corporate";
  recipient_name: string;
  recipient_contact_person: string | null;
  recipient_tin: string | null;
  scope_description: string | null;
  currency: string;
  total_amount: number;
  issue_date: string;
  expires_at: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  notes: string | null;
  paid_at: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const onRequestGet: PagesFunction<Env, "token"> = async ({ env, params }) => {
  if (!env.DB) return jsonResponse(500, { error: "Not configured" });
  const db = env.DB;
  const token = params.token;

  const bill = await db
    .prepare(
      `SELECT id, bill_number, client_type, recipient_name, recipient_contact_person, recipient_tin,
              scope_description, currency, total_amount, issue_date, expires_at, status, notes, paid_at
       FROM bills WHERE token = ?`
    )
    .bind(token)
    .first<BillRow>();

  if (!bill) return jsonResponse(404, { error: "This bill of service link isn't valid." });

  let status = bill.status;
  if (status === "pending" && new Date(bill.expires_at).getTime() < Date.now()) {
    status = "expired";
    await db.prepare(`UPDATE bills SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(new Date().toISOString(), bill.id).run();
  }

  const lineItems = await db
    .prepare(`SELECT description, amount FROM bill_line_items WHERE bill_id = ? ORDER BY sort_order ASC`)
    .bind(bill.id)
    .all<{ description: string; amount: number }>();

  return jsonResponse(200, {
    billNumber: bill.bill_number,
    clientType: bill.client_type,
    recipientName: bill.recipient_name,
    recipientContactPerson: bill.recipient_contact_person,
    recipientTin: bill.recipient_tin,
    scopeDescription: bill.scope_description,
    currency: bill.currency,
    totalAmount: bill.total_amount,
    issueDate: bill.issue_date,
    expiresAt: bill.expires_at,
    status,
    notes: bill.notes,
    paidAt: bill.paid_at,
    lineItems: lineItems.results,
  });
};
