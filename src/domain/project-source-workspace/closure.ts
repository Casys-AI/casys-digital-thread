/**
 * Canonical project-source dependency closure.
 *
 * Resolution is a pure workspace replay. Role catalogues, resource reopen,
 * CAS persistence and compilation admission stay outside this module.
 */

import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  agentResourceReferencesEqual,
  parseAgentResourceReference,
} from "../resource/agent-resource-reference.ts";
import type { AgentResourceReference } from "../resource/agent-resource-capture.ts";
import { attachmentRevisionAt, contentRevisionAt } from "./transitions.ts";
import {
  PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
  type ProjectSourceAttachmentDeclaredAgainst,
  type ProjectSourceAttachmentRevision,
  type ProjectSourceAttachmentRole,
  type ProjectSourceAttachmentTarget,
  type ProjectSourceCaptureRequest,
  type ProjectSourceFileRevision,
  type ProjectSourceFileRevisionRef,
  type ProjectSourceWorkspaceState,
} from "./types.ts";
import {
  parseAttachmentDeclaredAgainst,
  parseAttachmentRole,
  parseAttachmentTarget,
  parseCaptureRequest,
  parseFileRevisionRef,
  parseProjectId,
} from "./validation.ts";

export const PROJECT_SOURCE_CLOSURE_SCHEMA = "project-source-closure/1.0" as const;
export const PROJECT_SOURCE_CLOSURE_KIND = "project-source-closure" as const;
export const PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA =
  "project-source-closure-locator/1.0" as const;
export const PROJECT_SOURCE_CLOSURE_LOCATOR_KIND =
  "project-source-closure-locator" as const;
export const PROJECT_SOURCE_CLOSURE_URI_PREFIX =
  "casys://project-source-closure/sha256/" as const;
export const PROJECT_SOURCE_CLOSURE_URI_PATTERN =
  /^casys:\/\/project-source-closure\/sha256\/[a-f0-9]{64}$/;

/**
 * Server-owned bounds for one closure traversal. Distinct from workspace
 * page size: a bound limits this operation, not the project's file count.
 * Fan-out stays 32 so a single file cannot exceed the workspace mutation
 * bound; node/edge/depth are a larger but still finite envelope.
 */
export const PROJECT_SOURCE_CLOSURE_BOUNDS = Object.freeze({
  maxFiles: 1024,
  maxEdges: 4096,
  maxFanout: 32,
  maxDepth: 64,
});

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CAS_URI = /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/;

export type ProjectSourceClosureErrorCode =
  | "invalid_request"
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "source_removed"
  | "root_not_active"
  | "dependency_missing"
  | "dependency_tombstone"
  | "dependency_cycle"
  | "contradictory_duplicate"
  | "bound_exceeded"
  | "event_fingerprint_missing"
  | "workspace_mismatch"
  | "closure_mismatch";

export class ProjectSourceClosureError extends Error {
  constructor(
    readonly code: ProjectSourceClosureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceClosureError";
  }
}

export interface ProjectSourceClosureAttachment {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly predecessorAttachmentRevision?: number;
  readonly fingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
}

export interface ProjectSourceClosureRoot {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly fingerprint: ContentFingerprint;
  readonly resourceRef: AgentResourceReference;
}

export interface ProjectSourceClosureFile {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly predecessorFileRevision?: number;
  readonly fingerprint: ContentFingerprint;
  readonly resourceRef: AgentResourceReference;
  readonly role: string;
  readonly captureRequest?: ProjectSourceCaptureRequest;
  readonly dependencies: readonly ProjectSourceFileRevisionRef[];
}

export interface ProjectSourceClosureEdge {
  readonly from: ProjectSourceFileRevisionRef;
  readonly to: ProjectSourceFileRevisionRef;
}

export interface ProjectSourceClosure {
  readonly schemaVersion: typeof PROJECT_SOURCE_CLOSURE_SCHEMA;
  readonly kind: typeof PROJECT_SOURCE_CLOSURE_KIND;
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly workspaceEventFingerprint: ContentFingerprint;
  readonly attachment: ProjectSourceClosureAttachment;
  readonly root: ProjectSourceClosureRoot;
  readonly files: readonly ProjectSourceClosureFile[];
  readonly edges: readonly ProjectSourceClosureEdge[];
  readonly fingerprint: ContentFingerprint;
}

