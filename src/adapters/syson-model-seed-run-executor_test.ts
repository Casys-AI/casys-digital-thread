import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { EngineeringProjectCommandService } from "../domain/engineering-project-command-service.ts";
import { ProjectDiscoveryHandoffService } from "../domain/project-discovery-handoff-service.ts";
import { ProjectDiscoveryCommandService } from "../domain/project-discovery-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { ApprovedDiscoveryBaselineRunExecutor } from "./approved-discovery-baseline-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "./engineering-project-completion-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "./engineering-project-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "./engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "./file-approved-discovery-baseline-capture-store.ts";
import { FileSysonModelSeedAttemptStore } from "./file-syson-model-seed-attempt-store.ts";
import { FileSysonModelSeedCaptureStore } from "./file-syson-model-seed-capture-store.ts";
import { FileThreadSnapshotStore } from "./file-thread-snapshot-store.ts";
import { FileLiveThreadUpdateStore } from "./live-thread-update-store.ts";
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";
import { materializeSysonModelSeed } from "../domain/syson-model-seed.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

Deno.test("trusted SysON seed creates only the read-back model container and publishes r2", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-executor-" });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const executor = seedExecutor(fixture, syson);
    const execution = executionCommand(fixture.queued);

    const completed = await executor.execute(AGENT, execution);
    const run = completed.agentRuns.find((item) => item.id === execution.runId);
    assertExists(run);
    assertEquals(run.status, "completed");
    assertEquals(run.basis?.kind, "thread-snapshot");
    assertEquals(completed.threadSnapshots.length, 2);
    const result = run.resultSnapshot;
    assertExists(result);
    assertEquals(result.revision, 2);
    const snapshot = await fixture.snapshots.get(result.snapshotId);
    assertExists(snapshot);
    assertEquals(snapshot.artifacts.map((artifact) => artifact.kind), [
      "document",
      "sysml-model",
    ]);
    assertEquals(snapshot.requirements, []);
    assertEquals(snapshot.evaluations, []);
    assertEquals(snapshot.violations, []);
    assertEquals(snapshot.proposedActions, []);
    const model = snapshot.artifacts.at(-1)!;
    assertEquals(
      await fixture.seedCaptures.read(model.fingerprint) !== undefined,
      true,
    );
    assertEquals(model.uri, fixture.seedCaptures.uriFor(model.fingerprint));
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_project_create",
      "syson_model_create",
      "syson_element_get",
    ]);
    assertEquals(
      (syson.calls[1]!.arguments as Record<string, unknown>).create_root_package,
      true,
    );
    assertEquals(
      JSON.stringify(syson.calls).includes("syson_element_insert_sysml"),
      false,
    );

    const replay = await executor.execute(AGENT, execution);
    assertEquals(replay.revision, completed.revision);
    assertEquals(syson.calls.length, 3);
    assertEquals(
      (await fixture.liveUpdates.list(completed.project.subjectId))
        .filter((update) => update.runId === execution.runId)
        .map((update) => update.state),
      ["running", "fresh", "running", "fresh", "running", "fresh", "reconciled"],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("an uncertain SysON project creation is never replayed automatically", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-unknown-" });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient("provider timeout after an unknown mutation");
    const executor = seedExecutor(fixture, syson);
    const execution = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "will not retry it automatically",
    );
    assertEquals(syson.calls.map((call) => call.name), ["syson_project_create"]);
    const attempt = await fixture.attempts.read(
      fixture.queued.project.id,
      execution.runId,
      "project-create",
    );
    assertEquals(attempt?.status, "dispatched");
    assertEquals(
      JSON.stringify(await fixture.projects.get(fixture.queued.project.id)).includes(
        "provider timeout",
      ),
      false,
    );

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "will not retry it automatically",
    );
    assertEquals(syson.calls.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a non-documentary seed basis cannot claim a run or call SysON", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-invalid-base-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const documentary = await fixture.snapshots.get(
      fixture.queued.threadSnapshots[0]!.snapshotId,
    );
    assertExists(documentary);
    const laterTechnicalSnapshot = await materializeSysonModelSeed({
      base: documentary,
      trustedRunId: "another-trusted-run",
      capturedAt: "2026-08-02T12:04:00.000Z",
      projectCreateResult: {
        id: "other-project",
        name: "Other project",
        editingContextId: "other-context",
      },
      modelCreateResult: {
        documentId: "other-document",
        documentName: "Other document",
        documentKind: "Document",
        rootPackageId: "other-root",
        rootPackageLabel: "Other Root",
      },
      rootPackageGetResult: {
        id: "other-root",
        kind: "Package",
        label: "Other Root",
      },
    });
    await fixture.snapshots.save(laterTechnicalSnapshot.snapshot);

    const current = await fixture.projects.get(fixture.queued.project.id);
    assertExists(current);
    const invalidBasisProject = {
      ...current,
      id: `${current.project.id}:project:r${current.revision + 1}:invalid-seed-basis`,
      revision: current.revision + 1,
      generatedAt: "2026-08-02T12:05:00.000Z",
      previous: { snapshotId: current.id, revision: current.revision },
      threadSnapshots: [
        ...current.threadSnapshots,
        {
          snapshotId: laterTechnicalSnapshot.snapshot.id,
          revision: laterTechnicalSnapshot.snapshot.revision,
          subjectId: laterTechnicalSnapshot.snapshot.subject.id,
        },
      ],
      agentRuns: current.agentRuns.map((run) =>
        run.id === fixture.queued.agentRuns.at(-1)!.id
          ? {
            ...run,
            basis: {
              kind: "thread-snapshot" as const,
              snapshotId: laterTechnicalSnapshot.snapshot.id,
              revision: laterTechnicalSnapshot.snapshot.revision,
              subjectId: laterTechnicalSnapshot.snapshot.subject.id,
            },
          }
          : run
      ),
    };
    const invalidBasisProjectStore = Object.create(
      fixture.projects,
    ) as typeof fixture.projects;
    invalidBasisProjectStore.get = (projectId: string) =>
      Promise.resolve(
        projectId === fixture.queued.project.id
          ? structuredClone(invalidBasisProject)
          : undefined,
      );
    const syson = new FakeSysonClient();
    const executor = seedExecutor(fixture, syson, invalidBasisProjectStore);
    const execution = {
      ...executionCommand(fixture.queued),
      expectedRevision: invalidBasisProject.revision,
    };

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "requires the exact documentary ThreadSnapshot revision 1 root",
    );
    assertEquals(syson.calls, []);
    const after = await fixture.projects.get(fixture.queued.project.id);
    assertExists(after);
    assertEquals(after.revision, current.revision);
    assertEquals(
      after.agentRuns.find((run) => run.id === execution.runId)?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function seedExecutor(
  fixture: Awaited<ReturnType<typeof queuedSeed>>,
  syson: McpToolClient,
  projects = fixture.projects,
) {
  return new SysonModelSeedRunExecutor({
    projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    captures: fixture.seedCaptures,
    attempts: fixture.attempts,
    syson,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/seed-leases`),
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-02T12:10:00.000Z",
  });
}

function executionCommand(queued: Awaited<ReturnType<typeof queuedSeed>>["queued"]) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-seed-syson-model",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-02T12:05:00.000Z",
    runId: run.id,
  };
}

async function queuedSeed(directory: string) {
  const discoveries = new FileProjectDiscoveryRevisionStore(`${directory}/discoveries`);
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileApprovedDiscoveryBaselineCaptureStore(
    `${directory}/baseline-captures`,
  );
  const seedCaptures = new FileSysonModelSeedCaptureStore(`${directory}/seed-captures`);
  const attempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
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
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    () =>
      new Date(Date.parse("2026-08-02T12:01:00.000Z") + ++tick * 1_000)
        .toISOString(),
    { discoveries, operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );
  const planned = await commands.publishPlan(AGENT, stagedPlanCommand(handoff));
  const queuedBaseline = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-documentary-baseline",
    projectId: planned.project.id,
    expectedRevision: planned.revision,
    issuedAt: "2026-08-02T12:01:30.000Z",
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
    liveUpdates,
    now: () => "2026-08-02T12:02:00.000Z",
  });
  const baselineCompleted = await baselineExecutor.execute(AGENT, {
    commandId: "agent-record-documentary-baseline",
    projectId: queuedBaseline.project.id,
    expectedRevision: queuedBaseline.revision,
    issuedAt: "2026-08-02T12:02:00.000Z",
    runId: "run:documentary-baseline",
  });
  const base = baselineCompleted.threadSnapshots[0]!;
  const queued = await commands.queueRun(HUMAN, {
    commandId: "human-authorize-syson-seed",
    projectId: baselineCompleted.project.id,
    expectedRevision: baselineCompleted.revision,
    issuedAt: "2026-08-02T12:03:00.000Z",
    runId: "run:seed-syson-model",
    workItemId: "seed-syson-model",
    summary: "Human authorized the first editable system model container.",
    basis: { kind: "thread-snapshot", ...base },
  });
  return {
    directory,
    attempts,
    commands,
    liveUpdates,
    projects,
    queued,
    seedCaptures,
    snapshots,
  };
}

function stagedPlanCommand(project: { project: { id: string } }) {
  return {
    commandId: "agent-publish-staged-plan",
    projectId: project.project.id,
    expectedRevision: 1,
    issuedAt: "2026-08-02T12:00:30.000Z",
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
        description: "Create the first traceable system-model container.",
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
    ],
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

class FakeSysonClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(private readonly projectCreateFailure?: string) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_project_create" && this.projectCreateFailure) {
      return Promise.reject(new Error(this.projectCreateFailure));
    }
    switch (call.name) {
      case "syson_project_create":
        return Promise.resolve({
          structuredContent: {
            id: "syson-project-123",
            name: "Drone model seed",
            editingContextId: "editing-context-456",
          },
          text: "created",
        });
      case "syson_model_create":
        return Promise.resolve({
          structuredContent: {
            documentId: "document-789",
            documentName: "Drone system model",
            documentKind: "Document",
            rootPackageId: "root-package-012",
            rootPackageLabel: "New Package",
          },
          text: "created",
        });
      case "syson_element_get":
        return Promise.resolve({
          structuredContent: {
            id: "root-package-012",
            kind: "Package",
            label: "New Package",
            iconURLs: [],
          },
          text: "read",
        });
      default:
        return Promise.reject(new Error(`Unexpected SysON tool ${call.name}`));
    }
  }
}
