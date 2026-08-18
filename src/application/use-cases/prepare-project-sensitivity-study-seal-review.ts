/**
 * Provider-free compilation of one sensitivity-study template into
 * `analyze.seal-sensitivity-study@1` MRTR parameters.
 *
 * A named historical catalog id, or the unique catalogued template for the
 * project, still wins. When the catalog does not uniquely select (absent or
 * ambiguous), a unique signed `sensitivity-catalog-offer` on the current tip
 * is reopened, recompiled, and lowered into a
 * `sensitivity-study-case-template/2.0` — including the code-owned mesh-sized
 * step. cadSource is that offer's signed `compile.seal-admission@1`
 * admission, or the unique readable admission that binds a catalogued
 * semanticKey. The caller never supplies case bytes, hashes or solver
 * numbers. This writes no project or Thread state and grants no MRTR
 * authority.
 */

import type {
  ProjectSensitivityStudySealReviewCommand,
  ProjectSensitivityStudySealReviewResult,
  ProjectSensitivityStudySealReviewUseCase,
} from "../ports/in/project-sensitivity-study-seal-review.ts";
import type { CataloguedMechanicalProofCaseReader } from "../ports/out/catalogued-mechanical-proof-case-reader.ts";
import type { TechnicalCompilationAdmissionReader } from "../ports/out/technical-compilation-admission-reader.ts";
import { parseFeaProofCaseCapture } from "../../domain/analysis/fea-proof-case-capture.ts";
import { compileSensitivityCatalogOfferFromAdmission } from "../../domain/analysis/sensitivity-catalog-from-proof.ts";
import { parseSensitivityCatalogOfferCapture } from "../../domain/analysis/sensitivity-catalog-offer-capture.ts";
import {
  bindSignedCatalogOffer,
  bindSignedOfferAdmissionArtifact,
  joinProofCaptureForOfferDigest,
  selectUniqueSignedCatalogOffer,
  shouldOpenSignedCatalogOffer,
} from "../../domain/analysis/sensitivity-catalog-offer-join.ts";
import { assertSensitivityLiveMethod } from "../../domain/analysis/sensitivity-live-method.ts";
import {
  isKnownSensitivityStudyCaseId,
  selectUniqueCataloguedSensitivityCase,
  SENSITIVITY_STUDY_CASE_SOURCES,
  sensitivityStudyCaseSourcePath,
  sensitivityStudySealIdentities,
} from "../../domain/analysis/sensitivity-study-case-catalog.ts";
import {
  listCompileAdmissionArtifacts,
  listFeaProofCaseArtifacts,
  listRejectedCadSourceLookalikes,
  listSensitivityCatalogOfferArtifacts,
  matchAdmittedSensitivityParameter,
  sensitivityCadSourceUri,
  type SensitivityStudySealDiagnostic,
} from "../../domain/analysis/sensitivity-study-seal-bindings.ts";
import {
  encodeSensitivityStudyDecisionParameters,
  parseSensitivityStudyDecisionParameters,
  sealSensitivityStudyWorkItemOperation,
  verifySensitivityStudyParametersMatchCase,
} from "../../domain/analysis/sensitivity-study-proposal.ts";
import {
  assembleSensitivityStudyCaseV2,
  type SensitivityStudyCaseTemplate,
  validateSensitivityStudyCaseTemplate,
} from "../../domain/analysis/sensitivity-study-template.ts";
import type { SensitivityCadSource } from "../../domain/analysis/sensitivity-study-v2.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  feaReviewNext,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  parseOptionalThreadBasis,
  validateFeaReviewNextState,
} from "./fea-review-support.ts";

export type ProjectSensitivityStudySealReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "catalog_unavailable"
  | "catalog_integrity_failed";

export class ProjectSensitivityStudySealReviewError extends Error {
  constructor(
    readonly code: ProjectSensitivityStudySealReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSensitivityStudySealReviewError";
  }
}

export interface ContentAddressedCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface PrepareProjectSensitivityStudySealReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly projects?: FeaReviewProjectReader;
  readonly catalogReader: CataloguedMechanicalProofCaseReader;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly catalogOffers?: ContentAddressedCaptureReader;
  readonly proofCaptures?: ContentAddressedCaptureReader;
}

