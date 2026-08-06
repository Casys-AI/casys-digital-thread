import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../../domain/project/engineering-project-command-service.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import {
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
  type RegisteredEngineeringOperation,
  type RegisteredEngineeringOperationInput,
} from "../../orchestration/operations/registry.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import {
  COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION,
  COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID,
  CoffeeMachineCm01V3CadR4RunExecutor,
} from "./coffee-machine-cm01-v3-cad-r4-run-executor.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { FileCm01SemanticCadAttemptStore } from "../wal/file-cm01-semantic-cad-attempt-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../captures/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileEngineeringAssetReader } from "../engineering-asset-resolver.ts";
import type { McpToolCall, McpToolResult } from "../mcp/http-mcp-tool-client.ts";
import { LiveThreadUpdateStore } from "../stores/live-thread-update-store.ts";
import { parseCoffeeMachineCm01SemanticRecipeR2 } from "../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import {
  CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
  CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX,
} from "../captures/cm01-semantic-cad-capture-r3.ts";
import type { HostAssetMaterializer } from "./host-asset-materializer.ts";
import { HostAssetMaterializationError } from "./host-asset-materializer.ts";

const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };
const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };

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

const CAD_R4_OPERATION: RegisteredEngineeringOperation = {
  ...COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Build CM-01 @4 CAD",
  description:
    "Capture the reviewed CM-01 R2 semantic CAD evidence with presentation meshes and host-side asset materialization.",
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
      candidate.operation?.id !== CAD_R4_OPERATION.id ||
      candidate.operation.version !== CAD_R4_OPERATION.version
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
    ) throw new Error("Invalid CM-01 @4 CAD operation input.");
    return {
      operation: CAD_R4_OPERATION,
      stage: candidate.stage,
      ...(candidate.stage === "queue" ? { basisKind: "thread-snapshot" as const } : {}),
      bindings: structuredClone(candidate.operation.bindings),
    };
  },
};

// ── Key invariant test ────────────────────────────────────────────────────────

