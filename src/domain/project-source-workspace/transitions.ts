/**
 * Pure workspace transitions. The event log is recovery authority.
 */

import { deepFreeze } from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS as BOUNDS,
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
  type ProjectSourceFilePut,
  type ProjectSourceFileRevision,
  type ProjectSourceFileRevisionRecord,
  type ProjectSourceFileTombstone,
  type ProjectSourceModule,
  type ProjectSourceModulePut,
  type ProjectSourceMutationAck,
  type ProjectSourceWorkspaceCommand,
  type ProjectSourceWorkspaceEvent,
  type ProjectSourceWorkspaceMutation,
  type ProjectSourceWorkspaceState,
  type ProjectSourceWorkspaceTransition,
} from "./types.ts";
import {
  assertLogicalNameUnique,
  assertModuleGraphDepth,
  assertSiblingSlugUnique,
  assertUniqueDerivedPaths,
  dependencyGraphHasCycle,
  moduleWouldCycle,
  parseWorkspaceCommand,
  parseWorkspaceEvent,
  workspaceError,
} from "./validation.ts";

export function emptyProjectSourceWorkspace(
  projectId: string,
): ProjectSourceWorkspaceState {
  return deepFreeze({
    projectId,
    workspaceRevision: 0,
    modules: new Map(),
    files: new Map(),
    mutations: new Map(),
  });
}

export async function commandFingerprint(
  command: ProjectSourceWorkspaceCommand,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    projectId: command.projectId,
    mutationId: command.mutationId,
    expectedWorkspaceRevision: command.expectedWorkspaceRevision,
    mutation: command.mutation,
  });
}

export async function eventBodyFingerprint(
  event: Omit<ProjectSourceWorkspaceEvent, "fingerprint">,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint({
    schemaVersion: event.schemaVersion,
    projectId: event.projectId,
    workspaceRevision: event.workspaceRevision,
    previousWorkspaceRevision: event.previousWorkspaceRevision,
    mutationId: event.mutationId,
    mutation: event.mutation,
  });
}

export async function applyProjectSourceWorkspaceCommand(
  state: ProjectSourceWorkspaceState,
  value: unknown,
): Promise<ProjectSourceWorkspaceTransition> {
  const command = parseWorkspaceCommand(value);
  if (command.projectId !== state.projectId) {
    workspaceError(
      "invalid_request",
      "Command projectId does not match the workspace project.",
    );
  }
  assertMutationPayloadBound(command.mutation);
  const existing = state.mutations.get(command.mutationId);
  if (existing) {
    const fingerprint = await commandFingerprint(command);
    if (!fingerprintsEqual(existing.commandFingerprint, fingerprint)) {
      workspaceError(
        "mutation_id_conflict",
        `Mutation ${command.mutationId} was already accepted with a different command.`,
      );
    }
    return { state, event: existing.event, replayed: true };
  }
  if (command.expectedWorkspaceRevision !== state.workspaceRevision) {
    workspaceError(
      "stale_revision",
      `Workspace expected revision ${command.expectedWorkspaceRevision}, current is ${state.workspaceRevision}.`,
    );
  }
  const nextRevision = state.workspaceRevision + 1;
  const nextState = await applyMutation(state, command.mutation);
  const eventBody = {
    schemaVersion: PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
    projectId: command.projectId,
    workspaceRevision: nextRevision,
    previousWorkspaceRevision: state.workspaceRevision,
    mutationId: command.mutationId,
    mutation: command.mutation,
  };
  const fingerprint = await eventBodyFingerprint(eventBody);
  const event: ProjectSourceWorkspaceEvent = deepFreeze({
    ...eventBody,
    fingerprint,
  });
  const ack: ProjectSourceMutationAck = {
    mutationId: command.mutationId,
    commandFingerprint: await commandFingerprint(command),
    event,
  };
  const mutations = new Map(nextState.mutations);
  mutations.set(command.mutationId, ack);
  return {
    state: freezeState({
      ...nextState,
      workspaceRevision: nextRevision,
      lastEventFingerprint: fingerprint,
      mutations,
    }),
    event,
    replayed: false,
  };
}

