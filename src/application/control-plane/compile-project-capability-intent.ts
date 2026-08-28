import {
  PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION,
  type ProjectCapabilityIntent,
  type ProjectCapabilityIntentAuthorityReference,
  type ProjectCapabilityIntentAuthorityResolution,
  type ProjectCapabilityIntentOperationReference,
  type UnresolvedProjectCapabilityIntentAuthority,
} from "../../domain/capability/project-capability-intent.ts";
import {
  compareEngineeringCapabilities,
  engineeringCapabilityRequirementKey,
  flattenEngineeringCapabilityRequirements,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  deepFreeze,
  exactVersionToken,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import type {
  BriefCapabilityIntentRoute,
  BriefCapabilityIntentRouteTable,
} from "../../orchestration/operations/brief-capability-intent-routes.ts";
import { briefCapabilityIntentRouteTable } from "../../orchestration/operations/brief-capability-intent-routes.ts";
import type {
  EngineeringOperationRuntimeDemand,
  RegisteredEngineeringOperation,
} from "../../orchestration/operations/operation-contract.ts";

/**
 * Trusted server projection of the operation registry. The caller never
 * supplies operations, runtime demands, or a capability list.
 */
export interface BriefCapabilityIntentOperationRegistryView {
  list(): readonly Pick<
    RegisteredEngineeringOperation,
    "id" | "version" | "runtimeDemand"
  >[];
}

interface RegistryOperation {
  readonly operation: ProjectCapabilityIntentOperationReference;
  readonly runtimeDemand: EngineeringOperationRuntimeDemand;
}

interface CanonicalRoute {
  readonly authority: ProjectCapabilityIntentAuthorityReference;
  readonly operations: readonly ProjectCapabilityIntentOperationReference[];
}

/**
 * Compile an operational capability ceiling from semantic Brief authorities.
 *
 * This deliberately reads only `verification-activity.verificationAuthority`;
 * statements, source references, item IDs, and item ordering cannot influence
 * the result or its semantic fingerprint. No host or runtime is mutated.
 */
export async function compileProjectCapabilityIntent(
  brief: ProjectBriefRevision,
  registry: BriefCapabilityIntentOperationRegistryView,
  routes: BriefCapabilityIntentRouteTable = briefCapabilityIntentRouteTable,
): Promise<ProjectCapabilityIntent> {
  const registryEntries = canonicalRegistry(registry);
  const routeEntries = canonicalRoutes(routes);
  const authorities = canonicalBriefAuthorities(brief);
  const resolutions: ProjectCapabilityIntentAuthorityResolution[] = [];
  const requirements: RequiredEngineeringCapability[] = [];

  for (const authority of authorities) {
    const route = routeEntries.get(authorityKey(authority));
    if (!route) {
      resolutions.push(unresolved(authority, "authority-unrouted"));
      continue;
    }
    if (route.operations.length === 0) {
      resolutions.push(unresolved(authority, "route-operation-missing"));
      continue;
    }
    const missingOperations = route.operations.filter((operation) =>
      !registryEntries.has(operationKey(operation))
    );
    if (missingOperations.length > 0) {
      resolutions.push(
        unresolved(authority, "operation-unregistered", missingOperations),
      );
      continue;
    }
    for (const operation of route.operations) {
      const registered = registryEntries.get(operationKey(operation));
      if (!registered) {
        throw new TypeError(
          `Registry operation ${operation.id}@${operation.version} disappeared during intent compilation.`,
        );
      }
      if (registered.runtimeDemand.kind === "required") {
        requirements.push(...registered.runtimeDemand.capabilities);
      }
    }
    resolutions.push({
      authority,
      resolution: "resolved",
      operations: route.operations,
    });
  }

  const capabilityRequirements = flattenEngineeringCapabilityRequirements(
    requirements,
  );
  const unresolvedAuthorities = resolutions.filter(
    (resolution): resolution is UnresolvedProjectCapabilityIntentAuthority =>
      resolution.resolution === "unresolved",
  ).map((resolution) => ({
    authority: resolution.authority,
    reason: resolution.reason,
    ...(resolution.operations === undefined ? {} : {
      operations: resolution.operations,
    }),
  }));
  const capabilityIntentFingerprint = await sha256Fingerprint({
    capabilityRequirements,
    unresolvedAuthorities,
  });

  return deepFreeze({
    schemaVersion: PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION,
    mutatesRuntime: false,
    status: unresolvedAuthorities.length === 0 ? "resolved" : "unresolved",
    authorities: resolutions,
    capabilityRequirements,
    capabilityIntentFingerprint,
  });
}

function canonicalBriefAuthorities(
  brief: ProjectBriefRevision,
): readonly ProjectCapabilityIntentAuthorityReference[] {
  const authorities = new Map<string, ProjectCapabilityIntentAuthorityReference>();
  for (const item of brief.items) {
    if (item.kind !== "verification-activity" || !item.verificationAuthority) {
      continue;
    }
    const authority = canonicalAuthority(
      item.verificationAuthority,
      "$brief.items[].verificationAuthority",
    );
    authorities.set(authorityKey(authority), authority);
  }
  return [...authorities.values()].toSorted(compareAuthority);
}

function canonicalRoutes(
  routes: BriefCapabilityIntentRouteTable,
): ReadonlyMap<string, CanonicalRoute> {
  const result = new Map<string, CanonicalRoute>();
  for (const [index, route] of routes.list().entries()) {
    const authority = canonicalAuthority(
      route.authority,
      `$routes[${index}].authority`,
    );
    const key = authorityKey(authority);
    if (result.has(key)) {
      throw new TypeError(
        `$routes has duplicate authority ${authority.id}@${authority.version}.`,
      );
    }
    const operations = canonicalOperations(
      route.operations,
      `$routes[${index}].operations`,
    );
    result.set(key, { authority, operations });
  }
  return new Map(
    [...result.entries()].toSorted(([left], [right]) => compareText(left, right)),
  );
}

function canonicalRegistry(
  registry: BriefCapabilityIntentOperationRegistryView,
): ReadonlyMap<string, RegistryOperation> {
  const result = new Map<string, RegistryOperation>();
  for (const [index, candidate] of registry.list().entries()) {
    const operation = canonicalOperation(candidate, `$registry[${index}]`);
    const key = operationKey(operation);
    if (result.has(key)) {
      throw new TypeError(
        `$registry has duplicate operation ${operation.id}@${operation.version}.`,
      );
    }
    result.set(key, {
      operation,
      runtimeDemand: canonicalRuntimeDemand(
        candidate.runtimeDemand,
        `$registry[${index}].runtimeDemand`,
      ),
    });
  }
  return new Map(
    [...result.entries()].toSorted(([left], [right]) => compareText(left, right)),
  );
}

function canonicalRuntimeDemand(
  value: EngineeringOperationRuntimeDemand,
  path: string,
): EngineeringOperationRuntimeDemand {
  if (value.kind === "none") return { kind: "none" };
  if (value.kind !== "required" || value.capabilities.length === 0) {
    throw new TypeError(`${path} must be none or required with nonempty capabilities.`);
  }
  const capabilities = value.capabilities.map((capability, index) =>
    canonicalCapability(capability, `${path}.capabilities[${index}]`)
  ).toSorted(compareEngineeringCapabilities);
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const key = engineeringCapabilityRequirementKey(capability);
    if (seen.has(key)) {
      throw new TypeError(`${path}.capabilities has duplicate ${key}.`);
    }
    seen.add(key);
  }
  return { kind: "required", capabilities };
}

