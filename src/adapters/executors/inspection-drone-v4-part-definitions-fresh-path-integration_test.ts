// deno-lint-ignore-file require-await -- transport ports intentionally mirror async production interfaces.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { EngineeringProjectCommandService } from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/platform/syson-model-seed.ts";
import type { ThreadArtifact } from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "../../orchestration/operations/inspection-drone-v4.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
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
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "../wal/file-inspection-drone-v4-part-definitions-publication-store.ts";
import { FileSysonModelSeedAttemptStore } from "../wal/file-syson-model-seed-attempt-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import {
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
} from "./inspection-drone-v4-architecture-run-executor.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT,
  InspectionDroneV4PartDefinitionsRunExecutor,
} from "./inspection-drone-v4-part-definitions-run-executor.ts";
import { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

const PROJECT_ID = "inspection-drone-v4";
const SUBJECT_ID = "project:inspection-drone-v4";
const AGENT = { kind: "agent" as const, actorId: "agent:integration" };
const HUMAN = { kind: "human" as const, actorId: "human:integration" };
const TIME = "2026-08-08T06:00:00.000Z";
const RECIPE_DIGEST =
  "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530";
const PART_IDS = [
  "part-inspection-drone",
  "part-airframe",
  "part-energy-system",
  "part-propulsion-system",
  "part-avionics-and-flight-control",
  "part-inspection-camera-payload",
] as const;
const REQUIREMENT_IDS = [
  "requirement-controlled-outdoor-inspection",
  "requirement-camera-payload-integration",
  "requirement-explicit-operational-tbd",
  "requirement-traceable-engineering-evidence",
] as const;
const USAGE_IDS = [
  "usage-airframe",
  "usage-energy-system",
  "usage-propulsion-system",
  "usage-avionics-and-flight-control",
  "usage-inspection-camera-payload",
] as const;

Deno.test("InspectionDroneV4PartDefinitions fresh path persists exact r4, attaches it, and replays without a second read", async () => {
  const fixture = await queuedProductFixture();
  try {
    const completed = await fixture.executor.execute(AGENT, fixture.command());
    const run = completed.agentRuns.find((item) => item.id === fixture.runId)!;
    assertEquals(run.status, "completed");
    assertEquals(run.resultSnapshot?.revision, 4);
    assertEquals(
      fixture.syson.calls.map((call) => call.name),
      Array(6).fill("syson_part_structure"),
    );
    assertEquals(
      fixture.syson.calls.map((call) => call.arguments?.root_element_id),
      [...PART_IDS],
    );
    assertEquals(
      fixture.syson.calls.every((call) =>
        call.arguments?.max_depth === 1 && call.arguments?.flatten === false
      ),
      true,
    );
    const r4 = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
    assert(r4);
    const artifact = r4.artifacts.find((item) =>
      item.id.startsWith("inspection-drone-v4-part-definitions-")
    );
    assert(artifact);
    assertEquals(artifact.inputArtifactIds, [fixture.architecture.id]);
    assertEquals(artifact.version, artifact.fingerprint.digest);
    assertEquals(
      r4.consumptions.filter((item) => item.artifactId === fixture.architecture.id)
        .length,
      1,
    );
    assertEquals(
      r4.provenance.some((item) =>
        item.relation === "derived_from" && item.from.id === artifact.id &&
        item.to.id === fixture.architecture.id
      ),
      true,
    );
    assertEquals(
      completed.threadSnapshots.at(-1)?.snapshotId,
      r4.id,
    );
    const capture = await fixture.partCaptures.read(artifact.fingerprint);
    assert(capture);
    assertEquals(JSON.parse(capture).definitions.length, 6);
    assert(await fixture.publications.read(PROJECT_ID, fixture.runId));

    fixture.syson.rejectCalls = true;
    const replay = await fixture.executor.execute(AGENT, fixture.command());
    assertEquals(
      replay.agentRuns.find((item) => item.id === fixture.runId)?.status,
      "completed",
    );
    assertEquals(fixture.syson.calls.length, 6);
  } finally {
    await Deno.remove(fixture.directory, { recursive: true });
  }
});

for (
  const corruption of ["max-depth", "quantity-two", "part-count", "wrong-root"] as const
) {
  Deno.test(`InspectionDroneV4PartDefinitions fresh path refuses ${corruption} without completing r4`, async () => {
    const fixture = await queuedProductFixture({ corruption });
    try {
      await assertRejects(() => fixture.executor.execute(AGENT, fixture.command()));
      const project = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        project?.agentRuns.find((item) => item.id === fixture.runId)?.status,
        "failed",
      );
      assertEquals(project?.threadSnapshots.some((item) => item.revision === 4), false);
      assertEquals((await fixture.snapshots.latest(SUBJECT_ID))?.revision, 3);
      assertEquals(
        await fixture.publications.read(PROJECT_ID, fixture.runId),
        undefined,
      );
      assertEquals(
        fixture.syson.calls.length,
        corruption === "quantity-two" ? 6 : 1,
      );
    } finally {
      await Deno.remove(fixture.directory, { recursive: true });
    }
  });
}

