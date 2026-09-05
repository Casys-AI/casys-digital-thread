/**
 * MRTR grammar and fail-closed parsers for `analyze.seal-sensitivity-study@1`.
 *
 * WHY DOMAIN LAYER — registry, proposal gate and executor all need the
 * operation identities and the same parse. Defining them in an adapter would
 * force the registry to import outward.
 *
 * The human signs the complete provider-neutral sensitivity-study-case/3.0 identity, including
 * the Thread cadSource. The step, mesh and boundary conditions are reviewed
 * fields, never chosen at execution.
 */

import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
} from "../../project/engineering-project.ts";
import {
  SENSITIVITY_STUDY_CASE_V3_SCHEMA,
  type SensitivityCadSource,
  type SensitivityStudyCaseV3,
} from "./sensitivity-study-v3.ts";
import type {
  SensitivityDomain,
  SensitivityLoad,
  SensitivityMetricDeclaration,
  SensitivityStaticStructuralMethod,
  SensitivitySupport,
} from "./sensitivity-study.ts";

export const ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION = {
  id: "analyze.seal-sensitivity-study",
  version: "1",
} as const;

/** Work-item operation for `project_change_append`. Numbers stay in the MRTR. */
export function sealSensitivityStudyWorkItemOperation(): EngineeringOperationRef {
  return {
    id: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id,
    version: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

export const ANALYZE_RUN_FEA_SENSITIVITY_OPERATION = {
  id: "analyze.run-fea-sensitivity",
  version: "1",
} as const;

export const MODEL_WRITE_SENSITIVITY_EDGES_OPERATION = {
  id: "model.write-sensitivity-edges",
  version: "1",
} as const;

export type SensitivityStudyProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class SensitivityStudyProposalError extends Error {
  constructor(
    readonly code: SensitivityStudyProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SensitivityStudyProposalError";
  }
}

export interface SensitivityStudyDecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CASE_V3_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: SensitivityStudyCaseV3["project"];
  readonly target: SensitivityStudyCaseV3["target"];
  readonly cadSource: SensitivityCadSource;
  readonly baseValue: SensitivityStudyCaseV3["baseValue"];
  readonly step: SensitivityStudyCaseV3["step"];
  readonly metrics: readonly SensitivityMetricDeclaration[];
  readonly method: SensitivityStaticStructuralMethod;
  readonly domain: SensitivityDomain;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalSensitivityStudyCaseText(
  studyCase: SensitivityStudyCaseV3,
): string {
  return deterministicJson(studyCase);
}

export function encodeSensitivityStudyDecisionParameters(
  caseDigest: string,
  studyCase: SensitivityStudyCaseV3,
): readonly EngineeringDecisionProposalParameter[] {
  assertFingerprint(caseDigest, "caseDigest");
  assertFingerprint(studyCase.cadSource.sha256, "cadSource.sha256");

  const result: EngineeringDecisionProposalParameter[] = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => result.push({ key, label, value });

  p("sensitivity.case.digest", "Sensitivity case SHA-256 digest", caseDigest);
  p(
    "sensitivity.case.schemaVersion",
    "Sensitivity case schema version",
    studyCase.schemaVersion,
  );
  p("sensitivity.case.id", "Sensitivity case ID", studyCase.id);
  p("sensitivity.case.revision", "Sensitivity case revision", studyCase.revision);
  p("sensitivity.case.scope", "Sensitivity case scope", studyCase.scope);
  p(
    "sensitivity.case.evidenceBoundary",
    "Evidence boundary",
    studyCase.evidenceBoundary,
  );
  p("sensitivity.case.project.id", "Project ID", studyCase.project.id);
  p(
    "sensitivity.case.project.subjectId",
    "Subject ID",
    studyCase.project.subjectId,
  );
  p(
    "sensitivity.case.target.componentKey",
    "Target component key",
    studyCase.target.componentKey,
  );
  p(
    "sensitivity.case.target.semanticKey",
    "Target semantic key",
    studyCase.target.semanticKey,
  );
  p(
    "sensitivity.case.cadSource.artifactUri",
    "CAD admission artifact URI",
    studyCase.cadSource.artifactUri,
  );
  p(
    "sensitivity.case.cadSource.sha256",
    "CAD admission SHA-256",
    studyCase.cadSource.sha256,
  );
  p(
    "sensitivity.case.baseValue.value",
    "Base parameter value",
    studyCase.baseValue.value,
  );
  p(
    "sensitivity.case.baseValue.unit",
    "Base parameter unit",
    studyCase.baseValue.unit,
  );
  p(
    "sensitivity.case.step.value",
    "Finite-difference step value",
    studyCase.step.value,
  );
  p("sensitivity.case.step.unit", "Finite-difference step unit", studyCase.step.unit);

  p("sensitivity.case.metrics.count", "Metric count", studyCase.metrics.length);
  for (const [i, metric] of studyCase.metrics.entries()) {
    p(`sensitivity.case.metrics.${i}.id`, `Metric ${i} ID`, metric.id);
    p(`sensitivity.case.metrics.${i}.unit`, `Metric ${i} unit`, metric.unit);
  }

  p("sensitivity.case.method.mesh.kind", "Mesh kind", studyCase.method.mesh.kind);
  p(
    "sensitivity.case.method.mesh.targetSizeMm",
    "Mesh target size (mm)",
    studyCase.method.mesh.targetSizeMm,
  );
  p(
    "sensitivity.case.method.material.model",
    "Material model",
    studyCase.method.material.model,
  );
  p(
    "sensitivity.case.method.material.eMpa",
    "Young modulus (MPa)",
    studyCase.method.material.eMpa,
  );
  p(
    "sensitivity.case.method.material.nu",
    "Poisson ratio",
    studyCase.method.material.nu,
  );
  p(
    "sensitivity.case.method.material.basis",
    "Material basis",
    studyCase.method.material.basis,
  );

  p(
    "sensitivity.case.method.supports.count",
    "Fixed support count",
    studyCase.method.supports.length,
  );
  for (const [i, support] of studyCase.method.supports.entries()) {
    encodeSupport(p, i, support);
  }

  p(
    "sensitivity.case.method.loads.count",
    "Force load count",
    studyCase.method.loads.length,
  );
  for (const [i, load] of studyCase.method.loads.entries()) {
    encodeLoad(p, i, load);
  }

  p(
    "sensitivity.case.domain.approximationOrder",
    "Approximation order",
    studyCase.domain.approximationOrder,
  );
  p(
    "sensitivity.case.domain.remeshingVariationIncluded",
    "Remeshing variation included",
    studyCase.domain.remeshingVariationIncluded,
  );
  p(
    "sensitivity.case.domain.localValidityNote",
    "Local validity note",
    studyCase.domain.localValidityNote,
  );
  p(
    "sensitivity.case.domain.limitations.count",
    "Limitation count",
    studyCase.domain.limitations.length,
  );
  for (const [i, limitation] of studyCase.domain.limitations.entries()) {
    p(
      `sensitivity.case.domain.limitations.${i}`,
      `Limitation ${i}`,
      limitation,
    );
  }

  return result;
}

export function sensitivityStudyDecisionParametersToMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid("duplicate_parameter", `Duplicate sensitivity parameter: ${param.key}`);
    }
    result.set(param.key, param.value);
  }
  return result;
}

