/**
 * Strict declaration of candidate inputs for a mechanical-analysis surface.
 * This schema is not an execution receipt: validation establishes only
 * declaration shape and internal consistency. It does not prove that SysON was
 * queried, a decision was approved, inputs reached CalculiX, or results exist.
 */

import {
  arrayOf,
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

export const MECHANICAL_PROOF_CASE_SCHEMA = "mechanical-proof-case/1.0" as const;

export interface MechanicalProofCase {
  readonly schemaVersion: typeof MECHANICAL_PROOF_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
    readonly baseThreadSnapshot: ExactThreadSnapshotBinding;
  };
  readonly target: {
    readonly id: string;
    /** Exact model element identity; labels are never used as a join. */
    readonly modelElementId: string;
  };
  readonly authorization: {
    /**
     * Declared cross-references for the proof-case seal MRTR only; this schema
     * does not resolve or approve them. A later CalculiX run has a distinct
     * MRTR in its resolved operation plan and cannot reuse this authority.
     */
    readonly workItemId: string;
    readonly decisionId: string;
  };
  readonly requirementsSource: {
    /** Declared source identity only; no SysON extraction occurs during validation. */
    readonly provider: "syson";
    readonly editingContextId: string;
    readonly elementId: string;
  };
  readonly solver: {
    /** Intended solver contract only; it is not evidence of a solver call. */
    readonly provider: "calculix";
    readonly tool: "calculix_solve_static";
    readonly resultSchemaVersion: "2.0";
  };
  /** Exact origin of the analyzed CAD, including its engineering limitations. */
  readonly cadSource: MechanicalCadSource;
  /** Declared expected CAD identity; validation does not prove solver consumption. */
  readonly expectedCadArtifact: MechanicalCadArtifactIdentity;
  readonly analysis: {
    readonly kind: "linear-static";
    readonly material: {
      readonly model: "isotropic-linear-elastic";
      readonly basis: string;
      readonly youngModulus: ScalarQuantity<"MPa">;
      readonly poissonRatio: ScalarQuantity<"1">;
    };
    readonly mesh: {
      readonly kind: "tetrahedral-volume";
      readonly targetSize: ScalarQuantity<"mm">;
    };
    readonly supports: readonly MechanicalFixedSupport[];
    readonly loads: readonly MechanicalForceLoad[];
  };
  readonly requirements: readonly MechanicalRequirement[];
}

export interface ExactThreadSnapshotBinding {
  readonly id: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface MechanicalCadArtifactIdentity {
  readonly format: "step";
  readonly sha256: string;
  readonly bytes: number;
}

export type MechanicalCadSource =
  | {
    readonly kind: "parametric";
    readonly generator: {
      readonly provider: string;
      readonly tool: string;
      /** Exact source definition supplied to the generator. */
      readonly definition: {
        readonly mediaType: string;
        readonly sha256: string;
        readonly bytes: number;
      };
    };
    readonly engineeringBoundary: CadEngineeringBoundary;
  }
  | {
    readonly kind: "imported-or-reconstructed";
    readonly method: "import" | "reverse-engineering";
    readonly sources: readonly ExternalCadSourceIdentity[];
    readonly license: {
      readonly identifier: string;
      readonly evidenceUri: string;
    };
    readonly conversion: {
      readonly tool: string;
      readonly revision: string;
      /** Explicitly known losses; an empty list is not accepted. */
      readonly losses: readonly string[];
    };
    readonly engineeringBoundary: CadEngineeringBoundary;
  };

export interface ExternalCadSourceIdentity {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly sourceUri: string;
}

export interface CadEngineeringBoundary {
  readonly designIntent: "preserved" | "partial" | "lost";
  readonly editableCad: "native" | "reconstructed" | "absent";
  /** FEA success never establishes manufacturing readiness in this schema. */
  readonly manufacturability: "not-established";
  readonly limitations: readonly string[];
}

export interface ScalarQuantity<Unit extends string> {
  readonly value: number;
  readonly unit: Unit;
}

export interface VectorQuantity<Unit extends string> {
  readonly value: readonly [number, number, number];
  readonly unit: Unit;
}

export interface MechanicalSelection {
  readonly name: string;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  };
}

