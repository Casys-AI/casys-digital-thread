/** Internal provider-free L4-method seal boundary. */

import type { AgentResourceReference } from "../../../../../domain/resource/agent-resource-capture.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { PrescribedKinematicsObservation } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsMethodSheet } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";

export interface SealPrescribedKinematicsMethodCommand {
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  /** Exact resource named in the already human-signed MRTR parameters. */
  readonly resourceRef: AgentResourceReference;
  readonly signedResourceFingerprint: ContentFingerprint;
}

export interface SealPrescribedKinematicsMethodUseCase {
  execute(
    command: SealPrescribedKinematicsMethodCommand,
  ): Promise<PrescribedKinematicsMethodSheet>;
}
