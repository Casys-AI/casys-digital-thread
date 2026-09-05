import {
  PROJECT_CAPABILITY_INTENT_SCHEMA_VERSION,
  type ProjectCapabilityIntent,
  type ProjectCapabilityIntentAuthorityReference,
  type ProjectCapabilityIntentAuthorityResolution,
  type ProjectCapabilityIntentOperationReference,
  type UnresolvedProjectCapabilityIntentAuthority,
} from "../../domain/capability/project-capability-intent.ts";
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
import type { ProjectBriefRevision } from "../../domain/project/project-brief.ts";
import type {
  BriefCapabilityIntentRouteTable,
} from "../../orchestration/operations/brief-capability-intent-routes.ts";
import { briefCapabilityIntentRouteTable } from "../../orchestration/operations/brief-capability-intent-routes.ts";
import {
  resolveRuntimePreparationPrerequisiteRegistry,
  type RuntimePreparationPrerequisiteRegistryView,
} from "../../orchestration/operations/runtime-preparation-prerequisite-closure.ts";

/**
 * Trusted server projection of the operation registry. The caller never
 * supplies operations, runtime demands, or a capability list.
 */
export interface BriefCapabilityIntentOperationRegistryView
  extends RuntimePreparationPrerequisiteRegistryView {}

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
  const registryClosure = resolveRuntimePreparationPrerequisiteRegistry(registry);
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
      !registryClosure.has(operation)
    );
    if (missingOperations.length > 0) {
      resolutions.push(
        unresolved(authority, "operation-unregistered", missingOperations),
      );
      continue;
    }
    for (const registered of registryClosure.resolve(route.operations)) {
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
