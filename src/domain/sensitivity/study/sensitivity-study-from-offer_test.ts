import { assertEquals, assertThrows } from "@std/assert";
import { validateMechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import { compileSensitivityCatalogOffer } from "./sensitivity-catalog-from-proof.ts";
import {
  compileSensitivityStudyStep,
  compileSensitivityStudyTemplateFromOffer,
  SENSITIVITY_STUDY_COMPILED_EVIDENCE_BOUNDARY,
  SENSITIVITY_STUDY_COMPILED_SCOPE,
  SENSITIVITY_STUDY_STEP_COMPILATION_PROFILE,
  sensitivityStudyCaseIdFromOffer,
} from "./sensitivity-study-from-offer.ts";

const DL06_PROOF = validateMechanicalProofCase(
  JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  ),
);

const ARM_THICKNESS = {
  semanticKey: "arm_thickness",
  value: 10,
  sourceId: "source.arm",
  sourceSymbolId: "parameter.arm-thickness",
  parameterBindingId: "binding.arm-thickness",
  parameterSysmlElementId: "sysml.arm-thickness",
  resultSymbolId: "artifact.result",
} as const;
const AUTHORITY = {
  proofDigest: "a".repeat(64),
  admissionArtifact: {
    id: "technical-compilation-admission-a",
    fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  },
  source: {
    id: "source.arm",
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
  },
  resultBinding: {
    id: "binding.result",
    sourceSymbolId: "artifact.result",
    modelElementId: DL06_PROOF.target.modelElementId,
  },
} as const;

function readyOffer() {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [ARM_THICKNESS],
    AUTHORITY,
  );
  if (offer.status !== "ready-for-opt-in") {
    throw new Error(`Expected a ready offer, got ${offer.status}.`);
  }
  return offer;
}

Deno.test(
  "step compilation copies the sealed proof mesh target size and does not invent 1 mm",
  () => {
    assertEquals(compileSensitivityStudyStep(DL06_PROOF.analysis.mesh), {
      value: 3,
      unit: "mm",
    });
    assertEquals(SENSITIVITY_STUDY_STEP_COMPILATION_PROFILE, "1.0");
  },
);

Deno.test(
  "signed catalog offer compiles a sealable template with copied solver facts",
  () => {
    const offer = readyOffer();
    const template = compileSensitivityStudyTemplateFromOffer({
      offer,
      proofCase: DL06_PROOF,
      proofDigest: AUTHORITY.proofDigest,
      projectId: "desk-lamp-dl06",
      subjectId: "project:desk-lamp-dl06",
    });
    assertEquals(
      template.id,
      "desk-lamp-dl06-arm-cantilever-arm_thickness",
    );
    assertEquals(
      template.id,
      sensitivityStudyCaseIdFromOffer(DL06_PROOF, offer),
    );
    assertEquals(template.revision, 1);
    assertEquals(template.scope, SENSITIVITY_STUDY_COMPILED_SCOPE);
    assertEquals(
      template.evidenceBoundary,
      SENSITIVITY_STUDY_COMPILED_EVIDENCE_BOUNDARY,
    );
    assertEquals(template.project, {
      id: "desk-lamp-dl06",
      subjectId: "project:desk-lamp-dl06",
    });
    assertEquals(template.target, {
      componentKey: "dl06-heron-arm",
      semanticKey: "arm_thickness",
    });
    assertEquals(template.baseValue, { value: 10, unit: "mm" });
    assertEquals(template.step, { value: 3, unit: "mm" });
    assertEquals(template.metrics, [
      { id: "maxDisplacement", unit: "mm" },
      { id: "maxVonMises", unit: "MPa" },
    ]);
    assertEquals(template.solver.mesh, {
      kind: "tetrahedral-volume",
      targetSizeMm: 3,
    });
    assertEquals(template.solver.material.eMpa, 69000);
    assertEquals(template.solver.material.nu, 0.33);
    assertEquals(template.solver.material.basis, DL06_PROOF.analysis.material.basis);
    assertEquals(template.solver.supports, DL06_PROOF.analysis.supports);
    assertEquals(template.solver.loads, DL06_PROOF.analysis.loads);
    assertEquals(template.domain.approximationOrder, "first-order-forward");
    assertEquals(template.domain.remeshingVariationIncluded, true);
    assertEquals(
      template.domain.localValidityNote.includes("arm_thickness in [10, 13] mm"),
      true,
    );
    assertEquals(
      template.domain.limitations.some((item) =>
        item.includes("sealed proof mesh target size (3 mm)")
      ),
      true,
    );
  },
);

Deno.test(
  "template compilation refuses a project or subject that is not the sealed proof",
  () => {
    const offer = readyOffer();
    assertThrows(
      () =>
        compileSensitivityStudyTemplateFromOffer({
          offer,
          proofCase: DL06_PROOF,
          proofDigest: AUTHORITY.proofDigest,
          projectId: "desk-lamp-dl05",
          subjectId: "project:desk-lamp-dl06",
        }),
      TypeError,
      "project.id",
    );
    assertThrows(
      () =>
        compileSensitivityStudyTemplateFromOffer({
          offer,
          proofCase: DL06_PROOF,
          proofDigest: AUTHORITY.proofDigest,
          projectId: "desk-lamp-dl06",
          subjectId: "project:desk-lamp-dl05",
        }),
      TypeError,
      "subjectId",
    );
  },
);

Deno.test(
  "template compilation refuses an offer whose proofDigest is not the reopened proof",
  () => {
    const offer = readyOffer();
    assertThrows(
      () =>
        compileSensitivityStudyTemplateFromOffer({
          offer,
          proofCase: DL06_PROOF,
          proofDigest: "f".repeat(64),
          projectId: "desk-lamp-dl06",
          subjectId: "project:desk-lamp-dl06",
        }),
      TypeError,
      "authority.proofDigest",
    );
  },
);

Deno.test(
  "template compilation refuses an offer whose copied solver facts drifted from the proof",
  () => {
    const offer = readyOffer();
    assertThrows(
      () =>
        compileSensitivityStudyTemplateFromOffer({
          offer: {
            ...offer,
            solver: {
              ...offer.solver,
              mesh: {
                ...offer.solver.mesh,
                targetSize: { value: 99, unit: "mm" },
              },
            },
          },
          proofCase: DL06_PROOF,
          proofDigest: AUTHORITY.proofDigest,
          projectId: "desk-lamp-dl06",
          subjectId: "project:desk-lamp-dl06",
        }),
      TypeError,
      "mesh is not the sealed proof mesh",
    );
  },
);
