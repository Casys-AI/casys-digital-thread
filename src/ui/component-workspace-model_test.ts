import { assertEquals } from "@std/assert";
import {
  buildSysmlSubtree,
  cadSurfaceCoverage,
  correctionNodesForComponent,
  resolveCadMeshStatus,
  resolveCadSurface,
} from "./src/thread/component-workspace-model.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("global CAD resolves by exact URI and preview hash without linking children", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const root: ThreadComponent = {
    id: "cm01",
    label: "CoffeeMachine CM-01",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "/exports/coffee-machine.step",
      label: "CM-01 STEP assembly",
      evidenceArtifactId: "superseded-run-step",
      status: "unverified",
      reason: "The declared evidence artifact is absent from this revision.",
    }],
    preview: {
      provider: "build123d",
      artifactId: "superseded-run-stl",
      mediaType: "model/stl",
      url: "/api/thread/assets/coffee-machine.stl",
      sha256: "b".repeat(64),
    },
  };
  const child: ThreadComponent = {
    id: "boiler",
    parentId: root.id,
    label: "Boiler",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "assembly-child",
      id: "boiler",
      label: "build123d child boiler",
      evidenceArtifactId: "current-step",
      status: "verified",
      selection: { kind: "artifact", id: "current-step" },
    }],
  };
  snapshot.components.components = [root, child];
  snapshot.artifacts.push(
    artifact("current-step", "step", "/exports/coffee-machine.step", "a"),
    artifact("current-stl", "mesh", "/exports/coffee-machine.stl", "b"),
  );

  const surface = resolveCadSurface(snapshot, root);

  assertEquals(surface?.scope, "assembly");
  assertEquals(surface?.authoritativeArtifact.id, "current-step");
  assertEquals(surface?.preview?.artifactId, "current-stl");
  assertEquals(surface?.inspectionBinding.selection, {
    kind: "artifact",
    id: "current-step",
  });
  assertEquals(resolveCadSurface(snapshot, child), undefined);
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 1,
    partSurfaces: 0,
    totalComponents: 2,
  });
});

Deno.test("global CAD does not resolve from a label or a foreign provider", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const root: ThreadComponent = {
    id: "cm01",
    label: "CoffeeMachine CM-01",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "/exports/expected.step",
      label: "Same friendly label",
      evidenceArtifactId: "missing",
      status: "unverified",
    }],
  };
  snapshot.components.components = [root];
  snapshot.artifacts.push({
    ...artifact("foreign-step", "step", "/exports/expected.step", "c"),
    system: "other-cad",
    label: "Same friendly label",
  });

  assertEquals(resolveCadSurface(snapshot, root), undefined);
});

Deno.test("component revisions require an explicit catalog anchor", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const dripTray: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [dripTray];
  snapshot.graph.nodes.push({
    id: "graph:change:drip-tray-height",
    ref: { kind: "change", id: "drip-tray-height" },
    entityKind: "change",
    label: "Raise DripTray to 30 mm",
    system: "digital-thread",
    freshness: "fresh",
    summary: "recorded correction",
    recordedAt: "2026-08-03T12:00:00.000Z",
    affectedComponentId: dripTray.id,
  }, {
    id: "graph:change:unanchored",
    ref: { kind: "change", id: "unanchored" },
    entityKind: "change",
    label: "Unanchored correction",
    system: "digital-thread",
    freshness: "fresh",
    summary: "recorded correction",
    recordedAt: "2026-08-03T12:01:00.000Z",
  });

  assertEquals(
    correctionNodesForComponent(snapshot, dripTray).map((node) => node.ref.id),
    ["drip-tray-height"],
  );
});

// ── @3 per-part mesh resolution ───────────────────────────────────────────────