export function parseSensitivityStudyDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SensitivityStudyDecisionParameters {
  return parseSensitivityStudyDecisionParameterMap(
    sensitivityStudyDecisionParametersToMap(parameters),
  );
}

export function parseSensitivityStudyDecisionParameterMap(
  params: ReadonlyMap<string, string | number | boolean>,
): SensitivityStudyDecisionParameters {
  const expected = new Set<string>();
  const str = (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing sensitivity parameter: ${key}`);
    }
    const result = String(value);
    if (result.trim() === "") {
      invalid("invalid_format", `Sensitivity parameter ${key} must be non-empty.`);
    }
    return result;
  };
  const posInt = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing sensitivity parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      invalid(
        "invalid_format",
        `Sensitivity parameter ${key} must be a positive integer (got: ${value}).`,
      );
    }
    return n;
  };
  const finiteNum = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing sensitivity parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      invalid(
        "invalid_format",
        `Sensitivity parameter ${key} must be finite (got: ${value}).`,
      );
    }
    return n;
  };
  const flag = (key: string): boolean => {
    expected.add(key);
    const value = params.get(key);
    if (typeof value !== "boolean") {
      invalid(
        "invalid_format",
        `Sensitivity parameter ${key} must be a boolean.`,
      );
    }
    return value;
  };

  const caseDigest = str("sensitivity.case.digest");
  assertFingerprint(caseDigest, "sensitivity.case.digest");

  const schemaVersion = str("sensitivity.case.schemaVersion");
  if (schemaVersion !== SENSITIVITY_STUDY_CASE_V3_SCHEMA) {
    invalid(
      "invalid_schema",
      `sensitivity.case.schemaVersion must be ${SENSITIVITY_STUDY_CASE_V3_SCHEMA} (got: ${schemaVersion}).`,
    );
  }

  const id = str("sensitivity.case.id");
  const revision = posInt("sensitivity.case.revision");
  const scope = str("sensitivity.case.scope");
  const evidenceBoundary = str("sensitivity.case.evidenceBoundary");
  const project = {
    id: str("sensitivity.case.project.id"),
    subjectId: str("sensitivity.case.project.subjectId"),
  };
  const target = {
    componentKey: str("sensitivity.case.target.componentKey"),
    semanticKey: str("sensitivity.case.target.semanticKey"),
  };
  const cadSource = {
    artifactUri: str("sensitivity.case.cadSource.artifactUri"),
    sha256: str("sensitivity.case.cadSource.sha256"),
  };
  assertFingerprint(cadSource.sha256, "sensitivity.case.cadSource.sha256");

  const baseValue = {
    value: finiteNum("sensitivity.case.baseValue.value"),
    unit: str("sensitivity.case.baseValue.unit"),
  };
  const step = {
    value: finiteNum("sensitivity.case.step.value"),
    unit: str("sensitivity.case.step.unit"),
  };

  const metricCount = posInt("sensitivity.case.metrics.count");
  const metrics: SensitivityMetricDeclaration[] = [];
  for (let i = 0; i < metricCount; i++) {
    metrics.push({
      id: str(`sensitivity.case.metrics.${i}.id`),
      unit: str(`sensitivity.case.metrics.${i}.unit`),
    });
  }

  const meshKind = str("sensitivity.case.method.mesh.kind");
  if (meshKind !== "tetrahedral-volume") {
    invalid(
      "invalid_format",
      "sensitivity.case.method.mesh.kind must be tetrahedral-volume.",
    );
  }
  const materialModel = str("sensitivity.case.method.material.model");
  if (materialModel !== "isotropic-linear-elastic") {
    invalid(
      "invalid_format",
      "sensitivity.case.method.material.model must be isotropic-linear-elastic.",
    );
  }
  const targetSizeMm = finiteNum("sensitivity.case.method.mesh.targetSizeMm");
  const eMpa = finiteNum("sensitivity.case.method.material.eMpa");
  const nu = finiteNum("sensitivity.case.method.material.nu");
  const materialBasis = str("sensitivity.case.method.material.basis");

  const supportCount = posInt("sensitivity.case.method.supports.count");
  const supports: SensitivitySupport[] = [];
  for (let i = 0; i < supportCount; i++) {
    supports.push(parseSupport(str, finiteNum, i));
  }
  const loadCount = posInt("sensitivity.case.method.loads.count");
  const loads: SensitivityLoad[] = [];
  for (let i = 0; i < loadCount; i++) {
    loads.push(parseLoad(str, finiteNum, i));
  }

  const approximationOrder = str("sensitivity.case.domain.approximationOrder");
  if (approximationOrder !== "first-order-forward") {
    invalid(
      "invalid_format",
      "sensitivity.case.domain.approximationOrder must be first-order-forward.",
    );
  }
  const remeshingVariationIncluded = flag(
    "sensitivity.case.domain.remeshingVariationIncluded",
  );
  const localValidityNote = str("sensitivity.case.domain.localValidityNote");
  const limitationCount = posInt("sensitivity.case.domain.limitations.count");
  const limitations: string[] = [];
  for (let i = 0; i < limitationCount; i++) {
    limitations.push(str(`sensitivity.case.domain.limitations.${i}`));
  }

  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid("unexpected_parameter", `Unexpected sensitivity parameter: ${key}`);
    }
  }

  return {
    caseDigest,
    schemaVersion: SENSITIVITY_STUDY_CASE_V3_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    cadSource,
    baseValue,
    step,
    metrics,
    method: {
      mesh: {
        kind: "tetrahedral-volume",
        targetSizeMm,
      },
      material: {
        model: "isotropic-linear-elastic",
        eMpa,
        nu,
        basis: materialBasis,
      },
      supports,
      loads,
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded,
      localValidityNote,
      limitations,
    },
  };
}

export function verifySensitivityStudyParametersMatchCase(
  params: SensitivityStudyDecisionParameters,
  studyCase: SensitivityStudyCaseV3,
): void {
  match(params.schemaVersion, studyCase.schemaVersion, "schemaVersion");
  match(params.id, studyCase.id, "id");
  match(params.revision, studyCase.revision, "revision");
  match(params.scope, studyCase.scope, "scope");
  match(params.evidenceBoundary, studyCase.evidenceBoundary, "evidenceBoundary");
  match(params.project.id, studyCase.project.id, "project.id");
  match(params.project.subjectId, studyCase.project.subjectId, "project.subjectId");
  match(
    params.target.componentKey,
    studyCase.target.componentKey,
    "target.componentKey",
  );
  match(params.target.semanticKey, studyCase.target.semanticKey, "target.semanticKey");
  match(
    params.cadSource.artifactUri,
    studyCase.cadSource.artifactUri,
    "cadSource.artifactUri",
  );
  match(params.cadSource.sha256, studyCase.cadSource.sha256, "cadSource.sha256");
  match(params.baseValue.value, studyCase.baseValue.value, "baseValue.value");
  match(params.baseValue.unit, studyCase.baseValue.unit, "baseValue.unit");
  match(params.step.value, studyCase.step.value, "step.value");
  match(params.step.unit, studyCase.step.unit, "step.unit");
  if (params.metrics.length !== studyCase.metrics.length) {
    mismatch("metrics.count", params.metrics.length, studyCase.metrics.length);
  }
  for (const [i, metric] of params.metrics.entries()) {
    match(metric.id, studyCase.metrics[i]!.id, `metrics.${i}.id`);
    match(metric.unit, studyCase.metrics[i]!.unit, `metrics.${i}.unit`);
  }
  match(params.method.mesh.kind, studyCase.method.mesh.kind, "method.mesh.kind");
  match(
    params.method.mesh.targetSizeMm,
    studyCase.method.mesh.targetSizeMm,
    "method.mesh.targetSizeMm",
  );
  match(
    params.method.material.model,
    studyCase.method.material.model,
    "method.material.model",
  );
  match(
    params.method.material.eMpa,
    studyCase.method.material.eMpa,
    "method.material.eMpa",
  );
  match(params.method.material.nu, studyCase.method.material.nu, "method.material.nu");
  match(
    params.method.material.basis,
    studyCase.method.material.basis,
    "method.material.basis",
  );
  if (params.method.supports.length !== studyCase.method.supports.length) {
    mismatch(
      "method.supports.count",
      params.method.supports.length,
      studyCase.method.supports.length,
    );
  }
  for (const [i, support] of params.method.supports.entries()) {
    const ref = studyCase.method.supports[i]!;
    match(support.id, ref.id, `method.supports.${i}.id`);
    match(support.kind, ref.kind, `method.supports.${i}.kind`);
    match(
      support.selection.name,
      ref.selection.name,
      `method.supports.${i}.selection.name`,
    );
    matchBox(
      support.selection.box,
      ref.selection.box,
      `method.supports.${i}.selection.box`,
    );
  }
  if (params.method.loads.length !== studyCase.method.loads.length) {
    mismatch(
      "method.loads.count",
      params.method.loads.length,
      studyCase.method.loads.length,
    );
  }
  for (const [i, load] of params.method.loads.entries()) {
    const ref = studyCase.method.loads[i]!;
    match(load.id, ref.id, `method.loads.${i}.id`);
    match(load.kind, ref.kind, `method.loads.${i}.kind`);
    match(load.selection.name, ref.selection.name, `method.loads.${i}.selection.name`);
    matchBox(load.selection.box, ref.selection.box, `method.loads.${i}.selection.box`);
    match(load.force.unit, ref.force.unit, `method.loads.${i}.force.unit`);
    matchTriple(load.force.value, ref.force.value, `method.loads.${i}.force.value`);
  }
  match(
    params.domain.approximationOrder,
    studyCase.domain.approximationOrder,
    "domain.approximationOrder",
  );
  match(
    params.domain.remeshingVariationIncluded,
    studyCase.domain.remeshingVariationIncluded,
    "domain.remeshingVariationIncluded",
  );
  match(
    params.domain.localValidityNote,
    studyCase.domain.localValidityNote,
    "domain.localValidityNote",
  );
  if (params.domain.limitations.length !== studyCase.domain.limitations.length) {
    mismatch(
      "domain.limitations.count",
      params.domain.limitations.length,
      studyCase.domain.limitations.length,
    );
  }
  for (const [i, limitation] of params.domain.limitations.entries()) {
    match(limitation, studyCase.domain.limitations[i]!, `domain.limitations.${i}`);
  }
}

function encodeSupport(
  p: (key: string, label: string, value: string | number | boolean) => void,
  index: number,
  support: SensitivitySupport,
): void {
  p(`sensitivity.case.method.supports.${index}.id`, `Support ${index} ID`, support.id);
  p(
    `sensitivity.case.method.supports.${index}.kind`,
    `Support ${index} kind`,
    support.kind,
  );
  p(
    `sensitivity.case.method.supports.${index}.selection.name`,
    `Support ${index} selection`,
    support.selection.name,
  );
  encodeBox(
    p,
    `sensitivity.case.method.supports.${index}.selection`,
    support.selection.box,
  );
}

function encodeLoad(
  p: (key: string, label: string, value: string | number | boolean) => void,
  index: number,
  load: SensitivityLoad,
): void {
  p(`sensitivity.case.method.loads.${index}.id`, `Load ${index} ID`, load.id);
  p(`sensitivity.case.method.loads.${index}.kind`, `Load ${index} kind`, load.kind);
  p(
    `sensitivity.case.method.loads.${index}.selection.name`,
    `Load ${index} selection`,
    load.selection.name,
  );
  encodeBox(p, `sensitivity.case.method.loads.${index}.selection`, load.selection.box);
  p(
    `sensitivity.case.method.loads.${index}.force.unit`,
    `Load ${index} force unit`,
    load.force.unit,
  );
  for (const axis of [0, 1, 2] as const) {
    p(
      `sensitivity.case.method.loads.${index}.force.value.${axis}`,
      `Load ${index} force ${axis} (N)`,
      load.force.value[axis],
    );
  }
}

function encodeBox(
  p: (key: string, label: string, value: string | number | boolean) => void,
  prefix: string,
  box: SensitivitySupport["selection"]["box"],
): void {
  p(`${prefix}.box.unit`, `${prefix} box unit`, box.unit);
  for (const axis of [0, 1, 2] as const) {
    p(`${prefix}.box.min.${axis}`, `${prefix} box min ${axis}`, box.min[axis]);
    p(`${prefix}.box.max.${axis}`, `${prefix} box max ${axis}`, box.max[axis]);
  }
}

function parseSupport(
  str: (key: string) => string,
  finiteNum: (key: string) => number,
  index: number,
): SensitivitySupport {
  const kind = str(`sensitivity.case.method.supports.${index}.kind`);
  if (kind !== "fixed") {
    invalid(
      "invalid_format",
      `sensitivity.case.method.supports.${index}.kind must be fixed.`,
    );
  }
  return {
    id: str(`sensitivity.case.method.supports.${index}.id`),
    kind: "fixed",
    selection: {
      name: str(`sensitivity.case.method.supports.${index}.selection.name`),
      box: parseBox(
        str,
        finiteNum,
        `sensitivity.case.method.supports.${index}.selection`,
      ),
    },
  };
}

function parseLoad(
  str: (key: string) => string,
  finiteNum: (key: string) => number,
  index: number,
): SensitivityLoad {
  const kind = str(`sensitivity.case.method.loads.${index}.kind`);
  if (kind !== "force") {
    invalid(
      "invalid_format",
      `sensitivity.case.method.loads.${index}.kind must be force.`,
    );
  }
  const forceUnit = str(`sensitivity.case.method.loads.${index}.force.unit`);
  if (forceUnit !== "N") {
    invalid(
      "invalid_format",
      `sensitivity.case.method.loads.${index}.force.unit must be N.`,
    );
  }
  return {
    id: str(`sensitivity.case.method.loads.${index}.id`),
    kind: "force",
    selection: {
      name: str(`sensitivity.case.method.loads.${index}.selection.name`),
      box: parseBox(str, finiteNum, `sensitivity.case.method.loads.${index}.selection`),
    },
    force: {
      unit: "N",
      value: [
        finiteNum(`sensitivity.case.method.loads.${index}.force.value.0`),
        finiteNum(`sensitivity.case.method.loads.${index}.force.value.1`),
        finiteNum(`sensitivity.case.method.loads.${index}.force.value.2`),
      ],
    },
  };
}

function parseBox(
  str: (key: string) => string,
  finiteNum: (key: string) => number,
  prefix: string,
): SensitivitySupport["selection"]["box"] {
  const unit = str(`${prefix}.box.unit`);
  if (unit !== "mm") {
    invalid("invalid_format", `${prefix}.box.unit must be mm.`);
  }
  return {
    unit: "mm",
    min: [
      finiteNum(`${prefix}.box.min.0`),
      finiteNum(`${prefix}.box.min.1`),
      finiteNum(`${prefix}.box.min.2`),
    ],
    max: [
      finiteNum(`${prefix}.box.max.0`),
      finiteNum(`${prefix}.box.max.1`),
      finiteNum(`${prefix}.box.max.2`),
    ],
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
  if (actual !== expected) {
    mismatch(path, actual, expected);
  }
}

function matchBox(
  actual: SensitivitySupport["selection"]["box"],
  expected: SensitivitySupport["selection"]["box"],
  path: string,
): void {
  match(actual.unit, expected.unit, `${path}.unit`);
  matchTriple(actual.min, expected.min, `${path}.min`);
  matchTriple(actual.max, expected.max, `${path}.max`);
}

function matchTriple(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
  path: string,
): void {
  for (const axis of [0, 1, 2] as const) {
    match(actual[axis], expected[axis], `${path}.${axis}`);
  }
}

function mismatch(path: string, actual: unknown, expected: unknown): never {
  invalid(
    "parameter_mismatch",
    `sensitivity.case.${path} does not match the sealed case ` +
      `(signed ${JSON.stringify(actual)}, case ${JSON.stringify(expected)}).`,
  );
}

function invalid(
  code: SensitivityStudyProposalErrorCode,
  message: string,
): never {
  throw new SensitivityStudyProposalError(code, message);
}
