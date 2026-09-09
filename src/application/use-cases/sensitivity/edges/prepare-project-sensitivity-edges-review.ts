/**
 * Reopen a completed sensitivity result and compile a paste-ready, typed MRTR
 * route for the server-rendered SysON edge writer.
 */

import type {
  ProjectSensitivityEdgesReviewCommand,
  ProjectSensitivityEdgesReviewResult,
  ProjectSensitivityEdgesReviewUseCase,
} from "../../../ports/in/sensitivity/edges/project-sensitivity-edges-review.ts";
import {
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  reconstructSensitivityEdgesFromStudyCapture,
  sensitivityPartDefName,
} from "../../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "../../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type {
  FeaReviewProjectReader,
  FeaReviewSnapshotStore,
} from "../../fea/seal-case/fea-review-support.ts";
import {
  compileSensitivityConsumerNext,
  openSensitivityConsumerReview,
  type SensitivityStudyCaptureReader,
} from "../project-sensitivity-consumer-review-support.ts";

export interface PrepareProjectSensitivityEdgesReviewDependencies {
  readonly projects: FeaReviewProjectReader;
  readonly snapshots: FeaReviewSnapshotStore;
  readonly studyCaptures: SensitivityStudyCaptureReader;
  readonly hasArchitecture: (snapshot: ThreadSnapshot) => boolean;
}

export class PrepareProjectSensitivityEdgesReview
  implements ProjectSensitivityEdgesReviewUseCase {
  constructor(
    private readonly dependencies: PrepareProjectSensitivityEdgesReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectSensitivityEdgesReviewResult> {
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
    try {
      if (!this.dependencies.hasArchitecture(opened.snapshot)) {
        return unresolved(
          "architecture-unavailable",
          "No active generic architecture exists on the exact Thread basis.",
          "Author or recross an active generic architecture before writing sensitivity edges.",
        );
      }
    } catch (error) {
      return unresolved(
        "architecture-unavailable",
        error instanceof Error
          ? error.message
          : "The active generic architecture could not be resolved.",
        "Resolve the architecture lineage before writing sensitivity edges.",
      );
    }
    const edges = reconstructSensitivityEdgesFromStudyCapture(opened.capture);
    const partDefName = sensitivityPartDefName(opened.capture.studyCase.id);
    const compiled = compileSensitivityConsumerNext({
      opened,
      operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
      role: "edges",
      phaseName: "Write sensitivity relations",
      phaseDescription:
        "Render the exact measured local sensitivity relations server-side and insert them beneath the existing SysON root package.",
      decisionTitle: "Approve sensitivity-edge write",
      decisionQuestion:
        "Approve writing the server-derived local sensitivity relations from this exact study result into SysON?",
      summary:
        `Write ${edges.length} server-derived local sensitivity relation(s) from ${opened.artifact.id}; no agent-authored SysML or numerical value is accepted.`,
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
      partDefName,
      edges,
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

function parseCommand(value: unknown): ProjectSensitivityEdgesReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "basis", "studyArtifactId"],
    "$sensitivityEdgesReview",
  );
  const basis = exactRecord(
    root.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$sensitivityEdgesReview.basis",
  );
  literalValue(
    basis.kind,
    "thread-snapshot",
    "$sensitivityEdgesReview.basis.kind",
  );
  return {
    projectId: safeId(root.projectId, "$sensitivityEdgesReview.projectId"),
    basis: {
      kind: "thread-snapshot",
      snapshotId: safeId(
        basis.snapshotId,
        "$sensitivityEdgesReview.basis.snapshotId",
      ),
      revision: positiveInteger(
        basis.revision,
        "$sensitivityEdgesReview.basis.revision",
      ),
      subjectId: safeId(
        basis.subjectId,
        "$sensitivityEdgesReview.basis.subjectId",
      ),
    },
    studyArtifactId: safeId(
      root.studyArtifactId,
      "$sensitivityEdgesReview.studyArtifactId",
    ),
  };
}

function unresolved(
  code: string,
  message: string,
  recovery: string,
): ProjectSensitivityEdgesReviewResult {
  return {
    status: "unresolved",
    error: { code, context: { message }, recovery },
  };
}
