import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildOverviewSensitivityJourneys,
  buildOverviewSensitivityVerdictBindings,
} from "./src/project/overview-sensitivity-journey.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

const CASE_DIGEST = "c".repeat(64);
const STUDY_DIGEST = "e".repeat(64);
const CASE_KEY = `verification-case:sensitivity-study:${CASE_DIGEST}`;
const CASE_ARTIFACT_ID = `sensitivity-case-${CASE_DIGEST}`;
const STUDY_ARTIFACT_ID = `sensitivity-study-${STUDY_DIGEST}`;
const EVALUATION_ARTIFACT_ID = `sensitivity-base-evaluation-${"f".repeat(64)}`;
const OBSERVATION_ID = `sensitivity-base-stress-${STUDY_DIGEST}`;
const EVALUATION_ID = `REQ-MECH-014-evaluation-${"f".repeat(64)}`;
const ANALYSIS_EDGE_ID = `measured-local-sensitivity:${STUDY_DIGEST}:stress`;
const MECHANICAL_CASE_DIGEST = "a".repeat(64);
const MECHANICAL_CASE_KEY =
  `verification-case:mechanical-proof:${MECHANICAL_CASE_DIGEST}`;
const MECHANICAL_EVALUATION_ID = `REQ-MECH-014-evaluation-${"b".repeat(64)}`;

Deno.test("Overview projects one exact available, measured, and used sensitivity FEA journey", () => {
  const thread = sensitivityThread();
  const before = JSON.stringify(thread);

  const journeys = buildOverviewSensitivityJourneys(thread);

  assertEquals(journeys.length, 1);
  assertEquals(journeys[0], {
    id: ANALYSIS_EDGE_ID,
    routeEdgeKey: `observation:${OBSERVATION_ID}>evaluation:${EVALUATION_ID}`,
    usesEdgeId: "uses:sensitivity-base:evaluation",
    analysisEdgeId: ANALYSIS_EDGE_ID,
    case: {
      key: CASE_KEY,
      id: "demo-arm-height",
      revision: 1,
      artifactId: CASE_ARTIFACT_ID,
    },
    parameter: {
      id: "sensitivity-parameter:demo:RadialArm:arm_height",
      label: "RadialArm · Arm height",
      lower: { value: 5, unit: "mm" },
      upper: { value: 6, unit: "mm" },
    },
    responseLabel: "Stress",
    measurement: {
      method: "forward-finite-difference",
      basePoint: { value: 5, unit: "mm" },
      perturbationStep: { value: 1, unit: "mm" },
      responseAtBase: { value: 100, unit: "MPa" },
      responseAtPerturbed: { value: 90, unit: "MPa" },
      derivative: { value: -10, unit: "MPa/mm" },
    },
    observation: {
      id: OBSERVATION_ID,
      label: "stress at base",
      display: "100 MPa",
      measuredAt: "2026-09-09T00:00:00.000Z",
    },
    requirement: {
      id: "REQ-MECH-014",
      label: "Illustrative bracket stress",
      expression: "max(von_mises) <= 120 MPa",
    },
    evaluation: {
      id: EVALUATION_ID,
      label: "Illustrative bracket stress study-base evaluation",
      verdict: "pass",
      artifactId: EVALUATION_ARTIFACT_ID,
    },
    evidence: {
      studyArtifactId: STUDY_ARTIFACT_ID,
      studyArtifactLabel: "Measured sensitivity study",
      studyFingerprint: STUDY_DIGEST,
      evaluationArtifactId: EVALUATION_ARTIFACT_ID,
    },
  });
  assertEquals(JSON.stringify(thread), before, "projection must be read-only");
});

