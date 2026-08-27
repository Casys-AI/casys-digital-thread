import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { EngineeringOperationPathLaneResolver } from "../../application/ports/out/project/engineering-operation-path-lane-resolver.ts";
import {
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "./engineering-workbench-projector.ts";
import {
  LIVE_THREAD_OVERLAY_SCHEMA,
  type LiveThreadWorkbenchSnapshot,
} from "../shared/stores/live-thread-update-store.ts";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../../testing/workbench/generic-engineering-workbench-fixture.ts";

Deno.test("engineering Workbench composes project intent and observed proof without mutation", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1);

  assertEquals(result.surface, "evidence");
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.project.project.subjectId, thread.subject.id);
  assertEquals(result.thread.id, thread.id);
  assertEquals(result.alignment, {
    status: "aligned",
    projectThreadRevision: 1,
    currentThreadRevision: 1,
  });
  assertEquals(result.unresolvedEvidenceReferences, []);
  assertEquals(result.projectPath, { phaseLanes: [], activities: [] });
});

Deno.test("engineering Workbench classifies contextual phases from exact downstream operations", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [
      projectPhase("requirements", 1, "work-requirements"),
      projectPhase("admission", 2, "work-admission"),
      projectPhase("target", 3, "work-target"),
      projectPhase("orphan", 4, "work-orphan"),
    ],
    workItems: [
      projectWork("work-requirements", "requirements", "requirements@1"),
      projectWork("work-admission", "admission", "admission@1"),
      projectWork("work-target", "target", "modelica@1"),
      projectWork("work-orphan", "orphan", "admission@1"),
    ],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "requirements") {
        return {
          kind: "fixed",
          lane: "requirements",
        };
      }
      if (operation.id === "admission") {
        return {
          kind: "contextual",
          allowedNext: ["geometry", "physics"],
          fallback: "system-model",
        };
      }
      if (operation.id === "modelica") {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.phaseLanes, [
    { phaseId: "requirements", lane: "requirements" },
    { phaseId: "admission", lane: "physics" },
    { phaseId: "target", lane: "physics" },
    { phaseId: "orphan", lane: "system-model" },
  ]);
  assertEquals(result.projectPath.activities.map((item) => item.id), [
    "activity:work-admission",
    "activity:work-orphan",
    "activity:work-requirements",
    "activity:work-target",
  ]);
});

Deno.test("engineering Workbench projects two same-operation roots as distinct activities", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [
      projectPhase("cad-a", 1, "work-cad-a"),
      projectPhase("cad-b", 2, "work-cad-b"),
    ],
    workItems: [
      projectWork("work-cad-a", "cad-a", "geometry@1"),
      projectWork("work-cad-b", "cad-b", "geometry@1"),
    ],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "geometry") return { kind: "fixed", lane: "geometry" };
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.activities, [
    {
      id: "activity:work-cad-a",
      lane: "geometry",
      rootRevisionId: "work-cad-a",
      revisionIds: ["work-cad-a"],
    },
    {
      id: "activity:work-cad-b",
      lane: "geometry",
      rootRevisionId: "work-cad-b",
      revisionIds: ["work-cad-b"],
    },
  ]);
});

Deno.test("engineering Workbench keeps an explicit successor in one activity", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const root = projectWork("work-cad", "cad", "geometry@1");
  const successor = {
    ...projectWork("work-cad-v2", "cad-v2", "geometry@2"),
    activityId: root.activityId,
    predecessorRevisionId: root.id,
  };
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [
      projectPhase("cad", 1, "work-cad"),
      projectPhase("cad-v2", 2, "work-cad-v2"),
    ],
    workItems: [successor, root],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "geometry") return { kind: "fixed", lane: "geometry" };
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.activities, [{
    id: root.activityId,
    lane: "geometry",
    rootRevisionId: "work-cad",
    revisionIds: ["work-cad", "work-cad-v2"],
  }]);
});

