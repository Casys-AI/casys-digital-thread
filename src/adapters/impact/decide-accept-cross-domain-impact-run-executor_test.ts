import { assertEquals, assertRejects } from "@std/assert";
import type { CrossDomainImpactBriefGateReader } from "../../application/ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactDecisionCaptureStore,
  CrossDomainImpactEvaluationCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type AcceptCrossDomainImpactDecisionCommand,
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { recrossCrossDomainImpactWorkItemClaims } from "../../domain/impact/cross-domain-impact-decision.ts";
import {
  encodeCrossDomainImpactDecisionAdmission,
  parseCrossDomainImpactDecisionParameters,
} from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  type CrossDomainImpactDecisionCapture,
  crossDomainImpactDecisionCaptureUri,
  validateCrossDomainImpactDecisionCapture,
} from "../../domain/impact/cross-domain-impact-decision-capture.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import { evaluateCrossDomainImpact } from "../../domain/impact/cross-domain-impact-evaluation.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
} from "../../testing/cross-domain-impact-fixtures.ts";
import {
  type CrossDomainImpactDecisionThreadSnapshotStore,
  DecideAcceptCrossDomainImpactRunExecutor,
} from "./decide-accept-cross-domain-impact-run-executor.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-led-1";
const SUBJECT = "subject-led-1";
const EVAL_RUN = "run-impact-evaluation";
const EVAL_WORK = "work-impact-evaluation";
const RUN = "run-impact-decision";
const WORK = "work-impact-decision";
const DECISION = "decision-impact-decision";
const APPROVAL = "approval-impact-decision";
const HUMAN = { kind: "human" as const, actorId: "human-impact-decision" };
const AGENT = { kind: "agent" as const, actorId: "agent-impact-decision" };

Deno.test("X09 applies the exact X07/X08 proposed claim transitions and queues no rerun", async () => {
  const fixture = await executorFixture();
  const completed = await fixture.executor.execute(HUMAN, fixture.command);
  const electrical = completed.workItems.find((item) => item.id === "work-electrical");
  const thermal = completed.workItems.find((item) => item.id === "work-thermal");
  const mechanical = completed.workItems.find((item) => item.id === "work-mechanical");
  assertEquals(electrical?.gateClaims?.[0]?.status, "invalidated");
  assertEquals(thermal?.gateClaims?.[0]?.status, "invalidated");
  assertEquals(mechanical?.gateClaims?.[0]?.status, "carried-forward");
  assertEquals(electrical?.status, "completed");
  assertEquals(
    completed.agentRuns.filter((item) => item.status === "queued").length,
    0,
  );
  assertEquals(completed.workItems.length, fixture.project.workItems.length);
  const result = completed.agentRuns.find((item) => item.id === RUN)!;
  assertEquals(result.status, "completed");
  const successor = await fixture.snapshots.getFresh(result.resultSnapshot!.snapshotId);
  assertEquals(
    successor!.artifacts.some((artifact) =>
      artifact.producer.tool === "decide.accept-cross-domain-impact@2"
    ),
    true,
  );
  assertEquals(fixture.decisionCaptures.saves, 1);
  assertEquals(fixture.evaluationCaptures.saves, 0);
  assertEquals(fixture.commands.accepts, 1);

  const replay = await fixture.executor.execute(HUMAN, fixture.command);
  assertEquals(replay.revision, completed.revision);
  assertEquals(fixture.snapshots.saves, 1);
  assertEquals(fixture.decisionCaptures.saves, 1);
  assertEquals(fixture.evaluationCaptures.saves, 0);
  assertEquals(fixture.commands.accepts, 1);
});

Deno.test("X09 refuses a non-human origin before any recross or mutation", async () => {
  const fixture = await executorFixture();
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "human operator",
  );
  assertEquals(
    fixture.project.workItems.find((item) => item.id === "work-electrical")
      ?.gateClaims?.[0]?.status,
    "current",
  );
  assertEquals(fixture.decisionCaptures.saves, 0);
  assertEquals(fixture.commands.accepts, 0);
});

Deno.test("X09 refuses execution without the exact human MRTR", async () => {
  const fixture = await executorFixture();
  fixture.project.approvals = [];
  await assertRejects(
    () => fixture.executor.execute(HUMAN, fixture.command),
    EngineeringProjectCommandError,
    "No exact human-approved",
  );
  assertEquals(fixture.commands.accepts, 0);
});

