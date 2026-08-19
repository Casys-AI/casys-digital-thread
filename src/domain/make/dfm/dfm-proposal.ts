/**
 * MRTR grammars for `industrialize.seal-dfm-case@1` and
 * `industrialize.run-dfm-checks@1`.
 *
 * The human signs the complete dfm-check-case/1.0 identity, including the
 * attested STEP digest and the declared Z-min filter. The run grammar signs
 * the sealed digest plus the filter that will be applied. Tool names stay
 * server locks.
 */

import {
  DFM_CHECK_CASE_SCHEMA,
  DFM_ENVELOPE_TOOL,
  DFM_OVERHANG_TOOL,
  DFM_TARGET_MEDIA_TYPE,
  DFM_THICKNESS_TOOL,
  type DfmCheckCase,
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  validateDfmCheckCase,
} from "./dfm-case.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";

export {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
};

export type DfmProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class DfmProposalError extends Error {
  constructor(
    readonly code: DfmProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DfmProposalError";
  }
}

export interface DfmDecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: typeof DFM_CHECK_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: DfmCheckCase["project"];
  readonly target: DfmCheckCase["target"];
  readonly buildVolumeMm: DfmCheckCase["buildVolumeMm"];
  readonly minThicknessMm: DfmCheckCase["minThicknessMm"];
  readonly maxOverhangAngleDeg: DfmCheckCase["maxOverhangAngleDeg"];
  readonly meshSizeMm: DfmCheckCase["meshSizeMm"];
  readonly buildDirection: DfmCheckCase["buildDirection"];
  readonly zMinFilter: DfmCheckCase["zMinFilter"];
  readonly provider: DfmCheckCase["provider"];
  readonly limitations: readonly string[];
  readonly provenance: DfmCheckCase["provenance"];
}

