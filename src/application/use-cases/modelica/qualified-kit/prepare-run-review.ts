/**
 * Prepare the closed MRTR review for the one qualified local Modelica kit.
 *
 * This boundary performs no execution and exposes no source text. The
 * executor-only method retains the validated bundle so a later registered
 * executor can dispatch the exact bytes after reopening the signed decision.
 */

import type {
  ProjectModelicaQualifiedKitRunReviewCommand,
  ProjectModelicaQualifiedKitRunReviewResult,
  ProjectModelicaQualifiedKitRunReviewUseCase,
} from "../../../ports/in/modelica/qualified-kit-run-review.ts";
import type {
  ModelicaQualifiedKitBundleFactory,
} from "../../../ports/out/modelica/qualified-kit-bundle-factory.ts";
import type {
  ModelicaQualifiedKitReviewBasisAuthority,
} from "../../../ports/out/modelica/qualified-kit-review-basis-authority.ts";
import type {
  ModelicaIsolatedExecutionProfile,
  ModelicaIsolatedExecutionProfileCatalog,
} from "../../../ports/out/modelica/isolated-execution-profile.ts";
import type {
  ModelicaIsolatedExecutionQualificationAuthority,
} from "../../../ports/out/modelica/isolated-execution-qualification.ts";
import {
  encodeModelicaQualifiedKitRunAdmissionParameters,
  MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
  MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
  MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
  type ModelicaQualifiedKitRunAdmission,
  type ModelicaQualifiedKitRunBundleFacts,
  type ModelicaQualifiedKitRunExecutionProfileFacts,
  parseModelicaQualifiedKitRunAdmissionParameters,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  validateModelicaQualifiedKitRunAdmission,
  validateModelicaQualifiedKitRunExecutionProfileFacts,
} from "../../../../domain/modelica/qualified-kit/run-proposal.ts";
import {
  type PreparedModelicaIsolatedInputBundle,
  validateModelicaIsolatedInputBundle,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  type ModelicaMicrosandboxQualificationReference,
  validateModelicaMicrosandboxQualificationReference,
} from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

export type ProjectModelicaQualifiedKitRunReviewErrorCode =
  | "invalid_request"
  | "basis_unavailable"
  | "basis_integrity_failed"
  | "profile_unavailable"
  | "profile_integrity_failed"
  | "runtime_qualification_unavailable"
  | "runtime_qualification_integrity_failed"
  | "bundle_unavailable"
  | "bundle_integrity_failed";

export class ProjectModelicaQualifiedKitRunReviewError extends Error {
  constructor(
    readonly code: ProjectModelicaQualifiedKitRunReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectModelicaQualifiedKitRunReviewError";
  }
}

export interface PrepareProjectModelicaQualifiedKitRunReviewDependencies {
  readonly basisAuthority: ModelicaQualifiedKitReviewBasisAuthority;
  readonly profiles: ModelicaIsolatedExecutionProfileCatalog;
  readonly qualifications: ModelicaIsolatedExecutionQualificationAuthority;
  readonly bundleFactory: ModelicaQualifiedKitBundleFactory;
}

/** Internal material for the registered executor; never a tool result. */
export interface PreparedQualifiedModelicaRunReview
  extends ProjectModelicaQualifiedKitRunReviewResult {
  readonly bundle: PreparedModelicaIsolatedInputBundle;
}