export interface MechanicalFixedSupport {
  readonly id: string;
  readonly kind: "fixed";
  readonly selection: MechanicalSelection;
}

export interface MechanicalForceLoad {
  readonly id: string;
  readonly kind: "force";
  readonly selection: MechanicalSelection;
  readonly force: VectorQuantity<"N">;
}

export type MechanicalRequirement =
  | {
    readonly id: string;
    readonly name: string;
    readonly metric: "maximum-displacement";
    readonly feature: string;
    readonly operator: "<=";
    readonly limit: ScalarQuantity<"mm">;
  }
  | {
    readonly id: string;
    readonly name: string;
    readonly metric: "maximum-von-mises-stress";
    readonly feature: string;
    readonly operator: "<=";
    readonly limit: ScalarQuantity<"Pa">;
  };

/**
 * Limited identity context for a declaration. It deliberately omits material,
 * mesh, supports, loads, decision state, SysON extraction and solver results;
 * matching it therefore cannot attest a complete or fail-closed execution.
 */
export interface MechanicalDeclarationIdentityBinding {
  readonly projectId: string;
  readonly subjectId: string;
  readonly baseThreadSnapshot: ExactThreadSnapshotBinding;
  readonly targetId: string;
  readonly targetModelElementId: string;
  readonly cadSource: MechanicalCadSource;
  readonly cadArtifact: MechanicalCadArtifactIdentity;
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "authorization",
  "requirementsSource",
  "solver",
  "cadSource",
  "expectedCadArtifact",
  "analysis",
  "requirements",
] as const;
const SELECTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIREMENT_ORDER = new Map<MechanicalRequirement["metric"], number>([
  ["maximum-displacement", 0],
  ["maximum-von-mises-stress", 1],
]);

/** Validate untrusted JSON and return an immutable canonical declaration. */
export function validateMechanicalProofCase(value: unknown): MechanicalProofCase {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(root.schemaVersion, MECHANICAL_PROOF_CASE_SCHEMA, "$case.schemaVersion");

  const projectInput = exactRecord(
    root.project,
    ["id", "subjectId", "baseThreadSnapshot"],
    "$case.project",
  );
  const projectId = safeId(projectInput.id, "$case.project.id");
  const subjectId = safeId(projectInput.subjectId, "$case.project.subjectId");
  const baseThreadSnapshot = threadSnapshotBinding(
    projectInput.baseThreadSnapshot,
    "$case.project.baseThreadSnapshot",
  );
  if (baseThreadSnapshot.subjectId !== subjectId) {
    throw new Error(
      "$case.project.baseThreadSnapshot.subjectId must equal $case.project.subjectId.",
    );
  }

  const targetInput = exactRecord(
    root.target,
    ["id", "modelElementId"],
    "$case.target",
  );
  const authorizationInput = exactRecord(
    root.authorization,
    ["workItemId", "decisionId"],
    "$case.authorization",
  );
  const sourceInput = exactRecord(
    root.requirementsSource,
    ["provider", "editingContextId", "elementId"],
    "$case.requirementsSource",
  );
  literalValue(sourceInput.provider, "syson", "$case.requirementsSource.provider");
  const solverInput = exactRecord(
    root.solver,
    ["provider", "tool", "resultSchemaVersion"],
    "$case.solver",
  );
  literalValue(solverInput.provider, "calculix", "$case.solver.provider");
  literalValue(solverInput.tool, "calculix_solve_static", "$case.solver.tool");
  literalValue(
    solverInput.resultSchemaVersion,
    "2.0",
    "$case.solver.resultSchemaVersion",
  );

  const analysis = parseMechanicalProofAnalysis(root.analysis, "$case.analysis");
  const orderedRequirements = parseMechanicalProofRequirements(
    root.requirements,
    "$case.requirements",
  );

  return deepFreeze({
    schemaVersion: MECHANICAL_PROOF_CASE_SCHEMA,
    id: safeId(root.id, "$case.id"),
    revision: positiveInteger(root.revision, "$case.revision"),
    scope: nonEmptyText(root.scope, "$case.scope"),
    evidenceBoundary: nonEmptyText(root.evidenceBoundary, "$case.evidenceBoundary"),
    project: { id: projectId, subjectId, baseThreadSnapshot },
    target: {
      id: safeId(targetInput.id, "$case.target.id"),
      modelElementId: safeId(
        targetInput.modelElementId,
        "$case.target.modelElementId",
      ),
    },
    authorization: {
      workItemId: safeId(
        authorizationInput.workItemId,
        "$case.authorization.workItemId",
      ),
      decisionId: safeId(
        authorizationInput.decisionId,
        "$case.authorization.decisionId",
      ),
    },
    requirementsSource: {
      provider: "syson",
      editingContextId: safeId(
        sourceInput.editingContextId,
        "$case.requirementsSource.editingContextId",
      ),
      elementId: safeId(
        sourceInput.elementId,
        "$case.requirementsSource.elementId",
      ),
    },
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
    },
    cadSource: cadSource(root.cadSource, "$case.cadSource"),
    expectedCadArtifact: cadArtifact(
      root.expectedCadArtifact,
      "$case.expectedCadArtifact",
    ),
    analysis,
    requirements: orderedRequirements,
  });
}

