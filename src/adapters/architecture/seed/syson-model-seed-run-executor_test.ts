import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
} from "../../../orchestration/operations/registry.ts";
import { ApprovedBriefBaselineRunExecutor } from "../../project/approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../../testing/approved-brief-source-analysis-fixture.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "../../shared/stores/engineering-project-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../project/engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FileSysonModelSeedAttemptStore } from "./file-syson-model-seed-attempt-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import { FileThreadSnapshotStore } from "../../shared/stores/file-thread-snapshot-store.ts";
import { FileLiveThreadUpdateStore } from "../../shared/stores/live-thread-update-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import {
  materializeSysonModelSeed,
  SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
} from "../../../domain/architecture/seed/syson-model-seed.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import { CapabilityRuntimeConnectionError } from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import { passthroughCapabilityRuntimeConnection } from "../../../testing/capability-runtime-execution-session-test-support.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const HUMAN = {
  kind: "human" as const,
  actorId: "mcp-elicitation:paired-chat@1",
};
const AGENT = { kind: "agent" as const, actorId: "mcp:paired-chat@1" };
const V3_SEED_OPERATION: RegisteredEngineeringOperation = {
  id: "architecture.seed-syson-model",
  version: "2",
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Create the first editable system model",
  description:
    "Create a traceable SysML system-model container after the approved brief baseline.",
  workItemKind: "architect",
  riskClass: "consequential",
  execution: "trusted",
  runtimeDemand: {
    kind: "required",
    capabilities: [{
      id: "model.author-system",
      version: "1",
      minimumQualification: "qualified",
      use: "execution",
    }],
  },
  requiresDependsOnOperation: {
    id: "baseline.from-approved-brief",
    version: "1",
  },
  bindings: [{ name: "approvedBrief", allowedSourceKinds: ["approved-brief"] }],
};
const TEST_OPERATION_REGISTRY: EngineeringProjectPlanOperationRegistry = {
  validate(input) {
    const candidate = input as {
      operation?: {
        id?: unknown;
        version?: unknown;
        bindings?: unknown;
      };
      stage?: unknown;
      basisKind?: unknown;
    };
    if (!isV3Seed(candidate.operation ?? {})) {
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(
        input as RegisteredEngineeringOperationInput,
      );
    }
    const bindings = candidate.operation?.bindings;
    if (
      (candidate.stage !== "planning" && candidate.stage !== "queue") ||
      (candidate.stage === "queue" && candidate.basisKind !== "thread-snapshot") ||
      !Array.isArray(bindings) || bindings.length !== 1 ||
      bindings[0]?.name !== "approvedBrief" ||
      bindings[0]?.source?.kind !== "approved-brief"
    ) throw new Error("Invalid V3 SysON seed operation input.");
    return {
      operation: V3_SEED_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(bindings),
    };
  },
};

function isV3Seed(reference: { id?: unknown; version?: unknown }): boolean {
  return reference.id === V3_SEED_OPERATION.id &&
    reference.version === V3_SEED_OPERATION.version;
}

Deno.test("trusted SysON seed creates only the read-back model container and publishes r2", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-executor-" });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const session = recordingSeedSession();
    const connection = passthroughCapabilityRuntimeConnection(syson);
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
    });
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
    assertEquals(session.events, ["begin"]);
    assertEquals(connection.opens, 1);
    assertEquals(session.releases, 1);
    assertEquals(session.retains, 0);
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

