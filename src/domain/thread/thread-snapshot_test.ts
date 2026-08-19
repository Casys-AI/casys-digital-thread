import { assertEquals, assertThrows } from "@std/assert";
import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "./thread-snapshot.ts";
import type { AnalysisGraph } from "./analysis-graph.ts";
import {
  collectThreadSnapshotIssues,
  createThreadSnapshot,
  ThreadSnapshotValidationError,
  validateThreadSnapshot,
} from "./thread-snapshot-validation.ts";

const AT = "2026-08-01T08:00:00.000Z";

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
type MutableThreadSnapshot = Mutable<ThreadSnapshot>;

Deno.test("ThreadSnapshot validates and round-trips a linked CoffeeMachine change", () => {
  const candidate = coffeeMachineSnapshot();
  const snapshot = createThreadSnapshot(candidate);
  const roundTrip = validateThreadSnapshot(JSON.parse(JSON.stringify(snapshot)));

  assertEquals(roundTrip.schemaVersion, "1.0");
  assertEquals(roundTrip.subject.id, "coffee-machine-cm01");
  assertEquals(
    roundTrip.violations[0].name,
    "Housing stress exceeds SYS-REQ-042 limit",
  );
  assertEquals(roundTrip.evaluations.map((item) => item.status), ["fail", "pass"]);
  assertEquals(
    roundTrip.consumptions.every((item) => item.status === "verified"),
    true,
  );
  assertEquals(collectThreadSnapshotIssues(snapshot), []);
});

Deno.test("ThreadSnapshot validation clones and deeply freezes accepted JSON", () => {
  const candidate = coffeeMachineSnapshot();
  const snapshot = validateThreadSnapshot(candidate);

  assertEquals(snapshot === candidate, false);
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(Object.isFrozen(snapshot.subject), true);
  assertEquals(Object.isFrozen(snapshot.artifacts), true);
  assertEquals(Object.isFrozen(snapshot.artifacts[0].fingerprint), true);

  candidate.subject.name = "Changed after validation";
  assertEquals(snapshot.subject.name, "CoffeeMachine CM-01");
  assertThrows(
    () => {
      (snapshot as MutableThreadSnapshot).subject.name = "Illegal mutation";
    },
    TypeError,
  );
  assertThrows(
    () => {
      (snapshot as MutableThreadSnapshot).artifacts.push(candidate.artifacts[0]);
    },
    TypeError,
  );
});

Deno.test("ThreadSnapshot rejects unknown root and nested properties", () => {
  const rootCandidate = coffeeMachineSnapshot() as MutableThreadSnapshot & {
    accidentalRootField?: string;
  };
  rootCandidate.accidentalRootField = "must not cross the boundary";
  assertEquals(
    collectThreadSnapshotIssues(rootCandidate).some((issue) =>
      issue.code === "unknown_property" && issue.path === "$.accidentalRootField"
    ),
    true,
  );

  const nestedCandidate = coffeeMachineSnapshot();
  const artifact = nestedCandidate.artifacts[0] as
    & typeof nestedCandidate.artifacts[0]
    & {
      accidentalArtifactField?: string;
    };
  artifact.accidentalArtifactField = "must not cross the boundary";
  assertEquals(
    collectThreadSnapshotIssues(nestedCandidate).some((issue) =>
      issue.code === "unknown_property" &&
      issue.path === "$.artifacts[0].accidentalArtifactField"
    ),
    true,
  );
});

Deno.test("ThreadSnapshot 1.0 forbids an analysis graph while 1.1 requires one", () => {
  const legacy = coffeeMachineSnapshot();
  legacy.analysisGraph = analysisGraphFor(legacy);
  assertEquals(
    collectThreadSnapshotIssues(legacy).some((issue) =>
      issue.code === "unknown_property" && issue.path === "$.analysisGraph"
    ),
    true,
  );

  const missing = coffeeMachineSnapshot();
  missing.schemaVersion = "1.1";
  assertEquals(
    collectThreadSnapshotIssues(missing).some((issue) =>
      issue.code === "missing_analysis_graph" && issue.path === "$.analysisGraph"
    ),
    true,
  );
});

