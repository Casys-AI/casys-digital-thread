import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  compactSysmlPartPairs,
  graphRefKey,
  isUiOnlySysmlCompositeEdge,
} from "./src/architecture/sysml-composite-projection.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

Deno.test("one unambiguous usage renders as a definition-backed composite while the root stays exact", () => {
  const fixture = singleUsageFixture();
  const projected = compactSysmlPartPairs(fixture, fixture);

  assertEquals(
    projected.nodes.map((node) => [graphRefKey(node.ref), node.label]),
    [
      ["part-definition:def-root", "DeskLamp"],
      ["part-definition:def-stem", "stem : FixedStem"],
      ["artifact:step-stem", "FixedStem STEP"],
    ],
  );
  assertEquals(projected.collapsedPairCount, 1);
  assertEquals(
    projected.nodes.find((node) => node.ref.id === "def-stem")?.summary,
    "PartUsage stem typed by PartDefinition FixedStem · 2 exact SysML identities",
  );
  assertEquals(
    projected.edges.some((edge) => edge.relation === "typed_by"),
    false,
  );
  assertEquals(
    graphRefKey(
      projected.compositeRefByMemberRefKey.get("part-usage:usage-stem")!,
    ),
    "part-definition:def-stem",
  );
});

Deno.test("compact usage keeps AttributeUsage nodes on the owning PartDefinition", () => {
  const fixture = singleUsageFixture();
  const thickness = node("attribute-usage", "attr-thickness", "thickness");
  fixture.nodes.push(thickness);
  fixture.edges.push(
    edge("contains-thickness", fixture.nodes[2]!.ref, thickness.ref, "contains"),
  );
  const projected = compactSysmlPartPairs(fixture, fixture);

  assertEquals(
    projected.nodes.map((node) => [graphRefKey(node.ref), node.label]),
    [
      ["part-definition:def-root", "DeskLamp"],
      ["part-definition:def-stem", "stem : FixedStem"],
      ["artifact:step-stem", "FixedStem STEP"],
      ["attribute-usage:attr-thickness", "thickness"],
    ],
  );
  const ownership = projected.edges.find((edge) => edge.to.kind === "attribute-usage");
  assertEquals(ownership?.from, {
    kind: "part-definition",
    id: "def-stem",
  });
  assertEquals(ownership?.to, {
    kind: "attribute-usage",
    id: "attr-thickness",
  });
  assertEquals(ownership?.relation, "contains");
});

Deno.test("compact usage keeps a parameterizes CAD lever on the AttributeUsage", () => {
  const fixture = singleUsageFixture();
  const thickness = node("attribute-usage", "attr-thickness", "WallHook · thickness");
  const lever = node(
    "cad-lever",
    "admission:parameter.thickness",
    "CAD · thickness = 8",
  );
  fixture.nodes.push(thickness, lever);
  fixture.edges.push(
    edge("contains-thickness", fixture.nodes[2]!.ref, thickness.ref, "contains"),
    edge("parameterizes-thickness", lever.ref, thickness.ref, "parameterizes"),
  );
  const projected = compactSysmlPartPairs(fixture, fixture);
  const ownership = projected.edges.find((item) => item.relation === "parameterizes");
  assertEquals(ownership?.from, lever.ref);
  assertEquals(ownership?.to, thickness.ref);
});

Deno.test("a shared PartDefinition keeps both usages and their exact family links visible", () => {
  const fixture = reusedDefinitionFixture();
  const projected = compactSysmlPartPairs(fixture, fixture);

  assertEquals(projected.collapsedPairCount, 0);
  assertEquals(
    projected.nodes.map((node) => graphRefKey(node.ref)),
    [
      "part-definition:def-root",
      "part-usage:usage-stem-left",
      "part-usage:usage-stem-right",
      "part-definition:def-stem",
    ],
  );
  assertEquals(
    projected.edges.filter((edge) => edge.relation === "typed_by").length,
    2,
  );
  assertEquals(
    projected.edges.every((edge) => !isUiOnlySysmlCompositeEdge(edge)),
    true,
  );
});

Deno.test("definition CAD evidence stays canonical and only the remapped containment route is UI-owned", () => {
  const fixture = singleUsageFixture();
  const representedBy = fixture.edges.find((edge) =>
    edge.relation === "represented_by"
  )!;
  const projected = compactSysmlPartPairs(fixture, fixture);
  const projectedCad = projected.edges.find((edge) =>
    edge.relation === "represented_by"
  )!;
  const compactContainment = projected.edges.find((edge) =>
    edge.relation === "contains" &&
    edge.to.id === "def-stem"
  )!;

  assertStrictEquals(projectedCad, representedBy);
  assertEquals(projectedCad.from, {
    kind: "part-definition",
    id: "def-stem",
  });
  assertEquals(isUiOnlySysmlCompositeEdge(projectedCad), false);
  assertEquals(isUiOnlySysmlCompositeEdge(compactContainment), true);
  assertEquals(
    compactContainment.rationale.includes("recorded relation contains-stem"),
    true,
  );
});

