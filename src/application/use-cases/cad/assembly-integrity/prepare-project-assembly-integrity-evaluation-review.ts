/**
 * Project-only MRTR preparation for the pending provider-free L4 evaluation.
 *
 * It does not append work, choose a gate, dispatch a provider, evaluate a
 * verdict for the caller, or publish evidence.  The manual L4 work append is
 * already authoritative; this use case only recrosses its unique current L3
 * dependency and turns that closed selection into exact signed parameters.
 */

import type {
  ProjectAssemblyIntegrityEvaluationReviewRequest,
  ProjectAssemblyIntegrityEvaluationReviewResult,
  ProjectAssemblyIntegrityEvaluationReviewUseCase,
} from "../../../ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  type AssemblyIntegrityEvaluationAdmission,
  encodeAssemblyIntegrityEvaluationAdmissionParameters,
  parseAssemblyIntegrityEvaluationAdmissionParameters,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-admission.ts";
import {
  evaluateAssemblyIntegrityWorkItemOperation,
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  assemblyIntegrityEvaluationGateClaimIssue,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-gate-policy.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { leafRevisionIdsForActivity } from "../../../../domain/project/engineering-activity.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import { selectCurrentThreadTip } from "../../../../domain/project/thread-tip.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { approvedBriefBasisForProject } from "../../project/commands/project-planning-transitions.ts";
import {
  type AssemblyIntegrityEvaluationRecrossDependencies,
  type AssemblyIntegrityEvaluationRecrossSnapshotStore,
  recrossAssemblyIntegrityEvaluation,
} from "./recross-assembly-integrity-evaluation.ts";

export type ProjectAssemblyIntegrityEvaluationReviewErrorCode = "invalid_request";

export class ProjectAssemblyIntegrityEvaluationReviewError extends Error {
  constructor(
    readonly code: ProjectAssemblyIntegrityEvaluationReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAssemblyIntegrityEvaluationReviewError";
  }
}

export interface PrepareProjectAssemblyIntegrityEvaluationReviewDependencies
  extends AssemblyIntegrityEvaluationRecrossDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore;
}