Deno.test("Overview sensitivity journey omits incomplete or ambiguous proof chains", () => {
  const cases: Array<{
    readonly name: string;
    readonly mutate: (thread: ThreadWorkbenchSnapshot) => void;
  }> = [
    {
      name: "declared rather than observed",
      mutate: (thread) => {
        sensitivityEdge(thread).analysis!.epistemicBasis = "declared";
      },
    },
    {
      name: "missing verified case input",
      mutate: (thread) => {
        thread.graph.edges = thread.graph.edges.filter((edge) =>
          edge.id !== "input:case:study"
        );
      },
    },
    {
      name: "ambiguous observation to evaluation cable",
      mutate: (thread) => {
        thread.graph.edges.push({
          ...usesEdge(),
          id: "uses:sensitivity-base:evaluation:duplicate",
        });
      },
    },
    {
      name: "stale study evidence",
      mutate: (thread) => {
        thread.artifacts.find((artifact) => artifact.id === STUDY_ARTIFACT_ID)!
          .freshness = "stale";
      },
    },
    {
      name: "case is no longer current",
      mutate: (thread) => {
        thread.engineeringCases!.current = [];
      },
    },
    {
      name: "evaluation does not recross the requirement",
      mutate: (thread) => {
        thread.graph.edges = thread.graph.edges.filter((edge) =>
          edge.id !== "evaluates:requirement:evaluation"
        );
      },
    },
  ];

  for (const item of cases) {
    const thread = sensitivityThread();
    item.mutate(thread);
    assertEquals(
      buildOverviewSensitivityJourneys(thread),
      [],
      item.name,
    );
  }
});

Deno.test("Overview attaches sensitivity to the exact current mechanical verdict sharing its requirement", () => {
  const thread = sensitivityThreadWithMechanicalVerdict();
  const journeys = buildOverviewSensitivityJourneys(thread);

  assertEquals(buildOverviewSensitivityVerdictBindings(thread, journeys), [{
    journeyId: ANALYSIS_EDGE_ID,
    verdictNodeKey: `evaluation:${MECHANICAL_EVALUATION_ID}`,
    verdictEvaluationId: MECHANICAL_EVALUATION_ID,
    requirementId: "REQ-MECH-014",
    mechanicalCaseKey: MECHANICAL_CASE_KEY,
  }]);
  assertEquals(
    MECHANICAL_EVALUATION_ID === journeys[0]?.evaluation.id,
    false,
    "the related mechanical and study-base verdicts must stay distinct",
  );

  const withHistory = structuredClone(thread);
  const requirement = withHistory.requirements.find((item) =>
    item.id === "REQ-MECH-014"
  )!;
  requirement.historicalEvaluations = [{
    relation: "historical-unjoined",
    hopIndex: 1,
    currentRequirementId: "REQ-MECH-014",
    predecessorRequirementId: "requirement-old",
    evaluationId: "eval-old",
    status: "pass",
    evaluatedAt: "2026-09-11T09:00:00.000Z",
    observations: [],
    evidence: [],
    predecessorCapture: {
      id: "requirements-old",
      fingerprint: `sha256:${"a".repeat(64)}`,
      producerRunId: "run:old",
    },
    currentArchitecture: {
      artifactId: "architecture-new",
      fingerprint: `sha256:${"b".repeat(64)}`,
      producerRunId: "run:new",
    },
    predecessorArchitecture: {
      artifactId: "architecture-old",
      fingerprint: `sha256:${"a".repeat(64)}`,
      producerRunId: "run:old",
    },
    native: {
      targetElementId: "part",
      requirementUsageId: "usage",
      constraintUsageId: "constraint",
      criterion: {
        metric: "max_von_mises_pa",
        operator: "<=",
        limit: { value: 120, unit: "MPa" },
      },
    },
  }];
  assertEquals(
    buildOverviewSensitivityJourneys(withHistory),
    journeys,
  );
  assertEquals(
    buildOverviewSensitivityVerdictBindings(withHistory, journeys),
    buildOverviewSensitivityVerdictBindings(thread, journeys),
  );
});

