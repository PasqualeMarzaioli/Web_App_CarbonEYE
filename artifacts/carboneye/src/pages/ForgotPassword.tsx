/**
 * artifacts/carboneye/src/pages/ForgotPassword.tsx — Password recovery form that emails a reset link (or shows it in dev mode if email is unconfigured).
 * Author: Pasquale Marzaioli
 */
import { useState } from "react";
import { Link } from "wouter";
import { Navbar } from "../components/Navbar";
import { useIsMobile } from "../hooks/use-mobile";

export function ForgotPassword() {
  const isMobile = useIsMobile();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResetUrl(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Request failed");
      setSubmitted(true);
      if (data?.resetUrl) setResetUrl(data.resetUrl);
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
            maxWidth: 460,
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
            Forgot your password?
          </h2>
          <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 22px" }}>
            Enter your email and we'll send you a secure link to choose a new password.
          </p>

          {!submitted ? (
            <form onSubmit={submit}>
              <div className="field">
                <label className="field-label">Email</label>
                <input
                  className="field-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <div className="alert alert-err" style={{ marginTop: 12 }}>{error}</div>}
              <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: 18 }}>
                {loading ? "Generating link…" : "Send reset link"}
              </button>
            </form>
          ) : (
            <div>
              <div className="alert alert-ok" style={{ marginBottom: 16 }}>
                If the email is registered, a reset link has been sent.
              </div>
              {resetUrl ? (
                <div
                  style={{
                    padding: 14,
                    background: "var(--c-bg-page)",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "var(--c-text)",
                    lineHeight: 1.6,
                    wordBreak: "break-all",
                  }}
                >
                  <div style={{ marginBottom: 10, fontSize: 12, color: "var(--c-text-muted)" }}>
                    Email is not yet configured, so the link is shown here. It expires in 1 hour.
                  </div>
                  <a
                    href={resetUrl}
                    style={{ color: "var(--c-green-mid)", fontWeight: 700, textDecoration: "none" }}
                  >
                    {resetUrl}
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--c-text-muted)" }}>
                  Check your inbox to continue.
                </div>
              )}
            </div>
          )}

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
