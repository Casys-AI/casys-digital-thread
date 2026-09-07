/**
 * Command-boundary guards for the versioned requirements writer.
 *
 * These are intentionally small structural tests.  Reopening and semantic
 * verification of a valid V2 brief clause belongs to the dedicated provenance
 * reader tests; here we prove that neither the direct decision command nor
 * queueing can bypass the exact operation/version and joint plan ownership.
 */
import { assertEquals, assertRejects } from "@std/assert";
import type {
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../../../../domain/project/project-brief.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import {
  MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  parseTracedRequirementsProposalParameters,
  type TracedRequirementsProposal,
  tracedRequirementsProposalParameters,
} from "../../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import {
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  requirementsBriefTraceParameters,
} from "../../../../domain/record/requirements-brief-trace.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../../orchestration/operations/registry.ts";
import {
  approvedBriefBasisForProject,
  EngineeringProjectCommandService,
} from "../engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../project-brief-command-service.ts";
import { EngineeringProjectStoreConflictError } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  assertRequirementsDecisionProposalAtCommandBoundary,
  assertRequirementsWriteQueueAdmissible,
  assertTracedRequirementsProposalAtProjectBoundary,
} from "./requirements-brief-source-guard.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";

const PROJECT_ID = "requirements-guard-project";
const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const STORE = {} as EngineeringProjectRevisionStore;