Deno.test("X09 refuses a missing, mismatched, or ambiguous work-item claim before mutation", async () => {
  for (
    const [name, mutate, message] of [
      [
        "missing",
        (project: MutableProject) => {
          project.workItems = project.workItems.filter((item) =>
            item.id !== "work-electrical"
          );
        },
        "missing work-item gate claim",
      ],
      [
        "mismatched role",
        (project: MutableProject) => {
          const work = project.workItems.find((item) =>
            item.id === "work-electrical"
          ) as MutableWork;
          work.gateClaims = [{
            gateItemId: "gate-electrical",
            role: "contributes-to",
            status: "current",
          }];
        },
        "mismatched work-item gate claim",
      ],
      [
        "ambiguous",
        (project: MutableProject) => {
          project.workItems.push({
            ...project.workItems.find((item) => item.id === "work-electrical")!,
            id: "work-electrical-duplicate",
          });
        },
        "ambiguous work-item gate claim",
      ],
    ] as const
  ) {
    const fixture = await executorFixture();
    mutate(fixture.project);
    await assertRejects(
      () => fixture.executor.execute(HUMAN, fixture.command),
      EngineeringProjectCommandError,
      message,
      name,
    );
    assertEquals(fixture.commands.accepts, 0, name);
  }
});

Deno.test("X09 refuses a missing evaluation capture or Brief V2 mismatch", async () => {
  const missing = await executorFixture();
  missing.evaluationCaptures.items.clear();
  await assertRejects(
    () => missing.executor.execute(HUMAN, missing.command),
    EngineeringProjectCommandError,
    "unavailable",
  );

  const brief = await executorFixture();
  brief.brief.brief.revision = 99;
  await assertRejects(
    () => brief.executor.execute(HUMAN, brief.command),
    EngineeringProjectCommandError,
    "Brief V2",
  );
});

Deno.test(
  "X09 refuses a changed, revoked, or foreign MRTR between preflight and leased execution",
  async () => {
    for (const tamper of ["revoked", "changed", "foreign"] as const) {
      const fixture = await executorFixture();
      const executor = new DecideAcceptCrossDomainImpactRunExecutor({
        projects: { get: () => Promise.resolve(fixture.project) },
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        briefGates: { read: () => Promise.resolve(fixture.brief) },
        evaluationCaptures: fixture.evaluationCaptures,
        decisionCaptures: fixture.decisionCaptures,
        lease: {
          withLease: async (_projectId, _scope, work) => {
            await tamperApprovalAfterPreflight(fixture.project, tamper);
            return await work();
          },
        },
      });
      await assertRejects(
        () => executor.execute(HUMAN, fixture.command),
        EngineeringProjectCommandError,
        tamper === "revoked" ? "No exact human-approved" : "changed after preflight",
        tamper,
      );
      assertEquals(fixture.decisionCaptures.saves, 0, tamper);
      assertEquals(fixture.snapshots.saves, 0, tamper);
      assertEquals(fixture.commands.accepts, 0, tamper);
      assertEquals(
        fixture.project.workItems.find((item) => item.id === "work-electrical")
          ?.gateClaims?.[0]?.status,
        "current",
        tamper,
      );
    }
  },
);

async function tamperApprovalAfterPreflight(
  project: MutableProject,
  tamper: "revoked" | "changed" | "foreign",
): Promise<void> {
  if (tamper === "revoked") {
    project.approvals = [];
    return;
  }
  const decision = project.decisions.find((item) =>
    item.id === DECISION
  ) as MutableDecision;
  const approval = project.approvals.find((item) =>
    item.id === APPROVAL
  ) as MutableApproval;
  const work = project.workItems.find((item) => item.id === WORK) as MutableWork;
  const run = project.agentRuns.find((item) => item.id === RUN) as MutableRun;
  if (tamper === "foreign") {
    decision.id = "decision-foreign";
    work.decisionIds = ["decision-foreign"];
    approval.decisionId = "decision-foreign";
  } else {
    const admission = parseCrossDomainImpactDecisionParameters(
      decision.proposal!.parameters,
    );
    const parameters = encodeCrossDomainImpactDecisionAdmission({
      ...admission,
      workItemClaims: admission.workItemClaims.map((claim, index) =>
        index === 0 ? { ...claim, status: "carried-forward" as const } : claim
      ),
    });
    decision.proposal = { ...decision.proposal!, parameters };
  }
  const inputFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  decision.inputFingerprint = inputFingerprint;
  approval.inputFingerprint = inputFingerprint;
  run.inputFingerprint = await sha256Fingerprint({
    workItemId: WORK,
    basis: run.basis,
    operation: {
      id: work.operation?.id,
      version: work.operation?.version,
      bindings: work.operation?.bindings,
    },
    approvedDecisions: [{ id: decision.id, inputFingerprint }],
  });
}

