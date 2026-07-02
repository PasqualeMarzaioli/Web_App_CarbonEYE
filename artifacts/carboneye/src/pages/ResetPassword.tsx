/**
 * artifacts/carboneye/src/pages/ResetPassword.tsx — Password reset form that accepts a URL token, validates new password match, and redirects after successful update.
 * Author: Pasquale Marzaioli
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Navbar } from "../components/Navbar";
import { useAuth } from "../lib/auth";
import { useIsMobile } from "../hooks/use-mobile";

export function ResetPassword() {
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  useEffect(() => {
    if (!token) setError("Missing reset token.");
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Request failed");
      setLocation(data.role === "admin" ? "/admin" : "/portal");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />
      <div style={{ display: "flex", justifyContent: "center", padding: isMobile ? "32px 16px" : "60px 20px" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "var(--c-white)",
            border: "1px solid var(--c-border)",
            borderRadius: 16,
            padding: isMobile ? 20 : 32,
            boxShadow: "0 8px 32px rgba(27,122,46,0.08)",
          }}
        >
          <div className="section-title" style={{ marginBottom: 8 }}>
            CarbonEYE
          </div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "var(--c-text)",
              margin: "0 0 6px",
              letterSpacing: "-0.01em",
            }}
          >
            Choose a new password
          </h2>
          <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 22px" }}>
            Enter your new password below. The reset link is valid for 1 hour.
          </p>

          <form onSubmit={submit}>
            <div className="field">
              <label className="field-label">New password</label>
              <input
                className="field-input"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Confirm password</label>
              <input
                className="field-input"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <div className="alert alert-err" style={{ marginTop: 12 }}>{error}</div>}
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !token}
              style={{ marginTop: 18 }}
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>

          <div style={{ marginTop: 22, textAlign: "center", fontSize: 13, color: "var(--c-text-muted)" }}>
            <Link
              href="/login"
              style={{ color: "var(--c-green-mid)", fontWeight: 700, textDecoration: "none" }}
            >
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
