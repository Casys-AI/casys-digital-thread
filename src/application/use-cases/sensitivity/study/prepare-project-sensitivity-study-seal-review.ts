/**
 * Provider-free compilation of one sensitivity-study template into
 * `analyze.seal-sensitivity-study@1` MRTR parameters.
 *
 * A named historical catalog id, or the unique catalogued template for the
 * project, still wins. When the catalog does not uniquely select (absent or
 * ambiguous), a unique signed `sensitivity-catalog-offer` on the current tip
 * is reopened, recompiled, and lowered into a
 * `sensitivity-study-case-template/3.0` — including the code-owned mesh-sized
 * step. cadSource is that offer's signed `compile.seal-admission@3`
 * admission, or the unique readable admission that binds a catalogued
 * semanticKey. The caller never supplies case bytes, hashes or solver
 * numbers. This writes no project or Thread state and grants no MRTR
 * authority.
 */

import type {
  ProjectSensitivityStudySealReviewCommand,
  ProjectSensitivityStudySealReviewResult,
  ProjectSensitivityStudySealReviewUseCase,
} from "../../../ports/in/sensitivity/study/project-sensitivity-study-seal-review.ts";
import type { CataloguedSensitivityStudyCaseReader } from "../../../ports/out/sensitivity/study/catalogued-sensitivity-study-case-reader.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { shouldOpenSignedCatalogOffer } from "../../../../domain/sensitivity/study/sensitivity-catalog-offer-join.ts";
import {
  type ContentAddressedCaptureReader,
  reopenSignedCatalogOffer,
} from "./reopen-signed-catalog-offer.ts";
import { assertSensitivityLiveMethod } from "../../../../domain/sensitivity/study/sensitivity-live-method.ts";
import {
  selectUniqueCataloguedSensitivityCase,
  sensitivityStudySealIdentities,
} from "../../../../domain/sensitivity/study/sensitivity-study-case-catalog.ts";
import {
  listCompileAdmissionArtifacts,
  listRejectedCadSourceLookalikes,
  matchAdmittedSensitivityParameter,
  sensitivityCadSourceUri,
  type SensitivityStudySealDiagnostic,
} from "../../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import {
  encodeSensitivityStudyDecisionParameters,
  parseSensitivityStudyDecisionParameters,
  sealSensitivityStudyWorkItemOperation,
  verifySensitivityStudyParametersMatchCase,
} from "../../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  assembleSensitivityStudyCaseV3,
  type SensitivityStudyCaseTemplate,
  validateSensitivityStudyCaseTemplate,
} from "../../../../domain/sensitivity/study/sensitivity-study-template.ts";
import type { SensitivityCadSource } from "../../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import {
  closedRecord,
  deepFreeze,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  feaReviewNext,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  parseOptionalThreadBasis,
  validateFeaReviewNextState,
} from "../../fea/seal-case/fea-review-support.ts";

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

export type { ContentAddressedCaptureReader };

export interface PrepareProjectSensitivityStudySealReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly projects?: FeaReviewProjectReader;
  readonly catalogReader: CataloguedSensitivityStudyCaseReader;
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly catalogOffers?: ContentAddressedCaptureReader;
  readonly proofCaptures?: ContentAddressedCaptureReader;
}

