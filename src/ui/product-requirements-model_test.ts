import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildRequirementMatrix,
  filterRequirementRows,
  productSourcingCoverage,
} from "./src/project/product-requirements-model.ts";
import { isThreadWorkbenchSnapshot } from "./src/thread/types.ts";
import type {
  ThreadEvidenceFamily,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadObservation,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("requirement matrix joins current records only and never invents a verdict", () => {
  const matrix = buildRequirementMatrix(GENERIC_THREAD_FIXTURE);
  const byId = Object.fromEntries(
    matrix.rows.map((row) => [row.id, row]),
  );

  assertEquals(matrix.counts, {
    all: 4,
    pass: 2,
    fail: 1,
    unresolved: 1,
  });
  assertEquals(matrix.worstMargin, "−12 MPa · −10.0%");

  assertEquals(byId["REQ-MECH-014"]?.status, "fail");
  assertEquals(
    byId["REQ-MECH-014"]?.lastVerdict,
    "132 MPa · −12 MPa · −10.0%",
  );
  assertEquals(byId["REQ-MECH-014"]?.violationId, "VIO-MECH-014");
  assertEquals(byId["REQ-MECH-014"]?.anchor, "fixture:REQ-MECH-014");

  assertEquals(byId["REQ-MASS-006"]?.status, "pass");
  assertEquals(byId["REQ-MASS-006"]?.lastVerdict, "417 g");

  assertEquals(byId["REQ-THERM-021"]?.status, "unresolved");
  assertEquals(byId["REQ-THERM-021"]?.lastVerdict, "53.7 °C");

  assertEquals(
    matrix.rows.some((row) => row.lastVerdict.includes("RUNNING")),
    false,
  );
  assertEquals(
    matrix.rows.every((row) => row.verdictTrail.length === 0),
    true,
  );
});

Deno.test("requirement matrix filter is a status partition, not a second ranking", () => {
  const matrix = buildRequirementMatrix(GENERIC_THREAD_FIXTURE);
  assertEquals(
    filterRequirementRows(matrix, "fail").map((row) => row.id),
    ["REQ-MECH-014"],
  );
  assertEquals(
    filterRequirementRows(matrix, "unresolved").map((row) => row.id),
    ["REQ-THERM-021"],
  );
  assertEquals(filterRequirementRows(matrix, "all").length, matrix.counts.all);
});

Deno.test("requirement matrix names an anchor only from the exact target PartDefinition", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const definition = snapshot.components.components[0]!.bindings.find(
    (binding) => binding.kind === "part-definition",
  ) ?? snapshot.components.components[0]!.bindings[0]!;
  definition.kind = "part-definition";
  definition.provider = "syson";
  snapshot.requirements.find((item) => item.id === "REQ-MASS-006")!
    .targetElementId = definition.id;
  snapshot.requirements.find((item) => item.id === "REQ-MASS-006")!
    .sourceElementId = "requirement-usage:mass";
  const row = buildRequirementMatrix(snapshot).rows.find((item) =>
    item.id === "REQ-MASS-006"
  );
  assertEquals(row?.anchor, snapshot.components.components[0]!.label);
});

Deno.test("expanded requirement trail walks a recorded family and hides historical members", () => {
  const snapshot = requirementFamilySnapshot();
  assertEquals(isThreadWorkbenchSnapshot(snapshot), true);

  const matrix = buildRequirementMatrix(snapshot);
  const byId = Object.fromEntries(
    matrix.rows.map((row) => [row.id, row]),
  );
  const trailText = matrix.rows
    .flatMap((row) => row.verdictTrail.map((step) => step.label))
    .join(" → ");

  assertEquals(matrix.counts, {
    all: 4,
    pass: 3,
    fail: 0,
    unresolved: 1,
  });
  assertEquals(
    matrix.rows.some((row) => row.id === "REQ-MECH-013"),
    false,
  );
  assertEquals(byId["REQ-MECH-014"]?.status, "pass");
  assertEquals(
    byId["REQ-MECH-014"]?.verdictTrail.map((step) => ({
      id: step.id,
      status: step.status,
      current: step.current,
    })),
    [
      { id: "REQ-MECH-013", status: "fail", current: false },
      { id: "REQ-MECH-014", status: "pass", current: true },
    ],
  );
  assertEquals(
    byId["REQ-MECH-014"]?.verdictTrail.map((step) => step.label),
    [
      "fail · 141 MPa · −21 MPa",
      "pass · 132 MPa",
    ],
  );
  assertEquals(trailText.includes("RUNNING"), false);
  assertEquals(trailText.includes("@36"), false);
  assertEquals(/@\d+/.test(trailText), false);
});

