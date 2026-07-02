/**
 * artifacts/api-server/src/lib/demoAnalysis.ts — Generates deterministic demo ESG analysis results seeded by company name and coordinates for testing without pipeline calls.
 * Author: Pasquale Marzaioli
 */
import type { AnalyzeInput } from "./azureFunctions";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function gradeFromScore(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 72) return "B+";
  if (score >= 65) return "B";
  if (score >= 58) return "C+";
  if (score >= 50) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function generateDemoAnalysis(input: AnalyzeInput): Record<string, unknown> {
  const seed = hash(`${input.company_name.toLowerCase()}|${input.lat.toFixed(2)}|${input.lon.toFixed(2)}`);
  const r = rand(seed);
  const score = Math.round(45 + r() * 50);
  const grade = gradeFromScore(score);
  const certificateId = `CE-DEMO-${seed.toString(36).toUpperCase().padStart(8, "0").slice(0, 8)}`;

  const ndvi = Number((0.25 + r() * 0.55).toFixed(3));
  const ndwi = Number((-0.1 + r() * 0.5).toFixed(3));
  const nbr = Number((0.1 + r() * 0.6).toFixed(3));
  const ch4 = Math.round(1820 + r() * 180);
  const co2 = Math.round(410 + r() * 30);

  const anomalyPool = [
    { code: "NDVI_DROP", severity: "medium", description: "Vegetation index decreased 12% vs 90-day baseline" },
    { code: "CH4_SPIKE", severity: "high", description: "Methane reading exceeded threshold by 8% on 3 sensors" },
    { code: "THERMAL_HOTSPOT", severity: "low", description: "Local thermal anomaly detected near perimeter" },
    { code: "WATER_STRESS", severity: "medium", description: "NDWI suggests reduced surface moisture" },
    { code: "FLARING_EVENT", severity: "critical", description: "Unscheduled flaring detected via satellite imagery" },
  ];
  const anomCount = Math.floor(r() * 3);
  const anomalies = [...anomalyPool].sort(() => r() - 0.5).slice(0, anomCount);

  const compStatus = (threshold: number) => (score >= threshold ? "compliant" : "non-compliant");

  return {
    esg_score: score,
    esg_grade: grade,
    timestamp: new Date().toISOString(),
    ndvi_mean: ndvi,
    ndwi_mean: ndwi,
    nbr_mean: nbr,
    ch4_ppb: ch4,
    co2_ppm: co2,
    iot_co2_mean: Math.round(420 + r() * 80),
    iot_ch4_mean: Math.round(1850 + r() * 200),
    iot_temperature_mean: Number((15 + r() * 18).toFixed(1)),
    iot_humidity_mean: Number((40 + r() * 40).toFixed(1)),
    num_iot_sensors: Math.floor(8 + r() * 16),
    anomalies,
    compliance: {
      csrd_2026: compStatus(60),
      eu_taxonomy: compStatus(70),
      esrs_e1: compStatus(65),
    },
    certificate_id: certificateId,
    demo_mode: true,
  };
}