Deno.test("engineering Workbench keeps same-phase successors in one activity", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const root = projectWork("work-cad", "cad", "geometry@1");
  const successor = {
    ...projectWork("work-cad-v2", "cad", "geometry@2"),
    activityId: root.activityId,
    predecessorRevisionId: root.id,
  };
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [projectPhase("cad", 1, "work-cad", "work-cad-v2")],
    workItems: [successor, root],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "geometry") return { kind: "fixed", lane: "geometry" };
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.phaseLanes, [{
    phaseId: "cad",
    lane: "geometry",
  }]);
  assertEquals(result.projectPath.activities, [{
    id: root.activityId,
    lane: "geometry",
    rootRevisionId: "work-cad",
    revisionIds: ["work-cad", "work-cad-v2"],
  }]);
});

Deno.test("engineering Workbench keeps mixed-lane scheduling phases total without merging activities", () => {
  const thread = threadFixture();
  const base = projectFixture(thread.subject.id, thread.id);
  const project: EngineeringProjectSnapshot = {
    ...base,
    phases: [projectPhase("shared", 1, "work-cad", "work-arch")],
    workItems: [
      projectWork("work-cad", "shared", "geometry@1"),
      projectWork("work-arch", "shared", "architecture@1"),
    ],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "geometry") return { kind: "fixed", lane: "geometry" };
      if (operation.id === "architecture") {
        return { kind: "fixed", lane: "system-model" };
      }
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.projectPath.phaseLanes, [{
    phaseId: "shared",
    lane: "geometry",
  }]);
  assertEquals(result.projectPath.activities, [
    {
      id: "activity:work-arch",
      lane: "system-model",
      rootRevisionId: "work-arch",
      revisionIds: ["work-arch"],
    },
    {
      id: "activity:work-cad",
      lane: "geometry",
      rootRevisionId: "work-cad",
      revisionIds: ["work-cad"],
    },
  ]);
});

Deno.test("engineering Workbench joins a typed FEA case to its Project activity through the producer run", () => {
  const thread = threadFixture();
  const work = projectWork("work-fea", "fea", "verify.run-fea-static-proof@3");
  const successor = {
    ...projectWork("work-fea-v2", "fea", "verify.run-fea-static-proof@3"),
    activityId: work.activityId,
    predecessorRevisionId: work.id,
  };
  const project: EngineeringProjectSnapshot = {
    ...projectFixture(thread.subject.id, thread.id),
    phases: [projectPhase("fea", 1, work.id, successor.id)],
    workItems: [work, successor],
    agentRuns: [{
      id: "run:fea-seal-v2",
      workItemId: successor.id,
      status: "completed",
      summary: "Sealed proof-case revision 2.",
      queuedAt: "2026-08-01T12:00:00.000Z",
      evidenceRefs: [],
    }],
  };
  const caseDigest = "a".repeat(64);
  thread.artifacts = [
    ...thread.artifacts,
    {
      id: "fea-proof-" + caseDigest,
      label: "Mechanical proof case r2",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      producerRunId: "run:fea-seal-v2",
      dependsOn: [],
    },
  ];
  thread.engineeringCases = {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases: [{
      key: `mechanical-proof:${caseDigest}`,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "arm-cantilever",
      revision: 2,
      scope: "Arm cantilever",
      caseDigest,
      authorityArtifactIds: ["fea-proof-" + caseDigest],
    }],
    issues: [],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "verify.run-fea-static-proof") {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.caseActivityJoins, [{
    caseKey: `mechanical-proof:${caseDigest}`,
    caseId: "arm-cantilever",
    caseRevision: 2,
    activityId: work.activityId,
    workItemId: successor.id,
    runId: "run:fea-seal-v2",
  }]);
});