Deno.test("ThreadSnapshot 1.1 accepts analysis assertions only with exact artifact evidence", () => {
  const candidate = coffeeMachineSnapshot();
  candidate.schemaVersion = "1.1";
  candidate.analysisGraph = analysisGraphFor(candidate);
  assertEquals(collectThreadSnapshotIssues(candidate), []);

  const mismatched = clone(candidate);
  const mutableGraph = mismatched.analysisGraph as unknown as {
    relations: Array<
      { assertion: { evidence: Array<{ fingerprint: ContentFingerprint }> } }
    >;
  };
  mutableGraph.relations[0]!.assertion.evidence[0]!.fingerprint = fingerprint("f");
  assertEquals(
    collectThreadSnapshotIssues(mismatched).some((issue) =>
      issue.code === "analysis_evidence_fingerprint_mismatch" &&
      issue.path === "$.analysisGraph.relations[0].assertion.evidence[0].fingerprint"
    ),
    true,
  );

  const missing = clone(candidate);
  const graphWithMissingEvidence = missing.analysisGraph as unknown as {
    relations: Array<{ assertion: { evidence: Array<{ id: string }> } }>;
  };
  graphWithMissingEvidence.relations[0]!.assertion.evidence[0]!.id =
    "unrecorded-analysis-evidence";
  assertEquals(
    collectThreadSnapshotIssues(missing).some((issue) =>
      issue.code === "missing_reference" &&
      issue.path === "$.analysisGraph.relations[0].assertion.evidence[0].id"
    ),
    true,
  );
});

Deno.test("ThreadSnapshot rejects mechanical provenance when consumer bytes do not match producer bytes", () => {
  const candidate = clone(coffeeMachineSnapshot());
  const consumption = candidate.consumptions.find((item) =>
    item.id === "consume-step-by-calculix"
  )!;
  consumption.observedFingerprint = fingerprint("f");
  consumption.status = "mismatch";
  candidate.freshness = {
    status: "failed",
    changedAt: AT,
    reason: "CalculiX observed a different STEP fingerprint.",
    invalidatedByChangeIds: [],
  };

  const issues = collectThreadSnapshotIssues(candidate);
  assertEquals(issues.some((item) => item.code === "unverified_provenance"), true);
  assertEquals(issues.some((item) => item.code === "unverified_derivation"), true);
  assertThrows(
    () => validateThreadSnapshot(candidate),
    ThreadSnapshotValidationError,
    "producer and consumer fingerprints",
  );
});

Deno.test("ThreadSnapshot never accepts an observation without an explicit unit", () => {
  const candidate = clone(coffeeMachineSnapshot());
  candidate.observations[0].quantity.unit = "";

  const issues = collectThreadSnapshotIssues(candidate);
  assertEquals(
    issues.some((item) =>
      item.code === "invalid_string" && item.path === "$.observations[0].quantity.unit"
    ),
    true,
  );
});

Deno.test("ThreadSnapshot requires a named violation and proposed action for a failed evaluation", () => {
  const candidate = clone(coffeeMachineSnapshot());
  candidate.violations = [];
  candidate.proposedActions = [];
  candidate.provenance = candidate.provenance.filter((link) =>
    link.from.kind !== "violation" && link.from.kind !== "action"
  );

  const issues = collectThreadSnapshotIssues(candidate);
  assertEquals(issues.some((item) => item.code === "missing_violation"), true);
});

Deno.test("ThreadSnapshot stale state names its cause and references a real change", () => {
  const candidate = clone(coffeeMachineSnapshot());
  candidate.artifacts[2].freshness = {
    status: "stale",
    changedAt: AT,
    invalidatedByChangeIds: ["change-does-not-exist"],
  };
  candidate.freshness = {
    status: "stale",
    changedAt: AT,
    reason: "At least one downstream artefact is stale.",
    invalidatedByChangeIds: ["change-sysml-housing"],
  };

  const issues = collectThreadSnapshotIssues(candidate);
  assertEquals(issues.some((item) => item.code === "missing_freshness_reason"), true);
  assertEquals(
    issues.some((item) =>
      item.code === "missing_reference" &&
      item.path === "$.artifacts[2].freshness.invalidatedByChangeIds[0]"
    ),
    true,
  );
});

Deno.test("ThreadSnapshot accepts an evidence artifact tracing to a design artifact without the derivation regime", () => {
  const snapshot = coffeeMachineSnapshot();
  // An immutable existing proof can never satisfy the derived_from regime
  // retroactively (inputs + verified consumption). traces_to is the recorded
  // way to attach evidence to the design element it measured.
  snapshot.provenance.push({
    id: "link-fea-traces-to-model",
    relation: "traces_to",
    from: { kind: "artifact", id: "fea-result-cm01" },
    to: { kind: "artifact", id: "sysml-cm01" },
    rationale: "The FEA result was computed on geometry defined by this model.",
  });
  const validated = validateThreadSnapshot(
    JSON.parse(JSON.stringify(snapshot)),
  );
  assertEquals(
    validated.provenance.some((link) => link.id === "link-fea-traces-to-model"),
    true,
  );
});

