/**
 * Provider-free compilation of one catalogued proof case into
 * `verify.seal-proof-case@1` MRTR parameters.
 *
 * The server reopens the catalogued JSON and the resolved Thread basis.
 * The caller never supplies proof bytes, hashes or solver numbers. This
 * writes no project or Thread state and grants no MRTR authority.
 */

import type {
  FeaProofSensitivityCatalog,
  ProjectFeaProofSealReviewCommand,
  ProjectFeaProofSealReviewResult,
  ProjectFeaProofSealReviewUseCase,
} from "../ports/in/project-fea-proof-seal-review.ts";
import type { CanonicalAssetReader } from "../ports/out/canonical-asset-reader.ts";
import type { CataloguedMechanicalProofCaseReader } from "../ports/out/catalogued-mechanical-proof-case-reader.ts";
import type { FeaProofSealRequirementsReviewer } from "../ports/out/fea-proof-seal-requirements-reviewer.ts";
import type { TechnicalCompilationAdmissionReader } from "../ports/out/technical-compilation-admission-reader.ts";
import {
  FEA_PROOF_CASE_SOURCES,
  feaProofCaseSourcePath,
  isKnownFeaProofCaseId,
  selectUniqueCataloguedProofCase,
} from "../../domain/analysis/fea-proof-case-catalog.ts";
import {
  type FeaProofSealBindingDiagnostic,
  resolveFeaProofSealThreadBindings,
} from "../../domain/analysis/fea-proof-seal-bindings.ts";
import {
  encodeFeaProofDecisionParameters,
  type FeaProofDecisionParameters,
  feaProofDecisionParametersToMap,
  parseFeaProofDecisionParameters,
  sealProofCaseWorkItemOperation,
} from "../../domain/analysis/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../domain/analysis/mechanical-proof-case.ts";
import { compileSensitivityCatalogOfferFromAdmission } from "../../domain/analysis/sensitivity-catalog-from-proof.ts";
import { listCompileAdmissionArtifacts } from "../../domain/analysis/sensitivity-study-seal-bindings.ts";
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
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import {
  admitFeaProofSealSource,
  type FeaProofSealGeometryCaptureReader,
} from "./fea-proof-seal-source-admission.ts";
import {
  feaReviewNext,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  parseOptionalThreadBasis,
  validateFeaReviewNextState,
} from "./fea-review-support.ts";

