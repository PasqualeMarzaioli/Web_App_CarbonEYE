/**
 * artifacts/carboneye/src/components/MonitoringTab.tsx — Comprehensive emissions monitoring dashboard with time-range charts (CO₂, CH₄, ESG, emissions), regulatory breach history, compliance summary, and facility selector with plan-based data locking.
 * Author: Pasquale Marzaioli
 */
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { startRenewCheckout, startUpgradeCheckout } from "../lib/submissions";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

type Range = "day" | "week" | "month" | "year";

// One monitoring tab = one facility (site). Renewals stay in the same tab.
type FacilityTab = {
  facilityId: number;
  name: string;
  lat: number;
  lon: number;
  // Per-company tier (DASHBOARD v3): drives the Basic/Premium pill and the locked view.
  tier: "basic" | "premium";
  firstReadingDate: string | null;
  hasValidCert: boolean;
};

// Default number of daily points the "Day" view shows when the user hasn't picked one.
const DEFAULT_DAY_COUNT = 30;

type BreachRecord = {
  id: number;
  userId: number;
  readingDate: string;
  pollutant: string;
  value: number;
  threshold: number;
  regulation: string;
  detectedAt: string;
};

type Reading = {
  label: string;
  co2Ppm: number;
  ch4Ppb: number;
  esgScore: number;
  verifiedEmissionsTco2eq: number;
  ndviMean?: number | null;
  temperature?: number | null;
  humidity?: number | null;
};

type CertBaseline = {
  co2Ppm: number | null;
  ch4Ppb: number | null;
  esgScore: number | null;
  verifiedEmissionsTco2eq: number | null;
};

type MonitoringData = {
  range: Range;
  facilityId: number | null;
  days?: number;
  rows: Reading[];
  count: number;
  isLive: boolean;
  baseline: CertBaseline | null;
  firstReadingDate?: string | null;
  // locked:true means the server WITHHELD this Basic facility's real data — the UI shows
  // a blurred placeholder + upgrade CTA. tier echoes the facility's plan.
  locked?: boolean;
  tier?: "basic" | "premium" | null;
};

// Decorative placeholder series shown BLURRED behind the upgrade CTA on a locked (Basic)
// facility. It is NEVER real data, never persisted, and never sent to the server — it only
// conveys "a live chart would be here once you upgrade". Deterministic (sine/cosine on the
// point index, no randomness) so it does not flicker between renders.
function buildFakePlaceholderSeries(): Reading[] {
  const out: Reading[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const t = 29 - i;
    out.push({
      label: d.toISOString().slice(0, 10),
      co2Ppm: Math.round((412 + Math.sin(t / 3) * 9) * 10) / 10,
      ch4Ppb: Math.round(1850 + Math.cos(t / 4) * 70),
      esgScore: Math.round((72 + Math.sin(t / 5) * 6) * 10) / 10,
      verifiedEmissionsTco2eq: Math.round((12 + Math.sin(t / 6) * 3) * 10) / 10,
    });
  }
  return out;
}

// Whole days between an ISO date (YYYY-MM-DD) and today, min 1. Bounds the Day selector.
function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 1;
  const start = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(start)) return 1;
  const diff = Math.floor((Date.now() - start) / 86_400_000);
  return Math.max(1, diff);
}

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const WHO_CO2_REF = 430;
const EU_CH4_REF = 1900;

function formatLabel(label: string): string {
  // Every range now emits individual daily readings labeled as ISO date strings.
  try {
    const d = new Date(`${label}T00:00:00Z`);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return label;
  }
}

// All ranges are daily points now, so exceedance counts are always "days".
function periodLabel(): string {
  return "days";
}

