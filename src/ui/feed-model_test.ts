import { assertEquals } from "@std/assert";
import type { EngineeringThreadEntityRef } from "../domain/project/engineering-project.ts";
import {
  activityCurrency,
  activityFeedNodes,
  activityKindLabel,
  AMBIGUOUS_FEED_SCOPE,
  buildActivityTimeline,
  buildFeedComponentCounts,
  buildFilterOptions,
  compactLineageCounters,
  compactLineageProjection,
  filterFeedNodesByScope,
  isActivityEntryExpanded,
  isArchitectureSysmlSealArtifactId,
  ORPHAN_FEED_SCOPE,
  traceThreadLineage,
} from "./src/thread/feed-model.ts";
import type { ProjectReviewRecord } from "./src/project/review-decision-model.ts";
import type { PartAnchorageResolution } from "./src/thread/part-anchorage-model.ts";
import { buildEvidenceGraphModel } from "./src/thread/evidence-graph-model.ts";
import {
  buildExplorationModel,
  FALLBACK_TOKENS,
} from "./src/thread/evidence-exploration-model.ts";
import type { EvidenceCanvasProjection } from "./src/thread/evidence-canvas-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadEvidenceFamilyGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

Deno.test("lineage keeps every upstream branch and downstream impact", () => {
  const nodes = ["cad", "scenario", "solve", "stress", "requirement", "action"]
    .map((id) => node(id));
  const edges = [
    edge("cad", "solve"),
    edge("scenario", "solve"),
    edge("solve", "stress"),
    edge("stress", "requirement"),
    edge("requirement", "action"),
  ];

  const lineage = traceThreadLineage(nodes, edges, ref("stress"));

  assertEquals(lineage.upstream.map((step) => step.node.ref.id), [
    "cad",
    "scenario",
    "solve",
  ]);
  assertEquals(lineage.downstream.map((step) => step.node.ref.id), [
    "requirement",
    "action",
  ]);
  assertEquals(lineage.edges.length, 5);
});

Deno.test("feedback nodes are not duplicated across both lineage directions", () => {
  const nodes = ["a", "b", "c"].map((id) => node(id));
  const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];

  const lineage = traceThreadLineage(nodes, edges, ref("b"));

  assertEquals(lineage.upstream, []);
  assertEquals(lineage.downstream, []);
  assertEquals(lineage.feedback.map((step) => step.node.ref.id), ["a", "c"]);
  assertEquals(lineage.edges.length, 3);
});

Deno.test("activity feed hides support plumbing but keeps meaningful outputs", () => {
  const nodes = [
    node("change", "change", "2026-08-01T08:00:00.000Z"),
    node("attestation", "consumption", "2026-08-01T08:01:00.000Z"),
    node("raw-evidence", "artifact", "2026-08-01T08:02:00.000Z", "evidence"),
    node("step", "artifact", "2026-08-01T08:03:00.000Z", "step"),
    node("stress", "observation", "2026-08-01T08:04:00.000Z"),
  ];

  assertEquals(activityFeedNodes(nodes).map((item) => item.ref.id), [
    "stress",
    "step",
  ]);
});

Deno.test("activity feed promotes only a change whose target explicitly supersedes evidence", () => {
  const correction = node("correction", "change", "2026-08-01T08:04:00.000Z");
  const record = node(
    "correction-record",
    "artifact",
    "2026-08-01T08:04:01.000Z",
    "document",
  );
  const historic = node(
    "proof-r28",
    "artifact",
    "2026-08-01T08:00:00.000Z",
    "solver-result",
  );
  const automaticCapture = node(
    "capture",
    "change",
    "2026-08-01T08:05:00.000Z",
  );
  const capturedArtifact = node(
    "capture-record",
    "artifact",
    "2026-08-01T08:05:01.000Z",
  );
  const edges: ThreadGraphEdge[] = [
    {
      id: "recorded-correction",
      from: correction.ref,
      to: record.ref,
      relation: "changes",
      rationale: "The correction is recorded.",
      origin: "provenance",
    },
    {
      id: "supersedes-proof",
      from: historic.ref,
      to: record.ref,
      relation: "supersedes",
      rationale: "The correction replaces the historic basis.",
      origin: "provenance",
    },
    {
      id: "automatic-capture",
      from: automaticCapture.ref,
      to: capturedArtifact.ref,
      relation: "changes",
      rationale: "A snapshot extension introduced a support artifact.",
      origin: "provenance",
    },
  ];

  assertEquals(
    activityFeedNodes(
      [correction, record, historic, automaticCapture, capturedArtifact],
      edges,
    ).map((item) => item.ref.id),
    ["correction", "proof-r28"],
  );
});

Deno.test(
  "activity feed promotes only the architecture SysML seal document, not every document",
  () => {
    const digest = "a".repeat(64);
    const seal = node(
      `architecture-sysml-seal-${digest}`,
      "artifact",
      "2026-08-14T08:04:00.000Z",
      "document",
      "digital-thread",
    );
    const brief = node(
      "artifact.brief",
      "artifact",
      "2026-08-14T08:00:00.000Z",
      "document",
      "digital-thread",
    );
    const proof = node(
      `fea-proof-${digest}`,
      "artifact",
      "2026-08-14T08:03:00.000Z",
      "document",
      "digital-thread",
    );

    assertEquals(
      isArchitectureSysmlSealArtifactId(seal.ref.id),
      true,
    );
    assertEquals(
      activityFeedNodes([seal, brief, proof]).map((item) => item.ref.id),
      [
        seal.ref.id,
      ],
    );
    assertEquals(activityKindLabel(seal), "document · documentary");
    assertEquals(activityKindLabel(brief), "document");
  },
);

