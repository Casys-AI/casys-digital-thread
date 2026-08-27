import { assertEquals, assertStrictEquals } from "@std/assert";
import type {
  EngineeringCaseCatalog,
  ThreadGraph,
  ThreadGraphNode,
} from "./src/thread/types.ts";
import {
  buildVerificationCaseLegend,
  filterGraphByVerificationCase,
  reconcileVerificationCaseContext,
  verificationCaseFilterIsAvailable,
} from "./src/thread/verification-case-model.ts";

const caseA = "mechanical-proof:aaa";
const caseB = "mechanical-proof:bbb";

const catalog: EngineeringCaseCatalog = {
  schemaVersion: "engineering-cases/1.0",
  status: "observed",
  coverage: [
    { family: "mechanical-proof", status: "observed" },
    { family: "sensitivity-study", status: "observed" },
    { family: "printability-check", status: "observed" },
    { family: "print-estimate", status: "observed" },
    { family: "dfm-check", status: "observed" },
  ],
  cases: [
    {
      key: caseA,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "structural-9g",
      revision: 2,
      scope: "Structural load case at 9 g",
      caseDigest: "a".repeat(64),
      authorityArtifactIds: ["case-a"],
    },
    {
      key: caseB,
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "thermal-hover",
      revision: 1,
      scope: "Structural load case at 9 g",
      caseDigest: "b".repeat(64),
      authorityArtifactIds: ["case-b"],
    },
  ],
  issues: [],
};

function node(
  id: string,
  engineeringCaseRefs?: string[],
): ThreadGraphNode {
  return {
    id: `artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    label: id,
    system: "test",
    freshness: "fresh",
    summary: id,
    engineeringCaseRefs,
  };
}

const graph: ThreadGraph = {
  nodes: [
    node("only-a", [caseA]),
    node("shared", [caseA, caseB]),
    node("only-b", [caseB]),
    node("outside"),
  ],
  edges: [
    {
      id: "a-shared",
      from: { kind: "artifact", id: "only-a" },
      to: { kind: "artifact", id: "shared" },
      relation: "derived_from",
      rationale: "recorded",
      origin: "provenance",
    },
    {
      id: "shared-b",
      from: { kind: "artifact", id: "shared" },
      to: { kind: "artifact", id: "only-b" },
      relation: "derived_from",
      rationale: "recorded",
      origin: "provenance",
    },
    {
      id: "outside-shared",
      from: { kind: "artifact", id: "outside" },
      to: { kind: "artifact", id: "shared" },
      relation: "derived_from",
      rationale: "recorded",
      origin: "provenance",
    },
  ],
};

Deno.test("case filtering is exact, preserves multi-case nodes, and removes bridge edges", () => {
  assertStrictEquals(
    filterGraphByVerificationCase(graph, { kind: "all" }),
    graph,
  );

  const filtered = filterGraphByVerificationCase(graph, {
    kind: "case",
    caseKey: caseA,
  });
  assertEquals(filtered.nodes.map((candidate) => candidate.ref.id), [
    "only-a",
    "shared",
  ]);
  assertEquals(filtered.edges.map((edge) => edge.id), ["a-shared"]);
});

Deno.test("case legend counts exact memberships and never merges equal scopes", () => {
  const legend = buildVerificationCaseLegend(catalog, graph.nodes);
  assertEquals(legend.map((item) => [item.case.id, item.nodeCount]), [
    ["structural-9g", 2],
    ["thermal-hover", 2],
  ]);
});

Deno.test("a stale selected case remains selected and filters to no records", () => {
  const staleFilter = {
    kind: "case" as const,
    caseKey: "missing",
  };
  assertEquals(
    verificationCaseFilterIsAvailable(catalog, staleFilter),
    false,
  );
  assertEquals(filterGraphByVerificationCase(graph, staleFilter), {
    nodes: [],
    edges: [],
  });
});

Deno.test("live case reconciliation clears transient state before widening or hiding a node", () => {
  assertEquals(
    reconcileVerificationCaseContext(
      catalog,
      graph,
      { kind: "case", caseKey: "missing" },
      [{ kind: "artifact", id: "outside" }],
    ),
    {
      filter: { kind: "case", caseKey: "missing" },
      resetTransientState: true,
    },
  );
  assertEquals(
    reconcileVerificationCaseContext(
      catalog,
      graph,
      { kind: "case", caseKey: caseA },
      [{ kind: "artifact", id: "only-b" }],
    ),
    {
      filter: { kind: "case", caseKey: caseA },
      resetTransientState: true,
    },
  );
  assertEquals(
    reconcileVerificationCaseContext(
      catalog,
      graph,
      { kind: "all" },
      [{ kind: "artifact", id: "outside" }],
    ),
    { filter: { kind: "all" }, resetTransientState: false },
  );
});