function buildCsvFilename(range: Range, rows: Reading[]): string {
  const now = new Date();
  const year = now.getFullYear();
  const labels = rows.map((r) => r.label).filter(Boolean).sort();

  if (labels.length > 0) {
    if (range === "day") {
      return `carboneye-emissions-${labels[0].slice(0, 10)}.csv`;
    }
    if (range === "year") {
      const first = labels[0];
      const last = labels[labels.length - 1];
      return `carboneye-emissions-${first}_${last}.csv`;
    }
    const startDate = labels[0].slice(0, 10);
    const endDate = labels[labels.length - 1].slice(0, 10);
    return `carboneye-emissions-${startDate}_${endDate}.csv`;
  }

  if (range === "day") {
    return `carboneye-emissions-${now.toISOString().slice(0, 10)}.csv`;
  } else if (range === "week") {
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `carboneye-emissions-${year}-W${String(week).padStart(2, "0")}.csv`;
  } else if (range === "month") {
    return `carboneye-emissions-${year}-${String(now.getMonth() + 1).padStart(2, "0")}.csv`;
  }
  return `carboneye-emissions-${year}.csv`;
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportToCsv(rows: Reading[], range: Range): void {
  const headers = ["date", "co2_ppm", "ch4_ppb", "esg_score", "emissions_tco2eq", "temperature_c", "humidity_pct"];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        escapeCsvField(r.label),
        escapeCsvField(r.co2Ppm),
        escapeCsvField(r.ch4Ppb),
        escapeCsvField(r.esgScore),
        escapeCsvField(r.verifiedEmissionsTco2eq),
        escapeCsvField(r.temperature),
        escapeCsvField(r.humidity),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildCsvFilename(range, rows);
  a.click();
  URL.revokeObjectURL(url);
}

type ComplianceAlert = {
  id: string;
  regulation: string;
  shortName: string;
  exceeded: number;
  total: number;
  unit: string;
  threshold: string;
  risk: string;
  color: string;
  bg: string;
  border: string;
};

function computeAlerts(rows: Reading[]): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];
  const unit = periodLabel();
  const co2Exceeded = rows.filter((r) => r.co2Ppm > WHO_CO2_REF).length;
  const ch4Exceeded = rows.filter((r) => r.ch4Ppb > EU_CH4_REF).length;

  if (co2Exceeded > 0) {
    alerts.push({
      id: "co2",
      regulation: "WHO Air Quality Guidelines 2021",
      shortName: "CO₂ / WHO AQG 2021",
      exceeded: co2Exceeded,
      total: rows.length,
      unit,
      threshold: `${WHO_CO2_REF} ppm`,
      risk:
        "Readings above the WHO reference level indicate poor air quality. Persistent exceedances must be disclosed and can delay quarterly GHG certificate renewal.",
      color: "#c0392b",
      bg: "#fff5f5",
      border: "#f5c6c6",
    });
  }

  if (ch4Exceeded > 0) {
    alerts.push({
      id: "ch4",
      regulation: "EU Methane Regulation 2024/1787",
      shortName: "CH₄ / EU Methane Reg. 2024",
      exceeded: ch4Exceeded,
      total: rows.length,
      unit,
      threshold: `${EU_CH4_REF} ppb`,
      risk:
        "Methane above the EU Methane Regulation 2024/1787 limit signals fugitive emissions that must be reported and addressed promptly. Persistent exceedances can trigger third-party audits and delay certificate issuance.",
      color: "#b7460e",
      bg: "#fff8f0",
      border: "#f8d5b0",
    });
  }

  return alerts;
}