Deno.test("per-part mesh binding resolves via resolveCadSurface as a part surface with preview", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const meshArtifactId = "coffee-machine-cm01-v3-cad-r3-" + "a".repeat(64) +
    "-mesh-drip-tray";
  const meshArtifact: ThreadArtifact = {
    id: meshArtifactId,
    label: "CM-01 30 mm drip-tray presentation STL",
    kind: "mesh",
    system: "build123d",
    revision: "a".repeat(64),
    freshness: "fresh",
    fingerprint: "sha256:" + "a".repeat(64),
    uri: "cm01-semantic-cad-r3-capture://test#coffee-machine-cm01-v3-r3-drip-tray.stl",
    producedBy: "build123d_export",
    dependsOn: [],
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
      id: meshArtifactId,
      label: "CM-01 30 mm drip-tray presentation STL",
      evidenceArtifactId: meshArtifactId,
      status: "verified",
      selection: { kind: "artifact", id: meshArtifactId },
    }],
    preview: {
      provider: "build123d",
      artifactId: meshArtifactId,
      mediaType: "model/stl",
      url: "/api/thread/assets/coffee-machine-cm01-v3-r3-drip-tray.stl",
      sha256: "a".repeat(64),
    },
  };
  snapshot.components.components = [dripTray];
  snapshot.artifacts.push(meshArtifact);

  const surface = resolveCadSurface(snapshot, dripTray);
  assertEquals(surface?.scope, "part");
  assertEquals(surface?.authoritativeArtifact.id, meshArtifactId);
  assertEquals(surface?.preview?.artifactId, meshArtifactId);
  assertEquals(surface?.preview?.url, dripTray.preview!.url);
});

Deno.test("resolveCadMeshStatus distinguishes preview-ready from not-exported from no-binding", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  const meshArtifactId = "coffee-machine-cm01-v3-cad-r3-" + "b".repeat(64) +
    "-mesh-drip-tray";
  const meshArtifact: ThreadArtifact = {
    id: meshArtifactId,
    label: "CM-01 30 mm drip-tray presentation STL",
    kind: "mesh",
    system: "build123d",
    revision: "b".repeat(64),
    freshness: "fresh",
    fingerprint: "sha256:" + "b".repeat(64),
    uri: "cm01-semantic-cad-r3-capture://test#coffee-machine-cm01-v3-r3-drip-tray.stl",
    producedBy: "build123d_export",
    dependsOn: [],
  };

  // Component with build123d artifact binding AND a valid preview — ready
  const partWithPreview: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshArtifactId,
      label: "mesh",
      evidenceArtifactId: meshArtifactId,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: meshArtifactId,
      mediaType: "model/stl",
      url: "/api/thread/assets/coffee-machine-cm01-v3-r3-drip-tray.stl",
      sha256: "b".repeat(64),
    },
  };

  // Component with binding but no preview (operation not yet run)
  const partWithBinding: ThreadComponent = {
    id: "cm01-v3:boiler",
    label: "Boiler",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "boiler-step",
      label: "Boiler STEP",
      evidenceArtifactId: "boiler-step",
      status: "unverified",
      reason: "Evidence artifact absent.",
    }],
  };

  // Component with no build123d binding
  const partNoBind: ThreadComponent = {
    id: "cm01-v3:enclosure",
    label: "Enclosure",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "enc-def",
      label: "Enclosure",
      evidenceArtifactId: "arch",
      status: "unverified",
    }],
  };

  snapshot.components.components = [partWithPreview, partWithBinding, partNoBind];
  snapshot.artifacts.push(meshArtifact);

  assertEquals(resolveCadMeshStatus(snapshot, partWithPreview), "preview-ready");
  assertEquals(resolveCadMeshStatus(snapshot, partWithBinding), "not-exported");
  assertEquals(resolveCadMeshStatus(snapshot, partNoBind), "no-binding");
});

// ── SysML sub-tree model ──────────────────────────────────────────────────────

Deno.test("buildSysmlSubtree returns the parent assembly as root and correct siblings for a part", () => {
  const snapshot = minimalSnapshot();
  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-coffee-machine",
      label: "CoffeeMachine",
      evidenceArtifactId: "arch",
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
      provider: "syson",
      kind: "part-definition",
      id: "sysml-drip-tray",
      label: "DripTray",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  const boiler: ThreadComponent = {
    id: "cm01-v3:boiler",
    label: "Boiler",
    kind: "part",
    quantity: 1,
    parentId: "cm01-v3:coffee-machine",
    bindings: [],
  };
  snapshot.components.components = [assembly, dripTray, boiler];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.root.id, "cm01-v3:coffee-machine");
  assertEquals(subtree.root.isCurrent, false);
  assertEquals(subtree.selected.id, "cm01-v3:drip-tray");
  assertEquals(subtree.selected.isCurrent, true);
  assertEquals(subtree.selected.elementId, "sysml-drip-tray");
  assertEquals(subtree.siblings.length, 1);
  assertEquals(subtree.siblings[0]?.id, "cm01-v3:boiler");
});

