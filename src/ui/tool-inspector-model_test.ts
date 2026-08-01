import { assertEquals } from "@std/assert";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import {
  resolveToolInspectorContext,
  resolveToolInspectorTarget,
} from "./src/thread/tool-inspector-model.ts";
import type {
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("graph action keeps its own provider while exposing its richer record", () => {
  const node = graphNode("action", "ACT-INSPECT");

  const context = resolveToolInspectorContext(COFFEE_MACHINE_THREAD_FIXTURE, {
    node,
    record: node.selection,
  });

  assertEquals(context.target, { kind: "action", id: "ACT-INSPECT" });
  assertEquals(context.owner.id, "calculix");
  assertEquals(
    context.actions.some((action) => action.id === "ACT-INSPECT"),
    true,
  );
  assertEquals(
    context.observations.some((item) => item.id === "OBS-STRESS-MAX"),
    true,
  );
});

Deno.test("graph-only consumption derives context from recorded neighbours", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    COFFEE_MACHINE_THREAD_FIXTURE,
  );
  const node: ThreadGraphNode = {
    id: "graph:consumption:consume-step",
    ref: { kind: "consumption", id: "consume-step" },
    entityKind: "consumption",
    label: "CalculiX consumed STEP",
    system: "CalculiX",
    freshness: "fresh",
    summary: "producer and consumer fingerprints match",
  };
  snapshot.graph.nodes.push(node);
  snapshot.graph.edges.push(
    {
      id: "step-to-consumption",
      from: { kind: "artifact", id: "ART-STEP-018" },
      to: node.ref,
      relation: "uses",
      rationale: "The solve consumed this exact STEP artifact.",
      origin: "provenance",
    },
    {
      id: "consumption-to-fea",
      from: node.ref,
      to: { kind: "artifact", id: "ART-FEA-018" },
      relation: "evidences",
      rationale: "The consumption attests the solve result input.",
      origin: "provenance",
    },
  );

  const context = resolveToolInspectorContext(snapshot, { node });
  const routed = resolveToolInspectorTarget(
    snapshot,
    { kind: "node", ref: node.ref },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(context.owner.id, "calculix");
  assertEquals(context.target, node.ref);
  assertEquals(context.artifacts.map((artifact) => artifact.id).sort(), [
    "ART-FEA-018",
    "ART-STEP-018",
  ]);
  assertEquals(routed.node?.ref, node.ref);
  assertEquals(routed.record, undefined);
});

Deno.test("graph node system owns model records without relying on flow aliases", () => {
  const node = graphNode("requirement", "REQ-MECH-014");

  const context = resolveToolInspectorContext(COFFEE_MACHINE_THREAD_FIXTURE, {
    node,
    record: node.selection,
  });

  assertEquals(context.owner.id, "syson");
  assertEquals(context.requirements.map((item) => item.id), ["REQ-MECH-014"]);
});

Deno.test("edge routing does not leak the previous record into its handoff panel", () => {
  const target = resolveToolInspectorTarget(
    COFFEE_MACHINE_THREAD_FIXTURE,
    { kind: "edge", id: "fixture:input:step:fea" },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(target, {});
});

function graphNode(
  kind: ThreadGraphNode["ref"]["kind"],
  id: string,
): ThreadGraphNode {
  const node = COFFEE_MACHINE_THREAD_FIXTURE.graph.nodes.find((candidate) =>
    candidate.ref.kind === kind && candidate.ref.id === id
  );
  if (!node) throw new Error(`fixture graph node ${kind}:${id} not found`);
  return node;
}
