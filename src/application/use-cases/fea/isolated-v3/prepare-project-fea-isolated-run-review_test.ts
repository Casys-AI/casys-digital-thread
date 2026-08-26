import { assertEquals, assertExists } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { canonicalProofText } from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import { parseFeaProofCaseCapture } from "../../../../domain/fea/seal-case/fea-proof-case-capture.ts";
import { validateMechanicalProofCase } from "../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import { engineeringActivityIdFromRootRevision } from "../../../../domain/project/engineering-activity.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { EngineeringProjectCommandService } from "../../project/engineering-project-command-service.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "../../../../tools/project-control.ts";
import { PrepareProjectFeaIsolatedRunReview } from "./prepare-project-fea-isolated-run-review.ts";
import type { ProjectFeaIsolatedRunReviewResult } from "../../../ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts";

const AT = "2026-08-16T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl06";
const SUBJECT_ID = "project:desk-lamp-dl06";
const STEP_DIGEST = "eec1fd0f1526161d9957b4693ab7d3ae67945870dcd75a5a91d21fd11f63140d";
const GEOM_DIGEST = "b".repeat(64);
const REQ_DIGEST = "c".repeat(64);

Deno.test("isolated-run review binds the canonical part STEP and lists the cad-model as a rejected lookalike", async () => {
  const world = await harness();
  const result = await world.review.execute(world.command);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertExists(result.bindings);
  assertEquals(result.operation.id, "verify.run-fea-static-proof");
  assertEquals(result.operation.version, "3");
  assertEquals(
    result.operation.bindings.map((binding) => binding.name),
    ["proofCase", "geometry"],
  );
  assertEquals(
    result.bindings.map((binding) => [
      binding.name,
      binding.source.kind === "thread-entity" ? binding.source.reference.id : null,
    ]),
    [
      ["proofCase", world.proofArtifactId],
      ["geometry", world.stepId],
    ],
  );
  assertEquals(result.rejectedLookalikes.map((item) => item.code), [
    "geometry-is-cad-model",
  ]);
  assertEquals(world.snapshots.saves, 0);
});

