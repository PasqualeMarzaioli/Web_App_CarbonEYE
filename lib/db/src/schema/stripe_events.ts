/**
 * lib/db/src/schema/stripe_events.ts — Drizzle schema definition for stripe_events table that logs incoming Stripe webhook events (event type, timestamp, payload) for idempotency and audit.
 * Author: Pasquale Marzaioli
 */
import { jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

export const stripeEventsTable = pgTable("stripe_events", {
  id: serial("id").primaryKey(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull().unique(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
});

export type StripeEvent = typeof stripeEventsTable.$inferSelect;
export type InsertStripeEvent = typeof stripeEventsTable.$inferInsert;
