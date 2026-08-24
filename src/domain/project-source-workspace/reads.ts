/**
 * Revision-anchored navigation. Cursors bind revision, filter and sort key.
 */

import {
  closedRecord,
  deepFreeze,
  literalValue,
  positiveInteger,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import {
  PROJECT_SOURCE_WORKSPACE_SNAPSHOT_SCHEMA,
  type ProjectSourceFileRead,
  type ProjectSourceFileReadQuery,
  type ProjectSourcePage,
  type ProjectSourceSearchHit,
  type ProjectSourceSearchQuery,
  type ProjectSourceTreeEntry,
  type ProjectSourceTreeQuery,
  type ProjectSourceWorkspaceSnapshot,
  type ProjectSourceWorkspaceState,
} from "./types.ts";
import { contentRevisionAt } from "./transitions.ts";
import {
  derivedFilePath,
  derivedModulePath,
  parseClassification,
  parseLogicalName,
  parsePageSize,
  parseProjectId,
  parseWorkspaceRevision,
  workspaceError,
} from "./validation.ts";

interface TreeCursor {
  readonly kind: "tree";
  readonly workspaceRevision: number;
  readonly moduleId: string | null;
  readonly after?: { readonly kind: "module" | "file"; readonly id: string };
}

interface SearchCursor {
  readonly kind: "search";
  readonly workspaceRevision: number;
  readonly filter: SearchFilter;
  readonly after?: { readonly derivedPath: string; readonly fileId: string };
}

interface SearchFilter {
  readonly pathPrefix?: string;
  readonly moduleId?: string;
  readonly domain?: string;
  readonly role?: string;
  readonly profileId?: string;
  readonly sourceId?: string;
}

export function projectSourceWorkspaceSnapshot(
  state: ProjectSourceWorkspaceState,
): ProjectSourceWorkspaceSnapshot {
  const rootModuleIds = [...state.modules.values()]
    .filter((module) => module.parentModuleId === undefined)
    .map((module) => module.moduleId)
    .sort();
  let activeFileCount = 0;
  for (const file of state.files.values()) {
    if (file.status === "active") activeFileCount += 1;
  }
  return deepFreeze({
    schemaVersion: PROJECT_SOURCE_WORKSPACE_SNAPSHOT_SCHEMA,
    projectId: state.projectId,
    workspaceRevision: state.workspaceRevision,
    lastEventFingerprint: state.lastEventFingerprint ?? null,
    rootModuleIds,
    moduleCount: state.modules.size,
    activeFileCount,
    grants: "none",
  });
}

export function projectSourceWorkspaceTreePage(
  state: ProjectSourceWorkspaceState,
  query: ProjectSourceTreeQuery,
): ProjectSourcePage<ProjectSourceTreeEntry> {
  assertExactRevision(state, query.workspaceRevision);
  const moduleId = query.moduleId === undefined
    ? undefined
    : parseProjectId(query.moduleId, "$query.moduleId");
  if (moduleId && !state.modules.has(moduleId)) {
    workspaceError("module_not_found", `Module ${moduleId} is not in the workspace.`);
  }
  const pageSize = parsePageSize(query.pageSize, "$query.pageSize");
  const cursor = query.cursor
    ? decodeTreeCursor(query.cursor, query.workspaceRevision, moduleId ?? null)
    : undefined;
  const entries = collectTreeEntries(state, moduleId);
  const start = cursor?.after
    ? entries.findIndex((entry) =>
      entry.kind === cursor.after!.kind && entry.id === cursor.after!.id
    ) + 1
    : 0;
  if (cursor?.after && start === 0) {
    workspaceError("cursor_mismatch", "Tree cursor sort key is not in this page set.");
  }
  const page = entries.slice(start, start + pageSize);
  const last = page.at(-1);
  const exhausted = start + page.length >= entries.length;
  const nextCursor = exhausted || !last ? null : encodeCursor({
    kind: "tree",
    workspaceRevision: query.workspaceRevision,
    moduleId: moduleId ?? null,
    after: { kind: last.kind, id: last.id },
  });
  return deepFreeze({
    workspaceRevision: query.workspaceRevision,
    entries: page,
    nextCursor,
    grants: "none",
  });
}

export function projectSourceWorkspaceSearchPage(
  state: ProjectSourceWorkspaceState,
  query: ProjectSourceSearchQuery,
): ProjectSourcePage<ProjectSourceSearchHit> {
  assertExactRevision(state, query.workspaceRevision);
  const filter = parseSearchFilter(query);
  const pageSize = parsePageSize(query.pageSize, "$query.pageSize");
  const cursor = query.cursor
    ? decodeSearchCursor(query.cursor, query.workspaceRevision, filter)
    : undefined;
  const hits = collectSearchHits(state, filter);
  const start = cursor?.after
    ? hits.findIndex((hit) =>
      hit.derivedPath === cursor.after!.derivedPath &&
      hit.fileId === cursor.after!.fileId
    ) + 1
    : 0;
  if (cursor?.after && start === 0) {
    workspaceError(
      "cursor_mismatch",
      "Search cursor sort key is not in this page set.",
    );
  }
  const page = hits.slice(start, start + pageSize);
  const last = page.at(-1);
  const exhausted = start + page.length >= hits.length;
  const nextCursor = exhausted || !last ? null : encodeCursor({
    kind: "search",
    workspaceRevision: query.workspaceRevision,
    filter,
    after: { derivedPath: last.derivedPath, fileId: last.fileId },
  });
  return deepFreeze({
    workspaceRevision: query.workspaceRevision,
    entries: page,
    nextCursor,
    grants: "none",
  });
}

export function projectSourceWorkspaceFileRead(
  state: ProjectSourceWorkspaceState,
  query: ProjectSourceFileReadQuery,
): ProjectSourceFileRead {
  assertExactRevision(state, query.workspaceRevision);
  const fileId = parseProjectId(query.fileId, "$query.fileId");
  const fileRevision = positiveInteger(query.fileRevision, "$query.fileRevision");
  const record = contentRevisionAt(state, fileId, fileRevision);
  const derivedPath = record.kind === "content"
    ? derivedFilePath(state.modules, record.moduleId, record.logicalName)
    : null;
  return deepFreeze({
    workspaceRevision: query.workspaceRevision,
    derivedPath,
    record,
    grants: "none",
  });
}

function collectTreeEntries(
  state: ProjectSourceWorkspaceState,
  parentModuleId: string | undefined,
): ProjectSourceTreeEntry[] {
  const modules = [...state.modules.values()]
    .filter((module) => module.parentModuleId === parentModuleId)
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((module) => {
      const derivedPath = parentModuleId
        ? `${derivedModulePath(state.modules, parentModuleId)}/${module.slug}`
        : `/${module.slug}`;
      return {
        kind: "module" as const,
        id: module.moduleId,
        name: module.slug,
        derivedPath,
        ...(module.domain ? { domain: module.domain } : {}),
      };
    });
  const files = parentModuleId === undefined ? [] : [...state.files.values()]
    .filter((file) => file.status === "active")
    .map((file) => {
      const head = file.revisions.get(file.headRevision);
      if (!head || head.kind !== "content") return undefined;
      if (head.moduleId !== parentModuleId) return undefined;
      return {
        kind: "file" as const,
        id: file.fileId,
        name: head.logicalName,
        derivedPath: derivedFilePath(state.modules, head.moduleId, head.logicalName),
        role: head.role,
        fileRevision: head.fileRevision,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
  return [...modules, ...files];
}

function collectSearchHits(
  state: ProjectSourceWorkspaceState,
  filter: SearchFilter,
): ProjectSourceSearchHit[] {
  const hits: ProjectSourceSearchHit[] = [];
  for (const file of state.files.values()) {
    if (file.status !== "active") continue;
    const head = file.revisions.get(file.headRevision);
    if (!head || head.kind !== "content") continue;
    const module = state.modules.get(head.moduleId);
    if (!module) continue;
    const derivedPath = derivedFilePath(
      state.modules,
      head.moduleId,
      head.logicalName,
    );
    if (filter.pathPrefix && !derivedPath.startsWith(filter.pathPrefix)) continue;
    if (filter.moduleId && head.moduleId !== filter.moduleId) continue;
    if (filter.domain && module.domain !== filter.domain) continue;
    if (filter.role && head.role !== filter.role) continue;
    if (
      filter.profileId &&
      head.captureRequest?.profileId !== filter.profileId
    ) {
      continue;
    }
    if (filter.sourceId && head.captureRequest?.sourceId !== filter.sourceId) {
      continue;
    }
    hits.push({
      fileId: file.fileId,
      fileRevision: head.fileRevision,
      moduleId: head.moduleId,
      logicalName: head.logicalName,
      derivedPath,
      role: head.role,
      fingerprint: head.fingerprint,
      ...(module.domain ? { domain: module.domain } : {}),
      ...(head.captureRequest ? { captureRequest: head.captureRequest } : {}),
    });
  }
  return hits.sort((left, right) => {
    const byPath = left.derivedPath.localeCompare(right.derivedPath);
    return byPath !== 0 ? byPath : left.fileId.localeCompare(right.fileId);
  });
}

function parseSearchFilter(query: ProjectSourceSearchQuery): SearchFilter {
  const filter: SearchFilter = {};
  if (query.pathPrefix !== undefined) {
    const prefix = query.pathPrefix;
    if (typeof prefix !== "string" || prefix.length === 0 || prefix[0] !== "/") {
      workspaceError(
        "invalid_request",
        "$query.pathPrefix must be a derived POSIX path prefix starting with '/'.",
      );
    }
    if (prefix.includes("..")) {
      workspaceError("invalid_request", "$query.pathPrefix must not contain '..'.");
    }
    (filter as { pathPrefix: string }).pathPrefix = prefix;
  }
  if (query.moduleId !== undefined) {
    (filter as { moduleId: string }).moduleId = parseProjectId(
      query.moduleId,
      "$query.moduleId",
    );
  }
  if (query.domain !== undefined) {
    (filter as { domain: string }).domain = parseClassification(
      query.domain,
      "$query.domain",
    );
  }
  if (query.role !== undefined) {
    (filter as { role: string }).role = parseClassification(
      query.role,
      "$query.role",
    );
  }
  if (query.profileId !== undefined) {
    (filter as { profileId: string }).profileId = parseProjectId(
      query.profileId,
      "$query.profileId",
    );
  }
  if (query.sourceId !== undefined) {
    (filter as { sourceId: string }).sourceId = parseProjectId(
      query.sourceId,
      "$query.sourceId",
    );
  }
  return filter;
}

function decodeTreeCursor(
  cursor: string,
  workspaceRevision: number,
  moduleId: string | null,
): TreeCursor {
  const decoded = decodeCursor(cursor);
  const rec = closedRecord(
    decoded,
    ["kind", "workspaceRevision", "moduleId", "after"],
    ["kind", "workspaceRevision", "moduleId"],
    "$cursor",
  );
  literalValue(rec.kind, "tree", "$cursor.kind");
  const cursorRevision = parseWorkspaceRevision(
    rec.workspaceRevision,
    "$cursor.workspaceRevision",
  );
  const cursorModuleId = rec.moduleId === null
    ? null
    : parseProjectId(rec.moduleId, "$cursor.moduleId");
  if (cursorRevision !== workspaceRevision || cursorModuleId !== moduleId) {
    workspaceError(
      "cursor_mismatch",
      "Tree cursor does not match the requested workspace revision and module filter.",
    );
  }
  let after: TreeCursor["after"];
  if (Object.hasOwn(rec, "after")) {
    const afterRec = closedRecord(
      rec.after,
      ["kind", "id"],
      ["kind", "id"],
      "$cursor.after",
    );
    if (afterRec.kind !== "module" && afterRec.kind !== "file") {
      workspaceError("cursor_mismatch", "$cursor.after.kind is not a tree sort key.");
    }
    after = {
      kind: afterRec.kind,
      id: parseProjectId(afterRec.id, "$cursor.after.id"),
    };
  }
  return { kind: "tree", workspaceRevision, moduleId, ...(after ? { after } : {}) };
}

function decodeSearchCursor(
  cursor: string,
  workspaceRevision: number,
  filter: SearchFilter,
): SearchCursor {
  const decoded = decodeCursor(cursor);
  const rec = closedRecord(
    decoded,
    ["kind", "workspaceRevision", "filter", "after"],
    ["kind", "workspaceRevision", "filter"],
    "$cursor",
  );
  literalValue(rec.kind, "search", "$cursor.kind");
  const cursorRevision = parseWorkspaceRevision(
    rec.workspaceRevision,
    "$cursor.workspaceRevision",
  );
  if (cursorRevision !== workspaceRevision) {
    workspaceError(
      "cursor_mismatch",
      "Search cursor does not match the requested workspace revision.",
    );
  }
  if (deterministicJson(rec.filter) !== deterministicJson(filter)) {
    workspaceError(
      "cursor_mismatch",
      "Search cursor does not match the requested filter.",
    );
  }
  let after: SearchCursor["after"];
  if (Object.hasOwn(rec, "after")) {
    const afterRec = closedRecord(
      rec.after,
      ["derivedPath", "fileId"],
      ["derivedPath", "fileId"],
      "$cursor.after",
    );
    after = {
      derivedPath: parsePathKey(afterRec.derivedPath, "$cursor.after.derivedPath"),
      fileId: parseProjectId(afterRec.fileId, "$cursor.after.fileId"),
    };
  }
  return {
    kind: "search",
    workspaceRevision,
    filter,
    ...(after ? { after } : {}),
  };
}

function parsePathKey(value: unknown, path: string): string {
  if (typeof value !== "string" || value[0] !== "/") {
    workspaceError("cursor_mismatch", `${path} is not a derived path.`);
  }
  parseLogicalName(value.slice(value.lastIndexOf("/") + 1) || value, path);
  return value;
}

function encodeCursor(value: TreeCursor | SearchCursor): string {
  return btoa(deterministicJson(value));
}

function decodeCursor(value: string): unknown {
  try {
    return JSON.parse(atob(value));
  } catch {
    workspaceError(
      "cursor_mismatch",
      "Workspace page cursor is not a valid opaque cursor.",
    );
  }
}

function assertExactRevision(
  state: ProjectSourceWorkspaceState,
  workspaceRevision: number,
): void {
  parseWorkspaceRevision(workspaceRevision, "$query.workspaceRevision");
  if (workspaceRevision !== state.workspaceRevision) {
    workspaceError(
      "revision_not_found",
      `Read is not anchored at workspace revision ${workspaceRevision}.`,
    );
  }
}
