import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { EngineeringProjectCommandService } from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/platform/syson-model-seed.ts";
import type { ContentFingerprint } from "../../domain/thread/thread-snapshot.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../captures/file-capture-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import {
  FileInspectionDroneV4ArchitectureAttemptStore,
  InspectionDroneV4ArchitectureWriteOutcomeUnknownError,
} from "../wal/file-inspection-drone-v4-architecture-attempt-store.ts";
import { FileSysonModelSeedAttemptStore } from "../wal/file-syson-model-seed-attempt-store.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../orchestration/operations/inspection-drone-v4.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import {
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION,
  InspectionDroneV4ArchitectureRunExecutor,
} from "./inspection-drone-v4-architecture-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const PROJECT_ID = "inspection-drone-v4";
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

Deno.test("inspection-drone architecture attests the complete recursive qualitative contract, persists it, and replays without a second insert", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-architecture-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const executor = architectureExecutor(fixture, syson, directory);

    const completed = await executor.execute(AGENT, executionCommand(fixture.queued));
    const run = completed.agentRuns.at(-1)!;
    assertEquals(run.status, "completed");
    assertEquals(run.resultSnapshot?.revision, 3);
    assertEquals(syson.insertCount, 1);
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_element_children",
      "syson_part_structure",
      ...INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map(() => "syson_query_aql"),
      ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map(() => "syson_query_aql"),
    ]);
    assertEquals(
      syson.calls.find((call) => call.name === "syson_part_structure")?.arguments,
      {
        editing_context_id: "editing-context-456",
        root_element_id: "definition-inspection-drone",
        max_depth: 1,
        include_attributes: false,
        flatten: false,
      },
    );

    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    const artifact = snapshot.artifacts.find((candidate) =>
      candidate.id.startsWith("inspection-drone-v4-architecture-")
    );
    assertExists(artifact);
    const capture = JSON.parse(
      await fixture.captures.read(artifact.fingerprint) ?? "",
    ) as {
      readback?: {
        provider?: {
          partStructureTool?: unknown;
          partUsageFeatureTypingQuery?: unknown;
          requirementDocumentationQuery?: unknown;
        };
        inspectionDrone?: { label?: unknown };
        partUsages?: readonly {
          usage?: { label?: unknown };
          type?: { label?: unknown };
        }[];
        requirements?: readonly {
          requirement?: { label?: unknown };
          documentation?: unknown;
        }[];
      };
    };
    assertEquals(capture.readback?.provider, {
      partStructureTool: "syson_part_structure",
      partUsageFeatureTypingQuery:
        INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION,
      requirementDocumentationQuery:
        INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION,
    });
    assertEquals(capture.readback?.inspectionDrone?.label, "InspectionDrone");
    assertEquals(
      capture.readback?.partUsages?.map((item) => [
        item.usage?.label,
        item.type?.label,
      ]),
      INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map((item) => [
        item.label,
        item.type,
      ]),
    );
    assertEquals(
      capture.readback?.requirements?.map((item) => [
        item.requirement?.label,
        item.documentation,
      ]),
      INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((item) => [
        item.label,
        item.documentation,
      ]),
    );

    const replay = await executor.execute(AGENT, executionCommand(fixture.queued));
    assertEquals(replay.revision, completed.revision);
    assertEquals(syson.insertCount, 1, "WAL replay must not insert twice");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

