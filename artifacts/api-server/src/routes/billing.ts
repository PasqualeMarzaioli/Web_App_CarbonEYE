/**
 * artifacts/api-server/src/routes/billing.ts — Billing endpoints that retrieve subscription summaries per facility and handle cancellation of subscriptions via Stripe.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import { db, facilitiesTable, submissionsTable, usersTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { stripe } from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// One billing row per facility. Stripe fields are best-effort: a deleted/test subscription
// that fails to retrieve leaves them null rather than failing the whole summary.
type SubscriptionSummary = {
  facilityId: number;
  facilityName: string;
  tier: string;
  stripeSubscriptionId: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  amountCents: number | null;
  currency: string | null;
  certificateValidUntil: string | null;
};

// Reads the access-until / next-renewal timestamp from a subscription. In Stripe API
// version 2026-04-22.dahlia (the pinned version) current_period_end lives on the
// subscription ITEM, not the subscription object; we read the item and defensively fall
// back to the legacy top-level field so the value is correct regardless.
function readPeriodEndIso(sub: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>): string | null {
  const item = sub.items?.data?.[0];
  const periodEnd =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof periodEnd === "number" ? new Date(periodEnd * 1000).toISOString() : null;
}

// GET /api/billing/summary — account overview + one subscription row per facility.
router.get("/billing/summary", requireAuth, async (req, res) => {
  const userId = req.session!.userId;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(401).json({ error: "Session invalid" });
      return;
    }

    // Total certificate requests = submissions count for this user.
    const [{ value: certificatesRequested }] = await db
      .select({ value: count() })
      .from(submissionsTable)
      .where(eq(submissionsTable.userId, userId));

    // The user's facilities, oldest first (stable ordering for the list).
    const facilities = await db
      .select({
        id: facilitiesTable.id,
        name: facilitiesTable.name,
        tier: facilitiesTable.tier,
        stripeSubscriptionId: facilitiesTable.stripeSubscriptionId,
      })
      .from(facilitiesTable)
      .where(eq(facilitiesTable.userId, userId))
      .orderBy(facilitiesTable.id);

    // Build each row independently; the per-facility mapper never rejects (internal
    // try/catch around the Stripe call), so N facilities ⇒ N parallel retrieves and one
    // failing/deleted subscription cannot 500 the whole summary.
    const subscriptions: SubscriptionSummary[] = await Promise.all(
      facilities.map(async (f): Promise<SubscriptionSummary> => {
        // Latest certified submission's certificate validity (reuse the monitoring.ts pattern).
        let certificateValidUntil: string | null = null;
        const certRows = await db
          .select({ certificate: submissionsTable.certificate })
          .from(submissionsTable)
          .where(and(eq(submissionsTable.facilityId, f.id), eq(submissionsTable.status, "certified")))
          .orderBy(desc(submissionsTable.id))
          .limit(1);
        if (certRows.length > 0 && certRows[0].certificate) {
          const cert = certRows[0].certificate as Record<string, unknown>;
          certificateValidUntil = cert.valid_until != null ? String(cert.valid_until) : null;
        }

        let status: string | null = null;
        let cancelAtPeriodEnd = false;
        let currentPeriodEnd: string | null = null;
        let amountCents: number | null = null;
        let currency: string | null = null;

        if (f.stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(f.stripeSubscriptionId);
            status = sub.status;
            cancelAtPeriodEnd = sub.cancel_at_period_end;
            currentPeriodEnd = readPeriodEndIso(sub);
            const price = sub.items?.data?.[0]?.price;
            amountCents = price?.unit_amount ?? null;
            currency = price?.currency ? price.currency.toUpperCase() : null;
          } catch (err) {
            // Deleted in the dashboard, test-mode mismatch, etc. — keep the row, drop the
            // Stripe-derived fields. The DB-derived fields above still render.
            logger.warn(
              { facilityId: f.id, subId: f.stripeSubscriptionId, err: err instanceof Error ? err.message : String(err) },
              "Could not retrieve Stripe subscription for billing summary (non-fatal)",
            );
          }
        }

        return {
          facilityId: f.id,
          facilityName: f.name,
          tier: f.tier,
          stripeSubscriptionId: f.stripeSubscriptionId,
          status,
          cancelAtPeriodEnd,
          currentPeriodEnd,
          amountCents,
          currency,
          certificateValidUntil,
        };
      }),
    );

    res.json({
      account: {
        companyName: user.companyName,
        email: user.email,
        createdAt: user.createdAt,
      },
      certificatesRequested,
      subscriptions,
    });
  } catch (err) {
    logger.error({ userId, err: err instanceof Error ? err.message : String(err) }, "billing summary failed");
    res.status(500).json({ error: "Failed to load billing summary." });
  }
});

// POST /api/billing/subscriptions/:facilityId/cancel — schedule cancellation at period end.
// Decision (locked): cancel_at_period_end keeps access until the paid 3-month period ends,
// then it stops renewing. We do NOT change facilities.tier here — access remains until the
// subscription actually lapses. Idempotent: re-cancelling an already-cancelling sub is a no-op.
router.post("/billing/subscriptions/:facilityId/cancel", requireAuth, async (req, res) => {
  const facilityId = Number(req.params.facilityId);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    res.status(400).json({ error: "facilityId must be a positive integer" });
    return;
  }

  // Ownership check (pattern from checkout.ts): the facility must belong to the caller.
  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, req.session!.userId)));
  if (!facility) {
    res.status(404).json({ error: "Facility not found" });
    return;
  }
  if (!facility.stripeSubscriptionId) {
    res.status(400).json({ error: "No active subscription for this facility." });
    return;
  }

  try {
    const sub = await stripe.subscriptions.update(facility.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    res.json({
      ok: true,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: readPeriodEndIso(sub),
    });
  } catch (err) {
    logger.error(
      { facilityId, subId: facility.stripeSubscriptionId, err: err instanceof Error ? err.message : String(err) },
      "subscription cancel failed",
    );
    res.status(502).json({ error: "Could not cancel the subscription. Please try again." });
  }
});

export default router;
