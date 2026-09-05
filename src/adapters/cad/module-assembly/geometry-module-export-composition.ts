/**
 * Provider-free composition for project_geometry_module_export.
 *
 * Kept separate from createCadProject so the sealer branch can integrate
 * later. The use case is wired only when a registered neutral assembler is
 * supplied. Caller-selected providers, programs and child assets stay refused.
 */

import {
  ExportProjectGeometryModule,
  type StructureCaptureArchitecture,
  type StructureCaptureOpen,
  type StructureCaptureReader,
} from "../../../application/use-cases/cad/canonical/export-project-geometry-module.ts";
import type { ProjectGeometryModuleExportUseCase } from "../../../application/ports/in/cad/canonical/project-geometry-module-export.ts";
import type { GeometryModuleAssembler } from "../../../application/ports/out/cad/module-assembly/geometry-module-assembler.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { ProductStructureTraversal } from "../../../application/ports/out/product-navigation/product-structure-traversal.ts";
import type { GeometryModuleStructureCapture } from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import { GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX } from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { parseExactPartDefinitionsCapture } from "../../architecture/part-definitions/part-definitions-capture.ts";
import type { SysmlSourceAnalysisReader } from "../../architecture/renderer/sysml-source-analysis-capture.ts";
import { FileCanonicalAssetReader } from "../../assets/canonical-asset-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  FileCaptureStore,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { DeclaredAgainstCadPlacementArchitectureIndex } from "../placement/declared-against-cad-placement-architecture-index.ts";
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
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
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
  readonly assembler?: GeometryModuleAssembler;
}

export interface GeometryModuleExportComposition {
  readonly geometryModuleExport: ProjectGeometryModuleExportUseCase | undefined;
}

export function createGeometryModuleExportComposition(
  options: GeometryModuleExportCompositionOptions,
): GeometryModuleExportComposition {
  if (options.assembler === undefined) {
    return Object.freeze({ geometryModuleExport: undefined });
  }
  const geometryModuleExport = new ExportProjectGeometryModule({
    projects: options.projects,
    snapshots: options.snapshots,
    traversal: options.traversal,
    architectureIndex: new DeclaredAgainstCadPlacementArchitectureIndex(
      options.snapshots,
      options.architectureCaptures,
      options.sysmlSourceAnalysis,
    ),
    partDefinitions: new CaptureBackedPartDefinitionsStructureReader(
      options.partDefinitionsCaptures,
    ),
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
    assembler: options.assembler,
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

export class CaptureBackedPartDefinitionsStructureReader
  implements StructureCaptureReader {
  readonly #captures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };

  constructor(
    captures: {
      read(fingerprint: ContentFingerprint): Promise<string | undefined>;
    },
  ) {
    this.#captures = captures;
  }

  async reopen(
    identity: StructureCaptureOpen,
    architecture: StructureCaptureArchitecture,
  ): Promise<GeometryModuleStructureCapture | undefined> {
    const digest = identity.fingerprint.digest;
    const expectedUri = `${GEOMETRY_MODULE_STRUCTURE_CAPTURE_URI_PREFIX}${digest}`;
    const expectedArchitectureUri =
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${architecture.fingerprint.digest}`;
    if (
      identity.fingerprint.algorithm !== "sha256" ||
      identity.artifactId !== `part-definitions-${digest}` ||
      identity.uri !== expectedUri
    ) {
      throw new TypeError(
        "The part-definitions structure identity is not casys://part-definitions-capture/sha256/<digest>.",
      );
    }
    const text = await this.#captures.read(identity.fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (deterministicJson(parsed) !== text) {
        throw new TypeError("non-canonical");
      }
    } catch {
      throw new TypeError(
        "The part-definitions structure capture is not canonical JSON.",
      );
    }
    const observed = await sha256Fingerprint(parsed);
    if (!fingerprintsEqual(observed, identity.fingerprint)) {
      throw new TypeError(
        "The part-definitions structure capture failed exact rehash.",
      );
    }
    const capture = parseExactPartDefinitionsCapture(parsed);
    if (
      capture.architecture.artifactId !== architecture.artifactId ||
      capture.architecture.artifactId !==
        `architecture-${architecture.fingerprint.digest}` ||
      !fingerprintsEqual(
        capture.architecture.fingerprint,
        architecture.fingerprint,
      ) ||
      capture.architecture.uri !== expectedArchitectureUri
    ) {
      throw new TypeError(
        "The part-definitions structure capture does not name the exact architecture reference.",
      );
    }
    return {
      schemaVersion: capture.schemaVersion,
      artifactId: identity.artifactId,
      fingerprint: identity.fingerprint,
      uri: identity.uri,
      byteCount: new TextEncoder().encode(text).byteLength,
      architecture: {
        artifactId: capture.architecture.artifactId,
        fingerprint: capture.architecture.fingerprint,
        uri: capture.architecture.uri,
      },
    };
  }
}
