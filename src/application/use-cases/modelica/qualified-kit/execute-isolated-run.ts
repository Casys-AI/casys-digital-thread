/** Recovery-safe local Modelica execution behind `IsolatedCodeRunner`. */

import type {
  ModelicaIsolatedExecutionAttempt,
  ModelicaIsolatedExecutionAttemptIdentity,
  ModelicaIsolatedExecutionAttemptKey,
  ModelicaIsolatedExecutionAttemptStore,
  ModelicaIsolatedExecutionCaptureReference,
} from "../../../ports/out/modelica/isolated-execution-attempt-store.ts";
import type { ModelicaIsolatedExecutionCaptureStore } from "../../../ports/out/modelica/isolated-execution-evidence-store.ts";
import type { ModelicaIsolatedExecutionProfileCatalog } from "../../../ports/out/modelica/isolated-execution-profile.ts";
import type { ModelicaIsolatedExecutionQualificationAuthority } from "../../../ports/out/modelica/isolated-execution-qualification.ts";
import type { ModelicaIsolatedExecutionRunLease } from "../../../ports/out/modelica/isolated-execution-run-lease.ts";
import {
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
  type IsolatedCodeRunRecovery,
  type IsolatedOutputPublicationReader,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  createModelicaIsolatedExecutionCapture,
  type ModelicaIsolatedExecutionCapture,
} from "../../../../domain/modelica/qualified-kit/isolated-execution-evidence.ts";
import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputValidationRejection,
  type IsolatedOutputProducerGeneration,
  validateContentFingerprint,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeExecutionRequest,
  validateIsolatedCodeOutputValidationRejection,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  assertModelicaBundleMethod,
  type ModelicaIsolatedEvidence,
  type PreparedModelicaIsolatedInputBundle,
  validateModelicaIsolatedInputBundle,
  validateModelicaIsolatedRun,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import { safeId } from "../../../../domain/kernel/case-validation.ts";
import { validateModelicaMicrosandboxQualificationReference } from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";

export class ModelicaIsolatedExecutionOutcomeUnknownError extends Error {
  constructor(message = "The local Modelica execution outcome remains unknown.") {
    super(message);
    this.name = "ModelicaIsolatedExecutionOutcomeUnknownError";
  }
}

/**
 * Terminal qualified-kit conversion of a public isolated output-validation
 * rejection. It carries only the registered role, observed size/digest and
 * proven destruction; no worker diagnostic, bytes, path or handle.
 */
export class IsolatedQualifiedModelicaOutputValidationRejectedError extends Error {
  readonly code = "output_validation_rejected" as const;
  readonly executionRunId: string;
  readonly observation: IsolatedCodeOutputValidationRejection;
  readonly destruction: Extract<
    IsolatedCodeExecutionReceipt["destruction"],
    { readonly status: "proven" }
  >;

  constructor(input: {
    readonly executionRunId: string;
    readonly observation: IsolatedCodeOutputValidationRejection;
    readonly destruction: IsolatedCodeExecutionReceipt["destruction"];
  }) {
    super(
      "A code-owned isolated qualified Modelica output validator rejected the observed bytes; no redispatch occurs.",
    );
    this.name = "IsolatedQualifiedModelicaOutputValidationRejectedError";
    this.executionRunId = safeId(input.executionRunId, "$rejection.executionRunId");
    this.observation = validateIsolatedCodeOutputValidationRejection(
      input.observation,
    );
    const destruction = validateIsolatedCodeExecutionDestruction(
      input.destruction,
      this.executionRunId,
    );
    if (destruction.status !== "proven") {
      throw new TypeError("Output-validation rejection requires proven destruction.");
    }
    this.destruction = destruction;
  }
}

export class ModelicaIsolatedExecutionProfileUnqualifiedError extends Error {
  constructor() {
    super(
      "The local Modelica profile has no exact-image OpenModelica smoke qualification.",
    );
    this.name = "ModelicaIsolatedExecutionProfileUnqualifiedError";
  }
}

export interface ExecuteIsolatedModelicaRunInput {
  readonly projectId: string;
  readonly agentRunId: string;
  /** Exact MRTR-sealed project-run input; never a resolved-operation-plan. */
  readonly reviewedRunFingerprint: ContentFingerprint;
  readonly bundle: PreparedModelicaIsolatedInputBundle;
  readonly preparedAt: string;
}

