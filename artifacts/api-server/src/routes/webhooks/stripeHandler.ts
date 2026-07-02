/**
 * artifacts/api-server/src/routes/webhooks/stripeHandler.ts — Stripe event processor handling checkout session completion for submissions and tier upgrades, with idempotent materialization, admin notification, and analysis polling logic.
 * Author: Pasquale Marzaioli
 */
import Stripe from "stripe";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  db as defaultDb,
  facilitiesTable,
  stripeEventsTable,
  submissionsTable,
  usersTable,
  type Submission,
} from "@workspace/db";
import {
  isSubmissionTier,
  validateSubmissionDraft,
  type SubmissionTier,
} from "../../lib/submissionSchema";
import { logger } from "../../lib/logger";
import { pollAnalyzeAsync } from "../../lib/azureFunctions";
// Feature 3: admin notification on a new paid certificate request. Imported from the
// shared mailer, which is bundled into this file's esbuild output (dist/stripeHandler.mjs).
// Resend is a pure-fetch SDK (not on esbuild's `external` list), so it inlines cleanly.
import { parseAdminEmails, sendCertificateRequestAdminEmail } from "../../lib/mailer";

type Database = typeof defaultDb;

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const withCode = err as { code?: unknown; cause?: unknown };
  if (withCode.code === "23505") return true;
  return isDuplicateKeyError(withCode.cause);
}

function reassembleDraft(metadata: Stripe.Metadata | null): unknown {
  if (!metadata) throw new Error("Missing Stripe metadata.");
  if (metadata.draft) return JSON.parse(metadata.draft);

  let raw = "";
  for (let i = 0; i < 47; i++) {
    const chunk = metadata[`draft_${i}`];
    if (!chunk) break;
    raw += chunk;
  }
  if (!raw) throw new Error("Missing submission draft metadata.");
  return JSON.parse(raw);
}

function parseUserId(value: string | undefined): number {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid Stripe userId metadata.");
  }
  return userId;
}

function parseTier(value: string | undefined): SubmissionTier {
  if (!isSubmissionTier(value)) {
    throw new Error("Invalid Stripe tier metadata.");
  }
  return value;
}

async function insertStripeEvent(event: Stripe.Event, database: Database): Promise<"inserted" | "duplicate"> {
  try {
    await database.insert(stripeEventsTable).values({
      stripeEventId: event.id,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
    return "inserted";
  } catch (err) {
    if (isDuplicateKeyError(err)) return "duplicate";
    throw err;
  }
}

function extractSubscriptionId(session: Stripe.Checkout.Session): string | null {
  const raw = session.subscription;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof raw.id === "string") return raw.id;
  return null;
}

// The discriminated result of materializing a completed Checkout session. Both the
// webhook and the synchronous /checkout/reconcile safety net dispatch through
// handleCheckoutSession() and act on this.
export type CheckoutResult =
  | { kind: "submission"; submission: Submission; created: boolean }
  | { kind: "upgrade"; facilityId: number; upgraded: boolean }
  | { kind: "ignored" };

// Feature 3: notify the CarbonEYE admins that a customer paid for and requested a
// certificate. Fired exactly once per genuinely-new submission (the created===true path,
// which already guards webhook retries via the unique stripe_session_id). NEVER throws —
// the whole body is wrapped so a Resend hiccup can never bubble into the webhook and make
// Stripe retry (a throw there could otherwise risk losing the submission, per the ordering
// comment in handleStripeWebhook).
async function notifyAdminsOfNewSubmission(submission: Submission, database: Database): Promise<void> {
  try {
    // Recipients: the configured ADMIN_EMAILS (shared parsing with auth.ts role assignment).
    // Fall back to the DB's admin users only when the env is empty, so we never go silent.
    let recipients = parseAdminEmails(process.env.ADMIN_EMAILS);
    if (recipients.length === 0) {
      const admins = await database
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.role, "admin"));
      recipients = admins.map((a) => a.email).filter(Boolean);
    }

    // The webhook has no request origin, so the admin-console link comes from APP_BASE_URL.
    // Omit it entirely when unset rather than emit a broken relative link.
    const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
    const adminUrl = base ? `${base}/admin` : null;

    await sendCertificateRequestAdminEmail({
      to: recipients,
      companyName: submission.companyName,
      industry: submission.industry,
      lat: submission.lat,
      lon: submission.lon,
      tierAtSubmission: submission.tierAtSubmission,
      submissionId: submission.id,
      paymentAmountCents: submission.paymentAmountCents,
      paymentCurrency: submission.paymentCurrency,
      adminUrl,
    });
  } catch (err) {
    // Defense in depth: sendCertificateRequestAdminEmail already swallows its own errors,
    // but the DB fallback query above could throw — keep this non-fatal regardless.
    logger.warn(
      { submissionId: submission.id, err: err instanceof Error ? err.message : String(err) },
      "Failed to notify admins of new submission (non-fatal)",
    );
  }
}

