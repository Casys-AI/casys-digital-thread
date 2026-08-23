import { assertEquals, assertThrows } from "@std/assert";
import {
  type MechanicalDeclarationIdentityBinding,
  type MechanicalProofCase,
  mechanicalProofRequirementsMatchCapture,
  validateMechanicalDeclarationIdentityBinding,
  validateMechanicalProofCase,
} from "./mechanical-proof-case.ts";

const CONFIG_URL = new URL(
  "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
  import.meta.url,
);
const DL06_CONFIG_URL = new URL(
  "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
  import.meta.url,
);
const CONFIG_TEXT = await Deno.readTextFile(CONFIG_URL);

Deno.test("DL-04 is one strict immutable mechanical proof declaration", () => {
  const proofCase = validateMechanicalProofCase(caseInput());

  assertEquals(proofCase.schemaVersion, "mechanical-proof-case/1.0");
  assertEquals(proofCase.project.id, "desk-lamp-dl04");
  assertEquals(proofCase.project.subjectId, "project:desk-lamp-dl04");
  assertEquals(
    proofCase.target.modelElementId,
    "b37e42b6-5faf-4c87-8704-f695568c08e8",
  );
  assertEquals(proofCase.expectedCadArtifact, {
    format: "step",
    sha256: "c2f04aa6660caad85bc1a179d64ab2f68cd966781a2646a5c8e8be308fbe187f",
    bytes: 22319,
  });
  assertEquals(proofCase.cadSource.kind, "parametric");
  if (proofCase.cadSource.kind !== "parametric") {
    throw new Error("DL-04 must use its attested parametric definition.");
  }
  assertEquals(proofCase.cadSource.generator.definition, {
    mediaType: "text/x-python",
    sha256: "4dc8adbc9ae879ddfdf851fe8d856417e55ab5ae9191decd3384d234f729625e",
    bytes: 285,
  });
  assertEquals(proofCase.cadSource.engineeringBoundary, {
    designIntent: "partial",
    editableCad: "absent",
    manufacturability: "not-established",
    limitations: [
      "The proof geometry is the isolated ArticulatedArm PartDefinition, not the assembled lamp.",
      "The joint between the arm root and the weighted base is not modelled; the root is treated as fully fixed.",
      "The declaration carries no tolerances, interfaces, manufacturing features or process evidence.",
    ],
  });
  assertEquals(proofCase.analysis.material.youngModulus, {
    value: 69000,
    unit: "MPa",
  });
  assertEquals(proofCase.analysis.mesh.targetSize, { value: 5, unit: "mm" });
  assertEquals(proofCase.analysis.loads[0].force, {
    value: [0, 0, -4.903325],
    unit: "N",
  });
  assertEquals(
    proofCase.requirements.map((requirement) => [
      requirement.metric,
      requirement.limit,
    ]),
    [
      ["maximum-displacement", { value: 5, unit: "mm" }],
      ["maximum-von-mises-stress", { value: 90_000_000, unit: "Pa" }],
    ],
  );
  assertEquals(Object.isFrozen(proofCase), true);
  assertEquals(Object.isFrozen(proofCase.analysis.loads[0].force.value), true);
});

Deno.test("DL-06 Heron arm cantilever is one strict immutable mechanical proof declaration", async () => {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(await Deno.readTextFile(DL06_CONFIG_URL)),
  );
  assertEquals(proofCase.id, "desk-lamp-dl06-arm-cantilever");
  assertEquals(proofCase.project.id, "desk-lamp-dl06");
  assertEquals(proofCase.target.modelElementId, "7dda85d1-764e-4329-95ea-09052355cc47");
  assertEquals(proofCase.expectedCadArtifact, {
    format: "step",
    sha256: "eec1fd0f1526161d9957b4693ab7d3ae67945870dcd75a5a91d21fd11f63140d",
    bytes: 15460,
  });
  assertEquals(proofCase.requirements.map((item) => item.feature), [
    "maxDisplacement",
    "maxVonMises",
  ]);
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
      mutate: (value) => object(value.baseThreadSnapshot).revision = 7,
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
      mutate: (value) => object(value.cadArtifact).bytes = 22320,
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
    "support arm-root-fixed and load head-mass-at-tip selection boxes must not overlap",
  );
});

