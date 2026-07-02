/**
 * artifacts/api-server/src/routes/monitoring.ts — Monitoring endpoints for emissions readings ingestion, facility management, and authenticated access to historical ESG data with Premium/Basic data access gating.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  emissionsReadingsTable,
  breachLogTable,
  facilitiesTable,
  submissionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logBreachesForReadings } from "../lib/breachLogger";

const router: IRouter = Router();

type Range = "day" | "week" | "month" | "year";

const DEFAULT_RATE_LIMIT_RPM = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
const tokenBuckets = new Map<string, { remaining: number; resetAt: number }>();

// How far back each range window reaches. Every range now returns RAW DAILY readings
// (no ISO-week / calendar-month aggregation) — only the window width changes:
//   day   → last `dayCount` days (user-controlled; 1 .. days-since-first-certificate)
//   week  → last 7 days
//   month → same day of the previous month
//   year  → same day of the previous year
function startDateFor(range: Range, dayCount: number): string {
  const d = new Date();
  if (range === "day") d.setDate(d.getDate() - Math.max(1, dayCount));
  else if (range === "week") d.setDate(d.getDate() - 7);
  else if (range === "month") d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.MONITORING_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "Monitoring ingest is not configured. Set the MONITORING_API_KEY environment secret to enable this endpoint.",
    });
    return;
  }
  const internalHeader = req.headers["x-monitoring-api-key"];
  const authHeader = req.headers["authorization"];
  const provided =
    typeof internalHeader === "string" && internalHeader.trim()
      ? internalHeader.trim()
      : typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";
  if (!provided) {
    res.status(401).json({
      error: "Missing monitoring API key. Use x-monitoring-api-key or Authorization: Bearer <MONITORING_API_KEY>.",
    });
    return;
  }
  if (provided !== apiKey) {
    res.status(403).json({ error: "Invalid API key." });
    return;
  }
  res.locals.monitoringApiKey = provided;
  next();
}

function monitoringRateLimit(req: Request, res: Response, next: NextFunction): void {
  const rpmRaw = Number(process.env.MONITORING_RATE_LIMIT_RPM ?? DEFAULT_RATE_LIMIT_RPM);
  const rpm = Number.isFinite(rpmRaw) && rpmRaw > 0 ? Math.floor(rpmRaw) : DEFAULT_RATE_LIMIT_RPM;
  const key = String(res.locals.monitoringApiKey ?? "unknown");
  const now = Date.now();
  const current = tokenBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { remaining: rpm, resetAt: now + RATE_LIMIT_WINDOW_MS }
      : current;

  if (bucket.remaining <= 0) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "Monitoring ingest rate limit exceeded.",
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  bucket.remaining -= 1;
  tokenBuckets.set(key, bucket);
  res.setHeader("X-RateLimit-Limit", String(rpm));
  res.setHeader("X-RateLimit-Remaining", String(bucket.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  next();
}

type IngestReading = {
  user_id: number;
  facility_id: number;
  date: string;
  co2_ppm: number;
  ch4_ppb: number;
  esg_score: number;
  verified_emissions_tco2eq: number;
  ndvi_mean?: number | null;
  temperature?: number | null;
  humidity?: number | null;
};

function validateReading(r: unknown, index?: number): { valid: true; reading: IngestReading } | { valid: false; error: string } {
  const prefix = index !== undefined ? `Reading[${index}]: ` : "";
  if (typeof r !== "object" || r === null) {
    return { valid: false, error: `${prefix}must be an object` };
  }
  const obj = r as Record<string, unknown>;

  const userId = Number(obj.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { valid: false, error: `${prefix}user_id must be a positive integer` };
  }
  const facilityId = Number(obj.facility_id);
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    return { valid: false, error: `${prefix}facility_id must be a positive integer` };
  }
  if (typeof obj.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date)) {
    return { valid: false, error: `${prefix}date must be a string in YYYY-MM-DD format` };
  }
  const parsedDate = new Date(`${obj.date}T00:00:00Z`);
  if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== obj.date) {
    return { valid: false, error: `${prefix}date is not a valid calendar date` };
  }
  if (typeof obj.co2_ppm !== "number" || !Number.isFinite(obj.co2_ppm)) {
    return { valid: false, error: `${prefix}co2_ppm must be a finite number` };
  }
  if (typeof obj.ch4_ppb !== "number" || !Number.isFinite(obj.ch4_ppb)) {
    return { valid: false, error: `${prefix}ch4_ppb must be a finite number` };
  }
  if (typeof obj.esg_score !== "number" || !Number.isFinite(obj.esg_score) || obj.esg_score < 0 || obj.esg_score > 100) {
    return { valid: false, error: `${prefix}esg_score must be a number between 0 and 100` };
  }
  if (typeof obj.verified_emissions_tco2eq !== "number" || !Number.isFinite(obj.verified_emissions_tco2eq)) {
    return { valid: false, error: `${prefix}verified_emissions_tco2eq must be a finite number` };
  }

  const optionalFields: Array<{ key: string; label: string }> = [
    { key: "ndvi_mean", label: "ndvi_mean" },
    { key: "temperature", label: "temperature" },
    { key: "humidity", label: "humidity" },
  ];
  for (const { key, label } of optionalFields) {
    if (obj[key] != null) {
      const n = Number(obj[key]);
      if (!Number.isFinite(n)) {
        return { valid: false, error: `${prefix}${label} must be a finite number when provided` };
      }
    }
  }

  return {
    valid: true,
    reading: {
      user_id: userId,
      facility_id: facilityId,
      date: obj.date,
      co2_ppm: obj.co2_ppm,
      ch4_ppb: obj.ch4_ppb,
      esg_score: obj.esg_score,
      verified_emissions_tco2eq: obj.verified_emissions_tco2eq,
      ndvi_mean: obj.ndvi_mean != null ? Number(obj.ndvi_mean) : null,
      temperature: obj.temperature != null ? Number(obj.temperature) : null,
      humidity: obj.humidity != null ? Number(obj.humidity) : null,
    },
  };
}

// POST /api/monitoring — ingest one or more real readings from the Python daily
// worker. Upserts on (facilityId, date) so a re-run for the same date overwrites
// measurements rather than duplicating the row. submissionId is not updated on
// conflict — the initial certificate reading's link is preserved.
router.post("/monitoring", requireApiKey, monitoringRateLimit, async (req, res) => {
  const body = req.body;
  const items: unknown[] = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    res.status(400).json({ error: "Request body must be a reading object or a non-empty array of readings." });
    return;
  }

  if (items.length > 500) {
    res.status(400).json({ error: "Batch size limit is 500 readings per request." });
    return;
  }

  const errors: string[] = [];
  const validated: IngestReading[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = validateReading(items[i], items.length > 1 ? i : undefined);
    if (!result.valid) {
      errors.push(result.error);
    } else {
      validated.push(result.reading);
    }
  }

  if (errors.length > 0) {
    res.status(400).json({ error: "Validation failed", details: errors });
    return;
  }

  const toInsert = validated.map((r) => ({
    userId: r.user_id,
    facilityId: r.facility_id,
    submissionId: null,
    date: r.date,
    co2Ppm: r.co2_ppm,
    ch4Ppb: r.ch4_ppb,
    esgScore: r.esg_score,
    verifiedEmissionsTco2eq: r.verified_emissions_tco2eq,
    ndviMean: r.ndvi_mean ?? null,
    temperature: r.temperature ?? null,
    humidity: r.humidity ?? null,
  }));

  let inserted = 0;
  try {
    const newlyInserted: Array<{ id: number; userId: number; facilityId: number; date: string; co2Ppm: number; ch4Ppb: number }> = [];

    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      // Upsert on (facilityId, date): update measurement fields when a row for this
      // facility+date already exists (e.g. re-run of the daily worker, or a conflict
      // with the initial certificate reading). submissionId is intentionally
      // excluded from the update set to preserve the certificate link.
      const rows = await db
        .insert(emissionsReadingsTable)
        .values(batch)
        .onConflictDoUpdate({
          target: [emissionsReadingsTable.facilityId, emissionsReadingsTable.date],
          set: {
            co2Ppm: sql`excluded.co2_ppm`,
            ch4Ppb: sql`excluded.ch4_ppb`,
            esgScore: sql`excluded.esg_score`,
            verifiedEmissionsTco2eq: sql`excluded.verified_emissions_tco2eq`,
            ndviMean: sql`excluded.ndvi_mean`,
            temperature: sql`excluded.temperature`,
            humidity: sql`excluded.humidity`,
          },
        })
        .returning({
          id: emissionsReadingsTable.id,
          userId: emissionsReadingsTable.userId,
          facilityId: emissionsReadingsTable.facilityId,
          date: emissionsReadingsTable.date,
          co2Ppm: emissionsReadingsTable.co2Ppm,
          ch4Ppb: emissionsReadingsTable.ch4Ppb,
        });
      for (const row of rows) {
        newlyInserted.push({
          id: row.id,
          userId: row.userId,
          facilityId: row.facilityId,
          date: String(row.date),
          co2Ppm: row.co2Ppm,
          ch4Ppb: row.ch4Ppb,
        });
      }
      inserted += rows.length;
    }

    await logBreachesForReadings(newlyInserted);
  } catch (err) {
    console.error("[monitoring ingest] DB error:", err);
    res.status(500).json({ error: "Failed to store readings. Check server logs." });
    return;
  }

  res.status(201).json({ inserted, message: `${inserted} reading(s) stored successfully.` });
});

// GET /api/internal/monitored-companies — internal endpoint consumed by the
// Python Azure Function daily timer. Returns ONE entry per facility (monitoring
// tab) that has a currently-valid certified submission, so the worker fetches
// ground data at the correct lat/lon and POSTs readings back keyed on the facility.
// Daily collection now runs for BOTH Basic and Premium facilities (no premium gate
// here); each entry carries the facility's `tier` so the worker can group the Telegram
// summary and Basic data can be withheld at GET /api/monitoring instead.
// Auth: Bearer MONITORING_API_KEY (same key used for POST /api/monitoring).
router.get("/internal/monitored-companies", requireApiKey, async (_req, res) => {
  try {
    // Newest certified submission first within each facility, so dedup keeps the
    // most recent (renewal) coordinates and validity for the facility's tab. Join the
    // facility (not the user) so each row carries the per-company tier.
    const rows = await db
      .select({
        submissionId: submissionsTable.id,
        facilityId: submissionsTable.facilityId,
        userId: submissionsTable.userId,
        companyName: submissionsTable.companyName,
        lat: submissionsTable.lat,
        lon: submissionsTable.lon,
        certificate: submissionsTable.certificate,
        tier: facilitiesTable.tier,
      })
      .from(submissionsTable)
      .innerJoin(facilitiesTable, eq(facilitiesTable.id, submissionsTable.facilityId))
      .where(
        sql`${submissionsTable.facilityId} IS NOT NULL
          AND ${submissionsTable.status} = 'certified'
          AND (${submissionsTable.certificate}->>'valid_until')::timestamptz > now()`,
      )
      .orderBy(desc(submissionsTable.id));

    type MonitoredEntry = {
      facilityId: number;
      submissionId: number;
      userId: number;
      companyName: string;
      lat: number;
      lon: number;
      validUntil: string;
      tier: "basic" | "premium";
    };

    const seen = new Set<number>();
    const result: MonitoredEntry[] = [];
    for (const row of rows) {
      const facilityId = row.facilityId as number | null;
      if (facilityId == null || seen.has(facilityId)) continue;
      seen.add(facilityId);
      const cert = row.certificate as Record<string, unknown>;
      result.push({
        facilityId,
        submissionId: row.submissionId,
        userId: row.userId,
        companyName: row.companyName,
        lat: row.lat,
        lon: row.lon,
        validUntil: String(cert.valid_until),
        tier: row.tier === "premium" ? "premium" : "basic",
      });
    }

    res.json(result);
  } catch (err) {
    console.error("[monitored-companies] DB error:", err);
    res.status(500).json({ error: "Failed to load monitored companies." });
  }
});

// Loads the caller's facilities (one per monitoring tab). For each, the first reading
// date (used to bound the Day-view day selector) and whether it currently has a valid
// certified submission.
async function listUserFacilities(userId: number) {
  const facilities = await db
    .select({
      facilityId: facilitiesTable.id,
      name: facilitiesTable.name,
      lat: facilitiesTable.lat,
      lon: facilitiesTable.lon,
      // Per-facility tier — the UI uses it for the Basic/Premium pill and to know that a
      // Basic facility's chart data is withheld (locked) server-side.
      tier: facilitiesTable.tier,
      createdAt: facilitiesTable.createdAt,
    })
    .from(facilitiesTable)
    .where(eq(facilitiesTable.userId, userId))
    .orderBy(asc(facilitiesTable.id));

  if (facilities.length === 0) return [];

  // First reading date per facility (the facility's "first certificate" anchor).
  const firstDates = await db
    .select({
      facilityId: emissionsReadingsTable.facilityId,
      firstDate: sql<string | null>`min(${emissionsReadingsTable.date})`,
    })
    .from(emissionsReadingsTable)
    .where(eq(emissionsReadingsTable.userId, userId))
    .groupBy(emissionsReadingsTable.facilityId);
  const firstDateByFacility = new Map(
    firstDates.map((r) => [r.facilityId, r.firstDate ? String(r.firstDate) : null]),
  );

  // Facilities that currently have a valid certified submission.
  const validCerts = await db
    .select({ facilityId: submissionsTable.facilityId })
    .from(submissionsTable)
    .where(
      and(
        eq(submissionsTable.userId, userId),
        sql`${submissionsTable.facilityId} IS NOT NULL
          AND ${submissionsTable.status} = 'certified'
          AND (${submissionsTable.certificate}->>'valid_until')::timestamptz > now()`,
      ),
    );
  const validSet = new Set(validCerts.map((r) => r.facilityId));

  return facilities.map((f) => ({
    facilityId: f.facilityId,
    name: f.name,
    lat: f.lat,
    lon: f.lon,
    tier: f.tier === "premium" ? "premium" : "basic",
    firstReadingDate: firstDateByFacility.get(f.facilityId) ?? null,
    hasValidCert: validSet.has(f.facilityId),
  }));
}

// Latest certified certificate for a facility — supplies the dashboard reference lines.
async function fetchCertBaseline(facilityId: number) {
  const certified = await db
    .select({ certificate: submissionsTable.certificate })
    .from(submissionsTable)
    .where(and(eq(submissionsTable.facilityId, facilityId), eq(submissionsTable.status, "certified")))
    .orderBy(desc(submissionsTable.id))
    .limit(1);

  if (certified.length === 0 || !certified[0].certificate) return null;

  const cert = certified[0].certificate as Record<string, unknown>;
  // Prefer the IoT ground means over the atmospheric ch4_ppb / co2_ppm fields:
  // those default to 0 / 415 in the Python pipeline when no Sentinel-5P scene
  // is available, so plotting them as the certificate baseline gives a
  // misleading "0 ppb" CH₄ reference line on the dashboard chart.
  const positive = (...values: unknown[]): number | null => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  return {
    co2Ppm: positive(cert.iot_co2_mean, cert.co2_ppm),
    ch4Ppb: positive(cert.iot_ch4_mean, cert.ch4_ppb),
    esgScore: Number(cert.esg_score ?? 0) || null,
    verifiedEmissionsTco2eq: Number(cert.verified_emissions_tco2eq ?? 0) || null,
  };
}

// GET /api/monitoring/facilities — the monitoring tabs for the authenticated user.
router.get("/monitoring/facilities", requireAuth, async (req, res) => {
  try {
    const facilities = await listUserFacilities(req.session!.userId);
    res.json({ facilities });
  } catch (err) {
    console.error("[monitoring facilities] DB error:", err);
    res.status(500).json({ error: "Failed to load facilities." });
  }
});

// GET /api/monitoring — chart data for ONE facility (monitoring tab) of the
// authenticated user. Every range returns RAW DAILY readings (no aggregation) —
// only the window width changes:
//   day   → last `days` days (1 .. days-since-first-reading; default min(30, available))
//   week  → last 7 days
//   month → same day of the previous month
//   year  → same day of the previous year
// ?facilityId selects the tab; if omitted, the user's first facility is used.
router.get("/monitoring", requireAuth, async (req, res) => {
  const userId = req.session!.userId;
  const range = (["day", "week", "month", "year"].includes(req.query.range as string)
    ? req.query.range
    : "day") as Range;

  // Resolve the requested facility and verify ownership; default to the first facility.
  // We also read the facility's tier here so a Basic facility's data can be withheld.
  let facilityId = Number(req.query.facilityId);
  let facilityTier: string;
  if (!Number.isInteger(facilityId) || facilityId <= 0) {
    const [first] = await db
      .select({ id: facilitiesTable.id, tier: facilitiesTable.tier })
      .from(facilitiesTable)
      .where(eq(facilitiesTable.userId, userId))
      .orderBy(asc(facilitiesTable.id))
      .limit(1);
    if (!first) {
      res.json({ range, facilityId: null, rows: [], count: 0, isLive: false, baseline: null, firstReadingDate: null, locked: false, tier: null });
      return;
    }
    facilityId = first.id;
    facilityTier = first.tier;
  } else {
    const [owned] = await db
      .select({ id: facilitiesTable.id, tier: facilitiesTable.tier })
      .from(facilitiesTable)
      .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, userId)));
    if (!owned) {
      res.status(404).json({ error: "Facility not found" });
      return;
    }
    facilityTier = owned.tier;
  }

  // Basic facilities have their dashboard data WITHHELD server-side. Daily collection
  // still runs for them (the data accumulates), but it is only unlocked by upgrading to
  // Premium — so we send NO rows/baseline here. We still expose firstReadingDate so the
  // frontend can tell the user since when data has been collecting behind the lock.
  if (facilityTier !== "premium") {
    const [firstRow] = await db
      .select({ firstDate: sql<string | null>`min(${emissionsReadingsTable.date})` })
      .from(emissionsReadingsTable)
      .where(eq(emissionsReadingsTable.facilityId, facilityId));
    const firstReadingDate = firstRow?.firstDate ? String(firstRow.firstDate) : null;
    res.json({
      locked: true,
      tier: facilityTier,
      range,
      facilityId,
      rows: [],
      count: 0,
      baseline: null,
      isLive: false,
      firstReadingDate,
    });
    return;
  }

  // Day-view day count, clamped to >= 1 (the frontend caps it at days-since-first-reading).
  const dayCountRaw = Number(req.query.days);
  const dayCount = Number.isFinite(dayCountRaw) && dayCountRaw >= 1 ? Math.floor(dayCountRaw) : 30;

  const baseline = await fetchCertBaseline(facilityId);
  const since = startDateFor(range, dayCount);

  const rows = await db
    .select()
    .from(emissionsReadingsTable)
    .where(
      and(
        eq(emissionsReadingsTable.facilityId, facilityId),
        gte(emissionsReadingsTable.date, since),
      ),
    )
    .orderBy(asc(emissionsReadingsTable.date));

  // All rows in emissions_readings are real measured data. isLive reflects whether
  // any reading exists for this facility at all. The label is the ISO date string so
  // the frontend formats it; every range is daily points now.
  const isLive = rows.length > 0;
  const labeled = rows.map((r) => ({
    label: String(r.date),
    co2Ppm: r.co2Ppm,
    ch4Ppb: r.ch4Ppb,
    esgScore: r.esgScore,
    verifiedEmissionsTco2eq: r.verifiedEmissionsTco2eq,
    ndviMean: r.ndviMean,
    temperature: r.temperature,
    humidity: r.humidity,
  }));

  // The facility's first reading date bounds the Day-view selector on the frontend.
  const [firstRow] = await db
    .select({ firstDate: sql<string | null>`min(${emissionsReadingsTable.date})` })
    .from(emissionsReadingsTable)
    .where(eq(emissionsReadingsTable.facilityId, facilityId));
  const firstReadingDate = firstRow?.firstDate ? String(firstRow.firstDate) : null;

  res.json({
    // Premium facility: full data. locked:false + tier let the frontend branch uniformly.
    locked: false,
    tier: facilityTier,
    range,
    facilityId,
    days: range === "day" ? dayCount : undefined,
    rows: labeled,
    count: labeled.length,
    isLive,
    baseline,
    firstReadingDate,
  });
});

router.get("/monitoring/breaches", requireAuth, async (req, res) => {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const since = twelveMonthsAgo.toISOString().slice(0, 10);

  // Optional facilityId filter so each tab shows only its own breach history.
  const facilityId = Number(req.query.facilityId);
  const hasFacility = Number.isInteger(facilityId) && facilityId > 0;

  try {
    // Breaches reveal measured data, so they are withheld for non-Premium facilities
    // (same lock as GET /api/monitoring). Verify ownership + tier before returning any.
    if (hasFacility) {
      const [facility] = await db
        .select({ tier: facilitiesTable.tier })
        .from(facilitiesTable)
        .where(and(eq(facilitiesTable.id, facilityId), eq(facilitiesTable.userId, req.session!.userId)));
      if (!facility || facility.tier !== "premium") {
        res.json({ breaches: [] });
        return;
      }
    }

    // Without a facilityId filter we must still honour the Premium lock: scope the result
    // to ONLY this user's Premium facilities, otherwise a Basic facility's breach data
    // (which is withheld on the per-facility path) would leak through the unfiltered query.
    let premiumFacilityIds: number[] | null = null;
    if (!hasFacility) {
      const premium = await db
        .select({ id: facilitiesTable.id })
        .from(facilitiesTable)
        .where(and(eq(facilitiesTable.userId, req.session!.userId), eq(facilitiesTable.tier, "premium")));
      premiumFacilityIds = premium.map((f) => f.id);
      if (premiumFacilityIds.length === 0) {
        res.json({ breaches: [] });
        return;
      }
    }

    const breaches = await db
      .select()
      .from(breachLogTable)
      .where(
        and(
          eq(breachLogTable.userId, req.session!.userId),
          gte(breachLogTable.readingDate, since),
          ...(hasFacility ? [eq(breachLogTable.facilityId, facilityId)] : []),
          ...(premiumFacilityIds ? [inArray(breachLogTable.facilityId, premiumFacilityIds)] : []),
        ),
      )
      .orderBy(desc(breachLogTable.readingDate), desc(breachLogTable.id));

    res.json({ breaches });
  } catch (err) {
    console.error("[monitoring breaches] DB error:", err);
    res.status(500).json({ error: "Failed to load breach history." });
  }
});

export default router;
