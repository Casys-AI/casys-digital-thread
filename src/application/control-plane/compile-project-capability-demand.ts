import {
  PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
  type ProjectCapabilityDemand,
  type ProjectCapabilityDemandSlice,
  type ProjectCapabilityOperationGroup,
  type ProjectCapabilityWorkItemHistory,
} from "../../domain/capability/project-capability-demand.ts";
import {
  flattenEngineeringCapabilityRequirements,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  deepFreeze,
  exactVersionToken,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectPlan,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
  EngineeringWorkItemStatus,
} from "../../domain/project/engineering-project.ts";
import { leafRevisionIdsForActivity } from "../../domain/project/engineering-activity.ts";
import {
  type ResolvedRuntimePreparationPrerequisiteRegistry,
  resolveRuntimePreparationPrerequisiteRegistry,
  runtimePreparationPrerequisiteRegistryFingerprintPayload,
  type RuntimePreparationPrerequisiteRegistryView,
} from "../../orchestration/operations/runtime-preparation-prerequisite-closure.ts";

interface CanonicalOperationGroup {
  readonly operation: { readonly id: string; readonly version: string };
  readonly workItemIds: string[];
}

/** Complete trusted registry projection. It is never caller request data. */
export interface EngineeringOperationRuntimeDemandRegistryView
  extends RuntimePreparationPrerequisiteRegistryView {}

/**
 * Server-composition seam for compiling an exact planned operation path into
 * provider-neutral capability demand. `registry` is a code-owned trusted
 * dependency, never request or agent input. Runtime demand is declared on
 * the exact registered operation; there is no second capability catalogue.
 *
 * This function only reads project and registry values; it cannot acquire,
 * activate, bind or otherwise mutate a runtime.
 */
export async function compileProjectCapabilityDemand(
  project: EngineeringProjectSnapshot,
  registry: EngineeringOperationRuntimeDemandRegistryView,
): Promise<ProjectCapabilityDemand> {
  const approvedBriefBasis = requireApprovedPlanBasis(project);
  const plan = copyPlan(project.plan!);
  const registryClosure = resolveRuntimePreparationPrerequisiteRegistry(registry);
  const projectSnapshot = {
    projectId: project.project.id,
    snapshotId: project.id,
    revision: project.revision,
  };
  const registryFingerprint = await sha256Fingerprint(
    runtimePreparationPrerequisiteRegistryFingerprintPayload(
      registryClosure.entries(),
    ),
  );
  const workItemHistory = collectWorkItemHistory(
    project.workItems,
    registryClosure,
  );
  const plannedCeiling = compileSlice(
    currentLeafWorkItems(project.workItems, false),
    registryClosure,
  );
  const jitDemand = compileSlice(
    currentLeafWorkItems(project.workItems, true),
    registryClosure,
  );
  const historyPathFingerprint = await sha256Fingerprint({
    projectSnapshot,
    approvedBriefBasis,
    plan,
    registryFingerprint,
    workItemHistory,
  });
  const plannedCeilingFingerprint = await sha256Fingerprint({
    plannedCeiling,
  });
  const jitDemandFingerprint = await sha256Fingerprint({
    jitDemand,
  });

  return deepFreeze({
    schemaVersion: PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
    mutatesRuntime: false,
    status: plannedCeiling.status,
    projectSnapshot,
    approvedBriefBasis: structuredClone(approvedBriefBasis),
    plan,
    workItemHistory,
    plannedCeiling,
    jitDemand,
    historyPathFingerprint,
    plannedCeilingFingerprint,
    jitDemandFingerprint,
    registryFingerprint,
  });
}

function requireApprovedPlanBasis(
  project: EngineeringProjectSnapshot,
): EngineeringApprovedBriefBasis {
  if (!project.plan) {
    throw new TypeError(
      "Project capability demand requires a project.plan-publish snapshot.",
    );
  }
  if (project.plan.basis.projectId !== project.project.id) {
    throw new TypeError(
      "Project capability demand requires a plan basis for the same project.",
    );
  }
  return project.plan.basis;
}

