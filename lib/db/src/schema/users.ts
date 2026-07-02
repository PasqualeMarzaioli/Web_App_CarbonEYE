/**
 * lib/db/src/schema/users.ts — Drizzle schema definition for users table with authentication (email, password hash), account metadata, Stripe customer/subscription tracking, and email verification fields.
 * Author: Pasquale Marzaioli
 */
import { boolean, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  companyName: varchar("company_name", { length: 255 }),
  tier: varchar("tier", { length: 16 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }).unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resetToken: varchar("reset_token", { length: 128 }),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
  // Email verification (migration 0006): login is blocked until emailVerified is true.
  // Existing accounts are backfilled to true; new accounts start false (admins start true).
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: varchar("email_verification_token", { length: 128 }),
  emailVerificationTokenExpiresAt: timestamp("email_verification_token_expires_at"),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