Deno.test(
  "a mesh artifact from a materialized @4 snapshot has servable bytes in the asset store",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r4-assets-",
    });
    try {
      const assetDirectory = `${directory}/thread-assets`;
      const fixture = await queuedCadR4(directory);
      const build123d = new FakeBuild123d();
      const assets = new WritingFakeAssetMaterializer(assetDirectory);
      const executor = cadR4Executor(fixture, build123d, assets);
      const command = executionCommand(fixture.queued);

      const completed = await executor.execute(AGENT, command);
      const run = completed.agentRuns.find((r) => r.id === command.runId);
      assertExists(run);
      assertEquals(run.status, "completed");

      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);

      // The key invariant: validateThreadSnapshot must pass on the result.
      validateThreadSnapshot(snapshot);

      // Every mesh artifact must have servable bytes in the asset store.
      // This test FAILS if the executor did not materialize the assets.
      const meshArtifacts = snapshot.artifacts.filter((a) => a.kind === "mesh");
      assertEquals(
        meshArtifacts.length,
        11,
        "Expected 1 assembly mesh + 10 part meshes = 11 total.",
      );
      const reader = new FileEngineeringAssetReader(assetDirectory);
      for (const artifact of meshArtifacts) {
        // The filename is in the URI fragment (e.g. captureUri#filename.stl).
        assertExists(artifact.uri, `Mesh artifact "${artifact.id}" has no URI.`);
        const filename = artifact.uri.split("#").at(-1) ?? "";
        const bytes = await reader.read(filename);
        assertExists(
          bytes,
          `Mesh artifact "${artifact.id}" (URI: ${artifact.uri}) has no bytes ` +
            `in the asset store at ${assetDirectory}/${filename}. ` +
            "The @4 executor must materialize all STL files before publishing the snapshot.",
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Executor behavior tests ───────────────────────────────────────────────────

Deno.test(
  "CM-01 V3 @4 CAD executor calls build123d N+1 times and materializes all STL files",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r4-executor-",
    });
    try {
      const assetDirectory = `${directory}/thread-assets`;
      const fixture = await queuedCadR4(directory);
      const build123d = new FakeBuild123d();
      const assets = new WritingFakeAssetMaterializer(assetDirectory);
      const executor = cadR4Executor(fixture, build123d, assets);
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

      // Remaining calls are per-part STL exports in component order.
      for (let i = 0; i < RECIPE_COMPONENT_KEYS.length; i++) {
        assertEquals(
          build123d.calls[i + 1]!.arguments!["name"],
          `${CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX}${RECIPE_COMPONENT_KEYS[i]}`,
        );
      }

      // Materializer was called for assembly STL + all part STLs = 11.
      assertEquals(assets.materializedFiles.length, 11);

      // Assembly STL must be the first materialized file.
      assertEquals(
        assets.materializedFiles[0],
        `${CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME}.stl`,
      );

      // Provider paths must not appear in snapshot artifact URIs.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot);
      assertEquals(
        snapshot.artifacts.some((a) => a.uri?.includes("/srv/exports")),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "CM-01 V3 @4 CAD executor is agent-only",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r4-executor-",
    });
    try {
      const assetDirectory = `${directory}/thread-assets`;
      const fixture = await queuedCadR4(directory);
      const build123d = new FakeBuild123d();
      const assets = new WritingFakeAssetMaterializer(assetDirectory);
      await assertRejects(
        () =>
          cadR4Executor(fixture, build123d, assets).execute(
            HUMAN,
            executionCommand(fixture.queued),
          ),
        EngineeringProjectCommandError,
        "Only an authenticated agent",
      );
      assertEquals(build123d.calls.length, 0);
      assertEquals(assets.materializedFiles.length, 0);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "CM-01 V3 @4 CAD executor stops for review when asset materialization fails",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r4-executor-",
    });
    try {
      const fixture = await queuedCadR4(directory);
      const build123d = new FakeBuild123d();
      const assets = new AlwaysFailingAssetMaterializer();
      await assertRejects(
        () =>
          cadR4Executor(fixture, build123d, assets).execute(
            AGENT,
            executionCommand(fixture.queued),
          ),
        EngineeringProjectCommandError,
        "stopped for operator review",
      );
      // Providers ran to completion (capture persisted); assets failed.
      assertEquals(build123d.calls.length, 11);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "CM-01 V3 @4 CAD executor does not replay providers when retrying after asset failure",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-cm01-cad-r4-executor-",
    });
    try {
      const assetDirectory = `${directory}/thread-assets`;
      const fixture = await queuedCadR4(directory);
      const build123d = new FakeBuild123d();
      const command = executionCommand(fixture.queued);

      // First run: providers succeed, asset materialization fails.
      await assertRejects(
        () =>
          cadR4Executor(fixture, build123d, new AlwaysFailingAssetMaterializer())
            .execute(AGENT, command),
        EngineeringProjectCommandError,
      );
      const callsAfterFirstRun = build123d.calls.length;
      assertEquals(callsAfterFirstRun, 11); // providers ran once

      // Second run with a working materializer: providers must NOT run again.
      const workingAssets = new WritingFakeAssetMaterializer(assetDirectory);
      const completed = await cadR4Executor(fixture, build123d, workingAssets)
        .execute(AGENT, command);
      const run = completed.agentRuns.find((r) => r.id === command.runId);
      assertExists(run);
      assertEquals(run.status, "completed");
      // No new build123d calls: the WAL entry prevented replay.
      assertEquals(build123d.calls.length, callsAfterFirstRun);
      // Assets were materialized on the second try.
      assertEquals(workingAssets.materializedFiles.length, 11);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function cadR4Executor(
  fixture: Awaited<ReturnType<typeof queuedCadR4>>,
  build123d: FakeBuild123d,
  assets: HostAssetMaterializer,
) {
  return new CoffeeMachineCm01V3CadR4RunExecutor({
    projects: fixture.projects,
    commands: fixture.commands,
    snapshots: fixture.snapshots,
    recipe: fixture.recipe,
    build123d,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: new FileEngineeringProjectRunLease(`${fixture.directory}/cad-r4-leases`),
    assets,
    liveUpdates: fixture.liveUpdates,
    now: () => "2026-08-06T10:00:00.000Z",
  });
}

function executionCommand(
  queued: Awaited<ReturnType<typeof queuedCadR4>>["queued"],
) {
  const run = queued.agentRuns.at(-1)!;
  return {
    commandId: "agent-run-cm01-cad-r4",
    projectId: queued.project.id,
    expectedRevision: queued.revision,
    issuedAt: "2026-08-06T10:00:00.000Z",
    runId: run.id,
  };
}

async function queuedCadR4(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const attempts = new FileCm01SemanticCadAttemptStore(`${directory}/cad-r4-attempts`);
  const captures = new FileCaptureStore({
    ...CM01_SEMANTIC_CAD_R3_CAPTURE_DESCRIPTOR,
    directory: `${directory}/cad-r4-captures`,
  });
  const liveUpdates = new LiveThreadUpdateStore();
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-06T09:00:00.000Z") + ++tick * 1_000).toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-v3-r4",
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID,
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-06T08:59:00.000Z",
    intent: "Create a CM-01 engineering record with meshes and host assets.",
    intentSource: { kind: "human", reference: "conversation:cm01-r4" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-cm01-r4-brief", project.revision),
    items: [
      {
        id: "objective",
        kind: "objective",
        statement:
          "Create a CM-01 record with presentation STLs materialized on the host.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r4" }],
      },
      {
        id: "mission",
        kind: "mission-scenario",
        statement:
          "Generate the reviewed CM-01 CAD assembly plus per-part presentation STLs and materialize them to the host.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r4" }],
      },
      {
        id: "success",
        kind: "success-criterion",
        statement:
          "Capture a deterministic STEP and N+1 presentation STLs, all bytes servable by the BFF.",
        sourceRefs: [{ kind: "intent", reference: "conversation:cm01-r4" }],
      },
    ],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-cm01-r4-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 @4 CAD evidence scenario is clear.",
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
    ...ctx("publish-cm01-r4-plan", project.revision),
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
    ...ctx("queue-cm01-r4-baseline", project.revision),
    runId: "run:cm01-r4-brief-baseline",
    workItemId: "record-approved-brief",
    summary: "Record the approved CM-01 @4 brief.",
    basis: project.plan!.basis,
  });
  const baseline = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-06T09:30:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-record-cm01-r4-brief",
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID,
    expectedRevision: baselineQueued.revision,
    issuedAt: "2026-08-06T09:30:00.000Z",
    runId: "run:cm01-r4-brief-baseline",
  });
  const baselineRef = baseline.threadSnapshots[0]!;
  const baselineSnapshot = await snapshots.get(baselineRef.snapshotId);
  assertExists(baselineSnapshot);

  // Synthesize architecture artifact.
  const archAt = now();
  const withArchitecture = applyThreadSnapshotExtensionIfNew(baselineSnapshot, {
    id: "cm01-r4-test-architecture",
    name: "Synthetic CM-01 @4 architecture",
    subjectId: baselineSnapshot.subject.id,
    capturedAt: archAt,
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
        runId: "run:r4-architecture",
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: archAt, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: archAt });
  await snapshots.save(withArchitecture.snapshot);

  // Synthesize stale @1 CAD artifacts (required by cm01R2CadSupersedesLinks).
  const staleAt = now();
  const withStaleR1Cad = applyThreadSnapshotExtensionIfNew(withArchitecture.snapshot, {
    id: "cm01-r4-test-stale-cad",
    name: "Synthetic stale CM-01 R1 CAD",
    subjectId: withArchitecture.snapshot.subject.id,
    capturedAt: staleAt,
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
          changedAt: staleAt,
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
          changedAt: staleAt,
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
          changedAt: staleAt,
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
  }, { appliedAt: staleAt });
  await snapshots.save(withStaleR1Cad.snapshot);

  // Synthesize the fresh correction artifact.
  const correctionAt = now();
  const withCorrection = applyThreadSnapshotExtensionIfNew(withStaleR1Cad.snapshot, {
    id: "cm01-r4-test-correction",
    name: "Synthetic CM-01 DripTray correction",
    subjectId: withStaleR1Cad.snapshot.subject.id,
    capturedAt: correctionAt,
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
        changedAt: correctionAt,
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
  }, { appliedAt: correctionAt });
  await snapshots.save(withCorrection.snapshot);

  const base = {
    snapshotId: withCorrection.snapshot.id,
    revision: withCorrection.snapshot.revision,
    subjectId: withCorrection.snapshot.subject.id,
  };
  project = await projects.commit({
    ...baseline,
    id: `${baseline.project.id}:project:r${baseline.revision + 1}:r4-basis`,
    revision: baseline.revision + 1,
    previous: { snapshotId: baseline.id, revision: baseline.revision },
    generatedAt: correctionAt,
    threadSnapshots: [...baseline.threadSnapshots, base],
    commandReceipts: [
      ...(baseline.commandReceipts ?? []),
      {
        commandId: "test-synthetic-cm01-r4-basis",
        type: "agent-run.progress" as const,
        actor: { id: AGENT.actorId, origin: AGENT.kind },
        issuedAt: correctionAt,
        appliedAt: correctionAt,
        requestFingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
        resultingSnapshot: {
          snapshotId: `${baseline.project.id}:project:r${
            baseline.revision + 1
          }:r4-basis`,
          revision: baseline.revision + 1,
        },
      },
    ],
  }, baseline.revision);
  project = await commands.appendChange(AGENT, {
    ...ctx("append-cm01-r4-cad", project.revision),
    baseSnapshot: base,
    phases: [{
      id: "cad-r4",
      name: "CAD R4 evidence",
      description: "Export assembly and part STLs, materialize to host.",
    }],
    workItems: [{
      id: "build-cm01-cad-r4",
      phaseId: "cad-r4",
      owner: "agent",
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION,
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
    ...ctx("queue-cm01-cad-r4", project.revision),
    runId: "run:cm01-semantic-cad-r4",
    workItemId: "build-cm01-cad-r4",
    summary: "Export the reviewed CM-01 @4 CAD assembly and part meshes to host.",
    basis: { kind: "thread-snapshot", ...base },
  });
  const recipe = parseCoffeeMachineCm01SemanticRecipeR2(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../config/product-recipes/coffee-machine-cm01-v2-drip-tray-30.json",
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

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-06T09:00:00.000Z",
  };
}

// ── Fakes ─────────────────────────────────────────────────────────────────────

/**
 * Fake build123d client: returns realistic structuredContent shapes without
 * touching any real provider.  SHA-256 values are test constants.
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
    if (formats.length === 1 && formats[0] === "stl") {
      const index = this.calls.length - 1;
      const digest = String(index).padStart(2, "0").repeat(32);
      return Promise.resolve({
        text: "ok",
        structuredContent: {
          schemaVersion: "1.0",
          kind: "export",
          metrics: {},
          files: [{
            format: "stl",
            path: `/srv/exports/${name}.stl`,
            bytes: 200 + index,
            sha256: digest,
          }],
        },
      });
    }
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

/**
 * Fake asset materializer that writes a deterministic byte sequence to the
 * local directory.  Does NOT verify SHA-256 (that is the responsibility of
 * DockerVolumeAssetMaterializer).  Records every call so tests can assert
 * that the correct filenames were materialized.
 */
class WritingFakeAssetMaterializer implements HostAssetMaterializer {
  readonly materializedFiles: string[] = [];

  constructor(private readonly localDirectory: string) {}

  async materialize(filename: string, expectedDigest: string): Promise<void> {
    this.materializedFiles.push(filename);
    await Deno.mkdir(this.localDirectory, { recursive: true });
    // Write placeholder bytes — the digest label makes misidentification obvious
    // in test failure messages, without needing to compute an actual SHA-256.
    const placeholder = new TextEncoder().encode(
      `fake-asset:${filename}:expected-sha256:${expectedDigest}`,
    );
    await Deno.writeFile(`${this.localDirectory}/${filename}`, placeholder);
  }
}

/**
 * Fake asset materializer that always throws HostAssetMaterializationError.
 * Used to verify the stop-for-review path.
 */
class AlwaysFailingAssetMaterializer implements HostAssetMaterializer {
  materialize(filename: string, _digest: string): Promise<void> {
    return Promise.reject(
      new HostAssetMaterializationError(
        "copy_failed",
        { filename, exitCode: "1", stderr: "Docker not running" },
        `Fake materialization failure for ${filename}.`,
      ),
    );
  }
}
