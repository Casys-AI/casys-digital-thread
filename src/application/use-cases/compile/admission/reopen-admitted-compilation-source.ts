/**
 * Provider-free reopen of one sealed compilation into exact source bytes.
 *
 * Shared by every admitted microVM vertical (Build123d, Modelica, later
 * frontends). It does not execute, select a worker, or grant MRTR authority.
 */

import type {
  ReopenAdmittedCompilationSourceCommand,
  ReopenAdmittedCompilationSourceUseCase,
  ReopenedAdmittedCompilationSource,
} from "../../../ports/in/compile/admission/reopen-admitted-compilation-source.ts";
import {
  ReopenAdmittedCompilationSourceError,
} from "../../../ports/in/compile/admission/reopen-admitted-compilation-source.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputDeclaration,
  type IsolatedCodePolicyRef,
  type IsolatedCodeProfileRef,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  type TechnicalCompilationTarget,
  validateTechnicalCompilationDocument,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../../domain/kernel/deterministic-json.ts";
import { parseExactThreadSnapshotBasis } from "../../../../domain/project/thread-tip.ts";

export interface ReopenAdmittedCompilationSourceDependencies {
  readonly admissions: TechnicalCompilationAdmissionReader;
}

export class ReopenAdmittedCompilationSource
  implements ReopenAdmittedCompilationSourceUseCase {
  readonly #admissions: TechnicalCompilationAdmissionReader;

  constructor(dependencies: ReopenAdmittedCompilationSourceDependencies) {
    this.#admissions = dependencies.admissions;
  }

  async execute(value: unknown): Promise<ReopenedAdmittedCompilationSource> {
    let command: ReopenAdmittedCompilationSourceCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reopenError(
        "invalid_request",
        "The admitted-compilation reopen request failed exact validation.",
      );
    }

    let reopened: ReopenedTechnicalCompilationAdmission | undefined;
    try {
      reopened = await this.#admissions.read({
        projectId: command.projectId,
        basis: command.basis,
        artifactId: command.artifactId,
        artifactFingerprint: command.artifactFingerprint,
      });
    } catch {
      throw reopenError(
        "admission_resolution_failed",
        "The exact technical-compilation admission could not be reopened.",
      );
    }
    if (!reopened) {
      throw reopenError(
        "admission_not_found",
        "The exact technical-compilation admission is unavailable.",
      );
    }

    try {
      return await materializeReadySource(reopened, command.expectedTarget);
    } catch {
      throw reopenError(
        "admission_integrity_failed",
        "The reopened technical-compilation admission is not an exact, singular, ready source for the requested compilation target.",
      );
    }
  }
}

/**
 * Build the only IsolatedCodeRunner payload admitted source may become.
 * Worker, image and outputs remain caller-supplied server-owned facts.
 */
export async function isolatedRequestFromAdmittedSource(input: {
  readonly runId: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly profile: IsolatedCodeProfileRef;
  readonly policy: IsolatedCodePolicyRef;
  readonly outputs: readonly IsolatedCodeOutputDeclaration[];
  readonly maximumSourceBytes: number;
}): Promise<IsolatedCodeExecutionRequest> {
  const sourceBytes = new TextEncoder().encode(input.sourceText);
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: input.runId,
    producerGeneration: 0,
    profile: input.profile,
    source: {
      bytes: sourceBytes,
      sha256: input.sourceSha256,
    },
    policy: input.policy,
    outputs: input.outputs,
  }, input.maximumSourceBytes);
  return {
    schemaVersion: request.schemaVersion,
    runId: request.runId,
    producerGeneration: 0,
    profile: request.profile,
    source: {
      bytes: request.source.bytes.copy(),
      sha256: request.source.sha256,
    },
    policy: request.policy,
    outputs: request.outputs,
  };
}

