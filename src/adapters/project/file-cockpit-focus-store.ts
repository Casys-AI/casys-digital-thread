import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { CockpitFocusStore } from "../../application/ports/out/project/cockpit-focus-store.ts";

import {
  type CockpitFocusSnapshot,
  validateCockpitFocusSnapshot,
} from "../../domain/project/cockpit-focus.ts";

export class CockpitFocusConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CockpitFocusConflictError";
  }
}

/**
 * Append-only focus history. The newest fully published revision is the
 * active target, while a stranded claim fails closed instead of silently
 * showing a prior project after an uncertain agent mutation.
 */
export class FileCockpitFocusStore implements CockpitFocusStore {
  constructor(private readonly directory = "state/local/cockpit-focus") {}

  async get(workspaceId: string): Promise<CockpitFocusSnapshot | undefined> {
    validateWorkspaceId(workspaceId);
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (
        const entry of Deno.readDir(this.workspaceDirectory(workspaceId))
      ) {
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    const names = entries.filter((entry) => entry.isFile).map((entry) => entry.name);
    const highestClaim = highestRevision(names, "claim");
    const highestJson = highestRevision(names, "json");
    if (highestClaim !== undefined && highestClaim > (highestJson ?? 0)) {
      throw new CockpitFocusConflictError(
        `Cockpit focus ${workspaceId} revision ${highestClaim} is claimed but not durably published.`,
      );
    }
    if (highestJson === undefined) return undefined;
    return await this.readRevision(workspaceId, highestJson);
  }

  async select(
    input: CockpitFocusSnapshot,
    expectedRevision: number,
  ): Promise<CockpitFocusSnapshot> {
    const snapshot = validateCockpitFocusSnapshot(input);
    validateWorkspaceId(snapshot.workspaceId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError(
        "expectedRevision must be a non-negative safe integer.",
      );
    }
    const current = await this.get(snapshot.workspaceId);
    const priorCommand = current
      ? await this.findCommand(
        snapshot.workspaceId,
        snapshot.commandId,
        current.revision,
      )
      : undefined;
    if (priorCommand) {
      if (deterministicJson(priorCommand) !== deterministicJson(snapshot)) {
        throw new CockpitFocusConflictError(
          `Cockpit focus command ${snapshot.commandId} was already used with different arguments.`,
        );
      }
      if (priorCommand.revision !== current?.revision) {
        throw new CockpitFocusConflictError(
          `Cockpit focus command ${snapshot.commandId} is already recorded at revision ${priorCommand.revision}; it cannot be reused after later focus revision ${current?.revision}.`,
        );
      }
      return priorCommand;
    }
    if ((current?.revision ?? 0) !== expectedRevision) {
      throw new CockpitFocusConflictError(
        `Cockpit focus ${snapshot.workspaceId} expected revision ${expectedRevision}, current revision is ${
          current?.revision ?? "absent"
        }.`,
      );
    }
    if (snapshot.revision !== expectedRevision + 1) {
      throw new CockpitFocusConflictError(
        `Cockpit focus revision ${snapshot.revision} must follow expected revision ${expectedRevision}.`,
      );
    }
    if (
      expectedRevision === 0
        ? snapshot.previous !== undefined
        : snapshot.previous?.revision !== expectedRevision
    ) {
      throw new CockpitFocusConflictError(
        "Cockpit focus previous revision does not extend the exact current focus.",
      );
    }
    await Deno.mkdir(this.workspaceDirectory(snapshot.workspaceId), {
      recursive: true,
    });
    const claim = this.claimPath(snapshot.workspaceId, snapshot.revision);
    try {
      await Deno.writeTextFile(claim, `${snapshot.commandId}\n`, {
        createNew: true,
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      await this.waitUntilPublished(snapshot.workspaceId, snapshot.revision);
      const published = await this.readRevision(
        snapshot.workspaceId,
        snapshot.revision,
      );
      if (
        published && published.commandId === snapshot.commandId &&
        deterministicJson(published) === deterministicJson(snapshot)
      ) {
        return published;
      }
      throw new CockpitFocusConflictError(
        `Cockpit focus ${snapshot.workspaceId} revision ${snapshot.revision} is already claimed.`,
      );
    }
    const revisionPath = this.revisionPath(
      snapshot.workspaceId,
      snapshot.revision,
    );
    const pending = `${revisionPath}.pending-${crypto.randomUUID()}`;
    await Deno.writeTextFile(pending, `${deterministicJson(snapshot)}\n`, {
      createNew: true,
    });
    await Deno.rename(pending, revisionPath);
    return structuredClone(snapshot);
  }

  private async readRevision(
    workspaceId: string,
    revision: number,
  ): Promise<CockpitFocusSnapshot | undefined> {
    try {
      const snapshot = validateCockpitFocusSnapshot(JSON.parse(
        await Deno.readTextFile(this.revisionPath(workspaceId, revision)),
      ));
      if (
        snapshot.workspaceId !== workspaceId || snapshot.revision !== revision
      ) {
        throw new Error(
          `Cockpit focus path ${workspaceId}@${revision} contains a different snapshot.`,
        );
      }
      return structuredClone(snapshot);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async findCommand(
    workspaceId: string,
    commandId: string,
    highestRevision: number,
  ): Promise<CockpitFocusSnapshot | undefined> {
    for (let revision = 1; revision <= highestRevision; revision++) {
      const raw = await this.readRawRevision(workspaceId, revision);
      if (raw === undefined) continue;
      if (
        typeof raw !== "object" || raw === null || Array.isArray(raw) ||
        typeof (raw as Record<string, unknown>).commandId !== "string"
      ) {
        throw new CockpitFocusConflictError(
          `Cockpit focus ${workspaceId} revision ${revision} is malformed.`,
        );
      }
      if ((raw as Record<string, unknown>).commandId !== commandId) continue;
      try {
        return validateCockpitFocusSnapshot(raw);
      } catch {
        throw new CockpitFocusConflictError(
          `Cockpit focus command ${commandId} belongs to an unsupported historical focus revision and cannot be reused.`,
        );
      }
    }
    return undefined;
  }

  private async readRawRevision(
    workspaceId: string,
    revision: number,
  ): Promise<unknown | undefined> {
    try {
      return JSON.parse(
        await Deno.readTextFile(this.revisionPath(workspaceId, revision)),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private async waitUntilPublished(
    workspaceId: string,
    revision: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await this.readRevision(workspaceId, revision)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }
  }

  private workspaceDirectory(workspaceId: string): string {
    return `${this.directory}/${encodeURIComponent(workspaceId)}`;
  }

  private revisionPath(workspaceId: string, revision: number): string {
    return `${this.workspaceDirectory(workspaceId)}/${
      String(revision).padStart(10, "0")
    }.json`;
  }

  private claimPath(workspaceId: string, revision: number): string {
    return `${this.workspaceDirectory(workspaceId)}/${
      String(revision).padStart(10, "0")
    }.claim`;
  }
}

function highestRevision(
  names: readonly string[],
  extension: "json" | "claim",
): number | undefined {
  const revisions = names.filter((name) =>
    new RegExp(`^\\d{10}\\.${extension}$`).test(name)
  ).map((name) => Number(name.slice(0, 10)));
  return revisions.length > 0 ? Math.max(...revisions) : undefined;
}

function validateWorkspaceId(workspaceId: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(workspaceId) ||
    workspaceId.toLowerCase() === "latest"
  ) {
    throw new TypeError("workspaceId must be a concrete non-alias identity.");
  }
}
