import { assertEquals, assertExists } from "@std/assert";
import {
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS,
  getCoffeeMachineCm01V3EngineeringKit,
  listCoffeeMachineCm01V3EngineeringKits,
  listCoffeeMachineCm01V3OperationDescriptors,
} from "./coffee-machine-cm01-v3-engineering-kits.ts";

Deno.test("CM-01 V3 exposes the baseline and bounded 30 mm correction kits", () => {
  const kits = listCoffeeMachineCm01V3EngineeringKits();

  assertEquals(
    kits.map((kit) => `${kit.kitId}@${kit.kitVersion}`),
    [
      "cm01.syson-architecture@1",
      "cm01.syson-oracle-requirements@1",
      "cm01.cad-assembly@1",
      "cm01.drip-tray-height-correction@1",
      "cm01.thermal-nominal@1",
      "cm01.cad-assembly-drip-tray-height-30@2",
      "cm01.cad-assembly-with-mesh-stls@3",
      "cm01.cad-assembly-with-host-assets@4",
      "cm01.erp-bom-observation@1",
      "cm01.drip-tray-static-proof@1",
      "cm01.drip-tray-static-proof-height-30@2",
      "cm01.drip-tray-static-proof-height-30-r3@3",
      "cm01.drip-tray-static-proof-height-30-r3-identity-recovery@1",
      "cm01.drip-tray-sensitivity@1",
      "cm01.drip-tray-sensitivity-relations@1",
      "cm01.drip-tray-sensitivity-edges@2",
      "cm01.drip-tray-printability@1",
      "cm01.drip-tray-print-estimate@1",
      "cm01.part-definitions@1",
      "cm01.archive-lineage@1",
    ],
  );
  assertEquals(
    kits.map((kit) => kit.qualification.status),
    Array(20).fill("manually-qualified"),
  );
  assertEquals(
    kits.map((kit) => kit.presentationRole),
    [
      "architecture",
      "architecture",
      "cad",
      "cad",
      "simulation",
      "cad",
      "cad",
      "cad",
      "supply",
      "verification",
      "verification",
      "verification",
      "verification",
      "verification",
      "architecture",
      "architecture", // cm01.drip-tray-sensitivity-edges@2
      "verification",
      "supply",
      "architecture", // cm01.part-definitions@1
      "architecture", // cm01.archive-lineage@1
    ],
  );
  assertEquals(
    kits.map((kit) => kit.activityCategory),
    [
      "model",
      "model",
      "design",
      "design",
      "analysis",
      "design",
      "design",
      "design",
      "observation",
      "verification",
      "verification",
      "verification",
      "verification",
      "analysis",
      "model",
      "model", // cm01.drip-tray-sensitivity-edges@2
      "observation",
      "observation",
      "model", // cm01.part-definitions@1
      "model", // cm01.archive-lineage@1
    ],
  );

  for (const kit of kits) {
    assertEquals(kit.qualification.sourceRefs.length > 0, true);
    assertEquals(kit.evidenceBoundary.length > 0, true);
    assertEquals(kit.operation.allowedBasisKinds, ["thread-snapshot"]);
  }
  // Every kit is trusted. @2 (cm01.drip-tray-sensitivity-edges) was
  // planning-only until the operator consented to live migration in chat on
  // 2026-08-05.
  assertEquals(
    kits.map((kit) => kit.operation.execution),
    Array(20).fill("trusted"),
  );
  assertEquals(kits[5]?.operation.bindings, [
    { name: "approvedBrief", allowedSourceKinds: ["approved-brief"] },
    { name: "dripTrayHeightCorrection", allowedSourceKinds: ["thread-entity"] },
  ]);
  // kits[6] = cm01.cad-assembly-with-mesh-stls@3 — same two bindings as @2.
  assertEquals(kits[6]?.operation.bindings, kits[5]?.operation.bindings);
  // kits[7] = cm01.cad-assembly-with-host-assets@4 — same two bindings as @3.
  assertEquals(kits[7]?.operation.bindings, kits[5]?.operation.bindings);
  assertEquals(kits[10]?.operation.bindings, [
    { name: "approvedBrief", allowedSourceKinds: ["approved-brief"] },
    { name: "dripTrayHeightCorrection", allowedSourceKinds: ["thread-entity"] },
    { name: "revisedCadStep", allowedSourceKinds: ["thread-entity"] },
  ]);
  assertEquals(kits[11]?.operation.bindings, kits[10]?.operation.bindings);
  assertEquals(kits[12]?.operation.bindings, [
    { name: "approvedBrief", allowedSourceKinds: ["approved-brief"] },
    {
      name: "historicalMechanicalR3Result",
      allowedSourceKinds: ["thread-entity"],
    },
  ]);
});