function copyPlan(plan: EngineeringProjectPlan): EngineeringProjectPlan {
  return structuredClone(plan);
}

function collectWorkItemHistory(
  workItems: readonly EngineeringWorkItem[],
  registryClosure: ResolvedRuntimePreparationPrerequisiteRegistry,
): readonly ProjectCapabilityWorkItemHistory[] {
  const workItemIds = new Set<string>();
  for (const workItem of workItems) {
    if (workItemIds.has(workItem.id)) {
      throw new TypeError(`Project work item id ${workItem.id} is duplicated.`);
    }
    workItemIds.add(workItem.id);
    safeId(workItem.id, `$project.workItems[${workItem.id}].id`);
  }
  assertActivityGraphs(workItems);
  return workItems.map((workItem) => {
    const status = canonicalWorkItemStatus(
      workItem.status,
      `$project.workItems[${workItem.id}].status`,
    );
    const operation = workItem.operation
      ? canonicalOperation(
        workItem.operation,
        `$project.workItems[${workItem.id}].operation`,
      )
      : null;
    const registered = operation && registryClosure.has(operation);
    return {
      id: safeId(workItem.id, `$project.workItems[${workItem.id}].id`),
      activityId: safeId(
        workItem.activityId,
        `$project.workItems[${workItem.id}].activityId`,
      ),
      ...(workItem.predecessorRevisionId === undefined ? {} : {
        predecessorRevisionId: safeId(
          workItem.predecessorRevisionId,
          `$project.workItems[${workItem.id}].predecessorRevisionId`,
        ),
      }),
      status,
      operation,
      resolution: registered ? "resolved" as const : "unresolved" as const,
      ...(operation
        ? (registered ? {} : { reason: "operation-unregistered" as const })
        : {
          reason: "operation-missing" as const,
        }),
    };
  }).toSorted((left, right) => compareText(left.id, right.id));
}

function currentLeafWorkItems(
  workItems: readonly EngineeringWorkItem[],
  jitOnly: boolean,
): readonly EngineeringWorkItem[] {
  const byActivity = new Map<string, EngineeringWorkItem[]>();
  for (const workItem of workItems) {
    const members = byActivity.get(workItem.activityId) ?? [];
    members.push(workItem);
    byActivity.set(workItem.activityId, members);
  }
  const leaves: EngineeringWorkItem[] = [];
  for (const [activityId, members] of byActivity.entries()) {
    const byId = new Map(members.map((member) => [member.id, member]));
    for (const leafId of leafRevisionIdsForActivity(members)) {
      const leaf = byId.get(leafId);
      if (!leaf) {
        throw new TypeError(`Activity ${activityId} has an unknown leaf ${leafId}.`);
      }
      if (leaf.status === "cancelled" || leaf.status === "abandoned") continue;
      if (jitOnly && leaf.status !== "ready" && leaf.status !== "in-progress") continue;
      if (!leaf.operation) {
        throw new TypeError(`Current activity leaf ${leaf.id} has no operation.`);
      }
      leaves.push(leaf);
    }
  }
  return leaves.toSorted((left, right) => compareText(left.id, right.id));
}