export interface DfmRunDecisionParameters {
  readonly caseDigest: string;
  readonly targetSha256: string;
  readonly zMinFilter: DfmCheckCase["zMinFilter"];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalDfmCaseText(dfmCase: DfmCheckCase): string {
  return deterministicJson(dfmCase);
}

export function encodeDfmDecisionParameters(
  caseDigest: string,
  dfmCase: DfmCheckCase,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(caseDigest, "caseDigest");
  const result: EngineeringDecisionProposalParameter[] = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => result.push({ key, label, value });
  p("dfm.case.digest", "DFM case SHA-256 digest", caseDigest);
  p("dfm.case.schemaVersion", "DFM case schema version", dfmCase.schemaVersion);
  p("dfm.case.id", "DFM case ID", dfmCase.id);
  p("dfm.case.revision", "DFM case revision", dfmCase.revision);
  p("dfm.case.scope", "DFM case scope", dfmCase.scope);
  p("dfm.case.evidenceBoundary", "Evidence boundary", dfmCase.evidenceBoundary);
  p("dfm.case.project.id", "Project ID", dfmCase.project.id);
  p("dfm.case.project.subjectId", "Subject ID", dfmCase.project.subjectId);
  p(
    "dfm.case.target.componentKey",
    "Target component key",
    dfmCase.target.componentKey,
  );
  p("dfm.case.target.artifactUri", "Target artefact URI", dfmCase.target.artifactUri);
  p("dfm.case.target.sha256", "Target STEP SHA-256", dfmCase.target.sha256);
  p("dfm.case.target.mediaType", "Target media type", dfmCase.target.mediaType);
  p(
    "dfm.case.buildVolumeMm.x.value",
    "Build volume X value",
    dfmCase.buildVolumeMm.x.value,
  );
  p(
    "dfm.case.buildVolumeMm.x.unit",
    "Build volume X unit",
    dfmCase.buildVolumeMm.x.unit,
  );
  p(
    "dfm.case.buildVolumeMm.y.value",
    "Build volume Y value",
    dfmCase.buildVolumeMm.y.value,
  );
  p(
    "dfm.case.buildVolumeMm.y.unit",
    "Build volume Y unit",
    dfmCase.buildVolumeMm.y.unit,
  );
  p(
    "dfm.case.buildVolumeMm.z.value",
    "Build volume Z value",
    dfmCase.buildVolumeMm.z.value,
  );
  p(
    "dfm.case.buildVolumeMm.z.unit",
    "Build volume Z unit",
    dfmCase.buildVolumeMm.z.unit,
  );
  p(
    "dfm.case.minThicknessMm.value",
    "Minimum thickness value",
    dfmCase.minThicknessMm.value,
  );
  p(
    "dfm.case.minThicknessMm.unit",
    "Minimum thickness unit",
    dfmCase.minThicknessMm.unit,
  );
  p(
    "dfm.case.maxOverhangAngleDeg.value",
    "Maximum overhang angle value",
    dfmCase.maxOverhangAngleDeg.value,
  );
  p(
    "dfm.case.maxOverhangAngleDeg.unit",
    "Maximum overhang angle unit",
    dfmCase.maxOverhangAngleDeg.unit,
  );
  p("dfm.case.meshSizeMm.value", "Mesh size value", dfmCase.meshSizeMm.value);
  p("dfm.case.meshSizeMm.unit", "Mesh size unit", dfmCase.meshSizeMm.unit);
  p("dfm.case.buildDirection.0", "Build direction X", dfmCase.buildDirection[0]);
  p("dfm.case.buildDirection.1", "Build direction Y", dfmCase.buildDirection[1]);
  p("dfm.case.buildDirection.2", "Build direction Z", dfmCase.buildDirection[2]);
  p("dfm.case.zMinFilter.enabled", "Z-min filter enabled", dfmCase.zMinFilter.enabled);
  p(
    "dfm.case.zMinFilter.planeZMm.value",
    "Z-min plane value",
    dfmCase.zMinFilter.planeZMm.value,
  );
  p(
    "dfm.case.zMinFilter.planeZMm.unit",
    "Z-min plane unit",
    dfmCase.zMinFilter.planeZMm.unit,
  );
  p(
    "dfm.case.zMinFilter.toleranceMm.value",
    "Z-min tolerance value",
    dfmCase.zMinFilter.toleranceMm.value,
  );
  p(
    "dfm.case.zMinFilter.toleranceMm.unit",
    "Z-min tolerance unit",
    dfmCase.zMinFilter.toleranceMm.unit,
  );
  p(
    "dfm.case.provider.envelopeTool",
    "Envelope tool lock",
    dfmCase.provider.envelopeTool,
  );
  p(
    "dfm.case.provider.thicknessTool",
    "Thickness tool lock",
    dfmCase.provider.thicknessTool,
  );
  p(
    "dfm.case.provider.overhangTool",
    "Overhang tool lock",
    dfmCase.provider.overhangTool,
  );
  p("dfm.case.limitations.count", "Limitation count", dfmCase.limitations.length);
  for (const [i, limitation] of dfmCase.limitations.entries()) {
    p(`dfm.case.limitations.${i}`, `Limitation ${i}`, limitation);
  }
  p("dfm.case.provenance.status", "Provenance status", dfmCase.provenance.status);
  p("dfm.case.provenance.note", "Provenance note", dfmCase.provenance.note);
  return result;
}

export function encodeDfmRunDecisionParameters(
  params: DfmRunDecisionParameters,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(params.caseDigest, "caseDigest");
  assertFingerprint(params.targetSha256, "targetSha256");
  return [
    {
      key: "dfm.run.caseDigest",
      label: "Sealed DFM case digest",
      value: params.caseDigest,
    },
    {
      key: "dfm.run.target.sha256",
      label: "Target STEP SHA-256",
      value: params.targetSha256,
    },
    {
      key: "dfm.run.zMinFilter.enabled",
      label: "Z-min filter enabled",
      value: params.zMinFilter.enabled,
    },
    {
      key: "dfm.run.zMinFilter.planeZMm.value",
      label: "Z-min plane value",
      value: params.zMinFilter.planeZMm.value,
    },
    {
      key: "dfm.run.zMinFilter.planeZMm.unit",
      label: "Z-min plane unit",
      value: params.zMinFilter.planeZMm.unit,
    },
    {
      key: "dfm.run.zMinFilter.toleranceMm.value",
      label: "Z-min tolerance value",
      value: params.zMinFilter.toleranceMm.value,
    },
    {
      key: "dfm.run.zMinFilter.toleranceMm.unit",
      label: "Z-min tolerance unit",
      value: params.zMinFilter.toleranceMm.unit,
    },
  ];
}

export function parseDfmDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): DfmDecisionParameters {
  return parseDfmDecisionParameterMap(toMap(parameters, "DFM"));
}