export class PrepareProjectAssemblyIntegrityEvaluationReview
  implements ProjectAssemblyIntegrityEvaluationReviewUseCase {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore;
  readonly #recross: AssemblyIntegrityEvaluationRecrossDependencies;

  constructor(
    dependencies: PrepareProjectAssemblyIntegrityEvaluationReviewDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#recross = {
      snapshots: dependencies.snapshots,
      observations: dependencies.observations,
      inputs: dependencies.inputs,
    };
  }

  async execute(
    value: unknown,
  ): Promise<ProjectAssemblyIntegrityEvaluationReviewResult> {
    let request: ProjectAssemblyIntegrityEvaluationReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      throw new ProjectAssemblyIntegrityEvaluationReviewError(
        "invalid_request",
        "The assembly-integrity evaluation review accepts exactly one projectId.",
      );
    }
    let project: EngineeringProjectSnapshot | undefined;
    try {
      const raw = await this.#projects.get(request.projectId);
      project = raw ? validateEngineeringProjectSnapshot(raw) : undefined;
    } catch {
      return unavailable(
        request.projectId,
        "project-unavailable",
        "The exact engineering project is unavailable.",
      );
    }
    if (!project || project.project.id !== request.projectId) {
      return unavailable(
        request.projectId,
        "project-unavailable",
        "The exact engineering project is unavailable.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok" || project.project.subjectId !== tip.basis.subjectId) {
      return unavailable(
        request.projectId,
        "thread-tip-unavailable",
        "The engineering project does not have one exact current Thread tip for L4 review.",
      );
    }
    let head;
    try {
      const raw = this.#snapshots.getFresh
        ? await this.#snapshots.getFresh(tip.basis.snapshotId)
        : await this.#snapshots.get(tip.basis.snapshotId);
      head = raw ? validateThreadSnapshot(raw) : undefined;
    } catch {
      head = undefined;
    }
    if (
      !head || head.id !== tip.basis.snapshotId ||
      head.revision !== tip.basis.revision ||
      head.subject.id !== tip.basis.subjectId
    ) {
      return unavailable(
        request.projectId,
        "thread-tip-unavailable",
        "The exact current Thread tip is unavailable.",
      );
    }
    let approvedBriefBasis: EngineeringApprovedBriefBasis;
    try {
      approvedBriefBasis = approvedBriefBasisForProject(project);
    } catch {
      return unavailable(
        request.projectId,
        "approved-brief-unavailable",
        "The current L4 review requires one exact human-approved Brief basis.",
      );
    }
    const selectedWork = selectUniquePendingL4Work(
      project,
      tip.basis,
      approvedBriefBasis,
    );
    if (selectedWork.status !== "resolved") {
      return unavailable(
        request.projectId,
        selectedWork.code,
        selectedWork.message,
      );
    }
    const selectedDecision = selectPendingDecision(project, selectedWork.work);
    if (selectedDecision.status !== "resolved") {
      return unavailable(
        request.projectId,
        selectedDecision.code,
        selectedDecision.message,
      );
    }

    const recrossed = await recrossAssemblyIntegrityEvaluation(this.#recross, {
      project,
      head,
      basis: tip.basis,
      currentWork: selectedWork.work,
    });
    if (recrossed.status !== "resolved") {
      return {
        status: recrossed.status,
        projectId: request.projectId,
        diagnostics: recrossed.diagnostics,
        grants: "none",
      };
    }
    let admission: AssemblyIntegrityEvaluationAdmission;
    let decisionParameters;
    try {
      admission = {
        schemaVersion: "assembly-integrity-evaluation-admission/1.0",
        operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
        projectId: request.projectId,
        basis: tip.basis,
        observation: {
          artifactId: recrossed.artifactInputs[2]!.id,
          fingerprint: recrossed.artifactInputs[2]!.fingerprint,
          observationFingerprint: recrossed.observationCapture.observationFingerprint,
        },
        // The L3 capture keeps its own schema discriminant.  L4 admission
        // signs only the immutable geometry identity, whose strict contract
        // deliberately has no capture schema field.
        geometryModule: {
          artifactId: recrossed.observationCapture.geometryModule.artifactId,
          fingerprint: recrossed.observationCapture.geometryModule.fingerprint,
        },
        assemblyStep: recrossed.observationCapture.assemblyStep,
        inputBundle: recrossed.observationCapture.inputBundle,
        method: {
          schemaVersion: recrossed.method.schemaVersion,
          id: recrossed.method.id,
          version: recrossed.method.version,
          fingerprint: recrossed.method.fingerprint,
        },
      };
      decisionParameters = encodeAssemblyIntegrityEvaluationAdmissionParameters(
        admission,
      );
      admission = parseAssemblyIntegrityEvaluationAdmissionParameters(
        decisionParameters,
      );
      if (
        deterministicJson(
          encodeAssemblyIntegrityEvaluationAdmissionParameters(admission),
        ) !== deterministicJson(decisionParameters)
      ) {
        throw new TypeError("The L4 MRTR admission did not replay exactly.");
      }
    } catch {
      return {
        status: "unresolved",
        projectId: request.projectId,
        diagnostics: [{
          code: "admission-invalid",
          message:
            "The server-selected L4 identity could not be represented as exact MRTR parameters.",
        }],
        grants: "none",
      };
    }
    return deepFreeze({
      status: "resolved" as const,
      projectId: request.projectId,
      basis: {
        snapshotId: tip.basis.snapshotId,
        revision: tip.basis.revision,
        subjectId: tip.basis.subjectId,
      },
      work: { workItemId: selectedWork.work.id },
      decision: {
        decisionId: selectedDecision.decision.id,
        title: selectedDecision.decision.title,
        question: selectedDecision.decision.question,
      },
      admission,
      decisionParameters,
      next: {
        propose: {
          tool: "project_decision_propose" as const,
          arguments: {
            decisionId: selectedDecision.decision.id,
            proposal: {
              summary:
                "Prepare the provider-free assembly-integrity evaluation from the exact fresh L3 observation evidence.",
              parameters: decisionParameters,
            },
          },
        },
      },
      diagnostics: [] as const,
      grants: "none" as const,
    });
  }
}

function parseRequest(
  value: unknown,
): ProjectAssemblyIntegrityEvaluationReviewRequest {
  const root = exactRecord(value, ["projectId"], "$assemblyIntegrityEvaluationReview");
  return deepFreeze({
    projectId: safeId(root.projectId, "$assemblyIntegrityEvaluationReview.projectId"),
  });
}