Deno.test("engineering Workbench omits a case join when producer runs disagree", () => {
  const thread = threadFixture();
  const work = projectWork("work-fea", "fea", "verify.run-fea-static-proof@3");
  const project: EngineeringProjectSnapshot = {
    ...projectFixture(thread.subject.id, thread.id),
    phases: [projectPhase("fea", 1, work.id)],
    workItems: [work],
    agentRuns: [{
      id: "run:fea-a",
      workItemId: work.id,
      status: "completed",
      summary: "First seal.",
      queuedAt: "2026-08-01T12:00:00.000Z",
      evidenceRefs: [],
    }, {
      id: "run:fea-b",
      workItemId: work.id,
      status: "completed",
      summary: "Second seal.",
      queuedAt: "2026-08-01T12:00:01.000Z",
      evidenceRefs: [],
    }],
  };
  const caseDigest = "b".repeat(64);
  thread.artifacts = [
    ...thread.artifacts,
    {
      id: "fea-proof-a",
      label: "Proof A",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      producerRunId: "run:fea-a",
      dependsOn: [],
    },
    {
      id: "fea-proof-b",
      label: "Proof B",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      producerRunId: "run:fea-b",
      dependsOn: [],
    },
  ];
  thread.engineeringCases = {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases: [{
      key: `mechanical-proof:${caseDigest}`,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "arm-cantilever",
      revision: 1,
      scope: "Arm cantilever",
      caseDigest,
      authorityArtifactIds: ["fea-proof-a", "fea-proof-b"],
    }],
    issues: [],
  };
  const resolver: EngineeringOperationPathLaneResolver = {
    resolve(operation) {
      if (operation.id === "verify.run-fea-static-proof") {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    resolver,
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.caseActivityJoins, []);
});

Deno.test("engineering Workbench omits a case join when an authority artifact is missing", () => {
  const thread = threadFixture();
  const work = projectWork("work-fea", "fea", "verify.run-fea-static-proof@3");
  const project: EngineeringProjectSnapshot = {
    ...projectFixture(thread.subject.id, thread.id),
    phases: [projectPhase("fea", 1, work.id)],
    workItems: [work],
    agentRuns: [{
      id: "run:fea-a",
      workItemId: work.id,
      status: "completed",
      summary: "Seal.",
      queuedAt: "2026-08-01T12:00:00.000Z",
      evidenceRefs: [],
    }],
  };
  const caseDigest = "c".repeat(64);
  thread.artifacts = [
    ...thread.artifacts,
    {
      id: "fea-proof-a",
      label: "Proof A",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      producerRunId: "run:fea-a",
      dependsOn: [],
    },
  ];
  thread.engineeringCases = {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases: [{
      key: `mechanical-proof:${caseDigest}`,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "arm-cantilever",
      revision: 1,
      scope: "Arm cantilever",
      caseDigest,
      authorityArtifactIds: ["fea-proof-a", "fea-proof-missing"],
    }],
    issues: [],
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    feaResolver(),
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.caseActivityJoins, []);
});

Deno.test("engineering Workbench omits a case join when an authority artifact has no producer run", () => {
  const thread = threadFixture();
  const work = projectWork("work-fea", "fea", "verify.run-fea-static-proof@3");
  const project: EngineeringProjectSnapshot = {
    ...projectFixture(thread.subject.id, thread.id),
    phases: [projectPhase("fea", 1, work.id)],
    workItems: [work],
    agentRuns: [{
      id: "run:fea-a",
      workItemId: work.id,
      status: "completed",
      summary: "Seal.",
      queuedAt: "2026-08-01T12:00:00.000Z",
      evidenceRefs: [],
    }],
  };
  const caseDigest = "d".repeat(64);
  thread.artifacts = [
    ...thread.artifacts,
    {
      id: "fea-proof-a",
      label: "Proof A",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      producerRunId: "run:fea-a",
      dependsOn: [],
    },
    {
      id: "fea-proof-b",
      label: "Proof B",
      kind: "document",
      system: "casys-digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      dependsOn: [],
    },
  ];
  thread.engineeringCases = {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases: [{
      key: `mechanical-proof:${caseDigest}`,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "arm-cantilever",
      revision: 1,
      scope: "Arm cantilever",
      caseDigest,
      authorityArtifactIds: ["fea-proof-a", "fea-proof-b"],
    }],
    issues: [],
  };

  const result = projectEngineeringWorkbenchSnapshot(
    project,
    thread,
    1,
    [],
    [],
    feaResolver(),
  );
  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to use the evidence surface.");
  }
  assertEquals(result.caseActivityJoins, []);
});

function feaResolver(): EngineeringOperationPathLaneResolver {
  return {
    resolve(operation) {
      if (operation.id === "verify.run-fea-static-proof") {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };
}

Deno.test("engineering Workbench labels a dangling evidence reference instead of hiding the projection", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);
  const issue = {
    path: "$.decisions[15].inputEvidenceRefs[0]",
    message: "does not resolve to a artifact in the exact ThreadSnapshot revision",
  };

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 1, [], [issue]);

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to remain an evidence surface.");
  }
  assertEquals(result.unresolvedEvidenceReferences, [issue]);
});

