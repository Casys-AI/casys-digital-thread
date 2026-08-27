import { assertEquals } from "@std/assert";
import { PrepareProjectAssemblyIntegrityEvaluationCloseoutReview } from "./prepare-project-assembly-integrity-evaluation-closeout-review.ts";
import { assemblyIntegrityEvaluationCloseoutReviewNext } from "../../../application/use-cases/cad/assembly-integrity/assembly-integrity-evaluation-closeout-review-next.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  assemblyIntegrityEvaluationMethod,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import { evaluateAssemblyIntegrityWorkItemOperation } from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY } from "../../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import { applyThreadSnapshotExtension } from "../../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const DIGEST_E = "e".repeat(64);
const DIGEST_F = "f".repeat(64);
const AT = "2026-08-26T10:00:00.000Z";
const PROJECT_ID = "project-assembly";
const SUBJECT_ID = "assembly-subject";
const GATE_ID = "verification.assembly-integrity";

Deno.test("assembly-integrity L5 public review reads only an exact projectId request", async () => {
  let projectReads = 0;
  const review = new PrepareProjectAssemblyIntegrityEvaluationCloseoutReview({
    projects: {
      get: () => {
        projectReads++;
        return Promise.resolve(undefined);
      },
    },
    snapshots: {
      get: () => Promise.resolve(undefined),
      latest: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
    },
    evaluationCaptures: {
      read: () => Promise.resolve(undefined),
    },
  });

  const result = await review.execute({
    projectId: "project-assembly",
    provider: "forbidden",
    tolerance: 0.01,
    verdict: "pass",
    gateItemId: "caller-gate",
    syson: { requirement: "forbidden" },
  });

  assertEquals(projectReads, 0);
  assertEquals(result, {
    status: "unavailable",
    family: "assembly-integrity",
    diagnostic: {
      code: "invalid_request",
      message:
        "The assembly-integrity evaluation-closeout review request must name exactly one project.",
    },
  });
});

