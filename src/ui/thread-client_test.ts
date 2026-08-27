import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  createThreadWorkbenchClient,
  HttpThreadWorkbenchClient,
} from "./src/thread/client.ts";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  type EngineeringEvidenceWorkbenchSnapshot,
  isEngineeringWorkbenchSnapshot,
  isThreadWorkbenchSnapshot,
  type ThreadArtifact,
  type ThreadGraphNode,
  type ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("native Workbench rejects a missing bootstrap instead of selecting a product fixture", async () => {
  const client = createThreadWorkbenchClient();
  assertEquals(client.source, "unconfigured");
  await assertRejects(
    () => client.load(),
    Error,
    "Engineering Workbench bootstrap is required",
  );
});

Deno.test("injected Workbench projection is preserved without a transport call", async () => {
  const client = createThreadWorkbenchClient({
    projection: GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  });

  assertEquals(client.source, "injected");
  assertStrictEquals(
    await client.load(),
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  );
  assertEquals(isEngineeringWorkbenchSnapshot(await client.load()), true);
});

Deno.test("evidence Workbench rejects unknown fields and incomplete array entities", () => {
  const extraRoot = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  extraRoot.providerResult = { hidden: true };
  assertEquals(isEngineeringWorkbenchSnapshot(extraRoot), false);

  const extraSubject = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { subject: Record<string, unknown> } };
  extraSubject.thread.subject.providerId = "must-stay-server-side";
  assertEquals(isEngineeringWorkbenchSnapshot(extraSubject), false);

  const extraChange = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { change: Record<string, unknown> } };
  extraChange.thread.change.toolArguments = {};
  assertEquals(isEngineeringWorkbenchSnapshot(extraChange), false);

  const malformedArtifacts = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { artifacts: unknown[] } };
  malformedArtifacts.thread.artifacts = [null];
  assertEquals(isEngineeringWorkbenchSnapshot(malformedArtifacts), false);

  const extraArtifactField = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { artifacts: Array<Record<string, unknown>> } };
  extraArtifactField.thread.artifacts[0]!.sysonElementId = "must-not-leak";
  assertEquals(isEngineeringWorkbenchSnapshot(extraArtifactField), false);

  const sealedDocument = structuredClone(GENERIC_THREAD_FIXTURE);
  sealedDocument.artifacts[0] = {
    ...sealedDocument.artifacts[0]!,
    kind: "document",
    producedBy: "model.seal-architecture-sysml@1",
    architectureSysmlSeal: {
      producer: "model.seal-architecture-sysml@1",
      authority: "documentary",
      artifactKind: "document",
      notSyson: true,
      notWriteArchitecture: true,
      notCompilationAdmission: true,
      symbolsStatus: "observed",
      sourceStatus: "observed",
      sourceText: "package DroneV4 {}\n",
      symbols: [{
        id: "symbol:package",
        kind: "artifact",
        label: "DroneV4",
        span: { start: { line: 1, column: 8 }, end: { line: 1, column: 15 } },
      }],
      incidences: [{
        id: "dependency:usage-type",
        kind: "structural-incidence",
        fromSymbolId: "symbol:package",
        toSymbolId: "symbol:package-type",
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 18 } },
      }],
      unresolvedConstructs: [{
        id: "unresolved:comment",
        kind: "comment",
        message: "A comment is outside the architecture closed subset.",
        span: { start: { line: 2, column: 0 }, end: { line: 2, column: 8 } },
      }],
    },
  };
  assertEquals(isThreadWorkbenchSnapshot(sealedDocument), true);

  const missingIncidences = structuredClone(sealedDocument);
  delete (missingIncidences.artifacts[0] as {
    architectureSysmlSeal?: {
      incidences?: unknown;
    };
  }).architectureSysmlSeal?.incidences;
  assertEquals(isThreadWorkbenchSnapshot(missingIncidences), false);

  const labelledIncidence = structuredClone(sealedDocument) as {
    artifacts: Array<{
      architectureSysmlSeal?: {
        incidences: Array<
          Record<string, unknown>
        >;
      };
    }>;
  };
  labelledIncidence.artifacts[0]!.architectureSysmlSeal!.incidences[0]!
    .fromLabel = "must-not-be-a-join-key";
  assertEquals(isThreadWorkbenchSnapshot(labelledIncidence), false);

  const missingSourceStatus = structuredClone(sealedDocument);
  delete (missingSourceStatus.artifacts[0] as {
    architectureSysmlSeal?: { sourceStatus?: unknown };
  }).architectureSysmlSeal?.sourceStatus;
  assertEquals(isThreadWorkbenchSnapshot(missingSourceStatus), false);

  const observedWithoutSourceText = structuredClone(sealedDocument);
  delete (observedWithoutSourceText.artifacts[0] as {
    architectureSysmlSeal?: { sourceText?: unknown };
  }).architectureSysmlSeal?.sourceText;
  assertEquals(isThreadWorkbenchSnapshot(observedWithoutSourceText), false);

  const unavailableWithSource = structuredClone(sealedDocument) as {
    artifacts: Array<{
      architectureSysmlSeal?: {
        sourceStatus?: string;
        sourceText?: string;
        symbols: Array<Record<string, unknown>>;
        incidences: Array<Record<string, unknown>>;
        unresolvedConstructs: Array<Record<string, unknown>>;
      };
    }>;
  };
  unavailableWithSource.artifacts[0]!.architectureSysmlSeal!.sourceStatus =
    "unavailable";
  assertEquals(isThreadWorkbenchSnapshot(unavailableWithSource), false);

  const unavailableCaptureOnly = structuredClone(sealedDocument) as {
    artifacts: Array<{
      architectureSysmlSeal?: {
        symbolsStatus?: string;
        sourceStatus?: string;
        sourceText?: string;
        symbols: unknown[];
        incidences: unknown[];
        unresolvedConstructs: Array<Record<string, unknown>>;
      };
    }>;
  };
  const unavailableSeal = unavailableCaptureOnly.artifacts[0]!
    .architectureSysmlSeal!;
  unavailableSeal.symbolsStatus = "unavailable";
  unavailableSeal.sourceStatus = "unavailable";
  delete unavailableSeal.sourceText;
  unavailableSeal.symbols = [];
  unavailableSeal.incidences = [];
  unavailableSeal.unresolvedConstructs = [{
    id: "unresolved:comment",
    kind: "comment",
  }];
  assertEquals(isThreadWorkbenchSnapshot(unavailableCaptureOnly), true);

  unavailableSeal.unresolvedConstructs[0]!.message = "must-not-invent";
  assertEquals(isThreadWorkbenchSnapshot(unavailableCaptureOnly), false);

  const extraSpanField = structuredClone(sealedDocument) as {
    artifacts: Array<{
      architectureSysmlSeal?: {
        symbols: Array<{ span?: Record<string, unknown> }>;
      };
    }>;
  };
  extraSpanField.artifacts[0]!.architectureSysmlSeal!.symbols[0]!.span!.origin =
    "invented";
  assertEquals(isThreadWorkbenchSnapshot(extraSpanField), false);

  const malformedActions = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { actions: unknown[] } };
  malformedActions.thread.actions = [{
    id: "action-without-authority-boundary",
  }];
  assertEquals(isEngineeringWorkbenchSnapshot(malformedActions), false);
});

