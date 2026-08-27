import type {
  EngineeringApprovedBriefBasis,
  EngineeringBlocker,
  EngineeringDecision,
  EngineeringProjectPhase,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../engineering-project.ts";
import { ENGINEERING_PROJECT_SCHEMA_VERSION } from "../engineering-project.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import {
  isProjectBriefGateKind,
  projectBriefContractVersion,
} from "../project-brief.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue, issueWithRecovery } from "./engineering-project-validation-issue.ts";
import { uniqueStrings } from "./engineering-project-value-validation.ts";
import {
  requireUnique,
  sameApprovedBriefBasis,
  sameEvidenceSet,
  sameSnapshotRef,
  sameStringSet,
  uniqueEvidence,
} from "./engineering-project-invariant-values.ts";
import { snapshotKey } from "./engineering-project-reference-index.ts";
import { claimDecisionWorkItemScope } from "./decision-blocker-invariants.ts";

export function validatePhaseLocalInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  project.phases.forEach((phase, index) => {
    if (phase.order !== index + 1) {
      issue(
        issues,
        "invalid_phase_order",
        `$.phases[${index}].order`,
        `must equal ${index + 1}`,
      );
    }
    uniqueStrings(phase.workItemIds, `$.phases[${index}].workItemIds`, issues);
    uniqueStrings(
      phase.requiredDecisionIds,
      `$.phases[${index}].requiredDecisionIds`,
      issues,
    );
    uniqueEvidence(phase.evidenceRefs, `$.phases[${index}].evidenceRefs`, issues);
  });
}

export function validatePhaseMembership(
  project: EngineeringProjectSnapshot,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  issues: EngineeringProjectValidationIssue[],
): void {
  project.phases.forEach((phase, phaseIndex) => {
    phase.workItemIds.forEach((id, itemIndex) => {
      const item = workById.get(id);
      if (!item || item.phaseId !== phase.id) {
        issue(
          issues,
          "missing_reference",
          `$.phases[${phaseIndex}].workItemIds[${itemIndex}]`,
          "must reference a work item in this phase",
        );
      }
    });
    phase.requiredDecisionIds.forEach((id, decisionIndex) => {
      const decision = decisionById.get(id);
      if (!decision || decision.phaseId !== phase.id) {
        issue(
          issues,
          "missing_reference",
          `$.phases[${phaseIndex}].requiredDecisionIds[${decisionIndex}]`,
          "must reference a decision in this phase",
        );
      }
    });
    const actualItems = project.workItems.filter((item) => item.phaseId === phase.id)
      .map((item) => item.id);
    if (!sameStringSet(actualItems, phase.workItemIds)) {
      issue(
        issues,
        "incomplete_phase_membership",
        `$.phases[${phaseIndex}].workItemIds`,
        "must list every work item assigned to this phase exactly once",
      );
    }
  });
}