export type ProjectFeaProofSealReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "catalog_unavailable"
  | "catalog_integrity_failed";

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
  readonly catalogReader: CataloguedMechanicalProofCaseReader;
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
  readonly #catalogReader: CataloguedMechanicalProofCaseReader;
  readonly #requirementsReviewer: FeaProofSealRequirementsReviewer;
  readonly #geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly #stepAssets: CanonicalAssetReader;
  readonly #admissions: TechnicalCompilationAdmissionReader | undefined;

  constructor(dependencies: PrepareProjectFeaProofSealReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#projects = dependencies.projects;
    this.#catalogReader = dependencies.catalogReader;
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

    const requirements = await this.#requirementsReviewer.review({
      snapshot,
      proofCase: catalogued.proofCase,
    });
    if (requirements.status !== "resolved") {
      return unresolved(catalogued.caseId, requirements.diagnostics, basis);
    }
    const resolved = resolveFeaProofSealThreadBindings(
      snapshot,
      catalogued.proofCase,
      command.projectId,
      requirements.artifact,
    );
    if (resolved.status !== "resolved") {
      return unresolved(catalogued.caseId, resolved.diagnostics, basis);
    }
    try {
      let compiled = await compileSealParameters(
        catalogued.proofCase,
        resolved.bindings.geometryArtifact,
        resolved.bindings.requirementsArtifact,
      );
      const sensitivityCatalog = await this.#sensitivityCatalog(
        snapshot,
        catalogued.proofCase,
        compiled.proofDigest,
        command.projectId,
        basis,
      );
      if (command.sensitivityCatalogOptIn === true) {
        if (sensitivityCatalog.status !== "ready-for-opt-in") {
          return unresolved(catalogued.caseId, [{
            code: "sensitivity-catalog-unavailable",
            artifactId: null,
            message:
              `Sensitivity catalog opt-in was requested, but the compiled offer is ${sensitivityCatalog.status}: ${sensitivityCatalog.message}`,
          }], basis);
        }
        compiled = await compileSealParameters(
          catalogued.proofCase,
          resolved.bindings.geometryArtifact,
          resolved.bindings.requirementsArtifact,
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
          catalogued.caseId,
          [admission.diagnostic],
          basis,
        );
      }
      const selected = {
        caseId: catalogued.caseId,
        proofDigest: compiled.proofDigest,
        basis,
        geometryArtifactId: resolved.bindings.geometryArtifact.id,
        requirementsArtifactId: resolved.bindings.requirementsArtifact.id,
        stepArtifactId: resolved.bindings.stepArtifact.id,
        workItemId: catalogued.proofCase.authorization.workItemId,
        decisionId: catalogued.proofCase.authorization.decisionId,
      };
      const summary =
        `Seal catalogued proof case ${selected.caseId} against Thread r${basis.revision} ` +
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
            "Seal the catalogued mechanical proof declaration without calling a provider.",
          workItemId: selected.workItemId,
          decisionId: selected.decisionId,
          decisionTitle: "Approve FEA proof-case seal",
          decisionQuestion:
            "Approve sealing this exact catalogued proof case against the current Thread basis?",
        }),
      });
    } catch (error) {
      return unresolved(catalogued.caseId, [{
        code: "proposal-grammar-rejected",
        artifactId: null,
        message: error instanceof Error
          ? error.message
          : "The compiled FEA proof parameters were refused.",
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
      readonly proofCase: MechanicalProofCase;
    }
    | {
      readonly status: "unresolved";
      readonly caseId: string;
      readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
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
      const proofCase = validateMechanicalProofCase(JSON.parse(raw));
      if (proofCase.id !== selected.caseId) {
        return {
          status: "catalog_integrity_failed",
          message:
            `Catalog source for "${selected.caseId}" declares proof id "${proofCase.id}".`,
        };
      }
      return { status: "ok", caseId: selected.caseId, proofCase };
    } catch {
      return {
        status: "catalog_integrity_failed",
        message: `Catalog source for "${selected.caseId}" is invalid or non-canonical.`,
      };
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
          "The current Thread tip has no compile.seal-admission@1 admission. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    if (candidates.length > 1) {
      return {
        status: "admission-ambiguous",
        message:
          "Several compile.seal-admission@1 admissions are on the current tip. The server does not pick a lever source. The proof-case review stays resolved.",
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
          "The unique compile.seal-admission@1 admission could not be reopened. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
      };
    }
    if (!reopened) {
      return {
        status: "admission-unavailable",
        message:
          "The unique compile.seal-admission@1 admission could not be reopened. The proof-case review stays resolved. No sensitivity catalog opt-in is offered.",
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
    ["projectId", "basis", "caseId", "sensitivityCatalogOptIn"],
    ["projectId"],
    "$feaProofSealReview",
  );
  const basis = parseOptionalThreadBasis(
    command.basis,
    "$feaProofSealReview.basis",
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
    ...(basis ? { basis } : {}),
    ...(command.caseId === undefined
      ? {}
      : { caseId: safeId(command.caseId, "$feaProofSealReview.caseId") }),
    ...(command.sensitivityCatalogOptIn === undefined
      ? {}
      : { sensitivityCatalogOptIn: command.sensitivityCatalogOptIn }),
  });
}

function namedCase(caseId: string):
  | { readonly status: "ok"; readonly caseId: string; readonly path: string }
  | {
    readonly status: "unresolved";
    readonly caseId: string;
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
  } {
  if (!isKnownFeaProofCaseId(caseId)) {
    return {
      status: "unresolved",
      caseId,
      diagnostics: [{
        code: "catalog-absent",
        artifactId: null,
        message: `Proof case "${caseId}" is not in the server-owned catalog. ` +
          "Add an entry to FEA_PROOF_CASE_SOURCES and the corresponding JSON file.",
      }],
    };
  }
  const path = feaProofCaseSourcePath(caseId);
  if (!path) {
    return {
      status: "unresolved",
      caseId,
      diagnostics: [{
        code: "catalog-absent",
        artifactId: null,
        message: `Proof case "${caseId}" is not in the server-owned catalog.`,
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
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
  }
> {
  const loaded: Array<
    { readonly caseId: string; readonly path: string; readonly projectId: string }
  > = [];
  for (const [caseId, path] of FEA_PROOF_CASE_SOURCES) {
    const candidate = await readCataloguedProofCase(reader, caseId, path);
    if (candidate) loaded.push(candidate);
  }
  const selected = selectUniqueCataloguedProofCase(projectId, loaded);
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
async function readCataloguedProofCase(
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
    const proofCase = validateMechanicalProofCase(JSON.parse(raw));
    if (proofCase.id !== caseId) return undefined;
    return { caseId, path, projectId: proofCase.project.id };
  } catch {
    return undefined;
  }
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
