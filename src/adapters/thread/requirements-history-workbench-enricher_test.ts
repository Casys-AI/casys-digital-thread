import { assertEquals } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { productStructureElementRef } from "../../domain/architecture/product-structure-ref.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { OpenedProductStructure } from "../../application/ports/out/product-navigation/product-structure-traversal.ts";
import {
  type ProductNavigationBasis,
  productNavigationElementNode,
} from "../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import { ProjectProductNavigation } from "../../application/use-cases/product-navigation/project-product-navigation.ts";
import {
  buildRequirementsHistoryUnjoinedFixture,
  HISTORY_CONSTRAINT,
  HISTORY_METRIC,
  HISTORY_SUBJECT,
  HISTORY_TARGET,
  HISTORY_USAGE,
  NEW_ARCH_DIGEST,
  type RequirementsHistoryFault,
  SENSITIVITY_BASE_VALUE,
  SENSITIVITY_RESPONSE_BASE,
  SENSITIVITY_RESPONSE_STEPPED,
  SENSITIVITY_STEP,
  SOLVER_DIGEST,
} from "../../testing/workbench/requirements-history-unjoined-fixture.ts";
import { projectThreadWorkbenchSnapshot } from "./thread-workbench-projector.ts";
import { enrichThreadWorkbenchWithRequirementsHistory } from "./requirements-history-workbench-enricher.ts";
import { WorkbenchProductNavigationEvidenceAttachmentReader } from "./product-navigation-workbench.ts";
import type { ThreadRequirement } from "../../presentation/workbench/thread/snapshot.ts";

const PROJECT = "project:id01";

Deno.test(
  "recaptured requirement stays unresolved and exposes exact archived pass context",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture();
    const before = deterministicJson(fixture.thread);
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const current = projected.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(current?.status, "unresolved");
    assertEquals(current?.observationIds, []);
    const edgeCount = projected.graph.edges.length;
    const graphBefore = deterministicJson(projected.graph);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.status, "unresolved");
    assertEquals(requirement?.observationIds, []);
    assertEquals(stripHistory(requirement), current);
    assertEquals(enriched.graph.edges.length, edgeCount);
    assertEquals(deterministicJson(enriched.graph), graphBefore);
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "evaluates"),
      [],
    );
    assertEquals(requirement?.historicalEvaluations, [
      expectedMechanicalHistory(fixture, requirement!.id),
    ]);
    assertEquals(requirement?.historicalChain, { status: "complete", hops: 1 });
    assertEquals(
      requirement?.historicalEvaluations?.[0]?.currentArchitecture.artifactId !==
        requirement?.historicalEvaluations?.[0]?.predecessorArchitecture
          .artifactId,
      true,
    );
    assertEquals(deterministicJson(fixture.thread), before);
  },
);

Deno.test(
  "current PASS keeps live observations and still exposes predecessor history",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      currentVerdict: "pass",
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const current = projected.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(current?.status, "pass");
    assertEquals(current?.observationIds.length, 1);
    const graphBefore = deterministicJson(projected.graph);
    const evaluatesBefore = projected.graph.edges.filter((edge) =>
      edge.relation === "evaluates"
    );
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.status, "pass");
    assertEquals(requirement?.observationIds, current?.observationIds);
    assertEquals(requirement?.violationIds, current?.violationIds);
    assertEquals(stripHistory(requirement), current);
    assertEquals(deterministicJson(enriched.graph), graphBefore);
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "evaluates"),
      evaluatesBefore,
    );
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => item.evaluationId),
      [fixture.evaluationId],
    );
    assertEquals(requirement?.historicalEvaluations?.[0]?.status, "pass");
  },
);

Deno.test(
  "current FAIL keeps its own truth and still exposes predecessor history",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      currentVerdict: "fail",
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const current = projected.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(current?.status, "fail");
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.status, "fail");
    assertEquals(stripHistory(requirement), current);
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => item.status),
      ["pass"],
    );
  },
);