Deno.test("ThreadSnapshot rejects a traces_to link toward a non-artifact target", () => {
  const snapshot = coffeeMachineSnapshot();
  snapshot.provenance.push({
    id: "link-traces-to-observation",
    relation: "traces_to",
    from: { kind: "artifact", id: "fea-result-cm01" },
    to: { kind: "observation", id: "obs-displacement" },
    rationale: "Invalid: traces_to targets must be artifacts.",
  });
  assertThrows(
    () => validateThreadSnapshot(JSON.parse(JSON.stringify(snapshot))),
    Error,
    "traces_to",
  );
});

Deno.test("ThreadSnapshot is strictly JSON serializable", () => {
  const candidate = coffeeMachineSnapshot() as unknown as Record<string, unknown>;
  candidate.nonJson = new Date(AT);

  const issues = collectThreadSnapshotIssues(candidate);
  assertEquals(issues.some((item) => item.code === "not_json"), true);
});

Deno.test("ThreadSnapshot keeps unresolved evaluations first-class without inventing evidence", () => {
  const candidate = clone(coffeeMachineSnapshot());
  const evaluation = candidate.evaluations[1];
  evaluation.status = "unresolved";
  evaluation.observationIds = [];
  delete evaluation.comparison;
  evaluation.evidenceArtifactIds = [];
  evaluation.message = "Thermal observation is unavailable.";
  candidate.provenance = candidate.provenance.filter((link) =>
    link.from.id !== evaluation.id ||
    (link.relation !== "uses" && link.relation !== "evidences")
  );

  assertEquals(collectThreadSnapshotIssues(candidate), []);
});

