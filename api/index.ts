/**
 * api/index.ts — Vercel serverless function entry point that routes all /api/* requests (except webhooks and cron tasks) to the bundled Express application.
 * Author: Pasquale Marzaioli
 */
// Vercel entry-point: all /api/* requests (except webhooks/stripe and cron/*)
// are dispatched to the existing Express app.

export const config = {
  api: { bodyParser: false }, // Express has its own body parser
};

type ExpressHandler = (r1: unknown, r2: unknown) => void;

let appPromise: Promise<ExpressHandler> | undefined;

async function loadApp(): Promise<ExpressHandler> {
  appPromise ??= import("../artifacts/api-server/dist/app.mjs").then(
    (mod) => mod.app as ExpressHandler,
  );
  return appPromise;
}

export default async function handler(req: unknown, res: unknown) {
  const app = await loadApp();
  return app(req, res);
}