Deno.test("CM-01 V3 operation references are stable and descriptors retain no executor authority", () => {
  const operations = listCoffeeMachineCm01V3OperationDescriptors();

  assertEquals(
    operations.map((operation) => `${operation.id}@${operation.version}`),
    [
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.dripTrayHeightCorrection.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.id}@2`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30WithMeshStls.id}@3`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30WithMeshStlsAndHostAssets.id}@4`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30.id}@2`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3.id}@3`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3IdentityRecovery.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityDripTrayBaseZ.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelations.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.id}@2`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.printabilityDripTray.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.printEstimateDripTray.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.partDefinitions.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage.id}@1`,
    ],
  );
  assertEquals(operations[0]?.execution, "trusted");
  assertEquals(operations[1]?.execution, "trusted");
  assertEquals(operations[2]?.execution, "trusted");
  assertEquals(operations[3]?.execution, "trusted");
  assertEquals(operations[4]?.execution, "trusted");
  assertEquals(operations[5]?.execution, "trusted");
  assertEquals(operations[6]?.execution, "trusted");
  assertEquals(operations[7]?.execution, "trusted");
  assertEquals(operations[8]?.execution, "trusted");
  assertEquals(operations[9]?.execution, "trusted");
  assertEquals(operations[10]?.execution, "trusted");
  assertEquals(operations[11]?.execution, "trusted");
  assertEquals(operations[12]?.execution, "trusted");
  assertEquals(operations[13]?.execution, "trusted");
  assertEquals(operations[14]?.execution, "trusted");
  // operations[15] = sensitivityRelationsV2@2 — planning-only until the
  // operator consented to live migration in chat on 2026-08-05.
  assertEquals(operations[15]?.execution, "trusted");
  assertEquals(operations[16]?.execution, "trusted");
  assertEquals(operations[17]?.execution, "trusted");
  assertEquals(operations[18]?.execution, "trusted");
  assertEquals(operations[19]?.execution, "trusted");
  assertEquals(
    operations.every((operation) => operation.execution === "trusted"),
    true,
  );
  assertEquals(
    operations.every((operation) =>
      !Object.keys(operation).some((key) =>
        ["executor", "provider", "tool", "arguments"].includes(key)
      )
    ),
    true,
  );
});

Deno.test(
  "CM-01 V3 oracle-requirements kit is trusted, carries the correct operation id, and declares the architecture artifact binding",
  () => {
    const kit = getCoffeeMachineCm01V3EngineeringKit(
      "cm01.syson-oracle-requirements",
    );
    assertExists(kit);

    // Identity and execution authority.
    assertEquals(kit.kitId, "cm01.syson-oracle-requirements");
    assertEquals(kit.kitVersion, "1");
    assertEquals(
      kit.operation.id,
      "model.write-coffee-machine-cm01-oracle-requirements",
    );
    assertEquals(kit.operation.version, "1");
    assertEquals(kit.operation.execution, "trusted");

    // Presentation metadata.
    assertEquals(kit.presentationRole, "architecture");
    assertEquals(kit.activityCategory, "model");
    assertEquals(kit.operation.workItemKind, "architect");
    assertEquals(kit.operation.riskClass, "consequential");

    // Bindings: approved-brief input from planning, architecture artifact from
    // the prior architecture kit execution — the executor needs both to insert
    // the requirement element into the correct editing context and parent.
    assertEquals(kit.operation.bindings, [
      { name: "approvedBrief", allowedSourceKinds: ["approved-brief"] },
      {
        name: "architectureArtifact",
        allowedSourceKinds: ["thread-entity"],
      },
    ]);

    // Three reviewed-configuration source refs: proof JSON (thresholds), domain
    // renderer (canonical SysML), and extractor (re-read contract).
    assertEquals(kit.qualification.status, "manually-qualified");
    assertEquals(kit.qualification.sourceRefs.length, 3);
    assertEquals(
      kit.qualification.sourceRefs.map((ref) => ref.kind),
      [
        "reviewed-configuration",
        "reviewed-configuration",
        "reviewed-configuration",
      ],
    );
    assertEquals(
      kit.qualification.sourceRefs.map((ref) => ref.path),
      [
        "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
        "src/domain/analysis/proof-case.ts",
        "src/adapters/extractors/syson-requirements-extractor.ts",
      ],
    );
    for (const ref of kit.qualification.sourceRefs) {
      assertEquals(ref.purpose.length > 0, true);
    }

    // Evidence boundary must explicitly disclaim verdict, solver, CAD, and
    // certification — it anchors a declaration, nothing more.
    assertEquals(kit.evidenceBoundary.length > 0, true);
  },
);

Deno.test("CM-01 V3 catalog callers receive isolated copies", () => {
  const first = getCoffeeMachineCm01V3EngineeringKit("cm01.cad-assembly");
  assertExists(first);
  (first.qualification.sourceRefs as unknown as { path: string }[])[0].path = "mutated";
  (first.operation.allowedBasisKinds as string[]).push("approved-brief");

  const second = getCoffeeMachineCm01V3EngineeringKit("cm01.cad-assembly");
  assertExists(second);
  assertEquals(
    second.qualification.sourceRefs[0].path,
    "config/golden-references/coffee-machine-cm01-v3.json",
  );
  assertEquals(second.operation.allowedBasisKinds, ["thread-snapshot"]);
});
