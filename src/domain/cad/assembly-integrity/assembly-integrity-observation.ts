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
/** Structural recross tolerance shared with the fixed provider matrix parser. */
export const ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE = 1e-9;

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
  readonly unitSystem: AssemblyIntegrityFact<"mm">;
  readonly solidCount: AssemblyIntegrityFact<number>;
}

export interface AssemblyIntegrityTopologyFacts {
  readonly brepValidity: AssemblyIntegrityFact<"valid" | "invalid">;
  readonly degenerateEdgeCount: AssemblyIntegrityFact<number>;
  readonly freeEdgeCount: AssemblyIntegrityFact<number>;
  readonly shellCount: AssemblyIntegrityFact<number>;
}

/** Canonical row-major homogeneous 4x4 placement matrix in millimetres. */
export type AssemblyIntegrityTransformMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface AssemblyIntegrityOccurrenceFacts {
  readonly usageElementId: string;
  readonly target: AssemblyIntegrityFact<{ readonly partDefinitionElementId: string }>;
  readonly transform: AssemblyIntegrityFact<{
    readonly expectedPlacement: AssemblyIntegrityExpectedPlacement;
    /** Derived from the exact bundle, never reverse-engineered from a matrix. */
    readonly expectedMatrix: AssemblyIntegrityTransformMatrix;
    /** Provider-observed factual matrix; no match criterion is applied here. */
    readonly observedMatrix: AssemblyIntegrityTransformMatrix;
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
  readonly importability: AssemblyIntegrityFact<"imported" | "failed">;
  readonly importFacts: AssemblyIntegrityImportFacts;
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
  const observation = validateAssemblyIntegrityObservation(value);
  assertBundleIdentity(observation.inputBundle, inputBundle);
  if (!sameMethod(observation.method, inputBundle.manifest.method)) {
    throw new TypeError(
      "$assemblyIntegrityObservation.method must equal the exact bound method.",
    );
  }
  if (
    observation.importFacts.unitSystem.status === "observed" &&
    observation.importFacts.unitSystem.value !== inputBundle.manifest.unitSystem
  ) {
    throw new TypeError(
      "$assemblyIntegrityObservation.importFacts.unitSystem diverges from the exact STEP basis.",
    );
  }
  if (observation.occurrences.length !== inputBundle.manifest.occurrences.length) {
    throw new TypeError(
      "$assemblyIntegrityObservation.occurrences must cover every immediate occurrence.",
    );
  }
  for (const [index, occurrence] of observation.occurrences.entries()) {
    assertOccurrenceMatches(
      occurrence,
      inputBundle.manifest.occurrences[index]!,
      `$assemblyIntegrityObservation.occurrences[${index}]`,
    );
  }
  const expectedPairs = expectedPairLabels(inputBundle);
  if (observation.pairs.length !== expectedPairs.length) {
    throw new TypeError(
      "$assemblyIntegrityObservation.pairs must cover every immediate-occurrence pair.",
    );
  }
  for (const [index, pair] of observation.pairs.entries()) {
    assertPairMatches(
      pair,
      expectedPairs[index]!,
      `$assemblyIntegrityObservation.pairs[${index}]`,
    );
  }
  return observation;
}

/**
 * Validate a persisted normalized observation without reopening its packed
 * input bytes. It preserves every self-contained factual invariant; a caller
 * that holds the exact bundle must additionally call
 * `parseAssemblyIntegrityObservation` to recross its geometry basis.
 */
export function validateAssemblyIntegrityObservation(
  value: unknown,
  path = "$assemblyIntegrityObservation",
): AssemblyIntegrityObservation {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "inputBundle",
      "method",
      "importability",
      "importFacts",
      "topology",
      "occurrences",
      "pairs",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  literalValue(
    operation.id,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    `${path}.operation.version`,
  );
  const bundleIdentity = parseInputBundleIdentity(
    root.inputBundle,
    `${path}.inputBundle`,
  );
  const method = validateAssemblyIntegrityMethodIdentity(
    root.method,
    `${path}.method`,
  );

  const importability = parseObservationFact(
    root.importability,
    `${path}.importability`,
    (candidate, path) => {
      if (candidate !== "imported" && candidate !== "failed") {
        throw new TypeError(`${path} must be imported or failed.`);
      }
      return candidate;
    },
  );
  const importFacts = parseImportFacts(
    root.importFacts,
    `${path}.importFacts`,
  );
  const topology = parseTopology(root.topology, `${path}.topology`);

  if (!Array.isArray(root.occurrences)) {
    throw new TypeError(`${path}.occurrences must be an array.`);
  }
  if (root.occurrences.length > ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES) {
    throw new TypeError(
      `${path}.occurrences exceeds the occurrence ceiling.`,
    );
  }
  const occurrences = root.occurrences.map((entry, index) =>
    parseOccurrenceFacts(
      entry,
      `${path}.occurrences[${index}]`,
    )
  );
  assertCanonicalOccurrenceLabels(occurrences, `${path}.occurrences`);

  if (!Array.isArray(root.pairs)) {
    throw new TypeError(`${path}.pairs must be an array.`);
  }
  if (root.pairs.length > ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS) {
    throw new TypeError(
      `${path}.pairs exceeds the pair ceiling.`,
    );
  }
  const pairs = root.pairs.map((entry, index) =>
    parsePairFacts(
      entry,
      method,
      `${path}.pairs[${index}]`,
    )
  );
  assertPairsCoverOccurrences(pairs, occurrences, `${path}.pairs`);
  assertImportFailureGapInvariant(
    importability,
    importFacts,
    topology,
    occurrences,
    pairs,
  );

  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: bundleIdentity,
    method,
    importability,
    importFacts,
    topology,
    occurrences,
    pairs,
  });
}

