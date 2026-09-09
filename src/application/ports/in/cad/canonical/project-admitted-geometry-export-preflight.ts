/** Read-only route selection before canonical admitted geometry export. */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectAdmittedGeometryExportPreflightCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectAdmittedGeometryExportChildRoot {
  readonly sourceId: string;
  readonly attachment: {
    readonly attachmentId: string;
    readonly attachmentRevision: number;
    readonly fileId: string;
    readonly target: {
      readonly elementKind: "PartDefinition";
      readonly elementId: string;
    };
  };
  readonly sourceClosure: {
    readonly fingerprint: ContentFingerprint;
    readonly workspaceRevision: number;
    readonly workspaceEventFingerprint: ContentFingerprint;
    readonly root: {
      readonly fileId: string;
      readonly fileRevision: number;
      readonly fileFingerprint: ContentFingerprint;
    };
  };
}

export type ProjectAdmittedGeometryExportPreflightResult =
  | {
    readonly schemaVersion: "project-admitted-geometry-export-preflight/1.0";
    readonly status: "singular-export-ready";
    readonly nextTool: "project_admitted_geometry_export";
  }
  | {
    readonly schemaVersion: "project-admitted-geometry-export-preflight/1.0";
    readonly status: "child-root-admission-required";
    readonly childRoots: readonly ProjectAdmittedGeometryExportChildRoot[];
    readonly recovery: string;
  }
  | {
    readonly schemaVersion: "project-admitted-geometry-export-preflight/1.0";
    readonly status: "unresolved";
    readonly recovery: string;
  };

export interface ProjectAdmittedGeometryExportPreflightUseCase {
  execute(value: unknown): Promise<ProjectAdmittedGeometryExportPreflightResult>;
}
