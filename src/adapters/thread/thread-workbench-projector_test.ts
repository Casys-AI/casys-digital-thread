import { assertEquals } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateAnalysisGraph } from "../../domain/thread/analysis-graph.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { projectThreadWorkbenchSnapshot } from "./thread-workbench-projector.ts";

const AT = "2026-08-01T08:00:00.000Z";

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
type MutableThreadSnapshot = Mutable<ThreadSnapshot>;

Deno.test("ThreadSnapshot projects linked evidence into the native Workbench contract", () => {
  const canonical = linkedSnapshot();
  const projection = projectThreadWorkbenchSnapshot(canonical);

  assertEquals(projection.schemaVersion, "thread-workbench/0.2");
  assertEquals(projection.source, "observed");
  assertEquals(projection.subject.label, "Generic Product GEN-01");
  assertEquals(Object.hasOwn(projection, "components"), false);
  assertEquals(projection.engineeringCases, {
    schemaVersion: "engineering-cases/1.0",
    status: "unavailable",
    coverage: [
      { family: "mechanical-proof", status: "unavailable" },
      { family: "sensitivity-study", status: "unavailable" },
      { family: "printability-check", status: "unavailable" },
      { family: "print-estimate", status: "unavailable" },
      { family: "dfm-check", status: "unavailable" },
    ],
    cases: [],
    issues: [],
  });
  assertEquals(projection.evidenceFamilyGraph, {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-generic-r2", revision: 2 },
    families: [],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  });
  assertEquals(projection.previous, {
    snapshotId: "thread-generic-r1",
    revision: 1,
  });
  assertEquals(projection.change.id, "changes-r2");
  assertEquals(projection.change.files, []);
  assertEquals(
    projection.change.summary,
    "Bracket wall thickness changed from 2.0 mm to 1.8 mm.",
  );

  assertEquals(projection.artifacts.map((artifact) => artifact.id), [
    "step-r2",
    "fea-r2",
  ]);
  assertEquals(projection.artifacts[1].attestation, {
    status: "verified",
    sourceArtifactId: "step-r2",
    producerFingerprint: `sha256:${"a".repeat(64)}`,
    consumedFingerprint: `sha256:${"a".repeat(64)}`,
    checkedAt: AT,
  });
  assertEquals(projection.observations[0].requirementIds, ["REQ-STRESS"]);
  assertEquals(projection.requirements[0].status, "fail");
  assertEquals(projection.requirements[0].violationIds, ["VIO-STRESS"]);
  assertEquals(projection.violations.map((violation) => violation.id), [
    "VIO-STRESS",
  ]);
  assertEquals(projection.violations[0].margin, "-12 MPa");
  assertEquals(projection.actions[0].targetId, "step-r2");
  assertEquals(flowDependencies(projection), {
    "flow:changes-r2": [],
    "flow:artifact:step-r2": [],
    "flow:artifact:fea-r2": ["flow:artifact:step-r2"],
    "flow:observation:OBS-STRESS": ["flow:artifact:fea-r2"],
    "flow:requirement:REQ-STRESS": ["flow:artifact:step-r2"],
    "flow:evaluation:EVAL-STRESS": [
      "flow:requirement:REQ-STRESS",
      "flow:observation:OBS-STRESS",
      "flow:artifact:fea-r2",
    ],
    "flow:violation:VIO-STRESS": [
      "flow:evaluation:EVAL-STRESS",
      "flow:artifact:fea-r2",
    ],
  });
  assertEquals(
    projection.graph.nodes.map((node) => `${node.ref.kind}:${node.ref.id}`),
    [
      "change:change-wall",
      "artifact:step-r2",
      "artifact:fea-r2",
      "consumption:consume-step-r2",
      "observation:OBS-STRESS",
      "requirement:REQ-STRESS",
      "evaluation:EVAL-STRESS",
      "violation:VIO-STRESS",
      "action:ACT-CORRECT",
    ],
  );
  assertEquals(graphEdgeSignatures(projection), [
    "changes:change:change-wall->artifact:step-r2:provenance",
    "derived_from:artifact:step-r2->artifact:fea-r2:provenance",
    "uses:artifact:step-r2->consumption:consume-step-r2:provenance",
    "derived_from:artifact:fea-r2->observation:OBS-STRESS:provenance",
    "traces_to:artifact:step-r2->requirement:REQ-STRESS:provenance",
    "evaluates:requirement:REQ-STRESS->evaluation:EVAL-STRESS:provenance",
    "uses:observation:OBS-STRESS->evaluation:EVAL-STRESS:provenance",
    "evidences:artifact:fea-r2->evaluation:EVAL-STRESS:provenance",
    "caused_by:evaluation:EVAL-STRESS->violation:VIO-STRESS:provenance",
    "evidences:artifact:fea-r2->violation:VIO-STRESS:provenance",
    "addresses:violation:VIO-STRESS->action:ACT-CORRECT:provenance",
    "input_to:artifact:step-r2->artifact:fea-r2:structure",
    "source_of:artifact:fea-r2->observation:OBS-STRESS:structure",
  ]);
  const provenance = projection.graph.edges.find((edge) =>
    edge.id === "link-derived_from-artifact-fea-r2-artifact-step-r2"
  );
  assertEquals(provenance?.rationale, "Canonical relation for projector test.");
  assertEquals(provenance?.attestation, {
    consumptionId: "consume-step-r2",
    status: "verified",
    producerFingerprint: `sha256:${"a".repeat(64)}`,
    consumedFingerprint: `sha256:${"a".repeat(64)}`,
    checkedAt: AT,
  });
  assertEquals(
    projection.graph.edges.filter((edge) =>
      edge.relation === "traces_to" &&
      edge.from.kind === "artifact" && edge.from.id === "step-r2" &&
      edge.to.kind === "requirement" && edge.to.id === "REQ-STRESS"
    ).map((edge) => edge.origin),
    ["provenance"],
  );
});