Deno.test("buildSysmlSubtree returns the assembly itself as root and selected when the assembly is selected", () => {
  const snapshot = minimalSnapshot();
  const assembly: ThreadComponent = {
    id: "cm01-v3:coffee-machine",
    label: "CoffeeMachine",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-coffee-machine",
      label: "CoffeeMachine",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [assembly];

  const subtree = buildSysmlSubtree(snapshot, assembly);

  assertEquals(subtree.root.id, "cm01-v3:coffee-machine");
  assertEquals(subtree.root.isCurrent, true);
  assertEquals(subtree.selected.id, "cm01-v3:coffee-machine");
  assertEquals(subtree.siblings.length, 0);
});

Deno.test("buildSysmlSubtree filters anchored requirements by SysON element id substring", () => {
  const snapshot = minimalSnapshot();
  const dripTray: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "cm01-v3:coffee-machine",
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-drip-tray-def",
      label: "DripTray",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [dripTray];
  snapshot.requirements = [
    {
      id: "req-displacement",
      label: "DripTray displacement",
      source: "syson · sysml-drip-tray-def",
      expression: "displacement ≤ 1 mm",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-stress",
      label: "DripTray stress",
      source: "syson · sysml-drip-tray-def",
      expression: "von_mises ≤ 150 MPa",
      status: "unresolved",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-boiler",
      label: "Boiler pressure",
      source: "syson · sysml-boiler-def",
      expression: "pressure ≤ 15 bar",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for Boiler, must not appear for DripTray.",
    },
  ];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.anchoredRequirements.length, 2);
  assertEquals(subtree.anchoredRequirements[0]?.id, "req-displacement");
  assertEquals(subtree.anchoredRequirements[1]?.id, "req-stress");
});

Deno.test("buildSysmlSubtree collects sensitivity derivative observations by canonical label pattern", () => {
  const snapshot = minimalSnapshot();
  const dripTray: ThreadComponent = {
    id: "cm01-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [dripTray];
  snapshot.observations = [
    {
      id: "obs-sensitivity-disp",
      label: "DripTray displacement sensitivity (size-z)",
      value: -0.008,
      unit: "mm/mm",
      display: "-0.008 mm/mm",
      sourceArtifactId: "fea-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
    {
      id: "obs-sensitivity-stress",
      label: "DripTray von Mises sensitivity (size-z)",
      value: -0.036,
      unit: "MPa/mm",
      display: "-0.036 MPa/mm",
      sourceArtifactId: "fea-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
    {
      id: "obs-mass",
      label: "DripTray mass",
      value: 0.042,
      unit: "kg",
      display: "42 g",
      sourceArtifactId: "cad-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
  ];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.sensitivityRecords.length, 2);
  assertEquals(
    subtree.sensitivityRecords[0]?.label,
    "DripTray displacement sensitivity (size-z)",
  );
  assertEquals(
    subtree.sensitivityRecords[1]?.label,
    "DripTray von Mises sensitivity (size-z)",
  );
  // Mass observation does not match the sensitivity label pattern
  assertEquals(
    subtree.sensitivityRecords.some((r) => r.label === "DripTray mass"),
    false,
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalSnapshot(): ThreadWorkbenchSnapshot {
  const snapshot = structuredClone(COFFEE_MACHINE_THREAD_FIXTURE);
  snapshot.components.components = [];
  snapshot.requirements = [];
  snapshot.observations = [];
  return snapshot;
}

function artifact(
  id: string,
  kind: string,
  uri: string,
  digestCharacter: string,
): ThreadArtifact {
  return {
    id,
    label: id,
    kind,
    system: "build123d",
    revision: digestCharacter.repeat(64),
    freshness: "fresh",
    fingerprint: `sha256:${digestCharacter.repeat(64)}`,
    uri,
    producedBy: "build123d_export",
    dependsOn: [],
  };
}