Deno.test("isolated-run review selects the unique sealed proof when proofArtifactId is omitted", async () => {
  const world = await harness();
  const result = await world.review.execute({
    projectId: PROJECT_ID,
    basis: world.command.basis,
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertExists(result.bindings);
  assertEquals(result.basis, world.command.basis);
  assertEquals(result.next.append.tool, "project_change_append");
  assertEquals(result.next.propose.tool, "project_decision_propose");
  assertEquals(
    result.next.append.arguments.workItems[0]?.operation,
    result.operation,
  );
  assertEquals(
    result.next.append.arguments.workItems[0]?.operation.bindings,
    result.bindings,
  );
  assertEquals(result.selected.proofArtifactId, world.proofArtifactId);
  assertEquals(result.selected.stepArtifactId, world.stepId);
  assertEquals(
    result.next.append.arguments.workItems[0]?.id,
    result.selected.workItemId,
  );
  assertEquals(
    result.next.append.arguments.requiredDecisions[0]?.id,
    result.selected.decisionId,
  );
  assertEquals(
    result.next.propose.arguments.decisionId,
    result.selected.decisionId,
  );
  assertEquals(result.next.queue.workItemId, result.selected.workItemId);
  assertEquals("predecessorWorkItemId" in result.selected, false);
  assertEquals("failedRunId" in result.selected, false);
  assertEquals(
    "predecessorRevisionId" in (result.next.append.arguments.workItems[0] ?? {}),
    false,
  );
  assertEquals(result.next.append.arguments.phases.length, 1);
  assertEquals(
    result.next.propose.arguments.proposal.summary.includes("cad-model"),
    true,
  );
  assertEquals(
    result.next.propose.arguments.proposal.parameters.map((parameter) => parameter.key),
    ["review.proofArtifactId", "review.stepArtifactId"],
  );
  assertEquals(
    result.next.propose.arguments.proposal.parameters.some((parameter) =>
      String(parameter.key).startsWith("fea.run.")
    ),
    false,
  );
  assertEquals(
    result.bindings[0]?.source.kind === "thread-entity"
      ? result.bindings[0].source.reference.id
      : null,
    world.proofArtifactId,
  );
});

Deno.test("isolated-run review selects the current Thread tip when basis is omitted", async () => {
  const world = await harness();
  const review = new PrepareProjectFeaIsolatedRunReview({
    snapshots: world.snapshots,
    admissionReviewer: world.admissionReviewer,
    projects: new MemoryProjects(world.snapshot),
  });
  const result = await review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.basis.revision, world.command.basis.revision);
  assertExists(result.bindings);
  assertEquals(result.next.append.arguments.expectedRevision, 12);
});

Deno.test("isolated-run review refuses latest as an unresolved basis-latest", async () => {
  const world = await harness();
  const result = await world.review.execute({
    projectId: PROJECT_ID,
    basis: { ...world.command.basis, snapshotId: "latest" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.bindings, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-latest"]);
});

Deno.test("isolated-run review refuses a cad-model offered as the sealed proof document", async () => {
  const world = await harness();
  const result = await world.review.execute({
    ...world.command,
    proofArtifactId: world.geometryId,
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.bindings, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["proof-not-document"]);
});

Deno.test("isolated-run review is unresolved when the sealed STEP is absent from the basis", async () => {
  const world = await harness({ omitStep: true });
  const result = await world.review.execute(world.command);
  assertEquals(result.status, "unresolved");
  assertEquals(result.bindings, undefined);
  assertEquals(
    result.diagnostics.some((item) => item.code === "queue-admission-rejected"),
    true,
  );
  assertEquals(
    result.diagnostics.some((item) => item.message.includes("absent")),
    true,
  );
});

Deno.test("isolated-run review emits no paste-ready hop from a historical project basis", async () => {
  const world = await harness();
  const current = {
    kind: "thread-snapshot" as const,
    snapshotId: "snap-fea-run-current",
    revision: 7,
    subjectId: SUBJECT_ID,
  };
  const project = {
    ...projectState(world.snapshot),
    threadSnapshots: [
      projectState(world.snapshot).threadSnapshots[0]!,
      current,
    ],
  } as EngineeringProjectSnapshot;
  const review = new PrepareProjectFeaIsolatedRunReview({
    snapshots: world.snapshots,
    admissionReviewer: world.admissionReviewer,
    projects: { get: () => Promise.resolve(project) },
  });

  const result = await review.execute(world.command);

  assertEquals(result.status, "unavailable");
  assertEquals(result.next, undefined);
  assertEquals(result.bindings, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["basis-not-current"],
  );
});

Deno.test("isolated-run review refuses first-run append when only the compiled decision already exists", async () => {
  const world = await harness();
  const ready = await world.review.execute(world.command);
  assertEquals(ready.status, "resolved");
  if (ready.status !== "resolved") return;
  const project = {
    ...projectState(world.snapshot),
    decisions: [{ id: ready.selected.decisionId, phaseId: "verification" }],
  } as unknown as EngineeringProjectSnapshot;
  const review = new PrepareProjectFeaIsolatedRunReview({
    snapshots: world.snapshots,
    admissionReviewer: world.admissionReviewer,
    projects: { get: () => Promise.resolve(project) },
  });
  const result = await review.execute(world.command);
  assertEquals(result.status, "unresolved");
  assertEquals(result.next, undefined);
  assertEquals(result.bindings, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["compiled-identities-conflict"],
  );
});

Deno.test("isolated-run review refuses a compiled root that has no qualifying failed run", async () => {
  const world = await harness();
  const ready = await world.review.execute(world.command);
  assertEquals(ready.status, "resolved");
  if (ready.status !== "resolved") return;
  const review = reviewAgainst(
    world,
    projectWithActivity(world, ready, {
      runs: [],
    }),
  );
  const result = await review.execute(world.command);
  assertEquals(result.status, "unresolved");
  assertEquals(result.next, undefined);
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["activity-attempt-missing"],
  );
});

Deno.test("isolated-run review compiles a successor after one evidence-free output-validation failure", async () => {
  const world = await harness();
  const first = await world.review.execute(world.command);
  assertEquals(first.status, "resolved");
  if (first.status !== "resolved") return;
  const failedRunId = "run:fea-isolated-output-validation";
  const review = reviewAgainst(
    world,
    projectWithActivity(world, first, {
      runs: [failedIsolatedRun(first.selected.workItemId, failedRunId)],
    }),
  );
  const result = await review.execute(world.command);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.operation, first.operation);
  assertEquals(result.bindings, first.bindings);
  assertEquals(result.selected.predecessorWorkItemId, first.selected.workItemId);
  assertEquals(result.selected.failedRunId, failedRunId);
  assertEquals(result.selected.workItemId, `${first.selected.workItemId}-2`);
  assertEquals(result.selected.decisionId, `${first.selected.decisionId}-2`);
  assertEquals(result.selected.workItemId === first.selected.workItemId, false);
  assertEquals(result.next.append.arguments.phases, []);
  assertEquals(
    result.next.append.arguments.workItems[0]?.predecessorRevisionId,
    first.selected.workItemId,
  );
  assertEquals(
    result.next.append.arguments.workItems[0]?.phaseId,
    first.next.append.arguments.workItems[0]?.phaseId,
  );
  assertEquals(
    result.next.append.arguments.workItems[0]?.operation,
    first.operation,
  );
  assertEquals(
    result.next.append.arguments.workItems[0]?.dependsOnWorkItemIds,
    ["work-step-export"],
  );
  assertEquals(
    result.next.append.arguments.requiredDecisions[0]?.id,
    result.selected.decisionId,
  );
  assertEquals(result.next.propose.arguments.decisionId, result.selected.decisionId);
  assertEquals(
    result.next.propose.arguments.proposal.parameters.some((parameter) =>
      parameter.key === "review.predecessorWorkItemId" &&
      parameter.value === first.selected.workItemId
    ),
    true,
  );
  assertEquals(
    result.next.propose.arguments.proposal.parameters.some((parameter) =>
      parameter.key === "review.failedRunId" && parameter.value === failedRunId
    ),
    true,
  );
  assertEquals(
    result.next.propose.arguments.proposal.summary.includes(failedRunId),
    true,
  );
});

Deno.test("isolated-run successor review is deterministic on replay", async () => {
  const world = await harness();
  const first = await world.review.execute(world.command);
  assertEquals(first.status, "resolved");
  if (first.status !== "resolved") return;
  const review = reviewAgainst(
    world,
    projectWithActivity(world, first, {
      runs: [failedIsolatedRun(first.selected.workItemId, "run:fea-replay")],
    }),
  );
  const left = await review.execute(world.command);
  const right = await review.execute(world.command);
  assertEquals(left, right);
  assertEquals(left.status, "resolved");
  if (left.status !== "resolved") return;
  assertEquals(left.selected.workItemId, `${first.selected.workItemId}-2`);
  assertEquals(left.selected.failedRunId, "run:fea-replay");
});

Deno.test("isolated-run review refuses a successor that itself has no qualifying failed run", async () => {
  const world = await harness();
  const first = await world.review.execute(world.command);
  assertEquals(first.status, "resolved");
  if (first.status !== "resolved") return;
  const successorId = `${first.selected.workItemId}-2`;
  const review = reviewAgainst(
    world,
    projectWithActivity(world, first, {
      extraWork: [successorWork(first, successorId)],
      runs: [failedIsolatedRun(first.selected.workItemId, "run:root-failed")],
    }),
  );
  const result = await review.execute(world.command);
  assertEquals(result.status, "unresolved");
  assertEquals(
    result.diagnostics.map((item) => item.code),
    ["activity-attempt-missing"],
  );
});

Deno.test("isolated-run review derives the next successor after a later qualifying failure", async () => {
  const world = await harness();
  const first = await world.review.execute(world.command);
  assertEquals(first.status, "resolved");
  if (first.status !== "resolved") return;
  const successorId = `${first.selected.workItemId}-2`;
  const review = reviewAgainst(
    world,
    projectWithActivity(world, first, {
      extraWork: [successorWork(first, successorId)],
      runs: [failedIsolatedRun(successorId, "run:successor-failed")],
    }),
  );
  const result = await review.execute(world.command);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.selected.predecessorWorkItemId, successorId);
  assertEquals(result.selected.failedRunId, "run:successor-failed");
  assertEquals(result.selected.workItemId, `${first.selected.workItemId}-3`);
  assertEquals(
    result.next.append.arguments.workItems[0]?.predecessorRevisionId,
    successorId,
  );
});

Deno.test("isolated-run successor append matches the project_change_append grammar", async () => {
  const world = await harness();
  const first = await world.review.execute(world.command);
  assertEquals(first.status, "resolved");
  if (first.status !== "resolved") return;
  const project = projectWithActivity(world, first, {
    runs: [failedIsolatedRun(first.selected.workItemId, "run:fea-append-shape")],
  });
  const review = reviewAgainst(world, project);
  const result = await review.execute(world.command);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;

  const decoded: Array<Record<string, unknown>> = [];
  const app = new CapturingApp();
  registerProjectControlTools(
    app as unknown as McpApp,
    {
      projects: {
        get: () => Promise.resolve(project),
        getRevision: () => Promise.resolve(project),
      },
      commands: {
        appendChange: (
          _origin: unknown,
          command: { readonly workItems: readonly unknown[] },
        ) => {
          decoded.push(command as unknown as Record<string, unknown>);
          return Promise.resolve(project);
        },
      } as unknown as EngineeringProjectCommandService,
    } as ProjectControlToolDependencies,
  );
  await app.handler("project_change_append")({
    commandId: "fea-isolated-successor-append",
    projectId: PROJECT_ID,
    issuedAt: AT,
    ...result.next.append.arguments,
  }, { toolName: "project_change_append" });
  assertEquals(decoded.length, 1);
  const work = (decoded[0]!.workItems as Array<Record<string, unknown>>)[0];
  assertEquals(work?.predecessorRevisionId, first.selected.workItemId);
  assertEquals(decoded[0]!.phases, []);
  assertEquals(work?.operation, result.operation);
});

async function harness(options: { readonly omitStep?: boolean } = {}) {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
      ),
    ),
  );
  const geometryId = `geometry-${GEOM_DIGEST}`;
  const stepId = `cad-asset-${GEOM_DIGEST}-definition-0-0-${STEP_DIGEST}`;
  const reqId = "req-Arm-test";
  const geomFp = fp(GEOM_DIGEST);
  const stepFp = fp(STEP_DIGEST);
  const reqFp = fp(REQ_DIGEST);
  const captureRecord = {
    schemaVersion: "fea-proof-case-capture/1.0",
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: {
      id: geometryId,
      fingerprint: geomFp,
      producerRunId: "run-geom",
    },
    stepArtifact: {
      id: stepId,
      fingerprint: stepFp,
      producerRunId: "run-geom",
      bytes: proofCase.expectedCadArtifact.bytes,
    },
    requirementsArtifact: {
      id: reqId,
      fingerprint: reqFp,
      producerRunId: "run-req",
    },
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: AT,
  };
  const captureText = deterministicJson(captureRecord);
  const capture = await parseFeaProofCaseCapture(captureText);
  const captureFp = await sha256Fingerprint(JSON.parse(captureText));
  const proofArtifactId = `fea-proof-${captureFp.digest}`;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-fea-run",
    revision: 6,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Desk Lamp DL06",
      kind: "system",
      version: "r6",
      modelArtifactId: geometryId,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.fea-run",
      name: "FEA run basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        change("change.geom", geometryId, geomFp),
        change("change.req", reqId, reqFp),
        ...(options.omitStep ? [] : [change("change.step", stepId, stepFp)]),
        change("change.proof", proofArtifactId, captureFp),
      ],
    },
    artifacts: [
      artifact(geometryId, "Geometry", "cad-model", geomFp, {
        uri: `casys://geometry-capture/sha256/${GEOM_DIGEST}`,
        mediaType: "application/json",
        tool: "design.write-geometry@1",
        runId: "run-geom",
      }),
      artifact(reqId, "Requirements", "sysml-model", reqFp, {
        uri: `casys://requirements-capture/Arm/sha256/${REQ_DIGEST}`,
        mediaType: "application/json",
        tool: "model.write-requirements@1",
        runId: "run-req",
      }),
      ...(options.omitStep ? [] : [
        artifact(stepId, "Arm STEP", "step", stepFp, {
          uri: `casys://step-export/${STEP_DIGEST}.step`,
          mediaType: "model/step",
          tool: "design.write-geometry@1",
          runId: "run-geom",
        }),
      ]),
      artifact(proofArtifactId, "FEA proof", "document", captureFp, {
        uri: `casys://fea-proof-case-capture/sha256/${captureFp.digest}`,
        mediaType: "application/json",
        tool: "verify.seal-proof-case@1",
        runId: "run-seal",
      }),
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      link("change.geom", geometryId),
      link("change.req", reqId),
      ...(options.omitStep ? [] : [link("change.step", stepId)]),
      link("change.proof", proofArtifactId),
    ],
    proposedActions: [],
  });
  const snapshots = new MemorySnapshots(snapshot);
  const admissionReviewer = {
    reviewIsolatedCalculixAdmission() {
      const stepArtifact = snapshot.artifacts.find((artifact) =>
        artifact.id === capture.stepArtifact.id
      );
      if (!stepArtifact) {
        return Promise.reject(
          new Error(
            `The sealed proof names STEP artifact "${capture.stepArtifact.id}", but it is absent from the exact basis.`,
          ),
        );
      }
      return Promise.resolve({
        capture,
        stepArtifact,
        stepBytes: new Uint8Array(capture.stepArtifact.bytes),
      });
    },
  };
  const review = new PrepareProjectFeaIsolatedRunReview({
    snapshots,
    admissionReviewer,
    projects: new MemoryProjects(snapshot),
  });
  return {
    review,
    snapshots,
    snapshot,
    admissionReviewer,
    proofArtifactId,
    geometryId,
    stepId,
    command: {
      projectId: PROJECT_ID,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: SUBJECT_ID,
      },
      proofArtifactId,
    },
  };
}

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function change(id: string, artifactId: string, fingerprint: ContentFingerprint) {
  return {
    id,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Created ${artifactId}.`,
    afterFingerprint: fingerprint,
  };
}

function link(changeId: string, artifactId: string) {
  return {
    id: `prov-${artifactId}`,
    relation: "changes" as const,
    from: { kind: "change" as const, id: changeId },
    to: { kind: "artifact" as const, id: artifactId },
    rationale: `Created ${artifactId}.`,
  };
}

function artifact(
  id: string,
  name: string,
  kind: "cad-model" | "sysml-model" | "step" | "document",
  fingerprint: ContentFingerprint,
  extra: {
    readonly uri: string;
    readonly mediaType: string;
    readonly tool: string;
    readonly runId: string;
  },
) {
  return {
    id,
    name,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri: extra.uri,
    mediaType: extra.mediaType,
    producer: {
      serverId: "digital-thread",
      tool: extra.tool,
      runId: extra.runId,
    },
    inputArtifactIds: [] as string[],
    freshness: fresh(),
  };
}

class MemorySnapshots {
  saves = 0;
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(id: string) {
    return Promise.resolve(id === this.snapshot.id ? this.snapshot : undefined);
  }
  latest(_subjectId: string) {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a Thread snapshot"));
  }
}

class MemoryProjects {
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(projectId: string) {
    return Promise.resolve(
      projectId === PROJECT_ID ? projectState(this.snapshot) : undefined,
    );
  }
}

function reviewAgainst(
  world: Awaited<ReturnType<typeof harness>>,
  project: EngineeringProjectSnapshot,
) {
  return new PrepareProjectFeaIsolatedRunReview({
    snapshots: world.snapshots,
    admissionReviewer: world.admissionReviewer,
    projects: { get: () => Promise.resolve(project) },
  });
}

function projectWithActivity(
  world: Awaited<ReturnType<typeof harness>>,
  first: Extract<ProjectFeaIsolatedRunReviewResult, { status: "resolved" }>,
  options: {
    readonly runs: readonly EngineeringAgentRun[];
    readonly extraWork?: readonly EngineeringWorkItem[];
  },
): EngineeringProjectSnapshot {
  const root = isolatedWorkItem(first, first.selected.workItemId);
  const workItems = [root, ...(options.extraWork ?? [])];
  const phaseId = first.next.append.arguments.workItems[0]!.phaseId;
  return {
    ...projectState(world.snapshot),
    phases: [{
      id: phaseId,
      name: "Isolated FEA verification",
      order: 1,
      description: "Run the isolated CalculiX proof on the canonical part STEP.",
      workItemIds: workItems.map((item) => item.id),
      requiredDecisionIds: [first.selected.decisionId],
      evidenceRefs: [],
    }],
    workItems,
    agentRuns: [...options.runs],
    decisions: [{
      id: first.selected.decisionId,
      phaseId,
      title: "Approve isolated FEA proof run",
      question:
        "Approve verify.run-fea-static-proof@3 for this exact sealed proof and canonical STEP?",
      status: "approved",
      requestedAt: AT,
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
  } as EngineeringProjectSnapshot;
}

function isolatedWorkItem(
  first: Extract<ProjectFeaIsolatedRunReviewResult, { status: "resolved" }>,
  id: string,
  predecessorRevisionId?: string,
): EngineeringWorkItem {
  return {
    id,
    activityId: engineeringActivityIdFromRootRevision(first.selected.workItemId),
    ...(predecessorRevisionId ? { predecessorRevisionId } : {}),
    phaseId: first.next.append.arguments.workItems[0]!.phaseId,
    title: "Isolated FEA verification",
    description: "Run the isolated CalculiX proof on the canonical part STEP.",
    kind: "verify",
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: ["work-step-export"],
    evidenceRefs: [],
    decisionIds: predecessorRevisionId
      ? [`${first.selected.decisionId}-2`]
      : [first.selected.decisionId],
    blockerIds: [],
    operation: first.operation as EngineeringOperationRef,
  };
}

function successorWork(
  first: Extract<ProjectFeaIsolatedRunReviewResult, { status: "resolved" }>,
  id: string,
): EngineeringWorkItem {
  return isolatedWorkItem(first, id, first.selected.workItemId);
}

function failedIsolatedRun(workItemId: string, runId: string): EngineeringAgentRun {
  return {
    id: runId,
    workItemId,
    status: "failed",
    summary: "Isolated output validation rejected the worker bundle.",
    queuedAt: AT,
    startedAt: AT,
    completedAt: AT,
    evidenceRefs: [],
    failure: {
      code: "isolated_output_validation_failed",
      message: "Isolated output validation rejected registered role result.json.",
    },
  };
}

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Expected ${name} handler to be registered.`);
    return handler;
  }
}

function projectState(snapshot: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r12`,
    revision: 12,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Desk Lamp DL06",
      subjectId: SUBJECT_ID,
      objective: {
        title: "Run the recorded proof",
        statement: "Run the exact sealed proof against the canonical part STEP.",
      },
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  } as EngineeringProjectSnapshot;
}
