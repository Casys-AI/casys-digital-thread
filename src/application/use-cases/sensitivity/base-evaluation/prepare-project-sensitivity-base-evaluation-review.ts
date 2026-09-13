/**
 * Provider-free check that study-base observations can join Thread
 * requirements. It does not evaluate and does not invent a mapping.
 */

import type {
  ProjectSensitivityBaseEvaluationReviewCommand,
  ProjectSensitivityBaseEvaluationReviewResult,
  ProjectSensitivityBaseEvaluationReviewUseCase,
} from "../../../ports/in/sensitivity/base-evaluation/project-sensitivity-base-evaluation-review.ts";
import { resolveSensitivityBaseJoin } from "../../../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
} from "../../../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type {
  FeaReviewProjectReader,
  FeaReviewSnapshotStore,
} from "../../fea/seal-case/fea-review-support.ts";
import {
  compileSensitivityConsumerNext,
  openSensitivityConsumerReview,
  type SensitivityStudyCaptureReader,
} from "../project-sensitivity-consumer-review-support.ts";

export class ProjectSensitivityBaseEvaluationReviewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProjectSensitivityBaseEvaluationReviewError";
  }
}

export interface PrepareProjectSensitivityBaseEvaluationReviewDependencies {
  readonly projects: FeaReviewProjectReader;
  readonly snapshots: FeaReviewSnapshotStore;
  readonly studyCaptures: SensitivityStudyCaptureReader;
}

export class PrepareProjectSensitivityBaseEvaluationReview
  implements ProjectSensitivityBaseEvaluationReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectSensitivityBaseEvaluationReviewDependencies,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectSensitivityBaseEvaluationReviewResult> {
    const command = parseCommand(value);
    const opened = await openSensitivityConsumerReview({
      ...command,
      projects: this.dependencies.projects,
      snapshots: this.dependencies.snapshots,
      studyCaptures: this.dependencies.studyCaptures,
    });
    if (opened.status !== "ok") {
      return unresolved(
        opened.diagnostic.code,
        opened.diagnostic.message,
        opened.diagnostic.recovery,
      );
    }
    const join = resolveSensitivityBaseJoin({
      capture: opened.capture,
      digest: opened.artifact.fingerprint.digest,
      observations: opened.snapshot.observations,
      requirements: opened.snapshot.requirements,
    });
    if (join.status !== "resolved") {
      return unresolved(join.reason, join.detail, recoveryFor(join.reason));
    }
    const compiled = compileSensitivityConsumerNext({
      opened,
      operation: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
      role: "base-evaluation",
      phaseName: "Evaluate sensitivity study base",
      phaseDescription:
        "Join the exact study-base observation to the same-metric Thread requirement and ask SysON for a verdict.",
      decisionTitle: "Approve sensitivity-base evaluation",
      decisionQuestion:
        "Approve evaluating the exact sensitivity-study base observation against its same-metric Thread requirement?",
      summary:
        `Evaluate the base observations from ${opened.artifact.id} without a metric alias or solver rerun.`,
    });
    if (compiled.status !== "ready") {
      return unresolved(
        compiled.diagnostic.code,
        compiled.diagnostic.message,
        compiled.diagnostic.recovery,
      );
    }
    return {
      status: "ready-for-review",
      projectId: command.projectId,
      basis: opened.basis,
      studyArtifactId: opened.artifact.id,
      metrics: join.pairs.map((pair) => pair.metricId),
      selected: {
        workItemId: compiled.workItemId,
        decisionId: compiled.decisionId,
      },
      admission: compiled.admission,
      decisionParameters: compiled.decisionParameters,
      next: compiled.next,
      grants: "none",
    };
  }
}

function recoveryFor(reason: string): string {
  if (reason === "study-metric-unlinked" || reason === "requirement-not-unique") {
    return "Seal a study whose metric ids match the Thread requirements exactly. Do not invent a mapping.";
  }
  if (reason === "observation-unlinked" || reason === "observation-not-fresh") {
    return "Run analyze.run-fea-sensitivity@1 on this exact study and persist the capture.";
  }
  return "Keep the study-base observation Object.is-equal to the capture measurement.";
}

function unresolved(
  code: string,
  message: string,
  recovery: string,
): ProjectSensitivityBaseEvaluationReviewResult {
  return {
    status: "unresolved",
    error: { code, context: { message }, recovery },
  };
}

function parseCommand(
  value: unknown,
): ProjectSensitivityBaseEvaluationReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "basis", "studyArtifactId"],
    "$review",
  );
  const basis = exactRecord(
    root.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$review.basis",
  );
  literalValue(basis.kind, "thread-snapshot", "$review.basis.kind");
  return {
    projectId: safeId(root.projectId, "$review.projectId"),
    studyArtifactId: safeId(root.studyArtifactId, "$review.studyArtifactId"),
    basis: {
      kind: "thread-snapshot",
      snapshotId: safeId(basis.snapshotId, "$review.basis.snapshotId"),
      revision: positiveInteger(basis.revision, "$review.basis.revision"),
      subjectId: safeId(basis.subjectId, "$review.basis.subjectId"),
    },
  };
}
