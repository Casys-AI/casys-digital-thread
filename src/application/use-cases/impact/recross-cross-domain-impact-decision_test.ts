import { assertEquals, assertRejects } from "@std/assert";
import { PrepareCrossDomainImpactDecision } from "./prepare-cross-domain-impact-decision.ts";
import {
  CrossDomainImpactDecisionRecrossError,
  recrossCrossDomainImpactDecision,
} from "./recross-cross-domain-impact-decision.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import { evaluateCrossDomainImpact } from "../../../domain/impact/cross-domain-impact-evaluation.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
} from "../../../testing/cross-domain-impact-fixtures.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-led-1";
const SUBJECT = "subject-led-1";
const EVAL_RUN = "run-impact-evaluation";
const EVAL_WORK = "work-impact-evaluation";
const EVAL_WORK_OLD = "work-impact-evaluation-root";
const EVAL_FORK_A = "work-impact-evaluation-fork-a";
const EVAL_FORK_B = "work-impact-evaluation-fork-b";
const DECISION_WORK = "work-impact-decision";
const DECISION_RUN = "run-impact-decision";

Deno.test("X09 recross reopens the named X08 dependsOn leaf on a later descendant retry", async () => {
  const fixture = await recrossFixture();
  const r2 = fixture.snapshot;
  const r3 = JSON.parse(JSON.stringify(r2)) as ThreadSnapshot;
  (r3 as { id: string }).id = "thread-impact-r3";
  (r3 as { revision: number }).revision = 3;
  (r3 as { previous: { snapshotId: string; revision: number } }).previous = {
    snapshotId: r2.id,
    revision: r2.revision,
  };
  (r3.subject as { version: string }).version = "r3";
  (r3.changeSet as { id: string }).id = "changes-impact-r3";
  const input = fixture.input();
  const retryBasis = {
    kind: "thread-snapshot" as const,
    snapshotId: r3.id,
    revision: r3.revision,
    subjectId: SUBJECT,
  };
  const recrossed = await recrossCrossDomainImpactDecision({
    ...input,
    project: {
      ...input.project,
      threadSnapshots: [
        ...input.project.threadSnapshots,
        { snapshotId: r3.id, revision: r3.revision, subjectId: SUBJECT },
      ],
      agentRuns: input.project.agentRuns.map((run) =>
        run.id === DECISION_RUN ? { ...run, basis: retryBasis } : run
      ),
    },
    snapshot: r3,
    basis: retryBasis,
    snapshots: {
      get: (id: string) =>
        Promise.resolve(id === r3.id ? r3 : id === r2.id ? r2 : undefined),
    },
  });
  assertEquals(recrossed.artifact.id, fixture.evaluationId);
});

Deno.test("X09 recross review reopens the unique completed X08 leaf without X09 work", async () => {
  const fixture = await recrossFixture({ includeDecisionWork: false });
  const recrossed = await recrossCrossDomainImpactDecision(fixture.input());
  assertEquals(recrossed.artifact.id, fixture.evaluationId);
});

Deno.test("X09 recross review ignores old X09 work and reopens the current X08 leaf", async () => {
  const fixture = await recrossFixture({
    evaluationLineage: "stale-leaf",
    decisionDependsOn: "stale",
  });
  const recrossed = await recrossCrossDomainImpactDecision({
    ...fixture.input(),
    trustedRunId: undefined,
  });
  assertEquals(recrossed.artifact.id, fixture.evaluationId);
});

Deno.test("X09 recross runtime refuses a trusted run whose dependsOn names a stale X08", async () => {
  const fixture = await recrossFixture({
    evaluationLineage: "stale-leaf",
    decisionDependsOn: "stale",
  });
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "current leaf",
  );
});

Deno.test("X09 recross runtime refuses a trusted run whose X08 activity is forked", async () => {
  const fixture = await recrossFixture({ evaluationLineage: "forked" });
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "multiple current leaf",
  );
});

