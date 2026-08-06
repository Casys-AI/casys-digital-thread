import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../../../domain/project/engineering-project-command-service.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { ProjectBriefCommandService } from "../../../domain/project/project-brief-command-service.ts";
import {
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
} from "../../../orchestration/operations/registry.ts";
import { ApprovedBriefBaselineRunExecutor } from "../approved-brief-baseline-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
  COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID,
  CoffeeMachineCm01V3CadRunExecutor,
} from "./coffee-machine-cm01-v3-cad-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { FileCm01SemanticCadAttemptStore } from "../../wal/file-cm01-semantic-cad-attempt-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../captures/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../../stores/file-thread-snapshot-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "../../stores/engineering-project-store.ts";
import type { McpToolCall, McpToolResult } from "../../mcp/http-mcp-tool-client.ts";
import { LiveThreadUpdateStore } from "../../stores/live-thread-update-store.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "../../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

const CAD_OPERATION: RegisteredEngineeringOperation = {
  ...COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Build CM-01 CAD",
  description: "Capture the reviewed CM-01 semantic CAD evidence.",
  workItemKind: "design",
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
      candidate.operation?.id !== CAD_OPERATION.id ||
      candidate.operation.version !== CAD_OPERATION.version
    ) {
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(
        input as RegisteredEngineeringOperationInput,
      );
    }
    if (
      (candidate.stage !== "planning" && candidate.stage !== "queue") ||
      (candidate.stage === "queue" && candidate.basisKind !== "thread-snapshot") ||
      !Array.isArray(candidate.operation.bindings) ||
      candidate.operation.bindings.length !== 1 ||
      candidate.operation.bindings[0]?.name !== "approvedBrief" ||
      candidate.operation.bindings[0]?.source?.kind !== "approved-brief"
    ) throw new Error("Invalid CM-01 CAD operation input.");
    return {
      operation: CAD_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(candidate.operation.bindings),
    };
  },
};