Deno.test(
  "two recapture hops expose each chained historical evaluation deterministically",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({ hops: 2 });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.historicalChain, { status: "complete", hops: 2 });
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => [
        item.hopIndex,
        item.predecessorRequirementId,
        item.evaluationId,
      ]),
      [
        [1, fixture.predecessorRequirementId, fixture.evaluationId],
        [
          2,
          fixture.thread.requirements.find((item) =>
            item.id !== fixture.currentRequirementId &&
            item.id !== fixture.predecessorRequirementId
          )!.id,
          "eval-von-mises-historical",
        ],
      ],
    );
    assertEquals(
      new Set(
        requirement?.historicalEvaluations?.map((item) =>
          item.predecessorArchitecture.artifactId
        ),
      ).size,
      2,
    );
    assertEquals(
      requirement?.historicalEvaluations?.every((item) =>
        item.currentRequirementId === fixture.currentRequirementId &&
        item.currentArchitecture.artifactId === fixture.currentArchitectureId
      ),
      true,
    );
  },
);

Deno.test(
  "multiple distinct predecessor evaluations remain separately visible",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      extraPredecessorEvaluation: true,
      extraPredecessorFail: true,
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => [
        item.evaluationId,
        item.status,
      ]),
      [
        [fixture.failEvaluationId, "fail"],
        [fixture.evaluationId, "pass"],
        [fixture.extraEvaluationId, "pass"],
      ],
    );
    assertEquals(requirement?.status, "unresolved");
  },
);

Deno.test(
  "a later missing hop keeps verified history as partial",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      hops: 2,
      fault: "second-hop-missing-cas",
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.historicalChain, {
      status: "partial",
      hops: 1,
      reason: "missing-cas",
      stoppedAtRequirementId: fixture.predecessorRequirementId,
    });
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => item.evaluationId),
      [fixture.evaluationId],
    );
  },
);

Deno.test(
  "FEA v3 two-source observation keeps current PASS and both predecessor evaluations",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      currentVerdict: "pass",
      sensitivity: "measured",
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const current = projected.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(current?.status, "pass");
    assertEquals(fixture.observationSourceIds.length, 2);
    const graphBefore = deterministicJson(projected.graph);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.status, "pass");
    assertEquals(requirement?.observationIds, current?.observationIds);
    assertEquals(stripHistory(requirement), current);
    assertEquals(deterministicJson(enriched.graph), graphBefore);
    const mechanical = requirement?.historicalEvaluations?.find((item) =>
      item.evaluationId === fixture.evaluationId
    );
    const studyBase = requirement?.historicalEvaluations?.find((item) =>
      item.evaluationId === fixture.studyBaseEvaluationId
    );
    assertEquals(
      mechanical?.observations[0]?.sourceArtifacts.map((item) => item.id),
      fixture.observationSourceIds,
    );
    assertEquals(mechanical?.status, "pass");
    assertEquals(studyBase?.evaluationFamily, "study-base");
    assertEquals(studyBase?.sensitivity?.status, "measured");
  },
);

Deno.test(
  "duplicate or missing observation sources refuse the hop without fabricating evaluations",
  async () => {
    for (
      const fault of [
        "duplicate-observation-source",
        "missing-observation-source",
      ] as const
    ) {
      const fixture = await buildRequirementsHistoryUnjoinedFixture({
        currentVerdict: "pass",
        fault,
      });
      const projected = projectThreadWorkbenchSnapshot(fixture.thread);
      const current = projected.requirements.find((item) =>
        item.id === fixture.currentRequirementId
      );
      assertEquals(current?.status, "pass", fault);
      const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
        projected,
        fixture.captures,
        fixture.thread,
      );
      const requirement = enriched.requirements.find((item) =>
        item.id === fixture.currentRequirementId
      );
      assertEquals(requirement?.status, "pass", fault);
      assertEquals(stripHistory(requirement), current, fault);
      assertEquals(requirement?.historicalEvaluations, [], fault);
      assertEquals(requirement?.historicalChain, {
        status: "partial",
        hops: 0,
        reason: "conflicting-provenance",
        stoppedAtRequirementId: fixture.currentRequirementId,
      }, fault);
    }
  },
);

