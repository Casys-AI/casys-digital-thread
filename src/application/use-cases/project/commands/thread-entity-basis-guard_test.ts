import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectPlanningDependencies } from "./engineering-project-commands.ts";
import { applyQueueRun } from "./engineering-run-transitions.ts";
import {
  applyAppendChange,
  approvedBriefBasisForProject,
} from "./project-planning-transitions.ts";

const FIXTURE = new URL(
  "../../../../testing/generic-engineering-project.fixture.json",
  import.meta.url,
);
const ORIGIN = { kind: "agent" as const, actorId: "agent:basis-guard" };
const APPLIED_AT = "2026-09-05T00:00:00.000Z";

/**
 * The generic flag is registry-owned; these tests deliberately model only the
 * narrow projection consumed by the planning and queue seams.
 */
function basisBoundPlanning(): EngineeringProjectPlanningDependencies {
  return {
    operations: {
      validate(input) {
        return {
          operation: {
            id: input.operation.id,
            version: input.operation.version,
            startingPoint: "idea-or-spec" as const,
            title: "Seal the reviewed technical compilation admission",
            description: "Fixture basis-bound admission operation.",
            workItemKind: "review" as const,
            execution: "trusted" as const,
            threadEntityBindingsMustMatchBasis: true as const,
          },
          bindings: input.operation.bindings,
        };
      },
    },
  };
}

Deno.test(
  "append rejects a historical thread-entity binding before adding the work item or MRTR slot",
  async () => {
    const project = await appendableProject();
    const head = currentHead(project);
    const workCount = project.workItems.length;
    const decisionCount = project.decisions.length;
    const phaseCount = project.phases.length;

    assertThrows(
      () =>
        applyAppendChange(
          project as never,
          APPLIED_AT,
          ORIGIN,
          appendCommand(head, referenceFor({ ...head, revision: head.revision - 1 })),
          basisBoundPlanning(),
        ),
      Error,
      "must name the exact project-change baseSnapshot",
    );

    assertEquals(project.workItems.length, workCount);
    assertEquals(project.decisions.length, decisionCount);
    assertEquals(project.phases.length, phaseCount);
  },
);

Deno.test(
  "queue rejects a historical thread-entity binding before run persistence",
  async () => {
    const project = await queueableProject();
    const head = currentHead(project);
    const workItem = project.workItems[0]!;
    workItem.operation = operationFor(
      referenceFor({ ...head, revision: head.revision - 1 }),
    ) as never;
    workItem.status = "ready";
    workItem.decisionIds = [];
    const runCount = project.agentRuns.length;

    await assertRejects(
      () =>
        applyQueueRun(
          project as never,
          APPLIED_AT,
          ORIGIN,
          queueCommand(head),
          basisBoundPlanning(),
        ),
      Error,
      "must name the exact queued run Thread basis",
    );

    assertEquals(project.agentRuns.length, runCount);
    assertEquals(workItem.status, "ready");
  },
);

Deno.test("queue accepts a binding on its exact Thread basis", async () => {
  const project = await queueableProject();
  const head = currentHead(project);
  const workItem = project.workItems[0]!;
  workItem.operation = operationFor(referenceFor(head)) as never;
  workItem.status = "ready";
  workItem.decisionIds = [];

  await applyQueueRun(
    project as never,
    APPLIED_AT,
    ORIGIN,
    queueCommand(head),
    basisBoundPlanning(),
  );

  assertEquals(project.agentRuns.length, 1);
  assertEquals(project.agentRuns[0]?.status, "queued");
  assertEquals(workItem.status, "in-progress");
});

async function appendableProject(): Promise<Mutable<EngineeringProjectSnapshot>> {
  const project = await fixture();
  const briefBasis = approvedBriefBasisForProject(project);
  project.plan = {
    startingPoint: "idea-or-spec",
    basis: briefBasis,
    publishedAt: APPLIED_AT,
    publishedBy: { id: ORIGIN.actorId, origin: ORIGIN.kind },
  };
  const baseline = project.workItems[0]!;
  baseline.operation = {
    id: "baseline.from-approved-brief",
    version: "1",
    bindings: [],
  };
  baseline.status = "completed";
  project.agentRuns = [{
    id: "run:fixture-baseline",
    workItemId: baseline.id,
    status: "completed",
    summary: "Fixture baseline completed.",
    queuedAt: APPLIED_AT,
    startedAt: APPLIED_AT,
    completedAt: APPLIED_AT,
    basis: briefBasis,
    inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    evidenceRefs: [],
  }] as never;
  return project;
}

async function queueableProject(): Promise<Mutable<EngineeringProjectSnapshot>> {
  return await fixture();
}

async function fixture(): Promise<Mutable<EngineeringProjectSnapshot>> {
  return JSON.parse(await Deno.readTextFile(FIXTURE)) as Mutable<
    EngineeringProjectSnapshot
  >;
}

function currentHead(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
  return structuredClone(project.threadSnapshots.at(-1)!);
}

function referenceFor(snapshot: EngineeringThreadSnapshotRef) {
  return {
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: "architecture-sysml-fixture",
  };
}

function operationFor(
  reference: ReturnType<typeof referenceFor>,
) {
  return {
    id: "compile.seal-admission",
    version: "3",
    bindings: [{
      name: "sysmlModel",
      source: { kind: "thread-entity" as const, reference },
    }],
  };
}

function appendCommand(
  head: EngineeringThreadSnapshotRef,
  reference: ReturnType<typeof referenceFor>,
) {
  return {
    commandId: "append-basis-bound-admission",
    projectId: "generic-test-system",
    expectedRevision: 2,
    issuedAt: APPLIED_AT,
    baseSnapshot: head,
    phases: [{
      id: "admission",
      name: "Admission",
      description: "Seal the reviewed technical compilation.",
    }],
    workItems: [{
      id: "seal-compilation-admission",
      phaseId: "admission",
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: operationFor(reference),
    }],
    requiredDecisions: [],
  };
}

function queueCommand(head: EngineeringThreadSnapshotRef) {
  return {
    commandId: "queue-basis-bound-admission",
    projectId: "generic-test-system",
    expectedRevision: 2,
    issuedAt: APPLIED_AT,
    runId: "run:basis-bound-admission",
    workItemId: "capture-system-model",
    summary: "Queue the exact basis-bound admission.",
    basis: { kind: "thread-snapshot" as const, ...head },
  };
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
