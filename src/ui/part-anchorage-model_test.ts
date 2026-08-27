/**
 * Tests for part-anchorage-model.ts
 *
 * The fixture topology is derived from the real GEN-01 V3 projection captured at
 * revision 18 of the primary workspace (http://127.0.0.1:5173/api/thread/workbench,
 * 2026-08-07, 175 nodes / 256 edges). Real artifact IDs are used so that the
 * prefix-table entries and catalog bindings can be verified against the server-fixed
 * naming contracts cited in the source comments of part-anchorage-model.ts.
 *
 * The fixture is a representative subset (21 nodes) used to compare its
 * preserved exact catalog/provenance against active generic anchorage:
 *   (a) catalog evidenceArtifactId binding
 *   (b) assembly-level nature
 *   (c) transitive derived_from propagation
 *   (d) change / consumption / adjacent inheritance
 *   (e) generic server-fixed forms
 *
 * Invariants under test:
 *  1. The historic-only facts remain unanchored rather than selecting GEN-01.
 *  2. The formerly-ambiguous R3 whole-assembly artifacts (plan, script, step)
 *     resolve to "assembly" via catalog after commit 0473bc1.
 *  3. The R3 drip-tray presentation mesh resolves to "generic-v3:drip-tray" via catalog.
 *  4. Exact catalog and provenance still cover the retained fixture topology.
 *  5. buildPartAnchorage is deterministic: two calls on the same input are identical.
 */

import { assertEquals } from "@std/assert";
import {
  anchorageCoverage,
  anchorFamilyByPrefix,
  buildPartAnchorage,
  buildPartAnchorageResolution,
} from "./src/thread/part-anchorage-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Stable IDs derived from the real GEN-01 V3 projection (2026-08-07, R18)
//
// The R3 capture digest and the architecture digest are server-fixed — they are
// the actual immutable hashes produced by the run executors and stored in the
// thread snapshot. Changing them would break the catalog binding contract.
// ---------------------------------------------------------------------------

const R3_DIGEST = "8484b759a788c018477f062863aff5f5a3ebaf06d28c5045534fb716c19d58f3";
const R3 = `generic-product-v3-cad-r3-${R3_DIGEST}`;

const ARCH_ID =
  "generic-product-v3-architecture-b4c805a45d9f3ac9ae67318d2822804ceaaa00e121b7079e13c62dce38d4add7";
const MECH_R3_PROOF_ID =
  "generic-product-v3-mechanical-r3-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-proof";
const ORACLE_REQ_ID =
  "oracle-requirements-944e2515fb349d631e9aa4d85a3b9394420990c9610d5dfff8c290f032d633e3";
const SENS_REL_ID =
  "sensitivity-relations-5e5f8384c2ca67297de6ccfa56d89a200b521f021459eefc711dc7e2dcec1a51";
const SYSON_SEED_ID =
  "syson-model-seed-10b6ed25982ee46be9006afb41eb61ab37859c2c9119f9dc498f1cb822556db6";
const DT_SENS_CAPTURE_ID =
  "drip-tray-sensitivity-bacc1c4ef2c0154ca71e72bf4e517290ce2c30aedb4702f724c3cf89d2cadc7e-capture";
const MODELICA_SCENARIO_ID =
  "modelica-run-c5969d95-db98-41a0-9109-facf9bd7a7a4-scenario-5";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function node(
  id: string,
  kind: ThreadGraphRef["kind"],
  opts: {
    artifactKind?: string;
    system?: string;
    freshness?: "fresh" | "stale";
  },
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(opts.artifactKind !== undefined ? { artifactKind: opts.artifactKind } : {}),
    label: id.slice(-24),
    system: opts.system ?? "digital-thread",
    freshness: opts.freshness ?? "fresh",
    summary: `${kind} · ${id.slice(-24)}`,
  };
}

function edge(
  id: string,
  fromKind: ThreadGraphRef["kind"],
  fromId: string,
  toKind: ThreadGraphRef["kind"],
  toId: string,
  relation: ThreadGraphEdge["relation"],
): ThreadGraphEdge {
  return {
    id,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation,
    rationale: id,
    origin: "provenance",
  };
}

