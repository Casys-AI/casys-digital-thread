import { assertEquals } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../domain/thread-snapshot.ts";
import type { ThreadComponentCatalog } from "../domain/thread-component-catalog.ts";
import { projectThreadWorkbenchSnapshot } from "./thread-workbench-projector.ts";

const AT = "2026-08-01T08:00:00.000Z";

Deno.test("ThreadSnapshot projects linked evidence into the native Workbench contract", () => {
  const canonical = linkedSnapshot();
  const projection = projectThreadWorkbenchSnapshot(canonical);

  assertEquals(projection.schemaVersion, "thread-workbench/0.1");
  assertEquals(projection.source, "observed");
  assertEquals(projection.subject.label, "Coffee Machine CM-01");
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

Deno.test("the flow does not invent requirement, evaluation, or violation dependencies", () => {
  const canonical = clone(linkedSnapshot());
  canonical.provenance = [];

  const projection = projectThreadWorkbenchSnapshot(canonical);
  const dependencies = flowDependencies(projection);

  // Artifact input and observation source are explicit structural facts.
  assertEquals(dependencies["flow:artifact:fea-r2"], ["flow:artifact:step-r2"]);
  assertEquals(dependencies["flow:observation:OBS-STRESS"], [
    "flow:artifact:fea-r2",
  ]);
  // The remaining causal edges need their canonical provenance link; matching
  // IDs in arrays alone are not enough to fabricate an edge.
  assertEquals(dependencies["flow:requirement:REQ-STRESS"], []);
  assertEquals(dependencies["flow:evaluation:EVAL-STRESS"], []);
  assertEquals(dependencies["flow:violation:VIO-STRESS"], []);
  assertEquals(graphEdgeSignatures(projection), [
    "input_to:artifact:step-r2->artifact:fea-r2:structure",
    "source_of:artifact:fea-r2->observation:OBS-STRESS:structure",
  ]);
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

function linkedSnapshot(): ThreadSnapshot {
  const cad = operation("mcp-build123d", "build123d_export", "cad-run-r2");
  const fea = operation("mcp-calculix", "calculix_solve_static", "fea-run-r2");
  const oracle = operation("mcp-syson", "evaluate_requirement", "eval-run-r2");
  return {
    schemaVersion: "1.0",
    id: "thread-cm01-r2",
    revision: 2,
    previous: { snapshotId: "thread-cm01-r1", revision: 1 },
    generatedAt: AT,
    subject: {
      id: "CM-01",
      name: "Coffee Machine CM-01",
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

function fresh(): ThreadFreshness {
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

function clone(snapshot: ThreadSnapshot): ThreadSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ThreadSnapshot;
}
