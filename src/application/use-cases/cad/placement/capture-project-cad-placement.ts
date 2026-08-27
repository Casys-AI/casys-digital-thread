/**
 * Capture one exact same-file CAD placement attachment set.
 *
 * Authority is the fresh hash-chained workspace snapshot plus the exact
 * declaredAgainst Thread/architecture recross. Coverage is set equality of
 * immediate owner usages, attachment targets and JSON entries.
 */

import {
  type ProjectCadPlacementCaptureCommand,
  ProjectCadPlacementCaptureError,
  type ProjectCadPlacementCaptureUseCase,
} from "../../../ports/in/cad/placement/project-cad-placement-capture.ts";
import {
  type CadImmediatePlacementSourceStore,
  CadImmediatePlacementSourceStoreError,
} from "../../../ports/out/cad/placement/cad-immediate-placement-source-store.ts";
import {
  type CadPlacementAnalysisCaptureStore,
  CadPlacementAnalysisCaptureStoreError,
} from "../../../ports/out/cad/placement/cad-placement-analysis-capture-store.ts";
import type { CadPlacementArchitectureIndex } from "../../../ports/out/cad/placement/cad-placement-architecture-index.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  ProjectSourceWorkspaceStoreError,
} from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  assembleCadPlacementAnalysisDocument,
  assertCadPlacementAnalysisCaptureLocatorsEqual,
  validateCadPlacementAnalysisCaptureLocator,
} from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  assembleResolvedCadPlacementCaptureReview,
  assembleUnresolvedCadPlacementCaptureReview,
  type CadPlacementCaptureReview,
} from "../../../../domain/cad/placement/cad-placement-capture-review.ts";
import {
  CadPlacementAttachmentError,
  placementAttachmentsShareDeclaredAgainst,
  requireSameFileActivePlacementAttachments,
} from "../../../../domain/cad/placement/cad-placement-attachments.ts";
import { assessCadPlacementCoverage } from "../../../../domain/cad/placement/cad-placement-coverage.ts";
import {
  CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS,
} from "../../../../domain/cad/placement/cad-immediate-placement-source.ts";
import {
  exactRecord,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { ProjectSourceWorkspaceError } from "../../../../domain/project-source-workspace/types.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../../domain/resource/agent-resource-reference.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../../resource/reopen-agent-resource.ts";
export interface CaptureProjectCadPlacementDependencies {
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly sources: CadImmediatePlacementSourceStore;
  readonly analyses: CadPlacementAnalysisCaptureStore;
  readonly architecture: CadPlacementArchitectureIndex;
}

export class CaptureProjectCadPlacement implements ProjectCadPlacementCaptureUseCase {
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #sources: CadImmediatePlacementSourceStore;
  readonly #analyses: CadPlacementAnalysisCaptureStore;
  readonly #architecture: CadPlacementArchitectureIndex;

  constructor(dependencies: CaptureProjectCadPlacementDependencies) {
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#sources = dependencies.sources;
    this.#analyses = dependencies.analyses;
    this.#architecture = dependencies.architecture;
  }

  async capture(value: unknown): Promise<CadPlacementCaptureReview> {
    let command: ProjectCadPlacementCaptureCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw captureError(
        "invalid_request",
        "The CAD placement capture request failed exact validation.",
        cause,
      );
    }

    let state;
    try {
      state = await this.#workspace.loadAtFresh(
        command.projectId,
        command.workspaceRevision,
      );
    } catch (cause) {
      throw mapWorkspaceLoadError(cause, command);
    }
    if (
      state.projectId !== command.projectId ||
      state.workspaceRevision !== command.workspaceRevision
    ) {
      throw captureError(
        "workspace_integrity_failed",
        "The reopened workspace snapshot is foreign to the requested project revision.",
      );
    }

    let resolved;
    try {
      resolved = requireSameFileActivePlacementAttachments(state, {
        attachmentId: command.attachmentId,
        attachmentRevision: command.attachmentRevision,
      });
    } catch (cause) {
      throw mapAttachmentError(cause);
    }
    if (!placementAttachmentsShareDeclaredAgainst(resolved.attachments)) {
      return assembleUnresolvedCadPlacementCaptureReview([{
        name: "declared-against",
        relation: "attachment",
        recovery:
          "Every same-file placement attachment must declare one exact Thread and architecture basis.",
      }]);
    }

    let sourceText: string;
    try {
      sourceText = (await this.#resources.reopenUtf8Text(resolved.file.resourceRef, {
        acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
        maxBytes: CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS,
      })).text;
    } catch (cause) {
      if (
        cause instanceof AgentResourceReopenError &&
        cause.code === "source_size_limit_exceeded"
      ) {
        throw captureError("source_size_limit_exceeded", cause.message, cause);
      }
      throw captureError(
        "resource_reopen_failed",
        "The workspace AgentResourceReference could not be reopened as exact placement JSON.",
        cause,
      );
    }

    let storedSource;
    try {
      storedSource = await this.#sources.persist(sourceText);
    } catch (cause) {
      if (cause instanceof CadImmediatePlacementSourceStoreError) {
        if (cause.code === "source_size_limit_exceeded") {
          throw captureError("source_size_limit_exceeded", cause.message, cause);
        }
        if (cause.code === "source_parse_failed") {
          throw captureError("source_parse_failed", cause.message, cause);
        }
      }
      throw captureError(
        "source_persist_failed",
        "The CAD placement source could not be captured and reread.",
        cause,
      );
    }

    const declaredAgainst = resolved.attachments[0]!.declaredAgainst;
    let architecture;
    try {
      architecture = await this.#architecture.open(declaredAgainst);
    } catch (cause) {
      throw captureError(
        "architecture_reopen_failed",
        "The exact architecture capture named by the placement attachments could not be reopened.",
        cause,
      );
    }
    if (architecture === undefined) {
      return assembleUnresolvedCadPlacementCaptureReview([{
        name: declaredAgainst.architecture.artifactId,
        relation: "architecture",
        recovery:
          "Reopen the exact architecture-capture/4.0 named on the placement attachments.",
      }]);
    }

    const coverage = assessCadPlacementCoverage({
      source: storedSource.source,
      attachedUsageIds: resolved.attachments.map((item) => item.target.elementId),
      architecture,
    });
    if (coverage.status === "unresolved") {
      return assembleUnresolvedCadPlacementCaptureReview(coverage.gaps);
    }

    const workspaceEventFingerprint = state.lastEventFingerprint;
    if (workspaceEventFingerprint === undefined) {
      throw captureError(
        "workspace_integrity_failed",
        "The workspace snapshot has no exact head event fingerprint.",
      );
    }

    const document = assembleCadPlacementAnalysisDocument({
      source: storedSource.source,
      sourceBytes: {
        schemaVersion: "cad-immediate-placement-source/1.0",
        fingerprint: storedSource.fingerprint,
        byteCount: storedSource.byteCount,
        casUri: storedSource.casUri,
      },
      workspace: {
        projectId: state.projectId,
        workspaceRevision: state.workspaceRevision,
        workspaceEventFingerprint,
        fileId: resolved.file.fileId,
        fileRevision: resolved.file.fileRevision,
        fileFingerprint: resolved.file.fingerprint,
        resourceRef: resolved.file.resourceRef,
        fileRole: "cad-placement-source",
      },
      declaredAgainst,
      ownerElementId: coverage.owner.elementId,
      attachments: resolved.attachments.map((item) => ({
        attachmentId: item.attachmentId,
        attachmentRevision: item.attachmentRevision,
        fingerprint: item.fingerprint,
        usageElementId: item.target.elementId,
      })),
    });

    try {
      const persisted = await this.#analyses.persist(document);
      const locator = validateCadPlacementAnalysisCaptureLocator(persisted.locator);
      const reopened = await this.#analyses.reopenLocator(locator);
      assertCadPlacementAnalysisCaptureLocatorsEqual(
        locator,
        reopened.locator,
        "$persistedCadPlacement.locator",
      );
      return assembleResolvedCadPlacementCaptureReview({
        reference: locator,
        owner: coverage.owner,
        usageCount: coverage.usages.length,
      });
    } catch (cause) {
      if (cause instanceof ProjectCadPlacementCaptureError) throw cause;
      if (cause instanceof CadPlacementAnalysisCaptureStoreError) {
        throw captureError("locator_integrity_failed", cause.message, cause);
      }
      throw captureError(
        "locator_persist_failed",
        "The CAD placement analysis capture could not be persisted as an opaque locator.",
        cause,
      );
    }
  }
}

