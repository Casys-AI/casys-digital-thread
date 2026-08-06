import { assertEquals, assertThrows } from "@std/assert";
import {
  type MechanicalDeclarationIdentityBinding,
  type MechanicalProofCase,
  validateMechanicalDeclarationIdentityBinding,
  validateMechanicalProofCase,
} from "./mechanical-proof-case.ts";

const CONFIG_URL = new URL(
  "../../../config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
  import.meta.url,
);
const CONFIG_TEXT = await Deno.readTextFile(CONFIG_URL);
const PROJECT = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../config/projects/coffee-machine-cm01.project.json",
      import.meta.url,
    ),
  ),
) as Record<string, unknown>;
const BASE_SNAPSHOT = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
      import.meta.url,
    ),
  ),
) as Record<string, unknown>;
const BUILD_DECLARATION = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../config/thread-subjects/coffee-machine-cm01.build.json",
      import.meta.url,
    ),
  ),
) as Record<string, unknown>;

Deno.test("CM-01 is one strict immutable mechanical proof declaration", () => {
  const proofCase = validateMechanicalProofCase(caseInput());

  assertEquals(proofCase.schemaVersion, "mechanical-proof-case/1.0");
  assertEquals(proofCase.project.id, "coffee-machine-cm01");
  assertEquals(proofCase.project.subjectId, "coffee-machine-cm01");
  assertEquals(
    proofCase.target.modelElementId,
    "ea6cdc62-4e96-4485-8e8a-e5aa2cfaf7b9",
  );
  assertEquals(proofCase.expectedCadArtifact, {
    format: "step",
    sha256: "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84",
    bytes: 15490,
  });
  assertEquals(proofCase.cadSource.kind, "parametric");
  if (proofCase.cadSource.kind !== "parametric") {
    throw new Error("CM-01 must use its attested parametric definition.");
  }
  assertEquals(proofCase.cadSource.generator.definition, {
    mediaType: "text/x-python",
    sha256: "d8926529fb20625cb5834703324c7dc8f24fe3bbf518829b7d34e3c09a19725e",
    bytes: 110,
  });
  assertEquals(proofCase.cadSource.engineeringBoundary, {
    designIntent: "partial",
    editableCad: "absent",
    manufacturability: "not-established",
    limitations: [
      "The proof geometry is one isolated parametric box, not the editable CM-01 product CAD model.",
      "The declaration contains no tolerances, interfaces, manufacturing features or fabrication process evidence.",
    ],
  });
  assertEquals(proofCase.analysis.material.youngModulus, {
    value: 2200,
    unit: "MPa",
  });
  assertEquals(proofCase.analysis.mesh.targetSize, { value: 5, unit: "mm" });
  assertEquals(proofCase.analysis.loads[0].force, {
    value: [0, 0, -100],
    unit: "N",
  });
  assertEquals(
    proofCase.requirements.map((requirement) => [
      requirement.metric,
      requirement.limit,
    ]),
    [
      ["maximum-displacement", { value: 1, unit: "mm" }],
      ["maximum-von-mises-stress", { value: 20_000_000, unit: "Pa" }],
    ],
  );
  assertEquals(Object.isFrozen(proofCase), true);
  assertEquals(Object.isFrozen(proofCase.analysis.loads[0].force.value), true);
});

Deno.test("declaration identity binding matches only project, target, snapshot and CAD identities", () => {
  const proofCase = validateMechanicalProofCase(caseInput());
  const binding = declarationIdentityBinding(proofCase);
  assertEquals(
    validateMechanicalDeclarationIdentityBinding(proofCase, binding),
    proofCase,
  );

  const mismatches: Array<{
    path: string;
    mutate(value: Record<string, unknown>): void;
  }> = [
    {
      path: "$binding.projectId",
      mutate: (value) => value.projectId = "another-project",
    },
    {
      path: "$binding.subjectId",
      mutate: (value) => value.subjectId = "another-subject",
    },
    {
      path: "$binding.baseThreadSnapshot.revision",
      mutate: (value) => object(value.baseThreadSnapshot).revision = 6,
    },
    {
      path: "$binding.targetModelElementId",
      mutate: (value) => value.targetModelElementId = "another-model-element",
    },
    {
      path: "$binding.cadSource",
      mutate: (value) =>
        object(object(value.cadSource).generator).tool = "another_export",
    },
    {
      path: "$binding.cadArtifact.sha256",
      mutate: (value) => object(value.cadArtifact).sha256 = "b".repeat(64),
    },
    {
      path: "$binding.cadArtifact.bytes",
      mutate: (value) => object(value.cadArtifact).bytes = 15491,
    },
  ];

  for (const mismatch of mismatches) {
    const candidate = structuredClone(binding) as unknown as Record<string, unknown>;
    mismatch.mutate(candidate);
    assertThrows(
      () => validateMechanicalDeclarationIdentityBinding(proofCase, candidate),
      Error,
      `${mismatch.path} does not match`,
    );
  }
});

