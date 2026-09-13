import { assertEquals } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { persistAgentResourceText } from "../../testing/agent-resource-test-support.ts";
import { PrepareProjectDocumentaryClauseResponseReview } from "./capture-backed-documentary-clause-response-reviewer.ts";
import { createDocumentaryClauseResponseStore } from "./documentary-clause-response-store.ts";

const AT = "2026-09-13T12:00:00.000Z";

Deno.test("source-backed exclusion review compiles parameters without inventing a requirement", async () => {
  const root = await Deno.makeTempDir({ prefix: "clause-response-review-" });
  try {
    const { project, store, thread } = await approvedProjectWithThread();
    const persisted = await persistAgentResourceText(root, {
      name: "exclusion-note.md",
      mimeType: "text/markdown",
      text: "Bench evidence does not claim live flight.",
    });
    const review = new PrepareProjectDocumentaryClauseResponseReview({
      projects: store,
      snapshots: {
        get: (id) => Promise.resolve(id === thread.id ? thread : undefined),
      },
      captures: createDocumentaryClauseResponseStore(`${root}/captures`),
      resources: persisted.reopen,
    });
    const result = await review.execute({
      projectId: project.project.id,
      sourceItemId: "exclusion",
      answer:
        "The approved brief excludes live flight; recorded proofs stay bench-only.",
      scope: "context",
      sourceRefs: [{
        kind: "agent-resource",
        resourceRef: persisted.reference,
      }],
    });
    assertEquals(result.status, "resolved");
    if (result.status !== "resolved") return;
    assertEquals(result.operation.id, "record.seal-documentary-clause-response");
    assertEquals(result.inputEvidenceRefs, []);
    assertEquals(
      result.decisionParameters.some((item) =>
        item.key === "clause.sourceItemId" && item.value === "exclusion"
      ),
      true,
    );
    assertEquals(
      result.decisionParameters.some((item) => item.key === "requirementId"),
      false,
    );
    assertEquals(
      result.decisionParameters.some((item) =>
        item.key === "clause.source.0.kind" && item.value === "agent-resource"
      ),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("review is unresolved for a missing item, URL+digest shortcut, and unknown resource", async () => {
  const root = await Deno.makeTempDir({ prefix: "clause-response-review-miss-" });
  try {
    const { project, store, thread } = await approvedProjectWithThread();
    const persisted = await persistAgentResourceText(root, {
      name: "note.md",
      mimeType: "text/markdown",
      text: "source",
    });
    const review = new PrepareProjectDocumentaryClauseResponseReview({
      projects: store,
      snapshots: {
        get: (id) => Promise.resolve(id === thread.id ? thread : undefined),
      },
      captures: createDocumentaryClauseResponseStore(`${root}/captures`),
      resources: persisted.reopen,
    });
    const missingItem = await review.execute({
      projectId: project.project.id,
      sourceItemId: "absent.item",
      answer: "No such clause.",
      scope: "context",
      sourceRefs: [{ kind: "agent-resource", resourceRef: persisted.reference }],
    });
    assertEquals(missingItem.status, "unresolved");

    const shortcut = await review.execute({
      projectId: project.project.id,
      sourceItemId: "exclusion",
      answer: "Shortcut.",
      scope: "context",
      sourceRefs: [{
        kind: "agent-resource",
        resourceRef: {
          uri: "https://example.invalid/note.md",
          digest: "a".repeat(64),
        },
      }],
    });
    assertEquals(shortcut.status, "unresolved");

    const unknown = await review.execute({
      projectId: project.project.id,
      sourceItemId: "exclusion",
      answer: "Unknown source.",
      scope: "context",
      sourceRefs: [{
        kind: "agent-resource",
        resourceRef: {
          ...persisted.reference,
          uri: `casys://agent-resource-capture/sha256/${"b".repeat(64)}`,
          fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        },
      }],
    });
    assertEquals(unknown.status, "unresolved");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function approvedProjectWithThread(): Promise<{
  readonly project: EngineeringProjectSnapshot;
  readonly store: MemoryProjectStore;
  readonly thread: ThreadSnapshot;
}> {
  const store = new MemoryProjectStore();
  const commands = new ProjectBriefCommandService(store, () => AT);
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await commands.startProject(agent, {
    commandId: "start",
    projectId: "project-clause",
    projectName: "Clause fixture",
    issuedAt: AT,
    intent: "Documentary answers.",
    intentSource: { kind: "human", reference: "conversation:clause" },
  });
  project = await commands.proposeBrief(agent, {
    commandId: "propose",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Record documentary answers.",
      sourceRefs: [{ kind: "intent", reference: "conversation:clause" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Inspect recorded answers.",
      sourceRefs: [{ kind: "document", reference: "brief:mission" }],
    }, {
      id: "exclusion",
      kind: "exclusion",
      statement: "No outdoor use.",
      sourceRefs: [{ kind: "document", reference: "brief:exclusion" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Displacement stays at or below 2 mm.",
      sourceRefs: [{ kind: "document", reference: "brief:limit" }],
      dependsOnItemIds: [],
    }],
  });
  project = await commands.approveBrief(human, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Fixture approval.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const thread: ThreadSnapshot = {
    schemaVersion: "1.0",
    id: "thread:clause:r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: project.project.subjectId,
      name: "Clause",
      kind: "system",
      version: "1",
      modelArtifactId: "model",
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "change:r1",
      name: "base",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: [{
      id: "model",
      name: "model",
      kind: "sysml-model",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      producer: { serverId: "digital-thread", tool: "test", runId: "run:seed" },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  project = {
    ...project,
    threadSnapshots: [{
      snapshotId: thread.id,
      revision: thread.revision,
      subjectId: thread.subject.id,
    }],
  };
  store.overlay = project;
  return { project, store, thread };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  #current: EngineeringProjectSnapshot | undefined;
  #revisions = new Map<number, EngineeringProjectSnapshot>();
  overlay: EngineeringProjectSnapshot | undefined;

  get(): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.overlay ?? this.#current;
    return Promise.resolve(value && structuredClone(value));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const value = this.overlay && this.overlay.revision === revision
      ? this.overlay
      : this.#revisions.get(revision);
    return Promise.resolve(value && structuredClone(value));
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#current?.revision !== expectedRevision) {
      return Promise.reject(new Error("CAS failed."));
    }
    this.#current = structuredClone(snapshot);
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}
