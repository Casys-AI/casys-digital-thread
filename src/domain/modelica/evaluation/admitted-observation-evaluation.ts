/**
 * Generic admitted Modelica observation evaluation method.
 *
 * This is not an LED oracle and not an L4 verdict. It names exact v2 output
 * symbols, `final`/`max_abs` roles, requirement identities and a unit policy.
 * Caller equations and values are refused. Absence of a unit policy is
 * unresolved, never an invented conversion.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { ModelicaThermalMethodSheet } from "../thermal-method-sheet.ts";
import type { ThermalMethodSheetSourceSymbol } from "../thermal-method-sheet-recross.ts";

export const MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA =
  "modelica-admitted-observation-evaluation-method/1.0" as const;

export const MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID =
  "admitted-modelica-observations-v1" as const;

export const MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_SCHEMA =
  "admitted-modelica-unit-policy/1.0" as const;
export const MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID =
  "admitted-modelica-unit-identity" as const;
export const MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_VERSION = "1.0.0" as const;

export type AdmittedObservationRole = "final" | "max_abs";

export interface AdmittedObservationUnitPolicy {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

export interface AdmittedObservationSelection {
  readonly outputSymbolId: string;
  readonly role: AdmittedObservationRole;
  readonly requirementElementId: string;
  readonly requirementMetric: string;
  readonly declaredUnit: string;
}

/** Signed sheet identity used to select one current Thread requirement. */
export interface ThermalRequirementPairIdentity {
  readonly requirementElementId: string;
  readonly requirementMetric: string;
}

/** Structural Thread requirement fields needed for the pair recross. */
export interface ThreadRequirementPairCandidate {
  readonly id: string;
  readonly trace: { readonly elementId: string };
  readonly criterion: { readonly metric: string };
}

export interface AdmittedObservationEvaluationMethod {
  readonly schemaVersion: typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA;
  readonly profile: {
    readonly id: typeof MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID;
    readonly version: "1.0.0";
    readonly admittedRoles: readonly ["final", "max_abs"];
  };
  readonly unitPolicy: AdmittedObservationUnitPolicy;
  readonly selections: readonly AdmittedObservationSelection[];
}

export interface AdmittedObservationSourceOutput {
  readonly name: string;
  readonly unit: string;
}

export interface AdmittedObservationPublishedMetric {
  readonly outputName: string;
  readonly statistic: AdmittedObservationRole;
  readonly unit: string;
}

export type AdmittedUnitNormalization =
  | { readonly status: "matched"; readonly unit: string }
  | { readonly status: "unresolved"; readonly reason: "unit-identity-mismatch" };

/**
 * Identity unit policy: exact declared string only. No conversion, no
 * invented magnitude. A mismatch stays unresolved.
 */
export function normalizeAdmittedObservationUnit(
  declaredUnit: string,
  observedUnit: string,
): AdmittedUnitNormalization {
  if (Object.is(declaredUnit, observedUnit)) {
    return { status: "matched", unit: declaredUnit };
  }
  return { status: "unresolved", reason: "unit-identity-mismatch" };
}

const ROOT_KEYS = [
  "schemaVersion",
  "profile",
  "unitPolicy",
  "selections",
] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ROLES = ["final", "max_abs"] as const;

/** Exact-string unit match only. No conversion, no invented magnitude. */
export const MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_DOCUMENT = deepFreeze({
  schemaVersion: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_SCHEMA,
  id: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID,
  version: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_VERSION,
  kind: "identity",
});

export async function admittedModelicaUnitIdentityPolicy(): Promise<
  AdmittedObservationUnitPolicy
> {
  return {
    id: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_ID,
    version: MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_VERSION,
    fingerprint: await sha256Fingerprint(
      MODELICA_ADMITTED_UNIT_IDENTITY_POLICY_DOCUMENT,
    ),
  };
}

export function deriveAdmittedObservationEvaluationMethod(
  sheet: ModelicaThermalMethodSheet,
  unitPolicy: AdmittedObservationUnitPolicy,
): AdmittedObservationEvaluationMethod {
  return validateAdmittedObservationEvaluationMethod({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    profile: {
      id: MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
      version: "1.0.0",
      admittedRoles: ["final", "max_abs"],
    },
    unitPolicy,
    selections: sheet.outputs.map((output) => ({
      outputSymbolId: output.modelSymbolId,
      role: output.role,
      requirementElementId: output.requirementElementId,
      requirementMetric: output.requirementMetric,
      declaredUnit: output.declaredUnit,
    })),
  });
}

