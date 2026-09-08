import { assertEquals, assertThrows } from "@std/assert";
import type {
  EngineeringDecision,
  EngineeringDecisionStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItemStatus,
} from "../../domain/project/engineering-project.ts";
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
import type { EngineeringCase } from "../../presentation/workbench/thread/evidence.ts";
import {
  ENGINEERING_CASE_CATALOG_SCHEMA,
  projectCurrentEngineeringCases,
  verificationCaseKey,
} from "../../presentation/workbench/thread/evidence.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../../domain/fea/seal-case/fea-proof-proposal.ts";

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
  thread.engineeringCases = mechanicalCatalog([{
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id: "arm-cantilever",
    revision: 2,
    scope: "Arm cantilever",
    caseDigest,
    authorityArtifactIds: ["fea-proof-" + caseDigest],
  }]);
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
    caseKey: verificationCaseKey("mechanical-proof", caseDigest),
    caseId: "arm-cantilever",
    caseRevision: 2,
    activityId: work.activityId,
    workItemId: successor.id,
    runId: "run:fea-seal-v2",
  }]);
});

Deno.test(
  "engineering Workbench keeps caseActivityJoins digest-addressed across one mechanical series",
  () => {
    const thread = threadFixture();
    const workR1 = projectWork(
      "work-fea-r1",
      "fea",
      "verify.run-fea-static-proof@3",
    );
    const workR3 = {
      ...projectWork("work-fea-r3", "fea", "verify.run-fea-static-proof@3"),
      activityId: workR1.activityId,
      predecessorRevisionId: workR1.id,
    };
    const digestR1 = "a".repeat(64);
    const digestR3 = "b".repeat(64);
    const keyR1 = verificationCaseKey("mechanical-proof", digestR1);
    const keyR3 = verificationCaseKey("mechanical-proof", digestR3);
    const project: EngineeringProjectSnapshot = {
      ...projectFixture(thread.subject.id, thread.id),
      phases: [projectPhase("fea", 1, workR1.id, workR3.id)],
      workItems: [workR1, workR3],
      agentRuns: [{
        id: "run:fea-seal-r1",
        workItemId: workR1.id,
        status: "completed",
        summary: "Sealed proof-case revision 1.",
        queuedAt: "2026-08-01T12:00:00.000Z",
        evidenceRefs: [],
      }, {
        id: "run:fea-seal-r3",
        workItemId: workR3.id,
        status: "completed",
        summary: "Sealed proof-case revision 3.",
        queuedAt: "2026-08-01T13:00:00.000Z",
        evidenceRefs: [],
      }],
    };
    thread.artifacts = [
      ...thread.artifacts,
      {
        id: "fea-proof-" + digestR1,
        label: "Mechanical proof case r1",
        kind: "document",
        system: "casys-digital-thread",
        revision: digestR1,
        freshness: "fresh",
        producerRunId: "run:fea-seal-r1",
        dependsOn: [],
      },
      {
        id: "fea-proof-" + digestR3,
        label: "Mechanical proof case r3",
        kind: "document",
        system: "casys-digital-thread",
        revision: digestR3,
        freshness: "fresh",
        producerRunId: "run:fea-seal-r3",
        dependsOn: [],
      },
    ];
    thread.engineeringCases = mechanicalCatalog([{
      key: keyR1,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "id01-camera-bracket-bench",
      revision: 1,
      scope: "Camera bracket bench",
      caseDigest: digestR1,
      authorityArtifactIds: ["fea-proof-" + digestR1],
    }, {
      key: keyR3,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "id01-camera-bracket-bench",
      revision: 3,
      scope: "Camera bracket bench",
      caseDigest: digestR3,
      authorityArtifactIds: ["fea-proof-" + digestR3],
    }]);

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
    assertEquals(thread.engineeringCases!.current, [{
      family: "mechanical-proof",
      id: "id01-camera-bracket-bench",
      currentCaseKey: keyR3,
      revision: 3,
    }]);
    assertEquals(result.caseActivityJoins, [
      {
        caseKey: keyR1,
        caseId: "id01-camera-bracket-bench",
        caseRevision: 1,
        activityId: workR1.activityId,
        workItemId: workR1.id,
        runId: "run:fea-seal-r1",
      },
      {
        caseKey: keyR3,
        caseId: "id01-camera-bracket-bench",
        caseRevision: 3,
        activityId: workR1.activityId,
        workItemId: workR3.id,
        runId: "run:fea-seal-r3",
      },
    ]);
  },
);

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
  thread.engineeringCases = mechanicalCatalog([{
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id: "arm-cantilever",
    revision: 1,
    scope: "Arm cantilever",
    caseDigest,
    authorityArtifactIds: ["fea-proof-a", "fea-proof-b"],
  }]);
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
  thread.engineeringCases = mechanicalCatalog([{
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id: "arm-cantilever",
    revision: 1,
    scope: "Arm cantilever",
    caseDigest,
    authorityArtifactIds: ["fea-proof-a", "fea-proof-missing"],
  }]);

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
  thread.engineeringCases = mechanicalCatalog([{
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id: "arm-cantilever",
    revision: 1,
    scope: "Arm cantilever",
    caseDigest,
    authorityArtifactIds: ["fea-proof-a", "fea-proof-b"],
  }]);

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

