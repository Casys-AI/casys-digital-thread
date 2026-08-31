/**
 * Admission-backed geometry export through the private build123d sandbox.
 *
 * WHY THIS ADAPTER — after `compile.seal-admission@3` the application already
 * holds exact admitted bytes. This adapter must not accept a second Python
 * source, provider name, tool, path or image. It reuses `build123d_export` and
 * `captureGeometryDraft` so the product remains a geometry DRAFT, never Thread.
 */

import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
  AdmittedGeometryExportRequest,
  AdmittedGeometryTargetedPartExportDraft,
  AdmittedGeometryTargetedPartExportRequest,
} from "../../../application/ports/out/cad/canonical/admitted-geometry-exporter.ts";
import type { GeometryDraftAssetStore } from "../../../application/ports/out/cad/canonical/geometry-draft-asset-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { ProviderResourceReader } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  parseGeometryDraftAdmission,
  parseGeometryPartDraftAdmission,
} from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import type { GeometryExportFormat } from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleManifest,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import { closedRecord, exactRecord } from "../../../domain/kernel/case-validation.ts";
import { captureGeometryBundleDraft } from "./geometry-draft-capture.ts";
import {
  captureGeometryPartDraft,
  GEOMETRY_PART_DRAFT_EXPORT_FORMATS,
} from "./geometry-part-draft-capture.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { GeometrySourceAnalysisCaptureDependencies } from "../source/geometry-source-analysis-capture.ts";

/** Server-fixed assembly and PartDefinition formats. Callers cannot select them. */
export const ADMITTED_GEOMETRY_EXPORT_FORMATS: readonly GeometryExportFormat[] = [
  "step",
  "gltf",
];
export const ADMITTED_GEOMETRY_PART_EXPORT_FORMATS: readonly GeometryExportFormat[] =
  ADMITTED_GEOMETRY_EXPORT_FORMATS;
/** Dedicated P2a target export profile; server-owned and STEP-authoritative. */
export const ADMITTED_TARGETED_PART_EXPORT_FORMATS: readonly GeometryExportFormat[] =
  GEOMETRY_PART_DRAFT_EXPORT_FORMATS;

export interface AdmissionBackedGeometryExportDependencies {
  readonly client: McpToolClient;
  readonly resourceReader: ProviderResourceReader;
  readonly draftCaptures: FileCaptureStore<"geometry-draft">;
  readonly draftAssets: GeometryDraftAssetStore;
  readonly sourceAnalysis: GeometrySourceAnalysisCaptureDependencies;
  readonly previewRunId?: string;
}

export class AdmissionBackedGeometryExportAdapter implements AdmittedGeometryExporter {
  constructor(
    private readonly dependencies: AdmissionBackedGeometryExportDependencies,
  ) {}

  async export(
    value: AdmittedGeometryExportRequest,
  ): Promise<AdmittedGeometryExportDraft> {
    const request = parseRequest(value);
    const manifest = admittedBundleManifest(request);
    const draft = await captureGeometryBundleDraft(
      this.dependencies.client,
      {
        assemblyScript: request.script,
        manifest,
        partDefinitionScripts: [{
          elementId: request.representedPart.elementId,
          script: request.script,
        }],
        admission: request.admission,
      },
      this.dependencies.draftCaptures,
      this.options(),
    );
    const assemblyAnalysis = draft.sourceAnalyses.assembly;
    return Object.freeze({
      draftDigest: draft.fingerprint.digest,
      scriptHash: draft.assembly.scriptHash,
      exportFormats: [...draft.assembly.exportFormats],
      partExportFormats: [...draft.partExportFormats],
      assemblyFiles: draft.assembly.files.map((file) =>
        Object.freeze({
          format: file.format,
          name: file.name,
          bytes: file.bytes,
          digest: file.fingerprint.digest,
        })
      ),
      partMeshes: Object.freeze([]),
      partDefinitions: draft.partDefinitions.map((definition) =>
        Object.freeze({
          elementId: definition.elementId,
          label: definition.label,
          scriptHash: definition.scriptHash,
          files: definition.files.map((file) =>
            Object.freeze({
              format: file.format,
              name: file.name,
              bytes: file.bytes,
              digest: file.fingerprint.digest,
            })
          ),
        })
      ),
      ...(draft.predecessor ? { predecessor: draft.predecessor } : {}),
      sourceAnalysis: Object.freeze({
        sourceId: assemblyAnalysis.sourceId,
        selector: assemblyAnalysis.selector,
        sourceDigest: assemblyAnalysis.sourceFingerprint.digest,
        sourceCaptureDigest: assemblyAnalysis.sourceCaptureFingerprint.digest,
        analysisDigest: assemblyAnalysis.analysisFingerprint.digest,
      }),
    });
  }