export function validateWorkItemGraphInvariants(
  project: EngineeringProjectSnapshot,
  phaseById: ReadonlyMap<string, EngineeringProjectPhase>,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  blockerById: ReadonlyMap<string, EngineeringBlocker>,
  annotationOnlyWorkItemIds: ReadonlySet<string>,
  workItemOwnerByDecisionId: Map<string, string>,
  issues: EngineeringProjectValidationIssue[],
): void {
  project.workItems.forEach((item, index) => {
    const path = `$.workItems[${index}]`;
    if (!phaseById.has(item.phaseId)) {
      issue(
        issues,
        "missing_reference",
        `${path}.phaseId`,
        "does not reference a phase",
      );
    }
    uniqueStrings(item.dependsOnWorkItemIds, `${path}.dependsOnWorkItemIds`, issues);
    uniqueStrings(item.decisionIds, `${path}.decisionIds`, issues);
    uniqueStrings(item.blockerIds, `${path}.blockerIds`, issues);
    uniqueEvidence(item.evidenceRefs, `${path}.evidenceRefs`, issues);
    item.dependsOnWorkItemIds.forEach((id, dependencyIndex) => {
      if (id === item.id || !workById.has(id)) {
        issue(
          issues,
          "missing_reference",
          `${path}.dependsOnWorkItemIds[${dependencyIndex}]`,
          "must reference a different work item",
        );
      }
    });
    item.decisionIds.forEach((id, decisionIndex) => {
      claimDecisionWorkItemScope(
        workItemOwnerByDecisionId,
        id,
        item.id,
        `${path}.decisionIds[${decisionIndex}]`,
        issues,
      );
      const decision = decisionById.get(id);
      if (!decision || decision.phaseId !== item.phaseId) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must reference a decision in the same phase",
        );
      }
    });
    item.operation?.bindings.forEach((binding, bindingIndex) => {
      const bindingPath = `${path}.operation.bindings[${bindingIndex}].source`;
      if (binding.source.kind === "decision-parameter") {
        const decision = decisionById.get(binding.source.decisionId);
        if (!decision || !item.decisionIds.includes(decision.id)) {
          issue(
            issues,
            "missing_reference",
            bindingPath,
            "must reference a decision bound to the same work item",
          );
        }
      }
    });
    item.blockerIds.forEach((id, blockerIndex) => {
      const blocker = blockerById.get(id);
      if (
        !blocker || blocker.phaseId !== item.phaseId ||
        !blocker.workItemIds.includes(item.id)
      ) {
        issue(
          issues,
          "missing_reference",
          `${path}.blockerIds[${blockerIndex}]`,
          "must reference a reciprocal blocker in the same phase",
        );
      }
    });
    if (
      item.status === "completed" && item.evidenceRefs.length === 0 &&
      !annotationOnlyWorkItemIds.has(item.id)
    ) {
      issue(
        issues,
        "missing_evidence",
        `${path}.evidenceRefs`,
        "a completed work item requires exact ThreadSnapshot evidence",
      );
    }
    if (
      item.status === "waiting-for-decision" &&
      !item.decisionIds.some((id) => {
        const decision = decisionById.get(id);
        return decision?.status === "required" || decision?.status === "proposed" ||
          decision?.status === "rejected";
      })
    ) {
      issue(
        issues,
        "missing_decision",
        `${path}.decisionIds`,
        "waiting-for-decision requires an unresolved linked decision",
      );
    }
    if (item.status === "ready") {
      const decisionsApproved = item.decisionIds.every((id) =>
        decisionById.get(id)?.status === "approved"
      );
      const blockersResolved = item.blockerIds.every((id) =>
        blockerById.get(id)?.status === "resolved"
      );
      // Mirror of nextIdleWorkStatus and deriveEngineeringPhaseStatus:
      // a cancelled dep with a reconciliation record carries equivalent evidence
      // from an independently completed successor, so it satisfies the dependency.
      const dependenciesCompleted = item.dependsOnWorkItemIds.every((id) => {
        const dep = workById.get(id);
        return dep?.status === "completed" ||
          (dep?.status === "cancelled" && dep.reconciliation !== undefined);
      });
      if (!decisionsApproved || !blockersResolved || !dependenciesCompleted) {
        issue(
          issues,
          "work_item_not_ready",
          `${path}.status`,
          "ready requires every decision approved, blocker resolved and dependency completed",
        );
      }
    }
  });
}

/**
 * A claim is coverage of a reviewed mandate, not an operation input. It can
 * only target an explicit V2 gate in the current human-approved canonical
 * brief; V1 remains readable but lacks the dependency contract needed for a
 * new claim.
 */
