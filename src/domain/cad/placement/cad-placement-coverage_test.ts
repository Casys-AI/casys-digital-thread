import { assertEquals } from "@std/assert";
import { validateCadImmediatePlacementSource } from "./cad-immediate-placement-source.ts";
import { assessCadPlacementCoverage } from "./cad-placement-coverage.ts";

const OWNERS: Record<string, string> = {
  "usage-left": "def-system",
  "usage-right": "def-system",
  "usage-pad": "def-rail",
};
const TYPED: Record<string, string> = {
  "usage-left": "def-rail",
  "usage-right": "def-rail",
  "usage-pad": "def-pad",
};
const IMMEDIATE: Record<string, readonly string[]> = {
  "def-system": ["usage-left", "usage-right"],
  "def-rail": ["usage-pad"],
};

function architecture() {
  return {
    ownerDefinitionId: (usageId: string) => OWNERS[usageId],
    immediateUsageIds: (definitionId: string) => IMMEDIATE[definitionId] ?? [],
    typedDefinitionId: (usageId: string) => TYPED[usageId],
  };
}

function source(usageIds: readonly string[] = ["usage-right", "usage-left"]) {
  return validateCadImmediatePlacementSource({
    schemaVersion: "cad-immediate-placement-source/1.0",
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    placements: usageIds.map((usageElementId) => ({
      usageElementId,
      partDefinitionElementId: TYPED[usageElementId] ?? "def-missing",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    })),
  });
}

Deno.test("placement coverage resolves when JSON, attachments and immediate owner usages are exactly equal", () => {
  const coverage = assessCadPlacementCoverage({
    source: source(),
    attachedUsageIds: ["usage-right", "usage-left"],
    architecture: architecture(),
  });
  assertEquals(coverage.status, "resolved");
  if (coverage.status !== "resolved") return;
  assertEquals(coverage.owner, {
    elementKind: "PartDefinition",
    elementId: "def-system",
  });
  assertEquals(coverage.usages.map((item) => item.usageElementId), [
    "usage-left",
    "usage-right",
  ]);
});

Deno.test("placement coverage stays unresolved for a missing or extra usage and never fills from order", () => {
  const missing = assessCadPlacementCoverage({
    source: source(["usage-left"]),
    attachedUsageIds: ["usage-left"],
    architecture: architecture(),
  });
  assertEquals(missing.status, "unresolved");
  if (missing.status !== "unresolved") return;
  assertEquals(
    missing.gaps.some((gap) =>
      gap.name === "usage-right" && gap.relation === "placement"
    ),
    true,
  );

  const extra = assessCadPlacementCoverage({
    source: source(["usage-left", "usage-right", "usage-pad"]),
    attachedUsageIds: ["usage-left", "usage-right"],
    architecture: architecture(),
  });
  assertEquals(extra.status, "unresolved");
  if (extra.status !== "unresolved") return;
  assertEquals(
    extra.gaps.some((gap) => gap.name === "usage-pad" && gap.relation === "owner"),
    true,
  );
});

Deno.test("placement coverage recrosses typed_by and refuses a label-shaped definition mismatch", () => {
  const mismatched = assessCadPlacementCoverage({
    source: validateCadImmediatePlacementSource({
      schemaVersion: "cad-immediate-placement-source/1.0",
      unitSystem: "mm",
      placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
      placements: [{
        usageElementId: "usage-left",
        partDefinitionElementId: "Rail",
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      }, {
        usageElementId: "usage-right",
        partDefinitionElementId: "def-rail",
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      }],
    }),
    attachedUsageIds: ["usage-left", "usage-right"],
    architecture: architecture(),
  });
  assertEquals(mismatched.status, "unresolved");
  if (mismatched.status !== "unresolved") return;
  assertEquals(
    mismatched.gaps.some((gap) =>
      gap.name === "usage-left" && gap.relation === "typed_by"
    ),
    true,
  );
});

Deno.test("placement coverage keeps duplicate active attachments unresolved", () => {
  const duplicated = assessCadPlacementCoverage({
    source: source(),
    attachedUsageIds: ["usage-left", "usage-left", "usage-right"],
    architecture: architecture(),
  });
  assertEquals(duplicated.status, "unresolved");
  if (duplicated.status !== "unresolved") return;
  assertEquals(
    duplicated.gaps.some((gap) =>
      gap.name === "usage-left" && gap.relation === "attachment"
    ),
    true,
  );
});