/** Closed linear-static analysis vocabulary shared with the agent source document. */
export function parseMechanicalProofAnalysis(
  value: unknown,
  path = "$case.analysis",
): MechanicalProofCase["analysis"] {
  const analysisInput = exactRecord(
    value,
    ["kind", "material", "mesh", "supports", "loads"],
    path,
  );
  literalValue(analysisInput.kind, "linear-static", `${path}.kind`);
  const material = mechanicalMaterial(
    analysisInput.material,
    `${path}.material`,
  );
  const mesh = mechanicalMesh(analysisInput.mesh, `${path}.mesh`);
  const supports = nonEmptyArray(
    analysisInput.supports,
    `${path}.supports`,
  ).map((item, index) => fixedSupport(item, `${path}.supports[${index}]`));
  const loads = nonEmptyArray(analysisInput.loads, `${path}.loads`).map(
    (item, index) => forceLoad(item, `${path}.loads[${index}]`),
  );
  rejectDuplicates(supports.map((item) => item.id), `${path}.supports ids`);
  rejectDuplicates(loads.map((item) => item.id), `${path}.loads ids`);
  const selections = [...supports, ...loads].map((item) => item.selection.name);
  rejectDuplicates(selections, `${path} selection names`);
  rejectSupportLoadSelectionOverlap(supports, loads, path);
  return {
    kind: "linear-static",
    material,
    mesh,
    supports,
    loads,
  };
}

/**
 * One captured scalar as the mechanical proof can observe it. Capture rows
 * have no proof-case metric kind; `metric` is the arbitrary SysON feature
 * name (`MechanicalRequirement.feature`), not `maximum-displacement`.
 */
export interface MechanicalProofCaptureCriterion {
  readonly metric: string;
  readonly operator: string;
  readonly limit: { readonly value: number; readonly unit: string };
}

/**
 * V1 capture/proof join units for the closed linear-static metrics.
 * Feature names are arbitrary. Distinct from solver-native MPa in
 * STATIC_PROOF_METRIC_UNITS.
 */
export function isMechanicalProofLimitUnit(unit: string): boolean {
  return unit === "mm" || unit === "Pa";
}

/**
 * Admit a requirements capture against declared mechanical proof criteria.
 *
 * Every declared criterion must match capture exactly on feature, operator,
 * value and unit. Capture rows whose unit is not a mechanical proof unit may
 * coexist. Capture rows whose unit is mm or Pa are treated as mechanical
 * obligations, including when their SysON feature name is arbitrary.
 *
 * Limitation: V1 `requirements-capture` has no semantic kind. A non-FEA
 * criterion that happens to use mm or Pa is therefore refused if omitted
 * from the proof. Do not invent a metric-name catalog or a temperature
 * exception to paper over that missing kind.
 */
export function mechanicalProofRequirementsMatchCapture(
  captured: readonly MechanicalProofCaptureCriterion[],
  declared: readonly Pick<
    MechanicalRequirement,
    "feature" | "operator" | "limit"
  >[],
): boolean {
  if (
    !declared.every((requirement) =>
      captured.some((candidate) => sameCaptureCriterion(candidate, requirement))
    )
  ) {
    return false;
  }
  return captured
    .filter((candidate) => isMechanicalProofLimitUnit(candidate.limit.unit))
    .every((candidate) =>
      declared.some((requirement) => sameCaptureCriterion(candidate, requirement))
    );
}