Deno.test(
  "requirements history enricher fails closed for ambiguous, drifted, missing, or disconnected lineage",
  async () => {
    const hopFaults: RequirementsHistoryFault[] = [
      "ambiguous-supersedes",
      "cyclic-supersedes",
      "missing-predecessor",
      "native-target-drift",
      "constraint-drift",
      "criterion-drift",
      "duplicate-evaluation-id",
    ];
    for (const fault of hopFaults) {
      const fixture = await buildRequirementsHistoryUnjoinedFixture(fault);
      const projected = projectThreadWorkbenchSnapshot(fixture.thread);
      const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
        projected,
        fixture.captures,
        fixture.thread,
      );
      const requirement = enriched.requirements.find((item) =>
        item.id === fixture.currentRequirementId
      );
      assertEquals(requirement?.historicalEvaluations, [], fault);
      assertEquals(requirement?.historicalChain?.status, "partial", fault);
      assertEquals(requirement?.historicalChain?.hops, 0, fault);
      assertEquals(
        requirement?.historicalChain?.stoppedAtRequirementId,
        fixture.currentRequirementId,
        fault,
      );
      assertEquals(requirement?.status, "unresolved", fault);
    }
  },
);

Deno.test(
  "an unreadable current recapture stays absent rather than emitting empty history",
  async () => {
    for (
      const fault of [
        "missing-cas",
        "corrupt-cas",
        "disconnected-architecture",
      ] as const
    ) {
      const fixture = await buildRequirementsHistoryUnjoinedFixture(fault);
      const projected = projectThreadWorkbenchSnapshot(fixture.thread);
      const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
        projected,
        fixture.captures,
        fixture.thread,
      );
      const requirement = enriched.requirements.find((item) =>
        item.id === fixture.currentRequirementId
      );
      assertEquals(requirement?.historicalEvaluations, undefined, fault);
      assertEquals(requirement?.historicalChain, undefined, fault);
      assertEquals(requirement?.status, "unresolved", fault);
    }
  },
);

Deno.test(
  "requirements history enricher refuses a foreign Thread subject without promoting the current verdict",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture();
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const foreign = {
      ...fixture.thread,
      subject: { ...fixture.thread.subject, id: "subject:foreign" },
    };
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      foreign,
    );
    assertEquals(
      enriched.requirements.find((item) => item.id === fixture.currentRequirementId)
        ?.historicalEvaluations,
      undefined,
    );
    assertEquals(
      enriched.requirements.find((item) => item.id === fixture.currentRequirementId)
        ?.status,
      "unresolved",
    );
  },
);

Deno.test(
  "product inspect publishes historical-unjoined metadata without a current pass",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture();
    const reader = new WorkbenchProductNavigationEvidenceAttachmentReader({
      requirementsCaptures: fixture.captures,
    });
    const facts = await reader.read(fixture.thread, {
      projectId: PROJECT,
      architectureArtifactId: fixture.currentArchitectureId,
      architectureFingerprint: `sha256:${NEW_ARCH_DIGEST}`,
    });
    const historical = (
      await enrichThreadWorkbenchWithRequirementsHistory(
        projectThreadWorkbenchSnapshot(fixture.thread),
        fixture.captures,
        fixture.thread,
      )
    ).requirements.find((item) => item.id === fixture.currentRequirementId)
      ?.historicalEvaluations;
    assertEquals(historical?.[0]?.relation, "historical-unjoined");
    assertEquals(facts?.requirementHistoricalEvaluations, [{
      requirementId: fixture.currentRequirementId,
      historicalEvaluations: historical!,
      historicalChain: { status: "complete", hops: 1 },
    }]);
    const result = await navigation(fixture, reader).inspect({
      projectId: PROJECT,
      expectedBasis: basis(fixture),
      selection: {
        kind: "element",
        element: productStructureElementRef("PartDefinition", HISTORY_TARGET),
      },
    });
    assertEquals(result.status, "observed");
    assertEquals(result.definitionScopedEvidence?.attachments.requirements, [{
      group: "requirements",
      kind: "requirement",
      id: fixture.currentRequirementId,
      label: "Maximum von Mises",
      historicalEvaluations: facts?.requirementHistoricalEvaluations?.[0]
        ?.historicalEvaluations,
      historicalChain: { status: "complete", hops: 1 },
    }]);
    assertEquals(
      result.definitionScopedEvidence?.attachments.requirements[0]
        ?.historicalEvaluations?.[0]?.status,
      "pass",
    );
    assertEquals(
      result.definitionScopedEvidence?.attachments.requirements[0]
        ?.historicalEvaluations?.[0]?.relation,
      "historical-unjoined",
    );
  },
);

