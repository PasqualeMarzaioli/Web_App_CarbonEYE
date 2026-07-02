/**
 * artifacts/api-server/src/lib/azureFunctions.ts — Client for calling the Azure Python pipeline to perform ESG certificate analysis, verify certificates, and generate PDFs with error handling and async polling support.
 * Author: Pasquale Marzaioli
 */
import { logger } from "./logger";

let _url = process.env.AZURE_FUNCTIONS_URL?.trim() ?? "";
let _key = process.env.AZURE_FUNCTIONS_KEY?.trim() ?? "";
const PIPELINE_API_KEY =
  process.env.CARBONEYE_PIPELINE_API_KEY?.trim() || process.env.CARBONEYE_API_KEY?.trim() || "";
if (_url && !/^https?:\/\//i.test(_url) && /^https?:\/\//i.test(_key)) {
  [_url, _key] = [_key, _url];
}
const BASE_URL = _url.replace(/\/$/, "");
const FUNCTION_KEY = _key;
const ANALYZE_TIMEOUT_MS = Number(process.env.AZURE_ANALYZE_TIMEOUT_MS ?? 120000);

if (!BASE_URL) {
  throw new Error("AZURE_FUNCTIONS_URL is not configured");
}
if (!FUNCTION_KEY) {
  throw new Error("AZURE_FUNCTIONS_KEY is not configured");
}
if (!PIPELINE_API_KEY) {
  throw new Error("CARBONEYE_PIPELINE_API_KEY is not configured");
}

// One day of a facility's monitored readings, forwarded to the pipeline so a renewal
// certificate can blend the facility's last 3 months of history (see admin rerun).
export type HistoryReading = {
  date: string;
  co2_ppm: number;
  ch4_ppb: number;
  esg_score: number;
  verified_emissions_tco2eq: number;
  ndvi_mean?: number | null;
  temperature?: number | null;
  humidity?: number | null;
};

export type AnalyzeInput = {
  company_name: string;
  lat: number;
  lon: number;
  // Historical window the pipeline aggregates (days). Defaults to 90 on the worker.
  period_days?: number;
  // The facility's last-N-days readings (Premium renewals only). When present the
  // pipeline blends them instead of querying its own Cosmos history.
  history?: HistoryReading[];
};

export type AnalyzeResult = Record<string, unknown> & {
  certificate_id?: string;
  esg_score?: number;
  esg_grade?: string;
  timestamp?: string;
};

export type VerifyResult = Record<string, unknown> & {
  valid?: boolean;
  certificate_id?: string;
  data_hash?: string;
  hash_check?: {
    stored_data_hash?: string;
    recomputed_data_hash?: string;
    matched?: boolean;
  };
};

export type CertificatePdfResult = {
  certificate_id: string;
  pdf_blob_name?: string;
  pdf_sha256?: string;
  url: string;
  expires_in_seconds?: number;
};

export class AzureFunctionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly upstreamStatus?: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function mapStatus(status: number): number {
  if (status === 401 || status === 403) return 401;
  if (status === 424) return 424;
  if (status === 429) return 429;
  if (status === 408 || status === 504) return 504;
  return 502;
}

function functionUrl(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${separator}code=${encodeURIComponent(FUNCTION_KEY)}`;
}

async function parseError(res: Response): Promise<{ message: string; details?: unknown }> {
  const text = await res.text().catch(() => "");
  if (!text) return { message: res.statusText || "Azure Function error" };
  try {
    const json = JSON.parse(text) as { error?: string; message?: string; detail?: string };
    return {
      message: json.error ?? json.message ?? json.detail ?? text.slice(0, 200),
      details: json,
    };
  } catch {
    return { message: text.slice(0, 200), details: text.slice(0, 1000) };
  }
}

export async function callAnalyze(input: AnalyzeInput, userId: number): Promise<AnalyzeResult> {
  const url = functionUrl("/api/analyze");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PIPELINE_API_KEY}`,
        "x-user-id": String(userId),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new AzureFunctionError(`Azure analyze timed out after ${Math.round(ANALYZE_TIMEOUT_MS / 1000)}s`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const parsed = await parseError(res);
    logger.warn({ status: res.status, body: parsed.details }, "Azure analyze failed");
    throw new AzureFunctionError(parsed.message, mapStatus(res.status), res.status, parsed.details);
  }
  return (await res.json()) as AnalyzeResult;
}