// Materializes the paid `submissions` row (and, for a brand-new site, its facility)
// from a completed "submission" Checkout session. IDEMPOTENT: keyed on the unique
// submissions.stripe_session_id, so the webhook and /checkout/reconcile can both run it
// for the same session and only the first one inserts. Returns the submission either way.
export async function materializeSubmissionFromSession(
  session: Stripe.Checkout.Session,
  database: Database,
): Promise<{ submission: Submission; created: boolean }> {
  const metadata = session.metadata;
  const userId = parseUserId(metadata?.userId);
  const tier = parseTier(metadata?.tier);
  const validation = validateSubmissionDraft(reassembleDraft(metadata));
  if (!validation.ok) throw new Error(validation.error);
  if (typeof session.amount_total !== "number") {
    throw new Error("Stripe Checkout Session is missing amount_total.");
  }
  if (typeof session.currency !== "string") {
    throw new Error("Stripe Checkout Session is missing currency.");
  }
  const amountTotal = session.amount_total;
  const currency = session.currency.toUpperCase();
  const subscriptionId = extractSubscriptionId(session);
  if (!subscriptionId) {
    throw new Error("Stripe Checkout Session is missing the subscription id.");
  }

  // Fast idempotency path: if this session was already materialized (webhook OR a prior
  // reconcile call), return that submission without touching the DB further.
  const [existing] = await database
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.stripeSessionId, session.id));
  if (existing) return { submission: existing, created: false };

  try {
    const submission = await database.transaction(async (tx) => {
      // Resolve the monitoring tab (facility): reuse it on a renewal, create it on a
      // brand-new submission. The renewal's facility ownership is re-verified here as
      // defense in depth even though /checkout/renew already checked it. Tier now lives
      // on the facility — we no longer write users.tier here.
      let facilityId = validation.draft.facilityId;
      if (facilityId != null) {
        const [owned] = await tx
          .select({ id: facilitiesTable.id })
          .from(facilitiesTable)
          .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, userId)));
        if (!owned) throw new Error("Renewal facility not found for this user.");
        // A renewal keeps the company's current tier and subscription — do NOT touch
        // facilities.tier or facilities.stripe_subscription_id here.
      } else {
        // Brand-new facility: its tier is the tier just paid for, and the subscription
        // that funds it is this Checkout's subscription (needed to cancel on upgrade).
        const [created] = await tx
          .insert(facilitiesTable)
          .values({
            userId,
            name: validation.draft.companyName,
            industry: validation.draft.industry,
            lat: validation.draft.lat,
            lon: validation.draft.lon,
            tier,
            stripeSubscriptionId: subscriptionId,
          })
          .returning({ id: facilitiesTable.id });
        facilityId = created.id;
      }

      const [inserted] = await tx
        .insert(submissionsTable)
        .values({
          userId,
          facilityId,
          companyName: validation.draft.companyName,
          industry: validation.draft.industry,
          lat: validation.draft.lat,
          lon: validation.draft.lon,
          notes: validation.draft.notes,
          status: "pending",
          tierAtSubmission: tier,
          stripeSessionId: session.id,
          paymentAmountCents: amountTotal,
          paymentCurrency: currency,
          paidAt: new Date(),
        })
        .returning();
      return inserted;
    });
    // Genuinely-new submission: notify admins exactly once. Awaited (so the attempt
    // completes before this serverless invocation can be frozen) but non-fatal.
    await notifyAdminsOfNewSubmission(submission, database);
    return { submission, created: true };
  } catch (err) {
    // Lost a race with a concurrent webhook/reconcile: the unique stripe_session_id
    // insert raised 23505 and the whole transaction (incl. any new facility) rolled
    // back. Re-read the row the winner inserted and return it idempotently.
    if (isDuplicateKeyError(err)) {
      const [row] = await database
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.stripeSessionId, session.id));
      if (row) return { submission: row, created: false };
    }
    throw err;
  }
}

