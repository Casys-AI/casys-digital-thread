/** Closed factual criteria for the CalculiX HTTP host qualification fixture. */

import type { CalculixHttpRuntimeQualificationCandidate } from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import {
  lowerRecordedCalculixStaticRequest,
  parseRecordedCalculixCompletedDispatch,
  parseRecordedCalculixCompletedReadback,
  parseRecordedCalculixStaticResultBytes,
  verifyCapturedRecordedCalculixRequest,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import type { SensitivityRecordedSolveReadback } from "../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";

export const CALCULIX_HTTP_QUALIFICATION_CRITERIA = deepFreeze({
  schemaVersion: "calculix-http-qualification-criteria/1.0",
  expectedUnits: { maximumDisplacement: "mm", maximumVonMisesStress: "MPa" },
  closedNumericBounds: {
    maximumDisplacementMm: { minimumExclusive: 0, maximumInclusive: 50 },
    maximumVonMisesStressMpa: { minimumExclusive: 0, maximumInclusive: 5_000 },
  },
  evidenceBoundary:
    "Factual host runtime contract only; no product, Thread, requirement, safety, or engineering verdict.",
});

export interface CalculixHttpQualificationEvidence {
  readonly recordedDispatch: unknown;
  readonly recordedReadback: unknown;
  readonly requestJsonBytes: Uint8Array;
  readonly resultJsonBytes: Uint8Array;
}

export function fingerprintCalculixHttpQualificationCriteria(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(CALCULIX_HTTP_QUALIFICATION_CRITERIA);
}

/**
 * Validates an acknowledged completed recorded solve, its exact nine-resource
 * readback, independently rehashed request JSON, and bounded factual metrics.
 */
export async function assertCalculixHttpQualificationEvidence(
  candidate: CalculixHttpRuntimeQualificationCandidate,
  evidence: CalculixHttpQualificationEvidence,
): Promise<void> {
  const dispatch = parseRecordedCalculixCompletedDispatch(evidence.recordedDispatch);
  const completed = parseRecordedCalculixCompletedReadback(evidence.recordedReadback, {
    requestId: candidate.fixture.case.requestId,
    stepSha256: candidate.fixture.step.sha256,
    stepBytes: candidate.fixture.step.byteCount,
    dispatch,
  });
  const readback: SensitivityRecordedSolveReadback = {
    phase: "base",
    stepSha256: candidate.fixture.step.sha256,
    stepBytes: candidate.fixture.step.byteCount,
    requestId: completed.requestId,
    runId: completed.runId,
    requestSha256: completed.requestSha256,
    resources: completed.artifacts,
    canonicalText: "",
    fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
  };
  const request = resource(readback, "request.json");
  const result = resource(readback, "result.json");
  if (
    evidence.requestJsonBytes.byteLength !== request.byteCount ||
    await fingerprintResourceBytes(evidence.requestJsonBytes) !== request.sha256 ||
    evidence.resultJsonBytes.byteLength !== result.byteCount ||
    await fingerprintResourceBytes(evidence.resultJsonBytes) !== result.sha256
  ) {
    throw new TypeError(
      "CalculiX qualification resource bytes do not match the recorded ledger.",
    );
  }
  await verifyCapturedRecordedCalculixRequest({
    bytes: evidence.requestJsonBytes,
    readback,
    method: candidate.fixture.method,
  });
  const expectedRequest = await sha256Fingerprint(
    lowerRecordedCalculixStaticRequest({
      requestId: candidate.fixture.case.requestId,
      stepSha256: candidate.fixture.step.sha256,
      stagedPath: `/inputs/fea-${candidate.fixture.step.sha256}.step`,
      method: candidate.fixture.method,
    }),
  );
  if (expectedRequest.digest !== candidate.fixture.case.fingerprint.digest) {
    throw new TypeError("CalculiX qualification candidate case fingerprint drifted.");
  }
  const parsed = parseRecordedCalculixStaticResultBytes(
    evidence.resultJsonBytes,
    readback,
    candidate.fixture.method,
  );
  const displacement = parsed.observations.maximumDisplacement.magnitude;
  const stress = parsed.observations.maximumVonMisesStress.magnitude;
  if (
    displacement.unit !==
      CALCULIX_HTTP_QUALIFICATION_CRITERIA.expectedUnits.maximumDisplacement ||
    stress.unit !==
      CALCULIX_HTTP_QUALIFICATION_CRITERIA.expectedUnits.maximumVonMisesStress
  ) {
    throw new TypeError(
      "CalculiX qualification result units differ from the closed criteria.",
    );
  }
  assertBounded(
    displacement.value,
    CALCULIX_HTTP_QUALIFICATION_CRITERIA.closedNumericBounds.maximumDisplacementMm,
    "maximum displacement",
  );
  assertBounded(
    stress.value,
    CALCULIX_HTTP_QUALIFICATION_CRITERIA.closedNumericBounds.maximumVonMisesStressMpa,
    "maximum von Mises stress",
  );
}

function resource(
  readback: SensitivityRecordedSolveReadback,
  role: "request.json" | "result.json",
) {
  const value = readback.resources.find((candidate) => candidate.role === role);
  if (!value) throw new TypeError(`CalculiX qualification lacks ${role}.`);
  return value;
}

function assertBounded(
  value: number,
  bound: { readonly minimumExclusive: number; readonly maximumInclusive: number },
  label: string,
): void {
  if (!(value > bound.minimumExclusive) || value > bound.maximumInclusive) {
    throw new TypeError(
      `CalculiX qualification ${label} is outside its closed numeric bounds.`,
    );
  }
}