/** Shape returned by POST /api/analyze-async — the pipeline runs in the background. */
export type AnalyzeAsyncStart = {
  request_id: string;
  status: string;
};

/** Result of a single poll of GET /api/analyze-async/{requestId}.
 *
 * Three terminal states the caller must handle:
 *   - { done: false }                               → pipeline still running, keep polling
 *   - { done: true, success: true, result }         → certificate ready
 *   - { done: true, success: false, reason }        → pipeline finished with a failure
 *
 * The third case used to be silently treated as { done: false } which left
 * submissions stuck in `analyzing` forever when the Python worker reported
 * a soft failure (status="rejected", "failed", etc.) instead of throwing.
 */
export type AnalyzePoll =
  | { done: false }
  | { done: true; success: true; result: AnalyzeResult }
  | { done: true; success: false; reason: string };

const TERMINAL_FAILURE_STATUSES = new Set([
  "rejected",
  "failed",
  "error",
  "analysis_failed",
]);

/**
 * Start an asynchronous analysis. Returns immediately with a request_id;
 * the long-running Sentinel-2 pipeline executes in the background on the
 * Python worker. Poll {@link pollAnalyzeAsync} until it reports done.
 */
export async function startAnalyzeAsync(
  input: AnalyzeInput,
  userId: number,
): Promise<AnalyzeAsyncStart> {
  const url = functionUrl("/api/analyze-async");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PIPELINE_API_KEY}`,
      "x-user-id": String(userId),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const parsed = await parseError(res);
    logger.warn({ status: res.status, body: parsed.details }, "Azure analyze-async start failed");
    throw new AzureFunctionError(parsed.message, mapStatus(res.status), res.status, parsed.details);
  }
  return (await res.json()) as AnalyzeAsyncStart;
}

/**
 * Poll an in-flight asynchronous analysis once.
 *
 * - Returns { done: false } while the pipeline is still running.
 * - Returns { done: true, result } once the certificate is ready.
 * - Throws AzureFunctionError if the pipeline rejected the request
 *   (e.g. no cloud-free satellite scene) — the message carries the reason.
 */
export async function pollAnalyzeAsync(requestId: string): Promise<AnalyzePoll> {
  const url = functionUrl(`/api/analyze-async/${encodeURIComponent(requestId)}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${PIPELINE_API_KEY}` },
  });
  if (!res.ok) {
    const parsed = await parseError(res);
    logger.warn({ requestId, status: res.status, body: parsed.details }, "Azure analyze-async poll failed");
    throw new AzureFunctionError(parsed.message, mapStatus(res.status), res.status, parsed.details);
  }
  const data = (await res.json()) as AnalyzeResult & {
    status?: string;
    rejection_reason?: string;
    message?: string;
  };
  if (data.status === "success" && data.certificate_id) {
    return { done: true, success: true, result: data };
  }
  const reportedStatus = (data.status ?? "").toLowerCase();
  if (TERMINAL_FAILURE_STATUSES.has(reportedStatus)) {
    return {
      done: true,
      success: false,
      reason:
        data.rejection_reason ??
        data.message ??
        `Pipeline reported terminal status "${data.status}"`,
    };
  }
  return { done: false };
}

async function callFunctionJson<T>(path: string): Promise<T> {
  const url = functionUrl(path);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${PIPELINE_API_KEY}`,
    },
  });
  if (!res.ok) {
    const parsed = await parseError(res);
    logger.warn({ path, status: res.status, body: parsed.details }, "Azure Function request failed");
    throw new AzureFunctionError(parsed.message, mapStatus(res.status), res.status, parsed.details);
  }
  return (await res.json()) as T;
}

export async function callVerify(certificateId: string): Promise<VerifyResult> {
  return callFunctionJson<VerifyResult>(`/api/certificates/${encodeURIComponent(certificateId)}/verify`);
}

export async function callCertificatePdf(certificateId: string): Promise<CertificatePdfResult> {
  return callFunctionJson<CertificatePdfResult>(`/api/certificates/${encodeURIComponent(certificateId)}/pdf`);
}
