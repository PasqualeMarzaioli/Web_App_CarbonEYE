/**
 * artifacts/carboneye/src/lib/types.ts — TypeScript types for ESG predictions, certificate data, anomalies, compliance mappings, and design system color constants.
 * Author: Pasquale Marzaioli
 */
// Re-export API contract types from the shared workspace package.
// This package mirrors the types in api-ts/src/types/api.ts and is the
// single source of truth for the certificate request workflow in sito/.
export type {
  RequestStatus,
  Coordinates,
  DateRange,
  CertificateRequest,
  ApiKeyRecord,
  ErrorResponse,
  SubmitCertificateRequestBody,
  SubmitCertificateRequestResponse,
} from '@workspace/carboneye-types';

export type Anomaly = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
};

export type Compliance = {
  csrd_2026: string;
  eu_taxonomy: string;
  esrs_e1: string;
};

export type DataSource = {
  source: "sentinel-2" | "sentinel-5p" | "open-meteo" | "cams" | "openaq" | "icos" | "eea" | string;
  label?: string;
  status: "ok" | "stale" | "missing" | "failed";
  last_updated: string;
};

export type MonitoringPeriod = {
  start: string;
  end: string;
};

export type ChainFacility = {
  name: string;
  role?: string;
  lat: number;
  lon: number;
  esg_score: number;
  esg_grade: string;
};

export type ChainSummary = {
  lead_company: string;
  facility_count: number;
  score_avg: number;
  score_min: number;
  facilities: ChainFacility[];
};

export type Prediction = {
  esg_score: number;
  esg_grade: string;
  timestamp: string;
  ndvi_mean: number;
  ndwi_mean: number;
  nbr_mean: number;
  ch4_ppb: number;
  co2_ppm: number;
  iot_co2_mean: number;
  iot_ch4_mean: number;
  iot_temperature_mean: number;
  iot_humidity_mean: number;
  num_iot_sensors: number;
  anomalies: Anomaly[];
  compliance: Compliance;
  certificate_id: string;
  submission_id?: number;
  pdf_path?: string;
  pdf_blob_url?: string;
  data_hash?: string;
  pdf_sha256?: string;
  demo_mode?: boolean;
  verified_emissions_tco2eq?: number;
  monitoring_period?: MonitoringPeriod;
  data_sources?: DataSource[];
  blockchain_hash?: string;
  methodology?: string;
  chain?: ChainSummary;
  // AI-generated ESG summary (Azure OpenAI, EU data zone). Reviewed by the admin
  // before issuance; never part of the certificate's hashed payload.
  narrative?: string | null;
};

export type AnalysisState = {
  prediction: Prediction;
  company: string;
  lat: number;
  lon: number;
};

export const C = {
  greenLight: "#5eea6e",
  greenMid: "#27ae60",
  greenDark: "#1a7a2e",
  teal: "#00b894",
  white: "#ffffff",
  bgPage: "#f0faf4",
  bgCard: "#ffffff",
  border: "#c6ecd4",
  borderMid: "#a8ddb8",
  text: "#1a2e1e",
  textMuted: "#4a7a58",
  textLight: "#8ab898",
  danger: "#d63031",
  warning: "#fdcb6e",
  orange: "#e67e22",
  purple: "#8e44ad",
} as const;

export const GRADE_COLORS: Record<string, string> = {
  "A+": C.greenMid,
  A: C.greenMid,
  "B+": C.orange,
  B: C.orange,
  "C+": C.warning,
  C: C.warning,
  D: C.danger,
  F: C.purple,
};