Deno.test(
  "engineering Workbench keeps RadialArm joins when a disjoint Camera group fail-closes",
  () => {
    const thread = threadFixture();
    const digestCameraA = "a".repeat(64);
    const digestCameraB = "b".repeat(64);
    const digestRadial = "d".repeat(64);
    const cameraA = cameraCase(digestCameraA, 1);
    const cameraB = {
      ...cameraCase(digestCameraB, 1),
      scope: "Camera bracket bench duplicate declaration.",
    };
    const radialKey = verificationCaseKey("mechanical-proof", digestRadial);
    const radial: EngineeringCase = {
      key: radialKey,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "id01-radial-arm-bench",
      revision: 2,
      scope: "RadialArm bench",
      caseDigest: digestRadial,
      authorityArtifactIds: ["fea-proof-" + digestRadial],
      target: { modelElementId: RADIAL_TARGET },
    };
    const workRadial = sealProofWork(
      "wi-proof-seal-id01-radial-arm-bench-r2",
      "completed",
      ["decision-seal-id01-radial-arm-bench-r2"],
    );
    const project: EngineeringProjectSnapshot = {
      ...projectFixture(thread.subject.id, thread.id),
      workItems: [workRadial],
      decisions: [
        projectDecision("decision-seal-id01-radial-arm-bench-r2", "approved"),
      ],
      agentRuns: [completedRun("run:radial-arm-r2", workRadial.id)],
    };
    thread.artifacts = [
      ...thread.artifacts,
      proofAuthority(
        "fea-proof-" + digestCameraA,
        digestCameraA,
        "run:camera-dup-a",
      ),
      proofAuthority(
        "fea-proof-" + digestCameraB,
        digestCameraB,
        "run:camera-dup-b",
      ),
      proofAuthority("fea-proof-" + digestRadial, digestRadial, "run:radial-arm-r2"),
    ];
    thread.engineeringCases = groupScopedCatalog([cameraA, cameraB, radial]);

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
    assertEquals(
      result.thread.engineeringCases?.cases,
      [cameraA, cameraB, radial],
    );
    assertEquals(result.thread.engineeringCases?.current, [{
      family: "mechanical-proof",
      id: "id01-radial-arm-bench",
      currentCaseKey: radialKey,
      revision: 2,
    }]);
    assertEquals(
      result.thread.engineeringCases?.issues.every((issue) =>
        issue.reason === "case-current-divergent"
      ),
      true,
    );
    assertEquals(result.caseActivityJoins, [{
      caseKey: radialKey,
      caseId: "id01-radial-arm-bench",
      caseRevision: 2,
      activityId: workRadial.activityId,
      workItemId: workRadial.id,
      runId: "run:radial-arm-r2",
    }]);
  },
);

Deno.test(
  "engineering Workbench keeps exact Camera cases and joins when duplicated r1 fail-closes current",
  () => {
    const thread = threadFixture();
    const digestR1a = "a".repeat(64);
    const digestR1b = "b".repeat(64);
    const digestR3 = "c".repeat(64);
    const keyR1a = verificationCaseKey("mechanical-proof", digestR1a);
    const keyR3 = verificationCaseKey("mechanical-proof", digestR3);
    const workR1 = sealProofWork(
      "wi-proof-seal-id01-camera-bracket-bench-r1",
      "completed",
      ["decision-seal-id01-camera-bracket-bench-r1"],
    );
    const workR3 = {
      ...sealProofWork(
        "wi-proof-seal-id01-camera-bracket-bench-r3",
        "completed",
        ["decision-seal-id01-camera-bracket-bench-r3"],
      ),
      activityId: workR1.activityId,
      predecessorRevisionId: workR1.id,
    };
    const project: EngineeringProjectSnapshot = {
      ...projectFixture(thread.subject.id, thread.id),
      workItems: [workR1, workR3],
      decisions: [
        projectDecision("decision-seal-id01-camera-bracket-bench-r1", "approved"),
        projectDecision("decision-seal-id01-camera-bracket-bench-r3", "approved"),
      ],
      agentRuns: [
        completedRun("run:camera-r1", workR1.id),
        completedRun("run:camera-r3", workR3.id),
      ],
    };
    thread.artifacts = [
      ...thread.artifacts,
      proofAuthority("fea-proof-" + digestR1a, digestR1a, "run:camera-r1"),
      proofAuthority("fea-proof-" + digestR1b, digestR1b, "run:camera-r1b"),
      proofAuthority("fea-proof-" + digestR3, digestR3, "run:camera-r3"),
    ];
    const cases = [
      cameraCase(digestR1a, 1),
      {
        ...cameraCase(digestR1b, 1),
        scope: "Camera bracket bench duplicate r1.",
      },
      cameraCase(digestR3, 3),
    ];
    thread.engineeringCases = groupScopedCatalog(cases);

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
    assertEquals(result.thread.engineeringCases?.cases, cases);
    assertEquals(result.thread.engineeringCases?.current, []);
    assertEquals(result.caseActivityJoins, [
      {
        caseKey: keyR1a,
        caseId: CAMERA_CASE_ID,
        caseRevision: 1,
        activityId: workR1.activityId,
        workItemId: workR1.id,
        runId: "run:camera-r1",
      },
      {
        caseKey: keyR3,
        caseId: CAMERA_CASE_ID,
        caseRevision: 3,
        activityId: workR1.activityId,
        workItemId: workR3.id,
        runId: "run:camera-r3",
      },
    ]);
    assertEquals(
      result.thread.engineeringCases?.issues.length,
      3,
    );
    assertEquals(
      result.thread.engineeringCases?.issues.every((issue) =>
        issue.reason === "case-current-divergent"
      ),
      true,
    );
  },
);

