/**
 * Closed parsers and graph/path invariants for the source workspace.
 *
 * Extra keys fail closed. POSIX slugs and logical names are navigation labels,
 * never server filesystem paths.
 */

import {
  closedRecord,
  deepFreeze,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { parseProductStructureElementRef } from "../architecture/product-structure-ref.ts";
import { parseAgentResourceReference } from "../resource/agent-resource-reference.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import {
  PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
  PROJECT_SOURCE_WORKSPACE_BOUNDS as BOUNDS,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
  type ProjectSourceAttachmentDeclaredAgainst,
  type ProjectSourceAttachmentDetach,
  type ProjectSourceAttachmentListQuery,
  type ProjectSourceAttachmentPut,
  type ProjectSourceAttachmentReadQuery,
  type ProjectSourceAttachmentRecross,
  type ProjectSourceAttachmentRecrossIntent,
  type ProjectSourceAttachmentRecrossItem,
  type ProjectSourceAttachmentRecrossRequest,
  type ProjectSourceAttachmentRecrossSuccessor,
  type ProjectSourceAttachmentRole,
  type ProjectSourceAttachmentTarget,
  type ProjectSourceCaptureRequest,
  type ProjectSourceFilePut,
  type ProjectSourceFileReadQuery,
  type ProjectSourceFileRecord,
  type ProjectSourceFileRemove,
  type ProjectSourceFileRevisionRef,
  type ProjectSourceModule,
  type ProjectSourceModulePut,
  type ProjectSourceSearchQuery,
  type ProjectSourceTreeQuery,
  type ProjectSourceWorkspaceCommand,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceEvent,
  type ProjectSourceWorkspaceEventV3,
  type ProjectSourceWorkspaceEventV4,
  type ProjectSourceWorkspaceLegacyMutation,
  type ProjectSourceWorkspaceMutation,
  type ProjectSourceWorkspaceState,
} from "./types.ts";

const POSIX_SLUG = /^[a-z][a-z0-9_-]*$/;
const LOGICAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CLASSIFICATION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function workspaceError(
  code: ProjectSourceWorkspaceError["code"],
  message: string,
): never {
  throw new ProjectSourceWorkspaceError(code, message);
}

export function asWorkspaceError(cause: unknown, path: string): never {
  if (cause instanceof ProjectSourceWorkspaceError) throw cause;
  const message = cause instanceof Error ? cause.message : `${path} is invalid.`;
  workspaceError("invalid_request", message);
}

export function parseProjectId(value: unknown, path = "$projectId"): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    workspaceError("invalid_request", `${path} cannot use a latest alias.`);
  }
  return id;
}

export function parseMutationId(value: unknown, path = "$mutationId"): string {
  return parseProjectId(value, path);
}

export function parseWorkspaceRevision(
  value: unknown,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    workspaceError("invalid_request", `${path} must be a non-negative integer.`);
  }
  return Number(value);
}

export function parsePageSize(value: unknown | undefined, path: string): number {
  if (value === undefined) return BOUNDS.defaultPageSize;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    workspaceError("invalid_request", `${path} must be a positive integer.`);
  }
  const size = Number(value);
  if (size > BOUNDS.maxPageSize) {
    workspaceError(
      "bound_exceeded",
      `${path} must be at most ${BOUNDS.maxPageSize}.`,
    );
  }
  return size;
}

export function parsePosixSlug(value: unknown, path: string): string {
  const slug = nonEmptyText(value, path);
  if (slug.length > BOUNDS.maxSlugLength || !POSIX_SLUG.test(slug)) {
    workspaceError(
      "invalid_request",
      `${path} must be a POSIX-safe lowercase slug.`,
    );
  }
  if (slug.includes("..")) {
    workspaceError("invalid_request", `${path} must not contain '..'.`);
  }
  return slug;
}

export function parseLogicalName(value: unknown, path: string): string {
  const name = nonEmptyText(value, path);
  if (
    name.length > BOUNDS.maxLogicalNameLength ||
    !LOGICAL_NAME.test(name) ||
    name === "." ||
    name === ".." ||
    name.includes("..")
  ) {
    workspaceError(
      "invalid_request",
      `${path} must be a POSIX-safe logical file name.`,
    );
  }
  return name;
}

export function parseDisplayName(value: unknown, path: string): string {
  const name = nonEmptyText(value, path);
  if (name.length > BOUNDS.maxDisplayNameLength) {
    workspaceError(
      "bound_exceeded",
      `${path} must be at most ${BOUNDS.maxDisplayNameLength} characters.`,
    );
  }
  return name;
}