for (
  const scenario of [
    {
      name: "missing PartUsage",
      options: { omitUsage: "energySystem" },
      expected: "exactly the five direct InspectionDrone PartUsages",
    },
    {
      name: "wrong PartUsage type",
      options: { wrongUsageType: "propulsionSystem" },
      expected: "exact reviewed PropulsionSystem PartDefinition",
    },
    {
      name: "wrong PartUsage type identity behind the expected label",
      options: { wrongUsageTypeIdentity: "propulsionSystem" },
      expected: "exact reviewed PropulsionSystem PartDefinition",
    },
    {
      name: "missing RequirementDefinition",
      options: { omitRequirement: "CameraPayloadIntegration" },
      expected: "reviewed drone declarations and named requirements",
    },
    {
      name: "altered qualitative/TBD requirement text",
      options: { alterRequirement: "ExplicitOperationalTbd" },
      expected: "differs from the reviewed qualitative/TBD requirement text",
    },
    {
      name: "provider response shape drift",
      options: { partStructureShapeDrift: true },
      expected: "unsupported shape",
    },
    {
      name: "FeatureTyping response shape drift",
      options: { aqlShapeDrift: "featureTyping" },
      expected: "unsupported shape",
    },
    {
      name: "requirement-documentation response shape drift",
      options: { aqlShapeDrift: "documentation" },
      expected: "unsupported shape",
    },
  ] as const
) {
  Deno.test(`inspection-drone architecture refuses ${scenario.name} and does not publish r3`, async () => {
    const directory = await Deno.makeTempDir({ prefix: "inspection-drone-readback-" });
    try {
      const fixture = await queuedArchitecture(directory);
      const syson = new ArchitectureSyson(scenario.options);
      await assertRejects(
        () =>
          architectureExecutor(fixture, syson, directory).execute(
            AGENT,
            executionCommand(fixture.queued),
          ),
        Error,
        scenario.expected,
      );
      await assertNoR3Published(fixture);
      assertEquals(syson.insertCount, 1);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}

Deno.test("inspection-drone architecture rejects a non-empty seeded root before insertion or r3 publication", async () => {
  const directory = await Deno.makeTempDir({ prefix: "inspection-drone-root-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson({ rootNonEmpty: true });
    await assertRejects(
      () =>
        architectureExecutor(fixture, syson, directory).execute(
          AGENT,
          executionCommand(fixture.queued),
        ),
      Error,
      "seed root must be empty",
    );
    assertEquals(syson.insertCount, 0);
    await assertNoR3Published(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture replays one acknowledged insert only after its contractual readback becomes conformant", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-post-ack-readback-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const provider = { partStructureShapeDrift: true };
    const syson = new ArchitectureSyson(provider);
    const executor = architectureExecutor(fixture, syson, directory);
    const command = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "unsupported shape",
    );
    await assertNoR3Published(fixture);
    assertEquals(syson.insertCount, 1);
    assertEquals(
      (await fixture.attempts.read(PROJECT_ID, command.runId))?.status,
      "completed",
    );
    const afterFailedReadback = await fixture.projects.get(PROJECT_ID);
    assertExists(afterFailedReadback);
    assertEquals(afterFailedReadback.agentRuns.at(-1)?.status, "running");
    assertEquals(
      architectureClaimReceiptCount(afterFailedReadback, command.commandId),
      1,
    );

    provider.partStructureShapeDrift = false;
    const completed = await executor.execute(AGENT, command);
    assertEquals(completed.threadSnapshots.at(-1)?.revision, 3);
    assertEquals(completed.agentRuns.at(-1)?.resultSnapshot?.revision, 3);
    assertEquals(syson.insertCount, 1, "replay must reuse the completed WAL");
    assertEquals(
      architectureClaimReceiptCount(completed, command.commandId),
      1,
      "the repeated command must replay the original claim",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture replays one acknowledged insert after a transient capture persistence readback failure", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-post-ack-persistence-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    let persistedCaptureReadback = false;
    const executor = new InspectionDroneV4ArchitectureRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      seedCaptures: fixture.seedCaptures,
      captures: {
        save: fixture.captures.save.bind(fixture.captures),
        read: async (fingerprint: ContentFingerprint) =>
          persistedCaptureReadback
            ? await fixture.captures.read(fingerprint)
            : '{"tampered":true}',
      } as never,
      attempts: fixture.attempts,
      syson,
      lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
      now: () => "2026-08-08T05:00:00.000Z",
    });
    const command = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, command),
      Error,
      "capture did not read back exactly",
    );
    await assertNoR3Published(fixture);
    assertEquals(syson.insertCount, 1);
    assertEquals(
      (await fixture.attempts.read(PROJECT_ID, command.runId))?.status,
      "completed",
    );
    const afterFailedPersistence = await fixture.projects.get(PROJECT_ID);
    assertExists(afterFailedPersistence);
    assertEquals(
      architectureClaimReceiptCount(afterFailedPersistence, command.commandId),
      1,
    );

    persistedCaptureReadback = true;
    const completed = await executor.execute(AGENT, command);
    assertEquals(completed.threadSnapshots.at(-1)?.revision, 3);
    assertEquals(completed.agentRuns.at(-1)?.resultSnapshot?.revision, 3);
    assertEquals(syson.insertCount, 1, "replay must not insert a second time");
    assertEquals(
      architectureClaimReceiptCount(completed, command.commandId),
      1,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture never reinserts an unknown dispatched WAL outcome", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-dispatched-unknown-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const command = executionCommand(fixture.queued);
    assertEquals(
      await fixture.attempts.begin({
        projectId: PROJECT_ID,
        runId: command.runId,
        dispatchedAt: command.issuedAt,
      }),
      { action: "dispatch" },
    );
    const syson = new ArchitectureSyson();

    await assertRejects(
      () => architectureExecutor(fixture, syson, directory).execute(AGENT, command),
      InspectionDroneV4ArchitectureWriteOutcomeUnknownError,
    );
    assertEquals(syson.insertCount, 0);
    assertEquals(syson.calls, []);
    await assertNoR3Published(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture refuses a capture that does not read back exactly", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-capture-readback-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const executor = new InspectionDroneV4ArchitectureRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      seedCaptures: fixture.seedCaptures,
      captures: {
        save: fixture.captures.save.bind(fixture.captures),
        read: () => Promise.resolve('{"tampered":true}'),
      } as never,
      attempts: fixture.attempts,
      syson,
      lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
      now: () => "2026-08-08T05:00:00.000Z",
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "capture did not read back exactly",
    );
    await assertNoR3Published(fixture);
    assertEquals(syson.insertCount, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture refuses a snapshot that does not read back exactly", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-snapshot-readback-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const executor = new InspectionDroneV4ArchitectureRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: {
        save: fixture.snapshots.save.bind(fixture.snapshots),
        get: async (snapshotId: string) => {
          const snapshot = await fixture.snapshots.get(snapshotId);
          return snapshot?.revision === 3 ? undefined : snapshot;
        },
      } as never,
      seedCaptures: fixture.seedCaptures,
      captures: fixture.captures,
      attempts: fixture.attempts,
      syson,
      lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
      now: () => "2026-08-08T05:00:00.000Z",
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "snapshot did not read back exactly",
    );
    await assertNoR3Published(fixture);
    assertEquals(syson.insertCount, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture rejects a wrong subject before reading a capture or provider", async () => {
  let providerCalled = false;
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: { id: PROJECT_ID, subjectId: "project:other" },
          agentRuns: [{
            id: "run:architecture",
            workItemId: "architecture",
            status: "queued",
          }],
          workItems: [{
            id: "architecture",
            operation: canonicalOperation({}),
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: { get: () => Promise.reject(new Error("must not read")) } as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) } as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
    } as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(AGENT, malformedCommand()),
    Error,
    "canonical inspection-drone-v4 architecture",
  );
  assertEquals(providerCalled, false);
});

Deno.test("inspection-drone architecture rejects the wrong registered operation before provider access", async () => {
  let providerCalled = false;
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: { id: PROJECT_ID, subjectId: `project:${PROJECT_ID}` },
          agentRuns: [{
            id: "run:architecture",
            workItemId: "architecture",
            status: "queued",
          }],
          workItems: [{
            id: "architecture",
            operation: { ...canonicalOperation({}), id: "architecture.other" },
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: { get: () => Promise.reject(new Error("must not read")) } as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) } as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
    } as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(AGENT, malformedCommand()),
    Error,
    "canonical inspection-drone-v4 architecture",
  );
  assertEquals(providerCalled, false);
});

