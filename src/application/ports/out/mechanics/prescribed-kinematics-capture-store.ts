/** Immutable content-addressed storage for the five durable vertical records. */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { PrescribedKinematicsCase } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { PrescribedKinematicsObservation } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsMethodSheet } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import type { PrescribedKinematicsEvaluation } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation.ts";
import type { PrescribedKinematicsEvaluationCloseoutCandidate } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import type { PrescribedKinematicsObservationRecord } from "./prescribed-kinematics-observer.ts";
import type { PrescribedKinematicsLoweredCase } from "./prescribed-kinematics-case-lowerer.ts";

export interface PrescribedKinematicsCaptureRef {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface PrescribedKinematicsObservationCapture {
  readonly schemaVersion: "prescribed-kinematics-observation-capture/2.0";
  readonly observation: PrescribedKinematicsObservation;
  /** Reread dispatch identity; both values are bound to receipt and lowering. */
  readonly request: Pick<
    PrescribedKinematicsObservationRecord["request"],
    "requestId" | "caseSha256"
  >;
  /** Fact-only provider provenance; it never becomes an L4 or L5 verdict. */
  readonly receipt: PrescribedKinematicsObservationRecord["receipt"];
  readonly notEvaluated: PrescribedKinematicsObservationRecord["notEvaluated"];
  /** Provenance of the exact server lowering; its request bytes are not stored. */
  readonly lowering: Pick<
    PrescribedKinematicsLoweredCase,
    "sourceFingerprint" | "loweringFingerprint" | "requestFingerprint"
  >;
}

export interface PrescribedKinematicsCaptureStore {
  saveCase(value: PrescribedKinematicsCase): Promise<PrescribedKinematicsCaptureRef>;
  readCase(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsCase | undefined>;
  saveObservation(
    value: PrescribedKinematicsObservationCapture,
    sealedCase: PrescribedKinematicsCase,
  ): Promise<PrescribedKinematicsCaptureRef>;
  readObservation(
    fingerprint: ContentFingerprint,
    sealedCase: PrescribedKinematicsCase,
  ): Promise<PrescribedKinematicsObservationCapture | undefined>;
  saveMethod(
    value: PrescribedKinematicsMethodSheet,
  ): Promise<PrescribedKinematicsCaptureRef>;
  readMethod(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsMethodSheet | undefined>;
  saveEvaluation(
    value: PrescribedKinematicsEvaluation,
  ): Promise<PrescribedKinematicsCaptureRef>;
  readEvaluation(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsEvaluation | undefined>;
  saveCloseout(
    value: PrescribedKinematicsEvaluationCloseoutCandidate,
  ): Promise<PrescribedKinematicsCaptureRef>;
  readCloseout(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsEvaluationCloseoutCandidate | undefined>;
}
