import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  graphNodeForSelection,
  resolveRecordInspectorContext,
  resolveRecordInspectorTarget,
  resolveSelectedGraphEdge,
} from "./src/thread/tool-inspector-model.ts";
import type { ThreadGraphNode, ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

Deno.test("generic inspector resolves the exact graph record without a provider facet", () => {
  const node = graphNode("action", "ACT-INSPECT");

  const context = resolveRecordInspectorContext(GENERIC_THREAD_FIXTURE, {
    node,
    record: node.selection,
  });

  assertEquals(context.target, { kind: "action", id: "ACT-INSPECT" });
  assertEquals(context.record?.ref, { kind: "action", id: "ACT-INSPECT" });
  assertEquals(context.record?.value.id, "ACT-INSPECT");
  assertEquals(
    context.relatedRecords.some((record) => record.ref.id === "OBS-STRESS-MAX"),
    true,
  );
  assertEquals(Object.keys(context).sort(), [
    "node",
    "record",
    "relatedRecords",
    "relations",
    "target",
  ]);
});

Deno.test("graph-only selection exposes only its exact incident relations and loaded records", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const node: ThreadGraphNode = {
    id: "graph:consumption:consume-step",
    ref: { kind: "consumption", id: "consume-step" },
    entityKind: "consumption",
    label: "Recorded consumption",
    system: "recorded-system",
    freshness: "fresh",
    summary: "recorded input and output",
  };
  snapshot.graph.nodes.push(node);
  snapshot.graph.edges.push(
    {
      id: "step-to-consumption",
      from: { kind: "artifact", id: "ART-STEP-018" },
      to: node.ref,
      relation: "uses",
      rationale: "Recorded input relation.",
      origin: "provenance",
    },
    {
      id: "consumption-to-result",
      from: node.ref,
      to: { kind: "artifact", id: "ART-FEA-018" },
      relation: "evidences",
      rationale: "Recorded output relation.",
      origin: "provenance",
    },
  );

  const context = resolveRecordInspectorContext(snapshot, { node });
  const routed = resolveRecordInspectorTarget(
    snapshot,
    { kind: "node", ref: node.ref },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(context.record, undefined);
  assertEquals(
    context.relations.map((relation) => ({
      direction: relation.direction,
      peer: relation.peerRef,
    })),
    [
      {
        direction: "incoming",
        peer: { kind: "artifact", id: "ART-STEP-018" },
      },
      {
        direction: "outgoing",
        peer: { kind: "artifact", id: "ART-FEA-018" },
      },
    ],
  );
  assertEquals(
    context.relatedRecords.map((record) => record.ref),
    [
      { kind: "artifact", id: "ART-STEP-018" },
      { kind: "artifact", id: "ART-FEA-018" },
    ],
  );
  assertEquals(routed.node?.ref, node.ref);
  assertEquals(routed.record, undefined);
});

Deno.test("record-only selection keeps its exact stored record", () => {
  const context = resolveRecordInspectorContext(GENERIC_THREAD_FIXTURE, {
    record: { kind: "requirement", id: "REQ-MECH-014" },
  });

  assertEquals(context.target, {
    kind: "requirement",
    id: "REQ-MECH-014",
  });
  assertEquals(context.record?.ref, {
    kind: "requirement",
    id: "REQ-MECH-014",
  });
  assertEquals(context.record?.value.id, "REQ-MECH-014");
});

Deno.test("edge routing never leaks the previous record into the node inspector", () => {
  const target = resolveRecordInspectorTarget(
    GENERIC_THREAD_FIXTURE,
    { kind: "edge", id: "fixture:input:step:fea" },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(target, {});
});

Deno.test("edge occurrence selection preserves the exact duplicate relation", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const first = {
    id: "duplicate-relation",
    from: { kind: "artifact" as const, id: "ART-CAD-018" },
    to: { kind: "artifact" as const, id: "ART-STEP-018" },
    relation: "derived_from" as const,
    rationale: "first recorded relation",
    origin: "provenance" as const,
  };
  const second = {
    ...first,
    to: { kind: "artifact" as const, id: "ART-FEA-018" },
    rationale: "second recorded relation",
  };
  snapshot.graph.edges.push(first, second);

  assertEquals(
    resolveSelectedGraphEdge(snapshot.graph, {
      kind: "edge",
      id: "duplicate-relation",
      occurrence: { key: "second-rendered-occurrence", edge: second },
    }),
    second,
  );
  assertEquals(
    resolveSelectedGraphEdge(snapshot.graph, {
      kind: "edge",
      id: "duplicate-relation",
    }),
    undefined,
  );
});

Deno.test("record selection prefers the exact graph ref over a selection alias", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const artifactRef = { kind: "artifact" as const, id: "ART-CAD-018" };
  snapshot.graph.nodes.push({
    id: "graph:alias:one",
    ref: { kind: "part-definition", id: "alias-one" },
    entityKind: "part-definition",
    label: "Alias one",
    system: "recorded-system",
    freshness: "fresh",
    summary: "selection alias",
    selection: artifactRef,
  });

  const result = graphNodeForSelection(snapshot, artifactRef);

  assertEquals(result?.ref, artifactRef);
});

Deno.test("native record inspector contains no domain facets or execution path", async () => {
  const model = await Deno.readTextFile(
    new URL("./src/thread/tool-inspector-model.ts", import.meta.url),
  );
  const view = await Deno.readTextFile(
    new URL("./src/thread/tool-inspectors.tsx", import.meta.url),
  );
  const combined = `${model}\n${view}`;
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  for (
    const forbidden of [
      "TOOL_FACETS",
      "resolveToolFacet",
      "contextMetrics",
      "SysON",
      "build123d",
      "CalculiX",
      "Modelica",
      "SPICE",
      "ERPNext",
      "producedBy",
      "callTool(",
    ]
  ) {
    assertEquals(combined.includes(forbidden), false, forbidden);
  }
  for (
    const forbidden of [
      "SelectionInspector",
      "ArtifactInspector",
      "ObservationInspector",
      "RequirementInspector",
      "ViolationInspector",
      "ActionList",
      "RelationLinks",
    ]
  ) {
    assertEquals(workbench.includes(forbidden), false, forbidden);
  }
});

function graphNode(
  kind: ThreadGraphNode["ref"]["kind"],
  id: string,
): ThreadGraphNode {
  const node = GENERIC_THREAD_FIXTURE.graph.nodes.find((candidate) =>
    candidate.ref.kind === kind && candidate.ref.id === id
  );
  if (!node) throw new Error(`fixture graph node ${kind}:${id} not found`);
  return node;
}