Deno.test("Activity never infers milestones from artifact id or provider", () => {
  const canonical = clone(linkedSnapshot());
  const extras = [
    {
      id: `dfm-check-${"c".repeat(64)}`,
      name: "Measured DFM",
      tool: "industrialize.run-dfm-checks@1",
    },
    {
      id: `sensitivity-base-evaluation-${"d".repeat(64)}`,
      name: "Study-base evaluation",
      tool: "verify.evaluate-sensitivity-base@1",
    },
  ];
  for (const extra of extras) {
    const digest = extra.id.split("-").at(-1)!;
    canonical.artifacts.push({
      id: extra.id,
      name: extra.name,
      kind: "document",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      producer: operation(
        "digital-thread",
        extra.tool,
        "run-demo",
      ),
      inputArtifactIds: ["step-r2"],
      freshness: fresh(),
    });
    canonical.changeSet.changes.push({
      id: `change-${extra.id}`,
      kind: "created",
      target: { kind: "artifact", id: extra.id },
      summary: extra.name,
      afterFingerprint: { algorithm: "sha256", digest },
    });
    canonical.consumptions.push({
      id: `consume-step-r2-by-${extra.id}`,
      artifactId: "step-r2",
      consumer: operation(
        "digital-thread",
        extra.tool,
        "run-demo",
      ),
      observedFingerprint: fingerprint("a"),
      verifiedAt: AT,
      status: "verified",
    });
    canonical.provenance.push(
      link("changes", "change", `change-${extra.id}`, "artifact", extra.id),
      link(
        "uses",
        "consumption",
        `consume-step-r2-by-${extra.id}`,
        "artifact",
        "step-r2",
      ),
      link("derived_from", "artifact", extra.id, "artifact", "step-r2"),
    );
  }
  const projection = projectThreadWorkbenchSnapshot(
    validateThreadSnapshot(canonical),
  );
  const roles = extras.map((extra) => {
    const node = projection.graph.nodes.find((item) => item.ref.id === extra.id);
    return { id: extra.id, activityRole: node?.activityRole };
  });
  assertEquals(
    roles,
    extras.map((extra) => ({
      id: extra.id,
      activityRole: undefined,
    })),
  );
  assertEquals(
    projection.graph.nodes.find((item) => item.ref.id === "fea-r2")?.activityRole,
    undefined,
  );
});

