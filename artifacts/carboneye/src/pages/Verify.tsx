/**
 * artifacts/carboneye/src/pages/Verify.tsx — Public certificate verification page that looks up certificates by ID in the registry and displays full analysis details.
 * Author: Pasquale Marzaioli
 */
import { useEffect, useState } from "react";
import { Navbar } from "../components/Navbar";
import { useIsMobile } from "../hooks/use-mobile";
import { SatellitePanel } from "../components/SatellitePanel";
import { IotPanel } from "../components/IotPanel";
import { CompliancePanel } from "../components/CompliancePanel";
import { AnomaliesPanel } from "../components/AnomaliesPanel";
import { Certificate } from "../components/Certificate";
import { FacilityMap } from "../components/FacilityMap";
import type { Prediction } from "../lib/types";

type VerifyResult = {
  certificate: Prediction;
  company?: string;
  verified_at: string;
  issued_at?: string;
  previous?: Prediction | null;
};

async function verifyCertificate(id: string): Promise<VerifyResult> {
  const response = await fetch(`/api/certificate/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (response.status === 404) {
    throw new Error("Certificate not found in registry.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Verification failed (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json();
  const cert: Prediction = data.certificate ?? data.prediction ?? data;
  const prev = data.previous?.certificate ?? data.previous ?? null;
  return {
    certificate: cert,
    company: data.company_name ?? data.company,
    issued_at: data.issued_at,
    verified_at: new Date().toISOString(),
    previous: prev,
  };
}

export function Verify() {
  const isMobile = useIsMobile();
  const [id, setId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const runVerify = async (rawId: string) => {
    const trimmed = rawId.trim();
    if (!trimmed) {
      setError("Please enter a certificate ID.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await verifyCertificate(trimmed);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runVerify(id);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qid = params.get("id");
    if (qid) {
      setId(qid);
      runVerify(qid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />
      <div style={{ maxWidth: 880, margin: "0 auto", padding: isMobile ? "32px 16px" : "48px 28px" }}>
        <div className="section-title">Public Certificate Registry</div>
        <h1
          style={{
            fontSize: isMobile ? 28 : 40,
            fontWeight: 700,
            color: "var(--c-text)",
            margin: "8px 0 14px",
            letterSpacing: "-0.02em",
          }}
        >
          Verify a CarbonEYE Certificate
        </h1>
        <p style={{ fontSize: 15, color: "var(--c-text-muted)", lineHeight: 1.7, margin: "0 0 28px" }}>
          Enter the certificate ID to confirm authenticity, issue date, and the original ESG score
          against our public registry.
        </p>

        <form
          onSubmit={submit}
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            gap: 12,
            background: "var(--c-white)",
            border: "1px solid var(--c-border)",
            borderRadius: 14,
            padding: 16,
            boxShadow: "0 4px 16px rgba(27,122,46,0.06)",
          }}
        >
          <input
            className="field-input"
            placeholder="e.g. CE-LU8H9X-4221"
            value={id}
            onChange={(e) => setId(e.target.value)}
            style={{ flex: 1, fontFamily: "var(--font-mono)" }}
          />
          <button
            type="submit"
            className="btn-primary"
            style={{ width: isMobile ? "100%" : "auto", padding: "10px 24px" }}
            disabled={loading}
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>

        {loading && (
          <div className="spinner-row" style={{ marginTop: 18 }}>
            <div className="spinner" />
            <span>Looking up certificate in registry…</span>
          </div>
        )}
        {error && (
          <div className="alert alert-err" style={{ marginTop: 18 }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 32 }}>
            <div
              style={{
                background: "linear-gradient(135deg, var(--c-green-dark), var(--c-green-mid))",
                color: "white",
                padding: "16px 20px",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 22,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    opacity: 0.85,
                  }}
                >
                  ✓ Verified
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 16,
                    fontWeight: 700,
                    marginTop: 4,
                  }}
                >
                  {result.certificate.certificate_id}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, opacity: 0.85 }}>
                <div style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>Verified at</div>
                <div style={{ fontFamily: "var(--font-mono)", marginTop: 4 }}>
                  {result.verified_at.replace("T", " ").slice(0, 19)} UTC
                </div>
              </div>
            </div>

            <Certificate
              company={result.company ?? "Unknown company"}
              prediction={result.certificate}
              previous={result.previous}
            />

            {result.certificate.chain && result.certificate.chain.facilities.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div className="section-title" style={{ marginBottom: 10 }}>Supply chain map</div>
                <FacilityMap facilities={result.certificate.chain.facilities} />
              </div>
            )}

            <div style={{ marginTop: 22 }}>
              <div className="section-title" style={{ marginBottom: 10 }}>Underlying analysis</div>
              {result.certificate.ndvi_mean != null && <SatellitePanel p={result.certificate} />}
              {result.certificate.iot_co2_mean != null && <IotPanel p={result.certificate} />}

              <div className="two-col" style={{ marginTop: 8 }}>
                {result.certificate.anomalies && <AnomaliesPanel p={result.certificate} />}
                {result.certificate.compliance && <CompliancePanel p={result.certificate} />}
              </div>
            </div>

            <p className="tagline">CarbonEYE — Truth is not declared, it's measured.</p>
          </div>
        )}
      </div>
    </div>
  );
}