const CAMERA_CASE_ID = "id01-camera-bracket-bench";
const CAMERA_TARGET = "e9f1d48b-666d-48ff-af6c-abf74646b68e";
const RADIAL_TARGET = "444df600-019b-45d5-ac36-617ff0a0f791";

function cameraCase(
  caseDigest: string,
  revision: number,
): EngineeringCase {
  return {
    key: verificationCaseKey("mechanical-proof", caseDigest),
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
    id: CAMERA_CASE_ID,
    revision,
    scope: "Camera bracket bench",
    caseDigest,
    authorityArtifactIds: ["fea-proof-" + caseDigest],
    target: { modelElementId: CAMERA_TARGET },
  };
}

function sealProofWork(
  id: string,
  status: EngineeringWorkItemStatus,
  decisionIds: string[],
): EngineeringProjectSnapshot["workItems"][number] {
  return {
    ...projectWork(
      id,
      "fea",
      `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`,
    ),
    kind: "verify",
    status,
    decisionIds,
  };
}

function projectDecision(
  id: string,
  status: EngineeringDecisionStatus,
  proposal?: EngineeringDecision["proposal"],
): EngineeringDecision {
  return {
    id,
    phaseId: "fea",
    title: "Seal the mechanical proof case",
    question: "Seal this reviewed mechanical proof case?",
    status,
    requestedAt: "2026-08-01T12:00:00.000Z",
    inputEvidenceRefs: [],
    approvalIds: [],
    ...(proposal ? { proposal } : {}),
  };
}

function completedRun(
  id: string,
  workItemId: string,
): EngineeringProjectSnapshot["agentRuns"][number] {
  return {
    id,
    workItemId,
    status: "completed",
    summary: "Completed seal.",
    queuedAt: "2026-08-01T12:00:00.000Z",
    evidenceRefs: [],
  };
}

function proofAuthority(
  id: string,
  caseDigest: string,
  producerRunId: string,
): LiveThreadWorkbenchSnapshot["artifacts"][number] {
  return {
    id,
    label: "Mechanical proof case",
    kind: "document",
    system: "casys-digital-thread",
    revision: caseDigest,
    freshness: "fresh",
    producerRunId,
    dependsOn: [],
  };
}

function feaResolver(): EngineeringOperationPathLaneResolver {
  return {
    resolve(operation) {
      if (
        operation.id === "verify.run-fea-static-proof" ||
        operation.id === VERIFY_SEAL_PROOF_CASE_OPERATION.id
      ) {
        return { kind: "fixed", lane: "physics" };
      }
      return undefined;
    },
  };
}

function mechanicalCatalog(
  cases: EngineeringCase[],
): LiveThreadWorkbenchSnapshot["engineeringCases"] {
  return {
    schemaVersion: ENGINEERING_CASE_CATALOG_SCHEMA,
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases,
    current: projectCurrentEngineeringCases(cases).current,
    issues: [],
  };
}

function groupScopedCatalog(
  cases: EngineeringCase[],
): LiveThreadWorkbenchSnapshot["engineeringCases"] {
  const projection = projectCurrentEngineeringCases(cases);
  return {
    schemaVersion: ENGINEERING_CASE_CATALOG_SCHEMA,
    status: projection.issues.length > 0 ? "unresolved" : "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases,
    current: projection.current,
    issues: projection.issues,
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
