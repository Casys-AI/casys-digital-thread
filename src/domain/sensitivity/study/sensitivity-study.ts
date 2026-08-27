/**
 * Schema and pure-domain functions for first-order forward finite-difference
 * sensitivity studies of FEA metrics with respect to a single geometric parameter.
 *
 * Why this boundary exists: a sensitivity derivative is pure arithmetic — no
 * verdict, no threshold, no provider detail can enter here. The reviewed case
 * file declares the step, mesh, and base value; the executor only reads them.
 * Keeping this in the domain layer enforces that invariant structurally.
 * Project-specific script renderers and recipe guards live outside this
 * generic schema.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";

export const SENSITIVITY_STUDY_CASE_SCHEMA = "sensitivity-study-case/1.0" as const;

export interface SensitivityStudyCase {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  readonly target: {
    readonly componentKey: string;
    readonly semanticKey: string;
  };
  readonly recipeSource: {
    readonly schemaVersion: string;
    readonly key: string;
  };
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly step: { readonly value: number; readonly unit: string };
  readonly metrics: readonly SensitivityMetricDeclaration[];
  readonly solver: SensitivitySolverDeclaration;
  readonly domain: SensitivityDomain;
}

export interface SensitivityMetricDeclaration {
  readonly id: string;
  readonly unit: string;
}

export interface SensitivitySolverDeclaration {
  readonly provider: "calculix";
  readonly tool: "calculix_solve_static";
  readonly resultSchemaVersion: "2.0";
  readonly mesh: {
    readonly kind: "tetrahedral-volume";
    readonly targetSizeMm: number;
  };
  readonly material: {
    readonly model: "isotropic-linear-elastic";
    readonly eMpa: number;
    readonly nu: number;
    readonly basis: string;
  };
  readonly supports: readonly SensitivitySupport[];
  readonly loads: readonly SensitivityLoad[];
}

export interface SensitivitySupport {
  readonly id: string;
  readonly kind: "fixed";
  readonly selection: SensitivitySelection;
}

export interface SensitivityLoad {
  readonly id: string;
  readonly kind: "force";
  readonly selection: SensitivitySelection;
  readonly force: {
    readonly value: readonly [number, number, number];
    readonly unit: "N";
  };
}

export interface SensitivitySelection {
  readonly name: string;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  };
}

export interface SensitivityDomain {
  readonly approximationOrder: "first-order-forward";
  readonly remeshingVariationIncluded: boolean;
  readonly localValidityNote: string;
  /** Non-empty; explains choices that were considered and rejected. */
  readonly limitations: readonly string[];
}

/** Observed scalar value from a single FEA run, matched by metric id. */
export interface SensitivityMetricMeasurement {
  readonly value: number;
  readonly unit: string;
}

export interface SensitivityDerivative {
  readonly metric: string;
  readonly value: number;
  /** Composed unit: "<metricUnit>/<stepUnit>" — e.g. "mm/mm" or "MPa/mm". */
  readonly unit: string;
}

export interface SensitivityDerivatives {
  readonly derivatives: readonly SensitivityDerivative[];
  /**
   * Neighbourhood provenance so the caller cannot mistake a local slope for a
   * global one. base and step are copied from the reviewed case, not recomputed.
   */
  readonly domain: {
    readonly base: number;
    readonly step: number;
    readonly parameterUnit: string;
  };
}

// --- validation ---------------------------------------------------------------

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "recipeSource",
  "baseValue",
  "step",
  "metrics",
  "solver",
  "domain",
] as const;

const SELECTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Parse and validate an untrusted value as a sensitivity-study-case/1.0 case. */
export function validateSensitivityStudyCase(value: unknown): SensitivityStudyCase {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CASE_SCHEMA,
    "$case.schemaVersion",
  );

  const id = safeId(root.id, "$case.id");
  const revision = positiveInteger(root.revision, "$case.revision");
  const scope = nonEmptyText(root.scope, "$case.scope");
  const evidenceBoundary = nonEmptyText(
    root.evidenceBoundary,
    "$case.evidenceBoundary",
  );

  const project = parseProject(root.project);
  const target = parseTarget(root.target);
  const recipeSource = parseRecipeSource(root.recipeSource);
  const baseValue = parseQuantity(root.baseValue, "$case.baseValue");
  const step = parseStep(root.step);

  const rawMetrics = nonEmptyArray(root.metrics, "$case.metrics");
  const metrics = rawMetrics.map((item, index) =>
    parseMetricDeclaration(item, `$case.metrics[${index}]`)
  );
  rejectDuplicates(metrics.map((m) => m.id), "$case.metrics ids");

  const solver = parseSolver(root.solver);
  const domain = parseDomain(root.domain);

  return deepFreeze({
    schemaVersion: SENSITIVITY_STUDY_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    recipeSource,
    baseValue,
    step,
    metrics,
    solver,
    domain,
  });
}

/**
 * Compute first-order forward finite differences for all declared metrics.
 *
 * Pure arithmetic: (stepped[m] − base[m]) / step.value, with the composed unit
 * "<metricUnit>/<stepUnit>". No rounding, no verdict, no threshold. Rejects any
 * measurement whose declared unit diverges from the case declaration so unit
 * confusion cannot silently propagate into the derivative.
 */
/**
 * Shared finite-difference input. Both sensitivity-study-case/1.0 and /2.0
 * satisfy this structurally; the arithmetic must not depend on recipeSource
 * or cadSource.
 */
export interface SensitivityFiniteDifferenceCase {
  readonly metrics: readonly SensitivityMetricDeclaration[];
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly step: { readonly value: number; readonly unit: string };
}

export function computeSensitivities(
  sensitivityCase: SensitivityFiniteDifferenceCase,
  baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
): SensitivityDerivatives {
  const stepValue = sensitivityCase.step.value;
  const stepUnit = sensitivityCase.step.unit;

  const derivatives: SensitivityDerivative[] = [];

  for (const declaration of sensitivityCase.metrics) {
    const baseMeasurement = baseMetrics.get(declaration.id);
    if (baseMeasurement === undefined) {
      throw new TypeError(
        `$metrics.${declaration.id}: base measurement not found.`,
      );
    }
    if (baseMeasurement.unit !== declaration.unit) {
      throw new TypeError(
        `$metrics.${declaration.id}: base unit mismatch ` +
          `(expected ${JSON.stringify(declaration.unit)}, ` +
          `got ${JSON.stringify(baseMeasurement.unit)}).`,
      );
    }

    const steppedMeasurement = steppedMetrics.get(declaration.id);
    if (steppedMeasurement === undefined) {
      throw new TypeError(
        `$metrics.${declaration.id}: stepped measurement not found.`,
      );
    }
    if (steppedMeasurement.unit !== declaration.unit) {
      throw new TypeError(
        `$metrics.${declaration.id}: stepped unit mismatch ` +
          `(expected ${JSON.stringify(declaration.unit)}, ` +
          `got ${JSON.stringify(steppedMeasurement.unit)}).`,
      );
    }

    derivatives.push({
      metric: declaration.id,
      value: (steppedMeasurement.value - baseMeasurement.value) / stepValue,
      unit: `${declaration.unit}/${stepUnit}`,
    });
  }

  return deepFreeze({
    derivatives,
    domain: {
      base: sensitivityCase.baseValue.value,
      step: stepValue,
      parameterUnit: sensitivityCase.baseValue.unit,
    },
  });
}

// --- internal parsers ---------------------------------------------------------

function parseProject(value: unknown): SensitivityStudyCase["project"] {
  const input = exactRecord(value, ["id", "subjectId"], "$case.project");
  return {
    id: safeId(input.id, "$case.project.id"),
    subjectId: safeId(input.subjectId, "$case.project.subjectId"),
  };
}