Deno.test("X09 review resolves on a completed X08 leaf with no X09 work", async () => {
  const fixture = await recrossFixture({ includeDecisionWork: false });
  const result = await reviewFromFixture(fixture);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.admission.evaluation.capture.id, fixture.evaluationId);
});

Deno.test("X09 review ignores old X09 work and keeps the current X08 leaf", async () => {
  const fixture = await recrossFixture({
    evaluationLineage: "stale-leaf",
    decisionDependsOn: "stale",
  });
  const result = await reviewFromFixture(fixture);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.admission.evaluation.capture.id, fixture.evaluationId);
});

Deno.test("X09 recross refuses a tampered X08 evaluation artifact identity", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  (artifact as { name: string }).name = "forged evaluation";
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

Deno.test("X09 recross refuses tampered X08 inputArtifactIds", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  const forged = {
    id: "forged-input",
    name: "forged-input",
    kind: "document" as const,
    version: "1",
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    producer: {
      serverId: "digital-thread",
      tool: "recorded-test@1",
      runId: "run-forged-input",
    },
    inputArtifactIds: [] as string[],
    freshness: { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] },
  };
  (fixture.snapshot.artifacts as unknown as typeof forged[]).push(forged);
  (fixture.snapshot.changeSet.changes as unknown as Array<{
    id: string;
    kind: string;
    target: { kind: string; id: string };
    summary: string;
    afterFingerprint: { algorithm: string; digest: string };
  }>).push({
    id: "change-forged-input",
    kind: "created",
    target: { kind: "artifact", id: forged.id },
    summary: forged.id,
    afterFingerprint: forged.fingerprint,
  });
  (fixture.snapshot.consumptions as unknown as Array<{
    id: string;
    artifactId: string;
    consumer: ThreadArtifact["producer"];
    observedFingerprint: ThreadArtifact["fingerprint"];
    verifiedAt: string;
    status: string;
  }>).push({
    id: "consume-forged-input",
    artifactId: forged.id,
    consumer: artifact.producer,
    observedFingerprint: forged.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  (fixture.snapshot.provenance as unknown as Array<{
    id: string;
    relation: string;
    from: { kind: string; id: string };
    to: { kind: string; id: string };
    rationale: string;
  }>).push(
    {
      id: "provenance-change-forged-input",
      relation: "changes",
      from: { kind: "change", id: "change-forged-input" },
      to: { kind: "artifact", id: forged.id },
      rationale: forged.id,
    },
    {
      id: `${fixture.evaluationId}-derived-from-${forged.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: fixture.evaluationId },
      to: { kind: "artifact", id: forged.id },
      rationale: "Forged input.",
    },
    {
      id: "consume-forged-input-uses",
      relation: "uses",
      from: { kind: "consumption", id: "consume-forged-input" },
      to: { kind: "artifact", id: forged.id },
      rationale: "Verified input.",
    },
  );
  (artifact as unknown as { inputArtifactIds: string[] }).inputArtifactIds = [
    ...artifact.inputArtifactIds,
    forged.id,
  ];
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

Deno.test("X09 recross refuses an archived X08 evaluation artifact", async () => {
  const fixture = await recrossFixture();
  (fixture.snapshot.changeSet.changes as unknown as Array<{
    id: string;
    kind: string;
    target: { kind: string; id: string };
    summary: string;
  }>).push({
    id: "change-archive-evaluation",
    kind: "archived",
    target: { kind: "artifact", id: fixture.evaluationId },
    summary: "Archived evaluation.",
  });
  (fixture.snapshot.provenance as unknown as Array<{
    id: string;
    relation: string;
    from: { kind: string; id: string };
    to: { kind: string; id: string };
    rationale: string;
  }>).push({
    id: "provenance-change-archive-evaluation",
    relation: "changes",
    from: { kind: "change", id: "change-archive-evaluation" },
    to: { kind: "artifact", id: fixture.evaluationId },
    rationale: "Archived evaluation.",
  });
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "archived",
  );
});

Deno.test("X09 recross refuses a Brief V2 gate whose dependsOnItemIds drifted", async () => {
  const fixture = await recrossFixture();
  const gate = fixture.brief.gates[0]!;
  fixture.brief.gates = fixture.brief.gates.map((item) =>
    item.id === gate.id
      ? { ...item, dependsOnItemIds: [...item.dependsOnItemIds, "forged-dependency"] }
      : item
  );
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact impact-evaluation gate",
  );
});

Deno.test("X09 recross refuses a Brief V2 that dropped a captured gate identity", async () => {
  const fixture = await recrossFixture();
  fixture.brief.gates = fixture.brief.gates.slice(1);
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact impact-evaluation gate",
  );
});

Deno.test("X09 recross refuses a tampered X08 evaluation mediaType", async () => {
  const fixture = await recrossFixture();
  const artifact = fixture.snapshot.artifacts.find((item) =>
    item.id === fixture.evaluationId
  )!;
  (artifact as { mediaType?: string }).mediaType = "text/plain";
  await assertRejects(
    () => recrossCrossDomainImpactDecision(fixture.input()),
    CrossDomainImpactDecisionRecrossError,
    "exact X08 evaluation artifact",
  );
});

async function reviewFromFixture(
  fixture: Awaited<ReturnType<typeof recrossFixture>>,
) {
  const input = fixture.input();
  const project = asValidImpactDecisionProject(input.project);
  const review = new PrepareCrossDomainImpactDecision({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (id: string) =>
        Promise.resolve(id === fixture.snapshot.id ? fixture.snapshot : undefined),
    },
    briefGates: { read: () => Promise.resolve(fixture.brief) },
    captures: input.captures,
  });
  return await review.execute({ projectId: PROJECT });
}

function asValidImpactDecisionProject(
  inner: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  const fingerprint = { algorithm: "sha256" as const, digest: "e".repeat(64) };
  const basis = {
    kind: "approved-brief" as const,
    projectId: PROJECT,
    projectSnapshotId: `${PROJECT}:r2`,
    projectRevision: 2,
    briefId: `${PROJECT}:brief`,
    briefSnapshotId: `${PROJECT}:brief:r1`,
    briefRevision: 1,
    approvedBriefFingerprint: fingerprint,
  };
  const workItems = inner.workItems.map((item) => ({
    id: item.id,
    activityId: item.activityId,
    ...(item.predecessorRevisionId
      ? { predecessorRevisionId: item.predecessorRevisionId }
      : {}),
    phaseId: "phase-impact",
    title: item.id,
    description: item.id,
    kind: "review" as const,
    operation: item.operation,
    status: item.id === DECISION_WORK ? "planned" as const : item.status,
    owner: "agent" as const,
    dependsOnWorkItemIds: item.dependsOnWorkItemIds ?? [],
    evidenceRefs: item.evidenceRefs,
    decisionIds: [],
    blockerIds: [],
    ...(item.gateClaims ? { gateClaims: item.gateClaims } : {}),
  }));
  const runFingerprint = { algorithm: "sha256" as const, digest: "b".repeat(64) };
  const agentRuns = inner.agentRuns
    .filter((run) => run.id !== DECISION_RUN)
    .map((run) => ({
      id: run.id,
      workItemId: run.workItemId,
      status: run.status,
      summary: run.id,
      queuedAt: AT,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.status === "completed" ? { completedAt: AT } : {}),
      ...(run.basis ? { basis: run.basis } : {}),
      inputFingerprint: runFingerprint,
      ...(run.resultSnapshot ? { resultSnapshot: run.resultSnapshot } : {}),
      evidenceRefs: run.evidenceRefs,
    }));
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${PROJECT}:r3`,
    revision: 3,
    generatedAt: AT,
    previous: { snapshotId: `${PROJECT}:r2`, revision: 2 },
    project: {
      id: PROJECT,
      name: "Impact project",
      subjectId: SUBJECT,
      objective: {
        title: "Review cross-domain impact.",
        statement: "Review cross-domain impact.",
      },
    },
    framing: {
      intent: {
        statement: "Review cross-domain impact.",
        source: { kind: "human", reference: "conversation:turn-1" },
        capturedAt: AT,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        contractVersion: "2.0",
        briefId: `${PROJECT}:brief`,
        id: `${PROJECT}:brief:r1`,
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Review cross-domain impact.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Walk the sealed impact recross.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Human review recrosses the unique X08 leaf.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          dependsOnItemIds: [],
        }, {
          id: "gate-electrical",
          kind: "success-criterion",
          statement: "Electrical impact gate.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          dependsOnItemIds: [],
        }, {
          id: "gate-thermal",
          kind: "success-criterion",
          statement: "Thermal impact gate.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          dependsOnItemIds: [],
        }, {
          id: "gate-mechanical",
          kind: "success-criterion",
          statement: "Mechanical impact gate.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
          dependsOnItemIds: [],
        }],
        proposedAt: AT,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: `${PROJECT}:brief:r1`,
        briefRevision: 1,
        status: "approved",
        inputFingerprint: fingerprint,
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Approved for planning.",
      },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis,
      publishedAt: AT,
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: inner.threadSnapshots.map((item) => ({
      snapshotId: item.snapshotId,
      revision: item.revision,
      subjectId: item.subjectId,
    })),
    phases: [{
      id: "phase-impact",
      name: "Impact",
      order: 1,
      description: "Cross-domain impact judgement.",
      workItemIds: workItems.map((item) => item.id),
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems,
    agentRuns,
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT}:r1`, revision: 1 },
    }, {
      commandId: "approve",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT}:r2`, revision: 2 },
      approvedBriefBasis: basis,
    }, {
      commandId: "publish",
      type: "project.plan-publish",
      actor: { id: "agent:planner", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT}:r3`, revision: 3 },
    }],
  });
}

type RecrossFixtureOptions = {
  readonly includeDecisionWork?: boolean;
  readonly evaluationLineage?: "single" | "stale-leaf" | "forked";
  readonly decisionDependsOn?: "leaf" | "stale" | "fork-a";
};

async function recrossFixture(options: RecrossFixtureOptions = {}) {
  const capture = await captureFixture();
  const captureFingerprint = await sha256Fingerprint(capture);
  const evaluationId = `cross-domain-impact-evaluation-${captureFingerprint.digest}`;
  const evaluationArtifact: ThreadArtifact = {
    id: evaluationId,
    name: "Cross-domain impact evaluation",
    kind: "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: crossDomainImpactEvaluationCaptureUri(captureFingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "analyze.evaluate-cross-domain-impact@2",
      runId: EVAL_RUN,
    },
    inputArtifactIds: capture.artifactInputs.map((item) => item.id),
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
  const inputArtifacts: ThreadArtifact[] = capture.artifactInputs.map((item) => ({
    id: item.id,
    name: item.id,
    kind: "document",
    version: "1",
    fingerprint: item.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: "recorded-test@1",
      runId: `run-${item.id}`,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  }));
  const artifacts = [...inputArtifacts, evaluationArtifact];
  const changes = artifacts.map((artifact) => ({
    id: `change-${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: artifact.id,
    afterFingerprint: artifact.fingerprint,
  }));
  const consumptions = evaluationArtifact.inputArtifactIds.map((inputId) => {
    const input = artifacts.find((item) => item.id === inputId)!;
    return {
      id: `consume-${inputId}`,
      artifactId: inputId,
      consumer: evaluationArtifact.producer,
      observedFingerprint: input.fingerprint,
      verifiedAt: AT,
      status: "verified" as const,
    };
  });
  const provenance = [
    ...changes.map((change) => ({
      id: `provenance-${change.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: change.id },
      to: change.target,
      rationale: change.summary,
    })),
    ...evaluationArtifact.inputArtifactIds.flatMap((inputId) => [
      {
        id: `${evaluationId}-derived-from-${inputId}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: evaluationId },
        to: { kind: "artifact" as const, id: inputId },
        rationale: "Evaluation input.",
      },
      {
        id: `consume-${inputId}-uses`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: `consume-${inputId}` },
        to: { kind: "artifact" as const, id: inputId },
        rationale: "Verified input.",
      },
    ]),
  ];
  const snapshot = {
    schemaVersion: "1.0",
    id: "thread-impact-r2",
    revision: 2,
    previous: { snapshotId: "thread-impact-r1", revision: 1 },
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact subject",
      kind: "system",
      version: "r2",
      modelArtifactId: evaluationId,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "changes-impact-r2",
      name: "Impact evaluation",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  } as unknown as ThreadSnapshot;
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: SUBJECT,
  };
  const evidence = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: evaluationId,
  };
  const includeDecisionWork = options.includeDecisionWork !== false;
  const evaluationLineage = options.evaluationLineage ?? "single";
  const evaluationActivityId = evaluationLineage === "stale-leaf"
    ? `activity:${EVAL_WORK_OLD}`
    : `activity:${EVAL_WORK}`;
  const evaluationOperation = {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{
      name: "approvedBrief" as const,
      source: { kind: "approved-brief" as const },
    }],
  };
  const evaluationWork = {
    id: EVAL_WORK,
    activityId: evaluationActivityId,
    ...(evaluationLineage === "stale-leaf"
      ? { predecessorRevisionId: EVAL_WORK_OLD }
      : {}),
    status: "completed",
    operation: evaluationOperation,
    evidenceRefs: [evidence],
    dependsOnWorkItemIds: [],
    gateClaims: [
      {
        gateItemId: "gate-electrical",
        role: "satisfies",
        status: "current",
      },
      {
        gateItemId: "gate-thermal",
        role: "contributes-to",
        status: "current",
      },
      {
        gateItemId: "gate-mechanical",
        role: "satisfies",
        status: "current",
      },
    ],
  };
  const historicalEvaluation = {
    id: EVAL_WORK_OLD,
    activityId: evaluationActivityId,
    status: "completed",
    operation: evaluationOperation,
    evidenceRefs: [{
      snapshotId: "thread-impact-r1",
      snapshotRevision: 1,
      kind: "artifact" as const,
      id: "historical-impact-evaluation",
    }],
    dependsOnWorkItemIds: [],
    gateClaims: [],
  };
  const forkA = {
    id: EVAL_FORK_A,
    activityId: evaluationActivityId,
    predecessorRevisionId: EVAL_WORK,
    status: "completed",
    operation: evaluationOperation,
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: "fork-a-evaluation",
    }],
    dependsOnWorkItemIds: [],
    gateClaims: [],
  };
  const forkB = {
    id: EVAL_FORK_B,
    activityId: evaluationActivityId,
    predecessorRevisionId: EVAL_WORK,
    status: "completed",
    operation: evaluationOperation,
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: "fork-b-evaluation",
    }],
    dependsOnWorkItemIds: [],
    gateClaims: [],
  };
  const extraEvaluations = evaluationLineage === "stale-leaf"
    ? [historicalEvaluation]
    : evaluationLineage === "forked"
    ? [forkA, forkB]
    : [];
  const decisionDependsOn = options.decisionDependsOn === "stale"
    ? EVAL_WORK_OLD
    : options.decisionDependsOn === "fork-a" || evaluationLineage === "forked"
    ? EVAL_FORK_A
    : EVAL_WORK;
  const decisionWork = {
    id: DECISION_WORK,
    activityId: "activity:work-impact-decision",
    status: "in-progress",
    operation: {
      id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
      version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    evidenceRefs: [],
    dependsOnWorkItemIds: [decisionDependsOn],
    gateClaims: [],
  };
  const project = {
    project: { id: PROJECT, subjectId: SUBJECT },
    threadSnapshots: [
      { snapshotId: "thread-impact-r1", revision: 1, subjectId: SUBJECT },
      basis,
    ],
    workItems: [
      ...extraEvaluations,
      evaluationWork,
      ...(includeDecisionWork ? [decisionWork] : []),
    ],
    agentRuns: [
      {
        id: EVAL_RUN,
        workItemId: EVAL_WORK,
        status: "completed",
        startedAt: AT,
        resultSnapshot: {
          snapshotId: snapshot.id,
          revision: snapshot.revision,
          subjectId: SUBJECT,
        },
        basis: {
          kind: "thread-snapshot",
          snapshotId: "thread-impact-r1",
          revision: 1,
          subjectId: SUBJECT,
        },
        evidenceRefs: [evidence],
      },
      ...(includeDecisionWork
        ? [{
          id: DECISION_RUN,
          workItemId: DECISION_WORK,
          status: "running" as const,
          startedAt: AT,
          basis,
          evidenceRefs: [],
        }]
        : []),
    ],
  } as unknown as EngineeringProjectSnapshot;
  const brief = {
    contractVersion: "2.0" as const,
    projectId: PROJECT,
    brief: {
      id: capture.brief.id,
      revision: capture.brief.revision,
      fingerprint: capture.brief.fingerprint,
    },
    gates: capture.brief.gates.map((gate) => ({
      id: gate.gateItemId,
      kind: gate.kind,
      fingerprint: gate.fingerprint,
      dependsOnItemIds: gate.dependsOnItemIds,
    })),
  };
  const captures = {
    save: () => Promise.reject(new Error("must not save")),
    read: (fingerprint: ContentFingerprint) =>
      Promise.resolve(
        fingerprint.digest === captureFingerprint.digest ? capture : undefined,
      ),
  };
  return {
    evaluationId,
    snapshot,
    brief,
    input: () => ({
      project,
      basis,
      snapshot,
      briefGates: { read: () => Promise.resolve(brief) },
      captures,
      snapshots: {
        get: (id: string) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      },
      ...(includeDecisionWork ? { trustedRunId: DECISION_RUN } : {}),
    }),
  };
}

