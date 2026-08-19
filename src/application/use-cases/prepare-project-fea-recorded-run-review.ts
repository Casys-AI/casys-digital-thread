/**
 * Provider-free compilation of `verify.run-fea-static-proof@3` bindings
 * from one sealed proof-case Thread document.
 *
 * The shared plan admission reopens the sealed capture and names the canonical
 * part STEP. It never emits `fea.run.*` numbers or binds a cad-model as geometry.
 */

import type {
  ProjectFeaRecordedRunReviewCommand,
  ProjectFeaRecordedRunReviewResult,
  ProjectFeaRecordedRunReviewUseCase,
} from "../ports/in/project-fea-recorded-run-review.ts";
import type { FeaRecordedRunAdmissionReviewer } from "../ports/out/fea-recorded-run-admission-reviewer.ts";
import {
  diagnoseRecordedCalculixProofArtifact,
  type RecordedCalculixBindingDiagnostic,
  recordedCalculixReviewProposal,
  resolveRecordedCalculixRunBindings,
  selectSealedFeaProofArtifact,
} from "../../domain/analysis/recorded-calculix-bindings.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../domain/project/engineering-project.ts";
import {
  type FeaReviewBasisDiagnostic,
  feaReviewNext,
  type FeaReviewNextDiagnostic,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  parseOptionalThreadBasis,
  validateFeaReviewNextState,
} from "./fea-review-support.ts";

export type ProjectFeaRecordedRunReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "admission_review_failed";

export class ProjectFeaRecordedRunReviewError extends Error {
  constructor(
    readonly code: ProjectFeaRecordedRunReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectFeaRecordedRunReviewError";
  }
}

export interface PrepareProjectFeaRecordedRunReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly admissionReviewer: FeaRecordedRunAdmissionReviewer;
  readonly projects?: FeaReviewProjectReader;
}

export class PrepareProjectFeaRecordedRunReview
  implements ProjectFeaRecordedRunReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #admissionReviewer: FeaRecordedRunAdmissionReviewer;
  readonly #projects: FeaReviewProjectReader | undefined;

  constructor(dependencies: PrepareProjectFeaRecordedRunReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#admissionReviewer = dependencies.admissionReviewer;
    this.#projects = dependencies.projects;
  }

  async execute(value: unknown): Promise<ProjectFeaRecordedRunReviewResult> {
    let command: ProjectFeaRecordedRunReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The FEA recorded-run review request failed exact validation.",
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
    const proofDiag = diagnoseRecordedCalculixProofArtifact(selected.artifact);
    if (proofDiag) return unresolvedRun([proofDiag], basis);

    if (!project) {
      return unresolvedRun([{
        code: "project-state-unavailable",
        artifactId: selected.artifact.id,
        artifactKind: selected.artifact.kind,
        message:
          "The sealed proof was found, but no exact project ledger was available for the same admission checks used by the @2 plan resolver.",
      }], basis);
    }
    let admission;
    try {
      admission = await this.#admissionReviewer.reviewRecordedCalculixAdmission({
        project,
        snapshot,
        proofArtifact: selected.artifact,
      });
    } catch (error) {
      return unresolvedRun([{
        code: "queue-admission-rejected",
        artifactId: selected.artifact.id,
        artifactKind: selected.artifact.kind,
        message: `The @2 plan resolver source-admission review rejected this proof: ${
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
    const resolved = resolveRecordedCalculixRunBindings(
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
      workItemId: recordedWorkItemId(capture.proofDigest, basis.revision),
      decisionId: recordedDecisionId(capture.proofDigest, basis.revision),
    };
    const proposal = recordedCalculixReviewProposal(
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

function parseCommand(value: unknown): ProjectFeaRecordedRunReviewCommand {
  const command = closedRecord(
    value,
    ["projectId", "basis", "proofArtifactId"],
    ["projectId"],
    "$feaRecordedRunReview",
  );
  const basis = parseOptionalThreadBasis(
    command.basis,
    "$feaRecordedRunReview.basis",
  );
  return deepFreeze({
    projectId: safeId(command.projectId, "$feaRecordedRunReview.projectId"),
    ...(basis ? { basis } : {}),
    ...(command.proofArtifactId === undefined ? {} : {
      proofArtifactId: safeId(
        command.proofArtifactId,
        "$feaRecordedRunReview.proofArtifactId",
      ),
    }),
  });
}

function unresolvedRun(
  diagnostics: readonly RecordedCalculixBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaRecordedRunReviewResult {
  return notAppendable("unresolved", diagnostics, basis);
}

function notAppendable(
  status: "unresolved" | "unavailable",
  diagnostics: readonly RecordedCalculixBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaRecordedRunReviewResult {
  return deepFreeze({
    status,
    diagnostics,
    rejectedLookalikes: [],
    ...(basis ? { basis } : {}),
  });
}

function toRunDiagnostic(
  diagnostic: FeaReviewBasisDiagnostic | FeaReviewNextDiagnostic,
): RecordedCalculixBindingDiagnostic {
  return {
    code: diagnostic.code,
    artifactId: diagnostic.artifactId,
    artifactKind: null,
    message: diagnostic.message,
  };
}

function reviewError(
  code: ProjectFeaRecordedRunReviewErrorCode,
  message: string,
): ProjectFeaRecordedRunReviewError {
  return new ProjectFeaRecordedRunReviewError(code, message);
}

function recordedWorkItemId(proofDigest: string, revision: number): string {
  return `work-fea-recorded-${proofDigest.slice(0, 16)}-r${revision}`;
}

function recordedDecisionId(proofDigest: string, revision: number): string {
  return `decision-fea-recorded-${proofDigest.slice(0, 16)}-r${revision}`;
}
