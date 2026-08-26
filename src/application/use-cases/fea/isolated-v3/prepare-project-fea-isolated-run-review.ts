/**
 * Provider-free compilation of `verify.run-fea-static-proof@3` bindings
 * from one sealed proof-case Thread document.
 *
 * The shared plan admission reopens the sealed capture and names the canonical
 * part STEP. It never emits `fea.run.*` numbers or binds a cad-model as geometry.
 */

import type {
  ProjectFeaIsolatedRunReviewCommand,
  ProjectFeaIsolatedRunReviewResult,
  ProjectFeaIsolatedRunReviewUseCase,
} from "../../../ports/in/fea/isolated-v3/project-fea-isolated-run-review.ts";
import type { FeaIsolatedRunAdmissionReviewer } from "../../../ports/out/fea/isolated-v3/fea-isolated-run-admission-reviewer.ts";
import {
  diagnoseIsolatedCalculixProofArtifact,
  type IsolatedCalculixBindingDiagnostic,
  type IsolatedCalculixResolvedBindings,
  isolatedCalculixReviewProposal,
  resolveIsolatedCalculixRunBindings,
  selectSealedFeaProofArtifact,
} from "../../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import {
  type FeaReviewBasisDiagnostic,
  feaReviewNext,
  type FeaReviewNextDiagnostic,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  parseOptionalThreadBasis,
  validateFeaReviewNextState,
} from "../seal-case/fea-review-support.ts";
import {
  isolatedFeaRunDecisionId,
  isolatedFeaRunWorkItemId,
  isolatedFeaSuccessorProposal,
  resolveFeaIsolatedRunSuccessor,
} from "./fea-isolated-run-successor.ts";

export type ProjectFeaIsolatedRunReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "admission_review_failed";

export class ProjectFeaIsolatedRunReviewError extends Error {
  constructor(
    readonly code: ProjectFeaIsolatedRunReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectFeaIsolatedRunReviewError";
  }
}

export interface PrepareProjectFeaIsolatedRunReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly admissionReviewer: FeaIsolatedRunAdmissionReviewer;
  readonly projects?: FeaReviewProjectReader;
}

