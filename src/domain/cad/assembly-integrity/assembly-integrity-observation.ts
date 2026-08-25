/**
 * Facts-only parser for `verify.observe-assembly-integrity@1` output.
 *
 * This record never decides fitness, clearance, safety, motion, strength, or
 * any product verdict. It only recrosses one exact input bundle with import,
 * topology, occurrence, transform, and pairwise geometry observations.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
  ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES,
  ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS,
  type AssemblyIntegrityExpectedPlacement,
  type AssemblyIntegrityInputBundle,
  type AssemblyIntegrityMethodIdentity,
  validateAssemblyIntegrityMethodIdentity,
} from "./assembly-integrity-input-bundle.ts";

export const ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA =
  "assembly-integrity-observation/1.0" as const;

/** Registered operation identity, not a runtime or provider capability. */
export const VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION = Object.freeze(
  {
    id: "verify.observe-assembly-integrity",
    version: "1",
  } as const,
);

export type AssemblyIntegrityObservationStatus =
  | "observed"
  | "unresolved"
  | "unavailable";

export type AssemblyIntegrityFact<T> =
  | { readonly status: "observed"; readonly value: T }
  | {
    readonly status: "unresolved";
    readonly reason: "identity-missing" | "observability-missing";
  }
  | { readonly status: "unavailable"; readonly reason: "unsupported" };

export interface AssemblyIntegrityInputBundleIdentity {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
}

export interface AssemblyIntegrityImportFacts {
  readonly unitSystem: "mm";
  readonly solidCount: number;
}

export interface AssemblyIntegrityTopologyFacts {
  readonly brepValidity: AssemblyIntegrityFact<"valid" | "invalid">;
  readonly degenerateEntityCount: AssemblyIntegrityFact<number>;
  readonly freeEdgeCount: AssemblyIntegrityFact<number>;
  readonly shellCount: AssemblyIntegrityFact<number>;
}

export interface AssemblyIntegrityOccurrenceFacts {
  readonly usageElementId: string;
  readonly target: AssemblyIntegrityFact<{ readonly partDefinitionElementId: string }>;
  readonly transform: AssemblyIntegrityFact<{
    readonly expectedPlacement: AssemblyIntegrityExpectedPlacement;
    readonly observedPlacement: AssemblyIntegrityExpectedPlacement;
  }>;
}

export interface AssemblyIntegrityPairFacts {
  readonly firstUsageElementId: string;
  readonly secondUsageElementId: string;
  readonly linearToleranceMm: number;
  readonly minimumDistanceMm: AssemblyIntegrityFact<number>;
  readonly intersectionVolumeMm3: AssemblyIntegrityFact<number>;
  readonly contact: AssemblyIntegrityFact<"contact" | "no-contact">;
}

export interface AssemblyIntegrityObservation {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA;
  readonly operation: typeof VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION;
  readonly inputBundle: AssemblyIntegrityInputBundleIdentity;
  readonly method: AssemblyIntegrityMethodIdentity;
  readonly importFacts: AssemblyIntegrityFact<AssemblyIntegrityImportFacts>;
  readonly topology: AssemblyIntegrityTopologyFacts;
  readonly occurrences: readonly AssemblyIntegrityOccurrenceFacts[];
  readonly pairs: readonly AssemblyIntegrityPairFacts[];
}

/**
 * Parse an observer result against a previously reopened, hash-verified input
 * bundle. A missing identity or observation must be literal `unresolved`; a
 * metric the method does not support must be literal `unavailable`.
 */
