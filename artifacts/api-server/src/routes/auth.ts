/**
 * artifacts/api-server/src/routes/auth.ts — Authentication endpoints including registration, login, email verification, password reset, and session management with rate limiting and admin email parsing.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { issueSession, clearSession, requireAuth } from "../lib/auth";
import { parseAdminEmails, sendVerificationEmail, sendPasswordResetEmail } from "../lib/mailer";

const router: IRouter = Router();
const RESET_TOKEN_TTL_MS = 1000 * 60 * 60;
// Email-verification links are valid for 24 hours (feature 2).
const VERIFY_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

// ── Per-IP rate limiter for the sensitive auth endpoints ────────────────────────────
// Unauthenticated POSTs here are brute-force (login), account-enumeration / email-spam
// (forgot-password, resend-verification, register) vectors, so they must be throttled.
// Simple in-memory fixed-window counter keyed on client IP (the app sets `trust proxy`,
// so req.ip is the real client). Process-local — good enough for a single App Service /
// serverless instance; a distributed limiter would need a shared store.
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20);
const authBuckets = new Map<string, { count: number; resetAt: number }>();

function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const current = authBuckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS } : current;

  if (bucket.count >= AUTH_RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many attempts. Please try again later.", retryAfterSeconds: retryAfter });
    return;
  }

  bucket.count += 1;
  authBuckets.set(key, bucket);
  next();
}

// Dev/test escape hatch: outside production we return the verification link in the API
// response (mirroring forgot-password returning resetUrl) so the signup→verify→login flow
// is testable without real email delivery. In production the link is ONLY emailed — never
// returned — because proving inbox ownership is the entire point of the gate.
const isDev = process.env.NODE_ENV !== "production";

function publicUser(user: typeof usersTable.$inferSelect) {
  // Tier is no longer an account property (it lives on the facility as of DASHBOARD v3),
  // so it is intentionally NOT exposed here. users.stripe_customer_id stays in use.
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    companyName: user.companyName,
    stripeCustomerId: user.stripeCustomerId,
    emailVerified: user.emailVerified,
  };
}

router.post("/auth/register", authRateLimit, async (req, res) => {
  const { email, password, companyName } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Invalid email or password (min 6 chars)" });
    return;
  }
  // Company name is now REQUIRED (feature 2): a verified ESG certificate is issued to a
  // named company, so we must capture it at signup rather than leaving it optional.
  if (typeof companyName !== "string" || !companyName.trim()) {
    res.status(400).json({ error: "Company name is required" });
    return;
  }
  const normalized = email.trim().toLowerCase();

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalized));
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Share the exact admin-email parsing with the mailer (feature 3) via parseAdminEmails.
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  const role = adminEmails.includes(normalized) ? "admin" : "user";

  // New accounts must verify their email before they can log in. Founders/admins skip the
  // gate (emailVerified:true) so a Resend misconfiguration can never lock the team out.
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalized,
      passwordHash,
      role,
      companyName: companyName.trim(),
      emailVerified: role === "admin",
      emailVerificationToken: role === "admin" ? null : token,
      emailVerificationTokenExpiresAt: role === "admin" ? null : expiresAt,
    })
    .returning();

  // Same origin derivation as forgot-password: prefer the browser Origin header, fall back
  // to the proxied host (the app sets `trust proxy`, so req.protocol honours x-forwarded-proto).
  const origin = (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.get("host")}`;
  const verifyUrl = `${origin.replace(/\/$/, "")}/verify-email?token=${token}`;

  if (role !== "admin") {
    // Best-effort send — mailer never throws and returns a boolean. Capture it so the log
    // reflects reality: `sent:false` when RESEND_API_KEY is unset or Resend rejected (the
    // dev verifyUrl below still covers testing in that case).
    const sent = await sendVerificationEmail(normalized, verifyUrl);
    req.log?.info({ email: normalized, sent }, "Verification email send attempted (best-effort)");
  }

  // Do NOT issue a session: the account is pending verification. The client shows a
  // "check your inbox" state. Admins are verified immediately but still must sign in.
  res.json({
    ok: true,
    pendingVerification: true,
    email: normalized,
    // Dev-only: lets local testing complete the flow without a real mailbox.
    ...(isDev && role !== "admin" ? { verifyUrl } : {}),
  });
});

router.post("/auth/login", authRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  // Email-verification gate: block login until the address is confirmed. The client reads
  // `code` to offer a "resend verification" affordance. Checked AFTER the password so we
  // never reveal verification state for a wrong password.
  if (!user.emailVerified) {
    res.status(403).json({
      error: "Please verify your email before signing in.",
      code: "EMAIL_NOT_VERIFIED",
    });
    return;
  }
  issueSession(res, { userId: user.id, email: user.email, role: user.role as "user" | "admin" });
  res.json(publicUser(user));
});

// GET /auth/verify-email?token=... — confirms an email and auto-logs-in. Single-use: the
// token is cleared on success so a replayed link returns INVALID_TOKEN.
router.get("/auth/verify-email", async (req, res) => {
  const token = req.query.token;
  if (typeof token !== "string" || !token) {
    res.status(400).json({ error: "Verification token is required", code: "INVALID_TOKEN" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.emailVerificationToken, token),
        gt(usersTable.emailVerificationTokenExpiresAt, new Date()),
      ),
    );

  if (!user) {
    res.status(400).json({ error: "Verification link is invalid or has expired", code: "INVALID_TOKEN" });
    return;
  }

  await db
    .update(usersTable)
    .set({ emailVerified: true, emailVerificationToken: null, emailVerificationTokenExpiresAt: null })
    .where(eq(usersTable.id, user.id));

  // Auto-login on verify: the user clicked their own link, so issue a session immediately.
  issueSession(res, { userId: user.id, email: user.email, role: user.role as "user" | "admin" });
  res.json(publicUser({ ...user, emailVerified: true }));
});

// POST /auth/resend-verification — re-sends the verification link. ALWAYS responds
// 200 { ok: true } to avoid account enumeration; only does real work when an unverified
// user exists. In dev it also returns the fresh verifyUrl so the resend flow is testable.
router.post("/auth/resend-verification", authRateLimit, async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Email required" });
    return;
  }
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized));

  let verifyUrl: string | null = null;
  if (user && !user.emailVerified) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    await db
      .update(usersTable)
      .set({ emailVerificationToken: token, emailVerificationTokenExpiresAt: expiresAt })
      .where(eq(usersTable.id, user.id));

    const origin = (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.get("host")}`;
    verifyUrl = `${origin.replace(/\/$/, "")}/verify-email?token=${token}`;
    await sendVerificationEmail(normalized, verifyUrl);
  }

  res.json({ ok: true, ...(isDev && verifyUrl ? { verifyUrl } : {}) });
});

router.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Email required" });
    return;
  }
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalized));

  let resetUrl: string | null = null;
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await db
      .update(usersTable)
      .set({ resetToken: token, resetTokenExpiresAt: expiresAt })
      .where(eq(usersTable.id, user.id));

    const origin = (req.headers.origin as string | undefined) ?? `${req.protocol}://${req.get("host")}`;
    resetUrl = `${origin.replace(/\/$/, "")}/reset-password?token=${token}`;
    // Best-effort email send (mirrors register → sendVerificationEmail). The token is the
    // proof of inbox ownership, so it must travel ONLY via email in production — never in
    // the response or the log. Log the attempt outcome, not the URL.
    const sent = await sendPasswordResetEmail(normalized, resetUrl);
    req.log?.info({ email: normalized, sent }, "Password reset email send attempted (best-effort)");
  }

  // Always respond the same way to avoid account enumeration. The resetUrl is returned
  // ONLY in dev (no real mailbox) — never in production, where leaking it would let any
  // caller take over any account.
  res.json({
    ok: true,
    message: "If the email exists, a reset link has been sent.",
    ...(isDev && resetUrl ? { resetUrl } : {}),
  });
});

router.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== "string" || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Invalid token or password (min 6 chars)" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.resetToken, token), gt(usersTable.resetTokenExpiresAt, new Date())));

  if (!user) {
    res.status(400).json({ error: "Reset link is invalid or has expired" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db
    .update(usersTable)
    .set({ passwordHash, resetToken: null, resetTokenExpiresAt: null })
    .where(eq(usersTable.id, user.id));

  issueSession(res, { userId: user.id, email: user.email, role: user.role as "user" | "admin" });
  res.json(publicUser(user));
});

router.post("/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session!.userId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  res.json(publicUser(user));
});

export default router;
