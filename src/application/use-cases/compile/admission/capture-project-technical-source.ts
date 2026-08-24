/**
 * Capture one exact workspace file revision as a technical source.
 *
 * Authority is the fresh hash-chained workspace snapshot. The caller cannot
 * name profile, source text, MIME, path, or a resource tuple.
 */

import type {
  ProjectTechnicalSourceCaptureCommand,
  ProjectTechnicalSourceCaptureUseCase,
} from "../../../ports/in/compile/admission/project-technical-source-capture.ts";
import {
  ProjectTechnicalSourceCaptureError,
} from "../../../ports/in/compile/admission/project-technical-source-capture.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  ProjectSourceWorkspaceStoreError,
} from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { TechnicalSourceAnalysisCapture } from "../../../ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  TechnicalSourceAnalysisCaptureError,
  TechnicalSourceCaptureProfileNotRegisteredError,
} from "../../../ports/out/compile/admission/technical-source-analysis-capture.ts";
import { assembleTechnicalSourceCaptureReview } from "../../../../domain/compile/admission/technical-source-capture-review.ts";
import type { TechnicalSourceCaptureReview } from "../../../../domain/compile/admission/technical-source-capture-review.ts";
import {
  assertTechnicalProjectSourceAnchorsEqual,
  assertTechnicalSourceAnalysisCaptureLocatorsEqual,
  projectSourceAnchorFromActiveFile,
  requireActiveTechnicalSourceFile,
  TechnicalSourceWorkspaceRecrossError,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  exactRecord,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  ProjectSourceWorkspaceError,
} from "../../../../domain/project-source-workspace/types.ts";
import { acceptedMimeTypesForTechnicalLanguage } from "../../../../domain/resource/agent-resource-reference.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../../resource/reopen-agent-resource.ts";

export interface CaptureProjectTechnicalSourceDependencies {
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly captures: TechnicalSourceAnalysisCapture;
}

export class CaptureProjectTechnicalSource
  implements ProjectTechnicalSourceCaptureUseCase {
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #captures: TechnicalSourceAnalysisCapture;

  constructor(dependencies: CaptureProjectTechnicalSourceDependencies) {
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#captures = dependencies.captures;
  }

  async capture(value: unknown): Promise<TechnicalSourceCaptureReview> {
    let command: ProjectTechnicalSourceCaptureCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw captureError(
        "invalid_request",
        "The technical-source capture request failed exact validation.",
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

    let record;
    try {
      record = requireActiveTechnicalSourceFile(
        state,
        command.fileId,
        command.fileRevision,
      );
    } catch (cause) {
      if (cause instanceof TechnicalSourceWorkspaceRecrossError) {
        throw captureError(
          cause.code === "file_revision_not_active"
            ? "file_revision_not_active"
            : "file_not_found",
          cause.message,
          cause,
        );
      }
      throw cause;
    }
    if (record.captureRequest === undefined) {
      throw captureError(
        "capture_request_missing",
        `File ${command.fileId} has no captureRequest.profileId at workspace revision ${command.workspaceRevision}.`,
      );
    }

    let profile;
    try {
      profile = this.#captures.requireCaptureProfile(
        record.captureRequest.profileId,
      );
    } catch (cause) {
      if (cause instanceof TechnicalSourceCaptureProfileNotRegisteredError) {
        throw captureError(
          "profile_not_registered",
          `No technical source-analysis profile is registered for ${record.captureRequest.profileId}.`,
          cause,
        );
      }
      throw captureError(
        "profile_not_registered",
        "The captureRequest.profileId is not a registered technical-source profile.",
        cause,
      );
    }
    if (record.role !== profile.role) {
      throw captureError(
        "role_mismatch",
        `Workspace file role ${record.role} does not equal registered profile role ${profile.role}.`,
      );
    }

    let sourceText: string;
    try {
      sourceText = (await this.#resources.reopenUtf8Text(record.resourceRef, {
        acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage(profile.language),
        maxBytes: profile.maxSourceBytes,
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
        "The workspace AgentResourceReference could not be reopened as exact technical source bytes.",
        cause,
      );
    }

    const projectSource = projectSourceAnchorFromActiveFile(state, record);
    let persisted;
    try {
      persisted = await this.#captures.persist({
        profileId: profile.id,
        sourceId: record.fileId,
        sourceText,
        projectSource,
      });
    } catch (cause) {
      throw mapPersistError(cause);
    }

    try {
      const locator = validateTechnicalSourceAnalysisCaptureLocator(
        persisted.locator,
      );
      const reopened = await this.#captures.reopenLocator(locator);
      assertTechnicalSourceAnalysisCaptureLocatorsEqual(
        locator,
        reopened.locator,
        "$persistedTechnicalSource.locator",
      );
      assertTechnicalProjectSourceAnchorsEqual(
        projectSource,
        reopened.document.projectSource,
        "$persistedTechnicalSource.projectSource",
      );
      if (reopened.document.source.id !== record.fileId) {
        throw new TypeError("Capture document source.id must equal fileId.");
      }
      return assembleTechnicalSourceCaptureReview(
        locator,
        reopened.sourceText,
        reopened.analysis,
      );
    } catch (cause) {
      if (cause instanceof ProjectTechnicalSourceCaptureError) throw cause;
      throw captureError(
        "locator_integrity_failed",
        "The persisted technical-source locator failed exact reopen before return.",
        cause,
      );
    }
  }
}

function parseCommand(value: unknown): ProjectTechnicalSourceCaptureCommand {
  const command = exactRecord(
    value,
    ["projectId", "workspaceRevision", "fileId", "fileRevision"],
    "$technicalSourceCapture",
  );
  const projectId = safeId(command.projectId, "$technicalSourceCapture.projectId");
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("$technicalSourceCapture.projectId cannot use a latest alias.");
  }
  const fileId = safeId(command.fileId, "$technicalSourceCapture.fileId");
  if (fileId.toLowerCase() === "latest") {
    throw new TypeError("$technicalSourceCapture.fileId cannot use a latest alias.");
  }
  return {
    projectId,
    workspaceRevision: positiveInteger(
      command.workspaceRevision,
      "$technicalSourceCapture.workspaceRevision",
    ),
    fileId,
    fileRevision: positiveInteger(
      command.fileRevision,
      "$technicalSourceCapture.fileRevision",
    ),
  };
}

function mapWorkspaceLoadError(
  cause: unknown,
  command: ProjectTechnicalSourceCaptureCommand,
): ProjectTechnicalSourceCaptureError {
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

function mapPersistError(cause: unknown): ProjectTechnicalSourceCaptureError {
  if (cause instanceof ProjectTechnicalSourceCaptureError) return cause;
  if (cause instanceof TechnicalSourceCaptureProfileNotRegisteredError) {
    return captureError("profile_not_registered", cause.message, cause);
  }
  if (cause instanceof TechnicalSourceAnalysisCaptureError) {
    if (cause.code === "source_size_limit_exceeded") {
      return captureError("source_size_limit_exceeded", cause.message, cause);
    }
    if (cause.code === "analysis_rejected") {
      return captureError("analysis_rejected", cause.message, cause);
    }
  }
  return captureError(
    "locator_persist_failed",
    "The technical-source capture document could not be persisted as an opaque locator.",
    cause,
  );
}

function captureError(
  code: ProjectTechnicalSourceCaptureError["code"],
  message: string,
  cause?: unknown,
): ProjectTechnicalSourceCaptureError {
  return new ProjectTechnicalSourceCaptureError(code, message, cause);
}