export class PrepareProjectSensitivityStudySealReview
  implements ProjectSensitivityStudySealReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #projects: FeaReviewProjectReader | undefined;
  readonly #catalogReader: CataloguedMechanicalProofCaseReader;
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #catalogOffers: ContentAddressedCaptureReader | undefined;
  readonly #proofCaptures: ContentAddressedCaptureReader | undefined;

  constructor(dependencies: PrepareProjectSensitivityStudySealReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#projects = dependencies.projects;
    this.#catalogReader = dependencies.catalogReader;
    this.#admissions = dependencies.admissions;
    this.#catalogOffers = dependencies.catalogOffers;
    this.#proofCaptures = dependencies.proofCaptures;
  }

  async execute(value: unknown): Promise<ProjectSensitivityStudySealReviewResult> {
    let command: ProjectSensitivityStudySealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The sensitivity-study seal-review request failed exact validation.",
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
      return unresolved(command.caseId ?? "", [opened.diagnostic], opened.basis);
    }
    const { basis, snapshot, project } = opened;

    const selectedCase = await this.#openCase(
      command.projectId,
      command.caseId,
      basis,
      snapshot,
    );
    if (selectedCase.status !== "ok") {
      if (
        selectedCase.status === "catalog_unavailable" ||
        selectedCase.status === "catalog_integrity_failed"
      ) {
        return unresolved(command.caseId ?? "", [{
          code: selectedCase.status === "catalog_unavailable"
            ? "catalog-unavailable"
            : "catalog-integrity-failed",
          artifactId: null,
          message: selectedCase.message,
        }], basis);
      }
      return notAppendable(
        selectedCase.status,
        selectedCase.caseId,
        selectedCase.diagnostics,
        basis,
      );
    }

    const identity = identityDiagnostics(
      selectedCase.template,
      command.projectId,
      snapshot,
      selectedCase.source,
    );
    if (identity.length > 0) {
      return unresolved(selectedCase.caseId, identity, basis);
    }

    const admission = selectedCase.source === "signed-offer"
      ? {
        status: "ok" as const,
        artifact: selectedCase.artifact,
        cadSource: selectedCase.cadSource,
      }
      : await this.#resolveUniqueAdmission(
        command.projectId,
        basis,
        snapshot,
        selectedCase.template,
      );
    if (admission.status !== "ok") {
      return notAppendable(
        admission.status,
        selectedCase.caseId,
        [admission.diagnostic],
        basis,
      );
    }

    try {
      const compiled = await compileSealParameters(
        selectedCase.template,
        admission.cadSource,
      );
      const selected = {
        caseId: selectedCase.caseId,
        caseDigest: compiled.caseDigest,
        basis,
        admissionArtifactId: admission.artifact.id,
        cadSource: admission.cadSource,
        authority: selectedCase.source,
        ...sensitivityStudySealIdentities(selectedCase.caseId),
      };
      const fromOffer = selectedCase.source === "signed-offer";
      const summary = fromOffer
        ? `Seal sensitivity study ${selected.caseId} compiled from the signed catalog offer against Thread r${basis.revision} (admission ${selected.admissionArtifactId}).`
        : `Seal catalogued sensitivity study ${selected.caseId} against Thread r${basis.revision} ` +
          `(admission ${selected.admissionArtifactId}).`;
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
          selectedCase.caseId,
          [nextState.diagnostic],
          basis,
        );
      }
      return deepFreeze({
        status: "resolved" as const,
        caseId: selectedCase.caseId,
        diagnostics: [],
        basis,
        selected,
        decisionParameters: compiled.decisionParameters,
        next: feaReviewNext({
          basis,
          operation: sealSensitivityStudyWorkItemOperation(),
          summary,
          parameters: compiled.decisionParameters,
          expectedRevision: nextState.expectedRevision,
          phaseId,
          phaseName: "Seal sensitivity study declaration",
          phaseDescription: fromOffer
            ? "Seal the sensitivity-study-case/2.0 compiled from the signed catalog offer without calling a provider."
            : "Seal the catalogued sensitivity-study-case/2.0 without calling a provider.",
          workItemId: selected.workItemId,
          decisionId: selected.decisionId,
          decisionTitle: "Approve sensitivity-study seal",
          decisionQuestion: fromOffer
            ? "Approve sealing this exact sensitivity study compiled from the signed catalog offer against the signed Thread admission?"
            : "Approve sealing this exact catalogued sensitivity study against the current Thread admission?",
        }),
      });
    } catch (error) {
      return unresolved(selectedCase.caseId, [{
        code: "proposal-grammar-rejected",
        artifactId: null,
        message: error instanceof Error
          ? error.message
          : "The compiled sensitivity-study parameters were refused.",
      }], basis);
    }
  }

  async #openCase(
    projectId: string,
    caseId: string | undefined,
    basis: EngineeringThreadSnapshotBasis,
    snapshot: ThreadSnapshot,
  ): Promise<OpenedSensitivityStudyCase> {
    const catalogued = await this.#openCataloguedCase(projectId, caseId);
    if (
      !shouldOpenSignedCatalogOffer({
        namedCaseId: caseId,
        catalogStatus: catalogued.status === "ok" ||
            catalogued.status === "catalog_unavailable" ||
            catalogued.status === "catalog_integrity_failed"
          ? catalogued.status
          : "unresolved",
      })
    ) {
      return catalogued;
    }
    const offered = await this.#openOfferedCase(
      projectId,
      caseId,
      basis,
      snapshot,
    );
    if (offered.status !== "absent") return offered;
    return catalogued;
  }

  async #openCataloguedCase(
    projectId: string,
    caseId: string | undefined,
  ): Promise<
    | {
      readonly status: "ok";
      readonly source: "catalog";
      readonly caseId: string;
      readonly template: SensitivityStudyCaseTemplate;
    }
    | {
      readonly status: "unresolved";
      readonly caseId: string;
      readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
    }
    | { readonly status: "catalog_unavailable"; readonly message: string }
    | { readonly status: "catalog_integrity_failed"; readonly message: string }
  > {
    const selected = caseId
      ? namedCase(caseId)
      : await uniqueCaseForProject(projectId, this.#catalogReader);
    if (selected.status !== "ok") return selected;
    let raw: string | undefined;
    try {
      raw = await this.#catalogReader.read(selected.path);
    } catch {
      return {
        status: "catalog_unavailable",
        message:
          `Catalog entry "${selected.caseId}" could not be read from its code-owned source.`,
      };
    }
    if (raw === undefined) {
      return {
        status: "catalog_unavailable",
        message:
          `Catalog entry "${selected.caseId}" is registered, but its code-owned source is unavailable.`,
      };
    }
    try {
      const template = validateSensitivityStudyCaseTemplate(JSON.parse(raw));
      if (template.id !== selected.caseId) {
        return {
          status: "catalog_integrity_failed",
          message:
            `Catalog source for "${selected.caseId}" declares case id "${template.id}".`,
        };
      }
      return {
        status: "ok",
        source: "catalog",
        caseId: selected.caseId,
        template,
      };
    } catch {
      return {
        status: "catalog_integrity_failed",
        message: `Catalog source for "${selected.caseId}" is invalid or non-canonical.`,
      };
    }
  }

  async #resolveUniqueAdmission(
    projectId: string,
    basis: EngineeringThreadSnapshotBasis,
    snapshot: ThreadSnapshot,
    template: SensitivityStudyCaseTemplate,
  ): Promise<
    | {
      readonly status: "ok";
      readonly artifact: ThreadArtifact;
      readonly cadSource: SensitivityCadSource;
    }
    | {
      readonly status: "unresolved" | "unavailable";
      readonly diagnostic: SensitivityStudySealDiagnostic;
    }
  > {
    const lookalikes = listRejectedCadSourceLookalikes(snapshot);
    const candidates = listCompileAdmissionArtifacts(snapshot);
    if (candidates.length === 0) {
      if (lookalikes.length > 0) {
        const names = lookalikes.map((item) =>
          `${item.id} (${item.kind}, ${item.producer.tool})`
        ).join(", ");
        return {
          status: "unresolved",
          diagnostic: {
            code: "cad-source-lookalike",
            artifactId: lookalikes[0]!.id,
            message:
              "cadSource must be a compile.seal-admission@1 admission document URI + sha256. " +
              `Rejected lookalikes: ${names}. ` +
              "Not design.write-geometry@1, a cad-model, a STEP, or design.seal-isolated-geometry@1.",
          },
        };
      }
      return {
        status: "unresolved",
        diagnostic: {
          code: "admission-absent",
          artifactId: null,
          message:
            "The current Thread tip has no compile.seal-admission@1 admission document. " +
            "cadSource cannot be compiled.",
        },
      };
    }

    const matched: ThreadArtifact[] = [];
    const unread: ThreadArtifact[] = [];
    let unbound: SensitivityStudySealDiagnostic | undefined;
    for (const artifact of candidates) {
      let reopened;
      try {
        reopened = await this.#admissions.read({
          projectId,
          basis,
          artifactId: artifact.id,
          artifactFingerprint: artifact.fingerprint,
        });
      } catch {
        unread.push(artifact);
        continue;
      }
      if (!reopened) {
        unread.push(artifact);
        continue;
      }
      const match = matchAdmittedSensitivityParameter(
        reopened.document.inputManifest.sources,
        template.target.semanticKey,
        template.baseValue.value,
      );
      if (match.status === "matched") {
        matched.push(artifact);
        continue;
      }
      unbound = {
        code: match.code,
        artifactId: artifact.id,
        message: match.message,
      };
    }

    if (matched.length > 1) {
      return {
        status: "unresolved",
        diagnostic: {
          code: "admission-ambiguous",
          artifactId: null,
          message:
            `Several compile.seal-admission@1 admissions bind ${template.target.semanticKey}: ` +
            `${
              matched.map((item) => item.id).join(", ")
            }. Name is not enough; uniqueness failed.`,
        },
      };
    }
    if (unread.length > 0 && matched.length !== 1) {
      return {
        status: "unavailable",
        diagnostic: {
          code: "admission-unavailable",
          artifactId: unread[0]!.id,
          message:
            "A compile.seal-admission@1 admission on the current tip could not be reopened. " +
            "Uniqueness of the cadSource join is unproven. No decisionParameters.",
        },
      };
    }
    if (matched.length === 0) {
      return {
        status: "unresolved",
        diagnostic: unbound ?? {
          code: "semantic-key-unbound",
          artifactId: candidates[0]?.id ?? null,
          message:
            `No readable admission source has a unique module-level numeric binding named ${template.target.semanticKey}.`,
        },
      };
    }

    const artifact = matched[0]!;
    if (artifact.fingerprint.algorithm !== "sha256") {
      return {
        status: "unresolved",
        diagnostic: {
          code: "admission-parameter-mismatch",
          artifactId: artifact.id,
          message: "cadSource sha256 must be the Thread admission fingerprint.",
        },
      };
    }
    return {
      status: "ok",
      artifact,
      cadSource: {
        artifactUri: sensitivityCadSourceUri(projectId, artifact.id),
        sha256: artifact.fingerprint.digest,
      },
    };
  }

  async #openOfferedCase(
    projectId: string,
    caseId: string | undefined,
    basis: EngineeringThreadSnapshotBasis,
    snapshot: ThreadSnapshot,
  ): Promise<
    | OpenedSignedOfferCase
    | {
      readonly status: "unresolved" | "unavailable";
      readonly caseId: string;
      readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
    }
    | { readonly status: "absent" }
  > {
    const selected = selectUniqueSignedCatalogOffer(
      listSensitivityCatalogOfferArtifacts(snapshot),
    );
    if (selected.status === "absent") return { status: "absent" };
    if (selected.status === "ambiguous") {
      return offeredFailure("unresolved", caseId, {
        code: "catalog-offer-ambiguous",
        artifactId: null,
        message: `Several signed sensitivity catalog offers are on the current tip: ${
          selected.artifacts.map((item) => item.id).join(", ")
        }. Name is not enough; uniqueness failed.`,
      });
    }
    const catalogOffers = this.#catalogOffers;
    const proofCaptures = this.#proofCaptures;
    if (!catalogOffers || !proofCaptures) {
      return offeredFailure("unavailable", caseId, {
        code: "catalog-offer-unavailable",
        artifactId: selected.artifact.id,
        message:
          "A signed sensitivity catalog offer is on the current tip, but the review has no offer or proof capture reader.",
      });
    }
    const offerArtifact = selected.artifact;
    let raw: string | undefined;
    try {
      raw = await catalogOffers.read(offerArtifact.fingerprint);
    } catch {
      return offeredFailure("unavailable", caseId, {
        code: "catalog-offer-unavailable",
        artifactId: offerArtifact.id,
        message:
          "The signed sensitivity catalog offer could not be reopened. Uniqueness of the case join is unproven.",
      });
    }
    if (raw === undefined) {
      return offeredFailure("unavailable", caseId, {
        code: "catalog-offer-unavailable",
        artifactId: offerArtifact.id,
        message:
          "The signed sensitivity catalog offer is registered on the tip but its capture is unavailable.",
      });
    }
    let capture;
    try {
      capture = await parseSensitivityCatalogOfferCapture(raw);
    } catch (error) {
      return offeredFailure("unresolved", caseId, {
        code: "catalog-offer-integrity-failed",
        artifactId: offerArtifact.id,
        message: error instanceof Error
          ? error.message
          : "The signed sensitivity catalog offer capture is invalid.",
      });
    }
    const proofJoin = await this.#reopenUniqueProofForOffer(
      capture.offer.authority.proofDigest,
      snapshot,
      proofCaptures,
    );
    if (proofJoin.status !== "ok") {
      return offeredFailure(proofJoin.status, caseId, proofJoin.diagnostic);
    }
    const { proofCapture } = proofJoin;
    const signedAdmission = capture.offer.authority.admissionArtifact;
    const boundAdmission = bindSignedOfferAdmissionArtifact({
      admissionArtifact: snapshot.artifacts.find((artifact) =>
        artifact.id === signedAdmission.id
      ),
      signedAdmission,
    });
    if (boundAdmission.status !== "ok") {
      return offeredFailure("unresolved", caseId, boundAdmission.diagnostic);
    }
    const admissionArtifact = boundAdmission.artifact;
    let reopened;
    try {
      reopened = await this.#admissions.read({
        projectId,
        basis,
        artifactId: admissionArtifact.id,
        artifactFingerprint: admissionArtifact.fingerprint,
      });
    } catch {
      return offeredFailure("unavailable", caseId, {
        code: "admission-unavailable",
        artifactId: admissionArtifact.id,
        message:
          "The signed catalog-offer admission could not be reopened. No decisionParameters.",
      });
    }
    if (!reopened) {
      return offeredFailure("unavailable", caseId, {
        code: "admission-unavailable",
        artifactId: admissionArtifact.id,
        message:
          "The signed catalog-offer admission is unavailable. No decisionParameters.",
      });
    }
    const bound = await bindSignedCatalogOffer({
      offerArtifact,
      offerDigest: capture.offerDigest,
      recompiled: compileSensitivityCatalogOfferFromAdmission({
        proofCase: proofCapture.proofCase,
        proofDigest: proofCapture.proofDigest,
        admissionArtifact: {
          id: admissionArtifact.id,
          fingerprint: admissionArtifact.fingerprint,
        },
        document: reopened.document,
      }),
      proofCase: proofCapture.proofCase,
      proofDigest: proofCapture.proofDigest,
      admissionArtifact,
      namedCaseId: caseId,
      projectId,
      subjectId: snapshot.subject.id,
    });
    if (bound.status !== "ok") {
      return offeredFailure("unresolved", caseId, bound.diagnostic);
    }
    return {
      status: "ok",
      source: "signed-offer",
      caseId: bound.caseId,
      template: bound.template,
      artifact: admissionArtifact,
      cadSource: bound.cadSource,
    };
  }

  async #reopenUniqueProofForOffer(
    proofDigest: string,
    snapshot: ThreadSnapshot,
    proofCaptures: ContentAddressedCaptureReader,
  ): Promise<
    | {
      readonly status: "ok";
      readonly proofArtifact: ThreadArtifact;
      readonly proofCapture: Awaited<ReturnType<typeof parseFeaProofCaseCapture>>;
    }
    | {
      readonly status: "unresolved" | "unavailable";
      readonly diagnostic: SensitivityStudySealDiagnostic;
    }
  > {
    const candidates = listFeaProofCaseArtifacts(snapshot);
    if (candidates.length === 0) {
      return {
        status: "unresolved",
        diagnostic: {
          code: "catalog-offer-integrity-failed",
          artifactId: null,
          message:
            "The current tip has no sealed FEA proof capture for the signed catalog offer.",
        },
      };
    }
    const attempts = [];
    for (const artifact of candidates) {
      let proofText: string | undefined;
      try {
        proofText = await proofCaptures.read(artifact.fingerprint);
      } catch {
        attempts.push({ status: "unread" as const, artifact });
        continue;
      }
      if (proofText === undefined) {
        attempts.push({ status: "unread" as const, artifact });
        continue;
      }
      try {
        const proofCapture = await parseFeaProofCaseCapture(proofText);
        if (proofCapture.proofDigest === proofDigest) {
          attempts.push({
            status: "matched" as const,
            artifact,
            proofCapture,
          });
        } else {
          attempts.push({ status: "other" as const, artifact });
        }
      } catch {
        attempts.push({ status: "invalid" as const, artifact });
      }
    }
    const joined = joinProofCaptureForOfferDigest(attempts);
    if (joined.status !== "ok") return joined;
    return {
      status: "ok",
      proofArtifact: joined.artifact,
      proofCapture: joined.proofCapture,
    };
  }
}

