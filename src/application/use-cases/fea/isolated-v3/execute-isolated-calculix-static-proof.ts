/**
 * Provider-free isolated solve core.
 *
 * A higher project executor must reopen the existing ROP2/MRTR/proof/STEP and
 * supply their exact identities. This use case owns only the one native
 * dispatch, CAS recovery and documentary evidence publication; it performs no
 * SysON evaluation and never mutates a ThreadSnapshot.
 */

import type {
  CalculixIsolatedExecutionAttempt,
  CalculixIsolatedExecutionAttemptIdentity,
  CalculixIsolatedExecutionAttemptKey,
  CalculixIsolatedExecutionAttemptStore,
  CalculixIsolatedProvenDestruction,
} from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-attempt-store.ts";
import type { CalculixIsolatedExecutionEvidenceStore } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-evidence-store.ts";
import type { CalculixIsolatedExecutionProfile } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { CalculixIsolatedExecutionRunLease } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-run-lease.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
  type IsolatedCodeRunRecovery,
  type IsolatedOutputPublicationReader,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import { safeId } from "../../../../domain/kernel/case-validation.ts";
import {
  CALCULIX_ISOLATED_EXECUTION_PROFILE,
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  type CalculixIsolatedBatchInspector,
  type CalculixIsolatedInputBundle,
  createCalculixIsolatedExecutionEvidence,
  parseCalculixIsolatedInputBundle,
} from "../../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodeOutputValidationRejection,
  isolatedCodeRefsEqual,
  type IsolatedOutputProducerGeneration,
  runtimeAttestationsEqual,
  validateIsolatedCodeExecutionDestruction,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputValidationRejection,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../../domain/kernel/deterministic-json.ts";

export interface ExecuteIsolatedCalculixStaticProofInput {
  readonly identity: CalculixIsolatedExecutionAttemptIdentity;
  readonly bundle: CalculixIsolatedInputBundle;
}

export class ExecuteIsolatedCalculixStaticProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecuteIsolatedCalculixStaticProofError";
  }
}

/**
 * Terminal CalculiX conversion of a public isolated output-validation
 * rejection. It carries only the registered role, observed size/digest and
 * proven destruction; no worker diagnostic, bytes, path or handle.
 */
export class IsolatedCalculixOutputValidationRejectedError extends Error {
  readonly code = "output_validation_rejected" as const;
  readonly executionRunId: string;
  readonly observation: IsolatedCodeOutputValidationRejection;
  readonly destruction: CalculixIsolatedProvenDestruction;

