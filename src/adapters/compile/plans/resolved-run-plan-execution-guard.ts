/**
 * Read-only execution admission for resolved-operation-plan/2.0 runs.
 *
 * The queue transition seals a plan before it commits, but an executor runs
 * later against a newer project head.  This guard rereads the exact queue
 * basis, human authority and ThreadSnapshot evidence before an executor can
 * claim a WAL entry or contact a provider.  It intentionally resolves no
 * source bytes: byte-level provenance remains the executor's next boundary.
 */

import {
  canonicalResolvedOperationPlanV2Text,
  fingerprintResolvedOperationPlanV2,
  type ResolvedOperationPlanRef,
  type ResolvedOperationPlanV2,
  sameResolvedOperationPlanRef,
  validateResolvedOperationPlanRef,
  validateResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import { canonicalCalculixStepAssetCasUri } from "../../../domain/fea/isolated-v3/calculix-step-asset-uri.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  ResolvedCapabilityRuntimeOperation,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  canonicalResolvedCapabilityRuntimeOperationText,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import type { ResolvedRunPlanReader } from "../../../domain/project/resolved-run-plan-sealer.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

/** Narrow read ports: execution never needs project or ThreadSnapshot writes. */
export interface ResolvedRunPlanExecutionProjectReader {
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface ResolvedRunPlanExecutionSnapshotReader {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface RequireResolvedRunPlanExecutionInput {
  /** Current immutable project head already selected by the fixed executor. */
  readonly project: EngineeringProjectSnapshot;
  readonly runId: string;
  /** Code-owned executor identity, never a caller-selected registry descriptor. */
  readonly expectedOperation: Pick<EngineeringOperationRef, "id" | "version">;
  /**
   * The only lifecycle states in which this fixed executor may admit the run.
   *
   * This is deliberately supplied by each executor rather than inferred from
   * a guard-wide allow-list: a fresh dispatch and a post-ACK recovery have
   * different legal states.  It is checked before the plan store or any
   * provider boundary is read.
   */
  readonly expectedRunStatuses: readonly [
    EngineeringAgentRunStatus,
    ...EngineeringAgentRunStatus[],
  ];
  readonly projects: ResolvedRunPlanExecutionProjectReader;
  readonly snapshots: ResolvedRunPlanExecutionSnapshotReader;
  readonly plans: ResolvedRunPlanReader;
  /**
   * Optional until server composition installs the capability-runtime
   * supervisor. When configured it rechecks operational authorization after
   * all ROP provenance checks and before an executor can claim WAL/provider.
   */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
}

/**
 * Read-only replay admission for a durable terminal result. It verifies the
 * same recorded plan/reference, pre-queue project, MRTR and Thread basis as
 * fresh admission, but deliberately does not re-authorize a runtime that may
 * have been revoked or rolled over after the result was recorded.
 */
export type RequireRecordedResolvedRunPlanExecutionInput = Omit<
  RequireResolvedRunPlanExecutionInput,
  "capabilityRuntime"
>;

export interface ResolvedRunPlanExecutionAuthorization {
  readonly plan: ResolvedOperationPlanV2;
  readonly run: EngineeringAgentRun;
  readonly workItem: EngineeringWorkItem;
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly basis: ThreadSnapshot;
  /** One exact Thread artifact per closed-plan source binding. */
  readonly artifactsByBinding: ReadonlyMap<string, ThreadArtifact>;
  /** Server-resolved operational binding; never an agent/provider input. */
  readonly capabilityRuntime?: ResolvedCapabilityRuntimeOperation;
}

/**
 * Require all persisted ROP2 seals before any provider/WAL boundary.
 *
 * The only plan reference that can be read is the one stamped on the run.
 * In particular, this accepts neither a caller CAS URI nor a fallback to a
 * project "latest" revision or ThreadSnapshot.
 */
export async function requireResolvedRunPlanExecution(
  input: RequireResolvedRunPlanExecutionInput,
): Promise<ResolvedRunPlanExecutionAuthorization> {
  const authorization = await requireRecordedResolvedRunPlanExecution(input);
  if (!input.capabilityRuntime) {
    throw new TypeError(
      "Resolved operation plan execution requires the configured capability runtime supervisor before WAL or provider dispatch.",
    );
  }
  const project = validateEngineeringProjectSnapshot(input.project);
  const freshOperationalCapability = await input.capabilityRuntime.requireExecution({
    project,
    run: authorization.run,
    workItem: authorization.workItem,
    operation: authorization.workItem.operation!,
  });
  if (!freshOperationalCapability) {
    throw new TypeError(
      "Resolved operation plan requires an active operational capability binding, but the runtime supervisor resolved none.",
    );
  }
  if (
    canonicalResolvedCapabilityRuntimeOperationText(freshOperationalCapability) !==
      canonicalResolvedCapabilityRuntimeOperationText(
        authorization.plan.operationalCapability,
      )
  ) {
    throw new TypeError(
      "Capability runtime binding changed after queueing; requeue through a reviewed authorization amendment.",
    );
  }
  return authorization;
}

export async function requireRecordedResolvedRunPlanExecution(
  input: RequireRecordedResolvedRunPlanExecutionInput,
): Promise<ResolvedRunPlanExecutionAuthorization> {
  // Reject an executor invocation in a disallowed lifecycle state before any
  // plan-store read. The fully validated snapshot is reselected immediately
  // afterwards, before it can authorize anything else.
  const selectedRun = exactOne(
    input.project.agentRuns.filter((candidate) => candidate.id === input.runId),
    `Agent run ${input.runId}`,
  );
  assertExpectedRunStatus(selectedRun, input.expectedRunStatuses);

  const project = validateEngineeringProjectSnapshot(input.project);
  const run = exactOne(
    project.agentRuns.filter((candidate) => candidate.id === input.runId),
    `Agent run ${input.runId}`,
  );
  if (!run.resolvedOperationPlan) {
    throw new TypeError(
      `Agent run ${run.id} has no resolved-operation-plan/2.0 reference.`,
    );
  }

  // Deliberately the only plan-store read in this guard.  A caller never
  // supplies a ref, digest or URI to this function.
  const ref = validateResolvedOperationPlanRef(run.resolvedOperationPlan);
  const plan = validateResolvedOperationPlanV2(await input.plans.read(ref));
  await assertPlanReferenceIntegrity(plan, ref);
  assertExpectedOperation(plan, input.expectedOperation);

  const workItem = exactOne(
    project.workItems.filter((candidate) => candidate.id === run.workItemId),
    `Work item ${run.workItemId}`,
  );
  await assertRunAndCurrentWorkItem(plan, run, workItem, project);
  const queueReceipt = requireExactQueueReceipt(project, run, ref);

  const queueBasis = plan.run.queueBasisProject;
  const queuedProjectValue = await input.projects.getRevision(
    project.project.id,
    queueBasis.revision,
  );
  if (!queuedProjectValue) {
    throw new TypeError(
      "Resolved operation plan pre-queue project revision is absent.",
    );
  }
  const queuedProject = validateEngineeringProjectSnapshot(queuedProjectValue);
  if (
    queuedProject.project.id !== project.project.id ||
    queuedProject.id !== queueBasis.snapshotId ||
    queuedProject.revision !== queueBasis.revision ||
    !fingerprintsEqual(
      await sha256Fingerprint(queuedProject),
      queueBasis.fingerprint,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan pre-queue project revision does not match its exact hash.",
    );
  }

  const queuedWorkItem = exactOne(
    queuedProject.workItems.filter((candidate) => candidate.id === run.workItemId),
    `Queued work item ${run.workItemId}`,
  );
  await assertRunAndQueuedWorkItem(plan, run, queuedWorkItem, ref);
  assertQueueReceiptBelongsToQueuedRun(queueReceipt, run, ref);

  const { decision, approval } = await requireExactMrtr(
    plan,
    queuedProject,
    queuedWorkItem,
    run,
  );
  await assertQueuedRunInputFingerprint(run, queuedWorkItem, decision);

  const basis = await requireExactBasis(plan, run, input.snapshots);
  return {
    plan,
    run,
    workItem,
    decision,
    approval,
    basis,
    artifactsByBinding: requireExactSourceArtifacts(plan, basis),
    capabilityRuntime: plan.operationalCapability,
  };
}

function assertExpectedRunStatus(
  run: EngineeringAgentRun,
  expected: readonly EngineeringAgentRunStatus[],
): void {
  if (expected.length === 0) {
    throw new TypeError(
      "Resolved operation plan execution requires a non-empty code-owned expectedRunStatuses set.",
    );
  }
  const distinct = new Set<EngineeringAgentRunStatus>();
  for (const status of expected) {
    if (distinct.has(status)) {
      throw new TypeError(
        "Resolved operation plan execution expectedRunStatuses must not repeat a lifecycle status.",
      );
    }
    distinct.add(status);
  }
  if (!distinct.has(run.status)) {
    throw new TypeError(
      `Resolved operation plan run ${run.id} is ${run.status}, not in the fixed executor expectedRunStatuses set.`,
    );
  }
}

async function assertPlanReferenceIntegrity(
  plan: ResolvedOperationPlanV2,
  ref: ResolvedOperationPlanRef,
): Promise<void> {
  const canonical = canonicalResolvedOperationPlanV2Text(plan);
  const byteCount = new TextEncoder().encode(canonical).byteLength;
  if (
    plan.id !== ref.planId ||
    byteCount !== ref.byteCount ||
    !fingerprintsEqual(await fingerprintResolvedOperationPlanV2(plan), ref.fingerprint)
  ) {
    throw new TypeError(
      "Resolved operation plan bytes do not match the run-stamped CAS reference.",
    );
  }
}

function assertExpectedOperation(
  plan: ResolvedOperationPlanV2,
  expected: Pick<EngineeringOperationRef, "id" | "version">,
): void {
  if (
    plan.workItem.operation.id !== expected.id ||
    plan.workItem.operation.version !== expected.version
  ) {
    throw new TypeError(
      `Resolved operation plan is ${plan.workItem.operation.id}@${plan.workItem.operation.version}, not the fixed executor ${expected.id}@${expected.version}.`,
    );
  }
}

async function assertRunAndCurrentWorkItem(
  plan: ResolvedOperationPlanV2,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
  project: EngineeringProjectSnapshot,
): Promise<void> {
  if (
    plan.run.projectId !== project.project.id ||
    plan.run.runId !== run.id ||
    plan.run.workItemId !== run.workItemId ||
    plan.workItem.id !== workItem.id ||
    !run.inputFingerprint ||
    !fingerprintsEqual(plan.run.inputFingerprint, run.inputFingerprint)
  ) {
    throw new TypeError("Resolved operation plan does not bind the exact current run.");
  }
  await assertWorkItemOperation(plan, workItem, "current");
  assertRunBasis(plan, run, "current");
}

async function assertRunAndQueuedWorkItem(
  plan: ResolvedOperationPlanV2,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
  ref: ResolvedOperationPlanRef,
): Promise<void> {
  if (
    !run.resolvedOperationPlan ||
    !sameResolvedOperationPlanRef(run.resolvedOperationPlan, ref) ||
    plan.run.runId !== run.id ||
    plan.run.workItemId !== workItem.id ||
    !run.inputFingerprint ||
    !fingerprintsEqual(plan.run.inputFingerprint, run.inputFingerprint)
  ) {
    throw new TypeError("Resolved operation plan does not bind the exact queued run.");
  }
  await assertWorkItemOperation(plan, workItem, "queued");
  assertRunBasis(plan, run, "queued");
}

async function assertWorkItemOperation(
  plan: ResolvedOperationPlanV2,
  workItem: EngineeringWorkItem,
  scope: "current" | "queued",
): Promise<void> {
  const operation = workItem.operation;
  if (
    !operation ||
    plan.workItem.operation.id !== operation.id ||
    plan.workItem.operation.version !== operation.version ||
    !fingerprintsEqual(
      plan.workItem.operationFingerprint,
      await sha256Fingerprint(operation),
    )
  ) {
    throw new TypeError(
      `Resolved operation plan does not bind the exact ${scope} work-item operation.`,
    );
  }
}

function assertRunBasis(
  plan: ResolvedOperationPlanV2,
  run: EngineeringAgentRun,
  scope: "current" | "queued",
): void {
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.basis.snapshotId !== plan.basis.snapshotId ||
    run.basis.revision !== plan.basis.revision ||
    run.basis.subjectId !== plan.basis.subjectId
  ) {
    throw new TypeError(
      `Resolved operation plan does not bind the exact ${scope} ThreadSnapshot basis.`,
    );
  }
}

function requireExactQueueReceipt(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  ref: ResolvedOperationPlanRef,
) {
  const transition = run.statusHistory?.[0];
  if (!transition || transition.status !== "queued") {
    throw new TypeError(
      "Resolved operation plan run has no initial queued transition.",
    );
  }
  const receipt = exactOne(
    (project.commandReceipts ?? []).filter((candidate) =>
      candidate.type === "agent-run.queue" &&
      candidate.commandId === transition.commandId
    ),
    `Queue receipt for agent run ${run.id}`,
  );
  assertQueueReceiptBelongsToQueuedRun(receipt, run, ref);
  return receipt;
}

function assertQueueReceiptBelongsToQueuedRun(
  receipt: {
    readonly queuedRun?: {
      readonly runId: string;
      readonly workItemId: string;
      readonly resolvedOperationPlan?: EngineeringAgentRun["resolvedOperationPlan"];
    };
  },
  run: EngineeringAgentRun,
  ref: ResolvedOperationPlanRef,
): void {
  if (
    !receipt.queuedRun ||
    receipt.queuedRun.runId !== run.id ||
    receipt.queuedRun.workItemId !== run.workItemId ||
    !sameResolvedOperationPlanRef(receipt.queuedRun.resolvedOperationPlan, ref)
  ) {
    throw new TypeError(
      "Resolved operation plan is not sealed by the exact queued-run receipt.",
    );
  }
}

async function requireExactMrtr(
  plan: ResolvedOperationPlanV2,
  project: EngineeringProjectSnapshot,
  workItem: EngineeringWorkItem,
  run: EngineeringAgentRun,
): Promise<
  { readonly decision: EngineeringDecision; readonly approval: EngineeringApproval }
> {
  if (workItem.decisionIds.length !== 1) {
    throw new TypeError(
      "A resolved-operation-plan/2.0 run requires exactly one direct MRTR decision.",
    );
  }
  const decisionId = workItem.decisionIds[0]!;
  const decision = exactOne(
    project.decisions.filter((candidate) => candidate.id === decisionId),
    `Direct MRTR decision ${decisionId}`,
  );
  if (
    decision.status !== "approved" ||
    !decision.proposal ||
    !decision.inputFingerprint ||
    decision.id !== plan.authorization.mrtr.decisionId ||
    !fingerprintsEqual(
      decision.inputFingerprint,
      plan.authorization.mrtr.decisionInputFingerprint,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact direct approved MRTR decision.",
    );
  }
  await assertDecisionProposalFingerprint(decision);
  assertBasisMatchesPlanAndRun(decision.baseSnapshot, plan, run, "decision");

  const approvalId = decision.approvalIds.at(-1);
  if (!approvalId || approvalId !== plan.authorization.mrtr.approvalId) {
    throw new TypeError(
      "Resolved operation plan does not bind the last MRTR approval.",
    );
  }
  const approval = exactOne(
    project.approvals.filter((candidate) => candidate.id === approvalId),
    `MRTR approval ${approvalId}`,
  );
  if (
    approval.decisionId !== decision.id ||
    approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    !approval.inputFingerprint ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) ||
    !fingerprintsEqual(
      await sha256Fingerprint(approval),
      plan.authorization.mrtr.approvalFingerprint,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the last human-approved MRTR approval.",
    );
  }
  assertBasisMatchesPlanAndRun(approval.baseSnapshot, plan, run, "approval");
  assertExactEvidenceRefs(decision.inputEvidenceRefs, approval.inputEvidenceRefs);
  assertExactEvidenceRefs(
    decision.inputEvidenceRefs,
    workItemThreadEntityBindings(workItem),
  );
  return { decision, approval };
}

async function assertDecisionProposalFingerprint(
  decision: EngineeringDecision,
): Promise<void> {
  if (!decision.baseSnapshot || !decision.proposal || !decision.inputFingerprint) {
    throw new TypeError("Approved MRTR decision lacks an exact proposal binding.");
  }
  const fingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(fingerprint, decision.inputFingerprint)) {
    throw new TypeError("Approved MRTR decision proposal fingerprint does not match.");
  }
}