Deno.test(
  "direct service accepts a traced proposal and queue across an unrelated revision, then rejects its stale brief before commit",
  async () => {
    const store = new MemoryProjectStore();
    const now = clock();
    const briefs = new ProjectBriefCommandService(store, now);
    let project = await approvedProject(briefs);
    const commands = new EngineeringProjectCommandService(
      store,
      undefined,
      now,
      { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
      { validateInitial: () => Promise.resolve() },
    );

    project = await commands.publishPlan(AGENT, baselinePlan(project));
    project = await completeBaseline(commands, project);
    project = await commands.appendChange(AGENT, tracedRequirementsChange(project));

    // This later revision is unrelated to the approved brief.  The source
    // guard must reopen the exact old revision, then accept the unchanged
    // current approval receipt instead of requiring the current project rev.
    project = await briefs.proposeQuestion(AGENT, {
      ...context("unrelated-question", project.revision),
      question: {
        id: "question-maintenance",
        prompt: "Which maintenance interval should be observed?",
        whyItMatters: "It is documentary and does not rewrite the approved brief.",
        recommendation: {
          value: "record-later",
          rationale: "Keep the bounded requirement source unchanged.",
          confidence: "medium",
        },
        options: [{
          value: "record-later",
          label: "Record later",
          consequences: "No requirement source changes.",
        }],
        allowUnknown: true,
        risk: "reversible",
        evidenceNeeded: ["maintenance record"],
      },
    });
    const parameters = await tracedParametersFor(project);
    const baseSnapshot = project.threadSnapshots.at(-1)!;

    project = await commands.proposeDecision(AGENT, {
      ...context("propose-traced-valid", project.revision),
      decisionId: "decision-valid",
      proposal: { summary: "Write the reviewed scalar requirement.", parameters },
      baseSnapshot,
    });
    assertEquals(decision(project, "decision-valid").status, "proposed");
    project = await approve(
      commands,
      project,
      "decision-valid",
      "approve-traced-valid",
    );
    project = await commands.queueRun(AGENT, {
      ...context("queue-traced-valid", project.revision),
      runId: "run-traced-valid",
      workItemId: "write-traced-valid",
      summary: "Queue only; no provider is contacted by this command test.",
      basis: { kind: "thread-snapshot", ...baseSnapshot },
    });
    assertEquals(
      project.agentRuns.find((run) => run.id === "run-traced-valid")?.status,
      "queued",
    );

    // A second decision is legitimately approved under the same source but
    // deliberately left unqueued.  Once the human approves a successor brief,
    // both a fresh proposal and this deferred queue must stop before commit.
    project = await commands.proposeDecision(AGENT, {
      ...context("propose-traced-stale-queue", project.revision),
      decisionId: "decision-stale-queue",
      proposal: { summary: "Defer a second reviewed requirement write.", parameters },
      baseSnapshot,
    });
    project = await approve(
      commands,
      project,
      "decision-stale-queue",
      "approve-traced-stale-queue",
    );
    project = await approveSuccessorBrief(briefs, project);
    const revisionBeforeStaleProposal = project.revision;

    const staleProposal = await assertRejects(
      () =>
        commands.proposeDecision(AGENT, {
          ...context("propose-traced-stale", project.revision),
          decisionId: "decision-stale-proposal",
          proposal: { summary: "Old source must not be rebound.", parameters },
          baseSnapshot,
        }),
      EngineeringProjectCommandError,
    );
    assertEquals(staleProposal.code, "approval_scope_mismatch");
    assertEquals((await store.get(PROJECT_ID))?.revision, revisionBeforeStaleProposal);

    const staleQueue = await assertRejects(
      () =>
        commands.queueRun(AGENT, {
          ...context("queue-traced-stale", project.revision),
          runId: "run-traced-stale",
          workItemId: "write-traced-stale-queue",
          summary: "The changed brief must stop this old queue.",
          basis: { kind: "thread-snapshot", ...baseSnapshot },
        }),
      EngineeringProjectCommandError,
    );
    assertEquals(staleQueue.code, "approval_scope_mismatch");
    const unchanged = await store.get(PROJECT_ID);
    assertEquals(unchanged?.revision, revisionBeforeStaleProposal);
    assertEquals(
      unchanged?.agentRuns.some((run) => run.id === "run-traced-stale"),
      false,
    );
  },
);

Deno.test("a direct proposal cannot use the retired requirements writer", async () => {
  const error = await assertRejects(
    () =>
      assertRequirementsDecisionProposalAtCommandBoundary({
        projects: STORE,
        project: legacyProject(),
        decisionId: "decision-requirements",
        proposal: { parameters: [] },
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_transition");
  assertEquals(error.message.includes("model.write-requirements@2"), true);
});

Deno.test("a retrospective trace proposal and queue reopen the same exact approved brief authority", async () => {
  const store = new MemoryProjectStore();
  const now = clock();
  const briefs = new ProjectBriefCommandService(store, now);
  let project = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  project = await commands.publishPlan(AGENT, baselinePlan(project));
  project = await completeBaseline(commands, project);
  project = await commands.appendChange(AGENT, requirementsBriefTraceChange(project));
  const requirements = parseTracedRequirementsProposalParameters(
    await retrospectiveTraceParametersFor(project),
  );
  const parameters = requirementsBriefTraceParameters({
    requirementsCapture: {
      artifactId: "approved-brief-baseline",
      fingerprint: FINGERPRINT,
      producerRunId: "run-baseline-traced-guard",
      schemaVersion: "requirements-capture/3.0",
    },
    requirements,
  });
  const baseSnapshot = project.threadSnapshots.at(-1)!;
  project = await commands.proposeDecision(AGENT, {
    ...context("propose-retrospective-trace", project.revision),
    decisionId: "decision-retrospective-trace",
    proposal: { summary: "Seal documentary links only.", parameters },
    baseSnapshot,
  });
  project = await approve(
    commands,
    project,
    "decision-retrospective-trace",
    "approve-retrospective-trace",
  );
  project = await commands.queueRun(AGENT, {
    ...context("queue-retrospective-trace", project.revision),
    runId: "run-retrospective-trace",
    workItemId: "seal-retrospective-trace",
    summary: "Queue the provider-free documentary append.",
    basis: { kind: "thread-snapshot", ...baseSnapshot },
  });
  assertEquals(
    project.agentRuns.find((run) => run.id === "run-retrospective-trace")?.status,
    "queued",
  );
});

Deno.test("a successor retrospective trace derives both capture and prior-claim evidence from claimInput bindings", async () => {
  const store = new MemoryProjectStore();
  const now = clock();
  const briefs = new ProjectBriefCommandService(store, now);
  let project = await approvedProject(briefs);
  const commands = new EngineeringProjectCommandService(
    store,
    undefined,
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    { validateInitial: () => Promise.resolve() },
  );
  project = await commands.publishPlan(AGENT, baselinePlan(project));
  project = await completeBaseline(commands, project);
  const claimInputIds = [
    "requirements-capture-successor",
    "requirements-brief-trace-previous",
  ];
  project = await commands.appendChange(
    AGENT,
    requirementsBriefTraceChange(project, claimInputIds),
  );
  const requirements = parseTracedRequirementsProposalParameters(
    await retrospectiveTraceParametersFor(project),
  );
  const parameters = requirementsBriefTraceParameters({
    requirementsCapture: {
      artifactId: claimInputIds[0]!,
      fingerprint: FINGERPRINT,
      producerRunId: "run-requirements-successor",
      schemaVersion: "requirements-capture/3.0",
    },
    predecessor: {
      artifactId: claimInputIds[1]!,
      fingerprint: FINGERPRINT,
      producerRunId: "run-requirements-brief-trace-previous",
    },
    requirements,
  });
  const baseSnapshot = project.threadSnapshots.at(-1)!;
  project = await commands.proposeDecision(AGENT, {
    ...context("propose-retrospective-trace-successor", project.revision),
    decisionId: "decision-retrospective-trace",
    proposal: { summary: "Supersede one documentary link only.", parameters },
    baseSnapshot,
  });
  assertEquals(
    decision(project, "decision-retrospective-trace").inputEvidenceRefs.map((ref) =>
      ref.id
    ),
    claimInputIds.toSorted(),
  );
  project = await approve(
    commands,
    project,
    "decision-retrospective-trace",
    "approve-retrospective-trace-successor",
  );
  project = await commands.queueRun(AGENT, {
    ...context("queue-retrospective-trace-successor", project.revision),
    runId: "run-retrospective-trace-successor",
    workItemId: "seal-retrospective-trace",
    summary: "Queue the provider-free documentary successor append.",
    basis: { kind: "thread-snapshot", ...baseSnapshot },
  });
  assertEquals(
    project.agentRuns.find((run) => run.id === "run-retrospective-trace-successor")
      ?.status,
    "queued",
  );
});

Deno.test("a queue cannot start the retired requirements writer", async () => {
  const error = await assertRejects(
    () =>
      assertRequirementsWriteQueueAdmissible({
        projects: STORE,
        project: legacyProject(),
        workItemId: "write-requirements",
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "invalid_transition");
  assertEquals(error.message.includes("retired"), true);
});

Deno.test("a traced proposal requires one plan change owning both its work and decision", async () => {
  const error = await assertRejects(
    () =>
      assertTracedRequirementsProposalAtProjectBoundary({
        projects: STORE,
        project: tracedProjectWithPartialOwner(),
        workItemId: "write-requirements",
        decisionId: "decision-requirements",
        proposal: { parameters: tracedParameters() },
        mode: "current",
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "approval_scope_mismatch");
  assertEquals(error.message.includes("jointly owned"), true);
});

Deno.test("a traced proposal rejects split and ambiguous plan-change ownership", async () => {
  const split = projectWithOperation("2") as Record<string, unknown>;
  split.planChanges = [{
    id: "change-work-only",
    commandId: "append-work-only",
    workItemIds: ["write-requirements"],
    decisionIds: [],
  }, {
    id: "change-decision-only",
    commandId: "append-decision-only",
    workItemIds: [],
    decisionIds: ["decision-requirements"],
  }];
  const splitError = await assertRejects(
    () =>
      assertTracedRequirementsProposalAtProjectBoundary({
        projects: STORE,
        project: split as unknown as EngineeringProjectSnapshot,
        workItemId: "write-requirements",
        decisionId: "decision-requirements",
        proposal: { parameters: tracedParameters() },
        mode: "current",
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(splitError.code, "approval_scope_mismatch");
  assertEquals(splitError.message.includes("jointly owned"), true);

  const ambiguous = projectWithOperation("2") as Record<string, unknown>;
  ambiguous.planChanges = ["one", "two"].map((id) => ({
    id: `change-${id}`,
    commandId: `append-${id}`,
    approvedBriefBasis: approvedBasis(),
    workItemIds: ["write-requirements"],
    decisionIds: ["decision-requirements"],
  }));
  const ambiguousError = await assertRejects(
    () =>
      assertTracedRequirementsProposalAtProjectBoundary({
        projects: STORE,
        project: ambiguous as unknown as EngineeringProjectSnapshot,
        workItemId: "write-requirements",
        decisionId: "decision-requirements",
        proposal: { parameters: tracedParameters() },
        mode: "current",
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(ambiguousError.code, "approval_scope_mismatch");
  assertEquals(ambiguousError.message.includes("multiple owning"), true);
});

Deno.test("a traced proposal rejects a foreign signed brief basis before any store reopen", async () => {
  const project = projectWithOperation("2") as Record<string, unknown>;
  project.planChanges = [{
    id: "change-requirements",
    commandId: "append-requirements",
    approvedBriefBasis: approvedBasis(),
    workItemIds: ["write-requirements"],
    decisionIds: ["decision-requirements"],
  }];
  const error = await assertRejects(
    () =>
      assertTracedRequirementsProposalAtProjectBoundary({
        projects: STORE,
        project: project as unknown as EngineeringProjectSnapshot,
        workItemId: "write-requirements",
        decisionId: "decision-requirements",
        proposal: {
          parameters: replaceParameter(
            tracedParameters(),
            "requirements.sourceBriefFingerprint",
            `sha256:${"c".repeat(64)}`,
          ),
        },
        mode: "current",
      }),
    EngineeringProjectCommandError,
  );
  assertEquals(error.code, "approval_scope_mismatch");
  assertEquals(error.message.includes("does not match"), true);
});

function legacyProject(): EngineeringProjectSnapshot {
  return projectWithOperation("1") as EngineeringProjectSnapshot;
}

function tracedProjectWithPartialOwner(): EngineeringProjectSnapshot {
  const project = projectWithOperation("2") as Record<string, unknown>;
  project.planChanges = [{
    id: "change-requirements",
    commandId: "append-requirements",
    workItemIds: ["write-requirements"],
    decisionIds: [],
  }];
  return project as unknown as EngineeringProjectSnapshot;
}

function projectWithOperation(version: "1" | "2"): unknown {
  return {
    project: { id: PROJECT_ID },
    workItems: [{
      id: "write-requirements",
      decisionIds: ["decision-requirements"],
      operation: { id: "model.write-requirements", version, bindings: [] },
    }],
    decisions: [{
      id: "decision-requirements",
      status: "required",
    }],
    plan: { basis: approvedBasis() },
    planChanges: [],
  };
}

function approvedBasis() {
  return {
    kind: "approved-brief" as const,
    projectId: PROJECT_ID,
    projectSnapshotId: "requirements-guard-project-r3",
    projectRevision: 3,
    briefId: "brief-requirements",
    briefSnapshotId: "brief-requirements-r1",
    briefRevision: 1,
    approvedBriefFingerprint: FINGERPRINT,
  };
}

function tracedParameters(): readonly EngineeringDecisionProposalParameter[] {
  return [
    parameter("requirements.containerComponent", "CameraMount"),
    parameter("requirements.sourceProjectId", PROJECT_ID),
    parameter("requirements.sourceProjectSnapshotId", "requirements-guard-project-r3"),
    parameter("requirements.sourceProjectRevision", 3),
    parameter("requirements.sourceBriefId", "brief-requirements"),
    parameter("requirements.sourceBriefSnapshotId", "brief-requirements-r1"),
    parameter("requirements.sourceBriefRevision", 1),
    parameter("requirements.sourceBriefFingerprint", `sha256:${"a".repeat(64)}`),
    parameter("requirements.sourceBriefContentFingerprint", `sha256:${"b".repeat(64)}`),
    parameter("requirements.containerSourceItemId", "mission-camera-mount"),
    parameter("requirement.stress.name", "Maximum stress"),
    parameter("requirement.stress.metric", "maxStress"),
    parameter("requirement.stress.operator", "<="),
    parameter("requirement.stress.threshold", 90_000_000, "Pa"),
    parameter("requirement.stress.sourceItemId", "success-stress"),
    parameter("requirement.stress.declaredThreshold", 90, "MPa"),
  ];
}

function parameter(
  key: string,
  value: string | number,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return unit === undefined ? { key, label: key, value } : {
    key,
    label: key,
    value,
    unit,
  };
}

function replaceParameter(
  parameters: readonly EngineeringDecisionProposalParameter[],
  key: string,
  value: string | number,
): readonly EngineeringDecisionProposalParameter[] {
  return parameters.map((entry) => entry.key === key ? parameter(key, value) : entry);
}

const AGENT = { kind: "agent" as const, actorId: "agent:requirements-test" };
const HUMAN = { kind: "human" as const, actorId: "human:requirements-test" };
const CLOCK_START = Date.parse("2026-09-07T05:00:00.000Z");

function clock() {
  let tick = 0;
  return () => new Date(CLOCK_START + ++tick * 1_000).toISOString();
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-09-07T04:59:00.000Z",
  };
}

async function approvedProject(
  briefs: ProjectBriefCommandService,
): Promise<EngineeringProjectSnapshot> {
  let project = await briefs.startProject(AGENT, {
    ...context("start-traced-guard", 1),
    projectName: "Traced requirements command boundary",
    intent: "Prove a compact reviewed scalar requirement path.",
    intentSource: { kind: "human", reference: "conversation:requirements-guard" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("propose-brief-traced-guard", project.revision),
    items: briefItems(),
  });
  const proposed = project.framing!.proposedBrief!;
  project = await briefs.approveBrief(HUMAN, {
    ...context("approve-brief-traced-guard", project.revision),
    briefSnapshotId: proposed.id,
    briefRevision: proposed.revision,
    rationale: "The source clauses were reviewed by the human owner.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return project;
}

function baselinePlan(project: EngineeringProjectSnapshot) {
  return {
    ...context("publish-baseline-traced-guard", project.revision),
    startingPoint: "idea-or-spec" as const,
    phases: [{
      id: "phase-baseline",
      name: "Documentary baseline",
      description: "Seal the approved brief before later technical work.",
    }],
    workItems: [{
      id: "record-approved-brief",
      phaseId: "phase-baseline",
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
      },
    }],
    requiredDecisions: [],
  };
}

async function completeBaseline(
  commands: EngineeringProjectCommandService,
  project: EngineeringProjectSnapshot,
): Promise<EngineeringProjectSnapshot> {
  const basis = project.plan!.basis;
  let next = await commands.queueRun(AGENT, {
    ...context("queue-baseline-traced-guard", project.revision),
    runId: "run-baseline-traced-guard",
    workItemId: "record-approved-brief",
    summary: "Queue the provider-free documentary baseline.",
    basis,
  });
  next = await commands.claimRun(AGENT, {
    ...context("claim-baseline-traced-guard", next.revision),
    runId: "run-baseline-traced-guard",
    summary: "Claim the provider-free documentary baseline.",
  });
  next = await commands.publishRun(AGENT, {
    ...context("mark-baseline-publishing-traced-guard", next.revision),
    runId: "run-baseline-traced-guard",
    summary: "Publish the provider-free documentary baseline.",
  });
  const resultSnapshot = {
    snapshotId: `${project.project.subjectId}:r1:brief-baseline`,
    revision: 1,
    subjectId: project.project.subjectId,
  };
  return await commands.completeRun(AGENT, {
    ...context("complete-baseline-traced-guard", next.revision),
    runId: "run-baseline-traced-guard",
    summary: "Complete the provider-free documentary baseline.",
    resultSnapshot,
    evidenceRefs: [{
      snapshotId: resultSnapshot.snapshotId,
      snapshotRevision: resultSnapshot.revision,
      kind: "artifact",
      id: "approved-brief-baseline",
    }],
  });
}

function tracedRequirementsChange(project: EngineeringProjectSnapshot) {
  const baseSnapshot = project.threadSnapshots.at(-1)!;
  const operation = {
    id: MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION.id,
    version: MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const items = [
    ["write-traced-valid", "decision-valid"],
    ["write-traced-stale-proposal", "decision-stale-proposal"],
    ["write-traced-stale-queue", "decision-stale-queue"],
  ] as const;
  return {
    ...context("append-traced-requirements", project.revision),
    baseSnapshot,
    phases: [{
      id: "phase-requirements",
      name: "Reviewed requirements",
      description: "Bind one exact approved brief to scalar requirements.",
    }],
    workItems: items.map(([id, decisionId]) => ({
      id,
      phaseId: "phase-requirements",
      owner: "agent" as const,
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: [decisionId],
      operation,
    })),
    requiredDecisions: items.map(([id, decisionId]) => ({
      id: decisionId,
      phaseId: "phase-requirements",
      title: `Approve ${id}`,
      question: "Does the exact reviewed brief authorize this scalar requirement?",
    })),
  };
}

function requirementsBriefTraceChange(
  project: EngineeringProjectSnapshot,
  claimInputIds = ["approved-brief-baseline"],
) {
  const baseSnapshot = project.threadSnapshots.at(-1)!;
  return {
    ...context("append-retrospective-trace", project.revision),
    baseSnapshot,
    phases: [{
      id: "phase-retrospective-trace",
      name: "Retrospective documentary trace",
      description: "Link existing legacy requirements to reviewed brief items.",
    }],
    workItems: [{
      id: "seal-retrospective-trace",
      phaseId: "phase-retrospective-trace",
      owner: "agent" as const,
      dependsOnWorkItemIds: ["record-approved-brief"],
      decisionIds: ["decision-retrospective-trace"],
      operation: {
        id: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id,
        version: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.version,
        bindings: [
          {
            name: "approvedBrief",
            source: { kind: "approved-brief" as const },
          },
          ...claimInputIds.map((id) => ({
            name: "claimInput",
            source: {
              kind: "thread-entity" as const,
              reference: {
                snapshotId: baseSnapshot.snapshotId,
                snapshotRevision: baseSnapshot.revision,
                kind: "artifact" as const,
                id,
              },
            },
          })),
        ],
      },
    }],
    requiredDecisions: [{
      id: "decision-retrospective-trace",
      phaseId: "phase-retrospective-trace",
      title: "Approve retrospective documentary links",
      question: "Do these links only record exact reviewed brief origins?",
    }],
  };
}

async function tracedParametersFor(
  project: EngineeringProjectSnapshot,
): Promise<readonly EngineeringDecisionProposalParameter[]> {
  const brief = project.framing!.currentBrief!;
  const proposal: TracedRequirementsProposal = {
    containerComponent: "CameraMount",
    partDefName: "CameraMountRequirements",
    requirements: [{
      slug: "stress",
      name: "Maximum mount stress",
      metric: "max_mount_stress",
      operator: "<=",
      threshold: { value: 90_000_000, unit: "Pa" },
    }],
    briefSource: {
      basis: approvedBriefBasisForProject(project),
      briefContentFingerprint: await sha256Fingerprint(brief),
      containerSourceItemId: "mission-camera-mount",
      requirements: [{
        requirementId: "max_mount_stress",
        sourceItemId: "success-mount-stress",
        declaredThreshold: { value: 90, unit: "MPa" },
        transformation: "MPa-to-Pa",
      }],
    },
  };
  return tracedRequirementsProposalParameters(proposal);
}

async function retrospectiveTraceParametersFor(
  project: EngineeringProjectSnapshot,
): Promise<readonly EngineeringDecisionProposalParameter[]> {
  return (await tracedParametersFor(project)).map((parameter) =>
    parameter.key === "requirement.stress.declaredThreshold"
      ? { ...parameter, value: 90_000_000, unit: "Pa" }
      : parameter
  );
}

async function approve(
  commands: EngineeringProjectCommandService,
  project: EngineeringProjectSnapshot,
  decisionId: string,
  commandId: string,
): Promise<EngineeringProjectSnapshot> {
  return await commands.approveDecision(HUMAN, {
    ...context(commandId, project.revision),
    decisionId,
    rationale: "The exact displayed traced proposal is approved.",
    inputFingerprint: decision(project, decisionId).inputFingerprint!,
  });
}

async function approveSuccessorBrief(
  briefs: ProjectBriefCommandService,
  project: EngineeringProjectSnapshot,
): Promise<EngineeringProjectSnapshot> {
  let next = await briefs.proposeBrief(AGENT, {
    ...context("propose-successor-traced-guard", project.revision),
    items: briefItems().map((item) =>
      item.id === "success-mount-stress"
        ? { ...item, statement: "Maximum mount stress stays at or below 80 MPa." }
        : item
    ),
  });
  const proposed = next.framing!.proposedBrief!;
  next = await briefs.approveBrief(HUMAN, {
    ...context("approve-successor-traced-guard", next.revision),
    briefSnapshotId: proposed.id,
    briefRevision: proposed.revision,
    rationale: "The human reviewed the revised stress envelope.",
    inputFingerprint: next.framing!.proposalReview!.inputFingerprint,
  });
  return next;
}

function decision(project: EngineeringProjectSnapshot, id: string) {
  return project.decisions.find((entry) => entry.id === id)!;
}

function briefItems(): readonly ProjectBriefItem[] {
  const source = [{
    kind: "intent" as const,
    reference: "conversation:requirements-guard",
  }];
  return [{
    id: "objective-camera-mount",
    kind: "objective",
    statement: "Demonstrate a reviewable camera mount requirement path.",
    sourceRefs: source,
  }, {
    id: "mission-camera-mount",
    kind: "mission-scenario",
    statement:
      "The camera mount carries its reviewed load within the declared envelope.",
    sourceRefs: source,
  }, {
    id: "success-mount-stress",
    kind: "success-criterion",
    statement: "Maximum mount stress stays at or below 90 MPa.",
    sourceRefs: source,
    dependsOnItemIds: [],
  }, {
    id: "verify-mount-stress",
    kind: "verification-activity",
    statement: "Verify mount stress against the reviewed success criterion.",
    sourceRefs: source,
    dependsOnItemIds: ["success-mount-stress"],
  }];
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly #revisions = new Map<number, EngineeringProjectSnapshot>();

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const current = [...this.#revisions.values()]
      .filter((snapshot) => snapshot.project.id === projectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(current ? structuredClone(current) : undefined);
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const snapshot = this.#revisions.get(revision);
    return Promise.resolve(
      snapshot?.project.id === projectId ? structuredClone(snapshot) : undefined,
    );
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.#revisions.size > 0) {
      throw new EngineeringProjectStoreConflictError("Project already exists.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  async commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = await this.get(snapshot.project.id);
    if (!current || current.revision !== expectedRevision) {
      throw new EngineeringProjectStoreConflictError("Project revision is stale.");
    }
    this.#revisions.set(snapshot.revision, structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}