Deno.test(
  "computed and evidenceLabel come from recorded joins and fall back to '—' without data",
  () => {
    const matrix = buildRequirementMatrix(GENERIC_THREAD_FIXTURE);
    const byId = Object.fromEntries(
      matrix.rows.map((row) => [row.id, row]),
    );

    // REQ-MECH-014 has OBS-STRESS-MAX → ART-FEA-018
    assertEquals(byId["REQ-MECH-014"]?.computed, "132 MPa");
    assertEquals(
      byId["REQ-MECH-014"]?.evidenceLabel,
      "Support bracket static solve · CalculiX",
    );
    // REQ-MASS-006 has OBS-MASS → ART-CAD-018
    assertEquals(byId["REQ-MASS-006"]?.computed, "417 g");
    assertEquals(
      byId["REQ-MASS-006"]?.evidenceLabel,
      "Brew-unit support bracket · build123d",
    );
    // marginLabel only from a recorded violation
    assertEquals(byId["REQ-MECH-014"]?.marginLabel, "−12 MPa · −10.0%");
    // pass row has no violation → "—"
    assertEquals(byId["REQ-MASS-006"]?.marginLabel, "—");
    // artifactRef is defined for rows with a matched artifact
    assertEquals(byId["REQ-MECH-014"]?.artifactRef?.id, "ART-FEA-018");
    assertEquals(byId["REQ-MASS-006"]?.artifactRef?.id, "ART-CAD-018");
  },
);

Deno.test(
  "computed and evidenceLabel are '—' when no observation is recorded",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    // Remove all observations so no requirement has data
    snapshot.observations = [];
    const matrix = buildRequirementMatrix(snapshot);
    for (const row of matrix.rows) {
      assertEquals(
        row.computed,
        "—",
        `computed should be '—' for ${row.id}`,
      );
      assertEquals(
        row.evidenceLabel,
        "—",
        `evidenceLabel should be '—' for ${row.id}`,
      );
      assertEquals(
        row.artifactRef,
        undefined,
        `artifactRef should be absent for ${row.id}`,
      );
    }
  },
);

Deno.test(
  "marginLabel is '—' when no violation is recorded, and never a calculated value",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    // Remove all violations
    snapshot.violations = [];
    for (const req of snapshot.requirements) {
      req.violationIds = [];
    }
    const matrix = buildRequirementMatrix(snapshot);
    for (const row of matrix.rows) {
      assertEquals(
        row.marginLabel,
        "—",
        `marginLabel should be '—' without a recorded violation for ${row.id}`,
      );
    }
  },
);

Deno.test("sourcing coverage is a recorded ERP binding count, else GAP", () => {
  const bound = productSourcingCoverage(GENERIC_THREAD_FIXTURE);
  assertEquals(bound, {
    boundCount: 1,
    componentCount: 1,
    badge: "1/1",
  });

  const unbound = structuredClone(GENERIC_THREAD_FIXTURE);
  unbound.components.components[0]!.bindings = unbound.components
    .components[0]!.bindings.filter((binding) => binding.provider !== "erpnext");
  assertEquals(productSourcingCoverage(unbound).badge, "GAP");
});

function requirementFamilySnapshot(): ThreadWorkbenchSnapshot {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const current = snapshot.requirements.find((item) => item.id === "REQ-MECH-014");
  if (!current) throw new Error("fixture is missing REQ-MECH-014");
  current.status = "pass";
  current.violationIds = [];
  snapshot.requirements.push(historicalRequirement());
  snapshot.observations.push(historicalObservation());
  snapshot.violations.push(historicalViolation());
  snapshot.graph.nodes.push(historicalRequirementNode());
  snapshot.graph.edges.push(historicalSupersedesEdge());
  const currentNode = snapshot.graph.nodes.find((node) =>
    node.ref.kind === "requirement" && node.ref.id === "REQ-MECH-014"
  );
  if (currentNode) currentNode.freshness = "fresh";
  snapshot.evidenceFamilyGraph = {
    ...snapshot.evidenceFamilyGraph,
    families: [requirementFamily()],
    omittedSelfLoops: [{
      familyId: "fixture:requirement-family:REQ-MECH-014",
      memberEdgeRefs: [{
        id: "fixture:supersedes:req-mech-013",
        relation: "supersedes",
        origin: "provenance",
      }],
    }],
  };
  return snapshot;
}

