/**
 * artifacts/api-server/src/lib/stripe.ts — Initializes Stripe client with production credentials and exports pricing IDs for Basic and Premium subscription tiers.
 * Author: Pasquale Marzaioli
 */
import Stripe from "stripe";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} must be set before starting the API server.`);
  }
  return value;
}

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2026-04-22.dahlia",
});

// Upgrades no longer use a standalone "delta" price — the upgrade endpoint
// swaps the user's Basic subscription item to the Premium price and lets
// Stripe compute the prorated difference. Only the two real recurring prices
// stay wired here.
export const PRICE_IDS = {
  basic: requireEnv("STRIPE_PRICE_BASIC"),
  premium: requireEnv("STRIPE_PRICE_PREMIUM"),
};

// The post-payment success/cancel redirect URLs are NOT read from env anymore.
// A hard-coded STRIPE_SUCCESS_URL (e.g. a stale "http://localhost:3000/...")
// silently sent paying users to an unreachable host and, because the success
// page never loaded, the /checkout/reconcile safety net never ran and no
// submission was created. The Checkout routes now build these URLs from the
// incoming request origin (see routes/checkout.ts), so they always match the
// deployment the user is actually on — production, preview, or localhost.

export const STRIPE_WEBHOOK_SECRET = requireEnv("STRIPE_WEBHOOK_SECRET");