export interface ProjectSourceClosureLocator {
  readonly schemaVersion: typeof PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA;
  readonly kind: typeof PROJECT_SOURCE_CLOSURE_LOCATOR_KIND;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

export interface ProjectSourceClosureQuery {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
}

export async function resolveProjectSourceClosure(
  state: ProjectSourceWorkspaceState,
  query: ProjectSourceClosureQuery,
): Promise<ProjectSourceClosure> {
  const facts = collectProjectSourceClosureFacts(state, query);
  return await sealProjectSourceClosure(facts);
}

export async function recrossProjectSourceClosure(
  state: ProjectSourceWorkspaceState,
  expected: ProjectSourceClosure,
): Promise<ProjectSourceClosure> {
  if (state.projectId !== expected.projectId) {
    throw new ProjectSourceClosureError(
      "workspace_mismatch",
      "Project source closure is foreign to the requested workspace project.",
    );
  }
  if (state.workspaceRevision !== expected.workspaceRevision) {
    throw new ProjectSourceClosureError(
      "workspace_mismatch",
      "Project source closure does not name the exact workspace revision.",
    );
  }
  if (
    state.lastEventFingerprint === undefined ||
    !fingerprintsEqual(
      state.lastEventFingerprint,
      expected.workspaceEventFingerprint,
    )
  ) {
    throw new ProjectSourceClosureError(
      "workspace_mismatch",
      "Workspace event fingerprint does not match the sealed source closure.",
    );
  }
  const observed = await resolveProjectSourceClosure(state, {
    attachmentId: expected.attachment.attachmentId,
    attachmentRevision: expected.attachment.attachmentRevision,
  });
  if (
    !fingerprintsEqual(observed.fingerprint, expected.fingerprint) ||
    !projectSourceClosuresEqual(observed, expected)
  ) {
    throw new ProjectSourceClosureError(
      "closure_mismatch",
      "Replayed project source closure does not match the sealed closure fingerprint.",
    );
  }
  return observed;
}

export async function validateProjectSourceClosure(
  value: unknown,
  path = "$projectSourceClosure",
): Promise<ProjectSourceClosure> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "projectId",
      "workspaceRevision",
      "workspaceEventFingerprint",
      "attachment",
      "root",
      "files",
      "edges",
      "fingerprint",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    PROJECT_SOURCE_CLOSURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, PROJECT_SOURCE_CLOSURE_KIND, `${path}.kind`);
  const files = parseFiles(root.files, `${path}.files`);
  const edges = parseEdges(root.edges, `${path}.edges`);
  const attachment = parseAttachment(root.attachment, `${path}.attachment`);
  const closureRoot = parseRoot(root.root, `${path}.root`);
  assertCanonicalClosureGraph(attachment, closureRoot, files, edges, path);
  const parsed = {
    schemaVersion: PROJECT_SOURCE_CLOSURE_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_KIND,
    projectId: exactProjectId(root.projectId, `${path}.projectId`),
    workspaceRevision: positiveInteger(
      root.workspaceRevision,
      `${path}.workspaceRevision`,
    ),
    workspaceEventFingerprint: parseFingerprint(
      root.workspaceEventFingerprint,
      `${path}.workspaceEventFingerprint`,
    ),
    attachment,
    root: closureRoot,
    files,
    edges,
  };
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const observed = await sha256Fingerprint(parsed);
  if (!fingerprintsEqual(fingerprint, observed)) {
    throw new TypeError(`${path}.fingerprint does not match the sealed closure facts.`);
  }
  return deepFreeze({ ...parsed, fingerprint });
}