Deno.test("client validator accepts only exact provider-free assembly-integrity L3/L4/L5 projection", () => {
  const snapshot = assemblyIntegrityThreadFixture();
  assertEquals(isThreadWorkbenchSnapshot(snapshot), true);

  const rawProvider = structuredClone(snapshot) as unknown as {
    assemblyIntegrity: {
      chains: Array<{ observation: { record: Record<string, unknown> } }>;
    };
  };
  rawProvider.assemblyIntegrity.chains[0]!.observation.record.provider =
    "must-not-leak";
  assertEquals(isThreadWorkbenchSnapshot(rawProvider), false);

  const sixthCriterion = structuredClone(snapshot) as {
    assemblyIntegrity: {
      chains: Array<{ evaluation: { criteria: unknown[] } }>;
    };
  };
  sixthCriterion.assemblyIntegrity.chains[0]!.evaluation.criteria.push({
    id: "invented-criterion",
    verdict: "pass",
  });
  assertEquals(isThreadWorkbenchSnapshot(sixthCriterion), false);

  const l3Verdict = structuredClone(snapshot) as unknown as {
    assemblyIntegrity: {
      chains: Array<{ observation: Record<string, unknown> }>;
    };
  };
  l3Verdict.assemblyIntegrity.chains[0]!.observation.aggregateVerdict = "pass";
  assertEquals(isThreadWorkbenchSnapshot(l3Verdict), false);
});

Deno.test("evidence Workbench rejects incoherent revisions and malformed live overlays", () => {
  const missingLive = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { live?: unknown } };
  delete missingLive.thread.live;
  assertEquals(isEngineeringWorkbenchSnapshot(missingLive), false);

  const fractionalRevision = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { alignment: { currentThreadRevision: number } };
  fractionalRevision.alignment.currentThreadRevision = 1.5;
  assertEquals(isEngineeringWorkbenchSnapshot(fractionalRevision), false);

  const mismatchedAsOf = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as {
    thread: { evidenceFamilyGraph: { asOf: { revision: number } } };
  };
  mismatchedAsOf.thread.evidenceFamilyGraph.asOf.revision = 2;
  assertEquals(isEngineeringWorkbenchSnapshot(mismatchedAsOf), false);

  const impossibleLiveVersion = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as {
    thread: {
      live: {
        version: number;
        active: unknown[];
      };
    };
  };
  impossibleLiveVersion.thread.live.active = [{
    runId: "run-1",
    operationId: "design.write-geometry@1",
    state: "running",
    recordedAt: "2026-08-02T12:00:00.000Z",
    baseRevision: 1,
    sequence: 1,
  }];
  assertEquals(isEngineeringWorkbenchSnapshot(impossibleLiveVersion), false);

  const crossSubject = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as { thread: { subject: { id: string } } };
  crossSubject.thread.subject.id = "another-subject";
  assertEquals(isEngineeringWorkbenchSnapshot(crossSubject), false);
});

function publicPretechnicalProject(
  project: typeof GENERIC_ENGINEERING_WORKBENCH_FIXTURE["project"],
) {
  return {
    ...project,
    agentRuns: project.agentRuns.map((run) => ({
      id: run.id,
      workItemId: run.workItemId,
      status: run.status,
      summary: run.summary,
      queuedAt: run.queuedAt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      evidenceRefs: [],
    })),
  };
}

Deno.test("Workbench contract accepts a planning surface only when no technical baseline is declared", () => {
  const planning = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  planning.surface = "planning";
  delete planning.thread;
  delete planning.projectPath;
  delete planning.alignment;
  delete planning.caseActivityJoins;
  delete planning.unresolvedEvidenceReferences;
  planning.project = publicPretechnicalProject(
    planning.project as typeof GENERIC_ENGINEERING_WORKBENCH_FIXTURE["project"],
  );
  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  planning.planning = {
    technicalBaseline: {
      status: "running",
      message: "The agent is preparing the first documentary baseline.",
    },
    baselineRun: {
      id: "run-first-baseline",
      status: "running",
      workItem: {
        id: "work-define",
        title: "Prepare the first system definition",
        kind: "define",
      },
      queuedAt: "2026-08-02T12:00:00.000Z",
      statusHistory: [{
        status: "queued",
        at: "2026-08-02T12:00:00.000Z",
      }, {
        status: "running",
        at: "2026-08-02T12:00:05.000Z",
      }],
    },
    activity: {
      version: 4,
      milestones: [{
        sequence: 4,
        state: "running",
        recordedAt: "2026-08-02T12:00:06.000Z",
      }],
    },
  };

  assertEquals(isEngineeringWorkbenchSnapshot(planning), true);

  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [{
    snapshotId: "thread-r1",
    revision: 1,
    subjectId: "GEN-01",
  }];
  assertEquals(isEngineeringWorkbenchSnapshot(planning), false);
});

Deno.test("Workbench contract rejects a planning activity that carries graph or provider payload", () => {
  const planning = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  planning.surface = "planning";
  delete planning.thread;
  delete planning.projectPath;
  delete planning.alignment;
  delete planning.caseActivityJoins;
  delete planning.unresolvedEvidenceReferences;
  planning.project = publicPretechnicalProject(
    planning.project as typeof GENERIC_ENGINEERING_WORKBENCH_FIXTURE["project"],
  );
  (planning.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  planning.planning = {
    technicalBaseline: {
      status: "queued",
      message: "A reviewed first run is queued.",
    },
    activity: {
      version: 1,
      milestones: [{
        sequence: 1,
        state: "running",
        recordedAt: "2026-08-02T12:00:00.000Z",
        graph: { nodes: [], edges: [] },
      }],
    },
  };

  assertEquals(isEngineeringWorkbenchSnapshot(planning), false);
});

Deno.test("Workbench contract keeps a documentary baseline separate from an evidence thread", () => {
  const fixture = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const documentary = {
    schemaVersion: "engineering-workbench/0.6",
    surface: "documentary",
    project: publicPretechnicalProject(fixture.project),
    documentary: {
      status: "recorded",
      message: "One durable pre-technical record is available.",
      record: {
        origin: "approved-brief",
        snapshotId: fixture.project.threadSnapshots[0]!.snapshotId,
        snapshotRevision: fixture.project.threadSnapshots[0]!.revision,
        artifactId: "approved-brief-document",
        label: "Approved project brief documentary baseline (pre-technical)",
        fingerprint: "sha256:documentary-record",
        recordedAt: "2026-08-02T12:00:00.000Z",
      },
      technicalEvidence: {
        status: "not-recorded",
        message: "No CAD, SysML, simulation or compliance proof is recorded.",
      },
    },
  };

  assertEquals(isEngineeringWorkbenchSnapshot(documentary), true);
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...documentary,
      thread: fixture.thread,
    }),
    false,
  );
});