function historicalRequirement(): ThreadRequirement {
  return {
    id: "REQ-MECH-013",
    label: "Illustrative bracket stress",
    source: "Synthetic fixture · not present in live SysON",
    sourceElementId: "fixture:REQ-MECH-013",
    expression: "max(von_mises) ≤ 120 MPa",
    status: "fail",
    observationIds: ["OBS-STRESS-MAX-013"],
    violationIds: ["VIO-MECH-013"],
    rationale: "Recorded historical fail retained after the later pass.",
  };
}

function historicalObservation(): ThreadObservation {
  return {
    id: "OBS-STRESS-MAX-013",
    label: "Maximum von Mises stress",
    value: 141,
    unit: "MPa",
    display: "141 MPa",
    sourceArtifactId: "ART-FEA-018",
    requirementIds: ["REQ-MECH-013"],
    freshness: "stale",
    measuredAt: "2026-07-31T08:38:51.000Z",
  };
}

function historicalViolation(): ThreadViolation {
  return {
    id: "VIO-MECH-013",
    name: "Illustrative stress limit exceeded",
    severity: "blocking",
    status: "resolved",
    requirementId: "REQ-MECH-013",
    observationId: "OBS-STRESS-MAX-013",
    message: "Recorded historical fail against the same synthetic 120 MPa limit.",
    margin: "−21 MPa",
    evidence: ["ART-FEA-018"],
    proposedActionIds: [],
  };
}

function historicalRequirementNode(): ThreadGraphNode {
  return {
    id: "graph:requirement:REQ-MECH-013",
    ref: { kind: "requirement", id: "REQ-MECH-013" },
    entityKind: "requirement",
    label: "Illustrative bracket stress",
    system: "SysON",
    freshness: "failed",
    summary: "max(von_mises) ≤ 120 MPa",
    selection: { kind: "requirement", id: "REQ-MECH-013" },
  };
}

function historicalSupersedesEdge(): ThreadGraphEdge {
  return {
    id: "fixture:supersedes:req-mech-013",
    from: { kind: "requirement", id: "REQ-MECH-013" },
    to: { kind: "requirement", id: "REQ-MECH-014" },
    relation: "supersedes",
    rationale:
      "The recorded requirement revision replaces the retained historical fail.",
    origin: "provenance",
  };
}

function requirementFamily(): ThreadEvidenceFamily {
  return {
    id: "fixture:requirement-family:REQ-MECH-014",
    entityKind: "requirement",
    historicalRefs: [{ kind: "requirement", id: "REQ-MECH-013" }],
    currentRefs: [{ kind: "requirement", id: "REQ-MECH-014" }],
    revisionCount: 1,
    status: "current",
    relationship: {
      relation: "supersedes",
      classification: "not-recorded",
      equivalence: "not-recorded",
    },
    transitions: [{
      edgeRef: {
        id: "fixture:supersedes:req-mech-013",
        relation: "supersedes",
        origin: "provenance",
      },
      historical: { kind: "requirement", id: "REQ-MECH-013" },
      successor: { kind: "requirement", id: "REQ-MECH-014" },
    }],
  };
}

Deno.test("views ask the model whether a field was recorded instead of matching its placeholder", async () => {
  // La marque « — » est une valeur d'affichage. Une vue qui la compare
  // reprend une décision qui appartient au modèle, et se casse
  // silencieusement le jour où la marque change.
  const views = [
    "./src/project/overview.tsx",
    "./src/project/product-requirements-matrix.tsx",
  ];
  for (const view of views) {
    const source = await Deno.readTextFile(new URL(view, import.meta.url));
    assertEquals(
      /[!=]==\s*"—"/.test(source),
      false,
      `${view} compares the unrecorded placeholder instead of asking the model`,
    );
  }
});
