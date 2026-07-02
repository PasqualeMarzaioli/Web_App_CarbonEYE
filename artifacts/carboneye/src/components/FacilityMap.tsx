/**
 * artifacts/carboneye/src/components/FacilityMap.tsx — Interactive map component using Leaflet that displays monitored facilities with ESG score markers and polyline connections between sites.
 * Author: Pasquale Marzaioli
 */
import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { ChainFacility } from "../lib/types";

type Props = {
  facilities: ChainFacility[];
  height?: number;
};

function colorForScore(score: number): string {
  if (score >= 80) return "#1a7a2e";
  if (score >= 65) return "#27ae60";
  if (score >= 50) return "#fdcb6e";
  if (score >= 40) return "#e67e22";
  return "#d63031";
}

export function FacilityMap({ facilities, height = 320 }: Props) {
  const center = useMemo<[number, number]>(() => {
    if (facilities.length === 0) return [42, 11];
    const lat = facilities.reduce((s, f) => s + f.lat, 0) / facilities.length;
    const lon = facilities.reduce((s, f) => s + f.lon, 0) / facilities.length;
    return [lat, lon];
  }, [facilities]);

  const lineCoords = useMemo<[number, number][]>(
    () => facilities.map((f) => [f.lat, f.lon]),
    [facilities],
  );

  return (
    <div
      style={{
        height,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--c-border)",
      }}
    >
      <MapContainer
        center={center}
        zoom={facilities.length > 1 ? 5 : 7}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {facilities.length > 1 && (
          <Polyline positions={lineCoords} pathOptions={{ color: "#27ae60", weight: 2, dashArray: "6 8", opacity: 0.6 }} />
        )}
        {facilities.map((f, i) => (
          <CircleMarker
            key={i}
            center={[f.lat, f.lon]}
            radius={11}
            pathOptions={{
              color: "white",
              weight: 2,
              fillColor: colorForScore(f.esg_score),
              fillOpacity: 0.92,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <div style={{ fontSize: 12 }}>
                <strong>{f.name}</strong>
                <div style={{ color: "#666" }}>{f.role ?? "Facility"}</div>
                <div>
                  <strong style={{ color: colorForScore(f.esg_score) }}>
                    {f.esg_score}/100 ({f.esg_grade})
                  </strong>
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
