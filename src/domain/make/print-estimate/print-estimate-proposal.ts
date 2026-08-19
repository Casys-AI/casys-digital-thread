/**
 * MRTR grammar and fail-closed parsers for `industrialize.seal-print-estimate-case@1`.
 *
 * WHY DOMAIN LAYER — registry, proposal gate and executor all need the
 * operation identities and the same parse. Defining them in an adapter would
 * force the registry to import outward.
 *
 * The human signs the complete print-estimate-case/1.0 identity, including the
 * committed profile digest. Profile parameters are reviewed fields, never
 * chosen at execution. This grammar never carries a price.
 */

import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  PRINT_ESTIMATE_CASE_SCHEMA,
  type PrintEstimateCase,
} from "./print-estimate-case.ts";

export const INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION = {
  id: "industrialize.seal-print-estimate-case",
  version: "1",
} as const;

export const INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION = {
  id: "industrialize.observe-print-estimate",
  version: "1",
} as const;

export type PrintEstimateProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class PrintEstimateProposalError extends Error {
  constructor(
    readonly code: PrintEstimateProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrintEstimateProposalError";
  }
}

export interface PrintEstimateDecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: typeof PRINT_ESTIMATE_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: PrintEstimateCase["project"];
  readonly target: PrintEstimateCase["target"];
  readonly profile: PrintEstimateCase["profile"];
  readonly filamentDensityGCm3?: PrintEstimateCase["filamentDensityGCm3"];
  readonly provider: PrintEstimateCase["provider"];
  readonly limitations: readonly string[];
  readonly provenance: PrintEstimateCase["provenance"];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalPrintEstimateCaseText(
  printEstimateCase: PrintEstimateCase,
): string {
  return deterministicJson(printEstimateCase);
}

export function encodePrintEstimateDecisionParameters(
  caseDigest: string,
  printEstimateCase: PrintEstimateCase,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(caseDigest, "caseDigest");
  assertFingerprint(printEstimateCase.profile.sha256, "profile.sha256");

  const result: EngineeringDecisionProposalParameter[] = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => result.push({ key, label, value });

  p("printEstimate.case.digest", "Print-estimate case SHA-256 digest", caseDigest);
  p(
    "printEstimate.case.schemaVersion",
    "Print-estimate case schema version",
    printEstimateCase.schemaVersion,
  );
  p("printEstimate.case.id", "Print-estimate case ID", printEstimateCase.id);
  p(
    "printEstimate.case.revision",
    "Print-estimate case revision",
    printEstimateCase.revision,
  );
  p("printEstimate.case.scope", "Print-estimate case scope", printEstimateCase.scope);
  p(
    "printEstimate.case.evidenceBoundary",
    "Evidence boundary",
    printEstimateCase.evidenceBoundary,
  );
  p("printEstimate.case.project.id", "Project ID", printEstimateCase.project.id);
  p(
    "printEstimate.case.project.subjectId",
    "Subject ID",
    printEstimateCase.project.subjectId,
  );
  p(
    "printEstimate.case.target.componentKey",
    "Target component key",
    printEstimateCase.target.componentKey,
  );
  p(
    "printEstimate.case.profile.repoPath",
    "Committed profile path",
    printEstimateCase.profile.repoPath,
  );
  p(
    "printEstimate.case.profile.exportName",
    "Profile export name",
    printEstimateCase.profile.exportName,
  );
  p(
    "printEstimate.case.profile.sha256",
    "Committed profile SHA-256",
    printEstimateCase.profile.sha256,
  );
  p(
    "printEstimate.case.profile.layerHeightMm.value",
    "Layer height value",
    printEstimateCase.profile.layerHeightMm.value,
  );
  p(
    "printEstimate.case.profile.layerHeightMm.unit",
    "Layer height unit",
    printEstimateCase.profile.layerHeightMm.unit,
  );
  p(
    "printEstimate.case.profile.nozzleDiameterMm.value",
    "Nozzle diameter value",
    printEstimateCase.profile.nozzleDiameterMm.value,
  );
  p(
    "printEstimate.case.profile.nozzleDiameterMm.unit",
    "Nozzle diameter unit",
    printEstimateCase.profile.nozzleDiameterMm.unit,
  );
  p(
    "printEstimate.case.profile.material",
    "Profile material",
    printEstimateCase.profile.material,
  );
  p(
    "printEstimate.case.hasFilamentDensity",
    "Filament density declared",
    printEstimateCase.filamentDensityGCm3 !== undefined,
  );
  if (printEstimateCase.filamentDensityGCm3 !== undefined) {
    p(
      "printEstimate.case.filamentDensityGCm3.value",
      "Filament density value",
      printEstimateCase.filamentDensityGCm3.value,
    );
    p(
      "printEstimate.case.filamentDensityGCm3.unit",
      "Filament density unit",
      printEstimateCase.filamentDensityGCm3.unit,
    );
  }
  p(
    "printEstimate.case.provider.build123dTool",
    "Build123d tool lock",
    printEstimateCase.provider.build123dTool,
  );
  p(
    "printEstimate.case.provider.prusaslicerTool",
    "PrusaSlicer tool lock",
    printEstimateCase.provider.prusaslicerTool,
  );
  p(
    "printEstimate.case.limitations.count",
    "Limitation count",
    printEstimateCase.limitations.length,
  );
  for (const [i, limitation] of printEstimateCase.limitations.entries()) {
    p(`printEstimate.case.limitations.${i}`, `Limitation ${i}`, limitation);
  }
  p(
    "printEstimate.case.provenance.status",
    "Provenance status",
    printEstimateCase.provenance.status,
  );
  p(
    "printEstimate.case.provenance.note",
    "Provenance note",
    printEstimateCase.provenance.note,
  );
  return result;
}

export function printEstimateDecisionParametersToMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid(
        "duplicate_parameter",
        `Duplicate print-estimate parameter: ${param.key}`,
      );
    }
    result.set(param.key, param.value);
  }
  return result;
}

export function parsePrintEstimateDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): PrintEstimateDecisionParameters {
  return parsePrintEstimateDecisionParameterMap(
    printEstimateDecisionParametersToMap(parameters),
  );
}

export function parsePrintEstimateDecisionParameterMap(
  params: ReadonlyMap<string, string | number | boolean>,
): PrintEstimateDecisionParameters {
  const expected = new Set<string>();
  const str = (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing print-estimate parameter: ${key}`);
    }
    const result = String(value);
    if (result.trim() === "") {
      invalid("invalid_format", `Print-estimate parameter ${key} must be non-empty.`);
    }
    return result;
  };
  const posInt = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing print-estimate parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      invalid(
        "invalid_format",
        `Print-estimate parameter ${key} must be a positive integer (got: ${value}).`,
      );
    }
    return n;
  };
  const finiteNum = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing print-estimate parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      invalid(
        "invalid_format",
        `Print-estimate parameter ${key} must be finite (got: ${value}).`,
      );
    }
    return n;
  };
  const flag = (key: string): boolean => {
    expected.add(key);
    const value = params.get(key);
    if (typeof value !== "boolean") {
      invalid("invalid_format", `Print-estimate parameter ${key} must be a boolean.`);
    }
    return value;
  };

  const caseDigest = str("printEstimate.case.digest");
  assertFingerprint(caseDigest, "printEstimate.case.digest");
  const schemaVersion = str("printEstimate.case.schemaVersion");
  if (schemaVersion !== PRINT_ESTIMATE_CASE_SCHEMA) {
    invalid(
      "invalid_schema",
      `printEstimate.case.schemaVersion must be ${PRINT_ESTIMATE_CASE_SCHEMA} ` +
        `(got: ${schemaVersion}).`,
    );
  }
  const layerUnit = str("printEstimate.case.profile.layerHeightMm.unit");
  const nozzleUnit = str("printEstimate.case.profile.nozzleDiameterMm.unit");
  if (layerUnit !== "mm" || nozzleUnit !== "mm") {
    invalid("invalid_format", "print-estimate profile linear units must be mm.");
  }
  const build123dTool = str("printEstimate.case.provider.build123dTool");
  const prusaslicerTool = str("printEstimate.case.provider.prusaslicerTool");
  if (build123dTool !== "build123d_export") {
    invalid("invalid_format", "print-estimate build123d tool lock is divergent.");
  }
  if (prusaslicerTool !== "prusaslicer_estimate_fff") {
    invalid("invalid_format", "print-estimate PrusaSlicer tool lock is divergent.");
  }
  const hasDensity = flag("printEstimate.case.hasFilamentDensity");
  const filamentDensityGCm3 = hasDensity
    ? parseDeclaredDensity(str, finiteNum)
    : undefined;
  const limitationCount = posInt("printEstimate.case.limitations.count");
  const limitations: string[] = [];
  for (let i = 0; i < limitationCount; i++) {
    limitations.push(str(`printEstimate.case.limitations.${i}`));
  }
  const provenanceStatus = str("printEstimate.case.provenance.status");
  if (provenanceStatus !== "provisional") {
    invalid("invalid_format", "print-estimate provenance status must be provisional.");
  }
  const profileSha256 = str("printEstimate.case.profile.sha256");
  assertFingerprint(profileSha256, "printEstimate.case.profile.sha256");
  const parsed = {
    id: str("printEstimate.case.id"),
    revision: posInt("printEstimate.case.revision"),
    scope: str("printEstimate.case.scope"),
    evidenceBoundary: str("printEstimate.case.evidenceBoundary"),
    project: {
      id: str("printEstimate.case.project.id"),
      subjectId: str("printEstimate.case.project.subjectId"),
    },
    target: {
      componentKey: str("printEstimate.case.target.componentKey"),
    },
    profile: {
      repoPath: str("printEstimate.case.profile.repoPath"),
      exportName: str("printEstimate.case.profile.exportName"),
      sha256: profileSha256,
      layerHeightMm: {
        value: finiteNum("printEstimate.case.profile.layerHeightMm.value"),
        unit: "mm" as const,
      },
      nozzleDiameterMm: {
        value: finiteNum("printEstimate.case.profile.nozzleDiameterMm.value"),
        unit: "mm" as const,
      },
      material: str("printEstimate.case.profile.material"),
    },
    provenanceNote: str("printEstimate.case.provenance.note"),
  };

  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected print-estimate parameter: ${key}`);
    }
  }

  const base: PrintEstimateDecisionParameters = {
    caseDigest,
    schemaVersion: PRINT_ESTIMATE_CASE_SCHEMA,
    id: parsed.id,
    revision: parsed.revision,
    scope: parsed.scope,
    evidenceBoundary: parsed.evidenceBoundary,
    project: parsed.project,
    target: parsed.target,
    profile: parsed.profile,
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations,
    provenance: {
      status: "provisional",
      note: parsed.provenanceNote,
    },
  };
  return filamentDensityGCm3 === undefined ? base : { ...base, filamentDensityGCm3 };
}