Deno.test("Overview omits an ungrounded or ambiguous sensitivity verdict attachment", () => {
  const ungrounded = sensitivityThreadWithMechanicalVerdict();
  requirementNode(ungrounded).engineeringCaseRefs = [CASE_KEY];
  assertEquals(buildOverviewSensitivityVerdictBindings(ungrounded), []);

  const ambiguous = sensitivityThreadWithMechanicalVerdict();
  const duplicateCaseKey = `verification-case:mechanical-proof:${
    "d".repeat(64)
  }`;
  ambiguous.engineeringCases!.cases.push({
    key: duplicateCaseKey,
    id: "other-current-proof",
    revision: 1,
    scope: "mechanical-structural",
    caseDigest: "d".repeat(64),
    authorityArtifactIds: ["other-proof-case"],
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
  });
  ambiguous.engineeringCases!.current.push({
    family: "mechanical-proof",
    id: "other-current-proof",
    currentCaseKey: duplicateCaseKey,
    revision: 1,
  });
  requirementNode(ambiguous).engineeringCaseRefs!.push(duplicateCaseKey);
  ambiguous.graph.nodes.push({
    ...mechanicalEvaluationNode(),
    id: "graph:evaluation:duplicate-mechanical",
    ref: { kind: "evaluation", id: "duplicate-mechanical" },
    engineeringCaseRefs: [duplicateCaseKey],
  });
  ambiguous.graph.edges.push({
    id: "evaluates:requirement:duplicate-mechanical",
    from: { kind: "requirement", id: "REQ-MECH-014" },
    to: { kind: "evaluation", id: "duplicate-mechanical" },
    relation: "evaluates",
    rationale: "A second current proof would make the presentation ambiguous.",
    origin: "provenance",
  });
  assertEquals(buildOverviewSensitivityVerdictBindings(ambiguous), []);
});

function sensitivityThread(): ThreadWorkbenchSnapshot {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  thread.engineeringCases = {
    schemaVersion: "engineering-cases/1.1",
    status: "observed",
    coverage: [{ family: "sensitivity-study", status: "observed" }],
    cases: [{
      key: CASE_KEY,
      id: "demo-arm-height",
      revision: 1,
      scope: "mechanical-structural",
      caseDigest: CASE_DIGEST,
      authorityArtifactIds: [CASE_ARTIFACT_ID],
      family: "sensitivity-study",
      caseSchemaVersion: "sensitivity-study-case/3.0",
    }],
    current: [{
      family: "sensitivity-study",
      id: "demo-arm-height",
      currentCaseKey: CASE_KEY,
      revision: 1,
    }],
    issues: [],
  };
  thread.artifacts.push(
    sensitivityArtifact(
      CASE_ARTIFACT_ID,
      "Sealed sensitivity case",
      "document",
      CASE_DIGEST,
      "analyze.seal-sensitivity-study@1",
    ),
    sensitivityArtifact(
      STUDY_ARTIFACT_ID,
      "Measured sensitivity study",
      "evidence",
      STUDY_DIGEST,
      "analyze.run-fea-sensitivity@1",
    ),
    sensitivityArtifact(
      EVALUATION_ARTIFACT_ID,
      "Sensitivity base evaluation",
      "evidence",
      "f".repeat(64),
      "verify.evaluate-sensitivity-base@1",
    ),
  );
  thread.observations.push({
    id: OBSERVATION_ID,
    label: "stress at base",
    value: 100,
    unit: "MPa",
    display: "100 MPa",
    sourceArtifactId: STUDY_ARTIFACT_ID,
    requirementIds: ["REQ-MECH-014"],
    freshness: "fresh",
    measuredAt: "2026-09-09T00:00:00.000Z",
  });
  const requirement = thread.requirements.find((candidate) =>
    candidate.id === "REQ-MECH-014"
  )!;
  requirement.status = "pass";
  requirement.expression = "max(von_mises) <= 120 MPa";
  requirement.observationIds = [OBSERVATION_ID];
  thread.graph.nodes.push(
    artifactNode(CASE_ARTIFACT_ID, "document"),
    artifactNode(STUDY_ARTIFACT_ID, "evidence"),
    artifactNode(EVALUATION_ARTIFACT_ID, "evidence"),
    {
      id: `graph:observation:${OBSERVATION_ID}`,
      ref: { kind: "observation", id: OBSERVATION_ID },
      entityKind: "observation",
      label: "stress at base",
      system: "CalculiX",
      freshness: "fresh",
      summary: "100 MPa",
    },
    {
      id: `graph:evaluation:${EVALUATION_ID}`,
      ref: { kind: "evaluation", id: EVALUATION_ID },
      entityKind: "evaluation",
      label: "Illustrative bracket stress study-base evaluation",
      system: "syson",
      freshness: "fresh",
      summary: "pass",
      evaluationFamily: "study-base",
      selection: { kind: "requirement", id: "REQ-MECH-014" },
      engineeringCaseRefs: [CASE_KEY],
    },
    analysisNode(
      "parameter",
      "sensitivity-parameter:demo:RadialArm:arm_height",
    ),
    analysisNode("metric", "sensitivity-response:demo:stress"),
  );
  thread.graph.edges.push(
    verifiedInputEdge(),
    sensitivityAnalysisEdge(),
    usesEdge(),
    {
      id: "evaluates:requirement:evaluation",
      from: { kind: "requirement", id: "REQ-MECH-014" },
      to: { kind: "evaluation", id: EVALUATION_ID },
      relation: "evaluates",
      rationale: "Exact requirement evaluated.",
      origin: "provenance",
    },
    {
      id: "evidences:evaluation",
      from: { kind: "artifact", id: EVALUATION_ARTIFACT_ID },
      to: { kind: "evaluation", id: EVALUATION_ID },
      relation: "evidences",
      rationale: "Recorded evaluation evidence.",
      origin: "provenance",
    },
  );
  return thread;
}

