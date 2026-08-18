/**
 * Outward port for exporting one already-admitted Build123d source.
 *
 * The application supplies only the exact sealed source bytes and the
 * architecture identity they were admitted against. Provider, tool, path,
 * image, formats and export names stay behind the adapter and cannot leak
 * into the caller-facing command.
 */

import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { GeometryDraftAdmission } from "../../../domain/engineering/geometry-draft-admission.ts";
import type { GeometryExportFormat } from "../../../domain/engineering/geometry-proposal.ts";

/** Exact admitted source plus the current Thread architecture identity. */
export interface AdmittedGeometryExportRequest {
  readonly script: string;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly admission: GeometryDraftAdmission;
}

export interface AdmittedGeometryExportedFile {
  readonly format: GeometryExportFormat;
  readonly name: string;
  readonly bytes: number;
  readonly digest: string;
}

/**
 * Geometry DRAFT facts produced by the private sandbox. This is not Thread
 * state and grants no sealing authority.
 */
export interface AdmittedGeometryExportDraft {
  readonly draftDigest: string;
  readonly scriptHash: ContentFingerprint;
  readonly exportFormats: readonly GeometryExportFormat[];
  readonly assemblyFiles: readonly AdmittedGeometryExportedFile[];
  readonly partMeshes: readonly {
    readonly usageName: string;
    readonly name: string;
    readonly bytes: number;
    readonly digest: string;
  }[];
  readonly sourceAnalysis: {
    readonly sourceId: string;
    readonly selector: unknown;
    readonly sourceDigest: string;
    readonly sourceCaptureDigest: string;
    readonly analysisDigest: string;
  };
}

/** Sends exact admitted bytes through the server-owned geometry export path. */
export interface AdmittedGeometryExporter {
  export(
    request: AdmittedGeometryExportRequest,
  ): Promise<AdmittedGeometryExportDraft>;
}
