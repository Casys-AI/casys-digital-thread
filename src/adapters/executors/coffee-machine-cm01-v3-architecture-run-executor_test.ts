import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../../domain/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project-brief-command-service.ts";
import {
  coffeeMachineCm01V3ArchitectureGoldenArtifact,
  CoffeeMachineCm01V3ArchitectureRunExecutor,
} from "./coffee-machine-cm01-v3-architecture-run-executor.ts";
import { FileCoffeeMachineCm01V3ArchitectureAttemptStore } from "../wal/file-coffee-machine-cm01-v3-architecture-attempt-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../file-capture-store.ts";
import { sha256Fingerprint } from "../../domain/deterministic-json.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/syson-model-seed.ts";
import {
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
} from "../../orchestration/operations/registry.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileSysonModelSeedAttemptStore } from "../wal/file-syson-model-seed-attempt-store.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { LiveThreadUpdateStore } from "../stores/live-thread-update-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../http-mcp-tool-client.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

const ARCHITECTURE_OPERATION: RegisteredEngineeringOperation = {
  ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Author CM-01 architecture",
  description: "Insert the reviewed CM-01 SysML architecture.",
  workItemKind: "architect",
  riskClass: "consequential",
  execution: "trusted",
  bindings: [{ name: "approvedBrief", allowedSourceKinds: ["approved-brief"] }],
};

const OPERATIONS: EngineeringProjectPlanOperationRegistry = {
  validate(input) {
    const candidate = input as {
      operation?: { id?: unknown; version?: unknown; bindings?: unknown };
      stage?: unknown;
      basisKind?: unknown;
    };
    if (
      candidate.operation?.id !== ARCHITECTURE_OPERATION.id ||
      candidate.operation.version !== ARCHITECTURE_OPERATION.version
    ) {
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(
        input as RegisteredEngineeringOperationInput,
      );
    }
    const bindings = candidate.operation.bindings;
    if (
      (candidate.stage !== "planning" && candidate.stage !== "queue") ||
      (candidate.stage === "queue" && candidate.basisKind !== "thread-snapshot") ||
      !Array.isArray(bindings) || bindings.length !== 1 ||
      bindings[0]?.name !== "approvedBrief" ||
      bindings[0]?.source?.kind !== "approved-brief"
    ) throw new Error("Invalid CM-01 architecture operation input.");
    return {
      operation: ARCHITECTURE_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(bindings),
    };
  },
};

Deno.test("CM-01 architecture executor inserts the closed recipe once and publishes a role-addressable r3 evidence branch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-architecture-" });
  try {
    const fixture = await queuedArchitecture(directory);
    const syson = new ArchitectureSyson();
    const executor = new CoffeeMachineCm01V3ArchitectureRunExecutor({
      projects: fixture.projects,
      commands: fixture.commands,
      snapshots: fixture.snapshots,
      seedCaptures: fixture.seedCaptures,
      captures: fixture.captures,
      attempts: fixture.attempts,
      recipe: await recipe(),
      syson,
      lease: new FileEngineeringProjectRunLease(`${directory}/architecture-leases`),
      liveUpdates: fixture.liveUpdates,
      now: () => "2026-08-03T15:00:00.000Z",
    });
    const completed = await executor.execute(AGENT, executionCommand(fixture.queued));
    const run = completed.agentRuns.at(-1)!;
    assertEquals(run.status, "completed");
    assertEquals(run.resultSnapshot?.revision, 3);
    assertEquals(syson.calls.map((call) => call.name), [
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_element_children",
      "syson_element_children",
    ]);
    assertEquals(syson.calls[1]?.arguments?.parent_id, "root-package-012");
    assertEquals(
      typeof syson.calls[1]?.arguments?.sysml_text,
      "string",
    );
    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    assertEquals(
      coffeeMachineCm01V3ArchitectureGoldenArtifact(snapshot).role,
      "architecture-model",
    );
    assertEquals(snapshot.requirements, []);
    assertEquals(snapshot.evaluations, []);
    assertEquals(
      (await fixture.liveUpdates.list("project:coffee-machine-cm01-v3")).at(-1)?.state,
      "reconciled",
    );
    const replay = await executor.execute(AGENT, executionCommand(fixture.queued));
    assertEquals(replay.revision, completed.revision);
    assertEquals(syson.calls.length, 4);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 architecture executor rejects a human before reading project or provider state", async () => {
  const executor = new CoffeeMachineCm01V3ArchitectureRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read")) } as never,
    commands: {} as never,
    snapshots: {} as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
    captures: {} as never,
    attempts: {} as never,
    recipe: await recipe(),
    syson: {} as never,
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, command()),
    Error,
    "Only an authenticated agent",
  );
});

