import { assertEquals, assertStringIncludes } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import { isThreadWorkbenchSnapshot } from "./src/thread/types.ts";
import type {
  ThreadRequirementHistoricalEvaluation,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";
import { selectOverviewHistoricalUnjoined } from "./src/thread/requirement-historical-unjoined-selection.ts";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const CASE_DIGEST = "d".repeat(64);
const CURRENT_EVALUATION_ID = "eval-mech-014-current";

Deno.test(
  "Workbench contract accepts historical-unjoined collection on an unresolved requirement",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    const requirement = snapshot.requirements.find((item) =>
      item.id === "REQ-THERM-021"
    )!;
    requirement.historicalEvaluations = [historical("REQ-THERM-021")];
    requirement.historicalChain = { status: "complete", hops: 1 };
    assertEquals(requirement.status, "unresolved");
    assertEquals(isThreadWorkbenchSnapshot(snapshot), true);
  },
);

Deno.test(
  "Workbench contract accepts current PASS plus predecessor history without a singleton alias",
  () => {
    const snapshot = withCurrentPassAndHistory({ evaluationNode: false });
    const requirement = snapshot.requirements.find((item) =>
      item.id === "REQ-MECH-014"
    )!;
    assertEquals(requirement.status, "pass");
    assertEquals(requirement.observationIds, ["OBS-STRESS-MAX"]);
    assertEquals(isThreadWorkbenchSnapshot(snapshot), true);
    assertEquals(
      Object.hasOwn(requirement, "historicalEvaluation"),
      false,
    );
  },
);

Deno.test(
  "Workbench contract rejects malformed historical-unjoined evaluation context",
  () => {
    const relabel = structuredClone(GENERIC_THREAD_FIXTURE);
    const requirement = relabel.requirements.find((item) =>
      item.id === "REQ-THERM-021"
    )!;
    requirement.historicalEvaluations = [historical("REQ-THERM-021")];
    requirement.status = "pass";
    assertEquals(isThreadWorkbenchSnapshot(relabel), true);

    const singleton = structuredClone(GENERIC_THREAD_FIXTURE);
    (singleton.requirements.find((item) =>
      item.id === "REQ-THERM-021"
    ) as unknown as Record<string, unknown>).historicalEvaluation = historical(
      "REQ-THERM-021",
    );
    assertEquals(isThreadWorkbenchSnapshot(singleton), false);

    const wrongRelation = structuredClone(GENERIC_THREAD_FIXTURE);
    wrongRelation.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [{
        ...historical("REQ-THERM-021"),
        relation: "supersedes",
      } as unknown as ThreadRequirementHistoricalEvaluation];
    assertEquals(isThreadWorkbenchSnapshot(wrongRelation), false);

    const extraKey = structuredClone(GENERIC_THREAD_FIXTURE);
    extraKey.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [{
        ...historical("REQ-THERM-021"),
        label: "pass",
      } as unknown as ThreadRequirementHistoricalEvaluation];
    assertEquals(isThreadWorkbenchSnapshot(extraKey), false);

    const missingNative = structuredClone(GENERIC_THREAD_FIXTURE);
    const broken = { ...historical("REQ-THERM-021") } as Record<
      string,
      unknown
    >;
    delete broken.native;
    missingNative.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [
        broken as unknown as ThreadRequirementHistoricalEvaluation,
      ];
    assertEquals(isThreadWorkbenchSnapshot(missingNative), false);

    const observationFingerprint = structuredClone(GENERIC_THREAD_FIXTURE);
    observationFingerprint.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [{
        ...historical("REQ-THERM-021"),
        observations: [{
          id: "obs-von-mises-historical",
          sourceArtifact: {
            id: "solver-result-old",
            fingerprint: FINGERPRINT,
          },
        }],
      } as unknown as ThreadRequirementHistoricalEvaluation];
    assertEquals(isThreadWorkbenchSnapshot(observationFingerprint), false);

    const duplicateSources = structuredClone(GENERIC_THREAD_FIXTURE);
    duplicateSources.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [{
        ...historical("REQ-THERM-021"),
        observations: [{
          id: "obs-von-mises-historical",
          sourceArtifacts: [{
            id: "solver-result-old",
            fingerprint: FINGERPRINT,
          }, {
            id: "solver-result-old",
            fingerprint: FINGERPRINT,
          }],
        }],
      }];
    assertEquals(isThreadWorkbenchSnapshot(duplicateSources), false);

    const emptyPartial = structuredClone(GENERIC_THREAD_FIXTURE);
    const emptyPartialRequirement = emptyPartial.requirements.find((item) =>
      item.id === "REQ-MECH-014"
    )!;
    emptyPartialRequirement.status = "pass";
    emptyPartialRequirement.historicalEvaluations = [];
    emptyPartialRequirement.historicalChain = {
      status: "partial",
      hops: 0,
      reason: "conflicting-provenance",
      stoppedAtRequirementId: "REQ-MECH-014",
    };
    assertEquals(isThreadWorkbenchSnapshot(emptyPartial), true);

    const mismatchedCurrent = structuredClone(GENERIC_THREAD_FIXTURE);
    mismatchedCurrent.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [historical("REQ-MECH-014")];
    assertEquals(isThreadWorkbenchSnapshot(mismatchedCurrent), false);

    const duplicateIds = structuredClone(GENERIC_THREAD_FIXTURE);
    duplicateIds.requirements.find((item) => item.id === "REQ-THERM-021")!
      .historicalEvaluations = [
        historical("REQ-THERM-021"),
        historical("REQ-THERM-021"),
      ];
    assertEquals(isThreadWorkbenchSnapshot(duplicateIds), false);
  },
);