export function fingerprintAdmittedObservationEvaluationMethod(
  method: AdmittedObservationEvaluationMethod,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateAdmittedObservationEvaluationMethod(method));
}

export function validateAdmittedObservationEvaluationMethod(
  value: unknown,
): AdmittedObservationEvaluationMethod {
  const root = exactRecord(value, ROOT_KEYS, "$evaluationMethod");
  literalValue(
    root.schemaVersion,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    "$evaluationMethod.schemaVersion",
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version", "admittedRoles"],
    "$evaluationMethod.profile",
  );
  literalValue(
    profile.id,
    MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
    "$evaluationMethod.profile.id",
  );
  literalValue(
    profile.version,
    "1.0.0",
    "$evaluationMethod.profile.version",
  );
  const admittedRoles = arrayOf(
    profile.admittedRoles,
    "$evaluationMethod.profile.admittedRoles",
  );
  if (
    admittedRoles.length !== 2 ||
    admittedRoles[0] !== "final" ||
    admittedRoles[1] !== "max_abs"
  ) {
    throw new TypeError(
      "$evaluationMethod.profile.admittedRoles must be exactly [final, max_abs].",
    );
  }
  const unitPolicy = parseUnitPolicy(
    root.unitPolicy,
    "$evaluationMethod.unitPolicy",
  );
  const selections = arrayOf(
    root.selections,
    "$evaluationMethod.selections",
  ).map((item, index) =>
    parseSelection(item, `$evaluationMethod.selections[${index}]`)
  );
  if (selections.length === 0) {
    throw new TypeError("$evaluationMethod.selections must not be empty.");
  }
  rejectDuplicates(
    selections.map((item) => `${item.outputSymbolId}:${item.role}`),
    "$evaluationMethod.selections roles",
  );
  rejectDuplicates(
    selections.map((item) => item.requirementElementId),
    "$evaluationMethod.selections requirements",
  );
  rejectDuplicates(
    selections.map((item) => `${item.requirementElementId}:${item.requirementMetric}`),
    "$evaluationMethod.selections requirement pairs",
  );
  return deepFreeze({
    schemaVersion: MODELICA_ADMITTED_OBSERVATION_EVALUATION_METHOD_SCHEMA,
    profile: {
      id: MODELICA_ADMITTED_OBSERVATION_EVALUATION_PROFILE_ID,
      version: "1.0.0",
      admittedRoles: ["final", "max_abs"],
    },
    unitPolicy,
    selections,
  });
}

/**
 * Attest a unique source-analysis id → native Modelica name mapping, then
 * return identity-keyed outputs and metrics. Extra metric fields such as
 * value are preserved. Callers must pass exact source symbols; this helper
 * never invents a name, digest, or product-specific alias.
 */
export function mapAdmittedObservationEvidenceBySourceIdentity<
  TOutput extends AdmittedObservationSourceOutput,
  TMetric extends AdmittedObservationPublishedMetric,
>(
  method: AdmittedObservationEvaluationMethod,
  sourceSymbols: readonly ThermalMethodSheetSourceSymbol[],
  sourceOutputs: readonly TOutput[],
  publishedMetrics: readonly TMetric[],
): {
  readonly outputs: readonly TOutput[];
  readonly metrics: readonly TMetric[];
} {
  const selectedIds = [
    ...new Set(method.selections.map((selection) => selection.outputSymbolId)),
  ];
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  for (const id of selectedIds) {
    const matches = sourceSymbols.filter((symbol) => symbol.id === id);
    if (matches.length !== 1) {
      throw new TypeError(
        `Admitted observation output "${id}" is not an exact source-analysis symbol.`,
      );
    }
    const symbol = matches[0]!;
    if (symbol.kind !== "variable") {
      throw new TypeError(
        `Admitted observation output "${id}" is not an exact source-analysis variable.`,
      );
    }
    const nativeName = symbol.name;
    const nameMatches = sourceSymbols.filter((item) => item.name === nativeName);
    if (nameMatches.length !== 1) {
      throw new TypeError(
        `Admitted observation native name "${nativeName}" is not unique.`,
      );
    }
    if (nameToId.has(nativeName) && nameToId.get(nativeName) !== id) {
      throw new TypeError(
        `Admitted observation native name "${nativeName}" is not unique.`,
      );
    }
    idToName.set(id, nativeName);
    nameToId.set(nativeName, id);
  }

  const outputs: TOutput[] = [];
  for (const id of selectedIds) {
    const nativeName = idToName.get(id)!;
    const matches = sourceOutputs.filter((output) => output.name === nativeName);
    if (matches.length !== 1) {
      throw new TypeError(
        `Admitted observation output "${id}" is not an exact native source output.`,
      );
    }
    outputs.push({ ...matches[0]!, name: id });
  }

  const metrics: TMetric[] = [];
  for (const metric of publishedMetrics) {
    const id = nameToId.get(metric.outputName);
    if (id === undefined) continue;
    metrics.push({ ...metric, outputName: id });
  }
  return deepFreeze({ outputs, metrics });
}

