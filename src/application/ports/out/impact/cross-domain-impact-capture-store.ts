/** Content-addressed persistence for the closed impact-manifest seal capture. */

import type { CrossDomainImpactDecisionCapture } from "../../../../domain/impact/cross-domain-impact-decision-capture.ts";
import type { CrossDomainImpactManifestSealCapture } from "../../../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import type { CrossDomainImpactEvaluationCapture } from "../../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import type { MechanicalPreservationCapture } from "../../../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface CrossDomainImpactManifestSealCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface CrossDomainImpactManifestSealCaptureStore {
  save(
    capture: CrossDomainImpactManifestSealCapture,
  ): Promise<CrossDomainImpactManifestSealCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactManifestSealCapture | undefined>;
}

/** Content-addressed storage for an X07/X08 documentary impact evaluation. */
export interface CrossDomainImpactEvaluationCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface CrossDomainImpactEvaluationCaptureStore {
  save(
    capture: CrossDomainImpactEvaluationCapture,
  ): Promise<CrossDomainImpactEvaluationCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactEvaluationCapture | undefined>;
}

export interface CrossDomainImpactDecisionCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface CrossDomainImpactDecisionCaptureStore {
  save(
    capture: CrossDomainImpactDecisionCapture,
  ): Promise<CrossDomainImpactDecisionCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactDecisionCapture | undefined>;
}

export interface MechanicalPreservationCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface MechanicalPreservationCaptureStore {
  save(
    capture: MechanicalPreservationCapture,
  ): Promise<MechanicalPreservationCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<MechanicalPreservationCapture | undefined>;
}
