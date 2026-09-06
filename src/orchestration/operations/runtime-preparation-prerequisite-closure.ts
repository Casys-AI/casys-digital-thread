import {
  compareEngineeringCapabilities,
  engineeringCapabilityRequirementKey,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import { exactVersionToken, safeId } from "../../domain/kernel/case-validation.ts";
import type {
  EngineeringOperationExecution,
  EngineeringOperationRuntimeDemand,
} from "./operation-contract.ts";

/**
 * The code-owned registry projection needed to close preparation-only demand.
 * It deliberately carries neither bindings nor any provider/runtime material.
 */
export interface RuntimePreparationPrerequisiteRegistryEntry {
  readonly id: string;
  readonly version: string;
  readonly execution?: EngineeringOperationExecution;
  readonly prerequisiteOnly?: true;
  readonly runtimeDemand: EngineeringOperationRuntimeDemand;
  readonly runtimePreparationPrerequisites?: readonly {
    readonly id: string;
    readonly version: string;
  }[];
}

export interface RuntimePreparationPrerequisiteRegistryView {
  list(): readonly RuntimePreparationPrerequisiteRegistryEntry[];
}

export interface ResolvedRuntimePreparationPrerequisiteRegistry {
  has(reference: OperationReference): boolean;
  resolve(
    roots: readonly OperationReference[],
  ): readonly RuntimePreparationPrerequisiteRegistryEntry[];
  entries(): readonly RuntimePreparationPrerequisiteRegistryEntry[];
}

export interface OperationReference {
  readonly id: string;
  readonly version: string;
}

interface CanonicalRegistryEntry {
  readonly id: string;
  readonly version: string;
  readonly runtimeDemand: EngineeringOperationRuntimeDemand;
  readonly prerequisiteOnly: boolean;
  readonly execution: EngineeringOperationExecution;
  readonly runtimePreparationPrerequisites: readonly OperationReference[];
}

/**
 * Canonicalize and validate the closed preparation-prerequisite graph once.
 * Every caller then resolves only exact non-prerequisite roots through this
 * shared graph; callers never enqueue or otherwise expose a prerequisite.
 */
export function resolveRuntimePreparationPrerequisiteRegistry(
  registry: RuntimePreparationPrerequisiteRegistryView,
): ResolvedRuntimePreparationPrerequisiteRegistry {
  const entries = canonicalRegistryEntries(registry);
  assertPrerequisiteTargets(entries);
  assertAcyclic(entries);

  return Object.freeze({
    has(reference: OperationReference): boolean {
      return entries.has(operationKey(canonicalOperation(reference, "$operation")));
    },
    resolve(
      roots: readonly OperationReference[],
    ): readonly RuntimePreparationPrerequisiteRegistryEntry[] {
      const closure = new Map<string, CanonicalRegistryEntry>();
      const visiting = new Set<string>();
      const visit = (reference: OperationReference, internal: boolean): void => {
        const operation = canonicalOperation(reference, "$runtimePreparationRoots");
        const key = operationKey(operation);
        const entry = entries.get(key);
        if (!entry) {
          throw new TypeError(
            `$runtimePreparationRoots references absent operation ${operation.id}@${operation.version}.`,
          );
        }
        if (!internal && entry.prerequisiteOnly) {
          throw new TypeError(
            `${entry.id}@${entry.version} is prerequisite-only and cannot be a closure root.`,
          );
        }
        if (closure.has(key)) return;
        if (visiting.has(key)) {
          throw new TypeError(
            `Runtime preparation prerequisite cycle includes ${entry.id}@${entry.version}.`,
          );
        }
        visiting.add(key);
        for (const prerequisite of entry.runtimePreparationPrerequisites) {
          visit(prerequisite, true);
        }
        visiting.delete(key);
        closure.set(key, entry);
      };

      for (
        const root of canonicalOperationReferences(roots, "$runtimePreparationRoots")
      ) {
        visit(root, false);
      }
      return Object.freeze(
        [...closure.values()].toSorted(compareOperation).map(copyEntry),
      );
    },
    entries(): readonly RuntimePreparationPrerequisiteRegistryEntry[] {
      return Object.freeze(
        [...entries.values()].toSorted(compareOperation).map(copyEntry),
      );
    },
  });
}

/** Stable, complete identity of the prerequisite-aware runtime-demand registry. */
export function runtimePreparationPrerequisiteRegistryFingerprintPayload(
  entries: readonly RuntimePreparationPrerequisiteRegistryEntry[],
): {
  readonly schemaVersion: "engineering-operation-runtime-demand-registry/2.0";
  readonly operations: readonly {
    readonly id: string;
    readonly version: string;
    readonly prerequisiteOnly: boolean;
    readonly runtimeDemand: EngineeringOperationRuntimeDemand;
    readonly runtimePreparationPrerequisites: readonly OperationReference[];
  }[];
} {
  return {
    schemaVersion: "engineering-operation-runtime-demand-registry/2.0",
    operations: entries.map((entry) => ({
      id: entry.id,
      version: entry.version,
      prerequisiteOnly: entry.prerequisiteOnly === true,
      runtimeDemand: copyRuntimeDemand(entry.runtimeDemand),
      runtimePreparationPrerequisites: canonicalOperationReferences(
        entry.runtimePreparationPrerequisites ?? [],
        `$registry.${entry.id}@${entry.version}.runtimePreparationPrerequisites`,
      ),
    })).toSorted(compareOperation),
  };
}

function canonicalRegistryEntries(
  registry: RuntimePreparationPrerequisiteRegistryView,
): ReadonlyMap<string, CanonicalRegistryEntry> {
  const entries = new Map<string, CanonicalRegistryEntry>();
  for (const [index, candidate] of registry.list().entries()) {
    const operation = canonicalOperation(candidate, `$registry.entries[${index}]`);
    const key = operationKey(operation);
    if (entries.has(key)) {
      throw new TypeError(
        `$registry.entries has duplicate operation ${operation.id}@${operation.version}.`,
      );
    }
    const execution = candidate.execution ?? "trusted";
    if (execution !== "trusted" && execution !== "planning-only") {
      throw new TypeError(
        `$registry.entries[${index}].execution must be trusted or planning-only.`,
      );
    }
    if (
      candidate.prerequisiteOnly !== undefined && candidate.prerequisiteOnly !== true
    ) {
      throw new TypeError(
        `$registry.entries[${index}].prerequisiteOnly must be true when present.`,
      );
    }
    entries.set(key, {
      ...operation,
      execution,
      prerequisiteOnly: candidate.prerequisiteOnly === true,
      runtimeDemand: canonicalRuntimeDemand(
        candidate.runtimeDemand,
        `$registry.entries[${index}].runtimeDemand`,
      ),
      runtimePreparationPrerequisites: canonicalOperationReferences(
        candidate.runtimePreparationPrerequisites ?? [],
        `$registry.entries[${index}].runtimePreparationPrerequisites`,
      ),
    });
  }
  return new Map(
    [...entries.entries()].toSorted(([left], [right]) => compareText(left, right)),
  );
}

function assertPrerequisiteTargets(
  entries: ReadonlyMap<string, CanonicalRegistryEntry>,
): void {
  for (const entry of entries.values()) {
    if (entry.prerequisiteOnly) {
      assertPreparationPrerequisite(entry, entry);
    }
    for (const reference of entry.runtimePreparationPrerequisites) {
      const prerequisite = entries.get(operationKey(reference));
      if (!prerequisite) {
        throw new TypeError(
          `${entry.id}@${entry.version} references absent runtime preparation prerequisite ${reference.id}@${reference.version}.`,
        );
      }
      assertPreparationPrerequisite(entry, prerequisite);
    }
  }
}

function assertPreparationPrerequisite(
  owner: CanonicalRegistryEntry,
  prerequisite: CanonicalRegistryEntry,
): void {
  if (prerequisite.execution !== "planning-only" || !prerequisite.prerequisiteOnly) {
    throw new TypeError(
      `${owner.id}@${owner.version} prerequisite ${prerequisite.id}@${prerequisite.version} must be planning-only and prerequisite-only.`,
    );
  }
  if (
    prerequisite.runtimeDemand.kind !== "required" ||
    prerequisite.runtimeDemand.capabilities.length !== 1 ||
    prerequisite.runtimeDemand.capabilities[0]!.use !== "preparation"
  ) {
    throw new TypeError(
      `${owner.id}@${owner.version} prerequisite ${prerequisite.id}@${prerequisite.version} must require exactly one preparation capability.`,
    );
  }
}

function assertAcyclic(entries: ReadonlyMap<string, CanonicalRegistryEntry>): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (entry: CanonicalRegistryEntry): void => {
    const key = operationKey(entry);
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new TypeError(
        `Runtime preparation prerequisite cycle includes ${entry.id}@${entry.version}.`,
      );
    }
    visiting.add(key);
    for (const prerequisite of entry.runtimePreparationPrerequisites) {
      const target = entries.get(operationKey(prerequisite));
      if (!target) {
        throw new TypeError(
          `${entry.id}@${entry.version} references absent runtime preparation prerequisite ${prerequisite.id}@${prerequisite.version}.`,
        );
      }
      visit(target);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const entry of entries.values()) visit(entry);
}

