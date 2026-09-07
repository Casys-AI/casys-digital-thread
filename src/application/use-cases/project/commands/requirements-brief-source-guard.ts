/**
 * Command-boundary admission for traced requirements brief-source operations.
 *
 * This is intentionally narrower than generic decision governance.  It binds
 * Binds one `model.write-requirements@2` or retrospective documentary trace
 * proposal to the immutable plan/change that introduced its exact work item
 * and decision, then reopens the signed brief provenance before the command
 * boundary admits it.
 */

import type {
  EngineeringDecision,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
} from "../../../../domain/architecture/requirements/requirements-proposal.ts";
import {
  MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION,
  parseTracedRequirementsProposalParameters,
  type TracedRequirementsProposal,
} from "../../../../domain/architecture/requirements/requirements-traced-proposal.ts";
import {
  parseRequirementsBriefTraceParameters,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
} from "../../../../domain/record/requirements-brief-trace.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import { sameApprovedBriefBasis } from "./engineering-project-transition-values.ts";
import {
  reopenRequirementsBriefProvenance,
} from "../../architecture/requirements/reopen-requirements-brief-provenance.ts";
import type { RequirementsBriefProvenance } from "../../../../domain/architecture/requirements/requirements-brief-provenance.ts";
import type { EngineeringDecisionProposalInput } from "./engineering-project-commands.ts";

export type RequirementsBriefProvenanceReopenMode = "current" | "historical";

export interface TracedRequirementsProjectBoundaryInput {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  /** The exact project revision currently being transitioned or preclaimed. */
  readonly project: EngineeringProjectSnapshot;
  readonly workItemId: string;
  readonly decisionId: string;
  readonly proposal: Pick<EngineeringDecisionProposalInput, "parameters">;
  readonly mode: RequirementsBriefProvenanceReopenMode;
}

export interface RequirementsDecisionProposalBoundaryInput {
  readonly projects: EngineeringProjectRevisionStore;
  readonly project: EngineeringProjectSnapshot;
  readonly decisionId: string;
  readonly proposal: Pick<EngineeringDecisionProposalInput, "parameters">;
}

export interface RequirementsQueueBoundaryInput {
  readonly projects: EngineeringProjectRevisionStore;
  readonly project: EngineeringProjectSnapshot;
  readonly workItemId: string;
}

/**
 * Reopen the immutable approved brief selected by one signed brief-source proposal.
 *
 * Exported for the executor's pre-claim recheck.  A caller cannot substitute a
 * current brief: the proposal, the owning plan/change and the historical
 * approval receipt must all name the same complete basis.
 */