export function parseAssemblyIntegrityObservation(
  value: unknown,
  inputBundle: AssemblyIntegrityInputBundle,
): AssemblyIntegrityObservation {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "inputBundle",
      "method",
      "importFacts",
      "topology",
      "occurrences",
      "pairs",
    ],
    "$assemblyIntegrityObservation",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    "$assemblyIntegrityObservation.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$assemblyIntegrityObservation.operation",
  );
  literalValue(
    operation.id,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    "$assemblyIntegrityObservation.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    "$assemblyIntegrityObservation.operation.version",
  );
  const bundleIdentity = parseInputBundleIdentity(root.inputBundle);
  assertBundleIdentity(bundleIdentity, inputBundle);
  const method = validateAssemblyIntegrityMethodIdentity(
    root.method,
    "$assemblyIntegrityObservation.method",
  );
  if (!sameMethod(method, inputBundle.manifest.method)) {
    throw new TypeError(
      "$assemblyIntegrityObservation.method must equal the exact bound method.",
    );
  }

  const importFacts = parseObservationFact(
    root.importFacts,
    "$assemblyIntegrityObservation.importFacts",
    parseImportFacts,
  );
  if (
    importFacts.status === "observed" &&
    importFacts.value.unitSystem !== inputBundle.manifest.unitSystem
  ) {
    throw new TypeError(
      "$assemblyIntegrityObservation.importFacts.unitSystem diverges from the exact STEP basis.",
    );
  }
  const topology = parseTopology(root.topology);

  if (!Array.isArray(root.occurrences)) {
    throw new TypeError("$assemblyIntegrityObservation.occurrences must be an array.");
  }
  if (root.occurrences.length > ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES) {
    throw new TypeError(
      "$assemblyIntegrityObservation.occurrences exceeds the occurrence ceiling.",
    );
  }
  if (root.occurrences.length !== inputBundle.manifest.occurrences.length) {
    throw new TypeError(
      "$assemblyIntegrityObservation.occurrences must cover every immediate occurrence.",
    );
  }
  const occurrences = root.occurrences.map((entry, index) =>
    parseOccurrenceFacts(
      entry,
      inputBundle.manifest.occurrences[index]!,
      `$assemblyIntegrityObservation.occurrences[${index}]`,
    )
  );

  if (!Array.isArray(root.pairs)) {
    throw new TypeError("$assemblyIntegrityObservation.pairs must be an array.");
  }
  if (root.pairs.length > ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS) {
    throw new TypeError(
      "$assemblyIntegrityObservation.pairs exceeds the pair ceiling.",
    );
  }
  const expectedPairs = expectedPairLabels(inputBundle);
  if (root.pairs.length !== expectedPairs.length) {
    throw new TypeError(
      "$assemblyIntegrityObservation.pairs must cover every immediate-occurrence pair.",
    );
  }
  const pairs = root.pairs.map((entry, index) =>
    parsePairFacts(
      entry,
      expectedPairs[index]!,
      method,
      `$assemblyIntegrityObservation.pairs[${index}]`,
    )
  );

  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: bundleIdentity,
    method,
    importFacts,
    topology,
    occurrences,
    pairs,
  });
}

function parseInputBundleIdentity(
  value: unknown,
): AssemblyIntegrityInputBundleIdentity {
  const root = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount"],
    "$assemblyIntegrityObservation.inputBundle",
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    "$assemblyIntegrityObservation.inputBundle.schemaVersion",
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$assemblyIntegrityObservation.inputBundle.fingerprint",
    ),
    byteCount: positiveInteger(
      root.byteCount,
      "$assemblyIntegrityObservation.inputBundle.byteCount",
    ),
  });
}

function assertBundleIdentity(
  identity: AssemblyIntegrityInputBundleIdentity,
  bundle: AssemblyIntegrityInputBundle,
): void {
  if (
    !fingerprintsEqual(identity.fingerprint, bundle.fingerprint) ||
    identity.byteCount !== bundle.bytes.byteLength
  ) {
    throw new TypeError(
      "$assemblyIntegrityObservation.inputBundle must equal the exact packed bundle.",
    );
  }
}

function parseImportFacts(value: unknown, path: string): AssemblyIntegrityImportFacts {
  const root = exactRecord(value, ["unitSystem", "solidCount"], path);
  literalValue(root.unitSystem, "mm", `${path}.unitSystem`);
  return deepFreeze({
    unitSystem: "mm",
    solidCount: nonNegativeFiniteInteger(root.solidCount, `${path}.solidCount`),
  });
}

