/**
 * MRTR grammar and fail-closed parsers for the `verify.seal-proof-case@1` decision.
 *
 * WHY THIS MODULE EXISTS — the decision MRTR that gates `verify.seal-proof-case@1`
 * carries a flat parameter list that the executor must parse back into a typed
 * representation for field-by-field cross-checking against the signed
 * MechanicalProofCase. This module is the only authority allowed to encode and decode
 * those parameters; the executor must not attempt a second interpretation of the raw
 * parameter strings.
 *
 * Requirements sort: validateMechanicalProofCase sorts requirements by metric using
 * REQUIREMENT_ORDER before returning — maximum-displacement always first,
 * maximum-von-mises-stress always second. The canonical proof text therefore carries a
 * deterministic requirement order regardless of the order in the source JSON, making
 * it safe to SHA-256-hash as a content address.
 *
 * The `geometryArtifact` and `requirementsArtifact` fields carried in the parameters
 * are Thread artifact identities, not proof-case fields. They are bound by the
 * executor at proposal time from the Thread state and are NOT cross-checked by
 * verifyFeaProofParametersMatchCase — only proof-case fields are verified there.
 */

import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { EngineeringOperationRef } from "../../project/engineering-project.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import {
  MECHANICAL_PROOF_CASE_SCHEMA,
  type MechanicalCadSource,
  type MechanicalProofCase,
} from "./mechanical-proof-case.ts";
import { SENSITIVITY_CATALOG_OFFER_SCHEMA } from "../../sensitivity/study/sensitivity-catalog-from-proof.ts";

// ── Operation identity ───────────────────────────────────────────────────────

/**
 * Historical MCP FEA identity. Not registered and cannot be queued. Kept so
 * `unknown_operation` tests and Thread-write kind guards stay exact.
 */
export const VERIFY_RUN_FEA_STATIC_PROOF_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "1",
} as const;

export const VERIFY_SEAL_PROOF_CASE_OPERATION = {
  id: "verify.seal-proof-case",
  version: "1",
} as const;

