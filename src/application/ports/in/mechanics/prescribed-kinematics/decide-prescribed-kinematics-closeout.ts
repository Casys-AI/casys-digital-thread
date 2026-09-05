/** Exact human-only L5 input. The public review prepares this; it never decides. */

import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { PrescribedKinematicsObservation } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type { PrescribedKinematicsMethodSheet } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import type { PrescribedKinematicsEvaluationCloseoutCandidate } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";

export interface DecidePrescribedKinematicsCloseoutCommand {
  readonly origin: "human";
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly candidate: PrescribedKinematicsEvaluationCloseoutCandidate;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
  readonly method: PrescribedKinematicsMethodSheet;
}

export interface DecidePrescribedKinematicsCloseoutUseCase {
  execute(
    command: DecidePrescribedKinematicsCloseoutCommand,
  ): Promise<PrescribedKinematicsEvaluationCloseoutCandidate>;
}