function assertBasisMatchesPlanAndRun(
  basis: EngineeringDecision["baseSnapshot"] | EngineeringApproval["baseSnapshot"],
  plan: ResolvedOperationPlanV2,
  run: EngineeringAgentRun,
  label: "decision" | "approval",
): void {
  if (
    !basis ||
    basis.snapshotId !== plan.basis.snapshotId ||
    basis.revision !== plan.basis.revision ||
    basis.subjectId !== plan.basis.subjectId ||
    run.basis?.kind !== "thread-snapshot" ||
    basis.snapshotId !== run.basis.snapshotId ||
    basis.revision !== run.basis.revision ||
    basis.subjectId !== run.basis.subjectId
  ) {
    throw new TypeError(
      `Resolved operation plan ${label} MRTR basis is not the exact run basis.`,
    );
  }
}

function assertExactEvidenceRefs(
  actual: readonly EngineeringThreadEntityRef[],
  expected: readonly EngineeringThreadEntityRef[],
): void {
  const actualKeys = evidenceKeys(actual);
  const expectedKeys = evidenceKeys(expected);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(
      "MRTR evidence references are not the exact reviewed bindings.",
    );
  }
}

function workItemThreadEntityBindings(
  workItem: EngineeringWorkItem,
): readonly EngineeringThreadEntityRef[] {
  if (!workItem.operation) {
    throw new TypeError("Resolved operation plan work item has no operation.");
  }
  return workItem.operation.bindings.flatMap((binding) =>
    binding.source.kind === "thread-entity" ? [binding.source.reference] : []
  );
}

