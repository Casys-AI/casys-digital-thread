/**
 * Generic admitted SPICE observation evaluation method.
 *
 * Server-owned deterministic closed comparator over exact native ngspice L3
 * observations and a sealed electrical observation method sheet. This is a
 * bounded digital-thread comparator. It is not physical, vendor, safety,
 * certification, or ngspice-as-oracle proof. It never calls SysON.
 */

import { sha256Hex } from "../../../compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  rejectDuplicates,
} from "../../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import type { RequirementEvaluationStatus } from "../../../thread/thread-snapshot.ts";
import {
  criterionDeclaredUnit,
  type ElectricalObservationMethodCriterion,
  type ElectricalObservationMethodSheet,
} from "../../observation-method-sheet.ts";
import {
  collectNativeObservationNames,
  type ElectricalObservationNativeBinding,
  evaluateElectricalObservationExpression,
} from "./expression.ts";

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA =
  "spice-admitted-observation-evaluation-method/1.0" as const;

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID =
  "admitted-spice-observations-v1" as const;

export const ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_SCHEMA =
  "electrical-observation-unit-algebra/1.0" as const;
export const ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID =
  "electrical-observation-unit-algebra" as const;
export const ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION = "1.0.0" as const;

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS = deepFreeze(
  [
    "bounded-digital-thread-comparator",
    "not-physical-proof",
    "not-vendor-proof",
    "not-safety-claim",
    "not-certification",
    "ngspice-is-not-oracle",
    "syson-decimal-requirements-unavailable",
    "brief-and-method-sheet-authority",
  ] as const,
);

export const ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_DOCUMENT = deepFreeze({
  schemaVersion: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_SCHEMA,
  id: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
  version: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION,
  units: ["V", "A", "W", "1"],
  products: [{ left: "V", right: "A", result: "W" }],
  scalar: "1",
});

export interface SpiceAdmittedObservationEvaluationMethod {
  readonly schemaVersion: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA;
  readonly profile: {
    readonly id: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID;
    readonly version: "1.0.0";
  };
  readonly unitAlgebra: {
    readonly id: typeof ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID;
    readonly version: typeof ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION;
    readonly fingerprint: ContentFingerprint;
  };
  readonly criterionIds: readonly string[];
  readonly nativeObservationNames: readonly string[];
}

export interface SpiceAdmittedCriterionEvaluation {
  readonly criterionId: string;
  readonly status: RequirementEvaluationStatus;
  readonly message: string;
  readonly actual?: { readonly value: number; readonly unit: string };
  readonly comparator: ElectricalObservationMethodCriterion["comparator"];
  readonly natives: readonly string[];
}

export interface SpiceAdmittedObservationEvaluationResult {
  readonly overall: RequirementEvaluationStatus;
  readonly method: SpiceAdmittedObservationEvaluationMethod;
  readonly evaluations: readonly SpiceAdmittedCriterionEvaluation[];
}

export async function electricalObservationUnitAlgebra(): Promise<{
  readonly id: typeof ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID;
  readonly version: typeof ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION;
  readonly fingerprint: ContentFingerprint;
}> {
  return {
    id: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
    version: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION,
    fingerprint: await sha256Fingerprint(
      ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_DOCUMENT,
    ),
  };
}

export async function deriveSpiceAdmittedObservationEvaluationMethod(
  sheet: ElectricalObservationMethodSheet,
): Promise<SpiceAdmittedObservationEvaluationMethod> {
  const nativeObservationNames = [
    ...new Set(
      sheet.criteria.flatMap((criterion) =>
        collectNativeObservationNames(criterion.expression)
      ),
    ),
  ].sort();
  return validateSpiceAdmittedObservationEvaluationMethod({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    profile: {
      id: SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
      version: "1.0.0",
    },
    unitAlgebra: await electricalObservationUnitAlgebra(),
    criterionIds: sheet.criteria.map((criterion) => criterion.id),
    nativeObservationNames,
  });
}

export function fingerprintSpiceAdmittedObservationEvaluationMethod(
  method: SpiceAdmittedObservationEvaluationMethod,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(
    validateSpiceAdmittedObservationEvaluationMethod(method),
  );
}

export function validateSpiceAdmittedObservationEvaluationMethod(
  value: unknown,
): SpiceAdmittedObservationEvaluationMethod {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "profile",
      "unitAlgebra",
      "criterionIds",
      "nativeObservationNames",
    ],
    "$evaluationMethod",
  );
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    "$evaluationMethod.schemaVersion",
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version"],
    "$evaluationMethod.profile",
  );
  literalValue(
    profile.id,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    "$evaluationMethod.profile.id",
  );
  literalValue(profile.version, "1.0.0", "$evaluationMethod.profile.version");
  const unitAlgebra = exactRecord(
    root.unitAlgebra,
    ["id", "version", "fingerprint"],
    "$evaluationMethod.unitAlgebra",
  );
  literalValue(
    unitAlgebra.id,
    ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
    "$evaluationMethod.unitAlgebra.id",
  );
  literalValue(
    unitAlgebra.version,
    ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION,
    "$evaluationMethod.unitAlgebra.version",
  );
  const fingerprint = parseFingerprint(
    unitAlgebra.fingerprint,
    "$evaluationMethod.unitAlgebra.fingerprint",
  );
  const criterionIds = arrayOfStrings(
    root.criterionIds,
    "$evaluationMethod.criterionIds",
  );
  if (criterionIds.length === 0) {
    throw new TypeError("$evaluationMethod.criterionIds must not be empty.");
  }
  rejectDuplicates(criterionIds, "$evaluationMethod.criterionIds");
  const nativeObservationNames = arrayOfStrings(
    root.nativeObservationNames,
    "$evaluationMethod.nativeObservationNames",
  );
  rejectDuplicates(
    nativeObservationNames,
    "$evaluationMethod.nativeObservationNames",
  );
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    profile: {
      id: SPICE_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
      version: "1.0.0",
    },
    unitAlgebra: {
      id: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_ID,
      version: ELECTRICAL_OBSERVATION_UNIT_ALGEBRA_VERSION,
      fingerprint,
    },
    criterionIds,
    nativeObservationNames,
  });
}