function AlertBanner({ alerts }: { alerts: ComplianceAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          background: "#f0faf4",
          border: "1px solid #a8d5b5",
          borderRadius: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>✅</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1a6b3c" }}>All readings within regulatory limits</div>
          <div style={{ fontSize: 11, color: "#2d8653", marginTop: 1 }}>
            CO₂ below {WHO_CO2_REF} ppm (WHO AQG 2021) · CH₄ below {EU_CH4_REF} ppb (EU Methane Reg. 2024/1787) · No action required
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={{
            background: alert.bg,
            border: `1px solid ${alert.border}`,
            borderLeft: `4px solid ${alert.color}`,
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontSize: 20, marginTop: 1 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: alert.color,
                  }}
                >
                  Threshold Exceeded — {alert.shortName}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: alert.color,
                    color: "#fff",
                    letterSpacing: "0.04em",
                  }}
                >
                  REGULATORY ALERT
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#444", lineHeight: 1.55, marginBottom: 8 }}>
                {alert.risk}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  fontSize: 11,
                  color: alert.color,
                  fontWeight: 600,
                  flexWrap: "wrap",
                }}
              >
                <span>Limit: {alert.threshold}</span>
                <span>
                  {alert.exceeded} of {alert.total} {alert.unit} above threshold
                </span>
                <span style={{ color: "#666", fontWeight: 400 }}>Regulation: {alert.regulation}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ComplianceSummary({ alerts, rows }: { alerts: ComplianceAlert[]; rows: Reading[] }) {
  const isMobile = useIsMobile();
  const co2Alert = alerts.find((a) => a.id === "co2");
  const ch4Alert = alerts.find((a) => a.id === "ch4");
  const allCompliant = alerts.length === 0;

  return (
    <div
      style={{
        background: "var(--c-white)",
        border: `1px solid ${allCompliant ? "#a8d5b5" : "#f0c0c0"}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 12,
          color: "var(--c-text)",
          marginBottom: 10,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        Compliance Summary
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 12 }}>
        <SummaryCell
          label="CO₂ above threshold"
          regulation="WHO AQG 2021 · limit: 430 ppm"
          exceeded={co2Alert?.exceeded ?? 0}
          total={rows.length}
          threshold={`${WHO_CO2_REF} ppm`}
          color={co2Alert ? "#c0392b" : "#1a6b3c"}
        />
        <SummaryCell
          label="CH₄ above threshold"
          regulation="EU Methane Reg. 2024/1787 · limit: 1900 ppb"
          exceeded={ch4Alert?.exceeded ?? 0}
          total={rows.length}
          threshold={`${EU_CH4_REF} ppb`}
          color={ch4Alert ? "#b7460e" : "#1a6b3c"}
        />
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  regulation,
  exceeded,
  total,
  threshold,
  color,
}: {
  label: string;
  regulation: string;
  exceeded: number;
  total: number;
  threshold: string;
  color: string;
}) {
  const compliant = exceeded === 0;
  const pct = total > 0 ? Math.round((exceeded / total) * 100) : 0;

  return (
    <div
      style={{
        background: compliant ? "#f0faf4" : "#fff5f5",
        border: `1px solid ${compliant ? "#a8d5b5" : "#f5c6c6"}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>{regulation}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
        {exceeded}
        <span style={{ fontSize: 12, fontWeight: 500, color: "#888", marginLeft: 4 }}>
          / {total} readings
        </span>
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
        {compliant ? (
          <span style={{ color: "#1a6b3c", fontWeight: 600 }}>✓ All within limit ({threshold})</span>
        ) : (
          <span style={{ color }}>
            {pct}% of readings exceed {threshold}
          </span>
        )}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 14,
        padding: "20px 20px 12px",
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--c-text)" }}>{title}</div>
        {hint && (
          <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>{hint}</div>
        )}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    background: "var(--c-white)",
    border: "1px solid var(--c-border)",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { fontWeight: 700, color: "var(--c-text)", marginBottom: 4 },
};

function BasicUpgradeCard({
  onUpgrade,
  loading,
  error,
}: {
  onUpgrade: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div
      style={{
        background: "#f0faf4",
        border: "1px solid var(--c-border-mid)",
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 14, color: "var(--c-text)", marginBottom: 4 }}>
          This company is on the Basic plan
        </div>
        <div style={{ fontSize: 12, color: "var(--c-text-muted)", lineHeight: 1.5 }}>
          We are already collecting daily emissions data for this company — it is just hidden.
          Upgrade to Premium to unlock the full dashboard (every reading collected so far, plus all
          future days). This does not require a new certificate; your existing certificate stays valid.
        </div>
        {error && <div style={{ color: "var(--c-danger)", fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        disabled={loading}
        style={{
          background: "var(--c-green-dark)",
          border: "1px solid var(--c-green-dark)",
          color: "#fff",
          borderRadius: 8,
          padding: "10px 14px",
          cursor: loading ? "wait" : "pointer",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Opening..." : "Upgrade to Premium"}
      </button>
    </div>
  );
}

export function MonitoringTab() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<Range>("day");
  const [dayCount, setDayCount] = useState<number>(DEFAULT_DAY_COUNT);
  const [facilities, setFacilities] = useState<FacilityTab[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | null>(null);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breaches, setBreaches] = useState<BreachRecord[]>([]);
  const [breachesLoading, setBreachesLoading] = useState(true);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [renewLoading, setRenewLoading] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);

  // Upgrade THIS facility (per-company). Opens a new paid Stripe Checkout; on return the
  // success page reconciles it and the facility's data unlocks. No new certificate.
  const upgrade = async () => {
    if (selectedFacilityId == null) return;
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const checkout = await startUpgradeCheckout(selectedFacilityId);
      window.location.href = checkout.url;
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : String(err));
      setUpgradeLoading(false);
    }
  };

  const renew = async () => {
    if (selectedFacilityId == null) return;
    setRenewLoading(true);
    setRenewError(null);
    try {
      const checkout = await startRenewCheckout(selectedFacilityId);
      window.location.href = checkout.url;
    } catch (err) {
      setRenewError(err instanceof Error ? err.message : String(err));
      setRenewLoading(false);
    }
  };

  // Load the user's facilities (tabs) once, then select the first.
  useEffect(() => {
    setFacilitiesLoading(true);
    fetch("/api/monitoring/facilities", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const list: FacilityTab[] = d.facilities ?? [];
        setFacilities(list);
        setSelectedFacilityId((prev) => prev ?? (list[0]?.facilityId ?? null));
        setFacilitiesLoading(false);
      })
      .catch(() => setFacilitiesLoading(false));
  }, []);

  // The currently-selected facility and the max selectable days (since its first reading).
  const selectedFacility = facilities.find((f) => f.facilityId === selectedFacilityId) ?? null;
  const maxDays = daysSince(selectedFacility?.firstReadingDate ?? data?.firstReadingDate ?? null);

  // Fetch chart data for the selected facility, range, and (for Day) day count.
  useEffect(() => {
    if (selectedFacilityId == null) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    const daysParam = range === "day" ? `&days=${Math.max(1, dayCount)}` : "";
    fetch(`/api/monitoring?facilityId=${selectedFacilityId}&range=${range}${daysParam}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load monitoring data");
        setLoading(false);
      });
  }, [selectedFacilityId, range, dayCount]);

  // Breach history for the selected facility tab.
  useEffect(() => {
    if (selectedFacilityId == null) {
      setBreaches([]);
      setBreachesLoading(false);
      return;
    }
    setBreachesLoading(true);
    fetch(`/api/monitoring/breaches?facilityId=${selectedFacilityId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setBreaches(d.breaches ?? []);
        setBreachesLoading(false);
      })
      .catch(() => {
        setBreachesLoading(false);
      });
  }, [selectedFacilityId]);

  const hasNoFacilities = !facilitiesLoading && facilities.length === 0;
  // Locked = the server WITHHELD this Basic facility's data. It is NOT "empty" (data is
  // accumulating, just hidden), so the locked view is handled before the empty state.
  const isLocked = data?.locked === true;
  const isEmpty = !loading && !hasNoFacilities && !isLocked && (!data || data.rows.length === 0);

  // Real chart data for Premium facilities; the blurred placeholder for locked ones is
  // generated separately so real and decorative data never mix.
  const chartData = (data?.rows ?? []).map((r) => ({
    ...r,
    label: formatLabel(r.label),
  }));
  const fakeChartData = buildFakePlaceholderSeries().map((r) => ({
    ...r,
    label: formatLabel(r.label),
  }));

  const alerts = computeAlerts(data?.rows ?? []);

  return (
    <div>
      {/* Facility tabs — one per monitored site. A renewal stays in the same tab and
          its readings keep accumulating. */}
      {facilities.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 16,
            borderBottom: "1px solid var(--c-border)",
            paddingBottom: 10,
          }}
        >
          {facilities.map((f) => {
            const active = selectedFacilityId === f.facilityId;
            return (
              <button
                key={f.facilityId}
                type="button"
                onClick={() => setSelectedFacilityId(f.facilityId)}
                title={`${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px 8px 0 0",
                  border: `1px solid ${active ? "var(--c-green-mid)" : "var(--c-border)"}`,
                  borderBottom: active ? "2px solid var(--c-green-dark)" : "1px solid var(--c-border)",
                  background: active ? "#e6f7ec" : "var(--c-white)",
                  color: active ? "var(--c-green-dark)" : "var(--c-text-muted)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    maxWidth: isMobile ? 120 : 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    verticalAlign: "middle",
                  }}
                >
                  {f.name}
                </span>
                {/* Per-company plan pill — Premium tabs are unlocked, Basic tabs are blurred. */}
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    padding: "1px 6px",
                    borderRadius: 999,
                    border: `1px solid ${f.tier === "premium" ? "var(--c-green-dark)" : "var(--c-border-mid)"}`,
                    background: f.tier === "premium" ? "var(--c-green-dark)" : "var(--c-white)",
                    color: f.tier === "premium" ? "#fff" : "var(--c-text-muted)",
                  }}
                >
                  {f.tier === "premium" ? "Premium" : "Basic"}
                </span>
                {!f.hasValidCert && (
                  <span
                    style={{ marginLeft: 6, fontSize: 9, color: "#b7791f" }}
                    title="Certificate expired — renew to resume daily monitoring"
                  >
                    ⚠ expired
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>
            Continuous Monitoring
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--c-text)" }}>
            Emissions dashboard
          </h3>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRange(opt.value)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: `1px solid ${range === opt.value ? "var(--c-green-mid)" : "var(--c-border)"}`,
                background: range === opt.value ? "#e6f7ec" : "var(--c-white)",
                color: range === opt.value ? "var(--c-green-dark)" : "var(--c-text-muted)",
                fontWeight: range === opt.value ? 700 : 400,
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: "0.03em",
              }}
            >
              {opt.label}
            </button>
          ))}
          {data && data.rows.length > 0 && (
            <button
              type="button"
              onClick={() => exportToCsv(data.rows, range)}
              title={`Download ${buildCsvFilename(range, data.rows)}`}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid var(--c-green-mid)",
                background: "var(--c-green-dark)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: "0.03em",
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginLeft: 6,
              }}
            >
              ↓ Export CSV
            </button>
          )}
          {selectedFacilityId != null && (
            <button
              type="button"
              onClick={renew}
              disabled={renewLoading}
              title="Request a new certificate for this facility (paid). Data continues in this tab."
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid var(--c-green-mid)",
                background: "var(--c-white)",
                color: "var(--c-green-dark)",
                fontWeight: 700,
                fontSize: 12,
                cursor: renewLoading ? "default" : "pointer",
                letterSpacing: "0.03em",
                marginLeft: 6,
              }}
            >
              {renewLoading ? "Opening…" : "⟳ Renew certificate"}
            </button>
          )}
        </div>
      </div>

      {renewError && (
        <div className="alert alert-err" style={{ marginBottom: 12 }}>{renewError}</div>
      )}

      {range === "day" && facilities.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            fontSize: 12,
            color: "var(--c-text-muted)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 600 }}>Show last</span>
          <input
            type="range"
            min={1}
            max={maxDays}
            value={Math.min(dayCount, maxDays)}
            onChange={(e) => setDayCount(Number(e.target.value))}
            style={{ flex: "0 0 200px" }}
          />
          <input
            type="number"
            min={1}
            max={maxDays}
            value={Math.min(dayCount, maxDays)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setDayCount(Math.min(Math.max(1, Math.floor(n)), maxDays));
            }}
            style={{ width: 64, padding: "4px 6px", border: "1px solid var(--c-border)", borderRadius: 6 }}
          />
          <span>day(s) · up to {maxDays} since first certificate</span>
        </div>
      )}

      {!data?.isLive && !isEmpty && !hasNoFacilities && !isLocked && (
        <div
          style={{
            padding: "6px 10px",
            background: "#fff7e6",
            border: "1px dashed #fdcb6e",
            borderRadius: 6,
            fontSize: 11,
            color: "#7a5a00",
            fontFamily: "var(--font-mono)",
            marginBottom: 18,
            display: "inline-block",
          }}
        >
          DEMO MODE — simulated data. Connect a real IoT feed via POST /api/monitoring to remove this notice.
        </div>
      )}
      {data?.isLive && !isLocked && (
        <div
          style={{
            padding: "6px 10px",
            background: "#f0faf4",
            border: "1px solid #a8d5b5",
            borderRadius: 6,
            fontSize: 11,
            color: "#1a6b3c",
            fontFamily: "var(--font-mono)",
            marginBottom: 18,
            display: "inline-block",
          }}
        >
          ● LIVE — receiving real IoT / external feed data
        </div>
      )}

      {/* Locked (Basic) facility: the server withheld the real data, so we show the four
          charts BLURRED behind an upgrade CTA. The series is a client-side decorative
          placeholder (buildFakePlaceholderSeries) — never real, never persisted. */}
      {isLocked && !loading && !facilitiesLoading && !error && (
        <div style={{ position: "relative" }}>
          <div
            aria-hidden
            style={{
              filter: "blur(6px)",
              pointerEvents: "none",
              userSelect: "none",
              opacity: 0.7,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 18 }}>
              <ChartCard title="CO₂ Concentration (ppm)" hint="Unlock with Premium">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={fakeChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <Line type="monotone" dataKey="co2Ppm" stroke="#00b894" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="CH₄ Concentration (ppb)" hint="Unlock with Premium">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={fakeChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <Line type="monotone" dataKey="ch4Ppb" stroke="#0984e3" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 18 }}>
              <ChartCard title="ESG Score trend" hint="Unlock with Premium">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={fakeChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Line type="monotone" dataKey="esgScore" stroke="#6c5ce7" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Verified Emissions (tCO₂eq/day)" hint="Unlock with Premium">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={fakeChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Bar dataKey="verifiedEmissionsTco2eq" fill="#55efc4" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
          {/* The only interactive element on a locked facility: the upgrade CTA. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div style={{ maxWidth: 560, width: "100%" }}>
              <BasicUpgradeCard onUpgrade={upgrade} loading={upgradeLoading} error={upgradeError} />
            </div>
          </div>
        </div>
      )}

      {(loading || facilitiesLoading) && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--c-text-muted)", fontSize: 13 }}>
          Loading monitoring data…
        </div>
      )}

      {error && (
        <div className="alert alert-err">{error}</div>
      )}

      {(isEmpty || hasNoFacilities) && !loading && !facilitiesLoading && !error && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            background: "var(--c-white)",
            border: "1px solid var(--c-border)",
            borderRadius: 14,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--c-text)", marginBottom: 8 }}>
            No monitoring data yet
          </div>
          <div style={{ fontSize: 13, color: "var(--c-text-muted)", maxWidth: 360, margin: "0 auto" }}>
            Get your first certificate to start monitoring.
            Your first real data point appears the moment your certificate is issued — charts fill in daily as the pipeline collects fresh readings.
          </div>
        </div>
      )}

      {!loading && !facilitiesLoading && !isEmpty && !hasNoFacilities && !isLocked && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <AlertBanner alerts={alerts} />
          <ComplianceSummary alerts={alerts} rows={data?.rows ?? []} />

          <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 18 }}>
            <ChartCard
              title="CO₂ Concentration (ppm)"
              hint={`WHO AQG 2021 limit at 430 ppm${data?.baseline?.co2Ppm ? ` · Certificate baseline: ${data.baseline.co2Ppm} ppm` : ""}`}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} ppm`, "CO₂"]} />
                  <ReferenceLine y={WHO_CO2_REF} stroke="#e17055" strokeDasharray="4 2" label={{ value: "WHO 430", fontSize: 9, fill: "#e17055" }} />
                  {data?.baseline?.co2Ppm != null && (
                    <ReferenceLine y={data.baseline.co2Ppm} stroke="#0984e3" strokeDasharray="6 3" label={{ value: `Cert. ${data.baseline.co2Ppm}`, fontSize: 9, fill: "#0984e3" }} />
                  )}
                  <Line type="monotone" dataKey="co2Ppm" stroke="#00b894" strokeWidth={2} dot={false} name="CO₂ (ppm)" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="CH₄ Concentration (ppb)"
              hint={`EU Methane Regulation 2024 limit at 1900 ppb${data?.baseline?.ch4Ppb ? ` · Certificate baseline: ${data.baseline.ch4Ppb} ppb` : ""}`}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} ppb`, "CH₄"]} />
                  <ReferenceLine y={EU_CH4_REF} stroke="#e17055" strokeDasharray="4 2" label={{ value: "EU 1900", fontSize: 9, fill: "#e17055" }} />
                  {data?.baseline?.ch4Ppb != null && (
                    <ReferenceLine y={data.baseline.ch4Ppb} stroke="#0984e3" strokeDasharray="6 3" label={{ value: `Cert. ${data.baseline.ch4Ppb}`, fontSize: 9, fill: "#0984e3" }} />
                  )}
                  <Line type="monotone" dataKey="ch4Ppb" stroke="#0984e3" strokeWidth={2} dot={false} name="CH₄ (ppb)" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 18 }}>
            <ChartCard
              title="ESG Score trend"
              hint={`Higher is better — 100 is best${data?.baseline?.esgScore != null ? ` · Certificate baseline: ${data.baseline.esgScore}` : ""}`}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}`, "ESG Score"]} />
                  <ReferenceLine y={50} stroke="#fdcb6e" strokeDasharray="4 2" label={{ value: "Floor 50", fontSize: 9, fill: "#b7791f" }} />
                  {data?.baseline?.esgScore != null && (
                    <ReferenceLine y={data.baseline.esgScore} stroke="#0984e3" strokeDasharray="6 3" label={{ value: `Cert. ${data.baseline.esgScore}`, fontSize: 9, fill: "#0984e3" }} />
                  )}
                  <Line type="monotone" dataKey="esgScore" stroke="#6c5ce7" strokeWidth={2} dot={false} name="ESG Score" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Verified Emissions (tCO₂eq/day)"
              hint="Daily equivalent emissions based on certificate baseline"
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} tCO₂eq`, "Emissions"]} />
                  <Bar dataKey="verifiedEmissionsTco2eq" fill="#55efc4" name="tCO₂eq" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {chartData.some((r) => r.temperature != null) && (
            <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 18 }}>
              <ChartCard title="Temperature (°C)" hint="IoT ground sensor average">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} °C`, "Temp"]} />
                    <Line type="monotone" dataKey="temperature" stroke="#fd79a8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Humidity (%)" hint="IoT ground sensor average">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8ede9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Humidity"]} />
                    <Line type="monotone" dataKey="humidity" stroke="#74b9ff" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}

          <div
            style={{
              fontSize: 11,
              color: "var(--c-text-muted)",
              textAlign: "center",
              paddingTop: 4,
            }}
          >
            Data refreshes on page load · {data?.count ?? 0} readings in selected period ·
            Reference lines: WHO AQG 2021, EU Methane Regulation 2024/1787
          </div>
        </div>
      )}

      {/* Breach history reveals measured data, so it is hidden for locked Basic facilities
          (the server also returns an empty list for them). */}
      {!isLocked && <BreachHistory breaches={breaches} loading={breachesLoading} />}
    </div>
  );
}