Deno.test("inspection-drone architecture rejects the wrong basis before reading a capture or provider", async () => {
  let providerCalled = false;
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: { id: PROJECT_ID, subjectId: `project:${PROJECT_ID}` },
          agentRuns: [{
            id: "run:architecture",
            workItemId: "architecture",
            status: "queued",
            basis: {
              kind: "thread-snapshot",
              snapshotId: "wrong-r2",
              revision: 99,
              subjectId: `project:${PROJECT_ID}`,
            },
          }],
          workItems: [{ id: "architecture", operation: canonicalOperation({}) }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: { get: () => Promise.reject(new Error("must not read")) } as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) } as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
    } as never,
    lease: {
      withLease: (_projectId: string, _runId: string, task: () => Promise<unknown>) =>
        task(),
    } as never,
  });
  await assertRejects(
    () => executor.execute(AGENT, malformedCommand()),
    Error,
    "exact r2 inspection-drone-v4 SysON seed snapshot",
  );
  assertEquals(providerCalled, false);
});

Deno.test("inspection-drone architecture rejects an unreadable bound seed capture before provider access", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-seed-capture-",
  });
  try {
    const fixture = await queuedArchitecture(directory);
    let providerCalled = false;
    const executor = new InspectionDroneV4ArchitectureRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      seedCaptures: { read: () => Promise.resolve(undefined) } as never,
      captures: fixture.captures,
      attempts: fixture.attempts,
      syson: {
        callTool: () => {
          providerCalled = true;
          return Promise.reject(new Error("must not call"));
        },
      } as never,
      lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "model-seed capture is not readable",
    );
    assertEquals(providerCalled, false);
    await assertNoR3Published(fixture);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("inspection-drone architecture rejects a human before reading project state", async () => {
  const executor = new InspectionDroneV4ArchitectureRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    seedCaptures: {} as never,
    captures: {} as never,
    attempts: {} as never,
    syson: {} as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute(HUMAN, malformedCommand()),
    Error,
    "Only an authenticated agent",
  );
});