function catalogBinding(
  evidenceArtifactId: string,
  provider: "syson" | "build123d" | "digital-thread" = "build123d",
  id = evidenceArtifactId,
): {
  provider: "syson" | "build123d" | "digital-thread";
  kind: "artifact";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified";
} {
  return {
    provider,
    kind: "artifact",
    id,
    label: id.slice(-24),
    evidenceArtifactId,
    status: "verified",
  };
}

// ---------------------------------------------------------------------------
// Representative fixture topology
//
// 21 nodes derived from the real GEN-01 V3 graph, chosen so that each
// anchorage criterion fires at least once.  Change and consumption nodes
// use the real IDs produced by the @3 CAD run executor.
// ---------------------------------------------------------------------------

const FIXTURE_GRAPH: ThreadGraph = {
  nodes: [
    // ── Criterion (a): catalog bindings ─────────────────────────────────────

    // R3 whole-assembly artifacts — formerly ambiguous, now in assembly bindings
    // after commit 0473bc1.  These are the exact ids used in the catalog below.
    node(`${R3}-plan`, "artifact", { artifactKind: "document" }),
    node(`${R3}-script`, "artifact", { artifactKind: "script" }),
    node(`${R3}-step`, "artifact", { artifactKind: "step" }),
    node(`${R3}-mesh-assembly`, "artifact", { artifactKind: "mesh" }),
    node(`${R3}-mesh-drip-tray`, "artifact", { artifactKind: "mesh" }),
    node(`${R3}-mesh-enclosure`, "artifact", { artifactKind: "mesh" }),

    // Architecture artifact — present in every component's syson binding;
    // last-writer-wins in buildCatalogMap gives it generic-v3:drip-tray.
    node(ARCH_ID, "artifact", { artifactKind: "sysml-model", system: "syson" }),

    // ── Criterion (b): server-fixed prefix table ─────────────────────────────
    node(ORACLE_REQ_ID, "artifact", {
      artifactKind: "sysml-model",
      system: "syson",
    }),
    node(SENS_REL_ID, "artifact", {
      artifactKind: "sysml-model",
      system: "syson",
    }),
    // Mechanical R3 — prefix b-10 → generic-v3:drip-tray
    node(MECH_R3_PROOF_ID, "artifact", { artifactKind: "document" }),
    // DripTray sensitivity study — prefix b-13 → generic-v3:drip-tray
    node(DT_SENS_CAPTURE_ID, "artifact", { artifactKind: "document" }),

    // ── Criterion (c): machine-level nature ─────────────────────────────────
    // SysON model seed — kind sysml-model, not in catalog → nature → assembly
    node(SYSON_SEED_ID, "artifact", {
      artifactKind: "sysml-model",
      system: "syson",
    }),
    // Modelica thermal artifact — system mcp-modelica → nature → assembly
    node(MODELICA_SCENARIO_ID, "artifact", {
      artifactKind: "evidence",
      system: "mcp-modelica",
    }),

    // ── Criterion (e): change / consumption inheritance ──────────────────────
    // Change nodes inherit from the artifact at the `to` end of a `changes` edge.
    node(
      `${R3}-extension:created:${R3}-plan`,
      "change",
      {},
    ),
    node(
      `${R3}-extension:created:${R3}-script`,
      "change",
      {},
    ),
    node(
      `${R3}-extension:created:${R3}-step`,
      "change",
      {},
    ),
    node(
      `${R3}-extension:created:${R3}-mesh-drip-tray`,
      "change",
      {},
    ),

    // Consumption nodes inherit from the artifact at the `from` end of a `uses` edge.
    node(`${R3}-consumes-architecture`, "consumption", {}),
    node(`${R3}-consumes-plan`, "consumption", {}),
    node(`${R3}-consumes-script`, "consumption", {}),
  ],
  edges: [
    // Change → artifact (changes relation)
    edge(
      "e-chg-plan",
      "change",
      `${R3}-extension:created:${R3}-plan`,
      "artifact",
      `${R3}-plan`,
      "changes",
    ),
    edge(
      "e-chg-script",
      "change",
      `${R3}-extension:created:${R3}-script`,
      "artifact",
      `${R3}-script`,
      "changes",
    ),
    edge(
      "e-chg-step",
      "change",
      `${R3}-extension:created:${R3}-step`,
      "artifact",
      `${R3}-step`,
      "changes",
    ),
    edge(
      "e-chg-mesh-dt",
      "change",
      `${R3}-extension:created:${R3}-mesh-drip-tray`,
      "artifact",
      `${R3}-mesh-drip-tray`,
      "changes",
    ),

    // Artifact → consumption (uses relation)
    edge(
      "e-uses-arch",
      "artifact",
      ARCH_ID,
      "consumption",
      `${R3}-consumes-architecture`,
      "uses",
    ),
    edge(
      "e-uses-plan",
      "artifact",
      `${R3}-plan`,
      "consumption",
      `${R3}-consumes-plan`,
      "uses",
    ),
    edge(
      "e-uses-script",
      "artifact",
      `${R3}-script`,
      "consumption",
      `${R3}-consumes-script`,
      "uses",
    ),
  ],
};

