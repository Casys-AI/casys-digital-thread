import { assertEquals } from "@std/assert";
import {
  buildCatalogArtifactAnchorMap,
  productDefinitionSummary,
  productStructureAvailability,
  productStructureHeadline,
} from "./src/thread/product-anchor-model.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import type { ThreadComponent, ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

function snapshotWith(
  components: ThreadComponent[],
): ThreadWorkbenchSnapshot {
  const base = structuredClone(GENERIC_THREAD_FIXTURE);
  base.components.components = components;
  return base;
}

const CAPTURE_DIGEST = "c".repeat(64);
const R3_PREFIX = `generic-product-v3-cad-r3-${CAPTURE_DIGEST}`;

// ── tests ─────────────────────────────────────────────────────────────────────

Deno.test("buildCatalogArtifactAnchorMap returns empty map for empty catalog", () => {
  const snapshot = snapshotWith([]);
  const anchor = buildCatalogArtifactAnchorMap(snapshot);
  assertEquals(anchor.size, 0);
});

Deno.test("empty or legacy product projection is unavailable, never zero components", () => {
  const snapshot = snapshotWith([]);
  snapshot.components.rationale =
    "architecture-capture/1.0 cannot be projected by the current vocabulary.";

  assertEquals(productStructureAvailability(snapshot), {
    status: "unavailable",
    title: "Product structure unavailable",
    detail: "architecture-capture/1.0 cannot be projected by the current vocabulary.",
    guidance:
      "The current thread does not expose a reviewed product catalog compatible with this view. No zero-component count is inferred; inspect the exact architecture evidence or migrate it through the reviewed architecture operation.",
  });
  assertEquals(
    productDefinitionSummary(snapshot),
    "Product structure unavailable. architecture-capture/1.0 cannot be projected by the current vocabulary.",
  );
});

Deno.test("available product structure distinguishes roots from part occurrences", () => {
  const snapshot = snapshotWith([{
    id: "assembly",
    label: "Desk lamp",
    kind: "assembly",
    quantity: 1,
    bindings: [],
  }, {
    id: "base-usage",
    parentId: "assembly",
    label: "Base",
    kind: "part",
    quantity: 1,
    bindings: [],
  }, {
    id: "fastener-usage",
    parentId: "assembly",
    label: "Fastener",
    kind: "part",
    quantity: 4,
    bindings: [],
  }]);

  assertEquals(productStructureAvailability(snapshot), {
    status: "available",
    assemblyRootCount: 1,
    partDefinitionCount: 1,
    partOccurrenceCount: 5,
  });
  assertEquals(
    productStructureHeadline({
      status: "available",
      assemblyRootCount: 1,
      partDefinitionCount: 1,
      partOccurrenceCount: 5,
    }),
    {
      count: 5,
      label: "declared part occurrences",
      detail: "1 assembly root",
    },
  );
});

Deno.test("a system-only assembly is one PartDefinition and zero occurrences, never 00", () => {
  const snapshot = snapshotWith([{
    id: "system-root",
    label: "CantileverArm",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "part-def-arm",
      label: "CantileverArm",
      evidenceArtifactId: "architecture-1",
      status: "verified",
    }],
    attributes: [{
      id: "attr-thickness",
      kind: "AttributeUsage",
      label: "thickness",
    }],
  }]);

  const structure = productStructureAvailability(snapshot);
  assertEquals(structure, {
    status: "available",
    assemblyRootCount: 1,
    partDefinitionCount: 1,
    partOccurrenceCount: 0,
  });
  if (structure.status !== "available") {
    throw new Error("A valid system-only catalog must stay available.");
  }
  assertEquals(productStructureHeadline(structure), {
    count: 1,
    label: "declared PartDefinition",
    detail: "0 part occurrences",
  });
  assertEquals(
    productDefinitionSummary(snapshot),
    "1 reviewed component records across SysON.",
  );
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 assembly STEP to assembly component", () => {
  const stepId = `${R3_PREFIX}-step`;
  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "syson",
        kind: "part-definition",
        id: "sysml-generic-product",
        label: "GenericAssembly",
        evidenceArtifactId: "arch-001",
        status: "verified",
      },
      {
        provider: "build123d",
        kind: "artifact",
        id: stepId,
        label: "GEN-01 30 mm DripTray assembly STEP export",
        evidenceArtifactId: stepId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(snapshotWith([assembly]));

  // The STEP artifact is anchored to the assembly component
  assertEquals(anchor.get(stepId), "generic-v3:generic-product");
  // The architecture artifact is also anchored via its own binding
  assertEquals(anchor.get("arch-001"), "generic-v3:generic-product");
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 drip-tray mesh to the drip-tray part", () => {
  const meshId = `${R3_PREFIX}-mesh-drip-tray`;
  const stepId = `${R3_PREFIX}-step`;

  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "build123d",
        kind: "artifact",
        id: stepId,
        label: "GEN-01 assembly STEP",
        evidenceArtifactId: stepId,
        status: "verified",
      },
    ],
  };
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [
      {
        provider: "build123d",
        kind: "artifact",
        id: meshId,
        label: "GEN-01 drip-tray presentation STL",
        evidenceArtifactId: meshId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(
    snapshotWith([assembly, dripTray]),
  );

  // Assembly STEP → assembly component
  assertEquals(anchor.get(stepId), "generic-v3:generic-product");

  // Drip-tray mesh → drip-tray part, NOT assembly
  assertEquals(anchor.get(meshId), "generic-v3:drip-tray");
  assertEquals(anchor.get(stepId) !== "generic-v3:drip-tray", true);
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 plan and script to assembly via digital-thread provider", () => {
  const planId = `${R3_PREFIX}-plan`;
  const scriptId = `${R3_PREFIX}-script`;

  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "digital-thread",
        kind: "artifact",
        id: planId,
        label: "GEN-01 30 mm DripTray semantic CAD plan",
        evidenceArtifactId: planId,
        status: "verified",
      },
      {
        provider: "digital-thread",
        kind: "artifact",
        id: scriptId,
        label: "GEN-01 30 mm DripTray deterministic build123d script",
        evidenceArtifactId: scriptId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(snapshotWith([assembly]));

  assertEquals(anchor.get(planId), "generic-v3:generic-product");
  assertEquals(anchor.get(scriptId), "generic-v3:generic-product");
});

Deno.test("buildCatalogArtifactAnchorMap never anchors a drip-tray mesh to the assembly", () => {
  const meshDripTrayId = `${R3_PREFIX}-mesh-drip-tray`;
  const meshAssemblyId = `${R3_PREFIX}-mesh-assembly`;

  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshAssemblyId,
      label: "GEN-01 assembly presentation STL",
      evidenceArtifactId: meshAssemblyId,
      status: "verified",
    }],
  };
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshDripTrayId,
      label: "GEN-01 drip-tray presentation STL",
      evidenceArtifactId: meshDripTrayId,
      status: "verified",
    }],
  };

  const anchor = buildCatalogArtifactAnchorMap(
    snapshotWith([assembly, dripTray]),
  );

  assertEquals(anchor.get(meshAssemblyId), "generic-v3:generic-product");
  assertEquals(anchor.get(meshDripTrayId), "generic-v3:drip-tray");
  // Explicit check: drip-tray mesh must NOT be anchored to assembly
  assertEquals(anchor.get(meshDripTrayId) !== "generic-v3:generic-product", true);
});
