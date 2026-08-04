import { assertEquals } from "@std/assert";
import {
  type ParameterState,
  proposeVectorCorrection,
  type RequirementState,
  type SensitivityEdge,
} from "./traversal.ts";

// ── Shared fixtures ────────────────────────────────────────────────────────────

function edge(
  parameter: string,
  metric: string,
  derivative: number,
  base: number,
  radius: number,
): SensitivityEdge {
  return {
    parameter,
    metric,
    derivative,
    unit: "mm/mm",
    neighbourhood: { base, radius },
    provenance: `solves for ${parameter}->${metric}`,
  };
}

const DISPLACEMENT: RequirementState = {
  metric: "disp",
  operator: "<=",
  limit: 1,
  observed: 1.2,
};

Deno.test("the scalar case matches the CA policy formula inside the neighbourhood", () => {
  const p: ParameterState = {
    name: "h",
    current: 30,
    domain: { min: 20, max: 40 },
    costPerUnit: 1,
  };
  const req: RequirementState = {
    metric: "disp",
    operator: "<=",
    limit: 1,
    observed: 1.04,
  };
  const result = proposeVectorCorrection(
    [edge("h", "disp", -0.008, 30, 10)],
    [req],
    [p],
    { epsilonFraction: 0 },
  );
  if (result.kind !== "propose") {
    throw new Error(`expected propose, got ${result.kind}`);
  }
  // delta = (observed - limit) / |d| = 0.04 / 0.008 = 5 — the CA formula.
  assertEquals(Math.abs(result.deltas.h - 5) < 1e-6, true, `got ${result.deltas.h}`);
  assertEquals(Math.abs(result.predicted.disp - 1) < 1e-9, true);
});

Deno.test("the declared epsilon margin aims below the limit and is reported in the output", () => {
  const p: ParameterState = {
    name: "h",
    current: 30,
    domain: { min: 20, max: 40 },
    costPerUnit: 1,
  };
  const req: RequirementState = {
    metric: "disp",
    operator: "<=",
    limit: 1,
    observed: 1.04,
  };
  const result = proposeVectorCorrection(
    [edge("h", "disp", -0.008, 30, 15)],
    [req],
    [{ ...p, domain: { min: 20, max: 45 } }],
    { epsilonFraction: 0.05 },
  );
  if (result.kind !== "propose") throw new Error("expected propose");
  assertEquals(result.epsilonFraction, 0.05);
  // target = 1 - 0.05 = 0.95 -> delta = (1.04 - 0.95)/0.008 = 11.25
  assertEquals(
    Math.abs(result.deltas.h - 11.25) < 1e-6,
    true,
    `got ${result.deltas.h}`,
  );
});

Deno.test("with two sufficient parameters the cheaper one is chosen", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 1 },
    { name: "plate", current: 6, domain: { min: 4, max: 10 }, costPerUnit: 5 },
  ];
  const edges = [
    edge("rib", "disp", -0.1, 6, 6),
    edge("plate", "disp", -0.1, 6, 4),
  ];
  const req: RequirementState = {
    metric: "disp",
    operator: "<=",
    limit: 1,
    observed: 1.2,
  };
  const result = proposeVectorCorrection(edges, [req], params, { epsilonFraction: 0 });
  if (result.kind !== "propose") {
    throw new Error(`expected propose, got ${JSON.stringify(result)}`);
  }
  // Signed cost: thinning the expensive plate REFUNDS cost, so the exact
  // optimum is not "all on the cheap rib" but rib +4, plate -2 (its lower
  // bound): disp -0.1*4 -0.1*(-2) = -0.2 exactly, net cost 4*1 + (-2)*5 = -6.
  // Hand-checked; the engine found it before the test author did.
  assertEquals(
    Math.abs(result.deltas.rib - 4) < 1e-6,
    true,
    `rib ${result.deltas.rib}`,
  );
  assertEquals(
    Math.abs(result.deltas.plate - (-2)) < 1e-6,
    true,
    `plate ${result.deltas.plate}`,
  );
  assertEquals(Math.abs(result.costEstimate - (-6)) < 1e-6, true);
});

