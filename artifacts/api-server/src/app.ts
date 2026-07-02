/**
 * artifacts/api-server/src/app.ts — Express application setup with CORS, session middleware, webhook routing for Stripe, and static file serving for the frontend.
 * Author: Pasquale Marzaioli
 */
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import stripeWebhookRouter from "./routes/webhooks/stripe";
import { logger } from "./lib/logger";
import { loadSession } from "./lib/auth";

export const app: Express = express();
app.set("trust proxy", 1);

// Operational guard: in production the email verification gate has no dev `verifyUrl`
// escape hatch, so a missing RESEND_API_KEY would leave every new non-admin user unable to
// verify and permanently locked out. Warn loudly at startup so this is caught before users are.
if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) {
  logger.warn(
    "RESEND_API_KEY is not set in production — verification and password-reset emails will NOT " +
      "be sent, which locks out new non-admin signups. Configure RESEND_API_KEY.",
  );
}
const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const staticDir = path.join(currentDir, "static");
const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3001";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, res, next) => {
  const allowedHosts = new Set(
    [publicUrl, `https://${req.get("host")}`, `https://${req.get("x-forwarded-host")}`]
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value as string).host;
        } catch {
          return null;
        }
      })
      .filter((value): value is string => Boolean(value)),
  );

  return cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      try {
        if (allowedHosts.has(new URL(origin).host)) {
          callback(null, true);
          return;
        }
      } catch {
        /* fall through to the rejection below */
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })(req, res, next);
});
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRouter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(loadSession);

app.use("/api", router);

app.use(express.static(staticDir, { maxAge: "1h" }));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

export default app;