function canonicalOperationReferences(
  values: readonly OperationReference[],
  path: string,
): readonly OperationReference[] {
  if (!Array.isArray(values)) {
    throw new TypeError(`${path} must be an array.`);
  }
  const references = values.map((value, index) =>
    canonicalOperation(value, `${path}[${index}]`)
  ).toSorted(compareOperation);
  const seen = new Set<string>();
  for (const reference of references) {
    const key = operationKey(reference);
    if (seen.has(key)) {
      throw new TypeError(
        `${path} has duplicate ${reference.id}@${reference.version}.`,
      );
    }
    seen.add(key);
  }
  return references;
}

function canonicalOperation(
  value: { readonly id: string; readonly version: string },
  path: string,
): OperationReference {
  return {
    id: safeId(value.id, `${path}.id`),
    version: exactVersionToken(value.version, `${path}.version`),
  };
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

function copyEntry(
  entry: CanonicalRegistryEntry,
): RuntimePreparationPrerequisiteRegistryEntry {
  return Object.freeze({
    id: entry.id,
    version: entry.version,
    execution: entry.execution,
    ...(entry.prerequisiteOnly ? { prerequisiteOnly: true as const } : {}),
    runtimeDemand: copyRuntimeDemand(entry.runtimeDemand),
    runtimePreparationPrerequisites: Object.freeze(
      entry.runtimePreparationPrerequisites.map((reference) =>
        Object.freeze({ ...reference })
      ),
    ),
  });
}

function copyRuntimeDemand(
  runtimeDemand: EngineeringOperationRuntimeDemand,
): EngineeringOperationRuntimeDemand {
  if (runtimeDemand.kind === "none") return Object.freeze({ kind: "none" });
  return Object.freeze({
    kind: "required",
    capabilities: Object.freeze(
      runtimeDemand.capabilities.map((capability) => Object.freeze({ ...capability })),
    ),
  });
}

function operationKey(reference: OperationReference): string {
  return `${reference.id}\u0000${reference.version}`;
}

function compareOperation(left: OperationReference, right: OperationReference): number {
  return compareText(operationKey(left), operationKey(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
