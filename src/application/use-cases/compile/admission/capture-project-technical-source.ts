/**
 * Capture one exact workspace attachment head as a technical source.
 *
 * Authority is the fresh hash-chained workspace snapshot. The caller cannot
 * name profile, source text, MIME, path, file identity or a resource tuple.
 * Root analysis still analyses only the root bytes.
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
import type { ProjectSourceAttachmentRoleCatalog } from "../../../ports/out/project-source-workspace/project-source-attachment-role-catalog.ts";
import type { ProjectSourceClosureStore } from "../../../ports/out/project-source-workspace/project-source-closure-store.ts";
import {
  ProjectSourceClosureStoreError,
} from "../../../ports/out/project-source-workspace/project-source-closure-store.ts";
import type { TechnicalSourceAnalysisCapture } from "../../../ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  TechnicalSourceAnalysisCaptureError,
  TechnicalSourceCaptureProfileNotRegisteredError,
} from "../../../ports/out/compile/admission/technical-source-analysis-capture.ts";
import { assembleTechnicalSourceCaptureReview } from "../../../../domain/compile/admission/technical-source-capture-review.ts";
import type { TechnicalSourceCaptureReview } from "../../../../domain/compile/admission/technical-source-capture-review.ts";
import {
  assertTechnicalSourceAnalysisCaptureLocatorsEqual,
  assertTechnicalSourceAttachmentProvenanceEqual,
  assertTechnicalSourceClosureProvenanceEqual,
  attachmentProvenanceFrom,
  sourceClosureProvenanceFrom,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  ProjectSourceClosureError,
  recrossProjectSourceClosure,
  resolveProjectSourceClosure,
} from "../../../../domain/project-source-workspace/closure.ts";
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
import {
  lowerBuild123dWorkspaceClosure,
} from "../../../../domain/cad/source/build123d-workspace-closure-lowering.ts";

export interface CaptureProjectTechnicalSourceDependencies {
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly captures: TechnicalSourceAnalysisCapture;
  readonly closures: ProjectSourceClosureStore;
  readonly roles: ProjectSourceAttachmentRoleCatalog;
}

export class CaptureProjectTechnicalSource
  implements ProjectTechnicalSourceCaptureUseCase {
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #captures: TechnicalSourceAnalysisCapture;
  readonly #closures: ProjectSourceClosureStore;
  readonly #roles: ProjectSourceAttachmentRoleCatalog;

  constructor(dependencies: CaptureProjectTechnicalSourceDependencies) {
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#captures = dependencies.captures;
    this.#closures = dependencies.closures;
    this.#roles = dependencies.roles;
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

    let closure;
    try {
      closure = await resolveProjectSourceClosure(state, {
        attachmentId: command.attachmentId,
        attachmentRevision: command.attachmentRevision,
      });
    } catch (cause) {
      throw mapClosureError(cause);
    }
    if (
      !this.#roles.accept(closure.attachment.role, closure.attachment.target)
    ) {
      throw captureError(
        "role_catalog_rejected",
        "The attachment role is not accepted by the server-owned product-relation catalogue.",
      );
    }

    for (const file of closure.files) {
      try {
        await this.#resources.reopenExact(file.resourceRef);
      } catch (cause) {
        throw captureError(
          "resource_reopen_failed",
          `Workspace AgentResourceReference for ${file.fileId}@${file.fileRevision} could not be reopened.`,
          cause,
        );
      }
    }

    const root = closure.files.find((file) =>
      file.fileId === closure.root.fileId &&
      file.fileRevision === closure.root.fileRevision
    );
    if (!root) {
      throw captureError(
        "closure_integrity_failed",
        "The resolved source closure does not contain its exact root file.",
      );
    }
    if (root.captureRequest === undefined) {
      throw captureError(
        "capture_request_missing",
        `File ${root.fileId} has no captureRequest.profileId at workspace revision ${command.workspaceRevision}.`,
      );
    }

    let profile;
    try {
      profile = this.#captures.requireCaptureProfile(root.captureRequest.profileId);
    } catch (cause) {
      if (cause instanceof TechnicalSourceCaptureProfileNotRegisteredError) {
        throw captureError(
          "profile_not_registered",
          `No technical source-analysis profile is registered for ${root.captureRequest.profileId}.`,
          cause,
        );
      }
      throw captureError(
        "profile_not_registered",
        "The captureRequest.profileId is not a registered technical-source profile.",
        cause,
      );
    }
    let sourceText: string;
    let sourceId: string;
    let effectiveUnit;
    if (
      closure.files.length > 1 &&
      profile.workspaceClosureLowering !== undefined &&
      closure.files.length > profile.workspaceClosureLowering.maxClosureFiles
    ) {
      throw captureError(
        "source_size_limit_exceeded",
        "The exact workspace closure exceeds its server-owned Build123d lowering file limit.",
      );
    }
    try {
      sourceText = (await this.#resources.reopenUtf8Text(root.resourceRef, {
        acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage(profile.language),
        maxBytes: closure.files.length > 1 &&
            profile.workspaceClosureLowering !== undefined
          ? profile.workspaceClosureLowering.maxClosureSourceBytes
          : profile.maxSourceBytes,
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

    if (closure.files.length === 1) {
      sourceId = `technical-unit:${closure.fingerprint.digest}`;
      effectiveUnit = {
        kind: "authored-root" as const,
        closureKind: "root-only" as const,
        unitId: sourceId,
        closureFingerprint: closure.fingerprint,
        scriptFingerprint: root.resourceRef.fingerprint,
      };
    } else if (profile.workspaceClosureLowering !== undefined) {
      const exactTexts = new Map<string, string>();
      let closureSourceBytes = 0;
      for (const file of closure.files) {
        let text: string;
        try {
          text = (await this.#resources.reopenUtf8Text(file.resourceRef, {
            acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage(profile.language),
            maxBytes: profile.workspaceClosureLowering.maxClosureSourceBytes,
          })).text;
        } catch (cause) {
          throw captureError(
            "resource_reopen_failed",
            `Workspace AgentResourceReference for ${file.fileId}@${file.fileRevision} could not be reopened as exact Build123d source text.`,
            cause,
          );
        }
        exactTexts.set(`${file.fileId}@${file.fileRevision}`, text);
        closureSourceBytes += new TextEncoder().encode(text).byteLength;
      }
      if (closureSourceBytes > profile.workspaceClosureLowering.maxClosureSourceBytes) {
        throw captureError(
          "source_size_limit_exceeded",
          "The exact workspace closure exceeds its server-owned Build123d lowering byte limit.",
        );
      }
      let lowered;
      try {
        lowered = await lowerBuild123dWorkspaceClosure({
          closure,
          root: {
            fileId: root.fileId,
            fileRevision: root.fileRevision,
            sourceText: exactTexts.get(`${root.fileId}@${root.fileRevision}`)!,
          },
          dependencies: closure.files.filter((file) =>
            file.fileId !== root.fileId || file.fileRevision !== root.fileRevision
          ).map((file) => ({
            fileId: file.fileId,
            fileRevision: file.fileRevision,
            sourceText: exactTexts.get(`${file.fileId}@${file.fileRevision}`)!,
          })),
        });
      } catch (cause) {
        throw captureError(
          "analysis_rejected",
          "The exact Build123d workspace closure cannot be lowered by the registered profile.",
          cause,
        );
      }
      sourceText = lowered.script;
      if (
        new TextEncoder().encode(sourceText).byteLength >
          profile.workspaceClosureLowering.maxEffectiveScriptBytes
      ) {
        throw captureError(
          "source_size_limit_exceeded",
          "The lowered Build123d executable script exceeds its server-owned effective-script byte limit.",
        );
      }
      sourceId = `technical-unit:${closure.fingerprint.digest}`;
      effectiveUnit = {
        kind: "build123d-workspace-closure-lowered" as const,
        closureKind: "build123d-workspace-closure-lowered" as const,
        unitId: sourceId,
        closureFingerprint: closure.fingerprint,
        scriptFingerprint: lowered.scriptFingerprint,
        lowerer: {
          schemaVersion: lowered.schemaVersion,
          kind: lowered.kind,
          manifestFingerprint: lowered.manifest.fingerprint,
        },
        loweringManifest: lowered.manifest,
      };
    } else {
      sourceId = `technical-unit:${closure.fingerprint.digest}`;
      effectiveUnit = {
        kind: "authored-root" as const,
        closureKind: "unlowered-closure" as const,
        unitId: sourceId,
        closureFingerprint: closure.fingerprint,
        scriptFingerprint: root.resourceRef.fingerprint,
      };
    }

    let closureLocator;
    try {
      closureLocator = await this.#closures.persist(closure);
      const reopenedClosure = await this.#closures.reopenLocator(closureLocator);
      await recrossProjectSourceClosure(state, reopenedClosure.document);
      if (reopenedClosure.document.fingerprint.digest !== closure.fingerprint.digest) {
        throw new TypeError("Persisted source closure fingerprint drifted.");
      }
    } catch (cause) {
      if (cause instanceof ProjectTechnicalSourceCaptureError) throw cause;
      throw captureError(
        cause instanceof ProjectSourceClosureStoreError &&
          cause.code === "locator_cas_tampered"
          ? "closure_integrity_failed"
          : "closure_persist_failed",
        "The project source closure could not be persisted and recrossed exactly.",
        cause,
      );
    }

    const attachment = attachmentProvenanceFrom(closure.attachment);
    const sourceClosure = sourceClosureProvenanceFrom(closureLocator, closure);
    let persisted;
    try {
      persisted = await this.#captures.persist({
        profileId: profile.id,
        sourceId,
        sourceText,
        effectiveUnit,
        attachment,
        sourceClosure,
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
      assertTechnicalSourceAttachmentProvenanceEqual(
        attachment,
        reopened.document.attachment,
        "$persistedTechnicalSource.attachment",
      );
      assertTechnicalSourceClosureProvenanceEqual(
        sourceClosure,
        reopened.document.sourceClosure,
        "$persistedTechnicalSource.sourceClosure",
      );
      if (reopened.document.source.id !== sourceId) {
        throw new TypeError(
          "Capture document source.id must equal the effective unit id.",
        );
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
    ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    "$technicalSourceCapture",
  );
  const projectId = safeId(command.projectId, "$technicalSourceCapture.projectId");
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("$technicalSourceCapture.projectId cannot use a latest alias.");
  }
  const attachmentId = safeId(
    command.attachmentId,
    "$technicalSourceCapture.attachmentId",
  );
  if (attachmentId.toLowerCase() === "latest") {
    throw new TypeError(
      "$technicalSourceCapture.attachmentId cannot use a latest alias.",
    );
  }
  return {
    projectId,
    workspaceRevision: positiveInteger(
      command.workspaceRevision,
      "$technicalSourceCapture.workspaceRevision",
    ),
    attachmentId,
    attachmentRevision: positiveInteger(
      command.attachmentRevision,
      "$technicalSourceCapture.attachmentRevision",
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

function mapClosureError(cause: unknown): ProjectTechnicalSourceCaptureError {
  if (cause instanceof ProjectSourceClosureError) {
    const mapped: Partial<
      Record<
        ProjectSourceClosureError["code"],
        ProjectTechnicalSourceCaptureError["code"]
      >
    > = {
      attachment_not_found: "attachment_not_found",
      attachment_not_active: "attachment_not_active",
      attachment_revision_not_head: "attachment_revision_not_head",
      source_removed: "source_removed",
      root_not_active: "file_revision_not_active",
      event_fingerprint_missing: "workspace_integrity_failed",
    };
    return captureError(
      mapped[cause.code] ?? "closure_unresolved",
      cause.message,
      cause,
    );
  }
  return captureError(
    "closure_unresolved",
    "The exact attachment source closure could not be resolved.",
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
