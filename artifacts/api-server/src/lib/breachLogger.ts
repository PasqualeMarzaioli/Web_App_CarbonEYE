/**
 * artifacts/api-server/src/lib/breachLogger.ts — Detects and logs regulatory threshold breaches for CO2 and CH4 emissions against WHO and EU standards, with backfill support for historical data.
 * Author: Pasquale Marzaioli
 */
import { db, breachLogTable, emissionsReadingsTable } from "@workspace/db";
import { gte } from "drizzle-orm";

const WHO_CO2_THRESHOLD = 430;
const EU_CH4_THRESHOLD = 1900;

type ReadingForBreachCheck = {
  id: number;
  userId: number;
  facilityId: number;
  date: string;
  co2Ppm: number;
  ch4Ppb: number;
};

export async function logBreachesForReadings(
  readings: ReadingForBreachCheck[],
): Promise<void> {
  if (readings.length === 0) return;

  const breaches: Array<{
    userId: number;
    facilityId: number;
    readingId: number;
    readingDate: string;
    pollutant: string;
    value: number;
    threshold: number;
    regulation: string;
  }> = [];

  for (const r of readings) {
    if (r.co2Ppm > WHO_CO2_THRESHOLD) {
      breaches.push({
        userId: r.userId,
        facilityId: r.facilityId,
        readingId: r.id,
        readingDate: r.date,
        pollutant: "co2",
        value: r.co2Ppm,
        threshold: WHO_CO2_THRESHOLD,
        regulation: "WHO Air Quality Guidelines 2021",
      });
    }
    if (r.ch4Ppb > EU_CH4_THRESHOLD) {
      breaches.push({
        userId: r.userId,
        facilityId: r.facilityId,
        readingId: r.id,
        readingDate: r.date,
        pollutant: "ch4",
        value: r.ch4Ppb,
        threshold: EU_CH4_THRESHOLD,
        regulation: "EU Methane Regulation 2024/1787",
      });
    }
  }

  if (breaches.length === 0) return;

  for (let i = 0; i < breaches.length; i += 50) {
    await db
      .insert(breachLogTable)
      .values(breaches.slice(i, i + 50))
      .onConflictDoNothing();
  }
}

export async function backfillBreachLog(): Promise<void> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const since = twelveMonthsAgo.toISOString().slice(0, 10);

  const readings = await db
    .select({
      id: emissionsReadingsTable.id,
      userId: emissionsReadingsTable.userId,
      facilityId: emissionsReadingsTable.facilityId,
      date: emissionsReadingsTable.date,
      co2Ppm: emissionsReadingsTable.co2Ppm,
      ch4Ppb: emissionsReadingsTable.ch4Ppb,
    })
    .from(emissionsReadingsTable)
    .where(gte(emissionsReadingsTable.date, since));

  const candidates = readings.map((r) => ({
    id: r.id,
    userId: r.userId,
    facilityId: r.facilityId,
    date: String(r.date),
    co2Ppm: r.co2Ppm,
    ch4Ppb: r.ch4Ppb,
  }));

  await logBreachesForReadings(candidates);
}
