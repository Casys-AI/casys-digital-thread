/**
 * Inward port for one review-only geometry-module draft.
 *
 * Callers name only the exact project, current Thread basis, composite
 * PartDefinition and placement-analysis locator. The server recrosses
 * structure, placements and unique active child geometry. The result is a
 * draft plus decisionParameters for a later `design.write-geometry@1`.
 * It is not Thread state and grants none.
 */

import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { CadPlacementAnalysisCaptureLocator } from "../../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import type { GeometryExportFormat } from "../../../../../domain/cad/canonical/geometry-proposal.ts";

export interface ProjectGeometryModuleExportCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly partDefinitionElementId: string;
  readonly placementAnalysis: CadPlacementAnalysisCaptureLocator;
}

export interface ProjectGeometryModuleExportFile {
  readonly format: GeometryExportFormat;
  readonly name: string;
  readonly bytes: number;
  readonly digest: string;
}

export interface ProjectGeometryModuleExportResult {
  readonly draftDigest: string;
  readonly target: {
    readonly partDefinitionElementId: string;
    readonly label: string;
    readonly files: readonly ProjectGeometryModuleExportFile[];
  };
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  readonly grants: "none";
}

export type ProjectGeometryModuleExportErrorCode =
  | "invalid_request"
  | "basis_mismatch"
  | "unavailable"
  | "unresolved"
  | "asset_digest_mismatch"
  | "assembly_failure";

export class ProjectGeometryModuleExportError extends Error {
  constructor(
    readonly code: ProjectGeometryModuleExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectGeometryModuleExportError";
  }
}

export interface ProjectGeometryModuleExportUseCase {
  execute(value: unknown): Promise<ProjectGeometryModuleExportResult>;
}
