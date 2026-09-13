/**
 * Read-only recross of a measured historical sensitivity onto its original
 * study-base evaluation. Missing or unproven measurement evidence leaves the
 * evaluation visible with sensitivity unavailable. This never invents numbers
 * or a current catalog join.
 */

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  isStudyBaseEvaluation,
  SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX,
  SENSITIVITY_BASE_OBSERVATION_ID_PREFIX,
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
} from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import { validateSensitivityBaseEvaluationCapture } from "../sensitivity/base-evaluation/sensitivity-base-evaluation-capture.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  isSensitivityStudyResultArtifactId,
  validateSensitivityStudyResult,
} from "../../domain/sensitivity/study/sensitivity-study-result.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
  validateSensitivityStudyCaseCapture,
} from "../sensitivity/study/sensitivity-study-case-capture.ts";
import type {
  ThreadRequirementHistoricalArchitectureBase,
  ThreadRequirementHistoricalSensitivity,
} from "../../domain/thread/requirement-historical-evaluation.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadSnapshot,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import type { RequirementsCaptureReader } from "./requirements-target-workbench-enricher.ts";

const STUDY_PRODUCER =
  `${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id}@${ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version}` as const;
const CASE_PRODUCER =
  `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}` as const;
const BASE_EVAL_PRODUCER =
  `${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id}@${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version}` as const;

export async function recrossHistoricalSensitivity(
  evaluation: RequirementEvaluation,
  predecessor: TracedRequirement,
  predecessorArchitecture: ThreadRequirementHistoricalArchitectureBase,
  thread: ThreadSnapshot,
  artifacts: ReadonlyMap<string, ThreadArtifact>,
  captures: RequirementsCaptureReader,
): Promise<ThreadRequirementHistoricalSensitivity | undefined> {
  if (!isStudyBaseEvaluation(evaluation)) return undefined;
  const proven = await proveMeasuredSensitivity(
    evaluation,
    predecessor,
    predecessorArchitecture,
    thread,
    artifacts,
    captures,
  );
  return proven ?? { status: "unavailable", reason: "missing-measurement-evidence" };
}