// Applies an "upgrade" Checkout session: flips the facility to Premium, points it at the
// new subscription, and cancels the old Basic subscription. IDEMPOTENT and never issues a
// new certificate — it only unlocks the data already being collected while Basic.
export async function handleUpgradeCheckout(
  session: Stripe.Checkout.Session,
  database: Database,
): Promise<{ facilityId: number; upgraded: boolean }> {
  const metadata = session.metadata;
  const userId = parseUserId(metadata?.userId);
  const facilityId = Number(metadata?.facilityId);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    throw new Error("Invalid Stripe facilityId metadata.");
  }
  const newSubId = extractSubscriptionId(session);
  if (!newSubId) {
    throw new Error("Stripe upgrade session is missing the subscription id.");
  }

  // Ownership: the facility must belong to the user named in the session metadata.
  const [facility] = await database
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, userId)));
  if (!facility) throw new Error("Upgrade facility not found for this user.");

  // Idempotent: a duplicate webhook + reconcile for the same session must not re-cancel
  // the (now-already-cancelled) old subscription or re-flip an already-premium facility.
  if (facility.tier === "premium" && facility.stripeSubscriptionId === newSubId) {
    return { facilityId, upgraded: false };
  }

  const oldSubId = facility.stripeSubscriptionId;
  await database
    .update(facilitiesTable)
    .set({ tier: "premium", stripeSubscriptionId: newSubId })
    .where(eq(facilitiesTable.id, facilityId));

  // Cancel the old Basic subscription so the customer is not billed for both plans.
  // Non-fatal: the upgrade has already been applied above; a Stripe hiccup here must not
  // roll it back. A Stripe client is built lazily (rather than importing ../../lib/stripe
  // at module load) so this file stays free of the PRICE_IDS/URLS requireEnv side effects
  // on the Vercel webhook bundle.
  if (oldSubId && oldSubId !== newSubId) {
    try {
      const sc = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", { apiVersion: "2026-04-22.dahlia" });
      await sc.subscriptions.cancel(oldSubId);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to cancel old Basic subscription on upgrade (non-fatal)",
      );
    }
  }
  return { facilityId, upgraded: true };
}

// Dispatches a completed Checkout session by its metadata.kind. Shared by the webhook
// and /checkout/reconcile so both paths materialize identically.
export async function handleCheckoutSession(
  session: Stripe.Checkout.Session,
  database: Database,
): Promise<CheckoutResult> {
  const kind = session.metadata?.kind;
  if (kind === "submission") {
    const result = await materializeSubmissionFromSession(session, database);
    return { kind: "submission", ...result };
  }
  if (kind === "upgrade") {
    const result = await handleUpgradeCheckout(session, database);
    return { kind: "upgrade", ...result };
  }
  logger.info({ kind }, "Stripe checkout session completed with unsupported metadata kind");
  return { kind: "ignored" };
}