Deno.test("an uncertain SysON project creation becomes a recoverable terminal failure and is never replayed", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-unknown-" });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient("provider timeout after an unknown mutation");
    const session = recordingSeedSession();
    const executor = seedExecutor(fixture, syson, fixture.projects, { session });
    const execution = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "failed and quarantined",
    );
    assertEquals(syson.calls.map((call) => call.name), ["syson_project_create"]);
    assertEquals(session.events, ["begin"]);
    assertEquals(session.releases, 0);
    assertEquals(session.retains, 1);
    const attempt = await fixture.attempts.read(
      fixture.queued.project.id,
      execution.runId,
      "project-create",
    );
    assertEquals(attempt?.status, "dispatched");
    const quarantined = await fixture.projects.get(fixture.queued.project.id);
    const failedRun = quarantined?.agentRuns.find((run) => run.id === execution.runId);
    assertEquals(failedRun?.status, "failed");
    assertEquals(
      failedRun?.failure?.code,
      SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
    );
    assertEquals(
      TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES.has(
        failedRun?.failure?.code ?? "",
      ),
      true,
    );
    assertEquals(
      JSON.stringify(quarantined).includes(
        "provider timeout",
      ),
      false,
    );

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "is failed; a human must review",
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
      lineage: seedLineage(fixture.queued, documentary),
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
      "must be the unique completed baseline.from-approved-brief@1 result",
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