/** Work-item operation for `project_change_append`. Numbers stay in the MRTR. */
export function sealProofCaseWorkItemOperation(): EngineeringOperationRef {
  return {
    id: VERIFY_SEAL_PROOF_CASE_OPERATION.id,
    version: VERIFY_SEAL_PROOF_CASE_OPERATION.version,
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
}

// ── Error contract ────────────────────────────────────────────────────────────

/**
 * Typed error codes for the FEA proof proposal grammar.
 *
 * WHY TYPED CODES — the executor and tests parse these codes, not the message prose.
 * Keeping the vocabulary exhaustive here prevents silent fallback to generic errors in
 * recovery paths.
 */
export type FeaProofProposalErrorCode =
  | "missing_parameter"
  | "unexpected_parameter"
  | "duplicate_parameter"
  | "invalid_schema"
  | "invalid_format"
  | "invalid_fingerprint"
  | "parameter_mismatch";

export class FeaProofProposalError extends Error {
  constructor(
    readonly code: FeaProofProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeaProofProposalError";
  }
}

// ── Parsed parameter shape ────────────────────────────────────────────────────

/** Flat box coordinates decoded from individual parameter keys. */
export interface FeaProofBoxParams {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface FeaProofSupportParams {
  readonly id: string;
  readonly selection: string;
  readonly box: FeaProofBoxParams;
}

export interface FeaProofLoadParams {
  readonly id: string;
  readonly selection: string;
  readonly box: FeaProofBoxParams;
  readonly forceN: readonly [number, number, number];
}

export interface FeaProofRequirementParams {
  readonly id: string;
  readonly name: string;
  readonly metric: "maximum-displacement" | "maximum-von-mises-stress";
  readonly feature: string;
  readonly operator: "<=";
  readonly limitValue: number;
  readonly limitUnit: "mm" | "Pa";
}

/**
 * Fully-typed result returned by parseFeaProofDecisionParameters.
 *
 * Fields derived from the proof case (schemaVersion…cadSource) and Thread artifact
 * identities (geometryArtifact, requirementsArtifact) are separated so that
 * verifyFeaProofParametersMatchCase can focus on proof-case fields only.
 */
export interface FeaProofDecisionParameters {
  readonly proofDigest: string;
  /** Exact captured agent source fingerprint. Not the compiled proof digest. */
  readonly sourceFingerprint: string;
  readonly schemaVersion: typeof MECHANICAL_PROOF_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly reviewBasis: {
    readonly snapshotId: string;
    readonly revision: number;
  };
  readonly target: {
    readonly id: string;
    readonly modelElementId: string;
  };
  /** Thread artifact identity bound at proposal time from the active basis. */
  readonly geometryArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  /** Thread artifact identity bound at proposal time from the active requirements tip. */
  readonly requirementsArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly requirementsSource: {
    readonly editingContextId: string;
    readonly elementId: string;
  };
  readonly step: {
    readonly digest: string;
    readonly bytes: number;
  };
  readonly material: {
    readonly youngModulusMpa: number;
    readonly poissonRatio: number;
    readonly basis: string;
  };
  readonly mesh: {
    readonly targetSizeMm: number;
  };
  readonly cadSource: MechanicalCadSource;
  readonly supports: readonly FeaProofSupportParams[];
  readonly loads: readonly FeaProofLoadParams[];
  readonly requirements: readonly FeaProofRequirementParams[];
  readonly sensitivityCatalog?: {
    readonly schemaVersion: typeof SENSITIVITY_CATALOG_OFFER_SCHEMA;
    readonly digest: string;
    readonly admissionArtifact: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
  };
}

// ── Canonical proof text ──────────────────────────────────────────────────────

/**
 * Canonical JSON serialisation of an already-validated MechanicalProofCase.
 *
 * The text is the exact byte sequence used to derive proofDigest. It MUST be
 * produced from a proof case returned by validateMechanicalProofCase — never from
 * raw JSON — because that function sorts requirements by metric before returning.
 * Hashing unsorted JSON would produce a different digest and break the CAS address.
 */
export function canonicalProofText(proofCase: MechanicalProofCase): string {
  return deterministicJson(proofCase);
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Convert a validated MechanicalProofCase and its associated Thread artifact
 * identities into the flat parameter list carried by an EngineeringDecisionProposal.
 *
 * The caller supplies:
 *   proofDigest          — sha256(canonicalProofText(proofCase))
 *   proofCase            — result of validateMechanicalProofCase (immutable, sorted)
 *   geometryArtifact     — active cad-model Thread artifact from the basis
 *   requirementsArtifact — active requirements Thread artifact from the tip algorithm
 */
export function encodeFeaProofDecisionParameters(
  proofDigest: string,
  proofCase: MechanicalProofCase,
  geometryArtifact: { readonly id: string; readonly fingerprint: ContentFingerprint },
  requirementsArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  },
  sourceFingerprint: string,
  sensitivityCatalog?: FeaProofDecisionParameters["sensitivityCatalog"],
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  assertFingerprint(proofDigest, "proofDigest");
  assertFingerprint(sourceFingerprint, "sourceFingerprint");
  assertFingerprint(
    geometryArtifact.fingerprint.digest,
    "geometryArtifact.fingerprint",
  );
  assertFingerprint(
    requirementsArtifact.fingerprint.digest,
    "requirementsArtifact.fingerprint",
  );

  const result: Array<
    { key: string; label: string; value: string | number | boolean }
  > = [];
  const p = (key: string, label: string, value: string | number | boolean) =>
    result.push({ key, label, value });

  p("fea.proof.digest", "Proof SHA-256 digest", proofDigest);
  p(
    "fea.proof.source.fingerprint",
    "Proof source capture SHA-256",
    sourceFingerprint,
  );
  p("fea.proof.schemaVersion", "Proof schema version", proofCase.schemaVersion);
  p("fea.proof.id", "Proof case ID", proofCase.id);
  p("fea.proof.revision", "Proof revision", proofCase.revision);
  p("fea.proof.scope", "Proof scope", proofCase.scope);
  p("fea.proof.evidenceBoundary", "Evidence boundary", proofCase.evidenceBoundary);
  p(
    "fea.proof.reviewBasis.snapshotId",
    "Base thread snapshot ID",
    proofCase.project.baseThreadSnapshot.id,
  );
  p(
    "fea.proof.reviewBasis.revision",
    "Base thread snapshot revision",
    proofCase.project.baseThreadSnapshot.revision,
  );
  p("fea.proof.target.id", "Target ID", proofCase.target.id);
  p(
    "fea.proof.target.modelElementId",
    "Target SysON element ID",
    proofCase.target.modelElementId,
  );
  p("fea.proof.geometryArtifact.id", "Geometry artifact ID", geometryArtifact.id);
  p(
    "fea.proof.geometryArtifact.fingerprint",
    "Geometry artifact SHA-256",
    geometryArtifact.fingerprint.digest,
  );
  p(
    "fea.proof.requirementsArtifact.id",
    "Requirements artifact ID",
    requirementsArtifact.id,
  );
  p(
    "fea.proof.requirementsArtifact.fingerprint",
    "Requirements artifact SHA-256",
    requirementsArtifact.fingerprint.digest,
  );
  p(
    "fea.proof.requirementsSource.editingContextId",
    "SysON editing context ID",
    proofCase.requirementsSource.editingContextId,
  );
  p(
    "fea.proof.requirementsSource.elementId",
    "SysON requirements element ID",
    proofCase.requirementsSource.elementId,
  );
  p(
    "fea.proof.step.digest",
    "Expected STEP SHA-256",
    proofCase.expectedCadArtifact.sha256,
  );
  p(
    "fea.proof.step.bytes",
    "Expected STEP bytes",
    proofCase.expectedCadArtifact.bytes,
  );
  p(
    "fea.proof.material.youngModulusMpa",
    "Young modulus (MPa)",
    proofCase.analysis.material.youngModulus.value,
  );
  p(
    "fea.proof.material.poissonRatio",
    "Poisson ratio",
    proofCase.analysis.material.poissonRatio.value,
  );
  p("fea.proof.material.basis", "Material basis", proofCase.analysis.material.basis);
  p(
    "fea.proof.mesh.targetSizeMm",
    "Mesh target size (mm)",
    proofCase.analysis.mesh.targetSize.value,
  );

  p(
    "fea.proof.supports.count",
    "Fixed support count",
    proofCase.analysis.supports.length,
  );
  for (const [i, support] of proofCase.analysis.supports.entries()) {
    p(`fea.proof.supports.${i}.id`, `Support ${i} ID`, support.id);
    p(
      `fea.proof.supports.${i}.selection`,
      `Support ${i} selection name`,
      support.selection.name,
    );
    encodeBox(p, `fea.proof.supports.${i}`, support.selection.box);
  }

  p("fea.proof.loads.count", "Force load count", proofCase.analysis.loads.length);
  for (const [i, load] of proofCase.analysis.loads.entries()) {
    p(`fea.proof.loads.${i}.id`, `Load ${i} ID`, load.id);
    p(
      `fea.proof.loads.${i}.selection`,
      `Load ${i} selection name`,
      load.selection.name,
    );
    encodeBox(p, `fea.proof.loads.${i}`, load.selection.box);
    p(`fea.proof.loads.${i}.forceN.0`, `Load ${i} force X (N)`, load.force.value[0]);
    p(`fea.proof.loads.${i}.forceN.1`, `Load ${i} force Y (N)`, load.force.value[1]);
    p(`fea.proof.loads.${i}.forceN.2`, `Load ${i} force Z (N)`, load.force.value[2]);
  }

  p(
    "fea.proof.requirements.count",
    "Requirement count",
    proofCase.requirements.length,
  );
  for (const [i, req] of proofCase.requirements.entries()) {
    p(`fea.proof.requirements.${i}.id`, `Requirement ${i} ID`, req.id);
    p(`fea.proof.requirements.${i}.name`, `Requirement ${i} name`, req.name);
    p(`fea.proof.requirements.${i}.metric`, `Requirement ${i} metric`, req.metric);
    p(
      `fea.proof.requirements.${i}.feature`,
      `Requirement ${i} feature path`,
      req.feature,
    );
    p(
      `fea.proof.requirements.${i}.operator`,
      `Requirement ${i} operator`,
      req.operator,
    );
    p(
      `fea.proof.requirements.${i}.limit.value`,
      `Requirement ${i} limit value`,
      req.limit.value,
    );
    p(
      `fea.proof.requirements.${i}.limit.unit`,
      `Requirement ${i} limit unit`,
      req.limit.unit,
    );
  }

  encodeCadSource(p, proofCase.cadSource);
  if (sensitivityCatalog !== undefined) {
    assertFingerprint(sensitivityCatalog.digest, "sensitivityCatalog.digest");
    assertFingerprint(
      sensitivityCatalog.admissionArtifact.fingerprint.digest,
      "sensitivityCatalog.admissionArtifact.fingerprint",
    );
    p(
      "sensitivity.catalog.schemaVersion",
      "Sensitivity catalog schema version",
      SENSITIVITY_CATALOG_OFFER_SCHEMA,
    );
    p(
      "sensitivity.catalog.digest",
      "Sensitivity catalog SHA-256",
      sensitivityCatalog.digest,
    );
    p(
      "sensitivity.catalog.admissionArtifact.id",
      "Sensitivity catalog admission artifact ID",
      sensitivityCatalog.admissionArtifact.id,
    );
    p(
      "sensitivity.catalog.admissionArtifact.fingerprint",
      "Sensitivity catalog admission artifact SHA-256",
      sensitivityCatalog.admissionArtifact.fingerprint.digest,
    );
  }

  return result;
}

// ── Parameters-to-map ─────────────────────────────────────────────────────────

/**
 * Convert a raw parameter array into a Map, rejecting duplicate keys before
 * any field is read.
 *
 * WHY SEPARATE FROM PARSE — the parameter list arrives as a signed array. Constructing
 * a Map eagerly loses the earlier signed value when a key is repeated. This function
 * enforces uniqueness while the original order is still visible, preventing a
 * signed parameter from being silently shadowed by a later duplicate.
 */
export function feaProofDecisionParametersToMap(
  parameters: ReadonlyArray<{
    readonly key: string;
    readonly value: string | number | boolean;
  }>,
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const param of parameters) {
    if (result.has(param.key)) {
      invalid("duplicate_parameter", `Duplicate FEA proof parameter: ${param.key}`);
    }
    result.set(param.key, param.value);
  }
  return result;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

/**
 * Reconstruct a fully-typed FeaProofDecisionParameters from a flat parameter Map.
 *
 * Fail-closed: any unexpected or missing key, invalid fingerprint format, or
 * schema mismatch throws FeaProofProposalError with a typed code. The executor
 * must call this before any Thread interaction.
 */
export function parseFeaProofDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): FeaProofDecisionParameters {
  // Track expected keys as we parse — unexpected keys are rejected at the end.
  const expected = new Set<string>();

  const str = (key: string): string => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing FEA proof parameter: ${key}`);
    }
    const result = String(value);
    if (result.trim() === "") {
      invalid("invalid_format", `FEA proof parameter ${key} must be non-empty.`);
    }
    return result;
  };

  const fp = (key: string): ContentFingerprint => {
    const digest = str(key);
    assertFingerprint(digest, key);
    return { algorithm: "sha256", digest };
  };

  const posInt = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing FEA proof parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
      invalid(
        "invalid_format",
        `FEA proof parameter ${key} must be a positive integer (got: ${value}).`,
      );
    }
    return n;
  };

  const nonNegInt = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing FEA proof parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) {
      invalid(
        "invalid_format",
        `FEA proof parameter ${key} must be a non-negative integer (got: ${value}).`,
      );
    }
    return n;
  };

  const finiteNum = (key: string): number => {
    expected.add(key);
    const value = params.get(key);
    if (value === undefined) {
      invalid("missing_parameter", `Missing FEA proof parameter: ${key}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      invalid(
        "invalid_format",
        `FEA proof parameter ${key} must be finite (got: ${value}).`,
      );
    }
    return n;
  };

  const proofDigest = str("fea.proof.digest");
  assertFingerprint(proofDigest, "fea.proof.digest");
  const sourceFingerprint = str("fea.proof.source.fingerprint");
  assertFingerprint(sourceFingerprint, "fea.proof.source.fingerprint");

  const schemaVersion = str("fea.proof.schemaVersion");
  if (schemaVersion !== MECHANICAL_PROOF_CASE_SCHEMA) {
    invalid(
      "invalid_schema",
      `fea.proof.schemaVersion must be ${MECHANICAL_PROOF_CASE_SCHEMA} (got: ${schemaVersion}).`,
    );
  }

  const id = str("fea.proof.id");
  const revision = posInt("fea.proof.revision");
  const scope = str("fea.proof.scope");
  const evidenceBoundary = str("fea.proof.evidenceBoundary");

  const reviewBasisSnapshotId = str("fea.proof.reviewBasis.snapshotId");
  const reviewBasisRevision = posInt("fea.proof.reviewBasis.revision");

  const targetId = str("fea.proof.target.id");
  const targetModelElementId = str("fea.proof.target.modelElementId");

  const geometryArtifactId = str("fea.proof.geometryArtifact.id");
  const geometryArtifactFp = fp("fea.proof.geometryArtifact.fingerprint");

  const requirementsArtifactId = str("fea.proof.requirementsArtifact.id");
  const requirementsArtifactFp = fp("fea.proof.requirementsArtifact.fingerprint");

  const editingContextId = str("fea.proof.requirementsSource.editingContextId");
  const requirementsElementId = str("fea.proof.requirementsSource.elementId");

  const stepDigest = str("fea.proof.step.digest");
  assertFingerprint(stepDigest, "fea.proof.step.digest");
  const stepBytes = posInt("fea.proof.step.bytes");

  const youngModulusMpa = finiteNum("fea.proof.material.youngModulusMpa");
  const poissonRatio = finiteNum("fea.proof.material.poissonRatio");
  const materialBasis = str("fea.proof.material.basis");

  const targetSizeMm = finiteNum("fea.proof.mesh.targetSizeMm");

  const supportCount = nonNegInt("fea.proof.supports.count");
  const supports: FeaProofSupportParams[] = [];
  for (let i = 0; i < supportCount; i++) {
    const supportId = str(`fea.proof.supports.${i}.id`);
    const selection = str(`fea.proof.supports.${i}.selection`);
    const box = parseBox(str, finiteNum, expected, `fea.proof.supports.${i}`);
    supports.push({ id: supportId, selection, box });
  }

  const loadCount = nonNegInt("fea.proof.loads.count");
  const loads: FeaProofLoadParams[] = [];
  for (let i = 0; i < loadCount; i++) {
    const loadId = str(`fea.proof.loads.${i}.id`);
    const selection = str(`fea.proof.loads.${i}.selection`);
    const box = parseBox(str, finiteNum, expected, `fea.proof.loads.${i}`);
    const forceN: [number, number, number] = [
      finiteNum(`fea.proof.loads.${i}.forceN.0`),
      finiteNum(`fea.proof.loads.${i}.forceN.1`),
      finiteNum(`fea.proof.loads.${i}.forceN.2`),
    ];
    loads.push({ id: loadId, selection, box, forceN });
  }

  const requirementCount = nonNegInt("fea.proof.requirements.count");
  const requirements: FeaProofRequirementParams[] = [];
  for (let i = 0; i < requirementCount; i++) {
    const reqId = str(`fea.proof.requirements.${i}.id`);
    const name = str(`fea.proof.requirements.${i}.name`);
    const metric = str(`fea.proof.requirements.${i}.metric`);
    if (metric !== "maximum-displacement" && metric !== "maximum-von-mises-stress") {
      invalid(
        "invalid_format",
        `fea.proof.requirements.${i}.metric is unsupported: ${metric}.`,
      );
    }
    const feature = str(`fea.proof.requirements.${i}.feature`);
    const operator = str(`fea.proof.requirements.${i}.operator`);
    if (operator !== "<=") {
      invalid(
        "invalid_format",
        `fea.proof.requirements.${i}.operator must be <= (got: ${operator}).`,
      );
    }
    const limitValue = finiteNum(`fea.proof.requirements.${i}.limit.value`);
    const limitUnit = str(`fea.proof.requirements.${i}.limit.unit`);
    if (limitUnit !== "mm" && limitUnit !== "Pa") {
      invalid(
        "invalid_format",
        `fea.proof.requirements.${i}.limit.unit must be mm or Pa (got: ${limitUnit}).`,
      );
    }
    requirements.push({
      id: reqId,
      name,
      metric,
      feature,
      operator: "<=",
      limitValue,
      limitUnit,
    });
  }

  const cadSource = parseCadSource(str, posInt, finiteNum, expected, params);
  let sensitivityCatalog: FeaProofDecisionParameters["sensitivityCatalog"];
  if (params.has("sensitivity.catalog.schemaVersion")) {
    const catalogSchema = str("sensitivity.catalog.schemaVersion");
    if (catalogSchema !== SENSITIVITY_CATALOG_OFFER_SCHEMA) {
      invalid(
        "invalid_schema",
        `sensitivity.catalog.schemaVersion must be ${SENSITIVITY_CATALOG_OFFER_SCHEMA}.`,
      );
    }
    sensitivityCatalog = {
      schemaVersion: SENSITIVITY_CATALOG_OFFER_SCHEMA,
      digest: fp("sensitivity.catalog.digest").digest,
      admissionArtifact: {
        id: str("sensitivity.catalog.admissionArtifact.id"),
        fingerprint: fp("sensitivity.catalog.admissionArtifact.fingerprint"),
      },
    };
  }

  // Reject any key that was not consumed above.
  for (const key of params.keys()) {
    if (!expected.has(key)) {
      invalid(
        "unexpected_parameter",
        `Unexpected FEA proof parameter: ${key}`,
      );
    }
  }

  return {
    proofDigest,
    sourceFingerprint,
    schemaVersion: MECHANICAL_PROOF_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    reviewBasis: { snapshotId: reviewBasisSnapshotId, revision: reviewBasisRevision },
    target: { id: targetId, modelElementId: targetModelElementId },
    geometryArtifact: { id: geometryArtifactId, fingerprint: geometryArtifactFp },
    requirementsArtifact: {
      id: requirementsArtifactId,
      fingerprint: requirementsArtifactFp,
    },
    requirementsSource: {
      editingContextId,
      elementId: requirementsElementId,
    },
    step: { digest: stepDigest, bytes: stepBytes },
    material: { youngModulusMpa, poissonRatio, basis: materialBasis },
    mesh: { targetSizeMm },
    cadSource,
    supports,
    loads,
    requirements,
    ...(sensitivityCatalog === undefined ? {} : { sensitivityCatalog }),
  };
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Cross-check every proof-case field in the parsed parameters against the
 * validated MechanicalProofCase, field by field.
 *
 * WHY SEPARATE FROM PARSE — the parse reconstructs the typed shape; this function
 * proves that the shape matches the signed proof on disk. Separating them lets the
 * executor interpose a catalogue read and digest re-verification between the two
 * steps without entangling those concerns inside the parser.
 *
 * geometryArtifact and requirementsArtifact are Thread-state fields, not proof-case
 * fields, and are not verified here.
 */
