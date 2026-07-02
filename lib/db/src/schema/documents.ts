/**
 * lib/db/src/schema/documents.ts — Drizzle schema definition for documents table that stores uploaded files (binary content, MIME type, size) associated with submissions.
 * Author: Pasquale Marzaioli
 */
import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  integer,
  customType,
} from "drizzle-orm/pg-core";
import { submissionsTable } from "./submissions";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id")
    .notNull()
    .references(() => submissionsTable.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  content: bytea("content").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Document = typeof documentsTable.$inferSelect;