Deno.test("a seed whose exact brief revision is not human-approved cannot claim or call SysON", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-unapproved-brief-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const basis = fixture.queued.plan!.basis;
    if (basis.kind !== "approved-brief") throw new Error("Expected V3 brief basis.");
    const approved = await fixture.projects.getRevision(
      basis.projectId,
      basis.projectRevision,
    );
    assertExists(approved);
    const unapproved = {
      ...approved,
      framing: {
        ...approved.framing!,
        currentBriefApproval: {
          ...approved.framing!.currentBriefApproval!,
          decidedBy: { id: "agent:impostor", origin: "agent" as const },
        },
      },
    };
    const projectStore = Object.create(
      fixture.projects,
    ) as typeof fixture.projects;
    projectStore.getRevision = (projectId: string, revision: number) =>
      Promise.resolve(
        projectId === basis.projectId && revision === basis.projectRevision
          ? structuredClone(unapproved)
          : undefined,
      );
    const syson = new FakeSysonClient();
    const executor = seedExecutor(fixture, syson, projectStore);
    const execution = executionCommand(fixture.queued);

    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "exact human-approved living brief",
    );
    assertEquals(syson.calls, []);
    assertEquals(
      (await fixture.projects.get(fixture.queued.project.id))?.agentRuns.at(-1)
        ?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON seed opens the JIT session before claim, WAL, or provider", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-syson-seed-jit-order-" });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const events: string[] = [];
    const session = recordingSeedSession(async (input) => {
      events.push("begin");
      assertEquals(
        input.operationalCapability.bindings.map((binding) => binding.capability.id),
        ["model.author-system"],
      );
      await input.recheck();
      return {
        lease: { id: "capability-jit-seed" } as CapabilityRuntimeExecutionSession[
          "lease"
        ],
        releaseTerminal: () => Promise.resolve(),
        retainForRecovery: () => undefined,
      };
    });
    const connection = passthroughCapabilityRuntimeConnection(syson, events);
    const commands = Object.create(fixture.commands) as typeof fixture.commands;
    commands.claimRun = (origin, command) => {
      events.push("claim");
      return fixture.commands.claimRun(origin, command);
    };
    const attempts = Object.create(fixture.attempts) as typeof fixture.attempts;
    attempts.begin = (input) => {
      events.push(`wal:${input.step}`);
      return fixture.attempts.begin(input);
    };
    const originalCall = syson.callTool.bind(syson);
    syson.callTool = (call) => {
      events.push(`provider:${call.name}`);
      return originalCall(call);
    };
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
      commands,
      attempts,
    });
    await executor.execute(AGENT, executionCommand(fixture.queued));
    assertEquals(events[0], "begin");
    assertEquals(events.includes("connect"), true);
    assertEquals(events.includes("open"), true);
    assertEquals(events.indexOf("begin") < events.indexOf("connect"), true);
    assertEquals(events.indexOf("connect") < events.indexOf("open"), true);
    assertEquals(events.indexOf("open") < events.indexOf("claim"), true);
    assertEquals(events.indexOf("claim") < events.indexOf("wal:project-create"), true);
    assertEquals(
      events.indexOf("wal:project-create") <
        events.indexOf("provider:syson_project_create"),
      true,
    );
    assertEquals(connection.opens, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a failed runtime connection after JIT begin does not construct or call SysON", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-connection-failed-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const session = recordingSeedSession();
    const connection = {
      ...passthroughCapabilityRuntimeConnection(syson),
      broker: {
        connect: () =>
          Promise.reject(
            new CapabilityRuntimeConnectionError(
              "exact SysON publication is unavailable",
            ),
          ),
      },
    };
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
    });
    await assertRejects(
      () => executor.execute(AGENT, executionCommand(fixture.queued)),
      Error,
      "publication is unavailable",
    );
    assertEquals(session.events, ["begin"]);
    assertEquals(session.releases, 1);
    assertEquals(session.retains, 0);
    assertEquals(connection.opens, 0);
    assertEquals(syson.calls, []);
    assertEquals(
      (await fixture.projects.get(fixture.queued.project.id))?.agentRuns.at(-1)
        ?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("JIT unavailability before claim leaves run, WAL, Thread and SysON intact", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-jit-unavailable-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const session = recordingSeedSession(() =>
      Promise.reject(new Error("exact SysON host group unavailable"))
    );
    const connection = passthroughCapabilityRuntimeConnection(syson);
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
    });
    const execution = executionCommand(fixture.queued);
    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "host group unavailable",
    );
    assertEquals(syson.calls, []);
    assertEquals(connection.opens, 0);
    assertEquals(
      await fixture.attempts.read(
        fixture.queued.project.id,
        execution.runId,
        "project-create",
      ),
      undefined,
    );
    const after = await fixture.projects.get(fixture.queued.project.id);
    assertEquals(
      after?.agentRuns.find((run) => run.id === execution.runId)?.status,
      "queued",
    );
    assertEquals(after?.threadSnapshots.length, fixture.queued.threadSnapshots.length);
    assertEquals(session.releases, 0);
    assertEquals(session.retains, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON seed rechecks the sealed operational capability before claim", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-capability-recheck-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const connection = passthroughCapabilityRuntimeConnection(syson);
    let requireCalls = 0;
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      connection,
      capabilityRuntime: {
        requireExecution: () => {
          requireCalls++;
          if (requireCalls > 1) {
            return Promise.reject(
              new Error(
                "Operational capability changed after its sealed ROP recheck; requeue through a reviewed authorization amendment.",
              ),
            );
          }
          return Promise.resolve(
            seedOperationalCapability(fixture.queued.project.id),
          );
        },
      },
    });
    const execution = executionCommand(fixture.queued);
    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "sealed ROP recheck",
    );
    assertEquals(requireCalls, 2);
    assertEquals(syson.calls, []);
    assertEquals(connection.opens, 0);
    assertEquals(
      (await fixture.projects.get(fixture.queued.project.id))?.agentRuns.at(-1)
        ?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a dispatched seed WAL forbids JIT begin, claim, and SysON", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-wal-dispatched-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const execution = executionCommand(fixture.queued);
    await fixture.attempts.begin({
      projectId: fixture.queued.project.id,
      runId: execution.runId,
      step: "project-create",
      dispatchedAt: "2026-08-02T12:05:00.000Z",
    });
    const syson = new FakeSysonClient();
    const session = recordingSeedSession();
    const connection = passthroughCapabilityRuntimeConnection(syson);
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
    });
    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "outcome is unknown",
    );
    assertEquals(session.events, []);
    assertEquals(syson.calls, []);
    assertEquals(connection.opens, 0);
    assertEquals(
      (await fixture.attempts.read(
        fixture.queued.project.id,
        execution.runId,
        "project-create",
      ))?.status,
      "dispatched",
    );
    assertEquals(
      (await fixture.projects.get(fixture.queued.project.id))?.agentRuns.at(-1)
        ?.status,
      "queued",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("model-create without completed project-create forbids JIT begin", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-wal-impossible-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const execution = executionCommand(fixture.queued);
    await fixture.attempts.begin({
      projectId: fixture.queued.project.id,
      runId: execution.runId,
      step: "model-create",
      dispatchedAt: "2026-08-02T12:05:00.000Z",
    });
    const syson = new FakeSysonClient();
    const session = recordingSeedSession();
    const connection = passthroughCapabilityRuntimeConnection(syson);
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      connection,
    });
    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "without a completed project-create",
    );
    assertEquals(session.events, []);
    assertEquals(syson.calls, []);
    assertEquals(connection.opens, 0);
    assertEquals(
      (await fixture.attempts.read(
        fixture.queued.project.id,
        execution.runId,
        "model-create",
      ))?.status,
      "dispatched",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a non-persistable failRun retains the JIT lease on a still-running seed", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-seed-failrun-retain-",
  });
  try {
    const fixture = await queuedSeed(directory);
    const syson = new FakeSysonClient();
    const session = recordingSeedSession();
    const commands = Object.create(fixture.commands) as typeof fixture.commands;
    commands.failRun = () => Promise.reject(new Error("failRun unavailable"));
    const attempts = Object.create(fixture.attempts) as typeof fixture.attempts;
    attempts.begin = () => Promise.reject(new Error("local WAL write failed"));
    const executor = seedExecutor(fixture, syson, fixture.projects, {
      session,
      commands,
      attempts,
    });
    const execution = executionCommand(fixture.queued);
    await assertRejects(
      () => executor.execute(AGENT, execution),
      Error,
      "local WAL write failed",
    );
    assertEquals(session.events, ["begin"]);
    assertEquals(session.releases, 0);
    assertEquals(session.retains, 1);
    assertEquals(syson.calls, []);
    assertEquals(
      (await fixture.projects.get(fixture.queued.project.id))?.agentRuns.at(-1)
        ?.status,
      "running",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function seedExecutor(
  fixture: Awaited<ReturnType<typeof queuedSeed>>,
  syson: McpToolClient,
  projects = fixture.projects,
  extras: {
    readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
    readonly capabilityRuntimeSession?: Pick<
      CapabilityRuntimeExecutionSessionCoordinator,
      "begin"
    >;
    readonly session?: RecordingSeedSession;
    readonly connection?: ReturnType<typeof passthroughCapabilityRuntimeConnection> & {
      readonly opens?: number;
    };
    readonly commands?: typeof fixture.commands;
    readonly attempts?: typeof fixture.attempts;
  } = {},
) {
  const session = extras.session ?? recordingSeedSession();
  const connection = extras.connection ??
    passthroughCapabilityRuntimeConnection(syson);
  return new SysonModelSeedRunExecutor({
    projects,
    commands: extras.commands ?? fixture.commands,
    snapshots: fixture.snapshots,
    captures: fixture.seedCaptures,
    attempts: extras.attempts ?? fixture.attempts,
    capabilityRuntimeConnection: connection,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/seed-leases`),
    capabilityRuntime: extras.capabilityRuntime ?? {
      requireExecution: () =>
        Promise.resolve(seedOperationalCapability(fixture.queued.project.id)),
    },
    capabilityRuntimeSession: extras.capabilityRuntimeSession ?? session,
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-02T12:10:00.000Z",
  });
}

interface RecordingSeedSession {
  readonly events: string[];
  readonly releases: number;
  readonly retains: number;
  begin: CapabilityRuntimeExecutionSessionCoordinator["begin"];
}

function recordingSeedSession(
  beginImpl?: CapabilityRuntimeExecutionSessionCoordinator["begin"],
): RecordingSeedSession {
  const state = { events: [] as string[], releases: 0, retains: 0 };
  return {
    get events() {
      return state.events;
    },
    get releases() {
      return state.releases;
    },
    get retains() {
      return state.retains;
    },
    begin: beginImpl ?? (async (input) => {
      state.events.push("begin");
      await input.recheck();
      return {
        lease: { id: "capability-jit-seed" } as CapabilityRuntimeExecutionSession[
          "lease"
        ],
        releaseTerminal: () => {
          state.releases++;
          return Promise.resolve();
        },
        retainForRecovery: () => {
          state.retains++;
        },
      };
    }),
  };
}

function seedOperationalCapability(
  projectId: string,
): ResolvedCapabilityRuntimeOperation {
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  const material = {
    unitId: "casys.syson-stack",
    materialId: "mcp-syson-image",
    imageDigest: "b".repeat(64),
  };
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId,
    operation: { id: "architecture.seed-syson-model", version: "2" },
    authorizationFingerprint: fingerprint,
    demandFingerprint: fingerprint,
    registryFingerprint: fingerprint,
    bindings: [{
      capability: {
        id: "model.author-system",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "syson-author-system", version: "1" },
      effectiveQualification: "qualified",
      adapter: {
        id: "syson-architecture-adapter",
        version: "1.0.0",
        source: "server",
      },
      profile: null,
      materials: [material],
      runtimeModes: [{
        material,
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material,
        kind: "persistent-compose",
        launchGroup: {
          id: "casys-syson",
          version: "1.0.0",
          fingerprint,
        },
      }],
    }],
  };
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
  const attempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const liveUpdates = new FileLiveThreadUpdateStore(`${directory}/live-updates`);
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-02T12:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-review-project",
    projectId: "project-review-demo",
    projectName: "Reviewable engineering system",
    issuedAt: "2026-08-02T11:59:00.000Z",
    intent: "Build a reviewable engineering demonstrator.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-review-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Build a reviewable engineering demonstrator.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Demonstrate a stable, bounded operating scenario.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Create a reviewable engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-review-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The brief is clear enough for bounded engineering.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: TEST_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
  );
  project = await commands.publishPlan(AGENT, {
    ...context("publish-initial-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "First project record",
      description: "Record the approved brief before technical work begins.",
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
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const queuedBaseline = await commands.queueRun(AGENT, {
    ...context("queue-documentary-baseline", project.revision),
    runId: "run:documentary-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved brief documentary baseline.",
    basis: project.plan!.basis,
  });
  const baselineExecutor = new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
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
  project = await commands.appendChange(AGENT, {
    ...context("append-syson-seed", baselineCompleted.revision),
    baseSnapshot: base,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the first traceable system-model container.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        id: "architecture.seed-syson-model",
        version: "2",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-syson-seed", project.revision),
    projectId: baselineCompleted.project.id,
    runId: "run:seed-syson-model",
    workItemId: "seed-syson-model",
    summary: "Create the first editable system model container.",
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

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "project-review-demo",
    expectedRevision,
    issuedAt: "2026-08-02T11:59:30.000Z",
  };
}

function seedLineage(
  project: EngineeringProjectSnapshot,
  base: NonNullable<
    Awaited<ReturnType<FileThreadSnapshotStore["get"]>>
  >,
) {
  const plan = project.plan!;
  if (plan.basis.kind !== "approved-brief") {
    throw new Error("Expected approved-brief plan basis.");
  }
  const change = project.planChanges!.find((item) =>
    item.workItemIds.includes("seed-syson-model")
  )!;
  if (!change.approvedBriefBasis) {
    throw new Error("Expected approved-brief project-change basis.");
  }
  const document = base.artifacts[0]!;
  return {
    approvedBriefBasis: structuredClone(change.approvedBriefBasis),
    plan: {
      publishedAt: plan.publishedAt,
      publishedBy: structuredClone(plan.publishedBy),
    },
    projectChange: {
      id: change.id,
      commandId: change.commandId,
      publishedAt: change.publishedAt,
      publishedBy: structuredClone(change.publishedBy),
    },
    workItemId: "seed-syson-model",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    documentaryArtifact: {
      id: document.id,
      fingerprint: structuredClone(document.fingerprint),
      uri: document.uri!,
      producerRunId: document.producer.runId,
    },
  };
}

class FakeSysonClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(private readonly projectCreateFailure?: string) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

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
            name: "Project model seed",
            editingContextId: "editing-context-456",
          },
          text: "created",
        });
      case "syson_model_create":
        return Promise.resolve({
          structuredContent: {
            documentId: "document-789",
            documentName: "Engineering system model",
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