export function validateGateClaimsAgainstCanonicalBrief(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const brief = project.framing?.currentBrief;
  const approval = project.framing?.currentBriefApproval;
  const hasCanonicalBrief = brief !== undefined &&
    approval?.status === "approved";
  const gateItems = hasCanonicalBrief && brief
    ? new Map(brief.items.map((item) => [item.id, item]))
    : undefined;
  const isV2Contract = brief !== undefined &&
    projectBriefContractVersion(brief) === "2.0";

  project.workItems.forEach((workItem, workItemIndex) => {
    if (workItem.gateClaims === undefined) return;
    const seenGateItemIds = new Set<string>();
    workItem.gateClaims.forEach((claim, claimIndex) => {
      const path = `$.workItems[${workItemIndex}].gateClaims[${claimIndex}]`;
      if (seenGateItemIds.has(claim.gateItemId)) {
        issueWithRecovery(
          issues,
          "duplicate_gate_claim",
          `${path}.gateItemId`,
          "a work item may claim each gate only once",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Keep one claim per gate and set its single reviewed role and link status.",
        );
      }
      seenGateItemIds.add(claim.gateItemId);
      if (!hasCanonicalBrief) {
        issueWithRecovery(
          issues,
          "missing_canonical_brief_for_gate_claim",
          `${path}.gateItemId`,
          "a gate claim requires one current human-approved canonical brief",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Approve the exact brief before recording work-item gate claims.",
        );
        return;
      }
      if (!isV2Contract) {
        issueWithRecovery(
          issues,
          "gate_claim_contract_incomplete",
          `${path}.gateItemId`,
          "a gate claim requires a V2 canonical brief with explicit dependencies",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Revise and approve the brief as V2 with explicit dependsOnItemIds before declaring claims.",
        );
        return;
      }
      const gate = gateItems?.get(claim.gateItemId);
      if (!gate) {
        issueWithRecovery(
          issues,
          "unknown_gate_claim",
          `${path}.gateItemId`,
          "must reference a gate item in the current canonical brief",
          { workItemId: workItem.id, gateItemId: claim.gateItemId },
          "Use the stable ID of a success-criterion or verification-activity in the current canonical brief.",
        );
      } else if (!isProjectBriefGateKind(gate.kind)) {
        issueWithRecovery(
          issues,
          "gate_claim_target_not_gate",
          `${path}.gateItemId`,
          "must reference a success-criterion or verification-activity",
          {
            workItemId: workItem.id,
            gateItemId: claim.gateItemId,
            itemKind: gate.kind,
          },
          "Target a success-criterion or verification-activity, not a general brief item.",
        );
      }
    });
  });
}