Deno.test("planning Workbench exposes intent without inventing a technical thread", () => {
  const project = planningProjectFixture();

  const result = projectEngineeringPlanningWorkbenchSnapshot(project);

  assertEquals(result.surface, "planning");
  assertEquals(result.project.threadSnapshots, []);
  assertEquals(result.planning.technicalBaseline.status, "not-created");
  assertEquals(result.planning.baselineRun, undefined);
  assertEquals(result.planning.activity, { version: 0, milestones: [] });
  assertEquals("thread" in result, false);
});

Deno.test("engineering Workbench rejects cross-subject composition", () => {
  const thread = threadFixture();
  const project = projectFixture("another-subject", thread.id);

  assertThrows(
    () => projectEngineeringWorkbenchSnapshot(project, thread, 1),
    Error,
    "does not match thread subject",
  );
});

Deno.test("engineering Workbench makes a newer current thread explicit", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id);

  const result = projectEngineeringWorkbenchSnapshot(project, thread, 2);

  if (result.surface !== "evidence") {
    throw new Error("Expected observed proof to remain an evidence surface.");
  }
  assertEquals(result.alignment, {
    status: "thread-ahead",
    projectThreadRevision: 1,
    currentThreadRevision: 2,
  });
});

Deno.test("engineering Workbench rejects a current thread older than project intent", () => {
  const thread = threadFixture();
  const project = projectFixture(thread.subject.id, thread.id, 2);

  assertThrows(
    () => projectEngineeringWorkbenchSnapshot(project, thread, 1),
    Error,
    "precedes project thread revision",
  );
});

function projectFixture(
  subjectId: string,
  snapshotId: string,
  revision = 1,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `project-snapshot-r${revision}`,
    revision,
    generatedAt: "2026-08-01T12:00:00.000Z",
    project: {
      id: "project-generic",
      name: "Generic Product GEN-01",
      subjectId,
      objective: {
        title: "Build a verifiable generic product",
        statement: "Connect project intent to observed technical proof.",
      },
    },
    threadSnapshots: [{ snapshotId, revision, subjectId }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function planningProjectFixture(): EngineeringProjectSnapshot {
  return {
    ...projectFixture("project:planning", "unused"),
    threadSnapshots: [],
  };
}

function projectPhase(
  id: string,
  order: number,
  ...workItemIds: string[]
): EngineeringProjectSnapshot["phases"][number] {
  return {
    id,
    name: "Deliberately non-classifying phase label",
    order,
    description: "Classification comes from the exact operation only.",
    workItemIds,
    requiredDecisionIds: [],
    evidenceRefs: [],
  };
}

function projectWork(
  id: string,
  phaseId: string,
  operationKey?: string,
): EngineeringProjectSnapshot["workItems"][number] {
  const [operationId, version] = operationKey?.split("@") ?? [];
  return {
    id,
    activityId: `activity:${id}`,
    phaseId,
    title: "Exact registered work",
    description: "Exact registered work.",
    kind: "simulate",
    ...(operationId && version
      ? { operation: { id: operationId, version, bindings: [] } }
      : {}),
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
}

function threadFixture(): LiveThreadWorkbenchSnapshot {
  return {
    ...structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE.thread),
    live: { schemaVersion: LIVE_THREAD_OVERLAY_SCHEMA, version: 0, active: [] },
  };
}
