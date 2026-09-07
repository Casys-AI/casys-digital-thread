/** Pure adversarial MRTR/run tests: structural fixtures, no storage or provider. */
import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  parseRequirementsBriefTraceParameters,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
} from "../../domain/record/requirements-brief-trace.ts";
import { requireRequirementsBriefTraceApproval } from "./requirements-brief-trace-approval.ts";

const TIME = "2026-09-07T08:15:30.000Z";
const CAPTURE_ID = "requirements-capture:exact";
const PREDECESSOR_ID = "requirements-brief-trace:prior";
const DECISION_ID = "decision:trace";

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

interface ApprovalFixture {
  project: Mutable<EngineeringProjectSnapshot>;
  run: Mutable<EngineeringAgentRun>;
  work: Mutable<EngineeringWorkItem>;
  decision: Mutable<EngineeringDecision>;
  approval: Mutable<EngineeringApproval>;
  basis: EngineeringThreadSnapshotBasis;
}

function parameter(
  key: string,
  value: EngineeringDecisionProposalParameter["value"],
  unit?: string,
): EngineeringDecisionProposalParameter {
  return unit === undefined
    ? { key, label: key, value }
    : { key, label: key, value, unit };
}

function parameters(successor: boolean): EngineeringDecisionProposalParameter[] {
  return [
    parameter("requirements.containerComponent", "ArticulatedArm"),
    parameter("requirements.sourceProjectId", "project:trace"),
    parameter("requirements.sourceProjectSnapshotId", "project:trace:r3"),
    parameter("requirements.sourceProjectRevision", 3),
    parameter("requirements.sourceBriefId", "brief:trace"),
    parameter("requirements.sourceBriefSnapshotId", "brief:trace:r1"),
    parameter("requirements.sourceBriefRevision", 1),
    parameter("requirements.sourceBriefFingerprint", `sha256:${"a".repeat(64)}`),
    parameter("requirements.sourceBriefContentFingerprint", `sha256:${"b".repeat(64)}`),
    parameter("requirements.containerSourceItemId", "item:container"),
    parameter("requirement.displacement.name", "Maximum arm displacement"),
    parameter("requirement.displacement.metric", "arm_max_displacement"),
    parameter("requirement.displacement.operator", "<="),
    parameter("requirement.displacement.threshold", 2, "mm"),
    parameter("requirement.displacement.sourceItemId", "item:displacement"),
    parameter("requirement.displacement.declaredThreshold", 2, "mm"),
    parameter("trace.artifactId", CAPTURE_ID),
    parameter("trace.captureFingerprint", `sha256:${"c".repeat(64)}`),
    parameter("trace.producerRunId", "run:requirements"),
    parameter("trace.captureSchema", "requirements-capture/6.0"),
    ...(successor
      ? [
        parameter("trace.predecessorArtifactId", PREDECESSOR_ID),
        parameter("trace.predecessorFingerprint", `sha256:${"d".repeat(64)}`),
        parameter("trace.predecessorRunId", "run:prior"),
      ]
      : []),
  ];
}