Deno.test("the Workbench projects a qualified sensitivity assertion separately from provenance", () => {
  const canonical = linkedSnapshot();
  canonical.schemaVersion = "1.1";
  canonical.analysisGraph = structuredClone(validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes: [{
      id: "analysis:parameter:wall-thickness",
      kind: "parameter",
      semanticRef: {
        domain: "thread",
        kind: "parameter",
        id: "wall-thickness",
        basisFingerprint: fingerprint("a"),
      },
    }, {
      id: "analysis:metric:von-mises-max",
      kind: "metric",
      semanticRef: {
        domain: "calculix",
        kind: "metric",
        id: "von-mises-max",
      },
    }],
    relations: [{
      fromNodeId: "analysis:parameter:wall-thickness",
      toNodeId: "analysis:metric:von-mises-max",
      assertion: {
        schemaVersion: "engineering-assertion/1.0",
        id: "assertion:sensitivity:wall-thickness:von-mises-max",
        relation: "measured-local-sensitivity",
        from: {
          domain: "thread",
          kind: "parameter",
          id: "wall-thickness",
          basisFingerprint: fingerprint("a"),
        },
        to: {
          domain: "calculix",
          kind: "metric",
          id: "von-mises-max",
        },
        epistemicBasis: "observed",
        assertedBy: { kind: "provider", id: "calculix", version: "2.20" },
        evidence: [{ id: "step-r2", fingerprint: fingerprint("a") }, {
          id: "fea-r2",
          fingerprint: fingerprint("b"),
        }],
        scope: {
          kind: "local-neighborhood",
          parameter: {
            domain: "thread",
            kind: "parameter",
            id: "wall-thickness",
            basisFingerprint: fingerprint("a"),
          },
          basisFingerprint: fingerprint("a"),
          lower: { value: 1.6, unit: "mm" },
          upper: { value: 2, unit: "mm" },
        },
        measurement: {
          method: "forward-finite-difference",
          basePoint: { value: 1.8, unit: "mm" },
          perturbationStep: { value: 0.1, unit: "mm" },
          responseAtBase: { value: 132, unit: "MPa" },
          responseAtPerturbed: { value: 119, unit: "MPa" },
          derivative: { value: -130, unit: "MPa/mm" },
        },
        rationale: "Measured from the exact retained CalculiX result pair.",
      },
    }],
  })) as Mutable<NonNullable<ThreadSnapshot["analysisGraph"]>>;
  const validated = validateThreadSnapshot(canonical);

  const projection = projectThreadWorkbenchSnapshot(validated);
  const analysisNodes = projection.graph.nodes.filter((node) =>
    node.entityKind === "analysis-node"
  );
  const edge = projection.graph.edges.find((candidate) =>
    candidate.id === "assertion:sensitivity:wall-thickness:von-mises-max"
  );

  assertEquals(analysisNodes.map((node) => node.ref), [{
    kind: "analysis-node",
    id: "analysis:metric:von-mises-max",
  }, {
    kind: "analysis-node",
    id: "analysis:parameter:wall-thickness",
  }]);
  assertEquals(analysisNodes[1]?.analysis, {
    semanticRef: {
      domain: "thread",
      kind: "parameter",
      id: "wall-thickness",
      basisFingerprint: "a".repeat(64),
    },
  });
  assertEquals(edge?.origin, "analysis");
  assertEquals(edge?.relation, "measured-local-sensitivity");
  assertEquals(edge?.from, {
    kind: "analysis-node",
    id: "analysis:parameter:wall-thickness",
  });
  assertEquals(edge?.to, {
    kind: "analysis-node",
    id: "analysis:metric:von-mises-max",
  });
  assertEquals(edge?.attestation, undefined);
  assertEquals(edge?.analysis, {
    assertionId: "assertion:sensitivity:wall-thickness:von-mises-max",
    epistemicBasis: "observed",
    assertedBy: { kind: "provider", id: "calculix", version: "2.20" },
    evidence: [{ id: "fea-r2", fingerprint: "b".repeat(64) }, {
      id: "step-r2",
      fingerprint: "a".repeat(64),
    }],
    scope: {
      kind: "local-neighborhood",
      parameter: {
        domain: "thread",
        kind: "parameter",
        id: "wall-thickness",
        basisFingerprint: "a".repeat(64),
      },
      basisFingerprint: "a".repeat(64),
      lower: { value: 1.6, unit: "mm" },
      upper: { value: 2, unit: "mm" },
    },
    measurement: {
      method: "forward-finite-difference",
      basePoint: { value: 1.8, unit: "mm" },
      perturbationStep: { value: 0.1, unit: "mm" },
      responseAtBase: { value: 132, unit: "MPa" },
      responseAtPerturbed: { value: 119, unit: "MPa" },
      derivative: { value: -130, unit: "MPa/mm" },
    },
  });
  assertEquals(
    projection.graph.edges.some((candidate) =>
      candidate.origin === "provenance" && candidate.relation === "derived_from"
    ),
    true,
  );
  assertEquals(
    projection.evidenceFamilyGraph.edges.some((candidate) =>
      candidate.memberEdgeRefs.some((reference) =>
        reference.id === edge?.id || reference.origin === "analysis"
      )
    ),
    false,
  );
});