export function validateWorkItemReconciliationInvariant(
  item: EngineeringWorkItem,
  index: number,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.workItems[${index}]`;
  const reconciliation = item.reconciliation;
  if (!reconciliation) return;
  if (item.status !== "cancelled") {
    issue(
      issues,
      "invalid_transition",
      `${path}.status`,
      "a successor reconciliation is valid only for cancelled work",
    );
    return;
  }
  if (item.evidenceRefs.length !== 0) {
    issue(
      issues,
      "invalid_transition",
      `${path}.evidenceRefs`,
      "reconciled failed work must not claim successor evidence as its own",
    );
  }
  if (reconciliation.failedRunId === reconciliation.successorRunId) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation`,
      "a failed run cannot reconcile itself as its successor",
    );
  }
  const failed = project.agentRuns.find((run) => run.id === reconciliation.failedRunId);
  // Mirror the command-service guard: a pre-claim cancelled run (no claimedAt,
  // no startedAt — never touched a provider) is valid alongside a failed run.
  const isEvidenceFreeFailure = !!failed && failed.status === "failed" &&
    !!failed.failure &&
    failed.evidenceRefs.length === 0;
  const isPreClaimCancellation = !!failed && failed.status === "cancelled" &&
    !failed.claimedAt &&
    !failed.startedAt && failed.evidenceRefs.length === 0;
  if (
    !failed || failed.workItemId !== item.id ||
    (!isEvidenceFreeFailure && !isPreClaimCancellation)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.failedRunId`,
      "must identify this work item's evidence-free failed or pre-claim cancelled run",
    );
  }
  const successor = project.agentRuns.find((run) =>
    run.id === reconciliation.successorRunId
  );
  const successorWork = successor
    ? project.workItems.find((work) => work.id === successor.workItemId)
    : undefined;
  if (
    successorWork && successorWork.activityId !== item.activityId
  ) {
    issue(
      issues,
      "cross_activity_predecessor",
      `${path}.reconciliation.successorRunId`,
      "reconciliation can close only work in the same stable activity",
    );
  }
  if (
    !successor || successor.workItemId === item.id ||
    successor.status !== "completed" || !successor.resultSnapshot ||
    successor.evidenceRefs.length === 0 || successorWork?.status !== "completed"
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunId`,
      "must identify an independently completed successor run with evidence",
    );
    return;
  }
  if (
    !sameSnapshotRef(successor.resultSnapshot, reconciliation.successorRunSnapshot)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunSnapshot`,
      "must exactly match the completed successor result snapshot",
    );
  }
  // For a direct reconciliation the successor run result is already the project
  // thread head and no separate closeout snapshot is produced. When present,
  // the full closeout path is validated as before.
  if (reconciliation.successorSnapshot !== undefined) {
    if (
      reconciliation.successorSnapshot.subjectId !== project.project.subjectId ||
      reconciliation.successorSnapshot.revision !==
        reconciliation.successorRunSnapshot.revision + 1 ||
      // The closeout snapshot must belong to the project's recorded lineage. It
      // was the newest snapshot when the closeout happened, but this validation
      // replays on every later revision — requiring it to still be the *last*
      // snapshot would freeze the whole project the moment any post-closeout
      // run publishes. The direct-successor position is already pinned by the
      // revision equality above; lineage membership is the durable property.
      !project.threadSnapshots.some((snapshot) =>
        sameSnapshotRef(snapshot, reconciliation.successorSnapshot!)
      )
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorSnapshot`,
        "must be the direct closeout snapshot after the successor result, " +
          "recorded in the project lineage",
      );
    }
  }
  if (
    !sameEvidenceSet(successor.evidenceRefs, reconciliation.successorEvidenceRefs)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorEvidenceRefs`,
      "must exactly match the completed successor evidence",
    );
  }
  if (
    successorWork &&
    !sameEvidenceSet(successorWork.evidenceRefs, successor.evidenceRefs)
  ) {
    issue(
      issues,
      "invalid_transition",
      `${path}.reconciliation.successorRunId`,
      "must retain the same exact evidence on its completed work item",
    );
  }
  // Mirror the command-service equivalence guard, and ONLY for the direct form.
  //
  // WHY THE DIRECT FORM ONLY — the direct path must remain self-contained on
  // replay. A full closeout may deliberately carry another operation, but the
  // command service now requires a code-owned injected operation-transition
  // policy before persisting it, in addition to the exact snapshot validator.
  // This structural replay validator cannot rerun that caller-owned proof; it
  // still verifies the immutable successor snapshot, evidence and lineage below.
  if (
    reconciliation.successorSnapshot === undefined &&
    item.operation !== undefined && successorWork !== undefined
  ) {
    if (
      successorWork.operation?.id !== item.operation.id ||
      successorWork.operation?.version !== item.operation.version ||
      deterministicJson(successorWork.operation?.bindings ?? []) !==
        deterministicJson(item.operation.bindings)
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorRunId`,
        "successor work item must carry the identical registered operation (id, version, bindings)",
      );
    }
  }
  // Mirror the command-service lineage guard: the successor run must have been
  // executed against a snapshot declared in this project's thread lineage.
  {
    const lineageIds = new Set(project.threadSnapshots.map((s) => s.snapshotId));
    const successorBaseId = successor.baseSnapshot?.snapshotId ??
      (successor.basis?.kind === "thread-snapshot"
        ? successor.basis.snapshotId
        : successor.basis?.kind === "approved-brief"
        ? successor.basis.projectSnapshotId
        : undefined);
    if (!successorBaseId || !lineageIds.has(successorBaseId)) {
      issue(
        issues,
        "invalid_transition",
        `${path}.reconciliation.successorRunId`,
        "successor run base snapshot must descend from this project's declared thread lineage",
      );
    }
  }
  if (Date.parse(reconciliation.reconciledAt) < Date.parse(successor.completedAt!)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.reconciliation.reconciledAt`,
      "cannot precede the completed successor run",
    );
  }
}

export function validatePlanInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const plan = project.plan;
  const path = "$.plan";
  if (!plan) return;
  if (project.schemaVersion === ENGINEERING_PROJECT_SCHEMA_VERSION) {
    if (plan.basis.kind !== "approved-brief") {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.basis`,
        "must name one exact human-approved project brief revision",
      );
    } else {
      validateApprovedBriefBasisAuthorization(
        project,
        plan.basis,
        `${path}.basis`,
        plan.publishedAt,
        issues,
      );
    }
  }
  if (plan.publishedBy.origin !== "agent") {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.publishedBy.origin`,
      "only an agent may publish a project path",
    );
  }
  if (Date.parse(plan.publishedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.publishedAt`,
      "cannot be later than the project snapshot generation time",
    );
  }
  if (project.phases.length === 0 || project.workItems.length === 0) {
    issue(
      issues,
      "missing_plan_content",
      path,
      "must declare at least one phase and one work item",
    );
  }
  project.workItems.forEach((item, index) => {
    if (!item.operation) {
      issue(
        issues,
        "missing_operation",
        `$.workItems[${index}].operation`,
        "agent-published work must reference a registered operation",
      );
    }
  });
  const matchingReceipt = project.commandReceipts?.some((receipt) =>
    receipt.type === "project.plan-publish" &&
    receipt.actor.id === plan.publishedBy.id &&
    receipt.actor.origin === plan.publishedBy.origin &&
    Date.parse(receipt.appliedAt) === Date.parse(plan.publishedAt)
  );
  if (!matchingReceipt) {
    issue(
      issues,
      "missing_plan_receipt",
      path,
      "must be anchored by an agent project.plan-publish receipt",
    );
  }
}