function parseCommand(value: unknown): ProjectCadPlacementCaptureCommand {
  const command = exactRecord(
    value,
    ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    "$cadPlacementCapture",
  );
  const projectId = safeId(command.projectId, "$cadPlacementCapture.projectId");
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("$cadPlacementCapture.projectId cannot use a latest alias.");
  }
  const attachmentId = safeId(
    command.attachmentId,
    "$cadPlacementCapture.attachmentId",
  );
  if (attachmentId.toLowerCase() === "latest") {
    throw new TypeError(
      "$cadPlacementCapture.attachmentId cannot use a latest alias.",
    );
  }
  return {
    projectId,
    workspaceRevision: positiveInteger(
      command.workspaceRevision,
      "$cadPlacementCapture.workspaceRevision",
    ),
    attachmentId,
    attachmentRevision: positiveInteger(
      command.attachmentRevision,
      "$cadPlacementCapture.attachmentRevision",
    ),
  };
}

function mapWorkspaceLoadError(
  cause: unknown,
  command: ProjectCadPlacementCaptureCommand,
): ProjectCadPlacementCaptureError {
  if (
    cause instanceof ProjectSourceWorkspaceError &&
    cause.code === "revision_not_found"
  ) {
    return captureError(
      "workspace_revision_not_found",
      `Workspace revision ${command.workspaceRevision} is not present for project ${command.projectId}.`,
      cause,
    );
  }
  if (
    cause instanceof ProjectSourceWorkspaceError ||
    cause instanceof ProjectSourceWorkspaceStoreError
  ) {
    return captureError(
      "workspace_integrity_failed",
      "The exact workspace snapshot failed fresh hash-chained replay.",
      cause,
    );
  }
  return captureError(
    "workspace_integrity_failed",
    "The exact workspace snapshot could not be reopened.",
    cause,
  );
}

function mapAttachmentError(cause: unknown): ProjectCadPlacementCaptureError {
  if (cause instanceof CadPlacementAttachmentError) {
    return captureError(cause.code, cause.message, cause);
  }
  return captureError(
    "attachment_not_found",
    "The exact same-file placement attachments could not be resolved.",
    cause,
  );
}

function captureError(
  code: ProjectCadPlacementCaptureError["code"],
  message: string,
  cause?: unknown,
): ProjectCadPlacementCaptureError {
  return new ProjectCadPlacementCaptureError(code, message, cause);
}
