import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { EngineeringProjectCommandService } from "../domain/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../domain/project-brief-command-service.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  INSPECTION_DRONE_ARCHITECTURE_V3_CAPTURE_SCHEMA,
  INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
  inspectionDroneArchitectureSysmlFingerprint,
} from "../domain/inspection-drone-architecture.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../domain/syson-model-seed.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { ApprovedDiscoveryBaselineRunExecutor } from "./approved-discovery-baseline-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "./engineering-project-completion-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "./engineering-project-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./engineering-project-initial-baseline-evidence-validator.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "./file-approved-discovery-baseline-capture-store.ts";
import { FileEngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import { FileInspectionDroneArchitectureAttemptStore } from "./file-inspection-drone-architecture-attempt-store.ts";
import { FileInspectionDroneArchitectureCaptureStore } from "./file-inspection-drone-architecture-capture-store.ts";
import { InspectionDroneArchitectureQueueEligibility } from "./inspection-drone-architecture-queue-eligibility.ts";
import { FileSysonModelSeedAttemptStore } from "./file-syson-model-seed-attempt-store.ts";
import { FileSysonModelSeedCaptureStore } from "./file-syson-model-seed-capture-store.ts";
import { FileThreadSnapshotStore } from "./file-thread-snapshot-store.ts";
import {
  type AppendLiveThreadUpdate,
  FileLiveThreadUpdateStore,
  type LiveThreadUpdate,
  type LiveThreadUpdateMilestoneJournal,
} from "./live-thread-update-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";
import {
  InspectionDroneArchitectureRunExecutor,
  resolveInspectionDroneArchitectureEligibility,
} from "./inspection-drone-architecture-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

Deno.test("r3 authoring inserts only the fixed architecture after exact r1/r2 gates and publishes r3", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-executor-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const executor = architectureExecutor(fixture, syson);
    const command = executionCommand(fixture.queued);

    const completed = await executor.execute(AGENT, command);
    const run = completed.agentRuns.find((candidate) => candidate.id === command.runId);
    assertExists(run);
    assertEquals(run.status, "completed");
    assertEquals(run.resultSnapshot?.revision, 3);
    assertEquals(completed.threadSnapshots.length, 3);
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_element_children",
    ]);
    const insertion = syson.calls[1]!;
    assertEquals(insertion.arguments, {
      editing_context_id: "editing-context-456",
      parent_id: "root-package-012",
      sysml_text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
    });

    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    const artifact = snapshot.artifacts.at(-1)!;
    assertEquals(artifact.kind, "sysml-model");
    assertEquals(artifact.inputArtifactIds.length, 1);
    assertEquals(snapshot.consumptions.length, 1);
    assertEquals(snapshot.requirements, []);
    assertEquals(snapshot.evaluations, []);
    assertEquals(snapshot.violations, []);
    assertEquals(snapshot.proposedActions, []);
    const capture = await fixture.captures.read(artifact.fingerprint);
    assertExists(capture);
    assertEquals(capture.includes(INSPECTION_DRONE_ARCHITECTURE_SYSML), false);
    assertEquals(capture.includes("approved-discovery"), false);
    assertEquals(
      JSON.parse(capture).schemaVersion,
      INSPECTION_DRONE_ARCHITECTURE_V3_CAPTURE_SCHEMA,
    );
    assertEquals(JSON.parse(capture).operation, {
      id: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.id,
      version: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.version,
    });
    assertEquals(
      (await fixture.liveUpdates.list(completed.project.subjectId)).map((update) => [
        update.operationId,
        update.state,
      ]),
      [
        [
          "architecture.author-inspection-drone:root-preflight",
          "running",
        ],
        [
          "architecture.author-inspection-drone:root-preflight",
          "fresh",
        ],
        [
          "architecture.author-inspection-drone:architecture-insert",
          "running",
        ],
        [
          "architecture.author-inspection-drone:architecture-insert",
          "fresh",
        ],
        [
          "architecture.author-inspection-drone:root-readback",
          "running",
        ],
        [
          "architecture.author-inspection-drone:root-readback",
          "fresh",
        ],
        [
          "architecture.author-inspection-drone:package-readback",
          "running",
        ],
        [
          "architecture.author-inspection-drone:package-readback",
          "fresh",
        ],
        ["$reconcile", "reconciled"],
      ],
    );

    const replay = await executor.execute(AGENT, command);
    assertEquals(replay.revision, completed.revision);
    assertEquals(syson.calls.length, 4);
    assertEquals(
      (await fixture.liveUpdates.list(completed.project.subjectId)).length,
      9,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 keeps the brief revision that authorized its change when the living brief evolves", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-historical-brief-",
  });
  try {
    const fixture = await queuedArchitecture(directory, {
      evolveBriefBeforeArchitectureQueue: true,
    });
    assertEquals(fixture.queued.framing?.currentBrief?.revision, 2);
    const change = fixture.queued.planChanges?.find((candidate) =>
      candidate.workItemIds.includes("author-inspection-drone")
    );
    assertEquals(change?.approvedBriefBasis?.briefRevision, 1);

    const syson = new ArchitectureSyson();
    const completed = await architectureExecutor(fixture, syson).execute(
      AGENT,
      executionCommand(fixture.queued),
    );
    const run = completed.agentRuns.at(-1)!;
    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    const capture = await fixture.captures.read(
      snapshot.artifacts.at(-1)!.fingerprint,
    );
    assertExists(capture);
    const authorization = JSON.parse(capture).authorization;
    assertEquals(authorization.approvedBriefBasis.briefRevision, 1);
    assertEquals(authorization.approvedBrief.revision, 1);
    assertEquals(syson.calls.length, 4);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 resume after a completed write journal skips preflight and never inserts twice", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-resume-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const command = executionCommand(fixture.queued);
    const fingerprint = await inspectionDroneArchitectureSysmlFingerprint();
    const begun = await fixture.attempts.begin({
      projectId: fixture.queued.project.id,
      runId: command.runId,
      step: "architecture-insert",
      dispatchedAt: "2026-08-03T12:04:00.000Z",
    });
    assertEquals(begun.action, "dispatch");
    await fixture.attempts.complete({
      projectId: fixture.queued.project.id,
      runId: command.runId,
      step: "architecture-insert",
      dispatchedAt: "2026-08-03T12:04:00.000Z",
      completedAt: "2026-08-03T12:04:01.000Z",
      result: {
        inserted: "true",
        parentId: "root-package-012",
        textSha256: fingerprint.digest,
      },
    });
    const syson = new ArchitectureSyson({ resumed: true });
    const executor = architectureExecutor(fixture, syson);

    await executor.execute(AGENT, command);

    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_children",
    ]);
    assertEquals(
      syson.calls.some((call) => call.name === "syson_element_insert_sysml"),
      false,
    );
    assertEquals(
      (await fixture.liveUpdates.list(fixture.queued.project.subjectId)).map(
        (update) => [update.operationId, update.state],
      ),
      [
        [
          "architecture.author-inspection-drone:root-readback",
          "running",
        ],
        [
          "architecture.author-inspection-drone:root-readback",
          "fresh",
        ],
        [
          "architecture.author-inspection-drone:package-readback",
          "running",
        ],
        [
          "architecture.author-inspection-drone:package-readback",
          "fresh",
        ],
        ["$reconcile", "reconciled"],
      ],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 marks a failed guarded provider read without exposing or retrying it", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-live-fail-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ preflightFailure: true });

    await assertRejects(
      () =>
        architectureExecutor(fixture, syson).execute(
          AGENT,
          executionCommand(fixture.queued),
        ),
      Error,
      "root package unavailable",
    );

    assertEquals(syson.calls.map((call) => call.name), ["syson_element_children"]);
    assertEquals(
      (await fixture.liveUpdates.list(fixture.queued.project.subjectId)).map(
        (update) => [update.operationId, update.state],
      ),
      [
        [
          "architecture.author-inspection-drone:root-preflight",
          "running",
        ],
        [
          "architecture.author-inspection-drone:root-preflight",
          "failed",
        ],
      ],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 completes canonical work once when its optional live journal is unavailable", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-live-optional-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const unavailableFeed = new UnavailableLiveUpdates();

    const completed = await architectureExecutor(fixture, syson, unavailableFeed)
      .execute(
        AGENT,
        executionCommand(fixture.queued),
      );

    assertEquals(completed.agentRuns.at(-1)?.status, "completed");
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_element_children",
    ]);
    assertEquals(unavailableFeed.appendOnceCalls, 8);
    assertEquals(unavailableFeed.reconcileRunOnceCalls, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 refuses a non-empty root before the write and records no insertion", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-root-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ nonEmptyRoot: true });
    const executor = architectureExecutor(fixture, syson);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "must contain no direct children",
    );
    assertEquals(syson.calls.map((call) => call.name), ["syson_element_children"]);
    assertEquals(
      await fixture.attempts.read(
        fixture.queued.project.id,
        fixture.queued.agentRuns.at(-1)!.id,
        "architecture-insert",
      ),
      undefined,
    );
    const current = await fixture.projects.get(fixture.queued.project.id);
    assertEquals(current?.agentRuns.at(-1)?.status, "failed");
    assertEquals(current?.threadSnapshots.length, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 rejects a mismatched write acknowledgement without publishing an r3 snapshot", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-ack-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ insertionTextMismatch: true });
    const executor = architectureExecutor(fixture, syson);
    const command = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "will not be retried automatically",
    );
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
    ]);
    await assertNoR3Snapshot(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 rejects an ambiguous post-write root read without publishing an r3 snapshot", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-readback-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ ambiguousRootReadback: true });
    const executor = architectureExecutor(fixture, syson);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "durably acknowledged",
    );
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
    ]);
    await assertNoR3Snapshot(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 rejects an invalid declaration semantic kind without publishing an r3 snapshot", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-kind-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ requirementUsage: true });
    const executor = architectureExecutor(fixture, syson);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "durably acknowledged",
    );
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_element_children",
    ]);
    await assertNoR3Snapshot(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 eligibility binds the r1 capture to this project's identity, plan, and baseline work item", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-bound-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const run = fixture.queued.agentRuns.at(-1)!;
    const basis = run.basis!;
    if (basis.kind !== "thread-snapshot") throw new Error("Expected an r2 basis.");
    const dependencies = {
      projects: fixture.projects,
      snapshots: fixture.snapshots,
      approvedBriefCaptures: fixture.baselineCaptures,
      seedCaptures: fixture.seedCaptures,
    };
    const variants = [
      {
        ...fixture.queued,
        project: { ...fixture.queued.project, id: "another-engineering-project" },
      },
      {
        ...fixture.queued,
        plan: { ...fixture.queued.plan!, publishedAt: "2026-08-03T12:59:00.000Z" },
      },
      {
        ...fixture.queued,
        workItems: fixture.queued.workItems.map((item) =>
          item.id === "record-approved-brief"
            ? { ...item, title: "Altered documentary baseline" }
            : item
        ),
      },
    ];
    for (const project of variants) {
      await assertRejects(
        () =>
          resolveInspectionDroneArchitectureEligibility(dependencies, {
            project,
            basis,
            workItemId: run.workItemId,
          }),
        Error,
        "identity, approved brief basis, reviewed plan, and baseline work item",
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 @2 queue gate refuses a missing approved-brief capture before creating a run", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-v3-queue-gate-",
  });
  try {
    const fixture = await queuedArchitecture(directory, {
      queueArchitecture: false,
    });
    const r1Reference = fixture.queued.threadSnapshots[0]!;
    const r1 = await fixture.snapshots.get(r1Reference.snapshotId);
    assertExists(r1);
    const document = r1.artifacts[0]!;
    await Deno.remove(fixture.baselineCaptures.pathFor(document.fingerprint));
    const before = await fixture.projects.get(fixture.queued.project.id);
    const r2 = fixture.queued.threadSnapshots.at(-1)!;

    await assertRejects(
      () =>
        fixture.commands.queueRun(HUMAN, {
          commandId: "human-authorize-architecture-without-v3-capture",
          projectId: fixture.queued.project.id,
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-03T12:03:30.000Z",
          runId: "run:author-without-v3-capture",
          workItemId: "author-inspection-drone",
          summary: "The exact V3 documentary authority must remain readable.",
          basis: { kind: "thread-snapshot", ...r2 },
        }),
      Error,
      "approved-brief capture required by V3 architecture is no longer readable",
    );
    assertEquals(await fixture.projects.get(fixture.queued.project.id), before);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 fails closed on an uncertain insertion and never replays it", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-unknown-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ insertionFailure: true });
    const executor = architectureExecutor(fixture, syson);
    const command = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "will not be retried automatically",
    );
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
    ]);
    assertEquals(
      (await fixture.attempts.read(
        fixture.queued.project.id,
        command.runId,
        "architecture-insert",
      ))
        ?.status,
      "dispatched",
    );

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "will not be retried automatically",
    );
    assertEquals(syson.calls.length, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 rejects a corrupt r2 seed capture before it calls SysON", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-r3-architecture-seed-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const r2 = fixture.queued.threadSnapshots.at(-1)!;
    const snapshot = await fixture.snapshots.get(r2.snapshotId);
    assertExists(snapshot);
    const seed = snapshot.artifacts.at(-1)!;
    await Deno.writeTextFile(
      fixture.seedCaptures.pathFor(seed.fingerprint),
      '{"corrupt":true}',
    );
    const syson = new ArchitectureSyson();
    const executor = architectureExecutor(fixture, syson);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "r2 SysON model-seed capture",
    );
    assertEquals(syson.calls, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function architectureExecutor(
  fixture: Awaited<ReturnType<typeof queuedArchitecture>>,
  syson: McpToolClient,
  liveUpdates: LiveThreadUpdateMilestoneJournal = fixture.liveUpdates,
) {
  return new InspectionDroneArchitectureRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    approvedBriefCaptures: fixture.baselineCaptures,
    seedCaptures: fixture.seedCaptures,
    captures: fixture.captures,
    attempts: fixture.attempts,
    syson,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/r3-leases`),
    liveUpdates,
    now: () => "2026-08-03T12:10:00.000Z",
  });
}

async function assertNoR3Snapshot(
  fixture: Awaited<ReturnType<typeof queuedArchitecture>>,
): Promise<void> {
  const current = await fixture.projects.get(fixture.queued.project.id);
  assertEquals(current?.threadSnapshots.length, 2);
  const latest = await fixture.snapshots.latest(fixture.queued.project.subjectId);
  assertEquals(latest?.revision, 2);
}

function executionCommand(
  queued: Awaited<ReturnType<typeof queuedArchitecture>>["queued"],
) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-author-inspection-drone",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-03T12:03:00.000Z",
    runId: run.id,
  };
}

async function queuedArchitecture(
  directory: string,
  options: {
    queueEligibility?: boolean;
    queueArchitecture?: boolean;
    evolveBriefBeforeArchitectureQueue?: boolean;
  } = {},
) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileApprovedDiscoveryBaselineCaptureStore(
    `${directory}/baseline-captures`,
  );
  const seedCaptures = new FileSysonModelSeedCaptureStore(`${directory}/seed-captures`);
  const seedAttempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const captures = new FileInspectionDroneArchitectureCaptureStore(
    `${directory}/r3-captures`,
  );
  const attempts = new FileInspectionDroneArchitectureAttemptStore(
    `${directory}/r3-attempts`,
  );
  const liveUpdates = new FileLiveThreadUpdateStore(`${directory}/live-updates`);
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T12:10:00.000Z") + ++tick * 1_000)
      .toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-drone-project",
    projectId: "drone-review-demo",
    projectName: "Inspection drone demonstrator",
    issuedAt: "2026-08-03T11:59:00.000Z",
    intent: "Build a reviewable controlled visual-inspection drone demonstrator.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await briefs.proposeBrief(AGENT, {
    commandId: "propose-drone-brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-03T12:00:02.000Z",
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Build a reviewable controlled inspection drone.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Perform controlled visual inspection with a light camera.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve traceable evidence from SysML through verification.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    }],
  });
  const proposedBrief = project.framing!.proposedBrief!;
  const proposalReview = project.framing!.proposalReview!;
  project = await briefs.approveBrief(HUMAN, {
    commandId: "approve-drone-brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-03T12:00:04.000Z",
    briefSnapshotId: proposedBrief.id,
    briefRevision: proposedBrief.revision,
    rationale: "Approved as the bounded first demonstrator.",
    inputFingerprint: proposalReview.inputFingerprint,
  });
  const queueEligibility = options.queueEligibility === false
    ? undefined
    : new InspectionDroneArchitectureQueueEligibility({
      projects,
      snapshots,
      approvedBriefCaptures: baselineCaptures,
      seedCaptures,
    });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
      ...(queueEligibility ? { queueEligibility } : {}),
    },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );
  const planned = await commands.publishPlan(AGENT, initialPlanCommand(project));
  const queuedBaseline = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-documentary-baseline",
    projectId: planned.project.id,
    expectedRevision: planned.revision,
    issuedAt: "2026-08-03T12:01:30.000Z",
    runId: "run:documentary-baseline",
    workItemId: "record-approved-brief",
    summary: "Human authorized the documentary baseline.",
    basis: planned.plan!.basis,
  });
  const baselineExecutor = new ApprovedDiscoveryBaselineRunExecutor({
    projects,
    commands,
    discoveries: { getRevision: () => Promise.resolve(undefined) },
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-03T12:02:00.000Z",
  });
  const baselineCompleted = await baselineExecutor.execute(AGENT, {
    commandId: "agent-record-documentary-baseline",
    projectId: queuedBaseline.project.id,
    expectedRevision: queuedBaseline.revision,
    issuedAt: "2026-08-03T12:02:00.000Z",
    runId: "run:documentary-baseline",
  });
  const r1 = baselineCompleted.threadSnapshots[0]!;
  const architectureDeclared = await commands.appendChange(AGENT, {
    commandId: "append-drone-architecture",
    projectId: baselineCompleted.project.id,
    expectedRevision: baselineCompleted.revision,
    issuedAt: "2026-08-03T12:02:20.000Z",
    baseSnapshot: r1,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the bounded traceable inspection-drone system model.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }, {
      id: "author-inspection-drone",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed-syson-model"],
      decisionIds: [],
      operation: {
        ...INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const queuedSeed = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-syson-seed",
    projectId: architectureDeclared.project.id,
    expectedRevision: architectureDeclared.revision,
    issuedAt: "2026-08-03T12:02:30.000Z",
    runId: "run:seed-syson-model",
    workItemId: "seed-syson-model",
    summary: "Human authorized the blank SysON container.",
    basis: { kind: "thread-snapshot", ...r1 },
  });
  const seedExecutor = new SysonModelSeedRunExecutor({
    projects,
    commands,
    snapshots,
    captures: seedCaptures,
    attempts: seedAttempts,
    syson: new SeedSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    now: () => "2026-08-03T12:03:00.000Z",
  });
  const seedCompleted = await seedExecutor.execute(AGENT, {
    commandId: "agent-seed-syson-model",
    projectId: queuedSeed.project.id,
    expectedRevision: queuedSeed.revision,
    issuedAt: "2026-08-03T12:03:00.000Z",
    runId: "run:seed-syson-model",
  });
  const r2 = seedCompleted.threadSnapshots.at(-1)!;
  let architectureProject = seedCompleted;
  if (options.evolveBriefBeforeArchitectureQueue) {
    architectureProject = await briefs.proposeBrief(AGENT, {
      commandId: "propose-drone-brief-r2",
      projectId: architectureProject.project.id,
      expectedRevision: architectureProject.revision,
      issuedAt: "2026-08-03T12:03:10.000Z",
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Extend the reviewed drone mission without rewriting prior work.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "mission",
        kind: "mission-scenario",
        statement: "Perform controlled visual inspection with a light camera.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }, {
        id: "success",
        kind: "success-criterion",
        statement: "Preserve traceable evidence from SysML through verification.",
        sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      }],
    });
    const proposal = architectureProject.framing!.proposedBrief!;
    const review = architectureProject.framing!.proposalReview!;
    architectureProject = await briefs.approveBrief(HUMAN, {
      commandId: "approve-drone-brief-r2",
      projectId: architectureProject.project.id,
      expectedRevision: architectureProject.revision,
      issuedAt: "2026-08-03T12:03:20.000Z",
      briefSnapshotId: proposal.id,
      briefRevision: proposal.revision,
      rationale: "The living brief can evolve without changing prior authorization.",
      inputFingerprint: review.inputFingerprint,
    });
  }
  const queued = options.queueArchitecture === false
    ? architectureProject
    : await commands.queueRun(HUMAN, {
      commandId: "human-authorize-inspection-drone-architecture",
      projectId: architectureProject.project.id,
      expectedRevision: architectureProject.revision,
      issuedAt: "2026-08-03T12:03:30.000Z",
      runId: "run:author-inspection-drone",
      workItemId: "author-inspection-drone",
      summary: "Human authorized the bounded inspection-drone architecture.",
      basis: { kind: "thread-snapshot", ...r2 },
    });
  return {
    directory,
    attempts,
    baselineCaptures,
    captures,
    commands,
    liveUpdates,
    projects,
    queued,
    seedCaptures,
    snapshots,
  };
}

function initialPlanCommand(project: { project: { id: string }; revision: number }) {
  return {
    commandId: "agent-publish-initial-plan",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-03T12:00:30.000Z",
    startingPoint: "idea-or-spec" as const,
    phases: [{
      id: "baseline",
      name: "First project record",
      description: "Record the canonical approved brief before technical work.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "baseline",
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
      },
    }],
    requiredDecisions: [],
  };
}

class SeedSyson implements McpToolClient {
  callTool(call: McpToolCall): Promise<McpToolResult> {
    switch (call.name) {
      case "syson_project_create":
        return Promise.resolve({
          text: "created",
          structuredContent: {
            id: "syson-project-123",
            name: "Drone model seed",
            editingContextId: "editing-context-456",
          },
        });
      case "syson_model_create":
        return Promise.resolve({
          text: "created",
          structuredContent: {
            documentId: "document-789",
            documentName: "Drone system model",
            documentKind: "Document",
            rootPackageId: "root-package-012",
            rootPackageLabel: "New Package",
          },
        });
      case "syson_element_get":
        return Promise.resolve({
          text: "read",
          structuredContent: {
            id: "root-package-012",
            kind: "sysml::Package",
            label: "New Package",
          },
        });
      default:
        return Promise.reject(new Error(`Unexpected seed SysON tool ${call.name}`));
    }
  }
}

class UnavailableLiveUpdates implements LiveThreadUpdateMilestoneJournal {
  appendOnceCalls = 0;
  reconcileRunOnceCalls = 0;

  append(_input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    return Promise.reject(new Error("live feed unavailable"));
  }

  appendOnce(_input: AppendLiveThreadUpdate): Promise<LiveThreadUpdate> {
    this.appendOnceCalls++;
    return Promise.reject(new Error("live feed unavailable"));
  }

  reconcileRun(
    _subjectId: string,
    _runId: string,
    _recordedAt?: string,
  ): Promise<LiveThreadUpdate> {
    return Promise.reject(new Error("live feed unavailable"));
  }

  reconcileRunOnce(
    _subjectId: string,
    _runId: string,
    _recordedAt?: string,
  ): Promise<LiveThreadUpdate> {
    this.reconcileRunOnceCalls++;
    return Promise.reject(new Error("live feed unavailable"));
  }

  list(_subjectId: string): Promise<LiveThreadUpdate[]> {
    return Promise.resolve([]);
  }

  version(_subjectId: string): Promise<number> {
    return Promise.resolve(0);
  }
}

class ArchitectureSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #childrenCall = 0;

  constructor(
    private readonly options: {
      resumed?: boolean;
      nonEmptyRoot?: boolean;
      insertionFailure?: boolean;
      insertionTextMismatch?: boolean;
      ambiguousRootReadback?: boolean;
      requirementUsage?: boolean;
      preflightFailure?: boolean;
    } = {},
  ) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      if (this.options.insertionFailure) {
        return Promise.reject(new Error("provider timeout after unknown mutation"));
      }
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
          text: this.options.insertionTextMismatch
            ? "package Unexpected {}"
            : call.arguments?.sysml_text,
        },
      });
    }
    if (call.name !== "syson_element_children") {
      return Promise.reject(
        new Error(`Unexpected architecture SysON tool ${call.name}`),
      );
    }
    const callIndex = ++this.#childrenCall;
    const parentId = call.arguments?.element_id;
    if (!this.options.resumed && callIndex === 1 && this.options.preflightFailure) {
      return Promise.reject(new Error("root package unavailable"));
    }
    if (!this.options.resumed && callIndex === 1) {
      return Promise.resolve({
        text: "preflight",
        structuredContent: {
          parentId,
          children: this.options.nonEmptyRoot
            ? [{ id: "manual", kind: "sysml::Package", label: "ManualEdit" }]
            : [],
          count: this.options.nonEmptyRoot ? 1 : 0,
        },
      });
    }
    if (
      (this.options.resumed && callIndex === 1) ||
      (!this.options.resumed && callIndex === 2)
    ) {
      return Promise.resolve({
        text: "root readback",
        structuredContent: {
          parentId,
          children: this.options.ambiguousRootReadback
            ? [
              {
                id: "architecture-package-123",
                kind: "siriusComponents://semantic?domain=sysml&entity=Package",
                label: "InspectionDroneArchitecture",
              },
              {
                id: "unexpected-package-456",
                kind: "sysml::Package",
                label: "UnexpectedPackage",
              },
            ]
            : [{
              id: "architecture-package-123",
              kind: "siriusComponents://semantic?domain=sysml&entity=Package",
              label: "InspectionDroneArchitecture",
            }],
          count: this.options.ambiguousRootReadback ? 2 : 1,
        },
      });
    }
    return Promise.resolve({
      text: "architecture readback",
      structuredContent: {
        parentId,
        children: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.map((label, index) => ({
          id: `declaration-${index}`,
          kind: label === "Requirements" && this.options.requirementUsage
            ? "sysml::RequirementUsage"
            : `siriusComponents://semantic?domain=sysml&entity=${
              label === "Requirements" ? "Package" : "PartDefinition"
            }`,
          label,
        })),
        count: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length,
      },
    });
  }
}