function parseInputBundleIdentity(
  value: unknown,
  path: string,
): AssemblyIntegrityInputBundleIdentity {
  const root = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      `${path}.fingerprint`,
    ),
    byteCount: positiveInteger(
      root.byteCount,
      `${path}.byteCount`,
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
  return deepFreeze({
    unitSystem: parseObservationFact(
      root.unitSystem,
      `${path}.unitSystem`,
      (candidate, candidatePath) => {
        literalValue(candidate, "mm", candidatePath);
        return "mm" as const;
      },
    ),
    solidCount: parseObservationFact(
      root.solidCount,
      `${path}.solidCount`,
      nonNegativeFiniteInteger,
    ),
  });
}

function parseTopology(value: unknown, path: string): AssemblyIntegrityTopologyFacts {
  const root = exactRecord(
    value,
    ["brepValidity", "degenerateEdgeCount", "freeEdgeCount", "shellCount"],
    path,
  );
  return deepFreeze({
    brepValidity: parseObservationFact(
      root.brepValidity,
      `${path}.brepValidity`,
      (candidate, path) => {
        if (candidate !== "valid" && candidate !== "invalid") {
          throw new TypeError(`${path} must be valid or invalid.`);
        }
        return candidate;
      },
    ),
    degenerateEdgeCount: parseObservationFact(
      root.degenerateEdgeCount,
      `${path}.degenerateEdgeCount`,
      nonNegativeFiniteInteger,
    ),
    freeEdgeCount: parseObservationFact(
      root.freeEdgeCount,
      `${path}.freeEdgeCount`,
      nonNegativeFiniteInteger,
    ),
    shellCount: parseObservationFact(
      root.shellCount,
      `${path}.shellCount`,
      nonNegativeFiniteInteger,
    ),
  });
}

