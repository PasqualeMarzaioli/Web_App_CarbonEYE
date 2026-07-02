/**
 * artifacts/api-server/src/routes/webhooks/stripe.ts — Stripe webhook receiver that verifies signatures and dispatches events to the handler.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { STRIPE_WEBHOOK_SECRET, stripe } from "../../lib/stripe";
import { logger } from "../../lib/logger";
import { handleStripeWebhook } from "./stripeHandler";

const router: IRouter = Router();

router.post("/", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).send("Missing Stripe signature.");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Stripe signature verification failed");
    res.status(400).send("Invalid Stripe signature.");
    return;
  }

  try {
    await handleStripeWebhook(event, db);
    res.json({ received: true });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Stripe webhook handling failed");
    res.status(500).json({ error: "Stripe webhook handling failed." });
  }
});

export default router;
