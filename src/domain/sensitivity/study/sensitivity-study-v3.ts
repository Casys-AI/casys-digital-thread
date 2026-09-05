/**
 * Schema 3.0 for first-order forward finite-difference sensitivity studies.
 *
 * Why 3.0 differs from 2.0 — 2.0 carried CalculiX provider/tool/response
 * literals in the sealed project case while claiming the executor selected
 * them. That mixed physical method facts with server-owned runtime binding.
 * Version 3.0 replaces the `solver` declaration with a provider-neutral
 * `method` declaration. The registered server operation selects its exact
 * binding, client, tool and response parser independently.
 *
 * The versioned case names an exact content-addressed Thread artifact (the sealed
 * compilation admission) as `cadSource`. The artifact URI is provided by the agent
 * from the Thread; the executor re-reads and re-validates it before staging the
 * perturbed Build123d run.
 *
 * The remaining invariants are unchanged:
 *   - The step value comes from the reviewed case; executors never choose it.
 *   - The study produces data (derivatives), never a verdict.
 *   - No provider name, tool name, response schema or argument appears here.
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
import type {
  SensitivityDomain,
  SensitivityLoad,
  SensitivityMetricDeclaration,
  SensitivitySelection,
  SensitivityStaticStructuralMethod,
  SensitivitySupport,
} from "./sensitivity-study.ts";

export const SENSITIVITY_STUDY_CASE_V3_SCHEMA = "sensitivity-study-case/3.0" as const;

// Re-export unchanged sub-types from 1.0 so consumers only import from here.
export type {
  SensitivityDomain,
  SensitivityLoad,
  SensitivityMetricDeclaration,
  SensitivitySelection,
  SensitivityStaticStructuralMethod,
  SensitivitySupport,
} from "./sensitivity-study.ts";

/**
 * A reference to a content-addressed Thread artifact that carries the exact
 * Build123d compilation admission to perturb. The executor re-reads this
 * artifact from the Thread, validates the SHA-256, and derives the parametric
 * Build123d source from it — the agent never supplies raw source text.
 */
export interface SensitivityCadSource {
  /**
   * Thread artifact URI of the sealed compilation admission. The executor uses
   * this as the read key for the Thread artifact store.
   * Form: "thread-artifact://<project-id>/<artifact-id>".
   */
  readonly artifactUri: string;
  /**
   * SHA-256 of the canonical bytes of the compilation admission artifact. The
   * executor validates the re-read bytes against this digest before any
   * Build123d staging.
   */
  readonly sha256: string;
}

export interface SensitivityStudyCaseV3 {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CASE_V3_SCHEMA;
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
  /**
   * Points to the exact content-addressed Thread artifact (sealed compilation
   * admission) from which the executor
   * will derive the parametric Build123d source. The agent names the URI
   * from the Thread; the server re-reads and re-validates.
   */
  readonly cadSource: SensitivityCadSource;
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly step: { readonly value: number; readonly unit: string };
  readonly metrics: readonly SensitivityMetricDeclaration[];
  readonly method: SensitivityStaticStructuralMethod;
  readonly domain: SensitivityDomain;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "cadSource",
  "baseValue",
  "step",
  "metrics",
  "method",
  "domain",
] as const;

const SELECTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const THREAD_ARTIFACT_URI = /^thread-artifact:\/\/[A-Za-z0-9_\-/]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parseSensitivityCadSourceUri(
  artifactUri: string,
): { readonly projectId: string; readonly artifactId: string } {
  if (!THREAD_ARTIFACT_URI.test(artifactUri)) {
    throw new TypeError(
      "$case.cadSource.artifactUri must be a thread-artifact:// URI.",
    );
  }
  const rest = artifactUri.slice("thread-artifact://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    throw new TypeError(
      "$case.cadSource.artifactUri must be thread-artifact://<project-id>/<artifact-id>.",
    );
  }
  return {
    projectId: rest.slice(0, slash),
    artifactId: rest.slice(slash + 1),
  };
}

/**
 * Parse and validate an untrusted value as a sensitivity-study-case/3.0 case.
 * Fail-closed: any unknown key, missing key, or invalid value throws.
 */
export function validateSensitivityStudyCaseV3(
  value: unknown,
): SensitivityStudyCaseV3 {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CASE_V3_SCHEMA,
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
  const cadSource = parseCadSource(root.cadSource);
  const baseValue = parseQuantity(root.baseValue, "$case.baseValue");
  const step = parseStep(root.step);

  const rawMetrics = nonEmptyArray(root.metrics, "$case.metrics");
  const metrics = rawMetrics.map((item, index) =>
    parseMetricDeclaration(item, `$case.metrics[${index}]`)
  );
  rejectDuplicates(metrics.map((m) => m.id), "$case.metrics ids");

  const method = parseMethod(root.method);
  const domain = parseDomain(root.domain);

  return deepFreeze({
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
    method,
    domain,
  });
}

// ---------------------------------------------------------------------------
// Internal parsers
// ---------------------------------------------------------------------------