type OpenedSignedOfferCase = {
  readonly status: "ok";
  readonly source: "signed-offer";
  readonly caseId: string;
  readonly template: SensitivityStudyCaseTemplate;
  readonly artifact: ThreadArtifact;
  readonly cadSource: SensitivityCadSource;
};

type OpenedSensitivityStudyCase =
  | {
    readonly status: "ok";
    readonly source: "catalog";
    readonly caseId: string;
    readonly template: SensitivityStudyCaseTemplate;
  }
  | OpenedSignedOfferCase
  | {
    readonly status: "unresolved" | "unavailable";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  }
  | { readonly status: "catalog_unavailable"; readonly message: string }
  | { readonly status: "catalog_integrity_failed"; readonly message: string };

async function compileSealParameters(
  template: SensitivityStudyCaseTemplate,
  cadSource: SensitivityCadSource,
): Promise<{
  readonly caseDigest: string;
  readonly decisionParameters: Extract<
    ProjectSensitivityStudySealReviewResult,
    { status: "resolved" }
  >["decisionParameters"];
}> {
  const studyCase = assembleSensitivityStudyCaseV2(template, cadSource);
  assertSensitivityLiveMethod(studyCase);
  const caseDigest = (await sha256Fingerprint(studyCase)).digest;
  const decisionParameters = encodeSensitivityStudyDecisionParameters(
    caseDigest,
    studyCase,
  );
  const reparsed = parseSensitivityStudyDecisionParameters(decisionParameters);
  verifySensitivityStudyParametersMatchCase(reparsed, studyCase);
  const reencoded = encodeSensitivityStudyDecisionParameters(
    reparsed.caseDigest,
    studyCase,
  );
  if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
    throw new TypeError("Sensitivity-study MRTR replay is not canonical.");
  }
  return { caseDigest, decisionParameters: reencoded };
}

