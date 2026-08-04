/**
 * The vector traversal engine: given a MEASURED jacobian (sensitivity edges,
 * each with its provenance and validity neighbourhood), requirement states
 * (some violated) and bounded parameters, propose the cheapest correction the
 * local linear model allows — or refuse, typed and named.
 *
 * Why this boundary exists: the hard-geometry campaign (2026-08-04) showed a
 * single edge applied outside its neighbourhood failing in both directions at
 * once — six under-corrections near saturation, one gross over-correction from
 * the steep zone. This module therefore refuses any proposal that leaves the
 * neighbourhood of ANY edge it used. And the LLM campaigns showed where truth
 * comes from: `predicted` below is the linear model's claim, never a verdict —
 * the caller MUST re-verify with a real solve before concluding anything.
 *
 * V1 is EXACT for up to two parameters: the feasible set is a convex polygon
 * (half-planes from requirements ∩ boxes from domains and neighbourhoods), so
 * the linear cost attains its minimum at a vertex, and vertices can be
 * enumerated exhaustively. Three or more parameters are refused rather than
 * approximated silently. Escalation criterion, for later: beyond ~6x6
 * jacobians or quadratic costs, swap the interior for a native solver
 * (HiGHS covers LP and MILP through one FFI) behind this same contract.
 */

export interface SensitivityEdge {
  /** Parameter name, e.g. "rib-height". */
  readonly parameter: string;
  /** Metric name, e.g. "assembly_max_displacement". */
  readonly metric: string;
  /** Measured d(metric)/d(parameter). */
  readonly derivative: number;
  /** Composed unit, e.g. "mm/mm". Kept as data for coherence checks. */
  readonly unit: string;
  /** Validity neighbourhood of the measurement, in parameter units. */
  readonly neighbourhood: { readonly base: number; readonly radius: number };
  /** Free-form provenance: which solves measured this edge. */
  readonly provenance: string;
}

export interface RequirementState {
  readonly metric: string;
  /** V1 handles upper bounds only. */
  readonly operator: "<=";
  readonly limit: number;
  /** The REAL measurement at the current point — never a prediction. */
  readonly observed: number;
}

export interface ParameterState {
  readonly name: string;
  readonly current: number;
  readonly domain: { readonly min: number; readonly max: number };
  /** Cost per unit of increase (e.g. added mass per mm). Must be >= 0. */
  readonly costPerUnit: number;
}

export interface TraversalOptions {
  /**
   * Aim this fraction BELOW each limit to absorb linearisation error.
   * Declared in the output; never hidden. Default 0.05.
   */
  readonly epsilonFraction?: number;
}

export type VectorProposal =
  | {
    readonly kind: "propose";
    readonly deltas: Readonly<Record<string, number>>;
    /** Linear-model claims per metric — a PREDICTION, not a verdict. */
    readonly predicted: Readonly<Record<string, number>>;
    readonly costEstimate: number;
    /** Provenance of every edge the proposal relied on. */
    readonly cites: readonly string[];
    /** The combined neighbourhood the proposal lives in. */
    readonly validity: string;
    /** The margin fraction that was aimed below each limit. */
    readonly epsilonFraction: number;
  }
  | {
    readonly kind: "refuse";
    readonly code:
      | "outside_edge_neighbourhood"
      | "no_feasible_correction"
      | "missing_edge"
      | "invalid_input";
    readonly detail: string;
  };

function refuse(
  code: Extract<VectorProposal, { kind: "refuse" }>["code"],
  detail: string,
): VectorProposal {
  return Object.freeze({ kind: "refuse" as const, code, detail });
}

/** Numerical tolerance for feasibility checks on enumerated vertices. */
const FEASIBILITY_EPS = 1e-9;