  async exportTargetedPart(
    value: AdmittedGeometryTargetedPartExportRequest,
  ): Promise<AdmittedGeometryTargetedPartExportDraft> {
    const request = parseTargetedPartRequest(value);
    const manifest = admittedPartManifest(request);
    const draft = await captureGeometryPartDraft(
      this.dependencies.client,
      {
        script: request.script,
        manifest,
        admission: request.admission,
      },
      this.dependencies.draftCaptures,
      this.options(),
    );
    return Object.freeze({
      draftDigest: draft.fingerprint.digest,
      target: Object.freeze({
        partDefinitionElementId: draft.target.partDefinitionElementId,
        label: draft.target.label,
        scriptHash: draft.target.scriptHash,
        files: draft.target.files.map((file) =>
          Object.freeze({
            format: file.format,
            name: file.name,
            bytes: file.bytes,
            digest: file.fingerprint.digest,
          })
        ),
      }),
      ...(draft.predecessor ? { predecessor: draft.predecessor } : {}),
      sourceAnalysis: Object.freeze({
        sourceId: draft.sourceAnalysis.sourceId,
        selector: draft.sourceAnalysis.selector,
        sourceDigest: draft.sourceAnalysis.sourceFingerprint.digest,
        sourceCaptureDigest: draft.sourceAnalysis.sourceCaptureFingerprint.digest,
        analysisDigest: draft.sourceAnalysis.analysisFingerprint.digest,
      }),
    });
  }

  private options() {
    return {
      sourceAnalysis: this.dependencies.sourceAnalysis,
      resourceReader: this.dependencies.resourceReader,
      draftAssets: this.dependencies.draftAssets,
      ...(this.dependencies.previewRunId === undefined
        ? {}
        : { previewRunId: this.dependencies.previewRunId }),
    } as const;
  }
}