Deno.test("assembly-integrity L5 review exposes freshness-bound accept and reject next.append", async () => {
  const fixture = await reviewFixture();
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;

  const accept = result.selected.accept;
  if (accept === undefined) throw new Error("Expected accept on a five-pass L4.");
  const expectedAccept = assemblyIntegrityEvaluationCloseoutReviewNext({
    projectId: PROJECT_ID,
    expectedRevision: fixture.project.revision,
    l4WorkItemId: "work-l4",
    baseSnapshot: {
      snapshotId: fixture.l4Snapshot.id,
      revision: fixture.l4Snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    admission: accept.admission,
  });
  const expectedReject = assemblyIntegrityEvaluationCloseoutReviewNext({
    projectId: PROJECT_ID,
    expectedRevision: fixture.project.revision,
    l4WorkItemId: "work-l4",
    baseSnapshot: {
      snapshotId: fixture.l4Snapshot.id,
      revision: fixture.l4Snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    admission: result.selected.reject.admission,
  });

  assertEquals(accept.next, expectedAccept);
  assertEquals(result.selected.reject.next, expectedReject);
  assertEquals(accept.next.append.arguments.workItems[0]?.gateClaims, [{
    gateItemId: GATE_ID,
    role: "satisfies",
    status: "current",
  }]);
  assertEquals(
    result.selected.reject.next.append.arguments.workItems[0]?.gateClaims,
    [],
  );
  assertEquals(
    accept.next.append.arguments.baseSnapshot.revision,
    fixture.l4Snapshot.revision,
  );
  assertEquals(accept.next.propose.arguments.projectId, PROJECT_ID);
  assertEquals(
    accept.next.propose.arguments.expectedRevision,
    fixture.project.revision + 1,
  );
  assertEquals(
    result.selected.reject.next.propose.arguments.expectedRevision,
    fixture.project.revision + 1,
  );
  assertEquals("issuedAt" in accept.next.propose.arguments, false);
  assertEquals(fixture.snapshotSaves(), 0);
  assertEquals(fixture.project.revision, 2);
});

Deno.test("TPS03: L5 accept next.append includes the gateClaims whose omission execute refuses", async () => {
  const fixture = await reviewFixture();
  const result = await fixture.review.execute({ projectId: PROJECT_ID });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  const accept = result.selected.accept;
  if (accept === undefined) throw new Error("Expected accept on a five-pass L4.");

  const leaf = accept.next.append.arguments.workItems[0];
  assertEquals(leaf?.gateClaims, accept.admission.gateClaims);
  assertEquals(leaf?.gateClaims, [{
    gateItemId: GATE_ID,
    role: "satisfies",
    status: "current",
  }]);
  assertEquals(leaf?.owner, "human");
  assertEquals(leaf?.dependsOnWorkItemIds, ["work-l4"]);
  assertEquals(
    result.selected.reject.next.append.arguments.workItems[0]?.gateClaims.some(
      (claim) => claim.role === "satisfies",
    ),
    false,
  );
});

async function reviewFixture() {
  const root = rootSnapshot();
  const l4Capture = await l4CaptureFixture({
    kind: "thread-snapshot" as const,
    snapshotId: root.id,
    revision: root.revision,
    subjectId: root.subject.id,
  });
  const l4Fingerprint = await sha256Fingerprint(l4Capture);
  const l4Artifact = l4CaptureArtifact(l4Capture, l4Fingerprint);
  const l4Sources = root.artifacts.filter((artifact) =>
    l4Artifact.inputArtifactIds.includes(artifact.id)
  );
  const l4Consumptions = l4Sources.map((source) => ({
    id: `consume-${source.id}-by-${l4Artifact.id}`,
    artifactId: source.id,
    consumer: l4Artifact.producer,
    observedFingerprint: source.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  }));
  const l4Snapshot = applyThreadSnapshotExtension(root, {
    id: "verify-evaluate-assembly-integrity-run-l4",
    name: "Evaluate assembly integrity",
    subjectId: root.subject.id,
    capturedAt: AT,
    artifacts: [l4Artifact],
    consumptions: l4Consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...l4Sources.map((source) => ({
        id: `${l4Artifact.id}-derived-from-${source.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: l4Artifact.id },
        to: { kind: "artifact" as const, id: source.id },
        rationale: "The L4 evaluation capture consumes this exact direct input.",
      })),
      ...l4Consumptions.map((consumption) => ({
        id: `${consumption.id}-uses`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumption.id },
        to: { kind: "artifact" as const, id: consumption.artifactId },
        rationale: "The L4 evaluator reread and fingerprint-attested this input.",
      })),
    ],
    proposedActions: [],
  });
  const rootRef = threadRef(root);
  const l4Ref = threadRef(l4Snapshot);
  const briefFingerprint = fp(DIGEST_F);
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: PROJECT_ID,
    projectSnapshotId: `${PROJECT_ID}:r2`,
    projectRevision: 2,
    briefId: `${PROJECT_ID}:brief`,
    briefSnapshotId: `${PROJECT_ID}:brief:r2`,
    briefRevision: 2,
    approvedBriefFingerprint: briefFingerprint,
  };
  const objective = "Verify the digital assembly-integrity method.";
  const project = validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Assembly closeout",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:assembly-closeout" },
        capturedAt: AT,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        contractVersion: "2.0",
        briefId: `${PROJECT_ID}:brief`,
        id: `${PROJECT_ID}:brief:r2`,
        revision: 2,
        previous: { snapshotId: `${PROJECT_ID}:brief:r1`, revision: 1 },
        proposedAt: AT,
        proposedBy: { id: "agent:planner", origin: "agent" },
        items: [
          {
            id: "objective",
            kind: "objective",
            statement: objective,
            sourceRefs: [{
              kind: "intent",
              reference: "conversation:assembly-closeout",
            }],
          },
          {
            id: "mission",
            kind: "mission-scenario",
            statement: "Close out one exact current assembly-integrity L4.",
            sourceRefs: [{
              kind: "intent",
              reference: "conversation:assembly-closeout",
            }],
          },
          {
            id: "success",
            kind: "success-criterion",
            statement:
              "The digital assembly remains interference-free on the current tip.",
            sourceRefs: [{
              kind: "intent",
              reference: "conversation:assembly-closeout",
            }],
            dependsOnItemIds: [],
          },
          {
            id: GATE_ID,
            kind: "verification-activity",
            statement: "Verify assembly integrity on the current canonical module.",
            sourceRefs: [{
              kind: "intent",
              reference: "conversation:assembly-closeout",
            }],
            dependsOnItemIds: [],
            verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
          },
        ],
      },
      currentBriefApproval: {
        briefSnapshotId: `${PROJECT_ID}:brief:r2`,
        briefRevision: 2,
        status: "approved",
        inputFingerprint: briefFingerprint,
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed the exact current assembly-integrity Brief.",
      },
    },
    threadSnapshots: [rootRef, l4Ref],
    phases: [{
      id: "phase-evaluate",
      name: "Evaluate",
      order: 1,
      description: "Evaluate the factual assembly-integrity observation.",
      workItemIds: ["work-l4"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work-l4",
      activityId: "activity:work-l4",
      phaseId: "phase-evaluate",
      title: "Evaluate assembly integrity",
      description: "Recross the exact current factual observation.",
      kind: "verify",
      operation: evaluateAssemblyIntegrityWorkItemOperation(),
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [{
        snapshotId: l4Snapshot.id,
        snapshotRevision: l4Snapshot.revision,
        kind: "artifact",
        id: l4Artifact.id,
      }],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run-l4",
      workItemId: "work-l4",
      status: "completed",
      summary: "Completed L4 assembly-integrity evaluation.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      basis: {
        kind: "thread-snapshot",
        ...rootRef,
      },
      inputFingerprint: fp(DIGEST_E),
      evidenceRefs: [{
        snapshotId: l4Snapshot.id,
        snapshotRevision: l4Snapshot.revision,
        kind: "artifact",
        id: l4Artifact.id,
      }],
      resultSnapshot: l4Ref,
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: fp("1".repeat(64)),
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "project-brief-approve",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: briefFingerprint,
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
      approvedBriefBasis,
    }],
  });
  const snapshotsById = new Map<string, ThreadSnapshot>([
    [root.id, root],
    [l4Snapshot.id, l4Snapshot],
  ]);
  let snapshotSaves = 0;
  const review = new PrepareProjectAssemblyIntegrityEvaluationCloseoutReview({
    projects: {
      get: (projectId) =>
        Promise.resolve(projectId === PROJECT_ID ? project : undefined),
    },
    snapshots: {
      get: (id) => Promise.resolve(snapshotsById.get(id)),
      getFresh: (id) => Promise.resolve(snapshotsById.get(id)),
      latest: () => Promise.resolve(l4Snapshot),
      save: () => {
        snapshotSaves++;
        return Promise.resolve();
      },
    },
    evaluationCaptures: {
      read: (fingerprint) =>
        Promise.resolve(
          fingerprint.digest === l4Fingerprint.digest ? l4Capture : undefined,
        ),
    },
  });
  return { review, project, l4Snapshot, snapshotSaves: () => snapshotSaves };
}

async function l4CaptureFixture(
  basis: {
    readonly kind: "thread-snapshot";
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): Promise<AssemblyIntegrityEvaluationCapture> {
  const method = await assemblyIntegrityEvaluationMethod();
  return await validateAssemblyIntegrityEvaluationCapture({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: { id: "verify.evaluate-assembly-integrity", version: "1" },
    trustedRunId: "run-l4",
    evaluatedAt: AT,
    basis,
    geometryModule: {
      schemaVersion: "geometry-module-capture/1.0",
      artifactId: `geometry-${DIGEST_A}`,
      fingerprint: fp(DIGEST_A),
    },
    assemblyStep: {
      artifactId: `cad-asset-${DIGEST_A}-module-step-${DIGEST_B}`,
      fingerprint: fp(DIGEST_B),
    },
    observation: {
      schemaVersion: "assembly-integrity-observation-capture/1.0",
      artifactId: `assembly-integrity-observation-${DIGEST_C}`,
      fingerprint: fp(DIGEST_C),
      observationFingerprint: fp(DIGEST_D),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(DIGEST_E),
      byteCount: 1024,
    },
    method,
    evaluation: {
      method,
      criteria: [
        { id: "assembly-import", verdict: "pass" },
        { id: "occurrence-coverage", verdict: "pass" },
        { id: "placement-recross", verdict: "pass" },
        { id: "brep-validity", verdict: "pass" },
        { id: "pairwise-intersection", verdict: "pass" },
      ],
      verdict: "pass",
      measurementDiagnostics: { pairwiseLinearToleranceMm: [] },
    },
  });
}

function rootSnapshot(): ThreadSnapshot {
  const geometry = sourceArtifact({
    id: `geometry-${DIGEST_A}`,
    fingerprint: fp(DIGEST_A),
    kind: "cad-model",
    tool: "design.write-geometry@1",
  });
  const step = sourceArtifact({
    id: `cad-asset-${DIGEST_A}-module-step-${DIGEST_B}`,
    fingerprint: fp(DIGEST_B),
    kind: "step",
    tool: "design.write-geometry@1",
    mediaType: "model/step",
  });
  const observation = sourceArtifact({
    id: `assembly-integrity-observation-${DIGEST_C}`,
    fingerprint: fp(DIGEST_C),
    kind: "evidence",
    tool: "verify.observe-assembly-integrity@1",
  });
  const artifacts = [geometry, step, observation];
  const changes = artifacts.map((artifact) => ({
    id: `created-${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `Captured ${artifact.name}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-assembly-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Assembly subject",
      kind: "assembly",
      version: "1",
      modelArtifactId: geometry.id,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "assembly-baseline",
      name: "Capture assembly baseline",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: changes.map((change) => ({
      id: `${change.id}-changes`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: change.id },
      to: change.target,
      rationale: "The baseline introduced this exact source artifact.",
    })),
    proposedActions: [],
  });
}

function l4CaptureArtifact(
  capture: AssemblyIntegrityEvaluationCapture,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): ThreadArtifact {
  return {
    id: `assembly-integrity-evaluation-${fingerprint.digest}`,
    name: "Assembly-integrity evaluation capture",
    kind: "evidence",
    version: fingerprint.digest,
    fingerprint,
    uri: assemblyIntegrityEvaluationCaptureUri(fingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "verify.evaluate-assembly-integrity@1",
      runId: capture.trustedRunId,
    },
    inputArtifactIds: [
      capture.geometryModule.artifactId,
      capture.assemblyStep.artifactId,
      capture.observation.artifactId,
    ],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function sourceArtifact(input: {
  readonly id: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly kind: ThreadArtifact["kind"];
  readonly tool: string;
  readonly mediaType?: string;
}): ThreadArtifact {
  return {
    id: input.id,
    name: input.id,
    kind: input.kind,
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    producer: { serverId: "digital-thread", tool: input.tool, runId: "run-source" },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function threadRef(snapshot: ThreadSnapshot) {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
