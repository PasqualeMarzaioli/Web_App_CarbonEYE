/**
 * artifacts/api-server/src/lib/insertCertificateReading.ts — Upserts emissions readings from issued certificates into the database, preferring IoT ground data over satellite values and triggering breach detection.
 * Author: Pasquale Marzaioli
 */
import { db, emissionsReadingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logBreachesForReadings } from "./breachLogger";
import { logger } from "./logger";

// Return the first finite positive value, or 0 if none match. Used to prefer
// real IoT measurements over the placeholder atmospheric defaults that the
// Python fused_data falls back to when Sentinel-5P data is missing.
function positiveOrZero(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// Upserts exactly one emissions_readings row from the certificate's measured values.
// Called once when the admin issues a certificate — this becomes the first real
// chart data point. The Python daily worker appends fresh readings from the next
// day onward and upserts on (userId, date) if it runs on the same day.
//
// Upserts (not no-op-on-conflict) so re-issuing a certificate the same day —
// or overwriting a stale row from a previous, broken pipeline run — refreshes
// the baseline with the new measured values instead of silently keeping the old
// (possibly zero) reading.
export async function insertCertificateReading(
  userId: number,
  facilityId: number,
  submissionId: number,
  cert: Record<string, unknown>,
  issuanceDate: string, // YYYY-MM-DD
): Promise<void> {
  // Extract measured values, preferring IoT ground means over atmospheric values.
  // cert.ch4_ppb / cert.co2_ppm default to 0 / 415 in the Python fused_data when
  // no Sentinel-5P scene is available (the common case), and `??` doesn't fall
  // through on 0 — so without this preference the CH₄ chart sticks at 0.
  const co2Ppm = positiveOrZero(cert.iot_co2_mean, cert.co2_ppm);
  const ch4Ppb = positiveOrZero(cert.iot_ch4_mean, cert.ch4_ppb);
  const esgScore = Math.min(100, Math.max(0, Number(cert.esg_score ?? 0)));
  const verifiedEmissionsTco2eq = Number(cert.verified_emissions_tco2eq ?? 0);
  // Satellite-derived index — null when no satellite scene was available.
  const ndviMean = cert.ndvi_mean != null ? Number(cert.ndvi_mean) : null;
  // IoT ground sensor averages — null when sensor data was absent.
  const temperature = cert.iot_temperature_mean != null ? Number(cert.iot_temperature_mean) : null;
  const humidity = cert.iot_humidity_mean != null ? Number(cert.iot_humidity_mean) : null;

  try {
    const rows = await db
      .insert(emissionsReadingsTable)
      .values({
        userId,
        facilityId,
        submissionId,
        date: issuanceDate,
        co2Ppm,
        ch4Ppb,
        esgScore,
        verifiedEmissionsTco2eq,
        ndviMean,
        temperature,
        humidity,
      })
      // Refresh the (facilityId, date) row with the new certificate's measured values.
      // submissionId is updated too so the row always points to the issued cert.
      .onConflictDoUpdate({
        target: [emissionsReadingsTable.facilityId, emissionsReadingsTable.date],
        set: {
          submissionId: sql`excluded.submission_id`,
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

    if (rows.length > 0) {
      // Run breach detection on the upserted row so any regulatory
      // threshold violation is recorded in the audit log immediately.
      await logBreachesForReadings(
        rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          facilityId: r.facilityId,
          date: String(r.date),
          co2Ppm: r.co2Ppm,
          ch4Ppb: r.ch4Ppb,
        })),
      );
    }
  } catch (err) {
    logger.error({ userId, submissionId, err: String(err) }, "insertCertificateReading: DB error");
    throw err;
  }
}
