/**
 * Seal the exact workspace mechanism-source attachment set as a case review.
 * This is provider-free: it opens no Chrono client and creates no Thread
 * successor.  The later registered seal operation owns that mutation.
 */

import type {
  ProjectPrescribedKinematicsCaseCaptureCommand,
  ProjectPrescribedKinematicsCaseCaptureResult,
  ProjectPrescribedKinematicsCaseCaptureUseCase,
} from "../../../ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import type { PrescribedKinematicsArchitectureIndex } from "../../../ports/out/mechanics/prescribed-kinematics-architecture-index.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  exactRecord,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  resolveProjectSourceClosure,
} from "../../../../domain/project-source-workspace/closure.ts";
import type {
  ProjectSourceAttachmentRevision,
  ProjectSourceWorkspaceState,
} from "../../../../domain/project-source-workspace/types.ts";
import {
  PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
  resolvePrescribedKinematicsSourceClosure,
  sealPrescribedKinematicsCase,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../../domain/resource/agent-resource-reference.ts";
import type { ReopenAgentResource } from "../../../use-cases/resource/reopen-agent-resource.ts";

export interface CaptureProjectPrescribedKinematicsCaseDependencies {
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly architecture: PrescribedKinematicsArchitectureIndex;
}

export class CaptureProjectPrescribedKinematicsCase
  implements ProjectPrescribedKinematicsCaseCaptureUseCase {
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #architecture: PrescribedKinematicsArchitectureIndex;

  constructor(dependencies: CaptureProjectPrescribedKinematicsCaseDependencies) {
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#architecture = dependencies.architecture;
  }

  async capture(value: unknown): Promise<ProjectPrescribedKinematicsCaseCaptureResult> {
    let command: ProjectPrescribedKinematicsCaseCaptureCommand;
    try {
      command = parseProjectPrescribedKinematicsCaseCaptureCommand(value);
    } catch {
      return unavailable(
        "invalid_request",
        "The mechanism case request failed exact validation.",
      );
    }
    let state: ProjectSourceWorkspaceState;
    try {
      state = await this.#workspace.loadAtFresh(
        command.projectId,
        command.workspaceRevision,
      );
    } catch {
      return unavailable(
        "workspace_unavailable",
        "The exact workspace snapshot could not be replayed.",
      );
    }
    if (
      state.projectId !== command.projectId ||
      state.workspaceRevision !== command.workspaceRevision
    ) {
      return unavailable(
        "workspace_mismatch",
        "The reopened workspace is foreign to the requested exact revision.",
      );
    }
    let attachments: readonly ProjectSourceAttachmentRevision[];
    try {
      attachments = sameFileMechanismAttachments(state, command);
    } catch (error) {
      return unavailable("attachment_unavailable", message(error));
    }
    let closures;
    try {
      closures = await Promise.all(
        attachments.map((attachment) =>
          resolveProjectSourceClosure(state, {
            attachmentId: attachment.attachmentId,
            attachmentRevision: attachment.attachmentRevision,
          })
        ),
      );
    } catch (error) {
      return unavailable("closure_unavailable", message(error));
    }
    const root = closures[0]!.root;
    let sourceText: string;
    try {
      sourceText = (await this.#resources.reopenUtf8Text(root.resourceRef, {
        acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
        maxBytes: 262_144,
      })).text;
    } catch {
      return unavailable(
        "resource_unavailable",
        "The exact mechanism JSON resource could not be reopened.",
      );
    }
    let sourceClosure;
    try {
      sourceClosure = await resolvePrescribedKinematicsSourceClosure({
        closures,
        sourceText,
      });
    } catch (error) {
      return unresolved("closure_mismatch", message(error));
    }
    const facts = await this.#architecture.open(attachments[0]!.declaredAgainst);
    if (!facts) {
      return unresolved(
        "architecture_unavailable",
        "The exact declared-against architecture-capture/4.0 could not be reopened.",
      );
    }
    const assembly = sourceClosure.source.assembly;
    const definitionId = assembly.elementKind === "PartDefinition"
      ? assembly.elementId
      : facts.typedDefinitionId(assembly.elementId);
    if (!definitionId) {
      return unresolved(
        "assembly_typed_by_missing",
        "The declared assembly PartUsage has no exact typed_by PartDefinition in its declared architecture capture.",
      );
    }
    const bodies = sourceClosure.source.bodies.map((body) => body.partUsageElementId);
    const immediate = [...new Set(facts.immediateUsageIds(definitionId))].toSorted();
    const expected = [...bodies].toSorted();
    if (JSON.stringify(immediate) !== JSON.stringify(expected)) {
      return unresolved(
        "immediate_body_set_mismatch",
        "The declared body PartUsage set must equal exactly the immediate children of the assembly PartDefinition.",
      );
    }
    return {
      status: "resolved",
      sealedCase: await sealPrescribedKinematicsCase(sourceClosure),
      grants: "none",
    };
  }
}

