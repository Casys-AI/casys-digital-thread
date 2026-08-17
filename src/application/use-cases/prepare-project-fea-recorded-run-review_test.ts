import { assertEquals, assertExists } from "@std/assert";
import { canonicalProofText } from "../../domain/analysis/fea-proof-proposal.ts";
import { parseFeaProofCaseCapture } from "../../domain/analysis/fea-proof-case-capture.ts";
import { validateMechanicalProofCase } from "../../domain/analysis/mechanical-proof-case.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { PrepareProjectFeaRecordedRunReview } from "./prepare-project-fea-recorded-run-review.ts";

const AT = "2026-08-16T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl06";
const SUBJECT_ID = "project:desk-lamp-dl06";
const STEP_DIGEST = "eec1fd0f1526161d9957b4693ab7d3ae67945870dcd75a5a91d21fd11f63140d";
const GEOM_DIGEST = "b".repeat(64);
const REQ_DIGEST = "c".repeat(64);

Deno.test("recorded-run review binds the canonical part STEP and lists the cad-model as a rejected lookalike", async () => {
  const world = await harness();
  const result = await world.review.execute(world.command);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertExists(result.bindings);
  assertEquals(result.operation.id, "verify.run-fea-static-proof");
  assertEquals(result.operation.version, "2");
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

Deno.test("recorded-run review selects the unique sealed proof when proofArtifactId is omitted", async () => {
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

Deno.test("recorded-run review selects the current Thread tip when basis is omitted", async () => {
  const world = await harness();
  const review = new PrepareProjectFeaRecordedRunReview({
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

Deno.test("recorded-run review refuses latest as an unresolved basis-latest", async () => {
  const world = await harness();
  const result = await world.review.execute({
    projectId: PROJECT_ID,
    basis: { ...world.command.basis, snapshotId: "latest" },
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.bindings, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["basis-latest"]);
});

Deno.test("recorded-run review refuses a cad-model offered as the sealed proof document", async () => {
  const world = await harness();
  const result = await world.review.execute({
    ...world.command,
    proofArtifactId: world.geometryId,
  });
  assertEquals(result.status, "unresolved");
  assertEquals(result.bindings, undefined);
  assertEquals(result.diagnostics.map((item) => item.code), ["proof-not-document"]);
});

Deno.test("recorded-run review is unresolved when the sealed STEP is absent from the basis", async () => {
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

Deno.test("recorded-run review emits no paste-ready hop from a historical project basis", async () => {
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
  const review = new PrepareProjectFeaRecordedRunReview({
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

Deno.test("recorded-run review is unresolved when compiled identities already exist", async () => {
  const world = await harness();
  const ready = await world.review.execute(world.command);
  assertEquals(ready.status, "resolved");
  if (ready.status !== "resolved") return;
  assertExists(ready.selected.workItemId);
  const project = {
    ...projectState(world.snapshot),
    workItems: [{ id: ready.selected.workItemId }],
  } as unknown as EngineeringProjectSnapshot;
  const review = new PrepareProjectFeaRecordedRunReview({
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

async function harness(options: { readonly omitStep?: boolean } = {}) {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
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
    reviewRecordedCalculixAdmission() {
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
  const review = new PrepareProjectFeaRecordedRunReview({
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

function projectState(snapshot: ThreadSnapshot): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
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