function parseCommand(value: unknown): ReopenAdmittedCompilationSourceCommand {
  const command = exactRecord(
    value,
    [
      "projectId",
      "basis",
      "artifactId",
      "artifactFingerprint",
      "expectedTarget",
    ],
    "$admittedCompilationSource",
  );
  const artifactFingerprint = validateContentFingerprint(
    command.artifactFingerprint,
    "$admittedCompilationSource.artifactFingerprint",
  );
  const artifactId = safeId(
    command.artifactId,
    "$admittedCompilationSource.artifactId",
  );
  if (
    artifactId !==
      `technical-compilation-admission-${artifactFingerprint.digest}`
  ) {
    throw new TypeError("The admission artifact id must derive from its hash.");
  }
  const expectedTarget = compilationTarget(
    command.expectedTarget,
    "$admittedCompilationSource.expectedTarget",
  );
  return deepFreeze({
    projectId: safeId(command.projectId, "$admittedCompilationSource.projectId"),
    basis: parseExactThreadSnapshotBasis(
      command.basis,
      "$admittedCompilationSource.basis",
    ),
    artifactId,
    artifactFingerprint,
    expectedTarget,
  });
}

async function materializeReadySource(
  reopened: ReopenedTechnicalCompilationAdmission,
  expectedTarget: TechnicalCompilationTarget,
): Promise<ReopenedAdmittedCompilationSource> {
  const document = await validateTechnicalCompilationDocument(reopened.document);
  if (
    document.status !== "ready-for-review" ||
    document.projections.length !== 1 ||
    document.inputManifest.sources.length !== 1 ||
    reopened.admission.sources.length !== 1
  ) {
    throw new TypeError("Admission is not a singular ready compilation.");
  }
  const projection = document.projections[0]!;
  const source = document.inputManifest.sources[0]!;
  if (
    projection.target !== expectedTarget ||
    projection.profile.target !== expectedTarget ||
    projection.status !== "ready-for-review" ||
    projection.diagnostics.length !== 0 ||
    projection.sources.length !== 1 ||
    source.analysis.unresolvedConstructs.length !== 0 ||
    source.analysis.policy.status !== "passed"
  ) {
    throw new TypeError("Admission is not a ready source for the expected target.");
  }
  const sourceFingerprint = await fingerprintTechnicalSourceText(source.sourceText);
  const documentFingerprint = await fingerprintTechnicalCompilationDocument(
    document,
  );
  if (
    !fingerprintsEqual(sourceFingerprint, source.analysis.source.fingerprint)
  ) {
    throw new TypeError("Source bytes disagree with the analysis fingerprint.");
  }
  const admissionSource = reopened.admission.sources[0]!;
  if (admissionSource.id !== source.analysis.source.id) {
    throw new TypeError("Admission source id does not match the compilation document.");
  }
  if (
    deterministicJson(admissionSource.effectiveUnit) !==
      deterministicJson(source.effectiveUnit)
  ) {
    throw new TypeError(
      "Admission effective unit does not match the compilation document.",
    );
  }
  return deepFreeze({
    reopened,
    document,
    documentFingerprint,
    projection,
    sourceId: source.analysis.source.id,
    sourceText: source.sourceText,
    sourceFingerprint,
    analysisFingerprint: source.analysisFingerprint,
    effectiveUnit: source.effectiveUnit,
    attachment: admissionSource.attachment,
    sourceClosure: admissionSource.sourceClosure,
    locator: admissionSource.locator,
  });
}

function compilationTarget(
  value: unknown,
  path: string,
): TechnicalCompilationTarget {
  if (
    value !== "build123d-source" &&
    value !== "modelica-source-qualification" &&
    value !== "calculix-source-candidate" &&
    value !== "spice-circuit-source"
  ) {
    throw new TypeError(`${path} is not a registered compilation target.`);
  }
  return value;
}

function reopenError(
  code: ReopenAdmittedCompilationSourceError["code"],
  message: string,
): ReopenAdmittedCompilationSourceError {
  return new ReopenAdmittedCompilationSourceError(code, message);
}
