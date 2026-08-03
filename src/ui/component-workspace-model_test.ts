import { assertEquals } from "@std/assert";
import {
  cadSurfaceCoverage,
  correctionNodesForComponent,
  resolveCadSurface,
} from "./src/thread/component-workspace-model.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import type { ThreadArtifact, ThreadComponent } from "./src/thread/types.ts";

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