function parseTopology(value: unknown): AssemblyIntegrityTopologyFacts {
  const root = exactRecord(
    value,
    ["brepValidity", "degenerateEntityCount", "freeEdgeCount", "shellCount"],
    "$assemblyIntegrityObservation.topology",
  );
  return deepFreeze({
    brepValidity: parseObservationFact(
      root.brepValidity,
      "$assemblyIntegrityObservation.topology.brepValidity",
      (candidate, path) => {
        if (candidate !== "valid" && candidate !== "invalid") {
          throw new TypeError(`${path} must be valid or invalid.`);
        }
        return candidate;
      },
    ),
    degenerateEntityCount: parseObservationFact(
      root.degenerateEntityCount,
      "$assemblyIntegrityObservation.topology.degenerateEntityCount",
      nonNegativeFiniteInteger,
    ),
    freeEdgeCount: parseObservationFact(
      root.freeEdgeCount,
      "$assemblyIntegrityObservation.topology.freeEdgeCount",
      nonNegativeFiniteInteger,
    ),
    shellCount: parseObservationFact(
      root.shellCount,
      "$assemblyIntegrityObservation.topology.shellCount",
      nonNegativeFiniteInteger,
    ),
  });
}

function parseOccurrenceFacts(
  value: unknown,
  expected: AssemblyIntegrityInputBundle["manifest"]["occurrences"][number],
  path: string,
): AssemblyIntegrityOccurrenceFacts {
  const root = exactRecord(value, ["usageElementId", "target", "transform"], path);
  const usageElementId = safeId(root.usageElementId, `${path}.usageElementId`);
  if (usageElementId !== expected.usageElementId) {
    throw new TypeError(
      `${path}.usageElementId must preserve the exact occurrence label.`,
    );
  }
  const target = parseObservationFact(
    root.target,
    `${path}.target`,
    (candidate, candidatePath) => {
      const record = exactRecord(candidate, ["partDefinitionElementId"], candidatePath);
      return deepFreeze({
        partDefinitionElementId: safeId(
          record.partDefinitionElementId,
          `${candidatePath}.partDefinitionElementId`,
        ),
      });
    },
  );
  if (
    target.status === "observed" &&
    target.value.partDefinitionElementId !== expected.partDefinitionElementId
  ) {
    throw new TypeError(
      `${path}.target must equal the exact occurrence target identity.`,
    );
  }
  const transform = parseObservationFact(
    root.transform,
    `${path}.transform`,
    (candidate, candidatePath) => {
      const record = exactRecord(
        candidate,
        ["expectedPlacement", "observedPlacement"],
        candidatePath,
      );
      return deepFreeze({
        expectedPlacement: parsePlacement(
          record.expectedPlacement,
          `${candidatePath}.expectedPlacement`,
        ),
        observedPlacement: parsePlacement(
          record.observedPlacement,
          `${candidatePath}.observedPlacement`,
        ),
      });
    },
  );
  if (
    transform.status === "observed" &&
    !samePlacement(transform.value.expectedPlacement, expected.expectedPlacement)
  ) {
    throw new TypeError(`${path}.transform.expectedPlacement must equal the bundle.`);
  }
  return deepFreeze({ usageElementId, target, transform });
}

function parsePairFacts(
  value: unknown,
  expected: {
    readonly firstUsageElementId: string;
    readonly secondUsageElementId: string;
  },
  method: AssemblyIntegrityMethodIdentity,
  path: string,
): AssemblyIntegrityPairFacts {
  const root = exactRecord(
    value,
    [
      "firstUsageElementId",
      "secondUsageElementId",
      "linearToleranceMm",
      "minimumDistanceMm",
      "intersectionVolumeMm3",
      "contact",
    ],
    path,
  );
  const firstUsageElementId = safeId(
    root.firstUsageElementId,
    `${path}.firstUsageElementId`,
  );
  const secondUsageElementId = safeId(
    root.secondUsageElementId,
    `${path}.secondUsageElementId`,
  );
  if (
    firstUsageElementId !== expected.firstUsageElementId ||
    secondUsageElementId !== expected.secondUsageElementId
  ) {
    throw new TypeError(`${path} must use the exact canonical pair order.`);
  }
  const linearToleranceMm = nonNegativeFinite(
    root.linearToleranceMm,
    `${path}.linearToleranceMm`,
  );
  if (!Object.is(linearToleranceMm, method.linearToleranceMm)) {
    throw new TypeError(
      `${path}.linearToleranceMm must equal the bound method tolerance.`,
    );
  }
  return deepFreeze({
    firstUsageElementId,
    secondUsageElementId,
    linearToleranceMm,
    minimumDistanceMm: parseObservationFact(
      root.minimumDistanceMm,
      `${path}.minimumDistanceMm`,
      nonNegativeFinite,
    ),
    intersectionVolumeMm3: parseObservationFact(
      root.intersectionVolumeMm3,
      `${path}.intersectionVolumeMm3`,
      nonNegativeFinite,
    ),
    contact: parseObservationFact(
      root.contact,
      `${path}.contact`,
      (candidate, candidatePath) => {
        if (candidate !== "contact" && candidate !== "no-contact") {
          throw new TypeError(`${candidatePath} must be contact or no-contact.`);
        }
        return candidate;
      },
    ),
  });
}