function parseRequest(value: unknown): AdmittedGeometryExportRequest {
  const request = closedRecord(
    value,
    ["script", "architectureBasis", "admission", "representedPart", "predecessor"],
    ["script", "architectureBasis", "admission", "representedPart"],
    "$admittedGeometryExportRequest",
  );
  if (typeof request.script !== "string" || request.script.length === 0) {
    throw new TypeError(
      "$admittedGeometryExportRequest.script must be non-empty admitted source.",
    );
  }
  const architectureBasis = exactRecord(
    request.architectureBasis,
    ["snapshotId", "revision", "artifactFingerprint"],
    "$admittedGeometryExportRequest.architectureBasis",
  );
  const fingerprint = exactRecord(
    architectureBasis.artifactFingerprint,
    ["algorithm", "digest"],
    "$admittedGeometryExportRequest.architectureBasis.artifactFingerprint",
  );
  if (fingerprint.algorithm !== "sha256") {
    throw new TypeError(
      "$admittedGeometryExportRequest.architectureBasis.artifactFingerprint.algorithm must be sha256.",
    );
  }
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.architectureBasis.artifactFingerprint.digest must be SHA-256 hex.",
    );
  }
  if (
    typeof architectureBasis.snapshotId !== "string" ||
    architectureBasis.snapshotId.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.architectureBasis.snapshotId must be a non-empty id.",
    );
  }
  const revision = architectureBasis.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
    throw new TypeError(
      "$admittedGeometryExportRequest.architectureBasis.revision must be a positive integer.",
    );
  }
  const representedPart = exactRecord(
    request.representedPart,
    ["elementId", "label"],
    "$admittedGeometryExportRequest.representedPart",
  );
  if (
    typeof representedPart.elementId !== "string" ||
    representedPart.elementId.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.representedPart.elementId must be a non-empty id.",
    );
  }
  if (
    typeof representedPart.label !== "string" ||
    representedPart.label.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.representedPart.label must be a non-empty label.",
    );
  }
  const predecessor = request.predecessor === undefined
    ? undefined
    : parseLegacyPredecessor(request.predecessor);
  return {
    script: request.script,
    architectureBasis: {
      snapshotId: architectureBasis.snapshotId,
      revision: Number(revision),
      artifactFingerprint: {
        algorithm: "sha256",
        digest: fingerprint.digest,
      },
    },
    admission: parseGeometryDraftAdmission(
      request.admission,
      "$admittedGeometryExportRequest.admission",
    ),
    representedPart: {
      elementId: representedPart.elementId,
      label: representedPart.label,
    },
    ...(predecessor ? { predecessor } : {}),
  };
}

