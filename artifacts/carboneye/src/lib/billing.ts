/**
 * artifacts/carboneye/src/lib/billing.ts — Billing API client for retrieving subscription summaries and cancelling per-facility Stripe subscriptions.
 * Author: Pasquale Marzaioli
 */
// Client for the billing/subscriptions API (feature 4). Mirrors the jsonFetch pattern
// used across the other lib/* clients.

export type SubscriptionSummary = {
  facilityId: number;
  facilityName: string;
  tier: string;
  stripeSubscriptionId: string | null;
  // Stripe-derived fields are null when the subscription could not be retrieved
  // (deleted/test sub) — the row still renders from the DB-derived fields.
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null; // next renewal OR access-until-when-cancelled (ISO)
  amountCents: number | null;
  currency: string | null;
  certificateValidUntil: string | null;
};

export type BillingSummary = {
  account: {
    companyName: string | null;
    email: string;
    createdAt: string;
  };
  certificatesRequested: number;
  subscriptions: SubscriptionSummary[];
};

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

export const getBillingSummary = () => jsonFetch<BillingSummary>("/api/billing/summary");

// Schedule cancellation at period end for one facility's subscription. Idempotent server-side.
export const cancelSubscription = (facilityId: number) =>
  jsonFetch<{ ok: true; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }>(
    `/api/billing/subscriptions/${facilityId}/cancel`,
    { method: "POST" },
  );