async function fixture(successor = false): Promise<ApprovalFixture> {
  const basis: EngineeringThreadSnapshotBasis = {
    kind: "thread-snapshot",
    snapshotId: "thread:trace:r8",
    revision: 8,
    subjectId: "subject:arm",
  };
  const evidence = [CAPTURE_ID, ...(successor ? [PREDECESSOR_ID] : [])].map((id) => ({
    snapshotId: basis.snapshotId,
    snapshotRevision: basis.revision,
    kind: "artifact" as const,
    id,
  }));
  const baseSnapshot: EngineeringThreadSnapshotRef = {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
  const proposal = {
    summary:
      "Record the reviewed correspondence of one requirement to one brief clause.",
    parameters: parameters(successor),
    proposedAt: TIME,
    proposedBy: { id: "agent:fixture", origin: "agent" as const },
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot,
    inputEvidenceRefs: evidence,
    proposal: { summary: proposal.summary, parameters: proposal.parameters },
  });
  const operation = {
    ...RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
    bindings: [
      { name: "approvedBrief", source: { kind: "approved-brief" as const } },
      ...evidence.map((reference) => ({
        name: "claimInput",
        source: { kind: "thread-entity" as const, reference },
      })),
    ],
  };
  const work: EngineeringWorkItem = {
    id: "work:trace",
    activityId: "activity:trace",
    phaseId: "phase:record",
    title: "Record a late correspondence",
    description: "Seal one reviewed documentary requirement to brief claim.",
    kind: "review",
    operation,
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [DECISION_ID],
    blockerIds: [],
  };
  const decision: EngineeringDecision = {
    id: DECISION_ID,
    phaseId: work.phaseId,
    title: "Review the correspondence",
    question: "Record this documentary correspondence without asserting satisfaction?",
    status: "approved",
    requestedAt: TIME,
    baseSnapshot,
    inputFingerprint: decisionFingerprint,
    inputEvidenceRefs: evidence,
    approvalIds: ["approval:trace"],
    proposal,
  };
  const approval: EngineeringApproval = {
    id: "approval:trace",
    decisionId: DECISION_ID,
    status: "approved",
    requestedAt: TIME,
    decidedAt: TIME,
    decidedBy: "human:reviewer",
    decidedByOrigin: "human",
    rationale: "Reviewed the exact documentary correspondence.",
    baseSnapshot,
    inputFingerprint: decisionFingerprint,
    inputEvidenceRefs: evidence,
  };
  const run: EngineeringAgentRun = {
    id: "run:trace",
    workItemId: work.id,
    status: "queued",
    summary: "Record the reviewed correspondence.",
    queuedAt: TIME,
    basis,
    inputFingerprint: await sha256Fingerprint({
      workItemId: work.id,
      basis,
      operation,
      approvedDecisions: [{ id: decision.id, inputFingerprint: decisionFingerprint }],
    }),
    evidenceRefs: [],
  };
  const project: EngineeringProjectSnapshot = {
    schemaVersion: "4.0",
    id: "project:trace:r9",
    revision: 9,
    generatedAt: TIME,
    project: {
      id: "project:trace",
      name: "Trace approval fixture",
      subjectId: basis.subjectId,
      objective: {
        title: "Document correspondence",
        statement: "Record one reviewed claim.",
      },
    },
    threadSnapshots: [baseSnapshot],
    phases: [{
      id: work.phaseId,
      name: "Record",
      order: 1,
      description: "Record documentary trace evidence.",
      workItemIds: [work.id],
      requiredDecisionIds: [decision.id],
      evidenceRefs: evidence,
    }],
    workItems: [work],
    agentRuns: [run],
    decisions: [decision],
    approvals: [approval],
    blockers: [],
  };
  // Test-only mutability for adversarial structural overrides. Production
  // DTOs and the real parser/approval helper remain unchanged and fully typed.
  const mutable = structuredClone(project) as Mutable<EngineeringProjectSnapshot>;
  return {
    project: mutable,
    run: mutable.agentRuns[0]!,
    work: mutable.workItems[0]!,
    decision: mutable.decisions[0]!,
    approval: mutable.approvals[0]!,
    basis,
  };
}

/** Reseal a reviewed mutation so refusal cannot be explained by a stale hash alone. */
async function reseal(value: ApprovalFixture): Promise<void> {
  const proposal = value.decision.proposal!;
  const fingerprint = await sha256Fingerprint({
    baseSnapshot: value.decision.baseSnapshot,
    inputEvidenceRefs: value.decision.inputEvidenceRefs,
    proposal: { summary: proposal.summary, parameters: proposal.parameters },
  });
  value.decision.inputFingerprint = structuredClone(fingerprint);
  value.approval.inputFingerprint = structuredClone(fingerprint);
  value.run.inputFingerprint = await sha256Fingerprint({
    workItemId: value.work.id,
    basis: value.run.basis,
    operation: value.work.operation,
    approvedDecisions: [{ id: value.decision.id, inputFingerprint: fingerprint }],
  });
}

function setEvidence(
  value: ApprovalFixture,
  refs: readonly EngineeringThreadEntityRef[],
): void {
  value.decision.inputEvidenceRefs = refs.map((ref) => ({ ...ref }));
  value.approval.inputEvidenceRefs = refs.map((ref) => ({ ...ref }));
}

async function refuses(value: ApprovalFixture, message?: string): Promise<void> {
  await assertRejects(
    () => requireRequirementsBriefTraceApproval(value.project, value.run),
    EngineeringProjectCommandError,
    message,
  );
}

for (const successor of [false, true]) {
  Deno.test(`brief trace approval accepts exact ${successor ? "successor" : "first"} claim MRTR and run`, async () => {
    const value = await fixture(successor);
    const result = await requireRequirementsBriefTraceApproval(
      value.project,
      value.run,
    );
    assertEquals<EngineeringDecision>(result.decision, value.decision);
    assertEquals(
      result.proposal,
      parseRequirementsBriefTraceParameters(parameters(successor)),
    );
    assertEquals(
      value.decision.inputEvidenceRefs.map((ref) => ref.id),
      successor ? [CAPTURE_ID, PREDECESSOR_ID] : [CAPTURE_ID],
    );
    assertEquals(
      result.proposal.predecessor?.artifactId,
      successor ? PREDECESSOR_ID : undefined,
    );
  });
}

