/**
 * L3 recovery journal.  A `dispatching` record is deliberately a one-way
 * boundary: a restart can read the same request or receipt, never call `run`
 * again.  Provider selection is absent from both the identity and the WAL.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { PrescribedKinematicsPreDispatchRejectionCode } from "./prescribed-kinematics-observer.ts";
import type {
  PrescribedKinematicsRuntimeProvenance,
} from "../../in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";

export interface PrescribedKinematicsObservationAttemptIdentity {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly requestId: string;
  readonly caseFingerprint: ContentFingerprint;
  /** Exact sealed ROP/runtime identity, never provider arguments. */
  readonly runtime: PrescribedKinematicsRuntimeProvenance;
  /** Exact fingerprint of the source bytes reopened from the sealed case. */
  readonly sourceFingerprint: ContentFingerprint;
  /** Exact server-owned source-to-request lowering identity. */
  readonly loweringFingerprint: ContentFingerprint;
  /** SHA-256 of the exact ephemeral provider request bytes. */
  readonly requestFingerprint: ContentFingerprint;
  readonly startedAt: string;
}

export interface PrescribedKinematicsObservationAttemptKey {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly requestId: string;
}

export type PrescribedKinematicsObservationAttempt =
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "prepared";
  })
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "case-submitted";
    readonly caseSha256: string;
    readonly caseUri: string;
  })
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "dispatching";
    readonly caseSha256: string;
    readonly caseUri: string;
  })
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "recorded";
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly receiptSha256: string;
  })
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "quarantined";
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly quarantineReason: "uncertain" | "absent" | "malformed";
  })
  | (PrescribedKinematicsObservationAttemptIdentity & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "rejected";
    readonly caseSha256: string;
    readonly caseUri: string;
    readonly rejectionCode: PrescribedKinematicsPreDispatchRejectionCode;
  });

export type PrescribedKinematicsDispatchingAttempt =
  & PrescribedKinematicsObservationAttemptIdentity
  & {
    readonly schemaVersion: "prescribed-kinematics-observation-attempt/4.0";
    readonly phase: "dispatching";
    readonly caseSha256: string;
    readonly caseUri: string;
  };

export interface PrescribedKinematicsObservationAttemptStore {
  read(
    key: PrescribedKinematicsObservationAttemptKey,
  ): Promise<PrescribedKinematicsObservationAttempt | undefined>;
  prepare(
    identity: PrescribedKinematicsObservationAttemptIdentity,
  ): Promise<PrescribedKinematicsObservationAttempt>;
  markCaseSubmitted(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    submitted: { readonly caseSha256: string; readonly caseUri: string },
  ): Promise<PrescribedKinematicsObservationAttempt>;
  /** Returns true exactly once, in the local continuation that may call run. */
  markDispatching(
    identity: PrescribedKinematicsObservationAttemptIdentity,
  ): Promise<
    | {
      readonly attempt: PrescribedKinematicsDispatchingAttempt;
      readonly dispatchNow: true;
    }
    | {
      readonly attempt: PrescribedKinematicsObservationAttempt;
      readonly dispatchNow: false;
    }
  >;
  markRecorded(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    receiptSha256: string,
  ): Promise<PrescribedKinematicsObservationAttempt>;
  markQuarantined(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    reason: "uncertain" | "absent" | "malformed",
  ): Promise<
    | Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "quarantined" }>
    | Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "recorded" }>
  >;
  markRejected(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    code: PrescribedKinematicsPreDispatchRejectionCode,
  ): Promise<
    Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "rejected" }>
  >;
}