Deno.test("analysis-node ids that already include the kind prefix are not wrapped twice", () => {
  const canonical = linkedSnapshot();
  canonical.schemaVersion = "1.1";
  canonical.analysisGraph = structuredClone(validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes: [{
      id: "analysis-node:brief-item:abc:assume-material",
      kind: "brief-item",
      semanticRef: {
        domain: "brief",
        kind: "brief-item",
        id: "assume-material",
        basisFingerprint: fingerprint("a"),
      },
    }, {
      id: "analysis-node:brief-item:abc:crit-arm",
      kind: "brief-item",
      semanticRef: {
        domain: "brief",
        kind: "brief-item",
        id: "crit-arm",
        basisFingerprint: fingerprint("a"),
      },
    }],
    relations: [{
      fromNodeId: "analysis-node:brief-item:abc:assume-material",
      toNodeId: "analysis-node:brief-item:abc:crit-arm",
      assertion: {
        schemaVersion: "engineering-assertion/1.0",
        id: "assertion:brief:assume-material:crit-arm",
        relation: "declared-dependency",
        from: {
          domain: "brief",
          kind: "brief-item",
          id: "assume-material",
          basisFingerprint: fingerprint("a"),
        },
        to: {
          domain: "brief",
          kind: "brief-item",
          id: "crit-arm",
          basisFingerprint: fingerprint("a"),
        },
        epistemicBasis: "declared",
        assertedBy: { kind: "analyzer", id: "brief-frontend" },
        evidence: [{ id: "step-r2", fingerprint: fingerprint("a") }],
        scope: { kind: "basis", basisFingerprint: fingerprint("a") },
        rationale: "The brief declared this dependency.",
      },
    }],
  })) as Mutable<NonNullable<ThreadSnapshot["analysisGraph"]>>;

  const projection = projectThreadWorkbenchSnapshot(
    validateThreadSnapshot(canonical),
  );
  const analysisIds = projection.graph.nodes
    .filter((node) => node.entityKind === "analysis-node")
    .map((node) => node.id)
    .sort();
  assertEquals(analysisIds, [
    "graph:analysis-node:brief-item:abc:assume-material",
    "graph:analysis-node:brief-item:abc:crit-arm",
  ]);
  assertEquals(
    analysisIds.some((id) => id.includes("analysis-node:analysis-node:")),
    false,
  );
});

Deno.test("study-base evaluations carry evaluationFamily and proof evaluations do not", () => {
  const canonical = linkedSnapshot();
  canonical.evaluations.push({
    id: "REQ-STRESS-evaluation-study",
    name: "Allowable bracket stress study-base evaluation",
    requirementId: "REQ-STRESS",
    observationIds: [`sensitivity-base-von_mises_max-${"c".repeat(64)}`],
    status: "pass",
    evaluatedAt: "2026-08-16T00:00:00.000Z",
    evaluator: {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: "run-study-base",
    },
    evidenceArtifactIds: [`sensitivity-base-evaluation-${"c".repeat(64)}`],
    message: "The study-base observation is within the reviewed concept limit.",
    freshness: fresh(),
  });
  const projection = projectThreadWorkbenchSnapshot(
    canonical as ThreadSnapshot,
  );
  const studyBase = projection.graph.nodes.find((node) =>
    node.ref.id === "REQ-STRESS-evaluation-study"
  );
  const proof = projection.graph.nodes.find((node) =>
    node.entityKind === "evaluation" &&
    node.ref.id !== "REQ-STRESS-evaluation-study"
  );
  assertEquals(studyBase?.evaluationFamily, "study-base");
  assertEquals(proof?.evaluationFamily, undefined);
});

