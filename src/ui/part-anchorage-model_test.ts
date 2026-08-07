/**
 * Tests for part-anchorage-model.ts
 *
 * The fixture topology is derived from the real CM-01 V3 projection captured at
 * revision 18 of the primary workspace (http://127.0.0.1:5173/api/thread/workbench,
 * 2026-08-07, 175 nodes / 256 edges). Real artifact IDs are used so that the
 * prefix-table entries and catalog bindings can be verified against the server-fixed
 * naming contracts cited in the source comments of part-anchorage-model.ts.
 *
 * The fixture is a representative subset (21 nodes) covering every anchorage
 * criterion in order:
 *   (a) catalog evidenceArtifactId binding
 *   (b) server-fixed prefix table
 *   (c) machine-level nature
 *   (d) transitive derived_from propagation
 *   (e) change / consumption / adjacent inheritance
 *
 * Invariants under test:
 *  1. Zero orphan count — the implementation is designed to cover all node kinds.
 *  2. The formerly-ambiguous R3 whole-assembly artifacts (plan, script, step)
 *     resolve to "assembly" via catalog after commit 0473bc1.
 *  3. The R3 drip-tray presentation mesh resolves to "cm01-v3:drip-tray" via catalog.
 *  4. Unique anchorage coverage is >= 95 % on the fixture topology.
 *  5. buildPartAnchorage is deterministic: two calls on the same input are identical.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import {
  anchorageCoverage,
  buildPartAnchorage,
} from "./src/thread/part-anchorage-model.ts";
import type {
  ThreadComponentCatalog,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Stable IDs derived from the real CM-01 V3 projection (2026-08-07, R18)
//
// The R3 capture digest and the architecture digest are server-fixed — they are
// the actual immutable hashes produced by the run executors and stored in the
// thread snapshot. Changing them would break the catalog binding contract.
// ---------------------------------------------------------------------------

const R3_DIGEST = "8484b759a788c018477f062863aff5f5a3ebaf06d28c5045534fb716c19d58f3";
const R3 = `coffee-machine-cm01-v3-cad-r3-${R3_DIGEST}`;

const ARCH_ID =
  "coffee-machine-cm01-v3-architecture-b4c805a45d9f3ac9ae67318d2822804ceaaa00e121b7079e13c62dce38d4add7";
const MECH_R3_PROOF_ID =
  "coffee-machine-cm01-v3-mechanical-r3-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-proof";
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
    id: evidenceArtifactId,
    label: evidenceArtifactId.slice(-24),
    evidenceArtifactId,
    status: "verified",
  };
}

// ---------------------------------------------------------------------------
// Representative fixture topology
//
// 21 nodes derived from the real CM-01 V3 graph, chosen so that each
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
    // last-writer-wins in buildCatalogMap gives it cm01-v3:drip-tray.
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
    // Mechanical R3 — prefix b-10 → cm01-v3:drip-tray
    node(MECH_R3_PROOF_ID, "artifact", { artifactKind: "document" }),
    // DripTray sensitivity study — prefix b-13 → cm01-v3:drip-tray
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

// The catalog mirrors the live CM-01 V3 catalog (R18).
//
// Key bindings exercised:
//   - Assembly gets architecture (syson), mesh-assembly, plan, script, step.
//   - Enclosure and drip-tray each re-bind architecture (same evidenceArtifactId)
//     so that the last-writer-wins behaviour of buildCatalogMap is observable.
//   - Drip-tray gets mesh-drip-tray; enclosure gets mesh-enclosure.
//
// Note: the architecture artifact appears in all three components' bindings.
// buildCatalogMap processes components in order (assembly → enclosure → drip-tray)
// so the architecture id ends up mapped to cm01-v3:drip-tray.
const FIXTURE_CATALOG: ThreadComponentCatalog = {
  schemaVersion: "thread-components/1.0",
  authority: "workspace-declared",
  subjectId: "project:coffee-machine-cm01-v3",
  rationale:
    "Representative fixture catalog derived from the live CM-01 V3 workspace (2026-08-07, R18).",
  systemViews: {},
  components: [
    {
      id: "cm01-v3:coffee-machine",
      label: "CoffeeMachine",
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
      id: "cm01-v3:enclosure",
      label: "Enclosure",
      kind: "part",
      quantity: 1,
      parentId: "cm01-v3:coffee-machine",
      bindings: [
        catalogBinding(ARCH_ID, "syson"),
        catalogBinding(`${R3}-mesh-enclosure`),
      ],
    },
    {
      id: "cm01-v3:drip-tray",
      label: "DripTray",
      kind: "part",
      quantity: 1,
      parentId: "cm01-v3:coffee-machine",
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
  "fixture topology yields zero orphans and zero ambiguous nodes",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const coverage = anchorageCoverage(map, FIXTURE_GRAPH);
    assertEquals(coverage.orphan, 0, "orphan count must be zero");
    assertEquals(
      coverage.ambiguous,
      0,
      `ambiguous count must be zero; ${coverage.ambiguous} nodes remain unresolved`,
    );
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
  "R3 drip-tray presentation mesh resolves to cm01-v3:drip-tray via catalog criterion",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${R3}-mesh-drip-tray`);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
    assertEquals(anchor?.criterion, "catalog");
  },
);

Deno.test(
  "unique anchorage coverage is at least 95 % on the representative fixture",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const coverage = anchorageCoverage(map, FIXTURE_GRAPH);
    const totalNodes = FIXTURE_GRAPH.nodes.length;
    // unique + ambiguous + orphan === totalNodes (orphan always 0 by convention)
    assertGreaterOrEqual(
      coverage.unique,
      Math.ceil(totalNodes * 0.95),
      `unique (${coverage.unique}/${totalNodes}) must be >= 95 %`,
    );
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

Deno.test(
  "mechanical R3 proof resolves to cm01-v3:drip-tray via prefix criterion (b-10)",
  () => {
    // coffee-machine-cm01-v3-mechanical-r3-{HEX64}-proof matches prefix b-10.
    // This artifact is not in the catalog, so criterion (a) does not fire.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${MECH_R3_PROOF_ID}`);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
    assertEquals(anchor?.criterion, "prefix");
  },
);

Deno.test(
  "oracle requirements artifact resolves to assembly via prefix criterion (b-2)",
  () => {
    // oracle-requirements-{digest} is not in the catalog; prefix b-2 fires.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${ORACLE_REQ_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "prefix");
  },
);

Deno.test(
  "sensitivity-relations artifact resolves to assembly via prefix criterion (b-5)",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${SENS_REL_ID}`);
    assertEquals(anchor?.target, "assembly");
    assertEquals(anchor?.criterion, "prefix");
  },
);

Deno.test(
  "drip-tray sensitivity capture resolves to cm01-v3:drip-tray via prefix criterion (b-13)",
  () => {
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${DT_SENS_CAPTURE_ID}`);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
    assertEquals(anchor?.criterion, "prefix");
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
  "architecture artifact resolves to cm01-v3:drip-tray via catalog last-writer-wins",
  () => {
    // The architecture artifact id appears in the syson binding of all three
    // components (assembly → enclosure → drip-tray, in order).  buildCatalogMap
    // uses Map.set which is last-writer-wins, so the final value is cm01-v3:drip-tray.
    // Criterion (a) fires before (b), so the prefix rule b-1 (assembly) does NOT win.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const anchor = map.get(`artifact:${ARCH_ID}`);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
    assertEquals(anchor?.criterion, "catalog");
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
  "R3 mesh-drip-tray change node resolves to cm01-v3:drip-tray via criterion (e)",
  () => {
    // change --changes--> artifact:mesh-drip-tray (cm01-v3:drip-tray).
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const changeKey = `change:${R3}-extension:created:${R3}-mesh-drip-tray`;
    const anchor = map.get(changeKey);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
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
  "R3 consumes-architecture consumption node resolves to cm01-v3:drip-tray via criterion (e)",
  () => {
    // artifact:architecture (catalog → drip-tray) --uses--> consumption:consumes-architecture.
    // Consumption inherits the anchor of the source artifact → cm01-v3:drip-tray.
    const map = buildPartAnchorage(FIXTURE_GRAPH, FIXTURE_CATALOG);
    const consumptionKey = `consumption:${R3}-consumes-architecture`;
    const anchor = map.get(consumptionKey);
    assertEquals(anchor?.target, "cm01-v3:drip-tray");
    assertEquals(anchor?.criterion, "change-consumption");
  },
);
