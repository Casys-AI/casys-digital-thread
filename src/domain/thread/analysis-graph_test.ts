import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import {
  ANALYSIS_GRAPH_SCHEMA,
  fingerprintAnalysisGraph,
  validateAnalysisGraph,
} from "./analysis-graph.ts";
import { ENGINEERING_ASSERTION_SCHEMA } from "./engineering-assertion.ts";

const FIRST_FINGERPRINT = {
  algorithm: "sha256",
  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} as const;

const SECOND_FINGERPRINT = {
  algorithm: "sha256",
  digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
} as const;

function graph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ANALYSIS_GRAPH_SCHEMA,
    nodes: [
      {
        id: "component.housing",
        kind: "component",
        semanticRef: {
          domain: "cad",
          kind: "component",
          id: "housing",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
      {
        id: "metric.max-displacement",
        kind: "metric",
        semanticRef: {
          domain: "calculix",
          kind: "metric",
          id: "max-displacement",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
      {
        id: "parameter.size-z",
        kind: "parameter",
        semanticRef: {
          domain: "cad",
          kind: "parameter",
          id: "size-z",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
      {
        id: "symbol.wall-thickness",
        kind: "model-symbol",
        semanticRef: {
          domain: "cad",
          kind: "model-symbol",
          id: "wall-thickness",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
    ],
    relations: [
      relation(
        "structural.housing-size-z",
        "structural-incidence",
        "component.housing",
        "parameter.size-z",
        {
          domain: "cad",
          kind: "component",
          id: "housing",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        {
          domain: "cad",
          kind: "parameter",
          id: "size-z",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        "inferred",
        {
          kind: "source-span",
          source: { domain: "cad", kind: "component", id: "housing" },
          basisFingerprint: FIRST_FINGERPRINT,
          start: { line: 1, column: 0 },
          end: { line: 1, column: 12 },
        },
      ),
      relation(
        "sensitivity.size-z.max-displacement",
        "measured-local-sensitivity",
        "parameter.size-z",
        "metric.max-displacement",
        {
          domain: "cad",
          kind: "parameter",
          id: "size-z",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        {
          domain: "calculix",
          kind: "metric",
          id: "max-displacement",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        "observed",
        {
          kind: "local-neighborhood",
          parameter: { domain: "cad", kind: "parameter", id: "size-z" },
          basisFingerprint: FIRST_FINGERPRINT,
          lower: { value: 29, unit: "mm" },
          upper: { value: 31, unit: "mm" },
        },
        {
          method: "forward-finite-difference",
          basePoint: { value: 30, unit: "mm" },
          perturbationStep: { value: 1, unit: "mm" },
          responseAtBase: { value: 0.1, unit: "mm" },
          responseAtPerturbed: { value: 0.092, unit: "mm" },
          derivative: { value: -0.008, unit: "mm/mm" },
        },
      ),
      relation(
        "declared.symbol-size-z",
        "declared-dependency",
        "symbol.wall-thickness",
        "parameter.size-z",
        {
          domain: "cad",
          kind: "model-symbol",
          id: "wall-thickness",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        {
          domain: "cad",
          kind: "parameter",
          id: "size-z",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        "declared",
        { kind: "basis", basisFingerprint: FIRST_FINGERPRINT },
      ),
    ],
    ...overrides,
  };
}

function relation(
  id: string,
  kind: string,
  fromNodeId: string,
  toNodeId: string,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  epistemicBasis: string,
  scope: Record<string, unknown>,
  measurement?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    assertion: {
      schemaVersion: ENGINEERING_ASSERTION_SCHEMA,
      id,
      relation: kind,
      from,
      to,
      epistemicBasis,
      assertedBy: { kind: "analyzer", id: "analysis-front-end", version: "1" },
      evidence: [
        { id: "result-capture", fingerprint: SECOND_FINGERPRINT },
        { id: "source-capture", fingerprint: FIRST_FINGERPRINT },
      ],
      scope,
      ...(measurement === undefined ? {} : { measurement }),
      rationale: "Exact evidence supports this provider-neutral causal fact.",
    },
    fromNodeId,
    toNodeId,
  };
}

function graphRelation(
  input: Record<string, unknown>,
  assertionId: string,
): Record<string, unknown> {
  return (input.relations as Record<string, unknown>[]).find((item) =>
    (item.assertion as Record<string, unknown>).id === assertionId
  )!;
}

Deno.test("analysis graph aggregates validated provider-neutral engineering assertions", () => {
  const result = validateAnalysisGraph(graph());

  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.nodes));
  assert(Object.isFrozen(result.relations));
  assert(Object.isFrozen(result.relations[0].assertion.evidence));
  assertEquals(result.nodes.map((node) => node.id), [
    "component.housing",
    "metric.max-displacement",
    "parameter.size-z",
    "symbol.wall-thickness",
  ]);
  const sensitivity = result.relations.find((item) =>
    item.assertion.relation === "measured-local-sensitivity"
  )!;
  assertEquals(sensitivity.assertion.evidence.map((item) => item.id), [
    "result-capture",
    "source-capture",
  ]);
  assertEquals(sensitivity.assertion.measurement?.derivative, {
    value: -0.008,
    unit: "mm/mm",
  });
});

Deno.test("analysis graph rejects unknown and missing root fields", () => {
  assertThrows(
    () => validateAnalysisGraph({ ...graph(), authority: "never" }),
    TypeError,
    "$graph has unsupported field authority.",
  );
  const { relations: _relations, ...missing } = graph();
  assertThrows(
    () => validateAnalysisGraph(missing),
    TypeError,
    "$graph.relations is required.",
  );
});

Deno.test("analysis graph rejects assertion-free graphs and invisible orphan nodes", () => {
  assertThrows(
    () => validateAnalysisGraph(graph({ relations: [] })),
    TypeError,
    "$graph.relations must not be empty",
  );

  const orphaned = graph();
  (orphaned.nodes as Record<string, unknown>[]).push({
    id: "metric.orphan",
    kind: "metric",
    semanticRef: {
      domain: "calculix",
      kind: "metric",
      id: "orphan",
      basisFingerprint: FIRST_FINGERPRINT,
    },
  });
  assertThrows(
    () => validateAnalysisGraph(orphaned),
    TypeError,
    "metric.orphan must be referenced",
  );
});

Deno.test("analysis graph rejects provider fields, divergent node kinds, and duplicate semantic nodes", () => {
  const providerField = graph({
    nodes: [{
      id: "parameter.size-z",
      kind: "parameter",
      provider: "calculix",
      semanticRef: { domain: "cad", kind: "parameter", id: "size-z" },
    }],
    relations: [],
  });
  assertThrows(
    () => validateAnalysisGraph(providerField),
    TypeError,
    "unsupported field provider",
  );
  const wrongKind = graph({
    nodes: [{
      id: "parameter.size-z",
      kind: "metric",
      semanticRef: { domain: "cad", kind: "parameter", id: "size-z" },
    }],
    relations: [],
  });
  assertThrows(() => validateAnalysisGraph(wrongKind), TypeError, "must equal");
  const duplicateSemanticNode = graph({
    nodes: [
      {
        id: "parameter.size-z.a",
        kind: "parameter",
        semanticRef: { domain: "cad", kind: "parameter", id: "size-z" },
      },
      {
        id: "parameter.size-z.b",
        kind: "parameter",
        semanticRef: { domain: "cad", kind: "parameter", id: "size-z" },
      },
    ],
    relations: [],
  });
  assertThrows(
    () => validateAnalysisGraph(duplicateSemanticNode),
    TypeError,
    "semantic refs",
  );
});

Deno.test("analysis graph accepts safe source-defined node kinds without a second taxonomy", () => {
  const sourceDefined = graph({
    nodes: [
      {
        id: "simulation-case.nominal",
        kind: "simulation-case",
        semanticRef: {
          domain: "modelica",
          kind: "simulation-case",
          id: "nominal",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
      {
        id: "proof-requirement.displacement",
        kind: "proof-requirement",
        semanticRef: {
          domain: "thread",
          kind: "proof-requirement",
          id: "displacement",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
      {
        id: "fixed-support.rear",
        kind: "fixed-support",
        semanticRef: {
          domain: "thread",
          kind: "fixed-support",
          id: "rear",
          basisFingerprint: FIRST_FINGERPRINT,
        },
      },
    ],
    relations: [
      relation(
        "source-defined-case-requirement",
        "declared-dependency",
        "simulation-case.nominal",
        "proof-requirement.displacement",
        {
          domain: "modelica",
          kind: "simulation-case",
          id: "nominal",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        {
          domain: "thread",
          kind: "proof-requirement",
          id: "displacement",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        "declared",
        { kind: "basis", basisFingerprint: FIRST_FINGERPRINT },
      ),
      relation(
        "source-defined-requirement-support",
        "declared-dependency",
        "proof-requirement.displacement",
        "fixed-support.rear",
        {
          domain: "thread",
          kind: "proof-requirement",
          id: "displacement",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        {
          domain: "thread",
          kind: "fixed-support",
          id: "rear",
          basisFingerprint: FIRST_FINGERPRINT,
        },
        "declared",
        { kind: "basis", basisFingerprint: FIRST_FINGERPRINT },
      ),
    ],
  });

  assertEquals(
    validateAnalysisGraph(sourceDefined).nodes.map((node) => node.kind),
    ["fixed-support", "proof-requirement", "simulation-case"],
  );
});

Deno.test("analysis graph rejects dangling or semantically mismatched assertion endpoints", () => {
  const dangling = graph();
  graphRelation(dangling, "structural.housing-size-z").fromNodeId = "component.missing";
  assertThrows(() => validateAnalysisGraph(dangling), TypeError, "must name a node");

  const mismatched = graph();
  const assertion = graphRelation(mismatched, "structural.housing-size-z")
    .assertion as Record<string, unknown>;
  assertion.from = {
    domain: "cad",
    kind: "component",
    id: "other",
    basisFingerprint: FIRST_FINGERPRINT,
  };
  assertThrows(
    () => validateAnalysisGraph(mismatched),
    TypeError,
    "exactly match assertion.from",
  );
});

Deno.test("analysis graph rejects duplicate assertion identity and inherits assertion fail-closed semantics", () => {
  const duplicate = graph();
  (duplicate.relations as unknown[]).push({
    ...graphRelation(duplicate, "structural.housing-size-z"),
  });
  assertThrows(() => validateAnalysisGraph(duplicate), TypeError, "assertion ids");

  const invalidMeasurement = graph();
  const assertion = graphRelation(
    invalidMeasurement,
    "sensitivity.size-z.max-displacement",
  )
    .assertion as Record<string, unknown>;
  (assertion.measurement as Record<string, unknown>).derivative = {
    value: -0.007,
    unit: "mm/mm",
  };
  assertThrows(
    () => validateAnalysisGraph(invalidMeasurement),
    TypeError,
    "finite-difference quotient",
  );
});

Deno.test("analysis graph identity is invariant to graph and assertion-evidence permutations", async () => {
  const left = graph();
  const right = graph({
    nodes: [...(graph().nodes as unknown[])].reverse(),
    relations: [...(graph().relations as Record<string, unknown>[])]
      .reverse()
      .map((item) => ({
        ...item,
        assertion: {
          ...(item.assertion as Record<string, unknown>),
          evidence: [
            ...((item.assertion as Record<string, unknown>).evidence as unknown[]),
          ].reverse(),
        },
      })),
  });
  const leftFingerprint = await fingerprintAnalysisGraph(left);
  const rightFingerprint = await fingerprintAnalysisGraph(right);
  assertEquals(leftFingerprint, rightFingerprint);

  const changed = graph();
  const assertion = graphRelation(changed, "declared.symbol-size-z")
    .assertion as Record<string, unknown>;
  assertion.rationale = "A distinct exact causal fact.";
  const changedFingerprint = await fingerprintAnalysisGraph(changed);
  assertNotEquals(leftFingerprint, changedFingerprint);
});
