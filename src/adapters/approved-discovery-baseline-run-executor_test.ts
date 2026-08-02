import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { EngineeringProjectCommandService } from "../domain/engineering-project-command-service.ts";
import { ProjectDiscoveryHandoffService } from "../domain/project-discovery-handoff-service.ts";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { FileEngineeringProjectRevisionStore } from "./engineering-project-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./engineering-project-initial-baseline-evidence-validator.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "./file-approved-discovery-baseline-capture-store.ts";
import {
  type EngineeringProjectRunLease,
  FileEngineeringProjectRunLease,
} from "./file-engineering-project-run-lease.ts";
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";
import { FileThreadSnapshotStore } from "./file-thread-snapshot-store.ts";
import { FileLiveThreadUpdateStore } from "./live-thread-update-store.ts";
import { ApprovedDiscoveryBaselineRunExecutor } from "./approved-discovery-baseline-run-executor.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

Deno.test("trusted executor concurrently captures and attaches one V2 documentary baseline without duplicating live milestones", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-v2-baseline-executor-" });
  try {
    const {
      captures,
      commands,
      discoveries,
      liveUpdates,
      projects,
      queued,
      snapshots,
    } = await queuedBaseline(directory);

    const executionBarrier = new ExecutionLeaseBarrier();
    const firstExecutor = new ApprovedDiscoveryBaselineRunExecutor({
      projects,
      commands,
      discoveries,
      captures,
      snapshots,
      lease: new BarrierLease(
        new FileEngineeringProjectRunLease(`${directory}/run-leases`),
        executionBarrier,
      ),
      liveUpdates,
      now: () => "2026-08-02T12:10:00.000Z",
    });
    const secondExecutor = new ApprovedDiscoveryBaselineRunExecutor({
      projects,
      commands,
      discoveries,
      captures,
      snapshots,
      lease: new BarrierLease(
        new FileEngineeringProjectRunLease(`${directory}/run-leases`),
        executionBarrier,
      ),
      liveUpdates,
      now: () => "2026-08-02T12:10:00.000Z",
    });
    const execution = {
      commandId: "agent-record-documentary-baseline",
      projectId: queued.project.id,
      expectedRevision: queued.revision,
      issuedAt: "2026-08-02T12:02:00.000Z",
      runId: "run:documentary-baseline",
    };
    const firstExecution = firstExecutor.execute(AGENT, execution);
    await executionBarrier.firstEntered.promise;
    const secondExecution = secondExecutor.execute(AGENT, execution);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assertEquals(executionBarrier.secondEntered, false);
    executionBarrier.releaseFirst.resolve();
    const [completed, concurrentReplay] = await Promise.all([
      firstExecution,
      secondExecution,
    ]);
    assertEquals(concurrentReplay.id, completed.id);

    const run = completed.agentRuns[0]!;
    assertEquals(completed.revision, 6);
    assertEquals(run.status, "completed");
    assertEquals(run.basis?.kind, "approved-discovery");
    const approvedDiscoveryBasis = run.basis;
    if (approvedDiscoveryBasis?.kind !== "approved-discovery") {
      throw new Error("Fixture run must retain its approved-discovery basis.");
    }
    assertEquals(run.evidenceRefs.length, 1);
    assertEquals(completed.threadSnapshots.length, 1);
    const snapshot = await snapshots.get(completed.threadSnapshots[0]!.snapshotId);
    assertExists(snapshot);
    assertEquals(snapshot.revision, 1);
    assertEquals(snapshot.artifacts.map((artifact) => artifact.kind), ["document"]);
    assertEquals(snapshot.observations, []);
    assertEquals(snapshot.requirements, []);
    assertEquals(snapshot.evaluations, []);
    assertEquals(snapshot.violations, []);
    const document = snapshot.artifacts[0]!;
    assertEquals(await captures.read(document.fingerprint) !== undefined, true);
    assertEquals(
      document.uri,
      captures.uriFor(document.fingerprint),
    );
    assertEquals(
      (await liveUpdates.list(completed.project.subjectId)).map((item) => item.state),
      ["running", "fresh", "reconciled"],
    );

    await assertRejects(
      () =>
        new ExactInitialBaselineEvidenceValidator(snapshots, captures).validateInitial(
          "run:not-the-documentary-run",
          approvedDiscoveryBasis,
          completed.workItems[0]!.operation!,
          run.resultSnapshot!,
          run.evidenceRefs,
        ),
      Error,
      "trusted local producer exactly",
    );

    const replay = await firstExecutor.execute(AGENT, execution);
    assertEquals(replay.id, completed.id);
    assertEquals((await liveUpdates.list(completed.project.subjectId)).length, 3);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a divergent replay cannot fail another invocation's claimed documentary baseline", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-v2-baseline-divergent-" });
  try {
    const {
      captures,
      commands,
      discoveries,
      liveUpdates,
      projects,
      queued,
      snapshots,
    } = await queuedBaseline(directory);
    const captureBarrier = new CaptureBarrierStore(`${directory}/captures`);
    const firstExecutor = new ApprovedDiscoveryBaselineRunExecutor({
      projects,
      commands,
      discoveries,
      captures: captureBarrier,
      snapshots,
      lease: new PassthroughLease(),
      liveUpdates,
      now: () => "2026-08-02T12:10:00.000Z",
    });
    const divergentExecutor = new ApprovedDiscoveryBaselineRunExecutor({
      projects,
      commands,
      discoveries,
      captures,
      snapshots,
      lease: new PassthroughLease(),
      liveUpdates,
      now: () => "2026-08-02T12:10:00.000Z",
    });
    const execution = {
      commandId: "agent-record-documentary-baseline",
      projectId: queued.project.id,
      expectedRevision: queued.revision,
      issuedAt: "2026-08-02T12:02:00.000Z",
      runId: "run:documentary-baseline",
    };

    const first = firstExecutor.execute(AGENT, execution);
    await captureBarrier.entered.promise;

    await assertRejects(
      () =>
        divergentExecutor.execute(AGENT, {
          ...execution,
          issuedAt: "2026-08-02T12:02:01.000Z",
        }),
      Error,
      "already used for a different request",
    );
    const whileFirstIsBlocked = await projects.get(queued.project.id);
    assertExists(whileFirstIsBlocked);
    assertEquals(whileFirstIsBlocked.agentRuns[0]?.status, "running");
    assertEquals(
      whileFirstIsBlocked.commandReceipts?.some((receipt) =>
        receipt.commandId.endsWith(":approved-discovery-baseline:fail")
      ),
      false,
    );

    captureBarrier.release.resolve();
    const completed = await first;
    assertEquals(completed.agentRuns[0]?.status, "completed");
    assertEquals(
      completed.commandReceipts?.some((receipt) =>
        receipt.commandId.endsWith(":approved-discovery-baseline:fail")
      ),
      false,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a snapshot save that commits before losing its acknowledgement stays retryable", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-v2-baseline-save-ambiguity-",
  });
  try {
    const {
      captures,
      commands,
      discoveries,
      projects,
      queued,
      snapshots,
    } = await queuedBaseline(directory);
    const executor = new ApprovedDiscoveryBaselineRunExecutor({
      projects,
      commands,
      discoveries,
      captures,
      snapshots: new SaveThenThrowSnapshotStore(snapshots),
      lease: new FileEngineeringProjectRunLease(`${directory}/run-leases`),
      now: () => "2026-08-02T12:10:00.000Z",
    });
    const execution = {
      commandId: "agent-record-documentary-baseline",
      projectId: queued.project.id,
      expectedRevision: queued.revision,
      issuedAt: "2026-08-02T12:02:00.000Z",
      runId: "run:documentary-baseline",
    };

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "durable, but its project attachment did not finish",
    );

    const intermediate = await projects.get(queued.project.id);
    assertExists(intermediate);
    assertEquals(intermediate.agentRuns[0]?.status, "running");
    assertEquals(intermediate.threadSnapshots, []);
    assertEquals(
      intermediate.commandReceipts?.some((receipt) =>
        receipt.commandId.endsWith(":approved-discovery-baseline:fail")
      ),
      false,
    );

    // A new store instance has no in-memory cache: this proves the first save
    // reached the durable file before its acknowledgement was lost.
    const freshReader = new FileThreadSnapshotStore(`${directory}/snapshots`);
    const durableUnattached = await freshReader.latest(queued.project.subjectId);
    assertExists(durableUnattached);

    const completed = await executor.execute(AGENT, execution);
    assertEquals(completed.agentRuns[0]?.status, "completed");
    assertEquals(completed.threadSnapshots.length, 1);
    assertEquals(completed.threadSnapshots[0]?.snapshotId, durableUnattached.id);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function queuedBaseline(directory: string) {
  const discoveries = new FileProjectDiscoveryRevisionStore(`${directory}/discoveries`);
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const captures = new FileApprovedDiscoveryBaselineCaptureStore(
    `${directory}/captures`,
  );
  const liveUpdates = new FileLiveThreadUpdateStore(`${directory}/live-updates`);
  const discovery = await approvedDiscovery(discoveries);
  const handoff = await new ProjectDiscoveryHandoffService(
    discoveries,
    projects,
    () => "2026-08-02T12:00:00.000Z",
  ).createEngineeringProject(HUMAN, {
    commandId: "create-drone-project",
    discoveryId: discovery.discoveryId,
    expectedDiscoveryRevision: discovery.revision,
    issuedAt: "2026-08-02T11:59:00.000Z",
    projectId: "drone-review-demo",
    projectName: "Build a reviewable drone demonstrator.",
  });

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-02T12:01:00.000Z") + ++tick * 1_000)
      .toISOString();
  const commands = new EngineeringProjectCommandService(
    projects,
    undefined,
    now,
    { discoveries, operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, captures),
  );
  const planned = await commands.publishPlan(AGENT, planCommand(handoff));
  assertEquals(planned.schemaVersion, "2.0");
  assertEquals(planned.workItems[0].status, "ready");
  const queued = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-documentary-baseline",
    projectId: planned.project.id,
    expectedRevision: planned.revision,
    issuedAt: "2026-08-02T12:01:30.000Z",
    runId: "run:documentary-baseline",
    workItemId: "record-approved-discovery",
    summary: "Human authorized the documentary baseline.",
    basis: planned.plan!.basis,
  });
  assertEquals(queued.agentRuns[0].basis, planned.plan!.basis);
  assertEquals(queued.agentRuns[0].baseSnapshot, undefined);
  return {
    captures,
    commands,
    discoveries,
    liveUpdates,
    projects,
    queued,
    snapshots,
  };
}

