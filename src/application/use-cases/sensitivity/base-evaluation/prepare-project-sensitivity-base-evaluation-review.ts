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
  type SensitivityStudyResult,
  validateSensitivityStudyResult,
} from "../../../../domain/sensitivity/study/sensitivity-study-result.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export class ProjectSensitivityBaseEvaluationReviewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProjectSensitivityBaseEvaluationReviewError";
  }
}

export interface PrepareProjectSensitivityBaseEvaluationReviewDependencies {
  readonly snapshots: ThreadSnapshotStore;
  readonly studyCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
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
    const snapshot = await readSnapshot(
      this.dependencies.snapshots,
      command.basis,
    );
    const artifact = snapshot.artifacts.find((item) =>
      item.id === command.studyArtifactId
    );
    if (!artifact || artifact.freshness.status !== "fresh") {
      return unresolved(
        "capture_not_found",
        "The study capture artifact is absent or not fresh.",
        "Bind the exact sensitivity-study Thread artifact from this basis.",
      );
    }
    const text = await this.dependencies.studyCaptures.read(artifact.fingerprint);
    if (!text) {
      return unresolved(
        "capture_not_found",
        "The sensitivity-study capture is not readable.",
        "Re-run analyze.run-fea-sensitivity@1 and persist the capture.",
      );
    }
    let capture: SensitivityStudyResult;
    try {
      capture = await validateSensitivityStudyResult(JSON.parse(text));
    } catch {
      return unresolved(
        "capture_integrity_failed",
        "The sensitivity-study capture is not a valid 1.0 document.",
        "Do not repair the capture. Re-run the sealed study.",
      );
    }
    const join = resolveSensitivityBaseJoin({
      capture,
      digest: artifact.fingerprint.digest,
      observations: snapshot.observations,
      requirements: snapshot.requirements,
    });
    if (join.status !== "resolved") {
      return unresolved(join.reason, join.detail, recoveryFor(join.reason));
    }
    return deepFreeze({
      status: "ready-for-review",
      studyArtifactId: artifact.id,
      metrics: join.pairs.map((pair) => pair.metricId),
    });
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

async function readSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new ProjectSensitivityBaseEvaluationReviewError(
      "snapshot_not_found",
      "The exact Thread basis snapshot is not available.",
    );
  }
  return validateThreadSnapshot(snapshot);
}