Deno.test("CM-01 architecture executor rejects a non-canonical project before a provider call", async () => {
  let providerCalled = false;
  const executor = new CoffeeMachineCm01V3ArchitectureRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "3.0",
          project: { id: "different-project", subjectId: "project:different-project" },
          agentRuns: [{
            id: "run:cm01",
            workItemId: "cm01-architecture",
            basis: { kind: "thread-snapshot" },
          }],
          workItems: [{
            id: "cm01-architecture",
            operation: {
              id: "architecture.author-coffee-machine-cm01",
              version: "1",
              bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
            },
          }],
        } as never),
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    seedCaptures: { read: () => Promise.reject(new Error("must not read")) },
    captures: {} as never,
    attempts: {} as never,
    recipe: await recipe(),
    syson: {
      callTool: () => {
        providerCalled = true;
        return Promise.reject(new Error("must not call"));
      },
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
    lease: {} as never,
  });
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:engineering" }, command()),
    Error,
    "canonical CM-01 V3 architecture",
  );
  assertEquals(providerCalled, false);
});

Deno.test("CM-01 architecture write-ahead record never dispatches the same insertion twice", async () => {
  const directory = await Deno.makeTempDir({ prefix: "cm01-architecture-attempt-" });
  try {
    const attempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(directory);
    assertEquals(
      await attempts.begin({
        projectId: "coffee-machine-cm01-v3",
        runId: "run:cm01",
        dispatchedAt: "2026-08-03T12:00:00.000Z",
      }),
      { action: "dispatch" },
    );
    await assertRejects(
      () =>
        attempts.begin({
          projectId: "coffee-machine-cm01-v3",
          runId: "run:cm01",
          dispatchedAt: "2026-08-03T12:00:00.000Z",
        }),
      Error,
      "will not be retried automatically",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 architecture attempt parser requires the exact key set for its status", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "cm01-architecture-attempt-shape-",
  });
  try {
    const projectId = "coffee-machine-cm01-v3";
    const runId = "run:cm01";
    const attempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(directory);
    await attempts.begin({
      projectId,
      runId,
      dispatchedAt: "2026-08-03T12:00:00.000Z",
    });
    const path = `${directory}/${
      encodeURIComponent(JSON.stringify([projectId, runId]))
    }.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        schemaVersion: "coffee-machine-cm01-v3-architecture-write-attempt/1.0",
        projectId,
        runId,
        status: "dispatched",
        dispatchedAt: "2026-08-03T12:00:00.000Z",
        result: {},
      }),
    );
    await assertRejects(
      () => attempts.read(projectId, runId),
      Error,
      "unsupported shape",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 architecture capture store re-reads only bytes named by its content fingerprint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "cm01-architecture-capture-" });
  try {
    const text = '{"kind":"normalized-cm01-readback"}';
    const fingerprint = await sha256Fingerprint(JSON.parse(text));
    const store = new FileCaptureStore({
      ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
      directory,
    });
    await store.save(fingerprint, text);
    assertEquals(await store.read(fingerprint), text);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 golden projection exposes a semantic role, never an artifact identity", () => {
  const result = coffeeMachineCm01V3ArchitectureGoldenArtifact({
    artifacts: [{
      id: "coffee-machine-cm01-v3-architecture-abcdef",
      kind: "sysml-model",
      producer: { serverId: "syson", tool: "syson_element_insert_sysml" },
    }],
  } as ThreadSnapshot);
  assertEquals(result, {
    role: "architecture-model",
    kind: "sysml-model",
    producer: { serverId: "syson", tool: "syson_element_insert_sysml" },
  });
});

async function recipe() {
  return JSON.parse(
    await Deno.readTextFile("config/product-recipes/coffee-machine-cm01-v1.json"),
  );
}

function command() {
  return {
    commandId: "agent-author-cm01",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 1,
    issuedAt: "2026-08-03T12:00:00.000Z",
    runId: "run:cm01",
  };
}

function executionCommand(
  queued: {
    project: { id: string };
    revision: number;
    agentRuns: readonly { id: string }[];
  },
) {
  return {
    commandId: "agent-author-cm01-architecture",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-03T14:30:00.000Z",
    runId: queued.agentRuns.at(-1)!.id,
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
  const seedAttempts = new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`);
  const captures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const attempts = new FileCoffeeMachineCm01V3ArchitectureAttemptStore(
    `${directory}/architecture-attempts`,
  );
  const liveUpdates = new LiveThreadUpdateStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T13:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-03T12:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-cm01-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable CM-01 coffee-machine engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Represent the reviewed CM-01 machine boundaries in one system model.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a traceable SysON architecture read-back.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-cm01-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 architecture record is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: OPERATIONS },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );
  project = await commands.publishPlan(AGENT, {
    ...context("publish-cm01-plan", project.revision),
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
  const baselineQueued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-baseline", project.revision),
    runId: "run:cm01-brief-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });
  const baseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-03T13:30:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-record-cm01-brief",
    projectId: project.project.id,
    expectedRevision: baselineQueued.revision,
    issuedAt: "2026-08-03T13:30:00.000Z",
    runId: "run:cm01-brief-baseline",
  });
  const r1 = baseline.threadSnapshots[0]!;
  project = await commands.appendChange(AGENT, {
    ...context("append-cm01-architecture", baseline.revision),
    baseSnapshot: r1,
    phases: [{
      id: "architecture",
      name: "System model",
      description: "Create the bounded CM-01 system model.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }, {
      id: "author-cm01-architecture",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed-syson-model"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const queuedSeed = await commands.queueRun(AGENT, {
    ...context("queue-cm01-seed", project.revision),
    runId: "run:cm01-seed",
    workItemId: "seed-syson-model",
    summary: "Create the CM-01 SysON model container.",
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
    now: () => "2026-08-03T14:00:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-seed-cm01",
    projectId: project.project.id,
    expectedRevision: queuedSeed.revision,
    issuedAt: "2026-08-03T14:00:00.000Z",
    runId: "run:cm01-seed",
  });
  const r2 = seeded.threadSnapshots.at(-1)!;
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-architecture", seeded.revision),
    runId: "run:cm01-architecture",
    workItemId: "author-cm01-architecture",
    summary: "Author the reviewed CM-01 architecture.",
    basis: { kind: "thread-snapshot", ...r2 },
  });
  return {
    projects,
    commands,
    snapshots,
    seedCaptures,
    captures,
    attempts,
    liveUpdates,
    queued,
  };
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "coffee-machine-cm01-v3",
    expectedRevision,
    issuedAt: "2026-08-03T13:00:00.000Z",
  };
}

class SeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          id: "syson-project-123",
          name: "CM-01",
          editingContextId: "editing-context-456",
        },
      });
    }
    if (call.name === "syson_model_create") {
      return Promise.resolve({
        text: "created",
        structuredContent: {
          documentId: "document-789",
          documentName: "CM-01",
          documentKind: "Document",
          rootPackageId: "root-package-012",
          rootPackageLabel: "New Package",
        },
      });
    }
    if (call.name === "syson_element_get") {
      return Promise.resolve({
        text: "read",
        structuredContent: {
          id: "root-package-012",
          kind: "sysml::Package",
          label: "New Package",
        },
      });
    }
    return Promise.reject(new Error(`Unexpected seed tool ${call.name}`));
  }
}

class ArchitectureSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #children = 0;

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_element_insert_sysml") {
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
          text: call.arguments?.sysml_text,
        },
      });
    }
    if (call.name !== "syson_element_children") {
      return Promise.reject(new Error(`Unexpected architecture tool ${call.name}`));
    }
    this.#children++;
    const parentId = call.arguments?.element_id;
    if (this.#children === 1) {
      return Promise.resolve({
        text: "preflight",
        structuredContent: { parentId, children: [], count: 0 },
      });
    }
    if (this.#children === 2) {
      return Promise.resolve({
        text: "root",
        structuredContent: {
          parentId,
          children: [{
            id: "cm01-package",
            kind: "sysml::Package",
            label: "CoffeeMachineCM01",
          }],
          count: 1,
        },
      });
    }
    return recipe().then((value) =>
      Promise.resolve({
        text: "package",
        structuredContent: {
          parentId,
          children: [
            value.system.sysmlPartDefinitionName,
            ...value.components.map((component: { sysmlPartDefinitionName: string }) =>
              component.sysmlPartDefinitionName
            ),
          ].map((label, index) => ({
            id: `definition-${index}`,
            kind: "sysml::PartDefinition",
            label,
          })),
          count: value.components.length + 1,
        },
      })
    );
  }
}
