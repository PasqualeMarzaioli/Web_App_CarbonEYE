/**
 * artifacts/api-server/src/routes/analyze.ts — Analysis endpoints that trigger synchronous certificate generation (admin-only) for single facilities or batch supply-chain analysis, with certificate enrichment and data source normalization.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter, type Response } from "express";
import { createHash } from "node:crypto";
import { db, submissionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { AzureFunctionError, callAnalyze, callCertificatePdf, callVerify } from "../lib/azureFunctions";
import { findCertificate } from "../lib/cosmos";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function monitoringPeriodFrom(ts?: string): { start: string; end: string } {
  const d = ts ? new Date(ts) : new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Computes the certificate validity timestamp. Do not use monitoring_period.end:
// that field describes the historical analysis window and may end at issuance.
// valid_until drives monitored-companies filtering for Premium daily collection.
// CarbonEYE certificates are valid until the end of the issuance quarter:
// Q1 Mar 31, Q2 Jun 30, Q3 Sep 30, Q4 Dec 31.
function computeValidUntil(issuanceTs: string): string {
  const d = new Date(issuanceTs);
  const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  const quarterEnd = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999));
  return quarterEnd.toISOString();
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

function computeAggregatedHash(payload: Record<string, unknown>): string {
  const { data_hash: _h, blockchain_hash: _b, ...rest } = payload;
  return createHash("sha256").update(canonicalize(rest)).digest("hex");
}

function positiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function enrichCertificate(cert: Record<string, unknown>): Record<string, unknown> {
  const score = Number(cert.esg_score) || 0;
  const co2 = positiveNumber(cert.iot_co2_mean, cert.co2_ppm) ?? 420;
  const ch4 = positiveNumber(cert.iot_ch4_mean, cert.ch4_ppb) ?? 1900;
  const baseEmissions = Math.max(
    800,
    Math.round((100 - score) * 250 + (co2 - 400) * 4 + (ch4 - 1800) * 0.4),
  );
  const chain = cert.chain as { facility_count?: number } | undefined;
  const mult = chain?.facility_count ?? 1;
  // Prefer the value computed by the Python pipeline; only fall back to a local
  // estimate when the pipeline genuinely did not provide one (legacy certs).
  const certEmissions = Number(cert.verified_emissions_tco2eq);
  const verifiedEmissions = Number.isFinite(certEmissions) && certEmissions > 0
    ? certEmissions
    : baseEmissions * mult;
  const ts = String(cert.timestamp ?? new Date().toISOString());
  // Only the sources CarbonEYE actually consumes are surfaced here: Sentinel-2
  // (satellite indices), Open-Meteo (weather + AQ proxies), and ICOS (direct
  // CH4/CO2). CAMS / OpenAQ / EEA were removed from the pipeline.
  const defaultSources = [
    { source: "sentinel-2", label: "Sentinel-2", status: "ok", last_updated: ts },
    { source: "open-meteo", label: "Open-Meteo", status: "ok", last_updated: ts },
    { source: "icos", label: "ICOS", status: "missing", last_updated: ts },
  ];
  const dataSources = Array.isArray(cert.data_sources)
    ? cert.data_sources
        .map((source) => {
          if (source && typeof source === "object") return source;
          const label = String(source).toLowerCase();
          if (label.includes("sentinel-2") || label.includes("prisma")) return defaultSources[0];
          if (label.includes("open-meteo") || label.includes("weather") || label.includes("wind")) return defaultSources[1];
          if (label.includes("icos") || label.includes("iot") || label.includes("ground")) return { ...defaultSources[2], status: "ok" };
          if (label.includes("sentinel-5") || label.includes("s5p")) {
            return { source: "sentinel-5p", label: "Sentinel-5P", status: "ok", last_updated: ts };
          }
          return null;
        })
        .filter((entry): entry is { source: string; label?: string; status: string; last_updated: string } => entry !== null)
    : defaultSources;
  const dataHash = (cert.data_hash ?? cert.hash) as string | undefined;
  const monitoringPeriod = cert.monitoring_period ?? monitoringPeriodFrom(ts);
  const enriched: Record<string, unknown> = {
    ...cert,
    verified_emissions_tco2eq: verifiedEmissions,
    monitoring_period: monitoringPeriod,
    // valid_until drives the monitored-companies endpoint — the daily Python
    // timer stops collecting once this timestamp passes.
    valid_until: computeValidUntil(ts),
    data_sources: dataSources,
    methodology: "CarbonEYE v1.0 — multi-source ESG aggregation",
  };
  if (dataHash) {
    enriched.data_hash = dataHash;
    enriched.blockchain_hash = `0x${dataHash.slice(0, 40)}`;
  }
  return enriched;
}

async function analyzeOne(input: { company_name: string; lat: number; lon: number }, userId: number) {
  return callAnalyze(input, userId);
}

function sendAnalyzeError(res: Response, err: unknown): void {
  if (err instanceof AzureFunctionError) {
    res.status(err.status).json({
      error: err.message,
      upstreamStatus: err.upstreamStatus,
      details: err.details,
    });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err: msg }, "Analyze request failed");
  res.status(502).json({ error: "Analysis pipeline unavailable", details: msg });
}

// Direct synchronous analysis is an admin-only tool. Regular users never
// generate certificates themselves — they submit a request and the CarbonEYE
// admin team runs the analysis and issues the certificate (human-in-the-loop).
router.post("/analyze", requireAdmin, async (req, res) => {
  const { company_name, lat, lon } = req.body ?? {};
  if (typeof company_name !== "string" || !company_name.trim()) {
    res.status(400).json({ error: "company_name is required" });
    return;
  }
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
    res.status(400).json({ error: "lat and lon must be numbers" });
    return;
  }
  try {
    const raw = await analyzeOne(
      { company_name: company_name.trim(), lat: latNum, lon: lonNum },
      req.session!.userId,
    );
    if (!raw?.data_hash && !raw?.hash) {
      logger.error({ certId: raw?.certificate_id }, "Upstream pipeline returned no data_hash");
      res.status(502).json({
        error: "Pipeline returned no data_hash",
        details: "Integrity hash missing from upstream response; refusing to fabricate one.",
      });
      return;
    }
    const certificate = enrichCertificate(raw);
    res.json(certificate);
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

function gradeFromScore(s: number): string {
  if (s >= 90) return "A+";
  if (s >= 80) return "A";
  if (s >= 72) return "B+";
  if (s >= 65) return "B";
  if (s >= 58) return "C+";
  if (s >= 50) return "C";
  if (s >= 40) return "D";
  return "F";
}

// Batch (supply-chain) synchronous analysis — admin-only, same rationale as /analyze.
router.post("/analyze/batch", requireAdmin, async (req, res) => {
  const { company_name, facilities } = req.body ?? {};
  if (typeof company_name !== "string" || !company_name.trim()) {
    res.status(400).json({ error: "company_name is required" });
    return;
  }
  if (!Array.isArray(facilities) || facilities.length === 0) {
    res.status(400).json({ error: "facilities array required" });
    return;
  }
  const targets = facilities
    .map((f: { name?: string; role?: string; lat: number | string; lon: number | string }) => ({
      name: String(f.name ?? "").trim(),
      role: typeof f.role === "string" ? f.role : undefined,
      lat: Number(f.lat),
      lon: Number(f.lon),
    }))
    .filter((t) => t.name && !Number.isNaN(t.lat) && !Number.isNaN(t.lon));
  if (targets.length === 0) {
    res.status(400).json({ error: "no valid facilities" });
    return;
  }

  const breakdown = await Promise.all(
    targets.map(async (t) => {
      const a = await analyzeOne({ company_name: t.name, lat: t.lat, lon: t.lon }, req.session!.userId);
      return { facility: t, analysis: a };
    }),
  );

  const scores = breakdown.map((b) => Number(b.analysis.esg_score) || 0);
  const avg = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
  const min = Math.min(...scores);
  const weighted = Math.round(avg * 0.6 + min * 0.4);
  const allAnoms: { code?: string; severity?: string; description?: string; facility?: string }[] = [];
  for (const b of breakdown) {
    const arr = (b.analysis.anomalies as { code: string; severity: string; description: string }[]) ?? [];
    for (const a of arr) allAnoms.push({ ...a, facility: b.facility.name });
  }
  const compKeys = ["csrd_2026", "eu_taxonomy", "esrs_e1"] as const;
  const compliance: Record<string, string> = {};
  for (const k of compKeys) {
    const all = breakdown.map((b) => String((b.analysis.compliance as Record<string, string>)?.[k] ?? "non-compliant"));
    compliance[k] = all.every((v) => v === "compliant") ? "compliant" : "non-compliant";
  }
  const seed = Date.now().toString(36).toUpperCase().slice(-6);
  const certificateId = `CE-CHAIN-${seed}`;
  const isDemo = breakdown.some((b) => b.analysis.demo_mode === true);

  const aggregated = {
    esg_score: weighted,
    esg_grade: gradeFromScore(weighted),
    timestamp: new Date().toISOString(),
    ndvi_mean: Number((breakdown.reduce((s, b) => s + (Number(b.analysis.ndvi_mean) || 0), 0) / breakdown.length).toFixed(3)),
    ndwi_mean: Number((breakdown.reduce((s, b) => s + (Number(b.analysis.ndwi_mean) || 0), 0) / breakdown.length).toFixed(3)),
    nbr_mean: Number((breakdown.reduce((s, b) => s + (Number(b.analysis.nbr_mean) || 0), 0) / breakdown.length).toFixed(3)),
    ch4_ppb: Math.round(breakdown.reduce((s, b) => s + (Number(b.analysis.ch4_ppb) || 0), 0) / breakdown.length),
    co2_ppm: Math.round(breakdown.reduce((s, b) => s + (Number(b.analysis.co2_ppm) || 0), 0) / breakdown.length),
    iot_co2_mean: Math.round(breakdown.reduce((s, b) => s + (Number(b.analysis.iot_co2_mean) || 0), 0) / breakdown.length),
    iot_ch4_mean: Math.round(breakdown.reduce((s, b) => s + (Number(b.analysis.iot_ch4_mean) || 0), 0) / breakdown.length),
    iot_temperature_mean: Number((breakdown.reduce((s, b) => s + (Number(b.analysis.iot_temperature_mean) || 0), 0) / breakdown.length).toFixed(1)),
    iot_humidity_mean: Number((breakdown.reduce((s, b) => s + (Number(b.analysis.iot_humidity_mean) || 0), 0) / breakdown.length).toFixed(1)),
    num_iot_sensors: breakdown.reduce((s, b) => s + (Number(b.analysis.num_iot_sensors) || 0), 0),
    anomalies: allAnoms,
    compliance,
    certificate_id: certificateId,
    demo_mode: isDemo,
    chain: {
      lead_company: company_name.trim(),
      facility_count: breakdown.length,
      score_avg: avg,
      score_min: min,
      facilities: breakdown.map((b) => ({
        name: b.facility.name,
        role: b.facility.role,
        lat: b.facility.lat,
        lon: b.facility.lon,
        esg_score: b.analysis.esg_score,
        esg_grade: b.analysis.esg_grade,
      })),
    },
  };
  const aggregatedWithHash = {
    ...aggregated,
    data_hash: computeAggregatedHash(aggregated as Record<string, unknown>),
  };
  res.json(enrichCertificate(aggregatedWithHash));
});

async function findPreviousCertificate(
  companyName: string,
  beforeIso: string,
  excludeCertId: string,
): Promise<{ certificate: unknown; issued_at: Date | string } | null> {
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(
      sql`${submissionsTable.status} = 'certified'
          AND ${submissionsTable.companyName} = ${companyName}
          AND ${submissionsTable.certificate}->>'certificate_id' <> ${excludeCertId}
          AND COALESCE(${submissionsTable.certificate}->>'timestamp', '') < ${beforeIso}`,
    )
    .orderBy(sql`COALESCE(${submissionsTable.certificate}->>'timestamp', '') DESC`)
    .limit(1);
  const r = rows[0];
  if (!r || !r.certificate) return null;
  return { certificate: r.certificate, issued_at: r.updatedAt };
}

router.get("/certificate/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(
      sql`${submissionsTable.status} = 'certified' AND ${submissionsTable.certificate}->>'certificate_id' = ${id}`,
    )
    .limit(1);
  const row = rows[0];
  if (row?.certificate) {
    const ts = (row.certificate as { timestamp?: string } | null)?.timestamp ?? new Date().toISOString();
    const previous = await findPreviousCertificate(row.companyName, ts, id);
    res.json({
      certificate_id: id,
      company_name: row.companyName,
      issued_at: row.updatedAt,
      certificate: row.certificate,
      previous,
    });
    return;
  }
  const record = await findCertificate(id);
  if (!record) {
    res.status(404).json({ error: "Certificate not found" });
    return;
  }
  const ts = (record.payload as { timestamp?: string } | null)?.timestamp ?? new Date().toISOString();
  const previous = await findPreviousCertificate(record.company_name, ts, id);
  const certificate = enrichCertificate(record.payload ?? record);
  res.json({
    certificate_id: record.certificate_id,
    company_name: record.company_name,
    issued_at: record.issued_at,
    certificate,
    previous,
  });
});

router.get("/certificate/:id/pdf", requireAuth, async (req, res) => {
  const rawId = req.params.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  const session = req.session!;
  if (session.role !== "admin") {
    const rows = await db
      .select({ userId: submissionsTable.userId })
      .from(submissionsTable)
      .where(
        sql`${submissionsTable.status} = 'certified' AND ${submissionsTable.certificate}->>'certificate_id' = ${id}`,
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Certificate not found" });
      return;
    }
    if (row.userId !== session.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  try {
    const result = await callCertificatePdf(id);
    res.json(result);
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

router.get("/verify/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  try {
    const result = await callVerify(id);
    res.json(result);
  } catch (err) {
    sendAnalyzeError(res, err);
  }
});

export default router;