export function parseDfmRunDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): DfmRunDecisionParameters {
  const params = toMap(parameters, "DFM run");
  const expected = new Set<string>();
  const str = stringReader(params, expected, "DFM run");
  const finiteNum = finiteReader(params, expected, "DFM run");
  const flag = booleanReader(params, expected, "DFM run");
  const caseDigest = str("dfm.run.caseDigest");
  assertFingerprint(caseDigest, "dfm.run.caseDigest");
  const targetSha256 = str("dfm.run.target.sha256");
  assertFingerprint(targetSha256, "dfm.run.target.sha256");
  const planeUnit = str("dfm.run.zMinFilter.planeZMm.unit");
  const toleranceUnit = str("dfm.run.zMinFilter.toleranceMm.unit");
  if (planeUnit !== "mm" || toleranceUnit !== "mm") {
    invalid("invalid_format", "DFM run Z-min units must be mm.");
  }
  const enabled = flag("dfm.run.zMinFilter.enabled");
  const planeZMm = {
    value: finiteNum("dfm.run.zMinFilter.planeZMm.value"),
    unit: "mm" as const,
  };
  const toleranceValue = finiteNum("dfm.run.zMinFilter.toleranceMm.value");
  if (toleranceValue < 0) {
    invalid(
      "invalid_format",
      "dfm.run.zMinFilter.toleranceMm.value must be non-negative.",
    );
  }
  rejectUnexpected(params, expected, "DFM run");
  return {
    caseDigest,
    targetSha256,
    zMinFilter: {
      enabled,
      planeZMm,
      toleranceMm: { value: toleranceValue, unit: "mm" },
    },
  };
}

export function dfmCaseFromDecisionParameters(
  params: DfmDecisionParameters,
): DfmCheckCase {
  return validateDfmCheckCase({
    schemaVersion: params.schemaVersion,
    id: params.id,
    revision: params.revision,
    scope: params.scope,
    evidenceBoundary: params.evidenceBoundary,
    project: params.project,
    target: params.target,
    buildVolumeMm: params.buildVolumeMm,
    minThicknessMm: params.minThicknessMm,
    maxOverhangAngleDeg: params.maxOverhangAngleDeg,
    meshSizeMm: params.meshSizeMm,
    buildDirection: [...params.buildDirection],
    zMinFilter: params.zMinFilter,
    provider: params.provider,
    limitations: [...params.limitations],
    provenance: params.provenance,
  });
}