Deno.test(
  "measured historical sensitivity attaches only to the original study-base evaluation",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      currentVerdict: "pass",
      sensitivity: "measured",
      extraPredecessorFail: true,
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const current = projected.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    const graphBefore = deterministicJson(projected.graph);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(requirement?.status, "pass");
    assertEquals(stripHistory(requirement), current);
    assertEquals(deterministicJson(enriched.graph), graphBefore);
    const mechanical = requirement?.historicalEvaluations?.find((item) =>
      item.evaluationId === fixture.evaluationId
    );
    const failed = requirement?.historicalEvaluations?.find((item) =>
      item.evaluationId === fixture.failEvaluationId
    );
    const studyBase = requirement?.historicalEvaluations?.find((item) =>
      item.evaluationId === fixture.studyBaseEvaluationId
    );
    assertEquals(mechanical?.status, "pass");
    assertEquals(mechanical?.sensitivity, undefined);
    assertEquals(failed?.status, "fail");
    assertEquals(failed?.sensitivity, undefined);
    assertEquals(studyBase?.evaluationFamily, "study-base");
    assertEquals(studyBase?.sensitivity?.status, "measured");
    if (studyBase?.sensitivity?.status !== "measured") {
      throw new Error("expected measured historical sensitivity");
    }
    assertEquals(studyBase.sensitivity.method, "forward-finite-difference");
    assertEquals(studyBase.sensitivity.measurement.basePoint, SENSITIVITY_BASE_VALUE);
    assertEquals(
      studyBase.sensitivity.measurement.perturbationStep,
      SENSITIVITY_STEP,
    );
    assertEquals(
      studyBase.sensitivity.measurement.responseAtBase,
      SENSITIVITY_RESPONSE_BASE,
    );
    assertEquals(
      studyBase.sensitivity.measurement.responseAtPerturbed,
      SENSITIVITY_RESPONSE_STEPPED,
    );
    assertEquals(studyBase.sensitivity.measurement.derivative, {
      value: 100,
      unit: "Pa/mm",
    });
    assertEquals(studyBase.sensitivity.study.id, fixture.studyArtifactId);
    assertEquals(studyBase.sensitivity.studyCase.id, fixture.studyCaseArtifactId);
    assertEquals(studyBase.sensitivity.studyCase.digest, fixture.caseDigest);
    assertEquals(
      studyBase.sensitivity.baseEvaluation.id,
      fixture.baseEvaluationArtifactId,
    );
    assertEquals(
      studyBase.sensitivity.originalRequirementId,
      fixture.predecessorRequirementId,
    );
    assertEquals(studyBase.sensitivity.originalEvaluationId, studyBase.evaluationId);
    assertEquals(
      studyBase.sensitivity.predecessorArchitecture.artifactId,
      fixture.predecessorArchitectureId,
    );
    assertEquals(
      studyBase.currentArchitecture.artifactId !==
        studyBase.predecessorArchitecture.artifactId,
      true,
    );
  },
);

Deno.test(
  "an old measured study remains visible when a newer unexecuted case exists",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      sensitivity: "measured",
      newerSensitivityCase: true,
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const studyBase = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    )?.historicalEvaluations?.find((item) => item.evaluationFamily === "study-base");
    assertEquals(studyBase?.sensitivity?.status, "measured");
  },
);

