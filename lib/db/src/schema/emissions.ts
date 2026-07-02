/**
 * lib/db/src/schema/emissions.ts — Drizzle schema definition for emissions_readings table that stores daily environmental measurements (CO2, CH4, ESG score, temperature, humidity) keyed by facility and date.
 * Author: Pasquale Marzaioli
 */
import {
  pgTable,
  serial,
  integer,
  date,
  doublePrecision,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { submissionsTable } from "./submissions";
import { facilitiesTable } from "./facilities";

export const emissionsReadingsTable = pgTable(
  "emissions_readings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    submissionId: integer("submission_id").references(() => submissionsTable.id, {
      onDelete: "set null",
    }),
    // The facility (monitoring tab) this reading belongs to. This — not user_id — is
    // the per-day uniqueness key, so one account can monitor several facilities in
    // parallel without their daily readings colliding.
    facilityId: integer("facility_id")
      .notNull()
      .references(() => facilitiesTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    co2Ppm: doublePrecision("co2_ppm").notNull(),
    ch4Ppb: doublePrecision("ch4_ppb").notNull(),
    esgScore: doublePrecision("esg_score").notNull(),
    verifiedEmissionsTco2eq: doublePrecision("verified_emissions_tco2eq").notNull(),
    ndviMean: doublePrecision("ndvi_mean"),
    temperature: doublePrecision("temperature"),
    humidity: doublePrecision("humidity"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One reading per facility per calendar day — the daily Python worker upserts
    // on this key so re-runs overwrite rather than duplicate. The initial certificate
    // reading uses the same key, so the worker's live data can supersede it on the
    // first collection day. Keyed on facility (not user) so multi-facility accounts
    // don't collide on the same date.
    unique("emissions_readings_facility_date_unique").on(t.facilityId, t.date),
  ],
);

export type EmissionsReading = typeof emissionsReadingsTable.$inferSelect;
export type InsertEmissionsReading = typeof emissionsReadingsTable.$inferInsert;