function coffeeMachineSnapshot(): MutableThreadSnapshot {
  const syson = operation("mcp-syson", "syson_project_snapshot", "syson-run-42");
  const author = operation(
    "thread-orchestrator",
    "materialize_cad_script",
    "author-run-17",
  );
  const build123d = operation("mcp-build123d", "build123d_export", "cad-run-18");
  const calculix = operation("mcp-calculix", "calculix_solve_static", "fea-run-19");
  const modelica = operation("mcp-modelica", "modelica_simulate", "thermal-run-20");
  const verifier = operation("mcp-syson", "syson_constraint_evaluate", "verify-run-21");

  const sysmlFingerprint = fingerprint("1");
  const oldSysmlFingerprint = fingerprint("0");
  const scriptFingerprint = fingerprint("2");
  const stepFingerprint = fingerprint("3");
  const feaFingerprint = fingerprint("4");
  const modelicaModelFingerprint = fingerprint("5");
  const thermalFingerprint = fingerprint("6");

  return {
    schemaVersion: "1.0",
    id: "thread-snapshot-cm01-r7",
    revision: 7,
    previous: { snapshotId: "thread-snapshot-cm01-r6", revision: 6 },
    generatedAt: AT,
    subject: {
      id: "coffee-machine-cm01",
      name: "CoffeeMachine CM-01",
      kind: "system",
      version: "7",
      modelArtifactId: "sysml-cm01",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-cm01-r7",
      name: "Increase housing rib thickness",
      status: "applied",
      createdAt: "2026-08-01T07:45:00.000Z",
      appliedAt: "2026-08-01T07:50:00.000Z",
      changes: [{
        id: "change-sysml-housing",
        kind: "modified",
        target: { kind: "artifact", id: "sysml-cm01" },
        summary: "Housing support rib thickness changed from 2.0 mm to 2.4 mm.",
        beforeFingerprint: oldSysmlFingerprint,
        afterFingerprint: sysmlFingerprint,
      }],
    },
    artifacts: [
      {
        id: "sysml-cm01",
        name: "CoffeeMachine SysML v2 model",
        kind: "sysml-model",
        version: "7",
        fingerprint: sysmlFingerprint,
        uri: "syson://projects/cm01/revisions/7",
        producer: syson,
        inputArtifactIds: [],
        freshness: fresh(),
      },
      {
        id: "cad-script-cm01",
        name: "CoffeeMachine build123d script",
        kind: "script",
        version: "7",
        fingerprint: scriptFingerprint,
        mediaType: "text/x-python",
        producer: author,
        inputArtifactIds: ["sysml-cm01"],
        freshness: fresh(),
      },
      {
        id: "step-cm01",
        name: "CoffeeMachine housing STEP",
        kind: "step",
        version: "7",
        fingerprint: stepFingerprint,
        uri: "artifact://cad-run-18/coffee-machine.step",
        mediaType: "model/step",
        producer: build123d,
        inputArtifactIds: ["cad-script-cm01"],
        freshness: fresh(),
      },
      {
        id: "fea-result-cm01",
        name: "CoffeeMachine housing static solve",
        kind: "solver-result",
        version: "7",
        fingerprint: feaFingerprint,
        uri: "artifact://fea-run-19/results.json",
        mediaType: "application/json",
        producer: calculix,
        inputArtifactIds: ["step-cm01"],
        freshness: fresh(),
      },
      {
        id: "modelica-model-cm01",
        name: "CoffeeMachine thermal model",
        kind: "simulation-model",
        version: "1.0.0",
        fingerprint: modelicaModelFingerprint,
        uri: "modelica://coffee-machine-v1/1.0.0",
        producer: operation("mcp-modelica", "modelica_kit_get", "kit-coffee-1"),
        inputArtifactIds: [],
        freshness: fresh(),
      },
      {
        id: "thermal-result-cm01",
        name: "CoffeeMachine nominal heat-up result",
        kind: "solver-result",
        version: "7",
        fingerprint: thermalFingerprint,
        uri: "artifact://thermal-run-20/result.json",
        mediaType: "application/json",
        producer: modelica,
        inputArtifactIds: ["modelica-model-cm01"],
        freshness: fresh(),
      },
    ],
    consumptions: [
      {
        id: "consume-sysml-by-author",
        artifactId: "sysml-cm01",
        consumer: author,
        observedFingerprint: sysmlFingerprint,
        verifiedAt: AT,
        status: "verified",
      },
      {
        id: "consume-script-by-build123d",
        artifactId: "cad-script-cm01",
        consumer: build123d,
        observedFingerprint: scriptFingerprint,
        verifiedAt: AT,
        status: "verified",
      },
      {
        id: "consume-step-by-calculix",
        artifactId: "step-cm01",
        consumer: calculix,
        observedFingerprint: stepFingerprint,
        verifiedAt: AT,
        status: "verified",
      },
      {
        id: "consume-model-by-modelica",
        artifactId: "modelica-model-cm01",
        consumer: modelica,
        observedFingerprint: modelicaModelFingerprint,
        verifiedAt: AT,
        status: "verified",
      },
    ],
    observations: [
      {
        id: "obs-von-mises",
        name: "Maximum housing von Mises stress",
        metric: "von_mises_max",
        quantity: { value: 132, unit: "MPa" },
        source: {
          operation: calculix,
          artifactIds: ["fea-result-cm01"],
          capturedAt: AT,
        },
        freshness: fresh(),
      },
      {
        id: "obs-water-temperature",
        name: "Maximum water temperature",
        metric: "water_temperature_max",
        quantity: { value: 94, unit: "degC" },
        source: {
          operation: modelica,
          artifactIds: ["thermal-result-cm01"],
          capturedAt: AT,
        },
        freshness: fresh(),
      },
    ],
    requirements: [
      {
        id: "SYS-REQ-042",
        name: "Housing allowable stress",
        statement: "Maximum housing von Mises stress shall not exceed 120 MPa.",
        version: "7",
        criterion: {
          metric: "von_mises_max",
          operator: "<=",
          limit: { value: 120, unit: "MPa" },
        },
        trace: {
          sourceArtifactId: "sysml-cm01",
          elementId: "8de3d5d0-sys-req-042",
          targetArtifactIds: ["step-cm01"],
        },
        freshness: fresh(),
      },
      {
        id: "SYS-REQ-017",
        name: "Nominal water temperature",
        statement: "Water temperature shall reach at least 90 degC.",
        version: "7",
        criterion: {
          metric: "water_temperature_max",
          operator: ">=",
          limit: { value: 90, unit: "degC" },
        },
        trace: {
          sourceArtifactId: "sysml-cm01",
          elementId: "0f39ac52-sys-req-017",
          targetArtifactIds: ["modelica-model-cm01"],
        },
        freshness: fresh(),
      },
    ],
    evaluations: [
      {
        id: "eval-stress-r7",
        name: "Evaluate SYS-REQ-042 against FEA evidence",
        requirementId: "SYS-REQ-042",
        observationIds: ["obs-von-mises"],
        status: "fail",
        evaluatedAt: AT,
        evaluator: verifier,
        comparison: {
          observationId: "obs-von-mises",
          actual: { value: 132, unit: "MPa" },
          operator: "<=",
          limit: { value: 120, unit: "MPa" },
          normalizedUnit: "MPa",
          margin: { value: -12, unit: "MPa" },
        },
        evidenceArtifactIds: ["fea-result-cm01"],
        message: "132 MPa exceeds the 120 MPa limit by 12 MPa.",
        freshness: fresh(),
      },
      {
        id: "eval-temperature-r7",
        name: "Evaluate SYS-REQ-017 against thermal evidence",
        requirementId: "SYS-REQ-017",
        observationIds: ["obs-water-temperature"],
        status: "pass",
        evaluatedAt: AT,
        evaluator: verifier,
        comparison: {
          observationId: "obs-water-temperature",
          actual: { value: 94, unit: "degC" },
          operator: ">=",
          limit: { value: 90, unit: "degC" },
          normalizedUnit: "degC",
          margin: { value: 4, unit: "degC" },
        },
        evidenceArtifactIds: ["thermal-result-cm01"],
        message: "94 degC satisfies the 90 degC minimum.",
        freshness: fresh(),
      },
    ],
    violations: [{
      id: "violation-stress-r7",
      name: "Housing stress exceeds SYS-REQ-042 limit",
      requirementId: "SYS-REQ-042",
      evaluationId: "eval-stress-r7",
      severity: "error",
      status: "open",
      detectedAt: AT,
      observationIds: ["obs-von-mises"],
      evidenceArtifactIds: ["fea-result-cm01"],
      summary: "The modified housing remains 12 MPa above its allowable stress.",
      freshness: fresh(),
    }],
    provenance: [
      link(
        "change-to-sysml",
        "changes",
        "change",
        "change-sysml-housing",
        "artifact",
        "sysml-cm01",
      ),
      link(
        "consume-sysml",
        "uses",
        "consumption",
        "consume-sysml-by-author",
        "artifact",
        "sysml-cm01",
      ),
      link(
        "script-from-sysml",
        "derived_from",
        "artifact",
        "cad-script-cm01",
        "artifact",
        "sysml-cm01",
      ),
      link(
        "consume-script",
        "uses",
        "consumption",
        "consume-script-by-build123d",
        "artifact",
        "cad-script-cm01",
      ),
      link(
        "step-from-script",
        "derived_from",
        "artifact",
        "step-cm01",
        "artifact",
        "cad-script-cm01",
      ),
      link(
        "consume-step",
        "uses",
        "consumption",
        "consume-step-by-calculix",
        "artifact",
        "step-cm01",
      ),
      link(
        "fea-from-step",
        "derived_from",
        "artifact",
        "fea-result-cm01",
        "artifact",
        "step-cm01",
      ),
      link(
        "consume-modelica-model",
        "uses",
        "consumption",
        "consume-model-by-modelica",
        "artifact",
        "modelica-model-cm01",
      ),
      link(
        "thermal-from-model",
        "derived_from",
        "artifact",
        "thermal-result-cm01",
        "artifact",
        "modelica-model-cm01",
      ),
      link(
        "stress-from-fea",
        "derived_from",
        "observation",
        "obs-von-mises",
        "artifact",
        "fea-result-cm01",
      ),
      link(
        "temperature-from-thermal",
        "derived_from",
        "observation",
        "obs-water-temperature",
        "artifact",
        "thermal-result-cm01",
      ),
      link(
        "stress-traces-step",
        "traces_to",
        "requirement",
        "SYS-REQ-042",
        "artifact",
        "step-cm01",
      ),
      link(
        "temperature-traces-model",
        "traces_to",
        "requirement",
        "SYS-REQ-017",
        "artifact",
        "modelica-model-cm01",
      ),
      link(
        "eval-stress-requirement",
        "evaluates",
        "evaluation",
        "eval-stress-r7",
        "requirement",
        "SYS-REQ-042",
      ),
      link(
        "eval-stress-observation",
        "uses",
        "evaluation",
        "eval-stress-r7",
        "observation",
        "obs-von-mises",
      ),
      link(
        "eval-stress-evidence",
        "evidences",
        "evaluation",
        "eval-stress-r7",
        "artifact",
        "fea-result-cm01",
      ),
      link(
        "eval-temperature-requirement",
        "evaluates",
        "evaluation",
        "eval-temperature-r7",
        "requirement",
        "SYS-REQ-017",
      ),
      link(
        "eval-temperature-observation",
        "uses",
        "evaluation",
        "eval-temperature-r7",
        "observation",
        "obs-water-temperature",
      ),
      link(
        "eval-temperature-evidence",
        "evidences",
        "evaluation",
        "eval-temperature-r7",
        "artifact",
        "thermal-result-cm01",
      ),
      link(
        "violation-from-eval",
        "caused_by",
        "violation",
        "violation-stress-r7",
        "evaluation",
        "eval-stress-r7",
      ),
      link(
        "violation-evidence",
        "evidences",
        "violation",
        "violation-stress-r7",
        "artifact",
        "fea-result-cm01",
      ),
      link(
        "action-addresses-violation",
        "addresses",
        "action",
        "action-correct-housing",
        "violation",
        "violation-stress-r7",
      ),
    ],
    proposedActions: [{
      id: "action-correct-housing",
      name: "Correct housing support geometry and recompute downstream evidence",
      kind: "correct",
      readiness: "ready",
      rationale:
        "The named stress violation is backed by verified CalculiX input and result evidence.",
      targets: [
        { kind: "artifact", id: "sysml-cm01" },
        { kind: "requirement", id: "SYS-REQ-042" },
      ],
      addressesViolationIds: ["violation-stress-r7"],
      dependsOnActionIds: [],
      operation: {
        id: "digital-thread.correct-and-recompute",
        inputs: {
          subjectId: "coffee-machine-cm01",
          violationId: "violation-stress-r7",
        },
      },
    }],
  };
}