function planCommand(project: { project: { id: string } }) {
  return {
    commandId: "agent-publish-documentary-plan",
    projectId: project.project.id,
    expectedRevision: 1,
    issuedAt: "2026-08-02T12:00:30.000Z",
    startingPoint: "idea-or-spec" as const,
    phases: [{
      id: "baseline",
      name: "First project record",
      description: "Record the reviewed discovery before technical work begins.",
    }],
    workItems: [{
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
    }],
    requiredDecisions: [],
  };
}

async function approvedDiscovery(store: FileProjectDiscoveryRevisionStore) {
  let tick = 0;
  const service = new ProjectDiscoveryCommandService(
    store,
    () =>
      new Date(Date.parse("2026-08-02T10:00:00.000Z") + ++tick * 1_000)
        .toISOString(),
  );
  let discovery = await service.start(HUMAN, {
    commandId: "start-drone-discovery",
    discoveryId: "drone-review-discovery",
    issuedAt: "2026-08-02T09:59:00.000Z",
    intent: "Build a reviewable drone demonstrator.",
  });
  discovery = await service.proposeBrief(AGENT, {
    commandId: "propose-drone-brief",
    discoveryId: discovery.discoveryId,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-02T09:59:10.000Z",
    brief: {
      id: "drone-brief-v1",
      objective: "Build a reviewable drone demonstrator.",
      missionScenarios: ["Demonstrate stable controlled flight"],
      successCriteria: ["Create a reviewable engineering record"],
      constraints: ["No provider execution before a reviewed plan"],
      intendedMarkets: ["To be confirmed"],
      manufacturingJurisdictions: ["To be confirmed"],
      operatingJurisdictions: ["To be confirmed"],
      complianceTargets: ["Identify applicable evidence"],
      verificationPlan: ["Plan technical verification after baseline"],
      exclusions: ["No certification claim"],
      assumptions: ["Controlled demonstrator"],
      openQuestions: ["Payload remains open"],
    },
  });
  return await service.approveBrief(HUMAN, {
    commandId: "approve-drone-brief",
    discoveryId: discovery.discoveryId,
    expectedRevision: discovery.revision,
    issuedAt: "2026-08-02T09:59:20.000Z",
    briefId: discovery.brief!.id,
    rationale: "The brief is clear enough to create a bounded project path.",
    inputFingerprint: discovery.review!.inputFingerprint,
  });
}