function assertActivityGraphs(workItems: readonly EngineeringWorkItem[]): void {
  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const byActivity = new Map<string, EngineeringWorkItem[]>();
  for (const workItem of workItems) {
    safeId(workItem.activityId, `$project.workItems[${workItem.id}].activityId`);
    const members = byActivity.get(workItem.activityId) ?? [];
    members.push(workItem);
    byActivity.set(workItem.activityId, members);
  }
  for (const [activityId, members] of byActivity) {
    for (const member of members) {
      if (member.predecessorRevisionId === undefined) continue;
      const predecessor = byId.get(member.predecessorRevisionId);
      if (!predecessor || predecessor.activityId !== activityId) {
        throw new TypeError(
          `Activity ${activityId} has an invalid predecessor for ${member.id}.`,
        );
      }
    }
    const rootIds = new Map<string, string | undefined>();
    for (const member of members) {
      const seen = new Set<string>();
      let current: EngineeringWorkItem | undefined = member;
      while (current?.predecessorRevisionId !== undefined) {
        if (seen.has(current.id)) {
          throw new TypeError(
            `Activity ${activityId} has a predecessor cycle at ${current.id}.`,
          );
        }
        seen.add(current.id);
        current = byId.get(current.predecessorRevisionId);
      }
      rootIds.set(member.id, current?.id);
    }
    const roots = members.filter((member) =>
      member.predecessorRevisionId === undefined
    );
    if (roots.length !== 1) {
      throw new TypeError(
        `Activity ${activityId} must have exactly one root revision.`,
      );
    }
    const rootId = roots[0]!.id;
    for (const [memberId, terminalRootId] of rootIds) {
      if (terminalRootId !== rootId) {
        throw new TypeError(`Activity ${activityId} is disconnected at ${memberId}.`);
      }
    }
  }
}

function compileSlice(
  workItems: readonly EngineeringWorkItem[],
  registryClosure: ResolvedRuntimePreparationPrerequisiteRegistry,
): ProjectCapabilityDemandSlice {
  const groups = new Map<string, CanonicalOperationGroup>();
  for (const workItem of workItems) {
    const operation = canonicalOperation(
      workItem.operation!,
      `$project.workItems[${workItem.id}].operation`,
    );
    const key = operationKey(operation);
    const group = groups.get(key) ?? { operation, workItemIds: [] };
    group.workItemIds.push(
      safeId(workItem.id, `$project.workItems[${workItem.id}].id`),
    );
    groups.set(key, group);
  }
  const operationGroups: ProjectCapabilityOperationGroup[] = [];
  const requiredCapabilities: RequiredEngineeringCapability[] = [];
  for (const group of [...groups.values()].sort(compareOperationGroup)) {
    if (!registryClosure.has(group.operation)) {
      operationGroups.push({
        operation: group.operation,
        workItemIds: group.workItemIds.toSorted(compareText),
        resolution: "unresolved",
        reason: "operation-unregistered",
      });
      continue;
    }
    const capabilities = flattenEngineeringCapabilityRequirements(
      registryClosure.resolve([group.operation]).flatMap(
        (entry) =>
          entry.runtimeDemand.kind === "required"
            ? entry.runtimeDemand.capabilities
            : [],
      ),
    );
    operationGroups.push({
      operation: group.operation,
      workItemIds: group.workItemIds.toSorted(compareText),
      resolution: "resolved",
      capabilities,
    });
    requiredCapabilities.push(...capabilities);
  }
  return {
    status: operationGroups.some((group) => group.resolution === "unresolved")
      ? "unresolved" as const
      : "resolved" as const,
    operationGroups,
    capabilityRequirements: flattenEngineeringCapabilityRequirements(
      requiredCapabilities,
    ),
  };
}

function canonicalOperation(
  value: { readonly id: string; readonly version: string },
  path: string,
): { id: string; version: string } {
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
  };
}

function operationKey(
  value: { readonly id: string; readonly version: string },
): string {
  return `${value.id}\u0000${value.version}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareOperationGroup(
  left: CanonicalOperationGroup,
  right: CanonicalOperationGroup,
): number {
  return compareText(operationKey(left.operation), operationKey(right.operation));
}

function canonicalWorkItemStatus(
  value: unknown,
  path: string,
): EngineeringWorkItemStatus {
  if (
    value === "planned" || value === "ready" || value === "in-progress" ||
    value === "waiting-for-decision" || value === "completed" ||
    value === "cancelled" || value === "abandoned"
  ) {
    return value;
  }
  throw new TypeError(`${path} must be a known EngineeringWorkItem status.`);
}
