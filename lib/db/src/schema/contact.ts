/**
 * lib/db/src/schema/contact.ts — Drizzle schema definition for contact_messages table that stores user inquiries from the contact form (name, email, company, subject, message).
 * Author: Pasquale Marzaioli
 */
import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const contactMessagesTable = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  subject: varchar("subject", { length: 120 }).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