function parseArchitectureBasis(value: unknown, path: string) {
  const architectureBasis = exactRecord(
    value,
    ["snapshotId", "revision", "artifactFingerprint"],
    path,
  );
  const fingerprint = exactRecord(
    architectureBasis.artifactFingerprint,
    ["algorithm", "digest"],
    `${path}.artifactFingerprint`,
  );
  if (fingerprint.algorithm !== "sha256") {
    throw new TypeError(`${path}.artifactFingerprint.algorithm must be sha256.`);
  }
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.artifactFingerprint.digest must be SHA-256 hex.`);
  }
  if (
    typeof architectureBasis.snapshotId !== "string" ||
    architectureBasis.snapshotId.trim() === ""
  ) {
    throw new TypeError(`${path}.snapshotId must be a non-empty id.`);
  }
  if (
    typeof architectureBasis.revision !== "number" ||
    !Number.isSafeInteger(architectureBasis.revision) ||
    architectureBasis.revision < 1
  ) {
    throw new TypeError(`${path}.revision must be a positive integer.`);
  }
  return {
    snapshotId: architectureBasis.snapshotId,
    revision: architectureBasis.revision,
    artifactFingerprint: {
      algorithm: "sha256" as const,
      digest: fingerprint.digest,
    },
  };
}

function parseLegacyPredecessor(value: unknown): NonNullable<
  AdmittedGeometryExportRequest["predecessor"]
> {
  const predecessor = exactRecord(
    value,
    ["artifactId", "fingerprint"],
    "$admittedGeometryExportRequest.predecessor",
  );
  if (
    typeof predecessor.artifactId !== "string" ||
    predecessor.artifactId.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.predecessor.artifactId must be a non-empty id.",
    );
  }
  const fingerprint = exactRecord(
    predecessor.fingerprint,
    ["algorithm", "digest"],
    "$admittedGeometryExportRequest.predecessor.fingerprint",
  );
  if (fingerprint.algorithm !== "sha256") {
    throw new TypeError(
      "$admittedGeometryExportRequest.predecessor.fingerprint.algorithm must be sha256.",
    );
  }
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "$admittedGeometryExportRequest.predecessor.fingerprint.digest must be SHA-256 hex.",
    );
  }
  return {
    artifactId: predecessor.artifactId,
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
  };
}

function parseTargetPredecessor(
  value: unknown,
  targetId: string,
): NonNullable<AdmittedGeometryTargetedPartExportRequest["predecessor"]> {
  const predecessor = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "partDefinitionElementId"],
    "$admittedGeometryTargetedPartExportRequest.predecessor",
  );
  if (
    predecessor.schemaVersion !== "geometry-part-capture/1.0" &&
    predecessor.schemaVersion !== "geometry-module-capture/1.0"
  ) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.predecessor.schemaVersion must name a canonical target geometry capture family.",
    );
  }
  if (
    typeof predecessor.artifactId !== "string" ||
    predecessor.artifactId.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.predecessor.artifactId must be non-empty.",
    );
  }
  if (predecessor.partDefinitionElementId !== targetId) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.predecessor must name the exact target PartDefinition.",
    );
  }
  const fingerprint = exactRecord(
    predecessor.fingerprint,
    ["algorithm", "digest"],
    "$admittedGeometryTargetedPartExportRequest.predecessor.fingerprint",
  );
  if (
    fingerprint.algorithm !== "sha256" ||
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.predecessor.fingerprint must be SHA-256.",
    );
  }
  return {
    schemaVersion: predecessor.schemaVersion,
    artifactId: predecessor.artifactId,
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
    partDefinitionElementId: targetId,
  };
}

function parseTargetedPartRequest(
  value: unknown,
): AdmittedGeometryTargetedPartExportRequest {
  const request = closedRecord(
    value,
    ["script", "architectureBasis", "admission", "target", "predecessor"],
    ["script", "architectureBasis", "admission", "target"],
    "$admittedGeometryTargetedPartExportRequest",
  );
  if (typeof request.script !== "string" || request.script.length === 0) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.script must be non-empty admitted source.",
    );
  }
  const architectureBasis = parseArchitectureBasis(
    request.architectureBasis,
    "$admittedGeometryTargetedPartExportRequest.architectureBasis",
  );
  const target = exactRecord(
    request.target,
    ["partDefinitionElementId", "label"],
    "$admittedGeometryTargetedPartExportRequest.target",
  );
  if (
    typeof target.partDefinitionElementId !== "string" ||
    target.partDefinitionElementId.trim() === ""
  ) {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.target.partDefinitionElementId must be a non-empty id.",
    );
  }
  if (typeof target.label !== "string" || target.label.trim() === "") {
    throw new TypeError(
      "$admittedGeometryTargetedPartExportRequest.target.label must be a non-empty label.",
    );
  }
  const predecessor = request.predecessor === undefined
    ? undefined
    : parseTargetPredecessor(
      request.predecessor,
      target.partDefinitionElementId as string,
    );
  return {
    script: request.script,
    architectureBasis,
    admission: parseGeometryPartDraftAdmission(
      request.admission,
      "$admittedGeometryTargetedPartExportRequest.admission",
    ),
    target: {
      partDefinitionElementId: target.partDefinitionElementId,
      label: target.label,
    },
    ...(predecessor ? { predecessor } : {}),
  };
}

function admittedBundleManifest(
  request: AdmittedGeometryExportRequest,
): GeometryBundleManifest {
  return {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis: request.architectureBasis,
    ...(request.predecessor ? { predecessor: request.predecessor } : {}),
    components: [],
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: [...ADMITTED_GEOMETRY_EXPORT_FORMATS],
    partExportFormats: [...ADMITTED_GEOMETRY_PART_EXPORT_FORMATS],
    partDefinitions: [{
      elementId: request.representedPart.elementId,
      label: request.representedPart.label,
    }],
    occurrences: [],
  };
}

function admittedPartManifest(
  request: AdmittedGeometryTargetedPartExportRequest,
) {
  return {
    schemaVersion: "geometry-part-manifest/1.0" as const,
    architectureBasis: request.architectureBasis,
    ...(request.predecessor ? { predecessor: request.predecessor } : {}),
    target: {
      partDefinitionElementId: request.target.partDefinitionElementId,
      label: request.target.label,
    },
    unitSystem: "mm" as const,
    exportFormats: [...ADMITTED_TARGETED_PART_EXPORT_FORMATS],
  };
}
