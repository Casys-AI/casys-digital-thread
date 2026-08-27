import { assertEquals, assertThrows } from "@std/assert";
import { validateMechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";
import {
  compileSensitivityCatalogOffer,
  validateReadySensitivityCatalogOffer,
} from "./sensitivity-catalog-from-proof.ts";

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

Deno.test(
  "catalog offer from the live dl06 proof and one lever is ready-for-opt-in without inventing step",
  () => {
    const offer = compileSensitivityCatalogOffer(
      DL06_PROOF,
      [ARM_THICKNESS],
      AUTHORITY,
    );
    assertEquals(offer.status, "ready-for-opt-in");
    if (offer.status !== "ready-for-opt-in") return;
    assertEquals(offer.optInDefault, false);
    assertEquals(offer.lever, { semanticKey: "arm_thickness", value: 10 });
    assertEquals(offer.target, {
      componentKey: "dl06-heron-arm",
      semanticKey: "arm_thickness",
    });
    assertEquals(offer.baseValue, { value: 10 });
    assertEquals(offer.step, { status: "not-compiled" });
    assertEquals(offer.metrics, [
      { id: "maxDisplacement", unit: "mm" },
      { id: "maxVonMises", unit: "MPa" },
    ]);
    assertEquals(offer.solver.mesh, DL06_PROOF.analysis.mesh);
    assertEquals(offer.solver.loads, DL06_PROOF.analysis.loads);
    assertEquals(offer.solver.supports, DL06_PROOF.analysis.supports);
    assertEquals(offer.solver.material, DL06_PROOF.analysis.material);
    assertEquals(
      offer.metrics.some((metric) => metric.id.startsWith("assembly_max_")),
      false,
    );
  },
);

Deno.test(
  "catalog offer is no-named-lever when the admission has no numeric lever",
  () => {
    const offer = compileSensitivityCatalogOffer(DL06_PROOF, [], AUTHORITY);
    assertEquals(offer.status, "no-named-lever");
  },
);

Deno.test(
  "catalog offer is lever-ambiguous when several distinct lever names exist",
  () => {
    const offer = compileSensitivityCatalogOffer(
      DL06_PROOF,
      [
        ARM_THICKNESS,
        {
          ...ARM_THICKNESS,
          semanticKey: "arm_width",
          value: 20,
          sourceSymbolId: "parameter.arm-width",
          parameterBindingId: "binding.arm-width",
          parameterSysmlElementId: "sysml.arm-width",
        },
      ],
      AUTHORITY,
    );
    assertEquals(offer.status, "lever-ambiguous");
  },
);

Deno.test(
  "catalog offer rejects two causal occurrences even when their lever names match",
  () => {
    const offer = compileSensitivityCatalogOffer(
      DL06_PROOF,
      [
        ARM_THICKNESS,
        {
          ...ARM_THICKNESS,
          value: 99,
          sourceId: "source.other",
          sourceSymbolId: "parameter.other-arm-thickness",
          parameterBindingId: "binding.other-arm-thickness",
        },
      ],
      AUTHORITY,
    );
    assertEquals(offer.status, "lever-ambiguous");
  },
);

Deno.test("ready catalog offer validator accepts the compiled dl06 offer", () => {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [ARM_THICKNESS],
    AUTHORITY,
  );
  assertEquals(offer.status, "ready-for-opt-in");
  if (offer.status !== "ready-for-opt-in") return;
  const validated = validateReadySensitivityCatalogOffer(offer);
  assertEquals(validated.step, { status: "not-compiled" });
  assertEquals(validated.optInDefault, false);
  assertEquals(validated.authority.proofDigest, AUTHORITY.proofDigest);
});

Deno.test("ready catalog offer validator refuses a truncated offer without authority", () => {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [ARM_THICKNESS],
    AUTHORITY,
  );
  assertEquals(offer.status, "ready-for-opt-in");
  if (offer.status !== "ready-for-opt-in") return;
  const { authority: _dropped, ...truncated } = offer;
  assertThrows(
    () => validateReadySensitivityCatalogOffer(truncated),
    TypeError,
    "authority is required",
  );
});

Deno.test("ready catalog offer validator refuses a compiled step value", () => {
  const offer = compileSensitivityCatalogOffer(
    DL06_PROOF,
    [ARM_THICKNESS],
    AUTHORITY,
  );
  assertEquals(offer.status, "ready-for-opt-in");
  if (offer.status !== "ready-for-opt-in") return;
  assertThrows(
    () =>
      validateReadySensitivityCatalogOffer({
        ...offer,
        step: { status: "not-compiled", value: 1 },
      }),
    TypeError,
    "unsupported field value",
  );
});
