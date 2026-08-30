import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  isExactOverviewGlbArtifact,
  resolveOverviewThreadViewerCapabilities,
} from "./src/project/overview-thread-viewer-model.ts";
import type { ThreadArtifact, ThreadGraphNode } from "./src/thread/types.ts";

const DIGEST = "a".repeat(64);

Deno.test("overview viewer resolver admits the exact selected fingerprint-bound GLB", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const artifact = exactGlb("exact-glb");
  const node = graphNode({ kind: "artifact", id: artifact.id });
  snapshot.artifacts.push(artifact);
  snapshot.graph.nodes.push(node);

  const capabilities = resolveOverviewThreadViewerCapabilities(snapshot, node);

  assertEquals(capabilities.inspectRecord, true);
  assertEquals(capabilities.openVerification, true);
  assertEquals(capabilities.cadAssets.map((item) => item.id), [artifact.id]);
});

Deno.test("overview viewer resolver admits only a directly recorded GLB edge", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const source = graphNode({ kind: "part-definition", id: "part:hull" });
  const intermediate = graphNode({ kind: "part-usage", id: "usage:hull" });
  const direct = exactGlb("direct-glb");
  const indirect = exactGlb("indirect-glb", "b".repeat(64));
  snapshot.artifacts.push(direct, indirect);
  snapshot.graph.nodes.push(source, intermediate);
  snapshot.graph.edges.push(
    {
      id: "edge:direct-glb",
      from: source.ref,
      to: { kind: "artifact", id: direct.id },
      relation: "represented_by",
      rationale: "Exact recorded presentation",
      origin: "structure",
    },
    {
      id: "edge:intermediate",
      from: source.ref,
      to: intermediate.ref,
      relation: "contains",
      rationale: "Structural incidence",
      origin: "structure",
    },
    {
      id: "edge:indirect-glb",
      from: intermediate.ref,
      to: { kind: "artifact", id: indirect.id },
      relation: "represented_by",
      rationale: "Not a direct edge from the selected record",
      origin: "structure",
    },
  );

  assertEquals(
    resolveOverviewThreadViewerCapabilities(snapshot, source).cadAssets.map((
      artifact,
    ) => artifact.id),
    [direct.id],
  );
});

Deno.test("overview viewer resolver rejects labels, systems and malformed GLB authority", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const source = graphNode({ kind: "part-definition", id: "part:hull" });
  const wrongKind = { ...exactGlb("wrong-kind"), kind: "mesh" };
  const mismatched = {
    ...exactGlb("mismatched"),
    fingerprint: `sha256:${"c".repeat(64)}`,
  };
  const friendlyOnly = exactGlb("friendly-only", "d".repeat(64));
  snapshot.artifacts.push(wrongKind, mismatched, friendlyOnly);
  snapshot.graph.nodes.push(source);
  snapshot.graph.edges.push(
    {
      id: "edge:wrong-kind",
      from: source.ref,
      to: { kind: "artifact", id: wrongKind.id },
      relation: "represented_by",
      rationale: "Wrong artifact contract",
      origin: "structure",
    },
    {
      id: "edge:mismatch",
      from: source.ref,
      to: { kind: "artifact", id: mismatched.id },
      relation: "represented_by",
      rationale: "Fingerprint mismatch",
      origin: "structure",
    },
  );

  assertEquals(isExactOverviewGlbArtifact(wrongKind), false);
  assertEquals(isExactOverviewGlbArtifact(mismatched), false);
  assertEquals(
    resolveOverviewThreadViewerCapabilities(snapshot, source).cadAssets,
    [],
  );
});

function exactGlb(id: string, digest = DIGEST): ThreadArtifact {
  return {
    id,
    label: `Exact ${id}`,
    kind: "cad-model",
    system: "build123d",
    revision: "1",
    freshness: "fresh",
    fingerprint: `sha256:${digest}`,
    uri: `/api/thread/assets/${digest}.glb`,
    dependsOn: [],
  };
}

function graphNode(ref: ThreadGraphNode["ref"]): ThreadGraphNode {
  return {
    id: `graph:${ref.kind}:${ref.id}`,
    ref,
    entityKind: ref.kind,
    label: "Hull",
    system: "build123d",
    freshness: "fresh",
    summary: "Recorded hull",
  };
}