export function proposeVectorCorrection(
  edges: readonly SensitivityEdge[],
  requirements: readonly RequirementState[],
  parameters: readonly ParameterState[],
  options: TraversalOptions = {},
): VectorProposal {
  const epsilon = options.epsilonFraction ?? 0.05;

  // ── Input validation (fail fast, AX #5) ─────────────────────────────────────
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon >= 1) {
    return refuse("invalid_input", `epsilonFraction must be in [0, 1), got ${epsilon}`);
  }
  if (parameters.length === 0 || requirements.length === 0) {
    return refuse(
      "invalid_input",
      "at least one parameter and one requirement are required",
    );
  }
  if (parameters.length > 2) {
    return refuse(
      "invalid_input",
      `V1 is exact for at most 2 parameters and refuses ${parameters.length} rather ` +
        "than approximating silently; escalate to a native LP/MILP solver (HiGHS via " +
        "FFI) behind this same contract when more parameters are needed",
    );
  }
  const paramNames = new Set(parameters.map((p) => p.name));
  if (paramNames.size !== parameters.length) {
    return refuse("invalid_input", "duplicate parameter names");
  }
  const metricNames = new Set(requirements.map((r) => r.metric));
  if (metricNames.size !== requirements.length) {
    return refuse("invalid_input", "duplicate requirement metrics");
  }
  for (const p of parameters) {
    if (
      !Number.isFinite(p.current) || !Number.isFinite(p.domain.min) ||
      !Number.isFinite(p.domain.max) || p.domain.min > p.domain.max ||
      !Number.isFinite(p.costPerUnit) || p.costPerUnit < 0
    ) {
      return refuse("invalid_input", `parameter "${p.name}" has invalid numbers`);
    }
  }
  for (const r of requirements) {
    if (r.operator !== "<=") {
      return refuse("invalid_input", `requirement "${r.metric}": V1 handles "<=" only`);
    }
    if (!Number.isFinite(r.limit) || !Number.isFinite(r.observed)) {
      return refuse("invalid_input", `requirement "${r.metric}" has invalid numbers`);
    }
  }

  // ── Jacobian completeness: absence of an edge is an UNKNOWN, never a zero ───
  // Every (parameter, requirement-metric) pair must have exactly one edge; an
  // explicitly measured zero derivative is legitimate, a missing edge is not.
  const edgeByPair = new Map<string, SensitivityEdge>();
  for (const e of edges) {
    if (!Number.isFinite(e.derivative)) {
      return refuse(
        "invalid_input",
        `edge ${e.parameter}->${e.metric}: derivative is not finite`,
      );
    }
    if (
      !Number.isFinite(e.neighbourhood.base) ||
      !Number.isFinite(e.neighbourhood.radius) ||
      e.neighbourhood.radius <= 0
    ) {
      return refuse(
        "invalid_input",
        `edge ${e.parameter}->${e.metric}: invalid neighbourhood`,
      );
    }
    const key = `${e.parameter} ${e.metric}`;
    if (edgeByPair.has(key)) {
      return refuse(
        "invalid_input",
        `two edges for ${e.parameter}->${e.metric}: ambiguous jacobian (piecewise ` +
          "selection belongs to the caller, which must pass the edge whose " +
          "neighbourhood covers the current point)",
      );
    }
    edgeByPair.set(key, e);
  }
  // Unit coherence: all edges of one metric share the numerator, all edges of
  // one parameter share the denominator.
  const numeratorByMetric = new Map<string, string>();
  const denominatorByParam = new Map<string, string>();
  for (const e of edgeByPair.values()) {
    const parts = e.unit.split("/");
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      return refuse(
        "invalid_input",
        `edge ${e.parameter}->${e.metric}: unit "${e.unit}" is not of the form "<metric>/<parameter>"`,
      );
    }
    const [num, den] = parts;
    const prevNum = numeratorByMetric.get(e.metric);
    if (prevNum !== undefined && prevNum !== num) {
      return refuse(
        "invalid_input",
        `metric "${e.metric}" appears with units "${prevNum}" and "${num}"`,
      );
    }
    numeratorByMetric.set(e.metric, num);
    const prevDen = denominatorByParam.get(e.parameter);
    if (prevDen !== undefined && prevDen !== den) {
      return refuse(
        "invalid_input",
        `parameter "${e.parameter}" appears with units "${prevDen}" and "${den}"`,
      );
    }
    denominatorByParam.set(e.parameter, den);
  }
  for (const p of parameters) {
    for (const r of requirements) {
      if (!edgeByPair.has(`${p.name} ${r.metric}`)) {
        return refuse(
          "missing_edge",
          `no measured edge ${p.name}->${r.metric}; absence is an unknown, not a ` +
            "zero — measure it (or measure an explicit zero) before proposing",
        );
      }
    }
  }

  // ── The linearisation base point must sit inside every edge neighbourhood ──
  // `observed` was measured at the CURRENT point; an edge measured elsewhere
  // cannot extend a prediction from here, even if its neighbourhood is
  // reachable — the hard campaign showed that failing in both directions.
  for (const p of parameters) {
    for (const r of requirements) {
      const e = edgeByPair.get(`${p.name} ${r.metric}`)!;
      if (Math.abs(p.current - e.neighbourhood.base) > e.neighbourhood.radius) {
        return refuse(
          "outside_edge_neighbourhood",
          `edge ${p.name}->${r.metric} was measured around ${e.neighbourhood.base} ` +
            `(radius ${e.neighbourhood.radius}) but the current point is ` +
            `${p.current}; re-measure the edge around the current point`,
        );
      }
    }
  }

  // ── Per-parameter delta bounds: domain ∩ every used edge's neighbourhood ────
  // The proposal moves ALL listed parameters' models, so every edge of every
  // listed parameter is "used" and bounds it.
  const bounds = parameters.map((p) => {
    let lo = p.domain.min - p.current;
    let hi = p.domain.max - p.current;
    for (const r of requirements) {
      const e = edgeByPair.get(`${p.name} ${r.metric}`)!;
      lo = Math.max(lo, e.neighbourhood.base - e.neighbourhood.radius - p.current);
      hi = Math.min(hi, e.neighbourhood.base + e.neighbourhood.radius - p.current);
    }
    return { lo, hi };
  });
  for (let i = 0; i < parameters.length; i++) {
    if (bounds[i].lo > bounds[i].hi + FEASIBILITY_EPS) {
      return refuse(
        "outside_edge_neighbourhood",
        `parameter "${parameters[i].name}": the current point admits no move inside ` +
          "the intersection of its domain and the neighbourhoods of its edges " +
          `(lo=${bounds[i].lo}, hi=${
            bounds[i].hi
          }); re-measure edges around the current point`,
      );
    }
  }

  // ── Constraint set over deltas d = (d0[, d1]) ───────────────────────────────
  // Requirements: observed + Σ ∂·d <= target, target = limit - epsilon·|limit|.
  // Encoded as a·d <= b.
  type HalfPlane = {
    readonly a: readonly number[];
    readonly b: number;
    readonly tag: string;
  };
  const halfPlanes: HalfPlane[] = [];
  for (const r of requirements) {
    const a = parameters.map((p) =>
      edgeByPair.get(`${p.name} ${r.metric}`)!.derivative
    );
    const target = r.limit - epsilon * Math.abs(r.limit);
    halfPlanes.push({ a, b: target - r.observed, tag: r.metric });
  }
  for (let i = 0; i < parameters.length; i++) {
    const aHi = parameters.map((_, j) => (j === i ? 1 : 0));
    halfPlanes.push({ a: aHi, b: bounds[i].hi, tag: `${parameters[i].name}<=hi` });
    const aLo = parameters.map((_, j) => (j === i ? -1 : 0));
    halfPlanes.push({ a: aLo, b: -bounds[i].lo, tag: `${parameters[i].name}>=lo` });
  }

  const cost = parameters.map((p) => p.costPerUnit);
  const feasible = (d: readonly number[]): boolean =>
    halfPlanes.every((h) =>
      h.a.reduce((s, ai, i) => s + ai * d[i], 0) <= h.b + FEASIBILITY_EPS
    );

  // ── Exact vertex enumeration ────────────────────────────────────────────────
  const candidates: number[][] = [];
  if (parameters.length === 1) {
    // 1D: the feasible set is an interval; candidate optima are its endpoints,
    // i.e. every constraint boundary that is feasible.
    for (const h of halfPlanes) {
      if (h.a[0] !== 0) candidates.push([h.b / h.a[0]]);
    }
  } else {
    // 2D: vertices are intersections of pairs of active constraint lines.
    for (let i = 0; i < halfPlanes.length; i++) {
      for (let j = i + 1; j < halfPlanes.length; j++) {
        const [a1, b1] = [halfPlanes[i].a, halfPlanes[i].b];
        const [a2, b2] = [halfPlanes[j].a, halfPlanes[j].b];
        const det = a1[0] * a2[1] - a1[1] * a2[0];
        if (Math.abs(det) < 1e-12) continue; // parallel
        candidates.push([
          (b1 * a2[1] - b2 * a1[1]) / det,
          (a1[0] * b2 - a2[0] * b1) / det,
        ]);
      }
    }
  }
  const feasibleVertices = candidates.filter(feasible);
  if (feasibleVertices.length === 0) {
    return refuse(
      "no_feasible_correction",
      "the requirement half-planes and the domain/neighbourhood box intersect in " +
        "nothing the linear model can reach; widen a domain, relax a limit, or " +
        "measure edges around a different point",
    );
  }

  // Deterministic optimum: minimal cost, then lexicographic smallest deltas.
  let best = feasibleVertices[0];
  let bestCost = cost.reduce((s, c, i) => s + c * best[i], 0);
  for (const v of feasibleVertices.slice(1)) {
    const c = cost.reduce((s, ci, i) => s + ci * v[i], 0);
    const better = c < bestCost - FEASIBILITY_EPS ||
      (Math.abs(c - bestCost) <= FEASIBILITY_EPS &&
        v.some((x, i) => x < best[i] - FEASIBILITY_EPS) &&
        !best.some((x, i) => x < v[i] - FEASIBILITY_EPS));
    if (better) {
      best = v;
      bestCost = c;
    }
  }

  const deltas: Record<string, number> = {};
  parameters.forEach((p, i) => {
    deltas[p.name] = best[i];
  });
  const predicted: Record<string, number> = {};
  for (const r of requirements) {
    predicted[r.metric] = r.observed +
      parameters.reduce(
        (s, p, i) => s + edgeByPair.get(`${p.name} ${r.metric}`)!.derivative * best[i],
        0,
      );
  }
  const cites = [...edgeByPair.values()].map((e) => e.provenance).sort();
  const validity = parameters
    .map((p, i) =>
      `${p.name} in [${(p.current + bounds[i].lo).toFixed(6)}, ${
        (p.current + bounds[i].hi).toFixed(6)
      }]`
    )
    .join("; ");

  return Object.freeze({
    kind: "propose" as const,
    deltas: Object.freeze(deltas),
    predicted: Object.freeze(predicted),
    costEstimate: bestCost,
    cites: Object.freeze(cites),
    validity,
    epsilonFraction: epsilon,
  });
}