export async function applyProjectSourceWorkspaceEvent(
  state: ProjectSourceWorkspaceState,
  value: unknown,
): Promise<ProjectSourceWorkspaceState> {
  const event = parseWorkspaceEvent(value);
  if (event.projectId !== state.projectId) {
    workspaceError(
      "invalid_request",
      "Event projectId does not match the workspace project.",
    );
  }
  if (event.previousWorkspaceRevision !== state.workspaceRevision) {
    workspaceError(
      "event_sequence_mismatch",
      `Event previous revision ${event.previousWorkspaceRevision} does not match ${state.workspaceRevision}.`,
    );
  }
  if (event.workspaceRevision !== state.workspaceRevision + 1) {
    workspaceError(
      "event_sequence_mismatch",
      `Event revision ${event.workspaceRevision} is not the next workspace revision.`,
    );
  }
  if (state.mutations.has(event.mutationId)) {
    workspaceError(
      "mutation_id_conflict",
      `Mutation ${event.mutationId} appears twice in the event log.`,
    );
  }
  const expected = await eventBodyFingerprint(event);
  if (!fingerprintsEqual(expected, event.fingerprint)) {
    workspaceError(
      "event_fingerprint_mismatch",
      `Event ${event.workspaceRevision} fingerprint does not match the canonical payload.`,
    );
  }
  const nextState = await applyMutation(state, event.mutation);
  const ack: ProjectSourceMutationAck = {
    mutationId: event.mutationId,
    commandFingerprint: await commandFingerprint({
      projectId: event.projectId,
      mutationId: event.mutationId,
      expectedWorkspaceRevision: event.previousWorkspaceRevision,
      mutation: event.mutation,
    }),
    event,
  };
  const mutations = new Map(nextState.mutations);
  mutations.set(event.mutationId, ack);
  return freezeState({
    ...nextState,
    workspaceRevision: event.workspaceRevision,
    lastEventFingerprint: event.fingerprint,
    mutations,
  });
}

export async function replayProjectSourceWorkspaceEvents(
  projectId: string,
  events: readonly unknown[],
): Promise<ProjectSourceWorkspaceState> {
  let state = emptyProjectSourceWorkspace(projectId);
  for (const [index, raw] of events.entries()) {
    const expectedRevision = index + 1;
    const event = parseWorkspaceEvent(raw, `$events[${index}]`);
    if (event.workspaceRevision !== expectedRevision) {
      workspaceError(
        "event_sequence_mismatch",
        `Event log has a gap or out-of-order revision at ${expectedRevision}.`,
      );
    }
    state = await applyProjectSourceWorkspaceEvent(state, event);
  }
  return state;
}

async function applyMutation(
  state: ProjectSourceWorkspaceState,
  mutation: ProjectSourceWorkspaceMutation,
): Promise<
  Omit<
    ProjectSourceWorkspaceState,
    "workspaceRevision" | "lastEventFingerprint" | "mutations"
  > & {
    mutations: ReadonlyMap<string, ProjectSourceMutationAck>;
  }
> {
  if (mutation.kind === "module_put") {
    return applyModulePut(state, mutation);
  }
  if (mutation.kind === "file_put") {
    return await applyFilePut(state, mutation);
  }
  return await applyFileRemove(state, mutation);
}

