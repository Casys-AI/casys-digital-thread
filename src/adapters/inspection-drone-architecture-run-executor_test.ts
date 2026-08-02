import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { EngineeringProjectCommandService } from "../domain/engineering-project-command-service.ts";
import { ProjectDiscoveryHandoffService } from "../domain/project-discovery-handoff-service.ts";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS,
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  inspectionDroneArchitectureSysmlFingerprint,
} from "../domain/inspection-drone-architecture.ts";
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
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";
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
      snapshots: fixture.snapshots,
      approvedDiscoveryCaptures: fixture.baselineCaptures,
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
          item.id === "record-approved-discovery"
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
          }),
        Error,
        "identity, approved handoff, reviewed plan, and baseline work item",
      );
    }
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

Deno.test("r3 requires the exact approved payload choice before it calls SysON", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-payload-",
  });
  try {
    const fixture = await queuedArchitecture(directory, {
      payload: "flight-only",
      queueEligibility: false,
    });
    const syson = new ArchitectureSyson();
    const executor = architectureExecutor(fixture, syson);

    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "payload-class=light-inspection-camera",
    );
    assertEquals(syson.calls, []);
    const current = await fixture.projects.get(fixture.queued.project.id);
    assertEquals(current?.agentRuns.at(-1)?.status, "queued");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 queue eligibility refuses an unapproved payload before it creates a run", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-r3-architecture-queue-eligibility-",
  });
  try {
    const fixture = await queuedArchitecture(directory, {
      payload: "flight-only",
      queueArchitecture: false,
    });
    const r2 = fixture.queued.threadSnapshots.at(-1)!;
    const before = await fixture.projects.get(fixture.queued.project.id);

    await assertRejects(
      () =>
        fixture.commands.queueRun(HUMAN, {
          commandId: "human-authorize-unapproved-inspection-drone-architecture",
          projectId: fixture.queued.project.id,
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-03T12:03:30.000Z",
          runId: "run:author-unapproved-inspection-drone",
          workItemId: "author-inspection-drone",
          summary: "Do not queue an architecture outside the reviewed scope.",
          basis: { kind: "thread-snapshot", ...r2 },
        }),
      Error,
      "payload-class=light-inspection-camera",
    );
    assertEquals(await fixture.projects.get(fixture.queued.project.id), before);
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
    approvedDiscoveryCaptures: fixture.baselineCaptures,
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
    payload?: "light-inspection-camera" | "flight-only";
    queueEligibility?: boolean;
    queueArchitecture?: boolean;
  } = {},
) {
  const discoveries = new FileProjectDiscoveryRevisionStore(`${directory}/discoveries`);
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
  const discovery = await approvedDroneDiscovery(
    discoveries,
    options.payload ?? "light-inspection-camera",
  );
  const handoff = await new ProjectDiscoveryHandoffService(
    discoveries,
    projects,
    () => "2026-08-03T12:00:00.000Z",
  ).createEngineeringProject(HUMAN, {
    commandId: "create-drone-project",
    discoveryId: discovery.discoveryId,
    expectedDiscoveryRevision: discovery.revision,
    issuedAt: "2026-08-03T11:59:00.000Z",
    projectId: "drone-review-demo",
    projectName: "Build a reviewable controlled inspection drone demonstrator.",
  });
  let tick = 0;
  const queueEligibility = options.queueEligibility === false
    ? undefined
    : new InspectionDroneArchitectureQueueEligibility({
      snapshots,
      approvedDiscoveryCaptures: baselineCaptures,
      seedCaptures,
    });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    () =>
      new Date(Date.parse("2026-08-03T12:01:00.000Z") + ++tick * 1_000)
        .toISOString(),
    {
      discoveries,
      operations: testOperationRegistry(),
      ...(queueEligibility ? { queueEligibility } : {}),
    },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );
  const planned = await commands.publishPlan(AGENT, stagedPlanCommand(handoff));
  const queuedBaseline = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-documentary-baseline",
    projectId: planned.project.id,
    expectedRevision: planned.revision,
    issuedAt: "2026-08-03T12:01:30.000Z",
    runId: "run:documentary-baseline",
    workItemId: "record-approved-discovery",
    summary: "Human authorized the documentary baseline.",
    basis: planned.plan!.basis,
  });
  const baselineExecutor = new ApprovedDiscoveryBaselineRunExecutor({
    projects,
    commands,
    discoveries,
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
  const queuedSeed = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-syson-seed",
    projectId: baselineCompleted.project.id,
    expectedRevision: baselineCompleted.revision,
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
  const queued = options.queueArchitecture === false
    ? seedCompleted
    : await commands.queueRun(HUMAN, {
      commandId: "human-authorize-inspection-drone-architecture",
      projectId: seedCompleted.project.id,
      expectedRevision: seedCompleted.revision,
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

function testOperationRegistry() {
  return {
    validate(
      input: Parameters<typeof REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate>[0],
    ) {
      const operation = input.operation;
      if (
        operation.id !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.id ||
        operation.version !== INSPECTION_DRONE_ARCHITECTURE_OPERATION.version
      ) {
        return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
      }
      if (
        operation.bindings.length !== 1 ||
        operation.bindings[0]?.name !== "approvedDiscovery" ||
        operation.bindings[0].source.kind !== "approved-discovery" ||
        (input.stage === "queue" && input.basisKind !== "thread-snapshot")
      ) {
        throw new Error("Invalid test inspection-drone architecture operation.");
      }
      return {
        operation: {
          id: INSPECTION_DRONE_ARCHITECTURE_OPERATION.id,
          version: INSPECTION_DRONE_ARCHITECTURE_OPERATION.version,
          startingPoint: "idea-or-spec" as const,
          title: "Author the bounded inspection-drone architecture",
          description:
            "Insert one reviewed high-level architecture into the empty SysON root.",
          workItemKind: "architect" as const,
          execution: "trusted" as const,
        },
        bindings: structuredClone(operation.bindings),
      };
    },
  };
}

function stagedPlanCommand(project: { project: { id: string } }) {
  return {
    commandId: "agent-publish-staged-plan",
    projectId: project.project.id,
    expectedRevision: 1,
    issuedAt: "2026-08-03T12:00:30.000Z",
    startingPoint: "idea-or-spec" as const,
    phases: [
      {
        id: "baseline",
        name: "First project record",
        description: "Record the reviewed discovery before technical work begins.",
      },
      {
        id: "architecture",
        name: "System model",
        description: "Create the bounded traceable inspection-drone system model.",
      },
    ],
    workItems: [
      {
        id: "record-approved-discovery",
        phaseId: "baseline",
        owner: "agent" as const,
        dependsOnWorkItemIds: [],
        decisionIds: [],
        operation: {
          id: "baseline.from-approved-discovery",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" as const },
          }],
        },
      },
      {
        id: "seed-syson-model",
        phaseId: "architecture",
        owner: "agent" as const,
        dependsOnWorkItemIds: ["record-approved-discovery"],
        decisionIds: [],
        operation: {
          id: "architecture.seed-syson-model",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" as const },
          }],
        },
      },
      {
        id: "author-inspection-drone",
        phaseId: "architecture",
        owner: "agent" as const,
        dependsOnWorkItemIds: ["seed-syson-model"],
        decisionIds: [],
        operation: {
          id: INSPECTION_DRONE_ARCHITECTURE_OPERATION.id,
          version: INSPECTION_DRONE_ARCHITECTURE_OPERATION.version,
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" as const },
          }],
        },
      },
    ],
    requiredDecisions: [],
  };
}