export function parseProjectPrescribedKinematicsCaseCaptureCommand(
  value: unknown,
): ProjectPrescribedKinematicsCaseCaptureCommand {
  const root = exactRecord(value, [
    "projectId",
    "workspaceRevision",
    "attachmentId",
    "attachmentRevision",
  ], "$prescribedKinematicsCaseCapture");
  const projectId = safeId(
    root.projectId,
    "$prescribedKinematicsCaseCapture.projectId",
  );
  const attachmentId = safeId(
    root.attachmentId,
    "$prescribedKinematicsCaseCapture.attachmentId",
  );
  if (projectId.toLowerCase() === "latest" || attachmentId.toLowerCase() === "latest") {
    throw new TypeError("latest is not an exact project-source identity.");
  }
  return {
    projectId,
    workspaceRevision: positiveInteger(
      root.workspaceRevision,
      "$prescribedKinematicsCaseCapture.workspaceRevision",
    ),
    attachmentId,
    attachmentRevision: positiveInteger(
      root.attachmentRevision,
      "$prescribedKinematicsCaseCapture.attachmentRevision",
    ),
  };
}

function sameFileMechanismAttachments(
  state: ProjectSourceWorkspaceState,
  named: ProjectPrescribedKinematicsCaseCaptureCommand,
): readonly ProjectSourceAttachmentRevision[] {
  const namedRecord = state.attachments.get(named.attachmentId);
  const namedRevision = namedRecord?.revisions.get(named.attachmentRevision);
  if (
    !namedRecord || namedRecord.status !== "active" ||
    namedRecord.headRevision !== named.attachmentRevision ||
    !namedRevision || namedRevision.kind !== "content"
  ) {
    throw new TypeError(
      "The named mechanism-source attachment is not its unique active head.",
    );
  }
  if (!mechanismAttachment(namedRevision)) {
    throw new TypeError(
      "The named attachment is not mechanism-source@1 onto a PartDefinition or PartUsage.",
    );
  }
  const file = state.files.get(namedRevision.fileId);
  if (!file || file.status !== "active") {
    throw new TypeError("The named mechanism-source file is not active.");
  }
  return [...state.attachments.values()].flatMap((record) => {
    if (record.status !== "active" || record.fileId !== namedRevision.fileId) return [];
    const revision = record.revisions.get(record.headRevision);
    return revision && revision.kind === "content" && mechanismAttachment(revision)
      ? [revision]
      : [];
  });
}

function mechanismAttachment(value: ProjectSourceAttachmentRevision): boolean {
  return value.role.id === PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE.id &&
    value.role.version === PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE.version &&
    (value.target.elementKind === "PartDefinition" ||
      value.target.elementKind === "PartUsage");
}

function unavailable(
  code: string,
  message: string,
): ProjectPrescribedKinematicsCaseCaptureResult {
  return { status: "unavailable", diagnostic: { code, message }, grants: "none" };
}

function unresolved(
  code: string,
  message: string,
): ProjectPrescribedKinematicsCaseCaptureResult {
  return { status: "unresolved", diagnostic: { code, message }, grants: "none" };
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The exact mechanism source could not be recrossed.";
}