Deno.test("the Workbench flow hides retired current entities but retains the archive change", () => {
  const snapshot = clone(linkedSnapshot());
  const archived = [
    ["artifact", "step-r2"],
    ["artifact", "fea-r2"],
    ["observation", "OBS-STRESS"],
    ["requirement", "REQ-STRESS"],
    ["evaluation", "EVAL-STRESS"],
    ["violation", "VIO-STRESS"],
  ] as const;
  snapshot.changeSet.changes.push(...archived.map(([kind, id]) => ({
    id: `archive:${kind}:${id}`,
    kind: "archived" as const,
    target: { kind, id },
    summary: `Retired ${kind}:${id}.`,
  })));
  snapshot.provenance.push(
    ...archived.map(([kind, id]) =>
      link("changes", "change", `archive:${kind}:${id}`, kind, id)
    ),
  );

  const projection = projectThreadWorkbenchSnapshot(snapshot);
  assertEquals(projection.flow.map((stage) => stage.id), ["flow:changes-r2"]);
  assertEquals(projection.change.summary, "Retired violation:VIO-STRESS.");
  assertEquals(projection.artifacts, []);
  assertEquals(projection.observations, []);
  assertEquals(projection.requirements, []);
  assertEquals(projection.violations, []);
});

Deno.test("the Workbench omits predecessor history for an initial snapshot", () => {
  const canonical = linkedSnapshot();
  delete canonical.previous;

  const projection = projectThreadWorkbenchSnapshot(canonical);

  assertEquals(projection.previous, undefined);
});

Deno.test(
  "the Workbench wraps architecture-capture predecessor and tip as one family",
  () => {
    const canonical = clone(linkedSnapshot());
    const predecessorDigest = "4".repeat(64);
    const tipDigest = "5".repeat(64);
    const predecessorId = `architecture-${predecessorDigest}`;
    const tipId = `architecture-${tipDigest}`;
    canonical.artifacts.push(
      {
        id: predecessorId,
        name: "Architecture: DeskLampDL04",
        kind: "sysml-model",
        version: predecessorDigest,
        fingerprint: { algorithm: "sha256", digest: predecessorDigest },
        uri: `casys://architecture-capture/sha256/${predecessorDigest}`,
        producer: operation("syson", "syson_element_insert_sysml", "run-arch-v2"),
        inputArtifactIds: [],
        freshness: fresh(),
      },
      {
        id: tipId,
        name: "Architecture: DeskLampDL04",
        kind: "sysml-model",
        version: tipDigest,
        fingerprint: { algorithm: "sha256", digest: tipDigest },
        uri: `casys://architecture-capture/sha256/${tipDigest}`,
        producer: operation("syson", "syson_element_insert_sysml", "run-arch-v3"),
        inputArtifactIds: [predecessorId],
        freshness: fresh(),
      },
    );
    canonical.provenance.push(
      link("derived_from", "artifact", tipId, "artifact", predecessorId),
    );

    const projection = projectThreadWorkbenchSnapshot(canonical);
    const family = projection.evidenceFamilyGraph.families.find((candidate) =>
      candidate.currentRefs.some((reference) => reference.id === tipId)
    );

    assertEquals(family?.status, "current");
    assertEquals(family?.historicalRefs.map((reference) => reference.id), [
      predecessorId,
    ]);
    assertEquals(
      projection.flow.some((stage) => stage.id === `flow:artifact:${predecessorId}`),
      false,
    );
    assertEquals(
      projection.flow.some((stage) => stage.id === `flow:artifact:${tipId}`),
      true,
    );
  },
);

