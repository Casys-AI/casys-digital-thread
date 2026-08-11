/** Capture-backed implementation of the bounded project geometry preview. */

import type { McpToolClient } from "./mcp/http-mcp-tool-client.ts";
import type { FileCaptureStore } from "./captures/file-capture-store.ts";
import {
  captureGeometryBundleDraft,
  captureGeometryDraft,
  geometryBundleManifestFromDraft,
} from "./captures/geometry-draft-capture.ts";
import type { GeometrySourceAnalysisCaptureDependencies } from "./captures/geometry-source-analysis-capture.ts";
import { encodeGeometryDecisionParameters } from "../domain/platform/geometry-proposal.ts";
import type {
  GeometryPreviewCommand,
  GeometryPreviewResult,
  GeometryPreviewSourceAnalysisSummary,
  ProjectGeometryPreviewUseCase,
} from "../orchestration/project-geometry-preview.ts";
import type { ContentFingerprint } from "../domain/thread/thread-snapshot.ts";

export interface CaptureBackedProjectGeometryPreviewDependencies {
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

export class CaptureBackedProjectGeometryPreviewUseCase
  implements ProjectGeometryPreviewUseCase {
  constructor(
    private readonly dependencies: CaptureBackedProjectGeometryPreviewDependencies,
  ) {}

  async execute(command: GeometryPreviewCommand): Promise<GeometryPreviewResult> {
    if (command.kind === "bundle") {
      const draft = await captureGeometryBundleDraft(
        this.dependencies.client,
        {
          assemblyScript: command.assemblyScript,
          manifest: command.manifest,
          partDefinitionScripts: command.partDefinitionScripts,
        },
        this.dependencies.draftCaptures,
        this.options(),
      );
      const completedManifest = geometryBundleManifestFromDraft(draft);
      return Object.freeze({
        kind: "bundle" as const,
        schemaVersion: completedManifest.schemaVersion,
        draftDigest: draft.fingerprint.digest,
        assemblyFiles: draft.assembly.files.map((file) => ({
          format: file.format,
          name: file.name,
          bytes: file.bytes,
          digest: file.fingerprint.digest,
        })),
        partDefinitions: draft.partDefinitions.map((definition) => ({
          elementId: definition.elementId,
          label: definition.label,
          scriptHash: definition.scriptHash.digest,
          files: definition.files.map((file) => ({
            format: file.format,
            name: file.name,
            bytes: file.bytes,
            digest: file.fingerprint.digest,
          })),
        })),
        sourceAnalyses: {
          assembly: sourceAnalysisSummary(draft.sourceAnalyses.assembly),
          partDefinitions: draft.sourceAnalyses.partDefinitions.map((entry) => ({
            elementId: entry.elementId,
            analysis: sourceAnalysisSummary(entry.analysis),
          })),
        },
        occurrences: draft.occurrences,
        decisionParameters: encodeGeometryDecisionParameters(
          draft.fingerprint.digest,
          completedManifest,
        ),
      });
    }

    const draft = await captureGeometryDraft(
      this.dependencies.client,
      { script: command.script, manifest: command.manifest },
      this.dependencies.draftCaptures,
      this.options(),
    );
    const completedManifest = {
      ...command.manifest,
      scriptHash: draft.scriptHash,
      artifactHashes: {
        assemblyFiles: draft.assemblyFiles.map((file) => ({
          format: file.format,
          name: file.name,
          fingerprint: file.fingerprint,
        })),
        partMeshes: draft.partMeshes.map((mesh) => ({
          semanticKey: mesh.usageName,
          name: mesh.name,
          fingerprint: mesh.fingerprint,
        })),
      },
    };
    return Object.freeze({
      kind: "legacy" as const,
      draftDigest: draft.fingerprint.digest,
      assemblyFiles: draft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        bytes: file.bytes,
        digest: file.fingerprint.digest,
      })),
      partMeshes: draft.partMeshes.map((mesh) => ({
        usageName: mesh.usageName,
        name: mesh.name,
        bytes: mesh.bytes,
        digest: mesh.fingerprint.digest,
      })),
      sourceAnalysis: sourceAnalysisSummary(draft.sourceAnalysis),
      decisionParameters: encodeGeometryDecisionParameters(
        draft.fingerprint.digest,
        completedManifest,
      ),
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

function sourceAnalysisSummary(
  reference: {
    readonly sourceId: string;
    readonly selector: unknown;
    readonly sourceFingerprint: ContentFingerprint;
    readonly sourceCaptureFingerprint: ContentFingerprint;
    readonly analysisFingerprint: ContentFingerprint;
  },
): GeometryPreviewSourceAnalysisSummary {
  return Object.freeze({
    sourceId: reference.sourceId,
    selector: reference.selector,
    sourceDigest: reference.sourceFingerprint.digest,
    sourceCaptureDigest: reference.sourceCaptureFingerprint.digest,
    analysisDigest: reference.analysisFingerprint.digest,
  });
}