export class PrepareProjectSensitivityStudySealReview
  implements ProjectSensitivityStudySealReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #projects: FeaReviewProjectReader | undefined;
  readonly #catalogReader: CataloguedSensitivityStudyCaseReader;
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
            ? "Seal the provider-neutral sensitivity-study-case/3.0 compiled from the signed catalog offer without calling a provider."
            : "Seal the provider-neutral catalogued sensitivity-study-case/3.0 without calling a provider.",
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
        catalogStatus: catalogued.status === "ok" ||
            catalogued.status === "catalog_unavailable" ||
            catalogued.status === "catalog_integrity_failed"
          ? catalogued.status
          : "unresolved",
      })
    ) {
      return catalogued;
    }
    const offered = await reopenSignedCatalogOffer({
      projectId,
      namedCaseId: caseId,
      basis,
      snapshot,
      admissions: this.#admissions,
      catalogOffers: this.#catalogOffers,
      proofCaptures: this.#proofCaptures,
    });
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
      ? await namedCase(caseId, this.#catalogReader)
      : await uniqueCaseForProject(projectId, this.#catalogReader);
    if (selected.status !== "ok") return selected;
    let raw: string | undefined;
    try {
      raw = await this.#catalogReader.read(selected.caseId);
    } catch {
      return {
        status: "catalog_unavailable",
        message:
          `Catalog entry "${selected.caseId}" could not be read from the server-owned manifest.`,
      };
    }
    if (raw === undefined) {
      return {
        status: "catalog_unavailable",
        message:
          `Catalog entry "${selected.caseId}" is registered, but its manifest file is unavailable.`,
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
              "cadSource must be a compile.seal-admission@3 admission document URI + sha256. " +
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
            "The current Thread tip has no compile.seal-admission@3 admission document. " +
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
            `Several compile.seal-admission@3 admissions bind ${template.target.semanticKey}: ` +
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
            "A compile.seal-admission@3 admission on the current tip could not be reopened. " +
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
  const studyCase = assembleSensitivityStudyCaseV3(template, cadSource);
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

async function namedCase(
  caseId: string,
  reader: CataloguedSensitivityStudyCaseReader,
): Promise<
  | { readonly status: "ok"; readonly caseId: string }
  | {
    readonly status: "unresolved";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  }
  | { readonly status: "catalog_unavailable"; readonly message: string }
> {
  let entries: readonly { readonly caseId: string }[];
  try {
    entries = await reader.list();
  } catch {
    return {
      status: "catalog_unavailable",
      message:
        `The server-owned sensitivity-study catalog manifest could not be opened for "${caseId}".`,
    };
  }
  if (!entries.some((entry) => entry.caseId === caseId)) {
    return {
      status: "unresolved",
      caseId,
      diagnostics: [{
        code: "catalog-absent",
        artifactId: null,
        message: `Sensitivity case "${caseId}" is not in the server-owned catalog. ` +
          "Add a reviewed JSON template to the manifest.",
      }],
    };
  }
  return { status: "ok", caseId };
}

async function uniqueCaseForProject(
  projectId: string,
  reader: CataloguedSensitivityStudyCaseReader,
): Promise<
  | { readonly status: "ok"; readonly caseId: string }
  | {
    readonly status: "unresolved";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
  }
  | { readonly status: "catalog_unavailable"; readonly message: string }
> {
  const loaded: Array<{ readonly caseId: string; readonly projectId: string }> = [];
  let entries: readonly { readonly caseId: string }[];
  try {
    entries = await reader.list();
  } catch {
    return {
      status: "catalog_unavailable",
      message:
        "The server-owned sensitivity-study catalog manifest could not be opened.",
    };
  }
  for (const { caseId } of entries) {
    const candidate = await readCataloguedSensitivityCase(reader, caseId);
    if (candidate) loaded.push(candidate);
  }
  const selected = selectUniqueCataloguedSensitivityCase(projectId, loaded);
  if (selected.status === "ok") {
    return { status: "ok", caseId: selected.caseId };
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
 * Auto-select only considers readable, exact manifest entries. A missing or
 * invalid sibling must not fail another project's unique-case scan; naming
 * that sibling as `caseId` still reports catalog-unavailable / integrity.
 */
async function readCataloguedSensitivityCase(
  reader: CataloguedSensitivityStudyCaseReader,
  caseId: string,
): Promise<{ readonly caseId: string; readonly projectId: string } | undefined> {
  let raw: string | undefined;
  try {
    raw = await reader.read(caseId);
  } catch {
    return undefined;
  }
  if (raw === undefined) return undefined;
  try {
    const template = validateSensitivityStudyCaseTemplate(JSON.parse(raw));
    if (template.id !== caseId) return undefined;
    return { caseId, projectId: template.project.id };
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