Deno.test("brief trace approval refuses missing, unapproved or ambiguous MRTR decisions", async () => {
  const mutations: ((value: ApprovalFixture) => void)[] = [
    (value) => value.work.decisionIds = [],
    (value) => value.work.decisionIds.push("decision:other"),
    (value) => value.project.decisions = [],
    (value) => value.decision.status = "proposed",
    (value) => delete value.decision.proposal,
    (value) => delete value.decision.inputFingerprint,
    (value) => value.decision.approvalIds = [],
  ];
  for (const mutate of mutations) {
    const value = await fixture();
    mutate(value);
    await refuses(value);
  }
});

Deno.test("brief trace approval requires a linked exact human approval receipt", async () => {
  const mutations: ((value: ApprovalFixture) => void)[] = [
    (value) => value.project.approvals = [],
    (value) => value.approval.status = "pending",
    (value) => value.approval.decidedByOrigin = "agent",
    (value) => delete value.approval.decidedByOrigin,
    (value) => value.approval.decidedBy = "   ",
    (value) => delete value.approval.decidedBy,
    (value) => value.approval.decidedAt = "not-an-instant",
    (value) => delete value.approval.decidedAt,
    (value) => value.approval.decisionId = "decision:other",
    (value) =>
      value.approval.inputFingerprint = { algorithm: "sha256", digest: "f".repeat(64) },
  ];
  for (const mutate of mutations) {
    const value = await fixture();
    mutate(value);
    await refuses(value, "human approval");
  }
});

Deno.test("brief trace approval refuses duplicate linked human approvals", async () => {
  const value = await fixture();
  value.project.approvals.push({
    ...structuredClone(value.approval),
    id: "approval:duplicate",
  });
  value.decision.approvalIds.push("approval:duplicate");
  await refuses(value, "human approval");
});

Deno.test("brief trace approval refuses an extra approved receipt even when unlinked", async () => {
  const value = await fixture();
  value.project.approvals.push({
    ...structuredClone(value.approval),
    id: "approval:unlinked",
  });
  await refuses(value, "human approval");
});

Deno.test("brief trace approval refuses changed decision bytes despite matching approval and run hashes", async () => {
  const value = await fixture();
  value.decision.proposal!.summary = "A different unreviewed correspondence.";
  await refuses(value, "decision fingerprint");

  const changedHash = await fixture();
  const forged = { algorithm: "sha256" as const, digest: "f".repeat(64) };
  changedHash.decision.inputFingerprint = { ...forged };
  changedHash.approval.inputFingerprint = { ...forged };
  changedHash.run.inputFingerprint = await sha256Fingerprint({
    workItemId: changedHash.work.id,
    basis: changedHash.run.basis,
    operation: changedHash.work.operation,
    approvedDecisions: [{ id: changedHash.decision.id, inputFingerprint: forged }],
  });
  await refuses(changedHash, "decision fingerprint");
});

Deno.test("brief trace approval refuses a missing or changed run fingerprint", async () => {
  const missing = await fixture();
  delete missing.run.inputFingerprint;
  await refuses(missing, "run fingerprint");
  const changed = await fixture();
  changed.run.inputFingerprint = { algorithm: "sha256", digest: "f".repeat(64) };
  await refuses(changed, "run fingerprint");
});

Deno.test("brief trace approval refuses unknown, extra, duplicate or missing operation bindings", async () => {
  const mutations: ((value: ApprovalFixture) => void)[] = [
    (value) => value.work.operation!.bindings[0]!.name = "unknownBinding",
    (value) =>
      value.work.operation!.bindings.push({
        name: "extra",
        source: { kind: "approved-brief" },
      }),
    (value) => value.work.operation!.bindings.pop(),
    (value) => value.work.operation!.bindings.shift(),
    (value) =>
      value.work.operation!.bindings[1] = structuredClone(
        value.work.operation!.bindings[0]!,
      ),
    (value) =>
      value.work.operation!.bindings[1]!.source = {
        kind: "project-answer",
        answerId: "answer:foreign",
      },
  ];
  for (const mutate of mutations) {
    const value = await fixture();
    mutate(value);
    await reseal(value);
    await refuses(value, "bindings");
  }
});