export class PrepareProjectModelicaQualifiedKitRunReview
  implements ProjectModelicaQualifiedKitRunReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectModelicaQualifiedKitRunReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectModelicaQualifiedKitRunReviewResult> {
    const prepared = await this.prepareForExecution(value);
    return deepFreeze({
      admission: prepared.admission,
      decisionParameters: prepared.decisionParameters,
    });
  }

  async prepareForExecution(
    value: unknown,
  ): Promise<PreparedQualifiedModelicaRunReview> {
    let command: ProjectModelicaQualifiedKitRunReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The qualified Modelica review request failed exact validation.",
      );
    }

    let reopenedBasis:
      | { readonly projectId: string; readonly basis: EngineeringThreadSnapshotBasis }
      | undefined;
    try {
      reopenedBasis = await this.dependencies.basisAuthority.reopenExact(command);
    } catch {
      throw reviewError(
        "basis_unavailable",
        "The exact project and Thread basis could not be reopened.",
      );
    }
    if (!reopenedBasis) {
      throw reviewError(
        "basis_unavailable",
        "The exact project and Thread basis is unavailable.",
      );
    }
    try {
      const canonical = parseCommand(reopenedBasis);
      if (deterministicJson(canonical) !== deterministicJson(command)) {
        throw new TypeError("The reopened Modelica review basis is foreign.");
      }
    } catch {
      throw reviewError(
        "basis_integrity_failed",
        "The reopened project and Thread basis differs from the requested current basis.",
      );
    }

    let rawProfile: ModelicaIsolatedExecutionProfile;
    try {
      rawProfile = await this.dependencies.profiles.initial();
    } catch {
      throw reviewError(
        "profile_unavailable",
        "The server-owned qualified Modelica profile is unavailable.",
      );
    }

    let profile: ModelicaQualifiedKitRunExecutionProfileFacts;
    try {
      profile = validateModelicaQualifiedKitRunExecutionProfileFacts(rawProfile);
      const { profileFingerprint, ...profileBody } = profile;
      if (
        !fingerprintsEqual(profileFingerprint, await sha256Fingerprint(profileBody))
      ) {
        throw new TypeError("The Modelica profile fingerprint is stale.");
      }
    } catch {
      throw reviewError(
        "profile_integrity_failed",
        "The server-owned qualified Modelica profile failed integrity validation.",
      );
    }

    let rawQualification: ModelicaMicrosandboxQualificationReference | undefined;
    try {
      rawQualification = await this.dependencies.qualifications.reopenQualified(
        profile as ModelicaIsolatedExecutionProfile,
      );
    } catch {
      throw reviewError(
        "runtime_qualification_unavailable",
        "The exact local Modelica runtime qualification could not be reopened.",
      );
    }
    if (!rawQualification) {
      throw reviewError(
        "runtime_qualification_unavailable",
        "The exact local Modelica runtime profile is not qualified.",
      );
    }

    let runtimeQualification: ModelicaMicrosandboxQualificationReference;
    try {
      runtimeQualification = validateModelicaMicrosandboxQualificationReference(
        rawQualification,
        profile.profileFingerprint,
      );
      if (
        !fingerprintsEqual(
          runtimeQualification.fingerprint,
          MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
        )
      ) {
        throw new TypeError("The runtime qualification is not the pinned capture.");
      }
    } catch {
      throw reviewError(
        "runtime_qualification_integrity_failed",
        "The local Modelica runtime qualification does not bind the selected profile.",
      );
    }

    let rawBundle: PreparedModelicaIsolatedInputBundle;
    try {
      rawBundle = await this.dependencies.bundleFactory.prepare({
        projectId: command.projectId,
        basis: command.basis,
        profile: profile as ModelicaIsolatedExecutionProfile,
        runtimeQualification,
      });
    } catch {
      throw reviewError(
        "bundle_unavailable",
        "The exact qualified Modelica input bundle could not be reopened.",
      );
    }

    let bundle: PreparedModelicaIsolatedInputBundle;
    let admission: ModelicaQualifiedKitRunAdmission;
    let decisionParameters:
      ProjectModelicaQualifiedKitRunReviewResult["decisionParameters"];
    try {
      bundle = await validatePreparedBundle(rawBundle);
      const bundleFacts: ModelicaQualifiedKitRunBundleFacts = deepFreeze({
        schemaVersion: bundle.document.schemaVersion,
        fingerprint: bundle.fingerprint,
        byteCount: bundle.bytes.byteLength,
        qualification: bundle.document.qualification,
        selection: bundle.document.selection,
        invocation: bundle.document.invocation,
        method: bundle.document.method,
        inputs: bundle.document.inputs.map(({ text: _text, ...input }) => input),
      });
      admission = validateModelicaQualifiedKitRunAdmission({
        schemaVersion: MODELICA_QUALIFIED_KIT_RUN_ADMISSION_SCHEMA,
        operation: SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
        project: { id: command.projectId, basis: command.basis },
        intent: {
          purpose: MODELICA_QUALIFIED_KIT_RUN_PURPOSE,
          arbitraryModelica: false,
        },
        bundle: bundleFacts,
        execution: { profile, runtimeQualification },
        status: "ready-for-qualified-modelica-review",
      });
      decisionParameters = encodeModelicaQualifiedKitRunAdmissionParameters(admission);
      const replay = parseModelicaQualifiedKitRunAdmissionParameters(
        decisionParameters,
      );
      const reencoded = encodeModelicaQualifiedKitRunAdmissionParameters(replay);
      if (deterministicJson(decisionParameters) !== deterministicJson(reencoded)) {
        throw new TypeError("The qualified Modelica MRTR sequence is not canonical.");
      }
      admission = replay;
      decisionParameters = reencoded;
    } catch {
      throw reviewError(
        "bundle_integrity_failed",
        "The reopened bundle is not the exact qualified Modelica conformance kit.",
      );
    }

    return deepFreeze({ admission, decisionParameters, bundle });
  }
}

function parseCommand(value: unknown): ProjectModelicaQualifiedKitRunReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "basis"],
    "$modelicaQualifiedKitRunReview",
  );
  return deepFreeze({
    projectId: safeId(root.projectId, "$modelicaQualifiedKitRunReview.projectId"),
    basis: parseBasis(root.basis, "$modelicaQualifiedKitRunReview.basis"),
  });
}

function parseBasis(value: unknown, path: string): EngineeringThreadSnapshotBasis {
  const root = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(root.kind, "thread-snapshot", `${path}.kind`);
  const snapshotId = safeId(root.snapshotId, `${path}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.snapshotId cannot be latest.`);
  }
  return deepFreeze({
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

async function validatePreparedBundle(
  value: PreparedModelicaIsolatedInputBundle,
): Promise<PreparedModelicaIsolatedInputBundle> {
  const root = exactRecord(
    value,
    ["document", "text", "bytes", "fingerprint"],
    "$qualifiedModelicaBundle",
  );
  const document = await validateModelicaIsolatedInputBundle(root.document);
  const text = deterministicJson(document);
  if (root.text !== text || !(root.bytes instanceof Uint8Array)) {
    throw new TypeError("The prepared Modelica bundle is not canonical bytes.");
  }
  const bytes = new TextEncoder().encode(text);
  if (
    root.bytes.byteLength !== bytes.byteLength ||
    root.bytes.some((byte, index) => byte !== bytes[index])
  ) throw new TypeError("The prepared Modelica bundle bytes differ from its document.");
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$qualifiedModelicaBundle.fingerprint",
  );
  if (!fingerprintsEqual(fingerprint, await sha256Fingerprint(document))) {
    throw new TypeError("The prepared Modelica bundle fingerprint is stale.");
  }
  return Object.freeze({
    document,
    text,
    bytes: Uint8Array.from(bytes),
    fingerprint,
  });
}

function reviewError(
  code: ProjectModelicaQualifiedKitRunReviewErrorCode,
  message: string,
): ProjectModelicaQualifiedKitRunReviewError {
  return new ProjectModelicaQualifiedKitRunReviewError(code, message);
}
