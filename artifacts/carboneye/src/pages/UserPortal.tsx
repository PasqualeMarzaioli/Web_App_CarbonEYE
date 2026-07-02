/**
 * artifacts/carboneye/src/pages/UserPortal.tsx — Main user dashboard with tabs for submissions (create/list/detail), monitoring (lazy-loaded), and billing; Stripe checkout post-payment reconciliation.
 * Author: Pasquale Marzaioli
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "../components/Navbar";
import { useAuth } from "../lib/auth";
import {
  confirmCheckoutSession,
  deleteSubmission,
  documentDownloadUrl,
  findPreviousPrediction,
  getSubmission,
  listSubmissions,
  startSubmissionCheckout,
  uploadDocuments,
  type Submission,
  type SubmissionDetail,
} from "../lib/submissions";
import { SatellitePanel } from "../components/SatellitePanel";
import { IotPanel } from "../components/IotPanel";
import { CompliancePanel } from "../components/CompliancePanel";
import { AnomaliesPanel } from "../components/AnomaliesPanel";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

type PortalTab = "submissions" | "monitoring" | "subscriptions";
type PlanTier = "basic" | "premium";

// Display label per portal tab (the tab switcher renders these directly).
const TAB_LABELS: Record<PortalTab, string> = {
  submissions: "📋 Submissions",
  monitoring: "📡 Monitoring",
  subscriptions: "💳 Billing",
};

const Certificate = lazy(() =>
  import("../components/Certificate").then((m) => ({ default: m.Certificate })),
);
const MonitoringTab = lazy(() =>
  import("../components/MonitoringTab").then((m) => ({ default: m.MonitoringTab })),
);
const BillingTab = lazy(() =>
  import("../components/BillingTab").then((m) => ({ default: m.BillingTab })),
);

function LazyPanelFallback() {
  return <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>Loading...</div>;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "#fffbf0", color: "#b7791f", label: "Pending review" },
  analyzing: { bg: "#eef4ff", color: "#3b5bdb", label: "Analysis in progress" },
  // analysis_failed is an internal retry state — the CarbonEYE team re-runs it.
  // The customer simply sees their submission is still being handled.
  analysis_failed: { bg: "#e8f4fd", color: "#0984e3", label: "In review" },
  in_review: { bg: "#e8f4fd", color: "#0984e3", label: "In review" },
  certified: { bg: "#e6f7ec", color: "#1a7a2e", label: "✓ Certified" },
  rejected: { bg: "#fff0f0", color: "#d63031", label: "Rejected" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 6,
      }}
    >
      {s.label}
    </span>
  );
}

function StatTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent?: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div className="section-title" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? "var(--c-text)", lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--c-text-light)", marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

function planName(tier: PlanTier): string {
  return tier === "premium" ? "Premium" : "Basic";
}

// The plan is chosen PER SUBMISSION now (tier lives on the facility, not the account),
// so the Basic/Premium radio is shown on every new request — there is no account-level
// "your plan" shortcut. Upgrades happen per-company from the MonitoringTab.
function PlanSelector({
  selectedTier,
  onSelectedTierChange,
}: {
  selectedTier: PlanTier;
  onSelectedTierChange: (tier: PlanTier) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <fieldset
      style={{
        border: "1px solid var(--c-border)",
        borderRadius: 10,
        padding: 14,
        margin: "0 0 18px",
      }}
    >
      <legend className="field-label" style={{ padding: "0 6px" }}>
        Choose your plan
      </legend>
      <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 10 }}>
        {(["basic", "premium"] as PlanTier[]).map((tier) => {
          const active = selectedTier === tier;
          return (
            <label
              key={tier}
              style={{
                display: "block",
                border: `2px solid ${active ? "var(--c-green-mid)" : "var(--c-border)"}`,
                background: active ? "#e6f7ec" : "var(--c-white)",
                borderRadius: 10,
                padding: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="plan"
                value={tier}
                checked={active}
                required
                onChange={() => onSelectedTierChange(tier)}
                style={{ marginRight: 8 }}
              />
              <span style={{ fontWeight: 700, color: "var(--c-text)" }}>{planName(tier)}</span>
              <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 6, lineHeight: 1.4 }}>
                {tier === "premium"
                  ? "Certificate plus continuous daily monitoring."
                  : "One verified ESG certificate with the baseline dashboard."}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function PaymentNotice({
  notice,
  onDismiss,
}: {
  notice: { tone: "success" | "cancelled"; message: string } | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  const success = notice.tone === "success";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: success ? "#f0faf4" : "#fff7e6",
        border: `1px solid ${success ? "#a8d5b5" : "#fdcb6e"}`,
        borderRadius: 10,
        color: success ? "#1a6b3c" : "#7a5a00",
        padding: "12px 14px",
        marginBottom: 18,
        fontSize: 13,
      }}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontWeight: 800,
          fontSize: 16,
          lineHeight: 1,
        }}
        aria-label="Dismiss payment notice"
      >
        x
      </button>
    </div>
  );
}

function SingleSubmissionForm({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [companyName, setCompanyName] = useState(user?.companyName ?? "");
  const [industry, setIndustry] = useState("");
  const [lat, setLat] = useState(42.0);
  const [lon, setLon] = useState(11.0);
  const [notes, setNotes] = useState("");
  const [selectedTier, setSelectedTier] = useState<PlanTier>("basic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Tier is chosen per request (per facility) — always send the radio selection.
      const checkout = await startSubmissionCheckout({
        companyName: companyName.trim(),
        industry: industry || undefined,
        lat,
        lon,
        notes: notes || undefined,
        tier: selectedTier,
      });
      window.location.href = checkout.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 14 }}>
        <div className="field">
          <label className="field-label">Company name</label>
          <input
            className="field-input"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field-label">Industry</label>
          <input
            className="field-input"
            placeholder="e.g. Renewable Energy"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">Latitude</label>
          <input
            className="field-input"
            type="number"
            step="0.0001"
            min={-90}
            max={90}
            value={lat}
            onChange={(e) => setLat(Number(e.target.value))}
            required
          />
        </div>
        <div className="field">
          <label className="field-label">Longitude</label>
          <input
            className="field-input"
            type="number"
            step="0.0001"
            min={-180}
            max={180}
            value={lon}
            onChange={(e) => setLon(Number(e.target.value))}
            required
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label">Notes for reviewer</label>
        <textarea
          className="field-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ fontFamily: "inherit", resize: "vertical" }}
        />
      </div>

      <PlanSelector
        selectedTier={selectedTier}
        onSelectedTierChange={setSelectedTier}
      />

      {error && <div className="alert alert-err">{error}</div>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Opening Stripe..." : "Proceed to payment"}
      </button>
    </form>
  );
}


function SubmissionRow({
  s,
  onOpen,
  onDeleted,
}: {
  s: Submission;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canDelete = s.status !== "certified";

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDelete) return;
    if (!window.confirm(
      `Delete submission #${s.id} for "${s.companyName}"? This cannot be undone.`,
    )) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteSubmission(s.id);
      onDeleted();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      style={{
        textAlign: "left",
        background: "var(--c-bg-page)",
        border: "1px solid var(--c-border)",
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.companyName}
          </span>
          <StatusBadge status={s.status} />
        </div>
        <div style={{ fontSize: 11, color: "var(--c-text-light)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
          #{s.id} · {new Date(s.createdAt).toLocaleDateString()}
        </div>
        {err && (
          <div style={{ fontSize: 11, color: "var(--c-danger)", marginTop: 4 }}>{err}</div>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="Delete this submission"
          aria-label={`Delete submission ${s.id}`}
          style={{
            background: "transparent",
            border: "1px solid transparent",
            color: "var(--c-text-light)",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 16,
            lineHeight: 1,
            cursor: busy ? "wait" : "pointer",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#ffe6e6";
            e.currentTarget.style.borderColor = "#f5b7b1";
            e.currentTarget.style.color = "#a8141d";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.color = "var(--c-text-light)";
          }}
        >
          {busy ? "…" : "🗑"}
        </button>
      )}
    </div>
  );
}

function NewSubmissionCard({ onCreated }: { onCreated: () => void }) {
  return (
    <div
      style={{
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 14,
        padding: 24,
        boxShadow: "0 4px 16px rgba(27,122,46,0.06)",
      }}
    >
      <div className="section-title" style={{ marginBottom: 4 }}>New Submission</div>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: "var(--c-text)", margin: "0 0 14px" }}>
        Request your ESG certificate
      </h3>

      <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: "0 0 18px", lineHeight: 1.5 }}>
        One certificate request covers a single facility (one site, one set of coordinates).
        To monitor more than one site, submit a separate request per facility.
      </p>

      <SingleSubmissionForm onCreated={onCreated} />
    </div>
  );
}

function SubmissionDetailView({
  submission,
  onClose,
  onDeleted,
  allSubmissions = [],
}: {
  submission: SubmissionDetail;
  onClose: () => void;
  onDeleted: () => void;
  allSubmissions?: Submission[];
}) {
  const isMobile = useIsMobile();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState(submission.documents);

  const canDelete = submission.status !== "certified";

  const upload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newDocs = await uploadDocuments(submission.id, files);
      setDocs((d) => [...newDocs, ...d]);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!canDelete) return;
    if (!window.confirm(
      `Delete submission #${submission.id} for "${submission.companyName}"? This cannot be undone.`,
    )) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSubmission(submission.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  const cert = submission.certificate;

  return (
    <div
      style={{
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 14,
        padding: 24,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="section-title">
            Submission #{submission.id}
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 8px" }}>
            {submission.companyName}
          </h3>
          <StatusBadge status={submission.status} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canDelete && (
            <button
              onClick={remove}
              disabled={deleting}
              title="Permanently delete this submission"
              style={{
                background: "white",
                border: "1px solid #f5b7b1",
                color: "#a8141d",
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: deleting ? "wait" : "pointer",
              }}
            >
              {deleting ? "Deleting…" : "✗ Delete"}
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: "var(--c-bg-page)",
              border: "1px solid var(--c-border)",
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "repeat(4, 1fr)", "repeat(2, 1fr)"), gap: 12, marginTop: 18 }}>
        <div className="tile">
          <div className="tile-label">Industry</div>
          <div className="tile-value" style={{ fontSize: 14 }}>{submission.industry ?? "—"}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Latitude</div>
          <div className="tile-value" style={{ fontSize: 14 }}>{submission.lat.toFixed(4)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Longitude</div>
          <div className="tile-value" style={{ fontSize: 14 }}>{submission.lon.toFixed(4)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Submitted</div>
          <div className="tile-value" style={{ fontSize: 14 }}>
            {new Date(submission.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      {submission.notes && (
        <div style={{ marginTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 6 }}>Notes</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--c-text-muted)",
              background: "var(--c-bg-page)",
              padding: 12,
              borderRadius: 8,
              whiteSpace: "pre-wrap",
            }}
          >
            {submission.notes}
          </div>
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Documents</div>
        {docs.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>No documents uploaded yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {docs.map((d) => (
              <a
                key={d.id}
                href={documentDownloadUrl(submission.id, d.id)}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--c-bg-page)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "var(--c-text)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)" }}>{d.filename}</span>
                <span style={{ color: "var(--c-text-light)", fontSize: 11 }}>
                  {(d.sizeBytes / 1024).toFixed(1)} KB · {d.mimeType}
                </span>
              </a>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            style={{ fontSize: 12, flex: 1 }}
          />
          <button
            type="button"
            onClick={upload}
            disabled={uploading || files.length === 0}
            className="btn-primary"
            style={{ width: "auto", padding: "10px 18px" }}
          >
            {uploading ? "Uploading…" : `Upload ${files.length || ""}`}
          </button>
        </div>
        {error && <div className="alert alert-err">{error}</div>}
      </div>

      {cert && (
        <div style={{ marginTop: 26 }}>
          <div className="section-title" style={{ marginBottom: 12 }}>Official Certificate</div>
          <Suspense fallback={<LazyPanelFallback />}>
            <Certificate
              company={submission.companyName}
              prediction={cert}
              previous={findPreviousPrediction(allSubmissions, submission)}
            />
          </Suspense>
          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Underlying analysis</div>
            {cert.ndvi_mean != null && <SatellitePanel p={cert} />}
            {cert.iot_co2_mean != null && <IotPanel p={cert} />}
            <div className="two-col">
              {cert.anomalies && <AnomaliesPanel p={cert} />}
              {cert.compliance && <CompliancePanel p={cert} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function UserPortal() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [portalTab, setPortalTab] = useState<PortalTab>("submissions");
  const [paymentNotice, setPaymentNotice] = useState<{ tone: "success" | "cancelled"; message: string } | null>(null);

  const submissionsQuery = useQuery({
    queryKey: ["portal", "submissions"],
    queryFn: listSubmissions,
  });
  const selectedQuery = useQuery({
    queryKey: ["portal", "submission", selectedId],
    queryFn: () => getSubmission(selectedId!),
    enabled: selectedId != null,
  });
  const submissions = submissionsQuery.data ?? [];
  const selected = selectedQuery.data ?? null;
  const loading = submissionsQuery.isLoading;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portal", "submissions"] });

  // Post-payment handler (also covers the per-facility upgrade, which uses the same
  // success URL). Fixes "paid but the certificate request doesn't appear": we read the
  // Stripe Checkout session_id and reconcile it synchronously, so the submission (or
  // upgrade) materializes even if the webhook is slow/unreachable in this environment,
  // then refetch with a short poll as a belt-and-braces fallback for a delayed webhook.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");

    if (payment === "cancelled") {
      setPaymentNotice({
        tone: "cancelled",
        message: "Payment was cancelled. No submission was created.",
      });
    } else if (payment === "success" || sessionId) {
      setPaymentNotice({
        tone: "success",
        message: "Payment confirmed — finalizing your request…",
      });
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const refetchSubs = () => queryClient.refetchQueries({ queryKey: ["portal", "submissions"] });
      void (async () => {
        if (sessionId) {
          try {
            // Materialize synchronously (idempotent server-side). If this succeeds the
            // request is already in the DB before the first refetch below.
            await confirmCheckoutSession(sessionId);
          } catch {
            // Ignore — fall back to the polling loop in case the webhook lands shortly.
          }
        }
        await refetchSubs();
        // Poll ~5 times over ~15s as a fallback for a delayed webhook.
        for (let i = 0; i < 5; i++) {
          const current = queryClient.getQueryData<Submission[]>(["portal", "submissions"]) ?? [];
          const found = sessionId
            ? current.some((s) => s.stripeSessionId === sessionId)
            : current.length > 0;
          if (found) break;
          await sleep(3000);
          await refetchSubs();
        }
        setPaymentNotice({
          tone: "success",
          message: "Payment confirmed. Your request now appears below.",
        });
      })();
    }

    if (payment || sessionId) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // Run once on mount; queryClient is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const pending = submissions.filter((s) => s.status === "pending").length;
    const inReview = submissions.filter((s) => s.status === "in_review").length;
    const certified = submissions.filter((s) => s.status === "certified");
    const rejected = submissions.filter((s) => s.status === "rejected").length;
    const avgScore =
      certified.length > 0
        ? Math.round(
            certified.reduce((s, x) => s + (x.certificate?.esg_score ?? 0), 0) / certified.length,
          )
        : null;
    const lastIssued = certified
      .map((s) => s.updatedAt)
      .sort()
      .pop();
    return {
      total: submissions.length,
      pending,
      inReview,
      certified: certified.length,
      rejected,
      avgScore,
      lastIssued,
    };
  }, [submissions]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "24px 16px 48px" : "32px 24px 60px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "flex-end",
            gap: isMobile ? 14 : 0,
            marginBottom: 22,
          }}
        >
          <div>
            <div className="section-title">Customer Portal</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, margin: 0, letterSpacing: "-0.01em", wordBreak: "break-word" }}>
                Welcome, {user?.email}
              </h1>
            </div>
            <div style={{ fontSize: 13, color: "var(--c-text-muted)", marginTop: 4 }}>
              Verify operations via satellite and IoT to generate auditable ESG
              certificates, instantly verifiable on-chain by any stakeholder.
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              color: "var(--c-text-muted)",
            }}
          >
            Sign out
          </button>
        </div>

        <PaymentNotice notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />

        {!selectedId && (
          <div style={{ display: "flex", gap: 4, marginBottom: 22, flexWrap: "wrap" }}>
            {(["submissions", "monitoring", "subscriptions"] as PortalTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPortalTab(tab)}
                style={{
                  padding: "8px 20px",
                  borderRadius: 10,
                  border: `1.5px solid ${portalTab === tab ? "var(--c-green-mid)" : "var(--c-border)"}`,
                  background: portalTab === tab ? "#e6f7ec" : "var(--c-white)",
                  color: portalTab === tab ? "var(--c-green-dark)" : "var(--c-text-muted)",
                  fontWeight: portalTab === tab ? 700 : 400,
                  fontSize: 13,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        )}

        {!selectedId && portalTab === "submissions" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: cols(isMobile, "repeat(5, 1fr)", "repeat(2, 1fr)"),
              gap: 12,
              marginBottom: 22,
            }}
          >
            <StatTile label="Total submissions" value={stats.total} />
            <StatTile label="Pending" value={stats.pending} accent="#b7791f" />
            <StatTile label="In review" value={stats.inReview} accent="#0984e3" />
            <StatTile
              label="Certified"
              value={stats.certified}
              accent="var(--c-green-dark)"
              hint={stats.lastIssued ? `Last: ${new Date(stats.lastIssued).toLocaleDateString()}` : undefined}
            />
            <StatTile
              label="Avg ESG score"
              value={stats.avgScore != null ? stats.avgScore : "—"}
              accent="var(--c-green-mid)"
              hint={stats.avgScore != null ? "Across your certified assets" : "No certificates yet"}
            />
          </div>
        )}

        {selectedQuery.isFetching && selectedId != null && !selected ? (
          <div
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 14,
              padding: 24,
              color: "var(--c-text-light)",
            }}
          >
            Loading submission…
          </div>
        ) : selected ? (
          <SubmissionDetailView
            key={selected.id}
            submission={selected}
            onClose={() => setSelectedId(null)}
            onDeleted={() => {
              setSelectedId(null);
              refresh();
            }}
            allSubmissions={submissions}
          />
        ) : portalTab === "subscriptions" ? (
          <div
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <Suspense fallback={<LazyPanelFallback />}>
              <BillingTab />
            </Suspense>
          </div>
        ) : portalTab === "monitoring" ? (
          <div
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <Suspense fallback={<LazyPanelFallback />}>
              <MonitoringTab />
            </Suspense>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1.4fr 1fr"), gap: 24 }}>
            <NewSubmissionCard
              onCreated={() => {
                refresh();
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div
                style={{
                  background: "var(--c-white)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: 22,
                }}
              >
                <div className="section-title" style={{ marginBottom: 4 }}>How it works</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>
                  Three steps to a verifiable certificate
                </h3>
                <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: "var(--c-text-muted)", lineHeight: 1.6 }}>
                  <li><strong style={{ color: "var(--c-text)" }}>Submit</strong> — enter your facility's details and coordinates (one facility per request).</li>
                  <li><strong style={{ color: "var(--c-text)" }}>Verify</strong> — our pipeline cross-checks satellite imagery (NDVI, NDWI, NBR, methane), IoT sensors and your documents.</li>
                  <li><strong style={{ color: "var(--c-text)" }}>Certify</strong> — once approved, your certificate is anchored on the blockchain, published on the public registry, and permanently verifiable by anyone.</li>
                </ol>
              </div>

              <div
                style={{
                  background: "var(--c-white)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: 22,
                }}
              >
                <div className="section-title" style={{ marginBottom: 4 }}>My Submissions</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>
                  {submissions.length} total
                </h3>
                {loading ? (
                  <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>Loading…</div>
                ) : submissions.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>
                    No submissions yet. Use the form to send your first asset for verification.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 380, overflowY: "auto" }}>
                    {submissions.map((s) => (
                      <SubmissionRow
                        key={s.id}
                        s={s}
                        onOpen={() => setSelectedId(s.id)}
                        onDeleted={refresh}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "linear-gradient(135deg, #e6f7ec 0%, #f0faf4 100%)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: 22,
                }}
              >
                <div className="section-title" style={{ marginBottom: 4, color: "var(--c-green-dark)" }}>
                  Compliance frameworks
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
                  Built for EU regulation
                </h3>
                <div style={{ fontSize: 12, color: "var(--c-text-muted)", lineHeight: 1.6 }}>
                  Each certificate is mapped against <strong>CSRD 2026</strong>,
                  the <strong>EU Taxonomy</strong> and <strong>ESRS E1</strong>{" "}
                  (climate change), so you can use it directly in regulatory filings
                  and stakeholder reports.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
