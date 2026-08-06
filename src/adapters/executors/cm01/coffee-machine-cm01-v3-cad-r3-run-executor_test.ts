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
  COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION,
  COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID,
  CoffeeMachineCm01V3CadR3RunExecutor,
} from "./coffee-machine-cm01-v3-cad-r3-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { FileCm01SemanticCadAttemptStore } from "../../wal/file-cm01-semantic-cad-attempt-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../captures/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../../stores/file-thread-snapshot-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "../../stores/engineering-project-store.ts";
import type { McpToolCall, McpToolResult } from "../../mcp/http-mcp-tool-client.ts";
import { LiveThreadUpdateStore } from "../../stores/live-thread-update-store.ts";
import { parseCoffeeMachineCm01SemanticRecipeR2 } from "../../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import {
  CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
  CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX,
} from "../../captures/cm01-semantic-cad-capture-r3.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

/**
 * 10 components from the R2 recipe — drip-tray plus 9 others.
 * Each per-part call returns one STL file.
 */
const RECIPE_COMPONENT_KEYS = [
  "enclosure",
  "water-tank",
  "boiler",
  "pump",
  "brew-unit",
  "control-pcb",
  "power-supply",
  "temperature-sensor",
  "user-interface",
  "drip-tray",
];

const CAD_R3_OPERATION: RegisteredEngineeringOperation = {
  ...COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Build CM-01 @3 CAD",
  description:
    "Capture the reviewed CM-01 R2 semantic CAD evidence with presentation meshes.",
  workItemKind: "design",
  riskClass: "consequential",
  execution: "trusted",
  bindings: [
    { name: "approvedBrief", allowedSourceKinds: ["approved-brief"] },
    { name: "dripTrayHeightCorrection", allowedSourceKinds: ["thread-entity"] },
  ],
};

const OPERATIONS: EngineeringProjectPlanOperationRegistry = {
  validate(input) {
    const candidate = input as {
      operation?: { id?: unknown; version?: unknown; bindings?: unknown };
      stage?: unknown;
      basisKind?: unknown;
    };
    if (
      candidate.operation?.id !== CAD_R3_OPERATION.id ||
      candidate.operation.version !== CAD_R3_OPERATION.version
    ) {
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(
        input as RegisteredEngineeringOperationInput,
      );
    }
    if (
      (candidate.stage !== "planning" && candidate.stage !== "queue") ||
      (candidate.stage === "queue" && candidate.basisKind !== "thread-snapshot") ||
      !Array.isArray(candidate.operation.bindings) ||
      candidate.operation.bindings.length !== 2
    ) throw new Error("Invalid CM-01 @3 CAD operation input.");
    return {
      operation: CAD_R3_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(candidate.operation.bindings),
    };
  },
};