  constructor(input: {
    readonly executionRunId: string;
    readonly observation: IsolatedCodeOutputValidationRejection;
    readonly destruction: CalculixIsolatedProvenDestruction;
  }) {
    super(
      "A code-owned isolated CalculiX output validator rejected the observed bytes; no redispatch occurs.",
    );
    this.name = "IsolatedCalculixOutputValidationRejectedError";
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

/**
 * Terminal recovery after generation 1 was consumed, unpublished, and
 * destroyed. It carries no worker diagnostic, lease, path or handle.
 */
export class IsolatedCalculixRedispatchExhaustedError extends Error {
  readonly code = "redispatch_exhausted" as const;
  readonly executionRunId: string;
  readonly producerGeneration = 1 as const;
  readonly destruction: CalculixIsolatedProvenDestruction;

  constructor(input: {
    readonly executionRunId: string;
    readonly destruction: CalculixIsolatedProvenDestruction;
  }) {
    super(
      "The unpublished CalculiX redispatch generation was cleaned up; no third dispatch occurs.",
    );
    this.name = "IsolatedCalculixRedispatchExhaustedError";
    this.executionRunId = safeId(input.executionRunId, "$exhaustion.executionRunId");
    const destruction = validateIsolatedCodeExecutionDestruction(
      input.destruction,
      this.executionRunId,
    );
    if (destruction.status !== "proven") {
      throw new TypeError("Redispatch exhaustion requires proven destruction.");
    }
    this.destruction = destruction;
  }
}

export class ExecuteIsolatedCalculixStaticProof {
  constructor(
    private readonly dependencies: {
      readonly runner: IsolatedCodeRunner;
      readonly recovery: IsolatedCodeRunRecovery;
      readonly publications: IsolatedOutputPublicationReader;
      readonly lease: CalculixIsolatedExecutionRunLease;
      readonly attempts: CalculixIsolatedExecutionAttemptStore;
      readonly evidence: CalculixIsolatedExecutionEvidenceStore;
      readonly inspector: CalculixIsolatedBatchInspector;
    },
  ) {}

  async execute(input: ExecuteIsolatedCalculixStaticProofInput) {
    if (
      !Number.isSafeInteger(input.bundle.bytes.byteLength) ||
      input.bundle.bytes.byteLength < 1 ||
      input.bundle.bytes.byteLength > input.identity.profile.maximumBundleBytes
    ) {
      throw blocked(
        "The CalculiX input bundle exceeds the code-owned profile ceiling.",
      );
    }
    const bundle = await parseCalculixIsolatedInputBundle(input.bundle.bytes.copy());
    assertInputIdentity(input.identity, bundle);
    return await this.dependencies.lease.withLease(
      input.identity.projectId,
      input.identity.executionRunId,
      () => this.#executeLocked(input.identity, bundle),
    );
  }

  /**
   * Replay-only terminal: if the WAL already recorded an output-validation
   * rejection, throw the typed error without runner, recovery, CAS, or
   * generation advance. Other phases return without effect.
   */
  async reopenOutputValidationRejection(input: {
    readonly projectId: string;
    readonly agentRunId: string;
  }): Promise<void> {
    const projectId = safeId(input.projectId, "$input.projectId");
    const agentRunId = safeId(input.agentRunId, "$input.agentRunId");
    const attempt = await this.dependencies.attempts.read(projectId, agentRunId);
    if (attempt?.phase === "output-validation-rejected") {
      throwOutputValidationRejected(attempt);
    }
  }

  async #executeLocked(
    identity: CalculixIsolatedExecutionAttemptIdentity,
    bundle: CalculixIsolatedInputBundle,
  ) {
    let attempt = await this.dependencies.attempts.prepare(identity);
    const key = keyOf(attempt);
    if (attempt.phase === "evidence-captured") {
      return await this.#reopenEvidence(attempt, bundle);
    }
    if (attempt.phase === "execution-rejected") {
      throwRejected(attempt);
    }
    if (attempt.phase === "output-validation-rejected") {
      throwOutputValidationRejected(attempt);
    }
    if (attempt.phase === "redispatch-exhausted") {
      throwExhausted(attempt);
    }

    const candidate = "receiptRecord" in attempt
      ? {
        receipt: await this.#readReceipt(
          attempt.receiptRecord,
          identity.profile,
          attempt.dispatch.producerGeneration,
        ),
        producerGeneration: attempt.dispatch.producerGeneration,
      }
      : await this.#dispatchOrRecover(identity, bundle, attempt, key);
    const receipt = await this.#readReceipt(
      isolatedCodeExecutionReceiptRecord(candidate.receipt),
      identity.profile,
      candidate.producerGeneration,
    );
    const receiptRecord = isolatedCodeExecutionReceiptRecord(receipt);
    attempt = await this.dependencies.attempts.markOutputPublished({
      ...key,
      receiptRecord,
    });
    if (attempt.phase === "evidence-captured") {
      return await this.#reopenEvidence(attempt, bundle);
    }
    const outputBytes = new Map<string, Uint8Array>();
    for (const member of receiptRecord.outputs) {
      const bytes = await this.dependencies.publications.readPublishedObject(
        receiptRecord.publication.ref,
        member,
      );
      if (!bytes) {
        throw blocked("A published CalculiX output could not be reopened.");
      }
      outputBytes.set(member.role, bytes);
    }
    const evidence = await createCalculixIsolatedExecutionEvidence({
      projectId: identity.projectId,
      agentRunId: identity.agentRunId,
      executionRunId: identity.executionRunId,
      executedAt: identity.startedAt,
      resolvedOperationPlanFingerprint: identity.resolvedOperationPlanFingerprint,
      executionProfileFingerprint: identity.profile.profileFingerprint,
      bundle,
      receipt: receiptRecord,
      outputBytes,
      inspector: this.dependencies.inspector,
    });
    const persisted = await this.dependencies.evidence.save(evidence);
    if (!fingerprintsEqual(persisted.fingerprint, evidence.fingerprint)) {
      throw blocked("The CalculiX evidence store returned a divergent identity.");
    }
    attempt = await this.dependencies.attempts.markEvidenceCaptured({
      ...key,
      evidence: persisted.evidence,
    });
    if (
      attempt.phase !== "evidence-captured" ||
      !fingerprintsEqual(attempt.evidence.fingerprint, persisted.fingerprint)
    ) {
      throw blocked("The CalculiX evidence WAL transition was not durable.");
    }
    return Object.freeze({ evidence: persisted.evidence, attempt });
  }

  async #dispatchOrRecover(
    identity: CalculixIsolatedExecutionAttemptIdentity,
    bundle: CalculixIsolatedInputBundle,
    attempt: CalculixIsolatedExecutionAttempt,
    key: CalculixIsolatedExecutionAttemptKey,
  ): Promise<{
    readonly receipt: IsolatedCodeExecutionReceipt;
    readonly producerGeneration: IsolatedOutputProducerGeneration;
  }> {
    if (attempt.phase === "prepared") {
      attempt = await this.dependencies.attempts.markDispatching({
        ...key,
        dispatchedAt: identity.startedAt,
      });
      if (attempt.phase !== "dispatching" || attempt.dispatch.dispatchCount !== 1) {
        throw blocked("The initial CalculiX dispatch generation was not durable.");
      }
      const producerGeneration = attempt.dispatch.producerGeneration;
      return Object.freeze({
        receipt: await this.#runOrReject(
          identity,
          bundle,
          key,
          producerGeneration,
        ),
        producerGeneration,
      });
    }
    if (attempt.phase !== "dispatching") {
      throw blocked("The CalculiX WAL is not in a dispatch recovery phase.");
    }
    let resolution;
    try {
      resolution = await this.dependencies.publications.resolvePublicationByRunId(
        key.executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw blocked("The CalculiX publication could not be resolved safely.");
    }
    if (resolution.status === "published") {
      return Object.freeze({
        receipt: await this.#readReceipt(
          resolution.receipt,
          identity.profile,
          attempt.dispatch.producerGeneration,
        ),
        producerGeneration: attempt.dispatch.producerGeneration,
      });
    }
    if (resolution.status === "outcome-unknown") {
      throw blocked(
        "The CalculiX publication outcome is unknown; no redispatch occurs.",
      );
    }
    if (attempt.dispatch.dispatchCount === 1) {
      const destruction = await this.dependencies.recovery.destroyByRunId(
        key.executionRunId,
        0,
      );
      if (destruction.status !== "proven") {
        throw blocked(
          "Microsandbox cleanup is not proven; no CalculiX redispatch occurs.",
        );
      }
      let generationAdvance;
      try {
        generationAdvance = await this.dependencies.recovery
          .advanceProducerGeneration({
            runId: key.executionRunId,
            closedGeneration: 0,
            nextGeneration: 1,
          });
      } catch {
        throw blocked(
          "CalculiX cleanup was proven but the durable producer-generation advance was not; no redispatch occurs.",
        );
      }
      attempt = await this.dependencies.attempts.authorizeRedispatch({
        ...key,
        recoveryDestruction: destruction,
        generationAdvance,
      });
    }
    if (
      attempt.phase === "dispatching" &&
      attempt.dispatch.dispatchCount === 2 &&
      attempt.dispatch.redispatch.status === "consumed"
    ) {
      let destruction;
      try {
        destruction = await this.dependencies.recovery.destroyByRunId(
          key.executionRunId,
          1,
        );
      } catch {
        throw blocked(
          "The unpublished CalculiX redispatch cleanup could not be proven; no third dispatch occurs.",
        );
      }
      if (destruction.status !== "proven") {
        throw blocked(
          "The unpublished CalculiX redispatch cleanup was not proven; no third dispatch occurs.",
        );
      }
      const exhausted = await this.dependencies.attempts.markRedispatchExhausted({
        ...key,
        destruction,
      });
      return throwExhausted(exhausted);
    }
    if (
      attempt.phase !== "dispatching" || attempt.dispatch.dispatchCount !== 2 ||
      attempt.dispatch.redispatch.status !== "authorized"
    ) {
      throw blocked("The single CalculiX redispatch authorization is unavailable.");
    }
    const consumed = await this.dependencies.attempts.consumeRedispatch(key);
    if (consumed.outcome !== "consumed-now") {
      throw blocked("The CalculiX redispatch may already have started.");
    }
    if (
      consumed.attempt.phase !== "dispatching" ||
      consumed.attempt.dispatch.dispatchCount !== 2 ||
      consumed.attempt.dispatch.producerGeneration !== 1 ||
      consumed.attempt.dispatch.redispatch.status !== "consumed"
    ) {
      throw blocked("The CalculiX redispatch generation was not consumed durably.");
    }
    return Object.freeze({
      receipt: await this.#runOrReject(identity, bundle, key, 1),
      producerGeneration: 1,
    });
  }

  async #runOrReject(
    identity: CalculixIsolatedExecutionAttemptIdentity,
    bundle: CalculixIsolatedInputBundle,
    key: CalculixIsolatedExecutionAttemptKey,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedCodeExecutionReceipt> {
    try {
      return await this.dependencies.runner.run(
        request(identity.profile, bundle, key, producerGeneration),
      );
    } catch (error) {
      if (error instanceof IsolatedCodeOutputValidationRejectedError) {
        if (
          error.destruction.status !== "proven" ||
          error.destruction.runId !== key.executionRunId
        ) {
          throw blocked(
            "Isolated CalculiX output-validation cleanup is not proven; no redispatch occurs.",
          );
        }
        let rejected;
        try {
          rejected = await this.dependencies.attempts.markOutputValidationRejected({
            ...key,
            observation: error.observation,
            destruction: error.destruction,
          });
        } catch (markError) {
          const current = await this.dependencies.attempts.read(
            key.projectId,
            key.agentRunId,
          );
          if (
            current?.phase === "output-validation-rejected" &&
            current.executionRunId === key.executionRunId
          ) {
            return throwOutputValidationRejected(current);
          }
          throw markError;
        }
        return throwOutputValidationRejected(rejected);
      }
      if (!(error instanceof IsolatedCodeExecutionRejectedError)) throw error;
      if (
        error.destruction.status !== "proven" ||
        error.destruction.runId !== key.executionRunId
      ) {
        throw blocked(
          "Isolated CalculiX rejection cleanup is not proven; no redispatch occurs.",
        );
      }
      const rejected = await this.dependencies.attempts.markExecutionRejected({
        ...key,
        diagnostic: error.diagnostic,
        destruction: error.destruction,
      });
      return throwRejected(rejected);
    }
  }

  async #readReceipt(
    value: unknown,
    profile: CalculixIsolatedExecutionProfile,
    expectedProducerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedCodeExecutionReceipt> {
    const record = await validateIsolatedCodeExecutionReceiptRecord(value);
    assertReceipt(record, profile, expectedProducerGeneration);
    const receipt = await this.dependencies.publications.readReceipt(
      record.publication.ref,
    );
    if (
      !receipt ||
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(record)
    ) {
      throw blocked("The published CalculiX receipt is divergent or unavailable.");
    }
    return receipt;
  }

  async #reopenEvidence(
    attempt: CalculixIsolatedExecutionAttempt,
    bundle: CalculixIsolatedInputBundle,
  ) {
    if (attempt.phase !== "evidence-captured") {
      throw blocked("The CalculiX evidence WAL transition was not durable.");
    }
    const reopened = await this.dependencies.evidence.read(
      attempt.evidence.fingerprint,
    );
    if (
      !reopened || deterministicJson(reopened) !== deterministicJson(attempt.evidence)
    ) {
      throw blocked("The durable CalculiX evidence could not be reopened exactly.");
    }
    const receipt = await this.#readReceipt(
      attempt.receiptRecord,
      attempt.identity.profile,
      attempt.dispatch.producerGeneration,
    );
    const receiptRecord = isolatedCodeExecutionReceiptRecord(receipt);
    const outputBytes = new Map<string, Uint8Array>();
    for (const member of receiptRecord.outputs) {
      const bytes = await this.dependencies.publications.readPublishedObject(
        receiptRecord.publication.ref,
        member,
      );
      if (!bytes) {
        throw blocked("A durable CalculiX output could not be reopened on replay.");
      }
      outputBytes.set(member.role, bytes);
    }
    const replayed = await createCalculixIsolatedExecutionEvidence({
      projectId: attempt.identity.projectId,
      agentRunId: attempt.identity.agentRunId,
      executionRunId: attempt.identity.executionRunId,
      executedAt: attempt.identity.startedAt,
      resolvedOperationPlanFingerprint:
        attempt.identity.resolvedOperationPlanFingerprint,
      executionProfileFingerprint: attempt.identity.profile.profileFingerprint,
      bundle,
      receipt: receiptRecord,
      outputBytes,
      inspector: this.dependencies.inspector,
    });
    if (!fingerprintsEqual(replayed.fingerprint, reopened.fingerprint)) {
      throw blocked("The replayed CalculiX artifacts differ from durable evidence.");
    }
    return Object.freeze({ evidence: reopened, attempt });
  }
}

