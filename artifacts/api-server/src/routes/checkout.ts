/**
 * artifacts/api-server/src/routes/checkout.ts — Stripe Checkout flow orchestration for new submissions, renewals, and tier upgrades, with post-payment reconciliation and facility management.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter, type Request } from "express";
import { db, facilitiesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { PRICE_IDS, stripe } from "../lib/stripe";
import {
  isSubmissionTier,
  validateSubmissionDraft,
  type SubmissionDraft,
  type SubmissionTier,
} from "../lib/submissionSchema";
// The reconcile route runs the SAME materialization as the Stripe webhook, so a paid
// request always appears even if the webhook is slow/unreachable in this environment.
import { handleCheckoutSession } from "./webhooks/stripeHandler";

const router: IRouter = Router();
const MAX_METADATA_VALUE_LENGTH = 500;
const MAX_DRAFT_METADATA_KEYS = 47;

// Base origin of the web app for this request. Prefer the browser-sent Origin
// header (always present on the same-origin fetch that starts Checkout); fall
// back to the proxied host (the app sets `trust proxy`, so req.protocol honours
// x-forwarded-proto). This is the same derivation auth.ts uses for its links.
function appOrigin(req: Request): string {
  return (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.get("host")}`;
}

// Post-payment redirect targets, built from the live request origin so they
// always point at the deployment the user is on. Both land on the user portal:
// UserPortal reads `payment` / `session_id` and reconciles the paid submission
// synchronously. {CHECKOUT_SESSION_ID} is substituted by Stripe at redirect.
function checkoutRedirectUrls(req: Request): { success_url: string; cancel_url: string } {
  const origin = appOrigin(req);
  return {
    success_url: `${origin}/portal?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/portal?payment=cancelled`,
  };
}

function encodeDraftMetadata(draft: unknown): Record<string, string> {
  const json = JSON.stringify(draft);
  if (json.length <= MAX_METADATA_VALUE_LENGTH) {
    return { draft: json };
  }

  const chunks: Record<string, string> = {};
  for (let i = 0; i < json.length; i += MAX_METADATA_VALUE_LENGTH) {
    const index = Math.floor(i / MAX_METADATA_VALUE_LENGTH);
    if (index >= MAX_DRAFT_METADATA_KEYS) {
      throw new Error("Submission draft is too large for Stripe Checkout metadata.");
    }
    chunks[`draft_${index}`] = json.slice(i, i + MAX_METADATA_VALUE_LENGTH);
  }
  return chunks;
}

async function getAuthenticatedUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user ?? null;
}

async function createOrReuseStripeCustomer(user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.companyName ?? undefined,
    metadata: { userId: String(user.id) },
  });

  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(usersTable.id, user.id));

  return customer.id;
}

// Creates the subscription Checkout session for a (new or renewal) submission and
// returns its URL. Shared by /checkout/submission and /checkout/renew so both paths
// encode the draft identically and the webhook materializes the submission the same way.
async function createSubmissionCheckoutSession(
  req: Request,
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
  tier: SubmissionTier,
  draft: SubmissionDraft,
): Promise<{ url: string } | { error: string; status: number }> {
  let draftMetadata: Record<string, string>;
  try {
    draftMetadata = encodeDraftMetadata(draft);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid submission draft", status: 400 };
  }

  const customerId = await createOrReuseStripeCustomer(user);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE_IDS[tier], quantity: 1 }],
    ...checkoutRedirectUrls(req),
    metadata: {
      kind: "submission",
      userId: String(user.id),
      tier,
      ...draftMetadata,
    },
  });

  if (!session.url) return { error: "Stripe did not return a Checkout URL.", status: 502 };
  return { url: session.url };
}

router.post("/checkout/submission", requireAuth, async (req, res) => {
  const validation = validateSubmissionDraft(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const user = await getAuthenticatedUser(req.session!.userId);
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  // Tier is chosen per submission now (it lives on the facility, not the account), so it
  // always comes from the request body — never forced from a previous account-level tier.
  const bodyTier = (req.body as Record<string, unknown> | undefined)?.tier;
  if (!isSubmissionTier(bodyTier)) {
    res.status(400).json({ error: "tier must be basic or premium" });
    return;
  }
  const tier: SubmissionTier = bodyTier;

  // If a facilityId was supplied (renewal via this route), verify ownership before
  // creating the Stripe session. New-facility submissions carry no facilityId.
  if (validation.draft.facilityId != null) {
    const [owned] = await db
      .select({ id: facilitiesTable.id })
      .from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, validation.draft.facilityId), eq(facilitiesTable.userId, user.id)));
    if (!owned) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }
  }

  const result = await createSubmissionCheckoutSession(req, user, tier, validation.draft);
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ url: result.url });
});

// Renew an existing facility's certificate: a new paid submission tied to the SAME
// facility (same monitoring tab), so its daily readings keep accumulating. The draft
// is rebuilt from the stored facility record (we do not trust client coordinates on a
// renewal), and the tier is the account's current tier (renewals never change tier).
router.post("/checkout/renew", requireAuth, async (req, res) => {
  const facilityId = Number((req.body as Record<string, unknown> | undefined)?.facilityId);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    res.status(400).json({ error: "facilityId must be a positive integer" });
    return;
  }

  const user = await getAuthenticatedUser(req.session!.userId);
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, user.id)));
  if (!facility) {
    res.status(404).json({ error: "Facility not found" });
    return;
  }

  // A renewal keeps the company's CURRENT tier (tier changes only via the upgrade flow),
  // so it comes from the facility, not the account. facilities.tier is NOT NULL with a
  // 'basic' default, so this is always a valid SubmissionTier; coerce defensively.
  const renewTier: SubmissionTier = isSubmissionTier(facility.tier) ? facility.tier : "basic";

  const draft: SubmissionDraft = {
    companyName: facility.name,
    industry: facility.industry,
    lat: facility.lat,
    lon: facility.lon,
    notes: typeof (req.body as Record<string, unknown>)?.notes === "string"
      ? ((req.body as { notes: string }).notes)
      : null,
    facilityId: facility.id,
  };

  const result = await createSubmissionCheckoutSession(req, user, renewTier, draft);
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ url: result.url });
});

// Upgrade Basic -> Premium for ONE facility. This is a NEW paid Stripe Checkout (no
// proration, no auto-charge of a previously used card): the user pays the Premium price
// again, and only after payment does the webhook / reconcile flip facilities.tier to
// 'premium', point the facility at the new subscription, and cancel the old Basic one.
// It does NOT request or issue a new certificate — it only unlocks the data already
// being collected while Basic (and hidden).
router.post("/checkout/upgrade", requireAuth, async (req, res) => {
  const facilityId = Number((req.body as Record<string, unknown> | undefined)?.facilityId);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    res.status(400).json({ error: "facilityId must be a positive integer" });
    return;
  }

  const user = await getAuthenticatedUser(req.session!.userId);
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, user.id)));
  if (!facility) {
    res.status(404).json({ error: "Facility not found" });
    return;
  }
  if (facility.tier !== "basic") {
    res.status(400).json({ error: "Only Basic facilities can upgrade to Premium." });
    return;
  }

  const customerId = await createOrReuseStripeCustomer(user);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE_IDS.premium, quantity: 1 }],
    ...checkoutRedirectUrls(req),
    // metadata.kind === "upgrade" routes the completed session to handleUpgradeCheckout,
    // which flips this exact facility to Premium and cancels its old Basic subscription.
    metadata: {
      kind: "upgrade",
      userId: String(user.id),
      facilityId: String(facilityId),
    },
  });

  if (!session.url) {
    res.status(502).json({ error: "Stripe did not return a Checkout URL." });
    return;
  }
  res.json({ url: session.url });
});

// Synchronous post-payment safety net. The success page calls this with the Stripe
// Checkout session_id so the paid submission (or upgrade) materializes immediately, even
// if the webhook is slow, unreachable, or misconfigured in this environment. It runs the
// SAME dispatch as the webhook (handleCheckoutSession) and is idempotent, so a later
// webhook delivery is a no-op.
router.post("/checkout/reconcile", requireAuth, async (req, res) => {
  const sessionId = (req.body as Record<string, unknown> | undefined)?.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const user = await getAuthenticatedUser(req.session!.userId);
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(400).json({ error: "Could not load the Checkout session." });
    return;
  }

  // Ownership: the session must belong to the caller (the userId we stamped in metadata).
  if (session.metadata?.userId !== String(user.id)) {
    res.status(403).json({ error: "This Checkout session does not belong to you." });
    return;
  }
  // Only act on a genuinely paid/complete session — never materialize an unpaid request.
  if (!(session.payment_status === "paid" || session.status === "complete")) {
    res.status(409).json({ error: "Payment is not complete yet." });
    return;
  }

  try {
    const result = await handleCheckoutSession(session, db);
    if (result.kind === "submission") {
      res.json({ kind: "submission", submission: result.submission });
      return;
    }
    if (result.kind === "upgrade") {
      res.json({ kind: "upgrade", facilityId: result.facilityId, upgraded: result.upgraded });
      return;
    }
    res.status(400).json({ error: "Unsupported Checkout session." });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Reconcile failed." });
  }
});

export default router;
