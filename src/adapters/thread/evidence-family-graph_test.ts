import { assert, assertEquals } from "@std/assert";
import type {
  ThreadEvidenceFamily,
} from "../../presentation/workbench/thread/evidence.ts";
import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "../../presentation/workbench/thread/graph.ts";
import { projectEvidenceFamilyGraph } from "./evidence-family-graph.ts";

const AT = "2026-08-03T13:15:00.000Z";

Deno.test("r11-shaped identity recovery keeps direct proof, STEP, solve, and requirement chains distinct", () => {
  const graph = r11ShapedGraph();

  const projection = projectEvidenceFamilyGraph(graph, {
    snapshotId: "project:generic-product-v3:r11:mechanical-r3",
    revision: 11,
  });

  assertEquals(projection.asOf, {
    snapshotId: "project:generic-product-v3:r11:mechanical-r3",
    revision: 11,
  });
  assertEquals(projection.schemaVersion, "thread-evidence-family-graph/1.0");

  const proof = familyWithCurrent(projection.families, "r11-proof");
  assertEquals(proof.historicalRefs.map((ref) => ref.id), [
    "stale-proof",
    "r10-proof",
  ]);
  assertEquals(proof.revisionCount, 2);
  assertEquals(proof.status, "current");
  assertEquals(proof.relationship, {
    relation: "supersedes",
    classification: "not-recorded",
    equivalence: "not-recorded",
  });
  assertEquals(proof.transitions.map(transitionSignature), [
    "stale-proof->r10-proof",
    "r10-proof->r11-proof",
  ]);
  assertEquals(
    proof.historicalRefs.some((ref) => ref.id === "correction-record"),
    false,
  );

  const step = familyWithCurrent(projection.families, "r11-step");
  assertEquals(step.historicalRefs.map((ref) => ref.id), [
    "stale-step",
    "r10-step",
  ]);
  assertEquals(step.artifactKind, "step");

  const solve = familyWithCurrent(projection.families, "r11-solve");
  assertEquals(solve.historicalRefs.map((ref) => ref.id), [
    "stale-solve",
    "r10-solve",
  ]);
  assertEquals(solve.artifactKind, "solver-result");
  assertEquals(
    projection.families.some((family) =>
      [...family.historicalRefs, ...family.currentRefs].some((ref) =>
        ref.id === "failed-attempt-solve"
      )
    ),
    false,
  );

  assertEquals(
    familyWithCurrent(projection.families, "r11-displacement").historicalRefs
      .map((ref) => ref.id),
    ["r10-displacement"],
  );
  assertEquals(
    familyWithCurrent(projection.families, "r11-von-mises").historicalRefs
      .map((ref) => ref.id),
    ["r10-von-mises"],
  );

  // Measurements and evaluations are not a version family simply because the
  // R3 result reuses the completed R10 provider bytes.
  assertEquals(
    projection.families.some((family) =>
      family.entityKind === "artifact" && family.artifactKind === "observation"
    ),
    false,
  );
  assertEquals(
    projection.families.flatMap((family) => [
      ...family.historicalRefs,
      ...family.currentRefs,
    ]).some((ref) => ref.kind === "observation" || ref.kind === "evaluation"),
    false,
  );
  assert(
    projection.omittedSelfLoops.some((loop) =>
      loop.memberEdgeRefs.some((edge) => edge.id === "r10-proof-r11-proof")
    ),
  );
});

Deno.test("ambiguous successor branches remain raw facts rather than a guessed evidence family", () => {
  const graph: ThreadGraph = {
    nodes: [
      artifact("historic", "step", "fresh"),
      artifact("successor-a", "step", "stale"),
      artifact("successor-b", "step", "fresh"),
    ],
    edges: [
      supersedes("historic-a", "historic", "successor-a"),
      supersedes("historic-b", "historic", "successor-b"),
    ],
  };

  const projection = projectEvidenceFamilyGraph(graph, asOf());

  assertEquals(projection.families, []);
  assertEquals(projection.edges, []);
  // The canonical raw graph still retains both direct supersedes links.
  assertEquals(graph.edges.map((edge) => edge.id), ["historic-a", "historic-b"]);
});