function architectureExecutor(
  fixture: Awaited<ReturnType<typeof queuedArchitecture>>,
  syson: McpToolClient,
  directory: string,
) {
  return new InspectionDroneV4ArchitectureRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    seedCaptures: fixture.seedCaptures,
    captures: fixture.captures,
    attempts: fixture.attempts,
    syson,
    lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
    now: () => "2026-08-08T05:00:00.000Z",
  });
}

async function assertNoR3Published(
  fixture: Awaited<ReturnType<typeof queuedArchitecture>>,
): Promise<void> {
  const current = await fixture.projects.get(PROJECT_ID);
  assertExists(current);
  assertEquals(current.threadSnapshots.length, 2);
  assertEquals(current.agentRuns.at(-1)?.resultSnapshot, undefined);
}

function architectureClaimReceiptCount(
  project: { commandReceipts?: readonly { commandId: string }[] },
  commandId: string,
): number {
  return project.commandReceipts?.filter((receipt) =>
    receipt.commandId === `${commandId}:inspection-drone-v4-architecture:claim`
  ).length ?? 0;
}

function executionCommand(
  queued: {
    project: { id: string };
    revision: number;
    agentRuns: readonly { id: string }[];
  },
) {
  return {
    commandId: "agent-author-drone-architecture",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-08T04:45:00.000Z",
    runId: queued.agentRuns.at(-1)!.id,
  };
}

function malformedCommand() {
  return {
    commandId: "execute-drone-architecture",
    projectId: PROJECT_ID,
    expectedRevision: 1,
    issuedAt: "2026-08-08T04:00:00.000Z",
    runId: "run:architecture",
  };
}

function canonicalOperation(seedReference: Record<string, unknown>) {
  return {
    ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }, {
      name: "sysonModelSeed",
      source: { kind: "thread-entity", reference: seedReference },
    }],
  };
}

