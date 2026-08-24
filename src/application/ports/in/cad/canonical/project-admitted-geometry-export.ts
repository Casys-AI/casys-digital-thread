/**
 * Inward port for exporting geometry from one sealed compilation admission.
 *
 * After `compile.seal-admission@3`, callers name only the exact project,
 * Thread basis and admission artefact. They cannot supply source text,
 * provider, tool, path, image or formats. The result is a geometry DRAFT for
 * later `design.write-geometry@1`; it is not Thread state.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";
import type { GeometryExportFormat } from "../../../../../domain/cad/canonical/geometry-proposal.ts";

export interface ProjectAdmittedGeometryExportCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectAdmittedGeometryExportFile {
  readonly format: GeometryExportFormat;
  readonly name: string;
  readonly bytes: number;
  readonly digest: string;
}

export interface ProjectAdmittedGeometryExportSourceAnalysis {
  readonly sourceId: string;
  readonly selector: unknown;
  readonly sourceDigest: string;
  readonly sourceCaptureDigest: string;
  readonly analysisDigest: string;
}

export interface ProjectAdmittedGeometryExportResult {
  readonly draftDigest: string;
  /**
   * Present only for a multi-part targeted export. The legacy arrays remain
   * empty in that mode for transport compatibility; they are not a manifest.
   */
  readonly target?: {
    readonly partDefinitionElementId: string;
    readonly label: string;
    readonly files: readonly ProjectAdmittedGeometryExportFile[];
  };
  readonly assemblyFiles: readonly ProjectAdmittedGeometryExportFile[];
  readonly partMeshes: readonly {
    readonly usageName: string;
    readonly name: string;
    readonly bytes: number;
    readonly digest: string;
  }[];
  readonly partDefinitions: readonly {
    readonly elementId: string;
    readonly label: string;
    readonly files: readonly ProjectAdmittedGeometryExportFile[];
  }[];
  readonly sourceAnalysis: ProjectAdmittedGeometryExportSourceAnalysis;
  /** Canonical MRTR scalars for a later `design.write-geometry@1` proposal. */
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectAdmittedGeometryExportUseCase {
  execute(value: unknown): Promise<ProjectAdmittedGeometryExportResult>;
}
