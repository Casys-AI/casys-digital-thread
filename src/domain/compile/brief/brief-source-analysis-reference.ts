/**
 * Stable, adapter-neutral handle for a captured project-brief source and its
 * provider-neutral local analysis. It is a CAS locator, never evidence or an
 * authority grant.
 */

import { exactRecord, safeId } from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export interface BriefSourceAnalysisReference {
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly sourceId: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly sourceCaptureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
}

/** Collision-safe identity for exactly one immutable brief revision. */
export async function briefSourceIdFor(
  briefId: string,
  briefSnapshotId: string,
  briefRevision: number,
): Promise<string> {
  safeId(briefId, "$brief.briefId");
  safeId(briefSnapshotId, "$brief.id");
  if (!Number.isSafeInteger(briefRevision) || briefRevision < 1) {
    throw new TypeError("$brief.revision must be a positive integer.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(deterministicJson({
      briefId,
      briefRevision,
      briefSnapshotId,
    })),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return safeId(`brief-source:${fingerprint}`, "$brief.sourceId");
}

export function validateBriefSourceAnalysisReference(
  value: unknown,
): BriefSourceAnalysisReference {
  const reference = exactRecord(
    value,
    [
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "sourceId",
      "sourceFingerprint",
      "sourceCaptureFingerprint",
      "analysisFingerprint",
    ],
    "$briefSourceAnalysisReference",
  );
  const briefRevision = reference.briefRevision;
  if (
    !Number.isSafeInteger(briefRevision) ||
    (typeof briefRevision === "number" && briefRevision < 1)
  ) {
    throw new TypeError(
      "$briefSourceAnalysisReference.briefRevision must be positive.",
    );
  }
  return Object.freeze({
    briefId: safeId(reference.briefId, "$briefSourceAnalysisReference.briefId"),
    briefSnapshotId: safeId(
      reference.briefSnapshotId,
      "$briefSourceAnalysisReference.briefSnapshotId",
    ),
    briefRevision: briefRevision as number,
    sourceId: safeId(reference.sourceId, "$briefSourceAnalysisReference.sourceId"),
    sourceFingerprint: fingerprint(
      reference.sourceFingerprint,
      "$briefSourceAnalysisReference.sourceFingerprint",
    ),
    sourceCaptureFingerprint: fingerprint(
      reference.sourceCaptureFingerprint,
      "$briefSourceAnalysisReference.sourceCaptureFingerprint",
    ),
    analysisFingerprint: fingerprint(
      reference.analysisFingerprint,
      "$briefSourceAnalysisReference.analysisFingerprint",
    ),
  });
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const candidate = exactRecord(value, ["algorithm", "digest"], path);
  if (
    candidate.algorithm !== "sha256" || typeof candidate.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.digest)
  ) throw new TypeError(`${path} must be a canonical SHA-256 fingerprint.`);
  return Object.freeze({ algorithm: "sha256", digest: candidate.digest });
}