// The catalog mirrors the live GEN-01 V3 catalog (R18).
//
// Key bindings exercised:
//   - Assembly gets architecture (syson), mesh-assembly, plan, script, step.
//   - Enclosure and drip-tray each re-bind architecture (same evidenceArtifactId)
//     so that the last-writer-wins behaviour of buildCatalogMap is observable.
//   - Drip-tray gets mesh-drip-tray; enclosure gets mesh-enclosure.
//
// Note: the architecture artifact appears in all three components' bindings.
// buildCatalogMap processes components in order (assembly → enclosure → drip-tray)
// so the architecture id ends up mapped to generic-v3:drip-tray.
const FIXTURE_CATALOG: ThreadComponentCatalog = {
  schemaVersion: "thread-components/1.0",
  authority: "workspace-declared",
  subjectId: "project:generic-product-v3",
  rationale:
    "Representative fixture catalog derived from the live GEN-01 V3 workspace (2026-08-07, R18).",
  systemViews: {},
  components: [
    {
      id: "generic-v3:generic-product",
      label: "GenericAssembly",
      kind: "assembly",
      quantity: 1,
      bindings: [
        catalogBinding(ARCH_ID, "syson"),
        catalogBinding(`${R3}-mesh-assembly`),
        catalogBinding(`${R3}-plan`, "digital-thread"),
        catalogBinding(`${R3}-script`, "digital-thread"),
        catalogBinding(`${R3}-step`),
      ],
    },
    {
      id: "generic-v3:enclosure",
      label: "Enclosure",
      kind: "part",
      quantity: 1,
      parentId: "generic-v3:generic-product",
      bindings: [
        catalogBinding(ARCH_ID, "syson"),
        catalogBinding(`${R3}-mesh-enclosure`),
      ],
    },
    {
      id: "generic-v3:drip-tray",
      label: "DripTray",
      kind: "part",
      quantity: 1,
      parentId: "generic-v3:generic-product",
      bindings: [
        catalogBinding(ARCH_ID, "syson"),
        catalogBinding(`${R3}-mesh-drip-tray`),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "archived fixture retains exact catalog anchors while legacy-only records stay unanchored",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const coverage = anchorageCoverage(map, FIXTURE_GRAPH);
    assertEquals(coverage, { unique: 17, ambiguous: 1, orphan: 2 });
  },
);

Deno.test(
  "R3 whole-assembly plan, script and step resolve to assembly via catalog criterion",
  () => {
    // These three artifacts were the formerly-ambiguous 'derived_from'-conflicted
    // nodes before commit 0473bc1 anchored them explicitly in the assembly catalog
    // bindings.  After the commit the catalog criterion fires first and wins.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);

    const planAnchor = map.get(`artifact:${R3}-plan`);
    const scriptAnchor = map.get(`artifact:${R3}-script`);
    const stepAnchor = map.get(`artifact:${R3}-step`);

    assertEquals(
      planAnchor?.target,
      "assembly",
      "R3 plan must be anchored to assembly",
    );
    assertEquals(
      planAnchor?.criterion,
      "catalog",
      "R3 plan must be resolved by catalog criterion",
    );
    assertEquals(
      scriptAnchor?.target,
      "assembly",
      "R3 script must be anchored to assembly",
    );
    assertEquals(
      scriptAnchor?.criterion,
      "catalog",
      "R3 script must be resolved by catalog criterion",
    );
    assertEquals(
      stepAnchor?.target,
      "assembly",
      "R3 step must be anchored to assembly",
    );
    assertEquals(
      stepAnchor?.criterion,
      "catalog",
      "R3 step must be resolved by catalog criterion",
    );
  },
);

Deno.test(
  "R3 drip-tray presentation mesh resolves to generic-v3:drip-tray via catalog criterion",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${R3}-mesh-drip-tray`);
    assertEquals(anchor?.target, "generic-v3:drip-tray");
    assertEquals(anchor?.criterion, "catalog");
  },
);

Deno.test(
  "archived fixture coverage depends on exact catalog and provenance, not legacy prefixes",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const coverage = anchorageCoverage(map, FIXTURE_GRAPH);
    assertEquals(coverage.unique, 17);
    assertEquals(coverage.ambiguous + coverage.orphan, 3);
  },
);

Deno.test(
  "buildPartAnchorage is deterministic — two calls on the same inputs yield identical maps",
  () => {
    const map1 = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const map2 = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);

    assertEquals(map1.size, map2.size, "map sizes must match");
    for (const [key, anchor1] of map1) {
      const anchor2 = map2.get(key);
      assertEquals(
        anchor2?.target,
        anchor1.target,
        `target for ${key} must be stable`,
      );
      assertEquals(
        anchor2?.criterion,
        anchor1.criterion,
        `criterion for ${key} must be stable`,
      );
    }
  },
);

Deno.test("buildPartAnchorage is invariant to graph and catalog permutations", () => {
  const baseline = [...buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG)]
    .sort();
  const permutedGraph: ThreadGraph = {
    ...FIXTURE_GRAPH,
    nodes: [...FIXTURE_GRAPH.nodes].reverse(),
    edges: [...FIXTURE_GRAPH.edges].reverse(),
  };
  const permutedCatalog: ThreadComponentCatalog = {
    ...FIXTURE_CATALOG,
    components: [...FIXTURE_CATALOG.components].reverse(),
  };
  assertEquals(
    [...buildPartAnchorage(permutedGraph, permutedCatalog)].sort(),
    baseline,
  );
});

Deno.test("anchorage retains conflict targets and distinguishes ambiguous from orphan", () => {
  const graph: ThreadGraph = {
    nodes: [
      node("ambiguous-evidence", "artifact", { artifactKind: "document" }),
      node("unanchored-fact", "observation", { system: "calculix" }),
    ],
    edges: [],
  };
  const catalog: ThreadComponentCatalog = {
    ...FIXTURE_CATALOG,
    components: FIXTURE_CATALOG.components.map((component) => ({
      ...component,
      bindings: component.kind === "part" ? [catalogBinding("ambiguous-evidence")] : [],
    })),
  };
  const resolution = buildPartAnchorageResolution(graph, catalog);
  const coverage = anchorageCoverage(resolution.anchors, graph);
  assertEquals(resolution.anchors.size, 0);
  assertEquals(
    resolution.ambiguousByRef.get("artifact:ambiguous-evidence"),
    ["generic-v3:drip-tray", "generic-v3:enclosure"],
  );
  assertEquals(
    resolution.orphanRefKeys.has("observation:unanchored-fact"),
    true,
  );
  assertEquals(coverage, { unique: 0, ambiguous: 1, orphan: 1 });

  const permuted = buildPartAnchorageResolution(
    {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    },
    { ...catalog, components: [...catalog.components].reverse() },
  );
  assertEquals(
    [...permuted.ambiguousByRef.entries()],
    [...resolution.ambiguousByRef.entries()],
  );
  assertEquals([...permuted.orphanRefKeys], [...resolution.orphanRefKeys]);
});

Deno.test(
  "archived mechanical proof does not receive an active product-prefix anchor",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${MECH_R3_PROOF_ID}`);
    assertEquals(anchor, undefined);
  },
);

