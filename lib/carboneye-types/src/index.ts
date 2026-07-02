/**
 * lib/carboneye-types/src/index.ts — Shared TypeScript types for the CarbonEYE platform (certificate request lifecycle, coordinates, responses) serving as the single source of truth across frontend and backend.
 * Author: Pasquale Marzaioli
 */
/**
 * sito/lib/carboneye-types/src/index.ts
 *
 * Shared TypeScript types for the CarbonEYE platform.
 * Re-exported from here so that both the TypeScript API (api-ts/) and the
 * sito/ frontend import from a single source of truth.
 *
 * Import in sito artifacts:
 *   import type { CertificateRequest, RequestStatus } from '@workspace/carboneye-types';
 *
 * These types mirror the Python data models in api/function_app.py.
 * Any change to the API contract must be reflected here AND in the Python side.
 */

// ─── Certificate Request Lifecycle States ────────────────────────────────────

/**
 * All valid states a certificate request can pass through.
 * The state machine is: submitted → analyzing → pending_approval → approved | rejected
 * Terminal states (approved / rejected) are immutable — no further transitions allowed.
 */
export type RequestStatus =
  | 'submitted'         // User submitted the request; admin has not yet triggered the pipeline
  | 'analyzing'         // Admin triggered the pipeline; analysis is running asynchronously
  | 'pending_approval'  // Pipeline completed; draft certificate awaits admin review
  | 'approved'          // Admin approved the certificate; it is now visible to the requesting company
  | 'rejected';         // Admin (or a pipeline error) rejected the request; reason returned to user

// ─── Shared Value Objects ─────────────────────────────────────────────────────

/**
 * Geographic coordinates in decimal degrees (WGS-84).
 * Required for satellite data retrieval — both lat and lon must be present.
 */
export interface Coordinates {
  lat: number; // Latitude; valid range [-90, 90]
  lon: number; // Longitude; valid range [-180, 180]
}

/**
 * Date range for the certificate's analysis window.
 * ISO 8601 date strings (YYYY-MM-DD).
 */
export interface DateRange {
  start: string; // Start of the analysis window (inclusive)
  end: string;   // End of the analysis window (inclusive)
}

// ─── Core Domain Objects ──────────────────────────────────────────────────────

/**
 * A certificate request as stored in Cosmos DB and returned by the API.
 * Fields are populated progressively as the request moves through the workflow:
 *   - On submit: id, request_id, company_name, coordinates, date_range, period_days, submitted_at, status
 *   - After analysis: analysis_started_at, analysis_finished_at, certificate_id, esg_*, anomalies_count, greenwashing_risk, pdf_blob_name, data_hash
 *   - After admin action: admin_action_at, admin_note (if approved) or rejection_reason (if rejected)
 */
export interface CertificateRequest {
  id: string;                    // Cosmos partition key — same value as request_id
  request_id: string;            // Human-readable request ID, format: REQ-YYYY-XXXXXXXX
  company_name: string;          // Legal name of the company requesting the certificate
  coordinates: Coordinates;      // Geographic location of the emission site to analyse
  date_range: DateRange;         // Analysis window requested by the company
  period_days: number;           // Historical rolling window in days (7–365, default 90)
  submitted_at: string;          // ISO datetime when the user submitted the request
  status: RequestStatus;         // Current lifecycle state — drives all conditional rendering

  // Populated after the admin triggers the pipeline (analyzing → pending_approval)
  analysis_started_at?: string;  // ISO datetime the pipeline started
  analysis_finished_at?: string; // ISO datetime the pipeline completed
  certificate_id?: string;       // Draft certificate ID, format: CEYE-YYYY-XXXXXXXX
  esg_score?: number;            // Computed ESG score, range 0–100
  esg_grade?: string;            // Letter grade: A, A-, B+, B, C+, C, D, F
  anomalies_count?: number;      // Number of emission anomalies detected
  greenwashing_risk?: string;    // Derived risk level: "low" | "medium" | "high"
  pdf_blob_name?: string;        // Azure Blob name for the PDF; used to build the download URL
  data_hash?: string;            // SHA-256 of the canonical source payload (load-bearing integrity hash)

  // Populated after the admin approves or rejects (pending_approval → approved | rejected)
  admin_action_at?: string;      // ISO datetime of the admin action
  admin_note?: string;           // Optional note from admin (visible to company on approval)
  rejection_reason?: string;     // Required reason when admin rejects (visible to company)
}

/**
 * API key record as stored in Cosmos DB `api-keys` container.
 * The plaintext key is never stored — only its SHA-256 hex digest.
 * A key is considered revoked if revoked_at is present.
 */
export interface ApiKeyRecord {
  id: string;            // Cosmos item ID — same as api_key_hash for O(1) lookup
  company_name: string;  // Company this key belongs to
  api_key_hash: string;  // SHA-256 hex digest of the plaintext key (never store plaintext)
  rate_limit: number;    // Max allowed requests per hour for this key
  created_at: string;    // ISO datetime of key creation
  revoked_at?: string;   // ISO datetime of revocation; absent means the key is active
  description?: string;  // Human-readable note (e.g. "ERP integration via SAP connector")
}

/**
 * Structured error response — every non-2xx response uses this shape.
 * The `code` field is machine-readable; `message` is for human display.
 */
export interface ErrorResponse {
  status: 'error'; // Always the literal string "error"
  message: string; // Human-readable description of the error
  code: string;    // Machine-readable code (e.g. "INVALID_STATE", "NOT_FOUND", "UNAUTHORIZED")
}

// ─── Request / Response bodies used by sito/ ─────────────────────────────────

/**
 * Request body for POST /api/certificate-requests.
 * All three top-level fields are required; period_days is optional (defaults to 90).
 */
export interface SubmitCertificateRequestBody {
  company_name: string;       // Legal name of the requesting company
  coordinates: Coordinates;   // Emission site location
  date_range: DateRange;      // Analysis window
  period_days?: number;       // Historical rolling window, defaults to 90 if omitted
}

/**
 * Success response from POST /api/certificate-requests (HTTP 202 Accepted).
 * The request is queued; the company should poll GET /api/certificate-requests/{id}
 * for status updates.
 */
export interface SubmitCertificateRequestResponse {
  request_id: string;    // Permanent ID to use for all subsequent polling calls
  status: 'submitted';   // Always "submitted" immediately after creation
  message: string;       // Human-readable confirmation message
  submitted_at: string;  // ISO datetime of submission (for display in the portal)
}