Deno.test("two requirements in tension find the exact feasible vertex", () => {
  // Hand-checkable: correct disp (needs stiffening) while mass must not grow
  // beyond +10. Edges: rib helps disp at -0.1/mm and costs 4 mass/mm; plate
  // helps at -0.2/mm and costs 25 mass/mm. Mass "requirement": observed 0,
  // limit 10 (upper bound on ADDED mass, epsilon 0).
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 4 },
    { name: "plate", current: 6, domain: { min: 4, max: 10 }, costPerUnit: 25 },
  ];
  const edges = [
    edge("rib", "disp", -0.1, 6, 8),
    edge("plate", "disp", -0.2, 6, 4),
    edge("rib", "mass", 4, 6, 8),
    edge("plate", "mass", 25, 6, 4),
  ];
  const disp: RequirementState = {
    metric: "disp",
    operator: "<=",
    limit: 1,
    observed: 1.5,
  };
  const mass: RequirementState = {
    metric: "mass",
    operator: "<=",
    limit: 10,
    observed: 0,
  };
  const result = proposeVectorCorrection(edges, [disp, mass], params, {
    epsilonFraction: 0,
  });
  if (result.kind !== "propose") {
    throw new Error(`expected propose, got ${JSON.stringify(result)}`);
  }
  // Hand-checked exact optimum: rib at its upper bound (+8, capped by domain
  // [1,14] from current 6) with plate thinned to keep disp exactly active:
  // 0.1*8 + 0.2*p = 0.5 -> p = -1.5. Mass constraint stays INACTIVE
  // (4*8 + 25*(-1.5) = -5.5 <= 10), cost 4*8 + 25*(-1.5) = -5.5 — cheaper
  // than any vertex where mass is active. The engine beat the test author's
  // first hand computation, which had wrongly assumed mass must bind.
  const r = result.deltas.rib;
  const p = result.deltas.plate;
  assertEquals(Math.abs(r - 8) < 1e-6, true, `rib ${r}`);
  assertEquals(Math.abs(p - (-1.5)) < 1e-6, true, `plate ${p}`);
  assertEquals(
    Math.abs(0.1 * r + 0.2 * p - 0.5) < 1e-6,
    true,
    `disp active: r=${r} p=${p}`,
  );
  assertEquals(Math.abs(result.predicted.disp - 1) < 1e-6, true);
  assertEquals(result.predicted.mass <= 10 + 1e-9, true);
});

Deno.test("no feasible correction is a typed refusal, not a stretched proposal", () => {
  const p: ParameterState = {
    name: "h",
    current: 30,
    domain: { min: 29, max: 31 },
    costPerUnit: 1,
  };
  // Needs delta 25, domain allows 1.
  const result = proposeVectorCorrection(
    [edge("h", "disp", -0.008, 30, 10)],
    [DISPLACEMENT],
    [p],
    { epsilonFraction: 0 },
  );
  assertEquals(result.kind, "refuse");
  if (result.kind === "refuse") assertEquals(result.code, "no_feasible_correction");
});

Deno.test("a move outside an edge neighbourhood is refused before any proposal", () => {
  const p: ParameterState = {
    name: "h",
    current: 30,
    domain: { min: 20, max: 60 },
    costPerUnit: 1,
  };
  // Edge measured around 45 with radius 2: the current point 30 cannot even
  // move inside the neighbourhood intersection.
  const result = proposeVectorCorrection(
    [edge("h", "disp", -0.008, 45, 2)],
    [DISPLACEMENT],
    [p],
  );
  assertEquals(result.kind, "refuse");
  if (result.kind === "refuse") assertEquals(result.code, "outside_edge_neighbourhood");
});