async function captureFixture(): Promise<CrossDomainImpactEvaluationCapture> {
  const input = await validCrossDomainImpactEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(input);
  const branchFacts = input.branchReadiness.map((branch) => ({
    branchId: branch.branchId,
    method: {
      reference: branch.method.reference,
      availability: "available" as const,
    },
    joins: branch.joins.map((join) => ({
      reference: join.reference,
      currentness: "current" as const,
    })),
  }));
  const mechanicalEvidence = input.mechanicalEvidence!;
  const artifactInputs = [
    { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
    ...branchFacts.flatMap((branch) => [
      branch.method.reference,
      ...branch.joins.map((join) => join.reference),
    ]),
    mechanicalEvidence.evidence,
    ...mechanicalEvidence.consumptions.map((item) => item.input),
  ].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateCrossDomainImpactEvaluationCapture({
    schemaVersion: "cross-domain-impact-evaluation-capture/2.0",
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: EVAL_RUN,
    evaluatedAt: AT,
    manifestSeal: {
      artifact: { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
      trustedRunId: "run-manifest-seal",
    },
    artifactInputs,
    manifest: {
      id: evaluation.manifest.id,
      fingerprint: evaluation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-impact-evaluation",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    branchFacts,
    mechanicalFact: {
      status: "current" as const,
      assertionId: input.manifest.independenceAssertions[0]!.id,
      reviewTrigger: input.reviewTrigger,
      evidence: mechanicalEvidence.evidence,
      evidenceFreshness: "fresh" as const,
      consumptions: mechanicalEvidence.consumptions,
    },
    evaluation,
    limits: {
      providerCalls: "none",
      solverCalls: "none",
      gateClaimTransitions: "none",
      workItemInvalidations: "none",
      rerunProposals: "none",
    },
  });
}
