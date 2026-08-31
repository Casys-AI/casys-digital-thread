/**
 * Compile a sensitivity-catalog opt-in from a sealed proof case plus levers.
 *
 * The offer copies already catalogued proof fields. It does not invent mesh,
 * loads, a step, or a complete sensitivity-study-case-template/3.0. Metric
 * units come from the code-owned live-method contract, not requirement limits.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type GeometryAffectingNamedNumericLever,
  listGeometryAffectingNamedNumericLevers,
} from "../../compile/source/named-cad-levers.ts";
import type { MechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import { SENSITIVITY_LIVE_METRIC_UNITS } from "./sensitivity-live-method.ts";
import type { TechnicalCompilationDocument } from "../../compile/admission/technical-compilation.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const SELECTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const READY_OFFER_KEYS = [
  "schemaVersion",
  "status",
  "optInDefault",
  "lever",
  "metrics",
  "method",
  "target",
  "authority",
  "baseValue",
  "step",
] as const;

const HISTORICAL_ASSEMBLY_METRIC = /^assembly_max_/;
export const SENSITIVITY_CATALOG_OFFER_SCHEMA =
  "sensitivity-catalog-offer/1.0" as const;
export const SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA =
  "sensitivity-catalog-offer-capture/1.0" as const;

export interface SensitivityCatalogAuthority {
  readonly proofDigest: string;
  readonly admissionArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly resultBinding: {
    readonly id: string;
    readonly sourceSymbolId: string;
    readonly modelElementId: string;
  };
}

export type SensitivityCatalogOffer =
  | {
    readonly schemaVersion: typeof SENSITIVITY_CATALOG_OFFER_SCHEMA;
    readonly status: "ready-for-opt-in";
    readonly optInDefault: false;
    readonly lever: { readonly semanticKey: string; readonly value: number };
    readonly metrics: readonly { readonly id: string; readonly unit: string }[];
    readonly method: {
      readonly mesh: MechanicalProofCase["analysis"]["mesh"];
      readonly material: MechanicalProofCase["analysis"]["material"];
      readonly supports: MechanicalProofCase["analysis"]["supports"];
      readonly loads: MechanicalProofCase["analysis"]["loads"];
    };
    readonly target: {
      readonly componentKey: string;
      readonly semanticKey: string;
    };
    readonly authority: SensitivityCatalogAuthority & {
      readonly parameterBinding: {
        readonly id: string;
        readonly sourceSymbolId: string;
        readonly sysmlElementId: string;
      };
    };
    readonly baseValue: { readonly value: number };
    readonly step: { readonly status: "not-compiled" };
  }
  | {
    readonly status:
      | "no-named-lever"
      | "lever-ambiguous"
      | "metric-incompatible"
      | "admission-unlinked";
    readonly message: string;
  };

export type ReadySensitivityCatalogOffer = Extract<
  SensitivityCatalogOffer,
  { readonly status: "ready-for-opt-in" }
>;

export function compileSensitivityCatalogOffer(
  proofCase: MechanicalProofCase,
  levers: readonly GeometryAffectingNamedNumericLever[],
  authority: SensitivityCatalogAuthority,
): SensitivityCatalogOffer {
  if (levers.length === 0) {
    return deepFreeze({
      status: "no-named-lever" as const,
      message:
        "The admitted CAD source has no unique module-level named numeric lever. The sensitivity catalog is not offered.",
    });
  }
  if (levers.length !== 1) {
    return deepFreeze({
      status: "lever-ambiguous" as const,
      message: `Several causal named numeric lever occurrences are present (${
        levers.map((lever) =>
          `${lever.semanticKey}@${lever.sourceId}:${lever.sourceSymbolId}`
        ).join(", ")
      }). The server does not pick one.`,
    });
  }
  const lever = levers[0]!;
  const requirements = proofCase.requirements.filter((requirement) =>
    !HISTORICAL_ASSEMBLY_METRIC.test(requirement.feature)
  );
  const incompatibleMetric = requirements.find((requirement) =>
    !SENSITIVITY_LIVE_METRIC_UNITS.has(requirement.feature)
  );
  if (incompatibleMetric) {
    return deepFreeze({
      status: "metric-incompatible" as const,
      message:
        `Proof metric ${incompatibleMetric.feature} has no exact unit in the live sensitivity method.`,
    });
  }
  return deepFreeze({
    schemaVersion: SENSITIVITY_CATALOG_OFFER_SCHEMA,
    status: "ready-for-opt-in" as const,
    optInDefault: false,
    lever: { semanticKey: lever.semanticKey, value: lever.value },
    metrics: requirements
      .map((requirement) => ({
        id: requirement.feature,
        unit: SENSITIVITY_LIVE_METRIC_UNITS.get(requirement.feature)!,
      })),
    method: {
      mesh: proofCase.analysis.mesh,
      material: proofCase.analysis.material,
      supports: proofCase.analysis.supports,
      loads: proofCase.analysis.loads,
    },
    target: {
      componentKey: proofCase.target.id,
      semanticKey: lever.semanticKey,
    },
    authority: {
      ...authority,
      parameterBinding: {
        id: lever.parameterBindingId,
        sourceSymbolId: lever.sourceSymbolId,
        sysmlElementId: lever.parameterSysmlElementId,
      },
    },
    baseValue: { value: lever.value },
    step: { status: "not-compiled" as const },
  });
}

export function compileSensitivityCatalogOfferFromAdmission(input: {
  readonly proofCase: MechanicalProofCase;
  readonly proofDigest: string;
  readonly admissionArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly document: TechnicalCompilationDocument;
}): SensitivityCatalogOffer {
  const build123d = input.document.projections.filter((projection) =>
    projection.target === "build123d-source" &&
    projection.status === "ready-for-review"
  );
  if (build123d.length !== 1 || build123d[0]!.sources.length !== 1) {
    return unlinked(
      "The admission does not expose exactly one ready Build123d source.",
    );
  }
  const source = build123d[0]!.sources[0]!;
  const sourceIdentity = source.analysis.source;
  const definition = input.proofCase.cadSource.kind === "parametric"
    ? input.proofCase.cadSource.generator.definition
    : undefined;
  if (
    definition === undefined ||
    definition.mediaType !== "text/x-python" ||
    definition.sha256 !== sourceIdentity.fingerprint.digest ||
    definition.bytes !== new TextEncoder().encode(source.sourceText).byteLength
  ) {
    return unlinked(
      "The admitted Build123d source is not the exact CAD definition sealed by the proof case.",
    );
  }
  const resultSymbols = source.analysis.symbols.filter((symbol) =>
    symbol.kind === "artifact" && symbol.name === "result"
  );
  if (resultSymbols.length !== 1) {
    return unlinked(
      "The admitted Build123d source has no unique result artifact for the proof target.",
    );
  }
  const resultBindings = source.bindings.filter((binding) =>
    binding.sourceSymbolId === resultSymbols[0]!.id &&
    binding.relation === "represents" &&
    binding.sysmlElementId === input.proofCase.target.modelElementId
  );
  if (resultBindings.length !== 1) {
    return unlinked(
      "The admitted Build123d result does not uniquely represent the proof target model element.",
    );
  }
  const levers = listGeometryAffectingNamedNumericLevers(
    source.sourceText,
    source.analysis,
    source.bindings,
  );
  return compileSensitivityCatalogOffer(input.proofCase, levers, {
    proofDigest: input.proofDigest,
    admissionArtifact: input.admissionArtifact,
    source: {
      id: sourceIdentity.id,
      fingerprint: sourceIdentity.fingerprint,
    },
    resultBinding: {
      id: resultBindings[0]!.id,
      sourceSymbolId: resultSymbols[0]!.id,
      modelElementId: input.proofCase.target.modelElementId,
    },
  });
}

/**
 * Fail-closed reopen of a sealed ready offer. Extra keys, a compiled `step`,
 * a missing `authority`, or a non-false `optInDefault` are refused here so a
 * later join cannot throw while reading nested fields.
 *
 * `baseValue` stays `{ value }` only. The live-method / mesh-unit rule that
 * fills `baseValue.unit` on the study template is not this schema.
 */
