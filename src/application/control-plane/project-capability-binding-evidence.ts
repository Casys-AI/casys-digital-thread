/**
 * Provider-neutral published-method evidence for a capability binding
 * replacement. It never parses UI labels, Thread document names, or a
 * hardcoded provider operation identity. Today's registry is only a skip
 * when the exact operation is still registered and demonstrably does not
 * demand the replacement. An unregistered historical operation is recrossed
 * against its sealed ROP so published evidence cannot disappear after a
 * breaking registry change.
 */

import {
  engineeringCapabilityRequirementKey,
} from "../../domain/capability/engineering-capability.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import type { ResolvedOperationPlanV2 } from "../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { ResolvedRunPlanReader } from "../../domain/project/resolved-run-plan-sealer.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import type {
  EngineeringOperationRegistry,
  RegisteredEngineeringOperation,
} from "../../orchestration/operations/operation-contract.ts";
import type { ProjectCapabilityBindingReplacement } from "../../domain/capability/project-capability-authorization.ts";
import type { PlannedProjectCapabilityBinding } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { ResolvedCapabilityRuntimeBinding } from "../../domain/capability/runtime/capability-runtime-supervision.ts";

export type ProjectCapabilityBindingEvidenceDecision =
  | "none"
  | "published"
  | "unresolved";

export async function evaluateProjectCapabilityBindingEvidence(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly registry: Pick<EngineeringOperationRegistry, "list">;
  readonly recordedPlans: ResolvedRunPlanReader;
  readonly replacements: readonly ProjectCapabilityBindingReplacement[];
}): Promise<ReadonlyMap<string, ProjectCapabilityBindingEvidenceDecision>> {
  const operations = new Map(
    input.registry.list().map((operation) => [
      operationKey(operation),
      operation,
    ]),
  );
  const decisions = new Map<string, ProjectCapabilityBindingEvidenceDecision>();
  for (const replacement of input.replacements) {
    decisions.set(
      replacement.requirementKey,
      await evidenceForReplacement({
        project: input.project,
        operations,
        recordedPlans: input.recordedPlans,
        replacement,
      }),
    );
  }
  return decisions;
}

async function evidenceForReplacement(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly operations: ReadonlyMap<string, RegisteredEngineeringOperation>;
  readonly recordedPlans: ResolvedRunPlanReader;
  readonly replacement: ProjectCapabilityBindingReplacement;
}): Promise<ProjectCapabilityBindingEvidenceDecision> {
  if (input.replacement.previous === null) return "none";
  let published = false;
  for (const run of input.project.agentRuns) {
    const verdict = await inspectEvidenceProducingRun({
      project: input.project,
      operations: input.operations,
      recordedPlans: input.recordedPlans,
      replacement: input.replacement,
      previous: input.replacement.previous,
      run,
    });
    if (verdict === "unresolved") return "unresolved";
    if (verdict === "published") published = true;
  }
  return published ? "published" : "none";
}

async function inspectEvidenceProducingRun(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly operations: ReadonlyMap<string, RegisteredEngineeringOperation>;
  readonly recordedPlans: ResolvedRunPlanReader;
  readonly replacement: ProjectCapabilityBindingReplacement;
  readonly previous: PlannedProjectCapabilityBinding;
  readonly run: EngineeringAgentRun;
}): Promise<ProjectCapabilityBindingEvidenceDecision | "skip"> {
  if (input.run.status !== "completed" || input.run.annotationOnly === true) {
    return "skip";
  }
  if (
    input.run.resultSnapshot === undefined ||
    matchingThreadSnapshots(input.project.threadSnapshots, input.run.resultSnapshot)
        .length !== 1 ||
    input.run.evidenceRefs.length === 0
  ) {
    return "skip";
  }
  const workItem = input.project.workItems.find((item) =>
    item.id === input.run.workItemId
  );
  if (workItem?.operation === undefined) return "skip";
  const registered = input.operations.get(operationKey(workItem.operation));
  if (
    registered !== undefined &&
    !registeredDemandIncludes(registered, input.replacement.requirementKey)
  ) {
    return "skip";
  }
  if (input.run.resolvedOperationPlan === undefined) return "unresolved";
  let plan: ResolvedOperationPlanV2;
  try {
    plan = await input.recordedPlans.read(input.run.resolvedOperationPlan);
  } catch {
    return "unresolved";
  }
  if (!recrossResolvedPlan(plan, input.project, input.run, workItem)) {
    return "unresolved";
  }
  const matches = plan.operationalCapability.bindings.filter((binding) =>
    engineeringCapabilityRequirementKey(binding.capability) ===
      input.replacement.requirementKey
  );
  if (matches.length === 0) {
    return registered === undefined ? "skip" : "unresolved";
  }
  if (matches.length !== 1) return "unresolved";
  return previousMethodMatches(matches[0]!, input.previous) ? "published" : "skip";
}

function registeredDemandIncludes(
  registered: RegisteredEngineeringOperation,
  requirementKey: string,
): boolean {
  return registered.runtimeDemand.kind === "required" &&
    registered.runtimeDemand.capabilities.some((capability) =>
      engineeringCapabilityRequirementKey(capability) === requirementKey
    );
}

function recrossResolvedPlan(
  plan: ResolvedOperationPlanV2,
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
): boolean {
  const operation = workItem.operation;
  if (operation === undefined || run.inputFingerprint === undefined) return false;
  return plan.run.projectId === project.project.id &&
    plan.run.runId === run.id &&
    plan.run.workItemId === run.workItemId &&
    plan.run.workItemId === workItem.id &&
    fingerprintsEqual(plan.run.inputFingerprint, run.inputFingerprint) &&
    plan.workItem.id === workItem.id &&
    plan.workItem.operation.id === operation.id &&
    plan.workItem.operation.version === operation.version &&
    plan.operationalCapability.projectId === project.project.id &&
    plan.operationalCapability.operation.id === operation.id &&
    plan.operationalCapability.operation.version === operation.version;
}

function previousMethodMatches(
  binding: ResolvedCapabilityRuntimeBinding,
  previous: PlannedProjectCapabilityBinding,
): boolean {
  const candidate = previous.candidate;
  if (candidate === undefined) return false;
  return binding.capability.id === previous.requirement.id &&
    binding.capability.version === previous.requirement.version &&
    binding.capability.use === previous.requirement.use &&
    binding.binding.id === candidate.id &&
    binding.binding.version === candidate.version &&
    binding.adapter.id === candidate.adapter.id &&
    binding.adapter.version === candidate.adapter.version &&
    deterministicJson(binding.profile) === deterministicJson(candidate.profile);
}

function matchingThreadSnapshots(
  snapshots: readonly EngineeringThreadSnapshotRef[],
  result: EngineeringThreadSnapshotRef,
): readonly EngineeringThreadSnapshotRef[] {
  return snapshots.filter((snapshot) =>
    snapshot.snapshotId === result.snapshotId &&
    snapshot.revision === result.revision &&
    snapshot.subjectId === result.subjectId
  );
}

function operationKey(operation: { readonly id: string; readonly version: string }) {
  return `${operation.id}\u0000${operation.version}`;
}