async function proveMeasuredSensitivity(
  evaluation: RequirementEvaluation,
  predecessor: TracedRequirement,
  predecessorArchitecture: ThreadRequirementHistoricalArchitectureBase,
  thread: ThreadSnapshot,
  artifacts: ReadonlyMap<string, ThreadArtifact>,
  captures: RequirementsCaptureReader,
): Promise<ThreadRequirementHistoricalMeasured | undefined> {
  const observation = uniqueMatching(
    evaluation.observationIds.flatMap((id) => {
      const item = thread.observations.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    }),
    (item) =>
      item.id.startsWith(SENSITIVITY_BASE_OBSERVATION_ID_PREFIX) &&
      item.metric === predecessor.criterion.metric,
  );
  if (!observation) return undefined;
  const studyId = uniqueId(observation.source.artifactIds);
  const studyArtifact = studyId ? artifacts.get(studyId) : undefined;
  if (
    !studyArtifact ||
    studyArtifact.producer.tool !== STUDY_PRODUCER ||
    !isSensitivityStudyResultArtifactId(
      studyArtifact.id,
      studyArtifact.fingerprint,
    )
  ) {
    return undefined;
  }

  const relation = uniqueMatching(
    thread.analysisGraph?.relations ?? [],
    (item) =>
      item.assertion.relation === "measured-local-sensitivity" &&
      item.assertion.epistemicBasis === "observed" &&
      item.assertion.scope.kind === "local-neighborhood" &&
      item.assertion.measurement !== undefined &&
      item.assertion.evidence.length === 1 &&
      item.assertion.evidence[0]?.id === studyArtifact.id &&
      fingerprintsEqual(
        item.assertion.evidence[0]!.fingerprint,
        studyArtifact.fingerprint,
      ) &&
      sameQuantity(observation, item.assertion.measurement.responseAtBase),
  );
  if (
    !relation ||
    relation.assertion.scope.kind !== "local-neighborhood" ||
    relation.assertion.measurement === undefined
  ) {
    return undefined;
  }
  const scope = relation.assertion.scope;
  const measurement = relation.assertion.measurement;
  const caseDigest = scope.basisFingerprint.digest;
  const studyCapture = await reopenValidated(
    studyArtifact,
    captures,
    async (value) => {
      const capture = await validateSensitivityStudyResult(value);
      if (capture.caseDigest !== caseDigest) {
        throw new Error("study case digest does not match the assertion basis");
      }
      if (capture.trustedRunId !== studyArtifact.producer.runId) {
        throw new Error("study producer run does not match the capture");
      }
      const metric = capture.measurements.base.find((item) =>
        item.metric === predecessor.criterion.metric
      );
      if (
        !metric ||
        !sameQuantity(observation, metric) ||
        !sameQuantity(metric, measurement.responseAtBase)
      ) {
        throw new Error("study base measurement does not match the observation");
      }
      return capture;
    },
  );
  if (!studyCapture) return undefined;

  const caseArtifact = artifacts.get(`sensitivity-case-${caseDigest}`);
  if (
    !caseArtifact ||
    caseArtifact.producer.tool !== CASE_PRODUCER ||
    !caseArtifact.uri?.startsWith(SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX)
  ) {
    return undefined;
  }
  const caseCapture = await reopenValidated(
    caseArtifact,
    captures,
    async (value) => {
      const capture = await validateSensitivityStudyCaseCapture(value);
      if (
        capture.caseDigest !== caseDigest ||
        capture.trustedRunId !== caseArtifact.producer.runId
      ) {
        throw new Error("sealed case identity does not match the Thread artifact");
      }
      return capture;
    },
  );
  if (!caseCapture) return undefined;

  const baseEvaluationId = uniqueMatching(
    evaluation.evidenceArtifactIds,
    (id) => id.startsWith(SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX),
  );
  const baseEvaluationArtifact = baseEvaluationId
    ? artifacts.get(baseEvaluationId)
    : undefined;
  if (
    !baseEvaluationArtifact ||
    baseEvaluationArtifact.producer.tool !== BASE_EVAL_PRODUCER ||
    baseEvaluationArtifact.id !==
      `${SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX}${baseEvaluationArtifact.fingerprint.digest}`
  ) {
    return undefined;
  }
  const baseEvaluationCapture = await reopenValidated(
    baseEvaluationArtifact,
    captures,
    (value) => {
      const capture = validateSensitivityBaseEvaluationCapture(value);
      if (
        capture.studyDigest !== studyArtifact.fingerprint.digest ||
        baseEvaluationArtifact.producer.runId !== evaluation.evaluator.runId
      ) {
        throw new Error("base-evaluation capture does not name the study");
      }
      return capture;
    },
  );
  if (!baseEvaluationCapture) return undefined;

  return {
    status: "measured",
    method: measurement.method,
    parameter: {
      id: scope.parameter.id,
      lower: { value: scope.lower.value, unit: scope.lower.unit },
      upper: { value: scope.upper.value, unit: scope.upper.unit },
    },
    measurement: {
      method: measurement.method,
      basePoint: { ...measurement.basePoint },
      perturbationStep: { ...measurement.perturbationStep },
      responseAtBase: { ...measurement.responseAtBase },
      responseAtPerturbed: { ...measurement.responseAtPerturbed },
      derivative: { ...measurement.derivative },
    },
    study: ref(studyArtifact),
    studyCase: {
      ...ref(caseArtifact),
      digest: caseDigest,
    },
    baseEvaluation: ref(baseEvaluationArtifact),
    originalRequirementId: predecessor.id,
    originalEvaluationId: evaluation.id,
    predecessorArchitecture,
  };
}

type ThreadRequirementHistoricalMeasured = Extract<
  ThreadRequirementHistoricalSensitivity,
  { readonly status: "measured" }
>;

async function reopenValidated<T>(
  artifact: ThreadArtifact,
  captures: RequirementsCaptureReader,
  validate: (value: unknown) => T | Promise<T>,
): Promise<T | undefined> {
  if (artifact.fingerprint.algorithm !== "sha256") return undefined;
  let text: string | undefined;
  try {
    text = await captures.read(artifact.fingerprint);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text);
    const validated = await validate(parsed);
    if (deterministicJson(parsed) !== text) return undefined;
    if (
      !fingerprintsEqual(await sha256Fingerprint(parsed), artifact.fingerprint)
    ) {
      return undefined;
    }
    return validated;
  } catch {
    return undefined;
  }
}

function ref(artifact: ThreadArtifact) {
  return {
    id: artifact.id,
    fingerprint: `${artifact.fingerprint.algorithm}:${artifact.fingerprint.digest}`,
  };
}

function sameQuantity(
  left: { readonly value?: number; readonly unit?: string } | {
    readonly quantity: { readonly value: number; readonly unit: string };
  },
  right: { readonly value: number; readonly unit: string },
): boolean {
  const quantity = "quantity" in left ? left.quantity : left;
  return Object.is(quantity.value, right.value) && quantity.unit === right.unit;
}

function uniqueMatching<T>(
  items: readonly T[],
  match: (item: T) => boolean,
): T | undefined {
  const matched = items.filter(match);
  return matched.length === 1 ? matched[0] : undefined;
}

function uniqueId(ids: readonly string[]): string | undefined {
  return ids.length === 1 ? ids[0] : undefined;
}