function request(
  profile: CalculixIsolatedExecutionProfile,
  bundle: CalculixIsolatedInputBundle,
  key: CalculixIsolatedExecutionAttemptKey,
  producerGeneration: IsolatedOutputProducerGeneration,
) {
  return {
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: key.executionRunId,
    producerGeneration,
    profile: CALCULIX_ISOLATED_EXECUTION_PROFILE,
    source: {
      bytes: bundle.bytes.copy(),
      sha256: bundle.fingerprint.digest,
    },
    policy: profile.isolationPolicy,
    outputs: CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  } as const;
}

function assertInputIdentity(
  identity: CalculixIsolatedExecutionAttemptIdentity,
  bundle: CalculixIsolatedInputBundle,
): void {
  if (
    identity.projectId !== bundle.manifest.proof.project.id ||
    identity.requestId !== bundle.manifest.requestId ||
    !fingerprintsEqual(identity.bundleFingerprint, bundle.fingerprint) ||
    !fingerprintsEqual(identity.proofFingerprint, bundle.manifest.proofFingerprint) ||
    identity.step.byteCount !== bundle.manifest.step.byteCount ||
    identity.step.sha256 !== bundle.manifest.step.sha256
  ) {
    throw blocked(
      "The CalculiX execution identity or project differs from the exact proof bundle.",
    );
  }
}