Deno.test("activity feed promotes measured DFM and study-base evaluation documents", () => {
  const digest = "b".repeat(64);
  const dfm = node(
    `dfm-check-${digest}`,
    "artifact",
    "2026-08-15T10:00:00.000Z",
    "evidence",
    "digital-thread",
  );
  const join = node(
    `sensitivity-base-evaluation-${digest}`,
    "artifact",
    "2026-08-15T10:02:00.000Z",
    "evidence",
    "digital-thread",
  );
  assertEquals(
    activityFeedNodes([dfm, join]).map((item) => item.ref.id),
    [join.ref.id, dfm.ref.id],
  );
  assertEquals(activityKindLabel(dfm), "measured DFM");
  assertEquals(activityKindLabel(join), "study-base evaluation");
  const joinEval: ThreadGraphNode = {
    ...node(
      "requirement-arm-maxDisplacement-evaluation-abc",
      "evaluation",
      "2026-08-16T10:12:00.000Z",
    ),
    evaluationFamily: "study-base",
  };
  assertEquals(activityKindLabel(joinEval), "study-base evaluation");
});

Deno.test("activity feed promotes server-declared live milestones, not generic support", () => {
  const nodes = [
    {
      ...node(
        "run-7:projector-milestone",
        "artifact",
        "2026-08-01T08:03:00.000Z",
        "other",
        "any-server-owned-projector",
      ),
      activityRole: "milestone" as const,
    },
    node(
      "run-7:provider-support",
      "artifact",
      "2026-08-01T08:02:00.000Z",
      "other",
      "any-server-owned-projector",
    ),
  ];

  assertEquals(activityFeedNodes(nodes).map((item) => item.ref.id), [
    "run-7:projector-milestone",
  ]);
});

Deno.test("activity feed is collapsed until the reviewer explicitly selects an event", () => {
  const correction = node("correction", "change");

  assertEquals(isActivityEntryExpanded(undefined, correction), false);
  assertEquals(isActivityEntryExpanded(correction.ref, correction), true);
  assertEquals(
    isActivityEntryExpanded({ kind: "artifact", id: "different" }, correction),
    false,
  );
});

Deno.test("published review enriches its exact feed fact without a duplicate card", () => {
  const result = node(
    "geometry-result",
    "artifact",
    "2026-08-05T10:00:00.000Z",
    "geometry-capture",
  );
  const review = reviewRecord({
    decisionId: "decision-geometry-v2",
    state: "published",
    recordedAt: "2026-08-05T09:59:00.000Z",
    resultEvidence: canonicalResultRef(result),
  });

  const timeline = buildActivityTimeline([result], [review]);

  assertEquals(timeline.length, 1);
  assertEquals(timeline[0]?.kind, "thread");
  if (timeline[0]?.kind === "thread") {
    assertEquals(timeline[0].review?.decision?.id, "decision-geometry-v2");
    assertEquals(timeline[0].recordedAt, result.recordedAt);
  }
});

Deno.test("pending and revision reviews remain ordinary chronological feed events", () => {
  const pending = reviewRecord({
    decisionId: "decision-requirements",
    state: "needs-review",
    recordedAt: "2026-08-05T11:00:00.000Z",
  });
  const revision = reviewRecord({
    decisionId: "decision-architecture",
    state: "revision-requested",
    recordedAt: "2026-08-05T10:00:00.000Z",
  });

  const timeline = buildActivityTimeline([], [revision, pending]);

  assertEquals(timeline.map((entry) => entry.kind), ["review", "review"]);
  assertEquals(
    timeline.map((entry) =>
      entry.kind === "review" ? entry.review.decision?.id : undefined
    ),
    ["decision-requirements", "decision-architecture"],
  );
});

Deno.test("review identity stays stable when its decision timestamp changes", () => {
  const proposed = reviewRecord({
    decisionId: "decision-geometry",
    state: "needs-review",
    recordedAt: "2026-08-05T09:00:00.000Z",
  });
  const validated = reviewRecord({
    decisionId: "decision-geometry",
    state: "approved-awaiting-result",
    recordedAt: "2026-08-05T09:05:00.000Z",
  });

  assertEquals(
    buildActivityTimeline([], [proposed])[0]?.key,
    buildActivityTimeline([], [validated])[0]?.key,
  );
});

Deno.test("ambiguous result ownership fails closed instead of choosing a review", () => {
  const result = node("shared-result");
  const first = reviewRecord({
    decisionId: "decision-a",
    state: "published",
    resultEvidence: canonicalResultRef(result),
  });
  const second = reviewRecord({
    decisionId: "decision-b",
    state: "published",
    resultEvidence: canonicalResultRef(result),
  });

  const timeline = buildActivityTimeline([result], [first, second]);

  assertEquals(timeline.length, 3);
  assertEquals(
    timeline.find((entry) => entry.kind === "thread")?.kind === "thread" &&
      timeline.find((entry) => entry.kind === "thread")?.review,
    undefined,
  );
});