export class PrepareProjectFeaIsolatedRunReview
  implements ProjectFeaIsolatedRunReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #admissionReviewer: FeaIsolatedRunAdmissionReviewer;
  readonly #projects: FeaReviewProjectReader | undefined;

  constructor(dependencies: PrepareProjectFeaIsolatedRunReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#admissionReviewer = dependencies.admissionReviewer;
    this.#projects = dependencies.projects;
  }

  async execute(value: unknown): Promise<ProjectFeaIsolatedRunReviewResult> {
    let command: ProjectFeaIsolatedRunReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The FEA isolated-run review request failed exact validation.",
      );
    }

    const opened = await openFeaReviewSnapshot({
      projectId: command.projectId,
      named: command.basis,
      projects: this.#projects,
      snapshots: this.#snapshots,
    });
    if (opened.status === "project_not_found") {
      throw reviewError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    if (
      opened.status === "snapshot_not_found" ||
      opened.status === "snapshot_resolution_failed"
    ) {
      throw reviewError(
        opened.status,
        opened.status === "snapshot_not_found"
          ? "The exact Thread basis snapshot is unavailable."
          : "The exact Thread basis snapshot could not be reopened.",
      );
    }
    if (opened.status !== "ok") {
      return unresolvedRun([toRunDiagnostic(opened.diagnostic)], opened.basis);
    }
    const { basis, snapshot, project } = opened;

    const selected = selectSealedFeaProofArtifact(
      snapshot,
      command.proofArtifactId,
    );
    if (selected.status !== "ok") {
      return unresolvedRun(selected.diagnostics, basis);
    }
    const proofDiag = diagnoseIsolatedCalculixProofArtifact(selected.artifact);
    if (proofDiag) return unresolvedRun([proofDiag], basis);

    if (!project) {
      return unresolvedRun([{
        code: "project-state-unavailable",
        artifactId: selected.artifact.id,
        artifactKind: selected.artifact.kind,
        message:
          "The sealed proof was found, but no exact project ledger was available for the same admission checks used by the isolated plan resolver.",
      }], basis);
    }
    let admission;
    try {
      admission = await this.#admissionReviewer.reviewIsolatedCalculixAdmission({
        project,
        snapshot,
        proofArtifact: selected.artifact,
      });
    } catch (error) {
      return unresolvedRun([{
        code: "queue-admission-rejected",
        artifactId: selected.artifact.id,
        artifactKind: selected.artifact.kind,
        message:
          `The isolated plan resolver source-admission review rejected this proof: ${
            error instanceof Error ? error.message : String(error)
          }`,
      }], basis);
    }
    const capture = admission.capture;
    if (capture.proofCase.project.id !== command.projectId) {
      return unresolvedRun([{
        code: "step-mismatch",
        artifactId: selected.artifact.id,
        artifactKind: selected.artifact.kind,
        message: `Sealed proof case project.id "${capture.proofCase.project.id}" ` +
          `does not match requested projectId "${command.projectId}".`,
      }], basis);
    }
    const resolved = resolveIsolatedCalculixRunBindings(
      snapshot,
      selected.artifact,
      capture,
    );
    if (resolved.status !== "resolved") {
      return unresolvedRun(resolved.diagnostics, basis);
    }
    const rootWorkItemId = isolatedFeaRunWorkItemId(
      capture.proofDigest,
      basis.revision,
    );
    const rootDecisionId = isolatedFeaRunDecisionId(
      capture.proofDigest,
      basis.revision,
    );
    const rootExists = project.workItems.some((item) => item.id === rootWorkItemId);
    if (rootExists) {
      const successor = resolveFeaIsolatedRunSuccessor({
        project,
        rootWorkItemId,
        proofDigest: capture.proofDigest,
        threadRevision: basis.revision,
        operation: resolved.resolved.operation,
      });
      if (successor.status !== "ready") {
        return notAppendable("unresolved", [successor.diagnostic], basis);
      }
      return compileAppendableRunReview({
        project,
        projectId: command.projectId,
        basis,
        resolved,
        workItemId: successor.workItemId,
        decisionId: successor.decisionId,
        phaseId: successor.phaseId,
        dependsOnWorkItemIds: successor.dependsOnWorkItemIds,
        predecessorWorkItemId: successor.predecessorWorkItemId,
        failedRunId: successor.failedRunId,
      });
    }
    return compileAppendableRunReview({
      project,
      projectId: command.projectId,
      basis,
      resolved,
      workItemId: rootWorkItemId,
      decisionId: rootDecisionId,
      phaseId: `phase-${rootWorkItemId}`,
      dependsOnWorkItemIds: [],
    });
  }
}

