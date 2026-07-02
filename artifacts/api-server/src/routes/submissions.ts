/**
 * artifacts/api-server/src/routes/submissions.ts — Submission CRUD operations including document upload/download, status updates with certificate issuance, and baseline emissions reading insertion.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import { db, submissionsTable, documentsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { saveCertificate } from "../lib/cosmos";
import { logger } from "../lib/logger";
import { insertCertificateReading } from "../lib/insertCertificateReading";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

router.get("/submissions", requireAuth, async (req, res) => {
  const isAdmin = req.session!.role === "admin";
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(isAdmin ? undefined : eq(submissionsTable.userId, req.session!.userId))
    .orderBy(desc(submissionsTable.createdAt));
  res.json(rows);
});

router.get("/submissions/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const isAdmin = req.session!.role === "admin";
  const [row] = await db
    .select()
    .from(submissionsTable)
    .where(
      isAdmin
        ? eq(submissionsTable.id, id)
        : and(eq(submissionsTable.id, id), eq(submissionsTable.userId, req.session!.userId)),
    );
  if (!row) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const docs = await db
    .select({
      id: documentsTable.id,
      filename: documentsTable.filename,
      mimeType: documentsTable.mimeType,
      sizeBytes: documentsTable.sizeBytes,
      description: documentsTable.description,
      createdAt: documentsTable.createdAt,
    })
    .from(documentsTable)
    .where(eq(documentsTable.submissionId, row.id))
    .orderBy(desc(documentsTable.createdAt));
  res.json({ ...row, documents: docs });
});

router.post(
  "/submissions/:id/documents",
  requireAuth,
  upload.array("files", 10),
  async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const isAdmin = req.session!.role === "admin";
    const [row] = await db
      .select()
      .from(submissionsTable)
      .where(
        isAdmin
          ? eq(submissionsTable.id, id)
          : and(eq(submissionsTable.id, id), eq(submissionsTable.userId, req.session!.userId)),
      );
    if (!row) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }
    const inserted = await db
      .insert(documentsTable)
      .values(
        files.map((f) => ({
          submissionId: row.id,
          filename: f.originalname,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          content: f.buffer,
        })),
      )
      .returning({
        id: documentsTable.id,
        filename: documentsTable.filename,
        mimeType: documentsTable.mimeType,
        sizeBytes: documentsTable.sizeBytes,
      });
    res.json(inserted);
  },
);

router.get("/submissions/:id/documents/:docId", requireAuth, async (req, res) => {
  const subId = Number(req.params.id);
  const docId = Number(req.params.docId);
  if (Number.isNaN(subId) || Number.isNaN(docId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const isAdmin = req.session!.role === "admin";
  const [row] = await db
    .select()
    .from(submissionsTable)
    .where(
      isAdmin
        ? eq(submissionsTable.id, subId)
        : and(eq(submissionsTable.id, subId), eq(submissionsTable.userId, req.session!.userId)),
    );
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, docId), eq(documentsTable.submissionId, subId)));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
  );
  res.send(doc.content);
});

router.delete("/submissions/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const isAdmin = req.session!.role === "admin";
  const [row] = await db
    .select()
    .from(submissionsTable)
    .where(
      isAdmin
        ? eq(submissionsTable.id, id)
        : and(eq(submissionsTable.id, id), eq(submissionsTable.userId, req.session!.userId)),
    );
  if (!row) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  if (row.status === "certified") {
    res.status(403).json({
      error: "Certified submissions are part of the public registry and cannot be deleted.",
    });
    return;
  }
  if (row.status === "analyzing") {
    res.status(409).json({
      error: "Analysis is running for this submission — wait for it to finish before deleting.",
    });
    return;
  }
  await db.delete(documentsTable).where(eq(documentsTable.submissionId, id));
  await db.delete(submissionsTable).where(eq(submissionsTable.id, id));
  res.json({ ok: true, id });
});

// Returns certificate validity: the end of the issuance quarter. The
// certificate's monitoring_period is the historical analysis window, not the
// active validity.
function computeValidUntil(issuanceTs: string): string {
  const d = new Date(issuanceTs);
  const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  const quarterEnd = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999));
  return quarterEnd.toISOString();
}

router.patch("/submissions/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { status, certificate } = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof status === "string") updates.status = status;
  if (certificate !== undefined) updates.certificate = certificate;

  // When the admin issues a certificate (status → "certified"), stamp valid_until
  // into the certificate JSONB so the monitored-companies endpoint can filter on it.
  // We read the existing cert from the DB if the request body does not include one
  // (the normal async-flow approve path: admin POSTs only { status: "certified" }).
  if (status === "certified") {
    let certToStamp = certificate as Record<string, unknown> | undefined;
    if (!certToStamp) {
      const [existing] = await db
        .select({ certificate: submissionsTable.certificate })
        .from(submissionsTable)
        .where(eq(submissionsTable.id, id));
      certToStamp = (existing?.certificate as Record<string, unknown>) ?? undefined;
    }
    if (certToStamp && !certToStamp.valid_until) {
      const issuanceTs = new Date().toISOString();
      updates.certificate = {
        ...certToStamp,
        valid_until: computeValidUntil(issuanceTs),
      };
    }
  }

  const [row] = await db
    .update(submissionsTable)
    .set(updates)
    .where(eq(submissionsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }

  if (status === "certified" && row.certificate) {
    const cert = row.certificate as Record<string, unknown>;
    const certId = String(cert.certificate_id ?? `CE-${row.id}-${Date.now()}`);
    const ok = await saveCertificate({
      id: certId,
      certificate_id: certId,
      company_name: row.companyName,
      lat: row.lat,
      lon: row.lon,
      esg_score: Number(cert.esg_score ?? 0),
      esg_grade: String(cert.esg_grade ?? ""),
      timestamp: String(cert.timestamp ?? new Date().toISOString()),
      issued_at: new Date().toISOString(),
      issued_by: req.session!.email,
      payload: cert,
    });
    if (!ok) {
      logger.warn({ submissionId: row.id }, "Cosmos save failed; certificate only in Postgres");
    }

    // Insert the first real emissions_readings row from the certificate's measured
    // values. This is the first genuine chart data point; the Python daily worker
    // appends fresh readings from the next day onward via POST /api/monitoring.
    // The reading is keyed on the facility (monitoring tab), so a renewal's baseline
    // lands in the same tab as the previous certificate's readings.
    if (row.facilityId != null) {
      const issuanceDate = new Date().toISOString().slice(0, 10);
      insertCertificateReading(row.userId, row.facilityId, row.id, cert, issuanceDate).catch((err) => {
        logger.warn({ submissionId: row.id, err: String(err) }, "Certificate readings insert failed");
      });
    } else {
      logger.warn({ submissionId: row.id }, "Submission has no facility_id; skipping baseline reading");
    }
  }

  res.json(row);
});

export default router;
