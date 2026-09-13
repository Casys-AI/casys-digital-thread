/**
 * Reusable in-memory recapture history for F49 projection tests.
 *
 * Current requirements keep their own live verdict. Archived predecessors
 * keep recorded evaluations. This is not live project state.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { buildSensitivityAnalysisGraph } from "../../domain/sensitivity/live-fea/sensitivity-analysis-graph.ts";
import { validateSensitivityBaseEvaluationCapture } from "../../adapters/sensitivity/base-evaluation/sensitivity-base-evaluation-capture.ts";
import { SENSITIVITY_STUDY_CAPTURE_URI_PREFIX } from "../../domain/sensitivity/study/sensitivity-study-capture.ts";
import { validateSensitivityStudyCapture } from "../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
  validateSensitivityStudyCaseCapture,
} from "../../adapters/sensitivity/study/sensitivity-study-case-capture.ts";
import { computeSensitivities } from "../../domain/sensitivity/study/sensitivity-study.ts";
import { validateSensitivityStudyCaseV3 } from "../../domain/sensitivity/study/sensitivity-study-v3.ts";
import { sensitivityBaseObservationId } from "../../domain/sensitivity/vector-correction/vector-correction-origin.ts";
import type { AnalysisGraph } from "../../domain/thread/analysis-graph.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadObservation,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../adapters/shared/cas/file-capture-store.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "../../adapters/architecture/requirements/requirements-identities.ts";
import type { RequirementsCaptureReader } from "../../adapters/thread/requirements-target-workbench-enricher.ts";

export const HISTORY_SUBJECT = "subject:id01";
export const HISTORY_CONTAINER = "CameraMountBracket";
export const HISTORY_TARGET = "part-def-camera-bracket";
export const HISTORY_USAGE = "requirement-usage-camera-bracket";
export const HISTORY_CONSTRAINT = "constraint-usage-max-von-mises";
export const HISTORY_METRIC_ID = "max_von_mises_pa";
export const HISTORY_METRIC = "max_von_mises_pa";
export const HISTORY_AT = "2026-09-07T12:00:00.000Z";
export const HISTORY_EVALUATED_AT = "2026-09-11T09:00:00.000Z";
export const CURRENT_EVALUATED_AT = "2026-09-12T08:00:00.000Z";
export const OLD_ARCH_DIGEST = "a".repeat(64);
export const MID_ARCH_DIGEST = "11".repeat(32);
export const NEW_ARCH_DIGEST = "b".repeat(64);
export const SOLVER_DIGEST = "c".repeat(64);
export const FEA_EVIDENCE_DIGEST = "88".repeat(32);
export const CURRENT_SOLVER_DIGEST = "22".repeat(32);
export const SENSITIVITY_BASE_VALUE = { value: 5, unit: "mm" } as const;
export const SENSITIVITY_STEP = { value: 1, unit: "mm" } as const;
export const SENSITIVITY_RESPONSE_BASE = {
  value: 8_000,
  unit: "Pa",
} as const;
export const SENSITIVITY_RESPONSE_STEPPED = {
  value: 8_100,
  unit: "Pa",
} as const;

export type RequirementsHistoryFault =
  | "none"
  | "ambiguous-supersedes"
  | "cyclic-supersedes"
  | "missing-predecessor"
  | "native-target-drift"
  | "constraint-drift"
  | "criterion-drift"
  | "missing-cas"
  | "corrupt-cas"
  | "disconnected-architecture"
  | "second-hop-missing-cas"
  | "duplicate-evaluation-id"
  | "duplicate-observation-source"
  | "missing-observation-source";

export type RequirementsHistoryCurrentVerdict = "unresolved" | "pass" | "fail";
export type RequirementsHistorySensitivity =
  | "none"
  | "measured"
  | "missing-capture"
  | "wrong-digest"
  | "wrong-unit"
  | "unexecuted-case";

export interface RequirementsHistoryFixtureOptions {
  readonly fault?: RequirementsHistoryFault;
  readonly currentVerdict?: RequirementsHistoryCurrentVerdict;
  readonly hops?: 1 | 2;
  readonly extraPredecessorEvaluation?: boolean;
  readonly extraPredecessorFail?: boolean;
  readonly sensitivity?: RequirementsHistorySensitivity;
  readonly newerSensitivityCase?: boolean;
}

export interface RequirementsHistoryUnjoinedFixture {
  readonly thread: ThreadSnapshot;
  readonly captures: RequirementsCaptureReader;
  readonly currentRequirementId: string;
  readonly predecessorRequirementId: string;
  readonly middleRequirementId?: string;
  readonly evaluationId: string;
  readonly extraEvaluationId?: string;
  readonly failEvaluationId?: string;
  readonly studyBaseEvaluationId?: string;
  readonly observationId: string;
  readonly observationSourceIds: readonly string[];
  readonly evidenceId: string;
  readonly feaEvidenceId: string;
  readonly currentCaptureId: string;
  readonly predecessorCaptureId: string;
  readonly currentArchitectureId: string;
  readonly predecessorArchitectureId: string;
  readonly studyArtifactId?: string;
  readonly studyCaseArtifactId?: string;
  readonly baseEvaluationArtifactId?: string;
  readonly caseDigest?: string;
}

export async function buildRequirementsHistoryUnjoinedFixture(
  faultOrOptions: RequirementsHistoryFault | RequirementsHistoryFixtureOptions = "none",
): Promise<RequirementsHistoryUnjoinedFixture> {
  const options = typeof faultOrOptions === "string"
    ? { fault: faultOrOptions }
    : faultOrOptions;
  const fault = options.fault ?? "none";
  const hops = options.hops ?? (fault === "second-hop-missing-cas" ? 2 : 1);
  const currentVerdict = options.currentVerdict ?? "unresolved";
  const sensitivity = options.sensitivity ?? "none";

  const oldArch = architectureArtifact(OLD_ARCH_DIGEST, "run:architecture-old");
  const midArch = architectureArtifact(MID_ARCH_DIGEST, "run:architecture-mid");
  const newArch = architectureArtifact(NEW_ARCH_DIGEST, "run:architecture-new");
  const writeCapture = writeRequirementsCapture({
    architecture: oldArch,
    targetElementId: fault === "native-target-drift"
      ? "part-def-foreign"
      : HISTORY_TARGET,
    constraintId: fault === "constraint-drift"
      ? "constraint-usage-foreign"
      : HISTORY_CONSTRAINT,
    limit: fault === "criterion-drift" ? 1 : 120_000_000,
  });
  const oldestFp = await sha256Fingerprint(writeCapture);
  const oldestCaptureId = requirementsArtifactId(
    HISTORY_CONTAINER,
    oldestFp.digest,
  );
  const oldestArtifact = requirementsArtifact({
    fingerprint: oldestFp,
    producerTool: "syson_element_insert_sysml",
    runId: "run:requirements-write",
    inputs: [oldArch.id],
  });
  const oldestRequirement = tracedRequirement({
    digest: oldestFp.digest,
    sourceArtifactId: oldestCaptureId,
    architectureId: oldArch.id,
    changedAt: HISTORY_AT,
  });

  let middleArtifact: ThreadArtifact | undefined;
  let middleRequirement: TracedRequirement | undefined;
  let middleCapture: ReturnType<typeof recaptureRequirementsCapture> | undefined;
  let middleFp: ContentFingerprint | undefined;
  if (hops === 2) {
    middleCapture = recaptureRequirementsCapture({
      architecture: midArch,
      predecessor: oldestArtifact,
      writeCapture,
      runId: "run:requirements-recapture-mid",
      snapshotId: "thread:id01:r90",
      revision: 90,
      capturedAt: "2026-09-10T12:00:00.000Z",
    });
    middleFp = await sha256Fingerprint(middleCapture);
    middleArtifact = requirementsArtifact({
      fingerprint: middleFp,
      producerTool: "syson_constraint_extract",
      runId: "run:requirements-recapture-mid",
      inputs: [midArch.id, oldestArtifact.id],
    });
    middleRequirement = tracedRequirement({
      digest: middleFp.digest,
      sourceArtifactId: requirementsArtifactId(
        HISTORY_CONTAINER,
        middleFp.digest,
      ),
      architectureId: midArch.id,
      changedAt: "2026-09-10T12:00:00.000Z",
    });
  }

  const immediatePredecessorArtifact = middleArtifact ?? oldestArtifact;
  const immediatePredecessorRequirement = middleRequirement ?? oldestRequirement;
  const recaptureCapture = recaptureRequirementsCapture({
    architecture: fault === "disconnected-architecture"
      ? architectureArtifact("f".repeat(64), "run:architecture-missing")
      : newArch,
    predecessor: immediatePredecessorArtifact,
    writeCapture,
    runId: "run:requirements-recapture",
    snapshotId: "thread:id01:r98",
    revision: 98,
    capturedAt: HISTORY_EVALUATED_AT,
  });
  const currentFp = await sha256Fingerprint(recaptureCapture);
  const currentCaptureId = requirementsArtifactId(
    HISTORY_CONTAINER,
    currentFp.digest,
  );
  const currentArtifact = requirementsArtifact({
    fingerprint: currentFp,
    producerTool: "syson_constraint_extract",
    runId: "run:requirements-recapture",
    inputs: [newArch.id, immediatePredecessorArtifact.id],
  });
  const currentRequirement = tracedRequirement({
    digest: currentFp.digest,
    sourceArtifactId: currentCaptureId,
    architectureId: newArch.id,
    changedAt: HISTORY_EVALUATED_AT,
  });

  const solver = solverArtifact(SOLVER_DIGEST, "run:fea-historical");
  const feaEvidence = feaEvidenceArtifact(
    FEA_EVIDENCE_DIGEST,
    "run:fea-historical",
  );
  const observationSourceIds = fault === "duplicate-observation-source"
    ? [solver.id, solver.id]
    : fault === "missing-observation-source"
    ? [solver.id, "solver-evidence-missing"]
    : [solver.id, feaEvidence.id];
  const observation = historicalObservation(observationSourceIds);
  const evaluation = historicalEvaluation({
    id: "eval-von-mises-historical",
    requirementId: oldestRequirement.id,
    evidenceId: solver.id,
    observationIds: [observation.id],
    status: "pass",
    evaluatedAt: HISTORY_EVALUATED_AT,
    runId: "run:fea-historical",
  });
  const extraEvaluation = historicalEvaluation({
    id: fault === "duplicate-evaluation-id"
      ? evaluation.id
      : "eval-von-mises-historical-other",
    requirementId: immediatePredecessorRequirement.id,
    evidenceId: solver.id,
    observationIds: [observation.id],
    status: "pass",
    evaluatedAt: "2026-09-11T10:00:00.000Z",
    runId: "run:fea-historical-other",
  });
  const failEvaluation = historicalEvaluation({
    id: "eval-von-mises-historical-fail",
    requirementId: immediatePredecessorRequirement.id,
    evidenceId: solver.id,
    observationIds: [observation.id],
    status: "fail",
    evaluatedAt: "2026-09-11T08:00:00.000Z",
    runId: "run:fea-historical-fail",
  });
  const middleEvaluation = middleRequirement
    ? historicalEvaluation({
      id: "eval-von-mises-middle",
      requirementId: middleRequirement.id,
      evidenceId: solver.id,
      observationIds: [observation.id],
      status: "pass",
      evaluatedAt: "2026-09-10T15:00:00.000Z",
      runId: "run:fea-middle",
    })
    : undefined;

  const currentSolver = solverArtifact(
    CURRENT_SOLVER_DIGEST,
    "run:fea-current",
  );
  const currentObservation: ThreadObservation = {
    ...historicalObservation([currentSolver.id]),
    id: "obs-von-mises-current",
    source: {
      ...historicalObservation([currentSolver.id]).source,
      operation: {
        serverId: "calculix",
        tool: "verify.run-fea-static-proof@3",
        runId: "run:fea-current",
      },
      capturedAt: CURRENT_EVALUATED_AT,
    },
    freshness: {
      status: "fresh",
      changedAt: CURRENT_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
  const currentEvaluation = historicalEvaluation({
    id: "eval-von-mises-current",
    requirementId: currentRequirement.id,
    evidenceId: currentSolver.id,
    observationIds: [currentObservation.id],
    status: currentVerdict === "fail" ? "fail" : "pass",
    evaluatedAt: CURRENT_EVALUATED_AT,
    runId: "run:fea-current",
  });

  const measuredSensitivity = sensitivity !== "none" &&
      sensitivity !== "unexecuted-case"
    ? await buildMeasuredSensitivity({
      predecessor: immediatePredecessorRequirement,
      fault: sensitivity,
    })
    : undefined;
  const unexecutedCase = sensitivity === "unexecuted-case"
    ? await buildUnexecutedCase()
    : undefined;
  const newerCase = options.newerSensitivityCase
    ? await buildUnexecutedCase("newer")
    : undefined;

  const capturesByDigest = new Map<string, string>([
    [oldestFp.digest, deterministicJson(writeCapture)],
    [currentFp.digest, deterministicJson(recaptureCapture)],
    ...(middleFp && middleCapture
      ? [[middleFp.digest, deterministicJson(middleCapture)] as const]
      : []),
    ...(measuredSensitivity?.captures ?? []),
    ...(unexecutedCase?.captures ?? []),
    ...(newerCase?.captures ?? []),
  ]);
  if (fault === "second-hop-missing-cas") {
    capturesByDigest.delete(oldestFp.digest);
  }

  const evaluations: RequirementEvaluation[] = [
    evaluation,
    ...(options.extraPredecessorEvaluation ||
        fault === "duplicate-evaluation-id"
      ? [extraEvaluation]
      : []),
    ...(options.extraPredecessorFail ? [failEvaluation] : []),
    ...(middleEvaluation ? [middleEvaluation] : []),
    ...(currentVerdict !== "unresolved" ? [currentEvaluation] : []),
    ...(measuredSensitivity?.evaluation ? [measuredSensitivity.evaluation] : []),
  ];
  const observations: ThreadObservation[] = [
    observation,
    ...(currentVerdict !== "unresolved" ? [currentObservation] : []),
    ...(measuredSensitivity?.observation ? [measuredSensitivity.observation] : []),
  ];
  const artifacts: ThreadArtifact[] = [
    oldArch,
    newArch,
    ...(hops === 2 ? [midArch] : []),
    oldestArtifact,
    ...(middleArtifact ? [middleArtifact] : []),
    currentArtifact,
    solver,
    feaEvidence,
    ...(currentVerdict !== "unresolved" ? [currentSolver] : []),
    ...(measuredSensitivity?.artifacts ?? []),
    ...(unexecutedCase?.artifacts ?? []),
    ...(newerCase?.artifacts ?? []),
  ];
  const requirements = [
    oldestRequirement,
    ...(middleRequirement ? [middleRequirement] : []),
    currentRequirement,
  ];
  const provenance: ThreadProvenanceLink[] = [
    supersedes(
      currentRequirement.id,
      fault === "missing-predecessor"
        ? "requirement-missing"
        : immediatePredecessorRequirement.id,
    ),
    ...(middleRequirement
      ? [supersedes(middleRequirement.id, oldestRequirement.id)]
      : []),
    ...(fault === "ambiguous-supersedes"
      ? [supersedes(currentRequirement.id, "requirement-decoy")]
      : []),
    ...(fault === "cyclic-supersedes"
      ? [supersedes(immediatePredecessorRequirement.id, currentRequirement.id)]
      : []),
  ];
  const archivedEvaluations = [
    evaluation.id,
    ...(options.extraPredecessorEvaluation ||
        fault === "duplicate-evaluation-id"
      ? [extraEvaluation.id]
      : []),
    ...(options.extraPredecessorFail ? [failEvaluation.id] : []),
    ...(middleEvaluation ? [middleEvaluation.id] : []),
    ...(measuredSensitivity?.evaluation ? [measuredSensitivity.evaluation.id] : []),
  ];

  const thread: ThreadSnapshot = {
    schemaVersion: measuredSensitivity?.analysisGraph || newerCase ? "1.1" : "1.0",
    id: "thread:id01:r108",
    revision: 108,
    generatedAt: HISTORY_EVALUATED_AT,
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
    subject: {
      id: HISTORY_SUBJECT,
      name: "Inspection drone",
      kind: "system",
      version: "1",
      modelArtifactId: newArch.id,
    },
    changeSet: {
      id: "changes-r108",
      name: "Recapture requirements",
      status: "applied",
      createdAt: HISTORY_EVALUATED_AT,
      appliedAt: HISTORY_EVALUATED_AT,
      changes: [
        archive("requirement", oldestRequirement.id),
        ...(middleRequirement ? [archive("requirement", middleRequirement.id)] : []),
        ...archivedEvaluations.map((id) => archive("evaluation", id)),
      ],
    },
    artifacts,
    consumptions: [],
    observations,
    requirements,
    evaluations,
    violations: [],
    provenance,
    proposedActions: [],
    ...(measuredSensitivity?.analysisGraph
      ? { analysisGraph: measuredSensitivity.analysisGraph }
      : {}),
  };
  return {
    thread,
    captures: {
      read: (fingerprint: ContentFingerprint) => {
        if (fault === "missing-cas") return Promise.resolve(undefined);
        if (fault === "corrupt-cas") return Promise.resolve("{not-a-capture}");
        if (
          sensitivity === "missing-capture" &&
          fingerprint.digest === measuredSensitivity?.studyFingerprint.digest
        ) {
          return Promise.resolve(undefined);
        }
        return Promise.resolve(capturesByDigest.get(fingerprint.digest));
      },
    },
    currentRequirementId: currentRequirement.id,
    predecessorRequirementId: immediatePredecessorRequirement.id,
    middleRequirementId: middleRequirement?.id,
    evaluationId: hops === 2 && middleEvaluation ? middleEvaluation.id : evaluation.id,
    extraEvaluationId: options.extraPredecessorEvaluation
      ? extraEvaluation.id
      : undefined,
    failEvaluationId: options.extraPredecessorFail ? failEvaluation.id : undefined,
    studyBaseEvaluationId: measuredSensitivity?.evaluation?.id,
    observationId: observation.id,
    observationSourceIds,
    evidenceId: solver.id,
    feaEvidenceId: feaEvidence.id,
    currentCaptureId,
    predecessorCaptureId: immediatePredecessorArtifact.id,
    currentArchitectureId: newArch.id,
    predecessorArchitectureId: hops === 2 ? midArch.id : oldArch.id,
    studyArtifactId: measuredSensitivity?.studyArtifactId,
    studyCaseArtifactId: measuredSensitivity?.caseArtifactId ??
      unexecutedCase?.caseArtifactId ?? newerCase?.caseArtifactId,
    baseEvaluationArtifactId: measuredSensitivity?.baseEvaluationArtifactId,
    caseDigest: measuredSensitivity?.caseDigest,
  };
}

function writeRequirementsCapture(input: {
  readonly architecture: ThreadArtifact;
  readonly targetElementId: string;
  readonly constraintId: string;
  readonly limit: number;
}) {
  return {
    schemaVersion: "requirements-capture/3.0",
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements-write",
    containerComponent: HISTORY_CONTAINER,
    partDefName: "CameraMountBracketRequirements",
    target: {
      kind: "part-definition",
      label: "CameraMountBracket",
      elementId: input.targetElementId,
    },
    architectureBasis: {
      snapshotId: "thread:id01:r85",
      revision: 85,
      fingerprint: OLD_ARCH_DIGEST,
    },
    requirements: [oracleRequirement(input.limit)],
    seed: {
      artifactId: "syson-model-seed-" + "e".repeat(64),
      fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      producerRunId: "run:seed",
    },
    architecture: artifactRef(input.architecture),
    requirementsElementId: HISTORY_USAGE,
    requirementUsage: { id: HISTORY_USAGE, kind: "RequirementUsage" },
    constraintUsages: [constraintUsage(input.constraintId)],
    insertedAt: HISTORY_AT,
  };
}

function recaptureRequirementsCapture(input: {
  readonly architecture: ThreadArtifact;
  readonly predecessor: ThreadArtifact;
  readonly writeCapture: ReturnType<typeof writeRequirementsCapture>;
  readonly runId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly capturedAt: string;
}) {
  return {
    schemaVersion: "requirements-capture/4.0",
    operation: { id: "model.recapture-requirements", version: "1" },
    trustedRunId: input.runId,
    containerComponent: HISTORY_CONTAINER,
    partDefName: input.writeCapture.partDefName,
    target: {
      kind: "part-definition",
      label: "CameraMountBracket",
      elementId: HISTORY_TARGET,
    },
    architectureBasis: {
      snapshotId: input.snapshotId,
      revision: input.revision,
      fingerprint: input.architecture.fingerprint.digest,
    },
    requirements: [oracleRequirement(120_000_000)],
    seed: input.writeCapture.seed,
    architecture: artifactRef(input.architecture),
    predecessor: artifactRef(input.predecessor),
    requirementsElementId: HISTORY_USAGE,
    requirementUsage: { id: HISTORY_USAGE, kind: "RequirementUsage" },
    constraintUsages: [constraintUsage(HISTORY_CONSTRAINT)],
    capturedAt: input.capturedAt,
    subject: {
      id: "reference-usage-camera-target",
      kind: "ReferenceUsage",
      name: "target",
    },
  };
}

function oracleRequirement(limit: number) {
  return {
    id: HISTORY_METRIC_ID,
    name: "Maximum von Mises",
    metric: HISTORY_METRIC,
    operator: "<=" as const,
    limit: { value: limit, unit: "Pa" },
  };
}

function constraintUsage(id: string) {
  return {
    requirementId: HISTORY_METRIC_ID,
    id,
    kind: "ConstraintUsage" as const,
    sourceId: id,
  };
}

function tracedRequirement(input: {
  readonly digest: string;
  readonly sourceArtifactId: string;
  readonly architectureId: string;
  readonly changedAt: string;
}): TracedRequirement {
  return {
    id: `requirement-${input.digest}-${HISTORY_METRIC_ID}`,
    name: "Maximum von Mises",
    statement: "Maximum von Mises: max_von_mises_pa <= 120000000 Pa.",
    version: input.digest,
    criterion: {
      metric: HISTORY_METRIC,
      operator: "<=",
      limit: { value: 120_000_000, unit: "Pa" },
    },
    trace: {
      sourceArtifactId: input.sourceArtifactId,
      elementId: HISTORY_USAGE,
      targetArtifactIds: [input.architectureId],
    },
    freshness: {
      status: "fresh",
      changedAt: input.changedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function historicalObservation(
  artifactIds: readonly string[],
): ThreadObservation {
  return {
    id: "obs-von-mises-historical",
    name: "max von Mises",
    metric: HISTORY_METRIC,
    quantity: { value: 7638, unit: "Pa" },
    source: {
      operation: {
        serverId: "calculix",
        tool: "verify.run-fea-static-proof@3",
        runId: "run:fea-historical",
      },
      artifactIds: [...artifactIds],
      capturedAt: HISTORY_EVALUATED_AT,
    },
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function historicalEvaluation(input: {
  readonly id: string;
  readonly requirementId: string;
  readonly evidenceId: string;
  readonly observationIds: readonly string[];
  readonly status: "pass" | "fail" | "unresolved";
  readonly evaluatedAt: string;
  readonly runId: string;
}): RequirementEvaluation {
  return {
    id: input.id,
    name: "max von Mises",
    requirementId: input.requirementId,
    observationIds: [...input.observationIds],
    status: input.status,
    evaluatedAt: input.evaluatedAt,
    evaluator: {
      serverId: "syson",
      tool: "syson_constraint_extract",
      runId: input.runId,
    },
    evidenceArtifactIds: [input.evidenceId],
    message: "Recorded evaluation on a predecessor requirement.",
    freshness: {
      status: "fresh",
      changedAt: input.evaluatedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function architectureArtifact(digest: string, runId: string): ThreadArtifact {
  return {
    id: `architecture-${digest}`,
    name: "Architecture",
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function requirementsArtifact(input: {
  readonly fingerprint: ContentFingerprint;
  readonly producerTool: string;
  readonly runId: string;
  readonly inputs: readonly string[];
}): ThreadArtifact {
  return {
    id: requirementsArtifactId(HISTORY_CONTAINER, input.fingerprint.digest),
    name: `Requirements: ${HISTORY_CONTAINER}`,
    kind: "sysml-model",
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    uri: requirementsUriFor(HISTORY_CONTAINER, input.fingerprint),
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: input.producerTool,
      runId: input.runId,
    },
    inputArtifactIds: [...input.inputs],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function feaEvidenceArtifact(digest: string, runId: string): ThreadArtifact {
  return {
    id: `solver-evidence-${digest}`,
    name: "Historical FEA evidence",
    kind: "evidence",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://solver-evidence/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "calculix",
      tool: "verify.run-fea-static-proof@3",
      runId,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function solverArtifact(digest: string, runId: string): ThreadArtifact {
  return {
    id: `solver-result-${digest}`,
    name: "Historical FEA result",
    kind: "solver-result",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://solver-result/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "calculix",
      tool: "verify.run-fea-static-proof@3",
      runId,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function artifactRef(artifact: ThreadArtifact) {
  return {
    artifactId: artifact.id,
    fingerprint: artifact.fingerprint,
    producerRunId: artifact.producer.runId,
  };
}

function archive(
  kind: "requirement" | "evaluation",
  id: string,
) {
  return {
    id: `archive-${kind}-${id}`,
    kind: "archived" as const,
    target: { kind, id },
    summary: `Retired ${kind} ${id}.`,
  };
}

function supersedes(fromId: string, toId: string): ThreadProvenanceLink {
  return {
    id: `supersedes-${toId}-by-${fromId}`,
    relation: "supersedes",
    from: { kind: "requirement", id: fromId },
    to: { kind: "requirement", id: toId },
    rationale:
      "This recapture projection replaces the prior capture version of the same unchanged metric.",
  };
}

function historyStudyCase() {
  return validateSensitivityStudyCaseV3({
    schemaVersion: "sensitivity-study-case/3.0",
    id: "id01-radial-arm-height-isolated",
    revision: 1,
    scope: "mechanical-structural",
    evidenceBoundary: "fea-static",
    project: { id: "project-id01", subjectId: HISTORY_SUBJECT },
    target: { componentKey: "RadialArm", semanticKey: "arm_height" },
    cadSource: {
      artifactUri: "thread-artifact://project-id01/admission",
      sha256: "33".repeat(32),
    },
    baseValue: SENSITIVITY_BASE_VALUE,
    step: SENSITIVITY_STEP,
    metrics: [{ id: HISTORY_METRIC, unit: "Pa" }],
    method: {
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 69000,
        nu: 0.33,
        basis: "fixture",
      },
      supports: [{
        id: "support",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [0, 0, 0], max: [1, 1, 1], unit: "mm" },
        },
      }],
      loads: [{
        id: "load",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [2, 2, 2], max: [3, 3, 3], unit: "mm" },
        },
        force: { value: [0, 0, -1], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "fixture",
      limitations: ["fixture"],
    },
  });
}

async function buildMeasuredSensitivity(input: {
  readonly predecessor: TracedRequirement;
  readonly fault: Exclude<
    RequirementsHistorySensitivity,
    "none" | "unexecuted-case"
  >;
}) {
  const studyCase = historyStudyCase();
  const caseDigest = (await sha256Fingerprint(studyCase)).digest;
  const measurements = {
    base: [{
      metric: HISTORY_METRIC,
      value: SENSITIVITY_RESPONSE_BASE.value,
      unit: SENSITIVITY_RESPONSE_BASE.unit,
    }],
    stepped: [{
      metric: HISTORY_METRIC,
      value: SENSITIVITY_RESPONSE_STEPPED.value,
      unit: SENSITIVITY_RESPONSE_STEPPED.unit,
    }],
  };
  const derivatives = computeSensitivities(
    studyCase,
    new Map([[HISTORY_METRIC, SENSITIVITY_RESPONSE_BASE]]),
    new Map([[HISTORY_METRIC, SENSITIVITY_RESPONSE_STEPPED]]),
  );
  const studyCapture = await validateSensitivityStudyCapture({
    schemaVersion: "sensitivity-study-capture/1.0",
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run:sensitivity-historical",
    caseDigest,
    studyCase,
    cad: {
      base: {
        executionRunId: "cad-base",
        sourceSha256: "44".repeat(32),
        stepSha256: "55".repeat(32),
        stepBytes: 1,
      },
      stepped: {
        executionRunId: "cad-step",
        sourceSha256: "66".repeat(32),
        stepSha256: "77".repeat(32),
        stepBytes: 1,
      },
    },
    measurements,
    derivatives,
    capturedAt: HISTORY_EVALUATED_AT,
  });
  const studyFingerprint = await sha256Fingerprint(studyCapture);
  const studyArtifactId = `sensitivity-study-${studyFingerprint.digest}`;
  const studyArtifact: ThreadArtifact = {
    id: studyArtifactId,
    name: "Historical sensitivity study",
    kind: "evidence",
    version: studyFingerprint.digest,
    fingerprint: studyFingerprint,
    uri: `${SENSITIVITY_STUDY_CAPTURE_URI_PREFIX}${studyFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "calculix",
      tool: "analyze.run-fea-sensitivity@1",
      runId: "run:sensitivity-historical",
    },
    inputArtifactIds: [`sensitivity-case-${caseDigest}`],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
  const caseCapture = await validateSensitivityStudyCaseCapture({
    schemaVersion: "sensitivity-study-case-capture/1.0",
    operation: { id: "analyze.seal-sensitivity-study", version: "1" },
    trustedRunId: "run:sensitivity-case-historical",
    caseDigest,
    canonicalCaseText: deterministicJson(studyCase),
    studyCase,
    admissionArtifact: {
      id: "admission-fixture",
      fingerprint: { algorithm: "sha256", digest: "33".repeat(32) },
    },
    sealedAt: HISTORY_AT,
  });
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const caseArtifact: ThreadArtifact = {
    id: `sensitivity-case-${caseDigest}`,
    name: "Historical sensitivity case",
    kind: "evidence",
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "casys",
      tool: "analyze.seal-sensitivity-study@1",
      runId: "run:sensitivity-case-historical",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_AT,
      invalidatedByChangeIds: [],
    },
  };
  const baseEvaluationCapture = validateSensitivityBaseEvaluationCapture({
    schemaVersion: "sensitivity-base-evaluation-capture/1.0",
    operation: { id: "verify.evaluate-sensitivity-base", version: "1" },
    studyDigest: studyFingerprint.digest,
    request: { name: "syson_constraint_evaluate", arguments: { name: "eval" } },
    response: { structuredContent: { status: "pass" } },
  });
  const baseEvaluationFingerprint = await sha256Fingerprint(
    baseEvaluationCapture,
  );
  const baseEvaluationArtifactId =
    `sensitivity-base-evaluation-${baseEvaluationFingerprint.digest}`;
  const baseEvaluationArtifact: ThreadArtifact = {
    id: baseEvaluationArtifactId,
    name: "Historical study-base evaluation",
    kind: "evidence",
    version: baseEvaluationFingerprint.digest,
    fingerprint: baseEvaluationFingerprint,
    uri:
      `casys://sensitivity-base-evaluation-capture/sha256/${baseEvaluationFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "verify.evaluate-sensitivity-base@1",
      runId: "run:sensitivity-base-historical",
    },
    inputArtifactIds: [studyArtifactId],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
  const observationId = sensitivityBaseObservationId(
    HISTORY_METRIC,
    studyFingerprint.digest,
  );
  const observation: ThreadObservation = {
    id: observationId,
    name: "study-base max von Mises",
    metric: HISTORY_METRIC,
    quantity: input.fault === "wrong-unit"
      ? { value: SENSITIVITY_RESPONSE_BASE.value, unit: "MPa" }
      : { ...SENSITIVITY_RESPONSE_BASE },
    source: {
      operation: {
        serverId: "calculix",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run:sensitivity-historical",
      },
      artifactIds: [studyArtifactId],
      capturedAt: HISTORY_EVALUATED_AT,
    },
    freshness: {
      status: "fresh",
      changedAt: HISTORY_EVALUATED_AT,
      invalidatedByChangeIds: [],
    },
  };
  const evaluation: RequirementEvaluation = {
    id: `eval-study-base-historical`,
    name: "study-base max von Mises",
    requirementId: input.predecessor.id,
    observationIds: [observationId],
    status: "pass",
    evaluatedAt: "2026-09-11T11:00:00.000Z",
    evaluator: {
      serverId: "syson",
      tool: "verify.evaluate-sensitivity-base@1",
      runId: "run:sensitivity-base-historical",
    },
    evidenceArtifactIds: [baseEvaluationArtifactId],
    message: "Historical study-base evaluation.",
    freshness: {
      status: "fresh",
      changedAt: "2026-09-11T11:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
  const analysisGraph: AnalysisGraph = buildSensitivityAnalysisGraph({
    caseFingerprint: { algorithm: "sha256", digest: caseDigest },
    sensitivityCase: studyCase,
    baseMetrics: new Map([[HISTORY_METRIC, SENSITIVITY_RESPONSE_BASE]]),
    steppedMetrics: new Map([[HISTORY_METRIC, SENSITIVITY_RESPONSE_STEPPED]]),
    evidence: {
      capture: {
        id: studyArtifactId,
        fingerprint: input.fault === "wrong-digest"
          ? { algorithm: "sha256", digest: "99".repeat(32) }
          : studyFingerprint,
      },
    },
  });
  return {
    artifacts: [studyArtifact, caseArtifact, baseEvaluationArtifact],
    captures: [
      [studyFingerprint.digest, deterministicJson(studyCapture)],
      [caseFingerprint.digest, deterministicJson(caseCapture)],
      [baseEvaluationFingerprint.digest, deterministicJson(baseEvaluationCapture)],
    ] as const,
    observation,
    evaluation,
    analysisGraph,
    studyArtifactId,
    caseArtifactId: caseArtifact.id,
    baseEvaluationArtifactId,
    caseDigest,
    studyFingerprint,
  };
}

async function buildUnexecutedCase(tag = "unexecuted") {
  const studyCase = validateSensitivityStudyCaseV3({
    ...historyStudyCase(),
    id: `${historyStudyCase().id}-${tag}`,
    revision: tag === "newer" ? 2 : 1,
  });
  const caseDigest = (await sha256Fingerprint(studyCase)).digest;
  const caseCapture = await validateSensitivityStudyCaseCapture({
    schemaVersion: "sensitivity-study-case-capture/1.0",
    operation: { id: "analyze.seal-sensitivity-study", version: "1" },
    trustedRunId: `run:sensitivity-case-${tag}`,
    caseDigest,
    canonicalCaseText: deterministicJson(studyCase),
    studyCase,
    admissionArtifact: {
      id: "admission-fixture",
      fingerprint: { algorithm: "sha256", digest: "33".repeat(32) },
    },
    sealedAt: HISTORY_AT,
  });
  const caseFingerprint = await sha256Fingerprint(caseCapture);
  const caseArtifact: ThreadArtifact = {
    id: `sensitivity-case-${caseDigest}`,
    name: `Sensitivity case ${tag}`,
    kind: "evidence",
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "casys",
      tool: "analyze.seal-sensitivity-study@1",
      runId: `run:sensitivity-case-${tag}`,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: HISTORY_AT,
      invalidatedByChangeIds: [],
    },
  };
  return {
    artifacts: [caseArtifact],
    captures: [
      [caseFingerprint.digest, deterministicJson(caseCapture)],
    ] as const,
    caseArtifactId: caseArtifact.id,
  };
}
