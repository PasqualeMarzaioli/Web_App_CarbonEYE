/**
 * artifacts/api-server/src/routes/contact.ts — Public contact form endpoint that validates and stores messages, then sends them to configured admin email addresses.
 * Author: Pasquale Marzaioli
 */
import { Router, type IRouter } from "express";
import { db, contactMessagesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { sendContactFormEmail, parseAdminEmails } from "../lib/mailer";

const router: IRouter = Router();

router.post("/contact", async (req, res) => {
  const { name, email, company, subject, message } = req.body ?? {};

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    res.status(400).json({ error: "Subject is required" });
    return;
  }
  if (!message || typeof message !== "string" || message.trim().length < 10) {
    res.status(400).json({ error: "Message must be at least 10 characters" });
    return;
  }

  const cleanName    = name.trim().slice(0, 255);
  const cleanEmail   = email.trim().slice(0, 255);
  const cleanCompany = company ? String(company).trim().slice(0, 255) : null;
  const cleanSubject = String(subject).trim().slice(0, 120);
  const cleanMessage = message.trim().slice(0, 5000);

  await db.insert(contactMessagesTable).values({
    name: cleanName,
    email: cleanEmail,
    company: cleanCompany,
    subject: cleanSubject,
    message: cleanMessage,
  });

  sendContactFormEmail({
    to: parseAdminEmails(process.env.ADMIN_EMAILS),
    name: cleanName,
    email: cleanEmail,
    company: cleanCompany,
    subject: cleanSubject,
    message: cleanMessage,
  });

  res.status(201).json({ ok: true });
});

router.get("/contact/messages", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(contactMessagesTable)
    .orderBy(desc(contactMessagesTable.createdAt))
    .limit(200);
  res.json({ messages: rows });
});

export default router;