Deno.test("Workbench contract accepts only the closed live SysON seed sequence on documentary r1", () => {
  const fixture = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const documentary = {
    schemaVersion: "engineering-workbench/0.6",
    surface: "documentary",
    project: publicPretechnicalProject(fixture.project),
    documentary: {
      status: "recorded",
      message: "One durable pre-technical record is available.",
      record: {
        origin: "approved-brief",
        snapshotId: fixture.project.threadSnapshots[0]!.snapshotId,
        snapshotRevision: fixture.project.threadSnapshots[0]!.revision,
        artifactId: "approved-brief-document",
        label: "Approved project brief documentary baseline (pre-technical)",
        fingerprint: "sha256:documentary-record",
        recordedAt: "2026-08-02T12:00:00.000Z",
      },
      technicalEvidence: {
        status: "not-recorded",
        message: "No technical proof is recorded.",
      },
      technicalStart: {
        kind: "sysml-container-seed",
        state: "running",
        message: "The first SysON container is being read back.",
        activity: {
          version: 3,
          steps: [{
            id: "project-container",
            state: "fresh",
            label: "SysON project container",
            summary: "Created.",
            recordedAt: "2026-08-02T12:00:01.000Z",
          }, {
            id: "sysml-document",
            state: "running",
            label: "Editable SysML document",
            summary: "Creating.",
            recordedAt: "2026-08-02T12:00:02.000Z",
            predecessor: "project-container",
          }],
        },
      },
    },
  } as const;

  assertEquals(isEngineeringWorkbenchSnapshot(documentary), true);
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...documentary,
      documentary: {
        ...documentary.documentary,
        technicalStart: {
          ...documentary.documentary.technicalStart,
          activity: {
            ...documentary.documentary.technicalStart.activity,
            steps: [{
              ...documentary.documentary.technicalStart.activity.steps[0]!,
              providerResult: "must not be accepted",
            }],
          },
        },
      },
    }),
    false,
  );
});

Deno.test("the Workbench contract requires explicit flow dependencies", () => {
  const missingDependencies = JSON.parse(
    JSON.stringify(GENERIC_THREAD_FIXTURE),
  ) as typeof GENERIC_THREAD_FIXTURE;
  delete (missingDependencies.flow[0] as { dependsOn?: string[] }).dependsOn;

  assertEquals(isThreadWorkbenchSnapshot(missingDependencies), false);
});

Deno.test("the Workbench contract requires a typed native graph", () => {
  const missingGraph = JSON.parse(
    JSON.stringify(GENERIC_THREAD_FIXTURE),
  ) as Partial<typeof GENERIC_THREAD_FIXTURE>;
  delete missingGraph.graph;
  assertEquals(isThreadWorkbenchSnapshot(missingGraph), false);

  const unsupportedRelation = JSON.parse(
    JSON.stringify(GENERIC_THREAD_FIXTURE),
  ) as typeof GENERIC_THREAD_FIXTURE;
  unsupportedRelation.graph.edges[0].relation = "fuzzy_match" as never;
  assertEquals(isThreadWorkbenchSnapshot(unsupportedRelation), false);
});

Deno.test("the Workbench contract rejects duplicate graph identities and dangling edges", () => {
  const duplicateNodeId = structuredClone(GENERIC_THREAD_FIXTURE);
  const firstNode = duplicateNodeId.graph.nodes[0];
  if (!firstNode) throw new Error("Expected one graph-node fixture.");
  duplicateNodeId.graph.nodes.push(structuredClone(firstNode));
  assertEquals(isThreadWorkbenchSnapshot(duplicateNodeId), false);

  const duplicateReference = structuredClone(GENERIC_THREAD_FIXTURE);
  const referencedNode = duplicateReference.graph.nodes[0];
  if (!referencedNode) throw new Error("Expected one graph-node fixture.");
  duplicateReference.graph.nodes.push({
    ...structuredClone(referencedNode),
    id: `${referencedNode.id}:duplicate-browser-key`,
  });
  assertEquals(isThreadWorkbenchSnapshot(duplicateReference), false);

  const danglingEdge = structuredClone(GENERIC_THREAD_FIXTURE);
  const firstEdge = danglingEdge.graph.edges[0];
  if (!firstEdge) throw new Error("Expected one graph-edge fixture.");
  firstEdge.from = { kind: "artifact", id: "missing-graph-node" };
  assertEquals(isThreadWorkbenchSnapshot(danglingEdge), false);
});

Deno.test("the Workbench contract permits duplicate edge ids for distinct occurrences", () => {
  const duplicateEdgeId = structuredClone(GENERIC_THREAD_FIXTURE);
  const [firstEdge, secondEdge] = duplicateEdgeId.graph.edges;
  if (!firstEdge || !secondEdge) {
    throw new Error("Expected two distinct graph-edge fixtures.");
  }
  secondEdge.id = firstEdge.id;

  assertEquals(isThreadWorkbenchSnapshot(duplicateEdgeId), true);
});

Deno.test("evidence families cannot mask valid evidence without exact raw supersession", () => {
  const valid = evidenceWorkbenchWithDeclaredFamily();
  assertEquals(isEngineeringWorkbenchSnapshot(valid), true);

  const masksUnrelatedEvidence = evidenceWorkbenchWithDeclaredFamily();
  masksUnrelatedEvidence.thread.evidenceFamilyGraph.families[0]!
    .historicalRefs.push({ kind: "artifact", id: "ART-CAD-018" });
  assertEquals(isEngineeringWorkbenchSnapshot(masksUnrelatedEvidence), false);

  const unknownTransition = evidenceWorkbenchWithDeclaredFamily();
  unknownTransition.thread.evidenceFamilyGraph.families[0]!
    .transitions[0]!.edgeRef.id = "missing-raw-supersession";
  assertEquals(isEngineeringWorkbenchSnapshot(unknownTransition), false);

  const outsideGraph = evidenceWorkbenchWithDeclaredFamily();
  const outsideFamily = outsideGraph.thread.evidenceFamilyGraph.families[0]!;
  outsideFamily.currentRefs[0] = { kind: "artifact", id: "missing-current" };
  outsideFamily.transitions[0]!.successor = {
    kind: "artifact",
    id: "missing-current",
  };
  assertEquals(isEngineeringWorkbenchSnapshot(outsideGraph), false);

  const duplicateMembership = evidenceWorkbenchWithDeclaredFamily();
  const declaredFamily = duplicateMembership.thread.evidenceFamilyGraph
    .families[0]!;
  duplicateMembership.thread.evidenceFamilyGraph.families.push({
    ...structuredClone(declaredFamily),
    id: "duplicate-membership-family",
  });
  assertEquals(isEngineeringWorkbenchSnapshot(duplicateMembership), false);
});