function parseTarget(value: unknown): SensitivityStudyCase["target"] {
  const input = exactRecord(value, ["componentKey", "semanticKey"], "$case.target");
  return {
    componentKey: safeId(input.componentKey, "$case.target.componentKey"),
    semanticKey: safeId(input.semanticKey, "$case.target.semanticKey"),
  };
}

function parseRecipeSource(value: unknown): SensitivityStudyCase["recipeSource"] {
  const input = exactRecord(value, ["schemaVersion", "key"], "$case.recipeSource");
  return {
    schemaVersion: nonEmptyText(
      input.schemaVersion,
      "$case.recipeSource.schemaVersion",
    ),
    key: safeId(input.key, "$case.recipeSource.key"),
  };
}

function parseQuantity(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: string } {
  const input = exactRecord(value, ["value", "unit"], path);
  return {
    value: finite(input.value, `${path}.value`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

function parseStep(value: unknown): SensitivityStudyCase["step"] {
  const input = exactRecord(value, ["value", "unit"], "$case.step");
  const v = finite(input.value, "$case.step.value");
  if (v === 0) {
    throw new TypeError("$case.step.value must not be zero.");
  }
  return {
    value: v,
    unit: nonEmptyText(input.unit, "$case.step.unit"),
  };
}

function parseMetricDeclaration(
  value: unknown,
  path: string,
): SensitivityMetricDeclaration {
  const input = exactRecord(value, ["id", "unit"], path);
  return {
    id: nonEmptyText(input.id, `${path}.id`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

function parseSolver(value: unknown): SensitivitySolverDeclaration {
  const input = exactRecord(
    value,
    [
      "provider",
      "tool",
      "resultSchemaVersion",
      "mesh",
      "material",
      "supports",
      "loads",
    ],
    "$case.solver",
  );
  literalValue(input.provider, "calculix", "$case.solver.provider");
  literalValue(input.tool, "calculix_solve_static", "$case.solver.tool");
  literalValue(input.resultSchemaVersion, "2.0", "$case.solver.resultSchemaVersion");

  const mesh = parseSolverMesh(input.mesh);
  const material = parseSolverMaterial(input.material);

  const rawSupports = nonEmptyArray(input.supports, "$case.solver.supports");
  const supports = rawSupports.map((item, i) =>
    parseSolverSupport(item, `$case.solver.supports[${i}]`)
  );

  const rawLoads = nonEmptyArray(input.loads, "$case.solver.loads");
  const loads = rawLoads.map((item, i) =>
    parseSolverLoad(item, `$case.solver.loads[${i}]`)
  );

  rejectDuplicates(supports.map((s) => s.id), "$case.solver.supports ids");
  rejectDuplicates(loads.map((l) => l.id), "$case.solver.loads ids");
  rejectDuplicates(
    [
      ...supports.map((s) => s.selection.name),
      ...loads.map((l) => l.selection.name),
    ],
    "$case.solver selection names",
  );

  return {
    provider: "calculix",
    tool: "calculix_solve_static",
    resultSchemaVersion: "2.0",
    mesh,
    material,
    supports,
    loads,
  };
}

function parseSolverMesh(value: unknown): SensitivitySolverDeclaration["mesh"] {
  const input = exactRecord(value, ["kind", "targetSizeMm"], "$case.solver.mesh");
  literalValue(input.kind, "tetrahedral-volume", "$case.solver.mesh.kind");
  const size = finite(input.targetSizeMm, "$case.solver.mesh.targetSizeMm");
  if (size <= 0) {
    throw new TypeError("$case.solver.mesh.targetSizeMm must be positive.");
  }
  return { kind: "tetrahedral-volume", targetSizeMm: size };
}

function parseSolverMaterial(
  value: unknown,
): SensitivitySolverDeclaration["material"] {
  const input = exactRecord(
    value,
    ["model", "eMpa", "nu", "basis"],
    "$case.solver.material",
  );
  literalValue(input.model, "isotropic-linear-elastic", "$case.solver.material.model");
  const eMpa = finite(input.eMpa, "$case.solver.material.eMpa");
  if (eMpa <= 0) throw new TypeError("$case.solver.material.eMpa must be positive.");
  const nu = finite(input.nu, "$case.solver.material.nu");
  if (nu <= 0 || nu >= 0.5) {
    throw new TypeError(
      "$case.solver.material.nu must be in the open interval (0, 0.5).",
    );
  }
  return {
    model: "isotropic-linear-elastic",
    eMpa,
    nu,
    basis: nonEmptyText(input.basis, "$case.solver.material.basis"),
  };
}

function parseSolverSupport(value: unknown, path: string): SensitivitySupport {
  const input = exactRecord(value, ["id", "kind", "selection"], path);
  literalValue(input.kind, "fixed", `${path}.kind`);
  return {
    id: safeId(input.id, `${path}.id`),
    kind: "fixed",
    selection: parseSelection(input.selection, `${path}.selection`),
  };
}

function parseSolverLoad(value: unknown, path: string): SensitivityLoad {
  const input = exactRecord(value, ["id", "kind", "selection", "force"], path);
  literalValue(input.kind, "force", `${path}.kind`);
  return {
    id: safeId(input.id, `${path}.id`),
    kind: "force",
    selection: parseSelection(input.selection, `${path}.selection`),
    force: parseForce(input.force, `${path}.force`),
  };
}

function parseSelection(value: unknown, path: string): SensitivitySelection {
  const input = exactRecord(value, ["name", "box"], path);
  const name = nonEmptyText(input.name, `${path}.name`);
  if (!SELECTION_NAME.test(name)) {
    throw new TypeError(
      `${path}.name must start with a letter and contain only letters, ` +
        `digits or underscores (max 64 chars).`,
    );
  }
  return { name, box: parseBox(input.box, `${path}.box`) };
}

function parseBox(value: unknown, path: string): SensitivitySelection["box"] {
  const input = exactRecord(value, ["min", "max", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  const min = vectorValues(input.min, `${path}.min`);
  const max = vectorValues(input.max, `${path}.max`);
  min.forEach((component, axis) => {
    if (component >= max[axis]) {
      throw new TypeError(`${path}.min[${axis}] must be less than max[${axis}].`);
    }
  });
  return { min, max, unit: "mm" };
}

function parseForce(value: unknown, path: string): SensitivityLoad["force"] {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "N", `${path}.unit`);
  const v = vectorValues(input.value, `${path}.value`);
  if (v.every((c) => c === 0)) {
    throw new TypeError(`${path}.value must have at least one non-zero component.`);
  }
  return { value: v, unit: "N" };
}

function parseDomain(value: unknown): SensitivityDomain {
  const input = exactRecord(
    value,
    [
      "approximationOrder",
      "remeshingVariationIncluded",
      "localValidityNote",
      "limitations",
    ],
    "$case.domain",
  );
  literalValue(
    input.approximationOrder,
    "first-order-forward",
    "$case.domain.approximationOrder",
  );
  if (typeof input.remeshingVariationIncluded !== "boolean") {
    throw new TypeError("$case.domain.remeshingVariationIncluded must be a boolean.");
  }
  const localValidityNote = nonEmptyText(
    input.localValidityNote,
    "$case.domain.localValidityNote",
  );
  const rawLimitations = nonEmptyArray(
    input.limitations,
    "$case.domain.limitations",
  );
  const limitations = rawLimitations.map((item, i) =>
    nonEmptyText(item, `$case.domain.limitations[${i}]`)
  );
  rejectDuplicates(limitations, "$case.domain.limitations");
  return {
    approximationOrder: "first-order-forward",
    remeshingVariationIncluded: input.remeshingVariationIncluded,
    localValidityNote,
    limitations,
  };
}

// --- domain-specific helpers --------------------------------------------------

function vectorValues(value: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be an array of exactly three finite numbers.`);
  }
  return value.map((component, index) => finite(component, `${path}[${index}]`)) as [
    number,
    number,
    number,
  ];
}
