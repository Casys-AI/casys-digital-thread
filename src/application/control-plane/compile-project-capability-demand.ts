import {
  PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
  type ProjectCapabilityDemand,
  type ProjectCapabilityOperationGroup,
  type UnresolvedProjectCapabilityOperationGroup,
} from "../../domain/capability/project-capability-demand.ts";
import type { CapabilityRequirementCatalogView } from "../../domain/capability/capability-requirement-catalog.ts";
import type { RequiredEngineeringCapability } from "../../domain/capability/engineering-capability.ts";
import {
  deepFreeze,
  exactVersionToken,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";

interface CanonicalOperationGroup {
  readonly operation: { readonly id: string; readonly version: string };
  readonly workItemIds: readonly string[];
}

/**
 * Server-composition seam for compiling an exact planned operation path into
 * provider-neutral capability demand. `catalog` must be a code-owned trusted
 * dependency, never request or agent input. Product consumers use a scoped
 * adapter that pins the catalogue.
 *
 * This function only reads project and catalogue values; it cannot acquire,
 * activate, bind or otherwise mutate a runtime.
 */
export async function compileProjectCapabilityDemandFromServerCatalog(
  project: EngineeringProjectSnapshot,
  catalog: CapabilityRequirementCatalogView,
): Promise<ProjectCapabilityDemand> {
  const approvedBriefBasis = requireApprovedPlanBasis(project);
  const catalogByOperation = validateCatalog(catalog);
  const canonicalOperationGroups = groupProjectOperations(project);
  const operationGroups: ProjectCapabilityOperationGroup[] = [];
  const flattened = new Map<string, RequiredEngineeringCapability>();

  for (const group of canonicalOperationGroups) {
    const entry = catalogByOperation.get(operationKey(group.operation));
    if (!entry) {
      operationGroups.push({
        ...group,
        resolution: "unresolved",
        reason: "catalog-entry-missing",
      });
      continue;
    }
    const capabilities = canonicalCapabilities(entry.capabilities);
    operationGroups.push({ ...group, resolution: "resolved", capabilities });
    for (const capability of capabilities) {
      const key = capabilityKey(capability);
      const previous = flattened.get(key);
      if (
        !previous ||
        qualificationRank(capability.minimumQualification) >
          qualificationRank(previous.minimumQualification)
      ) {
        flattened.set(key, capability);
      }
    }
  }

  const capabilityRequirements = [...flattened.values()].sort(compareCapability);
  const projectSnapshot = {
    projectId: project.project.id,
    snapshotId: project.id,
    revision: project.revision,
  };
  const pathFingerprint = await sha256Fingerprint({
    projectSnapshot,
    approvedBriefBasis,
    operationGroups: canonicalOperationGroups,
  });
  const unresolvedOperationGroups = operationGroups.filter(
    (group): group is UnresolvedProjectCapabilityOperationGroup =>
      group.resolution === "unresolved",
  );
  const capabilitySetFingerprint = await sha256Fingerprint({
    capabilityRequirements,
    unresolvedOperationGroups,
  });

  return deepFreeze({
    schemaVersion: PROJECT_CAPABILITY_DEMAND_SCHEMA_VERSION,
    mutatesRuntime: false,
    status: unresolvedOperationGroups.length === 0 ? "resolved" : "unresolved",
    projectSnapshot,
    approvedBriefBasis: structuredClone(approvedBriefBasis),
    operationGroups,
    capabilityRequirements,
    pathFingerprint,
    capabilitySetFingerprint,
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

function groupProjectOperations(
  project: EngineeringProjectSnapshot,
): CanonicalOperationGroup[] {
  const workItemIds = new Set<string>();
  const groups = new Map<string, {
    operation: { id: string; version: string };
    workItemIds: string[];
  }>();
  for (const workItem of project.workItems) {
    if (workItemIds.has(workItem.id)) {
      throw new TypeError(`Project work item id ${workItem.id} is duplicated.`);
    }
    workItemIds.add(workItem.id);
    const workItemId = safeId(
      workItem.id,
      `$project.workItems[${workItem.id}].id`,
    );
    if (!workItem.operation) {
      throw new TypeError(
        `Project work item ${workItemId} has no registered operation after project.plan-publish.`,
      );
    }
    const operation = canonicalOperation(
      workItem.operation,
      `$project.workItems[${workItem.id}].operation`,
    );
    const key = operationKey(operation);
    const group = groups.get(key) ?? { operation, workItemIds: [] };
    group.workItemIds.push(workItemId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    operation: group.operation,
    workItemIds: group.workItemIds.sort(compareText),
  })).sort(compareOperationGroup);
}

function validateCatalog(
  catalog: CapabilityRequirementCatalogView,
): ReadonlyMap<string, { capabilities: readonly RequiredEngineeringCapability[] }> {
  const entries = new Map<
    string,
    { capabilities: readonly RequiredEngineeringCapability[] }
  >();
  for (let index = 0; index < catalog.entries.length; index++) {
    const entry = catalog.entries[index]!;
    const operation = canonicalOperation(
      entry.operation,
      `$catalog.entries[${index}].operation`,
    );
    const key = operationKey(operation);
    if (entries.has(key)) {
      throw new TypeError(
        `$catalog.entries has duplicate operation ${operation.id}@${operation.version}.`,
      );
    }
    if (entry.capabilities.length === 0) {
      throw new TypeError(
        `$catalog.entries[${index}].capabilities must declare at least one capability.`,
      );
    }
    const seenCapabilities = new Set<string>();
    const capabilities = entry.capabilities.map((capability, capabilityIndex) => {
      const canonical = canonicalCapability(
        capability,
        `$catalog.entries[${index}].capabilities[${capabilityIndex}]`,
      );
      const capabilityIdentity = capabilityKey(canonical);
      if (seenCapabilities.has(capabilityIdentity)) {
        throw new TypeError(
          `$catalog.entries[${index}].capabilities has duplicate or conflicting ${canonical.id}@${canonical.version} ${canonical.use} demand.`,
        );
      }
      seenCapabilities.add(capabilityIdentity);
      return canonical;
    });
    entries.set(key, { capabilities });
  }
  return entries;
}

function canonicalCapabilities(
  capabilities: readonly RequiredEngineeringCapability[],
): RequiredEngineeringCapability[] {
  return capabilities.map((capability) => ({ ...capability })).sort(
    compareCapability,
  );
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

function canonicalCapability(
  value: RequiredEngineeringCapability,
  path: string,
): RequiredEngineeringCapability {
  const minimumQualification = value.minimumQualification;
  if (minimumQualification !== "compatible" && minimumQualification !== "qualified") {
    throw new TypeError(
      `${path}.minimumQualification must be compatible or qualified.`,
    );
  }
  const use = value.use;
  if (use !== "preparation" && use !== "execution") {
    throw new TypeError(`${path}.use must be preparation or execution.`);
  }
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
    minimumQualification,
    use,
  };
}

function operationKey(
  value: { readonly id: string; readonly version: string },
): string {
  return `${value.id}\u0000${value.version}`;
}

function capabilityKey(value: RequiredEngineeringCapability): string {
  return `${value.id}\u0000${value.version}\u0000${value.use}`;
}

function qualificationRank(
  value: RequiredEngineeringCapability["minimumQualification"],
): number {
  return value === "qualified" ? 1 : 0;
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

function compareCapability(
  left: RequiredEngineeringCapability,
  right: RequiredEngineeringCapability,
): number {
  return compareText(capabilityKey(left), capabilityKey(right)) ||
    compareText(left.minimumQualification, right.minimumQualification);
}