Deno.test("the Workbench BFF projects a convergent requirement revision family", () => {
  const canonical = linkedSnapshot();
  const original = canonical.requirements[0]!;
  const r1 = {
    ...original,
    id: "REQ-STRESS-R1",
    version: "1",
    freshness: {
      status: "stale" as const,
      changedAt: AT,
      invalidatedByChangeIds: [],
    },
  };
  const r2 = {
    ...original,
    id: "REQ-STRESS-R2",
    version: "2",
  };
  const r3 = {
    ...original,
    id: "REQ-STRESS-R3",
    version: "3",
  };
  canonical.requirements = [r1, r2, r3];
  canonical.evaluations[0] = {
    ...canonical.evaluations[0]!,
    requirementId: r3.id,
    status: "pass",
    message: "The current requirement passes.",
  };
  canonical.provenance.push(
    link("supersedes", "requirement", r3.id, "requirement", r1.id),
    link("supersedes", "requirement", r3.id, "requirement", r2.id),
  );

  const projection = projectThreadWorkbenchSnapshot(canonical);
  const family = projection.evidenceFamilyGraph.families.find((candidate) =>
    candidate.entityKind === "requirement" &&
    candidate.currentRefs.some((reference) => reference.id === r3.id)
  );

  assertEquals(family?.status, "current");
  assertEquals(family?.historicalRefs.map((reference) => reference.id), [
    r1.id,
    r2.id,
  ]);
  assertEquals(family?.currentRefs.map((reference) => reference.id), [r3.id]);
});

Deno.test("the Workbench projects only the latest revision change summary", () => {
  const canonical = linkedSnapshot();
  canonical.changeSet.changes.unshift({
    id: "change-older",
    kind: "modified",
    target: { kind: "artifact", id: "step-r2" },
    summary: "Older history kept for canonical validation.",
    beforeFingerprint: fingerprint("d"),
    afterFingerprint: fingerprint("0"),
  });
  canonical.provenance.unshift(link(
    "changes",
    "change",
    "change-older",
    "artifact",
    "step-r2",
  ));

  const projection = projectThreadWorkbenchSnapshot(canonical);

  assertEquals(
    projection.change.summary,
    "Bracket wall thickness changed from 2.0 mm to 1.8 mm.",
  );
  assertEquals(
    projection.flow.find((stage) => stage.selection.kind === "change")?.summary,
    "Bracket wall thickness changed from 2.0 mm to 1.8 mm.",
  );
  assertEquals(canonical.changeSet.changes.length, 2);
});

Deno.test("the graph links a requirement only to its explicit source capture", () => {
  const canonical = clone(linkedSnapshot());
  canonical.provenance = [];

  const projection = projectThreadWorkbenchSnapshot(canonical);
  const dependencies = flowDependencies(projection);

  // Artifact input and observation source are explicit structural facts.
  assertEquals(dependencies["flow:artifact:fea-r2"], ["flow:artifact:step-r2"]);
  assertEquals(dependencies["flow:observation:OBS-STRESS"], [
    "flow:artifact:fea-r2",
  ]);
  // Requirement capture is an explicit structural fact. It does not grant a
  // planning dependency or imply evaluation and violation authority.
  assertEquals(dependencies["flow:requirement:REQ-STRESS"], []);
  assertEquals(dependencies["flow:evaluation:EVAL-STRESS"], []);
  assertEquals(dependencies["flow:violation:VIO-STRESS"], []);
  assertEquals(graphEdgeSignatures(projection), [
    "input_to:artifact:step-r2->artifact:fea-r2:structure",
    "source_of:artifact:fea-r2->observation:OBS-STRESS:structure",
    "traces_to:artifact:step-r2->requirement:REQ-STRESS:structure",
  ]);

  canonical.requirements[0]!.trace.sourceArtifactId = "missing-requirement-capture";
  const missingSourceProjection = projectThreadWorkbenchSnapshot(canonical);
  assertEquals(
    missingSourceProjection.graph.edges.some((edge) =>
      edge.to.kind === "requirement" && edge.to.id === "REQ-STRESS"
    ),
    false,
  );
});