function parseProject(value: unknown): SensitivityStudyCaseV3["project"] {
  const input = exactRecord(value, ["id", "subjectId"], "$case.project");
  return {
    id: safeId(input.id, "$case.project.id"),
    subjectId: safeId(input.subjectId, "$case.project.subjectId"),
  };
}

function parseTarget(value: unknown): SensitivityStudyCaseV3["target"] {
  const input = exactRecord(
    value,
    ["componentKey", "semanticKey"],
    "$case.target",
  );
  return {
    componentKey: safeId(input.componentKey, "$case.target.componentKey"),
    semanticKey: safeId(input.semanticKey, "$case.target.semanticKey"),
  };
}

function parseCadSource(value: unknown): SensitivityCadSource {
  const input = exactRecord(value, ["artifactUri", "sha256"], "$case.cadSource");
  const artifactUri = nonEmptyText(
    input.artifactUri,
    "$case.cadSource.artifactUri",
  );
  if (!THREAD_ARTIFACT_URI.test(artifactUri)) {
    throw new TypeError(
      `$case.cadSource.artifactUri must be a thread-artifact:// URI ` +
        `(letters, digits, hyphens, underscores, slashes after the scheme).`,
    );
  }
  const sha256 = nonEmptyText(input.sha256, "$case.cadSource.sha256");
  if (!SHA256_HEX.test(sha256)) {
    throw new TypeError(
      "$case.cadSource.sha256 must be a lowercase 64-character hex string.",
    );
  }
  return { artifactUri, sha256 };
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

function parseStep(value: unknown): SensitivityStudyCaseV3["step"] {
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

function parseMethod(value: unknown): SensitivityStaticStructuralMethod {
  const input = exactRecord(
    value,
    [
      "mesh",
      "material",
      "supports",
      "loads",
    ],
    "$case.method",
  );

  const mesh = parseMethodMesh(input.mesh);
  const material = parseMethodMaterial(input.material);

  const rawSupports = nonEmptyArray(input.supports, "$case.method.supports");
  const supports = rawSupports.map((item, i) =>
    parseMethodSupport(item, `$case.method.supports[${i}]`)
  );
  const rawLoads = nonEmptyArray(input.loads, "$case.method.loads");
  const loads = rawLoads.map((item, i) =>
    parseMethodLoad(item, `$case.method.loads[${i}]`)
  );

  rejectDuplicates(supports.map((s) => s.id), "$case.method.supports ids");
  rejectDuplicates(loads.map((l) => l.id), "$case.method.loads ids");
  rejectDuplicates(
    [
      ...supports.map((s) => s.selection.name),
      ...loads.map((l) => l.selection.name),
    ],
    "$case.method selection names",
  );

  return {
    mesh,
    material,
    supports,
    loads,
  };
}

function parseMethodMesh(
  value: unknown,
): SensitivityStaticStructuralMethod["mesh"] {
  const input = exactRecord(
    value,
    ["kind", "targetSizeMm"],
    "$case.method.mesh",
  );
  literalValue(input.kind, "tetrahedral-volume", "$case.method.mesh.kind");
  const size = finite(input.targetSizeMm, "$case.method.mesh.targetSizeMm");
  if (size <= 0) {
    throw new TypeError("$case.method.mesh.targetSizeMm must be positive.");
  }
  return { kind: "tetrahedral-volume", targetSizeMm: size };
}

function parseMethodMaterial(
  value: unknown,
): SensitivityStaticStructuralMethod["material"] {
  const input = exactRecord(
    value,
    ["model", "eMpa", "nu", "basis"],
    "$case.method.material",
  );
  literalValue(
    input.model,
    "isotropic-linear-elastic",
    "$case.method.material.model",
  );
  const eMpa = finite(input.eMpa, "$case.method.material.eMpa");
  if (eMpa <= 0) {
    throw new TypeError("$case.method.material.eMpa must be positive.");
  }
  const nu = finite(input.nu, "$case.method.material.nu");
  if (nu <= 0 || nu >= 0.5) {
    throw new TypeError(
      "$case.method.material.nu must be in the open interval (0, 0.5).",
    );
  }
  return {
    model: "isotropic-linear-elastic",
    eMpa,
    nu,
    basis: nonEmptyText(input.basis, "$case.method.material.basis"),
  };
}

function parseMethodSupport(value: unknown, path: string): SensitivitySupport {
  const input = exactRecord(value, ["id", "kind", "selection"], path);
  literalValue(input.kind, "fixed", `${path}.kind`);
  return {
    id: safeId(input.id, `${path}.id`),
    kind: "fixed",
    selection: parseSelection(input.selection, `${path}.selection`),
  };
}

function parseMethodLoad(value: unknown, path: string): SensitivityLoad {
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
    throw new TypeError(
      `${path}.value must have at least one non-zero component.`,
    );
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
    throw new TypeError(
      "$case.domain.remeshingVariationIncluded must be a boolean.",
    );
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

function vectorValues(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be an array of exactly three finite numbers.`);
  }
  return value.map((component, index) => finite(component, `${path}[${index}]`)) as [
    number,
    number,
    number,
  ];
}