export function validateProjectSourceClosureLocator(
  value: unknown,
  path = "$projectSourceClosureLocator",
): ProjectSourceClosureLocator {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
    path,
  );
  literalValue(
    root.schemaVersion,
    PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, PROJECT_SOURCE_CLOSURE_LOCATOR_KIND, `${path}.kind`);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const byteCount = nonNegativeSafeInteger(root.byteCount, `${path}.byteCount`);
  return deepFreeze({
    schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
    fingerprint,
    byteCount,
    casUri: locatorCasUri(root.casUri, fingerprint.digest, `${path}.casUri`),
  });
}

export function projectSourceClosureLocatorsEqual(
  left: ProjectSourceClosureLocator,
  right: ProjectSourceClosureLocator,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.byteCount === right.byteCount &&
    left.casUri === right.casUri;
}

export function projectSourceClosuresEqual(
  left: ProjectSourceClosure,
  right: ProjectSourceClosure,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    left.projectId === right.projectId &&
    left.workspaceRevision === right.workspaceRevision &&
    fingerprintsEqual(
      left.workspaceEventFingerprint,
      right.workspaceEventFingerprint,
    ) &&
    attachmentsEqual(left.attachment, right.attachment) &&
    rootsEqual(left.root, right.root) &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => filesEqual(file, right.files[index]!)) &&
    left.edges.length === right.edges.length &&
    left.edges.every((edge, index) => edgesEqual(edge, right.edges[index]!)) &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

export async function sealProjectSourceClosure(
  facts: Omit<ProjectSourceClosure, "fingerprint">,
): Promise<ProjectSourceClosure> {
  const fingerprint = await sha256Fingerprint(facts);
  return deepFreeze({ ...facts, fingerprint });
}

function collectProjectSourceClosureFacts(
  state: ProjectSourceWorkspaceState,
  query: ProjectSourceClosureQuery,
): Omit<ProjectSourceClosure, "fingerprint"> {
  if (state.lastEventFingerprint === undefined) {
    throw new ProjectSourceClosureError(
      "event_fingerprint_missing",
      "A project source closure requires a hash-chained workspace event fingerprint.",
    );
  }
  const attachment = requireActiveAttachmentHead(
    state,
    query.attachmentId,
    query.attachmentRevision,
  );
  const rootRecord = requireActiveRootFile(state, attachment.fileId);
  const walked = walkClosure(state, rootRecord);
  const files = topologicalFiles(walked.files, walked.edges);
  const edges = sortEdges(walked.edges);
  const root = {
    fileId: rootRecord.fileId,
    fileRevision: rootRecord.fileRevision,
    fingerprint: rootRecord.fingerprint,
    resourceRef: rootRecord.resourceRef,
  };
  return {
    schemaVersion: PROJECT_SOURCE_CLOSURE_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_KIND,
    projectId: state.projectId,
    workspaceRevision: state.workspaceRevision,
    workspaceEventFingerprint: state.lastEventFingerprint,
    attachment: attachmentFacts(attachment),
    root,
    files,
    edges,
  };
}