Deno.test(
  "current verdict selection opens the historical list through the exact requirement reference",
  () => {
    const snapshot = withCurrentPassAndHistory();
    const evaluatesBefore = snapshot.graph.edges.filter((edge) =>
      edge.relation === "evaluates"
    );
    const fromRequirement = selectOverviewHistoricalUnjoined(snapshot, {
      kind: "requirement",
      id: "REQ-MECH-014",
    });
    const fromVerdict = selectOverviewHistoricalUnjoined(snapshot, {
      kind: "evaluation",
      id: CURRENT_EVALUATION_ID,
    });
    assertEquals(fromRequirement?.kind, "historical-unjoined");
    assertEquals(fromRequirement?.requirementId, "REQ-MECH-014");
    assertEquals(
      fromRequirement?.evaluations.map((item) => [
        item.evaluationId,
        item.status,
        item.sensitivity?.status,
      ]),
      [
        ["eval-von-mises-historical-fail", "fail", undefined],
        ["eval-von-mises-historical", "pass", "measured"],
      ],
    );
    assertEquals(fromVerdict, fromRequirement);
    assertEquals(
      snapshot.graph.edges.filter((edge) => edge.relation === "evaluates"),
      evaluatesBefore,
    );
    assertEquals(
      snapshot.graph.nodes.some((node) =>
        node.entityKind === "analysis-node" &&
        node.ref.id.includes("historical")
      ),
      false,
    );
    const measured = fromVerdict?.evaluations.find((item) =>
      item.sensitivity?.status === "measured"
    )?.sensitivity;
    assertEquals(measured?.status, "measured");
    if (measured?.status !== "measured") return;
    assertEquals(measured.measurement.responseAtBase, {
      value: 8_000,
      unit: "Pa",
    });
    assertEquals(measured.study.id, "sensitivity-study-old");
    assertEquals(
      measured.predecessorArchitecture.artifactId !==
        fromVerdict?.evaluations[0]?.currentArchitecture.artifactId,
      true,
    );
    assertEquals(
      fromVerdict?.evaluations[1]?.observations[0]?.sourceArtifacts.length,
      2,
    );

    snapshot.requirements.find((item) => item.id === "REQ-MECH-014")!
      .historicalEvaluations = [];
    snapshot.requirements.find((item) => item.id === "REQ-MECH-014")!
      .historicalChain = {
        status: "partial",
        hops: 0,
        reason: "conflicting-provenance",
        stoppedAtRequirementId: "REQ-MECH-014",
      };
    const unavailable = selectOverviewHistoricalUnjoined(snapshot, {
      kind: "evaluation",
      id: CURRENT_EVALUATION_ID,
    });
    assertEquals(unavailable, {
      kind: "historical-unjoined",
      requirementId: "REQ-MECH-014",
      evaluations: [],
      chain: {
        status: "partial",
        hops: 0,
        reason: "conflicting-provenance",
        stoppedAtRequirementId: "REQ-MECH-014",
      },
    });
  },
);

Deno.test(
  "requirement detail sources render historical-unjoined context without a new inspector",
  async () => {
    const inspector = await Deno.readTextFile(
      new URL("./src/thread/tool-inspectors.tsx", import.meta.url),
    );
    const hero = await Deno.readTextFile(
      new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
    );
    const disclosure = await Deno.readTextFile(
      new URL(
        "./src/thread/requirement-historical-unjoined.tsx",
        import.meta.url,
      ),
    );
    const note = await Deno.readTextFile(
      new URL(
        "./src/project/overview-sensitivity-journey-note.tsx",
        import.meta.url,
      ),
    );
    const journey = await Deno.readTextFile(
      new URL("./src/project/overview-sensitivity-journey.ts", import.meta.url),
    );
    assertEquals(
      inspector.includes("RequirementHistoricalUnjoinedContext"),
      true,
    );
    assertEquals(inspector.includes("historicalEvaluations"), true);
    assertEquals(/historicalEvaluation(?!s)/.test(inspector), false);
    assertEquals(hero.includes("selectOverviewHistoricalUnjoined"), true);
    assertEquals(hero.includes("RequirementHistoricalUnjoinedContext"), true);
    assertEquals(/historicalEvaluation(?!s)/.test(hero), false);
    assertEquals(disclosure.includes("Historical unjoined evaluations"), true);
    assertEquals(
      disclosure.includes("Historical unjoined evaluations unavailable"),
      true,
    );
    assertEquals(disclosure.includes("current join"), true);
    assertEquals(disclosure.includes("Historical measured relation"), true);
    assertEquals(disclosure.includes("SensitivityMeasuredDeltaTable"), true);
    assertEquals(disclosure.includes('kind: "artifact"'), true);
    assertEquals(
      note.includes("export function SensitivityMeasuredDeltaTable"),
      true,
    );
    assertEquals(
      journey.includes("buildOverviewSensitivityVerdictBindings"),
      true,
    );
    assertEquals(journey.includes("historicalEvaluations"), false);
    assertEquals(hero.includes("data-edge-action-key"), false);
  },
);

