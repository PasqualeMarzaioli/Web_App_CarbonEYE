/**
 * lib/db/src/schema/submissions.ts — Drizzle schema definition for submissions table that stores ESG certificate issuance requests with facility reference, tier, payment info, and Azure processing status.
 * Author: Pasquale Marzaioli
 */
import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  doublePrecision,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { facilitiesTable } from "./facilities";

export const submissionsTable = pgTable("submissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // The monitoring tab this submission belongs to. Set on the first submission for a
  // site (new facility) and reused on every renewal so the dashboard keeps one tab per
  // facility. Nullable only to allow the 0004 backfill; new rows always carry it.
  facilityId: integer("facility_id").references(() => facilitiesTable.id, {
    onDelete: "set null",
  }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  industry: varchar("industry", { length: 120 }),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  notes: text("notes"),
  submissionType: varchar("submission_type", { length: 20 }).notNull().default("single"),
  facilities: jsonb("facilities"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  certificate: jsonb("certificate"),
  azureRequestId: varchar("azure_request_id", { length: 64 }),
  tierAtSubmission: varchar("tier_at_submission", { length: 16 }).notNull(),
  stripeSessionId: varchar("stripe_session_id", { length: 255 }).unique(),
  paymentAmountCents: integer("payment_amount_cents").notNull(),
  paymentCurrency: varchar("payment_currency", { length: 3 }).notNull(),
  paidAt: timestamp("paid_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Facility = {
  name: string;
  role?: string;
  lat: number;
  lon: number;
};

export type Submission = typeof submissionsTable.$inferSelect;
export type InsertSubmission = typeof submissionsTable.$inferInsert;
