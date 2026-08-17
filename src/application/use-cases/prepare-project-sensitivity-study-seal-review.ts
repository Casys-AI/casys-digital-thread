/**
 * Provider-free compilation of one catalogued sensitivity-study template into
 * `analyze.seal-sensitivity-study@1` MRTR parameters.
 *
 * The server reopens the catalogued template and the resolved Thread basis.
 * cadSource is the unique readable `compile.seal-admission@1` admission whose
 * source binds the template `target.semanticKey`. The caller never supplies
 * case bytes, hashes or solver numbers. This writes no project or Thread
 * state and grants no MRTR authority.
 */

import type {
  ProjectSensitivityStudySealReviewCommand,
  ProjectSensitivityStudySealReviewResult,
  ProjectSensitivityStudySealReviewUseCase,
} from "../ports/in/project-sensitivity-study-seal-review.ts";
import type { CataloguedMechanicalProofCaseReader } from "../ports/out/catalogued-mechanical-proof-case-reader.ts";
import type { TechnicalCompilationAdmissionReader } from "../ports/out/technical-compilation-admission-reader.ts";
import {
  isKnownSensitivityStudyCaseId,
  selectUniqueCataloguedSensitivityCase,
  SENSITIVITY_STUDY_CASE_SOURCES,
  sensitivityStudyCaseSourcePath,
  sensitivityStudySealIdentities,
} from "../../domain/analysis/sensitivity-study-case-catalog.ts";
import {
  listCompileAdmissionArtifacts,
  listRejectedCadSourceLookalikes,
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

export interface PrepareProjectSensitivityStudySealReviewDependencies {
  readonly snapshots: FeaReviewSnapshotStore;
  readonly projects?: FeaReviewProjectReader;
  readonly catalogReader: CataloguedMechanicalProofCaseReader;
  readonly admissions: TechnicalCompilationAdmissionReader;
}

export class PrepareProjectSensitivityStudySealReview
  implements ProjectSensitivityStudySealReviewUseCase {
  readonly #snapshots: FeaReviewSnapshotStore;
  readonly #projects: FeaReviewProjectReader | undefined;
  readonly #catalogReader: CataloguedMechanicalProofCaseReader;
  readonly #admissions: TechnicalCompilationAdmissionReader;

  constructor(dependencies: PrepareProjectSensitivityStudySealReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#projects = dependencies.projects;
    this.#catalogReader = dependencies.catalogReader;
    this.#admissions = dependencies.admissions;
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

    const catalogued = await this.#openCataloguedCase(
      command.projectId,
      command.caseId,
    );
    if (catalogued.status === "unresolved") {
      return unresolved(catalogued.caseId, catalogued.diagnostics, basis);
    }
    if (catalogued.status !== "ok") {
      return unresolved(command.caseId ?? "", [{
        code: catalogued.status === "catalog_unavailable"
          ? "catalog-unavailable"
          : "catalog-integrity-failed",
        artifactId: null,
        message: catalogued.message,
      }], basis);
    }

    const identity = identityDiagnostics(
      catalogued.template,
      command.projectId,
      snapshot,
    );
    if (identity.length > 0) {
      return unresolved(catalogued.caseId, identity, basis);
    }

    const admission = await this.#resolveUniqueAdmission(
      command.projectId,
      basis,
      snapshot,
      catalogued.template,
    );
    if (admission.status !== "ok") {
      return notAppendable(
        admission.status,
        catalogued.caseId,
        [admission.diagnostic],
        basis,
      );
    }

    try {
      const compiled = await compileSealParameters(
        catalogued.template,
        admission.cadSource,
      );
      const selected = {
        caseId: catalogued.caseId,
        caseDigest: compiled.caseDigest,
        basis,
        admissionArtifactId: admission.artifact.id,
        cadSource: admission.cadSource,
        ...sensitivityStudySealIdentities(catalogued.caseId),
      };
      const summary =
        `Seal catalogued sensitivity study ${selected.caseId} against Thread r${basis.revision} ` +
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
          catalogued.caseId,
          [nextState.diagnostic],
          basis,
        );
      }
      return deepFreeze({
        status: "resolved" as const,
        caseId: catalogued.caseId,
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
          phaseDescription:
            "Seal the catalogued sensitivity-study-case/2.0 without calling a provider.",
          workItemId: selected.workItemId,
          decisionId: selected.decisionId,
          decisionTitle: "Approve sensitivity-study seal",
          decisionQuestion:
            "Approve sealing this exact catalogued sensitivity study against the current Thread admission?",
        }),
      });
    } catch (error) {
      return unresolved(catalogued.caseId, [{
        code: "proposal-grammar-rejected",
        artifactId: null,
        message: error instanceof Error
          ? error.message
          : "The compiled sensitivity-study parameters were refused.",
      }], basis);
    }
  }

  async #openCataloguedCase(
    projectId: string,
    caseId: string | undefined,
  ): Promise<
    | {
      readonly status: "ok";
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
      return { status: "ok", caseId: selected.caseId, template };
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
}

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
): SensitivityStudySealDiagnostic[] {
  const diagnostics: SensitivityStudySealDiagnostic[] = [];
  if (template.project.id !== projectId) {
    diagnostics.push({
      code: "project-mismatch",
      artifactId: null,
      message: `Catalogued case project.id "${template.project.id}" does not match ` +
        `requested projectId "${projectId}".`,
    });
  }
  if (template.project.subjectId !== snapshot.subject.id) {
    diagnostics.push({
      code: "subject-mismatch",
      artifactId: null,
      message:
        `Catalogued case project.subjectId "${template.project.subjectId}" does not match ` +
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
