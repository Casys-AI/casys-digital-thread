import { assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import { validateSensitivityStudyCaseV3 } from "../study/sensitivity-study-v3.ts";
import { buildSensitivityAnalysisGraph } from "./sensitivity-analysis-graph.ts";

const FP = (digest: string) => ({ algorithm: "sha256" as const, digest });

Deno.test("sensitivity analysis graph records one measured assertion per declared metric deterministically", () => {
  const first = buildSensitivityAnalysisGraph(graphInput());
  const second = buildSensitivityAnalysisGraph(graphInput());

  assertEquals(deterministicJson(first), deterministicJson(second));
  assertEquals(first.relations.length, 2);
  assertEquals(first.nodes.some((node) => node.kind === "component"), false);
  assertEquals(first.nodes.find((node) => node.kind === "parameter")?.semanticRef, {
    domain: "thread",
    kind: "parameter",
    id: "sensitivity-parameter:case-sensitivity:part:size-z",
    basisFingerprint: FP("d".repeat(64)),
  });
  const derivativeByMetric = new Map(first.relations.map((item) => [
    item.assertion.to.id,
    item.assertion.measurement?.derivative,
  ]));
  assertEquals(
    derivativeByMetric.get(
      "sensitivity-response:case-sensitivity:assembly_max_displacement",
    ),
    { value: 0.1, unit: "mm/mm" },
  );
  assertEquals(
    derivativeByMetric.get(
      "sensitivity-response:case-sensitivity:assembly_max_von_mises",
    ),
    { value: 0.09999999999999998, unit: "MPa/mm" },
  );
  for (
    const relation of first.relations.filter((relation) =>
      relation.assertion.relation === "measured-local-sensitivity"
    )
  ) {
    assertEquals(relation.assertion.evidence, [
      { id: "sensitivity-capture", fingerprint: FP("c".repeat(64)) },
    ]);
    assertEquals(relation.assertion.scope.kind, "local-neighborhood");
    if (relation.assertion.scope.kind !== "local-neighborhood") {
      throw new Error("Measured sensitivity must retain its local neighborhood.");
    }
    assertEquals(relation.assertion.scope.lower, { value: 30, unit: "mm" });
    assertEquals(relation.assertion.scope.upper, { value: 31, unit: "mm" });
    assertEquals(
      relation.assertion.scope.basisFingerprint,
      FP("d".repeat(64)),
    );
  }
});

Deno.test("sensitivity analysis graph bounds a negative step by the two observed parameter points", () => {
  const input = graphInput();
  input.sensitivityCase = validateSensitivityStudyCaseV3({
    ...input.sensitivityCase,
    step: { value: -1, unit: "mm" },
  });
  const graph = buildSensitivityAnalysisGraph(input);

  for (
    const relation of graph.relations.filter((relation) =>
      relation.assertion.relation === "measured-local-sensitivity"
    )
  ) {
    assertEquals(relation.assertion.scope.kind, "local-neighborhood");
    if (relation.assertion.scope.kind !== "local-neighborhood") {
      throw new Error("Measured sensitivity must retain its local neighborhood.");
    }
    assertEquals(relation.assertion.scope.lower, { value: 29, unit: "mm" });
    assertEquals(relation.assertion.scope.upper, { value: 30, unit: "mm" });
  }
});

Deno.test("sensitivity analysis graph rejects a response measurement with a declared-unit mismatch", () => {
  const input = graphInput();
  input.baseMetrics.set("assembly_max_displacement", { value: 0.1, unit: "m" });
  assertThrows(
    () => buildSensitivityAnalysisGraph(input),
    TypeError,
    'expected "mm"',
  );
});

Deno.test("sensitivity graph keeps semantic nodes stable across capture occurrences", () => {
  const input = graphInput();
  const first = buildSensitivityAnalysisGraph(input);
  input.evidence = {
    capture: { id: "sensitivity-capture-2", fingerprint: FP("e".repeat(64)) },
  };
  const second = buildSensitivityAnalysisGraph(input);

  assertEquals(first.nodes, second.nodes);
  assertEquals(
    first.relations.map((relation) => relation.assertion.id).some((id) =>
      second.relations.some((relation) => relation.assertion.id === id)
    ),
    false,
  );
  assertEquals(
    first.relations[0]?.assertion.scope,
    second.relations[0]?.assertion.scope,
  );
});

function graphInput() {
  return {
    caseFingerprint: FP("d".repeat(64)),
    sensitivityCase: validateSensitivityStudyCaseV3({
      schemaVersion: "sensitivity-study-case/3.0",
      id: "case-sensitivity",
      revision: 1,
      scope: "test",
      evidenceBoundary: "test",
      project: { id: "project", subjectId: "project:subject" },
      target: { componentKey: "part", semanticKey: "size-z" },
      cadSource: {
        artifactUri: "thread-artifact://project/admission",
        sha256: "a".repeat(64),
      },
      baseValue: { value: 30, unit: "mm" },
      step: { value: 1, unit: "mm" },
      metrics: [
        { id: "assembly_max_displacement", unit: "mm" },
        { id: "assembly_max_von_mises", unit: "MPa" },
      ],
      method: {
        mesh: { kind: "tetrahedral-volume", targetSizeMm: 1 },
        material: {
          model: "isotropic-linear-elastic",
          eMpa: 1,
          nu: 0.3,
          basis: "test",
        },
        supports: [{
          id: "support",
          kind: "fixed",
          selection: {
            name: "FIXED",
            box: { min: [0, 0, 0], max: [1, 1, 1], unit: "mm" },
          },
        }],
        loads: [{
          id: "load",
          kind: "force",
          selection: {
            name: "LOADED",
            box: { min: [2, 2, 2], max: [3, 3, 3], unit: "mm" },
          },
          force: { value: [0, 0, -1], unit: "N" },
        }],
      },
      domain: {
        approximationOrder: "first-order-forward",
        remeshingVariationIncluded: true,
        localValidityNote: "test",
        limitations: ["test"],
      },
    }),
    baseMetrics: new Map([
      ["assembly_max_displacement", { value: 0.1, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.5, unit: "MPa" }],
    ]),
    steppedMetrics: new Map([
      ["assembly_max_displacement", { value: 0.2, unit: "mm" }],
      ["assembly_max_von_mises", { value: 0.6, unit: "MPa" }],
    ]),
    evidence: {
      capture: { id: "sensitivity-capture", fingerprint: FP("c".repeat(64)) },
    },
  };
}

Deno.test(
  "buildSensitivityAnalysisGraph emits observed measured-local-sensitivity from a 3.0 case and never a verdict",
  () => {
    const graph = buildSensitivityAnalysisGraph({
      caseFingerprint: FP("d".repeat(64)),
      sensitivityCase: validateSensitivityStudyCaseV3({
        schemaVersion: "sensitivity-study-case/3.0",
        id: "case-sensitivity",
        revision: 1,
        scope: "test",
        evidenceBoundary: "test",
        project: { id: "project", subjectId: "project:subject" },
        target: { componentKey: "part", semanticKey: "size-z" },
        cadSource: {
          artifactUri: "thread-artifact://project/admission",
          sha256: "a".repeat(64),
        },
        baseValue: { value: 30, unit: "mm" },
        step: { value: 1, unit: "mm" },
        metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
        method: {
          mesh: { kind: "tetrahedral-volume", targetSizeMm: 1 },
          material: {
            model: "isotropic-linear-elastic",
            eMpa: 1,
            nu: 0.3,
            basis: "test",
          },
          supports: [{
            id: "support",
            kind: "fixed",
            selection: {
              name: "FIXED",
              box: { min: [0, 0, 0], max: [1, 1, 1], unit: "mm" },
            },
          }],
          loads: [{
            id: "load",
            kind: "force",
            selection: {
              name: "LOADED",
              box: { min: [2, 2, 2], max: [3, 3, 3], unit: "mm" },
            },
            force: { value: [0, 0, -1], unit: "N" },
          }],
        },
        domain: {
          approximationOrder: "first-order-forward",
          remeshingVariationIncluded: true,
          localValidityNote: "test",
          limitations: ["test"],
        },
      }),
      baseMetrics: new Map([
        ["assembly_max_displacement", { value: 0.1, unit: "mm" }],
      ]),
      steppedMetrics: new Map([
        ["assembly_max_displacement", { value: 0.2, unit: "mm" }],
      ]),
      evidence: {
        capture: { id: "sensitivity-capture", fingerprint: FP("c".repeat(64)) },
      },
    });
    assertEquals(graph.relations[0]?.assertion.relation, "measured-local-sensitivity");
    assertEquals(graph.relations[0]?.assertion.epistemicBasis, "observed");
    assertEquals("verdict" in (graph.relations[0]?.assertion ?? {}), false);
  },
);