function parseOccurrenceFacts(
  value: unknown,
  path: string,
): AssemblyIntegrityOccurrenceFacts {
  const root = exactRecord(value, ["usageElementId", "target", "transform"], path);
  const usageElementId = safeId(root.usageElementId, `${path}.usageElementId`);
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
  const transform = parseObservationFact(
    root.transform,
    `${path}.transform`,
    (candidate, candidatePath) => {
      const record = exactRecord(
        candidate,
        ["expectedPlacement", "expectedMatrix", "observedMatrix"],
        candidatePath,
      );
      return deepFreeze({
        expectedPlacement: parsePlacement(
          record.expectedPlacement,
          `${candidatePath}.expectedPlacement`,
        ),
        expectedMatrix: parseAssemblyIntegrityTransformMatrix(
          record.expectedMatrix,
          `${candidatePath}.expectedMatrix`,
        ),
        observedMatrix: parseAssemblyIntegrityTransformMatrix(
          record.observedMatrix,
          `${candidatePath}.observedMatrix`,
        ),
      });
    },
  );
  if (
    transform.status === "observed" &&
    !sameTransformMatrix(
      transform.value.expectedMatrix,
      assemblyIntegrityExpectedPlacementMatrix(transform.value.expectedPlacement),
    )
  ) {
    throw new TypeError(
      `${path}.transform.expectedMatrix must be derived from the exact bundle placement.`,
    );
  }
  return deepFreeze({ usageElementId, target, transform });
}