Deno.test(
  "missing or wrong sensitivity evidence leaves the historical evaluation visible without a relation",
  async () => {
    for (
      const sensitivity of [
        "missing-capture",
        "wrong-digest",
        "wrong-unit",
      ] as const
    ) {
      const fixture = await buildRequirementsHistoryUnjoinedFixture({
        sensitivity,
      });
      const projected = projectThreadWorkbenchSnapshot(fixture.thread);
      const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
        projected,
        fixture.captures,
        fixture.thread,
      );
      const requirement = enriched.requirements.find((item) =>
        item.id === fixture.currentRequirementId
      );
      const studyBase = requirement?.historicalEvaluations?.find((item) =>
        item.evaluationId === fixture.studyBaseEvaluationId
      );
      assertEquals(studyBase?.status, "pass", sensitivity);
      assertEquals(studyBase?.evaluationFamily, "study-base", sensitivity);
      assertEquals(studyBase?.sensitivity?.status, "unavailable", sensitivity);
      assertEquals(
        requirement?.historicalEvaluations?.some((item) =>
          item.evaluationId === fixture.evaluationId
        ),
        true,
        sensitivity,
      );
    }
  },
);

Deno.test(
  "an unexecuted sealed case alone does not invent a historical measured relation",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      sensitivity: "unexecuted-case",
    });
    const projected = projectThreadWorkbenchSnapshot(fixture.thread);
    const enriched = await enrichThreadWorkbenchWithRequirementsHistory(
      projected,
      fixture.captures,
      fixture.thread,
    );
    const requirement = enriched.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    );
    assertEquals(
      requirement?.historicalEvaluations?.map((item) => item.evaluationId),
      [fixture.evaluationId],
    );
    assertEquals(
      requirement?.historicalEvaluations?.some((item) =>
        item.sensitivity?.status === "measured"
      ),
      false,
    );
  },
);

Deno.test(
  "MCP inspect publishes the same historical collection including measured sensitivity",
  async () => {
    const fixture = await buildRequirementsHistoryUnjoinedFixture({
      currentVerdict: "pass",
      sensitivity: "measured",
    });
    const reader = new WorkbenchProductNavigationEvidenceAttachmentReader({
      requirementsCaptures: fixture.captures,
    });
    const facts = await reader.read(fixture.thread, {
      projectId: PROJECT,
      architectureArtifactId: fixture.currentArchitectureId,
      architectureFingerprint: `sha256:${NEW_ARCH_DIGEST}`,
    });
    const workbench = await enrichThreadWorkbenchWithRequirementsHistory(
      projectThreadWorkbenchSnapshot(fixture.thread),
      fixture.captures,
      fixture.thread,
    );
    const historical = workbench.requirements.find((item) =>
      item.id === fixture.currentRequirementId
    )?.historicalEvaluations;
    assertEquals(
      facts?.requirementHistoricalEvaluations?.[0]?.historicalEvaluations,
      historical,
    );
    assertEquals(
      historical?.find((item) => item.evaluationFamily === "study-base")
        ?.sensitivity?.status,
      "measured",
    );
  },
);