function sensitivityThreadWithMechanicalVerdict(): ThreadWorkbenchSnapshot {
  const thread = sensitivityThread();
  thread.engineeringCases!.coverage.push({
    family: "mechanical-proof",
    status: "observed",
  });
  thread.engineeringCases!.cases.push({
    key: MECHANICAL_CASE_KEY,
    id: "demo-arm-bench",
    revision: 2,
    scope: "mechanical-structural",
    caseDigest: MECHANICAL_CASE_DIGEST,
    authorityArtifactIds: ["mechanical-proof-case"],
    family: "mechanical-proof",
    caseSchemaVersion: "mechanical-proof-case/1.0",
  });
  thread.engineeringCases!.current.push({
    family: "mechanical-proof",
    id: "demo-arm-bench",
    currentCaseKey: MECHANICAL_CASE_KEY,
    revision: 2,
  });
  const requirement = requirementNode(thread);
  requirement.freshness = "fresh";
  requirement.engineeringCaseRefs = [CASE_KEY, MECHANICAL_CASE_KEY];
  thread.graph.nodes.push(mechanicalEvaluationNode());
  thread.graph.edges.push({
    id: "evaluates:requirement:mechanical-evaluation",
    from: { kind: "requirement", id: "REQ-MECH-014" },
    to: { kind: "evaluation", id: MECHANICAL_EVALUATION_ID },
    relation: "evaluates",
    rationale: "The current mechanical proof evaluates the exact requirement.",
    origin: "provenance",
  });
  return thread;
}

function requirementNode(thread: ThreadWorkbenchSnapshot): ThreadGraphNode {
  return thread.graph.nodes.find((node) =>
    node.ref.kind === "requirement" && node.ref.id === "REQ-MECH-014"
  )!;
}

function mechanicalEvaluationNode(): ThreadGraphNode {
  return {
    id: `graph:evaluation:${MECHANICAL_EVALUATION_ID}`,
    ref: { kind: "evaluation", id: MECHANICAL_EVALUATION_ID },
    entityKind: "evaluation",
    label: "Illustrative bracket stress evaluation",
    system: "syson",
    freshness: "fresh",
    summary: "pass",
    selection: { kind: "requirement", id: "REQ-MECH-014" },
    engineeringCaseRefs: [MECHANICAL_CASE_KEY],
  };
}