function applyModulePut(
  state: ProjectSourceWorkspaceState,
  mutation: ProjectSourceModulePut,
): ProjectSourceWorkspaceState {
  if (mutation.parentModuleId) {
    if (!state.modules.has(mutation.parentModuleId)) {
      workspaceError(
        "module_not_found",
        `Parent module ${mutation.parentModuleId} is not in the workspace.`,
      );
    }
    if (moduleWouldCycle(state.modules, mutation.moduleId, mutation.parentModuleId)) {
      workspaceError("module_cycle", "Module parent graph is cyclic.");
    }
  }
  const module: ProjectSourceModule = {
    moduleId: mutation.moduleId,
    slug: mutation.slug,
    displayName: mutation.displayName,
    ...(mutation.parentModuleId ? { parentModuleId: mutation.parentModuleId } : {}),
    ...(mutation.domain ? { domain: mutation.domain } : {}),
  };
  const modules = new Map(state.modules);
  modules.set(mutation.moduleId, module);
  assertSiblingSlugUnique(modules, module);
  assertModuleGraphDepth(modules);
  const next = { ...state, modules };
  assertUniqueDerivedPaths(next);
  return next;
}

async function applyFilePut(
  state: ProjectSourceWorkspaceState,
  mutation: ProjectSourceFilePut,
): Promise<ProjectSourceWorkspaceState> {
  if (!state.modules.has(mutation.moduleId)) {
    workspaceError(
      "module_not_found",
      `Module ${mutation.moduleId} is not in the workspace.`,
    );
  }
  const existing = state.files.get(mutation.fileId);
  if (existing?.status === "removed") {
    workspaceError(
      "branch_ambiguity",
      `File ${mutation.fileId} is tombstoned; a new branch is refused.`,
    );
  }
  if (existing?.status === "active") {
    if (mutation.predecessorFileRevision === undefined) {
      workspaceError(
        "branch_ambiguity",
        `File ${mutation.fileId} already exists; creation without the unique active predecessor is refused.`,
      );
    }
    if (mutation.predecessorFileRevision !== existing.headRevision) {
      workspaceError(
        "predecessor_mismatch",
        `File ${mutation.fileId} predecessor must be the unique active revision ${existing.headRevision}.`,
      );
    }
  } else if (mutation.predecessorFileRevision !== undefined) {
    workspaceError(
      "predecessor_mismatch",
      `File ${mutation.fileId} has no active revision; predecessor must be absent.`,
    );
  }
  const fileRevision = mutation.predecessorFileRevision
    ? mutation.predecessorFileRevision + 1
    : 1;
  const content: Omit<ProjectSourceFileRevision, "fingerprint"> = {
    kind: "content",
    fileId: mutation.fileId,
    fileRevision,
    moduleId: mutation.moduleId,
    logicalName: mutation.logicalName,
    role: mutation.role,
    dependencies: mutation.dependencies,
    resourceRef: mutation.resourceRef,
    ...(mutation.predecessorFileRevision !== undefined
      ? { predecessorFileRevision: mutation.predecessorFileRevision }
      : {}),
    ...(mutation.captureRequest ? { captureRequest: mutation.captureRequest } : {}),
  };
  const record: ProjectSourceFileRevision = {
    ...content,
    fingerprint: await sha256Fingerprint(content),
  };
  assertLogicalNameUnique(
    state.files,
    mutation.fileId,
    mutation.moduleId,
    mutation.logicalName,
  );
  assertDependenciesExist(state, mutation);
  const files = new Map(state.files);
  const revisions = new Map(existing?.revisions ?? []);
  revisions.set(fileRevision, record);
  files.set(mutation.fileId, {
    fileId: mutation.fileId,
    headRevision: fileRevision,
    status: "active",
    revisions,
  });
  const next = { ...state, files };
  assertDependencyAcyclic(next);
  assertUniqueDerivedPaths(next);
  return next;
}

