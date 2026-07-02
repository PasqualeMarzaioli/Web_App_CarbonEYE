/**
 * artifacts/api-server/src/lib/submissionSchema.ts — Validates and types certificate submission requests, supporting both new facilities and facility renewals with required and optional fields.
 * Author: Pasquale Marzaioli
 */
// A certificate request is always for a single facility (the supply-chain / multi-
// facility flow was removed). `facilityId` is present only when the request is a
// renewal of an existing monitoring tab; absent for a brand-new facility, in which
// case the webhook creates the facility.
export type SubmissionDraft = {
  companyName: string;
  industry: string | null;
  lat: number;
  lon: number;
  notes: string | null;
  facilityId: number | null;
};

export type SubmissionTier = "basic" | "premium";

export function isSubmissionTier(value: unknown): value is SubmissionTier {
  return value === "basic" || value === "premium";
}

export function validateSubmissionDraft(input: unknown):
  | { ok: true; draft: SubmissionDraft }
  | { ok: false; error: string } {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const companyName = body.companyName;
  const latNum = Number(body.lat);
  const lonNum = Number(body.lon);

  if (
    typeof companyName !== "string" ||
    !companyName.trim() ||
    Number.isNaN(latNum) ||
    Number.isNaN(lonNum)
  ) {
    return { ok: false, error: "companyName, lat, lon are required" };
  }

  // Optional facilityId — present only for a renewal of an existing facility.
  let facilityId: number | null = null;
  if (body.facilityId != null) {
    const fid = Number(body.facilityId);
    if (!Number.isInteger(fid) || fid <= 0) {
      return { ok: false, error: "facilityId must be a positive integer when provided" };
    }
    facilityId = fid;
  }

  return {
    ok: true,
    draft: {
      companyName: companyName.trim(),
      industry: typeof body.industry === "string" ? body.industry : null,
      lat: latNum,
      lon: lonNum,
      notes: typeof body.notes === "string" ? body.notes : null,
      facilityId,
    },
  };
}