export function parseDfmDecisionParameterMap(
  params: ReadonlyMap<string, string | number | boolean>,
): DfmDecisionParameters {
  const expected = new Set<string>();
  const str = stringReader(params, expected, "DFM");
  const posInt = positiveIntReader(params, expected, "DFM");
  const finiteNum = finiteReader(params, expected, "DFM");
  const flag = booleanReader(params, expected, "DFM");
  const caseDigest = str("dfm.case.digest");
  assertFingerprint(caseDigest, "dfm.case.digest");
  const schemaVersion = str("dfm.case.schemaVersion");
  if (schemaVersion !== DFM_CHECK_CASE_SCHEMA) {
    invalid(
      "invalid_schema",
      `dfm.case.schemaVersion must be ${DFM_CHECK_CASE_SCHEMA} (got: ${schemaVersion}).`,
    );
  }
  const id = str("dfm.case.id");
  const revision = posInt("dfm.case.revision");
  const scope = str("dfm.case.scope");
  const evidenceBoundary = str("dfm.case.evidenceBoundary");
  const project = {
    id: str("dfm.case.project.id"),
    subjectId: str("dfm.case.project.subjectId"),
  };
  const targetSha256 = str("dfm.case.target.sha256");
  assertFingerprint(targetSha256, "dfm.case.target.sha256");
  const mediaType = str("dfm.case.target.mediaType");
  if (mediaType !== DFM_TARGET_MEDIA_TYPE) {
    invalid("invalid_format", "dfm.case.target.mediaType must be model/step.");
  }
  const xUnit = str("dfm.case.buildVolumeMm.x.unit");
  const yUnit = str("dfm.case.buildVolumeMm.y.unit");
  const zUnit = str("dfm.case.buildVolumeMm.z.unit");
  const minUnit = str("dfm.case.minThicknessMm.unit");
  const meshUnit = str("dfm.case.meshSizeMm.unit");
  const overhangUnit = str("dfm.case.maxOverhangAngleDeg.unit");
  const planeUnit = str("dfm.case.zMinFilter.planeZMm.unit");
  const toleranceUnit = str("dfm.case.zMinFilter.toleranceMm.unit");
  if (
    xUnit !== "mm" || yUnit !== "mm" || zUnit !== "mm" || minUnit !== "mm" ||
    meshUnit !== "mm" || planeUnit !== "mm" || toleranceUnit !== "mm"
  ) {
    invalid("invalid_format", "DFM length units must be mm.");
  }
  if (overhangUnit !== "deg") {
    invalid("invalid_format", "DFM overhang unit must be deg.");
  }
  const envelopeTool = str("dfm.case.provider.envelopeTool");
  const thicknessTool = str("dfm.case.provider.thicknessTool");
  const overhangTool = str("dfm.case.provider.overhangTool");
  if (envelopeTool !== DFM_ENVELOPE_TOOL) {
    invalid("invalid_format", "DFM envelope tool lock is divergent.");
  }
  if (thicknessTool !== DFM_THICKNESS_TOOL) {
    invalid("invalid_format", "DFM thickness tool lock is divergent.");
  }
  if (overhangTool !== DFM_OVERHANG_TOOL) {
    invalid("invalid_format", "DFM overhang tool lock is divergent.");
  }
  const limitationCount = posInt("dfm.case.limitations.count");
  const limitations: string[] = [];
  for (let i = 0; i < limitationCount; i++) {
    limitations.push(str(`dfm.case.limitations.${i}`));
  }
  const provenanceStatus = str("dfm.case.provenance.status");
  if (provenanceStatus !== "provisional") {
    invalid("invalid_format", "DFM provenance status must be provisional.");
  }
  const toleranceValue = finiteNum("dfm.case.zMinFilter.toleranceMm.value");
  if (toleranceValue < 0) {
    invalid(
      "invalid_format",
      "dfm.case.zMinFilter.toleranceMm.value must be non-negative.",
    );
  }
  const parsed: DfmDecisionParameters = {
    caseDigest,
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target: {
      componentKey: str("dfm.case.target.componentKey"),
      artifactUri: str("dfm.case.target.artifactUri"),
      sha256: targetSha256,
      mediaType: DFM_TARGET_MEDIA_TYPE,
    },
    buildVolumeMm: {
      x: { value: finiteNum("dfm.case.buildVolumeMm.x.value"), unit: "mm" },
      y: { value: finiteNum("dfm.case.buildVolumeMm.y.value"), unit: "mm" },
      z: { value: finiteNum("dfm.case.buildVolumeMm.z.value"), unit: "mm" },
    },
    minThicknessMm: { value: finiteNum("dfm.case.minThicknessMm.value"), unit: "mm" },
    maxOverhangAngleDeg: {
      value: finiteNum("dfm.case.maxOverhangAngleDeg.value"),
      unit: "deg",
    },
    meshSizeMm: { value: finiteNum("dfm.case.meshSizeMm.value"), unit: "mm" },
    buildDirection: [
      finiteNum("dfm.case.buildDirection.0"),
      finiteNum("dfm.case.buildDirection.1"),
      finiteNum("dfm.case.buildDirection.2"),
    ],
    zMinFilter: {
      enabled: flag("dfm.case.zMinFilter.enabled"),
      planeZMm: {
        value: finiteNum("dfm.case.zMinFilter.planeZMm.value"),
        unit: "mm",
      },
      toleranceMm: { value: toleranceValue, unit: "mm" },
    },
    provider: {
      envelopeTool: DFM_ENVELOPE_TOOL,
      thicknessTool: DFM_THICKNESS_TOOL,
      overhangTool: DFM_OVERHANG_TOOL,
    },
    limitations,
    provenance: {
      status: "provisional",
      note: str("dfm.case.provenance.note"),
    },
  };
  rejectUnexpected(params, expected, "DFM");
  dfmCaseFromDecisionParameters(parsed);
  return parsed;
}