function parseObservationFact<T>(
  value: unknown,
  path: string,
  parseObserved: (value: unknown, path: string) => T,
): AssemblyIntegrityFact<T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an observation state object.`);
  }
  const status = (value as Record<string, unknown>).status;
  if (status === "observed") {
    const root = exactRecord(value, ["status", "value"], path);
    return deepFreeze({
      status: "observed" as const,
      value: parseObserved(root.value, `${path}.value`),
    });
  }
  if (status === "unresolved") {
    const root = exactRecord(value, ["status", "reason"], path);
    if (root.reason !== "identity-missing" && root.reason !== "observability-missing") {
      throw new TypeError(
        `${path}.reason must name missing identity or observability.`,
      );
    }
    return deepFreeze({ status: "unresolved" as const, reason: root.reason });
  }
  if (status === "unavailable") {
    const root = exactRecord(value, ["status", "reason"], path);
    literalValue(root.reason, "unsupported", `${path}.reason`);
    return deepFreeze({ status: "unavailable" as const, reason: "unsupported" });
  }
  throw new TypeError(`${path}.status must be observed, unresolved, or unavailable.`);
}

function parsePlacement(
  value: unknown,
  path: string,
): AssemblyIntegrityExpectedPlacement {
  const root = exactRecord(value, ["translationMm", "rotationDeg"], path);
  return deepFreeze({
    translationMm: vector3(root.translationMm, `${path}.translationMm`),
    rotationDeg: vector3(root.rotationDeg, `${path}.rotationDeg`),
  });
}

function expectedPairLabels(
  inputBundle: AssemblyIntegrityInputBundle,
): readonly {
  readonly firstUsageElementId: string;
  readonly secondUsageElementId: string;
}[] {
  const occurrences = inputBundle.manifest.occurrences;
  const pairs: { firstUsageElementId: string; secondUsageElementId: string }[] = [];
  for (let first = 0; first < occurrences.length; first += 1) {
    for (let second = first + 1; second < occurrences.length; second += 1) {
      pairs.push({
        firstUsageElementId: occurrences[first]!.usageElementId,
        secondUsageElementId: occurrences[second]!.usageElementId,
      });
    }
  }
  if (pairs.length > ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS) {
    throw new TypeError("The bound bundle exceeds the pair ceiling.");
  }
  return pairs;
}

function sameMethod(
  left: AssemblyIntegrityMethodIdentity,
  right: AssemblyIntegrityMethodIdentity,
): boolean {
  return left.id === right.id && left.version === right.version &&
    Object.is(left.linearToleranceMm, right.linearToleranceMm);
}

function samePlacement(
  left: AssemblyIntegrityExpectedPlacement,
  right: AssemblyIntegrityExpectedPlacement,
): boolean {
  return left.translationMm.every((value, index) =>
    value === right.translationMm[index]
  ) &&
    left.rotationDeg.every((value, index) => value === right.rotationDeg[index]);
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must contain exactly three finite numbers.`);
  }
  return deepFreeze(
    [
      finite(value[0], `${path}[0]`),
      finite(value[1], `${path}[1]`),
      finite(value[2], `${path}[2]`),
    ] as const,
  );
}

function nonNegativeFinite(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed < 0 || Object.is(parsed, -0)) {
    throw new TypeError(`${path} must be a non-negative finite number.`);
  }
  return parsed;
}

function nonNegativeFiniteInteger(value: unknown, path: string): number {
  const parsed = nonNegativeFinite(value, path);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return parsed;
}
