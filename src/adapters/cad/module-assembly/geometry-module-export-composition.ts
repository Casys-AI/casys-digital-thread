/**
 * Provider-free composition for project_geometry_module_export.
 *
 * Kept separate from createCadProject so the sealer branch can integrate
 * later. The use case is wired only when an IsolatedCodeRunner is supplied.
 * Caller-selected programs, profiles and child assets stay refused.
 */

import { ExportProjectGeometryModule } from "../../../application/use-cases/cad/canonical/export-project-geometry-module.ts";
import type { ProjectGeometryModuleExportUseCase } from "../../../application/ports/in/cad/canonical/project-geometry-module-export.ts";
import type { IsolatedCodeRunner } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type { GeometryModuleAssemblyExecutionProfileCatalog } from "../../../application/ports/out/cad/module-assembly/geometry-module-assembly-profile.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ProductStructureTraversal } from "../../../application/ports/out/product-navigation/product-structure-traversal.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { CaptureBackedCadPlacementArchitectureIndex } from "../placement/capture-backed-cad-placement-architecture-index.ts";
import { FileCadPlacementAnalysisCaptureStore } from "../placement/file-cad-placement-analysis-capture-store.ts";
import { FileGeometryDraftAssetStore } from "../canonical/file-geometry-draft-asset-store.ts";
import { FileGeometryModuleDraftStore } from "../canonical/file-geometry-module-evidence-store.ts";

export interface GeometryModuleExportCompositionOptions {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly traversal: ProductStructureTraversal;
  readonly architectureCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly partDefinitionsCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly geometryCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly recordedAnalysisDirectory: string;
  readonly canonicalAssetDirectory: string;
  readonly geometryDraftCaptureDirectory: string;
  readonly geometryDraftAssetDirectory: string;
  readonly profiles: GeometryModuleAssemblyExecutionProfileCatalog;
  readonly runner?: IsolatedCodeRunner;
}

export interface GeometryModuleExportComposition {
  readonly geometryModuleExport: ProjectGeometryModuleExportUseCase | undefined;
}

export function createGeometryModuleExportComposition(
  options: GeometryModuleExportCompositionOptions,
): GeometryModuleExportComposition {
  if (options.runner === undefined) {
    return Object.freeze({ geometryModuleExport: undefined });
  }
  const geometryModuleExport = new ExportProjectGeometryModule({
    projects: options.projects,
    snapshots: options.snapshots,
    traversal: options.traversal,
    architectureIndex: new CaptureBackedCadPlacementArchitectureIndex(
      options.architectureCaptures,
    ),
    partDefinitions: options.partDefinitionsCaptures,
    placements: new FileCadPlacementAnalysisCaptureStore(
      new FileByteStore({
        kind: "cad-placement-analysis-capture",
        directory: `${options.recordedAnalysisDirectory}/cad/placement/analyses`,
        uriNamespace: "cad-placement-analysis-capture",
        label: "CAD placement analysis capture",
      }),
    ),
    geometryCaptures: options.geometryCaptures,
    stepAssets: new FileCanonicalAssetReader({
      directory: options.canonicalAssetDirectory,
    }),
    profiles: options.profiles,
    runner: options.runner,
    draftStore: new FileGeometryModuleDraftStore(
      new FileCaptureStore({
        ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
        directory: options.geometryDraftCaptureDirectory,
      }),
    ),
    draftAssets: new FileGeometryDraftAssetStore(
      new FileByteStore({
        kind: "geometry-draft-asset",
        directory: options.geometryDraftAssetDirectory,
        uriNamespace: "geometry-draft-asset",
        label: "Geometry draft asset",
      }),
    ),
  });
  return Object.freeze({ geometryModuleExport });
}