function parseCommand(value: unknown): ProjectSensitivityStudySealReviewCommand {
  const command = closedRecord(
    value,
    ["projectId", "basis", "caseId"],
    ["projectId"],
    "$sensitivityStudySealReview",
  );
  const basis = parseOptionalThreadBasis(
    command.basis,
    "$sensitivityStudySealReview.basis",
  );
  return deepFreeze({
    projectId: safeId(command.projectId, "$sensitivityStudySealReview.projectId"),
    ...(basis ? { basis } : {}),
    ...(command.caseId === undefined
      ? {}
      : { caseId: safeId(command.caseId, "$sensitivityStudySealReview.caseId") }),
  });
}

function namedCase(caseId: string):
  | { readonly status: "ok"; readonly caseId: string; readonly path: string }
  | {
    readonly status: "unresolved";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  } {
  if (!isKnownSensitivityStudyCaseId(caseId)) {
    return {
      status: "unresolved",
      caseId,
      diagnostics: [{
        code: "catalog-absent",
        artifactId: null,
        message: `Sensitivity case "${caseId}" is not in the server-owned catalog. ` +
          "Add an entry to SENSITIVITY_STUDY_CASE_SOURCES and the corresponding JSON template.",
      }],
    };
  }
  const path = sensitivityStudyCaseSourcePath(caseId);
  if (!path) {
    return {
      status: "unresolved",
      caseId,
      diagnostics: [{
        code: "catalog-absent",
        artifactId: null,
        message: `Sensitivity case "${caseId}" is not in the server-owned catalog.`,
      }],
    };
  }
  return { status: "ok", caseId, path };
}