export interface ExecuteIsolatedModelicaRunResult {
  readonly executionRunId: string;
  readonly receipt: IsolatedCodeExecutionReceipt;
  readonly evidence: ModelicaIsolatedEvidence;
  readonly capture: ModelicaIsolatedExecutionCapture;
  readonly captureReference: ModelicaIsolatedExecutionCaptureReference;
}

export interface ExecuteIsolatedModelicaRunDependencies {
  readonly profiles: ModelicaIsolatedExecutionProfileCatalog;
  readonly qualifications: ModelicaIsolatedExecutionQualificationAuthority;
  readonly lease: ModelicaIsolatedExecutionRunLease;
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
  readonly attempts: ModelicaIsolatedExecutionAttemptStore;
  readonly captures: ModelicaIsolatedExecutionCaptureStore;
}

/**
 * This use case owns no project lifecycle mutation.  Its successful result is
 * durable evidence that the dedicated qualified-kit executor can materialize
 * into Thread only after repeating its closed MRTR and qualification checks.
 */
export class ExecuteIsolatedModelicaRun {
  constructor(private readonly d: ExecuteIsolatedModelicaRunDependencies) {}

  async execute(
    input: ExecuteIsolatedModelicaRunInput,
  ): Promise<ExecuteIsolatedModelicaRunResult> {
    const projectId = safeId(input.projectId, "$input.projectId");
    const agentRunId = safeId(input.agentRunId, "$input.agentRunId");
    const executionRunId = await deriveModelicaIsolatedExecutionRunId({
      projectId,
      agentRunId,
    });
    const reviewedRunFingerprint = validateContentFingerprint(
      input.reviewedRunFingerprint,
      "$input.reviewedRunFingerprint",
    );
    const profile = await this.d.profiles.initial();
    const reopenedQualification = await this.d.qualifications.reopenQualified(profile);
    if (!reopenedQualification) {
      throw new ModelicaIsolatedExecutionProfileUnqualifiedError();
    }
    const runtimeQualification = validateModelicaMicrosandboxQualificationReference(
      reopenedQualification,
      profile.profileFingerprint,
    );
    const bundle = await validatePreparedBundle(input.bundle);
    assertModelicaBundleMethod(bundle.document, profile.method);
    if (
      bundle.bytes.byteLength > profile.maximumBundleBytes ||
      bundle.document.invocation.timeoutMs >
        profile.runtime.requestedLimits.maxWallTimeMs
    ) {
      throw new TypeError("The qualified Modelica bundle exceeds its local profile.");
    }
    const validatedRequest = await validateIsolatedCodeExecutionRequest({
      schemaVersion: "isolated-code-execution-request/1.0",
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      source: {
        bytes: bundle.bytes,
        sha256: bundle.fingerprint.digest,
      },
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    }, profile.maximumBundleBytes);
    const request: IsolatedCodeExecutionRequest = {
      schemaVersion: validatedRequest.schemaVersion,
      runId: validatedRequest.runId,
      producerGeneration: validatedRequest.producerGeneration,
      profile: validatedRequest.profile,
      source: {
        bytes: validatedRequest.source.bytes.copy(),
        sha256: validatedRequest.source.sha256,
      },
      policy: validatedRequest.policy,
      outputs: validatedRequest.outputs,
    };
    const identity: ModelicaIsolatedExecutionAttemptIdentity = {
      projectId,
      agentRunId,
      executionRunId,
      reviewedRunFingerprint,
      bundle: {
        ...bundle.document,
        inputs: bundle.document.inputs.map(({ text: _text, ...member }) => member),
        byteCount: bundle.bytes.byteLength,
        fingerprint: bundle.fingerprint,
      },
      executionProfile: profile,
      runtimeQualification,
      isolatedRequest: {
        schemaVersion: request.schemaVersion,
        runId: request.runId,
        producerGeneration: 0,
        profile: request.profile,
        sourceSha256: request.source.sha256,
        policy: request.policy,
        outputs: request.outputs,
      },
    };
    return await this.d.lease.withLease(projectId, executionRunId, async () => {
      let attempt = await this.d.attempts.prepare(identity, input.preparedAt);
      const key = keyFor(attempt);
      let receipt: IsolatedCodeExecutionReceipt | undefined;
      let dispatchNow = false;
      if (attempt.phase === "output-validation-rejected") {
        throwOutputValidationRejected(attempt);
      }

      if (attempt.phase === "prepared") {
        attempt = await this.d.attempts.markDispatching({
          ...key,
          dispatchedAt: input.preparedAt,
        });
        if (attempt.phase !== "dispatching") {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError();
        }
        dispatchNow = true;
      }

      if (attempt.phase === "dispatching") {
        const recovered = dispatchNow
          ? await this.#dispatchOrRecover(
            requestForGeneration(request, attempt.dispatch.producerGeneration),
            attempt,
          )
          : await this.#recoverDispatch(attempt);
        if (recovered.kind === "receipt") {
          receipt = recovered.receipt;
          attempt = await this.#recordReceipt(attempt, key, receipt);
        } else {
          attempt = recovered.attempt;
        }
      }

      if (attempt.phase === "generation-zero-cleaned") {
        const advance = await this.d.recovery.advanceProducerGeneration({
          runId: executionRunId,
          closedGeneration: 0,
          nextGeneration: 1,
        });
        attempt = await this.d.attempts.markRedispatching({
          ...key,
          advance,
          dispatchedAt: input.preparedAt,
        });
        if (
          attempt.phase !== "dispatching" ||
          attempt.dispatch.producerGeneration !== 1
        ) {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError();
        }
        const recovered = await this.#dispatchOrRecover(
          requestForGeneration(request, 1),
          attempt,
        );
        if (recovered.kind !== "receipt") {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError(
            "The Modelica retry generation did not produce a receipt.",
          );
        }
        receipt = recovered.receipt;
        attempt = await this.#recordReceipt(attempt, key, receipt);
      }

      if (attempt.phase === "output-published") {
        await this.#reopenReceipt(attempt);
        const outputRecords = new Map(
          attempt.receiptRecord.outputs.map((output) => [output.role, output]),
        );
        const evidenceRecord = outputRecords.get("evidence");
        const resultRecord = outputRecords.get("result");
        if (!evidenceRecord || !resultRecord || outputRecords.size !== 2) {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError(
            "The published local Modelica output set is incomplete.",
          );
        }
        const [evidenceBytes, resultBytes] = await Promise.all([
          this.d.publications.readPublishedObject(
            attempt.receiptRecord.publication.ref,
            evidenceRecord,
          ),
          this.d.publications.readPublishedObject(
            attempt.receiptRecord.publication.ref,
            resultRecord,
          ),
        ]);
        if (!evidenceBytes || !resultBytes) {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError(
            "The published local Modelica output bytes cannot be reopened.",
          );
        }
        const evidence = await validateModelicaIsolatedRun({
          bundle: bundle.document,
          evidenceBytes,
          resultBytes,
        });
        const capture = await createModelicaIsolatedExecutionCapture({
          schemaVersion: "modelica-qualified-kit-execution-capture/1.0",
          operation: { id: "simulate.run-qualified-modelica-kit", version: "1" },
          projectId,
          agentRunId,
          executionRunId,
          reviewedRunFingerprint,
          bundle: {
            fingerprint: bundle.fingerprint,
            byteCount: bundle.bytes.byteLength,
            caseSha256: bundle.document.qualification.caseSha256,
            manifestSha256: bundle.document.qualification.manifestSha256,
            sourceCaptureSha256: bundle.document.qualification.sourceCaptureSha256,
          },
          executionProfileFingerprint: profile.profileFingerprint,
          runtimeQualification,
          generationRecovery: attempt.generationRecovery,
          receipt: attempt.receiptRecord,
          evidence,
        });
        const persisted = await this.d.captures.save(capture);
        const captureReference: ModelicaIsolatedExecutionCaptureReference = {
          schemaVersion: "modelica-qualified-kit-execution-capture-reference/1.0",
          uri: persisted.uri,
          fingerprint: persisted.fingerprint,
        };
        attempt = await this.d.attempts.markEvidencePersisted({
          ...key,
          evidence,
          capture: captureReference,
        });
      }

      if (attempt.phase === "evidence-persisted") {
        attempt = await this.d.attempts.markCompleted(key);
      }
      if (attempt.phase !== "completed") {
        throw new ModelicaIsolatedExecutionOutcomeUnknownError();
      }
      return await this.#reopenCompleted(attempt, bundle);
    });
  }

  /**
   * Replay-only boundary for a project run that already entered publication.
   * It never prepares a WAL or dispatches: absence or any non-completed phase
   * is an integrity failure that keeps the project run recoverable.
   */
  async reopenCompleted(
    input: ExecuteIsolatedModelicaRunInput,
  ): Promise<ExecuteIsolatedModelicaRunResult> {
    const projectId = safeId(input.projectId, "$input.projectId");
    const agentRunId = safeId(input.agentRunId, "$input.agentRunId");
    const reviewedRunFingerprint = validateContentFingerprint(
      input.reviewedRunFingerprint,
      "$input.reviewedRunFingerprint",
    );
    const bundle = await validatePreparedBundle(input.bundle);
    const attempt = await this.d.attempts.read(projectId, agentRunId);
    if (
      !attempt || attempt.phase !== "completed" ||
      !fingerprintsEqual(
        attempt.identity.reviewedRunFingerprint,
        reviewedRunFingerprint,
      ) ||
      !fingerprintsEqual(attempt.identity.bundle.fingerprint, bundle.fingerprint)
    ) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The completed local Modelica journal cannot be reopened exactly.",
      );
    }
    const profile = await this.d.profiles.initial();
    const qualification = await this.d.qualifications.reopenQualified(profile);
    if (!qualification) throw new ModelicaIsolatedExecutionProfileUnqualifiedError();
    if (
      !fingerprintsEqual(
        qualification.fingerprint,
        attempt.identity.runtimeQualification.fingerprint,
      ) ||
      !fingerprintsEqual(
        profile.profileFingerprint,
        attempt.identity.executionProfile.profileFingerprint,
      )
    ) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The completed local Modelica runtime authority drifted.",
      );
    }
    return await this.#reopenCompleted(attempt, bundle);
  }

  /**
   * Replay-only terminal: if the WAL already recorded an output-validation
   * rejection, throw the provider-specific error without runner, recovery,
   * CAS, or generation advance. Other phases return without effect.
   */
  async reopenOutputValidationRejection(input: {
    readonly projectId: string;
    readonly agentRunId: string;
  }): Promise<void> {
    const projectId = safeId(input.projectId, "$input.projectId");
    const agentRunId = safeId(input.agentRunId, "$input.agentRunId");
    const attempt = await this.d.attempts.read(projectId, agentRunId);
    if (attempt?.phase === "output-validation-rejected") {
      throwOutputValidationRejected(attempt);
    }
  }

  async #dispatchOrRecover(
    request: IsolatedCodeExecutionRequest,
    attempt: Extract<ModelicaIsolatedExecutionAttempt, { phase: "dispatching" }>,
  ): Promise<
    | { readonly kind: "receipt"; readonly receipt: IsolatedCodeExecutionReceipt }
    | {
      readonly kind: "generation-zero-cleaned";
      readonly attempt: Extract<
        ModelicaIsolatedExecutionAttempt,
        { phase: "generation-zero-cleaned" }
      >;
    }
  > {
    try {
      return { kind: "receipt", receipt: await this.d.runner.run(request) };
    } catch (error) {
      if (error instanceof IsolatedCodeOutputValidationRejectedError) {
        if (
          error.destruction.status !== "proven" ||
          error.destruction.runId !== attempt.executionRunId
        ) {
          throw new ModelicaIsolatedExecutionOutcomeUnknownError(
            "Isolated Modelica output-validation cleanup is not proven; no redispatch occurs.",
          );
        }
        const rejected = await this.d.attempts.markOutputValidationRejected({
          ...keyFor(attempt),
          observation: error.observation,
          destruction: error.destruction,
        });
        return throwOutputValidationRejected(rejected);
      }
      return await this.#recoverDispatch(attempt);
    }
  }

  async #recoverDispatch(
    attempt: Extract<ModelicaIsolatedExecutionAttempt, { phase: "dispatching" }>,
  ): Promise<
    | { readonly kind: "receipt"; readonly receipt: IsolatedCodeExecutionReceipt }
    | {
      readonly kind: "generation-zero-cleaned";
      readonly attempt: Extract<
        ModelicaIsolatedExecutionAttempt,
        { phase: "generation-zero-cleaned" }
      >;
    }
  > {
    const producerGeneration = attempt.dispatch.producerGeneration;
    const resolution = await this.d.publications.resolvePublicationByRunId(
      attempt.executionRunId,
      producerGeneration,
    );
    if (resolution.status === "published") {
      const receipt = await this.d.publications.readReceipt(resolution.ref);
      if (
        !receipt || deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
          deterministicJson(resolution.receipt)
      ) {
        throw new ModelicaIsolatedExecutionOutcomeUnknownError(
          "The published Modelica receipt cannot be reopened exactly.",
        );
      }
      return { kind: "receipt", receipt };
    }
    if (resolution.status === "outcome-unknown") {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError();
    }
    const destruction = await this.d.recovery.destroyByRunId(
      attempt.executionRunId,
      producerGeneration,
    );
    if (destruction.status !== "proven") {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The unpublished Modelica run cleanup was not proven.",
      );
    }
    if (producerGeneration === 1) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The single Modelica retry generation was cleaned up without publication; no third dispatch is allowed.",
      );
    }
    const cleaned = await this.d.attempts.markGenerationZeroCleaned({
      ...keyFor(attempt),
      destruction,
    });
    if (cleaned.phase !== "generation-zero-cleaned") {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError();
    }
    return { kind: "generation-zero-cleaned", attempt: cleaned };
  }

  async #recordReceipt(
    attempt: Extract<ModelicaIsolatedExecutionAttempt, { phase: "dispatching" }>,
    key: ModelicaIsolatedExecutionAttemptKey,
    receipt: IsolatedCodeExecutionReceipt,
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    if (
      receipt.runId !== attempt.executionRunId ||
      receipt.producerGeneration !== attempt.dispatch.producerGeneration
    ) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The isolated runner returned a foreign Modelica run.",
      );
    }
    return await this.d.attempts.markOutputPublished({
      ...key,
      receiptRecord: isolatedCodeExecutionReceiptRecord(receipt),
    });
  }

  async #reopenReceipt(
    attempt: Extract<
      ModelicaIsolatedExecutionAttempt,
      { phase: "output-published" | "evidence-persisted" | "completed" }
    >,
  ): Promise<IsolatedCodeExecutionReceipt> {
    const receipt = await this.d.publications.readReceipt(
      attempt.receiptRecord.publication.ref,
    );
    if (
      !receipt || deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(attempt.receiptRecord)
    ) throw new ModelicaIsolatedExecutionOutcomeUnknownError();
    return receipt;
  }

  async #reopenCompleted(
    attempt: Extract<ModelicaIsolatedExecutionAttempt, { phase: "completed" }>,
    bundle: PreparedModelicaIsolatedInputBundle,
  ): Promise<ExecuteIsolatedModelicaRunResult> {
    const receipt = await this.#reopenReceipt(attempt);
    const capture = await this.d.captures.read(attempt.capture.fingerprint);
    const expectedCapture = await createModelicaIsolatedExecutionCapture({
      schemaVersion: "modelica-qualified-kit-execution-capture/1.0",
      operation: { id: "simulate.run-qualified-modelica-kit", version: "1" },
      projectId: attempt.projectId,
      agentRunId: attempt.agentRunId,
      executionRunId: attempt.executionRunId,
      reviewedRunFingerprint: attempt.identity.reviewedRunFingerprint,
      bundle: {
        fingerprint: bundle.fingerprint,
        byteCount: bundle.bytes.byteLength,
        caseSha256: bundle.document.qualification.caseSha256,
        manifestSha256: bundle.document.qualification.manifestSha256,
        sourceCaptureSha256: bundle.document.qualification.sourceCaptureSha256,
      },
      executionProfileFingerprint: attempt.identity.executionProfile.profileFingerprint,
      runtimeQualification: attempt.identity.runtimeQualification,
      generationRecovery: attempt.generationRecovery,
      receipt: attempt.receiptRecord,
      evidence: attempt.evidence,
    });
    if (
      !capture ||
      this.d.captures.uriFor(attempt.capture.fingerprint) !== attempt.capture.uri ||
      deterministicJson(capture) !== deterministicJson(expectedCapture)
    ) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The durable local Modelica capture cannot be replayed.",
      );
    }
    const outputs = new Map(
      attempt.receiptRecord.outputs.map((output) => [output.role, output]),
    );
    const evidenceOutput = outputs.get("evidence");
    const resultOutput = outputs.get("result");
    if (!evidenceOutput || !resultOutput) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError();
    }
    const [evidenceBytes, resultBytes] = await Promise.all([
      this.d.publications.readPublishedObject(
        attempt.receiptRecord.publication.ref,
        evidenceOutput,
      ),
      this.d.publications.readPublishedObject(
        attempt.receiptRecord.publication.ref,
        resultOutput,
      ),
    ]);
    if (!evidenceBytes || !resultBytes) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError();
    }
    const evidence = await validateModelicaIsolatedRun({
      bundle: bundle.document,
      evidenceBytes,
      resultBytes,
    });
    if (deterministicJson(evidence) !== deterministicJson(attempt.evidence)) {
      throw new ModelicaIsolatedExecutionOutcomeUnknownError(
        "The replayed Modelica observations differ from the WAL.",
      );
    }
    return Object.freeze({
      executionRunId: attempt.executionRunId,
      receipt,
      evidence,
      capture,
      captureReference: attempt.capture,
    });
  }
}