Deno.test("a consumer fingerprint mismatch is visible and stales dependent UI evidence", () => {
  const canonical = clone(linkedSnapshot());
  canonical.consumptions[0].status = "mismatch";
  canonical.consumptions[0].observedFingerprint = fingerprint("c");

  const projection = projectThreadWorkbenchSnapshot(canonical);
  const result = projection.artifacts.find((artifact) => artifact.id === "fea-r2");
  const observation = projection.observations.find((item) => item.id === "OBS-STRESS");

  assertEquals(result?.freshness, "stale");
  assertEquals(result?.attestation?.status, "mismatch");
  assertEquals(
    result?.attestation?.producerFingerprint,
    `sha256:${"a".repeat(64)}`,
  );
  assertEquals(
    result?.attestation?.consumedFingerprint,
    `sha256:${"c".repeat(64)}`,
  );
  assertEquals(observation?.freshness, "stale");
  assertEquals(projection.requirements[0].status, "unresolved");
});

Deno.test("the projector never synthesizes a violation absent from the canonical snapshot", () => {
  const canonical = clone(linkedSnapshot());
  canonical.violations = [];
  canonical.proposedActions = [];

  const projection = projectThreadWorkbenchSnapshot(canonical);

  assertEquals(projection.requirements[0].status, "fail");
  assertEquals(projection.requirements[0].violationIds, []);
  assertEquals(projection.violations, []);
  assertEquals(
    projection.flow.some((stage) => stage.selection.kind === "violation"),
    false,
  );
});

function linkedSnapshot(): MutableThreadSnapshot {
  const cad = operation("mcp-build123d", "build123d_export", "cad-run-r2");
  const fea = operation("mcp-calculix", "calculix_solve_static", "fea-run-r2");
  const oracle = operation("mcp-syson", "evaluate_requirement", "eval-run-r2");
  return {
    schemaVersion: "1.0",
    id: "thread-generic-r2",
    revision: 2,
    previous: { snapshotId: "thread-generic-r1", revision: 1 },
    generatedAt: AT,
    subject: {
      id: "GEN-01",
      name: "Generic Product GEN-01",
      kind: "system",
      version: "2",
      modelArtifactId: "step-r2",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-r2",
      name: "Reduce bracket wall thickness",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-wall",
        kind: "modified",
        target: { kind: "artifact", id: "step-r2" },
        summary: "Bracket wall thickness changed from 2.0 mm to 1.8 mm.",
        beforeFingerprint: fingerprint("0"),
        afterFingerprint: fingerprint("a"),
      }],
    },
    // Intentionally reverse ordered: the projector must emit causal artifact order.
    artifacts: [
      {
        id: "fea-r2",
        name: "Bracket static solve",
        kind: "solver-result",
        version: "2",
        fingerprint: fingerprint("b"),
        uri: "artifact://fea-r2/results.frd",
        producer: fea,
        inputArtifactIds: ["step-r2"],
        freshness: fresh(),
      },
      {
        id: "step-r2",
        name: "Bracket STEP",
        kind: "step",
        version: "2",
        fingerprint: fingerprint("a"),
        uri: "artifact://cad-r2/bracket.step",
        producer: cad,
        inputArtifactIds: [],
        freshness: fresh(),
      },
    ],
    consumptions: [{
      id: "consume-step-r2",
      artifactId: "step-r2",
      consumer: fea,
      observedFingerprint: fingerprint("a"),
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [{
      id: "OBS-STRESS",
      name: "Maximum von Mises stress",
      metric: "von_mises_max",
      quantity: { value: 132, unit: "MPa" },
      source: {
        operation: fea,
        artifactIds: ["fea-r2"],
        capturedAt: AT,
      },
      freshness: fresh(),
    }],
    requirements: [{
      id: "REQ-STRESS",
      name: "Allowable bracket stress",
      statement: "Bracket stress shall not exceed 120 MPa.",
      version: "2",
      criterion: {
        metric: "von_mises_max",
        operator: "<=",
        limit: { value: 120, unit: "MPa" },
      },
      trace: {
        sourceArtifactId: "step-r2",
        elementId: "REQ-STRESS-ELEMENT",
        targetArtifactIds: ["step-r2"],
      },
      freshness: fresh(),
    }],
    evaluations: [{
      id: "EVAL-STRESS",
      name: "Evaluate bracket stress",
      requirementId: "REQ-STRESS",
      observationIds: ["OBS-STRESS"],
      status: "fail",
      evaluatedAt: AT,
      evaluator: oracle,
      comparison: {
        observationId: "OBS-STRESS",
        actual: { value: 132, unit: "MPa" },
        operator: "<=",
        limit: { value: 120, unit: "MPa" },
        normalizedUnit: "MPa",
        margin: { value: -12, unit: "MPa" },
      },
      evidenceArtifactIds: ["fea-r2"],
      message: "132 MPa exceeds the 120 MPa limit.",
      freshness: fresh(),
    }],
    violations: [{
      id: "VIO-STRESS",
      name: "Bracket allowable stress exceeded",
      requirementId: "REQ-STRESS",
      evaluationId: "EVAL-STRESS",
      severity: "error",
      status: "open",
      detectedAt: AT,
      observationIds: ["OBS-STRESS"],
      evidenceArtifactIds: ["fea-r2"],
      summary: "The bracket exceeds allowable stress by 12 MPa.",
      freshness: fresh(),
    }],
    provenance: [
      link("changes", "change", "change-wall", "artifact", "step-r2"),
      link("derived_from", "artifact", "fea-r2", "artifact", "step-r2"),
      link("uses", "consumption", "consume-step-r2", "artifact", "step-r2"),
      link("derived_from", "observation", "OBS-STRESS", "artifact", "fea-r2"),
      link("traces_to", "requirement", "REQ-STRESS", "artifact", "step-r2"),
      link(
        "evaluates",
        "evaluation",
        "EVAL-STRESS",
        "requirement",
        "REQ-STRESS",
      ),
      link("uses", "evaluation", "EVAL-STRESS", "observation", "OBS-STRESS"),
      link("evidences", "evaluation", "EVAL-STRESS", "artifact", "fea-r2"),
      link("caused_by", "violation", "VIO-STRESS", "evaluation", "EVAL-STRESS"),
      link("evidences", "violation", "VIO-STRESS", "artifact", "fea-r2"),
      link("addresses", "action", "ACT-CORRECT", "violation", "VIO-STRESS"),
    ],
    proposedActions: [{
      id: "ACT-CORRECT",
      name: "Correct bracket geometry",
      kind: "correct",
      readiness: "ready",
      rationale: "The named violation has current structural evidence.",
      targets: [{ kind: "artifact", id: "step-r2" }],
      addressesViolationIds: ["VIO-STRESS"],
      dependsOnActionIds: [],
    }],
  };
}

