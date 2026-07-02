/**
 * artifacts/api-server/src/lib/mailer.ts — Best-effort email delivery using Resend for verification, password resets, contact forms, and admin notifications on certificate requests.
 * Author: Pasquale Marzaioli
 */
import { Resend } from "resend";
import { logger } from "./logger";

// Shared, best-effort email infrastructure used by feature 2 (email verification) and
// feature 3 (admin notification on a new paid certificate request).
//
// Design constraints (do not relax):
//  - The Resend client is built LAZILY inside each send, never at module load. This
//    mirrors the lazy-Stripe pattern in stripeHandler.ts and is critical because this
//    module is bundled into the Vercel webhook function (dist/stripeHandler.mjs): a
//    top-level `new Resend(process.env.RESEND_API_KEY)` would throw on import if the key
//    were missing and take the whole webhook bundle down with it.
//  - Every exported send NEVER throws. Email is best-effort: callers (a register route,
//    a Stripe webhook) must not 500 or retry just because delivery failed. On any error
//    we logger.warn and return `false`; on success we return `true`.

// Build a Resend client from the current env, or null when no API key is configured.
// Returning null (rather than throwing) lets the dev/test environments run the full
// signup→verify flow via the API's `verifyUrl` escape hatch without real delivery.
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

// The verified sender, e.g. `CarbonEYE <onboarding@resend.dev>`. Falls back to Resend's
// shared test sender so a missing EMAIL_FROM degrades gracefully instead of throwing.
function sender(): string {
  return process.env.EMAIL_FROM?.trim() || "CarbonEYE <onboarding@resend.dev>";
}

// Parse a comma-separated ADMIN_EMAILS string into a normalized, de-duplicated list.
// Replicates EXACTLY the parsing in routes/auth.ts (split → trim → lowercase → filter
// empties) so the admin-role assignment and the admin-notification recipients share one
// implementation and can never disagree about who is an admin.
export function parseAdminEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Sends the "verify your email" message after registration. Best-effort: returns true
// when Resend accepted the message, false otherwise (no key, send error, etc.).
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    // Not an error in dev/test: the register route returns `verifyUrl` in the response
    // body so the flow stays testable without a configured mailbox.
    logger.warn({ to }, "RESEND_API_KEY not set — skipping verification email (dev fallback active)");
    return false;
  }
  try {
    const { error } = await client.emails.send({
      from: sender(),
      to,
      subject: "Verify your CarbonEYE email",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a2e1e;">
          <h2 style="color:#1a7a2e;margin:0 0 8px;">Confirm your email</h2>
          <p style="font-size:14px;line-height:1.6;color:#4a7a58;">
            Welcome to CarbonEYE. Please confirm this email address to activate your account
            and sign in.
          </p>
          <p style="margin:24px 0;">
            <a href="${verifyUrl}"
               style="background:#1a7a2e;color:#fff;text-decoration:none;font-weight:700;
                      padding:12px 22px;border-radius:8px;display:inline-block;font-size:14px;">
              Verify my email
            </a>
          </p>
          <p style="font-size:12px;color:#8ab898;line-height:1.6;">
            This link expires in 24 hours. If the button does not work, copy and paste this
            URL into your browser:<br />
            <a href="${verifyUrl}" style="color:#27ae60;word-break:break-all;">${verifyUrl}</a>
          </p>
          <p style="font-size:12px;color:#8ab898;">If you did not create a CarbonEYE account, you can ignore this email.</p>
        </div>
      `,
    });
    if (error) {
      logger.warn({ to, err: error.message }, "Resend rejected the verification email (non-fatal)");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { to, err: err instanceof Error ? err.message : String(err) },
      "Failed to send verification email (non-fatal)",
    );
    return false;
  }
}

// Sends the "reset your password" message. Best-effort: returns true when Resend accepted
// the message, false otherwise (no key, send error, etc.). Mirrors sendVerificationEmail so
// the forgot-password flow emails the link instead of leaking it in the API response.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    // Not an error in dev/test: the forgot-password route returns `resetUrl` in the
    // response body (only when isDev) so the flow stays testable without a mailbox.
    logger.warn({ to }, "RESEND_API_KEY not set — skipping password-reset email (dev fallback active)");
    return false;
  }
  try {
    const { error } = await client.emails.send({
      from: sender(),
      to,
      subject: "Reset your CarbonEYE password",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a2e1e;">
          <h2 style="color:#1a7a2e;margin:0 0 8px;">Reset your password</h2>
          <p style="font-size:14px;line-height:1.6;color:#4a7a58;">
            We received a request to reset the password for your CarbonEYE account. Click the
            button below to choose a new password.
          </p>
          <p style="margin:24px 0;">
            <a href="${resetUrl}"
               style="background:#1a7a2e;color:#fff;text-decoration:none;font-weight:700;
                      padding:12px 22px;border-radius:8px;display:inline-block;font-size:14px;">
              Reset my password
            </a>
          </p>
          <p style="font-size:12px;color:#8ab898;line-height:1.6;">
            This link expires in 1 hour. If the button does not work, copy and paste this
            URL into your browser:<br />
            <a href="${resetUrl}" style="color:#27ae60;word-break:break-all;">${resetUrl}</a>
          </p>
          <p style="font-size:12px;color:#8ab898;">If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `,
    });
    if (error) {
      logger.warn({ to, err: error.message }, "Resend rejected the password-reset email (non-fatal)");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { to, err: err instanceof Error ? err.message : String(err) },
      "Failed to send password-reset email (non-fatal)",
    );
    return false;
  }
}