export async function deriveModelicaIsolatedExecutionRunId(input: {
  readonly projectId: string;
  readonly agentRunId: string;
}): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: "modelica-isolated-execution-run-id/1.0",
    operation: { id: "simulate.run-qualified-modelica-kit", version: "1" },
    projectId: safeId(input.projectId, "$projectId"),
    agentRunId: safeId(input.agentRunId, "$agentRunId"),
  });
  return `modelica-${fingerprint.digest}`;
}

function requestForGeneration(
  request: IsolatedCodeExecutionRequest,
  producerGeneration: IsolatedOutputProducerGeneration,
): IsolatedCodeExecutionRequest {
  return Object.freeze({
    ...request,
    producerGeneration,
    source: Object.freeze({
      bytes: Uint8Array.from(request.source.bytes),
      sha256: request.source.sha256,
    }),
  });
}

async function validatePreparedBundle(
  value: PreparedModelicaIsolatedInputBundle,
): Promise<PreparedModelicaIsolatedInputBundle> {
  const document = await validateModelicaIsolatedInputBundle(value.document);
  const text = deterministicJson(document);
  const bytes = new TextEncoder().encode(text);
  const fingerprint = await sha256Fingerprint(document);
  if (
    value.text !== text || !(value.bytes instanceof Uint8Array) ||
    value.bytes.byteLength !== bytes.byteLength ||
    await fingerprintResourceBytes(value.bytes) !== fingerprint.digest ||
    !fingerprintsEqual(value.fingerprint, fingerprint)
  ) throw new TypeError("The prepared Modelica bundle is not exact canonical bytes.");
  return Object.freeze({
    document,
    text,
    bytes: Uint8Array.from(bytes),
    fingerprint,
  });
}

function keyFor(
  attempt: ModelicaIsolatedExecutionAttempt,
): ModelicaIsolatedExecutionAttemptKey {
  return {
    projectId: attempt.projectId,
    agentRunId: attempt.agentRunId,
    executionRunId: attempt.executionRunId,
    attemptFingerprint: attempt.attemptFingerprint,
  };
}

function throwOutputValidationRejected(
  attempt: ModelicaIsolatedExecutionAttempt,
): never {
  if (attempt.phase !== "output-validation-rejected") {
    throw new ModelicaIsolatedExecutionOutcomeUnknownError(
      "The qualified Modelica output-validation rejection WAL transition was not durable.",
    );
  }
  throw new IsolatedQualifiedModelicaOutputValidationRejectedError({
    executionRunId: attempt.executionRunId,
    observation: attempt.outputValidationRejection.observation,
    destruction: attempt.outputValidationRejection.destruction,
  });
}
