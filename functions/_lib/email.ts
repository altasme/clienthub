// Shared Resend email helper (functions/_lib/email.ts).
//
// Cloudflare Workers isn't a Node runtime, so this calls Resend's REST API
// directly via fetch() — same pattern as the marketing site's
// functions/testpayment.ts. Best-effort by design: every caller wraps a
// send in try/catch and logs on failure rather than letting a bounced
// email undo D1 writes that already committed.
//
// This is the ONLY account-creation nudge sent to a client (CLAUDE.md §1,
// item 10's follow-up fix). WorkOS's own invitation email used to fire
// automatically from the ganap.net webhook at the same moment the
// marketing site's thank-you page showed its own "Create Your Account"
// button — two concurrent, uncoordinated ways in, which confused a real
// client who got both at once. The webhook no longer calls WorkOS's
// invitations API at all; ACCOUNT_SIGNUP_URL below is the one link in the
// whole ecosystem that starts account creation.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendEmailEnv {
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
}

export async function sendEmail(
  env: SendEmailEnv,
  { to, subject, html }: { to: string; subject: string; html: string }
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject, html }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Resend failed: ${response.status} ${text}`);
  }
}

export const ACCOUNT_SIGNUP_URL = "https://account.altasme.com/api/auth-start?intent=signup";

/**
 * The email sent from the ganap.net payment webhook. Always a payment
 * confirmation first — the account-creation nudge is a small footer
 * notice, not the headline, and only appears at all for a client with no
 * linked WorkOS account yet (a returning client paying for a second
 * project gets a dashboard link instead, since they already have one).
 */
export function paymentConfirmationEmail(params: {
  clientName: string;
  businessName: string;
  amount: number;
  currency: string;
  hasAccount: boolean;
}): { subject: string; html: string } {
  const { clientName, businessName, amount, currency, hasAccount } = params;
  const greetingName = clientName || businessName || "there";

  const footer = hasAccount
    ? `<p style="margin-top: 24px; font-size: 14px; color: #667085;">You can track this project any time by logging into your <a href="https://account.altasme.com/">Altaventures dashboard</a>.</p>`
    : `<p style="margin-top: 24px; font-size: 14px; color: #667085;">Haven't created your account yet? <a href="${ACCOUNT_SIGNUP_URL}">Click here to get started</a>.</p>`;

  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>We've received your payment of &#8369;${amount} ${escapeHtml(currency)} for <strong>${escapeHtml(businessName)}</strong>. Thanks for choosing Altaventures. We're excited to get started on your website.</p>
    <p>We'll be in touch shortly with next steps.</p>
    ${footer}
  `;

  return { subject: `Payment Received: ${businessName || "Your Website"}`, html };
}

/**
 * The email sent from the internal-upsell ganap.net webhook (Pricing
 * page purchases, plans and add-ons alike) — distinct wording from
 * paymentConfirmationEmail since these are existing, already-onboarded
 * clients buying a specific catalog item, not a new payment kicking off
 * the account-creation bridge.
 */
export function upsellPurchaseEmail(params: {
  clientName: string;
  businessName: string;
  itemName: string;
  amount: number;
  currency: string;
  renewalAmount: number | null;
  nextRenewalDate: string | null;
}): { subject: string; html: string } {
  const { clientName, businessName, itemName, amount, currency, renewalAmount, nextRenewalDate } = params;
  const greetingName = clientName || businessName || "there";

  const renewalNote =
    renewalAmount && nextRenewalDate
      ? `<p style="margin-top: 16px; font-size: 14px; color: #667085;">This renews at &#8369;${renewalAmount} on ${escapeHtml(new Date(nextRenewalDate).toLocaleDateString())}. There's no auto-charge. We'll let you know when it's time, and you can renew from your Account page.</p>`
      : "";

  const html = `
    <p>Hi ${escapeHtml(greetingName)},</p>
    <p>We've received your payment of &#8369;${amount} ${escapeHtml(currency)} for <strong>${escapeHtml(itemName)}</strong>. Thanks for growing with Altaventures.</p>
    ${renewalNote}
    <p style="margin-top: 24px; font-size: 14px; color: #667085;">You can see this in your <a href="https://account.altasme.com/account">Altaventures dashboard</a> any time.</p>
  `;

  return { subject: `Purchase Confirmed: ${itemName}`, html };
}
