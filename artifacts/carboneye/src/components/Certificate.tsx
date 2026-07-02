/**
 * artifacts/carboneye/src/components/Certificate.tsx — Renders ESG emission certificate with regulatory compliance indicators, trend analysis, facility breakdown, verification status, and downloadable PDF.
 * Author: Pasquale Marzaioli
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Prediction } from "../lib/types";

type Props = {
  company: string;
  prediction: Prediction;
  previous?: Prediction | null;
};

function TrendDelta({
  label,
  current,
  previous,
  unit,
  betterIsLower,
  digits = 0,
}: {
  label: string;
  current?: number;
  previous?: number;
  unit?: string;
  betterIsLower: boolean;
  digits?: number;
}) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  const same = Math.abs(delta) < Math.pow(10, -digits) * 0.5;
  const better = same ? null : betterIsLower ? delta < 0 : delta > 0;
  const color = better == null ? "#7a9088" : better ? "#1a7a2e" : "#a8141d";
  const arrow = same ? "→" : delta > 0 ? "▲" : "▼";
  const pct =
    previous !== 0 ? ((delta / Math.abs(previous)) * 100).toFixed(1) : "—";
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #eef3ef",
        borderRadius: 6,
        padding: "8px 10px",
        flex: "1 1 140px",
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "#3f5747",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          fontWeight: 700,
          color: "#1a2e1e",
          marginTop: 2,
        }}
      >
        {current.toFixed(digits)}
        {unit ? ` ${unit}` : ""}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color,
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {arrow} {delta >= 0 ? "+" : ""}
        {delta.toFixed(digits)}
        {unit ? ` ${unit}` : ""}{" "}
        {pct !== "—" && !same && (
          <span style={{ opacity: 0.8 }}>
            ({delta >= 0 ? "+" : ""}
            {pct}%)
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "#7a9088",
          marginTop: 2,
        }}
      >
        prev {previous.toFixed(digits)}
        {unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}

function TrendPanel({ current, previous }: { current: Prediction; previous: Prediction }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#3f5747",
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Trend vs. previous certificate
        {previous.monitoring_period && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              textTransform: "none",
              letterSpacing: 0,
              color: "#7a9088",
              marginLeft: 8,
            }}
          >
            ({new Date(previous.monitoring_period.start).toLocaleDateString()} →{" "}
            {current.monitoring_period
              ? new Date(current.monitoring_period.end).toLocaleDateString()
              : "current"})
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, background: "#f7faf8", padding: 10, borderRadius: 8 }}>
        <TrendDelta label="ESG score" current={current.esg_score} previous={previous.esg_score} unit="/100" betterIsLower={false} />
        <TrendDelta
          label="Verified emissions"
          current={current.verified_emissions_tco2eq}
          previous={previous.verified_emissions_tco2eq}
          unit="tCO₂eq"
          betterIsLower
        />
        <TrendDelta label="Atm. CO₂" current={current.co2_ppm} previous={previous.co2_ppm} unit="ppm" betterIsLower />
        <TrendDelta label="Atm. CH₄" current={current.ch4_ppb} previous={previous.ch4_ppb} unit="ppb" betterIsLower />
        <TrendDelta label="Site CO₂" current={current.iot_co2_mean} previous={previous.iot_co2_mean} unit="ppm" betterIsLower />
        <TrendDelta label="Site CH₄" current={current.iot_ch4_mean} previous={previous.iot_ch4_mean} unit="ppb" betterIsLower />
        <TrendDelta label="NDVI" current={current.ndvi_mean} previous={previous.ndvi_mean} digits={3} betterIsLower={false} />
        <TrendDelta
          label="Anomalies"
          current={current.anomalies?.length}
          previous={previous.anomalies?.length}
          betterIsLower
        />
      </div>
    </div>
  );
}

type Status = "pass" | "fail" | "info";

type Indicator = {
  label: string;
  measured: string;
  reference: string;
  source: string;
  status: Status;
};

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  pass: { bg: "#e6f7ec", fg: "#1a7a2e", label: "✓ Within" },
  fail: { bg: "#ffe6e6", fg: "#a8141d", label: "✗ Exceeds" },
  info: { bg: "#eef3ef", fg: "#3f5747", label: "Reported" },
};

function classifyMax(value: number, hardMax: number): Status {
  return value <= hardMax ? "pass" : "fail";
}

function classifyMin(value: number, hardMin: number): Status {
  return value >= hardMin ? "pass" : "fail";
}

function classifyRange(value: number, lo: number, hi: number): Status {
  return value >= lo && value <= hi ? "pass" : "fail";
}

function hasDataSource(p: Prediction, source: string): boolean {
  const target = source.toLowerCase();
  return (p.data_sources ?? []).some((s) => {
    const raw = `${s.source} ${s.label ?? ""}`.toLowerCase();
    return raw.includes(target);
  });
}

function atmosphericSourceLabel(p: Prediction): string {
  if (hasDataSource(p, "sentinel-5p")) return "Sentinel-5P";
  if (hasDataSource(p, "icos")) return "ICOS";
  return "Ground/reanalysis network";
}

function buildIndicators(p: Prediction): Indicator[] {
  const rows: Indicator[] = [];
  const atmosphericSource = atmosphericSourceLabel(p);

  if (p.verified_emissions_tco2eq != null) {
    const v = p.verified_emissions_tco2eq;
    rows.push({
      label: "Annualised CO₂e estimate",
      measured: `${v.toLocaleString("en-US")} tCO₂eq`,
      reference: "≤ 25,000 tCO₂eq triggers EU ETS scope",
      source: "CarbonEYE score + measured CO₂/CH₄ excess",
      status: classifyMax(v, 25000),
    });
  }
  if (p.co2_ppm != null && p.co2_ppm > 0) {
    rows.push({
      label: "Atmospheric CO₂",
      measured: `${p.co2_ppm.toFixed(0)} ppm`,
      reference: "≤ 440 ppm regional alert level",
      source: atmosphericSource,
      status: classifyMax(p.co2_ppm, 440),
    });
  }
  if (p.ch4_ppb != null && p.ch4_ppb > 0) {
    rows.push({
      label: "Atmospheric CH₄",
      measured: `${p.ch4_ppb.toFixed(0)} ppb`,
      reference: "≤ 2,200 ppb plume detection threshold",
      source: `EU Methane Reg. 2024/1787 · ${atmosphericSource}`,
      status: classifyMax(p.ch4_ppb, 2200),
    });
  }
  if (p.ndvi_mean != null) {
    rows.push({
      label: "NDVI — vegetation health",
      measured: p.ndvi_mean.toFixed(3),
      reference: "≥ 0.45 healthy vegetation",
      source: "NASA / USGS Landsat NDVI",
      status: classifyMin(p.ndvi_mean, 0.45),
    });
  }
  if (p.ndwi_mean != null) {
    rows.push({
      label: "NDWI — water / moisture index",
      measured: p.ndwi_mean.toFixed(3),
      reference: "≥ -0.15 (lower = drought stress)",
      source: "ESA Copernicus Sentinel-2",
      status: classifyMin(p.ndwi_mean, -0.15),
    });
  }
  if (p.nbr_mean != null) {
    rows.push({
      label: "NBR — burn-scar index",
      measured: p.nbr_mean.toFixed(3),
      reference: "≥ 0.10 unburned land",
      source: "USGS Landsat NBR (Key & Benson)",
      status: classifyMin(p.nbr_mean, 0.1),
    });
  }
  if (p.iot_co2_mean != null) {
    rows.push({
      label: "Site CO₂ (IoT ground)",
      measured: `${p.iot_co2_mean.toFixed(0)} ppm`,
      reference: "≤ 2,000 ppm fugitive-leak threshold",
      source: "ASHRAE 62.1 · WHO AQG 2021",
      status: classifyMax(p.iot_co2_mean, 2000),
    });
  }
  if (p.iot_ch4_mean != null) {
    rows.push({
      label: "Site CH₄ (IoT ground)",
      measured: `${p.iot_ch4_mean.toFixed(0)} ppb`,
      reference: "≤ 5,000 ppb fugitive-leak threshold",
      source: "EU Methane Reg. 2024/1787 (Art. 14)",
      status: classifyMax(p.iot_ch4_mean, 5000),
    });
  }
  if (p.iot_temperature_mean != null) {
    rows.push({
      label: "Operating temperature",
      measured: `${p.iot_temperature_mean.toFixed(1)} °C`,
      reference: "15–30 °C industrial operating range",
      source: "ISO 7730 · NIOSH heat-stress",
      status: classifyRange(p.iot_temperature_mean, 15, 30),
    });
  }
  if (p.iot_humidity_mean != null) {
    rows.push({
      label: "Relative humidity",
      measured: `${p.iot_humidity_mean.toFixed(1)} %`,
      reference: "30–70 % industrial range",
      source: "ASHRAE 55 · ISO 7730",
      status: classifyRange(p.iot_humidity_mean, 30, 70),
    });
  }
  if (p.num_iot_sensors != null) {
    rows.push({
      label: "Active IoT sensors",
      measured: `${p.num_iot_sensors}`,
      reference: "Reported active sensor count",
      source: "CarbonEYE methodology v1.0",
      status: "info",
    });
  }
  return rows;
}

function IndicatorTable({ p }: { p: Prediction }) {
  const rows = buildIndicators(p);
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#3f5747",
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Measured Indicators vs. Regulatory Reference
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11.5,
          fontFamily: "var(--font-display)",
        }}
      >
        <thead>
          <tr style={{ background: "#f0f7f2", color: "#1a2e1e" }}>
            <th style={{ textAlign: "left", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Indicator</th>
            <th style={{ textAlign: "right", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Measured</th>
            <th style={{ textAlign: "left", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Regulatory reference</th>
            <th style={{ textAlign: "center", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = STATUS_STYLE[r.status];
            return (
              <tr key={i} style={{ borderBottom: "1px solid #eef3ef" }}>
                <td style={{ padding: "7px 8px", color: "#1a2e1e" }}>{r.label}</td>
                <td
                  style={{
                    padding: "7px 8px",
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    color: "#1a2e1e",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.measured}
                </td>
                <td style={{ padding: "7px 8px", color: "#3f5747" }}>
                  <div>{r.reference}</div>
                  <div style={{ fontSize: 9.5, color: "#7a9088", fontFamily: "var(--font-mono)", marginTop: 1 }}>
                    {r.source}
                  </div>
                </td>
                <td style={{ padding: "7px 8px", textAlign: "center", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: s.bg,
                      color: s.fg,
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        style={{
          marginTop: 8,
          fontSize: 9.5,
          fontFamily: "var(--font-mono)",
          color: "#7a9088",
          lineHeight: 1.5,
        }}
      >
        Reference frameworks: WHO Air Quality Guidelines 2021 · EU Methane Regulation
        2024/1787 · EU CSRD / ESRS E1 · EU ETS Directive 2003/87/EC · ASHRAE 62.1 / 55
        · ISO 7730 · NASA-USGS Landsat indices.
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const stroke = 9;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={130} height={130} viewBox="0 0 130 130">
      <circle
        cx={65}
        cy={65}
        r={radius}
        stroke="#e6f0ea"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={65}
        cy={65}
        r={radius}
        stroke="#27ae60"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 65 65)"
      />
      <text
        x="65"
        y="58"
        textAnchor="middle"
        fontSize="11"
        fontFamily="var(--font-display)"
        fill="#1a7a2e"
        fontWeight={600}
      >
        ESG Score
      </text>
      <text
        x="65"
        y="80"
        textAnchor="middle"
        fontSize="20"
        fontFamily="var(--font-display)"
        fill="#1a2e1e"
        fontWeight={700}
      >
        {score}/100
      </text>
    </svg>
  );
}

function VerifiedBadge() {
  return (
    <svg width={36} height={36} viewBox="0 0 36 36">
      <path
        d="M18 2 L22 5 L27 4 L29 9 L34 11 L33 16 L36 20 L33 24 L34 29 L29 31 L27 36 L22 35 L18 38 L14 35 L9 36 L7 31 L2 29 L3 24 L0 20 L3 16 L2 11 L7 9 L9 4 L14 5 Z"
        transform="translate(0,-2)"
        fill="#27ae60"
      />
      <path
        d="M11 18 L16 23 L25 13"
        stroke="white"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Certificate({ company, prediction, previous }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyState, setVerifyState] = useState<{
    valid: boolean;
    dataHash?: string;
    error?: string;
  } | null>(null);

  const verifyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/verify?id=${encodeURIComponent(prediction.certificate_id)}`
      : prediction.certificate_id;

  const hash = prediction.data_hash ?? "";
  const hashShort = hash ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : "pending";

  const emissions = prediction.verified_emissions_tco2eq ?? 0;
  const emissionsLabel = emissions.toLocaleString("en-US");

  const period = prediction.monitoring_period
    ? `${new Date(prediction.monitoring_period.start).toLocaleDateString()} - ${new Date(
        prediction.monitoring_period.end,
      ).toLocaleDateString()}`
    : "—";
  const sources =
    prediction.data_sources ??
    [
      { source: "sentinel-2", label: "Sentinel-2", status: "missing", last_updated: prediction.timestamp },
      { source: "open-meteo", label: "Open-Meteo", status: "missing", last_updated: prediction.timestamp },
      { source: "icos", label: "ICOS", status: "missing", last_updated: prediction.timestamp },
    ];

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/api/certificate/${encodeURIComponent(prediction.certificate_id)}/pdf`, {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error((data as { error?: string }).error ?? "Certificate PDF is not available.");
      }
      window.open(String(data.url), "_blank", "noopener,noreferrer");
    } catch (err) {
      setVerifyState({
        valid: false,
        dataHash: prediction.data_hash,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDownloading(false);
    }
  };

  const verifyCertificate = async () => {
    setVerifying(true);
    try {
      const response = await fetch(`/api/verify/${encodeURIComponent(prediction.certificate_id)}`, {
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? "Certificate verification failed.");
      }
      const hashCheck = data.hash_check as { stored_data_hash?: string } | undefined;
      setVerifyState({
        valid: data.valid === true,
        dataHash: String(data.data_hash ?? hashCheck?.stored_data_hash ?? prediction.data_hash ?? ""),
      });
    } catch (err) {
      setVerifyState({
        valid: false,
        dataHash: prediction.data_hash,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={downloading}
          data-pdf-hide
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid var(--c-green-mid, #27ae60)",
            background: "white",
            color: "var(--c-green-dark, #1a7a2e)",
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: downloading ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {downloading ? "Generating…" : "↓ Download PDF"}
        </button>
        <button
          type="button"
          onClick={verifyCertificate}
          disabled={verifying}
          data-pdf-hide
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid var(--c-green-mid, #27ae60)",
            background: verifying ? "#f0f7f2" : "white",
            color: "var(--c-green-dark, #1a7a2e)",
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: verifying ? "wait" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {verifying ? "Verifying…" : "✓ Verify"}
        </button>
      </div>
      <div
        style={{
          background: "white",
          border: "1.5px solid #1a2e1e",
          borderRadius: 8,
          padding: "32px 36px",
          position: "relative",
          fontFamily: "var(--font-display)",
          color: "#1a2e1e",
          boxShadow: "0 8px 28px rgba(27, 122, 46, 0.12)",
        }}
      >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>CarbonEYE</div>
        <VerifiedBadge />
      </div>

      <h2
        style={{
          fontSize: 32,
          fontWeight: 700,
          margin: "12px 0 0",
          padding: "0 0 10px",
          letterSpacing: "-0.02em",
          lineHeight: 1.25,
        }}
      >
        ESG Emission Certificate
      </h2>
      <div style={{ height: 1, background: "#1a2e1e", margin: "0 0 22px" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center" }}>
        <div style={{ fontSize: 16, lineHeight: 1.9 }}>
          <div>
            <span style={{ color: "#3f5747" }}>Company:</span>{" "}
            <strong>{company}</strong>
          </div>
          <div>
            <span style={{ color: "#3f5747" }}>Monitoring Period:</span> {period}
          </div>
          <div>
            <span style={{ color: "#3f5747" }}>Verified Emissions:</span>{" "}
            <strong>{emissionsLabel} tCO₂eq</strong>
          </div>
          {prediction.chain && (
            <div style={{ fontSize: 13, color: "#3f5747", marginTop: 4 }}>
              Aggregated across <strong>{prediction.chain.facility_count}</strong>{" "}
              facilities · weakest site score {prediction.chain.score_min}/100
            </div>
          )}
        </div>
        <ScoreRing score={prediction.esg_score} />
      </div>

      <div style={{ marginTop: 22, fontSize: 13, lineHeight: 1.8, color: "#3f5747" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "#3f5747" }}>Data Sources:</span>
          {sources.map((s) => (
            <span
              key={`${s.source}-${s.last_updated}`}
              title={`Last updated ${new Date(s.last_updated).toLocaleString()}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 7px",
                borderRadius: 999,
                border: "1px solid #c6ecd4",
                background: s.status === "ok" ? "#e6f7ec" : "#fff7e6",
                color: s.status === "ok" ? "#1a7a2e" : "#7a5a00",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              {s.label ?? s.source} · {s.status}
            </span>
          ))}
        </div>
        <div>
          <span style={{ color: "#3f5747" }}>Certificate ID:</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "#1a2e1e" }}>
            {prediction.certificate_id}
          </span>
        </div>
        <div>
          <span style={{ color: "#3f5747" }}>Data Hash:</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "#1a2e1e" }}>{hashShort}</span>
        </div>
        {verifyState && (
          <div
            style={{
              marginTop: 8,
              padding: "7px 9px",
              borderRadius: 6,
              border: "1px solid #c6ecd4",
              background: verifyState.valid ? "#e6f7ec" : "#fff7e6",
              color: verifyState.valid ? "#1a7a2e" : "#7a5a00",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
            }}
          >
            {verifyState.valid ? "Source data integrity verified" : verifyState.error ?? "Source data integrity could not be verified"}
            <div>data_hash: {verifyState.dataHash || prediction.data_hash || "pending"}</div>
          </div>
        )}
      </div>

      <IndicatorTable p={prediction} />

      {previous && <TrendPanel current={prediction} previous={previous} />}

      {prediction.chain && prediction.chain.facilities.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#3f5747",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            Per-facility breakdown
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: "#f0f7f2", color: "#1a2e1e" }}>
                <th style={{ textAlign: "left", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Facility</th>
                <th style={{ textAlign: "left", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Role</th>
                <th style={{ textAlign: "right", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>Coordinates</th>
                <th style={{ textAlign: "center", padding: "7px 8px", fontWeight: 700, borderBottom: "1px solid #c6ecd4" }}>ESG</th>
              </tr>
            </thead>
            <tbody>
              {prediction.chain.facilities.map((f, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eef3ef" }}>
                  <td style={{ padding: "7px 8px", color: "#1a2e1e" }}>{f.name}</td>
                  <td style={{ padding: "7px 8px", color: "#3f5747" }}>{f.role ?? "—"}</td>
                  <td
                    style={{
                      padding: "7px 8px",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      color: "#3f5747",
                    }}
                  >
                    {f.lat.toFixed(3)}, {f.lon.toFixed(3)}
                  </td>
                  <td
                    style={{
                      padding: "7px 8px",
                      textAlign: "center",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      color: "#1a7a2e",
                    }}
                  >
                    {f.esg_score}/100 ({f.esg_grade})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: 22,
          gap: 18,
        }}
      >
        <div style={{ flex: 1, fontSize: 12, color: "#3f5747", lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#27ae60",
                color: "white",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              ✓
            </span>
            <strong style={{ color: "#1a2e1e", fontSize: 13 }}>
              Verified via Copernicus & PRISMA satellite data + IoT ground sensors
            </strong>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#7a9088" }}>
            This certificate is immutable and publicly verifiable.
          </div>
        </div>
        <div
          style={{
            background: "white",
            padding: 6,
            border: "1px solid #c6ecd4",
            borderRadius: 6,
          }}
        >
          <QRCodeSVG value={verifyUrl} size={84} fgColor="#1a2e1e" bgColor="white" />
        </div>
      </div>

      {prediction.demo_mode && (
        <div
          style={{
            marginTop: 18,
            padding: "6px 10px",
            background: "#fff7e6",
            border: "1px dashed #fdcb6e",
            borderRadius: 6,
            fontSize: 11,
            color: "#7a5a00",
            fontFamily: "var(--font-mono)",
            textAlign: "center",
          }}
        >
          DEMO MODE — simulated data. The ML pipeline is intentionally not connected in this build and no real certificate is issued.
        </div>
      )}
      </div>
    </div>
  );
}