async function uniqueCaseForProject(
  projectId: string,
  reader: CataloguedMechanicalProofCaseReader,
): Promise<
  | { readonly status: "ok"; readonly caseId: string; readonly path: string }
  | {
    readonly status: "unresolved";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  }
> {
  const loaded: Array<
    { readonly caseId: string; readonly path: string; readonly projectId: string }
  > = [];
  for (const [caseId, path] of SENSITIVITY_STUDY_CASE_SOURCES) {
    const candidate = await readCataloguedSensitivityCase(reader, caseId, path);
    if (candidate) loaded.push(candidate);
  }
  const selected = selectUniqueCataloguedSensitivityCase(projectId, loaded);
  if (selected.status === "ok") {
    const match = loaded.find((item) => item.caseId === selected.caseId);
    return { status: "ok", caseId: selected.caseId, path: match!.path };
  }
  return {
    status: "unresolved",
    caseId: "",
    diagnostics: [{
      code: selected.code,
      artifactId: null,
      message: selected.message,
    }],
  };
}

/**
 * Auto-select only considers readable, exact catalog entries. A missing or
 * invalid sibling must not fail another project's unique-case scan; naming
 * that sibling as `caseId` still reports catalog-unavailable / integrity.
 */
async function readCataloguedSensitivityCase(
  reader: CataloguedMechanicalProofCaseReader,
  caseId: string,
  path: string,
): Promise<
  | { readonly caseId: string; readonly path: string; readonly projectId: string }
  | undefined
