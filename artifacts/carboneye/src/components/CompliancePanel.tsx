/**
 * artifacts/carboneye/src/components/CompliancePanel.tsx — Shows regulatory compliance status for CSRD 2026, EU Taxonomy, and ESRS E1 standards with pass/fail indicators.
 * Author: Pasquale Marzaioli
 */
import type { Prediction } from "../lib/types";
import { Panel } from "./Panel";

const ITEMS: Array<[string, keyof Prediction["compliance"]]> = [
  ["CSRD 2026", "csrd_2026"],
  ["EU Taxonomy", "eu_taxonomy"],
  ["ESRS E1", "esrs_e1"],
];

const PASS_VALUES = new Set([
  "PASS",
  "GREEN",
  "APPROVED",
  "OK",
  "COMPLIANT",
  "TRUE",
  "YES",
]);

export function CompliancePanel({ p }: { p: Prediction }) {
  return (
    <Panel title="Regulatory Compliance" bodyPadded>
      {ITEMS.map(([name, key]) => {
        const val = String(p.compliance?.[key] ?? "N/A").toUpperCase();
        const passing = PASS_VALUES.has(val);
        return (
          <div
            key={key}
            className="compliance-row"
            style={{
              background: passing ? "var(--c-bg-page)" : "#fff0f0",
              borderColor: passing ? "var(--c-border)" : "#f5c0c0",
            }}
          >
            <span className="compliance-name">{name}</span>
            <span
              className="compliance-value"
              style={{ color: passing ? "var(--c-green-mid)" : "var(--c-danger)" }}
            >
              {passing ? "✓ PASS" : "✗ FAIL"}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