export function verifyFeaProofParametersMatchCase(
  params: FeaProofDecisionParameters,
  proofCase: MechanicalProofCase,
): void {
  match(params.schemaVersion, proofCase.schemaVersion, "schemaVersion");
  match(params.id, proofCase.id, "id");
  match(params.revision, proofCase.revision, "revision");
  match(params.scope, proofCase.scope, "scope");
  match(params.evidenceBoundary, proofCase.evidenceBoundary, "evidenceBoundary");
  match(
    params.reviewBasis.snapshotId,
    proofCase.project.baseThreadSnapshot.id,
    "reviewBasis.snapshotId",
  );
  match(
    params.reviewBasis.revision,
    proofCase.project.baseThreadSnapshot.revision,
    "reviewBasis.revision",
  );
  match(params.target.id, proofCase.target.id, "target.id");
  match(
    params.target.modelElementId,
    proofCase.target.modelElementId,
    "target.modelElementId",
  );
  match(
    params.requirementsSource.editingContextId,
    proofCase.requirementsSource.editingContextId,
    "requirementsSource.editingContextId",
  );
  match(
    params.requirementsSource.elementId,
    proofCase.requirementsSource.elementId,
    "requirementsSource.elementId",
  );
  match(params.step.digest, proofCase.expectedCadArtifact.sha256, "step.digest");
  match(params.step.bytes, proofCase.expectedCadArtifact.bytes, "step.bytes");
  match(
    params.material.youngModulusMpa,
    proofCase.analysis.material.youngModulus.value,
    "material.youngModulusMpa",
  );
  match(
    params.material.poissonRatio,
    proofCase.analysis.material.poissonRatio.value,
    "material.poissonRatio",
  );
  match(params.material.basis, proofCase.analysis.material.basis, "material.basis");
  match(
    params.mesh.targetSizeMm,
    proofCase.analysis.mesh.targetSize.value,
    "mesh.targetSizeMm",
  );

  if (params.supports.length !== proofCase.analysis.supports.length) {
    mismatch(
      "supports.count",
      params.supports.length,
      proofCase.analysis.supports.length,
    );
  }
  for (const [i, support] of params.supports.entries()) {
    const ref = proofCase.analysis.supports[i];
    match(support.id, ref.id, `supports.${i}.id`);
    match(support.selection, ref.selection.name, `supports.${i}.selection`);
    matchBox(support.box, ref.selection.box, `supports.${i}.box`);
  }

  if (params.loads.length !== proofCase.analysis.loads.length) {
    mismatch(
      "loads.count",
      params.loads.length,
      proofCase.analysis.loads.length,
    );
  }
  for (const [i, load] of params.loads.entries()) {
    const ref = proofCase.analysis.loads[i];
    match(load.id, ref.id, `loads.${i}.id`);
    match(load.selection, ref.selection.name, `loads.${i}.selection`);
    matchBox(load.box, ref.selection.box, `loads.${i}.box`);
    matchTriple(load.forceN, ref.force.value, `loads.${i}.forceN`);
  }

  if (params.requirements.length !== proofCase.requirements.length) {
    mismatch(
      "requirements.count",
      params.requirements.length,
      proofCase.requirements.length,
    );
  }
  for (const [i, req] of params.requirements.entries()) {
    const ref = proofCase.requirements[i];
    match(req.id, ref.id, `requirements.${i}.id`);
    match(req.name, ref.name, `requirements.${i}.name`);
    match(req.metric, ref.metric, `requirements.${i}.metric`);
    match(req.feature, ref.feature, `requirements.${i}.feature`);
    match(req.operator, ref.operator, `requirements.${i}.operator`);
    match(req.limitValue, ref.limit.value, `requirements.${i}.limit.value`);
    match(req.limitUnit, ref.limit.unit, `requirements.${i}.limit.unit`);
  }

  matchCadSource(params.cadSource, proofCase.cadSource);
}