Deno.test("evidence families accept an architecture-capture derived_from predecessor", () => {
  const workbench = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const predecessor = workbench.thread.graph.nodes.find((node) =>
    node.ref.kind === "artifact" && node.ref.id === "ART-SYSML-018"
  );
  if (!predecessor || typeof predecessor.artifactKind !== "string") {
    throw new Error("Expected ART-SYSML-018 fixture node.");
  }
  const edge = {
    id: "architecture-v2-to-v3",
    from: { ...predecessor.ref },
    to: { ...predecessor.ref, id: `${predecessor.ref.id}-v3` },
    relation: "derived_from" as const,
    origin: "provenance" as const,
    rationale: "Parser-backed architecture attests its predecessor.",
  };
  const tipNode = {
    ...predecessor,
    id: `graph:artifact:${edge.to.id}`,
    ref: { ...edge.to },
    label: predecessor.label,
  };
  workbench.thread.graph.nodes.push(tipNode);
  workbench.thread.graph.edges.push(edge);
  const edgeRef = {
    id: edge.id,
    relation: edge.relation,
    origin: edge.origin,
  };
  workbench.thread.evidenceFamilyGraph.families = [{
    id: "fixture-architecture-family",
    entityKind: "artifact",
    artifactKind: predecessor.artifactKind,
    historicalRefs: [{ ...edge.from }],
    currentRefs: [{ ...edge.to }],
    revisionCount: 1,
    status: "current",
    relationship: {
      relation: "supersedes",
      classification: "not-recorded",
      equivalence: "not-recorded",
    },
    transitions: [{
      edgeRef,
      historical: { ...edge.from },
      successor: { ...edge.to },
    }],
  }];
  workbench.thread.evidenceFamilyGraph.edges = [];
  workbench.thread.evidenceFamilyGraph.omittedSelfLoops = [{
    familyId: "fixture-architecture-family",
    memberEdgeRefs: [edgeRef],
  }];
  workbench.thread.evidenceFamilyGraph.omittedCycleEdges = [];

  assertEquals(isEngineeringWorkbenchSnapshot(workbench), true);
});

Deno.test("the Workbench contract requires one non-empty structured requirement source identity", () => {
  const missingSourceElementId = structuredClone(GENERIC_THREAD_FIXTURE);
  delete (missingSourceElementId.requirements[0] as {
    sourceElementId?: string;
  }).sourceElementId;
  assertEquals(isThreadWorkbenchSnapshot(missingSourceElementId), false);

  const blankSourceElementId = structuredClone(GENERIC_THREAD_FIXTURE);
  blankSourceElementId.requirements[0]!.sourceElementId = "";
  assertEquals(isThreadWorkbenchSnapshot(blankSourceElementId), false);
});

Deno.test("the Workbench contract accepts qualified analysis assertions and rejects malformed detail", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const digest = "a".repeat(64);
  snapshot.graph.nodes.push({
    id: "analysis-node:wall-thickness",
    ref: { kind: "analysis-node", id: "wall-thickness" },
    entityKind: "analysis-node",
    label: "wall-thickness",
    system: "thread",
    freshness: "fresh",
    summary: "parameter · thread",
    analysis: {
      semanticRef: {
        domain: "thread",
        kind: "parameter",
        id: "wall-thickness",
        basisFingerprint: digest,
      },
    },
  }, {
    id: "analysis-node:von-mises-max",
    ref: { kind: "analysis-node", id: "von-mises-max" },
    entityKind: "analysis-node",
    label: "von-mises-max",
    system: "calculix",
    freshness: "fresh",
    summary: "metric · calculix",
    analysis: {
      semanticRef: {
        domain: "calculix",
        kind: "metric",
        id: "von-mises-max",
      },
    },
  });
  snapshot.graph.edges.push({
    id: "assertion:sensitivity:wall-thickness:von-mises-max",
    from: { kind: "analysis-node", id: "wall-thickness" },
    to: { kind: "analysis-node", id: "von-mises-max" },
    relation: "measured-local-sensitivity",
    rationale: "Measured from retained solver outputs.",
    origin: "analysis",
    analysis: {
      assertionId: "assertion:sensitivity:wall-thickness:von-mises-max",
      epistemicBasis: "observed",
      assertedBy: { kind: "provider", id: "calculix" },
      evidence: [{ id: "ART-FEA-018", fingerprint: digest }],
      scope: {
        kind: "local-neighborhood",
        parameter: {
          domain: "thread",
          kind: "parameter",
          id: "wall-thickness",
          basisFingerprint: digest,
        },
        basisFingerprint: digest,
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
    },
  });

  assertEquals(isThreadWorkbenchSnapshot(snapshot), true);

  const wrongAssertionId = structuredClone(snapshot);
  wrongAssertionId.graph.edges.at(-1)!.analysis!.assertionId = "other-assertion";
  assertEquals(isThreadWorkbenchSnapshot(wrongAssertionId), false);

  const missingMeasurement = structuredClone(snapshot);
  delete missingMeasurement.graph.edges.at(-1)!.analysis!.measurement;
  assertEquals(isThreadWorkbenchSnapshot(missingMeasurement), false);

  const unexpectedMeasurement = structuredClone(snapshot);
  unexpectedMeasurement.graph.edges.at(-1)!.relation = "declared-dependency";
  assertEquals(isThreadWorkbenchSnapshot(unexpectedMeasurement), false);

  const invalidSourcePosition = structuredClone(snapshot);
  const invalidDetail = invalidSourcePosition.graph.edges.at(-1)!.analysis!;
  invalidSourcePosition.graph.edges.at(-1)!.relation = "static-value-flow";
  delete invalidDetail.measurement;
  invalidDetail.scope = {
    kind: "source-span",
    source: {
      domain: "cad",
      kind: "model-symbol",
      id: "wall-thickness",
      basisFingerprint: digest,
    },
    basisFingerprint: digest,
    start: { line: 0, column: 0 },
    end: { line: 1, column: 0 },
  };
  assertEquals(isThreadWorkbenchSnapshot(invalidSourcePosition), false);
});