async function executorFixture(): Promise<{
  readonly executor: DecideAcceptCrossDomainImpactRunExecutor;
  readonly command: {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
  readonly project: MutableProject;
  readonly basis: ThreadSnapshot;
  readonly snapshots: MemorySnapshots;
  readonly evaluationCaptures: MemoryEvaluationCaptures;
  readonly decisionCaptures: MemoryDecisionCaptures;
  readonly commands: MemoryCommands;
  readonly brief: {
    contractVersion: "2.0";
    projectId: string;
    brief: { id: string; revision: number; fingerprint: ContentFingerprint };
    gates: Array<{
      id: string;
      kind: "success-criterion" | "verification-activity";
      fingerprint: ContentFingerprint;
      dependsOnItemIds: readonly string[];
    }>;
  };
  readonly evaluationArtifactId: string;
}> {
  const capture = await captureFixture();
  const captureFingerprint = await sha256Fingerprint(capture);
  const evaluationArtifactId =
    `cross-domain-impact-evaluation-${captureFingerprint.digest}`;
  const previous = previousFixture(capture);
  const basis = evaluationBasisFixture(capture, captureFingerprint, previous);
  const basisFingerprint = await sha256Fingerprint(basis);
  const workItems = branchWorkItems();
  const workItemClaims = recrossCrossDomainImpactWorkItemClaims(
    workItems,
    capture.evaluation.gateClaims.map((claim) => ({
      gateItemId: claim.gateItemId,
      role: claim.role,
      status: claim.status,
    })),
    { excludeWorkItemId: WORK },
  );
  const admission = {
    schemaVersion: "cross-domain-impact-decision-admission/2.0" as const,
    consequence: "accept" as const,
    projectId: PROJECT,
    subjectId: SUBJECT,
    basis: {
      snapshotId: basis.id,
      revision: basis.revision,
      fingerprint: basisFingerprint,
    },
    brief: {
      id: capture.brief.id,
      revision: capture.brief.revision,
      fingerprint: capture.brief.fingerprint,
    },
    evaluation: {
      capture: { id: evaluationArtifactId, fingerprint: captureFingerprint },
      trustedRunId: EVAL_RUN,
    },
    manifestSeal: capture.manifestSeal.artifact,
    workItemClaims,
    limits: {
      providerCalls: "none" as const,
      solverCalls: "none" as const,
      reruns: "none" as const,
      newWorkItems: "none" as const,
    },
  };
  const parameters = encodeCrossDomainImpactDecisionAdmission(admission);
  const baseSnapshot = {
    snapshotId: basis.id,
    revision: basis.revision,
    subjectId: SUBJECT,
  };
  const inputFingerprint = await sha256Fingerprint({
    baseSnapshot,
    inputEvidenceRefs: [],
    proposal: {
      summary: "Accept the exact proposed impact statuses.",
      parameters,
    },
  });
  const decision = {
    id: DECISION,
    phaseId: "phase-impact-decision",
    title: "Accept impact",
    question: "Accept the exact proposed impact statuses?",
    status: "approved" as const,
    requestedAt: AT,
    inputEvidenceRefs: [] as const,
    approvalIds: [APPROVAL],
    baseSnapshot,
    proposal: {
      summary: "Accept the exact proposed impact statuses.",
      proposedAt: AT,
      proposedBy: { id: "agent-impact-decision", origin: "agent" as const },
      parameters,
    },
    inputFingerprint,
  };
  const operation = {
    id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const evalOperation = {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const runFingerprint = await sha256Fingerprint({
    workItemId: WORK,
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: SUBJECT,
    },
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions: [{ id: DECISION, inputFingerprint }],
  });
  const project = {
    schemaVersion: "4.0",
    id: "project-impact-decision-r1",
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Impact decision project",
      subjectId: SUBJECT,
      objective: { title: "Impact", statement: "Decide impact." },
    },
    threadSnapshots: [
      { snapshotId: previous.id, revision: previous.revision, subjectId: SUBJECT },
      { snapshotId: basis.id, revision: basis.revision, subjectId: SUBJECT },
    ],
    phases: [{
      id: "phase-impact-decision",
      name: "Impact",
      order: 1,
      description: "Decide impact",
      workItemIds: [
        EVAL_WORK,
        "work-electrical",
        "work-thermal",
        "work-mechanical",
        WORK,
      ],
      requiredDecisionIds: [DECISION],
      evidenceRefs: [{
        snapshotId: basis.id,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: evaluationArtifactId,
      }],
    }],
    workItems: [
      {
        id: EVAL_WORK,
        activityId: `activity:${EVAL_WORK}`,
        phaseId: "phase-impact-decision",
        title: "Evaluate impact",
        description: "Capture impact evaluation",
        kind: "review",
        operation: evalOperation,
        status: "completed",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [{
          snapshotId: basis.id,
          snapshotRevision: basis.revision,
          kind: "artifact",
          id: evaluationArtifactId,
        }],
        decisionIds: [],
        blockerIds: [],
      },
      ...workItems,
      {
        id: WORK,
        activityId: `activity:${WORK}`,
        phaseId: "phase-impact-decision",
        title: "Decide impact",
        description: "Accept exact impact",
        kind: "review",
        operation,
        status: "in-progress",
        owner: "human",
        dependsOnWorkItemIds: [EVAL_WORK],
        evidenceRefs: [],
        decisionIds: [DECISION],
        blockerIds: [],
      },
    ],
    agentRuns: [
      {
        id: EVAL_RUN,
        workItemId: EVAL_WORK,
        status: "completed",
        summary: "Captured impact evaluation",
        queuedAt: AT,
        startedAt: AT,
        completedAt: AT,
        claimedAt: AT,
        claimedBy: { id: "agent-impact-evaluation", origin: "agent" as const },
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: previous.id,
          revision: previous.revision,
          subjectId: SUBJECT,
        },
        resultSnapshot: {
          snapshotId: basis.id,
          revision: basis.revision,
          subjectId: SUBJECT,
        },
        evidenceRefs: [{
          snapshotId: basis.id,
          snapshotRevision: basis.revision,
          kind: "artifact",
          id: evaluationArtifactId,
        }],
      },
      {
        id: RUN,
        workItemId: WORK,
        status: "queued",
        summary: "Decide impact",
        queuedAt: AT,
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: basis.id,
          revision: basis.revision,
          subjectId: SUBJECT,
        },
        inputFingerprint: runFingerprint,
        evidenceRefs: [],
      },
    ],
    decisions: [decision],
    approvals: [{
      id: APPROVAL,
      decisionId: DECISION,
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Exact proposed statuses.",
      baseSnapshot: {
        snapshotId: basis.id,
        revision: basis.revision,
        subjectId: SUBJECT,
      },
      inputEvidenceRefs: [],
      inputFingerprint,
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;

  const snapshots = new MemorySnapshots(previous);
  snapshots.items.set(basis.id, structuredClone(basis));
  const evaluationCaptures = new MemoryEvaluationCaptures();
  evaluationCaptures.items.set(captureFingerprint.digest, structuredClone(capture));
  const decisionCaptures = new MemoryDecisionCaptures();
  const commands = new MemoryCommands(project);
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
  const briefGates: CrossDomainImpactBriefGateReader = {
    read: () => Promise.resolve(brief),
  };
  return {
    executor: new DecideAcceptCrossDomainImpactRunExecutor({
      projects: { get: () => Promise.resolve(project) },
      commands,
      snapshots,
      briefGates,
      evaluationCaptures,
      decisionCaptures,
      lease: { withLease: (_projectId, _scope, work) => work() },
    }),
    command: {
      commandId: "command-impact-decision",
      projectId: PROJECT,
      expectedRevision: 1,
      issuedAt: AT,
      runId: RUN,
    },
    project,
    basis,
    snapshots,
    evaluationCaptures,
    decisionCaptures,
    commands,
    brief,
    evaluationArtifactId,
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
  const mechanicalFact = {
    status: "current" as const,
    assertionId: input.manifest.independenceAssertions[0]!.id,
    reviewTrigger: input.reviewTrigger,
    evidence: mechanicalEvidence.evidence,
    evidenceFreshness: "fresh" as const,
    consumptions: mechanicalEvidence.consumptions,
  };
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
    mechanicalFact,
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

function previousFixture(capture: CrossDomainImpactEvaluationCapture): ThreadSnapshot {
  const artifacts: ThreadArtifact[] = capture.artifactInputs.map((input) => ({
    id: input.id,
    name: input.id,
    kind: input.id === "mechanical-fea-evidence" ? "evidence" : "document",
    version: "1",
    fingerprint: input.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: input.id === "manifest-seal-document"
        ? "verify.seal-cross-domain-impact-manifest@2"
        : "recorded-test@1",
      runId: input.id === "manifest-seal-document"
        ? "run-manifest-seal"
        : `run-${input.id}`,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  }));
  const seal = artifacts.find((artifact) => artifact.id === "manifest-seal-document")!;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-impact-decision-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact decision subject",
      kind: "system",
      version: "r1",
      modelArtifactId: seal.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-impact-decision-r1",
      name: "Manifest seal",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-manifest-seal",
        kind: "created",
        target: { kind: "artifact", id: seal.id },
        summary: "Manifest seal document.",
        afterFingerprint: seal.fingerprint,
      }],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance-change-manifest-seal",
      relation: "changes",
      from: { kind: "change", id: "change-manifest-seal" },
      to: { kind: "artifact", id: seal.id },
      rationale: "Manifest seal document.",
    }],
    proposedActions: [],
  });
}