Deno.test("brief trace approval requires each signed capture and predecessor exactly once in claimInput", async () => {
  const missing = await fixture(true);
  missing.work.operation!.bindings.pop();
  await reseal(missing);
  await refuses(missing, "claimInput");

  const extra = await fixture();
  extra.work.operation!.bindings.push({
    name: "claimInput",
    source: {
      kind: "thread-entity",
      reference: { ...extra.decision.inputEvidenceRefs[0]!, id: "artifact:unreviewed" },
    },
  });
  await reseal(extra);
  await refuses(extra, "claimInput");

  const duplicate = await fixture(true);
  duplicate.work.operation!.bindings[2] = structuredClone(
    duplicate.work.operation!.bindings[1]!,
  );
  await reseal(duplicate);
  await refuses(duplicate, "claimInput");
});

Deno.test("brief trace approval refuses a missing predecessor or extra evidence even when fully resealed", async () => {
  const missing = await fixture(true);
  setEvidence(missing, missing.decision.inputEvidenceRefs.slice(0, 1));
  await reseal(missing);
  await refuses(missing, "input evidence");

  const extra = await fixture();
  setEvidence(extra, [...extra.decision.inputEvidenceRefs, {
    ...extra.decision.inputEvidenceRefs[0]!,
    id: "artifact:unreviewed",
  }]);
  await reseal(extra);
  await refuses(extra, "input evidence");

  const duplicate = await fixture(true);
  setEvidence(duplicate, [
    duplicate.decision.inputEvidenceRefs[0]!,
    duplicate.decision.inputEvidenceRefs[0]!,
  ]);
  await reseal(duplicate);
  await refuses(duplicate, "input evidence");
});

Deno.test("brief trace approval refuses an unsigned predecessor or incomplete predecessor triple", async () => {
  const unsigned = await fixture(true);
  unsigned.decision.proposal!.parameters = unsigned.decision.proposal!.parameters
    .filter((item) => !item.key.startsWith("trace.predecessor"));
  await reseal(unsigned);
  await refuses(unsigned, "input evidence");

  const incomplete = await fixture(true);
  incomplete.decision.proposal!.parameters = incomplete.decision.proposal!.parameters
    .filter((item) => item.key !== "trace.predecessorRunId");
  await reseal(incomplete);
  await refuses(incomplete, "parameters are invalid");
});

Deno.test("brief trace approval refuses decision, approval and capture references at a different basis", async () => {
  const decision = await fixture();
  decision.decision.baseSnapshot = { ...decision.basis, revision: 7 };
  await reseal(decision);
  await refuses(decision, "run basis");

  const approval = await fixture();
  approval.approval.baseSnapshot = { ...approval.basis, subjectId: "subject:other" };
  await refuses(approval, "human approval");

  const capture = await fixture();
  setEvidence(capture, [{
    ...capture.decision.inputEvidenceRefs[0]!,
    snapshotRevision: 7,
  }]);
  await reseal(capture);
  await refuses(capture, "input evidence");

  const predecessor = await fixture(true);
  setEvidence(predecessor, [predecessor.decision.inputEvidenceRefs[0]!, {
    ...predecessor.decision.inputEvidenceRefs[1]!,
    snapshotId: "thread:trace:r7",
  }]);
  await reseal(predecessor);
  await refuses(predecessor, "input evidence");

  const absentRunBasis = await fixture();
  delete absentRunBasis.run.basis;
  await refuses(absentRunBasis, "exact ThreadSnapshot basis");
});

Deno.test("brief trace approval refuses a substituted requirements capture source or binding", async () => {
  const source = await fixture();
  source.decision.proposal!.parameters.find((item) => item.key === "trace.artifactId")!
    .value = "requirements-capture:foreign";
  await reseal(source);
  await refuses(source, "input evidence");

  const binding = await fixture();
  binding.work.operation!.bindings[1]!.source = {
    kind: "thread-entity",
    reference: {
      ...binding.decision.inputEvidenceRefs[0]!,
      id: "requirements-capture:foreign",
    },
  };
  await reseal(binding);
  await refuses(binding, "claimInput");

  const kind = await fixture();
  setEvidence(kind, [{ ...kind.decision.inputEvidenceRefs[0]!, kind: "requirement" }]);
  await reseal(kind);
  await refuses(kind, "input evidence");
});

Deno.test("brief trace approval refuses fake operations and detached work items", async () => {
  for (
    const operation of [
      { id: "model.write-requirements", version: "1" },
      { id: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id, version: "2" },
    ]
  ) {
    const value = await fixture();
    Object.assign(value.work.operation!, operation);
    await reseal(value);
    await refuses(value, "exact @1 operation");
  }
  const missing = await fixture();
  delete missing.work.operation;
  await refuses(missing, "exact @1 operation");
  const detached = await fixture();
  detached.run.workItemId = "work:foreign";
  await refuses(detached, "exact @1 operation");
});