export function validateReadySensitivityCatalogOffer(
  value: unknown,
  path = "Sensitivity catalog offer",
): ReadySensitivityCatalogOffer {
  const record = exactRecord(value, READY_OFFER_KEYS, path);
  literalValue(
    record.schemaVersion,
    SENSITIVITY_CATALOG_OFFER_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(record.status, "ready-for-opt-in", `${path}.status`);
  literalValue(record.optInDefault, false, `${path}.optInDefault`);
  const lever = exactRecord(record.lever, ["semanticKey", "value"], `${path}.lever`);
  const leverSemanticKey = safeId(lever.semanticKey, `${path}.lever.semanticKey`);
  const leverValue = finite(lever.value, `${path}.lever.value`);
  const metrics = nonEmptyArray(record.metrics, `${path}.metrics`).map(
    (metric, index) => parseOfferMetric(metric, `${path}.metrics[${index}]`),
  );
  const method = parseOfferMethod(record.method, `${path}.method`);
  const target = exactRecord(
    record.target,
    ["componentKey", "semanticKey"],
    `${path}.target`,
  );
  const targetSemanticKey = safeId(target.semanticKey, `${path}.target.semanticKey`);
  if (leverSemanticKey !== targetSemanticKey) {
    throw new TypeError(
      `${path}.lever.semanticKey does not match ${path}.target.semanticKey.`,
    );
  }
  const authority = parseOfferAuthority(record.authority, `${path}.authority`);
  const baseValue = exactRecord(record.baseValue, ["value"], `${path}.baseValue`);
  const base = finite(baseValue.value, `${path}.baseValue.value`);
  if (leverValue !== base) {
    throw new TypeError(
      `${path}.lever.value does not match ${path}.baseValue.value.`,
    );
  }
  const step = exactRecord(record.step, ["status"], `${path}.step`);
  literalValue(step.status, "not-compiled", `${path}.step.status`);
  return deepFreeze({
    schemaVersion: SENSITIVITY_CATALOG_OFFER_SCHEMA,
    status: "ready-for-opt-in",
    optInDefault: false,
    lever: { semanticKey: leverSemanticKey, value: leverValue },
    metrics,
    method,
    target: {
      componentKey: safeId(target.componentKey, `${path}.target.componentKey`),
      semanticKey: targetSemanticKey,
    },
    authority,
    baseValue: { value: base },
    step: { status: "not-compiled" },
  });
}

function parseOfferMetric(
  value: unknown,
  path: string,
): { readonly id: string; readonly unit: string } {
  const record = exactRecord(value, ["id", "unit"], path);
  const id = safeId(record.id, `${path}.id`);
  const unit = nonEmptyText(record.unit, `${path}.unit`);
  const expected = SENSITIVITY_LIVE_METRIC_UNITS.get(id);
  if (expected === undefined) {
    throw new TypeError(`${path}.id is not a live sensitivity metric.`);
  }
  if (unit !== expected) {
    throw new TypeError(`${path}.unit must equal ${expected}.`);
  }
  return { id, unit };
}

function parseOfferMethod(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"] {
  const record = exactRecord(
    value,
    [
      "mesh",
      "material",
      "supports",
      "loads",
    ],
    path,
  );
  return {
    mesh: parseOfferMesh(record.mesh, `${path}.mesh`),
    material: parseOfferMaterial(record.material, `${path}.material`),
    supports: nonEmptyArray(record.supports, `${path}.supports`).map((
      support,
      index,
    ) => parseOfferSupport(support, `${path}.supports[${index}]`)),
    loads: nonEmptyArray(record.loads, `${path}.loads`).map((load, index) =>
      parseOfferLoad(load, `${path}.loads[${index}]`)
    ),
  };
}

function parseOfferMesh(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"]["mesh"] {
  const record = exactRecord(value, ["kind", "targetSize"], path);
  literalValue(record.kind, "tetrahedral-volume", `${path}.kind`);
  const targetSize = parseScalar(record.targetSize, "mm", `${path}.targetSize`);
  if (targetSize.value <= 0) {
    throw new TypeError(`${path}.targetSize.value must be greater than zero.`);
  }
  return { kind: "tetrahedral-volume", targetSize };
}

function parseOfferMaterial(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"]["material"] {
  const record = exactRecord(
    value,
    ["model", "basis", "youngModulus", "poissonRatio"],
    path,
  );
  literalValue(record.model, "isotropic-linear-elastic", `${path}.model`);
  const youngModulus = parseScalar(
    record.youngModulus,
    "MPa",
    `${path}.youngModulus`,
  );
  if (youngModulus.value <= 0) {
    throw new TypeError(`${path}.youngModulus.value must be greater than zero.`);
  }
  const poissonRatio = parseScalar(record.poissonRatio, "1", `${path}.poissonRatio`);
  if (poissonRatio.value <= 0 || poissonRatio.value >= 0.5) {
    throw new TypeError(
      `${path}.poissonRatio.value must be greater than zero and below 0.5.`,
    );
  }
  return {
    model: "isotropic-linear-elastic",
    basis: nonEmptyText(record.basis, `${path}.basis`),
    youngModulus,
    poissonRatio,
  };
}

function parseOfferSupport(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"]["supports"][number] {
  const record = exactRecord(value, ["id", "kind", "selection"], path);
  literalValue(record.kind, "fixed", `${path}.kind`);
  return {
    id: safeId(record.id, `${path}.id`),
    kind: "fixed",
    selection: parseOfferSelection(record.selection, `${path}.selection`),
  };
}

function parseOfferLoad(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"]["loads"][number] {
  const record = exactRecord(value, ["id", "kind", "selection", "force"], path);
  literalValue(record.kind, "force", `${path}.kind`);
  const force = parseVector(record.force, "N", `${path}.force`);
  if (force.value.every((component) => component === 0)) {
    throw new TypeError(`${path}.force.value must contain a non-zero component.`);
  }
  return {
    id: safeId(record.id, `${path}.id`),
    kind: "force",
    selection: parseOfferSelection(record.selection, `${path}.selection`),
    force,
  };
}

function parseOfferSelection(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["method"]["supports"][number]["selection"] {
  const record = exactRecord(value, ["name", "box"], path);
  const name = nonEmptyText(record.name, `${path}.name`);
  if (!SELECTION_NAME.test(name)) {
    throw new TypeError(
      `${path}.name must start with a letter and contain only letters, digits or underscores.`,
    );
  }
  const box = exactRecord(record.box, ["min", "max", "unit"], `${path}.box`);
  literalValue(box.unit, "mm", `${path}.box.unit`);
  const min = parseTriple(box.min, `${path}.box.min`);
  const max = parseTriple(box.max, `${path}.box.max`);
  min.forEach((component, axis) => {
    if (component >= max[axis]) {
      throw new TypeError(`${path}.box.min[${axis}] must be below max[${axis}].`);
    }
  });
  return { name, box: { min, max, unit: "mm" } };
}

function parseOfferAuthority(
  value: unknown,
  path: string,
): ReadySensitivityCatalogOffer["authority"] {
  const record = exactRecord(
    value,
    [
      "proofDigest",
      "admissionArtifact",
      "source",
      "resultBinding",
      "parameterBinding",
    ],
    path,
  );
  const admission = exactRecord(
    record.admissionArtifact,
    ["id", "fingerprint"],
    `${path}.admissionArtifact`,
  );
  const source = exactRecord(record.source, ["id", "fingerprint"], `${path}.source`);
  const resultBinding = exactRecord(
    record.resultBinding,
    ["id", "sourceSymbolId", "modelElementId"],
    `${path}.resultBinding`,
  );
  const parameterBinding = exactRecord(
    record.parameterBinding,
    ["id", "sourceSymbolId", "sysmlElementId"],
    `${path}.parameterBinding`,
  );
  return {
    proofDigest: digestValue(record.proofDigest, `${path}.proofDigest`),
    admissionArtifact: {
      id: safeId(admission.id, `${path}.admissionArtifact.id`),
      fingerprint: parseFingerprint(
        admission.fingerprint,
        `${path}.admissionArtifact.fingerprint`,
      ),
    },
    source: {
      id: safeId(source.id, `${path}.source.id`),
      fingerprint: parseFingerprint(source.fingerprint, `${path}.source.fingerprint`),
    },
    resultBinding: {
      id: safeId(resultBinding.id, `${path}.resultBinding.id`),
      sourceSymbolId: safeId(
        resultBinding.sourceSymbolId,
        `${path}.resultBinding.sourceSymbolId`,
      ),
      modelElementId: safeId(
        resultBinding.modelElementId,
        `${path}.resultBinding.modelElementId`,
      ),
    },
    parameterBinding: {
      id: safeId(parameterBinding.id, `${path}.parameterBinding.id`),
      sourceSymbolId: safeId(
        parameterBinding.sourceSymbolId,
        `${path}.parameterBinding.sourceSymbolId`,
      ),
      sysmlElementId: safeId(
        parameterBinding.sysmlElementId,
        `${path}.parameterBinding.sysmlElementId`,
      ),
    },
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: digestValue(record.digest, `${path}.digest`) };
}

function parseScalar<Unit extends string>(
  value: unknown,
  unit: Unit,
  path: string,
): { readonly value: number; readonly unit: Unit } {
  const record = exactRecord(value, ["value", "unit"], path);
  literalValue(record.unit, unit, `${path}.unit`);
  return { value: finite(record.value, `${path}.value`), unit };
}

function parseVector<Unit extends string>(
  value: unknown,
  unit: Unit,
  path: string,
): { readonly value: readonly [number, number, number]; readonly unit: Unit } {
  const record = exactRecord(value, ["value", "unit"], path);
  literalValue(record.unit, unit, `${path}.unit`);
  return { value: parseTriple(record.value, `${path}.value`), unit };
}

function parseTriple(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must contain exactly three finite numbers.`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}

function digestValue(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 hex digest.`);
  }
  return digest;
}

function unlinked(message: string): SensitivityCatalogOffer {
  return deepFreeze({
    status: "admission-unlinked" as const,
    message,
  });
}
