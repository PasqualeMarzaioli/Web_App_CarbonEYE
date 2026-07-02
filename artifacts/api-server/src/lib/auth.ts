/**
 * artifacts/api-server/src/lib/auth.ts — Manages JWT session tokens, cookie issuance/clearing, and Express middleware for authentication and admin role enforcement.
 * Author: Pasquale Marzaioli
 */
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// The JWT signing key. In production it MUST be provided — falling back to a known
// constant would let anyone forge a session cookie (including role:"admin"), so we fail
// fast at startup instead. Outside production the dev fallback keeps local runs frictionless.
function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Refusing to start in production with an insecure default " +
        "signing key (it would allow forged admin sessions). Set SESSION_SECRET to a long random value.",
    );
  }
  return "dev-insecure-secret-change-me";
}

const SECRET = resolveSessionSecret();
const COOKIE_NAME = "ce_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export type SessionPayload = {
  userId: number;
  email: string;
  role: "user" | "admin";
};

export function issueSession(res: Response, payload: SessionPayload) {
  const token = jwt.sign(payload, SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, SECRET) as SessionPayload;
    req.session = decoded;
  } catch {
    /* ignore invalid token */
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.session.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
