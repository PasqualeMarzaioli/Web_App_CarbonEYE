/**
 * api/webhooks/stripe.ts — Vercel serverless function that verifies raw Stripe webhook signatures and processes payment events using the bundled Stripe handler.
 * Author: Pasquale Marzaioli
 */
// Vercel serverless function: raw-body Stripe webhook. Stripe SDK is bundled
// inside artifacts/api-server/dist/stripeHandler.mjs so this file does NOT need
// its own package.json to declare "stripe" as a dep.

export const config = { api: { bodyParser: false } };

declare const Buffer: {
  concat(list: ReadonlyArray<Uint8Array>): Uint8Array;
};

type VercelLikeRequest = AsyncIterable<Uint8Array | string> & {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type VercelLikeResponse = {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
  end(): void;
};

async function readRawBody(req: VercelLikeRequest): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const signature = req.headers["stripe-signature"];
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!sig) return res.status(400).json({ error: "Missing stripe-signature" });

  let raw: Uint8Array;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    console.error("Failed to read raw body:", err);
    return res.status(400).json({ error: "Failed to read body" });
  }

  try {
    const mod = await import("../../artifacts/api-server/dist/stripeHandler.mjs");
    const result = await mod.verifyAndHandleStripeWebhook(raw, sig);
    if (result.ok) {
      return res.status(200).json({ received: true });
    }
    return res.status(result.status).json({ error: result.error });
  } catch (err) {
    console.error("Stripe handler error:", err);
    return res.status(500).json({ error: "Handler failed" });
  }
}
