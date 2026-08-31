/** Trusted provider-free L4. All inputs are reread closed evidence. */

import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { PrescribedKinematicsObservation } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsMethodSheet } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import type { PrescribedKinematicsEvaluation } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation.ts";

export interface EvaluatePrescribedKinematicsCommand {
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}

export interface EvaluatePrescribedKinematicsUseCase {
  execute(
    command: EvaluatePrescribedKinematicsCommand,
  ): Promise<PrescribedKinematicsEvaluation>;
}