Deno.test(
  "archived requirements artifact keeps only its generic assembly nature",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${ORACLE_REQ_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "nature");
  },
);

Deno.test(
  "archived sensitivity artifact keeps only its generic assembly nature",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${SENS_REL_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "nature");
  },
);

Deno.test(
  "archived sensitivity capture does not receive an active product-prefix anchor",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${DT_SENS_CAPTURE_ID}`);
    assertEquals(anchor, undefined);
  },
);

Deno.test(
  "syson model seed resolves to assembly via nature criterion (sysml-model, not in catalog)",
  () => {
    // syson-model-seed is a sysml-model artifact from the syson system.
    // It is not bound in the catalog (only the architecture artifact is in catalog).
    // Criterion (c) fires: k === "sysml-model" → "assembly".
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${SYSON_SEED_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "nature");
  },
);

Deno.test(
  "Modelica artifact resolves to assembly via nature criterion (thermal system)",
  () => {
    // system === "mcp-modelica" → nature criterion returns "assembly".
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${MODELICA_SCENARIO_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "nature");
  },
);

Deno.test(
  "shared architecture capture remains ambiguous across catalog components",
  () => {
    const resolution = buildPartAnchorageResolution(
      FIXTURE_GRAPH,
      FIXTURE_CATALOG,
    );
    assertEquals(resolution.anchors.has(`artifact:${ARCH_ID}`), false);
    assertEquals(resolution.ambiguousByRef.get(`artifact:${ARCH_ID}`), [
      "assembly",
      "generic-v3:drip-tray",
      "generic-v3:enclosure",
    ]);
  },
);

Deno.test(
  "R3 plan change node resolves to assembly via change-consumption criterion (e)",
  () => {
    // change --changes--> artifact:plan (assembly) → change inherits assembly.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const changeKey = `change:${R3}-extension:created:${R3}-plan`;
    const anchor = map.get(changeKey);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "change-consumption");
  },
);

Deno.test(
  "R3 mesh-drip-tray change node resolves to generic-v3:drip-tray via criterion (e)",
  () => {
    // change --changes--> artifact:mesh-drip-tray (generic-v3:drip-tray).
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const changeKey = `change:${R3}-extension:created:${R3}-mesh-drip-tray`;
    const anchor = map.get(changeKey);
    assertEquals(anchor?.target, "generic-v3:drip-tray");
    assertEquals(anchor?.criterion, "change-consumption");
  },
);

Deno.test(
  "R3 consumes-plan consumption node resolves to assembly via criterion (e)",
  () => {
    // artifact:plan --uses--> consumption:consumes-plan → consumption inherits plan → assembly.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const consumptionKey = `consumption:${R3}-consumes-plan`;
    const anchor = map.get(consumptionKey);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "change-consumption");
  },
);

Deno.test(
  "R3 consumes-architecture consumption node resolves to assembly via criterion (e)",
  () => {
    // artifact:architecture now resolves to assembly (catalog assembly-wins merge).
    // The consumption node inherits from it via criterion (e) → assembly.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const consumptionKey = `consumption:${R3}-consumes-architecture`;
    const anchor = map.get(consumptionKey);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "change-consumption");
  },
);

// ---------------------------------------------------------------------------
// Archived isolated records must remain unanchored without an exact catalog
// binding or recorded provenance. The graphs below are intentionally minimal.
// ---------------------------------------------------------------------------

Deno.test(
  "archived correction action is not selected by a product-specific fallback",
  () => {
    // Action node generated by generic-drip-tray-height-correction.ts:38,143.
    // Id: generic-product-v3-drip-tray-height-28-to-30:recompute-cad-r2
    const ACTION_ID = "generic-product-v3-drip-tray-height-28-to-30:recompute-cad-r2";
    const g: ThreadGraph = {
      nodes: [
        {
          id: `graph:action:${ACTION_ID}`,
          ref: { kind: "action", id: ACTION_ID },
          entityKind: "action",
          label: ACTION_ID.slice(-30),
          system: "digital-thread",
          freshness: "fresh",
          summary: ACTION_ID.slice(-30),
        },
      ],
      edges: [],
    };
    const map = buildPartAnchorage(g, FIXTURE_CATALOG);
    const anchor = map.get(`action:${ACTION_ID}`);
    assertEquals(anchor, undefined);
  },
);

Deno.test(
  "archived verification queue is not selected by a product-specific fallback",
  () => {
    // Artifact node whose run-id is defined in generic-v3-r11-closeout.ts:19.
    // Id: run:generic-v3-r7-r10-28-to-30-queue-mechanical-r2:verify.generic-product-drip-tray-mechanical
    const RUN_ARTIFACT_ID =
      "run:generic-v3-r7-r10-28-to-30-queue-mechanical-r2:verify.generic-product-drip-tray-mechanical";
    const g: ThreadGraph = {
      nodes: [
        {
          id: `graph:artifact:${RUN_ARTIFACT_ID}`,
          ref: { kind: "artifact", id: RUN_ARTIFACT_ID },
          entityKind: "artifact",
          label: RUN_ARTIFACT_ID.slice(-30),
          system: "digital-thread",
          freshness: "fresh",
          summary: RUN_ARTIFACT_ID.slice(-30),
        },
      ],
      edges: [],
    };
    const map = buildPartAnchorage(g, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${RUN_ARTIFACT_ID}`);
    assertEquals(anchor, undefined);
  },
);