function assertReceipt(
  receipt: Awaited<ReturnType<typeof validateIsolatedCodeExecutionReceiptRecord>>,
  profile: CalculixIsolatedExecutionProfile,
  expectedProducerGeneration: IsolatedOutputProducerGeneration,
): void {
  if (
    receipt.producerGeneration !== expectedProducerGeneration ||
    receipt.publication.ref.producerGeneration !== expectedProducerGeneration ||
    !isolatedCodeRefsEqual(receipt.profile, profile.executionProfile) ||
    !isolatedCodeRefsEqual(receipt.policy, profile.isolationPolicy) ||
    !runtimeAttestationsEqual(receipt.runtime, profile.runtime) ||
    !isolatedCodeOutputManifestsEqual(receipt.outputs, profile.outputManifest) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.termination.signal !== null ||
    receipt.destruction.status !== profile.minimumDestructionAssurance
  ) {
    throw blocked("The CalculiX receipt differs from the qualified profile.");
  }
}

function keyOf(
  attempt: CalculixIsolatedExecutionAttempt,
): CalculixIsolatedExecutionAttemptKey {
  return {
    projectId: attempt.projectId,
    agentRunId: attempt.agentRunId,
    executionRunId: attempt.executionRunId,
    attemptFingerprint: attempt.attemptFingerprint,
  };
}

