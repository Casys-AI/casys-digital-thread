/** Internal L3 runner; no public tool accepts this transport-facing command. */

import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  PrescribedKinematicsObservation,
} from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsPreDispatchRejectionCode,
} from "../../../out/mechanics/prescribed-kinematics-observer.ts";
import type { PrescribedKinematicsLoweredCase } from "../../../out/mechanics/prescribed-kinematics-case-lowerer.ts";
import type {
  CapabilityRuntimeLaunchGroupReference,
} from "../../../../../domain/capability/runtime/capability-runtime-launch-group.ts";

/**
 * Fact-only runtime identity stamped from the exact sealed ROP.  It is not a
 * provider request and contains no endpoint, tool arguments or secret value.
 */
export interface PrescribedKinematicsRuntimeProvenance {
  readonly resolvedOperationPlanFingerprint: ContentFingerprint;
  readonly operationalCapabilityFingerprint: ContentFingerprint;
  readonly binding: { readonly id: string; readonly version: string };
  readonly adapter: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
  };
  /** Null is a sealed fact: this binding has no separately versioned profile. */
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint | null;
  } | null;
  readonly material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  };
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly platformMode: "native" | "emulated" | "unavailable";
}

export interface RunPrescribedKinematicsObservationCommand {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly requestId: string;
  readonly startedAt: string;
  readonly runtime: PrescribedKinematicsRuntimeProvenance;
  readonly sealedCase: PrescribedKinematicsCase;
}

export type RunPrescribedKinematicsObservationResult =
  | {
    readonly status: "recorded";
    readonly observation: PrescribedKinematicsObservation;
    /** Exact dispatch identity factually reread with the provider receipt. */
    readonly request: Pick<
      PrescribedKinematicsObservationRecord["request"],
      "requestId" | "caseSha256"
    >;
    /** Factual provider provenance, retained without becoming a verdict. */
    readonly receipt: PrescribedKinematicsObservationRecord["receipt"];
    /** Exact nine-item provider wire boundary, preserved verbatim. */
    readonly providerNotEvaluated:
      PrescribedKinematicsObservationRecord["notEvaluated"];
    /** Source-to-request provenance; the request body itself is never captured. */
    readonly lowering: Pick<
      PrescribedKinematicsLoweredCase,
      "sourceFingerprint" | "loweringFingerprint" | "requestFingerprint"
    >;
  }
  | {
    readonly status: "quarantined";
    readonly reason: "uncertain" | "absent" | "malformed";
  }
  | {
    readonly status: "rejected";
    readonly code: PrescribedKinematicsPreDispatchRejectionCode;
  };

export interface RunPrescribedKinematicsObservationUseCase {
  execute(
    command: RunPrescribedKinematicsObservationCommand,
  ): Promise<RunPrescribedKinematicsObservationResult>;
}