function parsePairFacts(
  value: unknown,
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
  if (firstUsageElementId >= secondUsageElementId) {
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

function assertOccurrenceMatches(
  actual: AssemblyIntegrityOccurrenceFacts,
  expected: AssemblyIntegrityInputBundle["manifest"]["occurrences"][number],
  path: string,
): void {
  if (actual.usageElementId !== expected.usageElementId) {
    throw new TypeError(
      `${path}.usageElementId must preserve the exact occurrence label.`,
    );
  }
  if (
    actual.target.status === "observed" &&
    actual.target.value.partDefinitionElementId !== expected.partDefinitionElementId
  ) {
    throw new TypeError(
      `${path}.target must equal the exact occurrence target identity.`,
    );
  }
  if (
    actual.transform.status === "observed" &&
    !samePlacement(actual.transform.value.expectedPlacement, expected.expectedPlacement)
  ) {
    throw new TypeError(`${path}.transform.expectedPlacement must equal the bundle.`);
  }
  if (
    actual.transform.status === "observed" &&
    !sameTransformMatrix(
      actual.transform.value.expectedMatrix,
      assemblyIntegrityExpectedPlacementMatrix(expected.expectedPlacement),
    )
  ) {
    throw new TypeError(
      `${path}.transform.expectedMatrix must be derived from the exact bundle placement.`,
    );
  }
}

function assertPairMatches(
  actual: AssemblyIntegrityPairFacts,
  expected: {
    readonly firstUsageElementId: string;
    readonly secondUsageElementId: string;
  },
  path: string,
): void {
  if (
    actual.firstUsageElementId !== expected.firstUsageElementId ||
    actual.secondUsageElementId !== expected.secondUsageElementId
  ) {
    throw new TypeError(`${path} must use the exact canonical pair order.`);
  }
}

function assertCanonicalOccurrenceLabels(
  occurrences: readonly AssemblyIntegrityOccurrenceFacts[],
  path: string,
): void {
  for (let index = 1; index < occurrences.length; index += 1) {
    if (
      occurrences[index - 1]!.usageElementId >=
        occurrences[index]!.usageElementId
    ) {
      throw new TypeError(`${path} labels must be unique and canonically sorted.`);
    }
  }
}

function assertPairsCoverOccurrences(
  pairs: readonly AssemblyIntegrityPairFacts[],
  occurrences: readonly AssemblyIntegrityOccurrenceFacts[],
  path: string,
): void {
  const expected = expectedPairLabelsForUsageElementIds(
    occurrences.map((occurrence) => occurrence.usageElementId),
  );
  if (
    pairs.length !== expected.length ||
    pairs.some((pair, index) =>
      pair.firstUsageElementId !== expected[index]!.firstUsageElementId ||
      pair.secondUsageElementId !== expected[index]!.secondUsageElementId
    )
  ) {
    throw new TypeError(`${path} must cover every canonical occurrence pair.`);
  }
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
  return expectedPairLabelsForUsageElementIds(
    inputBundle.manifest.occurrences.map((occurrence) => occurrence.usageElementId),
  );
}

function expectedPairLabelsForUsageElementIds(
  occurrences: readonly string[],
): readonly {
  readonly firstUsageElementId: string;
  readonly secondUsageElementId: string;
}[] {
  const pairs: { firstUsageElementId: string; secondUsageElementId: string }[] = [];
  for (let first = 0; first < occurrences.length; first += 1) {
    for (let second = first + 1; second < occurrences.length; second += 1) {
      pairs.push({
        firstUsageElementId: occurrences[first]!,
        secondUsageElementId: occurrences[second]!,
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

function sameTransformMatrix(
  left: AssemblyIntegrityTransformMatrix,
  right: AssemblyIntegrityTransformMatrix,
): boolean {
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Convert the bundle's canonical right-handed millimetre placement to a
 * row-major homogeneous matrix. The geometry-module/input-bundle convention
 * composes Rx * Ry * Rz, then translation. This is one-way recrossing only:
 * it never attempts an Euler inversion of an observed provider matrix.
 */
export function assemblyIntegrityExpectedPlacementMatrix(
  placement: AssemblyIntegrityExpectedPlacement,
): AssemblyIntegrityTransformMatrix {
  const [translationX, translationY, translationZ] = placement.translationMm;
  const rotationX = placement.rotationDeg[0] * Math.PI / 180;
  const rotationY = placement.rotationDeg[1] * Math.PI / 180;
  const rotationZ = placement.rotationDeg[2] * Math.PI / 180;
  const cosineX = Math.cos(rotationX);
  const sineX = Math.sin(rotationX);
  const cosineY = Math.cos(rotationY);
  const sineY = Math.sin(rotationY);
  const cosineZ = Math.cos(rotationZ);
  const sineZ = Math.sin(rotationZ);
  return matrix16([
    cosineY * cosineZ,
    -cosineY * sineZ,
    sineY,
    translationX,
    sineX * sineY * cosineZ + cosineX * sineZ,
    -sineX * sineY * sineZ + cosineX * cosineZ,
    -sineX * cosineY,
    translationY,
    -cosineX * sineY * cosineZ + sineX * sineZ,
    cosineX * sineY * sineZ + sineX * cosineZ,
    cosineX * cosineY,
    translationZ,
    0,
    0,
    0,
    1,
  ], "$assemblyIntegrityExpectedPlacementMatrix");
}

/**
 * Validate and canonicalize a provider-observed transform. The last row is
 * structural evidence for a homogeneous affine matrix; no tolerance/match
 * rule is inferred from its rotation or translation values here.
 */
export function parseAssemblyIntegrityTransformMatrix(
  value: unknown,
  path = "$assemblyIntegrityTransformMatrix",
): AssemblyIntegrityTransformMatrix {
  return matrix16(value, path);
}

function matrix16(
  value: unknown,
  path: string,
): AssemblyIntegrityTransformMatrix {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new TypeError(`${path} must contain exactly sixteen finite numbers.`);
  }
  const matrix = value.map((entry, index) =>
    normalizeZero(finite(entry, `${path}[${index}]`))
  );
  if (
    matrix[12] !== 0 || matrix[13] !== 0 || matrix[14] !== 0 ||
    matrix[15] !== 1
  ) {
    throw new TypeError(
      `${path} must use the row-major homogeneous bottom row [0, 0, 0, 1].`,
    );
  }
  assertRightHandedRigidRotation(matrix, path);
  return deepFreeze(matrix as unknown as AssemblyIntegrityTransformMatrix);
}

function assertRightHandedRigidRotation(
  matrix: readonly number[],
  path: string,
): void {
  const rotation = [
    [matrix[0]!, matrix[1]!, matrix[2]!],
    [matrix[4]!, matrix[5]!, matrix[6]!],
    [matrix[8]!, matrix[9]!, matrix[10]!],
  ] as const;
  for (let row = 0; row < rotation.length; row += 1) {
    const norm = dot(rotation[row]!, rotation[row]!);
    if (Math.abs(norm - 1) > ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE) {
      throw new TypeError(`${path} rotation row ${row} is not unit length.`);
    }
    for (let other = row + 1; other < rotation.length; other += 1) {
      if (
        Math.abs(dot(rotation[row]!, rotation[other]!)) >
          ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE
      ) {
        throw new TypeError(`${path} rotation rows are not orthogonal.`);
      }
    }
  }
  const determinant = rotation[0]![0]! *
      (rotation[1]![1]! * rotation[2]![2]! -
        rotation[1]![2]! * rotation[2]![1]!) -
    rotation[0]![1]! *
      (rotation[1]![0]! * rotation[2]![2]! -
        rotation[1]![2]! * rotation[2]![0]!) +
    rotation[0]![2]! *
      (rotation[1]![0]! * rotation[2]![1]! -
        rotation[1]![1]! * rotation[2]![0]!);
  if (
    Math.abs(determinant - 1) > ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE
  ) {
    throw new TypeError(`${path} rotation determinant must be +1.`);
  }
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function assertImportFailureGapInvariant(
  importability: AssemblyIntegrityFact<"imported" | "failed">,
  importFacts: AssemblyIntegrityImportFacts,
  topology: AssemblyIntegrityTopologyFacts,
  occurrences: readonly AssemblyIntegrityOccurrenceFacts[],
  pairs: readonly AssemblyIntegrityPairFacts[],
): void {
  if (importability.status !== "observed" || importability.value !== "failed") {
    return;
  }
  const requireGap = (fact: AssemblyIntegrityFact<unknown>, path: string) => {
    if (
      fact.status !== "unresolved" || fact.reason !== "observability-missing"
    ) {
      throw new TypeError(
        `${path} must remain unresolved with observability-missing after a failed import.`,
      );
    }
  };
  requireGap(
    importFacts.unitSystem,
    "$assemblyIntegrityObservation.importFacts.unitSystem",
  );
  requireGap(
    importFacts.solidCount,
    "$assemblyIntegrityObservation.importFacts.solidCount",
  );
  requireGap(
    topology.brepValidity,
    "$assemblyIntegrityObservation.topology.brepValidity",
  );
  requireGap(
    topology.degenerateEdgeCount,
    "$assemblyIntegrityObservation.topology.degenerateEdgeCount",
  );
  requireGap(
    topology.freeEdgeCount,
    "$assemblyIntegrityObservation.topology.freeEdgeCount",
  );
  requireGap(topology.shellCount, "$assemblyIntegrityObservation.topology.shellCount");
  occurrences.forEach((occurrence, index) => {
    requireGap(
      occurrence.target,
      `$assemblyIntegrityObservation.occurrences[${index}].target`,
    );
    requireGap(
      occurrence.transform,
      `$assemblyIntegrityObservation.occurrences[${index}].transform`,
    );
  });
  pairs.forEach((pair, index) => {
    requireGap(
      pair.minimumDistanceMm,
      `$assemblyIntegrityObservation.pairs[${index}].minimumDistanceMm`,
    );
    requireGap(
      pair.intersectionVolumeMm3,
      `$assemblyIntegrityObservation.pairs[${index}].intersectionVolumeMm3`,
    );
    requireGap(pair.contact, `$assemblyIntegrityObservation.pairs[${index}].contact`);
  });
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