// ── Private: encode helpers ───────────────────────────────────────────────────

function encodeBox(
  p: (key: string, label: string, value: string | number | boolean) => void,
  prefix: string,
  box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  },
): void {
  for (const axis of [0, 1, 2] as const) {
    p(`${prefix}.box.min.${axis}`, `${prefix} box min ${axis}`, box.min[axis]);
    p(`${prefix}.box.max.${axis}`, `${prefix} box max ${axis}`, box.max[axis]);
  }
}

function encodeCadSource(
  p: (key: string, label: string, value: string | number | boolean) => void,
  cadSource: MechanicalCadSource,
): void {
  p("fea.proof.cadSource.kind", "CAD source kind", cadSource.kind);
  if (cadSource.kind === "parametric") {
    p(
      "fea.proof.cadSource.generator.provider",
      "Generator provider",
      cadSource.generator.provider,
    );
    p(
      "fea.proof.cadSource.generator.tool",
      "Generator tool",
      cadSource.generator.tool,
    );
    p(
      "fea.proof.cadSource.generator.definition.mediaType",
      "Generator definition media type",
      cadSource.generator.definition.mediaType,
    );
    p(
      "fea.proof.cadSource.generator.definition.sha256",
      "Generator definition SHA-256",
      cadSource.generator.definition.sha256,
    );
    p(
      "fea.proof.cadSource.generator.definition.bytes",
      "Generator definition bytes",
      cadSource.generator.definition.bytes,
    );
  } else {
    p("fea.proof.cadSource.method", "Import/reconstruction method", cadSource.method);
    p(
      "fea.proof.cadSource.sources.count",
      "External source count",
      cadSource.sources.length,
    );
    for (const [i, source] of cadSource.sources.entries()) {
      p(`fea.proof.cadSource.sources.${i}.id`, `Source ${i} ID`, source.id);
      p(`fea.proof.cadSource.sources.${i}.name`, `Source ${i} name`, source.name);
      p(
        `fea.proof.cadSource.sources.${i}.format`,
        `Source ${i} format`,
        source.format,
      );
      p(
        `fea.proof.cadSource.sources.${i}.sha256`,
        `Source ${i} SHA-256`,
        source.sha256,
      );
      p(
        `fea.proof.cadSource.sources.${i}.bytes`,
        `Source ${i} bytes`,
        source.bytes,
      );
      p(
        `fea.proof.cadSource.sources.${i}.sourceUri`,
        `Source ${i} URI`,
        source.sourceUri,
      );
    }
    p(
      "fea.proof.cadSource.license.identifier",
      "License identifier",
      cadSource.license.identifier,
    );
    p(
      "fea.proof.cadSource.license.evidenceUri",
      "License evidence URI",
      cadSource.license.evidenceUri,
    );
    p(
      "fea.proof.cadSource.conversion.tool",
      "Conversion tool",
      cadSource.conversion.tool,
    );
    p(
      "fea.proof.cadSource.conversion.revision",
      "Conversion revision",
      cadSource.conversion.revision,
    );
    p(
      "fea.proof.cadSource.conversion.losses.count",
      "Conversion loss count",
      cadSource.conversion.losses.length,
    );
    for (const [i, loss] of cadSource.conversion.losses.entries()) {
      p(
        `fea.proof.cadSource.conversion.losses.${i}`,
        `Conversion loss ${i}`,
        loss,
      );
    }
  }
  // Fields common to both cadSource variants.
  p(
    "fea.proof.cadSource.engineeringBoundary.designIntent",
    "Design intent",
    cadSource.engineeringBoundary.designIntent,
  );
  p(
    "fea.proof.cadSource.engineeringBoundary.editableCad",
    "Editable CAD",
    cadSource.engineeringBoundary.editableCad,
  );
  p(
    "fea.proof.cadSource.engineeringBoundary.manufacturability",
    "Manufacturability",
    cadSource.engineeringBoundary.manufacturability,
  );
  p(
    "fea.proof.cadSource.engineeringBoundary.limitations.count",
    "Engineering limitation count",
    cadSource.engineeringBoundary.limitations.length,
  );
  for (const [i, limitation] of cadSource.engineeringBoundary.limitations.entries()) {
    p(
      `fea.proof.cadSource.engineeringBoundary.limitations.${i}`,
      `Engineering limitation ${i}`,
      limitation,
    );
  }
}

