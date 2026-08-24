/**
 * Provider-free compilation of one captured proof-case source into
 * `verify.seal-proof-case@1` MRTR parameters.
 *
 * The server reopens the exact source fingerprint and recrosses the unique
 * current Thread tip. The caller never supplies proof bytes, hashes, solver
 * numbers, provider, tool or runtime. This writes no project or Thread state
 * and grants no MRTR authority.
 */

import type {
  FeaProofSensitivityCatalog,
  ProjectFeaProofSealReviewCommand,
  ProjectFeaProofSealReviewResult,
  ProjectFeaProofSealReviewUseCase,
} from "../../../ports/in/fea/seal-case/project-fea-proof-seal-review.ts";
import type { CanonicalAssetReader } from "../../../ports/out/canonical-asset-reader.ts";
import type { FeaProofCaseSourceCaptureReader } from "../../../ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts";
import type { FeaProofSealRequirementsReviewer } from "../../../ports/out/fea/seal-case/fea-proof-seal-requirements-reviewer.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { validateFeaProofCaseSourceCaptureReference } from "../../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import {
  type FeaProofSealBindingDiagnostic,
} from "../../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import {
  encodeFeaProofDecisionParameters,
  type FeaProofDecisionParameters,
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  sealProofCaseWorkItemOperation,
} from "../../../../domain/fea/seal-case/fea-proof-proposal.ts";
import type { MechanicalProofCase } from "../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import { compileSensitivityCatalogOfferFromAdmission } from "../../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import { listCompileAdmissionArtifacts } from "../../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { recrossMechanicalProofCaseFromSource } from "./compile-fea-proof-from-source.ts";
import {
  admitFeaProofSealSource,
  type FeaProofSealGeometryCaptureReader,
} from "./fea-proof-seal-source-admission.ts";
import {
  feaReviewNext,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  validateFeaReviewNextState,
} from "./fea-review-support.ts";

export type ProjectFeaProofSealReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "snapshot_not_found"
  | "snapshot_resolution_failed";

export class ProjectFeaProofSealReviewError extends Error {
  constructor(
    readonly code: ProjectFeaProofSealReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectFeaProofSealReviewError";
  }
}

export interface PrepareProjectFeaProofSealReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly projects?: FeaReviewProjectReader;
  readonly proofCaseSources: FeaProofCaseSourceCaptureReader;
  readonly requirementsReviewer: FeaProofSealRequirementsReviewer;
  readonly geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly stepAssets: CanonicalAssetReader;
  /** Optional: without it the FEA review stays resolved as admission-absent. */
  readonly admissions?: TechnicalCompilationAdmissionReader;
}