function sameCaptureCriterion(
  captured: MechanicalProofCaptureCriterion,
  declared: Pick<MechanicalRequirement, "feature" | "operator" | "limit">,
): boolean {
  return captured.metric === declared.feature &&
    captured.operator === declared.operator &&
    captured.limit.value === declared.limit.value &&
    captured.limit.unit === declared.limit.unit;
}

/** Closed requirement vocabulary shared with the agent source document. */
export function parseMechanicalProofRequirements(
  value: unknown,
  path = "$case.requirements",
): readonly MechanicalRequirement[] {
  const requirements = arrayOf(value, path).map(
    (item, index) => requirement(item, `${path}[${index}]`),
  );
  if (requirements.length === 0) {
    throw new Error(`${path} must not be empty.`);
  }
  if (requirements.length > REQUIREMENT_ORDER.size) {
    throw new Error(
      `${path} may only declare maximum-displacement and/or maximum-von-mises-stress.`,
    );
  }
  rejectDuplicates(requirements.map((item) => item.id), `${path} ids`);
  rejectDuplicates(requirements.map((item) => item.name), `${path} names`);
  rejectDuplicates(
    requirements.map((item) => item.feature),
    `${path} features`,
  );
  rejectDuplicates(requirements.map((item) => item.metric), `${path} metrics`);
  if (requirements.some((item) => !REQUIREMENT_ORDER.has(item.metric))) {
    throw new Error(`${path} contains an unsupported metric.`);
  }
  return [...requirements].sort(
    (left, right) =>
      REQUIREMENT_ORDER.get(left.metric)! - REQUIREMENT_ORDER.get(right.metric)!,
  );
}

/**
 * Match only the project, subject, target, base snapshot and CAD identities
 * carried by this declaration. This is not an execution validator and makes no
 * claim about reviewed analysis inputs, provider calls, outputs or evidence.
 */
export function validateMechanicalDeclarationIdentityBinding(
  caseValue: unknown,
  bindingValue: unknown,
): MechanicalProofCase {
  const proofCase = validateMechanicalProofCase(caseValue);
  const binding = declarationIdentityBinding(bindingValue);
  same(binding.projectId, proofCase.project.id, "$binding.projectId");
  same(binding.subjectId, proofCase.project.subjectId, "$binding.subjectId");
  same(
    binding.baseThreadSnapshot.id,
    proofCase.project.baseThreadSnapshot.id,
    "$binding.baseThreadSnapshot.id",
  );
  same(
    binding.baseThreadSnapshot.revision,
    proofCase.project.baseThreadSnapshot.revision,
    "$binding.baseThreadSnapshot.revision",
  );
  same(
    binding.baseThreadSnapshot.subjectId,
    proofCase.project.baseThreadSnapshot.subjectId,
    "$binding.baseThreadSnapshot.subjectId",
  );
  same(binding.targetId, proofCase.target.id, "$binding.targetId");
  same(
    binding.targetModelElementId,
    proofCase.target.modelElementId,
    "$binding.targetModelElementId",
  );
  sameJson(binding.cadSource, proofCase.cadSource, "$binding.cadSource");
  same(
    binding.cadArtifact.format,
    proofCase.expectedCadArtifact.format,
    "$binding.cadArtifact.format",
  );
  same(
    binding.cadArtifact.sha256,
    proofCase.expectedCadArtifact.sha256,
    "$binding.cadArtifact.sha256",
  );
  same(
    binding.cadArtifact.bytes,
    proofCase.expectedCadArtifact.bytes,
    "$binding.cadArtifact.bytes",
  );
  return proofCase;
}

function declarationIdentityBinding(
  value: unknown,
): MechanicalDeclarationIdentityBinding {
  const input = exactRecord(
    value,
    [
      "projectId",
      "subjectId",
      "baseThreadSnapshot",
      "targetId",
      "targetModelElementId",
      "cadSource",
      "cadArtifact",
    ],
    "$binding",
  );
  return {
    projectId: safeId(input.projectId, "$binding.projectId"),
    subjectId: safeId(input.subjectId, "$binding.subjectId"),
    baseThreadSnapshot: threadSnapshotBinding(
      input.baseThreadSnapshot,
      "$binding.baseThreadSnapshot",
    ),
    targetId: safeId(input.targetId, "$binding.targetId"),
    targetModelElementId: safeId(
      input.targetModelElementId,
      "$binding.targetModelElementId",
    ),
    cadSource: cadSource(input.cadSource, "$binding.cadSource"),
    cadArtifact: cadArtifact(input.cadArtifact, "$binding.cadArtifact"),
  };
}