function compileAppendableRunReview(input: {
  readonly project: EngineeringProjectSnapshot;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly resolved: { readonly resolved: IsolatedCalculixResolvedBindings };
  readonly workItemId: string;
  readonly decisionId: string;
  readonly phaseId: string;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly predecessorWorkItemId?: string;
  readonly failedRunId?: string;
}): ProjectFeaIsolatedRunReviewResult {
  const successor = input.predecessorWorkItemId && input.failedRunId
    ? isolatedFeaSuccessorProposal({
      proofArtifactId: input.resolved.resolved.proofArtifact.id,
      stepArtifactId: input.resolved.resolved.stepArtifact.id,
      predecessorWorkItemId: input.predecessorWorkItemId,
      failedRunId: input.failedRunId,
    })
    : undefined;
  const proposal = isolatedCalculixReviewProposal(
    input.resolved.resolved.proofArtifact.id,
    input.resolved.resolved.stepArtifact.id,
  );
  const nextState = validateFeaReviewNextState({
    project: input.project,
    projectId: input.projectId,
    basis: input.basis,
    phaseId: input.phaseId,
    workItemId: input.workItemId,
    decisionId: input.decisionId,
    ...(successor ? { reuseExistingPhase: true } : {}),
  });
  if (nextState.status !== "ready") {
    return notAppendable(
      nextState.status,
      [toRunDiagnostic(nextState.diagnostic)],
      input.basis,
    );
  }
  return deepFreeze({
    status: "resolved" as const,
    diagnostics: [],
    rejectedLookalikes: input.resolved.resolved.rejectedLookalikes,
    basis: input.basis,
    selected: {
      proofArtifactId: input.resolved.resolved.proofArtifact.id,
      stepArtifactId: input.resolved.resolved.stepArtifact.id,
      basis: input.basis,
      workItemId: input.workItemId,
      decisionId: input.decisionId,
      ...(successor
        ? {
          predecessorWorkItemId: input.predecessorWorkItemId,
          failedRunId: input.failedRunId,
        }
        : {}),
    },
    operation: input.resolved.resolved.operation,
    bindings: input.resolved.resolved.bindings,
    next: feaReviewNext({
      basis: input.basis,
      operation: input.resolved.resolved.operation,
      summary: successor?.summary ?? proposal.summary,
      parameters: [...proposal.parameters, ...(successor?.parameters ?? [])],
      expectedRevision: nextState.expectedRevision,
      phaseId: input.phaseId,
      phaseName: "Isolated FEA verification",
      phaseDescription: "Run the isolated CalculiX proof on the canonical part STEP.",
      workItemId: input.workItemId,
      decisionId: input.decisionId,
      decisionTitle: successor
        ? "Approve isolated FEA proof successor run"
        : "Approve isolated FEA proof run",
      decisionQuestion: successor
        ? `Approve verify.run-fea-static-proof@3 as a successor revision of ${input.predecessorWorkItemId} after evidence-free isolated output-validation failure ${input.failedRunId} on this exact sealed proof and canonical STEP?`
        : "Approve verify.run-fea-static-proof@3 for this exact sealed proof and canonical STEP?",
      dependsOnWorkItemIds: input.dependsOnWorkItemIds,
      ...(successor
        ? {
          predecessorRevisionId: input.predecessorWorkItemId,
          reuseExistingPhase: true,
        }
        : {}),
    }),
  });
}

function parseCommand(value: unknown): ProjectFeaIsolatedRunReviewCommand {
  const command = closedRecord(
    value,
    ["projectId", "basis", "proofArtifactId"],
    ["projectId"],
    "$feaIsolatedRunReview",
  );
  const basis = parseOptionalThreadBasis(
    command.basis,
    "$feaIsolatedRunReview.basis",
  );
  return deepFreeze({
    projectId: safeId(command.projectId, "$feaIsolatedRunReview.projectId"),
    ...(basis ? { basis } : {}),
    ...(command.proofArtifactId === undefined ? {} : {
      proofArtifactId: safeId(
        command.proofArtifactId,
        "$feaIsolatedRunReview.proofArtifactId",
      ),
    }),
  });
}

function unresolvedRun(
  diagnostics: readonly IsolatedCalculixBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaIsolatedRunReviewResult {
  return notAppendable("unresolved", diagnostics, basis);
}

function notAppendable(
  status: "unresolved" | "unavailable",
  diagnostics: readonly IsolatedCalculixBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaIsolatedRunReviewResult {
  return deepFreeze({
    status,
    diagnostics,
    rejectedLookalikes: [],
    ...(basis ? { basis } : {}),
  });
}

function toRunDiagnostic(
  diagnostic: FeaReviewBasisDiagnostic | FeaReviewNextDiagnostic,
): IsolatedCalculixBindingDiagnostic {
  return {
    code: diagnostic.code,
    artifactId: diagnostic.artifactId,
    artifactKind: null,
    message: diagnostic.message,
  };
}

function reviewError(
  code: ProjectFeaIsolatedRunReviewErrorCode,
  message: string,
): ProjectFeaIsolatedRunReviewError {
  return new ProjectFeaIsolatedRunReviewError(code, message);
}