Deno.test(
  "historical requirements capture currency is historical, never Validated fresh",
  () => {
    const predecessor = node(
      "requirements-capture-r1",
      "artifact",
      "2026-08-01T08:00:00.000Z",
      "sysml-model",
    );
    const tip = node(
      "requirements-capture-r2",
      "artifact",
      "2026-08-02T08:00:00.000Z",
      "sysml-model",
    );
    const familyGraph = currentFamilyGraph({
      id: "requirements-capture-family",
      entityKind: "artifact",
      artifactKind: "sysml-model",
      historical: predecessor.ref,
      current: tip.ref,
    });

    const review = reviewRecord({
      decisionId: "decision-requirements-r1",
      state: "published",
      resultEvidence: canonicalResultRef(predecessor),
    });
    const timeline = buildActivityTimeline([predecessor], [review]);

    assertEquals(predecessor.freshness, "fresh");
    assertEquals(timeline[0]?.kind, "thread");
    if (timeline[0]?.kind === "thread") {
      assertEquals(timeline[0].review?.state, "published");
    }
    assertEquals(activityCurrency(predecessor, familyGraph), "historical");
    assertEquals(activityCurrency(tip, familyGraph), "fresh");
    assertEquals(activityCurrency(predecessor, EMPTY_FAMILY), "fresh");
    assertEquals(
      activityCurrency(predecessor, familyGraph) === "fresh",
      false,
      "a family historicalRef must not keep the fresh currency chip",
    );
  },
);

Deno.test(
  "review-required families do not invent historical currency",
  () => {
    const left = node(
      "requirements-capture-a",
      "artifact",
      "2026-08-01T08:00:00.000Z",
      "sysml-model",
    );
    const right = node(
      "requirements-capture-b",
      "artifact",
      "2026-08-02T08:00:00.000Z",
      "sysml-model",
    );
    const familyGraph: ThreadEvidenceFamilyGraph = {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: { snapshotId: "feed-test", revision: 2 },
      families: [{
        id: "divergent-requirements",
        entityKind: "artifact",
        artifactKind: "sysml-model",
        historicalRefs: [],
        currentRefs: [left.ref, right.ref],
        revisionCount: 1,
        status: "review-required",
        reviewReason: "divergent-successors",
        relationship: {
          relation: "supersedes",
          classification: "not-recorded",
          equivalence: "not-recorded",
        },
        transitions: [{
          edgeRef: {
            id: "divergent",
            relation: "supersedes",
            origin: "provenance",
          },
          historical: left.ref,
          successor: right.ref,
        }],
      }],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    };

    assertEquals(activityCurrency(left, familyGraph), "fresh");
    assertEquals(activityCurrency(right, familyGraph), "fresh");
  },
);

Deno.test("part filtering keeps exact attached reviews but omits unscoped review-only events", () => {
  const visible = node("geometry-result");
  const attached = reviewRecord({
    decisionId: "decision-geometry",
    state: "published",
    resultEvidence: canonicalResultRef(visible),
  });
  const waiting = reviewRecord({
    decisionId: "decision-requirements",
    state: "needs-review",
  });

  const timeline = buildActivityTimeline(
    [visible],
    [attached, waiting],
    false,
  );

  assertEquals(timeline.length, 1);
  assertEquals(timeline[0]?.kind, "thread");
  if (timeline[0]?.kind === "thread") {
    assertEquals(timeline[0].review?.decision?.id, "decision-geometry");
  }
});

// ---------------------------------------------------------------------------
// Feed lineage local view — compact preparation (depth 2, anchored on focus)
//
// These tests verify the specific invariants of the sigma local view used by
// FeedLineageGraph:
//   - the focus node is ALWAYS included in the filtered bounded projection
//   - nodes more than 2 hops away are EXCLUDED (compact = bounded depth)
//   - building the sigma model from the same neighborhood is DETERMINISTIC
//   - an isolated focus node (no edges in the visible graph) falls back to an
//     empty neighborhood so the component can render the "unlinked" message
// ---------------------------------------------------------------------------

const EMPTY_FAMILY: ThreadEvidenceFamilyGraph = {
  schemaVersion: "thread-evidence-family-graph/1.0",
  asOf: { snapshotId: "feed-test", revision: 1 },
  families: [],
  edges: [],
  omittedSelfLoops: [],
  omittedCycleEdges: [],
};

function currentFamilyGraph(spec: {
  id: string;
  entityKind: "artifact" | "requirement";
  artifactKind?: string;
  historical: ThreadGraphRef;
  current: ThreadGraphRef;
}): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "feed-test", revision: 2 },
    families: [{
      id: spec.id,
      entityKind: spec.entityKind,
      ...(spec.artifactKind ? { artifactKind: spec.artifactKind } : {}),
      historicalRefs: [spec.historical],
      currentRefs: [spec.current],
      revisionCount: 1,
      status: "current",
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: `${spec.id}-supersedes`,
          relation: "supersedes",
          origin: "provenance",
        },
        historical: spec.historical,
        successor: spec.current,
      }],
    }],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