async function assertQueuedRunInputFingerprint(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
  decision: EngineeringDecision,
): Promise<void> {
  if (!run.basis || run.basis.kind !== "thread-snapshot" || !run.inputFingerprint) {
    throw new TypeError(
      "Queued resolved operation plan run has no exact input fingerprint.",
    );
  }
  const operation = workItem.operation;
  if (!operation || !decision.inputFingerprint) {
    throw new TypeError("Queued resolved operation plan inputs are incomplete.");
  }
  const expected = await sha256Fingerprint({
    workItemId: workItem.id,
    basis: run.basis,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: operation.bindings,
    },
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(expected, run.inputFingerprint)) {
    throw new TypeError(
      "Queued resolved operation plan input fingerprint does not match.",
    );
  }
}

async function requireExactBasis(
  plan: ResolvedOperationPlanV2,
  run: EngineeringAgentRun,
  snapshots: ResolvedRunPlanExecutionSnapshotReader,
): Promise<ThreadSnapshot> {
  assertRunBasis(plan, run, "queued");
  const snapshotValue = await snapshots.get(plan.basis.snapshotId);
  if (!snapshotValue) {
    throw new TypeError("Resolved operation plan ThreadSnapshot basis is absent.");
  }
  const basis = validateThreadSnapshot(snapshotValue);
  if (
    basis.id !== plan.basis.snapshotId ||
    basis.revision !== plan.basis.revision ||
    basis.subject.id !== plan.basis.subjectId ||
    !fingerprintsEqual(await sha256Fingerprint(basis), plan.basis.fingerprint)
  ) {
    throw new TypeError(
      "Resolved operation plan ThreadSnapshot basis does not match its exact canonical hash.",
    );
  }
  return basis;
}

