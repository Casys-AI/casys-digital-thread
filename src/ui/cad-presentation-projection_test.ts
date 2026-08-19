import { assertEquals } from "@std/assert";
import {
  cadPresentationSiblingOf,
  compactCadPresentationPairs,
  isUiOnlyCadPresentationEdge,
} from "./src/cad/cad-presentation-projection.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

function ref(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
): ThreadGraphRef {
  return { id, kind };
}

function artifact(
  id: string,
  artifactKind: ThreadGraphNode["artifactKind"],
  label: string,
): ThreadGraphNode {
  return {
    id,
    ref: ref(id),
    entityKind: "artifact",
    artifactKind,
    label,
    system: "build123d-sandbox",
    freshness: "fresh",
    summary: `${artifactKind} · ${id}`,
  };
}

function partDef(id: string, label: string): ThreadGraphNode {
  return {
    id,
    ref: ref(id, "part-definition"),
    entityKind: "part-definition",
    label,
    system: "syson",
    freshness: "fresh",
    summary: label,
  };
}

function structure(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation,
    rationale: id,
    origin: "structure",
  };
}

function armFixture() {
  const definition = partDef("arm-def", "Arm");
  const step = artifact("arm-step", "step", "Authoritative STEP: Arm");
  const preview = artifact("arm-glb", "cad-model", "GLTF: Arm");
  const nodes = [definition, step, preview];
  const edges = [
    structure("arm-step", definition.ref, step.ref, "represented_by"),
    structure("arm-glb", definition.ref, preview.ref, "represented_by"),
  ];
  return { definition, step, preview, nodes, edges };
}

Deno.test("catalog STEP + GLB collapse onto the authoritative STEP", () => {
  const fixture = armFixture();
  const projected = compactCadPresentationPairs(fixture, fixture);

  assertEquals(projected.collapsedPairCount, 1);
  assertEquals(
    projected.nodes.map((node) => [node.ref.id, node.label]),
    [
      ["arm-def", "Arm"],
      ["arm-step", "Authoritative STEP: Arm"],
    ],
  );
  assertEquals(
    projected.nodes.find((node) => node.ref.id === "arm-step")?.summary,
    "Authoritative STEP: Arm plus GLB presentation · 2 exact artifact identities",
  );
  assertEquals(
    projected.edges.filter((edge) => edge.relation === "represented_by").length,
    1,
  );
});

Deno.test("a second preview on the same PartDefinition fails open", () => {
  const fixture = armFixture();
  const extra = artifact("arm-glb-2", "cad-model", "GLTF: Arm extra");
  const graph = {
    nodes: [...fixture.nodes, extra],
    edges: [
      ...fixture.edges,
      structure(
        "arm-glb-2",
        fixture.definition.ref,
        extra.ref,
        "represented_by",
      ),
    ],
  };
  const projected = compactCadPresentationPairs(graph, graph);
  assertEquals(projected.collapsedPairCount, 0);
  assertEquals(projected.nodes.length, 4);
});

Deno.test("cadPresentationSiblingOf names the other recorded encoding", () => {
  const fixture = armFixture();
  assertEquals(
    cadPresentationSiblingOf(fixture, fixture.preview.ref)?.id,
    "arm-step",
  );
  assertEquals(
    cadPresentationSiblingOf(fixture, fixture.step.ref)?.id,
    "arm-glb",
  );
  assertEquals(
    cadPresentationSiblingOf(fixture, fixture.definition.ref),
    undefined,
  );
});

Deno.test("focusing the GLB expands the exact pair", () => {
  const fixture = armFixture();
  const projected = compactCadPresentationPairs(
    fixture,
    fixture,
    fixture.preview.ref,
  );
  assertEquals(projected.collapsedPairCount, 0);
  assertEquals(projected.nodes.map((node) => node.ref.id).sort(), [
    "arm-def",
    "arm-glb",
    "arm-step",
  ]);
});