> {
  let raw: string | undefined;
  try {
    raw = await reader.read(path);
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;
  try {
    const template = validateSensitivityStudyCaseTemplate(JSON.parse(raw));
    if (template.id !== caseId) return undefined;
    return { caseId, path, projectId: template.project.id };
  } catch {
    return undefined;
  }
}

function identityDiagnostics(
  template: SensitivityStudyCaseTemplate,
  projectId: string,
  snapshot: ThreadSnapshot,
  source: "catalog" | "signed-offer",
): SensitivityStudySealDiagnostic[] {
  const label = source === "signed-offer" ? "Signed-offer case" : "Catalogued case";
  const diagnostics: SensitivityStudySealDiagnostic[] = [];
  if (template.project.id !== projectId) {
    diagnostics.push({
      code: "project-mismatch",
      artifactId: null,
      message: `${label} project.id "${template.project.id}" does not match ` +
        `requested projectId "${projectId}".`,
    });
  }
  if (template.project.subjectId !== snapshot.subject.id) {
    diagnostics.push({
      code: "subject-mismatch",
      artifactId: null,
      message:
        `${label} project.subjectId "${template.project.subjectId}" does not match ` +
        `Thread subject "${snapshot.subject.id}".`,
    });
  }
  return diagnostics;
}

function offeredFailure(
  status: "unresolved" | "unavailable",
  caseId: string | undefined,
  diagnostic: SensitivityStudySealDiagnostic,
): {
  readonly status: "unresolved" | "unavailable";
  readonly caseId: string;
  readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
} {
  return {
    status,
    caseId: caseId ?? "",
    diagnostics: [diagnostic],
  };
}

function unresolved(
  caseId: string,
  diagnostics: readonly SensitivityStudySealDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectSensitivityStudySealReviewResult {
  return notAppendable("unresolved", caseId, diagnostics, basis);
}

function notAppendable(
  status: "unresolved" | "unavailable",
  caseId: string,
  diagnostics: readonly SensitivityStudySealDiagnostic[],
  basis?: EngineeringThreadSnapshotBasis,
): ProjectSensitivityStudySealReviewResult {
  return deepFreeze({
    status,
    caseId,
    diagnostics,
    ...(basis ? { basis } : {}),
  });
}

function reviewError(
  code: ProjectSensitivityStudySealReviewErrorCode,
  message: string,
): ProjectSensitivityStudySealReviewError {
  return new ProjectSensitivityStudySealReviewError(code, message);
}