// ── Private: parse helpers ────────────────────────────────────────────────────

function parseBox(
  str: (key: string) => string,
  finiteNum: (key: string) => number,
  expected: Set<string>,
  prefix: string,
): FeaProofBoxParams {
  // Register all six box keys explicitly so the unexpected-key check sees them.
  const min: [number, number, number] = [
    finiteNum(`${prefix}.box.min.0`),
    finiteNum(`${prefix}.box.min.1`),
    finiteNum(`${prefix}.box.min.2`),
  ];
  const max: [number, number, number] = [
    finiteNum(`${prefix}.box.max.0`),
    finiteNum(`${prefix}.box.max.1`),
    finiteNum(`${prefix}.box.max.2`),
  ];
  // str/finiteNum already add to expected — suppress the unused-param warning.
  void str;
  void expected;
  return { min, max };
}

function parseCadSource(
  str: (key: string) => string,
  posInt: (key: string) => number,
  _finiteNum: (key: string) => number,
  expected: Set<string>,
  params: ReadonlyMap<string, string | number | boolean>,
): MechanicalCadSource {
  const kind = str("fea.proof.cadSource.kind");
  let cadSource: MechanicalCadSource;

  if (kind === "parametric") {
    const provider = str("fea.proof.cadSource.generator.provider");
    const tool = str("fea.proof.cadSource.generator.tool");
    const mediaType = str("fea.proof.cadSource.generator.definition.mediaType");
    const defSha256 = str("fea.proof.cadSource.generator.definition.sha256");
    assertFingerprint(defSha256, "fea.proof.cadSource.generator.definition.sha256");
    const defBytes = posInt("fea.proof.cadSource.generator.definition.bytes");
    const engineeringBoundary = parseCadEngineeringBoundary(
      str,
      posInt,
      expected,
      params,
    );
    cadSource = {
      kind: "parametric",
      generator: {
        provider,
        tool,
        definition: { mediaType, sha256: defSha256, bytes: defBytes },
      },
      engineeringBoundary,
    };
  } else if (kind === "imported-or-reconstructed") {
    const method = str("fea.proof.cadSource.method");
    if (method !== "import" && method !== "reverse-engineering") {
      invalid(
        "invalid_format",
        `fea.proof.cadSource.method must be import or reverse-engineering (got: ${method}).`,
      );
    }
    const sourceCount = posInt("fea.proof.cadSource.sources.count");
    const sources = [];
    for (let i = 0; i < sourceCount; i++) {
      const sourceId = str(`fea.proof.cadSource.sources.${i}.id`);
      const name = str(`fea.proof.cadSource.sources.${i}.name`);
      const format = str(`fea.proof.cadSource.sources.${i}.format`);
      const sourceSha256 = str(`fea.proof.cadSource.sources.${i}.sha256`);
      assertFingerprint(sourceSha256, `fea.proof.cadSource.sources.${i}.sha256`);
      const bytes = posInt(`fea.proof.cadSource.sources.${i}.bytes`);
      const sourceUri = str(`fea.proof.cadSource.sources.${i}.sourceUri`);
      sources.push({
        id: sourceId,
        name,
        format,
        sha256: sourceSha256,
        bytes,
        sourceUri,
      });
    }
    const licenseIdentifier = str("fea.proof.cadSource.license.identifier");
    const licenseEvidenceUri = str("fea.proof.cadSource.license.evidenceUri");
    const conversionTool = str("fea.proof.cadSource.conversion.tool");
    const conversionRevision = str("fea.proof.cadSource.conversion.revision");
    const lossCount = posInt("fea.proof.cadSource.conversion.losses.count");
    const losses: string[] = [];
    for (let i = 0; i < lossCount; i++) {
      losses.push(str(`fea.proof.cadSource.conversion.losses.${i}`));
    }
    const engineeringBoundary = parseCadEngineeringBoundary(
      str,
      posInt,
      expected,
      params,
    );
    cadSource = {
      kind: "imported-or-reconstructed",
      method,
      sources,
      license: { identifier: licenseIdentifier, evidenceUri: licenseEvidenceUri },
      conversion: { tool: conversionTool, revision: conversionRevision, losses },
      engineeringBoundary,
    };
  } else {
    invalid(
      "invalid_format",
      `fea.proof.cadSource.kind must be parametric or imported-or-reconstructed (got: ${kind}).`,
    );
  }

  return cadSource;
}