async function queuedArchitecture(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed-captures`,
  });
  const captures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const seedAttempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const attempts = new FileInspectionDroneV4ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T03:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
  );
  let project = await briefs.startProject(AGENT, {
    commandId: "start-inspection-drone-v4",
    projectId: PROJECT_ID,
    projectName: "Drone inspection demonstrator v4",
    issuedAt: "2026-08-08T02:00:00.000Z",
    intent: "Create a reviewable qualitative inspection-drone architecture.",
    intentSource: { kind: "human", reference: "conversation:inspection-drone" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-inspection-drone-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable qualitative inspection-drone architecture.",
      sourceRefs: [{ kind: "intent", reference: "conversation:inspection-drone" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Inspect a controlled outdoor site with a lightweight camera.",
      sourceRefs: [{ kind: "intent", reference: "conversation:inspection-drone" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement:
        "Keep assumptions and technical evidence traceable without certification claims.",
      sourceRefs: [{ kind: "intent", reference: "conversation:inspection-drone" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-inspection-drone-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The qualitative inspection-drone scope is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await commands.publishPlan(AGENT, {
    ...context("publish-inspection-drone-baseline", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Engineering baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const queuedBaseline = await commands.queueRun(AGENT, {
    ...context("queue-inspection-drone-baseline", project.revision),
    runId: "run:inspection-drone-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved inspection-drone brief.",
    basis: project.plan!.basis,
  });
  const baseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-08T03:30:00.000Z",
  }).execute(AGENT, {
    commandId: "execute-inspection-drone-baseline",
    projectId: PROJECT_ID,
    expectedRevision: queuedBaseline.revision,
    issuedAt: "2026-08-08T03:20:00.000Z",
    runId: "run:inspection-drone-baseline",
  });
  const r1 = baseline.threadSnapshots.at(-1)!;

  project = await commands.appendChange(AGENT, {
    ...context("append-inspection-drone-seed", baseline.revision),
    baseSnapshot: r1,
    phases: [{
      id: "seed-syson",
      name: "SysON model seed",
      description: "Create the exact empty SysON model container.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "seed-syson",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const queuedSeed = await commands.queueRun(AGENT, {
    ...context("queue-inspection-drone-seed", project.revision),
    runId: "run:inspection-drone-seed",
    workItemId: "seed-syson-model",
    summary: "Create the inspection-drone SysON model container.",
    basis: { kind: "thread-snapshot", ...r1 },
  });
  const seeded = await new SysonModelSeedRunExecutor({
    projects,
    commands,
    snapshots,
    captures: seedCaptures,
    attempts: seedAttempts,
    syson: new SeedSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    now: () => "2026-08-08T04:00:00.000Z",
  }).execute(AGENT, {
    commandId: "execute-inspection-drone-seed",
    projectId: PROJECT_ID,
    expectedRevision: queuedSeed.revision,
    issuedAt: "2026-08-08T03:45:00.000Z",
    runId: "run:inspection-drone-seed",
  });
  const r2 = seeded.threadSnapshots.at(-1)!;
  const r2Snapshot = await snapshots.get(r2.snapshotId);
  if (!r2Snapshot) throw new Error("test fixture did not persist the r2 snapshot");
  const seedArtifact = r2Snapshot.artifacts.find((artifact) =>
    artifact.id.startsWith("syson-model-seed-")
  );
  if (!seedArtifact) {
    throw new Error("test fixture did not produce a SysON seed artifact");
  }

  project = await commands.appendChange(AGENT, {
    ...context("append-inspection-drone-architecture", seeded.revision),
    baseSnapshot: r2,
    phases: [{
      id: "architecture",
      name: "Qualitative architecture",
      description: "Author the bounded inspection-drone architecture.",
    }],
    workItems: [{
      id: "author-inspection-drone-architecture",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed-syson-model"],
      decisionIds: [],
      operation: {
        ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }, {
          name: "sysonModelSeed",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: r2.snapshotId,
              snapshotRevision: r2.revision,
              kind: "artifact",
              id: seedArtifact.id,
            },
          },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-inspection-drone-architecture", project.revision),
    runId: "run:inspection-drone-architecture",
    workItemId: "author-inspection-drone-architecture",
    summary: "Author the reviewed qualitative inspection-drone architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });
  return { projects, commands, snapshots, seedCaptures, captures, attempts, queued };
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-08T02:30:00.000Z",
  };
}

class SeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`Unexpected seed text tool ${call.name}`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return Promise.resolve(result({
        id: "syson-project-123",
        name: "Inspection drone",
        editingContextId: "editing-context-456",
      }));
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve(result({
        documentId: "document-789",
        documentName: "Inspection drone",
        documentKind: "Document",
        rootPackageId: "root-package-012",
        rootPackageLabel: "New Package",
      }));
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve(result({
        id: "root-package-012",
        kind: "sysml::Package",
        label: "New Package",
      }));
    }
    return Promise.reject(new Error(`Unexpected seed tool ${call.name}`));
  }
}

interface ArchitectureSysonOptions {
  readonly omitUsage?: string;
  readonly wrongUsageType?: string;
  readonly omitRequirement?: string;
  readonly alterRequirement?: string;
  readonly partStructureShapeDrift?: boolean;
  readonly aqlShapeDrift?: "featureTyping" | "documentation";
  readonly wrongUsageTypeIdentity?: string;
  readonly rootNonEmpty?: boolean;
}

class ArchitectureSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  insertCount = 0;
  #rootReads = 0;

  constructor(private readonly options: ArchitectureSysonOptions = {}) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`Unexpected architecture text tool ${call.name}`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      this.insertCount++;
      return Promise.resolve(result({
        inserted: true,
        parentId: call.arguments?.parent_id,
        text: call.arguments?.sysml_text,
      }));
    }
    if (call.name === "syson_element_children") {
      return Promise.resolve(this.children(call));
    }
    if (call.name === "syson_part_structure") {
      return Promise.resolve(this.partStructure());
    }
    if (call.name === "syson_query_aql") {
      return Promise.resolve(this.query(call));
    }
    return Promise.reject(new Error(`Unexpected architecture tool ${call.name}`));
  }

  private children(call: McpToolCall): McpToolResult {
    const parentId = call.arguments?.element_id;
    if (parentId === "root-package-012") {
      this.#rootReads++;
      if (this.#rootReads === 1) {
        const children = this.options.rootNonEmpty
          ? [{ id: "unexpected", kind: "sysml::Package", label: "Unexpected" }]
          : [];
        return result({ parentId, children, count: children.length });
      }
      return result({
        parentId,
        children: [{
          id: "drone-package",
          kind: "sysml::Package",
          label: "InspectionDroneArchitecture",
        }],
        count: 1,
      });
    }
    if (parentId === "drone-package") {
      const children = declarationChildren().filter((child) =>
        child.label !== this.options.omitRequirement
      );
      return result({ parentId, children, count: children.length });
    }
    throw new Error(`Unexpected children parent ${String(parentId)}`);
  }

  private partStructure(): McpToolResult {
    const tree = INSPECTION_DRONE_V4_PART_USAGE_CONTRACT
      .filter((usage) => usage.label !== this.options.omitUsage)
      .map((usage) => ({
        id: `usage-${usage.label}`,
        label: usage.label,
        kind: "sysml::PartUsage",
        quantity: 1,
        quantitySource: "sysml-default",
        children: [],
      }));
    const value: Record<string, unknown> = {
      root: {
        id: "definition-inspection-drone",
        label: "InspectionDrone",
        kind: "sysml::PartDefinition",
      },
      tree,
      partCount: tree.length,
      maxDepthReached: false,
    };
    if (this.options.partStructureShapeDrift) value.unexpected = true;
    return result(value);
  }

  private query(call: McpToolCall): McpToolResult {
    const objectId = call.arguments?.object_id;
    const expression = call.arguments?.expression;
    if (expression === INSPECTION_DRONE_V4_PART_USAGE_FEATURE_TYPING_EXPRESSION) {
      const usage = INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.find((candidate) =>
        `usage-${candidate.label}` === objectId
      );
      if (!usage) {
        throw new Error(`Unexpected FeatureTyping query ${String(objectId)}`);
      }
      const type = this.options.wrongUsageType === usage.label
        ? "UnexpectedPartDefinition"
        : usage.type;
      const expectedDefinition = declarationChildren().find((candidate) =>
        candidate.label === type
      ) ?? {
        id: `definition-${type}`,
        kind: "sysml::PartDefinition",
        label: type,
      };
      const response: Record<string, unknown> = {
        objectId,
        expression,
        type: "objects",
        results: [{
          id: this.options.wrongUsageTypeIdentity === usage.label
            ? `definition-wrong-${type}`
            : expectedDefinition.id,
          kind: "sysml::PartDefinition",
          label: type,
        }],
        count: 1,
      };
      if (this.options.aqlShapeDrift === "featureTyping") {
        response.unexpected = true;
      }
      return result(response);
    }
    if (expression === INSPECTION_DRONE_V4_REQUIREMENT_DOCUMENTATION_EXPRESSION) {
      const requirement = INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.find((candidate) =>
        `requirement-${candidate.label}` === objectId
      );
      if (!requirement) {
        throw new Error(`Unexpected documentation query ${String(objectId)}`);
      }
      const response: Record<string, unknown> = {
        objectId,
        expression,
        type: "string",
        result: this.options.alterRequirement === requirement.label
          ? "Altered provider text"
          : requirement.documentation,
      };
      if (this.options.aqlShapeDrift === "documentation") {
        response.unexpected = true;
      }
      return result(response);
    }
    throw new Error(`Unexpected AQL expression ${String(expression)}`);
  }
}

function declarationChildren() {
  return [
    {
      id: "definition-inspection-drone",
      kind: "sysml::PartDefinition",
      label: "InspectionDrone",
    },
    {
      id: "definition-airframe",
      kind: "sysml::PartDefinition",
      label: "Airframe",
    },
    {
      id: "definition-energy-system",
      kind: "sysml::PartDefinition",
      label: "EnergySystem",
    },
    {
      id: "definition-propulsion-system",
      kind: "sysml::PartDefinition",
      label: "PropulsionSystem",
    },
    {
      id: "definition-avionics-and-flight-control",
      kind: "sysml::PartDefinition",
      label: "AvionicsAndFlightControl",
    },
    {
      id: "definition-inspection-camera-payload",
      kind: "sysml::PartDefinition",
      label: "InspectionCameraPayload",
    },
    ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement) => ({
      id: `requirement-${requirement.label}`,
      kind: "sysml::RequirementDefinition",
      label: requirement.label,
    })),
  ];
}

function result(structuredContent: Record<string, unknown>): McpToolResult {
  return { text: "read", structuredContent };
}