function mechanicalMaterial(
  value: unknown,
  path: string,
): MechanicalProofCase["analysis"]["material"] {
  const input = exactRecord(
    value,
    ["model", "basis", "youngModulus", "poissonRatio"],
    path,
  );
  literalValue(input.model, "isotropic-linear-elastic", `${path}.model`);
  const youngModulus = scalar(input.youngModulus, "MPa", `${path}.youngModulus`);
  if (youngModulus.value <= 0) {
    throw new Error(`${path}.youngModulus.value must be greater than zero.`);
  }
  const poissonRatio = scalar(input.poissonRatio, "1", `${path}.poissonRatio`);
  if (poissonRatio.value <= 0 || poissonRatio.value >= 0.5) {
    throw new Error(
      `${path}.poissonRatio.value must be greater than zero and below 0.5.`,
    );
  }
  return {
    model: "isotropic-linear-elastic",
    basis: nonEmptyText(input.basis, `${path}.basis`),
    youngModulus,
    poissonRatio,
  };
}

function mechanicalMesh(
  value: unknown,
  path: string,
): MechanicalProofCase["analysis"]["mesh"] {
  const input = exactRecord(value, ["kind", "targetSize"], path);
  literalValue(input.kind, "tetrahedral-volume", `${path}.kind`);
  const targetSize = scalar(input.targetSize, "mm", `${path}.targetSize`);
  if (targetSize.value <= 0) {
    throw new Error(`${path}.targetSize.value must be greater than zero.`);
  }
  return {
    kind: "tetrahedral-volume",
    targetSize,
  };
}

function fixedSupport(value: unknown, path: string): MechanicalFixedSupport {
  const input = exactRecord(value, ["id", "kind", "selection"], path);
  literalValue(input.kind, "fixed", `${path}.kind`);
  return {
    id: safeId(input.id, `${path}.id`),
    kind: "fixed",
    selection: selection(input.selection, `${path}.selection`),
  };
}