function parseCadEngineeringBoundary(
  str: (key: string) => string,
  posInt: (key: string) => number,
  _expected: Set<string>,
  _params: ReadonlyMap<string, string | number | boolean>,
): MechanicalCadSource["engineeringBoundary"] {
  const designIntent = str(
    "fea.proof.cadSource.engineeringBoundary.designIntent",
  );
  if (
    designIntent !== "preserved" && designIntent !== "partial" &&
    designIntent !== "lost"
  ) {
    invalid(
      "invalid_format",
      `fea.proof.cadSource.engineeringBoundary.designIntent is unsupported: ${designIntent}.`,
    );
  }
  const editableCad = str("fea.proof.cadSource.engineeringBoundary.editableCad");
  if (
    editableCad !== "native" && editableCad !== "reconstructed" &&
    editableCad !== "absent"
  ) {
    invalid(
      "invalid_format",
      `fea.proof.cadSource.engineeringBoundary.editableCad is unsupported: ${editableCad}.`,
    );
  }
  const manufacturability = str(
    "fea.proof.cadSource.engineeringBoundary.manufacturability",
  );
  if (manufacturability !== "not-established") {
    invalid(
      "invalid_format",
      `fea.proof.cadSource.engineeringBoundary.manufacturability must be not-established.`,
    );
  }
  const limitationCount = posInt(
    "fea.proof.cadSource.engineeringBoundary.limitations.count",
  );
  const limitations: string[] = [];
  for (let i = 0; i < limitationCount; i++) {
    limitations.push(str(`fea.proof.cadSource.engineeringBoundary.limitations.${i}`));
  }
  return {
    designIntent,
    editableCad,
    manufacturability: "not-established",
    limitations,
  };
}