function requireExactSourceArtifacts(
  plan: ResolvedOperationPlanV2,
  basis: ThreadSnapshot,
): ReadonlyMap<string, ThreadArtifact> {
  const indexed = new Map<string, ThreadArtifact>();
  for (const source of plan.sources) {
    if (
      source.threadRef.snapshotId !== basis.id ||
      source.threadRef.snapshotRevision !== basis.revision ||
      source.threadRef.kind !== "artifact"
    ) {
      throw new TypeError(
        `Resolved plan source ${source.bindingName} does not belong to the exact basis.`,
      );
    }
    const artifact = exactOne(
      basis.artifacts.filter((candidate) => candidate.id === source.threadRef.id),
      `Thread artifact ${source.threadRef.id} for source ${source.bindingName}`,
    );
    if (
      !fingerprintsEqual(artifact.fingerprint, source.artifact.fingerprint) ||
      artifact.mediaType !== source.artifact.mediaType ||
      !sourceArtifactUriMatches(plan, source, artifact)
    ) {
      throw new TypeError(
        `Resolved plan source ${source.bindingName} does not match its exact Thread artifact.`,
      );
    }
    indexed.set(source.bindingName, artifact);
  }
  return indexed;
}

function sourceArtifactUriMatches(
  plan: ResolvedOperationPlanV2,
  source: ResolvedOperationPlanV2["sources"][number],
  artifact: ThreadArtifact,
): boolean {
  if (
    (plan.action.kind !== "static-structural-analysis" &&
      plan.action.kind !== "isolated-static-structural-analysis") ||
    source.bindingName !== plan.action.input.geometrySourceBinding
  ) {
    return artifact.uri === source.artifact.casUri;
  }
  try {
    return source.role === "geometry-source" &&
      source.artifact.casUri === canonicalCalculixStepAssetCasUri(artifact);
  } catch {
    return false;
  }
}

function evidenceKeys(
  references: readonly EngineeringThreadEntityRef[],
): readonly string[] {
  return references.map((reference) =>
    `${reference.snapshotId}\u0000${reference.snapshotRevision}\u0000${reference.kind}\u0000${reference.id}`
  ).sort(asciiCompare);
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactOne<T>(values: readonly T[], label: string): T {
  if (values.length !== 1) {
    throw new TypeError(`${label} must resolve exactly once.`);
  }
  return values[0]!;
}