Deno.test("the Workbench contract accepts exact SysML structure nodes and rejects malformed model kinds", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.graph.nodes.push({
    id: "graph:part-definition:def-system",
    ref: { kind: "part-definition", id: "def-system" },
    entityKind: "part-definition",
    label: "GenericAssembly",
    system: "syson",
    freshness: "fresh",
    summary: "PartDefinition · def-system",
    selection: { kind: "artifact", id: "ART-SYSML-017" },
  }, {
    id: "graph:part-usage:usage-tray",
    ref: { kind: "part-usage", id: "usage-tray" },
    entityKind: "part-usage",
    label: "tray",
    system: "syson",
    freshness: "fresh",
    summary: "PartUsage · typed by DripTray",
    selection: { kind: "artifact", id: "ART-SYSML-017" },
  }, {
    id: "graph:attribute-usage:attr-thickness",
    ref: { kind: "attribute-usage", id: "attr-thickness" },
    entityKind: "attribute-usage",
    label: "thickness",
    system: "syson",
    freshness: "fresh",
    summary: "AttributeUsage · owned by GenericAssembly",
    selection: { kind: "artifact", id: "ART-SYSML-017" },
  });
  snapshot.graph.edges.push({
    id: "structure:contains:def-system:usage-tray",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "part-usage", id: "usage-tray" },
    relation: "contains",
    rationale: "GenericAssembly contains tray.",
    origin: "structure",
  }, {
    id: "structure:typed-by:usage-tray:def-tray",
    from: { kind: "part-usage", id: "usage-tray" },
    to: { kind: "part-definition", id: "def-system" },
    relation: "typed_by",
    rationale: "tray is typed by the exact definition.",
    origin: "structure",
  }, {
    id: "structure:represented-by:def-system:ART-STEP-018",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "artifact", id: "ART-STEP-018" },
    relation: "represented_by",
    rationale: "The exact STEP represents this PartDefinition.",
    origin: "structure",
  }, {
    id: "structure:contains:def-system:attr-thickness",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "attribute-usage", id: "attr-thickness" },
    relation: "contains",
    rationale: "GenericAssembly contains thickness.",
    origin: "structure",
  }, {
    id: "structure:parameterizes:admission:attr-thickness",
    from: { kind: "cad-lever", id: "admission:parameter.thickness" },
    to: { kind: "attribute-usage", id: "attr-thickness" },
    relation: "parameterizes",
    rationale: "Sealed admission uniquely parameterizes thickness.",
    origin: "structure",
  });
  snapshot.graph.nodes.push({
    id: "graph:cad-lever:admission:parameter.thickness",
    ref: { kind: "cad-lever", id: "admission:parameter.thickness" },
    entityKind: "cad-lever",
    label: "CAD · thickness = 8",
    system: "build123d",
    freshness: "fresh",
    summary: "named numeric lever · unit undeclared",
    selection: { kind: "artifact", id: "ART-SYSML-017" },
  }, {
    id: "graph:source-file:source.cad@1",
    ref: { kind: "source-file", id: "source.cad@1" },
    entityKind: "source-file",
    label: "rail.py",
    system: "project-source-workspace",
    freshness: "fresh",
    summary: "cad-script · source.cad@1",
    selection: { kind: "artifact", id: "ART-SYSML-017" },
  });
  snapshot.graph.edges.push({
    id: "structure:represented-by:def-system:source.cad@1",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "source-file", id: "source.cad@1" },
    relation: "represented_by",
    rationale: "The exact source file represents this PartDefinition.",
    origin: "structure",
  }, {
    id: "structure:verified-by:def-system:fea-proof",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "artifact", id: "ART-STEP-018" },
    relation: "verified_by",
    rationale: "The exact proof case targets this PartDefinition.",
    origin: "structure",
  }, {
    id: "structure:constrained-by:def-system:REQ-MASS-006",
    from: { kind: "part-definition", id: "def-system" },
    to: { kind: "requirement", id: "REQ-MASS-006" },
    relation: "constrained_by",
    rationale: "The exact requirements capture targets this PartDefinition.",
    origin: "structure",
  });
  snapshot.sourceFiles = {
    schemaVersion: "thread-source-files/1.0",
    status: "observed",
    files: [{
      fileId: "source.cad",
      fileRevision: 1,
      workspaceRevision: 2,
      workspaceEventFingerprint: `sha256:${"e".repeat(64)}`,
      fileFingerprint: `sha256:${"f".repeat(64)}`,
      resourceFingerprint: `sha256:${"c".repeat(64)}`,
      resourceUri: `casys://agent-resource-capture/sha256/${"c".repeat(64)}`,
      resourceName: "rail.py",
      mimeType: "text/x-python",
      moduleId: "mod-rail",
      role: "cad-script",
      admissionArtifactId: "technical-compilation-admission-" + "a".repeat(64),
      bindings: [{
        relation: "represents",
        sourceSymbolId: "artifact.result",
        sysmlElementId: "def-system",
        sysmlElementKind: "PartDefinition",
      }],
    }],
  };
  snapshot.requirements[1]!.targetElementId = "def-system";
  assertEquals(isThreadWorkbenchSnapshot(snapshot), true);

  snapshot.graph.nodes.at(-1)!.entityKind = "artifact";
  assertEquals(isThreadWorkbenchSnapshot(snapshot), false);
});

Deno.test("the Workbench contract accepts only its explicit activity role", () => {
  const milestone = structuredClone(GENERIC_THREAD_FIXTURE);
  milestone.graph.nodes[0]!.activityRole = "milestone";
  assertEquals(isThreadWorkbenchSnapshot(milestone), true);

  milestone.graph.nodes[0]!.activityRole = "provider-event" as never;
  assertEquals(isThreadWorkbenchSnapshot(milestone), false);
});

Deno.test("the Workbench accepts only a non-empty explicit correction component anchor", () => {
  const anchored = structuredClone(GENERIC_THREAD_FIXTURE);
  anchored.graph.nodes[0]!.affectedComponentId = "generic-v3:drip-tray";
  assertEquals(isThreadWorkbenchSnapshot(anchored), true);

  anchored.graph.nodes[0]!.affectedComponentId = "";
  assertEquals(isThreadWorkbenchSnapshot(anchored), false);

  anchored.graph.nodes[0]!.affectedComponentId = 42 as never;
  assertEquals(isThreadWorkbenchSnapshot(anchored), false);
});

Deno.test("the Workbench contract accepts only an exact immutable predecessor reference", () => {
  const withPrevious = structuredClone(GENERIC_THREAD_FIXTURE);
  withPrevious.previous = {
    snapshotId: "thread-generic-r6",
    revision: 6,
  };
  assertEquals(isThreadWorkbenchSnapshot(withPrevious), true);

  withPrevious.previous = {
    snapshotId: "thread-generic-r6",
    revision: 6,
    source: "invented",
  } as never;
  assertEquals(isThreadWorkbenchSnapshot(withPrevious), false);
});