function forceLoad(value: unknown, path: string): MechanicalForceLoad {
  const input = exactRecord(value, ["id", "kind", "selection", "force"], path);
  literalValue(input.kind, "force", `${path}.kind`);
  const force = vector(input.force, "N", `${path}.force`);
  if (force.value.every((component) => component === 0)) {
    throw new Error(`${path}.force.value must contain a non-zero component.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    kind: "force",
    selection: selection(input.selection, `${path}.selection`),
    force,
  };
}

function selection(value: unknown, path: string): MechanicalSelection {
  const input = exactRecord(value, ["name", "box"], path);
  const name = nonEmptyText(input.name, `${path}.name`);
  if (!SELECTION_NAME.test(name)) {
    throw new Error(
      `${path}.name must start with a letter and contain only letters, digits or underscores.`,
    );
  }
  const boxInput = exactRecord(input.box, ["min", "max", "unit"], `${path}.box`);
  literalValue(boxInput.unit, "mm", `${path}.box.unit`);
  const min = vectorValues(boxInput.min, `${path}.box.min`);
  const max = vectorValues(boxInput.max, `${path}.box.max`);
  min.forEach((component, axis) => {
    if (component >= max[axis]) {
      throw new Error(`${path}.box.min[${axis}] must be below max[${axis}].`);
    }
  });
  return { name, box: { min, max, unit: "mm" } };
}

function rejectSupportLoadSelectionOverlap(
  supports: readonly MechanicalFixedSupport[],
  loads: readonly MechanicalForceLoad[],
  path: string,
): void {
  for (const support of supports) {
    for (const load of loads) {
      if (!selectionBoxesOverlap(support.selection, load.selection)) continue;
      throw new Error(
        `${path} support ${support.id} and load ${load.id} selection boxes must not overlap.`,
      );
    }
  }
}

/** Selection boxes are closed: touching faces or edges can select shared entities. */
function selectionBoxesOverlap(
  left: MechanicalSelection,
  right: MechanicalSelection,
): boolean {
  return left.box.min.every((leftMin, axis) =>
    leftMin <= right.box.max[axis] && right.box.min[axis] <= left.box.max[axis]
  );
}

function requirement(value: unknown, path: string): MechanicalRequirement {
  const input = exactRecord(
    value,
    ["id", "name", "metric", "feature", "operator", "limit"],
    path,
  );
  literalValue(input.operator, "<=", `${path}.operator`);
  const common = {
    id: safeId(input.id, `${path}.id`),
    name: safeId(input.name, `${path}.name`),
    feature: safeId(input.feature, `${path}.feature`),
    operator: "<=" as const,
  };
  if (input.metric === "maximum-displacement") {
    const limit = scalar(input.limit, "mm", `${path}.limit`);
    if (limit.value <= 0) {
      throw new Error(`${path}.limit.value must be greater than zero.`);
    }
    return { ...common, metric: "maximum-displacement", limit };
  }
  if (input.metric === "maximum-von-mises-stress") {
    const limit = scalar(input.limit, "Pa", `${path}.limit`);
    if (limit.value <= 0) {
      throw new Error(`${path}.limit.value must be greater than zero.`);
    }
    return { ...common, metric: "maximum-von-mises-stress", limit };
  }
  throw new Error(`${path}.metric is unsupported by mechanical-proof-case/1.0.`);
}

function threadSnapshotBinding(
  value: unknown,
  path: string,
): ExactThreadSnapshotBinding {
  const input = exactRecord(value, ["id", "revision", "subjectId"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
  };
}

function cadSource(value: unknown, path: string): MechanicalCadSource {
  // Basic object check before reading .kind to select the right exact key set.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const input = value as Record<string, unknown>;
  if (input.kind === "parametric") {
    exactRecord(input, ["kind", "generator", "engineeringBoundary"], path);
    const generator = exactRecord(
      input.generator,
      ["provider", "tool", "definition"],
      `${path}.generator`,
    );
    const definition = exactRecord(
      generator.definition,
      ["mediaType", "sha256", "bytes"],
      `${path}.generator.definition`,
    );
    return {
      kind: "parametric",
      generator: {
        provider: safeId(generator.provider, `${path}.generator.provider`),
        tool: safeId(generator.tool, `${path}.generator.tool`),
        definition: {
          mediaType: nonEmptyText(
            definition.mediaType,
            `${path}.generator.definition.mediaType`,
          ),
          sha256: sha256(
            definition.sha256,
            `${path}.generator.definition.sha256`,
          ),
          bytes: positiveInteger(
            definition.bytes,
            `${path}.generator.definition.bytes`,
          ),
        },
      },
      engineeringBoundary: cadEngineeringBoundary(
        input.engineeringBoundary,
        `${path}.engineeringBoundary`,
      ),
    };
  }
  if (input.kind === "imported-or-reconstructed") {
    exactRecord(
      input,
      [
        "kind",
        "method",
        "sources",
        "license",
        "conversion",
        "engineeringBoundary",
      ],
      path,
    );
    if (input.method !== "import" && input.method !== "reverse-engineering") {
      throw new Error(`${path}.method must equal "import" or "reverse-engineering".`);
    }
    const sources = nonEmptyArray(input.sources, `${path}.sources`).map(
      (source, index) => externalCadSource(source, `${path}.sources[${index}]`),
    );
    rejectDuplicates(sources.map((source) => source.id), `${path}.sources ids`);
    rejectDuplicates(
      sources.map((source) => source.sha256),
      `${path}.sources SHA-256 digests`,
    );
    const license = exactRecord(
      input.license,
      ["identifier", "evidenceUri"],
      `${path}.license`,
    );
    const conversion = exactRecord(
      input.conversion,
      ["tool", "revision", "losses"],
      `${path}.conversion`,
    );
    const losses = nonEmptyArray(
      conversion.losses,
      `${path}.conversion.losses`,
    ).map((loss, index) => nonEmptyText(loss, `${path}.conversion.losses[${index}]`));
    rejectDuplicates(losses, `${path}.conversion.losses`);
    const engineeringBoundary = cadEngineeringBoundary(
      input.engineeringBoundary,
      `${path}.engineeringBoundary`,
    );
    if (
      input.method === "reverse-engineering" &&
      engineeringBoundary.designIntent === "preserved"
    ) {
      throw new Error(
        `${path}.engineeringBoundary.designIntent cannot be preserved for reverse-engineering.`,
      );
    }
    return {
      kind: "imported-or-reconstructed",
      method: input.method,
      sources,
      license: {
        identifier: nonEmptyText(license.identifier, `${path}.license.identifier`),
        evidenceUri: nonEmptyText(license.evidenceUri, `${path}.license.evidenceUri`),
      },
      conversion: {
        tool: nonEmptyText(conversion.tool, `${path}.conversion.tool`),
        revision: nonEmptyText(conversion.revision, `${path}.conversion.revision`),
        losses,
      },
      engineeringBoundary,
    };
  }
  throw new Error(
    `${path}.kind must equal "parametric" or "imported-or-reconstructed".`,
  );
}

function externalCadSource(
  value: unknown,
  path: string,
): ExternalCadSourceIdentity {
  const input = exactRecord(
    value,
    ["id", "name", "format", "sha256", "bytes", "sourceUri"],
    path,
  );
  return {
    id: safeId(input.id, `${path}.id`),
    name: nonEmptyText(input.name, `${path}.name`),
    format: nonEmptyText(input.format, `${path}.format`),
    sha256: sha256(input.sha256, `${path}.sha256`),
    bytes: positiveInteger(input.bytes, `${path}.bytes`),
    sourceUri: nonEmptyText(input.sourceUri, `${path}.sourceUri`),
  };
}

function cadEngineeringBoundary(
  value: unknown,
  path: string,
): CadEngineeringBoundary {
  const input = exactRecord(
    value,
    ["designIntent", "editableCad", "manufacturability", "limitations"],
    path,
  );
  if (
    input.designIntent !== "preserved" && input.designIntent !== "partial" &&
    input.designIntent !== "lost"
  ) {
    throw new Error(`${path}.designIntent is unsupported.`);
  }
  if (
    input.editableCad !== "native" && input.editableCad !== "reconstructed" &&
    input.editableCad !== "absent"
  ) {
    throw new Error(`${path}.editableCad is unsupported.`);
  }
  literalValue(
    input.manufacturability,
    "not-established",
    `${path}.manufacturability`,
  );
  const limitations = nonEmptyArray(input.limitations, `${path}.limitations`).map(
    (limitation, index) => nonEmptyText(limitation, `${path}.limitations[${index}]`),
  );
  rejectDuplicates(limitations, `${path}.limitations`);
  if (input.designIntent === "preserved" && input.editableCad !== "native") {
    throw new Error(
      `${path}.editableCad must be native when designIntent is preserved.`,
    );
  }
  return {
    designIntent: input.designIntent,
    editableCad: input.editableCad,
    manufacturability: "not-established",
    limitations,
  };
}

function cadArtifact(value: unknown, path: string): MechanicalCadArtifactIdentity {
  const input = exactRecord(value, ["format", "sha256", "bytes"], path);
  literalValue(input.format, "step", `${path}.format`);
  return {
    format: "step",
    sha256: sha256(input.sha256, `${path}.sha256`),
    bytes: positiveInteger(input.bytes, `${path}.bytes`),
  };
}

function sha256(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256.test(digest)) {
    throw new Error(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function scalar<Unit extends string>(
  value: unknown,
  unit: Unit,
  path: string,
): ScalarQuantity<Unit> {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, unit, `${path}.unit`);
  return { value: finite(input.value, `${path}.value`), unit };
}

function vector<Unit extends string>(
  value: unknown,
  unit: Unit,
  path: string,
): VectorQuantity<Unit> {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, unit, `${path}.unit`);
  return { value: vectorValues(input.value, `${path}.value`), unit };
}

function vectorValues(
  value: unknown,
  path: string,
): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${path} must contain exactly three finite numbers.`);
  }
  return value.map((component, index) => finite(component, `${path}[${index}]`)) as [
    number,
    number,
    number,
  ];
}

function same(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) {
    throw new Error(`${path} does not match the mechanical proof declaration.`);
  }
}

function sameJson(actual: unknown, expected: unknown, path: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} does not match the mechanical proof declaration.`);
  }
}