Deno.test("a violated requirement without any edge is missing_edge, and absence is never zero", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 1 },
  ];
  const result = proposeVectorCorrection(
    [edge("rib", "disp", -0.1, 6, 8)],
    [
      { metric: "disp", operator: "<=", limit: 1, observed: 1.2 },
      { metric: "mass", operator: "<=", limit: 10, observed: 5 },
    ],
    params,
  );
  assertEquals(result.kind, "refuse");
  if (result.kind === "refuse") {
    assertEquals(result.code, "missing_edge");
    // The refusal must name the unknown pair, not silently treat it as zero.
    assertEquals(result.detail.includes("rib->mass"), true, result.detail);
  }
});

Deno.test("an explicitly measured zero derivative is a legitimate edge", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 1 },
  ];
  const result = proposeVectorCorrection(
    [
      edge("rib", "disp", -0.1, 6, 8),
      edge("rib", "mass", 0, 6, 8), // measured as zero — allowed
    ],
    [
      { metric: "disp", operator: "<=", limit: 1, observed: 1.2 },
      { metric: "mass", operator: "<=", limit: 10, observed: 5 },
    ],
    params,
    { epsilonFraction: 0 },
  );
  if (result.kind !== "propose") {
    throw new Error(`expected propose, got ${JSON.stringify(result)}`);
  }
  assertEquals(Math.abs(result.deltas.rib - 2) < 1e-6, true);
});

Deno.test("an incoherent edge unit is rejected as invalid input", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 1 },
  ];
  const bad: SensitivityEdge = {
    ...edge("rib", "disp", -0.1, 6, 8),
    unit: "mm-per-mm",
  };
  const result = proposeVectorCorrection(bad ? [bad] : [], [DISPLACEMENT], params);
  assertEquals(result.kind, "refuse");
  if (result.kind === "refuse") assertEquals(result.code, "invalid_input");
});

Deno.test("three parameters are refused explicitly rather than approximated silently", () => {
  const params: ParameterState[] = ["a", "b", "c"].map((name) => ({
    name,
    current: 5,
    domain: { min: 0, max: 10 },
    costPerUnit: 1,
  }));
  const edges = params.map((p) => edge(p.name, "disp", -0.1, 5, 5));
  const result = proposeVectorCorrection(edges, [DISPLACEMENT], params);
  assertEquals(result.kind, "refuse");
  if (result.kind === "refuse") {
    assertEquals(result.code, "invalid_input");
    assertEquals(
      result.detail.includes("HiGHS"),
      true,
      "the escalation path must be named",
    );
  }
});

Deno.test("identical inputs produce identical outputs", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 4 },
    { name: "plate", current: 6, domain: { min: 4, max: 10 }, costPerUnit: 25 },
  ];
  const edges = [
    edge("rib", "disp", -0.1, 6, 8),
    edge("plate", "disp", -0.2, 6, 4),
    edge("rib", "mass", 4, 6, 8),
    edge("plate", "mass", 25, 6, 4),
  ];
  const reqs: RequirementState[] = [
    { metric: "disp", operator: "<=", limit: 1, observed: 1.5 },
    { metric: "mass", operator: "<=", limit: 10, observed: 0 },
  ];
  const a = proposeVectorCorrection(edges, reqs, params);
  const b = proposeVectorCorrection(edges, reqs, params);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("the proposal cites the provenance of every edge it relied on", () => {
  const params: ParameterState[] = [
    { name: "rib", current: 6, domain: { min: 1, max: 14 }, costPerUnit: 1 },
  ];
  const result = proposeVectorCorrection(
    [edge("rib", "disp", -0.1, 6, 8)],
    [{ metric: "disp", operator: "<=", limit: 1, observed: 1.2 }],
    params,
    { epsilonFraction: 0 },
  );
  if (result.kind !== "propose") throw new Error("expected propose");
  assertEquals(result.cites.length, 1);
  assertEquals(result.cites[0], "solves for rib->disp");
});