function evaluationBasisFixture(
  capture: CrossDomainImpactEvaluationCapture,
  captureFingerprint: ContentFingerprint,
  previous: ThreadSnapshot,
): ThreadSnapshot {
  const evaluationId = `cross-domain-impact-evaluation-${captureFingerprint.digest}`;
  const producer = {
    serverId: "digital-thread",
    tool: "analyze.evaluate-cross-domain-impact@2",
    runId: EVAL_RUN,
  } as const;
  const artifact: ThreadArtifact = {
    id: evaluationId,
    name: "Cross-domain impact evaluation",
    kind: "document",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: crossDomainImpactEvaluationCaptureUri(captureFingerprint.digest),
    mediaType: "application/json",
    producer,
    inputArtifactIds: capture.artifactInputs.map((item) => item.id),
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
  const consumptions = capture.artifactInputs.map((upstream) => ({
    id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:consume:${upstream.id}`,
    artifactId: upstream.id,
    consumer: producer,
    observedFingerprint: upstream.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  }));
  const applied = applyThreadSnapshotExtensionIfNew(previous, {
    id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}`,
    name: "Capture the provider-free cross-domain impact evaluation",
    subjectId: previous.subject.id,
    capturedAt: AT,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: capture.artifactInputs.flatMap((upstream) => [
      {
        id:
          `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:derived-from:${upstream.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale: "The impact-evaluation capture reread this exact input.",
      },
      {
        id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:uses:${upstream.id}`,
        relation: "uses" as const,
        from: {
          kind: "consumption" as const,
          id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:consume:${upstream.id}`,
        },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale: "The provider-free evaluator verified this exact input fingerprint.",
      },
    ]),
    proposedActions: [],
  }, { appliedAt: AT });
  if (!applied.applied) {
    throw new Error("evaluation fixture successor was already present");
  }
  return validateThreadSnapshot(applied.snapshot);
}

function branchWorkItems() {
  return [
    workItem("work-electrical", "gate-electrical", "satisfies"),
    workItem("work-thermal", "gate-thermal", "contributes-to"),
    workItem("work-mechanical", "gate-mechanical", "satisfies"),
  ];
}

function workItem(
  id: string,
  gateItemId: string,
  role: "satisfies" | "contributes-to",
) {
  return {
    id,
    activityId: `activity:${id}`,
    phaseId: "phase-impact-decision",
    title: id,
    description: id,
    kind: "verify" as const,
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
    gateClaims: [{ gateItemId, role, status: "current" as const }],
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

class MemorySnapshots implements CrossDomainImpactDecisionThreadSnapshotStore {
  readonly items = new Map<string, ThreadSnapshot>();
  saves = 0;

  constructor(basis: ThreadSnapshot) {
    this.items.set(basis.id, structuredClone(basis));
  }

  get(id: string) {
    const value = this.items.get(id);
    return Promise.resolve(value && structuredClone(value));
  }

  getFresh(id: string) {
    return this.get(id);
  }

  latest(subjectId: string) {
    const values = [...this.items.values()].filter((item) =>
      item.subject.id === subjectId
    );
    return Promise.resolve(
      values.sort((left, right) => right.revision - left.revision)[0],
    );
  }

  save(snapshot: ThreadSnapshot) {
    const existing = this.items.get(snapshot.id);
    if (existing && deterministicJson(existing) !== deterministicJson(snapshot)) {
      return Promise.reject(new Error("non-idempotent snapshot"));
    }
    if (!existing) {
      this.items.set(snapshot.id, structuredClone(snapshot));
      this.saves += 1;
    }
    return Promise.resolve();
  }
}

class MemoryEvaluationCaptures implements CrossDomainImpactEvaluationCaptureStore {
  readonly items = new Map<string, CrossDomainImpactEvaluationCapture>();
  saves = 0;

  async save(value: CrossDomainImpactEvaluationCapture) {
    const capture = await validateCrossDomainImpactEvaluationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    this.items.set(fingerprint.digest, structuredClone(capture));
    this.saves += 1;
    return {
      fingerprint,
      uri: crossDomainImpactEvaluationCaptureUri(fingerprint.digest),
    };
  }

  read(fingerprint: ContentFingerprint) {
    const value = this.items.get(fingerprint.digest);
    return Promise.resolve(value && structuredClone(value));
  }
}

class MemoryDecisionCaptures implements CrossDomainImpactDecisionCaptureStore {
  readonly items = new Map<string, CrossDomainImpactDecisionCapture>();
  saves = 0;

  save(value: CrossDomainImpactDecisionCapture) {
    const capture = validateCrossDomainImpactDecisionCapture(value);
    return sha256Fingerprint(capture).then((fingerprint) => {
      this.items.set(fingerprint.digest, structuredClone(capture));
      this.saves += 1;
      return {
        fingerprint,
        uri: crossDomainImpactDecisionCaptureUri(fingerprint.digest),
      };
    });
  }

  read(fingerprint: ContentFingerprint) {
    const value = this.items.get(fingerprint.digest);
    return Promise.resolve(value && structuredClone(value));
  }
}

class MemoryCommands {
  accepts = 0;
  constructor(readonly project: MutableProject) {}

  async acceptCrossDomainImpactDecision(
    origin: typeof HUMAN,
    command: AcceptCrossDomainImpactDecisionCommand,
  ) {
    this.accepts += 1;
    const run = this.project.agentRuns.find((item) =>
      item.id === command.runId
    ) as MutableRun;
    if (run.status === "completed") return this.project;
    run.status = "completed";
    run.completedAt = AT;
    run.startedAt = AT;
    run.claimedAt = AT;
    run.claimedBy = { id: origin.actorId, origin: origin.kind };
    run.resultSnapshot = command.resultSnapshot;
    run.evidenceRefs = [...command.evidenceRefs];
    const decisionWork = this.project.workItems.find((item) =>
      item.id === run.workItemId
    ) as MutableWork;
    decisionWork.status = "completed";
    decisionWork.evidenceRefs = [...command.evidenceRefs];
    for (const claimed of command.appliedGateClaims) {
      const work = this.project.workItems.find((item) =>
        item.id === claimed.workItemId
      ) as MutableWork;
      work.gateClaims = (work.gateClaims ?? []).map((claim) =>
        claim.gateItemId === claimed.gateItemId && claim.role === claimed.role
          ? { ...claim, status: claimed.status }
          : claim
      );
    }
    this.project.threadSnapshots.push(command.resultSnapshot);
    this.project.revision += 1;
    this.project.commandReceipts.push({
      commandId: command.commandId,
      type: "impact-decision.accept",
      actor: { id: origin.actorId, origin: origin.kind },
      issuedAt: command.issuedAt,
      appliedAt: AT,
      requestFingerprint: await sha256Fingerprint({ command }),
      resultingSnapshot: {
        snapshotId: `project-impact-decision-r${this.project.revision}`,
        revision: this.project.revision,
      },
    });
    return this.project;
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  decisions: Array<EngineeringProjectSnapshot["decisions"][number]>;
  approvals: Array<EngineeringProjectSnapshot["approvals"][number]>;
  commandReceipts: Array<
    NonNullable<EngineeringProjectSnapshot["commandReceipts"]>[number]
  >;
};
type MutableRun = {
  -readonly [Key in keyof EngineeringProjectSnapshot["agentRuns"][number]]:
    EngineeringProjectSnapshot["agentRuns"][number][Key];
};
type MutableWork = {
  -readonly [Key in keyof EngineeringProjectSnapshot["workItems"][number]]:
    EngineeringProjectSnapshot["workItems"][number][Key];
};
type MutableDecision = {
  -readonly [Key in keyof EngineeringProjectSnapshot["decisions"][number]]:
    EngineeringProjectSnapshot["decisions"][number][Key];
};
type MutableApproval = {
  -readonly [Key in keyof EngineeringProjectSnapshot["approvals"][number]]:
    EngineeringProjectSnapshot["approvals"][number][Key];
};