function requireActiveAttachmentHead(
  state: ProjectSourceWorkspaceState,
  attachmentId: string,
  attachmentRevision: number,
): ProjectSourceAttachmentRevision {
  const record = state.attachments.get(attachmentId);
  if (!record) {
    throw new ProjectSourceClosureError(
      "attachment_not_found",
      `Attachment ${attachmentId} is not present at workspace revision ${state.workspaceRevision}.`,
    );
  }
  let revision;
  try {
    revision = attachmentRevisionAt(state, attachmentId, attachmentRevision);
  } catch {
    throw new ProjectSourceClosureError(
      "attachment_not_found",
      `Attachment ${attachmentId}@${attachmentRevision} is not present at workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (record.status === "detached" || revision.kind !== "content") {
    throw new ProjectSourceClosureError(
      "attachment_not_active",
      `Attachment ${attachmentId}@${attachmentRevision} is not an active head.`,
    );
  }
  if (record.headRevision !== attachmentRevision) {
    throw new ProjectSourceClosureError(
      "attachment_revision_not_head",
      `Attachment ${attachmentId}@${attachmentRevision} is not the unique active head ${record.headRevision}.`,
    );
  }
  const file = state.files.get(record.fileId);
  if (!file || file.status !== "active") {
    throw new ProjectSourceClosureError(
      "source_removed",
      `Attachment ${attachmentId} source file ${record.fileId} is not active at this workspace revision.`,
    );
  }
  return revision;
}

function requireActiveRootFile(
  state: ProjectSourceWorkspaceState,
  fileId: string,
): ProjectSourceFileRevision {
  const file = state.files.get(fileId);
  if (!file) {
    throw new ProjectSourceClosureError(
      "root_not_active",
      `Root file ${fileId} is not present at workspace revision ${state.workspaceRevision}.`,
    );
  }
  let record;
  try {
    record = contentRevisionAt(state, fileId, file.headRevision);
  } catch {
    throw new ProjectSourceClosureError(
      "root_not_active",
      `Root file ${fileId} has no content revision at workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (
    file.status !== "active" ||
    record.kind !== "content"
  ) {
    throw new ProjectSourceClosureError(
      "root_not_active",
      `Root file ${fileId}@${file.headRevision} is not the active content head.`,
    );
  }
  return record;
}

function walkClosure(
  state: ProjectSourceWorkspaceState,
  root: ProjectSourceFileRevision,
): {
  files: Map<string, ProjectSourceClosureFile>;
  edges: ProjectSourceClosureEdge[];
} {
  const files = new Map<string, ProjectSourceClosureFile>();
  const edges: ProjectSourceClosureEdge[] = [];
  const visiting = new Set<string>();

  function visit(record: ProjectSourceFileRevision, depth: number): void {
    if (depth > PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth) {
      throw new ProjectSourceClosureError(
        "bound_exceeded",
        `Project source closure exceeds the server-owned depth bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth}.`,
      );
    }
    const key = fileKey(record);
    if (visiting.has(key)) {
      throw new ProjectSourceClosureError(
        "dependency_cycle",
        `Project source closure contains a dependency cycle at ${key}.`,
      );
    }
    const existing = files.get(key);
    if (existing) {
      assertSameFile(existing, closureFile(record), key);
      return;
    }
    if (record.dependencies.length > PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout) {
      throw new ProjectSourceClosureError(
        "bound_exceeded",
        `File ${key} exceeds the server-owned dependency fan-out bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout}.`,
      );
    }
    visiting.add(key);
    files.set(key, closureFile(record));
    if (files.size > PROJECT_SOURCE_CLOSURE_BOUNDS.maxFiles) {
      throw new ProjectSourceClosureError(
        "bound_exceeded",
        `Project source closure exceeds the server-owned file bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxFiles}.`,
      );
    }
    for (const dependency of record.dependencies) {
      const next = requireDependencyContent(
        state,
        dependency.fileId,
        dependency.fileRevision,
      );
      edges.push({
        from: { fileId: record.fileId, fileRevision: record.fileRevision },
        to: { fileId: next.fileId, fileRevision: next.fileRevision },
      });
      if (edges.length > PROJECT_SOURCE_CLOSURE_BOUNDS.maxEdges) {
        throw new ProjectSourceClosureError(
          "bound_exceeded",
          `Project source closure exceeds the server-owned edge bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxEdges}.`,
        );
      }
      visit(next, depth + 1);
    }
    visiting.delete(key);
  }

  visit(root, 0);
  return { files, edges: dedupeEdges(edges) };
}

function requireDependencyContent(
  state: ProjectSourceWorkspaceState,
  fileId: string,
  fileRevision: number,
): ProjectSourceFileRevision {
  let record;
  try {
    record = contentRevisionAt(state, fileId, fileRevision);
  } catch {
    throw new ProjectSourceClosureError(
      "dependency_missing",
      `Dependency ${fileId}@${fileRevision} is not present at workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (record.kind === "tombstone") {
    throw new ProjectSourceClosureError(
      "dependency_tombstone",
      `Dependency ${fileId}@${fileRevision} is a tombstone at workspace revision ${state.workspaceRevision}.`,
    );
  }
  return record;
}

function topologicalFiles(
  files: Map<string, ProjectSourceClosureFile>,
  edges: readonly ProjectSourceClosureEdge[],
): ProjectSourceClosureFile[] {
  const remaining = new Map<string, Set<string>>();
  for (const file of files.values()) {
    remaining.set(fileKey(file), new Set());
  }
  for (const edge of edges) {
    const from = fileKey(edge.from);
    const to = fileKey(edge.to);
    remaining.get(from)?.add(to);
  }
  const ready = [...files.values()]
    .filter((file) => remaining.get(fileKey(file))?.size === 0)
    .sort(compareFiles);
  const ordered: ProjectSourceClosureFile[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    ordered.push(next);
    const released = fileKey(next);
    for (const [key, deps] of remaining) {
      if (!deps.delete(released) || deps.size !== 0) continue;
      const file = files.get(key);
      if (file) insertSorted(ready, file);
    }
  }
  if (ordered.length !== files.size) {
    throw new ProjectSourceClosureError(
      "dependency_cycle",
      "Project source closure is not a finite acyclic dependency graph.",
    );
  }
  return ordered;
}

function attachmentFacts(
  attachment: ProjectSourceAttachmentRevision,
): ProjectSourceClosureAttachment {
  return {
    attachmentId: attachment.attachmentId,
    attachmentRevision: attachment.attachmentRevision,
    ...(attachment.predecessorAttachmentRevision === undefined ? {} : {
      predecessorAttachmentRevision: attachment.predecessorAttachmentRevision,
    }),
    fingerprint: attachment.fingerprint,
    fileId: attachment.fileId,
    role: attachment.role,
    target: attachment.target,
    declaredAgainst: attachment.declaredAgainst,
  };
}

function closureFile(record: ProjectSourceFileRevision): ProjectSourceClosureFile {
  return {
    fileId: record.fileId,
    fileRevision: record.fileRevision,
    ...(record.predecessorFileRevision === undefined
      ? {}
      : { predecessorFileRevision: record.predecessorFileRevision }),
    fingerprint: record.fingerprint,
    resourceRef: record.resourceRef,
    role: record.role,
    ...(record.captureRequest === undefined
      ? {}
      : { captureRequest: record.captureRequest }),
    dependencies: [...record.dependencies],
  };
}

function parseAttachment(
  value: unknown,
  path: string,
): ProjectSourceClosureAttachment {
  const root = closedRecord(
    value,
    [
      "attachmentId",
      "attachmentRevision",
      "predecessorAttachmentRevision",
      "fingerprint",
      "fileId",
      "role",
      "target",
      "declaredAgainst",
    ],
    [
      "attachmentId",
      "attachmentRevision",
      "fingerprint",
      "fileId",
      "role",
      "target",
      "declaredAgainst",
    ],
    path,
  );
  let role: ProjectSourceAttachmentRole;
  let target: ProjectSourceAttachmentTarget;
  let declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  try {
    role = parseAttachmentRole(root.role, `${path}.role`);
    target = parseAttachmentTarget(root.target, `${path}.target`);
    declaredAgainst = parseAttachmentDeclaredAgainst(
      root.declaredAgainst,
      `${path}.declaredAgainst`,
    );
  } catch (cause) {
    throw new TypeError(
      cause instanceof Error
        ? cause.message
        : `${path} is not an exact attachment head.`,
    );
  }
  if (
    declaredAgainst.architecture.captureSchema !==
      PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA
  ) {
    throw new TypeError(
      `${path}.declaredAgainst.architecture.captureSchema must be ${PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA}.`,
    );
  }
  return {
    attachmentId: exactProjectId(root.attachmentId, `${path}.attachmentId`),
    attachmentRevision: positiveInteger(
      root.attachmentRevision,
      `${path}.attachmentRevision`,
    ),
    ...(Object.hasOwn(root, "predecessorAttachmentRevision")
      ? {
        predecessorAttachmentRevision: positiveInteger(
          root.predecessorAttachmentRevision,
          `${path}.predecessorAttachmentRevision`,
        ),
      }
      : {}),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    fileId: exactProjectId(root.fileId, `${path}.fileId`),
    role,
    target,
    declaredAgainst,
  };
}

function parseRoot(value: unknown, path: string): ProjectSourceClosureRoot {
  const root = exactRecord(
    value,
    ["fileId", "fileRevision", "fingerprint", "resourceRef"],
    path,
  );
  return {
    fileId: exactProjectId(root.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(root.fileRevision, `${path}.fileRevision`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    resourceRef: parseAgentResourceReference(root.resourceRef, `${path}.resourceRef`),
  };
}

function parseFiles(
  value: unknown,
  path: string,
): readonly ProjectSourceClosureFile[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  const files = value.map((item, index) => parseFile(item, `${path}[${index}]`));
  rejectDuplicates(files.map(fileKey), path);
  return files;
}

function parseFile(value: unknown, path: string): ProjectSourceClosureFile {
  const root = closedRecord(
    value,
    [
      "fileId",
      "fileRevision",
      "predecessorFileRevision",
      "fingerprint",
      "resourceRef",
      "role",
      "captureRequest",
      "dependencies",
    ],
    ["fileId", "fileRevision", "fingerprint", "resourceRef", "role", "dependencies"],
    path,
  );
  let captureRequest: ProjectSourceCaptureRequest | undefined;
  let dependencies: readonly ProjectSourceFileRevisionRef[];
  try {
    captureRequest = Object.hasOwn(root, "captureRequest")
      ? parseCaptureRequest(root.captureRequest, `${path}.captureRequest`)
      : undefined;
    if (!Array.isArray(root.dependencies)) {
      throw new TypeError(`${path}.dependencies must be an array.`);
    }
    dependencies = root.dependencies.map((item, index) =>
      parseFileRevisionRef(item, `${path}.dependencies[${index}]`)
    );
    rejectDuplicates(
      dependencies.map((item) => fileKey(item)),
      `${path}.dependencies`,
    );
  } catch (cause) {
    throw new TypeError(
      cause instanceof Error ? cause.message : `${path} is not an exact closure file.`,
    );
  }
  return {
    fileId: exactProjectId(root.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(root.fileRevision, `${path}.fileRevision`),
    ...(Object.hasOwn(root, "predecessorFileRevision")
      ? {
        predecessorFileRevision: positiveInteger(
          root.predecessorFileRevision,
          `${path}.predecessorFileRevision`,
        ),
      }
      : {}),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    resourceRef: parseAgentResourceReference(root.resourceRef, `${path}.resourceRef`),
    role: nonEmptyText(root.role, `${path}.role`),
    ...(captureRequest === undefined ? {} : { captureRequest }),
    dependencies,
  };
}

function parseEdges(
  value: unknown,
  path: string,
): readonly ProjectSourceClosureEdge[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  const edges = value.map((item, index) => {
    const edge = exactRecord(item, ["from", "to"], `${path}[${index}]`);
    try {
      return {
        from: parseFileRevisionRef(edge.from, `${path}[${index}].from`),
        to: parseFileRevisionRef(edge.to, `${path}[${index}].to`),
      };
    } catch (cause) {
      throw new TypeError(
        cause instanceof Error
          ? cause.message
          : `${path}[${index}] is not an exact edge.`,
      );
    }
  });
  rejectDuplicates(
    edges.map((edge) => `${fileKey(edge.from)}->${fileKey(edge.to)}`),
    path,
  );
  return edges;
}

function assertCanonicalClosureGraph(
  attachment: ProjectSourceClosureAttachment,
  root: ProjectSourceClosureRoot,
  files: readonly ProjectSourceClosureFile[],
  edges: readonly ProjectSourceClosureEdge[],
  path: string,
): void {
  if (attachment.fileId !== root.fileId) {
    throw new TypeError(
      `${path}.attachment.fileId must equal ${path}.root.fileId.`,
    );
  }
  if (files.length === 0) {
    throw new TypeError(`${path}.files must contain at least the root file.`);
  }
  if (files.length > PROJECT_SOURCE_CLOSURE_BOUNDS.maxFiles) {
    throw new TypeError(
      `${path}.files exceeds the server-owned file bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxFiles}.`,
    );
  }
  if (edges.length > PROJECT_SOURCE_CLOSURE_BOUNDS.maxEdges) {
    throw new TypeError(
      `${path}.edges exceeds the server-owned edge bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxEdges}.`,
    );
  }
  const match = files.find((file) =>
    file.fileId === root.fileId && file.fileRevision === root.fileRevision
  );
  if (
    !match ||
    !fingerprintsEqual(match.fingerprint, root.fingerprint) ||
    !agentResourceReferencesEqual(match.resourceRef, root.resourceRef)
  ) {
    throw new TypeError(`${path}.root must name the exact root file in files.`);
  }
  for (const [index, file] of files.entries()) {
    if (file.dependencies.length > PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout) {
      throw new TypeError(
        `${path}.files[${index}] exceeds the server-owned dependency fan-out bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxFanout}.`,
      );
    }
  }
  const expectedEdges = sortEdges(
    files.flatMap((file) =>
      file.dependencies.map((dependency) => ({
        from: { fileId: file.fileId, fileRevision: file.fileRevision },
        to: { fileId: dependency.fileId, fileRevision: dependency.fileRevision },
      }))
    ),
  );
  if (deterministicJson(edges) !== deterministicJson(expectedEdges)) {
    throw new TypeError(
      `${path}.edges must equal every file.dependencies relation in canonical order.`,
    );
  }
  const fileByKey = new Map(files.map((file) => [fileKey(file), file]));
  let expectedFiles: ProjectSourceClosureFile[];
  try {
    expectedFiles = topologicalFiles(fileByKey, edges);
  } catch (cause) {
    if (
      cause instanceof ProjectSourceClosureError &&
      cause.code === "dependency_cycle"
    ) {
      throw new TypeError(`${path}.files is not a finite acyclic dependency graph.`);
    }
    throw cause;
  }
  if (deterministicJson(files) !== deterministicJson(expectedFiles)) {
    throw new TypeError(
      `${path}.files must be in canonical topological order.`,
    );
  }
  assertClosureDepth(root, files, path);
}

function assertClosureDepth(
  root: ProjectSourceClosureRoot,
  files: readonly ProjectSourceClosureFile[],
  path: string,
): void {
  const byKey = new Map(files.map((file) => [fileKey(file), file]));
  const rootKey = fileKey(root);
  if (!byKey.has(rootKey)) {
    throw new TypeError(`${path}.root must name the exact root file in files.`);
  }
  const depth = new Map<string, number>([[rootKey, 0]]);
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const file = files[index]!;
    const key = fileKey(file);
    const current = depth.get(key);
    if (current === undefined) continue;
    if (current > PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth) {
      throw new TypeError(
        `${path} exceeds the server-owned depth bound of ${PROJECT_SOURCE_CLOSURE_BOUNDS.maxDepth}.`,
      );
    }
    for (const dependency of file.dependencies) {
      const nextKey = fileKey(dependency);
      if (!byKey.has(nextKey)) {
        throw new TypeError(
          `${path}.files names a dependency outside the sealed closure.`,
        );
      }
      const nextDepth = current + 1;
      const seen = depth.get(nextKey);
      if (seen === undefined || nextDepth > seen) depth.set(nextKey, nextDepth);
    }
  }
  if (depth.size !== files.length) {
    throw new TypeError(
      `${path}.files must contain only files reachable from the root.`,
    );
  }
}

function assertSameFile(
  existing: ProjectSourceClosureFile,
  observed: ProjectSourceClosureFile,
  key: string,
): void {
  if (!filesEqual(existing, observed)) {
    throw new ProjectSourceClosureError(
      "contradictory_duplicate",
      `File ${key} is reached with contradictory fingerprints, roles, or dependencies.`,
    );
  }
}

function attachmentsEqual(
  left: ProjectSourceClosureAttachment,
  right: ProjectSourceClosureAttachment,
): boolean {
  return left.attachmentId === right.attachmentId &&
    left.attachmentRevision === right.attachmentRevision &&
    left.predecessorAttachmentRevision === right.predecessorAttachmentRevision &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.fileId === right.fileId &&
    left.role.id === right.role.id &&
    left.role.version === right.role.version &&
    left.target.elementId === right.target.elementId &&
    left.target.elementKind === right.target.elementKind &&
    left.declaredAgainst.thread.snapshotId ===
      right.declaredAgainst.thread.snapshotId &&
    left.declaredAgainst.thread.revision === right.declaredAgainst.thread.revision &&
    left.declaredAgainst.thread.subjectId ===
      right.declaredAgainst.thread.subjectId &&
    left.declaredAgainst.architecture.artifactId ===
      right.declaredAgainst.architecture.artifactId &&
    fingerprintsEqual(
      left.declaredAgainst.architecture.fingerprint,
      right.declaredAgainst.architecture.fingerprint,
    ) &&
    left.declaredAgainst.architecture.captureSchema ===
      right.declaredAgainst.architecture.captureSchema;
}

function rootsEqual(
  left: ProjectSourceClosureRoot,
  right: ProjectSourceClosureRoot,
): boolean {
  return left.fileId === right.fileId &&
    left.fileRevision === right.fileRevision &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    agentResourceReferencesEqual(left.resourceRef, right.resourceRef);
}

function filesEqual(
  left: ProjectSourceClosureFile,
  right: ProjectSourceClosureFile,
): boolean {
  return left.fileId === right.fileId &&
    left.fileRevision === right.fileRevision &&
    left.predecessorFileRevision === right.predecessorFileRevision &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    agentResourceReferencesEqual(left.resourceRef, right.resourceRef) &&
    left.role === right.role &&
    left.captureRequest?.profileId === right.captureRequest?.profileId &&
    left.dependencies.length === right.dependencies.length &&
    left.dependencies.every((dependency, index) =>
      dependency.fileId === right.dependencies[index]?.fileId &&
      dependency.fileRevision === right.dependencies[index]?.fileRevision
    );
}

function edgesEqual(
  left: ProjectSourceClosureEdge,
  right: ProjectSourceClosureEdge,
): boolean {
  return left.from.fileId === right.from.fileId &&
    left.from.fileRevision === right.from.fileRevision &&
    left.to.fileId === right.to.fileId &&
    left.to.fileRevision === right.to.fileRevision;
}

function dedupeEdges(
  edges: readonly ProjectSourceClosureEdge[],
): ProjectSourceClosureEdge[] {
  const seen = new Set<string>();
  const unique: ProjectSourceClosureEdge[] = [];
  for (const edge of edges) {
    const key = `${fileKey(edge.from)}->${fileKey(edge.to)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return unique;
}

function sortEdges(
  edges: readonly ProjectSourceClosureEdge[],
): ProjectSourceClosureEdge[] {
  return [...edges].sort((left, right) => {
    const from = compareText(fileKey(left.from), fileKey(right.from));
    if (from !== 0) return from;
    return compareText(fileKey(left.to), fileKey(right.to));
  });
}

function insertSorted(
  files: ProjectSourceClosureFile[],
  file: ProjectSourceClosureFile,
): void {
  const index = files.findIndex((item) => compareFiles(file, item) < 0);
  if (index === -1) files.push(file);
  else files.splice(index, 0, file);
}

function compareFiles(
  left: ProjectSourceClosureFile,
  right: ProjectSourceClosureFile,
): number {
  const id = compareText(left.fileId, right.fileId);
  if (id !== 0) return id;
  return left.fileRevision - right.fileRevision;
}

function fileKey(
  file: { readonly fileId: string; readonly fileRevision: number },
): string {
  return `${file.fileId}@${file.fileRevision}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactProjectId(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  try {
    return parseProjectId(id, path);
  } catch (cause) {
    throw new TypeError(cause instanceof Error ? cause.message : `${path} is invalid.`);
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function locatorCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (
    !CAS_URI.test(uri) ||
    !PROJECT_SOURCE_CLOSURE_URI_PATTERN.test(uri) ||
    uri !== `${PROJECT_SOURCE_CLOSURE_URI_PREFIX}${digest}`
  ) {
    throw new TypeError(
      `${path} must be ${PROJECT_SOURCE_CLOSURE_URI_PREFIX}<digest>.`,
    );
  }
  return uri;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