function operation(serverId: string, tool: string, runId: string): ThreadOperationRef {
  return { serverId, tool, runId };
}

function fingerprint(character: string): ContentFingerprint {
  return { algorithm: "sha256", digest: character.repeat(64) };
}

function fresh(): Mutable<ThreadFreshness> {
  return { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] };
}

function link(
  id: string,
  relation: ThreadSnapshot["provenance"][number]["relation"],
  fromKind: ThreadSnapshot["provenance"][number]["from"]["kind"],
  fromId: string,
  toKind: ThreadSnapshot["provenance"][number]["to"]["kind"],
  toId: string,
): ThreadSnapshot["provenance"][number] {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: `${fromId} ${relation} ${toId}.`,
  };
}

function clone(snapshot: ThreadSnapshot): MutableThreadSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MutableThreadSnapshot;
}

function analysisGraphFor(snapshot: ThreadSnapshot): Mutable<AnalysisGraph> {
  const model = snapshot.artifacts.find((artifact) => artifact.id === "sysml-cm01")!;
  const result = snapshot.artifacts.find((artifact) =>
    artifact.id === "fea-result-cm01"
  )!;
  return {
    schemaVersion: "analysis-graph/1.0",
    nodes: [
      {
        id: "component.housing",
        kind: "component",
        semanticRef: {
          domain: "sysml",
          kind: "component",
          id: "housing",
          basisFingerprint: model.fingerprint,
        },
      },
      {
        id: "parameter.rib-thickness",
        kind: "parameter",
        semanticRef: {
          domain: "cad",
          kind: "parameter",
          id: "rib-thickness",
          basisFingerprint: result.fingerprint,
        },
      },
    ],
    relations: [{
      assertion: {
        schemaVersion: "engineering-assertion/1.0",
        id: "binding.housing-rib-thickness",
        relation: "semantic-binding",
        from: {
          domain: "sysml",
          kind: "component",
          id: "housing",
          basisFingerprint: model.fingerprint,
        },
        to: {
          domain: "cad",
          kind: "parameter",
          id: "rib-thickness",
          basisFingerprint: result.fingerprint,
        },
        epistemicBasis: "inferred",
        assertedBy: { kind: "analyzer", id: "thread-analysis-test", version: "1" },
        evidence: [
          { id: result.id, fingerprint: result.fingerprint },
          { id: model.id, fingerprint: model.fingerprint },
        ],
        scope: { kind: "basis", basisFingerprint: model.fingerprint },
        rationale: "A captured analysis linked this component to the CAD parameter.",
      },
      fromNodeId: "component.housing",
      toNodeId: "parameter.rib-thickness",
    }],
  };
}