export class PrepareProjectFeaProofSealReview
  implements ProjectFeaProofSealReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #projects: FeaReviewProjectReader | undefined;
  readonly #proofCaseSources: FeaProofCaseSourceCaptureReader;
  readonly #requirementsReviewer: FeaProofSealRequirementsReviewer;
  readonly #geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly #stepAssets: CanonicalAssetReader;
  readonly #admissions: TechnicalCompilationAdmissionReader | undefined;

  constructor(dependencies: PrepareProjectFeaProofSealReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#projects = dependencies.projects;
    this.#proofCaseSources = dependencies.proofCaseSources;
    this.#requirementsReviewer = dependencies.requirementsReviewer;
    this.#geometryCaptures = dependencies.geometryCaptures;
    this.#stepAssets = dependencies.stepAssets;
    this.#admissions = dependencies.admissions;
  }

  async execute(value: unknown): Promise<ProjectFeaProofSealReviewResult> {
    let command: ProjectFeaProofSealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The FEA proof-case seal-review request failed exact validation.",
      );
    }

    const opened = await openFeaReviewSnapshot({
      projectId: command.projectId,
      named: undefined,
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
      return unresolved("", [opened.diagnostic], opened.basis);
    }
    const { basis, snapshot, project } = opened;

    let reopened;
    try {
      reopened = await this.#proofCaseSources.reopen(command.caseRef);
    } catch (error) {
      return unresolved("", [sourceDiagnostic(error)], basis);
    }

    const recrossed = await recrossMechanicalProofCaseFromSource({
      source: reopened.source,
      projectId: command.projectId,
      snapshot,
      geometryCaptures: this.#geometryCaptures,
      stepAssets: this.#stepAssets,
    });
    if (recrossed.status !== "ok") {
      return notAppendable(
        recrossed.status,
        reopened.source.id,
        recrossed.diagnostics,
        basis,
      );
    }

    const requirements = await this.#requirementsReviewer.review({
      snapshot,
      proofCase: recrossed.proofCase,
    });
    if (requirements.status !== "resolved") {
      return unresolved(reopened.source.id, requirements.diagnostics, basis);
    }

    try {
      let compiled = await compileSealParameters(
        recrossed.proofCase,
        recrossed.geometryArtifact,
        requirements.artifact,
        reopened.reference.fingerprint,
      );
      const sensitivityCatalog = await this.#sensitivityCatalog(
        snapshot,
        recrossed.proofCase,
        compiled.proofDigest,
        command.projectId,
        basis,
      );
      if (command.sensitivityCatalogOptIn === true) {
        if (sensitivityCatalog.status !== "ready-for-opt-in") {
          return unresolved(reopened.source.id, [{
            code: "sensitivity-catalog-unavailable",
            artifactId: null,
            message:
              `Sensitivity catalog opt-in was requested, but the compiled offer is ${sensitivityCatalog.status}: ${sensitivityCatalog.message}`,
          }], basis);
        }
        compiled = await compileSealParameters(
          recrossed.proofCase,
          recrossed.geometryArtifact,
          requirements.artifact,
          reopened.reference.fingerprint,
          {
            schemaVersion: sensitivityCatalog.schemaVersion,
            digest: (await sha256Fingerprint(sensitivityCatalog)).digest,
            admissionArtifact: sensitivityCatalog.authority.admissionArtifact,
          },
        );
      }
      const parsed = parseFeaProofDecisionParameters(
        feaProofDecisionParametersToMap(compiled.decisionParameters),
      );
      const admission = await admitFeaProofSealSource({
        snapshot,
        decisionParams: parsed,
        geometryCaptures: this.#geometryCaptures,
        stepAssets: this.#stepAssets,
      });
      if (admission.status !== "admitted") {
        return notAppendable(
          admission.status,
          reopened.source.id,
          [admission.diagnostic],
          basis,
        );
      }
      const selected = {
        caseId: recrossed.proofCase.id,
        sourceFingerprint: reopened.reference.fingerprint,
        proofDigest: compiled.proofDigest,
        basis,
        geometryArtifactId: recrossed.geometryArtifact.id,
        requirementsArtifactId: requirements.artifact.id,
        stepArtifactId: recrossed.stepArtifact.id,
        workItemId: recrossed.proofCase.authorization.workItemId,
        decisionId: recrossed.proofCase.authorization.decisionId,
      };
      const summary =
        `Seal captured proof case ${selected.caseId} against Thread r${basis.revision} ` +
        `(geometry ${selected.geometryArtifactId}, STEP ${selected.stepArtifactId}).`;
      const phaseId = `phase-${selected.workItemId}`;
      const nextState = validateFeaReviewNextState({
        project,
        projectId: command.projectId,
        basis,
        phaseId,
        workItemId: selected.workItemId,
        decisionId: selected.decisionId,
      });
      if (nextState.status !== "ready") {
        return notAppendable(
          nextState.status,
          recrossed.proofCase.id,
          [nextState.diagnostic],
          basis,
        );
      }
      return deepFreeze({
        status: "resolved" as const,
        caseId: recrossed.proofCase.id,
        diagnostics: [],
        basis,
        selected,
        decisionParameters: compiled.decisionParameters,
        sensitivityCatalog,
        next: feaReviewNext({
          basis,
          operation: sealProofCaseWorkItemOperation(),
          summary,
          parameters: compiled.decisionParameters,
          expectedRevision: nextState.expectedRevision,
          phaseId,
          phaseName: "Seal FEA proof declaration",
          phaseDescription:
            "Seal the captured mechanical proof declaration without calling a provider.",
          workItemId: selected.workItemId,
          decisionId: selected.decisionId,
          decisionTitle: "Approve FEA proof-case seal",
          decisionQuestion:
            "Approve sealing this exact captured proof case against the current Thread basis?",
        }),
      });
    } catch (error) {
      return unresolved(reopened.source.id, [{
        code: "proposal-grammar-rejected",
        artifactId: null,
        message: error instanceof Error
          ? error.message
          : "The compiled FEA proof parameters were refused.",
      }], basis);
    }
  }

  async #sensitivityCatalog(
    snapshot: ThreadSnapshot,
    proofCase: MechanicalProofCase,
    proofDigest: string,
    projectId: string,
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<FeaProofSensitivityCatalog> {
    if (!this.#admissions) {
      return {
        status: "admission-absent",
        message:
          "No compilation-admission reader is bound; the FEA seal cannot see admitted CAD source text. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    const candidates = listCompileAdmissionArtifacts(snapshot);
    if (candidates.length === 0) {
      return {
        status: "admission-absent",
        message:
          "The current Thread tip has no compile.seal-admission@3 admission. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    if (candidates.length > 1) {
      return {
        status: "admission-ambiguous",
        message:
          "Several compile.seal-admission@3 admissions are on the current tip. The server does not pick a lever source. The proof-case review stays resolved.",
      };
    }
    const artifact = candidates[0]!;
    let reopened;
    try {
      reopened = await this.#admissions.read({
        projectId,
        basis,
        artifactId: artifact.id,
        artifactFingerprint: artifact.fingerprint,
      });
    } catch {
      return {
        status: "admission-unavailable",
        message:
          "The unique compile.seal-admission@3 admission could not be reopened. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    if (!reopened) {
      return {
        status: "admission-unavailable",
        message:
          "The unique compile.seal-admission@3 admission could not be reopened. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    return compileSensitivityCatalogOfferFromAdmission({
      proofCase,
      proofDigest,
      admissionArtifact: {
        id: artifact.id,
        fingerprint: artifact.fingerprint,
      },
      document: reopened.document,
    });
  }
}

async function compileSealParameters(
  proofCase: MechanicalProofCase,
  geometryArtifact: { readonly id: string; readonly fingerprint: ContentFingerprint },
  requirementsArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  },
  sourceFingerprint: string,
  sensitivityCatalog?: NonNullable<
    FeaProofDecisionParameters["sensitivityCatalog"]
  >,
): Promise<{
  readonly proofDigest: string;
  readonly decisionParameters: Extract<
    ProjectFeaProofSealReviewResult,
    { status: "resolved" }
  >["decisionParameters"];
}> {
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
  const decisionParameters = encodeFeaProofDecisionParameters(
    proofDigest,
    proofCase,
    geometryArtifact,
    requirementsArtifact,
    sourceFingerprint,
    sensitivityCatalog,
  );
  const reparsed = parseFeaProofDecisionParameters(
    feaProofDecisionParametersToMap(decisionParameters),
  );
  const reencoded = encodeFeaProofDecisionParameters(
    reparsed.proofDigest,
    proofCase,
    reparsed.geometryArtifact,
    reparsed.requirementsArtifact,
    reparsed.sourceFingerprint,
    reparsed.sensitivityCatalog,
  );
  if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
    throw new TypeError("FEA proof-case MRTR replay is not canonical.");
  }
  return { proofDigest, decisionParameters: reencoded };
}