Deno.test(
  "CM-01 V3 @3 CAD executor makes N+1 build123d calls and publishes plan, script, STEP and mesh artifacts",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r3-executor-",
    });
    try {
      const fixture = await queuedCadR3(directory);
      const build123d = new FakeBuild123d();
      const executor = cadR3Executor(fixture, build123d);
      const command = executionCommand(fixture.queued);

      const completed = await executor.execute(AGENT, command);
      const run = completed.agentRuns.find((r) => r.id === command.runId);
      assertExists(run);
      assertEquals(run.status, "completed");

      // Assembly call (1) + one per component (10) = 11 total.
      assertEquals(build123d.calls.length, 11);

      // First call must be the assembly export.
      assertEquals(
        build123d.calls[0]!.arguments!["name"],
        CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
      );
      assertEquals(
        (build123d.calls[0]!.arguments!["formats"] as string[]).sort(),
        ["gltf", "step", "stl"],
      );

      // Remaining calls are per-part STL exports in component order.
      for (let i = 0; i < RECIPE_COMPONENT_KEYS.length; i++) {
        const call = build123d.calls[i + 1]!;
        assertEquals(
          call.arguments!["name"],
          `${CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX}${RECIPE_COMPONENT_KEYS[i]}`,
        );
        assertEquals(call.arguments!["formats"], ["stl"]);
      }

      // Snapshot must include plan, script, STEP, assembly mesh, and 10 part meshes.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);
      const r3Artifacts = snapshot.artifacts.filter((a) =>
        a.id.includes("coffee-machine-cm01-v3-cad-r3-")
      );
      // 4 assembly artifacts + 10 part meshes = 14
      assertEquals(r3Artifacts.length, 14);
      const meshArtifacts = r3Artifacts.filter((a) => a.kind === "mesh");
      // 1 assembly STL + 10 part STLs = 11
      assertEquals(meshArtifacts.length, 11);
      const stepArtifacts = r3Artifacts.filter((a) => a.kind === "step");
      assertEquals(stepArtifacts.length, 1);

      // Provider paths must not leak into URIs.
      assertEquals(
        r3Artifacts.some((a) => a.uri?.includes("/srv/exports")),
        false,
      );

      // Idempotent replay: no additional provider calls.
      const replay = await executor.execute(AGENT, command);
      assertEquals(replay.revision, completed.revision);
      assertEquals(build123d.calls.length, 11);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "CM-01 V3 @3 CAD executor is agent-only and makes no build123d calls for non-agent callers",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r3-executor-",
    });
    try {
      const fixture = await queuedCadR3(directory);
      const build123d = new FakeBuild123d();
      await assertRejects(
        () =>
          cadR3Executor(fixture, build123d).execute(
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
  },
);

Deno.test(
  "CM-01 V3 @3 CAD executor will not replay a pre-existing dispatch marker",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r3-executor-",
    });
    try {
      const fixture = await queuedCadR3(directory);
      const command = executionCommand(fixture.queued);
      await fixture.attempts.begin({
        projectId: command.projectId,
        runId: command.runId,
        dispatchedAt: command.issuedAt,
      });
      const build123d = new FakeBuild123d();
      await assertRejects(
        () => cadR3Executor(fixture, build123d).execute(AGENT, command),
        EngineeringProjectCommandError,
        "outcome is unknown",
      );
      assertEquals(build123d.calls.length, 0);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

function cadR3Executor(
  fixture: Awaited<ReturnType<typeof queuedCadR3>>,
  build123d: FakeBuild123d,
  snapshots: ThreadSnapshotStore = fixture.snapshots,
) {
  return new CoffeeMachineCm01V3CadR3RunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots,
    recipe: fixture.recipe,
    build123d,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/cad-r3-leases`),
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-05T10:00:00.000Z",
  });
}

function executionCommand(
  queued: Awaited<ReturnType<typeof queuedCadR3>>["queued"],
) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-run-cm01-cad-r3",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-05T10:00:00.000Z",
    runId: run.id,
  };
}

async function queuedCadR3(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const attempts = new FileCm01SemanticCadAttemptStore(`${directory}/cad-r3-attempts`);
  const captures = new FileCaptureStore({
    ...CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
    directory: `${directory}/cad-r3-captures`,
  });
  const liveUpdates = new LiveThreadUpdateStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-05T09:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3-r3",
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID,
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-05T08:59:00.000Z",
    intent: "Create a reviewable CM-01 coffee-machine engineering record with meshes.",
    intentSource: { kind: "human", reference: "conversation:cm01-r3" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-cm01-r3-brief", project.revision),
    items: [
      {
        id: "objective",
        kind: "objective",
        statement:
          "Create a reviewable CM-01 coffee-machine engineering record with presentation STLs.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r3" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement:
          "Generate the reviewed CM-01 CAD assembly plus per-part presentation STLs from the closed R2 recipe.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r3" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement:
          "Capture a deterministic STEP and N+1 presentation STLs as content-addressed evidence.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r3" }],
      },
    ],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-cm01-r3-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 @3 CAD evidence scenario is clear.",
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
    ...context("publish-cm01-r3-plan", project.revision),
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
    ...context("queue-cm01-r3-baseline", project.revision),
    runId: "run:cm01-r3-brief-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved CM-01 @3 brief.",
    basis: project.plan!.basis,
  });
  const baseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-05T09:30:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-record-cm01-r3-brief",
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID,
    expectedRevision: baselineQueued.revision,
    issuedAt: "2026-08-05T09:30:00.000Z",
    runId: "run:cm01-r3-brief-baseline",
  });
  const baselineRef = baseline.threadSnapshots[0]!;
  const baselineSnapshot = await snapshots.get(baselineRef.snapshotId);
  assertExists(baselineSnapshot);

  // Synthesize architecture artifact (required by the executor basis guard).
  const syntheticAt = now();
  const withArchitecture = applyThreadSnapshotExtensionIfNew(baselineSnapshot, {
    id: "cm01-r3-test-architecture",
    name: "Synthetic CM-01 @3 architecture",
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
        runId: "run:r3-architecture",
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
  await snapshots.save(withArchitecture.snapshot);

  // Synthesize the stale @1 CAD artifacts that R3 supersedes via cm01R2CadSupersedesLinks.
  const correctionAt = now();
  const withStaleR1Cad = applyThreadSnapshotExtensionIfNew(withArchitecture.snapshot, {
    id: "cm01-r3-test-stale-cad",
    name: "Synthetic stale CM-01 R1 CAD",
    subjectId: withArchitecture.snapshot.subject.id,
    capturedAt: correctionAt,
    artifacts: [
      {
        id: `coffee-machine-cm01-v3-cad-plan-stale-${"b".repeat(64)}`,
        name: "CM-01 semantic CAD plan",
        kind: "document",
        version: "b".repeat(64),
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        uri: "casys://test/plan",
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "compile_coffee_machine_cm01_semantic_cad_plan",
          runId: "run:r1-cad",
        },
        inputArtifactIds: [],
        freshness: {
          status: "stale",
          changedAt: correctionAt,
          reason: "Superseded by the DripTray height correction (28→30 mm).",
          invalidatedByChangeIds: [],
        },
      },
      {
        id: `coffee-machine-cm01-v3-cad-script-stale-${"c".repeat(64)}`,
        name: "CM-01 deterministic build123d script",
        kind: "script",
        version: "c".repeat(64),
        fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
        uri: "casys://test/script",
        mediaType: "text/x-python",
        producer: {
          serverId: "digital-thread",
          tool: "compile_coffee_machine_cm01_semantic_cad_plan",
          runId: "run:r1-cad",
        },
        inputArtifactIds: [],
        freshness: {
          status: "stale",
          changedAt: correctionAt,
          reason: "Superseded by the DripTray height correction (28→30 mm).",
          invalidatedByChangeIds: [],
        },
      },
      {
        id: `coffee-machine-cm01-v3-cad-step-stale-${"d".repeat(64)}`,
        name: "CM-01 STEP export",
        kind: "step",
        version: "d".repeat(64),
        fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
        uri: "casys://test/step",
        mediaType: "model/step",
        producer: {
          serverId: "build123d",
          tool: "build123d_export",
          runId: "run:r1-cad",
        },
        inputArtifactIds: [],
        freshness: {
          status: "stale",
          changedAt: correctionAt,
          reason: "Superseded by the DripTray height correction (28→30 mm).",
          invalidatedByChangeIds: [],
        },
      },
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: correctionAt });
  await snapshots.save(withStaleR1Cad.snapshot);

  // Add the fresh correction artifact to the basis.
  const withCorrectionAt = now();
  const withCorrection = applyThreadSnapshotExtensionIfNew(withStaleR1Cad.snapshot, {
    id: "cm01-r3-test-correction",
    name: "Synthetic CM-01 DripTray correction",
    subjectId: withStaleR1Cad.snapshot.subject.id,
    capturedAt: withCorrectionAt,
    artifacts: [{
      id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
      name: "CM-01 DripTray height correction",
      kind: "document",
      version: "e".repeat(64),
      fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      uri: "casys://test/correction",
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "record_drip_tray_correction",
        runId: "run:correction",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: withCorrectionAt,
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
  }, { appliedAt: withCorrectionAt });
  await snapshots.save(withCorrection.snapshot);

  const base = {
    snapshotId: withCorrection.snapshot.id,
    revision: withCorrection.snapshot.revision,
    subjectId: withCorrection.snapshot.subject.id,
  };
  project = await projects.commit({
    ...baseline,
    id: `${baseline.project.id}:project:r${baseline.revision + 1}:r3-basis`,
    revision: baseline.revision + 1,
    previous: { snapshotId: baseline.id, revision: baseline.revision },
    generatedAt: withCorrectionAt,
    threadSnapshots: [...baseline.threadSnapshots, base],
    commandReceipts: [
      ...(baseline.commandReceipts ?? []),
      {
        commandId: "test-synthetic-cm01-r3-basis",
        type: "agent-run.progress" as const,
        actor: { id: AGENT.actorId, origin: AGENT.kind },
        issuedAt: withCorrectionAt,
        appliedAt: withCorrectionAt,
        requestFingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
        resultingSnapshot: {
          snapshotId: `${baseline.project.id}:project:r${
            baseline.revision + 1
          }:r3-basis`,
          revision: baseline.revision + 1,
        },
      },
    ],
  }, baseline.revision);
  project = await commands.appendChange(AGENT, {
    ...context("append-cm01-r3-cad", project.revision),
    baseSnapshot: base,
    phases: [{
      id: "cad-r3",
      name: "CAD R3 evidence",
      description: "Export assembly and part STLs.",
    }],
    workItems: [{
      id: "build-cm01-cad-r3",
      phaseId: "cad-r3",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "dripTrayHeightCorrection",
            source: {
              kind: "thread-entity",
              reference: {
                kind: "artifact",
                id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
                snapshotId: base.snapshotId,
                snapshotRevision: base.revision,
              },
            },
          },
        ],
      },
    }],
    requiredDecisions: [],
  });
  const queued = await commands.queueRun(AGENT, {
    ...context("queue-cm01-cad-r3", project.revision),
    runId: "run:cm01-semantic-cad-r3",
    workItemId: "build-cm01-cad-r3",
    summary: "Export the reviewed CM-01 @3 CAD assembly and part meshes.",
    basis: { kind: "thread-snapshot", ...base },
  });
  const recipe = parseCoffeeMachineCm01SemanticRecipeR2(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../../config/product-recipes/coffee-machine-cm01-v2-drip-tray-30.json",
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
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-05T09:00:00.000Z",
  };
}

/**
 * Fake build123d client that tracks all calls and returns realistic
 * structuredContent shapes for both assembly (3 files) and per-part (1 file)
 * exports.  Responses use the real server basename convention so the capture
 * normalizer can validate them end-to-end.
 */
class FakeBuild123d {
  calls: McpToolCall[] = [];

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult not implemented (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const name = String((call.arguments ?? {})["name"] ?? "");
    const formats = ((call.arguments ?? {})["formats"] ?? []) as string[];
    // Per-part call: formats === ["stl"]
    if (formats.length === 1 && formats[0] === "stl") {
      const index = this.calls.length - 1; // unique digest per call
      const digest = String(index).padStart(2, "0").repeat(32);
      return Promise.resolve({
        text: "ok",
        structuredContent: {
          schemaVersion: "1.0",
          kind: "export",
          metrics: {},
          files: [
            {
              format: "stl",
              path: `/srv/exports/${name}.stl`,
              bytes: 200 + index,
              sha256: digest,
            },
          ],
        },
      });
    }
    // Assembly call: formats === ["step", "gltf", "stl"]
    return Promise.resolve({
      text: "ok",
      structuredContent: {
        schemaVersion: "1.0",
        kind: "export",
        metrics: {},
        files: [
          {
            format: "step",
            path: `/srv/exports/${name}.step`,
            bytes: 1001,
            sha256: "1".repeat(64),
          },
          {
            format: "gltf",
            path: `/srv/exports/${name}.glb`,
            bytes: 1002,
            sha256: "2".repeat(64),
            viewer: { toolName: "build123d_export_read", name: `${name}.glb` },
          },
          {
            format: "stl",
            path: `/srv/exports/${name}.stl`,
            bytes: 1003,
            sha256: "3".repeat(64),
          },
        ],
      },
    });
  }
}
