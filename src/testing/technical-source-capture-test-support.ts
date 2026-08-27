/** Shared fixtures for technical-source V4 locators, authored evidence and units. */

import { createHash } from "node:crypto";

import { FileByteStore } from "../adapters/shared/cas/file-byte-store.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX,
  type TechnicalSourceAnalysisCaptureLocator,
  type TechnicalSourceAttachmentProvenance,
  type TechnicalSourceClosureProvenance,
  validateTechnicalSourceAnalysisCaptureLocator,
  validateTechnicalSourceAttachmentProvenance,
  validateTechnicalSourceClosureProvenance,
} from "../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
  type ProjectSourceClosureLocator,
  validateProjectSourceClosureLocator,
} from "../domain/project-source-workspace/closure.ts";
import { sampleAgentResourceReference } from "./agent-resource-test-support.ts";

export function sampleTechnicalSourceAttachmentProvenance(
  fileId: string,
  overrides: Partial<TechnicalSourceAttachmentProvenance> = {},
): TechnicalSourceAttachmentProvenance {
  return validateTechnicalSourceAttachmentProvenance({
    attachmentId: `att.${fileId}`,
    attachmentRevision: 1,
    fingerprint: { algorithm: "sha256", digest: "aa".repeat(32) },
    fileId,
    role: { id: "design-source", version: 1 },
    target: { elementId: `def.${fileId}`, elementKind: "PartDefinition" },
    declaredAgainst: {
      thread: {
        snapshotId: "thread.snapshot.1",
        revision: 1,
        subjectId: "subject.support",
      },
      architecture: {
        artifactId: "architecture-" + "a".repeat(64),
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        captureSchema: "architecture-capture/4.0",
      },
    },
    ...overrides,
  });
}

export function sampleProjectSourceClosureLocator(
  digest = "b".repeat(64),
  byteCount = 256,
): ProjectSourceClosureLocator {
  return validateProjectSourceClosureLocator({
    schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
    fingerprint: { algorithm: "sha256", digest },
    byteCount,
    casUri: `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${digest}`,
  });
}

export function sampleTechnicalSourceClosureProvenance(
  fileId: string,
  overrides: Partial<TechnicalSourceClosureProvenance> = {},
): TechnicalSourceClosureProvenance {
  const digest = overrides.root?.resourceRef.fingerprint.digest ?? "c".repeat(64);
  return validateTechnicalSourceClosureProvenance({
    locator: sampleProjectSourceClosureLocator(),
    fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    projectId: "project.support",
    workspaceRevision: 2,
    workspaceEventFingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
    },
    root: {
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
    },
    ...overrides,
    ...(overrides.root ? { root: overrides.root } : {}),
    ...(overrides.locator ? { locator: overrides.locator } : {}),
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
    closureDocuments: new FileByteStore({
      kind: "project-source-closure" as const,
      directory: `${directory}/closures`,
      uriNamespace: "project-source-closure",
      label: "project source closure",
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
    attachment: sampleTechnicalSourceAttachmentProvenance(fileId),
    sourceClosure: sampleTechnicalSourceClosureProvenance(fileId, {
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
  readonly attachment?: TechnicalSourceAttachmentProvenance;
  readonly sourceClosure?: TechnicalSourceClosureProvenance;
}) {
  const sourceClosure = input.sourceClosure ??
    sampleTechnicalSourceClosureProvenance(input.sourceId, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
  const scriptFingerprint = {
    algorithm: "sha256" as const,
    digest: createHash("sha256").update(input.sourceText, "utf8").digest("hex"),
  };
  const unitId = `technical-unit:${sourceClosure.fingerprint.digest}`;
  return {
    profileId: input.profileId,
    sourceId: unitId,
    sourceText: input.sourceText,
    effectiveUnit: {
      kind: "authored-root" as const,
      closureKind: "root-only" as const,
      unitId,
      closureFingerprint: sourceClosure.fingerprint,
      scriptFingerprint,
    },
    attachment: input.attachment ??
      sampleTechnicalSourceAttachmentProvenance(input.sourceId),
    sourceClosure,
  };
}