function BreachHistory({ breaches, loading }: { breaches: BreachRecord[]; loading: boolean }) {
  const co2Breaches = breaches.filter((b) => b.pollutant === "co2");
  const ch4Breaches = breaches.filter((b) => b.pollutant === "ch4");

  return (
    <div
      style={{
        marginTop: 32,
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 14,
        padding: "20px 24px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginBottom: 2 }}>
          Audit & Compliance
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--c-text)" }}>
          Breach History
        </h3>
        <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 4 }}>
          Persistent log of all regulatory threshold violations · Retained for 12 months · For audit and certificate renewal
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "28px 0", color: "var(--c-text-muted)", fontSize: 13 }}>
          Loading breach history…
        </div>
      )}

      {!loading && breaches.length === 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            background: "#f0faf4",
            border: "1px solid #a8d5b5",
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#1a6b3c" }}>No breaches recorded in the past 12 months</div>
            <div style={{ fontSize: 11, color: "#2d8653", marginTop: 1 }}>
              All IoT readings were within WHO CO₂ (430 ppm) and EU CH₄ (1900 ppb) limits.
            </div>
          </div>
        </div>
      )}

      {!loading && breaches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div
              style={{
                padding: "10px 16px",
                background: "#fff5f5",
                border: "1px solid #f5c6c6",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700, color: "#c0392b" }}>CO₂ exceedances: </span>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#c0392b" }}>{co2Breaches.length}</span>
              <span style={{ color: "#888", marginLeft: 4 }}>in past 12 months</span>
            </div>
            <div
              style={{
                padding: "10px 16px",
                background: "#fff8f0",
                border: "1px solid #f8d5b0",
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700, color: "#b7460e" }}>CH₄ exceedances: </span>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#b7460e" }}>{ch4Breaches.length}</span>
              <span style={{ color: "#888", marginLeft: 4 }}>in past 12 months</span>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ background: "#f8f9fa", borderBottom: "2px solid var(--c-border)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    DATE
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    POLLUTANT
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    VALUE
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    LIMIT
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    REGULATION
                  </th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "var(--c-text)", fontSize: 11, letterSpacing: "0.04em" }}>
                    RECORDED
                  </th>
                </tr>
              </thead>
              <tbody>
                {breaches.map((b, i) => {
                  const isCo2 = b.pollutant === "co2";
                  const color = isCo2 ? "#c0392b" : "#b7460e";
                  const bg = i % 2 === 0 ? "var(--c-white)" : "#fafafa";
                  const unit = isCo2 ? "ppm" : "ppb";
                  const label = isCo2 ? "CO₂" : "CH₄";
                  const excess = (b.value - b.threshold).toFixed(1);
                  return (
                    <tr key={b.id} style={{ background: bg, borderBottom: "1px solid var(--c-border)" }}>
                      <td style={{ padding: "8px 12px", color: "var(--c-text)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {b.readingDate}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 99,
                            background: isCo2 ? "#fff5f5" : "#fff8f0",
                            border: `1px solid ${isCo2 ? "#f5c6c6" : "#f8d5b0"}`,
                            color,
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        >
                          {label}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color, fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {b.value.toFixed(1)} {unit}
                        <span style={{ fontWeight: 400, color: "#999", fontSize: 10, marginLeft: 4 }}>+{excess}</span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#888", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {b.threshold} {unit}
                      </td>
                      <td style={{ padding: "8px 12px", color: "var(--c-text-muted)", fontSize: 11 }}>
                        {b.regulation}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#aaa", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                        {new Date(b.detectedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