Deno.test(
  "archived printability run is not selected by a product-specific fallback",
  () => {
    // Artifact node whose id ends with :drip-tray-printability. That suffix is
    // a historical product-specific leftover, not a live executor identity.
    // The runId prefix is variable (operator-supplied at dispatch time).
    const RUN_ARTIFACT_ID =
      "run:cmd:anchor-seq-b-printability-queue-20260805:drip-tray-printability";
    const g: ThreadGraph = {
      nodes: [
        {
          id: `graph:artifact:${RUN_ARTIFACT_ID}`,
          ref: { kind: "artifact", id: RUN_ARTIFACT_ID },
          entityKind: "artifact",
          label: RUN_ARTIFACT_ID.slice(-30),
          system: "digital-thread",
          freshness: "fresh",
          summary: RUN_ARTIFACT_ID.slice(-30),
        },
      ],
      edges: [],
    };
    const map = buildPartAnchorage(g, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${RUN_ARTIFACT_ID}`);
    assertEquals(anchor, undefined);
  },
);

// ---------------------------------------------------------------------------
// Tests for generic multi-project prefixes (b-1 … b-6)
//
// These isolated single-node graphs exercise the generic entries that apply
// to any active project.
// ---------------------------------------------------------------------------

Deno.test(
  "generic fea-proof artifact resolves to assembly via prefix criterion (b-3)",
  () => {
    // verify-seal-proof-case-run-executor.ts:508
    //   artifactId = `fea-proof-${captureFp.digest}`
    const FP = "a".repeat(64); // synthetic 64-char hex digest
    const FEA_PROOF_ID = `fea-proof-${FP}`;
    const g: ThreadGraph = {
      nodes: [
        {
          id: `graph:artifact:${FEA_PROOF_ID}`,
          ref: { kind: "artifact", id: FEA_PROOF_ID },
          entityKind: "artifact",
          artifactKind: "document",
          label: FEA_PROOF_ID.slice(-30),
          system: "digital-thread",
          freshness: "fresh",
          summary: FEA_PROOF_ID.slice(-30),
        },
      ],
      edges: [],
    };
    const map = buildPartAnchorage(g, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${FEA_PROOF_ID}`);
    assertEquals(
      anchor?.target,
      "assembly",
      "fea-proof-<hex> must resolve to assembly",
    );
    assertEquals(anchor?.criterion, "prefix");
  },
);

