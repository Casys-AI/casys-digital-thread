import { assertEquals } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadComponentCatalog } from "../../domain/thread/thread-component-catalog.ts";
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

Deno.test("Activity marks measured DFM and study-base evaluation as milestones", () => {
  const canonical = clone(linkedSnapshot());
  const extras = [
    { id: `dfm-check-${"c".repeat(64)}`, name: "Measured DFM" },
    {
      id: `sensitivity-base-evaluation-${"d".repeat(64)}`,
      name: "Study-base evaluation",
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
        extra.id.startsWith("dfm-check-")
          ? "industrialize.run-dfm-checks@1"
          : "verify.evaluate-sensitivity-base@1",
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
        extra.id.startsWith("dfm-check-")
          ? "industrialize.run-dfm-checks@1"
          : "verify.evaluate-sensitivity-base@1",
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
      activityRole: "milestone",
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

Deno.test("the Workbench keeps an exact component identity across provider facets", () => {
  const canonical = linkedSnapshot();
  const step = canonical.artifacts.find((artifact) => artifact.id === "step-r2");
  if (!step) throw new Error("Projector fixture is missing step-r2.");
  step.producer.serverId = "build123d";
  const catalog: ThreadComponentCatalog = {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: canonical.subject.id,
    rationale: "Reviewed identity for the projector test.",
    systemViews: {},
    components: [{
      id: "component:support-bracket",
      label: "Support bracket",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: "build123d",
        kind: "artifact",
        id: "step-r2",
        label: "Bracket STEP",
        evidenceArtifactId: "step-r2",
      }],
    }],
  };

  const projection = projectThreadWorkbenchSnapshot(canonical, catalog);

  assertEquals(projection.components.components, [{
    id: "component:support-bracket",
    label: "Support bracket",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "step-r2",
      label: "Bracket STEP",
      evidenceArtifactId: "step-r2",
      status: "verified",
      selection: { kind: "artifact", id: "step-r2" },
    }],
  }]);
});

