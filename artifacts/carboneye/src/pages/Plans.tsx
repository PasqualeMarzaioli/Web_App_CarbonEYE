/**
 * artifacts/carboneye/src/pages/Plans.tsx — Pricing page explaining Basic vs Premium tiers with feature comparison table (placeholder prices, links to login).
 * Author: Pasquale Marzaioli
 */
import { Link } from "wouter";
import { Navbar } from "../components/Navbar";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

// Public pricing page sitting between Verify and Contact in the nav. It explains the
// Basic vs Premium offering so a prospect understands what they buy BEFORE registering.
// Prices are intentionally the literal string "TBD": the real numbers are decided later
// and the actual plan is still chosen per-submission inside the portal (tier lives on the
// facility), so nothing here wires Stripe — every CTA simply deep-links to /login.
const PRICE_PLACEHOLDER = "TBD";

// One row of the feature-comparison table: a capability and whether each tier includes it.
type FeatureRow = { label: string; basic: string; premium: string };

const FEATURE_ROWS: FeatureRow[] = [
  { label: "Verified ESG certificate", basic: "✓", premium: "✓" },
  { label: "Satellite + IoT data fusion", basic: "✓", premium: "✓" },
  { label: "SHA-256 cryptography, publicly verifiable", basic: "✓", premium: "✓" },
  { label: "Compliance mapping (CSRD · EU Taxonomy · ESRS E1)", basic: "✓", premium: "✓" },
  { label: "Day-by-day monitoring dashboard", basic: "—", premium: "✓" },
  { label: "Daily satellite + ground refresh", basic: "—", premium: "✓" },
  { label: "Breach history & regulatory alerts", basic: "—", premium: "✓" },
];

function PlanCard({
  name,
  tagline,
  highlighted,
  points,
}: {
  name: string;
  tagline: string;
  highlighted?: boolean;
  points: string[];
}) {
  return (
    <div
      style={{
        background: "var(--c-white)",
        border: `1px solid ${highlighted ? "var(--c-green-mid)" : "var(--c-border)"}`,
        borderRadius: 16,
        padding: "28px 26px",
        boxShadow: highlighted
          ? "0 8px 28px rgba(39,174,96,0.16)"
          : "0 4px 16px rgba(27,122,46,0.06)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {highlighted && (
        <span
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#fff",
            background: "var(--c-green-dark)",
            padding: "3px 10px",
            borderRadius: 999,
          }}
        >
          Full monitoring
        </span>
      )}
      <div className="section-title" style={{ color: "var(--c-green-mid)", marginBottom: 6 }}>
        {name}
      </div>
      <h3 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px", color: "var(--c-text)" }}>
        {tagline}
      </h3>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "10px 0 4px" }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: "var(--c-text)", lineHeight: 1 }}>
          {PRICE_PLACEHOLDER}
        </span>
        <span style={{ fontSize: 13, color: "var(--c-text-muted)" }}>/ 3 months</span>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "18px 0 22px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {points.map((p) => (
          <li key={p} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--c-text-muted)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--c-green-mid)", fontWeight: 800 }}>✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/login"
        className="btn-primary"
        style={{
          marginTop: "auto",
          textAlign: "center",
          textDecoration: "none",
          display: "block",
          // The shared .btn-primary is built for <button>; reset line-height for an <a>.
          lineHeight: 1.4,
        }}
      >
        Get started
      </Link>
    </div>
  );
}

export function Plans() {
  const isMobile = useIsMobile();

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />

      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: isMobile ? "40px 16px 64px" : "60px 24px 80px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: isMobile ? 36 : 52 }}>
          <div className="section-title" style={{ marginBottom: 10, color: "var(--c-green-mid)" }}>
            Plans & pricing
          </div>
          <h1 style={{ fontSize: isMobile ? 28 : 38, fontWeight: 800, margin: "0 0 14px", color: "var(--c-text)" }}>
            Choose how deeply you measure
          </h1>
          <p
            style={{
              fontSize: isMobile ? 15 : 16,
              color: "var(--c-text-muted)",
              maxWidth: 560,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            Every plan delivers one verifiable ESG certificate backed by satellite and ground
            data. Premium adds the continuous day-by-day monitoring dashboard, refreshed
            automatically.
          </p>
        </div>

        {/* Two plan cards — collapse to one column on phones. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols(isMobile, "1fr 1fr"),
            gap: 22,
            alignItems: "stretch",
            marginBottom: isMobile ? 36 : 52,
          }}
        >
          <PlanCard
            name="Basic"
            tagline="Verified certificate"
            points={[
              "One verified ESG certificate per facility",
              "Satellite + IoT data fusion at certification time",
              "SHA-256 cryptography, publicly verifiable",
              "Compliance mapping (CSRD · EU Taxonomy · ESRS E1)",
            ]}
          />
          <PlanCard
            name="Premium"
            tagline="Certificate + monitoring"
            highlighted
            points={[
              "Everything in Basic, plus:",
              "Day-by-day monitoring dashboard",
              "Daily satellite + ground data refresh",
              "Breach history and regulatory alerts",
              "Certificate creation based on the last 90 days data",
            ]}
          />
        </div>

        {/* Feature comparison table — scrolls horizontally on narrow screens instead of
            overflowing the viewport. */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 480,
              borderCollapse: "collapse",
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 14,
              overflow: "hidden",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "#f0faf4", borderBottom: "2px solid var(--c-border)" }}>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 700, color: "var(--c-text)" }}>
                  Feature
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "var(--c-text)" }}>
                  Basic
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 700, color: "var(--c-green-dark)" }}>
                  Premium
                </th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row, i) => (
                <tr key={row.label} style={{ background: i % 2 === 0 ? "var(--c-white)" : "#fafdfb" }}>
                  <td style={{ padding: "11px 16px", color: "var(--c-text-muted)", borderBottom: "1px solid var(--c-border)" }}>
                    {row.label}
                  </td>
                  <td
                    style={{
                      padding: "11px 16px",
                      textAlign: "center",
                      fontWeight: 700,
                      color: row.basic === "✓" ? "var(--c-green-mid)" : "var(--c-text-light)",
                      borderBottom: "1px solid var(--c-border)",
                    }}
                  >
                    {row.basic}
                  </td>
                  <td
                    style={{
                      padding: "11px 16px",
                      textAlign: "center",
                      fontWeight: 700,
                      color: row.premium === "✓" ? "var(--c-green-mid)" : "var(--c-text-light)",
                      borderBottom: "1px solid var(--c-border)",
                    }}
                  >
                    {row.premium}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--c-text-muted)",
            marginTop: 24,
            lineHeight: 1.6,
          }}
        >
          Plan is selected when you request a certificate, per facility. One account can hold
          different plans for different sites.
        </p>
      </main>
    </div>
  );
}