export function parseClassification(
  value: unknown,
  path: string,
): string {
  const token = nonEmptyText(value, path);
  if (token.length > BOUNDS.maxSlugLength || !CLASSIFICATION.test(token)) {
    workspaceError(
      "invalid_request",
      `${path} must be a generic classification slug.`,
    );
  }
  return token;
}

export function parseBoundedText(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  const text = nonEmptyText(value, path);
  if (text.length > maxLength) {
    workspaceError(
      "bound_exceeded",
      `${path} must be at most ${maxLength} characters.`,
    );
  }
  return text;
}

export function parseCaptureRequest(
  value: unknown,
  path: string,
): ProjectSourceCaptureRequest {
  const rec = exactClosed(
    value,
    ["profileId"],
    ["profileId"],
    path,
  );
  return deepFreeze({
    profileId: parseProjectId(rec.profileId, `${path}.profileId`),
  });
}

export function parseFileRevisionRef(
  value: unknown,
  path: string,
): ProjectSourceFileRevisionRef {
  const rec = exactClosed(
    value,
    ["fileId", "fileRevision"],
    ["fileId", "fileRevision"],
    path,
  );
  return deepFreeze({
    fileId: parseProjectId(rec.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(rec.fileRevision, `${path}.fileRevision`),
  });
}

export function parseModulePut(
  value: unknown,
  path = "$mutation",
): ProjectSourceModulePut {
  const rec = exactClosed(
    value,
    ["kind", "moduleId", "parentModuleId", "slug", "displayName", "domain"],
    ["kind", "moduleId", "slug", "displayName"],
    path,
  );
  literalValue(rec.kind, "module_put", `${path}.kind`);
  return deepFreeze({
    kind: "module_put" as const,
    moduleId: parseProjectId(rec.moduleId, `${path}.moduleId`),
    slug: parsePosixSlug(rec.slug, `${path}.slug`),
    displayName: parseDisplayName(rec.displayName, `${path}.displayName`),
    ...(Object.hasOwn(rec, "parentModuleId")
      ? {
        parentModuleId: parseProjectId(
          rec.parentModuleId,
          `${path}.parentModuleId`,
        ),
      }
      : {}),
    ...(Object.hasOwn(rec, "domain")
      ? { domain: parseClassification(rec.domain, `${path}.domain`) }
      : {}),
  });
}

export function parseFilePut(
  value: unknown,
  path = "$mutation",
): ProjectSourceFilePut {
  const rec = exactClosed(
    value,
    [
      "kind",
      "fileId",
      "predecessorFileRevision",
      "moduleId",
      "logicalName",
      "role",
      "dependencies",
      "captureRequest",
      "resourceRef",
    ],
    [
      "kind",
      "fileId",
      "moduleId",
      "logicalName",
      "role",
      "dependencies",
      "resourceRef",
    ],
    path,
  );
  literalValue(rec.kind, "file_put", `${path}.kind`);
  if (!Array.isArray(rec.dependencies)) {
    workspaceError("invalid_request", `${path}.dependencies must be an array.`);
  }
  if (rec.dependencies.length > BOUNDS.maxDependencyFanout) {
    workspaceError(
      "bound_exceeded",
      `${path}.dependencies fan-out is at most ${BOUNDS.maxDependencyFanout}.`,
    );
  }
  const dependencies = rec.dependencies.map((item, index) =>
    parseFileRevisionRef(item, `${path}.dependencies[${index}]`)
  );
  rejectDuplicates(
    dependencies.map((item) => `${item.fileId}@${item.fileRevision}`),
    `${path}.dependencies`,
  );
  let resourceRef: AgentResourceReference;
  try {
    resourceRef = parseAgentResourceReference(rec.resourceRef, `${path}.resourceRef`);
  } catch (cause) {
    asWorkspaceError(cause, `${path}.resourceRef`);
  }
  return deepFreeze({
    kind: "file_put" as const,
    fileId: parseProjectId(rec.fileId, `${path}.fileId`),
    moduleId: parseProjectId(rec.moduleId, `${path}.moduleId`),
    logicalName: parseLogicalName(rec.logicalName, `${path}.logicalName`),
    role: parseClassification(rec.role, `${path}.role`),
    dependencies,
    resourceRef,
    ...(Object.hasOwn(rec, "predecessorFileRevision")
      ? {
        predecessorFileRevision: positiveInteger(
          rec.predecessorFileRevision,
          `${path}.predecessorFileRevision`,
        ),
      }
      : {}),
    ...(Object.hasOwn(rec, "captureRequest")
      ? {
        captureRequest: parseCaptureRequest(
          rec.captureRequest,
          `${path}.captureRequest`,
        ),
      }
      : {}),
  });
}

export function parseAttachmentRole(
  value: unknown,
  path: string,
): ProjectSourceAttachmentRole {
  const rec = exactClosed(value, ["id", "version"], ["id", "version"], path);
  return deepFreeze({
    id: parseProjectId(rec.id, `${path}.id`),
    version: positiveInteger(rec.version, `${path}.version`),
  });
}

export function parseAttachmentTarget(
  value: unknown,
  path: string,
): ProjectSourceAttachmentTarget {
  try {
    return parseProductStructureElementRef(value, path);
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseAttachmentDeclaredAgainst(
  value: unknown,
  path: string,
): ProjectSourceAttachmentDeclaredAgainst {
  const rec = exactClosed(
    value,
    ["thread", "architecture"],
    ["thread", "architecture"],
    path,
  );
  const thread = exactClosed(
    rec.thread,
    ["snapshotId", "revision", "subjectId"],
    ["snapshotId", "revision", "subjectId"],
    `${path}.thread`,
  );
  const architecture = exactClosed(
    rec.architecture,
    ["artifactId", "fingerprint", "captureSchema"],
    ["artifactId", "fingerprint", "captureSchema"],
    `${path}.architecture`,
  );
  literalValue(
    architecture.captureSchema,
    PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
    `${path}.architecture.captureSchema`,
  );
  return deepFreeze({
    thread: {
      snapshotId: parseProjectId(thread.snapshotId, `${path}.thread.snapshotId`),
      revision: positiveInteger(thread.revision, `${path}.thread.revision`),
      subjectId: parseProjectId(thread.subjectId, `${path}.thread.subjectId`),
    },
    architecture: {
      artifactId: parseProjectId(
        architecture.artifactId,
        `${path}.architecture.artifactId`,
      ),
      fingerprint: parseContentFingerprint(
        architecture.fingerprint,
        `${path}.architecture.fingerprint`,
      ),
      captureSchema: PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
    },
  });
}

export function parseAttachmentPut(
  value: unknown,
  path = "$mutation",
): ProjectSourceAttachmentPut {
  const rec = exactClosed(
    value,
    [
      "kind",
      "attachmentId",
      "predecessorAttachmentRevision",
      "fileId",
      "role",
      "target",
      "declaredAgainst",
    ],
    ["kind", "attachmentId", "fileId", "role", "target", "declaredAgainst"],
    path,
  );
  literalValue(rec.kind, "attachment_put", `${path}.kind`);
  return deepFreeze({
    kind: "attachment_put" as const,
    attachmentId: parseProjectId(rec.attachmentId, `${path}.attachmentId`),
    fileId: parseProjectId(rec.fileId, `${path}.fileId`),
    role: parseAttachmentRole(rec.role, `${path}.role`),
    target: parseAttachmentTarget(rec.target, `${path}.target`),
    declaredAgainst: parseAttachmentDeclaredAgainst(
      rec.declaredAgainst,
      `${path}.declaredAgainst`,
    ),
    ...(Object.hasOwn(rec, "predecessorAttachmentRevision")
      ? {
        predecessorAttachmentRevision: positiveInteger(
          rec.predecessorAttachmentRevision,
          `${path}.predecessorAttachmentRevision`,
        ),
      }
      : {}),
  });
}

export function parseAttachmentDetach(
  value: unknown,
  path = "$mutation",
): ProjectSourceAttachmentDetach {
  const rec = exactClosed(
    value,
    ["kind", "attachmentId", "activeAttachmentRevision"],
    ["kind", "attachmentId", "activeAttachmentRevision"],
    path,
  );
  literalValue(rec.kind, "attachment_detach", `${path}.kind`);
  return deepFreeze({
    kind: "attachment_detach" as const,
    attachmentId: parseProjectId(rec.attachmentId, `${path}.attachmentId`),
    activeAttachmentRevision: positiveInteger(
      rec.activeAttachmentRevision,
      `${path}.activeAttachmentRevision`,
    ),
  });
}

function parseAttachmentRecrossItems(
  value: unknown,
  path: string,
): readonly ProjectSourceAttachmentRecrossItem[] {
  if (!Array.isArray(value)) {
    workspaceError("invalid_request", `${path} must be an array.`);
  }
  if (value.length < 1) {
    workspaceError("invalid_request", `${path} must name at least one attachment.`);
  }
  if (value.length > BOUNDS.maxAttachmentRecrossItems) {
    workspaceError(
      "bound_exceeded",
      `${path} must contain at most ${BOUNDS.maxAttachmentRecrossItems} attachments.`,
    );
  }
  const items = value.map((item, index) => {
    const rec = exactClosed(
      item,
      ["attachmentId", "activeAttachmentRevision"],
      ["attachmentId", "activeAttachmentRevision"],
      `${path}[${index}]`,
    );
    return {
      attachmentId: parseProjectId(
        rec.attachmentId,
        `${path}[${index}].attachmentId`,
      ),
      activeAttachmentRevision: positiveInteger(
        rec.activeAttachmentRevision,
        `${path}[${index}].activeAttachmentRevision`,
      ),
    } as const;
  });
  rejectDuplicates(
    items.map((item) => item.attachmentId),
    path,
  );
  return deepFreeze(
    items.toSorted((left, right) =>
      left.attachmentId.localeCompare(right.attachmentId)
    ),
  );
}

function parseAttachmentRecrossIntent(
  value: unknown,
  path: string,
): ProjectSourceAttachmentRecrossIntent {
  const rec = exactClosed(
    value,
    ["expectedWorkspaceRevision", "attachments"],
    ["expectedWorkspaceRevision", "attachments"],
    path,
  );
  return deepFreeze({
    expectedWorkspaceRevision: parseWorkspaceRevision(
      rec.expectedWorkspaceRevision,
      `${path}.expectedWorkspaceRevision`,
    ),
    attachments: parseAttachmentRecrossItems(rec.attachments, `${path}.attachments`),
  });
}

function parseAttachmentRecrossSuccessors(
  value: unknown,
  path: string,
): readonly ProjectSourceAttachmentRecrossSuccessor[] {
  if (!Array.isArray(value)) {
    workspaceError("invalid_request", `${path} must be an array.`);
  }
  if (value.length < 1) {
    workspaceError("invalid_request", `${path} must name at least one successor.`);
  }
  if (value.length > BOUNDS.maxAttachmentRecrossItems) {
    workspaceError(
      "bound_exceeded",
      `${path} must contain at most ${BOUNDS.maxAttachmentRecrossItems} successors.`,
    );
  }
  const successors = value.map((item, index) => {
    const rec = exactClosed(
      item,
      [
        "attachmentId",
        "predecessorAttachmentRevision",
        "fileId",
        "role",
        "target",
      ],
      [
        "attachmentId",
        "predecessorAttachmentRevision",
        "fileId",
        "role",
        "target",
      ],
      `${path}[${index}]`,
    );
    return {
      attachmentId: parseProjectId(
        rec.attachmentId,
        `${path}[${index}].attachmentId`,
      ),
      predecessorAttachmentRevision: positiveInteger(
        rec.predecessorAttachmentRevision,
        `${path}[${index}].predecessorAttachmentRevision`,
      ),
      fileId: parseProjectId(rec.fileId, `${path}[${index}].fileId`),
      role: parseAttachmentRole(rec.role, `${path}[${index}].role`),
      target: parseAttachmentTarget(rec.target, `${path}[${index}].target`),
    } as const;
  });
  rejectDuplicates(
    successors.map((successor) => successor.attachmentId),
    path,
  );
  return deepFreeze(
    successors.toSorted((left, right) =>
      left.attachmentId.localeCompare(right.attachmentId)
    ),
  );
}

export function parseAttachmentRecross(
  value: unknown,
  path = "$mutation",
): ProjectSourceAttachmentRecross {
  const rec = exactClosed(
    value,
    ["kind", "intent", "declaredAgainst", "successors"],
    ["kind", "intent", "declaredAgainst", "successors"],
    path,
  );
  literalValue(rec.kind, "attachment_recross", `${path}.kind`);
  const intent = parseAttachmentRecrossIntent(rec.intent, `${path}.intent`);
  const successors = parseAttachmentRecrossSuccessors(
    rec.successors,
    `${path}.successors`,
  );
  if (intent.attachments.length !== successors.length) {
    workspaceError(
      "invalid_request",
      `${path}.successors must exactly cover ${path}.intent.attachments.`,
    );
  }
  for (const item of intent.attachments) {
    const successor = successors.find((candidate) =>
      candidate.attachmentId === item.attachmentId
    );
    if (
      !successor ||
      successor.predecessorAttachmentRevision !== item.activeAttachmentRevision
    ) {
      workspaceError(
        "invalid_request",
        `${path}.successors must retain the selected active attachment heads.`,
      );
    }
  }
  return deepFreeze({
    kind: "attachment_recross" as const,
    intent,
    declaredAgainst: parseAttachmentDeclaredAgainst(
      rec.declaredAgainst,
      `${path}.declaredAgainst`,
    ),
    successors,
  });
}

export function parseAttachmentRecrossRequest(
  value: unknown,
  path = "$request",
): ProjectSourceAttachmentRecrossRequest {
  try {
    const rec = exactClosed(
      value,
      ["projectId", "mutationId", "expectedWorkspaceRevision", "attachments"],
      ["projectId", "mutationId", "expectedWorkspaceRevision", "attachments"],
      path,
    );
    return deepFreeze({
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      mutationId: parseMutationId(rec.mutationId, `${path}.mutationId`),
      expectedWorkspaceRevision: parseWorkspaceRevision(
        rec.expectedWorkspaceRevision,
        `${path}.expectedWorkspaceRevision`,
      ),
      attachments: parseAttachmentRecrossItems(rec.attachments, `${path}.attachments`),
    });
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseFileRemove(
  value: unknown,
  path = "$mutation",
): ProjectSourceFileRemove {
  const rec = exactClosed(
    value,
    ["kind", "fileId", "activeFileRevision"],
    ["kind", "fileId", "activeFileRevision"],
    path,
  );
  literalValue(rec.kind, "file_remove", `${path}.kind`);
  return deepFreeze({
    kind: "file_remove" as const,
    fileId: parseProjectId(rec.fileId, `${path}.fileId`),
    activeFileRevision: positiveInteger(
      rec.activeFileRevision,
      `${path}.activeFileRevision`,
    ),
  });
}

export function parseMutation(
  value: unknown,
  path = "$mutation",
): ProjectSourceWorkspaceMutation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    workspaceError("invalid_request", `${path} must be an object.`);
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "module_put") return parseModulePut(value, path);
  if (kind === "file_put") return parseFilePut(value, path);
  if (kind === "file_remove") return parseFileRemove(value, path);
  if (kind === "attachment_put") return parseAttachmentPut(value, path);
  if (kind === "attachment_detach") return parseAttachmentDetach(value, path);
  if (kind === "attachment_recross") return parseAttachmentRecross(value, path);
  workspaceError("invalid_request", `${path}.kind must be a workspace mutation.`);
}

/**
 * V3 is historical replay input only. Its closed mutation vocabulary ended
 * before the persisted attachment_recross batch existed, so accepting that
 * kind under V3 would rewrite the meaning of old event bytes.
 */
function parseLegacyWorkspaceMutation(
  value: unknown,
  path: string,
): ProjectSourceWorkspaceLegacyMutation {
  const mutation = parseMutation(value, path);
  if (mutation.kind === "attachment_recross") {
    workspaceError(
      "invalid_request",
      `${path}.kind attachment_recross requires project-source-workspace-event/4.0.`,
    );
  }
  return mutation;
}

export function parseWorkspaceCommand(
  value: unknown,
  path = "$command",
): ProjectSourceWorkspaceCommand {
  try {
    const rec = exactClosed(
      value,
      ["projectId", "mutationId", "expectedWorkspaceRevision", "mutation"],
      ["projectId", "mutationId", "expectedWorkspaceRevision", "mutation"],
      path,
    );
    const command = {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      mutationId: parseMutationId(rec.mutationId, `${path}.mutationId`),
      expectedWorkspaceRevision: parseWorkspaceRevision(
        rec.expectedWorkspaceRevision,
        `${path}.expectedWorkspaceRevision`,
      ),
      mutation: parseMutation(rec.mutation, `${path}.mutation`),
    };
    if (
      command.mutation.kind === "attachment_recross" &&
      command.mutation.intent.expectedWorkspaceRevision !==
        command.expectedWorkspaceRevision
    ) {
      workspaceError(
        "invalid_request",
        `${path}.mutation.intent.expectedWorkspaceRevision must equal ${path}.expectedWorkspaceRevision.`,
      );
    }
    return deepFreeze(command);
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseSnapshotQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } {
  try {
    const rec = exactClosed(value, ["projectId"], ["projectId"], path);
    return { projectId: parseProjectId(rec.projectId, `${path}.projectId`) };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseTreeQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } & ProjectSourceTreeQuery {
  try {
    const rec = exactClosed(
      value,
      ["projectId", "workspaceRevision", "moduleId", "pageSize", "cursor"],
      ["projectId", "workspaceRevision"],
      path,
    );
    return {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision: parseWorkspaceRevision(
        rec.workspaceRevision,
        `${path}.workspaceRevision`,
      ),
      ...(Object.hasOwn(rec, "moduleId")
        ? { moduleId: parseProjectId(rec.moduleId, `${path}.moduleId`) }
        : {}),
      ...(Object.hasOwn(rec, "pageSize")
        ? { pageSize: parsePageSize(rec.pageSize, `${path}.pageSize`) }
        : {}),
      ...(Object.hasOwn(rec, "cursor")
        ? {
          cursor: parseBoundedText(
            rec.cursor,
            `${path}.cursor`,
            BOUNDS.maxCursorLength,
          ),
        }
        : {}),
    };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseSearchQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } & ProjectSourceSearchQuery {
  try {
    const rec = exactClosed(
      value,
      [
        "projectId",
        "workspaceRevision",
        "pathPrefix",
        "moduleId",
        "domain",
        "role",
        "profileId",
        "pageSize",
        "cursor",
      ],
      ["projectId", "workspaceRevision"],
      path,
    );
    return {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision: parseWorkspaceRevision(
        rec.workspaceRevision,
        `${path}.workspaceRevision`,
      ),
      ...(Object.hasOwn(rec, "pathPrefix")
        ? {
          pathPrefix: parseBoundedText(
            rec.pathPrefix,
            `${path}.pathPrefix`,
            BOUNDS.maxDerivedPathLength,
          ),
        }
        : {}),
      ...(Object.hasOwn(rec, "moduleId")
        ? { moduleId: parseProjectId(rec.moduleId, `${path}.moduleId`) }
        : {}),
      ...(Object.hasOwn(rec, "domain")
        ? { domain: parseClassification(rec.domain, `${path}.domain`) }
        : {}),
      ...(Object.hasOwn(rec, "role")
        ? { role: parseClassification(rec.role, `${path}.role`) }
        : {}),
      ...(Object.hasOwn(rec, "profileId")
        ? {
          profileId: parseProjectId(
            rec.profileId,
            `${path}.profileId`,
          ),
        }
        : {}),
      ...(Object.hasOwn(rec, "pageSize")
        ? { pageSize: parsePageSize(rec.pageSize, `${path}.pageSize`) }
        : {}),
      ...(Object.hasOwn(rec, "cursor")
        ? {
          cursor: parseBoundedText(
            rec.cursor,
            `${path}.cursor`,
            BOUNDS.maxCursorLength,
          ),
        }
        : {}),
    };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseAttachmentReadQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } & ProjectSourceAttachmentReadQuery {
  try {
    const rec = exactClosed(
      value,
      ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
      ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
      path,
    );
    return {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision: parseWorkspaceRevision(
        rec.workspaceRevision,
        `${path}.workspaceRevision`,
      ),
      attachmentId: parseProjectId(rec.attachmentId, `${path}.attachmentId`),
      attachmentRevision: positiveInteger(
        rec.attachmentRevision,
        `${path}.attachmentRevision`,
      ),
    };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseAttachmentListQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } & ProjectSourceAttachmentListQuery {
  try {
    const rec = exactClosed(
      value,
      [
        "projectId",
        "workspaceRevision",
        "fileId",
        "target",
        "pageSize",
        "cursor",
      ],
      ["projectId", "workspaceRevision"],
      path,
    );
    const hasFileId = Object.hasOwn(rec, "fileId");
    const hasTarget = Object.hasOwn(rec, "target");
    if (hasFileId && hasTarget) {
      workspaceError(
        "invalid_request",
        `${path} must filter by at most one of fileId or target.`,
      );
    }
    return {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision: parseWorkspaceRevision(
        rec.workspaceRevision,
        `${path}.workspaceRevision`,
      ),
      ...(hasFileId ? { fileId: parseProjectId(rec.fileId, `${path}.fileId`) } : {}),
      ...(hasTarget
        ? { target: parseAttachmentTarget(rec.target, `${path}.target`) }
        : {}),
      ...(Object.hasOwn(rec, "pageSize")
        ? { pageSize: parsePageSize(rec.pageSize, `${path}.pageSize`) }
        : {}),
      ...(Object.hasOwn(rec, "cursor")
        ? {
          cursor: parseBoundedText(
            rec.cursor,
            `${path}.cursor`,
            BOUNDS.maxCursorLength,
          ),
        }
        : {}),
    };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseFileReadQuery(
  value: unknown,
  path = "$query",
): { readonly projectId: string } & ProjectSourceFileReadQuery {
  try {
    const rec = exactClosed(
      value,
      ["projectId", "workspaceRevision", "fileId", "fileRevision"],
      ["projectId", "workspaceRevision", "fileId", "fileRevision"],
      path,
    );
    return {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision: parseWorkspaceRevision(
        rec.workspaceRevision,
        `${path}.workspaceRevision`,
      ),
      fileId: parseProjectId(rec.fileId, `${path}.fileId`),
      fileRevision: positiveInteger(rec.fileRevision, `${path}.fileRevision`),
    };
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function parseWorkspaceEvent(
  value: unknown,
  path = "$event",
): ProjectSourceWorkspaceEvent {
  try {
    const rec = exactClosed(
      value,
      [
        "schemaVersion",
        "projectId",
        "workspaceRevision",
        "previousWorkspaceRevision",
        "previousEventFingerprint",
        "mutationId",
        "mutation",
        "fingerprint",
      ],
      [
        "schemaVersion",
        "projectId",
        "workspaceRevision",
        "previousWorkspaceRevision",
        "previousEventFingerprint",
        "mutationId",
        "mutation",
        "fingerprint",
      ],
      path,
    );
    if (
      rec.schemaVersion !== PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3 &&
      rec.schemaVersion !== PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA
    ) {
      workspaceError(
        "invalid_request",
        `${path}.schemaVersion must be project-source-workspace-event/3.0 or project-source-workspace-event/4.0.`,
      );
    }
    const workspaceRevision = parseWorkspaceRevision(
      rec.workspaceRevision,
      `${path}.workspaceRevision`,
    );
    if (workspaceRevision < 1) {
      workspaceError(
        "invalid_request",
        `${path}.workspaceRevision must be a positive integer.`,
      );
    }
    const common = {
      projectId: parseProjectId(rec.projectId, `${path}.projectId`),
      workspaceRevision,
      previousWorkspaceRevision: parseWorkspaceRevision(
        rec.previousWorkspaceRevision,
        `${path}.previousWorkspaceRevision`,
      ),
      previousEventFingerprint: parsePreviousEventFingerprint(
        rec.previousEventFingerprint,
        `${path}.previousEventFingerprint`,
      ),
      mutationId: parseMutationId(rec.mutationId, `${path}.mutationId`),
      fingerprint: parseContentFingerprint(
        rec.fingerprint,
        `${path}.fingerprint`,
      ),
    };
    if (rec.schemaVersion === PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3) {
      const event: ProjectSourceWorkspaceEventV3 = {
        schemaVersion: PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA_V3,
        ...common,
        mutation: parseLegacyWorkspaceMutation(rec.mutation, `${path}.mutation`),
      };
      return deepFreeze(event);
    }
    const event: ProjectSourceWorkspaceEventV4 = {
      schemaVersion: PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
      ...common,
      mutation: parseMutation(rec.mutation, `${path}.mutation`),
    };
    return deepFreeze(event);
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}

export function moduleOf(
  modules: ReadonlyMap<string, ProjectSourceModule>,
): (id: string) => ProjectSourceModule {
  return (id) => {
    const found = modules.get(id);
    if (!found) {
      workspaceError("module_not_found", `Module ${id} is not in the workspace.`);
    }
    return found;
  };
}

export function moduleDepth(
  modules: ReadonlyMap<string, ProjectSourceModule>,
  moduleId: string,
): number {
  let depth = 0;
  let current: string | undefined = moduleId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      workspaceError("module_cycle", "Module parent graph is cyclic.");
    }
    seen.add(current);
    depth += 1;
    if (depth > BOUNDS.maxModuleDepth) {
      workspaceError(
        "bound_exceeded",
        `Module depth is at most ${BOUNDS.maxModuleDepth}.`,
      );
    }
    current = modules.get(current)?.parentModuleId;
  }
  return depth;
}

export function moduleWouldCycle(
  modules: ReadonlyMap<string, ProjectSourceModule>,
  moduleId: string,
  parentModuleId: string | undefined,
): boolean {
  let current = parentModuleId;
  const seen = new Set<string>();
  while (current) {
    if (current === moduleId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = modules.get(current)?.parentModuleId;
  }
  return false;
}

export function derivedModulePath(
  modules: ReadonlyMap<string, ProjectSourceModule>,
  moduleId: string,
): string {
  const slugs: string[] = [];
  let current: string | undefined = moduleId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      workspaceError("module_cycle", "Module parent graph is cyclic.");
    }
    seen.add(current);
    const module = modules.get(current);
    if (!module) {
      workspaceError("module_not_found", `Module ${current} is not in the workspace.`);
    }
    slugs.push(module.slug);
    current = module.parentModuleId;
  }
  slugs.reverse();
  const path = `/${slugs.join("/")}`;
  if (path.length > BOUNDS.maxDerivedPathLength) {
    workspaceError(
      "bound_exceeded",
      `Derived path exceeds ${BOUNDS.maxDerivedPathLength} characters.`,
    );
  }
  return path;
}

export function derivedFilePath(
  modules: ReadonlyMap<string, ProjectSourceModule>,
  moduleId: string,
  logicalName: string,
): string {
  const path = `${derivedModulePath(modules, moduleId)}/${logicalName}`;
  if (path.length > BOUNDS.maxDerivedPathLength) {
    workspaceError(
      "bound_exceeded",
      `Derived path exceeds ${BOUNDS.maxDerivedPathLength} characters.`,
    );
  }
  return path;
}

export function assertModuleGraphDepth(
  modules: ReadonlyMap<string, ProjectSourceModule>,
): void {
  for (const module of modules.values()) {
    moduleDepth(modules, module.moduleId);
  }
}

export function assertUniqueDerivedPaths(
  state: Pick<ProjectSourceWorkspaceState, "modules" | "files">,
): void {
  const used = new Map<string, string>();
  const claim = (path: string, owner: string): void => {
    const existing = used.get(path);
    if (existing) {
      workspaceError(
        "path_collision",
        `Derived path ${path} collides between ${existing} and ${owner}.`,
      );
    }
    used.set(path, owner);
  };
  for (const module of state.modules.values()) {
    claim(
      derivedModulePath(state.modules, module.moduleId),
      `module ${module.moduleId}`,
    );
  }
  for (const file of state.files.values()) {
    if (file.status !== "active") continue;
    const head = file.revisions.get(file.headRevision);
    if (!head || head.kind !== "content") continue;
    claim(
      derivedFilePath(state.modules, head.moduleId, head.logicalName),
      `file ${file.fileId}`,
    );
  }
}

export function assertSiblingSlugUnique(
  modules: ReadonlyMap<string, ProjectSourceModule>,
  candidate: ProjectSourceModule,
): void {
  for (const other of modules.values()) {
    if (other.moduleId === candidate.moduleId) continue;
    if (other.parentModuleId !== candidate.parentModuleId) continue;
    if (other.slug === candidate.slug) {
      workspaceError(
        "path_collision",
        `Module slug ${candidate.slug} is not unique among siblings.`,
      );
    }
  }
}

export function assertLogicalNameUnique(
  files: ReadonlyMap<string, ProjectSourceFileRecord>,
  fileId: string,
  moduleId: string,
  logicalName: string,
): void {
  for (const other of files.values()) {
    if (other.fileId === fileId || other.status !== "active") continue;
    const head = other.revisions.get(other.headRevision);
    if (!head || head.kind !== "content") continue;
    if (head.moduleId === moduleId && head.logicalName === logicalName) {
      workspaceError(
        "path_collision",
        `Logical name ${logicalName} is not unique in module ${moduleId}.`,
      );
    }
  }
}

export function dependencyGraphHasCycle(
  edges: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visited.has(node)) return false;
    if (visiting.has(node)) return true;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of edges.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

export function parseContentFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  const fingerprint = exactClosed(
    value,
    ["algorithm", "digest"],
    ["algorithm", "digest"],
    path,
  );
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    workspaceError(
      "invalid_request",
      `${path}.digest must be lowercase sha256 hex.`,
    );
  }
  return { algorithm: "sha256", digest };
}

function parsePreviousEventFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint | null {
  if (value === null) return null;
  return parseContentFingerprint(value, path);
}

function exactClosed(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): Record<string, unknown> {
  try {
    return closedRecord(value, allowed, required, path);
  } catch (cause) {
    asWorkspaceError(cause, path);
  }
}