Deno.test("composite refs and UI edge ids are deterministic across input ordering", () => {
  const fixture = singleUsageFixture();
  const forward = compactSysmlPartPairs(fixture, fixture);
  const reversed = compactSysmlPartPairs(
    {
      nodes: [...fixture.nodes].reverse(),
      edges: [...fixture.edges].reverse(),
    },
    {
      nodes: [...fixture.nodes].reverse(),
      edges: [...fixture.edges].reverse(),
    },
  );
  const signature = (projection: typeof forward) => ({
    nodeRefs: projection.nodes.map((node) => graphRefKey(node.ref)).sort(),
    edgeIds: projection.edges.map((edge) => edge.id).sort(),
    usageTarget: graphRefKey(
      projection.compositeRefByMemberRefKey.get("part-usage:usage-stem")!,
    ),
  });

  assertEquals(signature(reversed), signature(forward));
});

Deno.test("focusing either composite member restores both exact identities and typed_by selection", () => {
  const fixture = singleUsageFixture();
  for (
    const focus of [
      ref("part-usage", "usage-stem"),
      ref("part-definition", "def-stem"),
    ] as const
  ) {
    const projected = compactSysmlPartPairs(fixture, fixture, focus);
    assertEquals(projected.collapsedPairCount, 0);
    assertEquals(
      projected.nodes.some((node) =>
        node.ref.kind === focus.kind &&
        node.ref.id === focus.id
      ),
      true,
    );
    assertStrictEquals(
      projected.edges.find((edge) => edge.relation === "typed_by"),
      fixture.edges.find((edge) => edge.relation === "typed_by"),
    );
  }
});

Deno.test("mismatched freshness or inspector selection fails open", () => {
  const fixture = singleUsageFixture();
  const usage = fixture.nodes.find((node) => node.entityKind === "part-usage")!;
  for (
    const mismatch of [
      { ...usage, freshness: "stale" as const },
      {
        ...usage,
        selection: { kind: "artifact" as const, id: "other-model" },
      },
    ]
  ) {
    const nodes = fixture.nodes.map((node) => node === usage ? mismatch : node);
    const projected = compactSysmlPartPairs(
      { nodes, edges: fixture.edges },
      { nodes, edges: fixture.edges },
    );
    assertEquals(projected.collapsedPairCount, 0);
  }
});

Deno.test("a provenance-origin typed_by lookalike never collapses SysML identities", () => {
  const fixture = singleUsageFixture();
  const edges = fixture.edges.map((candidate) =>
    candidate.relation === "typed_by"
      ? { ...candidate, origin: "provenance" as const }
      : candidate
  );
  const projected = compactSysmlPartPairs(
    { nodes: fixture.nodes, edges },
    { nodes: fixture.nodes, edges },
  );

  assertEquals(projected.collapsedPairCount, 0);
  assertEquals(projected.nodes.length, fixture.nodes.length);
});

function singleUsageFixture(): {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
} {
  const root = node("part-definition", "def-root", "DeskLamp");
  const usage = node("part-usage", "usage-stem", "stem");
  const definition = node("part-definition", "def-stem", "FixedStem");
  const step = node("artifact", "step-stem", "FixedStem STEP", "build123d");
  return {
    nodes: [root, usage, definition, step],
    edges: [
      edge("contains-stem", root.ref, usage.ref, "contains"),
      edge("typed-stem", usage.ref, definition.ref, "typed_by"),
      edge("represented-stem", definition.ref, step.ref, "represented_by"),
    ],
  };
}

function reusedDefinitionFixture(): {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
} {
  const root = node("part-definition", "def-root", "DeskLamp");
  const left = node("part-usage", "usage-stem-left", "leftStem");
  const right = node("part-usage", "usage-stem-right", "rightStem");
  const definition = node("part-definition", "def-stem", "FixedStem");
  return {
    nodes: [root, left, right, definition],
    edges: [
      edge("contains-left", root.ref, left.ref, "contains"),
      edge("contains-right", root.ref, right.ref, "contains"),
      edge("typed-left", left.ref, definition.ref, "typed_by"),
      edge("typed-right", right.ref, definition.ref, "typed_by"),
    ],
  };
}

function node(
  kind: ThreadGraphRef["kind"],
  id: string,
  label: string,
  system = "syson",
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: ref(kind, id),
    entityKind: kind,
    ...(kind === "artifact" ? { artifactKind: "step" } : {}),
    label,
    system,
    freshness: "fresh",
    summary: `${kind} · ${id}`,
    recordedAt: "2026-08-10T00:00:00.000Z",
    selection: { kind: "artifact", id: "architecture" },
  };
}

function edge(
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

function ref(
  kind: ThreadGraphRef["kind"],
  id: string,
): ThreadGraphRef {
  return { kind, id };
}
