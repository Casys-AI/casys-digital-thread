/**
 * MRTR grammar and fail-closed parsers for `industrialize.seal-printability-case@1`.
 *
 * WHY DOMAIN LAYER — registry, proposal gate and executor all need the
 * operation identities and the same parse. Defining them in an adapter would
 * force the registry to import outward.
 *
 * The human signs the complete printability-check-case/1.0 identity. Thresholds,
 * mesh and build direction are reviewed fields, never chosen at execution.
 */

import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  PRINTABILITY_CHECK_CASE_SCHEMA,
  type PrintabilityCheckCase,
} from "./printability-case.ts";

export const INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION = {
  id: "industrialize.seal-printability-case",
  version: "1",
} as const;

export const INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION = {
  id: "industrialize.observe-printability",
  version: "1",
} as const;

export type PrintabilityProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class PrintabilityProposalError extends Error {
  constructor(
    readonly code: PrintabilityProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrintabilityProposalError";
  }
}

export interface PrintabilityDecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: typeof PRINTABILITY_CHECK_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: PrintabilityCheckCase["project"];
  readonly target: PrintabilityCheckCase["target"];
  readonly thresholds: PrintabilityCheckCase["thresholds"];
  readonly meshSizeMm: PrintabilityCheckCase["meshSizeMm"];
  readonly buildDirection: PrintabilityCheckCase["buildDirection"];
  readonly provider: PrintabilityCheckCase["provider"];
  readonly limitations: readonly string[];
  readonly provenance: PrintabilityCheckCase["provenance"];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalPrintabilityCaseText(
  printabilityCase: PrintabilityCheckCase,
): string {
  return deterministicJson(printabilityCase);
}

export function encodePrintabilityDecisionParameters(
  caseDigest: string,
  printabilityCase: PrintabilityCheckCase,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(caseDigest, "caseDigest");

  const result: EngineeringDecisionProposalParameter[] = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => result.push({ key, label, value });

  p("printability.case.digest", "Printability case SHA-256 digest", caseDigest);
  p(
    "printability.case.schemaVersion",
    "Printability case schema version",
    printabilityCase.schemaVersion,
  );
  p("printability.case.id", "Printability case ID", printabilityCase.id);
  p(
    "printability.case.revision",
    "Printability case revision",
    printabilityCase.revision,
  );
  p("printability.case.scope", "Printability case scope", printabilityCase.scope);
  p(
    "printability.case.evidenceBoundary",
    "Evidence boundary",
    printabilityCase.evidenceBoundary,
  );
  p("printability.case.project.id", "Project ID", printabilityCase.project.id);
  p(
    "printability.case.project.subjectId",
    "Subject ID",
    printabilityCase.project.subjectId,
  );
  p(
    "printability.case.target.componentKey",
    "Target component key",
    printabilityCase.target.componentKey,
  );
  p(
    "printability.case.thresholds.minWallThicknessMm.value",
    "Minimum wall thickness value",
    printabilityCase.thresholds.minWallThicknessMm.value,
  );
  p(
    "printability.case.thresholds.minWallThicknessMm.unit",
    "Minimum wall thickness unit",
    printabilityCase.thresholds.minWallThicknessMm.unit,
  );
  p(
    "printability.case.thresholds.maxOverhangAngleDeg.value",
    "Maximum overhang angle value",
    printabilityCase.thresholds.maxOverhangAngleDeg.value,
  );
  p(
    "printability.case.thresholds.maxOverhangAngleDeg.unit",
    "Maximum overhang angle unit",
    printabilityCase.thresholds.maxOverhangAngleDeg.unit,
  );
  p(
    "printability.case.thresholds.maxUnsupportedAreaMm2.value",
    "Maximum unsupported area value",
    printabilityCase.thresholds.maxUnsupportedAreaMm2.value,
  );
  p(
    "printability.case.thresholds.maxUnsupportedAreaMm2.unit",
    "Maximum unsupported area unit",
    printabilityCase.thresholds.maxUnsupportedAreaMm2.unit,
  );
  p(
    "printability.case.meshSizeMm.value",
    "Mesh size value",
    printabilityCase.meshSizeMm.value,
  );
  p(
    "printability.case.meshSizeMm.unit",
    "Mesh size unit",
    printabilityCase.meshSizeMm.unit,
  );
  p(
    "printability.case.buildDirection.0",
    "Build direction X",
    printabilityCase.buildDirection[0],
  );
  p(
    "printability.case.buildDirection.1",
    "Build direction Y",
    printabilityCase.buildDirection[1],
  );
  p(
    "printability.case.buildDirection.2",
    "Build direction Z",
    printabilityCase.buildDirection[2],
  );
  p(
    "printability.case.provider.build123dTool",
    "Build123d tool lock",
    printabilityCase.provider.build123dTool,
  );
  p(
    "printability.case.provider.thicknessTool",
    "Thickness tool lock",
    printabilityCase.provider.thicknessTool,
  );
  p(
    "printability.case.provider.overhangTool",
    "Overhang tool lock",
    printabilityCase.provider.overhangTool,
  );
  p(
    "printability.case.limitations.count",
    "Limitation count",
    printabilityCase.limitations.length,
  );
  for (const [i, limitation] of printabilityCase.limitations.entries()) {
    p(`printability.case.limitations.${i}`, `Limitation ${i}`, limitation);
  }
  p(
    "printability.case.provenance.status",
    "Provenance status",
    printabilityCase.provenance.status,
  );
  p(
    "printability.case.provenance.note",
    "Provenance note",
    printabilityCase.provenance.note,
  );
  return result;
}

export function printabilityDecisionParametersToMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid("duplicate_parameter", `Duplicate printability parameter: ${param.key}`);
    }
    result.set(param.key, param.value);
  }
  return result;
}

export function parsePrintabilityDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): PrintabilityDecisionParameters {
  return parsePrintabilityDecisionParameterMap(
    printabilityDecisionParametersToMap(parameters),
  );
}

export function parsePrintabilityDecisionParameterMap(
  params: ReadonlyMap<string, string | number | boolean>,
): PrintabilityDecisionParameters {
  const expected = new Set<string>();
  const str = (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing printability parameter: ${key}`);
    }
    const result = String(value);
    if (result.trim() === "") {
      invalid("invalid_format", `Printability parameter ${key} must be non-empty.`);
    }
    return result;
  };
  const posInt = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing printability parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      invalid(
        "invalid_format",
        `Printability parameter ${key} must be a positive integer (got: ${value}).`,
      );
    }
    return n;
  };
  const finiteNum = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing printability parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      invalid(
        "invalid_format",
        `Printability parameter ${key} must be finite (got: ${value}).`,
      );
    }
    return n;
  };

  const caseDigest = str("printability.case.digest");
  assertFingerprint(caseDigest, "printability.case.digest");
  const schemaVersion = str("printability.case.schemaVersion");
  if (schemaVersion !== PRINTABILITY_CHECK_CASE_SCHEMA) {
    invalid(
      "invalid_schema",
      `printability.case.schemaVersion must be ${PRINTABILITY_CHECK_CASE_SCHEMA} ` +
        `(got: ${schemaVersion}).`,
    );
  }
  const id = str("printability.case.id");
  const revision = posInt("printability.case.revision");
  const scope = str("printability.case.scope");
  const evidenceBoundary = str("printability.case.evidenceBoundary");
  const project = {
    id: str("printability.case.project.id"),
    subjectId: str("printability.case.project.subjectId"),
  };
  const target = {
    componentKey: str("printability.case.target.componentKey"),
  };
  const minWallUnit = str("printability.case.thresholds.minWallThicknessMm.unit");
  const overhangUnit = str("printability.case.thresholds.maxOverhangAngleDeg.unit");
  const unsupportedUnit = str(
    "printability.case.thresholds.maxUnsupportedAreaMm2.unit",
  );
  const meshUnit = str("printability.case.meshSizeMm.unit");
  if (minWallUnit !== "mm" || meshUnit !== "mm") {
    invalid("invalid_format", "printability thickness and mesh units must be mm.");
  }
  if (overhangUnit !== "deg") {
    invalid("invalid_format", "printability overhang unit must be deg.");
  }
  if (unsupportedUnit !== "mm2") {
    invalid("invalid_format", "printability unsupported-area unit must be mm2.");
  }
  const build123dTool = str("printability.case.provider.build123dTool");
  const thicknessTool = str("printability.case.provider.thicknessTool");
  const overhangTool = str("printability.case.provider.overhangTool");
  if (build123dTool !== "build123d_export") {
    invalid("invalid_format", "printability build123d tool lock is divergent.");
  }
  if (thicknessTool !== "dfm_check_min_thickness") {
    invalid("invalid_format", "printability thickness tool lock is divergent.");
  }
  if (overhangTool !== "dfm_check_overhangs") {
    invalid("invalid_format", "printability overhang tool lock is divergent.");
  }
  const limitationCount = posInt("printability.case.limitations.count");
  const limitations: string[] = [];
  for (let i = 0; i < limitationCount; i++) {
    limitations.push(str(`printability.case.limitations.${i}`));
  }
  const provenanceStatus = str("printability.case.provenance.status");
  if (provenanceStatus !== "provisional") {
    invalid("invalid_format", "printability provenance status must be provisional.");
  }
  const thresholds = {
    minWallThicknessMm: {
      value: finiteNum("printability.case.thresholds.minWallThicknessMm.value"),
      unit: "mm" as const,
    },
    maxOverhangAngleDeg: {
      value: finiteNum("printability.case.thresholds.maxOverhangAngleDeg.value"),
      unit: "deg" as const,
    },
    maxUnsupportedAreaMm2: {
      value: finiteNum("printability.case.thresholds.maxUnsupportedAreaMm2.value"),
      unit: "mm2" as const,
    },
  };
  const meshSizeMm = {
    value: finiteNum("printability.case.meshSizeMm.value"),
    unit: "mm" as const,
  };
  const buildDirection = [
    finiteNum("printability.case.buildDirection.0"),
    finiteNum("printability.case.buildDirection.1"),
    finiteNum("printability.case.buildDirection.2"),
  ] as const;
  const provenanceNote = str("printability.case.provenance.note");

  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected printability parameter: ${key}`);
    }
  }

  return {
    caseDigest,
    schemaVersion: PRINTABILITY_CHECK_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    thresholds,
    meshSizeMm,
    buildDirection,
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations,
    provenance: {
      status: "provisional",
      note: provenanceNote,
    },
  };
}

