/**
 * artifacts/carboneye/src/lib/submissions.ts — API client for submission lifecycle: create, retrieve, update, delete; document upload/download; and Stripe checkout flows (new submission, renew, upgrade).
 * Author: Pasquale Marzaioli
 */
import type { Prediction } from "./types";

export type Facility = {
  name: string;
  role?: string;
  lat: number;
  lon: number;
};

export type Submission = {
  id: number;
  userId: number;
  facilityId: number | null;
  companyName: string;
  industry: string | null;
  lat: number;
  lon: number;
  notes: string | null;
  // Legacy columns kept for API compatibility — the supply-chain flow was removed,
  // so submissionType is always "single" and facilities is always null on new rows.
  submissionType: "single" | "supply_chain";
  facilities: Facility[] | null;
  status: "pending" | "analyzing" | "analysis_failed" | "in_review" | "certified" | "rejected";
  certificate: Prediction | null;
  tierAtSubmission: "basic" | "premium";
  stripeSessionId: string | null;
  paymentAmountCents: number;
  paymentCurrency: string;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentMeta = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description?: string | null;
  createdAt?: string;
};

export type SubmissionDetail = Submission & { documents: DocumentMeta[] };

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const listSubmissions = () => jsonFetch<Submission[]>("/api/submissions");

export const getSubmission = (id: number) => jsonFetch<SubmissionDetail>(`/api/submissions/${id}`);

// Start a paid checkout for a brand-new facility's first certificate (single facility
// only — supply chain removed). The facility is created by the Stripe webhook.
export const startSubmissionCheckout = (payload: {
  companyName: string;
  industry?: string;
  lat: number;
  lon: number;
  notes?: string;
  tier: "basic" | "premium";
}) => jsonFetch<{ url: string }>("/api/checkout/submission", { method: "POST", body: JSON.stringify(payload) });

// Renew an existing facility's certificate: a new paid submission tied to the SAME
// facility (same monitoring tab), so its daily readings keep accumulating.
export const startRenewCheckout = (facilityId: number) =>
  jsonFetch<{ url: string }>("/api/checkout/renew", { method: "POST", body: JSON.stringify({ facilityId }) });

// Upgrade ONE facility to Premium. This is a NEW paid Stripe Checkout (no proration);
// after payment the webhook/reconcile unlocks the data already being collected for that
// facility. It does NOT issue a new certificate.
export const startUpgradeCheckout = (facilityId: number) =>
  jsonFetch<{ url: string }>("/api/checkout/upgrade", { method: "POST", body: JSON.stringify({ facilityId }) });

// Post-payment safety net: the success page calls this with the Stripe Checkout
// session_id so the paid submission (or upgrade) is materialized synchronously, even if
// the webhook is delayed/misconfigured. Idempotent on the server.
export const confirmCheckoutSession = (sessionId: string) =>
  jsonFetch<{ kind: string; submission?: Submission; facilityId?: number; upgraded?: boolean }>(
    "/api/checkout/reconcile",
    { method: "POST", body: JSON.stringify({ sessionId }) },
  );

export const updateSubmission = (
  id: number,
  patch: { status?: Submission["status"]; certificate?: Prediction | null },
) =>
  jsonFetch<Submission>(`/api/submissions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteSubmission = (id: number) =>
  jsonFetch<{ ok: boolean; id: number }>(`/api/submissions/${id}`, {
    method: "DELETE",
  });

export async function uploadDocuments(submissionId: number, files: File[]): Promise<DocumentMeta[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch(`/api/submissions/${submissionId}/documents`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Upload failed (${res.status})`);
  }
  return data as DocumentMeta[];
}

export const documentDownloadUrl = (submissionId: number, docId: number) =>
  `/api/submissions/${submissionId}/documents/${docId}`;

export function findPreviousPrediction(
  submissions: Submission[],
  current: { companyName: string; id: number; certificate?: { timestamp?: string } | null },
): import("./types").Prediction | null {
  const currentTs = current.certificate?.timestamp ?? "";
  const prior = submissions
    .filter(
      (s) =>
        s.id !== current.id &&
        s.status === "certified" &&
        s.companyName === current.companyName &&
        s.certificate &&
        (s.certificate.timestamp ?? "") < currentTs,
    )
    .sort((a, b) => (b.certificate?.timestamp ?? "").localeCompare(a.certificate?.timestamp ?? ""));
  return prior[0]?.certificate ?? null;
}