Deno.test("explicit R1 and R2 predecessors converge on the sole R3 current requirement", () => {
  const graph: ThreadGraph = {
    nodes: [
      requirement("displacement-r1"),
      requirement("displacement-r2"),
      requirement("displacement-r3"),
    ],
    edges: [
      supersedes(
        "r1-r3",
        "displacement-r1",
        "displacement-r3",
        "requirement",
      ),
      supersedes(
        "r2-r3",
        "displacement-r2",
        "displacement-r3",
        "requirement",
      ),
    ],
  };

  const family = familyWithCurrent(
    projectEvidenceFamilyGraph(graph, asOf()).families,
    "displacement-r3",
  );

  assertEquals(family.entityKind, "requirement");
  assertEquals(family.status, "current");
  assertEquals(family.historicalRefs.map((ref) => ref.id), [
    "displacement-r1",
    "displacement-r2",
  ]);
  assertEquals(family.currentRefs.map((ref) => ref.id), ["displacement-r3"]);
  assertEquals(family.transitions.map(transitionSignature), [
    "displacement-r1->displacement-r3",
    "displacement-r2->displacement-r3",
  ]);
});

Deno.test("requirement fan-out remains raw because it has no declared sole current successor", () => {
  const graph: ThreadGraph = {
    nodes: [
      requirement("requirement-r1"),
      requirement("requirement-r2a"),
      requirement("requirement-r2b"),
    ],
    edges: [
      supersedes("r1-r2a", "requirement-r1", "requirement-r2a", "requirement"),
      supersedes("r1-r2b", "requirement-r1", "requirement-r2b", "requirement"),
    ],
  };

  assertEquals(projectEvidenceFamilyGraph(graph, asOf()).families, []);
});

Deno.test("an unanchored correction-like branch preserves the direct r10 to r11 chain only", () => {
  const graph: ThreadGraph = {
    nodes: [
      artifact("stale-proof", "document", "stale"),
      artifact("unclassified-record", "document"),
      artifact("r10-proof", "document"),
      artifact("r11-proof", "document"),
    ],
    edges: [
      supersedes("record-invalidates-stale", "stale-proof", "unclassified-record"),
      supersedes("r10-replaces-stale", "stale-proof", "r10-proof"),
      supersedes("r11-replaces-r10", "r10-proof", "r11-proof"),
    ],
  };

  const family = familyWithCurrent(
    projectEvidenceFamilyGraph(graph, asOf()).families,
    "r11-proof",
  );

  assertEquals(family.historicalRefs.map((ref) => ref.id), ["r10-proof"]);
  assertEquals(family.transitions.map(transitionSignature), [
    "r10-proof->r11-proof",
  ]);
});

Deno.test("matching presentation details without an explicit supersedes edge never create a family", () => {
  const left = artifact("left", "solver-result");
  const right = artifact("right", "solver-result");
  right.label = left.label;
  right.system = left.system;
  right.summary = left.summary;
  right.recordedAt = left.recordedAt;

  const projection = projectEvidenceFamilyGraph(
    { nodes: [left, right], edges: [] },
    asOf(),
  );

  assertEquals(projection.families, []);
});

Deno.test("quotient graph records self-loops and refuses a newly introduced cycle", () => {
  const graph: ThreadGraph = {
    nodes: [
      artifact("a0", "step"),
      artifact("a1", "step"),
      artifact("b0", "solver-result"),
      artifact("b1", "solver-result"),
    ],
    edges: [
      supersedes("a0-a1", "a0", "a1"),
      supersedes("b0-b1", "b0", "b1"),
      edge("a-to-b", ref("artifact", "a1"), ref("artifact", "b0"), "derived_from"),
      edge("b-to-a", ref("artifact", "b1"), ref("artifact", "a0"), "derived_from"),
    ],
  };

  const projection = projectEvidenceFamilyGraph(graph, asOf());

  assertEquals(projection.families.length, 2);
  assertEquals(projection.edges.length, 1);
  assertEquals(projection.edges[0]?.memberEdgeRefs.map((item) => item.id), [
    "a-to-b",
  ]);
  assertEquals(projection.omittedCycleEdges.length, 1);
  assertEquals(
    projection.omittedCycleEdges[0]?.memberEdgeRefs.map((item) => item.id),
    ["b-to-a"],
  );
  assertEquals(
    projection.omittedSelfLoops.flatMap((loop) =>
      loop.memberEdgeRefs.map((item) => item.id)
    ),
    ["a0-a1", "b0-b1"],
  );
});

