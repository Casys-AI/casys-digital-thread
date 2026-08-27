/**
 * Provider-free adapter for preparing a human admitted SPICE L5 review.
 *
 * The public input is exactly `projectId`. This implementation never accepts
 * a caller snapshot, sheet, capture, status, value, unit, SPICE text,
 * provider/tool/args, SysON envelope, consequence, or approval. An L4 pass
 * is never implicit L5: both accept and reject grammars are always derived.
 */

import type {
  ProjectAdmittedSpiceEvaluationCloseoutReviewRequest,
  ProjectAdmittedSpiceEvaluationCloseoutReviewResult,
  ProjectAdmittedSpiceEvaluationCloseoutReviewUseCase,
} from "../../../../application/ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-closeout-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { encodeSpiceAdmittedObservationEvaluationCloseoutAdmission } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { selectCurrentThreadTip } from "../../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../../../shared/stores/thread-snapshot-lineage.ts";
import {
  admittedSpiceEvaluationCloseoutAdmission,
  type AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies,
  AdmittedSpiceEvaluationCloseoutResolutionError,
  resolveAdmittedSpiceEvaluationCloseoutEvidence,
} from "./admitted-spice-observation-evaluation-closeout-evidence-resolver.ts";

export interface EvaluationCloseoutReviewSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectAdmittedSpiceEvaluationCloseoutReviewDependencies
  extends AdmittedSpiceEvaluationCloseoutEvidenceResolverDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: EvaluationCloseoutReviewSnapshotStore;
}

export class PrepareProjectAdmittedSpiceEvaluationCloseoutReview
  implements ProjectAdmittedSpiceEvaluationCloseoutReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectAdmittedSpiceEvaluationCloseoutReviewDependencies,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectAdmittedSpiceEvaluationCloseoutReviewResult> {
    let request: ProjectAdmittedSpiceEvaluationCloseoutReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      return unavailable(
        "invalid_request",
        "The admitted SPICE evaluation-closeout review request must name exactly one project.",
      );
    }
    const rawProject = await this.dependencies.projects.get(request.projectId);
    if (!rawProject) {
      return unavailable(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    let project;
    try {
      project = validateEngineeringProjectSnapshot(rawProject);
    } catch {
      return unresolved(
        "project_invalid",
        "The engineering project failed closed validation.",
      );
    }
    if (project.project.id !== request.projectId) {
      return unresolved(
        "project_mismatch",
        "The project reader did not return the requested project identity.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unavailable(tip.diagnostic.code, tip.diagnostic.message);
    }
    const basis = tip.basis;
    if (basis.subjectId !== project.project.subjectId) {
      return unresolved(
        "subject_mismatch",
        "The unique current Thread tip is foreign to the project subject.",
      );
    }
    const snapshot = await readExactSnapshot(
      this.dependencies.snapshots,
      basis.snapshotId,
    );
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      return unavailable(
        "snapshot_not_found",
        "The exact current Thread tip cannot be reopened.",
      );
    }
    try {
      await assertThreadSnapshotLineageIntact(
        snapshot,
        this.dependencies.snapshots,
      );
      const resolved = await resolveAdmittedSpiceEvaluationCloseoutEvidence(
        this.dependencies,
        { project, basis, snapshot },
      );
      const accept = admittedSpiceEvaluationCloseoutAdmission(resolved, "accept");
      const reject = admittedSpiceEvaluationCloseoutAdmission(resolved, "reject");
      return deepFreeze({
        status: "resolved" as const,
        selected: {
          basis: resolved.basis,
          capture: {
            id: resolved.captureArtifact.id,
            fingerprint: resolved.captureArtifact.fingerprint,
            producerRunId: resolved.captureArtifact.producer.runId,
            freshness: "fresh" as const,
          },
          sheet: resolved.sheet,
          evaluations: resolved.evaluations,
          limitations: resolved.limitations,
          accept: {
            admission: accept,
            decisionParameters:
              encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(accept),
          },
          reject: {
            admission: reject,
            decisionParameters:
              encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(reject),
          },
        },
      });
    } catch (error) {
      if (error instanceof AdmittedSpiceEvaluationCloseoutResolutionError) {
        return error.code === "not-found" || error.code === "stale"
          ? unavailable(error.code, error.message)
          : unresolved(error.code, error.message);
      }
      return unresolved(
        "recross_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function parseRequest(
  value: unknown,
): ProjectAdmittedSpiceEvaluationCloseoutReviewRequest {
  const root = exactRecord(
    value,
    ["projectId"],
    "$admittedSpiceEvaluationCloseoutReview",
  );
  return {
    projectId: safeId(
      root.projectId,
      "$admittedSpiceEvaluationCloseoutReview.projectId",
    ),
  };
}

async function readExactSnapshot(
  store: EvaluationCloseoutReviewSnapshotStore,
  id: string,
): Promise<ThreadSnapshot | undefined> {
  const snapshot = store.getFresh === undefined
    ? await store.get(id)
    : await store.getFresh(id);
  return snapshot === undefined ? undefined : validateThreadSnapshot(snapshot);
}

function unavailable(
  code: string,
  message: string,
): ProjectAdmittedSpiceEvaluationCloseoutReviewResult {
  return { status: "unavailable", diagnostic: { code, message } };
}

function unresolved(
  code: string,
  message: string,
): ProjectAdmittedSpiceEvaluationCloseoutReviewResult {
  return { status: "unresolved", diagnostic: { code, message } };
}
