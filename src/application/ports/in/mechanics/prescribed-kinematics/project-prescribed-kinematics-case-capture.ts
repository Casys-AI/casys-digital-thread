/** Read-only preparation of one exact mechanism case from the source workspace. */

import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";

export interface ProjectPrescribedKinematicsCaseCaptureCommand {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export type ProjectPrescribedKinematicsCaseCaptureResult =
  | {
    readonly status: "resolved";
    readonly sealedCase: PrescribedKinematicsCase;
    readonly grants: "none";
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostic: { readonly code: string; readonly message: string };
    readonly grants: "none";
  };

export interface ProjectPrescribedKinematicsCaseCaptureUseCase {
  capture(value: unknown): Promise<ProjectPrescribedKinematicsCaseCaptureResult>;
}