export function selectUniqueSpiceNatives(
  method: SpiceAdmittedObservationEvaluationMethod,
  observables: readonly ElectricalObservationNativeBinding[],
): {
  readonly selected: readonly ElectricalObservationNativeBinding[];
  readonly unresolved: readonly {
    readonly name: string;
    readonly reason: "native-missing" | "native-not-unique";
  }[];
} {
  const unresolved: Array<{
    readonly name: string;
    readonly reason: "native-missing" | "native-not-unique";
  }> = [];
  const selected: ElectricalObservationNativeBinding[] = [];
  for (const name of method.nativeObservationNames) {
    const matches = observables.filter((item) => item.name === name);
    if (matches.length === 0) {
      unresolved.push({ name, reason: "native-missing" });
      continue;
    }
    if (matches.length !== 1) {
      unresolved.push({ name, reason: "native-not-unique" });
      continue;
    }
    selected.push(matches[0]!);
  }
  return deepFreeze({ selected, unresolved });
}

export async function evaluateAdmittedSpiceObservations(
  sheet: ElectricalObservationMethodSheet,
  observables: readonly ElectricalObservationNativeBinding[],
): Promise<SpiceAdmittedObservationEvaluationResult> {
  const method = await deriveSpiceAdmittedObservationEvaluationMethod(sheet);
  const nativeSelection = selectUniqueSpiceNatives(method, observables);
  const nativeGaps = new Map(
    nativeSelection.unresolved.map((item) => [item.name, item.reason]),
  );
  const evaluations = sheet.criteria.map((criterion) =>
    evaluateCriterion(criterion, nativeSelection.selected, nativeGaps)
  );
  return deepFreeze({
    overall: overallStatus(evaluations.map((item) => item.status)),
    method,
    evaluations,
  });
}

export function overallStatus(
  statuses: readonly RequirementEvaluationStatus[],
): RequirementEvaluationStatus {
  if (statuses.some((status) => status === "error")) return "error";
  if (statuses.some((status) => status === "unresolved")) return "unresolved";
  if (statuses.some((status) => status === "fail")) return "fail";
  return "pass";
}

function evaluateCriterion(
  criterion: ElectricalObservationMethodCriterion,
  natives: readonly ElectricalObservationNativeBinding[],
  nativeGaps: ReadonlyMap<string, "native-missing" | "native-not-unique">,
): SpiceAdmittedCriterionEvaluation {
  const used = collectNativeObservationNames(criterion.expression);
  for (const name of used) {
    const gap = nativeGaps.get(name);
    if (gap === "native-missing") {
      return {
        criterionId: criterion.id,
        status: "unresolved",
        comparator: criterion.comparator,
        natives: used,
        message: `Native observation "${name}" is absent from exact L3 evidence.`,
      };
    }
    if (gap === "native-not-unique") {
      return {
        criterionId: criterion.id,
        status: "unresolved",
        comparator: criterion.comparator,
        natives: used,
        message: `Native observation "${name}" is not unique on exact L3 evidence.`,
      };
    }
  }
  const evaluated = evaluateElectricalObservationExpression(
    criterion.expression,
    natives,
  );
  if (evaluated.status !== "ok") {
    return {
      criterionId: criterion.id,
      status: evaluated.status === "error" ? "error" : "unresolved",
      comparator: criterion.comparator,
      natives: used,
      message: evaluated.message,
    };
  }
  const declaredUnit = criterionDeclaredUnit(criterion);
  if (evaluated.quantity.unit !== declaredUnit) {
    return {
      criterionId: criterion.id,
      status: "unresolved",
      comparator: criterion.comparator,
      natives: used,
      actual: evaluated.quantity,
      message:
        `Derived unit ${evaluated.quantity.unit} does not match comparator unit ${declaredUnit}.`,
    };
  }
  const actual = evaluated.quantity;
  if (criterion.comparator === "between-inclusive") {
    const min = criterion.bounds!.min.value;
    const max = criterion.bounds!.max.value;
    const pass = actual.value >= min && actual.value <= max;
    return {
      criterionId: criterion.id,
      status: pass ? "pass" : "fail",
      comparator: criterion.comparator,
      natives: used,
      actual,
      message: pass
        ? "The derived observation is inside the reviewed inclusive bounds."
        : "The derived observation is outside the reviewed inclusive bounds.",
    };
  }
  const limit = criterion.threshold!.value;
  const pass = criterion.comparator === "<="
    ? actual.value <= limit
    : actual.value >= limit;
  return {
    criterionId: criterion.id,
    status: pass ? "pass" : "fail",
    comparator: criterion.comparator,
    natives: used,
    actual,
    message: pass
      ? "The derived observation satisfies the reviewed comparator."
      : "The derived observation does not satisfy the reviewed comparator.",
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  return {
    algorithm: "sha256",
    digest: sha256Hex(input.digest, `${path}.digest`),
  };
}

function arrayOfStrings(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item !== item.trim()) {
      throw new TypeError(
        `${path}[${index}] must be a non-empty string without edge whitespace.`,
      );
    }
    return item;
  });
}