export function verifyPrintEstimateParametersMatchCase(
  params: PrintEstimateDecisionParameters,
  printEstimateCase: PrintEstimateCase,
): void {
  match(params.schemaVersion, printEstimateCase.schemaVersion, "schemaVersion");
  match(params.id, printEstimateCase.id, "id");
  match(params.revision, printEstimateCase.revision, "revision");
  match(params.scope, printEstimateCase.scope, "scope");
  match(
    params.evidenceBoundary,
    printEstimateCase.evidenceBoundary,
    "evidenceBoundary",
  );
  match(params.project.id, printEstimateCase.project.id, "project.id");
  match(
    params.project.subjectId,
    printEstimateCase.project.subjectId,
    "project.subjectId",
  );
  match(
    params.target.componentKey,
    printEstimateCase.target.componentKey,
    "target.componentKey",
  );
  match(
    params.profile.repoPath,
    printEstimateCase.profile.repoPath,
    "profile.repoPath",
  );
  match(
    params.profile.exportName,
    printEstimateCase.profile.exportName,
    "profile.exportName",
  );
  match(params.profile.sha256, printEstimateCase.profile.sha256, "profile.sha256");
  match(
    params.profile.layerHeightMm.value,
    printEstimateCase.profile.layerHeightMm.value,
    "profile.layerHeightMm.value",
  );
  match(
    params.profile.layerHeightMm.unit,
    printEstimateCase.profile.layerHeightMm.unit,
    "profile.layerHeightMm.unit",
  );
  match(
    params.profile.nozzleDiameterMm.value,
    printEstimateCase.profile.nozzleDiameterMm.value,
    "profile.nozzleDiameterMm.value",
  );
  match(
    params.profile.nozzleDiameterMm.unit,
    printEstimateCase.profile.nozzleDiameterMm.unit,
    "profile.nozzleDiameterMm.unit",
  );
  match(
    params.profile.material,
    printEstimateCase.profile.material,
    "profile.material",
  );
  match(
    params.filamentDensityGCm3?.value,
    printEstimateCase.filamentDensityGCm3?.value,
    "filamentDensityGCm3.value",
  );
  match(
    params.filamentDensityGCm3?.unit,
    printEstimateCase.filamentDensityGCm3?.unit,
    "filamentDensityGCm3.unit",
  );
  match(
    params.provider.build123dTool,
    printEstimateCase.provider.build123dTool,
    "provider.build123dTool",
  );
  match(
    params.provider.prusaslicerTool,
    printEstimateCase.provider.prusaslicerTool,
    "provider.prusaslicerTool",
  );
  if (params.limitations.length !== printEstimateCase.limitations.length) {
    mismatch(
      "limitations.count",
      params.limitations.length,
      printEstimateCase.limitations.length,
    );
  }
  for (const [i, limitation] of params.limitations.entries()) {
    match(limitation, printEstimateCase.limitations[i]!, `limitations.${i}`);
  }
  match(
    params.provenance.status,
    printEstimateCase.provenance.status,
    "provenance.status",
  );
  match(params.provenance.note, printEstimateCase.provenance.note, "provenance.note");
}

function parseDeclaredDensity(
  str: (key: string) => string,
  finiteNum: (key: string) => number,
): { readonly value: number; readonly unit: "g/cm3" } {
  const unit = str("printEstimate.case.filamentDensityGCm3.unit");
  if (unit !== "g/cm3") {
    invalid("invalid_format", "print-estimate filament density unit must be g/cm3.");
  }
  return {
    value: finiteNum("printEstimate.case.filamentDensityGCm3.value"),
    unit: "g/cm3",
  };
}

function assertFingerprint(value: string, path: string): void {
  if (!SHA256_HEX.test(value)) {
    invalid(
      "invalid_fingerprint",
      `${path} must be a lowercase 64-character hex SHA-256 digest.`,
    );
  }
}

function match(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) mismatch(path, actual, expected);
}

function mismatch(path: string, actual: unknown, expected: unknown): never {
  invalid(
    "parameter_mismatch",
    `printEstimate.case.${path} does not match the sealed case ` +
      `(signed ${JSON.stringify(actual)}, case ${JSON.stringify(expected)}).`,
  );
}

function invalid(code: PrintEstimateProposalErrorCode, message: string): never {
  throw new PrintEstimateProposalError(code, message);
}
