/**
 * Admission-backed geometry export through the private build123d sandbox.
 *
 * WHY THIS ADAPTER — after `compile.seal-admission@1` the application already
 * holds exact admitted bytes. This adapter must not accept a second Python
 * source, provider name, tool, path or image. It reuses `build123d_export` and
 * `captureGeometryDraft` so the product remains a geometry DRAFT, never Thread.
 */

import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
  AdmittedGeometryExportRequest,
} from "../../application/ports/out/admitted-geometry-exporter.ts";
import type { McpToolClient } from "../../application/ports/out/mcp-tool-client.ts";
import {
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryExportFormat,
  type GeometryManifest,
} from "../../domain/engineering/geometry-proposal.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import { captureGeometryDraft } from "./geometry-draft-capture.ts";
import type { FileCaptureStore } from "./file-capture-store.ts";
import type { GeometrySourceAnalysisCaptureDependencies } from "./geometry-source-analysis-capture.ts";

/** Server-fixed assembly formats. Callers cannot select them. */
export const ADMITTED_GEOMETRY_EXPORT_FORMATS: readonly GeometryExportFormat[] = [
  "gltf",
];

export interface AdmissionBackedGeometryExportDependencies {
  readonly client: McpToolClient;
  readonly draftCaptures: FileCaptureStore<"geometry-draft">;
  readonly sourceAnalysis: GeometrySourceAnalysisCaptureDependencies;
  readonly build123dService: "mcp-build123d-sandbox";
  readonly materializeAsset?: (
    sha256: string,
    containerPath: string,
    expectedBytes: number,
  ) => Promise<void>;
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
    if (this.dependencies.build123dService !== "mcp-build123d-sandbox") {
      throw new TypeError(
        "Admitted geometry assets must be materialized from mcp-build123d-sandbox.",
      );
    }
    const manifest = admittedManifest(request);
    const draft = await captureGeometryDraft(
      this.dependencies.client,
      { script: request.script, manifest },
      this.dependencies.draftCaptures,
      this.options(),
    );
    return Object.freeze({
      draftDigest: draft.fingerprint.digest,
      scriptHash: draft.scriptHash,
      exportFormats: [...draft.exportFormats],
      assemblyFiles: draft.assemblyFiles.map((file) =>
        Object.freeze({
          format: file.format,
          name: file.name,
          bytes: file.bytes,
          digest: file.fingerprint.digest,
        })
      ),
      partMeshes: draft.partMeshes.map((mesh) =>
        Object.freeze({
          usageName: mesh.usageName,
          name: mesh.name,
          bytes: mesh.bytes,
          digest: mesh.fingerprint.digest,
        })
      ),
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
      build123dService: this.dependencies.build123dService,
      sourceAnalysis: this.dependencies.sourceAnalysis,
      ...(this.dependencies.materializeAsset === undefined
        ? {}
        : { materializeAsset: this.dependencies.materializeAsset }),
      ...(this.dependencies.previewRunId === undefined
        ? {}
        : { previewRunId: this.dependencies.previewRunId }),
    } as const;
  }
}

function parseRequest(value: unknown): AdmittedGeometryExportRequest {
  const request = exactRecord(
    value,
    ["script", "architectureBasis"],
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
  };
}

function admittedManifest(
  request: AdmittedGeometryExportRequest,
): GeometryManifest {
  return {
    schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
    architectureBasis: request.architectureBasis,
    components: [],
    unitSystem: "mm",
    exportFormats: [...ADMITTED_GEOMETRY_EXPORT_FORMATS],
  };
}
