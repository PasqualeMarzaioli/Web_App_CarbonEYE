/**
 * artifacts/carboneye/src/pages/AdminConsole.tsx — Admin dashboard for reviewing submissions: filters by status, displays details with satellite/IoT/compliance data, run/approve/reject analysis.
 * Author: Pasquale Marzaioli
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "../components/Navbar";
import { useAuth } from "../lib/auth";
import {
  deleteSubmission,
  documentDownloadUrl,
  findPreviousPrediction,
  getSubmission,
  updateSubmission,
  type Submission,
  type SubmissionDetail,
} from "../lib/submissions";
import {
  listAdminBreaches,
  listAdminContactMessages,
  listAdminSubmissions,
  listAdminUsers,
  rerunAdminSubmission,
} from "../lib/admin";
import { SatellitePanel } from "../components/SatellitePanel";
import { IotPanel } from "../components/IotPanel";
import { CompliancePanel } from "../components/CompliancePanel";
import { AnomaliesPanel } from "../components/AnomaliesPanel";
import { Certificate } from "../components/Certificate";
import { FacilityMap } from "../components/FacilityMap";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

const STATUS_BG: Record<string, string> = {
  pending: "#fffbf0",
  analyzing: "#eef4ff",
  analysis_failed: "#fff0f0",
  in_review: "#e8f4fd",
  certified: "#e6f7ec",
  rejected: "#fff0f0",
};
const STATUS_FG: Record<string, string> = {
  pending: "#b7791f",
  analyzing: "#3b5bdb",
  analysis_failed: "#d63031",
  in_review: "#0984e3",
  certified: "#1a7a2e",
  rejected: "#d63031",
};

// Background analysis polling — the pipeline performs a live Sentinel-2
// download and can run for several minutes. The admin console polls the
// submission until it leaves the "analyzing" state.
const POLL_INTERVAL_MS = 5000;
const ANALYZE_MAX_WAIT_MS = 25 * 60 * 1000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        background: STATUS_BG[status] ?? "#eee",
        color: STATUS_FG[status] ?? "#333",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 6,
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function ReviewPanel({
  submission,
  onUpdated,
  onDeleted,
  allSubmissions = [],
  onRerun,
}: {
  submission: SubmissionDetail;
  onUpdated: (s: Submission) => void;
  onDeleted: () => void;
  allSubmissions?: Submission[];
  onRerun: () => Promise<Submission>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cert, setCert] = useState(submission.certificate);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Guards the auto-resume effect so it starts the poll loop at most once
  // when a submission is opened while its analysis is already running.
  const resumedRef = useRef(false);

  // Poll the submission until the background analysis leaves the "analyzing"
  // state, then surface the resulting certificate (or failure) to the admin.
  const pollUntilDone = useCallback(async () => {
    const startedAt = Date.now();
    setElapsedMs(0);
    while (Date.now() - startedAt < ANALYZE_MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      setElapsedMs(Date.now() - startedAt);
      let fresh: SubmissionDetail;
      try {
        fresh = await getSubmission(submission.id);
      } catch {
        continue; // transient network error — keep polling
      }
      if (fresh.status !== "analyzing") {
        setCert(fresh.certificate);
        onUpdated(fresh);
        if (fresh.status === "analysis_failed") {
          setError(
            "The analysis did not complete. Re-run it when ready — common causes: " +
              "no cloud-free Sentinel-2 scene for these coordinates, or a data source " +
              "was unreachable. The server logs have the exact reason.",
          );
        }
        return;
      }
    }
    setError(
      "Analysis is still running after 25 minutes. Reload this page later to see the result.",
    );
  }, [submission.id, onUpdated]);

  // If the submission is opened while an analysis is already in flight (e.g.
  // after a page reload), resume polling automatically so the admin sees the
  // result land without having to click "Re-run".
  useEffect(() => {
    if (submission.status === "analyzing" && !resumedRef.current) {
      resumedRef.current = true;
      setBusy("analyze");
      void pollUntilDone().finally(() => setBusy(null));
    }
  }, [submission.status, pollUntilDone]);

  const remove = async () => {
    if (!window.confirm(
      `Delete submission #${submission.id} for "${submission.companyName}"? This cannot be undone.`,
    )) return;
    setBusy("delete");
    setError(null);
    try {
      await deleteSubmission(submission.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const runAnalysis = async () => {
    // Claim the resume guard so the auto-resume effect does not start a second
    // poll loop once onRerun flips the submission into the "analyzing" state.
    resumedRef.current = true;
    setBusy("analyze");
    setError(null);
    try {
      // onRerun triggers the pipeline and moves the submission to "analyzing".
      // The real result arrives later via background polling.
      await onRerun();
      await pollUntilDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: Submission["status"]) => {
    setBusy(status);
    setError(null);
    try {
      const updated = await updateSubmission(submission.id, { status });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div
        style={{
          background: "var(--c-white)",
          border: "1px solid var(--c-border)",
          borderRadius: 14,
          padding: 22,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="section-title">Reviewing</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 8px" }}>
              {submission.companyName}
            </h2>
            <StatusPill status={submission.status} />
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--c-text-light)", fontFamily: "var(--font-mono)" }}>
            #{submission.id}
            <br />
            {submission.lat.toFixed(4)}, {submission.lon.toFixed(4)}
            <br />
            {submission.industry ?? "—"}
          </div>
        </div>

        {submission.notes && (
          <div
            style={{
              background: "var(--c-bg-page)",
              borderRadius: 8,
              padding: 12,
              fontSize: 13,
              color: "var(--c-text-muted)",
              marginTop: 16,
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ color: "var(--c-text)" }}>User notes:</strong>
            <br />
            {submission.notes}
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            Submitted documents
          </div>
          {submission.documents.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--c-text-light)" }}>No documents.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {submission.documents.map((d) => (
                <a
                  key={d.id}
                  href={documentDownloadUrl(submission.id, d.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "var(--c-bg-page)",
                    border: "1px solid var(--c-border)",
                    borderRadius: 6,
                    textDecoration: "none",
                    color: "var(--c-text)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <span>{d.filename}</span>
                  <span style={{ color: "var(--c-text-light)" }}>{(d.sizeBytes / 1024).toFixed(0)} KB</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {cert && (cert as { demo_mode?: boolean }).demo_mode && (
          <div
            style={{
              marginTop: 14,
              padding: "8px 12px",
              background: "#fff7e6",
              border: "1px solid #fdcb6e",
              borderRadius: 8,
              fontSize: 12,
              color: "#7a5a00",
              fontFamily: "var(--font-mono)",
            }}
          >
            ⚠ DEMO MODE — This certificate was generated for demonstration purposes only. The real ML pipeline is intentionally not connected in this demo gallery build.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <button
            onClick={runAnalysis}
            disabled={!!busy}
            className="btn-primary"
            style={{ width: "auto", padding: "10px 18px" }}
          >
            {busy === "analyze" ? "Analysis running…" : cert ? "Re-run analysis" : "Run analysis"}
          </button>
          {busy === "analyze" && (
            <div
              style={{
                width: "100%",
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div className="spinner" />
              <span style={{ fontSize: 12, color: "var(--c-text-muted)", lineHeight: 1.5 }}>
                Live satellite &amp; ground analysis in progress — {formatElapsed(elapsedMs)} elapsed.
                A real Sentinel-2 scene is being downloaded and processed; this can take several
                minutes. You can leave this page and come back — the result is saved automatically.
              </span>
            </div>
          )}
          <button
            onClick={() => setStatus("certified")}
            disabled={!cert || !!busy}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--c-green-dark)",
              color: "white",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: cert ? "pointer" : "not-allowed",
              opacity: cert ? 1 : 0.5,
            }}
          >
            ✓ Issue Certificate
          </button>
          <button
            onClick={() => setStatus("rejected")}
            disabled={!!busy}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--c-border)",
              background: "var(--c-white)",
              color: "var(--c-danger)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            ✗ Reject
          </button>
          {submission.status !== "certified" && (
            <button
              onClick={remove}
              disabled={!!busy}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "1px solid #f5b7b1",
                background: "white",
                color: "#a8141d",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: busy === "delete" ? "wait" : "pointer",
                marginLeft: "auto",
              }}
              title="Permanently delete this submission and its documents"
            >
              {busy === "delete" ? "Deleting…" : "🗑 Delete"}
            </button>
          )}
        </div>
        {error && <div className="alert alert-err">{error}</div>}
      </div>

      {cert && (
        <>
          {cert.narrative && (
            <div
              style={{
                background: "var(--c-white)",
                border: "1px solid var(--c-border)",
                borderLeft: "4px solid var(--c-green-dark)",
                borderRadius: 14,
                padding: "16px 20px",
                marginBottom: 18,
              }}
            >
              <div className="section-title" style={{ marginBottom: 8 }}>
                AI Summary
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--c-text-light)",
                  }}
                >
                  generated by gpt-4o-mini · review before issuing
                </span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--c-text)", margin: 0 }}>
                {cert.narrative}
              </p>
            </div>
          )}
          <Certificate
            company={submission.companyName}
            prediction={cert}
            previous={findPreviousPrediction(allSubmissions, submission)}
          />
          {cert.chain && cert.chain.facilities.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>Supply chain map</div>
              <FacilityMap facilities={cert.chain.facilities} />
            </div>
          )}
          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Underlying analysis</div>
            <SatellitePanel p={cert} />
            <IotPanel p={cert} />
            <div className="divider" />
            <div className="two-col">
              <AnomaliesPanel p={cert} />
              <CompliancePanel p={cert} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminConsole() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<
    "all" | "pending" | "analyzing" | "analysis_failed" | "in_review" | "certified" | "rejected"
  >("all");

  const submissionsQuery = useQuery({
    queryKey: ["admin", "submissions"],
    queryFn: listAdminSubmissions,
  });
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listAdminUsers });
  const contactQuery = useQuery({
    queryKey: ["admin", "contact-messages"],
    queryFn: listAdminContactMessages,
  });
  const breachesQuery = useQuery({ queryKey: ["admin", "breaches"], queryFn: listAdminBreaches });
  const selectedQuery = useQuery({
    queryKey: ["admin", "submission", selectedId],
    queryFn: () => getSubmission(selectedId!),
    enabled: selectedId != null,
  });

  const items = submissionsQuery.data ?? [];
  const selected = selectedQuery.data ?? null;
  const loading = submissionsQuery.isLoading;
  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);

  const counts = items.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: isMobile ? "24px 16px 48px" : "32px 24px 60px" }}>
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
            <div className="section-title">Admin Console</div>
            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, margin: "4px 0 4px", letterSpacing: "-0.01em" }}>
              Verification Queue
            </h1>
            <div style={{ fontSize: 13, color: "var(--c-text-muted)" }}>
              Signed in as {user?.email} · {usersQuery.data?.length ?? 0} users ·{" "}
              {contactQuery.data?.length ?? 0} messages · {breachesQuery.data?.length ?? 0} breaches
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

        <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "320px 1fr"), gap: 22 }}>
          <aside
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 14,
              padding: 16,
              alignSelf: "start",
              // On mobile the list sits above the detail in natural flow; cap its height
              // only on desktop where it's a sticky sidebar (avoids a nested scroll on phones).
              maxHeight: isMobile ? "60vh" : "calc(100vh - 180px)",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              {(
                ["all", "pending", "analyzing", "analysis_failed", "in_review", "certified", "rejected"] as const
              ).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--c-border)",
                    background: filter === f ? "var(--c-green-mid)" : "var(--c-white)",
                    color: filter === f ? "white" : "var(--c-text-muted)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {f.replace("_", " ")} {f !== "all" && counts[f] ? `(${counts[f]})` : ""}
                </button>
              ))}
            </div>

            {submissionsQuery.isError ? (
              <div style={{ fontSize: 13, color: "var(--c-danger)" }}>
                {(submissionsQuery.error as Error).message}
              </div>
            ) : loading ? (
              <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>No submissions match this filter.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      textAlign: "left",
                      background: selectedId === s.id ? "var(--c-bg-page)" : "transparent",
                      border: "1px solid",
                      borderColor: selectedId === s.id ? "var(--c-border-mid)" : "transparent",
                      borderRadius: 8,
                      padding: "10px 12px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{s.companyName}</span>
                      <StatusPill status={s.status} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--c-text-light)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                      #{s.id} · {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <main>
            {selectedQuery.isFetching && selectedId != null && !selected ? (
              <div
                style={{
                  background: "var(--c-white)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: "60px 40px",
                  textAlign: "center",
                  color: "var(--c-text-light)",
                }}
              >
                Loading submission…
              </div>
            ) : selected ? (
              <ReviewPanel
                key={selected.id}
                submission={selected}
                onUpdated={(updated) => {
                  queryClient.setQueryData<Submission[]>(["admin", "submissions"], (list) =>
                    (list ?? []).map((s) => (s.id === updated.id ? updated : s)),
                  );
                  queryClient.setQueryData<SubmissionDetail>(["admin", "submission", updated.id], (s) =>
                    s ? { ...s, ...updated } : s,
                  );
                }}
                onDeleted={() => {
                  queryClient.setQueryData<Submission[]>(["admin", "submissions"], (list) =>
                    (list ?? []).filter((s) => s.id !== selected.id),
                  );
                  setSelectedId(null);
                }}
                onRerun={async () => {
                  const updated = await rerunAdminSubmission(selected.id);
                  await queryClient.invalidateQueries({ queryKey: ["admin", "submissions"] });
                  await queryClient.invalidateQueries({ queryKey: ["admin", "submission", selected.id] });
                  return updated;
                }}
                allSubmissions={items}
              />
            ) : (
              <div
                style={{
                  background: "var(--c-white)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: "60px 40px",
                  textAlign: "center",
                  color: "var(--c-text-light)",
                }}
              >
                Select a submission to start the verification process.
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