export function verifyDfmParametersMatchCase(
  params: DfmDecisionParameters,
  dfmCase: DfmCheckCase,
): void {
  match(params.schemaVersion, dfmCase.schemaVersion, "schemaVersion");
  match(params.id, dfmCase.id, "id");
  match(params.revision, dfmCase.revision, "revision");
  match(params.scope, dfmCase.scope, "scope");
  match(params.evidenceBoundary, dfmCase.evidenceBoundary, "evidenceBoundary");
  match(params.project.id, dfmCase.project.id, "project.id");
  match(params.project.subjectId, dfmCase.project.subjectId, "project.subjectId");
  match(params.target.componentKey, dfmCase.target.componentKey, "target.componentKey");
  match(params.target.artifactUri, dfmCase.target.artifactUri, "target.artifactUri");
  match(params.target.sha256, dfmCase.target.sha256, "target.sha256");
  match(params.target.mediaType, dfmCase.target.mediaType, "target.mediaType");
  match(
    params.buildVolumeMm.x.value,
    dfmCase.buildVolumeMm.x.value,
    "buildVolumeMm.x.value",
  );
  match(
    params.buildVolumeMm.y.value,
    dfmCase.buildVolumeMm.y.value,
    "buildVolumeMm.y.value",
  );
  match(
    params.buildVolumeMm.z.value,
    dfmCase.buildVolumeMm.z.value,
    "buildVolumeMm.z.value",
  );
  match(
    params.minThicknessMm.value,
    dfmCase.minThicknessMm.value,
    "minThicknessMm.value",
  );
  match(
    params.maxOverhangAngleDeg.value,
    dfmCase.maxOverhangAngleDeg.value,
    "maxOverhangAngleDeg.value",
  );
  match(params.meshSizeMm.value, dfmCase.meshSizeMm.value, "meshSizeMm.value");
  match(params.buildDirection[0], dfmCase.buildDirection[0], "buildDirection.0");
  match(params.buildDirection[1], dfmCase.buildDirection[1], "buildDirection.1");
  match(params.buildDirection[2], dfmCase.buildDirection[2], "buildDirection.2");
  match(params.zMinFilter.enabled, dfmCase.zMinFilter.enabled, "zMinFilter.enabled");
  match(
    params.zMinFilter.planeZMm.value,
    dfmCase.zMinFilter.planeZMm.value,
    "zMinFilter.planeZMm.value",
  );
  match(
    params.zMinFilter.toleranceMm.value,
    dfmCase.zMinFilter.toleranceMm.value,
    "zMinFilter.toleranceMm.value",
  );
  match(
    params.provider.envelopeTool,
    dfmCase.provider.envelopeTool,
    "provider.envelopeTool",
  );
  match(
    params.provider.thicknessTool,
    dfmCase.provider.thicknessTool,
    "provider.thicknessTool",
  );
  match(
    params.provider.overhangTool,
    dfmCase.provider.overhangTool,
    "provider.overhangTool",
  );
  if (params.limitations.length !== dfmCase.limitations.length) {
    mismatch(
      "limitations.count",
      params.limitations.length,
      dfmCase.limitations.length,
    );
  }
  for (const [i, limitation] of params.limitations.entries()) {
    match(limitation, dfmCase.limitations[i]!, `limitations.${i}`);
  }
  match(params.provenance.status, dfmCase.provenance.status, "provenance.status");
  match(params.provenance.note, dfmCase.provenance.note, "provenance.note");
}

export function verifyDfmRunParametersMatchCase(
  params: DfmRunDecisionParameters,
  dfmCase: DfmCheckCase,
  caseDigest: string,
): void {
  match(params.caseDigest, caseDigest, "run.caseDigest");
  match(params.targetSha256, dfmCase.target.sha256, "run.target.sha256");
  match(
    params.zMinFilter.enabled,
    dfmCase.zMinFilter.enabled,
    "run.zMinFilter.enabled",
  );
  match(
    params.zMinFilter.planeZMm.value,
    dfmCase.zMinFilter.planeZMm.value,
    "run.zMinFilter.planeZMm.value",
  );
  match(
    params.zMinFilter.toleranceMm.value,
    dfmCase.zMinFilter.toleranceMm.value,
    "run.zMinFilter.toleranceMm.value",
  );
}

function toMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
  label: string,
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid("duplicate_parameter", `Duplicate ${label} parameter: ${param.key}`);
    }
    result.set(param.key, param.value);
  }
  return result;
}

function stringReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => string {
  return (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    const result = String(value);
    if (result.trim() === "") {
      invalid("invalid_format", `${label} parameter ${key} must be non-empty.`);
    }
    return result;
  };
}

function positiveIntReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => number {
  return (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      invalid(
        "invalid_format",
        `${label} parameter ${key} must be a positive integer (got: ${value}).`,
      );
    }
    return n;
  };
}

function finiteReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => number {
  return (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      invalid(
        "invalid_format",
        `${label} parameter ${key} must be finite (got: ${value}).`,
      );
    }
    return n;
  };
}

function booleanReader(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): (key: string) => boolean {
  return (key: string): boolean => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing ${label} parameter: ${key}`);
    }
    if (typeof value !== "boolean") {
      invalid("invalid_format", `${label} parameter ${key} must be a boolean.`);
    }
    return value;
  };
}

function rejectUnexpected(
  params: ReadonlyMap<string, string | number | boolean>,
  expected: Set<string>,
  label: string,
): void {
  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected ${label} parameter: ${key}`);
    }
  }
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
    `dfm.case.${path} does not match the sealed case ` +
      `(signed ${JSON.stringify(actual)}, case ${JSON.stringify(expected)}).`,
  );
}

function invalid(code: DfmProposalErrorCode, message: string): never {
  throw new DfmProposalError(code, message);
}