Deno.test("Evidence projects the exact SysML hierarchy and authoritative STEP identities without changing the canvas contract", () => {
  const { canonical, catalog } = componentStructureFixture();

  const projection = projectThreadWorkbenchSnapshot(canonical, catalog);
  const modelNodes = projection.graph.nodes
    .filter((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    )
    .map((node) => `${node.ref.kind}:${node.ref.id}:${node.label}`)
    .sort();
  assertEquals(modelNodes, [
    "part-definition:def-base:WeightedBase",
    "part-definition:def-head:LampHead",
    "part-definition:def-socket:BulbSocket",
    "part-definition:def-stem:FixedStem",
    "part-definition:def-system:DeskLamp",
    "part-usage:usage-base:base",
    "part-usage:usage-head:head",
    "part-usage:usage-socket:socket",
    "part-usage:usage-stem:stem",
  ]);
  const structure = projection.graph.edges
    .filter((edge) =>
      edge.relation === "contains" || edge.relation === "typed_by" ||
      edge.relation === "represented_by"
    )
    .map((edge) =>
      `${edge.relation}:${edge.from.kind}:${edge.from.id}->${edge.to.kind}:${edge.to.id}`
    )
    .sort();
  assertEquals(structure, [
    "contains:artifact:architecture->part-definition:def-system",
    "contains:part-definition:def-head->part-usage:usage-socket",
    "contains:part-definition:def-stem->part-usage:usage-head",
    "contains:part-definition:def-system->part-usage:usage-base",
    "contains:part-definition:def-system->part-usage:usage-stem",
    "represented_by:part-definition:def-base->artifact:glb-base",
    "represented_by:part-definition:def-base->artifact:step-base",
    "represented_by:part-definition:def-head->artifact:glb-head",
    "represented_by:part-definition:def-head->artifact:step-head",
    "represented_by:part-definition:def-socket->artifact:glb-socket",
    "represented_by:part-definition:def-socket->artifact:step-socket",
    "represented_by:part-definition:def-stem->artifact:glb-stem",
    "represented_by:part-definition:def-stem->artifact:step-stem",
    "represented_by:part-definition:def-system->artifact:step-assembly",
    "typed_by:part-usage:usage-base->part-definition:def-base",
    "typed_by:part-usage:usage-head->part-definition:def-head",
    "typed_by:part-usage:usage-socket->part-definition:def-socket",
    "typed_by:part-usage:usage-stem->part-definition:def-stem",
  ]);
  assertEquals(
    projection.evidenceFamilyGraph.families.some((family) =>
      family.currentRefs.some((reference) =>
        reference.kind === "part-definition" || reference.kind === "part-usage"
      )
    ),
    false,
  );

  const reordered = cloneCatalog(catalog);
  reordered.components.forEach((component) => component.bindings.reverse());
  const reorderedProjection = projectThreadWorkbenchSnapshot(
    canonical,
    reordered,
  );
  assertEquals(
    reorderedProjection.graph.nodes.filter((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ),
    projection.graph.nodes.filter((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ),
  );
});

Deno.test("Evidence indexes a composite PartDefinition module GLB by exact asset identity", () => {
  const { canonical, catalog } = componentStructureFixture();
  const digest = "c".repeat(64);
  canonical.artifacts.push({
    id: "glb-assembly",
    name: "GLTF: DeskLamp assembly",
    kind: "cad-model",
    version: digest,
    fingerprint: fingerprint("c"),
    uri: `/api/thread/assets/${digest}.glb`,
    mediaType: "model/gltf-binary",
    producer: operation(
      "digital-thread",
      "build123d-module-assembler-v1@1.0.0",
      "module-assembly-run",
    ),
    inputArtifactIds: ["geometry-capture"],
    freshness: fresh(),
  });
  catalog.components.find((component) => component.id === "component-system")!
    .preview = {
      provider: "build123d",
      artifactId: "glb-assembly",
      mediaType: "model/gltf-binary",
      url: `/api/thread/assets/${digest}.glb`,
      sha256: digest,
    };

  const projection = projectThreadWorkbenchSnapshot(canonical, catalog);
  assertEquals(
    projection.graph.edges
      .filter((edge) =>
        edge.relation === "represented_by" &&
        edge.from.kind === "part-definition" &&
        edge.from.id === "def-system"
      )
      .map((edge) => `${edge.to.kind}:${edge.to.id}`)
      .sort(),
    ["artifact:glb-assembly", "artifact:step-assembly"],
  );
});

Deno.test("Evidence deduplicates one reused PartDefinition and refuses ambiguous reviewed bindings", () => {
  const { canonical, catalog } = componentStructureFixture();
  const reused = cloneCatalog(catalog);
  const head = reused.components.find((component) =>
    component.id === "component-head"
  )!;
  const socket = reused.components.find((component) =>
    component.id === "component-socket"
  )!;
  const headDefinition = head.bindings.find((binding) =>
    binding.kind === "part-definition"
  )!;
  const socketDefinition = socket.bindings.find((binding) =>
    binding.kind === "part-definition"
  )!;
  socketDefinition.id = headDefinition.id;
  socketDefinition.label = headDefinition.label;
  const headCad = head.bindings.find((binding) =>
    binding.provider === "digital-thread"
  )!;
  const socketCad = socket.bindings.find((binding) =>
    binding.provider === "digital-thread"
  )!;
  socketCad.id = headCad.id;
  socket.preview = { ...head.preview! };
  const reusedProjection = projectThreadWorkbenchSnapshot(canonical, reused);
  assertEquals(
    reusedProjection.graph.nodes.filter((node) => node.entityKind === "part-definition")
      .length,
    4,
  );
  assertEquals(
    reusedProjection.graph.nodes.filter((node) => node.entityKind === "part-usage")
      .length,
    4,
  );
  assertEquals(
    reusedProjection.graph.edges.filter((edge) => edge.relation === "represented_by")
      .length,
    7,
  );
  assertEquals(
    reusedProjection.graph.edges.filter((edge) =>
      edge.relation === "represented_by" &&
      edge.from.kind === "part-definition" &&
      edge.from.id === "def-head"
    ).map((edge) => edge.to.id).sort(),
    ["glb-head", "step-head"],
  );

  const ambiguous = cloneCatalog(catalog);
  ambiguous.components[1]!.bindings.push({
    provider: "syson",
    kind: "part-definition",
    id: "def-base-other",
    label: "Other base definition",
    evidenceArtifactId: "architecture",
  });
  const ambiguousProjection = projectThreadWorkbenchSnapshot(
    canonical,
    ambiguous,
  );
  assertEquals(
    ambiguousProjection.graph.nodes.some((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ),
    false,
  );
});

Deno.test("Evidence projects AttributeUsage nodes on a system-only PartDefinition", () => {
  const { canonical, catalog } = componentStructureFixture();
  const systemOnly = cloneCatalog(catalog);
  const system = systemOnly.components.find((component) =>
    component.id === "component-system"
  )!;
  system.attributes = [{
    id: "attr-thickness",
    kind: "AttributeUsage",
    label: "thickness",
  }];
  systemOnly.components = [system];

  const projection = projectThreadWorkbenchSnapshot(canonical, systemOnly);
  assertEquals(
    projection.graph.nodes
      .filter((node) => node.entityKind === "attribute-usage")
      .map((node) => `${node.ref.id}:${node.label}`),
    ["attr-thickness:DeskLamp · thickness"],
  );
  assertEquals(
    projection.graph.edges
      .filter((edge) => edge.to.kind === "attribute-usage")
      .map((edge) =>
        `${edge.from.kind}:${edge.from.id}->${edge.to.kind}:${edge.to.id}`
      ),
    ["part-definition:def-system->attribute-usage:attr-thickness"],
  );
});

Deno.test("Evidence projects AttributeUsage nodes onto their owning PartDefinition", () => {
  const { canonical, catalog } = componentStructureFixture();
  const withAttributes = cloneCatalog(catalog);
  const stem = withAttributes.components.find((component) =>
    component.id === "component-stem"
  )!;
  stem.attributes = [
    { id: "attr-length", kind: "AttributeUsage", label: "length" },
    { id: "attr-thickness", kind: "AttributeUsage", label: "thickness" },
  ];

  const projection = projectThreadWorkbenchSnapshot(canonical, withAttributes);
  const attributes = projection.graph.nodes
    .filter((node) => node.entityKind === "attribute-usage")
    .map((node) => `${node.ref.id}:${node.label}:${node.summary}`)
    .sort();
  assertEquals(attributes, [
    "attr-length:FixedStem · length:AttributeUsage · owned by FixedStem",
    "attr-thickness:FixedStem · thickness:AttributeUsage · owned by FixedStem",
  ]);
  const ownership = projection.graph.edges
    .filter((edge) =>
      edge.relation === "contains" && edge.to.kind === "attribute-usage"
    )
    .map((edge) => `${edge.from.kind}:${edge.from.id}->${edge.to.kind}:${edge.to.id}`)
    .sort();
  assertEquals(ownership, [
    "part-definition:def-stem->attribute-usage:attr-length",
    "part-definition:def-stem->attribute-usage:attr-thickness",
  ]);
});

Deno.test("Evidence keeps two AttributeUsage nodes when the same label belongs to distinct PartDefinitions", () => {
  const { canonical, catalog } = componentStructureFixture();
  const homonyms = cloneCatalog(catalog);
  homonyms.components.find((component) => component.id === "component-stem")!
    .attributes = [{
      id: "attr-stem-thickness",
      kind: "AttributeUsage",
      label: "thickness",
    }];
  homonyms.components.find((component) => component.id === "component-head")!
    .attributes = [{
      id: "attr-head-thickness",
      kind: "AttributeUsage",
      label: "thickness",
    }];

  const projection = projectThreadWorkbenchSnapshot(canonical, homonyms);
  assertEquals(
    projection.graph.nodes
      .filter((node) => node.entityKind === "attribute-usage")
      .map((node) => `${node.ref.id}:${node.label}`)
      .sort(),
    [
      "attr-head-thickness:LampHead · thickness",
      "attr-stem-thickness:FixedStem · thickness",
    ],
  );
});

Deno.test("Evidence fails closed when a reused PartDefinition disagrees on AttributeUsage", () => {
  const { canonical, catalog } = componentStructureFixture();
  const inconsistent = cloneCatalog(catalog);
  const head = inconsistent.components.find((component) =>
    component.id === "component-head"
  )!;
  const socket = inconsistent.components.find((component) =>
    component.id === "component-socket"
  )!;
  socket.bindings.find((binding) => binding.kind === "part-definition")!.id =
    head.bindings.find((binding) => binding.kind === "part-definition")!.id;
  socket.bindings.find((binding) => binding.kind === "part-definition")!.label =
    head.bindings.find((binding) => binding.kind === "part-definition")!.label;
  socket.bindings.find((binding) => binding.provider === "digital-thread")!.id =
    head.bindings.find((binding) => binding.provider === "digital-thread")!.id;
  socket.preview = { ...head.preview! };
  head.attributes = [
    { id: "attr-length", kind: "AttributeUsage", label: "length" },
  ];
  socket.attributes = [
    { id: "attr-thickness", kind: "AttributeUsage", label: "thickness" },
  ];

  assertNoComponentStructure(
    projectThreadWorkbenchSnapshot(canonical, inconsistent),
    "one reused PartDefinition cannot claim two AttributeUsage sets",
  );
});

Deno.test("Evidence fails closed when two PartDefinitions share an AttributeUsage id", () => {
  const { canonical, catalog } = componentStructureFixture();
  const shared = cloneCatalog(catalog);
  shared.components.find((component) => component.id === "component-stem")!
    .attributes = [
      { id: "attr-shared", kind: "AttributeUsage", label: "length" },
    ];
  shared.components.find((component) => component.id === "component-head")!
    .attributes = [
      { id: "attr-shared", kind: "AttributeUsage", label: "thickness" },
    ];

  assertNoComponentStructure(
    projectThreadWorkbenchSnapshot(canonical, shared),
    "one AttributeUsage id cannot belong to two PartDefinitions",
  );
});

Deno.test("Evidence fails closed when a reused PartDefinition disagrees on its exact GLB preview", () => {
  const { canonical, catalog } = componentStructureFixture();
  const inconsistent = cloneCatalog(catalog);
  const head = inconsistent.components.find((component) =>
    component.id === "component-head"
  )!;
  const socket = inconsistent.components.find((component) =>
    component.id === "component-socket"
  )!;
  socket.bindings.find((binding) => binding.kind === "part-definition")!.id =
    head.bindings.find((binding) => binding.kind === "part-definition")!.id;
  socket.bindings.find((binding) => binding.provider === "digital-thread")!.id =
    head.bindings.find((binding) => binding.provider === "digital-thread")!.id;

  assertNoComponentStructure(
    projectThreadWorkbenchSnapshot(canonical, inconsistent),
    "one reused PartDefinition cannot claim two GLB previews",
  );
});

Deno.test("Evidence fails closed when a GLB preview diverges from its canonical artifact", () => {
  const cases: Array<{
    name: string;
    mutate: (
      canonical: MutableThreadSnapshot,
      catalog: ThreadComponentCatalog,
    ) => void;
  }> = [{
    name: "digest",
    mutate: (_canonical, catalog) => {
      catalog.components.find((component) => component.id === "component-base")!
        .preview!.sha256 = "0".repeat(64);
    },
  }, {
    name: "uri",
    mutate: (canonical, catalog) => {
      const previewId = catalog.components.find((component) =>
        component.id === "component-base"
      )!.preview!.artifactId;
      canonical.artifacts.find((artifact) => artifact.id === previewId)!
        .uri = `/api/thread/assets/${"0".repeat(64)}.glb`;
    },
  }, {
    name: "media type",
    mutate: (canonical, catalog) => {
      const previewId = catalog.components.find((component) =>
        component.id === "component-base"
      )!.preview!.artifactId;
      canonical.artifacts.find((artifact) => artifact.id === previewId)!
        .mediaType = "application/octet-stream";
    },
  }];

  for (const testCase of cases) {
    const { canonical, catalog } = componentStructureFixture();
    testCase.mutate(canonical, catalog);
    assertNoComponentStructure(
      projectThreadWorkbenchSnapshot(canonical, catalog),
      `invalid preview ${testCase.name}`,
    );
  }
});

Deno.test("Evidence emits one PartUsage node when one semantic usage is repeated on expanded occurrence paths", () => {
  const { canonical, catalog } = componentStructureFixture();
  const reused = cloneCatalog(catalog);
  repeatStemOccurrencePath(reused);

  const projection = projectThreadWorkbenchSnapshot(canonical, reused);
  const usageRefs = projection.graph.nodes
    .filter((node) => node.entityKind === "part-usage")
    .map((node) => `${node.ref.kind}:${node.ref.id}`);
  assertEquals(
    usageRefs.filter((reference) => reference === "part-usage:usage-head"),
    ["part-usage:usage-head"],
  );
  assertEquals(
    usageRefs.filter((reference) => reference === "part-usage:usage-socket"),
    ["part-usage:usage-socket"],
  );
  assertEquals(new Set(usageRefs).size, usageRefs.length);
  assertEquals(
    projection.graph.edges
      .filter((edge) =>
        (edge.from.kind === "part-usage" && edge.from.id === "usage-head") ||
        (edge.to.kind === "part-usage" && edge.to.id === "usage-head")
      )
      .map((edge) =>
        `${edge.relation}:${edge.from.kind}:${edge.from.id}->${edge.to.kind}:${edge.to.id}`
      )
      .sort(),
    [
      "contains:part-definition:def-stem->part-usage:usage-head",
      "typed_by:part-usage:usage-head->part-definition:def-head",
    ],
  );
});

Deno.test("Evidence suppresses the SysML overlay when one PartUsage id targets conflicting exact definitions across occurrence paths", () => {
  const { canonical, catalog } = componentStructureFixture();
  const inconsistent = cloneCatalog(catalog);
  const repeatedHead = repeatStemOccurrencePath(inconsistent);
  const conflictingDefinition = repeatedHead.bindings.find((binding) =>
    binding.provider === "syson" && binding.kind === "part-definition"
  )!;
  // Keep the friendly label identical: exact provider ids, never labels, decide
  // whether the repeated semantic PartUsage has one coherent target.
  conflictingDefinition.id = "def-head-conflict";

  const projection = projectThreadWorkbenchSnapshot(canonical, inconsistent);
  assertEquals(
    projection.graph.nodes.some((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ),
    false,
  );
  assertEquals(
    projection.graph.edges.some((edge) =>
      edge.relation === "contains" || edge.relation === "typed_by" ||
      edge.relation === "represented_by"
    ),
    false,
  );
});

Deno.test("Evidence keeps exact SysML structure before CAD and suppresses a declared invalid CAD mapping", () => {
  const { canonical, catalog } = componentStructureFixture();
  const beforeCad = cloneCatalog(catalog);
  beforeCad.components.forEach((component) => {
    component.bindings = component.bindings.filter((binding) =>
      binding.provider !== "digital-thread"
    );
    delete component.preview;
  });
  const beforeCadProjection = projectThreadWorkbenchSnapshot(
    canonical,
    beforeCad,
  );
  assertEquals(
    beforeCadProjection.graph.nodes.filter((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ).length,
    9,
  );
  assertEquals(
    beforeCadProjection.graph.edges.filter((edge) => edge.relation === "represented_by")
      .length,
    0,
  );

  const invalidCad = cloneCatalog(catalog);
  const baseCad = invalidCad.components[1]!.bindings.find((binding) =>
    binding.provider === "digital-thread"
  )!;
  baseCad.id = "fea-r2";
  const invalidProjection = projectThreadWorkbenchSnapshot(
    canonical,
    invalidCad,
  );
  assertEquals(
    invalidProjection.graph.nodes.some((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage"
    ),
    false,
  );
});

function componentStructureFixture(): {
  canonical: MutableThreadSnapshot;
  catalog: ThreadComponentCatalog;
} {
  const canonical = linkedSnapshot();
  canonical.artifacts.push(
    {
      id: "architecture",
      name: "Architecture: DeskLamp",
      kind: "sysml-model",
      version: "1",
      fingerprint: fingerprint("1"),
      producer: operation("syson", "architecture-readback", "architecture-run"),
      inputArtifactIds: [],
      freshness: fresh(),
    },
    {
      id: "geometry-capture",
      name: "Geometry: DeskLamp",
      kind: "cad-model",
      version: "2",
      fingerprint: fingerprint("2"),
      producer: operation("digital-thread", "geometry-seal", "geometry-run"),
      inputArtifactIds: ["architecture"],
      freshness: fresh(),
    },
    ...["assembly", "base", "stem", "head", "socket"].map((name, index) => ({
      id: `step-${name}`,
      name: `Authoritative STEP: ${name}`,
      kind: "step" as const,
      version: "1",
      fingerprint: fingerprint(String(index + 3)),
      producer: operation(
        "build123d-sandbox",
        "build123d_export",
        `cad-${name}`,
      ),
      inputArtifactIds: ["geometry-capture"],
      freshness: fresh(),
    })),
    ...["base", "stem", "head", "socket"].map((name, index) => {
      const digest = ["8", "9", "a", "b"][index]!.repeat(64);
      return {
        id: `glb-${name}`,
        name: `GLTF: ${name}`,
        kind: "cad-model" as const,
        version: digest,
        fingerprint: fingerprint(digest[0]!),
        uri: `/api/thread/assets/${digest}.glb`,
        mediaType: "model/gltf-binary",
        producer: operation(
          "build123d-sandbox",
          "build123d_export",
          `cad-${name}`,
        ),
        inputArtifactIds: [],
        freshness: fresh(),
      };
    }),
  );
  const syson = (
    kind: "part-definition" | "part-usage",
    id: string,
    label: string,
  ) => ({
    provider: "syson" as const,
    kind,
    id,
    label,
    evidenceArtifactId: "architecture",
  });
  const cad = (id: string, label: string) => ({
    provider: "digital-thread" as const,
    kind: "artifact" as const,
    id,
    label,
    evidenceArtifactId: "geometry-capture",
  });
  const preview = (name: "base" | "stem" | "head" | "socket") => {
    const index = ["base", "stem", "head", "socket"].indexOf(name);
    const digest = ["8", "9", "a", "b"][index]!.repeat(64);
    return {
      provider: "build123d" as const,
      artifactId: `glb-${name}`,
      mediaType: "model/gltf-binary" as const,
      url: `/api/thread/assets/${digest}.glb`,
      sha256: digest,
    };
  };
  return {
    canonical,
    catalog: {
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId: canonical.subject.id,
      rationale: "Exact reviewed DeskLamp SysML and CAD identity.",
      systemViews: {},
      components: [{
        id: "component-system",
        label: "DeskLamp",
        kind: "assembly",
        quantity: 1,
        bindings: [
          syson("part-definition", "def-system", "DeskLamp"),
          cad("step-assembly", "Authoritative assembly STEP"),
        ],
      }, {
        id: "component-base",
        label: "WeightedBase",
        kind: "part",
        quantity: 1,
        parentId: "component-system",
        bindings: [
          syson("part-definition", "def-base", "WeightedBase"),
          syson("part-usage", "usage-base", "base"),
          cad("step-base", "Authoritative STEP: WeightedBase"),
        ],
        preview: preview("base"),
      }, {
        id: "component-stem",
        label: "FixedStem",
        kind: "part",
        quantity: 1,
        parentId: "component-system",
        bindings: [
          syson("part-definition", "def-stem", "FixedStem"),
          syson("part-usage", "usage-stem", "stem"),
          cad("step-stem", "Authoritative STEP: FixedStem"),
        ],
        preview: preview("stem"),
      }, {
        id: "component-head",
        label: "LampHead",
        kind: "part",
        quantity: 1,
        parentId: "component-stem",
        bindings: [
          syson("part-definition", "def-head", "LampHead"),
          syson("part-usage", "usage-head", "head"),
          cad("step-head", "Authoritative STEP: LampHead"),
        ],
        preview: preview("head"),
      }, {
        id: "component-socket",
        label: "BulbSocket",
        kind: "part",
        quantity: 1,
        parentId: "component-head",
        bindings: [
          syson("part-definition", "def-socket", "BulbSocket"),
          syson("part-usage", "usage-socket", "socket"),
          cad("step-socket", "Authoritative STEP: BulbSocket"),
        ],
        preview: preview("socket"),
      }],
    },
  };
}

function cloneCatalog(catalog: ThreadComponentCatalog): ThreadComponentCatalog {
  return JSON.parse(JSON.stringify(catalog)) as ThreadComponentCatalog;
}

function repeatStemOccurrencePath(
  catalog: ThreadComponentCatalog,
): ThreadComponentCatalog["components"][number] {
  const stem = catalog.components.find((component) =>
    component.id === "component-stem"
  )!;
  const head = catalog.components.find((component) =>
    component.id === "component-head"
  )!;
  const socket = catalog.components.find((component) =>
    component.id === "component-socket"
  )!;
  const repeatedStem: ThreadComponentCatalog["components"][number] = {
    ...stem,
    id: "component-stem-secondary",
    bindings: stem.bindings.map((binding) =>
      binding.provider === "syson" && binding.kind === "part-usage"
        ? { ...binding, id: "usage-stem-secondary", label: "secondaryStem" }
        : { ...binding }
    ),
  };
  const repeatedHead: ThreadComponentCatalog["components"][number] = {
    ...head,
    id: "component-head-secondary",
    parentId: repeatedStem.id,
    bindings: head.bindings.map((binding) => ({ ...binding })),
  };
  const repeatedSocket: ThreadComponentCatalog["components"][number] = {
    ...socket,
    id: "component-socket-secondary",
    parentId: repeatedHead.id,
    bindings: socket.bindings.map((binding) => ({ ...binding })),
  };
  catalog.components.push(repeatedStem, repeatedHead, repeatedSocket);
  return repeatedHead;
}

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

function assertNoComponentStructure(
  projection: ReturnType<typeof projectThreadWorkbenchSnapshot>,
  message: string,
): void {
  assertEquals(
    projection.graph.nodes.some((node) =>
      node.entityKind === "part-definition" || node.entityKind === "part-usage" ||
      node.entityKind === "attribute-usage"
    ),
    false,
    message,
  );
  assertEquals(
    projection.graph.edges.some((edge) =>
      edge.relation === "contains" || edge.relation === "typed_by" ||
      edge.relation === "represented_by"
    ),
    false,
    message,
  );
}

function clone(snapshot: ThreadSnapshot): MutableThreadSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MutableThreadSnapshot;
}