Deno.test("CM-01 identities resolve to the tracked project, base snapshot and PartUsage", () => {
  const proofCase = validateMechanicalProofCase(caseInput());
  const projectIdentity = object(PROJECT.project);
  assertEquals(projectIdentity.id, proofCase.project.id);
  assertEquals(projectIdentity.subjectId, proofCase.project.subjectId);
  assertEquals(BASE_SNAPSHOT.id, proofCase.project.baseThreadSnapshot.id);
  assertEquals(BASE_SNAPSHOT.revision, proofCase.project.baseThreadSnapshot.revision);
  assertEquals(
    object(BASE_SNAPSHOT.subject).id,
    proofCase.project.baseThreadSnapshot.subjectId,
  );
  const component = array(BUILD_DECLARATION.components).map(object).find((item) =>
    item.id === proofCase.target.id
  );
  assertEquals(component?.partUsageId, proofCase.target.modelElementId);
  assertEquals(
    array(PROJECT.workItems).map(object).some((item) =>
      item.id === proofCase.authorization.workItemId
    ),
    true,
  );
  assertEquals(
    array(PROJECT.decisions).map(object).some((item) =>
      item.id === proofCase.authorization.decisionId
    ),
    true,
  );
});

Deno.test("mechanical proof declaration rejects legacy schemas and undeclared fields", () => {
  const legacy = caseInput();
  object(legacy.solver).resultSchemaVersion = "1.0";
  assertThrows(
    () => validateMechanicalProofCase(legacy),
    Error,
    '$case.solver.resultSchemaVersion must equal "2.0"',
  );

  const wrongCaseSchema = caseInput();
  wrongCaseSchema.schemaVersion = "mechanical-proof-case/0.9";
  assertThrows(
    () => validateMechanicalProofCase(wrongCaseSchema),
    Error,
    '$case.schemaVersion must equal "mechanical-proof-case/1.0"',
  );

  const unsafeExtension = caseInput();
  unsafeExtension.solverArguments = { inferredMaterial: "ABS" };
  assertThrows(
    () => validateMechanicalProofCase(unsafeExtension),
    Error,
    "$case has unsupported field solverArguments",
  );

  const mismatchedSubject = caseInput();
  object(object(mismatchedSubject.project).baseThreadSnapshot).subjectId =
    "another-subject";
  assertThrows(
    () => validateMechanicalProofCase(mismatchedSubject),
    Error,
    "baseThreadSnapshot.subjectId must equal",
  );
});

Deno.test("mechanical proof declaration rejects inferred or invalid physical inputs", () => {
  const wrongModulusUnit = caseInput();
  object(
    object(object(wrongModulusUnit.analysis).material).youngModulus,
  ).unit = "Pa";
  assertThrows(
    () => validateMechanicalProofCase(wrongModulusUnit),
    Error,
    'youngModulus.unit must equal "MPa"',
  );

  const invalidPoissonRatio = caseInput();
  object(
    object(object(invalidPoissonRatio.analysis).material).poissonRatio,
  ).value = 0.5;
  assertThrows(
    () => validateMechanicalProofCase(invalidPoissonRatio),
    Error,
    "poissonRatio.value must be greater than zero and below 0.5",
  );

  const unsupportedElementOrder = caseInput();
  object(object(unsupportedElementOrder.analysis).mesh).elementOrder = 2;
  assertThrows(
    () => validateMechanicalProofCase(unsupportedElementOrder),
    Error,
    "$case.analysis.mesh has unsupported field elementOrder",
  );

  const invertedBox = caseInput();
  const support = object(array(object(invertedBox.analysis).supports)[0]);
  object(object(support.selection).box).min = [96, 66.5, -15];
  assertThrows(
    () => validateMechanicalProofCase(invertedBox),
    Error,
    "box.min[0] must be below max[0]",
  );

  const zeroForce = caseInput();
  const load = object(array(object(zeroForce.analysis).loads)[0]);
  object(load.force).value = [0, 0, 0];
  assertThrows(
    () => validateMechanicalProofCase(zeroForce),
    Error,
    "force.value must contain a non-zero component",
  );

  const reusedSelection = caseInput();
  const reusedLoad = object(array(object(reusedSelection.analysis).loads)[0]);
  object(reusedLoad.selection).name = "FIXED";
  assertThrows(
    () => validateMechanicalProofCase(reusedSelection),
    Error,
    "$case.analysis selection names must not contain duplicates",
  );

  const overlappingSelections = caseInput();
  const overlappingSupport = object(
    array(object(overlappingSelections.analysis).supports)[0],
  );
  const overlappingLoad = object(
    array(object(overlappingSelections.analysis).loads)[0],
  );
  object(overlappingLoad.selection).box = structuredClone(
    object(overlappingSupport.selection).box,
  );
  assertThrows(
    () => validateMechanicalProofCase(overlappingSelections),
    Error,
    "support rear-face-fixed and load front-face-downward-force selection boxes must not overlap",
  );
});

