/**
 * lib/db/src/schema/facilities.ts — Drizzle schema definition for facilities table representing monitored physical sites with location, industry, subscription tier, and linked Stripe subscription.
 * Author: Pasquale Marzaioli
 */
import {
  pgTable,
  serial,
  integer,
  varchar,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// A facility is the stable identity of a monitoring tab: one physical site that a
// company monitors. It survives certificate renewals — a renewal is a new submission
// pointing at the same facility, so its daily readings keep accumulating in the same
// tab. New facilities are created from the submission form; renewals reuse an existing
// facility id. This is what lets one account monitor several sites in parallel.
export const facilitiesTable = pgTable("facilities", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Tab title shown in the monitoring section (typically the company/site name).
  name: varchar("name", { length: 255 }).notNull(),
  industry: varchar("industry", { length: 120 }),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  // The facility's live tier (basic|premium). Tier is per-company as of DASHBOARD v3
  // (no longer per-account). It drives: the dashboard blur (real data is withheld
  // server-side for Basic), the daily Telegram grouping, and the admin 90-day history
  // gate. Set at submission time and only changed by the paid upgrade flow.
  tier: varchar("tier", { length: 16 }).notNull().default("basic"),
  // The recurring Stripe subscription that funds this facility's plan. Nullable and
  // NON-unique (a user can have several facilities). Needed so the upgrade flow can
  // cancel the old Basic subscription. (users.stripe_subscription_id is now deprecated.)
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Named FacilityRecord (not Facility) to avoid clashing with the legacy supply-chain
// `Facility` item type still exported from submissions.ts during the chain removal.
export type FacilityRecord = typeof facilitiesTable.$inferSelect;
export type InsertFacility = typeof facilitiesTable.$inferInsert;
