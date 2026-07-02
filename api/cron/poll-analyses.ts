/**
 * api/cron/poll-analyses.ts — Vercel serverless function endpoint that polls pending Azure emission analyses and advances completed ones, triggered on a cron schedule with optional secret-based authentication.
 * Author: Pasquale Marzaioli
 */
type VercelLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
};

declare const process: { env: Record<string, string | undefined> };

type VercelLikeResponse = {
  status(code: number): VercelLikeResponse;
  json(body: unknown): void;
};

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  // Vercel Cron sends header x-vercel-cron-signature; in production also verify
  // CRON_SECRET from env vars for security.
  if (process.env.CRON_SECRET && req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const mod = await import("../../artifacts/api-server/dist/stripeHandler.mjs");
  const result = await mod.pollAnalysesWithDefaultDb();
  return res.status(200).json(result);
}
