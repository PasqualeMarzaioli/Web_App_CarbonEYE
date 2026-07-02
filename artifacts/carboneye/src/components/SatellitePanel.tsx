/**
 * artifacts/carboneye/src/components/SatellitePanel.tsx — Displays satellite-derived vegetation and atmospheric metrics (NDVI, NDWI, NBR, atmospheric CO₂/CH₄) with alert indicators.
 * Author: Pasquale Marzaioli
 */
import type { Prediction } from "../lib/types";
import { MetricTile } from "./MetricTile";
import { Panel } from "./Panel";

export function SatellitePanel({ p }: { p: Prediction }) {
  const hasAnyMetric =
    p.ndvi_mean != null ||
    p.ndwi_mean != null ||
    p.nbr_mean != null ||
    p.ch4_ppb != null ||
    p.co2_ppm != null;

  return (
    <Panel title="Satellite Monitoring">
      {hasAnyMetric ? (
        <div className="tile-grid">
          {p.ndvi_mean != null && (
            <MetricTile label="NDVI" value={p.ndvi_mean.toFixed(3)} alert={p.ndvi_mean < 0.3} />
          )}
          {p.ndwi_mean != null && (
            <MetricTile label="NDWI" value={p.ndwi_mean.toFixed(3)} alert={p.ndwi_mean < 0} />
          )}
          {p.nbr_mean != null && (
            <MetricTile label="NBR" value={p.nbr_mean.toFixed(3)} alert={p.nbr_mean < 0.1} />
          )}
          {p.ch4_ppb != null && (
            <MetricTile label="CH4 (S5P)" value={p.ch4_ppb.toFixed(0)} unit="ppb" alert={p.ch4_ppb > 1900} />
          )}
          {p.co2_ppm != null && (
            <MetricTile label="CO2 (S5P)" value={p.co2_ppm.toFixed(0)} unit="ppm" alert={p.co2_ppm > 420} />
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--c-text-light)", padding: "6px 2px" }}>
          Satellite metric values are not available for this certificate yet.
        </div>
      )}
    </Panel>
  );
}