export async function assertTracedRequirementsProposalAtProjectBoundary(
  input: TracedRequirementsProjectBoundaryInput,
): Promise<RequirementsBriefProvenance> {
  const workItem = requireRequirementsBriefSourceWorkItem(
    input.project,
    input.workItemId,
  );
  if (
    isRequirementsBriefTraceOperation(workItem.operation) &&
    workItem.decisionIds.length !== 1
  ) {
    reject(
      "invalid_transition",
      `Requirements brief trace work item ${workItem.id} requires exactly one MRTR decision.`,
    );
  }
  if (!workItem.decisionIds.includes(input.decisionId)) {
    reject(
      "invalid_transition",
      `Requirements work item ${workItem.id} is not bound to decision ${input.decisionId}.`,
    );
  }

  const proposal = parseRequirementsBriefSourceProposal(
    workItem.operation!,
    input.proposal,
  );
  const ownerBasis = resolveOwningApprovedBriefBasis(
    input.project,
    workItem.id,
    input.decisionId,
  );
  if (!sameApprovedBriefBasis(ownerBasis, proposal.briefSource.basis)) {
    reject(
      "approval_scope_mismatch",
      "The signed traced requirements proposal does not match the exact approved brief basis that introduced its work item and decision.",
    );
  }

  let provenance: RequirementsBriefProvenance;
  try {
    provenance = await reopenRequirementsBriefProvenance({
      projects: input.projects,
      projectId: input.project.project.id,
      proposal,
      mode: input.mode,
    });
  } catch (error) {
    reject(
      "approval_scope_mismatch",
      `The signed requirements brief provenance is not reopenable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!sameApprovedBriefBasis(ownerBasis, provenance!.briefBasis)) {
    reject(
      "approval_scope_mismatch",
      "The reopened requirements brief provenance does not match the owning plan/change basis.",
    );
  }
  return provenance!;
}

/**
 * Apply the proposal boundary to direct command-service calls, not only the
 * MCP facade. Unrelated decisions are left to their own operation contracts.
 */
export async function assertRequirementsDecisionProposalAtCommandBoundary(
  input: RequirementsDecisionProposalBoundaryInput,
): Promise<RequirementsBriefProvenance | undefined> {
  const workItems = requirementsBriefSourceWorkItemsForDecision(
    input.project,
    input.decisionId,
  );
  if (workItems.length === 0) return undefined;
  rejectLegacyRequirementsWrites(workItems);
  if (workItems.length !== 1) {
    reject(
      "invalid_transition",
      `Decision ${input.decisionId} is ambiguously bound to ${workItems.length} requirements write work items.`,
    );
  }
  return await assertTracedRequirementsProposalAtProjectBoundary({
    ...input,
    workItemId: workItems[0]!.id,
    mode: "current",
  });
}

/** Reject a new queue or validate the one exact signed brief-source decision. */
export async function assertRequirementsWriteQueueAdmissible(
  input: RequirementsQueueBoundaryInput,
): Promise<RequirementsBriefProvenance | undefined> {
  const workItem = input.project.workItems.find((candidate) =>
    candidate.id === input.workItemId
  );
  if (!workItem) {
    reject(
      "entity_not_found",
      `Requirements work item ${input.workItemId} is not found.`,
    );
  }
  const operation = workItem!.operation;
  if (!isRequirementsBriefSourceOperation(operation)) return undefined;
  if (
    operation!.id === MODEL_WRITE_REQUIREMENTS_OPERATION.id &&
    operation.version === MODEL_WRITE_REQUIREMENTS_OPERATION.version
  ) {
    rejectLegacyRequirementsWrite(operation!);
  }
  if (
    !isTracedRequirementsWriteOperation(operation) &&
    !isRequirementsBriefTraceOperation(operation)
  ) return undefined;

  const candidates = workItem!.decisionIds.map((decisionId) =>
    input.project.decisions.find((decision) => decision.id === decisionId)
  ).filter((decision): decision is EngineeringDecision =>
    decision?.status === "approved" && decision.proposal !== undefined
  );
  if (candidates.length !== 1) {
    reject(
      "invalid_transition",
      `Requirements brief-source work item ${
        workItem!.id
      } requires exactly one approved decision with a proposal before queueing.`,
    );
  }
  const decision = candidates[0]!;
  return await assertTracedRequirementsProposalAtProjectBoundary({
    projects: input.projects,
    project: input.project,
    workItemId: workItem!.id,
    decisionId: decision.id,
    proposal: decision.proposal!,
    mode: "current",
  });
}

/** Explicit helper for command boundaries that prohibit a new @1 path. */
export function assertNoNewLegacyRequirementsWriteAtCommandBoundary(
  operation: EngineeringOperationRef | undefined,
): void {
  if (
    operation?.id === MODEL_WRITE_REQUIREMENTS_OPERATION.id &&
    operation.version === MODEL_WRITE_REQUIREMENTS_OPERATION.version
  ) {
    rejectLegacyRequirementsWrite(operation);
  }
}

function requireRequirementsBriefSourceWorkItem(
  project: EngineeringProjectSnapshot,
  workItemId: string,
): EngineeringWorkItem {
  const workItem = project.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem) {
    reject("entity_not_found", `Requirements work item ${workItemId} is not found.`);
  }
  if (
    !isTracedRequirementsWriteOperation(workItem!.operation) &&
    !isRequirementsBriefTraceOperation(workItem!.operation)
  ) {
    reject(
      "invalid_transition",
      `Work item ${
        workItem!.id
      } is not an exact traced requirements brief-source operation.`,
    );
  }
  return workItem!;
}

function requirementsBriefSourceWorkItemsForDecision(
  project: EngineeringProjectSnapshot,
  decisionId: string,
): readonly EngineeringWorkItem[] {
  return project.workItems.filter((item) =>
    item.decisionIds.includes(decisionId) &&
    isRequirementsBriefSourceOperation(item.operation)
  );
}

function isRequirementsBriefSourceOperation(
  operation: EngineeringOperationRef | undefined,
): operation is EngineeringOperationRef {
  return operation?.id === MODEL_WRITE_REQUIREMENTS_OPERATION.id &&
      (operation.version === MODEL_WRITE_REQUIREMENTS_OPERATION.version ||
        operation.version === MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION.version) ||
    isRequirementsBriefTraceOperation(operation);
}

function isTracedRequirementsWriteOperation(
  operation: EngineeringOperationRef | undefined,
): operation is EngineeringOperationRef {
  return operation?.id === MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION.id &&
    operation.version === MODEL_WRITE_TRACED_REQUIREMENTS_OPERATION.version;
}

function isRequirementsBriefTraceOperation(
  operation: EngineeringOperationRef | undefined,
): operation is EngineeringOperationRef {
  return operation?.id === RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id &&
    operation?.version === RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.version;
}

function rejectLegacyRequirementsWrites(
  workItems: readonly EngineeringWorkItem[],
): void {
  for (const workItem of workItems) {
    assertNoNewLegacyRequirementsWriteAtCommandBoundary(workItem.operation);
  }
}

function rejectLegacyRequirementsWrite(operation: EngineeringOperationRef): never {
  reject(
    "invalid_transition",
    `New ${operation.id}@${operation.version} proposals and queues are retired because they cannot seal brief-item provenance. Use model.write-requirements@2.`,
  );
}

function resolveOwningApprovedBriefBasis(
  project: EngineeringProjectSnapshot,
  workItemId: string,
  decisionId: string,
) {
  const allChanges = project.planChanges ?? [];
  const completeOwners = allChanges.filter((change) =>
    change.workItemIds.includes(workItemId) && change.decisionIds.includes(decisionId)
  );
  if (completeOwners.length === 1) {
    const basis = completeOwners[0]!.approvedBriefBasis;
    if (!basis) {
      reject(
        "approval_scope_mismatch",
        "The requirements work item's owning plan change has no exact approved brief basis.",
      );
    }
    return basis!;
  }
  if (completeOwners.length > 1) {
    reject(
      "approval_scope_mismatch",
      `Requirements work item ${workItemId} and decision ${decisionId} have multiple owning plan changes.`,
    );
  }

  const partialOwners = allChanges.filter((change) =>
    change.workItemIds.includes(workItemId) || change.decisionIds.includes(decisionId)
  );
  if (partialOwners.length > 0) {
    reject(
      "approval_scope_mismatch",
      "The requirements work item and decision are not jointly owned by one exact plan change.",
    );
  }
  const basis = project.plan?.basis;
  if (!basis || basis.kind !== "approved-brief") {
    reject(
      "approval_scope_mismatch",
      "The initial requirements plan has no exact approved brief basis.",
    );
  }
  return basis;
}

function parseRequirementsBriefSourceProposal(
  operation: EngineeringOperationRef,
  proposal: Pick<EngineeringDecisionProposalInput, "parameters">,
): TracedRequirementsProposal {
  try {
    if (isTracedRequirementsWriteOperation(operation)) {
      return parseTracedRequirementsProposalParameters(proposal.parameters);
    }
    if (isRequirementsBriefTraceOperation(operation)) {
      return parseRequirementsBriefTraceParameters(proposal.parameters).requirements;
    }
    throw new TypeError(
      "operation is not a traced requirements brief-source operation",
    );
  } catch (error) {
    reject(
      "invalid_input",
      `The traced requirements brief-source proposal is not the closed grammar: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function reject(
  code: ConstructorParameters<typeof EngineeringProjectCommandError>[0],
  message: string,
): never {
  throw new EngineeringProjectCommandError(code, message);
}