export async function handleStripeWebhook(event: Stripe.Event, database: Database): Promise<void> {
  // Process the event BEFORE recording it in stripe_events. handleCheckoutSession is
  // idempotent — the submission is keyed on the unique submissions.stripe_session_id and
  // the upgrade is a no-op once the facility is already Premium — so running it first
  // means a transient failure leaves NO stripe_events row, and Stripe's automatic retry
  // re-runs it cleanly.
  //
  // The previous order recorded the event first and returned early on a duplicate; when
  // materialization then failed (e.g. a table missing in the DB), the event row was
  // already committed, so every retry saw a "duplicate" and short-circuited — permanently
  // losing the paid submission. Recording the event LAST removes that trap: correctness
  // now depends on the idempotent business write, not on the order of the audit insert.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await handleCheckoutSession(session, database);
  } else {
    logger.info({ eventType: event.type }, "Stripe event recorded without handler");
  }

  // Record the delivery for audit + at-most-once accounting. A duplicate here is the
  // expected outcome of a Stripe retry of an already-processed event, and is a no-op.
  await insertStripeEvent(event, database);
}

export async function handleStripeWebhookWithDefaultDb(event: Stripe.Event): Promise<void> {
  await handleStripeWebhook(event, defaultDb);
}

// Vercel serverless entry-point: takes raw request body + signature, verifies,
// dispatches to the canonical handler. Keeps the Stripe SDK dep inside this
// bundled file so the Vercel function does not need its own package.json.
export async function verifyAndHandleStripeWebhook(
  rawBody: Buffer | string,
  signature: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return { ok: false, status: 500, error: "Stripe env vars missing" };
  }
  const stripeClient = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : "Invalid signature" };
  }
  await handleStripeWebhook(event, defaultDb);
  return { ok: true };
}

function normalizeCertificate(cert: Record<string, unknown>): Record<string, unknown> {
  const timestamp = String(cert.timestamp ?? new Date().toISOString());
  const score = Number(cert.esg_score ?? 0);
  const issuanceDate = new Date(timestamp);
  const quarterStartMonth = Math.floor(issuanceDate.getUTCMonth() / 3) * 3;
  const validUntil = new Date(Date.UTC(
    issuanceDate.getUTCFullYear(),
    quarterStartMonth + 3,
    0,
    23,
    59,
    59,
    999,
  ));
  return {
    ...cert,
    esg_grade: String(cert.esg_grade ?? gradeFromScore(score)),
    timestamp,
    monitoring_period: cert.monitoring_period ?? monitoringPeriodFrom(timestamp),
    valid_until: String(cert.valid_until ?? validUntil.toISOString()),
    verified_emissions_tco2eq: Number(cert.verified_emissions_tco2eq ?? 0),
  };
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 72) return "B+";
  if (score >= 65) return "B";
  if (score >= 58) return "C+";
  if (score >= 50) return "C";
  if (score >= 40) return "D";
  return "F";
}

function monitoringPeriodFrom(ts?: string): { start: string; end: string } {
  const d = ts ? new Date(ts) : new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function pollAnalysesWithDefaultDb(): Promise<{
  checked: number;
  results: Array<Record<string, unknown>>;
}> {
  const pending = await defaultDb
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.status, "analyzing"), isNotNull(submissionsTable.azureRequestId)));

  const results = await Promise.allSettled(
    pending.map(async (s) => {
      try {
        const poll = await pollAnalyzeAsync(s.azureRequestId!);
        if (poll.done && poll.success) {
          await defaultDb
            .update(submissionsTable)
            .set({
              status: "in_review",
              certificate: normalizeCertificate(poll.result),
              azureRequestId: null,
              updatedAt: new Date(),
            })
            .where(eq(submissionsTable.id, s.id));
          return { id: s.id, action: "completed" };
        }
        if (poll.done && !poll.success) {
          await defaultDb
            .update(submissionsTable)
            .set({
              status: "analysis_failed",
              azureRequestId: null,
              updatedAt: new Date(),
            })
            .where(eq(submissionsTable.id, s.id));
          return { id: s.id, action: "rejected", reason: poll.reason };
        }
        return { id: s.id, action: "still_pending" };
      } catch (err) {
        await defaultDb
          .update(submissionsTable)
          .set({
            status: "analysis_failed",
            azureRequestId: null,
            updatedAt: new Date(),
          })
          .where(eq(submissionsTable.id, s.id));
        return { id: s.id, action: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return {
    checked: pending.length,
    results: results.map((r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) })),
  };
}