function sensitivityArtifact(
  id: string,
  label: string,
  kind: string,
  digest: string,
  tool: string,
) {
  return {
    id,
    label,
    kind,
    system: "digital-thread",
    revision: "1",
    freshness: "fresh" as const,
    fingerprint: `sha256:${digest}`,
    producer: { serverId: "digital-thread", tool, runId: `run:${tool}` },
    dependsOn: [],
  };
}

function artifactNode(id: string, artifactKind: string): ThreadGraphNode {
  return {
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    artifactKind,
    label: id,
    system: "digital-thread",
    freshness: "fresh",
    summary: artifactKind,
  };
}

function analysisNode(kind: string, id: string): ThreadGraphNode {
  return {
    id: `graph:analysis-node:${id}`,
    ref: { kind: "analysis-node", id },
    entityKind: "analysis-node",
    label: id,
    system: "thread",
    freshness: "fresh",
    summary: kind,
    analysis: {
      semanticRef: {
        domain: "thread",
        kind,
        id,
        basisFingerprint: CASE_DIGEST,
      },
    },
  };
}

function verifiedInputEdge(): ThreadGraphEdge {
  return {
    id: "input:case:study",
    from: { kind: "artifact", id: CASE_ARTIFACT_ID },
    to: { kind: "artifact", id: STUDY_ARTIFACT_ID },
    relation: "input_to",
    rationale: "The sealed case is the exact study input.",
    origin: "structure",
    attestation: {
      consumptionId: "consume:case:study",
      status: "verified",
      producerFingerprint: `sha256:${CASE_DIGEST}`,
      consumedFingerprint: `sha256:${CASE_DIGEST}`,
      checkedAt: "2026-09-09T00:00:00.000Z",
    },
  };
}

function sensitivityAnalysisEdge(): ThreadGraphEdge {
  return {
    id: ANALYSIS_EDGE_ID,
    from: {
      kind: "analysis-node",
      id: "sensitivity-parameter:demo:RadialArm:arm_height",
    },
    to: {
      kind: "analysis-node",
      id: "sensitivity-response:demo:stress",
    },
    relation: "measured-local-sensitivity",
    rationale: "Two exact FEA points measured the local response.",
    origin: "analysis",
    analysis: {
      assertionId: ANALYSIS_EDGE_ID,
      epistemicBasis: "observed",
      assertedBy: { kind: "server", id: "digital-thread", version: "1" },
      evidence: [{ id: STUDY_ARTIFACT_ID, fingerprint: STUDY_DIGEST }],
      scope: {
        kind: "local-neighborhood",
        parameter: {
          domain: "thread",
          kind: "parameter",
          id: "sensitivity-parameter:demo:RadialArm:arm_height",
          basisFingerprint: CASE_DIGEST,
        },
        basisFingerprint: CASE_DIGEST,
        lower: { value: 5, unit: "mm" },
        upper: { value: 6, unit: "mm" },
      },
      measurement: {
        method: "forward-finite-difference",
        basePoint: { value: 5, unit: "mm" },
        perturbationStep: { value: 1, unit: "mm" },
        responseAtBase: { value: 100, unit: "MPa" },
        responseAtPerturbed: { value: 90, unit: "MPa" },
        derivative: { value: -10, unit: "MPa/mm" },
      },
    },
  };
}

function usesEdge(): ThreadGraphEdge {
  return {
    id: "uses:sensitivity-base:evaluation",
    from: { kind: "observation", id: OBSERVATION_ID },
    to: { kind: "evaluation", id: EVALUATION_ID },
    relation: "uses",
    rationale: "The evaluation cites the exact study-base observation.",
    origin: "provenance",
  };
}

function sensitivityEdge(thread: ThreadWorkbenchSnapshot): ThreadGraphEdge {
  return thread.graph.edges.find((edge) => edge.id === ANALYSIS_EDGE_ID)!;
}