function operation(
  serverId: string,
  tool: string,
  runId: string,
): ThreadOperationRef {
  return { serverId, tool, runId };
}

function fingerprint(character: string): ContentFingerprint {
  return { algorithm: "sha256", digest: character.repeat(64) };
}

function fresh(): Mutable<ThreadFreshness> {
  return { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] };
}

function link(
  relation: ThreadSnapshot["provenance"][number]["relation"],
  fromKind: ThreadSnapshot["provenance"][number]["from"]["kind"],
  fromId: string,
  toKind: ThreadSnapshot["provenance"][number]["to"]["kind"],
  toId: string,
): ThreadSnapshot["provenance"][number] {
  return {
    id: `link-${relation}-${fromKind}-${fromId}-${toKind}-${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: "Canonical relation for projector test.",
  };
}

function flowDependencies(
  projection: ReturnType<typeof projectThreadWorkbenchSnapshot>,
): Record<string, string[]> {
  return Object.fromEntries(
    projection.flow.map((stage) => [stage.id, stage.dependsOn]),
  );
}

function graphEdgeSignatures(
  projection: ReturnType<typeof projectThreadWorkbenchSnapshot>,
): string[] {
  return projection.graph.edges.map((edge) =>
    `${edge.relation}:${edge.from.kind}:${edge.from.id}->${edge.to.kind}:${edge.to.id}:${edge.origin}`
  );
}

function clone(snapshot: ThreadSnapshot): MutableThreadSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MutableThreadSnapshot;
}
