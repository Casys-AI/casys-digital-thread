import { assertEquals } from "@std/assert";
import {
  isStudyBaseEvaluation,
  resolveSensitivityBaseJoin,
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
} from "./sensitivity-base-evaluation.ts";
import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "../study/sensitivity-study-proposal.ts";
import type { SensitivityStudyCapture } from "../study/sensitivity-study-capture.ts";
import type {
  ThreadObservation,
  TracedRequirement,
} from "../../thread/thread-snapshot.ts";

const DIGEST = "a".repeat(64);
const AT = "2026-08-15T00:00:00.000Z";

Deno.test("isStudyBaseEvaluation is true only when a sensitivity-base observation or join capture is cited", () => {
  assertEquals(
    isStudyBaseEvaluation({
      observationIds: [`sensitivity-base-maxDisplacement-${DIGEST}`],
      evidenceArtifactIds: [`sensitivity-base-evaluation-${DIGEST}`],
    }),
    true,
  );
  assertEquals(
    isStudyBaseEvaluation({
      observationIds: ["calculix-observation-abc"],
      evidenceArtifactIds: ["calculix-syson-evaluation-abc"],
    }),
    false,
  );
});

Deno.test("verify.evaluate-sensitivity-base@1 is the join identity, not a sensitivity run", () => {
  assertEquals(
    VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id,
    "verify.evaluate-sensitivity-base",
  );
  assertEquals(VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version, "1");
  assertEquals(ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id, "analyze.run-fea-sensitivity");
});

Deno.test("resolveSensitivityBaseJoin pairs each study metric to one requirement and its study-base observation", () => {
  const world = harness();
  const join = resolveSensitivityBaseJoin(world);
  assertEquals(join.status, "resolved");
  if (join.status !== "resolved") return;
  assertEquals(join.pairs.map((pair) => pair.metricId), [
    "maxDisplacement",
    "maxVonMises",
  ]);
  assertEquals(
    join.pairs[0]!.observation.id,
    `sensitivity-base-maxDisplacement-${DIGEST}`,
  );
});

Deno.test("resolveSensitivityBaseJoin is unresolved when a study metric has no Thread requirement", () => {
  const world = harness();
  const join = resolveSensitivityBaseJoin({
    ...world,
    requirements: world.requirements.filter((item) =>
      item.criterion.metric !== "maxVonMises"
    ),
  });
  assertEquals(join.status, "unresolved");
  if (join.status !== "unresolved") return;
  assertEquals(join.reason, "study-metric-unlinked");
});

Deno.test("resolveSensitivityBaseJoin is unresolved when two requirements share a study metric", () => {
  const world = harness();
  const join = resolveSensitivityBaseJoin({
    ...world,
    requirements: [
      ...world.requirements,
      {
        ...world.requirements[0]!,
        id: "requirement-duplicate-maxDisplacement",
      },
    ],
  });
  assertEquals(join.status, "unresolved");
  if (join.status !== "unresolved") return;
  assertEquals(join.reason, "requirement-not-unique");
});

Deno.test("resolveSensitivityBaseJoin is unresolved when the study-base observation is missing", () => {
  const world = harness();
  const join = resolveSensitivityBaseJoin({
    ...world,
    observations: world.observations.filter((item) =>
      !item.id.includes("maxDisplacement")
    ),
  });
  assertEquals(join.status, "unresolved");
  if (join.status !== "unresolved") return;
  assertEquals(join.reason, "observation-unlinked");
});

Deno.test("resolveSensitivityBaseJoin is unresolved when the observation quantity is not Object.is-equal to the study measurement", () => {
  const world = harness();
  const join = resolveSensitivityBaseJoin({
    ...world,
    observations: world.observations.map((item) =>
      item.metric === "maxDisplacement"
        ? { ...item, quantity: { value: 0.24, unit: "mm" } }
        : item
    ),
  });
  assertEquals(join.status, "unresolved");
  if (join.status !== "unresolved") return;
  assertEquals(join.reason, "quantity-mismatch");
});