Deno.test("the Workbench accepts only exact verification cases and known node memberships", () => {
  const observed = structuredClone(GENERIC_THREAD_FIXTURE);
  const caseDigest = "a".repeat(64);
  const captureDigest = "c".repeat(64);
  const authorityArtifactId = `fea-proof-${captureDigest}`;
  observed.artifacts.push({
    id: authorityArtifactId,
    label: "Sealed proof case",
    kind: "document",
    system: "digital-thread",
    revision: caseDigest,
    freshness: "fresh",
    fingerprint: `sha256:${captureDigest}`,
    uri: `casys://fea-proof-case-capture/sha256/${captureDigest}`,
    producedBy: "verify.seal-proof-case@1",
    producerRunId: "run.proof.seal",
    dependsOn: [],
  } as ThreadArtifact);
  observed.graph.nodes.push({
    id: `artifact:${authorityArtifactId}`,
    ref: { kind: "artifact", id: authorityArtifactId },
    entityKind: "artifact",
    artifactKind: "document",
    label: "Sealed proof case",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Sealed proof case",
    engineeringCaseRefs: ["mechanical-proof:case-a"],
  } as ThreadGraphNode);
  observed.engineeringCases = {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "observed" },
      { family: "printability-check", status: "observed" },
      { family: "print-estimate", status: "observed" },
      { family: "dfm-check", status: "observed" },
    ],
    cases: [{
      key: "mechanical-proof:case-a",
      family: "mechanical-proof",
      caseSchemaVersion: "mechanical-proof-case/1.0",
      id: "case-a",
      revision: 2,
      scope: "Recorded structural proof case",
      caseDigest,
      authorityArtifactIds: [authorityArtifactId],
    }],
    issues: [],
  };
  assertEquals(isThreadWorkbenchSnapshot(observed), true);

  const unknownMembership = structuredClone(observed);
  unknownMembership.graph.nodes[0]!.engineeringCaseRefs = ["missing-case"];
  assertEquals(isThreadWorkbenchSnapshot(unknownMembership), false);

  const malformedDigest = structuredClone(observed);
  malformedDigest.engineeringCases!.cases[0]!.caseDigest = "sha256:wrong";
  assertEquals(isThreadWorkbenchSnapshot(malformedDigest), false);

  const mismatchedSchema = structuredClone(observed);
  mismatchedSchema.engineeringCases!.cases[0]!.caseSchemaVersion =
    "sensitivity-study-case/2.0" as never;
  assertEquals(isThreadWorkbenchSnapshot(mismatchedSchema), false);

  const wrongAuthority = structuredClone(observed);
  wrongAuthority.engineeringCases!.cases[0]!.authorityArtifactIds = [
    "ART-FEA-018",
  ];
  assertEquals(isThreadWorkbenchSnapshot(wrongAuthority), false);

  const missingProducerRun = structuredClone(observed);
  delete missingProducerRun.artifacts.find((artifact) =>
    artifact.id === authorityArtifactId
  )!.producerRunId;
  assertEquals(isThreadWorkbenchSnapshot(missingProducerRun), false);

  const foreignServer = structuredClone(observed);
  foreignServer.artifacts.find((artifact) => artifact.id === authorityArtifactId)!
    .system = "foreign-server";
  assertEquals(isThreadWorkbenchSnapshot(foreignServer), false);

  const unavailableFamily = structuredClone(observed);
  unavailableFamily.engineeringCases!.coverage[0]!.status = "unavailable";
  unavailableFamily.engineeringCases!.status = "unresolved";
  assertEquals(isThreadWorkbenchSnapshot(unavailableFamily), false);
});

Deno.test("evidence Workbench recrosses projected activity membership with domain identity", () => {
  const valid = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  assertEquals(isEngineeringWorkbenchSnapshot(valid), true);

  const first = valid.projectPath.activities[0]!;
  const second = valid.projectPath.activities[1]!;
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...valid,
      projectPath: {
        ...valid.projectPath,
        activities: valid.projectPath.activities.map((activity, index) =>
          index === 0 ? { ...activity, id: "forged-activity" } : activity
        ),
      },
    }),
    false,
  );
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...valid,
      projectPath: {
        ...valid.projectPath,
        activities: valid.projectPath.activities.map((activity, index) =>
          index === 0
            ? {
              ...first,
              rootRevisionId: second.rootRevisionId,
              revisionIds: second.revisionIds,
            }
            : index === 1
            ? {
              ...second,
              rootRevisionId: first.rootRevisionId,
              revisionIds: first.revisionIds,
            }
            : activity
        ),
      },
    }),
    false,
  );
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...valid,
      projectPath: {
        ...valid.projectPath,
        activities: [
          ...valid.projectPath.activities,
          {
            id: "activity:invented",
            lane: "physics",
            rootRevisionId: "work-define",
            revisionIds: ["work-define"],
          },
        ],
      },
    }),
    false,
  );

  const linked = {
    ...valid,
    project: {
      ...valid.project,
      workItems: valid.project.workItems.map((item) =>
        item.id === "work-simulate"
          ? {
            ...item,
            activityId: "activity:work-design",
            predecessorRevisionId: "work-design",
          }
          : item
      ),
    },
    projectPath: {
      ...valid.projectPath,
      activities: valid.projectPath.activities.flatMap((activity) => {
        if (activity.id === "activity:work-simulate") return [];
        if (activity.id !== "activity:work-design") return [activity];
        return [{
          ...activity,
          revisionIds: ["work-design", "work-simulate"],
        }];
      }),
    },
  };
  assertEquals(isEngineeringWorkbenchSnapshot(linked), true);
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...linked,
      projectPath: {
        ...linked.projectPath,
        activities: linked.projectPath.activities.map((activity) =>
          activity.id === "activity:work-design"
            ? {
              ...activity,
              rootRevisionId: "work-simulate",
              revisionIds: ["work-simulate", "work-design"],
            }
            : activity
        ),
      },
    }),
    false,
  );
});

Deno.test("evidence Workbench recrosses a case join to every authority producer run", () => {
  const workbench = joinedCaseWorkbench();
  assertEquals(isEngineeringWorkbenchSnapshot(workbench), true);

  const missingId = workbench.thread.engineeringCases!.cases[0]!
    .authorityArtifactIds[1]!;
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...workbench,
      thread: {
        ...workbench.thread,
        artifacts: workbench.thread.artifacts.filter((artifact) =>
          artifact.id !== missingId
        ),
        graph: {
          ...workbench.thread.graph,
          nodes: workbench.thread.graph.nodes.filter((node) =>
            node.ref.id !== missingId
          ),
        },
      },
    }),
    false,
  );

  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...workbench,
      thread: {
        ...workbench.thread,
        artifacts: workbench.thread.artifacts.map((artifact) =>
          artifact.id === missingId
            ? { ...artifact, producerRunId: "run:fea-other" }
            : artifact
        ),
      },
    }),
    false,
  );
});

function joinedCaseWorkbench(): EngineeringEvidenceWorkbenchSnapshot {
  const caseDigest = "a".repeat(64);
  const firstCapture = "c".repeat(64);
  const secondCapture = "d".repeat(64);
  const firstId = `fea-proof-${firstCapture}`;
  const secondId = `fea-proof-${secondCapture}`;
  const caseKey = `mechanical-proof:${caseDigest}`;
  const runId = "agent-run-mechanical-fixture";
  const workbench = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  return {
    ...workbench,
    thread: {
      ...workbench.thread,
      artifacts: [
        ...workbench.thread.artifacts,
        proofArtifact(firstId, firstCapture, caseDigest, runId),
        proofArtifact(secondId, secondCapture, caseDigest, runId),
      ],
      graph: {
        ...workbench.thread.graph,
        nodes: [
          ...workbench.thread.graph.nodes,
          proofNode(firstId, caseKey),
          proofNode(secondId, caseKey),
        ],
      },
      engineeringCases: {
        schemaVersion: "engineering-cases/1.0",
        status: "observed",
        coverage: [
          { family: "mechanical-proof", status: "observed" },
          { family: "sensitivity-study", status: "observed" },
          { family: "printability-check", status: "observed" },
          { family: "print-estimate", status: "observed" },
          { family: "dfm-check", status: "observed" },
        ],
        cases: [{
          key: caseKey,
          family: "mechanical-proof",
          caseSchemaVersion: "mechanical-proof-case/1.0",
          id: "arm-cantilever",
          revision: 2,
          scope: "Recorded structural proof case",
          caseDigest,
          authorityArtifactIds: [firstId, secondId],
        }],
        issues: [],
      },
    },
    caseActivityJoins: [{
      caseKey,
      caseId: "arm-cantilever",
      caseRevision: 2,
      activityId: "activity:work-simulate",
      workItemId: "work-simulate",
      runId,
    }],
  };
}

