/**
 * Outward port for exporting one already-admitted Build123d source.
 *
 * The application supplies only the exact sealed source bytes and the
 * architecture identity they were admitted against. Provider, tool, path,
 * image, formats and export names stay behind the adapter and cannot leak
 * into the caller-facing command.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  GeometryDraftAdmission,
  GeometryPartDraftAdmission,
} from "../../../../../domain/cad/canonical/geometry-draft-admission.ts";
import type { GeometryExportFormat } from "../../../../../domain/cad/canonical/geometry-proposal.ts";
import type { GeometryTargetPredecessor } from "../../../../../domain/cad/geometry-capture-contract.ts";

/** Exact admitted source plus the current Thread architecture identity. */
export interface AdmittedGeometryExportRequest {
  readonly script: string;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly admission: GeometryDraftAdmission;
  /** Unique represents PartDefinition. Server-derived; callers cannot choose it. */
  readonly representedPart: {
    readonly elementId: string;
    readonly label: string;
  };
  /** Unique active geometry tip when one already exists. */
  readonly predecessor?: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
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
  readonly partExportFormats: readonly GeometryExportFormat[];
  readonly assemblyFiles: readonly AdmittedGeometryExportedFile[];
  readonly partMeshes: readonly {
    readonly usageName: string;
    readonly name: string;
    readonly bytes: number;
    readonly digest: string;
  }[];
  readonly partDefinitions: readonly {
    readonly elementId: string;
    readonly label: string;
    readonly scriptHash: ContentFingerprint;
    readonly files: readonly AdmittedGeometryExportedFile[];
  }[];
  readonly predecessor?: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly sourceAnalysis: {
    readonly sourceId: string;
    readonly selector: unknown;
    readonly sourceDigest: string;
    readonly sourceCaptureDigest: string;
    readonly analysisDigest: string;
  };
}

/**
 * Server-derived request for one exact PartDefinition in a multi-part
 * architecture. It intentionally carries no assembly, occurrence, provider,
 * path, tool, format, or timeout field.
 */
export interface AdmittedGeometryTargetedPartExportRequest {
  readonly script: string;
  readonly architectureBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly artifactFingerprint: ContentFingerprint;
  };
  readonly admission: GeometryPartDraftAdmission;
  readonly target: {
    readonly partDefinitionElementId: string;
    readonly label: string;
  };
  /** Unique active canonical capture for this exact target only. */
  readonly predecessor?: GeometryTargetPredecessor;
}

export interface AdmittedGeometryTargetedPartExportedFile {
  readonly format: GeometryExportFormat;
  readonly name: string;
  readonly bytes: number;
  readonly digest: string;
}

/** A draft fact for one target PartDefinition, not an assembly projection. */
export interface AdmittedGeometryTargetedPartExportDraft {
  readonly draftDigest: string;
  readonly target: {
    readonly partDefinitionElementId: string;
    readonly label: string;
    readonly scriptHash: ContentFingerprint;
    readonly files: readonly AdmittedGeometryTargetedPartExportedFile[];
  };
  readonly predecessor?: GeometryTargetPredecessor;
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
  exportTargetedPart(
    request: AdmittedGeometryTargetedPartExportRequest,
  ): Promise<AdmittedGeometryTargetedPartExportDraft>;
}
