import { assertEquals } from "@std/assert";
import { buildCatalogArtifactAnchorMap } from "./src/thread/product-anchor-model.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import type { ThreadComponent, ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

function snapshotWith(
  components: ThreadComponent[],
): ThreadWorkbenchSnapshot {
  const base = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  base.components.components = components;
  return base;
}

const CAPTURE_DIGEST = "c".repeat(64);
const R3_PREFIX = `coffee-machine-cm01-v3-cad-r3-${CAPTURE_DIGEST}`;

// ── tests ─────────────────────────────────────────────────────────────────────

Deno.test("buildCatalogArtifactAnchorMap returns empty map for empty catalog", () => {
  const snapshot = snapshotWith([]);
  const anchor = buildCatalogArtifactAnchorMap(snapshot);
  assertEquals(anchor.size, 0);
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 assembly STEP to assembly component", () => {
  const stepId = `${R3_PREFIX}-step`;
  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "syson",
        kind: "part-definition",
        id: "sysml-coffee-machine",
        label: "CoffeeMachine",
        evidenceArtifactId: "arch-001",
        status: "verified",
      },
      {
        provider: "build123d",
        kind: "artifact",
        id: stepId,
        label: "CM-01 30 mm DripTray assembly STEP export",
        evidenceArtifactId: stepId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(snapshotWith([assembly]));

  // The STEP artifact is anchored to the assembly component
  assertEquals(anchor.get(stepId), "cm01-v3:coffee-machine");
  // The architecture artifact is also anchored via its own binding
  assertEquals(anchor.get("arch-001"), "cm01-v3:coffee-machine");
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 drip-tray mesh to the drip-tray part", () => {
  const meshId = `${R3_PREFIX}-mesh-drip-tray`;
  const stepId = `${R3_PREFIX}-step`;

  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "build123d",
        kind: "artifact",
        id: stepId,
        label: "CM-01 assembly STEP",
        evidenceArtifactId: stepId,
        status: "verified",
      },
    ],
  };
  const dripTray: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "cm01-v3:coffee-machine",
    bindings: [
      {
        provider: "build123d",
        kind: "artifact",
        id: meshId,
        label: "CM-01 drip-tray presentation STL",
        evidenceArtifactId: meshId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(
    snapshotWith([assembly, dripTray]),
  );

  // Assembly STEP → assembly component
  assertEquals(anchor.get(stepId), "cm01-v3:coffee-machine");

  // Drip-tray mesh → drip-tray part, NOT assembly
  assertEquals(anchor.get(meshId), "cm01-v3:drip-tray");
  assertEquals(anchor.get(stepId) !== "cm01-v3:drip-tray", true);
});

Deno.test("buildCatalogArtifactAnchorMap anchors @3 plan and script to assembly via digital-thread provider", () => {
  const planId = `${R3_PREFIX}-plan`;
  const scriptId = `${R3_PREFIX}-script`;

  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [
      {
        provider: "digital-thread",
        kind: "artifact",
        id: planId,
        label: "CM-01 30 mm DripTray semantic CAD plan",
        evidenceArtifactId: planId,
        status: "verified",
      },
      {
        provider: "digital-thread",
        kind: "artifact",
        id: scriptId,
        label: "CM-01 30 mm DripTray deterministic build123d script",
        evidenceArtifactId: scriptId,
        status: "verified",
      },
    ],
  };

  const anchor = buildCatalogArtifactAnchorMap(snapshotWith([assembly]));

  assertEquals(anchor.get(planId), "cm01-v3:coffee-machine");
  assertEquals(anchor.get(scriptId), "cm01-v3:coffee-machine");
});

Deno.test("buildCatalogArtifactAnchorMap never anchors a drip-tray mesh to the assembly", () => {
  const meshDripTrayId = `${R3_PREFIX}-mesh-drip-tray`;
  const meshAssemblyId = `${R3_PREFIX}-mesh-assembly`;

  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshAssemblyId,
      label: "CM-01 assembly presentation STL",
      evidenceArtifactId: meshAssemblyId,
      status: "verified",
    }],
  };
  const dripTray: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "cm01-v3:coffee-machine",
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshDripTrayId,
      label: "CM-01 drip-tray presentation STL",
      evidenceArtifactId: meshDripTrayId,
      status: "verified",
    }],
  };

  const anchor = buildCatalogArtifactAnchorMap(
    snapshotWith([assembly, dripTray]),
  );

  assertEquals(anchor.get(meshAssemblyId), "cm01-v3:coffee-machine");
  assertEquals(anchor.get(meshDripTrayId), "cm01-v3:drip-tray");
  // Explicit check: drip-tray mesh must NOT be anchored to assembly
  assertEquals(anchor.get(meshDripTrayId) !== "cm01-v3:coffee-machine", true);
});
