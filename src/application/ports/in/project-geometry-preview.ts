/**
 * Inward-facing application port for the agent's bounded geometry preview.
 *
 * The MCP tool validates transport input and builds the domain manifest, then
 * calls this use case. Provider selection, source/CAS capture and build123d
 * dispatch stay behind the port and cannot leak into the agent-facing layer.
 */

import type {
  GeometryBundleExportFormat,
  GeometryBundleManifest,
  GeometryBundleOccurrence,
} from "../../../domain/engineering/geometry-bundle.ts";
import type {
  GeometryExportFormat,
  GeometryManifest,
} from "../../../domain/engineering/geometry-proposal.ts";

export interface GeometryPreviewDecisionParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
}

export interface GeometryPreviewSourceAnalysisSummary {
  readonly sourceId: string;
  readonly selector: unknown;
  readonly sourceDigest: string;
  readonly sourceCaptureDigest: string;
  readonly analysisDigest: string;
}

export interface GeometryPreviewFile<
  Format extends GeometryExportFormat | GeometryBundleExportFormat,
> {
  readonly format: Format;
  readonly name: string;
  readonly bytes: number;
  readonly digest: string;
}

export interface GeometryPreviewLegacyCommand {
  readonly kind: "legacy";
  readonly script: string;
  readonly manifest: GeometryManifest;
}

export interface GeometryPreviewBundleCommand {
  readonly kind: "bundle";
  readonly assemblyScript: string;
  readonly manifest: GeometryBundleManifest;
  readonly partDefinitionScripts: readonly {
    readonly elementId: string;
    readonly script: string;
  }[];
}

export type GeometryPreviewCommand =
  | GeometryPreviewLegacyCommand
  | GeometryPreviewBundleCommand;

export interface GeometryPreviewLegacyResult {
  readonly kind: "legacy";
  readonly draftDigest: string;
  readonly assemblyFiles: readonly GeometryPreviewFile<GeometryExportFormat>[];
  readonly partMeshes: readonly {
    readonly usageName: string;
    readonly name: string;
    readonly bytes: number;
    readonly digest: string;
  }[];
  readonly sourceAnalysis: GeometryPreviewSourceAnalysisSummary;
  readonly decisionParameters: readonly GeometryPreviewDecisionParameter[];
}

export interface GeometryPreviewBundleResult {
  readonly kind: "bundle";
  readonly schemaVersion: GeometryBundleManifest["schemaVersion"];
  readonly draftDigest: string;
  readonly assemblyFiles: readonly GeometryPreviewFile<GeometryBundleExportFormat>[];
  readonly partDefinitions: readonly {
    readonly elementId: string;
    readonly label: string;
    readonly scriptHash: string;
    readonly files: readonly GeometryPreviewFile<GeometryBundleExportFormat>[];
  }[];
  readonly sourceAnalyses: {
    readonly assembly: GeometryPreviewSourceAnalysisSummary;
    readonly partDefinitions: readonly {
      readonly elementId: string;
      readonly analysis: GeometryPreviewSourceAnalysisSummary;
    }[];
  };
  readonly occurrences: readonly GeometryBundleOccurrence[];
  readonly decisionParameters: readonly GeometryPreviewDecisionParameter[];
}

export type GeometryPreviewResult =
  | GeometryPreviewLegacyResult
  | GeometryPreviewBundleResult;

export interface ProjectGeometryPreviewUseCase {
  execute(command: GeometryPreviewCommand): Promise<GeometryPreviewResult>;
}
