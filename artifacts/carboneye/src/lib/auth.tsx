/**
 * artifacts/carboneye/src/lib/auth.tsx — Authentication context provider managing login, registration, email verification, password reset, and session state via cookie-based auth.
 * Author: Pasquale Marzaioli
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  email: string;
  role: "user" | "admin";
  companyName: string | null;
  // Tier is no longer an account property (it lives on the facility as of DASHBOARD v3),
  // so it is intentionally absent here. The per-company tier comes from /api/monitoring.
  stripeCustomerId: string | null;
  emailVerified: boolean;
};

// Register no longer logs the user in — the account is pending email verification. The
// server returns this shape; in dev it also includes `verifyUrl` so the flow is testable
// without real email delivery.
export type RegisterResult = {
  pendingVerification: true;
  email: string;
  verifyUrl?: string;
};

// An Error carrying the server's machine-readable `code` (e.g. "EMAIL_NOT_VERIFIED") so
// the UI can branch — used by the login flow to offer a "resend verification" affordance.
export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string, companyName: string) => Promise<RegisterResult>;
  verifyEmail: (token: string) => Promise<AuthUser>;
  resendVerification: (email: string) => Promise<{ ok: true; verifyUrl?: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface the server-provided `code` on the thrown error so callers (e.g. login) can
    // detect EMAIL_NOT_VERIFIED and react, not just show a message.
    const payload = data as { error?: string; code?: string };
    throw new AuthError(payload.error ?? `Request failed (${res.status})`, payload.code);
  }
  return data as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    jsonFetch<AuthUser>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const u = await jsonFetch<AuthUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(u);
    return u;
  };

  // Register no longer sets the user / issues a session. It returns the pending-verification
  // result; the caller renders a "check your inbox" state.
  const register = async (email: string, password: string, companyName: string) => {
    return jsonFetch<RegisterResult>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, companyName }),
    });
  };

  // Confirm the email via the link token; the server auto-logs-in, so adopt the returned user.
  const verifyEmail = async (token: string) => {
    const u = await jsonFetch<AuthUser>(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    setUser(u);
    return u;
  };

  const resendVerification = async (email: string) => {
    return jsonFetch<{ ok: true; verifyUrl?: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, verifyEmail, resendVerification, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