export function validatePlanChangeInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const changes = project.planChanges ?? [];
  if (changes.length === 0) return;
  if (!project.plan) {
    issue(
      issues,
      "missing_reference",
      "$.planChanges",
      "an appended project change requires an initial project plan",
    );
  }
  requireUnique(changes, (change) => change.id, "$.planChanges", issues);
  requireUnique(changes, (change) => change.commandId, "$.planChanges", issues);
  const phaseIds = new Set<string>();
  const workItemIds = new Set<string>();
  const decisionIds = new Set<string>();
  const phaseCreatedAt = new Map<string, number>();
  changes.forEach((change, index) => {
    for (const phaseId of change.phaseIds) {
      if (!phaseCreatedAt.has(phaseId)) phaseCreatedAt.set(phaseId, index);
    }
  });
  const initialPhaseIds = new Set(
    project.phases
      .map((phase) => phase.id)
      .filter((phaseId) => !phaseCreatedAt.has(phaseId)),
  );
  const phaseExistsBefore = (phaseId: string, changeIndex: number): boolean =>
    initialPhaseIds.has(phaseId) ||
    ((phaseCreatedAt.get(phaseId) ?? Number.POSITIVE_INFINITY) < changeIndex);
  const phaseById = new Map(project.phases.map((phase) => [phase.id, phase]));
  const workById = new Map(project.workItems.map((item) => [item.id, item]));
  const decisionById = new Map(
    project.decisions.map((decision) => [decision.id, decision]),
  );
  const snapshots = new Set(
    project.threadSnapshots.map((snapshot) =>
      snapshotKey(snapshot.snapshotId, snapshot.revision)
    ),
  );
  changes.forEach((change, index) => {
    const path = `$.planChanges[${index}]`;
    if (project.schemaVersion === ENGINEERING_PROJECT_SCHEMA_VERSION) {
      if (!change.approvedBriefBasis) {
        issue(
          issues,
          "approval_scope_mismatch",
          `${path}.approvedBriefBasis`,
          "a V3 project change must retain the exact human-approved brief revision that authorized it",
        );
      } else {
        validateApprovedBriefBasisAuthorization(
          project,
          change.approvedBriefBasis,
          `${path}.approvedBriefBasis`,
          change.publishedAt,
          issues,
        );
      }
    }
    if (change.publishedBy.origin !== "agent") {
      issue(
        issues,
        "command_authority_mismatch",
        `${path}.publishedBy.origin`,
        "only an agent may append a project change",
      );
    }
    if (Date.parse(change.publishedAt) > Date.parse(project.generatedAt)) {
      issue(
        issues,
        "invalid_chronology",
        `${path}.publishedAt`,
        "cannot be later than the project snapshot generation time",
      );
    }
    if (
      !snapshots.has(
        snapshotKey(change.baseSnapshot.snapshotId, change.baseSnapshot.revision),
      ) || change.baseSnapshot.subjectId !== project.project.subjectId
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        `${path}.baseSnapshot`,
        "must name one exact ThreadSnapshot declared by this project",
      );
    }
    if (change.workItemIds.length === 0) {
      issue(
        issues,
        "missing_plan_content",
        path,
        "must append at least one work item",
      );
    }
    uniqueStrings(change.phaseIds, `${path}.phaseIds`, issues);
    uniqueStrings(change.workItemIds, `${path}.workItemIds`, issues);
    uniqueStrings(change.decisionIds, `${path}.decisionIds`, issues);
    change.phaseIds.forEach((phaseId, phaseIndex) => {
      if (phaseIds.has(phaseId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.phaseIds[${phaseIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      phaseIds.add(phaseId);
      if (!phaseById.has(phaseId)) {
        issue(
          issues,
          "missing_reference",
          `${path}.phaseIds[${phaseIndex}]`,
          "must reference a declared project phase",
        );
      }
    });
    change.workItemIds.forEach((workItemId, workItemIndex) => {
      if (workItemIds.has(workItemId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.workItemIds[${workItemIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      workItemIds.add(workItemId);
      const workItem = workById.get(workItemId);
      if (!workItem) {
        issue(
          issues,
          "missing_reference",
          `${path}.workItemIds[${workItemIndex}]`,
          "must reference a declared project work item",
        );
      } else if (
        !change.phaseIds.includes(workItem.phaseId) &&
        !phaseExistsBefore(workItem.phaseId, index)
      ) {
        issue(
          issues,
          "missing_reference",
          `${path}.workItemIds[${workItemIndex}]`,
          "must belong to an existing phase or a phase created by this change",
        );
      }
    });
    change.phaseIds.forEach((phaseId, phaseIndex) => {
      const hasWork = change.workItemIds.some((workItemId) =>
        workById.get(workItemId)?.phaseId === phaseId
      );
      if (!hasWork) {
        issue(
          issues,
          "missing_plan_content",
          `${path}.phaseIds[${phaseIndex}]`,
          "a newly declared phase must contain at least one work item from this change",
        );
      }
    });
    change.decisionIds.forEach((decisionId, decisionIndex) => {
      if (decisionIds.has(decisionId)) {
        issue(
          issues,
          "duplicate_id",
          `${path}.decisionIds[${decisionIndex}]`,
          "must be owned by exactly one appended project change",
        );
      }
      decisionIds.add(decisionId);
      const decision = decisionById.get(decisionId);
      if (!decision) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must reference a declared project decision",
        );
      } else if (
        !change.phaseIds.includes(decision.phaseId) &&
        !phaseExistsBefore(decision.phaseId, index)
      ) {
        issue(
          issues,
          "missing_reference",
          `${path}.decisionIds[${decisionIndex}]`,
          "must belong to an existing phase or a phase created by this change",
        );
      }
    });
    const receipt = project.commandReceipts?.find((candidate) =>
      candidate.type === "project.change-append" &&
      candidate.commandId === change.commandId &&
      candidate.actor.id === change.publishedBy.id &&
      candidate.actor.origin === change.publishedBy.origin &&
      Date.parse(candidate.appliedAt) === Date.parse(change.publishedAt) &&
      change.id === `change:${candidate.commandId}`
    );
    if (!receipt) {
      issue(
        issues,
        "missing_plan_receipt",
        path,
        "must be anchored by an agent project.change-append receipt",
      );
    }
  });
}

function validateApprovedBriefBasisAuthorization(
  project: EngineeringProjectSnapshot,
  basis: EngineeringApprovedBriefBasis,
  path: string,
  authorizedAt: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (basis.projectId !== project.project.id) {
    issue(
      issues,
      "approval_scope_mismatch",
      `${path}.projectId`,
      "must match this engineering project",
    );
  }
  const receipt = (project.commandReceipts ?? []).find((item) =>
    item.type === "project.brief-approve" &&
    item.actor.origin === "human" &&
    item.resultingSnapshot.snapshotId === basis.projectSnapshotId &&
    item.resultingSnapshot.revision === basis.projectRevision
  );
  if (!receipt) {
    issue(
      issues,
      "approval_scope_mismatch",
      path,
      "must resolve to an exact historical human project.brief-approve receipt",
    );
    return;
  }
  if (
    !receipt.approvedBriefBasis ||
    !sameApprovedBriefBasis(receipt.approvedBriefBasis, basis)
  ) {
    issue(
      issues,
      "approval_scope_mismatch",
      path,
      "must exactly match the approved brief basis retained by its human approval receipt",
    );
    return;
  }
  if (Date.parse(receipt.appliedAt) > Date.parse(authorizedAt)) {
    issue(
      issues,
      "invalid_chronology",
      path,
      "cannot authorize work published before the historical brief approval",
    );
  }
}

export function detectWorkCycles(
  workItems: readonly EngineeringWorkItem[],
  issues: EngineeringProjectValidationIssue[],
): void {
  const byId = new Map(workItems.map((item) => [item.id, item]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle =
      byId.get(id)?.dependsOnWorkItemIds.some((dependency) =>
        byId.has(dependency) && visit(dependency)
      ) ?? false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  workItems.forEach((item, index) => {
    if (visit(item.id)) {
      issue(
        issues,
        "dependency_cycle",
        `$.workItems[${index}].dependsOnWorkItemIds`,
        "participates in a dependency cycle",
      );
    }
  });
}