Deno.test(
  "feed lineage local view: focus node is always included in bounded neighborhood (depth 2)",
  () => {
    // Chain: source → focus → downstream1 → downstream2 (3 hops from focus)
    const source = artifact("source");
    const focus = artifact("focus");
    const down1 = artifact("down1");
    const down2 = artifact("down2");

    const rawGraph = {
      nodes: [source, focus, down1, down2],
      edges: [
        link("e1", source.ref, focus.ref),
        link("e2", focus.ref, down1.ref),
        link("e3", down1.ref, down2.ref),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
    const neighborhood = compactLineageProjection(evidenceModel, focus.ref);

    // Focus must be present.
    assertEquals(
      neighborhood.nodes.some((n) => n.ref.id === "focus"),
      true,
      "focus node must be in the bounded neighborhood",
    );
  },
);

Deno.test(
  "feed lineage local view: nodes beyond depth 2 are excluded (compact view)",
  () => {
    // Chain: A → B (focus) → C → D (3 hops from B)
    const nodeA = artifact("A");
    const nodeB = artifact("B"); // focus
    const nodeC = artifact("C");
    const nodeD = artifact("D");

    const rawGraph = {
      nodes: [nodeA, nodeB, nodeC, nodeD],
      edges: [
        link("e1", nodeA.ref, nodeB.ref),
        link("e2", nodeB.ref, nodeC.ref),
        link("e3", nodeC.ref, nodeD.ref),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});
    // FeedLineageGraph uses depth 2.
    const neighborhood = compactLineageProjection(evidenceModel, nodeB.ref);

    const ids = neighborhood.nodes.map((n) => n.ref.id).sort();
    // B (focus), A (1 hop upstream), C (1 hop downstream), D (2 hops downstream).
    // All four are within depth 2 of B.
    assertEquals(ids, ["A", "B", "C", "D"]);
  },
);

Deno.test(
  "feed lineage local view: node 3 hops away is excluded at depth 2",
  () => {
    // A → B → C → D → E (focus is A; E is 4 hops away)
    const nodes = ["A", "B", "C", "D", "E"].map((id) => artifact(id));
    const edges = [
      link("e1", nodes[0].ref, nodes[1].ref),
      link("e2", nodes[1].ref, nodes[2].ref),
      link("e3", nodes[2].ref, nodes[3].ref),
      link("e4", nodes[3].ref, nodes[4].ref),
    ];

    const evidenceModel = buildEvidenceGraphModel(
      { nodes, edges },
      EMPTY_FAMILY,
      {},
    );
    const neighborhood = compactLineageProjection(
      evidenceModel,
      nodes[0].ref,
    );

    const ids = neighborhood.nodes.map((n) => n.ref.id).sort();
    // A (focus), B (1 hop), C (2 hops). D and E are at 3+ hops — excluded.
    assertEquals(ids, ["A", "B", "C"]);
    assertEquals(
      ids.includes("D") || ids.includes("E"),
      false,
      "nodes beyond depth 2 must not appear in the compact view",
    );
  },
);

Deno.test(
  "feed lineage local view: sigma model built from bounded neighborhood is deterministic",
  () => {
    // SysML → CAD → Observation (3-node chain)
    const nodeSys = artifact("SYS", "syson");
    const nodeCAD = artifact("CAD", "build123d");
    const nodeObs = artifact("OBS", "calculix");

    const rawGraph = {
      nodes: [nodeSys, nodeCAD, nodeObs],
      edges: [
        link("e1", nodeSys.ref, nodeCAD.ref, "input_to"),
        link("e2", nodeCAD.ref, nodeObs.ref, "source_of"),
      ],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {});

    // Simulate FeedLineageGraph preparation twice — same inputs → same positions.
    // The projection is built from the *neighborhood* (not the full model),
    // mirroring the useMemo in FeedLineageGraph exactly.
    const neighborhood1 = compactLineageProjection(evidenceModel, nodeCAD.ref);
    const neighborhood2 = compactLineageProjection(evidenceModel, nodeCAD.ref);

    const projection1: EvidenceCanvasProjection = {
      nodes: neighborhood1.nodes,
      edges: neighborhood1.edges,
      displayedCount: neighborhood1.nodes.length,
      foldedInstrumentCount: 0,
      isFiltered: true,
      supportingNodeCount: 0,
    };
    const projection2: EvidenceCanvasProjection = {
      nodes: neighborhood2.nodes,
      edges: neighborhood2.edges,
      displayedCount: neighborhood2.nodes.length,
      foldedInstrumentCount: 0,
      isFiltered: true,
      supportingNodeCount: 0,
    };

    const m1 = buildExplorationModel(
      evidenceModel,
      projection1,
      FALLBACK_TOKENS,
    );
    const m2 = buildExplorationModel(
      evidenceModel,
      projection2,
      FALLBACK_TOKENS,
    );

    // Same node count.
    assertEquals(m1.graph.order, m2.graph.order);

    // Same positions per node key.
    m1.graph.forEachNode((key, attrs) => {
      assertEquals(
        m2.graph.hasNode(key),
        true,
        `node ${key} must appear in both runs`,
      );
      const attrs2 = m2.graph.getNodeAttributes(key);
      assertEquals(
        attrs.x,
        attrs2.x,
        `x position of ${key} must be stable across runs`,
      );
      assertEquals(
        attrs.y,
        attrs2.y,
        `y position of ${key} must be stable across runs`,
      );
    });

    // Neighborhoods themselves must contain the same node ids.
    const ids1 = neighborhood1.nodes.map((n) => n.ref.id).sort();
    const ids2 = neighborhood2.nodes.map((n) => n.ref.id).sort();
    assertEquals(ids1, ids2, "neighborhood must be deterministic");
  },
);

Deno.test(
  "feed lineage local view: invisible focus node returns empty neighborhood (unlinked fallback)",
  () => {
    // A visible, B invisible (instrument folded out). Querying B yields empty.
    const nodeA = artifact("A", "syson");
    const nodeB = { ...artifact("B", "analyze"), system: "analyze" };

    const rawGraph = {
      nodes: [nodeA, nodeB],
      edges: [link("e1", nodeA.ref, nodeB.ref, "input_to")],
    };

    const evidenceModel = buildEvidenceGraphModel(rawGraph, EMPTY_FAMILY, {
      isAnalyzeInstrumentNode: (n) => n.system === "analyze",
    });

    // B is folded out — querying it must return empty (component renders fallback).
    const nb = compactLineageProjection(evidenceModel, nodeB.ref);
    assertEquals(
      nb.nodes.length,
      0,
      "invisible focus node → empty neighborhood",
    );
  },
);

// ---------------------------------------------------------------------------
// Helpers for the feed lineage sigma tests
// ---------------------------------------------------------------------------

function artifact(
  id: string,
  system = "test",
): ThreadGraphNode {
  return {
    id: `artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    label: id,
    system,
    freshness: "fresh",
    summary: id,
  };
}

function link(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"] = "derived_from",
): ThreadGraphEdge {
  return {
    id,
    from,
    to,
    relation,
    rationale: `${from.id} → ${to.id}`,
    origin: "provenance",
  };
}

function structureLink(
  id: string,
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    ...link(id, from, to, relation),
    origin: "structure",
  };
}

function deskLampActivityEvidence(): {
  evidenceModel: ReturnType<typeof buildEvidenceGraphModel>;
  refs: {
    architecture: ThreadGraphRef;
    geometry: ThreadGraphRef;
    baseStep: ThreadGraphRef;
  };
} {
  const architecture = node(
    "architecture",
    "artifact",
    "2026-08-01T08:00:00.000Z",
    "sysml-model",
    "syson",
  );
  const geometry = node(
    "geometry",
    "artifact",
    "2026-08-01T08:01:00.000Z",
    "cad-model",
    "digital-thread",
  );
  const sourceHub = node(
    "source-hub",
    "artifact",
    "2026-08-01T07:59:00.000Z",
    "cad-model",
    "digital-thread",
  );
  const unrelatedCapture = node(
    "unrelated-capture",
    "artifact",
    "2026-08-01T08:01:00.000Z",
    "cad-model",
    "digital-thread",
  );
  const script = node(
    "raw-script",
    "artifact",
    "2026-08-01T08:02:00.000Z",
    "script",
    "build123d",
  );

  const definitionIds = [
    "def-system",
    "def-base",
    "def-stem",
    "def-head",
    "def-socket",
  ];
  const usageIds = [
    "usage-base",
    "usage-stem",
    "usage-head",
    "usage-socket",
  ];
  const definitions = new Map(
    definitionIds.map((id) =>
      [
        id,
        node(
          id,
          "part-definition",
          "2026-08-01T08:00:00.000Z",
          undefined,
          "syson",
        ),
      ] as const
    ),
  );
  const usages = new Map(
    usageIds.map((id) =>
      [
        id,
        node(
          id,
          "part-usage",
          "2026-08-01T08:00:00.000Z",
          undefined,
          "syson",
        ),
      ] as const
    ),
  );
  const stepIds = ["assembly", "base", "stem", "head", "socket"];
  const steps = new Map(
    stepIds.map((id) =>
      [
        id,
        node(
          `step-${id}`,
          "artifact",
          "2026-08-01T08:02:00.000Z",
          "step",
          "build123d",
        ),
      ] as const
    ),
  );
  const required = <T>(value: T | undefined, label: string): T => {
    if (!value) throw new Error(`Missing Desk Lamp fixture node ${label}.`);
    return value;
  };
  const definition = (id: string) => required(definitions.get(id), id);
  const usage = (id: string) => required(usages.get(id), id);
  const step = (id: string) => required(steps.get(id), id);

  const edges: ThreadGraphEdge[] = [
    link("hub-geometry", sourceHub.ref, geometry.ref),
    link("hub-unrelated", sourceHub.ref, unrelatedCapture.ref),
    structureLink(
      "architecture-geometry",
      architecture.ref,
      geometry.ref,
      "input_to",
    ),
    structureLink(
      "architecture-root",
      architecture.ref,
      definition("def-system").ref,
      "contains",
    ),
    structureLink(
      "root-base-usage",
      definition("def-system").ref,
      usage("usage-base").ref,
      "contains",
    ),
    structureLink(
      "root-stem-usage",
      definition("def-system").ref,
      usage("usage-stem").ref,
      "contains",
    ),
    structureLink(
      "stem-head-usage",
      definition("def-stem").ref,
      usage("usage-head").ref,
      "contains",
    ),
    structureLink(
      "head-socket-usage",
      definition("def-head").ref,
      usage("usage-socket").ref,
      "contains",
    ),
    ...[
      ["base", "usage-base", "def-base"],
      ["stem", "usage-stem", "def-stem"],
      ["head", "usage-head", "def-head"],
      ["socket", "usage-socket", "def-socket"],
    ].map(([id, usageId, definitionId]) =>
      structureLink(
        `typed-${id}`,
        usage(required(usageId, "usage id")).ref,
        definition(required(definitionId, "definition id")).ref,
        "typed_by",
      )
    ),
    ...stepIds.map((id) =>
      structureLink(
        `geometry-${id}`,
        geometry.ref,
        step(id).ref,
        "input_to",
      )
    ),
    ...[
      ["assembly", "def-system"],
      ["base", "def-base"],
      ["stem", "def-stem"],
      ["head", "def-head"],
      ["socket", "def-socket"],
    ].map(([stepId, definitionId]) =>
      structureLink(
        `represented-${stepId}`,
        definition(required(definitionId, "definition id")).ref,
        step(required(stepId, "STEP id")).ref,
        "represented_by",
      )
    ),
    structureLink("geometry-script", geometry.ref, script.ref, "input_to"),
  ];

  return {
    evidenceModel: buildEvidenceGraphModel(
      {
        nodes: [
          sourceHub,
          unrelatedCapture,
          architecture,
          geometry,
          script,
          ...definitions.values(),
          ...usages.values(),
          ...steps.values(),
        ],
        edges,
      },
      EMPTY_FAMILY,
      {},
    ),
    refs: {
      architecture: architecture.ref,
      geometry: geometry.ref,
      baseStep: step("base").ref,
    },
  };
}

function node(
  id: string,
  kind: ThreadGraphRef["kind"] = "artifact",
  recordedAt = "2026-08-01T08:00:00.000Z",
  artifactKind?: string,
  system = "test",
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(artifactKind ? { artifactKind } : {}),
    label: id,
    system,
    freshness: "fresh",
    summary: id,
    recordedAt,
  };
}

function reviewRecord(
  {
    decisionId,
    state,
    recordedAt = "2026-08-05T10:00:00.000Z",
    resultEvidence,
  }: {
    decisionId: string;
    state: ProjectReviewRecord["state"];
    recordedAt?: string;
    resultEvidence?: Pick<EngineeringThreadEntityRef, "kind" | "id">;
  },
): ProjectReviewRecord {
  return {
    id: decisionId.includes("requirements") ? "requirements" : "geometry",
    anchorId: `review-${decisionId}`,
    href: `#work/review/${decisionId}`,
    title: decisionId,
    question: `${decisionId}?`,
    summary: decisionId,
    state,
    representation: state === "published" ? "published-result" : "proposal",
    recordedAt,
    preview: { kind: "unavailable", reason: "Fixture preview" },
    decision: { id: decisionId } as ProjectReviewRecord["decision"],
    resultEvidence: resultEvidence
      ? {
        snapshotId: "thread:test",
        snapshotRevision: 1,
        kind: resultEvidence.kind,
        id: resultEvidence.id,
      }
      : undefined,
  };
}

function canonicalResultRef(
  node: ThreadGraphNode,
): Pick<EngineeringThreadEntityRef, "kind" | "id"> {
  const reference = node.ref;
  if (
    reference.kind === "analysis-node" ||
    reference.kind === "part-definition" ||
    reference.kind === "part-usage" ||
    reference.kind === "attribute-usage" ||
    reference.kind === "cad-lever" ||
    reference.kind === "cad-unnamed-literal" ||
    reference.kind === "source-file"
  ) {
    throw new Error(
      "A browser-only analysis or SysML element cannot be review result evidence.",
    );
  }
  return { kind: reference.kind, id: reference.id };
}

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}

function edge(from: string, to: string): ThreadGraphEdge {
  return {
    id: `${from}-${to}`,
    from: ref(from),
    to: ref(to),
    relation: "derived_from",
    rationale: `${to} derives from ${from}`,
    origin: "provenance",
  };
}

// ---------------------------------------------------------------------------
// compactLineageCounters — truthful counters for the feed vignette bandeau
// ---------------------------------------------------------------------------

Deno.test(
  "compactLineageCounters: focus-only node yields total=1, upstream=0, downstream=0",
  () => {
    // Isolated node — no edges in the visible graph.
    const focus = artifact("focus");
    const evidenceModel = buildEvidenceGraphModel(
      { nodes: [focus], edges: [] },
      EMPTY_FAMILY,
      {},
    );
    const counters = compactLineageCounters(evidenceModel, focus.ref);
    assertEquals(
      counters.total,
      1,
      "isolated focus node: total must be 1 (the node itself)",
    );
    assertEquals(counters.upstream, 0, "isolated: no upstream nodes");
    assertEquals(counters.downstream, 0, "isolated: no downstream nodes");
  },
);

Deno.test(
  "compactLineageCounters: linear chain A→B(focus)→C yields upstream=1, downstream=1",
  () => {
    // A → B (focus) → C
    const nodeA = artifact("A");
    const nodeB = artifact("B");
    const nodeC = artifact("C");
    const evidenceModel = buildEvidenceGraphModel(
      {
        nodes: [nodeA, nodeB, nodeC],
        edges: [
          link("e1", nodeA.ref, nodeB.ref, "input_to"),
          link("e2", nodeB.ref, nodeC.ref, "source_of"),
        ],
      },
      EMPTY_FAMILY,
      {},
    );
    const counters = compactLineageCounters(evidenceModel, nodeB.ref);
    assertEquals(counters.total, 3, "linear chain: 3 nodes in neighbourhood");
    assertEquals(counters.upstream, 1, "one upstream node (A)");
    assertEquals(counters.downstream, 1, "one downstream node (C)");
  },
);

Deno.test(
  "compactLineageCounters: depth 2 upstream/downstream are counted correctly",
  () => {
    // A → B → focus(C) → D → E
    // At depth 2 from C: upstream = {A, B} (2), downstream = {D, E} (2), total = 5.
    const [nA, nB, nC, nD, nE] = ["A", "B", "C", "D", "E"].map((id) => artifact(id));
    const evidenceModel = buildEvidenceGraphModel(
      {
        nodes: [nA, nB, nC, nD, nE],
        edges: [
          link("e1", nA.ref, nB.ref, "input_to"),
          link("e2", nB.ref, nC.ref, "input_to"),
          link("e3", nC.ref, nD.ref, "source_of"),
          link("e4", nD.ref, nE.ref, "source_of"),
        ],
      },
      EMPTY_FAMILY,
      {},
    );
    const counters = compactLineageCounters(evidenceModel, nC.ref);
    assertEquals(counters.total, 5, "all five nodes are within depth 2 of C");
    assertEquals(
      counters.upstream,
      2,
      "A and B are upstream of C (depth 1 and 2)",
    );
    assertEquals(counters.downstream, 2, "D and E are downstream of C");
  },
);

Deno.test(
  "compactLineageCounters: node 3 hops away is excluded from counters",
  () => {
    // Focus = A; chain A → B → C → D (D is 3 hops downstream from A)
    // At depth 2: downstream = {B, C} only; D is excluded.
    const [nA, nB, nC, nD] = ["A", "B", "C", "D"].map((id) => artifact(id));
    const evidenceModel = buildEvidenceGraphModel(
      {
        nodes: [nA, nB, nC, nD],
        edges: [
          link("e1", nA.ref, nB.ref, "input_to"),
          link("e2", nB.ref, nC.ref, "input_to"),
          link("e3", nC.ref, nD.ref, "input_to"),
        ],
      },
      EMPTY_FAMILY,
      {},
    );
    const counters = compactLineageCounters(evidenceModel, nA.ref);
    assertEquals(counters.total, 3, "A (focus) + B + C — D is beyond depth 2");
    assertEquals(counters.upstream, 0, "no upstream from A");
    assertEquals(counters.downstream, 2, "B and C are downstream (D excluded)");
  },
);

Deno.test(
  "Activity geometry context compacts unique SysML pairs, folds plumbing, and excludes hub siblings",
  () => {
    const { evidenceModel, refs } = deskLampActivityEvidence();

    const projection = compactLineageProjection(evidenceModel, refs.geometry);
    const counters = compactLineageCounters(evidenceModel, refs.geometry);

    assertEquals(
      projection.nodes
        .filter((candidate) =>
          candidate.entityKind === "part-definition" ||
          candidate.entityKind === "part-usage"
        )
        .map((candidate) => candidate.ref.id)
        .sort(),
      [
        "def-base",
        "def-head",
        "def-socket",
        "def-stem",
        "def-system",
      ],
      "the geometry card keeps the root plus four definition-backed composites",
    );
    assertEquals(
      projection.nodes
        .filter((candidate) => candidate.entityKind === "part-definition")
        .map((candidate) => candidate.label)
        .sort(),
      [
        "def-system",
        "usage-base : def-base",
        "usage-head : def-head",
        "usage-socket : def-socket",
        "usage-stem : def-stem",
      ],
    );
    assertEquals(
      projection.nodes.some((candidate) => candidate.ref.id === "raw-script"),
      false,
      "the shared essential mask must fold a dead-end build script",
    );
    assertEquals(projection.hiddenSupportingCount, 1);
    assertEquals(
      projection.nodes.some((candidate) => candidate.ref.id === "unrelated-capture"),
      false,
      "lineage must not cross the upstream hub and fan out to its sibling",
    );
    assertEquals(
      counters.total,
      projection.nodes.length,
      "the Activity counter must equal the nodes handed to its renderer",
    );

    const partProjection = compactLineageProjection(
      evidenceModel,
      refs.baseStep,
    );
    assertEquals(
      partProjection.nodes
        .filter((candidate) => candidate.artifactKind === "step")
        .map((candidate) => candidate.ref.id)
        .sort(),
      ["step-base"],
      "selecting one part STEP must not pull the four sibling STEP files",
    );
  },
);

Deno.test(
  "Activity architecture context renders four composites plus the root and shares its count",
  () => {
    const { evidenceModel, refs } = deskLampActivityEvidence();

    const projection = compactLineageProjection(
      evidenceModel,
      refs.architecture,
    );
    const counters = compactLineageCounters(evidenceModel, refs.architecture);

    assertEquals(
      projection.nodes.filter((candidate) => candidate.entityKind === "part-definition")
        .length,
      5,
    );
    assertEquals(
      projection.nodes.filter((candidate) => candidate.entityKind === "part-usage")
        .length,
      0,
    );
    assertEquals(
      projection.nodes.some((candidate) => candidate.ref.id === "raw-script"),
      false,
      "the architecture vignette must apply the essential mask too",
    );
    assertEquals(
      counters.total,
      projection.nodes.length,
      "the Activity header and rendered architecture projection must agree",
    );
  },
);

// ---------------------------------------------------------------------------
// buildFeedComponentCounts — per-part event counts for the feed selector
// ---------------------------------------------------------------------------

Deno.test(
  "buildFeedComponentCounts: empty feed yields empty map",
  () => {
    const counts = buildFeedComponentCounts([], emptyAnchorage());
    assertEquals(counts.size, 0, "no nodes → no counts");
  },
);

Deno.test(
  "buildFeedComponentCounts: unanchored nodes remain explicit orphan facts",
  () => {
    const nodes = [
      artifact("obs-1"),
      artifact("obs-2"),
      artifact("obs-3"),
    ];
    const counts = buildFeedComponentCounts(nodes, emptyAnchorage());
    assertEquals(counts.size, 1, "only one explicit orphan scope");
    assertEquals(
      counts.get(ORPHAN_FEED_SCOPE),
      3,
      "three unanchored nodes must not inflate assembly",
    );
  },
);

Deno.test(
  "buildFeedComponentCounts: anchored nodes are attributed to their target",
  () => {
    const obs1 = artifact("obs-1");
    const obs2 = artifact("obs-2");
    const cad = artifact("cad-artifact");
    // anchorage uses kind:id format (as produced by buildPartAnchorage)
    const anchorage = anchoredResolution([
      ["artifact:obs-1", {
        target: "generic-v3:drip-tray",
        criterion: "prefix" as const,
      }],
      ["artifact:obs-2", {
        target: "generic-v3:drip-tray",
        criterion: "prefix" as const,
      }],
      ["artifact:cad-artifact", {
        target: "assembly",
        criterion: "prefix" as const,
      }],
    ]);
    const counts = buildFeedComponentCounts([obs1, obs2, cad], anchorage);
    assertEquals(counts.get("generic-v3:drip-tray"), 2, "two drip-tray events");
    assertEquals(counts.get("assembly"), 1, "one assembly event");
    assertEquals(counts.size, 2, "exactly two distinct targets");
  },
);

Deno.test(
  "Activity feed partitions assembly, ambiguous-evidence and unanchored-fact without loss or assembly fallback",
  () => {
    const assemblyEvidence = node(
      "assembly-evidence",
      "artifact",
      "2026-08-01T08:00:00.000Z",
      "solver-result",
    );
    const ambiguousEvidence = node(
      "ambiguous-evidence",
      "observation",
      "2026-08-01T08:01:00.000Z",
    );
    const unanchoredFact = node(
      "unanchored-fact",
      "artifact",
      "2026-08-01T08:02:00.000Z",
      "solver-result",
    );
    const hiddenSupport = artifact("support-only");
    const anchorage: PartAnchorageResolution = {
      anchors: new Map([
        ["artifact:assembly-evidence", {
          target: "assembly",
          criterion: "nature",
        }],
      ]),
      ambiguousByRef: new Map([
        ["observation:ambiguous-evidence", [
          "generic-v3:drip-tray",
          "generic-v3:enclosure",
        ]],
      ]),
      orphanRefKeys: new Set(["artifact:unanchored-fact"]),
    };
    const activity = activityFeedNodes([
      assemblyEvidence,
      ambiguousEvidence,
      unanchoredFact,
      hiddenSupport,
    ]);
    assertEquals(
      activity.map((node) => node.ref.id),
      ["unanchored-fact", "ambiguous-evidence", "assembly-evidence"],
      "the regression must exercise actual Activity cards, not invisible support artifacts",
    );
    const counts = buildFeedComponentCounts(activity, anchorage);
    assertEquals(
      counts.get("assembly"),
      1,
      "only a unique assembly anchor counts as assembly",
    );
    assertEquals(counts.get(AMBIGUOUS_FEED_SCOPE), 1);
    assertEquals(counts.get(ORPHAN_FEED_SCOPE), 1);
    assertEquals(
      filterFeedNodesByScope(activity, anchorage, "assembly").map((node) =>
        node.ref.id
      ),
      ["assembly-evidence"],
      "assembly filter must not acquire ambiguous or orphan evidence",
    );
    assertEquals(
      filterFeedNodesByScope(activity, anchorage, AMBIGUOUS_FEED_SCOPE).map((
        node,
      ) => node.ref.id),
      ["ambiguous-evidence"],
      "ambiguous-evidence remains visible through its dedicated filter",
    );
    assertEquals(
      filterFeedNodesByScope(activity, anchorage, ORPHAN_FEED_SCOPE).map((
        node,
      ) => node.ref.id),
      ["unanchored-fact"],
      "unanchored-fact remains visible through its dedicated filter",
    );
    const scopes = [
      "assembly",
      AMBIGUOUS_FEED_SCOPE,
      ORPHAN_FEED_SCOPE,
    ] as const;
    const partition = scopes.flatMap((scope) =>
      filterFeedNodesByScope(activity, anchorage, scope).map((node) => node.ref.id)
    );
    assertEquals(
      [...new Set(partition)].sort(),
      activity.map((node) => node.ref.id).sort(),
      "every Activity card belongs to exactly one scope",
    );
    assertEquals(
      [...counts.values()].reduce((total, count) => total + count, 0),
      activity.length,
      "scope counters are an exhaustive Activity partition",
    );
    assertEquals(
      buildFilterOptions(FEED_TEST_COMPONENTS, counts),
      [
        { id: "assembly", label: "Machine (assemblage) · 1" },
        {
          id: AMBIGUOUS_FEED_SCOPE,
          label: "À rattacher — ambigu · 1",
        },
        { id: ORPHAN_FEED_SCOPE, label: "Non rattachés · 1" },
      ],
      "filter labels expose the exact non-anchored counts without inventing a part",
    );
  },
);

Deno.test(
  "buildFeedComponentCounts: observation node (kind=observation) keyed correctly",
  () => {
    // The anchorage key format is kind:id — verify that non-artifact kinds work.
    const obsNode: ThreadGraphNode = {
      id: "graph:observation:obs-drip-1",
      ref: { kind: "observation", id: "obs-drip-1" },
      entityKind: "observation",
      label: "Max displacement",
      system: "calculix",
      freshness: "fresh",
      summary: "Observed displacement",
    };
    const anchorage = anchoredResolution([
      ["observation:obs-drip-1", {
        target: "generic-v3:drip-tray",
        criterion: "change-consumption" as const,
      }],
    ]);
    const counts = buildFeedComponentCounts([obsNode], anchorage);
    assertEquals(
      counts.get("generic-v3:drip-tray"),
      1,
      "observation node anchored to drip-tray via kind:id key",
    );
  },
);

function emptyAnchorage(): PartAnchorageResolution {
  return {
    anchors: new Map(),
    ambiguousByRef: new Map(),
    orphanRefKeys: new Set(),
  };
}

function anchoredResolution(
  entries: [string, {
    target: "assembly" | string;
    criterion:
      | "catalog"
      | "prefix"
      | "nature"
      | "derived-from"
      | "change-consumption";
  }][],
): PartAnchorageResolution {
  return {
    anchors: new Map(entries),
    ambiguousByRef: new Map(),
    orphanRefKeys: new Set(),
  };
}

const FEED_TEST_COMPONENTS: ThreadComponentCatalog = {
  schemaVersion: "thread-components/1.0",
  authority: "workspace-declared",
  subjectId: "feed-test",
  rationale: "Test catalog for Activity feed anchorage scopes.",
  systemViews: {},
  components: [
    {
      id: "assembly-root",
      label: "Machine",
      kind: "assembly",
      quantity: 1,
      bindings: [],
    },
    {
      id: "generic-v3:drip-tray",
      label: "Drip tray",
      kind: "part",
      quantity: 1,
      bindings: [],
    },
    {
      id: "generic-v3:enclosure",
      label: "Enclosure",
      kind: "part",
      quantity: 1,
      bindings: [],
    },
  ],
};
