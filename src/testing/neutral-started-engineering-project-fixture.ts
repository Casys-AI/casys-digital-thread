import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../application/ports/out/engineering-project-revision-store.ts";
import { ProjectBriefCommandService } from "../application/use-cases/project/project-brief-command-service.ts";

export const NEUTRAL_PROJECT_ID = "neutral-system-ns01";
export const NEUTRAL_PROJECT_NAME = "Neutral engineering system";
export const NEUTRAL_PROJECT_CLOCK = "2026-08-01T14:00:00.000Z";

const NEUTRAL_START_AGENT = {
  kind: "agent" as const,
  actorId: "agent:neutral-fixture",
};

/**
 * Valid revision-1 seed: `project_start` from reported intent only.
 * It is not a review, plan, or technical work-item fixture.
 */
export async function createNeutralStartedProject(): Promise<
  EngineeringProjectSnapshot
> {
  const store = new MemoryProjectStore();
  const service = new ProjectBriefCommandService(
    store,
    () => NEUTRAL_PROJECT_CLOCK,
  );
  return await service.startProject(NEUTRAL_START_AGENT, {
    commandId: "start-neutral-system",
    projectId: NEUTRAL_PROJECT_ID,
    projectName: NEUTRAL_PROJECT_NAME,
    issuedAt: "2026-08-01T13:59:00.000Z",
    intent: "Exercise the project control boundary without a product-specific fixture.",
    intentSource: {
      kind: "human",
      reference: "conversation:neutral-registry-test",
    },
  });
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((snapshot) => snapshot.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Stale revision.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