export function selectUniquePendingL4Work(
  project: EngineeringProjectSnapshot,
  tip: EngineeringThreadSnapshotBasis,
  currentBriefBasis: EngineeringApprovedBriefBasis,
):
  | { readonly status: "resolved"; readonly work: EngineeringWorkItem }
  | {
    readonly status: "unavailable";
    readonly code: string;
    readonly message: string;
  } {
  const matches = project.workItems.filter((item) =>
    item.operation?.id === VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id &&
    item.operation.version === VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version
  );
  if (matches.length === 0) {
    return {
      status: "unavailable",
      code: "l4-work-unavailable",
      message: "No current L4 assembly-integrity evaluation work is present.",
    };
  }
  const candidates: EngineeringWorkItem[] = [];
  const activityIds = [...new Set(matches.map((item) => item.activityId))];
  for (const activityId of activityIds) {
    const revisions = project.workItems.filter((item) =>
      item.activityId === activityId
    );
    const leaves = leafRevisionIdsForActivity(revisions);
    const current = leaves.length === 1
      ? revisions.filter((item) => item.id === leaves[0])
      : [];
    if (current.length !== 1) continue;
    const work = current[0]!;
    if (
      deterministicJson(work.operation) !==
        deterministicJson(evaluateAssemblyIntegrityWorkItemOperation())
    ) continue;
    const changes = (project.planChanges ?? []).filter((change) =>
      change.workItemIds.includes(work.id)
    );
    if (changes.length !== 1) continue;
    const change = changes[0]!;
    if (
      change.baseSnapshot.snapshotId !== tip.snapshotId ||
      change.baseSnapshot.revision !== tip.revision ||
      change.baseSnapshot.subjectId !== tip.subjectId ||
      !change.approvedBriefBasis ||
      deterministicJson(change.approvedBriefBasis) !==
        deterministicJson(currentBriefBasis)
    ) continue;
    // A non-pending historical/current revision never competes with the
    // reviewable leaf. The public review selects waiting-for-decision only;
    // it must not let an unrelated non-pending leaf hide a valid one.
    if (work.status !== "waiting-for-decision") continue;
    const gateIssue = assemblyIntegrityEvaluationGateClaimIssue(project, work);
    if (gateIssue) {
      return {
        status: "unavailable",
        code: "l4-gate-claim-invalid",
        message: gateIssue,
      };
    }
    candidates.push(work);
  }
  if (candidates.length !== 1) {
    return {
      status: "unavailable",
      code: candidates.length === 0 ? "l4-work-unavailable" : "l4-work-ambiguous",
      message: candidates.length === 0
        ? "No pending L4 work was appended on the exact current Thread tip under the current approved Brief basis."
        : "More than one pending L4 work matches the exact current Thread tip and approved Brief basis.",
    };
  }
  return { status: "resolved", work: candidates[0]! };
}

function selectPendingDecision(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
):
  | {
    readonly status: "resolved";
    readonly decision: {
      readonly id: string;
      readonly title: string;
      readonly question: string;
    };
  }
  | {
    readonly status: "unavailable";
    readonly code: string;
    readonly message: string;
  } {
  if (work.decisionIds.length !== 1) {
    return {
      status: "unavailable",
      code: "l4-decision-ambiguous",
      message: "The L4 work must name exactly one MRTR decision.",
    };
  }
  const decisions = project.decisions.filter((item) => item.id === work.decisionIds[0]);
  if (
    decisions.length !== 1 || decisions[0]!.phaseId !== work.phaseId ||
    (decisions[0]!.status !== "required" && decisions[0]!.status !== "proposed")
  ) {
    return {
      status: "unavailable",
      code: "l4-decision-unavailable",
      message: "The unique L4 MRTR decision is absent, foreign, or no longer pending.",
    };
  }
  return { status: "resolved", decision: decisions[0]! };
}

function unavailable(
  projectId: string,
  code: string,
  message: string,
): ProjectAssemblyIntegrityEvaluationReviewResult {
  return {
    status: "unavailable",
    projectId,
    diagnostics: [{ code, message }],
    grants: "none",
  };
}
