/**
 * artifacts/carboneye/src/components/BillingTab.tsx — Subscription and account management interface showing billing summary, active subscriptions, plan tiers, certificate validity, and cancellation options.
 * Author: Pasquale Marzaioli
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelSubscription,
  getBillingSummary,
  type SubscriptionSummary,
} from "../lib/billing";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

// Formats an ISO date string as a short local date, or a dash when absent/invalid.
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// Formats a Stripe amount (cents) + currency, e.g. "0.01 EUR". Dash when unavailable.
function fmtAmount(cents: number | null, currency: string | null): string {
  if (cents == null || !currency) return "—";
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

// Per-company plan pill — same visual language as MonitoringTab's tab pill.
function TierPill({ tier }: { tier: string }) {
  const premium = tier === "premium";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${premium ? "var(--c-green-dark)" : "var(--c-border-mid)"}`,
        background: premium ? "var(--c-green-dark)" : "var(--c-white)",
        color: premium ? "#fff" : "var(--c-text-muted)",
      }}
    >
      {premium ? "Premium" : "Basic"}
    </span>
  );
}

// Status badge: a cancelling subscription shows when access ends; otherwise the live status.
function StatusBadge({ sub }: { sub: SubscriptionSummary }) {
  let label: string;
  let bg: string;
  let color: string;
  if (!sub.stripeSubscriptionId || sub.status == null) {
    label = "No subscription";
    bg = "#f3f5f4";
    color = "#7a8a80";
  } else if (sub.cancelAtPeriodEnd) {
    label = `Cancels on ${fmtDate(sub.currentPeriodEnd)}`;
    bg = "#fff7e6";
    color = "#b7791f";
  } else if (sub.status === "active" || sub.status === "trialing") {
    label = "Active";
    bg = "#e6f7ec";
    color = "#1a7a2e";
  } else if (sub.status === "canceled") {
    label = "Canceled";
    bg = "#f3f5f4";
    color = "#7a8a80";
  } else {
    // past_due, unpaid, incomplete, etc. — surface the raw status.
    label = sub.status.replace(/_/g, " ");
    bg = "#fff0f0";
    color = "var(--c-danger)";
  }
  return (
    <span
      style={{
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        padding: "4px 10px",
        borderRadius: 6,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function AccountTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--c-bg-page)",
        border: "1px solid var(--c-border)",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div className="section-title" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text)", wordBreak: "break-word" }}>
        {value}
      </div>
    </div>
  );
}

function SubscriptionRow({
  sub,
  onCancelled,
}: {
  sub: SubscriptionSummary;
  onCancelled: () => void;
}) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Cancel is only meaningful for a live, not-already-cancelling subscription.
  const canCancel =
    !!sub.stripeSubscriptionId &&
    !sub.cancelAtPeriodEnd &&
    sub.status !== "canceled" &&
    sub.status != null;

  const cancel = async () => {
    if (!window.confirm(
      `Cancel the subscription for "${sub.facilityName}"? You keep access until ${fmtDate(sub.currentPeriodEnd)}; it will not renew.`,
    )) return;
    setBusy(true);
    setErr(null);
    try {
      await cancelSubscription(sub.facilityId);
      onCancelled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--c-white)",
        border: "1px solid var(--c-border)",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--c-text)" }}>{sub.facilityName}</span>
            <TierPill tier={sub.tier} />
          </div>
          <div style={{ marginTop: 6 }}>
            <StatusBadge sub={sub} />
          </div>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            style={{
              background: "var(--c-white)",
              border: "1px solid #f5b7b1",
              color: "#a8141d",
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              cursor: busy ? "wait" : "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {busy ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {/* Detail tiles: plan price, next renewal / access-until, certificate validity. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols(isMobile, "repeat(3, 1fr)", "1fr"),
          gap: 10,
          marginTop: 14,
        }}
      >
        <div className="tile" style={{ borderRadius: 8, background: "var(--c-bg-page)" }}>
          <div className="tile-label">Plan price</div>
          <div className="tile-value" style={{ fontSize: 15 }}>{fmtAmount(sub.amountCents, sub.currency)}</div>
          <div className="tile-unit">per 3 months</div>
        </div>
        <div className="tile" style={{ borderRadius: 8, background: "var(--c-bg-page)" }}>
          <div className="tile-label">{sub.cancelAtPeriodEnd ? "Access until" : "Next renewal"}</div>
          <div className="tile-value" style={{ fontSize: 15 }}>{fmtDate(sub.currentPeriodEnd)}</div>
        </div>
        <div className="tile" style={{ borderRadius: 8, background: "var(--c-bg-page)" }}>
          <div className="tile-label">Certificate valid until</div>
          <div className="tile-value" style={{ fontSize: 15 }}>{fmtDate(sub.certificateValidUntil)}</div>
        </div>
      </div>

      {err && <div className="alert alert-err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}

export function BillingTab() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portal", "billing"],
    queryFn: getBillingSummary,
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["portal", "billing"] });

  if (isLoading) {
    return <div style={{ fontSize: 13, color: "var(--c-text-light)" }}>Loading billing…</div>;
  }
  if (isError || !data) {
    return (
      <div className="alert alert-err">
        {error instanceof Error ? error.message : "Failed to load billing summary."}
      </div>
    );
  }

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 2 }}>Billing</div>
      <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 18px", color: "var(--c-text)" }}>
        Account & subscriptions
      </h3>

      {/* Account overview tiles. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols(isMobile, "repeat(4, 1fr)", "repeat(2, 1fr)"),
          gap: 12,
          marginBottom: 26,
        }}
      >
        <AccountTile label="Company name" value={data.account.companyName ?? "—"} />
        <AccountTile label="Account created" value={fmtDate(data.account.createdAt)} />
        <AccountTile label="Certificates requested" value={String(data.certificatesRequested)} />
        <AccountTile label="Account email" value={data.account.email} />
      </div>

      <div className="section-title" style={{ marginBottom: 10 }}>Subscriptions</div>
      {data.subscriptions.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 24px",
            background: "var(--c-white)",
            border: "1px solid var(--c-border)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 10 }}>💳</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--c-text)", marginBottom: 6 }}>
            No subscriptions yet
          </div>
          <div style={{ fontSize: 13, color: "var(--c-text-muted)", maxWidth: 360, margin: "0 auto" }}>
            Request your first certificate to start a subscription. Each facility you monitor
            has its own plan.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.subscriptions.map((sub) => (
            <SubscriptionRow key={sub.facilityId} sub={sub} onCancelled={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}
