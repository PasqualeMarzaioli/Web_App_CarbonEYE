/**
 * artifacts/carboneye/src/lib/admin.ts — API client for admin operations: fetches submissions, users, contact messages, and breach logs; supports rerun analysis.
 * Author: Pasquale Marzaioli
 */
import type { Submission } from "./submissions";

export type AdminUser = {
  id: number;
  email: string;
  role: "user" | "admin";
  companyName: string | null;
  createdAt: string;
};

export type ContactMessage = {
  id: number;
  name: string;
  email: string;
  company: string | null;
  subject: string;
  message: string;
  createdAt: string;
};

export type BreachLog = {
  id: number;
  userId: number;
  readingId: number | null;
  readingDate: string;
  pollutant: string;
  value: number;
  threshold: number;
  regulation: string;
  detectedAt: string;
};

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export async function listAdminSubmissions(): Promise<Submission[]> {
  const data = await jsonFetch<{ submissions: Submission[] }>("/api/admin/submissions");
  return data.submissions;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const data = await jsonFetch<{ users: AdminUser[] }>("/api/admin/users");
  return data.users;
}

export async function listAdminContactMessages(): Promise<ContactMessage[]> {
  const data = await jsonFetch<{ messages: ContactMessage[] }>("/api/admin/contact-messages");
  return data.messages;
}

export async function listAdminBreaches(): Promise<BreachLog[]> {
  const data = await jsonFetch<{ breaches: BreachLog[] }>("/api/admin/breaches");
  return data.breaches;
}

export async function rerunAdminSubmission(id: number): Promise<Submission> {
  return jsonFetch<Submission>(`/api/admin/submissions/${id}/rerun`, { method: "POST" });
}
