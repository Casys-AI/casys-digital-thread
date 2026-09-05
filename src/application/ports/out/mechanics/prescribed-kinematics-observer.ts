/**
 * Temporary provider-neutral application DTOs for the prescribed-kinematics
 * vertical.  The mechanism domain will replace these transport-facing facts
 * with its sealed case, method, and evaluation value objects; provider JSON
 * must not leak into that future domain model.
 */

export interface PrescribedKinematicsCaseSubmissionRequest {
  /** Exact UTF-8 text supplied by the server-owned mechanism lowering. */
  readonly exactCaseText: string;
  /** Required content identity of those exact ephemeral submission bytes. */
  readonly requestFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}

export interface SubmittedPrescribedKinematicsCase {
  readonly caseSha256: string;
  readonly caseUri: string;
}

export interface PrescribedKinematicsSamplePageRequest {
  readonly sampleOffset?: number;
  readonly sampleLimit?: number;
}

export interface PrescribedKinematicsRunRequest
  extends PrescribedKinematicsSamplePageRequest {
  readonly requestId: string;
  readonly caseSha256: string;
  /** Exact URI returned by the prior case-submission readback. */
  readonly caseUri: string;
  readonly timeoutMs?: number;
}

export interface PrescribedKinematicsSamplePage
  extends Required<PrescribedKinematicsSamplePageRequest> {
  readonly total: number;
  readonly returned: number;
  readonly hasMore: boolean;
  readonly samples: readonly PrescribedKinematicsSample[];
}

export interface PrescribedKinematicsSample {
  readonly timeSeconds: number;
  readonly bodies: readonly PrescribedKinematicsBodyObservation[];
  readonly joints: readonly PrescribedKinematicsJointObservation[];
}

export interface PrescribedKinematicsBodyObservation {
  readonly bodyId: string;
  readonly positionMetres: readonly [number, number, number];
  readonly rotationWxyz: readonly [number, number, number, number];
}

export interface PrescribedKinematicsJointObservation {
  readonly jointId: string;
  readonly motorAngleRadians: number;
  readonly declaredLimitObservation: "below" | "within" | "above";
  readonly translationResidualMetres: readonly [number, number, number];
  readonly rotationQuaternionImagResidual: readonly [number, number, number];
}

export interface PrescribedKinematicsReceipt {
  readonly receiptSha256: string;
  readonly caseSha256: string;
  readonly outcomeSha256: string;
  readonly requestId: string;
  readonly recordedAt: string;
  /** Factual engine identity; it is not a provider-selection input. */
  readonly engine: { readonly name: string; readonly version: string };
  readonly runtime: {
    readonly binding: string;
    readonly pythonVersion: string;
    readonly serverDenoVersion: string;
  };
  readonly workerSourceSha256: string;
  readonly executionState: "completed" | "not-converged";
  readonly kinematicsExit: { readonly rawCode: number; readonly rawName: string };
}

export interface PrescribedKinematicsObservationRecord {
  readonly request: PrescribedKinematicsRunRequest;
  readonly recordedAt: string;
  readonly receipt: PrescribedKinematicsReceipt;
  readonly notEvaluated: readonly [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
  ];
  readonly sampleCount: number;
  readonly sampleTimeRangeSeconds: { readonly first: number; readonly last: number };
  readonly samplePage: PrescribedKinematicsSamplePage;
}

/**
 * Published mcp-chrono 0.3.2 failures proved to occur before a run intent is
 * recorded. They are a definite rejection, never an uncertain dispatch.
 */
export type PrescribedKinematicsPreDispatchRejectionCode =
  | "case_invalid"
  | "case_not_found"
  | "case_sha256_mismatch"
  | "case_uri_mismatch"
  | "invalid_case_json"
  | "invalid_request_id"
  | "invalid_sample_limit"
  | "invalid_sample_offset"
  | "invalid_timeout"
  | "request_conflict";

export type PrescribedKinematicsRunReadback =
  | {
    readonly state: "recorded";
    readonly record: PrescribedKinematicsObservationRecord;
  }
  | {
    readonly state: "uncertain";
    readonly requestId: string;
    readonly caseSha256: string;
    readonly caseUri: string;
  }
  | {
    readonly state: "rejected";
    readonly code: PrescribedKinematicsPreDispatchRejectionCode;
  }
  | { readonly state: "absent" };

/**
 * Provider-neutral observation port.  It makes no result or engineering
 * verdict: calls expose only exact submitted-case and factual run readbacks.
 */
export interface PrescribedKinematicsObserver {
  submitCase(
    request: PrescribedKinematicsCaseSubmissionRequest,
  ): Promise<SubmittedPrescribedKinematicsCase>;
  run(
    request: PrescribedKinematicsRunRequest,
  ): Promise<PrescribedKinematicsRunReadback>;
  readRun(
    /** Exact request/case identity expected by recovery; never a free lookup. */
    request: Pick<
      PrescribedKinematicsRunRequest,
      "requestId" | "caseSha256" | "caseUri"
    >,
    page?: PrescribedKinematicsSamplePageRequest,
  ): Promise<PrescribedKinematicsRunReadback>;
  readReceipt(
    receiptSha256: string,
    page?: PrescribedKinematicsSamplePageRequest,
  ): Promise<PrescribedKinematicsObservationRecord>;
}