Deno.test("assembly leftover pairs only when the STEP has no catalog preview", () => {
  const root = partDef("system", "HeronLampSystem");
  const arm = partDef("arm-def", "Arm");
  const geometry = artifact(
    "geometry",
    "cad-model",
    "Geometry bundle",
  );
  geometry.system = "digital-thread";
  const assemblyStep = artifact("assembly-step", "step", "Assembly STEP");
  const assemblyGlb = artifact("assembly-glb", "cad-model", "Assembly GLTF");
  const armStep = artifact("arm-step", "step", "Authoritative STEP: Arm");
  const armGlb = artifact("arm-glb", "cad-model", "GLTF: Arm");
  const nodes = [
    root,
    arm,
    geometry,
    assemblyStep,
    assemblyGlb,
    armStep,
    armGlb,
  ];
  const edges = [
    structure("root-step", root.ref, assemblyStep.ref, "represented_by"),
    structure("arm-step", arm.ref, armStep.ref, "represented_by"),
    structure("arm-glb", arm.ref, armGlb.ref, "represented_by"),
    structure("g-as", geometry.ref, assemblyStep.ref, "traces_to"),
    structure("g-ag", geometry.ref, assemblyGlb.ref, "traces_to"),
    structure("g-arm-s", geometry.ref, armStep.ref, "traces_to"),
    structure("g-arm-g", geometry.ref, armGlb.ref, "traces_to"),
  ];
  const projected = compactCadPresentationPairs({ nodes, edges }, {
    nodes,
    edges,
  });
  assertEquals(projected.collapsedPairCount, 2);
  assertEquals(
    projected.nodes.map((node) => node.ref.id).sort(),
    ["arm-def", "arm-step", "assembly-step", "geometry", "system"],
  );
});

Deno.test("leftover pairing refuses a part STEP and an orphan GLB", () => {
  const arm = partDef("arm-def", "Arm");
  const geometry = artifact("geometry", "cad-model", "Geometry bundle");
  geometry.system = "digital-thread";
  const armStep = artifact("arm-step", "step", "Authoritative STEP: Arm");
  const armGlb = artifact("arm-glb", "cad-model", "GLTF: Arm");
  const orphanGlb = artifact("assembly-glb", "cad-model", "Assembly GLTF");
  const nodes = [arm, geometry, armStep, armGlb, orphanGlb];
  const edges = [
    structure("arm-step", arm.ref, armStep.ref, "represented_by"),
    structure("arm-glb", arm.ref, armGlb.ref, "represented_by"),
    structure("g-arm-s", geometry.ref, armStep.ref, "traces_to"),
    structure("g-orphan", geometry.ref, orphanGlb.ref, "traces_to"),
  ];
  const visible = {
    nodes: [arm, geometry, armStep, orphanGlb],
    edges: edges.filter((edge) =>
      edge.to.id !== "arm-glb" && edge.from.id !== "arm-glb"
    ),
  };
  const projected = compactCadPresentationPairs({ nodes, edges }, visible);
  assertEquals(projected.collapsedPairCount, 0);
  assertEquals(projected.nodes.map((node) => node.ref.id).sort(), [
    "arm-def",
    "arm-step",
    "assembly-glb",
    "geometry",
  ]);
});

Deno.test("remapped CAD routes are UI-owned and do not keep the recorded id", () => {
  const fixture = armFixture();
  const extra = artifact("proof", "document", "FEA proof");
  extra.system = "digital-thread";
  const graph = {
    nodes: [...fixture.nodes, extra],
    edges: [
      ...fixture.edges,
      {
        id: "glb-proof",
        from: fixture.preview.ref,
        to: extra.ref,
        relation: "derived_from" as const,
        rationale: "preview consumed",
        origin: "provenance" as const,
      },
    ],
  };
  const projected = compactCadPresentationPairs(graph, graph);
  const remapped = projected.edges.find((edge) =>
    edge.from.id === "arm-step" && edge.to.id === "proof"
  );
  assertEquals(remapped !== undefined, true);
  assertEquals(isUiOnlyCadPresentationEdge(remapped!), true);
  assertEquals(remapped!.id.includes("glb-proof"), true);
});