Deno.test("mechanical proof declaration requires the two declared unit-bearing criteria", () => {
  const incomplete = caseInput();
  object(incomplete).requirements = array(incomplete.requirements).slice(0, 1);
  assertThrows(
    () => validateMechanicalProofCase(incomplete),
    Error,
    "$case.requirements must contain exactly",
  );

  const wrongStressUnit = caseInput();
  const stress = object(array(wrongStressUnit.requirements)[1]);
  object(stress.limit).unit = "MPa";
  assertThrows(
    () => validateMechanicalProofCase(wrongStressUnit),
    Error,
    '$case.requirements[1].limit.unit must equal "Pa"',
  );

  const unsupportedMetric = caseInput();
  object(array(unsupportedMetric.requirements)[0]).metric = "maximum-strain";
  assertThrows(
    () => validateMechanicalProofCase(unsupportedMetric),
    Error,
    "$case.requirements[0].metric is unsupported",
  );

  const duplicateMetric = caseInput();
  const duplicate = object(array(duplicateMetric.requirements)[1]);
  duplicate.metric = "maximum-displacement";
  duplicate.id = "another-constraint-id";
  duplicate.name = "another_constraint_name";
  duplicate.feature = "another_displacement_feature";
  duplicate.limit = { value: 2, unit: "mm" };
  assertThrows(
    () => validateMechanicalProofCase(duplicateMetric),
    Error,
    "$case.requirements metrics must not contain duplicates",
  );
});

Deno.test("imported or reconstructed CAD requires exact sources, licence and explicit losses", () => {
  const imported = caseInput();
  imported.cadSource = importedCadSource();
  const validated = validateMechanicalProofCase(imported);
  assertEquals(validated.cadSource, importedCadSource());

  const missingLicense = caseInput();
  missingLicense.cadSource = importedCadSource();
  delete object(missingLicense.cadSource).license;
  assertThrows(
    () => validateMechanicalProofCase(missingLicense),
    Error,
    "$case.cadSource.license is required",
  );

  const silentConversion = caseInput();
  silentConversion.cadSource = importedCadSource();
  object(object(silentConversion.cadSource).conversion).losses = [];
  assertThrows(
    () => validateMechanicalProofCase(silentConversion),
    Error,
    "$case.cadSource.conversion.losses must not be empty",
  );

  const falseIntent = caseInput();
  falseIntent.cadSource = importedCadSource();
  object(object(falseIntent.cadSource).engineeringBoundary).designIntent = "preserved";
  object(object(falseIntent.cadSource).engineeringBoundary).editableCad = "native";
  assertThrows(
    () => validateMechanicalProofCase(falseIntent),
    Error,
    "designIntent cannot be preserved for reverse-engineering",
  );

  const falseManufacturability = caseInput();
  object(object(falseManufacturability.cadSource).engineeringBoundary)
    .manufacturability = "validated";
  assertThrows(
    () => validateMechanicalProofCase(falseManufacturability),
    Error,
    'manufacturability must equal "not-established"',
  );
});

function caseInput(): Record<string, unknown> {
  return JSON.parse(CONFIG_TEXT) as Record<string, unknown>;
}

function declarationIdentityBinding(
  proofCase: MechanicalProofCase,
): MechanicalDeclarationIdentityBinding {
  return {
    projectId: proofCase.project.id,
    subjectId: proofCase.project.subjectId,
    baseThreadSnapshot: structuredClone(proofCase.project.baseThreadSnapshot),
    targetId: proofCase.target.id,
    targetModelElementId: proofCase.target.modelElementId,
    cadSource: structuredClone(proofCase.cadSource),
    cadArtifact: structuredClone(proofCase.expectedCadArtifact),
  };
}

function importedCadSource(): Record<string, unknown> {
  return {
    kind: "imported-or-reconstructed",
    method: "reverse-engineering",
    sources: [{
      id: "vendor-drip-tray-scan",
      name: "Vendor drip-tray reference mesh",
      format: "stl",
      sha256: "c".repeat(64),
      bytes: 98765,
      sourceUri: "casys://supplier-evidence/drip-tray-reference.stl",
    }],
    license: {
      identifier: "LicenseRef-CASYS-Supplier-Evaluation",
      evidenceUri: "casys://supplier-evidence/drip-tray-license.txt",
    },
    conversion: {
      tool: "surface-reconstruction",
      revision: "1.2.3",
      losses: [
        "Original feature history and parameter constraints are unavailable.",
        "Mesh-to-surface fitting introduces bounded geometric approximation.",
      ],
    },
    engineeringBoundary: {
      designIntent: "lost",
      editableCad: "reconstructed",
      manufacturability: "not-established",
      limitations: [
        "The reconstructed surface does not recover original tolerances or manufacturing intent.",
      ],
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("test fixture expected an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("test fixture expected an array");
  return value;
}