// Inputs for the contact form notification sent to admins on every new message.
export type ContactFormEmailOpts = {
  to: string[];
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
};

// Notifies the CarbonEYE admins that someone submitted the contact form.
// Best-effort: never throws, returns false on any failure.
export async function sendContactFormEmail(opts: ContactFormEmailOpts): Promise<boolean> {
  if (opts.to.length === 0) {
    logger.warn("No admin recipients configured — skipping contact form email");
    return false;
  }
  const client = getClient();
  if (!client) {
    logger.warn("RESEND_API_KEY not set — skipping contact form email");
    return false;
  }
  try {
    const { error } = await client.emails.send({
      from: sender(),
      to: opts.to,
      subject: `[Contact] ${opts.subject} — ${opts.name}`,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a2e1e;">
          <h2 style="color:#1a7a2e;margin:0 0 8px;">New contact message</h2>
          <table style="font-size:13px;color:#1a2e1e;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">From</td><td style="padding:4px 0;font-weight:700;">${opts.name} &lt;${opts.email}&gt;</td></tr>
            ${opts.company ? `<tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Company</td><td style="padding:4px 0;">${opts.company}</td></tr>` : ""}
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Subject</td><td style="padding:4px 0;">${opts.subject}</td></tr>
          </table>
          <div style="background:#f4faf6;border-left:3px solid #1a7a2e;padding:12px 16px;font-size:14px;line-height:1.7;color:#1a2e1e;white-space:pre-wrap;">${opts.message}</div>
          <p style="font-size:12px;color:#8ab898;margin-top:20px;">CarbonEYE — Truth is not declared, it's measured.</p>
        </div>
      `,
    });
    if (error) {
      logger.warn({ err: error.message }, "Resend rejected the contact form email (non-fatal)");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to send contact form email (non-fatal)",
    );
    return false;
  }
}

// Inputs for the admin notification fired once per genuinely-new paid submission.
export type CertificateRequestAdminEmailOpts = {
  to: string[]; // already-parsed admin recipients (parseAdminEmails)
  companyName: string;
  industry: string | null;
  lat: number;
  lon: number;
  tierAtSubmission: string;
  submissionId: number;
  paymentAmountCents: number;
  paymentCurrency: string;
  adminUrl?: string | null; // absolute link to the admin console, omitted when unknown
};

// Notifies the CarbonEYE admins that a customer paid for and requested a certificate, so
// they don't have to watch the console manually. Best-effort: returns true when Resend
// accepted the message, false otherwise. NEVER throws — feature 3 calls this from inside
// the Stripe webhook, where a throw could make Stripe retry and risk losing the submission.
export async function sendCertificateRequestAdminEmail(
  opts: CertificateRequestAdminEmailOpts,
): Promise<boolean> {
  if (opts.to.length === 0) {
    logger.warn("No admin recipients configured — skipping certificate-request admin email");
    return false;
  }
  const client = getClient();
  if (!client) {
    logger.warn("RESEND_API_KEY not set — skipping certificate-request admin email");
    return false;
  }
  // Human-readable amount, e.g. "12.34 EUR" from 1234 cents.
  const amount = `${(opts.paymentAmountCents / 100).toFixed(2)} ${opts.paymentCurrency.toUpperCase()}`;
  const tier = opts.tierAtSubmission.toUpperCase();
  try {
    const { error } = await client.emails.send({
      from: sender(),
      to: opts.to,
      subject: `New ${tier} certificate request — ${opts.companyName}`,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a2e1e;">
          <h2 style="color:#1a7a2e;margin:0 0 8px;">New certificate request</h2>
          <p style="font-size:14px;line-height:1.6;color:#4a7a58;">
            A customer has paid for and requested a verified ESG certificate. Run the analysis
            from the admin console when ready.
          </p>
          <table style="font-size:13px;color:#1a2e1e;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Submission</td><td style="padding:4px 0;font-weight:700;">#${opts.submissionId}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Company</td><td style="padding:4px 0;font-weight:700;">${opts.companyName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Industry</td><td style="padding:4px 0;">${opts.industry ?? "—"}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Coordinates</td><td style="padding:4px 0;">${opts.lat.toFixed(4)}, ${opts.lon.toFixed(4)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Plan</td><td style="padding:4px 0;font-weight:700;">${tier}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#8ab898;">Paid</td><td style="padding:4px 0;">${amount}</td></tr>
          </table>
          ${
            opts.adminUrl
              ? `<p style="margin:20px 0;">
                   <a href="${opts.adminUrl}"
                      style="background:#1a7a2e;color:#fff;text-decoration:none;font-weight:700;
                             padding:12px 22px;border-radius:8px;display:inline-block;font-size:14px;">
                     Open the admin console
                   </a>
                 </p>`
              : ""
          }
          <p style="font-size:12px;color:#8ab898;">CarbonEYE — Truth is not declared, it's measured.</p>
        </div>
      `,
    });
    if (error) {
      logger.warn({ submissionId: opts.submissionId, err: error.message }, "Resend rejected the admin email (non-fatal)");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { submissionId: opts.submissionId, err: err instanceof Error ? err.message : String(err) },
      "Failed to send certificate-request admin email (non-fatal)",
    );
    return false;
  }
}