export function selectAdmittedObservationEvaluations(
  method: AdmittedObservationEvaluationMethod,
  sourceOutputs: readonly AdmittedObservationSourceOutput[],
  publishedMetrics: readonly AdmittedObservationPublishedMetric[],
): readonly AdmittedObservationSelection[] {
  const outputsByName = new Map<string, AdmittedObservationSourceOutput[]>();
  for (const output of sourceOutputs) {
    const existing = outputsByName.get(output.name) ?? [];
    existing.push(output);
    outputsByName.set(output.name, existing);
  }
  const selected: AdmittedObservationSelection[] = [];
  for (const selection of method.selections) {
    const outputs = outputsByName.get(selection.outputSymbolId) ?? [];
    if (outputs.length !== 1) {
      throw new TypeError(
        `Admitted observation output "${selection.outputSymbolId}" is not an exact v2 source output.`,
      );
    }
    const output = outputs[0]!;
    if (output.unit !== selection.declaredUnit) {
      throw new TypeError(
        `Admitted observation output "${selection.outputSymbolId}" unit is unresolved against the source-declared unit.`,
      );
    }
    const metrics = publishedMetrics.filter((metric) =>
      metric.outputName === selection.outputSymbolId &&
      metric.statistic === selection.role
    );
    if (metrics.length !== 1) {
      throw new TypeError(
        `Admitted observation role "${selection.role}" for "${selection.outputSymbolId}" is absent from published evidence.`,
      );
    }
    if (metrics[0]!.unit !== selection.declaredUnit) {
      throw new TypeError(
        `Admitted observation "${selection.outputSymbolId}" ${selection.role} unit is unresolved without a matching published unit.`,
      );
    }
    selected.push(selection);
  }
  return deepFreeze(selected);
}

/**
 * Select exactly one current Thread requirement by the signed sheet pair.
 * `requirementElementId` matches `requirement.id` or `requirement.trace.elementId`.
 * `requirementMetric` matches `requirement.criterion.metric` exactly.
 * Missing or multiple matches stay unresolved; the first match is never chosen.
 */
export function threadRequirementMatchesSheetPair(
  requirement: ThreadRequirementPairCandidate,
  identity: ThermalRequirementPairIdentity,
): boolean {
  const elementMatches = requirement.id === identity.requirementElementId ||
    requirement.trace.elementId === identity.requirementElementId;
  return elementMatches &&
    requirement.criterion.metric === identity.requirementMetric;
}

export function selectUniqueThreadRequirementByPair<
  T extends ThreadRequirementPairCandidate,
>(
  requirements: readonly T[],
  identity: ThermalRequirementPairIdentity,
): T {
  const matches = requirements.filter((requirement) =>
    threadRequirementMatchesSheetPair(requirement, identity)
  );
  const pair = `${identity.requirementElementId}:${identity.requirementMetric}`;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new TypeError(
      `Thread requirement pair ${pair} is unresolved: no current requirement matches requirementElementId and requirementMetric.`,
    );
  }
  throw new TypeError(
    `Thread requirement pair ${pair} is unresolved: ${matches.length} current requirements match requirementElementId and requirementMetric; the server will not choose one.`,
  );
}

function parseUnitPolicy(
  value: unknown,
  path: string,
): AdmittedObservationUnitPolicy {
  const input = exactRecord(value, ["id", "version", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    version: nonEmptyText(input.version, `${path}.version`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseSelection(
  value: unknown,
  path: string,
): AdmittedObservationSelection {
  const input = exactRecord(
    value,
    [
      "outputSymbolId",
      "role",
      "requirementElementId",
      "requirementMetric",
      "declaredUnit",
    ],
    path,
  );
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!ROLES.includes(role as AdmittedObservationRole)) {
    throw new TypeError(`${path}.role must be final or max_abs.`);
  }
  return {
    outputSymbolId: safeId(input.outputSymbolId, `${path}.outputSymbolId`),
    role: role as AdmittedObservationRole,
    requirementElementId: safeId(
      input.requirementElementId,
      `${path}.requirementElementId`,
    ),
    requirementMetric: safeId(
      input.requirementMetric,
      `${path}.requirementMetric`,
    ),
    declaredUnit: nonEmptyText(input.declaredUnit, `${path}.declaredUnit`),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}
