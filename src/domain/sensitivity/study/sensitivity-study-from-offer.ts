/**
 * Compile a sealable sensitivity-study-case-template/3.0 from a signed
 * catalog offer plus the sealed proof it already joined.
 *
 * The offer still carries `step.status = not-compiled`. This profile copies
 * the sealed proof mesh target size as the first-order-forward step. That
 * number is already a signed proof fact; the remeshed live CalculiX path
 * cannot resolve a smaller perturbation than the discretization it sealed.
 * Mesh, loads, boxes, material and metric ids are copied. `baseValue.unit`
 * is the live-method / mesh-unit rule (`mm`), not a field on the signed
 * offer. The compiler does not invent a lever, a unit, or a catalog JSON.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { MechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import { assertSensitivityLiveMethod } from "./sensitivity-live-method.ts";
import type { ReadySensitivityCatalogOffer } from "./sensitivity-catalog-from-proof.ts";
import {
  assembleSensitivityStudyCaseV3,
  type SensitivityStudyCaseTemplate,
  validateSensitivityStudyCaseTemplate,
} from "./sensitivity-study-template.ts";

export const SENSITIVITY_STUDY_STEP_COMPILATION_PROFILE = "1.0" as const;
export const SENSITIVITY_STUDY_COMPILED_SCOPE = "mechanical-structural" as const;
export const SENSITIVITY_STUDY_COMPILED_EVIDENCE_BOUNDARY = "fea-static" as const;

const TEMPLATE_CAD_SOURCE_PLACEHOLDER = {
  artifactUri: "thread-artifact://template-placeholder/admission",
  sha256: "0".repeat(64),
} as const;

export function sensitivityStudyCaseIdFromOffer(
  proofCase: MechanicalProofCase,
  offer: ReadySensitivityCatalogOffer,
): string {
  return `${proofCase.id}-${offer.lever.semanticKey}`;
}

export function compileSensitivityStudyStep(
  mesh: MechanicalProofCase["analysis"]["mesh"],
): { readonly value: number; readonly unit: "mm" } {
  if (mesh.kind !== "tetrahedral-volume") {
    throw new TypeError(
      "Sensitivity step compilation requires the sealed tetrahedral-volume mesh.",
    );
  }
  if (mesh.targetSize.unit !== "mm") {
    throw new TypeError(
      "Sensitivity step compilation requires the sealed mesh targetSize unit mm.",
    );
  }
  if (!Number.isFinite(mesh.targetSize.value) || mesh.targetSize.value <= 0) {
    throw new TypeError(
      "Sensitivity step compilation requires a positive finite sealed mesh targetSize.",
    );
  }
  return { value: mesh.targetSize.value, unit: "mm" };
}

export function compileSensitivityStudyTemplateFromOffer(input: {
  readonly offer: ReadySensitivityCatalogOffer;
  readonly proofCase: MechanicalProofCase;
  readonly proofDigest: string;
  readonly projectId: string;
  readonly subjectId: string;
}): SensitivityStudyCaseTemplate {
  const { offer, proofCase, proofDigest, projectId, subjectId } = input;
  if (offer.authority.proofDigest !== proofDigest) {
    throw new TypeError(
      "Catalog offer authority.proofDigest is not the reopened proof digest.",
    );
  }
  if (proofCase.project.id !== projectId) {
    throw new TypeError(
      `Catalog offer proof project.id "${proofCase.project.id}" does not match ` +
        `requested projectId "${projectId}".`,
    );
  }
  if (proofCase.project.subjectId !== subjectId) {
    throw new TypeError(
      `Catalog offer proof project.subjectId "${proofCase.project.subjectId}" ` +
        `does not match Thread subject "${subjectId}".`,
    );
  }
  if (offer.lever.semanticKey !== offer.target.semanticKey) {
    throw new TypeError(
      "Catalog offer lever semanticKey does not match the offer target.",
    );
  }
  if (offer.lever.value !== offer.baseValue.value) {
    throw new TypeError(
      "Catalog offer lever value does not match the offer baseValue.",
    );
  }
  if (offer.target.componentKey !== proofCase.target.id) {
    throw new TypeError(
      "Catalog offer target.componentKey is not the sealed proof target.",
    );
  }
  assertCopiedMethodFacts(offer, proofCase);
  const step = compileSensitivityStudyStep(proofCase.analysis.mesh);
  const template = validateSensitivityStudyCaseTemplate({
    schemaVersion: "sensitivity-study-case-template/3.0",
    id: sensitivityStudyCaseIdFromOffer(proofCase, offer),
    revision: 1,
    scope: SENSITIVITY_STUDY_COMPILED_SCOPE,
    evidenceBoundary: SENSITIVITY_STUDY_COMPILED_EVIDENCE_BOUNDARY,
    project: { id: projectId, subjectId },
    target: offer.target,
    baseValue: { value: offer.baseValue.value, unit: step.unit },
    step,
    metrics: offer.metrics,
    method: {
      mesh: {
        kind: offer.method.mesh.kind,
        targetSizeMm: offer.method.mesh.targetSize.value,
      },
      material: {
        model: offer.method.material.model,
        eMpa: offer.method.material.youngModulus.value,
        nu: offer.method.material.poissonRatio.value,
        basis: offer.method.material.basis,
      },
      supports: offer.method.supports,
      loads: offer.method.loads,
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote:
        `Valid for ${offer.lever.semanticKey} in [${offer.baseValue.value}, ${
          offer.baseValue.value + step.value
        }] ${step.unit} on the sealed proof case ${proofCase.id}.`,
      limitations: [
        "Remeshing variation is included because each CalculiX solve remeshes independently.",
        `The study perimeter copies the sealed proof case ${proofCase.id}. Metric ids are the Thread requirement metrics ${
          offer.metrics.map((metric) => metric.id).join(", ")
        } — the join does not invent aliases.`,
        `The first-order-forward step equals the sealed proof mesh target size (${step.value} ${step.unit}) under sensitivity-study step compilation profile ${SENSITIVITY_STUDY_STEP_COMPILATION_PROFILE}; it is not an agent-supplied number.`,
      ],
    },
  });
  assertSensitivityLiveMethod(
    assembleSensitivityStudyCaseV3(template, TEMPLATE_CAD_SOURCE_PLACEHOLDER),
  );
  return deepFreeze(template);
}

function assertCopiedMethodFacts(
  offer: ReadySensitivityCatalogOffer,
  proofCase: MechanicalProofCase,
): void {
  if (
    deterministicJson(offer.method.mesh) !==
      deterministicJson(proofCase.analysis.mesh)
  ) {
    throw new TypeError("The catalog offer mesh is not the sealed proof mesh.");
  }
  if (
    deterministicJson(offer.method.material) !==
      deterministicJson(proofCase.analysis.material)
  ) {
    throw new TypeError(
      "The catalog offer material is not the sealed proof material.",
    );
  }
  if (
    deterministicJson(offer.method.supports) !==
      deterministicJson(proofCase.analysis.supports)
  ) {
    throw new TypeError(
      "The catalog offer supports are not the sealed proof supports.",
    );
  }
  if (
    deterministicJson(offer.method.loads) !==
      deterministicJson(proofCase.analysis.loads)
  ) {
    throw new TypeError(
      "The catalog offer loads are not the sealed proof loads.",
    );
  }
}