Deno.test(
  "generic geometry artifact resolves to assembly via prefix criterion (b-2)",
  () => {
    // design-write-geometry-run-executor.ts:1525
    //   artifact.id !== `geometry-${digest}`
    const FP = "b".repeat(64);
    const GEOMETRY_ID = `geometry-${FP}`;
    const g: ThreadGraph = {
      nodes: [
        {
          id: `graph:artifact:${GEOMETRY_ID}`,
          ref: { kind: "artifact", id: GEOMETRY_ID },
          entityKind: "artifact",
          artifactKind: "cad-model",
          label: GEOMETRY_ID.slice(-30),
          system: "digital-thread",
          freshness: "fresh",
          summary: GEOMETRY_ID.slice(-30),
        },
      ],
      edges: [],
    };
    const map = buildPartAnchorage(g, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${GEOMETRY_ID}`);
    assertEquals(
      anchor?.target,
      "assembly",
      "geometry-<hex> must resolve to assembly",
    );
    assertEquals(anchor?.criterion, "prefix");
  },
);

Deno.test(
  "a digital-thread binding id anchors its exact component while the shared capture stays ambiguous and carries its FEA lineage",
  () => {
    const digest = "c".repeat(64);
    const stepId = "artifact:build123d:articulated-arm:step:v7";
    const sharedCaptureId = `geometry-${digest}`;
    const proofId = `fea-proof-${digest}`;
    const resultId = `fea-solver-result-${digest}`;
    const verdictId = `fea-verdict-${digest}`;
    const observationId = `fea-observation-${digest}-stress`;
    const graph: ThreadGraph = {
      nodes: [
        node(stepId, "artifact", { artifactKind: "step" }),
        node(sharedCaptureId, "artifact", { artifactKind: "cad-model" }),
        node(proofId, "artifact", { artifactKind: "document" }),
        node(resultId, "artifact", { artifactKind: "solver-result" }),
        node(verdictId, "artifact", { artifactKind: "document" }),
        node(observationId, "observation", { system: "calculix" }),
      ],
      edges: [
        edge(
          "step-to-proof",
          "artifact",
          stepId,
          "artifact",
          proofId,
          "derived_from",
        ),
        edge(
          "step-to-result",
          "artifact",
          stepId,
          "artifact",
          resultId,
          "derived_from",
        ),
        edge(
          "result-to-verdict",
          "artifact",
          resultId,
          "artifact",
          verdictId,
          "derived_from",
        ),
        edge(
          "result-to-observation",
          "artifact",
          resultId,
          "observation",
          observationId,
          "derived_from",
        ),
      ],
    };
    const catalog: ThreadComponentCatalog = {
      ...FIXTURE_CATALOG,
      components: [
        {
          id: "robot:articulated-arm",
          label: "ArticulatedArm",
          kind: "part",
          quantity: 1,
          bindings: [
            catalogBinding(sharedCaptureId, "digital-thread", stepId),
          ],
        },
        {
          id: "robot:gripper",
          label: "Gripper",
          kind: "part",
          quantity: 1,
          bindings: [
            catalogBinding(
              sharedCaptureId,
              "digital-thread",
              "artifact:build123d:gripper:step:v7",
            ),
          ],
        },
      ],
    };

    const resolution = buildPartAnchorageResolution(graph, catalog);
    for (const id of [stepId, proofId, resultId, verdictId, observationId]) {
      assertEquals(
        resolution.anchors.get(
          `${id === observationId ? "observation" : "artifact"}:${id}`,
        )?.target,
        "robot:articulated-arm",
        `${id} must retain ArticulatedArm as its target`,
      );
    }
    assertEquals(resolution.ambiguousByRef.get(`artifact:${sharedCaptureId}`), [
      "robot:articulated-arm",
      "robot:gripper",
    ]);
  },
);

Deno.test(
  "generic architecture SysML seal document resolves to assembly via prefix (b-7)",
  () => {
    const digest = "e".repeat(64);
    const sealId = `architecture-sysml-seal-${digest}`;
    const graph: ThreadGraph = {
      nodes: [
        node(sealId, "artifact", { artifactKind: "document" }),
      ],
      edges: [],
    };
    const map = buildPartAnchorage(graph, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${sealId}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "prefix");
    assertEquals(anchorFamilyByPrefix(sealId), "architecture-sysml-seal");
  },
);

Deno.test(
  "architecture SysML seal prefix never anchors a non-document or invents a part",
  () => {
    const digest = "f".repeat(64);
    const sealId = `architecture-sysml-seal-${digest}`;
    const graph: ThreadGraph = {
      nodes: [
        node(sealId, "artifact", { artifactKind: "script" }),
        {
          id: "graph:part-definition:invented",
          ref: { kind: "part-definition", id: sealId },
          entityKind: "part-definition",
          label: "Invented",
          system: "syson",
          freshness: "fresh",
          summary: "must stay orphan",
        },
      ],
      edges: [],
    };
    const resolution = buildPartAnchorageResolution(graph, FIXTURE_CATALOG);
    assertEquals(resolution.anchors.has(`artifact:${sealId}`), false);
    assertEquals(
      resolution.orphanRefKeys.has(`part-definition:${sealId}`),
      true,
    );
  },
);

Deno.test(
  "generic-looking observations and actions never become assembly anchors",
  () => {
    const digest = "d".repeat(64);
    const graph: ThreadGraph = {
      nodes: [
        node("requirements-agent-note", "observation", { system: "syson" }),
        node("architecture-freeform-draft", "action", { system: "syson" }),
        node(`fea-proof-${digest}`, "observation", { system: "calculix" }),
      ],
      edges: [],
    };
    const resolution = buildPartAnchorageResolution(graph, FIXTURE_CATALOG);
    assertEquals(resolution.anchors.size, 0);
    assertEquals(
      resolution.orphanRefKeys,
      new Set([
        "observation:requirements-agent-note",
        "action:architecture-freeform-draft",
        `observation:fea-proof-${digest}`,
      ]),
    );
  },
);