Deno.test(
  "architecture-capture derived_from wraps predecessor and tip as one current family",
  () => {
    const graph: ThreadGraph = {
      nodes: [
        artifact("architecture-v2", "sysml-model", "fresh"),
        artifact("architecture-v3", "sysml-model", "fresh"),
        artifact("syson-model-seed", "sysml-model", "fresh"),
      ],
      edges: [
        edge(
          "v2-to-v3",
          ref("artifact", "architecture-v2"),
          ref("artifact", "architecture-v3"),
          "derived_from",
        ),
        edge(
          "seed-to-v3",
          ref("artifact", "syson-model-seed"),
          ref("artifact", "architecture-v3"),
          "derived_from",
        ),
      ],
    };

    const projection = projectEvidenceFamilyGraph(graph, asOf(), {
      architectureCaptureIds: new Set(["architecture-v2", "architecture-v3"]),
    });
    const family = familyWithCurrent(projection.families, "architecture-v3");

    assertEquals(family.historicalRefs.map((ref) => ref.id), ["architecture-v2"]);
    assertEquals(family.currentRefs.map((ref) => ref.id), ["architecture-v3"]);
    assertEquals(family.status, "current");
    assertEquals(family.artifactKind, "sysml-model");
    assertEquals(
      projection.families.some((candidate) =>
        [...candidate.historicalRefs, ...candidate.currentRefs].some((ref) =>
          ref.id === "syson-model-seed"
        )
      ),
      false,
    );
  },
);

Deno.test(
  "requirements-capture derived_from wraps predecessor and tip as one current family",
  () => {
    const graph: ThreadGraph = {
      nodes: [
        artifact("requirements-v1", "sysml-model", "fresh"),
        artifact("requirements-v2", "sysml-model", "fresh"),
        artifact("architecture-v1", "sysml-model", "fresh"),
      ],
      edges: [
        edge(
          "v1-to-v2",
          ref("artifact", "requirements-v1"),
          ref("artifact", "requirements-v2"),
          "derived_from",
        ),
        edge(
          "architecture-to-v2",
          ref("artifact", "architecture-v1"),
          ref("artifact", "requirements-v2"),
          "derived_from",
        ),
      ],
    };

    const projection = projectEvidenceFamilyGraph(graph, asOf(), {
      requirementsCaptureIds: new Set(["requirements-v1", "requirements-v2"]),
    });
    const family = familyWithCurrent(projection.families, "requirements-v2");

    assertEquals(family.historicalRefs.map((item) => item.id), [
      "requirements-v1",
    ]);
    assertEquals(family.currentRefs.map((item) => item.id), ["requirements-v2"]);
    assertEquals(family.status, "current");
    assertEquals(family.artifactKind, "sysml-model");
    assertEquals(
      projection.families.some((candidate) =>
        [...candidate.historicalRefs, ...candidate.currentRefs].some((item) =>
          item.id === "architecture-v1"
        )
      ),
      false,
    );
  },
);

Deno.test("a direct supersession cycle stays review-required without a current claim", () => {
  const graph: ThreadGraph = {
    nodes: [artifact("one", "step"), artifact("two", "step")],
    edges: [
      supersedes("one-two", "one", "two"),
      supersedes("two-one", "two", "one"),
    ],
  };

  const family = projectEvidenceFamilyGraph(graph, asOf()).families[0]!;

  assertEquals(family.currentRefs, []);
  assertEquals(family.status, "review-required");
  assertEquals(family.reviewReason, "no-current-successor");
});