function parseCommand(value: unknown): ProjectFeaProofSealReviewCommand {
  const command = closedRecord(
    value,
    ["projectId", "caseRef", "sensitivityCatalogOptIn"],
    ["projectId", "caseRef"],
    "$feaProofSealReview",
  );
  if (
    command.sensitivityCatalogOptIn !== undefined &&
    typeof command.sensitivityCatalogOptIn !== "boolean"
  ) {
    throw new TypeError(
      "$feaProofSealReview.sensitivityCatalogOptIn must be boolean.",
    );
  }
  return deepFreeze({
    projectId: safeId(command.projectId, "$feaProofSealReview.projectId"),
    caseRef: validateFeaProofCaseSourceCaptureReference(
      command.caseRef,
      "$feaProofSealReview.caseRef",
    ),
    ...(command.sensitivityCatalogOptIn === undefined
      ? {}
      : { sensitivityCatalogOptIn: command.sensitivityCatalogOptIn }),
  });
}

function sourceDiagnostic(error: unknown): FeaProofSealBindingDiagnostic {
  const code = error !== null && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  const message = error instanceof Error
    ? error.message
    : "The captured proof-case source could not be reopened.";
  if (code === "source_absent") {
    return { code: "source-absent", artifactId: null, message };
  }
  if (code === "source_capture_invalid") {
    return { code: "source-corrupt", artifactId: null, message };
  }
  return { code: "source-unavailable", artifactId: null, message };
}

function unresolved(
  caseId: string,
  diagnostics: readonly FeaProofSealBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaProofSealReviewResult {
  return notAppendable("unresolved", caseId, diagnostics, basis);
}

function notAppendable(
  status: "unresolved" | "unavailable",
  caseId: string,
  diagnostics: readonly FeaProofSealBindingDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectFeaProofSealReviewResult {
  return deepFreeze({
    status,
    caseId,
    diagnostics,
    ...(basis ? { basis } : {}),
  });
}

function reviewError(
  code: ProjectFeaProofSealReviewErrorCode,
  message: string,
): ProjectFeaProofSealReviewError {
  return new ProjectFeaProofSealReviewError(code, message);
}