function canonicalCapability(
  value: RequiredEngineeringCapability,
  path: string,
): RequiredEngineeringCapability {
  if (
    value.minimumQualification !== "compatible" &&
    value.minimumQualification !== "qualified"
  ) {
    throw new TypeError(
      `${path}.minimumQualification must be compatible or qualified.`,
    );
  }
  if (value.use !== "preparation" && value.use !== "execution") {
    throw new TypeError(`${path}.use must be preparation or execution.`);
  }
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
    minimumQualification: value.minimumQualification,
    use: value.use,
  };
}

function canonicalAuthority(
  value: { readonly id: string; readonly version: string },
  path: string,
): ProjectCapabilityIntentAuthorityReference {
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
  };
}

function canonicalOperations(
  values: readonly Pick<ProjectCapabilityIntentOperationReference, "id" | "version">[],
  path: string,
): readonly ProjectCapabilityIntentOperationReference[] {
  const operations = values.map((operation, index) =>
    canonicalOperation(operation, `${path}[${index}]`)
  ).toSorted(compareOperation);
  const seen = new Set<string>();
  for (const operation of operations) {
    const key = operationKey(operation);
    if (seen.has(key)) {
      throw new TypeError(
        `${path} has duplicate operation ${operation.id}@${operation.version}.`,
      );
    }
    seen.add(key);
  }
  return operations;
}

function canonicalOperation(
  value: { readonly id: string; readonly version: string },
  path: string,
): ProjectCapabilityIntentOperationReference {
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
  };
}

function unresolved(
  authority: ProjectCapabilityIntentAuthorityReference,
  reason: UnresolvedProjectCapabilityIntentAuthority["reason"],
  operations?: readonly ProjectCapabilityIntentOperationReference[],
): UnresolvedProjectCapabilityIntentAuthority {
  if (reason === "operation-unregistered" && (!operations || operations.length === 0)) {
    throw new TypeError(
      "operation-unregistered capability intent blockers require missing operations.",
    );
  }
  if (reason !== "operation-unregistered" && operations !== undefined) {
    throw new TypeError(
      `${reason} capability intent blockers must not name operations.`,
    );
  }
  return {
    authority,
    resolution: "unresolved",
    reason,
    ...(operations === undefined ? {} : { operations }),
  };
}

function authorityKey(
  authority: ProjectCapabilityIntentAuthorityReference,
): string {
  return `${authority.id}\u0000${authority.version}`;
}

function operationKey(
  operation: ProjectCapabilityIntentOperationReference,
): string {
  return `${operation.id}\u0000${operation.version}`;
}

function compareAuthority(
  left: ProjectCapabilityIntentAuthorityReference,
  right: ProjectCapabilityIntentAuthorityReference,
): number {
  return compareText(authorityKey(left), authorityKey(right));
}

function compareOperation(
  left: ProjectCapabilityIntentOperationReference,
  right: ProjectCapabilityIntentOperationReference,
): number {
  return compareText(operationKey(left), operationKey(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
