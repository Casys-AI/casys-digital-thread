/**
 * Durable append-only workspace events. One bounded event per revision.
 * Claim/publish is fail-closed; the in-memory index is rebuilt from the log.
 */

import type {
  ProjectSourceWorkspaceEventStore,
} from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  ProjectSourceWorkspaceStoreError,
} from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  applyProjectSourceWorkspaceEvent,
  cloneProjectSourceWorkspaceState,
  emptyProjectSourceWorkspace,
  eventChainFingerprintsEqual,
  replayProjectSourceWorkspaceEvents,
} from "../../domain/project-source-workspace/transitions.ts";
import {
  PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA,
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceEvent,
  type ProjectSourceWorkspaceEventV4,
  type ProjectSourceWorkspaceState,
} from "../../domain/project-source-workspace/types.ts";
import {
  parseProjectId,
  parseWorkspaceEvent,
} from "../../domain/project-source-workspace/validation.ts";

export interface ProjectSourceWorkspaceRevisionFileEntry {
  readonly name: string;
  readonly isFile: boolean;
}

export interface ProjectSourceWorkspaceRevisionFileIo {
  mkdir(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFileCreateNew(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readDir(path: string): AsyncIterable<ProjectSourceWorkspaceRevisionFileEntry>;
}

const DENO_FILE_IO: ProjectSourceWorkspaceRevisionFileIo = {
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFileCreateNew: (path, contents) =>
    Deno.writeTextFile(path, contents, { createNew: true }),
  rename: (from, to) => Deno.rename(from, to),
  readDir: async function* (path) {
    for await (const entry of Deno.readDir(path)) {
      yield { name: entry.name, isFile: entry.isFile };
    }
  },
};

interface CachedWorkspace {
  readonly events: readonly ProjectSourceWorkspaceEvent[];
  readonly state: ProjectSourceWorkspaceState;
}

interface LogCensus {
  readonly highestJson: number;
  readonly highestClaim: number;
  readonly jsonCount: number;
}

export class FileProjectSourceWorkspaceStore
  implements ProjectSourceWorkspaceEventStore {
  readonly #cache = new Map<string, CachedWorkspace>();

  constructor(
    private readonly directory = "state/local/project-source-workspaces",
    private readonly io: ProjectSourceWorkspaceRevisionFileIo = DENO_FILE_IO,
  ) {}

  async load(projectId: string): Promise<ProjectSourceWorkspaceState> {
    const cached = await this.loadCache(projectId);
    return cloneProjectSourceWorkspaceState(cached.state);
  }

  async loadAt(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceState> {
    const cached = await this.loadCache(projectId);
    if (workspaceRevision === cached.state.workspaceRevision) {
      return cloneProjectSourceWorkspaceState(cached.state);
    }
    if (workspaceRevision === 0) {
      return emptyProjectSourceWorkspace(parseProjectId(projectId));
    }
    if (
      workspaceRevision < 0 ||
      workspaceRevision > cached.state.workspaceRevision
    ) {
      throw new ProjectSourceWorkspaceError(
        "revision_not_found",
        `Workspace revision ${workspaceRevision} is not present for project ${projectId}.`,
      );
    }
    return cloneProjectSourceWorkspaceState(
      await replayProjectSourceWorkspaceEvents(
        parseProjectId(projectId),
        cached.events.slice(0, workspaceRevision),
      ),
    );
  }

  async loadAtFresh(
    projectId: string,
    workspaceRevision: number,
  ): Promise<ProjectSourceWorkspaceState> {
    const id = parseProjectId(projectId);
    if (workspaceRevision === 0) {
      return emptyProjectSourceWorkspace(id);
    }
    if (!Number.isSafeInteger(workspaceRevision) || workspaceRevision < 0) {
      throw new ProjectSourceWorkspaceError(
        "revision_not_found",
        `Workspace revision ${workspaceRevision} is not present for project ${projectId}.`,
      );
    }
    const events: ProjectSourceWorkspaceEvent[] = [];
    for (let revision = 1; revision <= workspaceRevision; revision += 1) {
      const event = await this.readEventFile(id, revision);
      if (!event) {
        if (revision === workspaceRevision && events.length === revision - 1) {
          throw new ProjectSourceWorkspaceError(
            "revision_not_found",
            `Workspace revision ${workspaceRevision} is not present for project ${projectId}.`,
          );
        }
        throw new ProjectSourceWorkspaceStoreError(
          "log_gap",
          `Project source workspace ${projectId} event log is missing revision ${revision}.`,
        );
      }
      events.push(event);
    }
    return cloneProjectSourceWorkspaceState(
      await this.replayOrCorrupt(id, events),
    );
  }

  async append(event: ProjectSourceWorkspaceEventV4): Promise<void> {
    // TypeScript callers receive the V4-only writer signature; retain this
    // runtime guard for untyped callers so V3 cannot become a new durable write.
    if (
      (event as ProjectSourceWorkspaceEvent).schemaVersion !==
        PROJECT_SOURCE_WORKSPACE_EVENT_SCHEMA
    ) {
      throw new ProjectSourceWorkspaceError(
        "invalid_request",
        "Only project-source-workspace-event/4.0 events may be appended; V3 is replay-only.",
      );
    }
    const projectId = parseProjectId(event.projectId);
    await this.io.mkdir(this.projectDirectory(projectId));
    const census = await this.readCensus(projectId);
    this.assertCensusHealthy(projectId, census);
    // Mutation authority ignores any cached materialization. Census/gap
    // checks already ran; fully replay the durable head before accepting a
    // successor, then drop the cache so publication cannot retain stale
    // historical events.
    this.#cache.delete(projectId);
    const currentState = census.highestJson === 0
      ? emptyProjectSourceWorkspace(projectId)
      : await this.loadAtFresh(projectId, census.highestJson);
    try {
      await applyProjectSourceWorkspaceEvent(currentState, event);
    } catch (cause) {
      if (cause instanceof ProjectSourceWorkspaceStoreError) throw cause;
      if (cause instanceof ProjectSourceWorkspaceError) throw cause;
      throw new ProjectSourceWorkspaceStoreError(
        "corrupt_log",
        `Workspace event ${event.workspaceRevision} is not a valid successor for ${projectId}.`,
      );
    }
    if (event.workspaceRevision === 1) {
      if (event.previousEventFingerprint !== null) {
        throw new ProjectSourceWorkspaceError(
          "event_chain_mismatch",
          "Workspace revision 1 requires previousEventFingerprint null.",
        );
      }
    } else {
      const previous = await this.readEventFile(
        projectId,
        event.workspaceRevision - 1,
      );
      if (!previous) {
        throw new ProjectSourceWorkspaceStoreError(
          "log_gap",
          `Workspace event ${event.workspaceRevision} cannot be published without predecessor ${
            event.workspaceRevision - 1
          }.`,
        );
      }
      if (
        !eventChainFingerprintsEqual(
          event.previousEventFingerprint,
          previous.fingerprint,
        )
      ) {
        throw new ProjectSourceWorkspaceError(
          "event_chain_mismatch",
          `Workspace event ${event.workspaceRevision} previousEventFingerprint does not match durable predecessor ${previous.workspaceRevision}.`,
        );
      }
    }
    const claimPath = this.claimPath(projectId, event.workspaceRevision);
    try {
      await this.io.writeTextFileCreateNew(claimPath, `${event.mutationId}\n`);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.waitUntilPublished(projectId, event.workspaceRevision);
      throw new ProjectSourceWorkspaceStoreError(
        "cas_conflict",
        `Project source workspace ${projectId} revision ${event.workspaceRevision} is already claimed.`,
      );
    }
    const revisionPath = this.revisionPath(projectId, event.workspaceRevision);
    const pendingPath = `${revisionPath}.pending-${crypto.randomUUID()}`;
    await this.io.writeTextFileCreateNew(
      pendingPath,
      `${deterministicJson(event)}\n`,
    );
    await this.io.rename(pendingPath, revisionPath);
  }

  private async loadCache(projectId: string): Promise<CachedWorkspace> {
    const id = parseProjectId(projectId);
    const census = await this.readCensus(id);
    this.assertCensusHealthy(id, census);
    const cached = this.#cache.get(id);
    if (cached) {
      return await this.refreshCache(id, cached, census);
    }
    const events = await this.readEventRange(id, 1, census.highestJson);
    const state = await this.replayOrCorrupt(id, events);
    const next = { events, state };
    this.#cache.set(id, next);
    return next;
  }

  private async refreshCache(
    projectId: string,
    cached: CachedWorkspace,
    census: LogCensus,
  ): Promise<CachedWorkspace> {
    if (census.highestJson < cached.state.workspaceRevision) {
      throw new ProjectSourceWorkspaceStoreError(
        "corrupt_log",
        `Project source workspace ${projectId} cached head ${cached.state.workspaceRevision} is ahead of durable revision ${census.highestJson}.`,
      );
    }
    if (census.highestJson === cached.state.workspaceRevision) {
      if (census.highestJson > 0) {
        const head = await this.readEventFile(projectId, census.highestJson);
        if (
          !head ||
          head.fingerprint.digest !== cached.state.lastEventFingerprint?.digest
        ) {
          throw new ProjectSourceWorkspaceStoreError(
            "corrupt_log",
            `Project source workspace ${projectId} cached head does not match durable revision ${census.highestJson}.`,
          );
        }
      }
      return cached;
    }
    let state = cached.state;
    const events = [...cached.events];
    for (
      let revision = cached.state.workspaceRevision + 1;
      revision <= census.highestJson;
      revision += 1
    ) {
      const event = await this.readEventFile(projectId, revision);
      if (!event) {
        throw new ProjectSourceWorkspaceStoreError(
          "log_gap",
          `Project source workspace ${projectId} event log is missing revision ${revision}.`,
        );
      }
      try {
        state = await applyProjectSourceWorkspaceEvent(state, event);
      } catch (cause) {
        if (cause instanceof ProjectSourceWorkspaceStoreError) throw cause;
        throw new ProjectSourceWorkspaceStoreError(
          "corrupt_log",
          `Project source workspace ${projectId} event log is not a valid workspace history.`,
        );
      }
      events.push(event);
    }
    const next = { events, state };
    this.#cache.set(projectId, next);
    return next;
  }

  private async readCensus(projectId: string): Promise<LogCensus> {
    const entries: ProjectSourceWorkspaceRevisionFileEntry[] = [];
    try {
      for await (const entry of this.io.readDir(this.projectDirectory(projectId))) {
        entries.push(entry);
      }
    } catch (error) {
      if (isNotFound(error)) {
        return { highestJson: 0, highestClaim: 0, jsonCount: 0 };
      }
      throw error;
    }
    const numbered = entries.filter((entry) =>
      entry.isFile && /^\d{10}\.(?:json|claim)$/.test(entry.name)
    );
    const jsonCount = numbered.filter((entry) => entry.name.endsWith(".json")).length;
    return {
      highestJson: highestRevision(numbered, "json") ?? 0,
      highestClaim: highestRevision(numbered, "claim") ?? 0,
      jsonCount,
    };
  }

  private assertCensusHealthy(projectId: string, census: LogCensus): void {
    if (census.highestClaim > census.highestJson) {
      throw new ProjectSourceWorkspaceStoreError(
        "incomplete_claim",
        `Project source workspace ${projectId} revision ${census.highestClaim} is claimed but not durably published.`,
      );
    }
    if (census.highestJson > 0 && census.jsonCount !== census.highestJson) {
      throw new ProjectSourceWorkspaceStoreError(
        "log_gap",
        `Project source workspace ${projectId} event log has a gap before revision ${census.highestJson}.`,
      );
    }
  }

  private async readEventRange(
    projectId: string,
    fromRevision: number,
    toRevision: number,
  ): Promise<readonly ProjectSourceWorkspaceEvent[]> {
    if (toRevision < fromRevision || toRevision === 0) return [];
    const events: ProjectSourceWorkspaceEvent[] = [];
    for (let revision = fromRevision; revision <= toRevision; revision += 1) {
      const event = await this.readEventFile(projectId, revision);
      if (!event) {
        throw new ProjectSourceWorkspaceStoreError(
          "log_gap",
          `Project source workspace ${projectId} event log is missing revision ${revision}.`,
        );
      }
      events.push(event);
    }
    return events;
  }

  private async replayOrCorrupt(
    projectId: string,
    events: readonly ProjectSourceWorkspaceEvent[],
  ): Promise<ProjectSourceWorkspaceState> {
    try {
      return await replayProjectSourceWorkspaceEvents(projectId, events);
    } catch (cause) {
      if (cause instanceof ProjectSourceWorkspaceStoreError) throw cause;
      throw new ProjectSourceWorkspaceStoreError(
        "corrupt_log",
        `Project source workspace ${projectId} event log is not a valid workspace history.`,
      );
    }
  }

  private async readEventFile(
    projectId: string,
    revision: number,
  ): Promise<ProjectSourceWorkspaceEvent | undefined> {
    try {
      const raw = JSON.parse(
        await this.io.readTextFile(this.revisionPath(projectId, revision)),
      );
      const event = parseWorkspaceEvent(raw);
      if (event.projectId !== projectId || event.workspaceRevision !== revision) {
        throw new ProjectSourceWorkspaceStoreError(
          "corrupt_log",
          `Workspace event path ${projectId}@${revision} contains ${event.projectId}@${event.workspaceRevision}.`,
        );
      }
      return event;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof ProjectSourceWorkspaceStoreError) throw error;
      throw new ProjectSourceWorkspaceStoreError(
        "corrupt_log",
        `Project source workspace ${projectId} revision ${revision} is corrupt.`,
      );
    }
  }

  private async waitUntilPublished(
    projectId: string,
    revision: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await this.readEventFile(projectId, revision)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
  }

  private projectDirectory(projectId: string): string {
    return joinPath(this.directory, encodeURIComponent(projectId));
  }

  private revisionPath(projectId: string, revision: number): string {
    return joinPath(
      this.projectDirectory(projectId),
      `${String(revision).padStart(10, "0")}.json`,
    );
  }

  private claimPath(projectId: string, revision: number): string {
    return joinPath(
      this.projectDirectory(projectId),
      `${String(revision).padStart(10, "0")}.claim`,
    );
  }
}

function highestRevision(
  entries: readonly ProjectSourceWorkspaceRevisionFileEntry[],
  extension: "json" | "claim",
): number | undefined {
  const revisions = entries.filter((entry) => entry.name.endsWith(`.${extension}`))
    .map((entry) => Number(entry.name.slice(0, 10)));
  return revisions.length > 0 ? Math.max(...revisions) : undefined;
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\/$/, "")}/${name}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error &&
      (error.name === "AlreadyExists" || /already exists/i.test(error.message)));
}
