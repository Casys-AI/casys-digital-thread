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
  isolatedCalculixReviewProposal,
  resolveIsolatedCalculixRunBindings,
  selectSealedFeaProofArtifact,
} from "../../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
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
    const selection = {
      proofArtifactId: resolved.resolved.proofArtifact.id,
      stepArtifactId: resolved.resolved.stepArtifact.id,
      basis,
      workItemId: isolatedWorkItemId(capture.proofDigest, basis.revision),
      decisionId: isolatedDecisionId(capture.proofDigest, basis.revision),
    };
    const proposal = isolatedCalculixReviewProposal(
      selection.proofArtifactId,
      selection.stepArtifactId,
    );
    const phaseId = `phase-${selection.workItemId}`;
    const nextState = validateFeaReviewNextState({
      project,
      projectId: command.projectId,
      basis,
      phaseId,
      workItemId: selection.workItemId,
      decisionId: selection.decisionId,
    });
    if (nextState.status !== "ready") {
      return notAppendable(
        nextState.status,
        [toRunDiagnostic(nextState.diagnostic)],
        basis,
      );
    }
    return deepFreeze({
      status: "resolved" as const,
      diagnostics: [],
      rejectedLookalikes: resolved.resolved.rejectedLookalikes,
      basis,
      selected: selection,
      operation: resolved.resolved.operation,
      bindings: resolved.resolved.bindings,
      next: feaReviewNext({
        basis,
        operation: resolved.resolved.operation,
        summary: proposal.summary,
        parameters: proposal.parameters,
        expectedRevision: nextState.expectedRevision,
        phaseId,
        phaseName: "Isolated FEA verification",
        phaseDescription: "Run the isolated CalculiX proof on the canonical part STEP.",
        workItemId: selection.workItemId,
        decisionId: selection.decisionId,
        decisionTitle: "Approve isolated FEA proof run",
        decisionQuestion:
          "Approve verify.run-fea-static-proof@3 for this exact sealed proof and canonical STEP?",
      }),
    });
  }
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

function isolatedWorkItemId(proofDigest: string, revision: number): string {
  return `work-fea-isolated-${proofDigest.slice(0, 16)}-r${revision}`;
}

function isolatedDecisionId(proofDigest: string, revision: number): string {
  return `decision-fea-isolated-${proofDigest.slice(0, 16)}-r${revision}`;
}