function withCurrentPassAndHistory(
  options: { readonly evaluationNode?: boolean } = {},
): ThreadWorkbenchSnapshot {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const requirement = snapshot.requirements.find((item) => item.id === "REQ-MECH-014")!;
  requirement.status = "pass";
  requirement.observationIds = ["OBS-STRESS-MAX"];
  requirement.historicalEvaluations = [
    {
      ...historical("REQ-MECH-014"),
      evaluationId: "eval-von-mises-historical-fail",
      status: "fail",
      evaluatedAt: "2026-09-11T08:00:00.000Z",
    },
    {
      ...historical("REQ-MECH-014"),
      evaluationFamily: "study-base",
      sensitivity: {
        status: "measured",
        method: "forward-finite-difference",
        parameter: {
          id: "sensitivity-parameter:id01:RadialArm:arm_height",
          lower: { value: 5, unit: "mm" },
          upper: { value: 6, unit: "mm" },
        },
        measurement: {
          method: "forward-finite-difference",
          basePoint: { value: 5, unit: "mm" },
          perturbationStep: { value: 1, unit: "mm" },
          responseAtBase: { value: 8_000, unit: "Pa" },
          responseAtPerturbed: { value: 8_100, unit: "Pa" },
          derivative: { value: 100, unit: "Pa/mm" },
        },
        study: {
          id: "sensitivity-study-old",
          fingerprint: FINGERPRINT,
        },
        studyCase: {
          id: "sensitivity-case-old",
          fingerprint: `sha256:${CASE_DIGEST}`,
          digest: CASE_DIGEST,
        },
        baseEvaluation: {
          id: "sensitivity-base-evaluation-old",
          fingerprint: FINGERPRINT,
        },
        originalRequirementId: "requirement-old-max_von_mises_pa",
        originalEvaluationId: "eval-von-mises-historical",
        predecessorArchitecture: {
          artifactId: "architecture-old",
          fingerprint: FINGERPRINT,
          producerRunId: "run:architecture-old",
        },
      },
    },
  ];
  requirement.historicalChain = { status: "complete", hops: 1 };
  if (options.evaluationNode !== false) {
    snapshot.graph.nodes.push({
      id: `graph:evaluation:${CURRENT_EVALUATION_ID}`,
      ref: { kind: "evaluation", id: CURRENT_EVALUATION_ID },
      entityKind: "evaluation",
      label: "Current mechanical verdict",
      system: "syson",
      freshness: "fresh",
      summary: "pass",
      selection: { kind: "requirement", id: "REQ-MECH-014" },
    });
  }
  snapshot.artifacts.push({
    id: "sensitivity-study-old",
    label: "Historical sensitivity study",
    kind: "evidence",
    system: "calculix",
    revision: "1",
    freshness: "fresh",
    fingerprint: FINGERPRINT,
    dependsOn: [],
  });
  return snapshot;
}

function historical(
  currentRequirementId: string,
): ThreadRequirementHistoricalEvaluation {
  return {
    relation: "historical-unjoined",
    hopIndex: 1,
    currentRequirementId,
    predecessorRequirementId: "requirement-old-max_von_mises_pa",
    evaluationId: "eval-von-mises-historical",
    status: "pass",
    evaluatedAt: "2026-09-11T09:00:00.000Z",
    observations: [{
      id: "obs-von-mises-historical",
      sourceArtifacts: [{
        id: "solver-result-old",
        fingerprint: FINGERPRINT,
      }, {
        id: "solver-evidence-old",
        fingerprint: `sha256:${"c".repeat(64)}`,
      }],
    }],
    evidence: [{
      id: "solver-result-old",
      fingerprint: FINGERPRINT,
    }],
    predecessorCapture: {
      id: "requirements-CameraMountBracket-old",
      fingerprint: FINGERPRINT,
      producerRunId: "run:requirements-write",
    },
    currentArchitecture: {
      artifactId: "architecture-new",
      fingerprint: `sha256:${"b".repeat(64)}`,
      producerRunId: "run:architecture-new",
    },
    predecessorArchitecture: {
      artifactId: "architecture-old",
      fingerprint: FINGERPRINT,
      producerRunId: "run:architecture-old",
    },
    native: {
      targetElementId: "part-def-camera-bracket",
      requirementUsageId: "requirement-usage-camera-bracket",
      constraintUsageId: "constraint-usage-max-von-mises",
      criterion: {
        metric: "max_von_mises_pa",
        operator: "<=",
        limit: { value: 120_000_000, unit: "Pa" },
      },
    },
  };
}