function proofArtifact(
  id: string,
  captureDigest: string,
  caseDigest: string,
  producerRunId: string,
): ThreadArtifact {
  return {
    id,
    label: "Sealed proof case",
    kind: "document",
    system: "digital-thread",
    revision: caseDigest,
    freshness: "fresh",
    fingerprint: `sha256:${captureDigest}`,
    uri: `casys://fea-proof-case-capture/sha256/${captureDigest}`,
    producedBy: "verify.seal-proof-case@1",
    producerRunId,
    dependsOn: [],
  };
}

function proofNode(id: string, caseKey: string): ThreadGraphNode {
  return {
    id: `artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    artifactKind: "document",
    label: "Sealed proof case",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Sealed proof case",
    engineeringCaseRefs: [caseKey],
  };
}

Deno.test("thread-workbench/0.2 keeps the case extension additive and fail-closed", () => {
  const legacy = structuredClone(GENERIC_THREAD_FIXTURE) as
    & typeof GENERIC_THREAD_FIXTURE
    & { engineeringCases?: unknown };
  delete legacy.engineeringCases;
  assertEquals(isThreadWorkbenchSnapshot(legacy), true);

  legacy.graph.nodes[0]!.engineeringCaseRefs = ["hidden-case"];
  assertEquals(isThreadWorkbenchSnapshot(legacy), false);
});

Deno.test("the Workbench contract requires evidence-backed component facets", () => {
  const missingComponents = JSON.parse(
    JSON.stringify(GENERIC_THREAD_FIXTURE),
  ) as Partial<typeof GENERIC_THREAD_FIXTURE>;
  delete missingComponents.components;
  assertEquals(isThreadWorkbenchSnapshot(missingComponents), false);

  const fuzzyBinding = JSON.parse(
    JSON.stringify(GENERIC_THREAD_FIXTURE),
  ) as typeof GENERIC_THREAD_FIXTURE;
  fuzzyBinding.components.components[0].bindings[0].status = "fuzzy" as never;
  assertEquals(isThreadWorkbenchSnapshot(fuzzyBinding), false);

  const partDefinition = structuredClone(GENERIC_THREAD_FIXTURE);
  partDefinition.components.components[0].bindings[0].kind = "part-definition";
  assertEquals(isThreadWorkbenchSnapshot(partDefinition), true);

  partDefinition.components.components[0].bindings[0].kind = "invented" as never;
  assertEquals(isThreadWorkbenchSnapshot(partDefinition), false);

  const withAttributes = structuredClone(GENERIC_THREAD_FIXTURE);
  withAttributes.components.components[0].attributes = [{
    id: "attr-thickness",
    kind: "AttributeUsage",
    label: "thickness",
  }];
  assertEquals(isThreadWorkbenchSnapshot(withAttributes), true);
  withAttributes.components.components[0].attributes = [{
    id: "attr-thickness",
    kind: "PartUsage",
    label: "thickness",
  }] as never;
  assertEquals(isThreadWorkbenchSnapshot(withAttributes), false);
});

Deno.test("HTTP Workbench client performs one uncached read-only JSON GET", async () => {
  const requests: Array<{
    input: string;
    method?: string;
    cache?: RequestCache;
  }> = [];
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        cache: init?.cache,
      });
      return Promise.resolve(
        Response.json(GENERIC_ENGINEERING_WORKBENCH_FIXTURE),
      );
    },
  );

  const snapshot = await client.load();

  assertEquals(snapshot.surface, "evidence");
  if (snapshot.surface !== "evidence") {
    throw new Error("Expected the HTTP fixture to contain technical evidence.");
  }
  assertEquals(snapshot.thread.id, GENERIC_THREAD_FIXTURE.id);
  assertEquals(
    snapshot.project.project.subjectId,
    GENERIC_THREAD_FIXTURE.subject.id,
  );
  assertEquals(requests, [
    { input: "/api/thread/workbench", method: "GET", cache: "no-store" },
  ]);
});

Deno.test("HTTP Workbench client rejects an unsupported contract", async () => {
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json({ schemaVersion: "unknown" })),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("HTTP Workbench client rejects malformed planning provenance", async () => {
  const malformed = structuredClone(
    GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  ) as unknown as Record<string, unknown>;
  malformed.surface = "planning";
  delete malformed.thread;
  delete malformed.alignment;
  (malformed.project as { threadSnapshots: unknown[] }).threadSnapshots = [];
  (malformed.project as Record<string, unknown>).plan = {
    startingPoint: "idea-or-spec",
    basis: null,
    publishedAt: "2026-08-02T12:00:00.000Z",
    publishedBy: { id: "agent:planner", origin: "agent" },
  };
  malformed.planning = {
    technicalBaseline: {
      status: "not-created",
      message: "Technical baseline not created yet.",
    },
    activity: { version: 0, milestones: [] },
  };
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json(malformed)),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("HTTP Workbench client rejects a naked thread projection", async () => {
  const client = new HttpThreadWorkbenchClient(
    "/api/thread/workbench",
    () => Promise.resolve(Response.json(GENERIC_THREAD_FIXTURE)),
  );

  await assertRejects(() => client.load(), Error, "unsupported contract");
});

Deno.test("native Workbench has no nested document or direct MCP tool call", async () => {
  const preview = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertEquals(preview.includes("<iframe"), false);
  assertEquals(workbench.includes("callTool("), false);
  assertEquals(workbench.includes("@modelcontextprotocol"), false);
  assertEquals(workbench.includes("executeProjectCommand"), false);
  assertEquals(workbench.includes("agent-run.queue"), false);
});

function evidenceWorkbenchWithDeclaredFamily() {
  const workbench = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const supersession = workbench.thread.graph.edges.find((edge) =>
    edge.relation === "supersedes"
  );
  if (
    !supersession || supersession.origin !== "provenance" ||
    supersession.from.kind !== "artifact" ||
    supersession.to.kind !== "artifact"
  ) {
    throw new Error("Expected one exact artifact supersession fixture.");
  }
  const historicalNode = workbench.thread.graph.nodes.find((node) =>
    node.ref.kind === supersession.from.kind &&
    node.ref.id === supersession.from.id
  );
  const currentNode = workbench.thread.graph.nodes.find((node) =>
    node.ref.kind === supersession.to.kind && node.ref.id === supersession.to.id
  );
  if (
    !historicalNode || !currentNode ||
    typeof historicalNode.artifactKind !== "string" ||
    historicalNode.artifactKind !== currentNode.artifactKind
  ) {
    throw new Error("Expected compatible superseded artifact-node fixtures.");
  }
  const edgeRef = {
    id: supersession.id,
    relation: supersession.relation,
    origin: supersession.origin,
  };
  workbench.thread.evidenceFamilyGraph.families = [{
    id: "fixture-driptray-fea-family",
    entityKind: "artifact",
    artifactKind: historicalNode.artifactKind,
    historicalRefs: [{ ...supersession.from }],
    currentRefs: [{ ...supersession.to }],
    revisionCount: 1,
    status: "current",
    relationship: {
      relation: "supersedes",
      classification: "not-recorded",
      equivalence: "not-recorded",
    },
    transitions: [{
      edgeRef: { ...edgeRef },
      historical: { ...supersession.from },
      successor: { ...supersession.to },
    }],
  }];
  workbench.thread.evidenceFamilyGraph.edges = [];
  workbench.thread.evidenceFamilyGraph.omittedSelfLoops = [{
    familyId: "fixture-driptray-fea-family",
    memberEdgeRefs: [{ ...edgeRef }],
  }];
  workbench.thread.evidenceFamilyGraph.omittedCycleEdges = [];
  return workbench;
}

function assemblyIntegrityThreadFixture(): ThreadWorkbenchSnapshot {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const c = "c".repeat(64);
  const d = "d".repeat(64);
  const e = "e".repeat(64);
  const geometry = assemblyProjectionRef(
    "geometry-" + a,
    a,
    "run-geometry",
    [],
  );
  const step = assemblyProjectionRef(
    "cad-asset-" + a + "-module-step-" + b,
    b,
    "run-geometry",
    [],
  );
  const observation = assemblyProjectionRef(
    "assembly-integrity-observation-" + c,
    c,
    "run-l3",
    [geometry.id, step.id],
  );
  const evaluation = assemblyProjectionRef(
    "assembly-integrity-evaluation-" + d,
    d,
    "run-l4",
    [geometry.id, step.id, observation.id],
  );
  const closeout = assemblyProjectionRef(
    "assembly-integrity-evaluation-closeout-" + e,
    e,
    "run-l5",
    [evaluation.id],
  );
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.previous = { snapshotId: "assembly-basis", revision: 4 };
  snapshot.artifacts = [
    ...snapshot.artifacts,
    assemblyProjectionArtifact(geometry, "cad-model", "design.write-geometry@1"),
    assemblyProjectionArtifact(step, "step", "design.write-geometry@1"),
    assemblyProjectionArtifact(
      observation,
      "evidence",
      "verify.observe-assembly-integrity@1",
    ),
    assemblyProjectionArtifact(
      evaluation,
      "evidence",
      "verify.evaluate-assembly-integrity@1",
    ),
    assemblyProjectionArtifact(
      closeout,
      "document",
      "decide.accept-assembly-integrity-evaluation@1",
    ),
  ];
  snapshot.assemblyIntegrity = {
    schemaVersion: "thread-assembly-integrity/1.0",
    family: "assembly-integrity",
    status: "current",
    chains: [{
      id: closeout.id,
      status: "current",
      observation: {
        record: observation,
        basis: {
          snapshotId: "assembly-basis",
          revision: 2,
          subjectId: snapshot.subject.id,
        },
        inputBundle: { fingerprint: "sha256:" + a, byteCount: 1 },
        evidence: { geometryModule: geometry, assemblyStep: step },
        facts: {
          importability: { status: "observed", value: "imported" },
          importFacts: {
            unitSystem: { status: "observed", value: "mm" },
            solidCount: { status: "observed", value: 1 },
          },
          topology: {
            brepValidity: { status: "observed", value: "valid" },
            degenerateEdgeCount: { status: "observed", value: 0 },
            freeEdgeCount: { status: "observed", value: 0 },
            shellCount: { status: "observed", value: 1 },
          },
          occurrences: [],
          pairs: [],
        },
        limitations: {
          verdict: "none",
          fitness: "none",
          safety: "none",
          motion: "none",
          strength: "none",
        },
      },
      evaluation: {
        record: evaluation,
        basis: {
          snapshotId: "assembly-basis",
          revision: 3,
          subjectId: snapshot.subject.id,
        },
        evidence: {
          geometryModule: geometry,
          assemblyStep: step,
          observation,
        },
        method: {
          id: "assembly-integrity-evaluation",
          version: "1.0",
          fingerprint: "sha256:" + a,
        },
        criteria: [
          { id: "assembly-import", verdict: "pass" },
          { id: "occurrence-coverage", verdict: "pass" },
          { id: "placement-recross", verdict: "pass" },
          { id: "brep-validity", verdict: "pass" },
          { id: "pairwise-intersection", verdict: "pass" },
        ],
        aggregateVerdict: "pass",
        limitations: {
          providerCalls: "none",
          genericSysmlRequirementEvaluation: "none",
          safety: "not-evaluated",
          physicalJoints: "not-evaluated",
          clearance: "not-evaluated",
          motion: "not-evaluated",
          load: "not-evaluated",
          fabricability: "not-evaluated",
        },
      },
      closeout: {
        record: closeout,
        basis: {
          snapshotId: "assembly-basis",
          revision: 4,
          fingerprint: "sha256:" + b,
        },
        humanDisposition: "accept",
        rejectionDisposition: "none",
        approvedBriefBasis: {
          projectId: "project-generic",
          projectSnapshotId: "project-generic-r2",
          projectRevision: 2,
          briefId: "brief-generic",
          briefSnapshotId: "brief-generic-r2",
          briefRevision: 2,
          fingerprint: "sha256:" + c,
        },
        verificationAuthority: { id: "assembly-integrity", version: "1.0" },
        gateClaims: [{
          gateItemId: "assembly-gate",
          role: "satisfies",
          status: "current",
        }],
        evidence: {
          evaluation,
          geometryModule: geometry,
          assemblyStep: step,
          observation,
        },
        l4Limitations: {
          providerCalls: "none",
          genericSysmlRequirementEvaluation: "none",
          safety: "not-evaluated",
          physicalJoints: "not-evaluated",
          clearance: "not-evaluated",
          motion: "not-evaluated",
          load: "not-evaluated",
          fabricability: "not-evaluated",
        },
        limitations: {
          providerCalls: "none",
          genericSysmlRequirementEvaluation: "none",
          certification: "not-issued",
          l4PassIsNotL5: true,
        },
      },
    }],
  };
  return snapshot;
}

function assemblyProjectionRef(
  id: string,
  digest: string,
  producerRunId: string,
  dependsOn: string[],
) {
  return {
    id,
    uri: "casys://fixture/sha256/" + digest,
    fingerprint: "sha256:" + digest,
    producerRunId,
    dependsOn,
    freshness: "fresh" as const,
  };
}

function assemblyProjectionArtifact(
  reference: ReturnType<typeof assemblyProjectionRef>,
  kind: string,
  producedBy: string,
): ThreadArtifact {
  return {
    ...reference,
    label: reference.id,
    kind,
    system: "assembly-fixture",
    revision: reference.fingerprint,
    producedBy,
  };
}