export function verifyPrintabilityParametersMatchCase(
  params: PrintabilityDecisionParameters,
  printabilityCase: PrintabilityCheckCase,
): void {
  match(params.schemaVersion, printabilityCase.schemaVersion, "schemaVersion");
  match(params.id, printabilityCase.id, "id");
  match(params.revision, printabilityCase.revision, "revision");
  match(params.scope, printabilityCase.scope, "scope");
  match(params.evidenceBoundary, printabilityCase.evidenceBoundary, "evidenceBoundary");
  match(params.project.id, printabilityCase.project.id, "project.id");
  match(
    params.project.subjectId,
    printabilityCase.project.subjectId,
    "project.subjectId",
  );
  match(
    params.target.componentKey,
    printabilityCase.target.componentKey,
    "target.componentKey",
  );
  match(
    params.thresholds.minWallThicknessMm.value,
    printabilityCase.thresholds.minWallThicknessMm.value,
    "thresholds.minWallThicknessMm.value",
  );
  match(
    params.thresholds.minWallThicknessMm.unit,
    printabilityCase.thresholds.minWallThicknessMm.unit,
    "thresholds.minWallThicknessMm.unit",
  );
  match(
    params.thresholds.maxOverhangAngleDeg.value,
    printabilityCase.thresholds.maxOverhangAngleDeg.value,
    "thresholds.maxOverhangAngleDeg.value",
  );
  match(
    params.thresholds.maxOverhangAngleDeg.unit,
    printabilityCase.thresholds.maxOverhangAngleDeg.unit,
    "thresholds.maxOverhangAngleDeg.unit",
  );
  match(
    params.thresholds.maxUnsupportedAreaMm2.value,
    printabilityCase.thresholds.maxUnsupportedAreaMm2.value,
    "thresholds.maxUnsupportedAreaMm2.value",
  );
  match(
    params.thresholds.maxUnsupportedAreaMm2.unit,
    printabilityCase.thresholds.maxUnsupportedAreaMm2.unit,
    "thresholds.maxUnsupportedAreaMm2.unit",
  );
  match(params.meshSizeMm.value, printabilityCase.meshSizeMm.value, "meshSizeMm.value");
  match(params.meshSizeMm.unit, printabilityCase.meshSizeMm.unit, "meshSizeMm.unit");
  match(
    params.buildDirection[0],
    printabilityCase.buildDirection[0],
    "buildDirection.0",
  );
  match(
    params.buildDirection[1],
    printabilityCase.buildDirection[1],
    "buildDirection.1",
  );
  match(
    params.buildDirection[2],
    printabilityCase.buildDirection[2],
    "buildDirection.2",
  );
  match(
    params.provider.build123dTool,
    printabilityCase.provider.build123dTool,
    "provider.build123dTool",
  );
  match(
    params.provider.thicknessTool,
    printabilityCase.provider.thicknessTool,
    "provider.thicknessTool",
  );
  match(
    params.provider.overhangTool,
    printabilityCase.provider.overhangTool,
    "provider.overhangTool",
  );
  if (params.limitations.length !== printabilityCase.limitations.length) {
    mismatch(
      "limitations.count",
      params.limitations.length,
      printabilityCase.limitations.length,
    );
  }
  for (const [i, limitation] of params.limitations.entries()) {
    match(limitation, printabilityCase.limitations[i]!, `limitations.${i}`);
  }
  match(
    params.provenance.status,
    printabilityCase.provenance.status,
    "provenance.status",
  );
  match(params.provenance.note, printabilityCase.provenance.note, "provenance.note");
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
    `printability.case.${path} does not match the sealed case ` +
      `(signed ${JSON.stringify(actual)}, case ${JSON.stringify(expected)}).`,
  );
}

function invalid(code: PrintabilityProposalErrorCode, message: string): never {
  throw new PrintabilityProposalError(code, message);
}
