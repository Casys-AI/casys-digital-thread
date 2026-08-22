/**
 * Provider-free reopen of one already-recorded static-mechanical L5 closeout.
 *
 * This port never calls CalculiX or SysON and never invents Thread
 * consumptions. Absence or a reject closeout is a fact for the preservation
 * recross; the reader does not invent carried-forward.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface MechanicalPreservationCloseoutInputIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

export interface MechanicalPreservationCloseoutFacts {
  readonly operation: {
    readonly id: string;
    readonly version: string;
  };
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly consequence: "accept" | "reject";
  readonly inputs: {
    readonly canonicalStep: MechanicalPreservationCloseoutInputIdentity;
    readonly sealedProof: MechanicalPreservationCloseoutInputIdentity;
    readonly executionEvidence: MechanicalPreservationCloseoutInputIdentity;
    readonly evaluationCapture: MechanicalPreservationCloseoutInputIdentity;
  };
}

export interface MechanicalPreservationCloseoutReader {
  read(
    fingerprint: ContentFingerprint,
  ): Promise<MechanicalPreservationCloseoutFacts | undefined>;
}