async function applyFileRemove(
  state: ProjectSourceWorkspaceState,
  mutation: { fileId: string; activeFileRevision: number },
): Promise<ProjectSourceWorkspaceState> {
  const existing = state.files.get(mutation.fileId);
  if (!existing || existing.status !== "active") {
    workspaceError(
      "file_not_found",
      `File ${mutation.fileId} is not active in the workspace.`,
    );
  }
  if (existing.headRevision !== mutation.activeFileRevision) {
    workspaceError(
      "predecessor_mismatch",
      `File ${mutation.fileId} remove must name the unique active revision ${existing.headRevision}.`,
    );
  }
  const fileRevision = mutation.activeFileRevision + 1;
  const tombstoneBody: Omit<ProjectSourceFileTombstone, "fingerprint"> = {
    kind: "tombstone",
    fileId: mutation.fileId,
    fileRevision,
    predecessorFileRevision: mutation.activeFileRevision,
  };
  const tombstone: ProjectSourceFileTombstone = {
    ...tombstoneBody,
    fingerprint: await sha256Fingerprint(tombstoneBody),
  };
  const files = new Map(state.files);
  const revisions = new Map(existing.revisions);
  revisions.set(fileRevision, tombstone);
  files.set(mutation.fileId, {
    fileId: mutation.fileId,
    headRevision: fileRevision,
    status: "removed",
    revisions,
  });
  return { ...state, files };
}

function assertDependenciesExist(
  state: ProjectSourceWorkspaceState,
  mutation: ProjectSourceFilePut,
): void {
  for (const ref of mutation.dependencies) {
    const target = state.files.get(ref.fileId);
    const record = target?.revisions.get(ref.fileRevision);
    if (!record || record.kind !== "content") {
      workspaceError(
        "file_not_found",
        `Dependency ${ref.fileId}@${ref.fileRevision} is not a content revision in this project.`,
      );
    }
  }
}

function revisionNode(fileId: string, fileRevision: number): string {
  return `${fileId}@${fileRevision}`;
}

function assertDependencyAcyclic(state: ProjectSourceWorkspaceState): void {
  const edges = new Map<string, string[]>();
  for (const file of state.files.values()) {
    for (const record of file.revisions.values()) {
      if (record.kind !== "content") continue;
      edges.set(
        revisionNode(file.fileId, record.fileRevision),
        record.dependencies.map((item) => revisionNode(item.fileId, item.fileRevision)),
      );
    }
  }
  if (dependencyGraphHasCycle(edges)) {
    workspaceError("dependency_cycle", "File dependency graph is cyclic.");
  }
}

function assertMutationPayloadBound(mutation: ProjectSourceWorkspaceMutation): void {
  const json = deterministicJson(mutation);
  if (json.length > BOUNDS.maxMutationJsonBytes) {
    workspaceError(
      "bound_exceeded",
      `Mutation payload exceeds ${BOUNDS.maxMutationJsonBytes} bytes.`,
    );
  }
}

function freezeState(state: ProjectSourceWorkspaceState): ProjectSourceWorkspaceState {
  return deepFreeze({
    projectId: state.projectId,
    workspaceRevision: state.workspaceRevision,
    ...(state.lastEventFingerprint
      ? { lastEventFingerprint: state.lastEventFingerprint }
      : {}),
    modules: state.modules,
    files: state.files,
    mutations: state.mutations,
  });
}

export function cloneProjectSourceWorkspaceState(
  state: ProjectSourceWorkspaceState,
): ProjectSourceWorkspaceState {
  const files = new Map(
    [...state.files.entries()].map(([fileId, file]) => [fileId, {
      fileId: file.fileId,
      headRevision: file.headRevision,
      status: file.status,
      revisions: new Map(file.revisions),
    }]),
  );
  return freezeState({
    projectId: state.projectId,
    workspaceRevision: state.workspaceRevision,
    ...(state.lastEventFingerprint
      ? { lastEventFingerprint: state.lastEventFingerprint }
      : {}),
    modules: new Map(state.modules),
    files,
    mutations: new Map(state.mutations),
  });
}

export function contentRevisionAt(
  state: ProjectSourceWorkspaceState,
  fileId: string,
  fileRevision: number,
): ProjectSourceFileRevisionRecord {
  const file = state.files.get(fileId);
  const record = file?.revisions.get(fileRevision);
  if (!record) {
    workspaceError(
      "revision_not_found",
      `File ${fileId}@${fileRevision} is not present at this workspace revision.`,
    );
  }
  return record;
}