Deno.test("CM-01 V3 CAD executor exports exactly once and publishes plan, script and STEP over the exact architecture basis", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-cad-executor-" });
  try {
    const fixture = await queuedCad(directory);
    const build123d = new FakeBuild123d();
    const executor = cadExecutor(fixture, build123d);
    const command = executionCommand(fixture.queued);

    const completed = await executor.execute(AGENT, command);
    const run = completed.agentRuns.find((candidate) => candidate.id === command.runId);
    assertExists(run);
    assertEquals(run.status, "completed");
    assertEquals(build123d.calls.length, 1);
    const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assertExists(snapshot);
    const newArtifacts = snapshot.artifacts.filter((artifact) =>
      artifact.id.includes("coffee-machine-cm01-v3-cad-")
    );
    assertEquals(
      newArtifacts.map((artifact) => [artifact.kind, artifact.producer.tool]).sort(),
      [
        ["document", "compile_coffee_machine_cm01_semantic_cad_plan"],
        ["script", "compile_coffee_machine_cm01_semantic_cad_plan"],
        ["step", "build123d_export"],
      ],
    );
    assertEquals(
      newArtifacts.some((artifact) => artifact.uri?.includes("/srv/exports")),
      false,
    );
    assertEquals(
      (await fixture.liveUpdates.list(completed.project.subjectId)).map((item) =>
        item.state
      ),
      ["running", "fresh", "reconciled"],
    );

    const replay = await executor.execute(AGENT, command);
    assertEquals(replay.revision, completed.revision);
    assertEquals(build123d.calls.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 CAD executor is agent-only and fails before an export for a non-agent caller", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-cad-executor-" });
  try {
    const fixture = await queuedCad(directory);
    const build123d = new FakeBuild123d();
    await assertRejects(
      () =>
        cadExecutor(fixture, build123d).execute(
          HUMAN,
          executionCommand(fixture.queued),
        ),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
    assertEquals(build123d.calls.length, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CM-01 V3 CAD executor will not replay a pre-existing dispatch marker", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-cad-executor-" });
  try {
    const fixture = await queuedCad(directory);
    const command = executionCommand(fixture.queued);
    await fixture.attempts.begin({
      projectId: command.projectId,
      runId: command.runId,
      dispatchedAt: command.issuedAt,
    });
    const build123d = new FakeBuild123d();
    await assertRejects(
      () => cadExecutor(fixture, build123d).execute(AGENT, command),
      EngineeringProjectCommandError,
      "outcome is unknown",
    );
    assertEquals(build123d.calls.length, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function cadExecutor(
  fixture: Awaited<ReturnType<typeof queuedCad>>,
  build123d: FakeBuild123d,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
) {
  return new CoffeeMachineCm01V3CadRunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots,
    recipe: fixture.recipe,
    build123d,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/cad-leases`),
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-03T15:00:00.000Z",
  });
}

function executionCommand(queued: Awaited<ReturnType<typeof queuedCad>>["queued"]) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-run-cm01-cad",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-03T14:00:00.000Z",
    runId: run.id,
  };
}

async function queuedCad(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const attempts = new FileCm01SemanticCadAttemptStore(`${directory}/cad-attempts`);
  const captures = new FileCaptureStore({
    ...CM01_SEMANTIC_CAD_CAPTURE_DESCRIPTOR,
    directory: `${directory}/cad-captures`,
  });
  const liveUpdates = new LiveThreadUpdateStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T13:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3",
    projectId: COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID,
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
      statement:
        "Generate a reviewed CM-01 CAD assembly from its semantic product recipe.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a deterministic CAD export as evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-cm01-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 CAD evidence scenario is clear.",
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
    projectId: COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID,
    expectedRevision: baselineQueued.revision,
    issuedAt: "2026-08-03T13:30:00.000Z",
    runId: "run:cm01-brief-baseline",
  });
  const baselineRef = baseline.threadSnapshots[0]!;
  const baselineSnapshot = await snapshots.get(baselineRef.snapshotId);
  assertExists(baselineSnapshot);
  const syntheticAt = now();
  const architecture = applyThreadSnapshotExtensionIfNew(baselineSnapshot, {
    id: "cm01-test-architecture",
    name: "Synthetic reviewed CM-01 architecture",
    subjectId: baselineSnapshot.subject.id,
    capturedAt: syntheticAt,
    artifacts: [{
      id: `coffee-machine-cm01-v3-architecture-${"a".repeat(64)}`,
      name: "CM-01 architecture model",
      kind: "sysml-model",
      version: "a".repeat(64),
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      uri: "casys://test/architecture",
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:architecture",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: syntheticAt,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: syntheticAt });
  await snapshots.save(architecture.snapshot);
  const base = {
    snapshotId: architecture.snapshot.id,
    revision: architecture.snapshot.revision,
    subjectId: architecture.snapshot.subject.id,
  };
  project = await projects.commit({
    ...baseline,
    id: `${baseline.project.id}:project:r${
      baseline.revision + 1
    }:synthetic-architecture`,
    revision: baseline.revision + 1,
    previous: { snapshotId: baseline.id, revision: baseline.revision },
    generatedAt: syntheticAt,
    threadSnapshots: [...baseline.threadSnapshots, base],
    commandReceipts: [
      ...(baseline.commandReceipts ?? []),
      {
        commandId: "test-synthetic-cm01-architecture",
        type: "agent-run.progress" as const,
        actor: { id: AGENT.actorId, origin: AGENT.kind },
        issuedAt: syntheticAt,
        appliedAt: syntheticAt,
        requestFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
        resultingSnapshot: {
          snapshotId: `${baseline.project.id}:project:r${
            baseline.revision + 1
          }:synthetic-architecture`,
          revision: baseline.revision + 1,
        },
      },
    ],
  }, baseline.revision);
  project = await commands.appendChange(AGENT, {
    ...context("append-cm01-cad", project.revision),
    baseSnapshot: base,
    phases: [{
      id: "cad",
      name: "CAD evidence",
      description: "Export the reviewed semantic CAD assembly.",
    }],
    workItems: [{
      id: "build-cm01-cad",
      phaseId: "cad",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_CAD_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-cad", project.revision),
    runId: "run:cm01-semantic-cad",
    workItemId: "build-cm01-cad",
    summary: "Export the reviewed CM-01 semantic CAD assembly.",
    basis: { kind: "thread-snapshot", ...base },
  });
  const recipe = parseCoffeeMachineCm01SemanticRecipe(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../config/product-recipes/coffee-machine-cm01-v1.json",
          import.meta.url,
        ),
      ),
    ),
  );
  return {
    directory,
    projects,
    commands,
    snapshots,
    liveUpdates,
    attempts,
    captures,
    queued,
    recipe,
  };
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-03T13:00:00.000Z",
  };
}

class FakeBuild123d {
  calls: McpToolCall[] = [];
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return Promise.resolve({
      text: "ok",
      structuredContent: {
        schemaVersion: "1.0",
        kind: "export",
        metrics: {},
        files: [
          {
            format: "step",
            path: "/srv/exports/coffee-machine-cm01-v3.step",
            bytes: 101,
            sha256: "a".repeat(64),
          },
          {
            format: "gltf",
            path: "/srv/exports/coffee-machine-cm01-v3.glb",
            bytes: 102,
            sha256: "b".repeat(64),
            viewer: {
              toolName: "build123d_export_read",
              name: "coffee-machine-cm01-v3.glb",
            },
          },
          {
            format: "stl",
            path: "/srv/exports/coffee-machine-cm01-v3.stl",
            bytes: 103,
            sha256: "c".repeat(64),
          },
        ],
      },
    });
  }
}
