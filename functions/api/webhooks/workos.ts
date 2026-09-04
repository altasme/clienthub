// Cloudflare Pages Function: POST /api/webhooks/workos
//
// Secondary signal in the account-creation bridge's dual-signal design
// (CLAUDE.md §1.5): the primary path is the OAuth redirect through
// /api/auth-callback; this webhook is an idempotent backstop for
// invitation.accepted events, catching account linking even if the
// browser redirect never lands (closed tab, network drop, etc.). Shares
// the same linking logic (functions/_lib/accountBridge.ts) — whichever
// signal arrives first does the real work, the second is a no-op.
//
// Register this URL (https://account.altasme.com/api/webhooks/workos) in
// the WorkOS dashboard's webhook settings, subscribed to at least the
// invitation.accepted event, once WORKOS_WEBHOOK_SECRET is set.
//
// Signature verification is confirmed against workos-node's real source
// (see functions/_lib/crypto.ts's verifyWorkosSignature for the full
// algorithm + citation) with one open question: the exact header name
// couldn't be verified byte-for-byte from source, only the algorithm
// could. This checks the conventional "WorkOS-Signature" name; if the
// very first real delivery fails verification, the full incoming header
// set is logged below specifically so the real name can be read off that
// log and corrected here.
//
// Required env vars: WORKOS_WEBHOOK_SECRET, DB.

import { verifyWorkosSignature } from "../../_lib/crypto";
import { linkClientAccount } from "../../_lib/accountBridge";

interface Env {
  WORKOS_WEBHOOK_SECRET: string;
  DB?: D1Database;
}

interface WorkosInvitationAcceptedEvent {
  event: string;
  data: {
    accepted_user_id?: string;
    email?: string;
  };
}

function parseEvent(rawBody: string): WorkosInvitationAcceptedEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.event !== "string" || typeof p.data !== "object" || p.data === null) return null;
  const data = p.data as Record<string, unknown>;
  return {
    event: p.event,
    data: {
      accepted_user_id: typeof data.accepted_user_id === "string" ? data.accepted_user_id : undefined,
      email: typeof data.email === "string" ? data.email : undefined,
    },
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.WORKOS_WEBHOOK_SECRET || !env.DB) {
    console.error("workos webhook: missing WORKOS_WEBHOOK_SECRET or DB binding");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("WorkOS-Signature") || request.headers.get("X-WorkOS-Signature") || "";

  if (!signatureHeader) {
    console.error(
      "workos webhook: no recognized signature header found; full header set for diagnosis:",
      JSON.stringify(Object.fromEntries(request.headers.entries()))
    );
    return new Response("Missing signature", { status: 401 });
  }

  const check = await verifyWorkosSignature(env.WORKOS_WEBHOOK_SECRET, rawBody, signatureHeader);
  if (!check.valid) {
    console.error(`workos webhook: signature check failed (${check.reason}), rejecting`);
    return new Response("Invalid signature", { status: 401 });
  }

  const event = parseEvent(rawBody);
  if (!event) {
    console.error("workos webhook: body is not valid JSON or missing required fields", rawBody);
    return new Response("Invalid body", { status: 400 });
  }

  if (event.event !== "invitation.accepted") {
    console.log(`workos webhook: ignoring event "${event.event}"`);
    return new Response("ok", { status: 200 });
  }

  const { accepted_user_id, email } = event.data;
  if (!accepted_user_id || !email) {
    console.error("workos webhook: invitation.accepted missing accepted_user_id or email", rawBody);
    return new Response("ok", { status: 200 });
  }

  try {
    const result = await linkClientAccount(env.DB, accepted_user_id, email);
    console.log(`workos webhook: linkClientAccount outcome "${result.outcome}" for ${email}`);
  } catch (err) {
    console.error("workos webhook: failed to link client account", err);
  }

  return new Response("ok", { status: 200 });
};