function r11ShapedGraph(): ThreadGraph {
  const nodes: ThreadGraphNode[] = [
    change("correction-change", "component:drip-tray"),
    artifact("correction-record", "document"),
    artifact("stale-proof", "document", "stale"),
    artifact("r10-proof", "document"),
    artifact("r11-proof", "document"),
    artifact("stale-step", "step", "stale"),
    artifact("r10-step", "step"),
    artifact("r11-step", "step"),
    artifact("stale-solve", "solver-result", "stale"),
    artifact("r10-solve", "solver-result"),
    artifact("r11-solve", "solver-result"),
    artifact("failed-attempt-solve", "solver-result", "failed"),
    requirement("r10-displacement"),
    requirement("r11-displacement"),
    requirement("r10-von-mises"),
    requirement("r11-von-mises"),
    observation("r10-displacement-observation"),
    observation("r11-displacement-observation"),
    evaluation("r10-displacement-evaluation"),
    evaluation("r11-displacement-evaluation"),
  ];
  const edges = [
    edge(
      "correction-change-record",
      ref("change", "correction-change"),
      ref("artifact", "correction-record"),
      "changes",
    ),
    supersedes("record-old-proof", "stale-proof", "correction-record"),
    supersedes("stale-proof-r10-proof", "stale-proof", "r10-proof"),
    supersedes("r10-proof-r11-proof", "r10-proof", "r11-proof"),
    supersedes("stale-step-r10-step", "stale-step", "r10-step"),
    supersedes("r10-step-r11-step", "r10-step", "r11-step"),
    supersedes("stale-solve-r10-solve", "stale-solve", "r10-solve"),
    supersedes("r10-solve-r11-solve", "r10-solve", "r11-solve"),
    supersedes("failed-r11-solve", "failed-attempt-solve", "r11-solve"),
    supersedes(
      "r10-r11-displacement",
      "r10-displacement",
      "r11-displacement",
      "requirement",
    ),
    supersedes(
      "r10-r11-von-mises",
      "r10-von-mises",
      "r11-von-mises",
      "requirement",
    ),
    edge(
      "proof-to-step",
      ref("artifact", "r11-proof"),
      ref("artifact", "r11-step"),
      "derived_from",
    ),
    edge(
      "step-to-solve",
      ref("artifact", "r11-step"),
      ref("artifact", "r11-solve"),
      "derived_from",
    ),
    edge(
      "solve-to-observation",
      ref("artifact", "r11-solve"),
      ref("observation", "r11-displacement-observation"),
      "source_of",
      "structure",
    ),
    edge(
      "observation-to-evaluation",
      ref("observation", "r11-displacement-observation"),
      ref("evaluation", "r11-displacement-evaluation"),
      "uses",
    ),
  ];
  return { nodes, edges };
}

function familyWithCurrent(
  families: readonly ThreadEvidenceFamily[],
  currentId: string,
): ThreadEvidenceFamily {
  const family = families.find((candidate) =>
    candidate.currentRefs.some((reference) => reference.id === currentId)
  );
  if (!family) throw new Error(`Missing family with current ${currentId}.`);
  return family;
}

function transitionSignature(
  transition: ThreadEvidenceFamily["transitions"][number],
): string {
  return `${transition.historical.id}->${transition.successor.id}`;
}

function artifact(
  id: string,
  artifactKind: string,
  freshness: ThreadGraphNode["freshness"] = "fresh",
): ThreadGraphNode {
  return {
    id: `graph:artifact:${id}`,
    ref: ref("artifact", id),
    entityKind: "artifact",
    artifactKind,
    label: `Deliberately arbitrary ${id}`,
    system: "fixture",
    freshness,
    summary: "No label, hash, or timestamp is used by the family projection.",
    recordedAt: AT,
  };
}

function requirement(id: string): ThreadGraphNode {
  return {
    id: `graph:requirement:${id}`,
    ref: ref("requirement", id),
    entityKind: "requirement",
    label: `Deliberately arbitrary ${id}`,
    system: "fixture",
    freshness: "fresh",
    summary: "Requirement fixture.",
    recordedAt: AT,
  };
}

function observation(id: string): ThreadGraphNode {
  return {
    id: `graph:observation:${id}`,
    ref: ref("observation", id),
    entityKind: "observation",
    label: `Deliberately arbitrary ${id}`,
    system: "fixture",
    freshness: "fresh",
    summary: "Observation fixture.",
    recordedAt: AT,
  };
}

function evaluation(id: string): ThreadGraphNode {
  return {
    id: `graph:evaluation:${id}`,
    ref: ref("evaluation", id),
    entityKind: "evaluation",
    label: `Deliberately arbitrary ${id}`,
    system: "fixture",
    freshness: "fresh",
    summary: "Evaluation fixture.",
    recordedAt: AT,
  };
}

function change(id: string, affectedComponentId: string): ThreadGraphNode {
  return {
    id: `graph:change:${id}`,
    ref: ref("change", id),
    entityKind: "change",
    label: "A correction declaration",
    system: "fixture",
    freshness: "fresh",
    summary: "created",
    affectedComponentId,
    recordedAt: AT,
  };
}

function ref(kind: ThreadGraphRef["kind"], id: string): ThreadGraphRef {
  return { kind, id };
}

function supersedes(
  id: string,
  historical: string,
  successor: string,
  kind: "artifact" | "requirement" = "artifact",
): ThreadGraphEdge {
  return edge(id, ref(kind, historical), ref(kind, successor), "supersedes");
}

function edge(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"],
  origin: ThreadGraphEdge["origin"] = "provenance",
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation,
    rationale: "Fixture edge.",
    origin,
  };
}

function asOf(): { snapshotId: string; revision: number } {
  return { snapshotId: "thread-r11-fixture", revision: 11 };
}
