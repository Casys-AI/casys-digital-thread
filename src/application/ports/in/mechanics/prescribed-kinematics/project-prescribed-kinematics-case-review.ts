/**
 * Public, read-only L1 review: a source/architecture recross plus one
 * paste-ready route for the already registered case-seal operation.
 */

import type { PrescribedKinematicsCase } from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { EngineeringThreadSnapshotRef } from "../../../../../domain/project/engineering-project.ts";
import type { ProjectPrescribedKinematicsNextHop } from "./project-prescribed-kinematics-next-hop-review.ts";

export type ProjectPrescribedKinematicsCaseReviewResult =
  | {
    readonly status: "resolved";
    readonly sealedCase: PrescribedKinematicsCase;
    readonly basis: EngineeringThreadSnapshotRef;
    readonly grants: "none";
    /** A server-derived route to the registered L1 operation, never an approval. */
    readonly next: ProjectPrescribedKinematicsNextHop;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostic: { readonly code: string; readonly message: string };
    readonly grants: "none";
  };

export interface ProjectPrescribedKinematicsCaseReviewUseCase {
  review(value: unknown): Promise<ProjectPrescribedKinematicsCaseReviewResult>;
}