class PassthroughLease implements EngineeringProjectRunLease {
  withLease<T>(
    _projectId: string,
    _runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }
}

class CaptureBarrierStore extends FileApprovedDiscoveryBaselineCaptureStore {
  readonly entered = deferred<void>();
  readonly release = deferred<void>();

  override async save(
    ...args: Parameters<FileApprovedDiscoveryBaselineCaptureStore["save"]>
  ) {
    this.entered.resolve();
    await this.release.promise;
    return await super.save(...args);
  }
}

class SaveThenThrowSnapshotStore implements ThreadSnapshotStore {
  #loseAcknowledgement = true;

  constructor(private readonly inner: ThreadSnapshotStore) {}

  get(snapshotId: string) {
    return this.inner.get(snapshotId);
  }

  latest(subjectId: string) {
    return this.inner.latest(subjectId);
  }

  async save(...args: Parameters<ThreadSnapshotStore["save"]>): Promise<void> {
    await this.inner.save(...args);
    if (this.#loseAcknowledgement) {
      this.#loseAcknowledgement = false;
      throw new Error("simulated post-commit snapshot acknowledgement loss");
    }
  }
}

class BarrierLease implements EngineeringProjectRunLease {
  constructor(
    private readonly inner: EngineeringProjectRunLease,
    private readonly barrier: ExecutionLeaseBarrier,
  ) {}

  withLease<T>(
    projectId: string,
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.inner.withLease(projectId, runId, async () => {
      await this.barrier.enter();
      return await operation();
    });
  }
}

class ExecutionLeaseBarrier {
  readonly firstEntered = deferred<void>();
  readonly releaseFirst = deferred<void>();
  #entries = 0;
  secondEntered = false;

  async enter(): Promise<void> {
    this.#entries += 1;
    if (this.#entries === 1) {
      this.firstEntered.resolve();
      await this.releaseFirst.promise;
      return;
    }
    this.secondEntered = true;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