function expectedMechanicalHistory(
  fixture: Awaited<ReturnType<typeof buildRequirementsHistoryUnjoinedFixture>>,
  currentRequirementId: string,
) {
  return {
    relation: "historical-unjoined" as const,
    hopIndex: 1,
    currentRequirementId,
    predecessorRequirementId: fixture.predecessorRequirementId,
    evaluationId: fixture.evaluationId,
    status: "pass" as const,
    evaluatedAt: "2026-09-11T09:00:00.000Z",
    observations: [{
      id: fixture.observationId,
      sourceArtifacts: fixture.observationSourceIds.map((id) => {
        const artifact = fixture.thread.artifacts.find((item) => item.id === id)!;
        return {
          id,
          fingerprint: `sha256:${artifact.fingerprint.digest}`,
        };
      }),
    }],
    evidence: [{
      id: fixture.evidenceId,
      fingerprint: `sha256:${"c".repeat(64)}`,
    }],
    predecessorCapture: {
      id: fixture.predecessorCaptureId,
      fingerprint: `sha256:${
        fixture.thread.artifacts.find((item) =>
          item.id === fixture.predecessorCaptureId
        )!.fingerprint.digest
      }`,
      producerRunId: "run:requirements-write",
    },
    currentArchitecture: {
      artifactId: fixture.currentArchitectureId,
      fingerprint: `sha256:${NEW_ARCH_DIGEST}`,
      producerRunId: "run:architecture-new",
    },
    predecessorArchitecture: {
      artifactId: fixture.predecessorArchitectureId,
      fingerprint: `sha256:${
        fixture.thread.artifacts.find((item) =>
          item.id === fixture.predecessorArchitectureId
        )!.fingerprint.digest
      }`,
      producerRunId: "run:architecture-old",
    },
    native: {
      targetElementId: HISTORY_TARGET,
      requirementUsageId: HISTORY_USAGE,
      constraintUsageId: HISTORY_CONSTRAINT,
      criterion: {
        metric: HISTORY_METRIC,
        operator: "<=" as const,
        limit: { value: 120_000_000, unit: "Pa" },
      },
    },
  };
}

function stripHistory(
  requirement: ThreadRequirement | undefined,
): Omit<ThreadRequirement, "historicalEvaluations" | "historicalChain"> | undefined {
  if (!requirement) return undefined;
  const { historicalEvaluations: _history, historicalChain: _chain, ...rest } =
    requirement;
  return rest;
}

function navigation(
  fixture: Awaited<ReturnType<typeof buildRequirementsHistoryUnjoinedFixture>>,
  reader: WorkbenchProductNavigationEvidenceAttachmentReader,
) {
  return new ProjectProductNavigation({
    projects: {
      get: (projectId: string) =>
        Promise.resolve(projectId === PROJECT ? project(fixture) : undefined),
    },
    snapshots: {
      get: (snapshotId: string) =>
        Promise.resolve(
          snapshotId === fixture.thread.id ? fixture.thread : undefined,
        ),
    },
    traversal: { open: () => Promise.resolve(opened(fixture)) },
    evidenceAttachments: reader,
  });
}

function project(
  fixture: Awaited<ReturnType<typeof buildRequirementsHistoryUnjoinedFixture>>,
): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "ID01", subjectId: HISTORY_SUBJECT },
    threadSnapshots: [{
      snapshotId: fixture.thread.id,
      revision: fixture.thread.revision,
      subjectId: HISTORY_SUBJECT,
    }],
  } as unknown as EngineeringProjectSnapshot;
}

function basis(
  fixture: Awaited<ReturnType<typeof buildRequirementsHistoryUnjoinedFixture>>,
): ProductNavigationBasis {
  return {
    projectId: PROJECT,
    threadSnapshotId: fixture.thread.id,
    threadRevision: fixture.thread.revision,
    threadSubjectId: HISTORY_SUBJECT,
    architectureArtifactId: fixture.currentArchitectureId,
    architectureFingerprint: `sha256:${NEW_ARCH_DIGEST}`,
    captureSchema: "architecture-capture/4.0",
  };
}

function opened(
  fixture: Awaited<ReturnType<typeof buildRequirementsHistoryUnjoinedFixture>>,
): OpenedProductStructure {
  const root = productNavigationElementNode({
    element: productStructureElementRef("PartDefinition", HISTORY_TARGET),
    label: "CameraMountBracket",
    expandable: false,
  });
  return {
    architectureArtifactId: fixture.currentArchitectureId,
    architectureFingerprint: {
      algorithm: "sha256",
      digest: NEW_ARCH_DIGEST,
    },
    root: () => root,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: (id: string) =>
      id === HISTORY_TARGET
        ? { element: root.element, label: root.label, expandable: false }
        : undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    hasDefinition: (id: string) => id === HISTORY_TARGET,
    hasElement: (query: { readonly elementId: string }) =>
      query.elementId === HISTORY_TARGET,
    typedDefinition: () => undefined,
  } as unknown as OpenedProductStructure;
}
