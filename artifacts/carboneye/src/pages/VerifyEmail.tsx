/**
 * artifacts/carboneye/src/pages/VerifyEmail.tsx — Email verification landing page that processes signup tokens, auto-logs in on success, and offers resend on expiry.
 * Author: Pasquale Marzaioli
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Navbar } from "../components/Navbar";
import { useAuth } from "../lib/auth";
import { useIsMobile } from "../hooks/use-mobile";

// Landing page for the verification link emailed at signup. Reads ?token=…, calls
// verifyEmail() on mount, and on success auto-logs-in (the server issues a session) and
// redirects to the portal. On an invalid/expired token it offers a resend affordance.
export function VerifyEmail() {
  const { verifyEmail, resendVerification } = useAuth();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resend, setResend] = useState<{ loading: boolean; message: string | null; devUrl: string | null }>({
    loading: false,
    message: null,
    devUrl: null,
  });

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }, []);

  // Guard against React 18 StrictMode double-invoke: verify only once. The token is
  // single-use server-side, so a second call would always report INVALID_TOKEN.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!token) {
      setStatus("error");
      setErrorMsg("Missing verification token.");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setStatus("success");
        // Brief beat so the user sees the success state before the redirect.
        setTimeout(() => setLocation("/portal"), 900);
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Verification failed.");
      });
  }, [token, verifyEmail, setLocation]);

  const doResend = async () => {
    if (!email.trim()) {
      setResend({ loading: false, message: "Enter your email to resend.", devUrl: null });
      return;
    }
    setResend({ loading: true, message: null, devUrl: null });
    try {
      const res = await resendVerification(email.trim());
      setResend({
        loading: false,
        message: "If that account needs verification, a new link has been sent.",
        devUrl: res.verifyUrl ?? null,
      });
    } catch (err) {
      setResend({
        loading: false,
        message: err instanceof Error ? err.message : String(err),
        devUrl: null,
      });
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

          {status === "verifying" && (
            <>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: "var(--c-text)", margin: "0 0 6px" }}>
                Verifying your email…
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: 0 }}>
                One moment while we confirm your verification link.
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: "var(--c-green-dark)", margin: "0 0 6px" }}>
                Email verified ✓
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: 0 }}>
                Your account is active. Taking you to your portal…
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: "var(--c-text)", margin: "0 0 6px" }}>
                Verification failed
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 18px", lineHeight: 1.6 }}>
                {errorMsg ?? "This verification link is invalid or has expired."} Enter your
                email below to receive a fresh link.
              </p>
              <div className="field">
                <label className="field-label">Email</label>
                <input
                  className="field-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="button" className="btn-primary" onClick={doResend} disabled={resend.loading}>
                {resend.loading ? "Sending…" : "Resend verification"}
              </button>
              {resend.message && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--c-text-muted)" }}>{resend.message}</div>
              )}
              {resend.devUrl && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    background: "var(--c-bg-page)",
                    borderRadius: 8,
                    fontSize: 13,
                    lineHeight: 1.6,
                    wordBreak: "break-all",
                  }}
                >
                  <div style={{ marginBottom: 10, fontSize: 12, color: "var(--c-text-muted)" }}>
                    Email delivery is not configured here, so the verification link is shown
                    below. It expires in 24 hours.
                  </div>
                  <a href={resend.devUrl} style={{ color: "var(--c-green-mid)", fontWeight: 700, textDecoration: "none" }}>
                    {resend.devUrl}
                  </a>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 22, textAlign: "center", fontSize: 13, color: "var(--c-text-muted)" }}>
            <Link href="/login" style={{ color: "var(--c-green-mid)", fontWeight: 700, textDecoration: "none" }}>
              ← Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