Deno.test("InspectionDroneV4PartDefinitions refuses a wrong r3 architecture binding before the provider is read", async () => {
  const fixture = await queuedProductFixture({ wrongBinding: true });
  try {
    await assertRejects(() => fixture.executor.execute(AGENT, fixture.command()));
    const project = await fixture.projects.get(PROJECT_ID);
    assertEquals(
      project?.agentRuns.find((item) => item.id === fixture.runId)?.status,
      "queued",
    );
    assertEquals(project?.threadSnapshots.some((item) => item.revision === 4), false);
    assertEquals(fixture.syson.calls.length, 0);
  } finally {
    await Deno.remove(fixture.directory, { recursive: true });
  }
});

type Corruption = "max-depth" | "quantity-two" | "part-count" | "wrong-root";

async function queuedProductFixture(options: {
  corruption?: Corruption;
  wrongBinding?: boolean;
} = {}) {
  const directory = await Deno.makeTempDir({
    prefix: "inspection-drone-v4-parts-integration-",
  });
  let tick = 0;
  const now = () => new Date(Date.parse(TIME) + ++tick * 1_000).toISOString();
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
  const architectureCaptures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture-captures`,
  });
  const partCaptures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/part-captures`,
  });
  const publications = new FileInspectionDroneV4PartDefinitionsPublicationStore(
    `${directory}/publications`,
  );
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
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Inspection drone V4",
    issuedAt: TIME,
    intent: "Capture a reviewable qualitative inspection-drone product structure.",
    intentSource: { kind: "human", reference: "conversation:integration" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Capture only exact qualitative SysON evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:integration" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Inspect a controlled outdoor site with a lightweight camera.",
      sourceRefs: [{ kind: "intent", reference: "conversation:integration" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Keep the reviewed evidence traceable without a technical verdict.",
      sourceRefs: [{ kind: "intent", reference: "conversation:integration" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded qualitative scope is approved.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await commands.publishPlan(AGENT, {
    ...context("publish-baseline", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "baseline",
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
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline", project.revision),
    runId: "run:baseline",
    workItemId: "baseline",
    summary: "Record the approved brief.",
    basis: project.plan!.basis,
  });
  project = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now,
  }).execute(AGENT, {
    ...context("execute-baseline", project.revision),
    runId: "run:baseline",
  });
  const r1 = project.threadSnapshots.at(-1)!;
  project = await commands.appendChange(AGENT, {
    ...context("append-seed", project.revision),
    baseSnapshot: r1,
    phases: [{ id: "seed", name: "Seed", description: "Create an empty SysON model." }],
    workItems: [{
      id: "seed",
      phaseId: "seed",
      owner: "agent",
      dependsOnWorkItemIds: ["baseline"],
      decisionIds: [],
      operation: {
        ...SYSON_MODEL_SEED_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-seed", project.revision),
    runId: "run:seed",
    workItemId: "seed",
    summary: "Create the exact empty SysON model.",
    basis: { kind: "thread-snapshot", ...r1 },
  });
  project = await new SysonModelSeedRunExecutor({
    projects,
    commands,
    snapshots,
    captures: seedCaptures,
    attempts: new FileSysonModelSeedAttemptStore(`${directory}/seed-attempts`),
    syson: new SeedSyson(),
    lease: new FileEngineeringProjectRunLease(`${directory}/seed-leases`),
    now,
  }).execute(AGENT, {
    ...context("execute-seed", project.revision),
    runId: "run:seed",
  });
  const r2Reference = project.threadSnapshots.at(-1)!;
  const r2 = await snapshots.get(r2Reference.snapshotId);
  assert(r2);
  const seed = r2.artifacts.find((artifact) =>
    artifact.id.startsWith("syson-model-seed-")
  );
  assert(seed);
  const seedCapture = JSON.parse(await seedCaptures.read(seed.fingerprint) ?? "");

  project = await commands.appendChange(AGENT, {
    ...context("append-architecture", project.revision),
    baseSnapshot: r2Reference,
    phases: [{
      id: "architecture",
      name: "Architecture",
      description: "Record exact r3 evidence.",
    }],
    workItems: [{
      id: "architecture",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: ["seed"],
      decisionIds: [],
      operation: {
        ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }, {
          name: "sysonModelSeed",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: r2.id,
              snapshotRevision: r2.revision,
              kind: "artifact",
              id: seed.id,
            },
          },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-architecture", project.revision),
    runId: "run:architecture",
    workItemId: "architecture",
    summary: "Record the already reviewed r3 architecture evidence.",
    basis: { kind: "thread-snapshot", ...r2Reference },
  });
  const architectureCapture = architectureCaptureFor(seed, seedCapture);
  const architectureFingerprint = await sha256Fingerprint(architectureCapture);
  await architectureCaptures.save(
    architectureFingerprint,
    deterministicJson(architectureCapture),
  );
  const architecture: ThreadArtifact = {
    id: `inspection-drone-v4-architecture-${architectureFingerprint.digest}`,
    name: "Inspection-drone V4 qualitative architecture",
    kind: "sysml-model",
    version: architectureFingerprint.digest,
    fingerprint: architectureFingerprint,
    uri:
      `casys://inspection-drone-v4-architecture-capture/sha256/${architectureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture",
    },
    inputArtifactIds: [seed.id],
    freshness: fresh(),
  };
  const r3Extension = applyThreadSnapshotExtensionIfNew(r2, {
    id: `capture-${architecture.id}`,
    name: "Capture the reviewed inspection-drone architecture",
    subjectId: SUBJECT_ID,
    capturedAt: TIME,
    artifacts: [architecture],
    consumptions: [{
      id: `consume-${seed.id}-by-${architecture.id}`,
      artifactId: seed.id,
      consumer: architecture.producer,
      observedFingerprint: seed.fingerprint,
      verifiedAt: TIME,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [{
      id: `link-${architecture.id}-derived-from-${seed.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: architecture.id },
      to: { kind: "artifact", id: seed.id },
      rationale: "The r3 architecture consumes the exact r2 SysON seed.",
    }, {
      id: `link-consume-${seed.id}-by-${architecture.id}-uses-${seed.id}`,
      relation: "uses",
      from: { kind: "consumption", id: `consume-${seed.id}-by-${architecture.id}` },
      to: { kind: "artifact", id: seed.id },
      rationale: "The architecture record retains its exact seed consumption.",
    }],
    bindingProofs: [],
  }, { appliedAt: TIME });
  assert(r3Extension.applied);
  await snapshots.save(r3Extension.snapshot);
  project = await commands.claimRun(AGENT, {
    ...context("claim-architecture", project.revision),
    runId: "run:architecture",
    summary: "Claim the reviewed architecture record.",
  });
  project = await commands.publishRun(AGENT, {
    ...context("publish-architecture", project.revision),
    runId: "run:architecture",
    summary: "Publish the reviewed architecture record.",
  });
  project = await commands.completeRun(AGENT, {
    ...context("complete-architecture", project.revision),
    runId: "run:architecture",
    summary: "Attach the exact r3 architecture evidence.",
    resultSnapshot: {
      snapshotId: r3Extension.snapshot.id,
      revision: r3Extension.snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    evidenceRefs: [{
      snapshotId: r3Extension.snapshot.id,
      snapshotRevision: r3Extension.snapshot.revision,
      kind: "artifact",
      id: architecture.id,
    }],
  });
  const r3Reference = project.threadSnapshots.at(-1)!;
  project = await commands.appendChange(AGENT, {
    ...context("append-product", project.revision),
    baseSnapshot: r3Reference,
    phases: [{
      id: "product",
      name: "Product structure",
      description: "Read six PartDefinitions.",
    }],
    workItems: [{
      id: "product",
      phaseId: "product",
      owner: "agent",
      dependsOnWorkItemIds: ["architecture"],
      decisionIds: [],
      operation: {
        ...INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
        bindings: [{
          name: "architecture",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: r3Reference.snapshotId,
              snapshotRevision: r3Reference.revision,
              kind: "artifact",
              id: options.wrongBinding ? seed.id : architecture.id,
            },
          },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-product", project.revision),
    runId: "run:product",
    workItemId: "product",
    summary: "Capture the exact six PartDefinitions.",
    basis: { kind: "thread-snapshot", ...r3Reference },
  });
  const syson = new ProductStructureSyson(options.corruption);
  const runId = "run:product";
  const executor = new InspectionDroneV4PartDefinitionsRunExecutor({
    projects,
    commands,
    snapshots,
    architectureCaptures,
    captures: partCaptures,
    syson,
    lease: new FileEngineeringProjectRunLease(`${directory}/part-leases`),
    publications,
  });
  return {
    directory,
    projects,
    snapshots,
    partCaptures,
    publications,
    architecture,
    syson,
    runId,
    executor,
    command: () => ({
      commandId: "execute-product",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: TIME,
      runId,
    }),
  };
}

function architectureCaptureFor(seed: ThreadArtifact, seedCapture: {
  normalizedResults: {
    project: { editingContextId: string };
    rootPackage: { id: string };
  };
}) {
  const declarations = [
    ...INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT.map((label, index) => ({
      id: PART_IDS[index]!,
      kind: "sysml::PartDefinition",
      label,
    })),
    ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement, index) => ({
      id: REQUIREMENT_IDS[index]!,
      kind: "sysml::RequirementDefinition",
      label: requirement.label,
    })),
  ];
  return {
    schemaVersion: "inspection-drone-v4-architecture-capture/1.0",
    kind: "inspection-drone-v4-architecture",
    scope: "bounded-qualitative-system-model",
    statement: "Frozen reviewed qualitative architecture fixture.",
    capturedAt: TIME,
    trustedRunId: "run:architecture",
    operation: INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
    authorization: { projectId: PROJECT_ID, approvedBriefBasis: {} },
    seed: {
      artifactId: seed.id,
      fingerprint: seed.fingerprint,
      editingContextId: seedCapture.normalizedResults.project.editingContextId,
      rootPackageId: seedCapture.normalizedResults.rootPackage.id,
    },
    recipe: { textSha256: { algorithm: "sha256", digest: RECIPE_DIGEST } },
    insertion: {
      parentId: seedCapture.normalizedResults.rootPackage.id,
      textSha256: RECIPE_DIGEST,
    },
    architecturePackage: {
      id: "inspection-drone-architecture-package",
      kind: "sysml::Package",
      label: "InspectionDroneArchitecture",
    },
    declarations,
    readback: {
      provider: {
        partStructureTool: "syson_part_structure",
        partUsageFeatureTypingQuery:
          "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type",
        requirementDocumentationQuery:
          "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::Documentation))->first().body",
      },
      inspectionDrone: declarations[0],
      partUsages: INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map((usage, index) => ({
        usage: { id: USAGE_IDS[index]!, kind: "sysml::PartUsage", label: usage.label },
        type: declarations[index + 1]!,
      })),
      requirements: INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((
        requirement,
        index,
      ) => ({
        requirement: declarations[index + 6]!,
        documentation: requirement.documentation,
      })),
    },
    explicitTbd: [
      "site-weather-and-separation",
      "camera-mass-power-dimensions-and-fixation",
      "autonomy-wind-and-battery-reserve",
    ],
  };
}

function context(commandId: string, expectedRevision: number) {
  return { commandId, projectId: PROJECT_ID, expectedRevision, issuedAt: TIME };
}

function fresh() {
  return { status: "fresh" as const, changedAt: TIME, invalidatedByChangeIds: [] };
}

class SeedSyson implements McpToolClient {
  async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name === "syson_project_create") {
      return result({
        id: "project",
        name: "Inspection drone",
        editingContextId: "editing-context",
      });
    }
    if (call.name === "syson_model_create") {
      return result({
        documentId: "document",
        documentName: "Inspection drone",
        documentKind: "Document",
        rootPackageId: "root-package",
        rootPackageLabel: "New Package",
      });
    }
    if (call.name === "syson_element_get") {
      return result({
        id: "root-package",
        kind: "sysml::Package",
        label: "New Package",
      });
    }
    throw new Error(`Unexpected seed tool ${call.name}`);
  }
  async callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    throw new Error(`Unexpected seed text tool ${call.name}`);
  }
}

class ProductStructureSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  rejectCalls = false;
  constructor(private readonly corruption?: Corruption) {}
  async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (this.rejectCalls) {
      throw new Error("Provider must not be read during completed replay.");
    }
    this.calls.push(structuredClone(call));
    if (call.name !== "syson_part_structure") {
      throw new Error(`Unexpected provider tool ${call.name}`);
    }
    const index = PART_IDS.indexOf(
      String(call.arguments?.root_element_id) as typeof PART_IDS[number],
    );
    if (index < 0) throw new Error("Unexpected PartDefinition id.");
    const definition = {
      id: PART_IDS[index]!,
      kind: "sysml::PartDefinition",
      label: INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT[index]!,
    };
    const tree = index === 0
      ? INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map((usage, usageIndex) => ({
        id: USAGE_IDS[usageIndex]!,
        kind: "sysml::PartUsage",
        label: usage.label,
        quantity: this.corruption === "quantity-two" ? 2 : 1,
        quantitySource: "sysml-default",
        children: [],
      }))
      : [];
    return result({
      root: this.corruption === "wrong-root"
        ? { ...definition, id: "wrong-root" }
        : definition,
      tree,
      partCount: this.corruption === "part-count" ? tree.length + 1 : tree.length,
      maxDepthReached: this.corruption === "max-depth",
    });
  }
  async callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    throw new Error(`Unexpected provider text tool ${call.name}`);
  }
}

function result(structuredContent: Record<string, unknown>): McpToolResult {
  return { text: "read", structuredContent };
}
