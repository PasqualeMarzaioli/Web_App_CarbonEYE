/**
 * api/vendor-bundles.d.ts — TypeScript ambient type declarations for esbuild-produced bundles, providing types for Express app and Stripe webhook handler imports without weakening strict mode.
 * Author: Pasquale Marzaioli
 */
// Ambient type declarations for the esbuild-produced bundles that the Vercel
// serverless functions in this directory import at runtime.
//
// The api-server build (artifacts/api-server/build.mjs) bundles the Express app
// and the Stripe handler with esbuild, which emits .mjs files but no .d.ts. With
// `strict` enabled, TypeScript resolves those .mjs files but, finding no types,
// raises TS7016 ("implicitly has an 'any' type"). These wildcard module
// declarations supply accurate types for the handful of exports the functions
// consume, so the build type-checks without weakening `strict`.
//
// The patterns end in the bundle's path suffix; the leading `*` matches the
// relative prefix (e.g. `../artifacts` or `../../artifacts`) from each function.
// Keep these signatures in sync with the real exports in
// artifacts/api-server/src/app.ts and
// artifacts/api-server/src/routes/webhooks/stripeHandler.ts.

declare module "*/api-server/dist/app.mjs" {
  // The Express application instance, callable as an (req, res) request handler.
  const app: (req: unknown, res: unknown) => void;
  export { app };
  export default app;
}

declare module "*/api-server/dist/stripeHandler.mjs" {
  // Verifies the raw Stripe webhook signature and processes the event.
  export function verifyAndHandleStripeWebhook(
    rawBody: Uint8Array | string,
    signature: string,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }>;

  // Polls in-flight Azure analyses and advances any that have completed.
  export function pollAnalysesWithDefaultDb(): Promise<{
    checked: number;
    results: Array<Record<string, unknown>>;
  }>;
}
