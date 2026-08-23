/**
 * Closed `modelica-thermal-method-sheet/1.0` declaration.
 *
 * A reviewed method sheet is not admission, execution or an L4 verdict. It
 * names exact source-analysis symbols and SysML identities. Values stay in
 * admitted source / SysML. This module never infers temperature, unit or
 * power from a label, and it never accepts Modelica source text.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const MODELICA_THERMAL_METHOD_SHEET_SCHEMA =
  "modelica-thermal-method-sheet/1.0" as const;

export type ThermalMethodSheetSourceKind = "human" | "document" | "expert" | "tool";

export type ThermalMethodSheetObservationRole = "final" | "max_abs";

export interface ThermalMethodSheetSource {
  readonly id: string;
  readonly kind: ThermalMethodSheetSourceKind;
  readonly reference: string;
  readonly justification: string;
}

export interface ThermalMethodSheetParameter {
  readonly modelSymbolId: string;
  readonly role: string;
  readonly attributeUsageId: string;
  readonly sourceId: string;
}

export interface ThermalMethodSheetOutput {
  readonly modelSymbolId: string;
  readonly role: ThermalMethodSheetObservationRole;
  readonly quantityMeaning: string;
  readonly declaredUnit: string;
  readonly requirementElementId: string;
  readonly requirementMetric: string;
  readonly limitation: string;
}

export interface ModelicaThermalMethodSheet {
  readonly schemaVersion: typeof MODELICA_THERMAL_METHOD_SHEET_SCHEMA;
  readonly id: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  readonly subject: { readonly id: string };
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly scope: string;
  readonly limitations: string;
  readonly sources: readonly ThermalMethodSheetSource[];
  readonly model: {
    readonly moduleName: string;
    readonly sourceCaptureFingerprint: ContentFingerprint;
  };
  readonly parameters: readonly ThermalMethodSheetParameter[];
  readonly outputs: readonly ThermalMethodSheetOutput[];
  readonly bindings: {
    readonly parameterizes: readonly {
      readonly modelSymbolId: string;
      readonly attributeUsageId: string;
    }[];
    readonly outputRequirements: readonly {
      readonly modelSymbolId: string;
      readonly role: ThermalMethodSheetObservationRole;
      readonly requirementElementId: string;
      readonly requirementMetric: string;
    }[];
  };
  readonly review: {
    readonly authorId: string;
    readonly reviewedAt: string;
    readonly sealDecisionId: string;
  };
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "project",
  "subject",
  "basis",
  "scope",
  "limitations",
  "sources",
  "model",
  "parameters",
  "outputs",
  "bindings",
  "review",
] as const;

const SOURCE_KINDS = ["human", "document", "expert", "tool"] as const;
const OUTPUT_ROLES = ["final", "max_abs"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function validateModelicaThermalMethodSheet(
  value: unknown,
): ModelicaThermalMethodSheet {
  const root = exactRecord(value, ROOT_KEYS, "$sheet");
  literalValue(
    root.schemaVersion,
    MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
    "$sheet.schemaVersion",
  );

  const projectInput = exactRecord(root.project, ["id", "subjectId"], "$sheet.project");
  const subjectInput = exactRecord(root.subject, ["id"], "$sheet.subject");
  const basisInput = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$sheet.basis",
  );
  const modelInput = exactRecord(
    root.model,
    ["moduleName", "sourceCaptureFingerprint"],
    "$sheet.model",
  );
  const bindingsInput = exactRecord(
    root.bindings,
    ["parameterizes", "outputRequirements"],
    "$sheet.bindings",
  );
  const reviewInput = exactRecord(
    root.review,
    ["authorId", "reviewedAt", "sealDecisionId"],
    "$sheet.review",
  );

  const sources = nonEmptyArray(root.sources, "$sheet.sources").map((item, index) =>
    parseSource(item, `$sheet.sources[${index}]`)
  );
  rejectDuplicates(sources.map((item) => item.id), "$sheet.sources");
  const sourceIds = new Set(sources.map((item) => item.id));

  const parameters = arrayOf(root.parameters, "$sheet.parameters").map(
    (item, index) => parseParameter(item, `$sheet.parameters[${index}]`, sourceIds),
  );
  rejectDuplicates(
    parameters.map((item) => item.modelSymbolId),
    "$sheet.parameters",
  );

  const outputs = arrayOf(root.outputs, "$sheet.outputs").map((item, index) =>
    parseOutput(item, `$sheet.outputs[${index}]`)
  );
  rejectDuplicates(
    outputs.map((item) => `${item.modelSymbolId}:${item.role}`),
    "$sheet.outputs",
  );
  rejectDuplicates(
    outputs.map((item) => `${item.requirementElementId}:${item.requirementMetric}`),
    "$sheet.outputs requirement pairs",
  );

  const parameterizes = arrayOf(
    bindingsInput.parameterizes,
    "$sheet.bindings.parameterizes",
  ).map((item, index) =>
    parseParameterBinding(item, `$sheet.bindings.parameterizes[${index}]`)
  );
  rejectDuplicates(
    parameterizes.map((item) => item.modelSymbolId),
    "$sheet.bindings.parameterizes",
  );
  const outputRequirements = arrayOf(
    bindingsInput.outputRequirements,
    "$sheet.bindings.outputRequirements",
  ).map((item, index) =>
    parseOutputBinding(item, `$sheet.bindings.outputRequirements[${index}]`)
  );
  rejectDuplicates(
    outputRequirements.map((item) => `${item.modelSymbolId}:${item.role}`),
    "$sheet.bindings.outputRequirements",
  );
  rejectDuplicates(
    outputRequirements.map((item) =>
      `${item.requirementElementId}:${item.requirementMetric}`
    ),
    "$sheet.bindings.outputRequirements requirement pairs",
  );

  for (const parameter of parameters) {
    const binding = parameterizes.find((item) =>
      item.modelSymbolId === parameter.modelSymbolId
    );
    if (
      !binding ||
      binding.attributeUsageId !== parameter.attributeUsageId
    ) {
      throw new TypeError(
        `$sheet.parameters modelSymbolId "${parameter.modelSymbolId}" has no exact parameterizes binding.`,
      );
    }
  }
  for (const output of outputs) {
    const binding = outputRequirements.find((item) =>
      item.modelSymbolId === output.modelSymbolId && item.role === output.role
    );
    if (
      !binding ||
      binding.requirementElementId !== output.requirementElementId ||
      binding.requirementMetric !== output.requirementMetric
    ) {
      throw new TypeError(
        `$sheet.outputs modelSymbolId "${output.modelSymbolId}" role "${output.role}" has no exact outputRequirements binding.`,
      );
    }
  }

  const sheet: ModelicaThermalMethodSheet = {
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
    id: safeId(root.id, "$sheet.id"),
    project: {
      id: safeId(projectInput.id, "$sheet.project.id"),
      subjectId: safeId(projectInput.subjectId, "$sheet.project.subjectId"),
    },
    subject: { id: safeId(subjectInput.id, "$sheet.subject.id") },
    basis: {
      snapshotId: safeId(basisInput.snapshotId, "$sheet.basis.snapshotId"),
      revision: positiveInteger(basisInput.revision, "$sheet.basis.revision"),
      fingerprint: parseFingerprint(
        basisInput.fingerprint,
        "$sheet.basis.fingerprint",
      ),
    },
    scope: nonEmptyText(root.scope, "$sheet.scope"),
    limitations: nonEmptyText(root.limitations, "$sheet.limitations"),
    sources,
    model: {
      moduleName: parseModuleName(modelInput.moduleName, "$sheet.model.moduleName"),
      sourceCaptureFingerprint: parseFingerprint(
        modelInput.sourceCaptureFingerprint,
        "$sheet.model.sourceCaptureFingerprint",
      ),
    },
    parameters,
    outputs,
    bindings: { parameterizes, outputRequirements },
    review: {
      authorId: safeId(reviewInput.authorId, "$sheet.review.authorId"),
      reviewedAt: parseReviewedAt(
        reviewInput.reviewedAt,
        "$sheet.review.reviewedAt",
      ),
      sealDecisionId: safeId(
        reviewInput.sealDecisionId,
        "$sheet.review.sealDecisionId",
      ),
    },
  };
  return deepFreeze(sheet);
}

export function fingerprintModelicaThermalMethodSheet(
  sheet: ModelicaThermalMethodSheet,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(sheet);
}

function parseSource(value: unknown, path: string): ThermalMethodSheetSource {
  const input = exactRecord(
    value,
    ["id", "kind", "reference", "justification"],
    path,
  );
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (!SOURCE_KINDS.includes(kind as ThermalMethodSheetSourceKind)) {
    throw new TypeError(`${path}.kind must be human, document, expert or tool.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    kind: kind as ThermalMethodSheetSourceKind,
    reference: nonEmptyText(input.reference, `${path}.reference`),
    justification: nonEmptyText(input.justification, `${path}.justification`),
  };
}

function parseParameter(
  value: unknown,
  path: string,
  sourceIds: ReadonlySet<string>,
): ThermalMethodSheetParameter {
  const input = exactRecord(
    value,
    ["modelSymbolId", "role", "attributeUsageId", "sourceId"],
    path,
  );
  const sourceId = safeId(input.sourceId, `${path}.sourceId`);
  if (!sourceIds.has(sourceId)) {
    throw new TypeError(`${path}.sourceId "${sourceId}" is not in $sheet.sources.`);
  }
  return {
    modelSymbolId: safeId(input.modelSymbolId, `${path}.modelSymbolId`),
    role: nonEmptyText(input.role, `${path}.role`),
    attributeUsageId: safeId(input.attributeUsageId, `${path}.attributeUsageId`),
    sourceId,
  };
}

function parseOutput(value: unknown, path: string): ThermalMethodSheetOutput {
  const input = exactRecord(
    value,
    [
      "modelSymbolId",
      "role",
      "quantityMeaning",
      "declaredUnit",
      "requirementElementId",
      "requirementMetric",
      "limitation",
    ],
    path,
  );
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!OUTPUT_ROLES.includes(role as ThermalMethodSheetObservationRole)) {
    throw new TypeError(`${path}.role must be final or max_abs.`);
  }
  return {
    modelSymbolId: safeId(input.modelSymbolId, `${path}.modelSymbolId`),
    role: role as ThermalMethodSheetObservationRole,
    quantityMeaning: nonEmptyText(input.quantityMeaning, `${path}.quantityMeaning`),
    declaredUnit: nonEmptyText(input.declaredUnit, `${path}.declaredUnit`),
    requirementElementId: safeId(
      input.requirementElementId,
      `${path}.requirementElementId`,
    ),
    requirementMetric: safeId(
      input.requirementMetric,
      `${path}.requirementMetric`,
    ),
    limitation: nonEmptyText(input.limitation, `${path}.limitation`),
  };
}

function parseParameterBinding(
  value: unknown,
  path: string,
): { readonly modelSymbolId: string; readonly attributeUsageId: string } {
  const input = exactRecord(value, ["modelSymbolId", "attributeUsageId"], path);
  return {
    modelSymbolId: safeId(input.modelSymbolId, `${path}.modelSymbolId`),
    attributeUsageId: safeId(input.attributeUsageId, `${path}.attributeUsageId`),
  };
}

function parseOutputBinding(
  value: unknown,
  path: string,
): {
  readonly modelSymbolId: string;
  readonly role: ThermalMethodSheetObservationRole;
  readonly requirementElementId: string;
  readonly requirementMetric: string;
} {
  const input = exactRecord(
    value,
    ["modelSymbolId", "role", "requirementElementId", "requirementMetric"],
    path,
  );
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!OUTPUT_ROLES.includes(role as ThermalMethodSheetObservationRole)) {
    throw new TypeError(`${path}.role must be final or max_abs.`);
  }
  return {
    modelSymbolId: safeId(input.modelSymbolId, `${path}.modelSymbolId`),
    role: role as ThermalMethodSheetObservationRole,
    requirementElementId: safeId(
      input.requirementElementId,
      `${path}.requirementElementId`,
    ),
    requirementMetric: safeId(
      input.requirementMetric,
      `${path}.requirementMetric`,
    ),
  };
}

function parseModuleName(value: unknown, path: string): string {
  const name = safeId(value, path);
  if (name.includes(".") || name.toLowerCase().endsWith("mo")) {
    throw new TypeError(
      `${path} must be a module identifier, not a Modelica source path or .mo file.`,
    );
  }
  return name;
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

function parseReviewedAt(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_DATE_TIME.test(text)) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return text;
}