Deno.test("mechanical proof declaration accepts one supported unit-bearing criterion", () => {
  const displacementOnly = caseInput();
  object(displacementOnly).requirements = array(displacementOnly.requirements).slice(
    0,
    1,
  );
  const proofCase = validateMechanicalProofCase(displacementOnly);
  assertEquals(proofCase.requirements.map((item) => item.metric), [
    "maximum-displacement",
  ]);
});

Deno.test("mechanical proof declaration rejects an empty requirement set", () => {
  const empty = caseInput();
  object(empty).requirements = [];
  assertThrows(
    () => validateMechanicalProofCase(empty),
    Error,
    "$case.requirements must not be empty",
  );
});

Deno.test("mechanical proof declaration rejects unsupported or conflicting criteria", () => {
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

Deno.test("mechanical capture admission allows an extra K criterion beside exact proof criteria", () => {
  assertEquals(
    mechanicalProofRequirementsMatchCapture(
      [
        displacementCapture("arm_max_displacement"),
        stressCapture("arm_max_von_mises"),
        {
          metric: "maxSurfaceTemperature",
          operator: "<=",
          limit: { value: 373, unit: "K" },
        },
      ],
      [
        displacementDeclared("arm_max_displacement"),
        stressDeclared("arm_max_von_mises"),
      ],
    ),
    true,
  );
});

Deno.test("mechanical capture admission refuses an omitted mm/Pa criterion even with an arbitrary feature", () => {
  assertEquals(
    mechanicalProofRequirementsMatchCapture(
      [
        displacementCapture("arm_max_displacement"),
        stressCapture("drip_tray_max_von_mises"),
      ],
      [displacementDeclared("arm_max_displacement")],
    ),
    false,
  );
});

Deno.test("mechanical capture admission refuses a mismatched mechanical criterion", () => {
  assertEquals(
    mechanicalProofRequirementsMatchCapture(
      [{
        ...displacementCapture("arm_max_displacement"),
        limit: { value: 5, unit: "mm" },
      }],
      [displacementDeclared("arm_max_displacement")],
    ),
    false,
  );
});

Deno.test(
  "mechanical capture admission conservatively treats extra mm as omitted mechanical because V1 capture has no kind",
  () => {
    assertEquals(
      mechanicalProofRequirementsMatchCapture(
        [
          displacementCapture("arm_max_displacement"),
          {
            metric: "clearance",
            operator: "<=",
            limit: { value: 2, unit: "mm" },
          },
        ],
        [displacementDeclared("arm_max_displacement")],
      ),
      false,
    );
  },
);

function displacementCapture(feature: string) {
  return {
    metric: feature,
    operator: "<=",
    limit: { value: 1, unit: "mm" },
  };
}

function stressCapture(feature: string) {
  return {
    metric: feature,
    operator: "<=",
    limit: { value: 80_000_000, unit: "Pa" },
  };
}

function displacementDeclared(feature: string) {
  return {
    id: "proof-deflection",
    name: feature,
    metric: "maximum-displacement" as const,
    feature,
    operator: "<=" as const,
    limit: { value: 1, unit: "mm" as const },
  };
}

function stressDeclared(feature: string) {
  return {
    id: "proof-stress",
    name: feature,
    metric: "maximum-von-mises-stress" as const,
    feature,
    operator: "<=" as const,
    limit: { value: 80_000_000, unit: "Pa" as const },
  };
}

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
      id: "vendor-arm-scan",
      name: "Vendor arm reference mesh",
      format: "stl",
      sha256: "c".repeat(64),
      bytes: 98765,
      sourceUri: "casys://supplier-evidence/arm-reference.stl",
    }],
    license: {
      identifier: "LicenseRef-CASYS-Supplier-Evaluation",
      evidenceUri: "casys://supplier-evidence/arm-license.txt",
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
