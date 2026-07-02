/**
 * artifacts/api-server/src/routes/admin.ts — Admin-only endpoints for viewing submissions, users, contact messages, and managing submission reanalysis and certificate reading refresh.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import {
  db,
  breachLogTable,
  contactMessagesTable,
  emissionsReadingsTable,
  facilitiesTable,
  submissionsTable,
  usersTable,
  type Submission,
} from "@workspace/db";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { startAnalyzeAsync, type HistoryReading } from "../lib/azureFunctions";
import { insertCertificateReading } from "../lib/insertCertificateReading";

const router: IRouter = Router();

// Number of days of a facility's history fed into a renewal certificate's generation
// (the "consider only the last 3 months" rule).
const HISTORY_WINDOW_DAYS = 90;

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

// Builds the optional history payload for the pipeline: the facility's last
// HISTORY_WINDOW_DAYS of readings, but ONLY for a Premium facility that already has a
// certified certificate (i.e. its 2nd certificate onward). First certificate or Basic
// → undefined, so the pipeline does a pure point-in-time analysis.
async function buildFacilityHistory(submission: Submission): Promise<HistoryReading[] | undefined> {
  if (submission.facilityId == null) return undefined;

  // The 90-day renewal history is a Premium feature, now gated PER FACILITY (tier lives
  // on the facility, not the account) — so one company can be Premium while another is
  // Basic on the same account. Basic facilities get a pure point-in-time analysis.
  const [facility] = await db
    .select({ tier: facilitiesTable.tier })
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, submission.facilityId));
  if (!facility || facility.tier !== "premium") return undefined;

  const priorCertified = await db
    .select({ id: submissionsTable.id })
    .from(submissionsTable)
    .where(and(eq(submissionsTable.facilityId, submission.facilityId), eq(submissionsTable.status, "certified")))
    .limit(1);
  if (priorCertified.length === 0) return undefined;

  const since = new Date();
  since.setDate(since.getDate() - HISTORY_WINDOW_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);

  const readings = await db
    .select({
      date: emissionsReadingsTable.date,
      co2Ppm: emissionsReadingsTable.co2Ppm,
      ch4Ppb: emissionsReadingsTable.ch4Ppb,
      esgScore: emissionsReadingsTable.esgScore,
      verifiedEmissionsTco2eq: emissionsReadingsTable.verifiedEmissionsTco2eq,
      ndviMean: emissionsReadingsTable.ndviMean,
      temperature: emissionsReadingsTable.temperature,
      humidity: emissionsReadingsTable.humidity,
    })
    .from(emissionsReadingsTable)
    .where(and(eq(emissionsReadingsTable.facilityId, submission.facilityId), gte(emissionsReadingsTable.date, sinceStr)))
    .orderBy(asc(emissionsReadingsTable.date));
  if (readings.length === 0) return undefined;

  return readings.map((r) => ({
    date: String(r.date),
    co2_ppm: r.co2Ppm,
    ch4_ppb: r.ch4Ppb,
    esg_score: r.esgScore,
    verified_emissions_tco2eq: r.verifiedEmissionsTco2eq,
    ndvi_mean: r.ndviMean,
    temperature: r.temperature,
    humidity: r.humidity,
  }));
}

router.use(requireAdmin);

router.get("/admin/submissions", async (req, res) => {
  const page = positiveInt(req.query.page, 1, 10_000);
  const limit = positiveInt(req.query.limit, 50, 200);
  const offset = (page - 1) * limit;
  const rows = await db
    .select()
    .from(submissionsTable)
    .orderBy(desc(submissionsTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ submissions: rows, page, limit });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      companyName: usersTable.companyName,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));
  res.json({ users: rows });
});

router.get("/admin/contact-messages", async (_req, res) => {
  const rows = await db
    .select()
    .from(contactMessagesTable)
    .orderBy(desc(contactMessagesTable.createdAt))
    .limit(200);
  res.json({ messages: rows });
});

router.post("/admin/submissions/:id/rerun", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid submission id" });
    return;
  }

  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, id));
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }

  // From a Premium facility's 2nd certificate onward, feed the pipeline that
  // facility's last 90 days of readings so the new certificate reflects the trend,
  // not just a single point in time. First certificate / Basic → no history.
  const history = await buildFacilityHistory(submission);

  const { request_id } = await startAnalyzeAsync(
    {
      company_name: submission.companyName,
      lat: submission.lat,
      lon: submission.lon,
      period_days: HISTORY_WINDOW_DAYS,
      ...(history ? { history } : {}),
    },
    submission.userId,
  );

  // Move the submission into "analyzing" and store the Azure request id for the
  // Vercel cron job, which owns all further status transitions.
  const [updated] = await db
    .update(submissionsTable)
    .set({
      status: "analyzing",
      azureRequestId: request_id,
      updatedAt: new Date(),
    })
    .where(eq(submissionsTable.id, id))
    .returning();

  res.status(202).json({ submissionId: updated.id, status: updated.status, requestId: request_id });
});

// Rewrites the emissions_readings baseline row from the submission's current
// certificate payload, without re-running the heavy satellite + AI pipeline.
// Use this to backfill dashboards for already-certified submissions whose
// certificate now reads correctly but whose baseline reading was inserted with
// stale values (e.g. before a fix landed).
router.post("/admin/submissions/:id/refresh-reading", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid submission id" });
    return;
  }

  const [submission] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, id));
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  if (submission.status !== "certified" || !submission.certificate) {
    res.status(409).json({ error: "Submission has no certified certificate to refresh from" });
    return;
  }
  if (submission.facilityId == null) {
    res.status(409).json({ error: "Submission has no facility to attach the reading to" });
    return;
  }

  const cert = submission.certificate as Record<string, unknown>;
  const issuanceDate = new Date().toISOString().slice(0, 10);
  try {
    await insertCertificateReading(submission.userId, submission.facilityId, submission.id, cert, issuanceDate);
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh reading", detail: String(err) });
    return;
  }
  res.json({ submissionId: submission.id, refreshedFor: issuanceDate });
});

router.get("/admin/breaches", async (_req, res) => {
  const rows = await db
    .select()
    .from(breachLogTable)
    .orderBy(desc(breachLogTable.detectedAt))
    .limit(500);
  res.json({ breaches: rows });
});

export default router;