function blocked(message: string): ExecuteIsolatedCalculixStaticProofError {
  return new ExecuteIsolatedCalculixStaticProofError(message);
}

function throwRejected(
  attempt: CalculixIsolatedExecutionAttempt,
): never {
  if (attempt.phase !== "execution-rejected") {
    throw blocked("The CalculiX rejection WAL transition was not durable.");
  }
  throw new IsolatedCodeExecutionRejectedError(
    attempt.rejection.diagnostic,
    attempt.rejection.destruction,
  );
}

function throwOutputValidationRejected(
  attempt: CalculixIsolatedExecutionAttempt,
): never {
  if (attempt.phase !== "output-validation-rejected") {
    throw blocked(
      "The CalculiX output-validation rejection WAL transition was not durable.",
    );
  }
  throw new IsolatedCalculixOutputValidationRejectedError({
    executionRunId: attempt.executionRunId,
    observation: attempt.outputValidationRejection.observation,
    destruction: attempt.outputValidationRejection.destruction,
  });
}

function throwExhausted(
  attempt: CalculixIsolatedExecutionAttempt,
): never {
  if (attempt.phase !== "redispatch-exhausted") {
    throw blocked("The CalculiX redispatch-exhaustion WAL transition was not durable.");
  }
  throw new IsolatedCalculixRedispatchExhaustedError({
    executionRunId: attempt.executionRunId,
    destruction: attempt.exhaustion.destruction,
  });
}
