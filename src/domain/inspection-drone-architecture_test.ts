import { assertEquals, assertRejects } from "@std/assert";
import {
  INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  InspectionDroneArchitectureReadbackError,
  inspectionDroneArchitectureSysmlFingerprint,
  validateInspectionDroneArchitectureReadback,
} from "./inspection-drone-architecture.ts";

Deno.test("inspection-drone architecture accepts only the reviewed SysML acknowledgement and readback", async () => {
  const result = await validateInspectionDroneArchitectureReadback(happyPath());

  assertEquals(result.insertion, {
    inserted: true,
    parentId: "root-package-012",
    textSha256: await inspectionDroneArchitectureSysmlFingerprint(),
  });
  assertEquals(result.architecturePackage, {
    id: "architecture-package-123",
    kind: "Package",
    label: "InspectionDroneArchitecture",
  });
  assertEquals(
    result.declarations.map((item) => item.label).sort(),
    [...INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS].sort(),
  );
});

Deno.test("inspection-drone architecture never accepts caller-altered SysML text", async () => {
  const input = happyPath();
  (input.insertionResult as { text: string }).text =
    `${INSPECTION_DRONE_ARCHITECTURE_SYSML}\n`;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(input),
    InspectionDroneArchitectureReadbackError,
    "exactly match the reviewed SysML recipe",
  );
});

Deno.test("inspection-drone architecture rejects ambiguous or incomplete post-write reads", async () => {
  const ambiguousRoot = happyPath();
  (ambiguousRoot.rootChildrenResult as { children: unknown[]; count: number }).children
    .push({ id: "manual-package", kind: "Package", label: "ManualEdit" });
  (ambiguousRoot.rootChildrenResult as { count: number }).count = 2;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(ambiguousRoot),
    InspectionDroneArchitectureReadbackError,
    "exactly one post-insert architecture package",
  );

  const incompleteDeclarations = happyPath();
  (incompleteDeclarations.architectureChildrenResult as {
    children: unknown[];
    count: number;
  }).children.pop();
  (incompleteDeclarations.architectureChildrenResult as { count: number }).count =
    INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length - 1;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(incompleteDeclarations),
    InspectionDroneArchitectureReadbackError,
    "must contain exactly",
  );
});

function happyPath() {
  const architecturePackage = {
    id: "architecture-package-123",
    kind: "Package",
    label: "InspectionDroneArchitecture",
  };
  return {
    rootPackageId: "root-package-012",
    insertionResult: {
      inserted: true,
      parentId: "root-package-012",
      text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
    },
    rootChildrenResult: {
      parentId: "root-package-012",
      children: [architecturePackage],
      count: 1,
    },
    architectureChildrenResult: {
      parentId: architecturePackage.id,
      children: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.map((label, index) => ({
        id: `declaration-${index}`,
        kind: label === "Requirements" ? "Package" : "PartDefinition",
        label,
      })),
      count: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length,
    },
  };
}