async function approvedDroneDiscovery(
  store: FileProjectDiscoveryRevisionStore,
  payload: "light-inspection-camera" | "flight-only",
) {
  let tick = 0;
  const service = new ProjectDiscoveryCommandService(
    store,
    () =>
      new Date(Date.parse("2026-08-03T10:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  let discovery = await service.start(HUMAN, {
    commandId: "start-drone-discovery",
    discoveryId: "drone-review-discovery",
    issuedAt: "2026-08-03T09:59:00.000Z",
    intent: "Build a reviewable controlled visual-inspection drone demonstrator.",
  });
  for (
    const question of [
      {
        id: "primary-mission",
        value: "inspection-controlled",
        label: "Controlled inspection",
      },
      {
        id: "payload-class",
        value: payload,
        label: payload === "light-inspection-camera" ? "Light camera" : "Flight only",
      },
    ]
  ) {
    discovery = await service.proposeQuestion(AGENT, {
      commandId: `propose-${question.id}`,
      discoveryId: discovery.discoveryId,
      expectedRevision: discovery.revision,
      issuedAt: "2026-08-03T09:59:10.000Z",
      question: {
        id: question.id,
        prompt: question.label,
        whyItMatters: "It bounds the first reviewed architecture slice.",
        recommendation: {
          value: question.value,
          rationale: "The review selected this bounded demonstration scope.",
          confidence: "high",
        },
        options: [{
          value: question.value,
          label: question.label,
          consequences: "This fixture uses the selected bounded scope.",
        }],
        allowUnknown: false,
        risk: "material",
        evidenceNeeded: [],
      },
    });
    discovery = await service.recordAnswer(HUMAN, {
      commandId: `answer-${question.id}`,
      discoveryId: discovery.discoveryId,
      expectedRevision: discovery.revision,
      issuedAt: "2026-08-03T09:59:20.000Z",
      answer: {
        id: `answer-${question.id}`,
        questionId: question.id,
        kind: "provided",
        value: question.value,
        explanation: "Human review selected this bounded option.",
        source: { kind: "human", reference: "human:reviewer" },
      },
    });
  }
  discovery = await service.proposeBrief(AGENT, {
    commandId: "propose-drone-brief",
    discoveryId: discovery.discoveryId,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-03T09:59:30.000Z",
    brief: {
      id: "drone-brief-v1",
      objective: "Build a reviewable controlled inspection drone demonstrator.",
      missionScenarios: ["Controlled visual inspection"],
      successCriteria: ["Create a reviewable engineering record"],
      constraints: ["No provider execution before a reviewed plan"],
      intendedMarkets: ["To be confirmed"],
      manufacturingJurisdictions: ["To be confirmed"],
      operatingJurisdictions: ["To be confirmed"],
      complianceTargets: ["Identify applicable evidence"],
      verificationPlan: ["Plan technical verification after baseline"],
      exclusions: ["No certification or flight claim"],
      assumptions: ["Controlled demonstrator"],
      openQuestions: [],
    },
  });
  return await service.approveBrief(HUMAN, {
    commandId: "approve-drone-brief",
    discoveryId: discovery.discoveryId,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-03T09:59:40.000Z",
    briefId: discovery.brief!.id,
    rationale: "The bounded brief is clear enough to create a project path.",
    inputFingerprint: discovery.review!.inputFingerprint,
  });
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
