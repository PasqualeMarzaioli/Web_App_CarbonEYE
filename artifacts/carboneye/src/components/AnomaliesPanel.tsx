/**
 * artifacts/carboneye/src/components/AnomaliesPanel.tsx — Displays detected emission/compliance anomalies with severity levels, compliance status badge, and detailed descriptions.
 * Author: Pasquale Marzaioli
 */
import type { Prediction } from "../lib/types";
import { Panel } from "./Panel";

const SEV_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  critical: { bg: "#fff0f0", border: "#d63031", text: "#d63031", icon: "●" },
  high: { bg: "#fff5e6", border: "#e67e22", text: "#e67e22", icon: "▲" },
  medium: { bg: "#fffbf0", border: "#fdcb6e", text: "#b7791f", icon: "◆" },
  low: { bg: "#f0faf4", border: "#27ae60", text: "#27ae60", icon: "■" },
};

export function AnomaliesPanel({ p }: { p: Prediction }) {
  const count = p.anomalies?.length ?? 0;
  const badge = (
    <span
      className="badge"
      style={{
        background: count ? "#fff0f0" : "var(--c-bg-page)",
        color: count ? "var(--c-danger)" : "var(--c-green-mid)",
      }}
    >
      {count > 0 ? count : "✓"}
    </span>
  );

  return (
    <Panel title="Detected Anomalies" badge={badge} bodyPadded>
      {count === 0 ? (
        <div style={{ fontSize: 12, color: "var(--c-green-mid)", padding: "6px 2px" }}>
          ✓ No anomalies detected. Full compliance.
        </div>
      ) : (
        p.anomalies.map((a, i) => {
          const s = SEV_STYLES[a.severity] ?? SEV_STYLES.low;
          return (
            <div
              key={i}
              className="anomaly-row"
              style={{ background: s.bg, borderLeft: `3px solid ${s.border}` }}
            >
              <div className="anomaly-tag" style={{ color: s.text }}>
                {s.icon} [{a.severity.toUpperCase()}] {a.code}
              </div>
              <div className="anomaly-desc">{a.description}</div>
            </div>
          );
        })
      )}
    </Panel>
  );
}