function harness(): {
  readonly capture: SensitivityStudyCapture;
  readonly digest: string;
  readonly observations: readonly ThreadObservation[];
  readonly requirements: readonly TracedRequirement[];
} {
  const capture = {
    schemaVersion: "sensitivity-study-capture/1.0",
    operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
    trustedRunId: "run:study",
    caseDigest: "b".repeat(64),
    studyCase: {
      schemaVersion: "sensitivity-study-case/3.0",
      id: "fixture",
      revision: 1,
      scope: "mechanical-structural",
      evidenceBoundary: "fea-static",
      project: { id: "desk-lamp-dl05", subjectId: "arm" },
      target: { componentKey: "arm", semanticKey: "arm_thickness" },
      cadSource: {
        artifactUri: "casys://technical-compilation-admission/sha256/" + "c".repeat(64),
        sha256: "c".repeat(64),
      },
      baseValue: { value: 10, unit: "mm" },
      step: { value: 1, unit: "mm" },
      metrics: [
        { id: "maxDisplacement", unit: "mm" },
        { id: "maxVonMises", unit: "MPa" },
      ],
      method: {
        mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
        material: {
          model: "isotropic-linear-elastic",
          eMpa: 69000,
          nu: 0.33,
          basis: "fixture",
        },
        supports: [],
        loads: [],
      },
      domain: {
        approximationOrder: "first-order-forward",
        remeshingVariationIncluded: true,
        localValidityNote: "fixture",
        limitations: [],
      },
    },
    cad: {
      base: {
        executionRunId: "cad-base",
        sourceSha256: "d".repeat(64),
        stepSha256: "e".repeat(64),
        stepBytes: 1,
      },
      stepped: {
        executionRunId: "cad-step",
        sourceSha256: "f".repeat(64),
        stepSha256: "1".repeat(64),
        stepBytes: 1,
      },
    },
    measurements: {
      base: [
        { metric: "maxDisplacement", value: 0.23912717490279242, unit: "mm" },
        { metric: "maxVonMises", value: 6.04, unit: "MPa" },
      ],
      stepped: [
        { metric: "maxDisplacement", value: 0.2, unit: "mm" },
        { metric: "maxVonMises", value: 5, unit: "MPa" },
      ],
    },
    derivatives: {
      schemaVersion: "sensitivity-derivatives/1.0",
      derivatives: [],
    },
    capturedAt: AT,
  } as unknown as SensitivityStudyCapture;
  const freshness = {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [] as const,
  };
  const observations: ThreadObservation[] = [
    observation("maxDisplacement", 0.23912717490279242, "mm"),
    observation("maxVonMises", 6.04, "MPa"),
  ];
  const requirements: TracedRequirement[] = [
    requirement("maxDisplacement", 1, "mm"),
    requirement("maxVonMises", 60_000_000, "Pa"),
  ];
  return { capture, digest: DIGEST, observations, requirements };

  function observation(
    metric: string,
    value: number,
    unit: string,
  ): ThreadObservation {
    return {
      id: `sensitivity-base-${metric}-${DIGEST}`,
      name: metric,
      metric,
      quantity: { value, unit },
      source: {
        operation: {
          serverId: "digital-thread",
          tool: "analyze.run-fea-sensitivity@1",
          runId: "run:study",
        },
        artifactIds: [`sensitivity-study-${DIGEST}`],
        capturedAt: AT,
      },
      freshness,
    };
  }

  function requirement(
    metric: string,
    value: number,
    unit: string,
  ): TracedRequirement {
    return {
      id: `requirement-fixture-${metric}`,
      name: metric,
      statement: metric,
      version: "1",
      criterion: {
        metric,
        operator: "<=",
        limit: { value, unit },
      },
      trace: {
        sourceArtifactId: "requirements-fixture",
        elementId: "el-1",
        targetArtifactIds: ["architecture-fixture"],
      },
      freshness,
    };
  }
}
