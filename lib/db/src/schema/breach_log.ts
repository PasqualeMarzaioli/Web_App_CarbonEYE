/**
 * lib/db/src/schema/breach_log.ts — Drizzle schema definition for breach_log table that records when emissions readings exceed regulatory thresholds by facility and pollutant.
 * Author: Pasquale Marzaioli
 */
import {
  pgTable,
  serial,
  integer,
  date,
  doublePrecision,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { emissionsReadingsTable } from "./emissions";
import { facilitiesTable } from "./facilities";

export const breachLogTable = pgTable(
  "breach_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The facility (monitoring tab) the breaching reading belongs to, so the per-tab
    // breach history can be filtered by facility. Nullable for the 0004 backfill.
    facilityId: integer("facility_id").references(() => facilitiesTable.id, {
      onDelete: "cascade",
    }),
    readingId: integer("reading_id").references(() => emissionsReadingsTable.id, {
      onDelete: "cascade",
    }),
    readingDate: date("reading_date").notNull(),
    pollutant: text("pollutant").notNull(),
    value: doublePrecision("value").notNull(),
    threshold: doublePrecision("threshold").notNull(),
    regulation: text("regulation").notNull(),
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
  },
  (t) => [unique("breach_log_unique_reading").on(t.readingId, t.pollutant)],
);

export type BreachLog = typeof breachLogTable.$inferSelect;
export type InsertBreachLog = typeof breachLogTable.$inferInsert;
