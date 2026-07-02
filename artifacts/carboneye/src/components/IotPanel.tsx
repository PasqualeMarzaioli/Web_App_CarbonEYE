/**
 * artifacts/carboneye/src/components/IotPanel.tsx — Displays ground IoT sensor metrics including CO₂, CH₄, temperature, humidity, and active sensor count with alert thresholds.
 * Author: Pasquale Marzaioli
 */
import type { Prediction } from "../lib/types";
import { MetricTile } from "./MetricTile";
import { Panel } from "./Panel";

export function IotPanel({ p }: { p: Prediction }) {
  const hasAnyMetric =
    p.iot_co2_mean != null ||
    p.iot_ch4_mean != null ||
    p.iot_temperature_mean != null ||
    p.iot_humidity_mean != null ||
    p.num_iot_sensors != null;

  return (
    <Panel title="Ground IoT Sensors">
      {hasAnyMetric ? (
        <div className="tile-grid">
          {p.iot_co2_mean != null && (
            <MetricTile label="CO2 (IoT)" value={p.iot_co2_mean.toFixed(0)} unit="ppm" alert={p.iot_co2_mean > 420} />
          )}
          {p.iot_ch4_mean != null && (
            <MetricTile label="CH4 (IoT)" value={p.iot_ch4_mean.toFixed(0)} unit="ppb" alert={p.iot_ch4_mean > 1900} />
          )}
          {p.iot_temperature_mean != null && (
            <MetricTile label="Temperature" value={p.iot_temperature_mean.toFixed(1)} unit="°C" />
          )}
          {p.iot_humidity_mean != null && (
            <MetricTile label="Humidity" value={p.iot_humidity_mean.toFixed(1)} unit="%" />
          )}
          {p.num_iot_sensors != null && (
            <MetricTile label="Sensors" value={String(p.num_iot_sensors)} unit="active" />
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--c-text-light)", padding: "6px 2px" }}>
          Ground IoT sensor values are not available for this certificate yet.
        </div>
      )}
    </Panel>
  );
}