// ── Private: verify helpers ───────────────────────────────────────────────────

function match(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) {
    mismatch(field, actual, expected);
  }
}

function matchBox(
  params: FeaProofBoxParams,
  ref: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  },
  label: string,
): void {
  for (const axis of [0, 1, 2] as const) {
    match(params.min[axis], ref.min[axis], `${label}.min.${axis}`);
    match(params.max[axis], ref.max[axis], `${label}.max.${axis}`);
  }
}

function matchTriple(
  params: readonly [number, number, number],
  ref: readonly [number, number, number],
  label: string,
): void {
  for (const axis of [0, 1, 2] as const) {
    match(params[axis], ref[axis], `${label}.${axis}`);
  }
}

function matchCadSource(
  params: MechanicalCadSource,
  ref: MechanicalCadSource,
): void {
  match(params.kind, ref.kind, "cadSource.kind");
  if (params.kind === "parametric" && ref.kind === "parametric") {
    match(
      params.generator.provider,
      ref.generator.provider,
      "cadSource.generator.provider",
    );
    match(params.generator.tool, ref.generator.tool, "cadSource.generator.tool");
    match(
      params.generator.definition.mediaType,
      ref.generator.definition.mediaType,
      "cadSource.generator.definition.mediaType",
    );
    match(
      params.generator.definition.sha256,
      ref.generator.definition.sha256,
      "cadSource.generator.definition.sha256",
    );
    match(
      params.generator.definition.bytes,
      ref.generator.definition.bytes,
      "cadSource.generator.definition.bytes",
    );
  } else if (
    params.kind === "imported-or-reconstructed" &&
    ref.kind === "imported-or-reconstructed"
  ) {
    match(params.method, ref.method, "cadSource.method");
    if (params.sources.length !== ref.sources.length) {
      mismatch("cadSource.sources.count", params.sources.length, ref.sources.length);
    }
    for (const [i, source] of params.sources.entries()) {
      const refSource = ref.sources[i];
      match(source.id, refSource.id, `cadSource.sources.${i}.id`);
      match(source.name, refSource.name, `cadSource.sources.${i}.name`);
      match(source.format, refSource.format, `cadSource.sources.${i}.format`);
      match(source.sha256, refSource.sha256, `cadSource.sources.${i}.sha256`);
      match(source.bytes, refSource.bytes, `cadSource.sources.${i}.bytes`);
      match(source.sourceUri, refSource.sourceUri, `cadSource.sources.${i}.sourceUri`);
    }
    match(
      params.license.identifier,
      ref.license.identifier,
      "cadSource.license.identifier",
    );
    match(
      params.license.evidenceUri,
      ref.license.evidenceUri,
      "cadSource.license.evidenceUri",
    );
    match(
      params.conversion.tool,
      ref.conversion.tool,
      "cadSource.conversion.tool",
    );
    match(
      params.conversion.revision,
      ref.conversion.revision,
      "cadSource.conversion.revision",
    );
    if (params.conversion.losses.length !== ref.conversion.losses.length) {
      mismatch(
        "cadSource.conversion.losses.count",
        params.conversion.losses.length,
        ref.conversion.losses.length,
      );
    }
    for (const [i, loss] of params.conversion.losses.entries()) {
      match(loss, ref.conversion.losses[i], `cadSource.conversion.losses.${i}`);
    }
  }
  // Common fields.
  match(
    params.engineeringBoundary.designIntent,
    ref.engineeringBoundary.designIntent,
    "cadSource.engineeringBoundary.designIntent",
  );
  match(
    params.engineeringBoundary.editableCad,
    ref.engineeringBoundary.editableCad,
    "cadSource.engineeringBoundary.editableCad",
  );
  match(
    params.engineeringBoundary.manufacturability,
    ref.engineeringBoundary.manufacturability,
    "cadSource.engineeringBoundary.manufacturability",
  );
  if (
    params.engineeringBoundary.limitations.length !==
      ref.engineeringBoundary.limitations.length
  ) {
    mismatch(
      "cadSource.engineeringBoundary.limitations.count",
      params.engineeringBoundary.limitations.length,
      ref.engineeringBoundary.limitations.length,
    );
  }
  for (
    const [i, limitation] of params.engineeringBoundary.limitations.entries()
  ) {
    match(
      limitation,
      ref.engineeringBoundary.limitations[i],
      `cadSource.engineeringBoundary.limitations.${i}`,
    );
  }
}

// ── Private: guards ───────────────────────────────────────────────────────────

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

function assertFingerprint(value: string, context: string): void {
  if (!FINGERPRINT_RE.test(value)) {
    invalid(
      "invalid_fingerprint",
      `${context} must be a 64-char lowercase SHA-256 hex digest (got: ${
        value.slice(0, 16)
      }…).`,
    );
  }
}

function mismatch(field: string, actual: unknown, expected: unknown): never {
  invalid(
    "parameter_mismatch",
    `FEA proof parameter ${field} does not match the signed proof case: got ${
      JSON.stringify(actual)
    }, expected ${JSON.stringify(expected)}.`,
  );
}

function invalid(code: FeaProofProposalErrorCode, message: string): never {
  throw new FeaProofProposalError(code, message);
}
