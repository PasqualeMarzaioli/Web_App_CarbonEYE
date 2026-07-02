/**
 * artifacts/carboneye/src/components/MetricTile.tsx — Reusable tile component displaying a single metric with label, value, unit, and optional alert state visualization.
 * Author: Pasquale Marzaioli
 */
type Props = {
  label: string;
  value: string;
  unit?: string;
  alert?: boolean;
};

export function MetricTile({ label, value, unit, alert }: Props) {
  const color = alert ? "var(--c-warning)" : "var(--c-green-mid)";
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value" style={{ color }}>
        {value}
      </div>
      <div className="tile-unit">{unit || "\u00A0"}</div>
    </div>
  );
}
