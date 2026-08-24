/**
 * Shared fixtures for technical-source V2 locators and project-source anchors.
 */

import { FileByteStore } from "../adapters/shared/cas/file-byte-store.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX,
  type TechnicalProjectSourceAnchor,
  type TechnicalSourceAnalysisCaptureLocator,
  validateTechnicalProjectSourceAnchor,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import { sampleAgentResourceReference } from "./agent-resource-test-support.ts";

export function sampleTechnicalProjectSourceAnchor(
  fileId: string,
  overrides: Partial<TechnicalProjectSourceAnchor> = {},
): TechnicalProjectSourceAnchor {
  const digest = overrides.resourceRef?.fingerprint.digest ?? "c".repeat(64);
  return validateTechnicalProjectSourceAnchor({
    projectId: "project.support",
    workspaceRevision: 2,
    workspaceEventFingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
    },
    fileId,
    fileRevision: 1,
    fileFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    resourceRef: sampleAgentResourceReference({
      name: `${fileId}.py`,
      mimeType: "text/x-python",
      byteCount: 40,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://agent-resource-capture/sha256/${digest}`,
    }),
    ...overrides,
    ...(overrides.resourceRef ? { resourceRef: overrides.resourceRef } : {}),
  });
}

export function sampleTechnicalSourceAnalysisCaptureLocator(
  digest = "3".repeat(64),
  byteCount = 128,
): TechnicalSourceAnalysisCaptureLocator {
  return validateTechnicalSourceAnalysisCaptureLocator({
    schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint: { algorithm: "sha256", digest },
    byteCount,
    casUri: `${TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`,
  });
}

export function technicalSourceAnalysisCaptureStores(directory: string) {
  return {
    sourceCaptures: new FileByteStore({
      kind: "technical-source" as const,
      directory: `${directory}/sources`,
      uriNamespace: "technical-source",
      label: "technical source",
    }),
    analysisCaptures: new FileByteStore({
      kind: "technical-source-analysis" as const,
      directory: `${directory}/analyses`,
      uriNamespace: "technical-source-analysis",
      label: "technical analysis",
    }),
    captureDocuments: new FileByteStore({
      kind: "technical-source-analysis-capture" as const,
      directory: `${directory}/capture-documents`,
      uriNamespace: "technical-source-analysis-capture",
      label: "technical source capture document",
    }),
  };
}

export function sampleAdmissionSourceWorkspaceFields(
  fileId: string,
  options: {
    readonly projectId?: string;
    readonly locatorDigest?: string;
  } = {},
) {
  const digest = options.locatorDigest ?? "4".repeat(64);
  return {
    projectSource: sampleTechnicalProjectSourceAnchor(fileId, {
      ...(options.projectId ? { projectId: options.projectId } : {}),
    }),
    locator: sampleTechnicalSourceAnalysisCaptureLocator(digest),
  };
}

export function technicalSourceCaptureInput(input: {
  readonly profileId: string;
  readonly sourceId: string;
  readonly sourceText: string;
  readonly projectId?: string;
  readonly projectSource?: TechnicalProjectSourceAnchor;
}) {
  return {
    profileId: input.profileId,
    sourceId: input.sourceId,
    sourceText: input.sourceText,
    projectSource: input.projectSource ??
      sampleTechnicalProjectSourceAnchor(input.sourceId, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
      }),
  };
}
