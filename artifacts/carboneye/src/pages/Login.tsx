/**
 * artifacts/carboneye/src/pages/Login.tsx — Combined login and registration form with email verification workflow, resend affordances, and dev-mode verification link display.
 * Author: Pasquale Marzaioli
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Navbar } from "../components/Navbar";
import { useAuth, AuthError } from "../lib/auth";
import { useIsMobile } from "../hooks/use-mobile";

export function Login() {
  const { login, register, resendVerification } = useAuth();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<"login" | "register">("login");
  // After a successful registration we swap the form for a "check your inbox" panel.
  const [view, setView] = useState<"form" | "checkInbox">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The server's machine-readable error code (e.g. EMAIL_NOT_VERIFIED) drives the inline
  // "resend verification" affordance on the login form.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Dev-only: the API returns the verification link outside production so the flow is
  // testable without real email delivery. Shown in the check-inbox panel when present.
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  const [resend, setResend] = useState<{ loading: boolean; message: string | null }>({
    loading: false,
    message: null,
  });

  // Switching between sign-in and register resets the transient verification state.
  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setView("form");
    setError(null);
    setErrorCode(null);
    setConfirmPassword("");
    setDevVerifyUrl(null);
    setResend({ loading: false, message: null });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    // Client-side guards for register (mirrors ResetPassword's confirm check).
    if (mode === "register") {
      if (!companyName.trim()) {
        setError("Company name is required.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const user = await login(email, password);
        setLocation(user.role === "admin" ? "/admin" : "/portal");
      } else {
        // Register no longer logs in — show the "check your inbox" panel instead.
        const result = await register(email, password, companyName.trim());
        setDevVerifyUrl(result.verifyUrl ?? null);
        setView("checkInbox");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof AuthError && err.code) setErrorCode(err.code);
    } finally {
      setLoading(false);
    }
  };

  // Re-send the verification email. Shared by the login EMAIL_NOT_VERIFIED affordance and
  // the check-inbox panel's "Resend" button.
  const doResend = async () => {
    setResend({ loading: true, message: null });
    try {
      const res = await resendVerification(email);
      setDevVerifyUrl(res.verifyUrl ?? null);
      setResend({ loading: false, message: "Verification email sent — check your inbox." });
    } catch (err) {
      setResend({ loading: false, message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Reusable block showing the dev-only verification link (mirrors ForgotPassword's resetUrl).
  const devLinkBlock = devVerifyUrl ? (
    <div
      style={{
        marginTop: 14,
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
        Email delivery is not configured in this environment, so the verification link is
        shown here. It expires in 24 hours.
      </div>
      <a href={devVerifyUrl} style={{ color: "var(--c-green-mid)", fontWeight: 700, textDecoration: "none" }}>
        {devVerifyUrl}
      </a>
    </div>
  ) : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: isMobile ? "32px 16px" : "60px 20px",
        }}
      >
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

          {view === "checkInbox" ? (
            // Post-registration: no session, awaiting email confirmation.
            <div>
              <h2
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--c-text)",
                  margin: "0 0 6px",
                  letterSpacing: "-0.01em",
                }}
              >
                Check your inbox
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 18px", lineHeight: 1.6 }}>
                We sent a verification link to <strong>{email}</strong>. Click it to activate
                your account, then sign in. The link expires in 24 hours.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={doResend}
                disabled={resend.loading}
              >
                {resend.loading ? "Sending…" : "Resend email"}
              </button>
              {resend.message && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--c-text-muted)" }}>{resend.message}</div>
              )}
              {devLinkBlock}
              <div style={{ marginTop: 22, textAlign: "center", fontSize: 13, color: "var(--c-text-muted)" }}>
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--c-green-mid)",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ← Back to sign in
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--c-text)",
                  margin: "0 0 6px",
                  letterSpacing: "-0.01em",
                }}
              >
                {mode === "login" ? "Sign in to your account" : "Create your account"}
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 22px" }}>
                {mode === "login"
                  ? "Access your dashboard or, if admin, the verification console."
                  : "Register your company to submit data and request verified certificates."}
              </p>

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
                <div className="field">
                  <label className="field-label">Password</label>
                  <input
                    className="field-input"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {mode === "register" && (
                  <>
                    <div className="field">
                      <label className="field-label">Confirm password</label>
                      <input
                        className="field-input"
                        type="password"
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">Company name</label>
                      <input
                        className="field-input"
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                    </div>
                  </>
                )}
                {error && <div className="alert alert-err" style={{ marginTop: 12 }}>{error}</div>}
                {/* Inline resend affordance when login is blocked by the verification gate. */}
                {errorCode === "EMAIL_NOT_VERIFIED" && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={doResend}
                      disabled={resend.loading}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--c-green-mid)",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        padding: 0,
                        textDecoration: "underline",
                      }}
                    >
                      {resend.loading ? "Sending…" : "Resend verification email"}
                    </button>
                    {resend.message && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--c-text-muted)" }}>{resend.message}</div>
                    )}
                    {devLinkBlock}
                  </div>
                )}
                <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: 18 }}>
                  {loading
                    ? mode === "login"
                      ? "Signing in…"
                      : "Creating account…"
                    : mode === "login"
                      ? "Sign In"
                      : "Create Account"}
                </button>
              </form>

              {mode === "login" && (
                <div style={{ marginTop: 12, textAlign: "right" }}>
                  <Link
                    href="/forgot-password"
                    style={{
                      fontSize: 12,
                      color: "var(--c-green-mid)",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

              <div
                style={{
                  marginTop: 22,
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--c-text-muted)",
                }}
              >
                {mode === "login" ? (
                  <>
                    Don't have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--c-green-mid)",
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Register
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("login")}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--c-green-mid)",
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, textAlign: "center" }}>
            <Link
              href="/"
              style={{
                fontSize: 12,
                color: "var(--c-text-light)",
                textDecoration: "none",
              }}
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
