/** Durable monotone WAL for admitted Modelica isolated execution. */

import {
  type AdmittedModelicaExecutionAttempt,
  type AdmittedModelicaExecutionAttemptIdentity,
  type AdmittedModelicaExecutionAttemptKey,
  type AdmittedModelicaExecutionAttemptStore,
  type AdmittedModelicaExecutionDispatch,
  type AdmittedModelicaExecutionDispatchTransition,
  type AdmittedModelicaExecutionGenerationRecovery,
  type AdmittedModelicaExecutionThreadArtifactEvidence,
  type AdmittedModelicaExecutionThreadEvidence,
  type AdmittedModelicaExecutionThreadEvidenceInput,
  type AdmittedModelicaProvenDestruction,
  fingerprintAdmittedModelicaExecutionAttemptIdentity,
} from "../../../application/ports/out/modelica/admitted-execution-attempt-store.ts";
import {
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  runtimeAttestationsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedOutputProducerGeneration,
  validateIsolatedOutputProducerGenerationAdvance,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Hex } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  deriveAdmittedModelicaExecutionRunId,
} from "../../../domain/modelica/admitted/execution-evidence.ts";
import {
  validateModelicaAdmittedRunAdmission,
} from "../../../domain/modelica/admitted/run-proposal.ts";
import { parseExactThreadSnapshotBasis } from "../../../domain/project/thread-tip.ts";
import { validateAdmittedModelicaExecutionProfile } from "./execution-profile-catalog.ts";

export const ADMITTED_MODELICA_EXECUTION_ATTEMPT_SCHEMA =
  "modelica-admitted-execution-attempt/1.0" as const;

const NO_PROGRESS = "Admitted Modelica execution WAL made no durable write progress.";
const MAX_WAL_BYTES = 1_048_576;

export class AdmittedModelicaExecutionAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdmittedModelicaExecutionAttemptIntegrityError";
  }
}

export class FileAdmittedModelicaExecutionAttemptStore
  implements AdmittedModelicaExecutionAttemptStore {
  readonly #directory: string;

  constructor(directory = "state/local/modelica/admitted/execution-attempts") {
    this.#directory = absoluteStorageRoot(validateStorageRoot(directory));
  }

  async read(
    projectIdValue: string,
    agentRunIdValue: string,
  ): Promise<AdmittedModelicaExecutionAttempt | undefined> {
    const projectId = safeId(projectIdValue, "$projectId");
    const agentRunId = safeId(agentRunIdValue, "$agentRunId");
    if (!await assertDirectoryTreeNoSymlinksIfPresent(this.#directory)) {
      return undefined;
    }
    await assertPrivateDirectory(this.#directory);
    const text = await readRegularTextFileIfPresent(
      this.#directory,
      await this.pathFor(projectId, agentRunId),
      "Admitted Modelica execution WAL",
    );
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The admitted Modelica execution WAL is not JSON.");
    }
    const attempt = await validateAdmittedModelicaExecutionAttempt(
      parsed,
      projectId,
      agentRunId,
    );
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw integrity("The admitted Modelica execution WAL is not canonical.");
    }
    return attempt;
  }

  async prepare(
    identityValue: AdmittedModelicaExecutionAttemptIdentity,
    preparedAtValue: string,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    const identity = await validateIdentity(identityValue);
    const preparedAt = timestamp(preparedAtValue, "$preparedAt");
    if (preparedAt !== identity.startedAt) {
      throw integrity(
        "The admitted Modelica WAL prepared time differs from its exact run start.",
      );
    }
    const attemptFingerprint =
      await fingerprintAdmittedModelicaExecutionAttemptIdentity(identity);
    const fresh: AdmittedModelicaExecutionAttempt = deepFreeze({
      schemaVersion: ADMITTED_MODELICA_EXECUTION_ATTEMPT_SCHEMA,
      ...keyFor(identity, attemptFingerprint),
      identity,
      preparedAt,
      phase: "prepared",
    });
    return await this.#withLock(identity.projectId, identity.agentRunId, async () => {
      const current = await this.read(identity.projectId, identity.agentRunId);
      if (current) {
        assertKey(current, keyFor(identity, attemptFingerprint));
        if (
          deterministicJson(current.identity) !== deterministicJson(identity) ||
          current.preparedAt !== preparedAt
        ) {
          throw integrity(
            "The admitted Modelica execution identity conflicts with its WAL.",
          );
        }
        return current;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  markDispatching(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedModelicaExecutionDispatchTransition> {
    return this.#dispatchTransition(input, (current) => {
      const dispatchedAt = timestamp(input.dispatchedAt, "$dispatchedAt");
      if (dispatchedAt !== current.identity.startedAt) {
        throw integrity(
          "Admitted Modelica generation-zero dispatch time differs from its exact run start.",
        );
      }
      if (current.phase === "dispatching") {
        if (
          current.dispatch.dispatchCount === 1 &&
          current.dispatch.producerGeneration === 0 &&
          current.dispatch.dispatchedAt === dispatchedAt &&
          current.generationRecovery === null
        ) return current;
        throw integrity("Admitted Modelica generation-zero dispatch is divergent.");
      }
      if (current.phase !== "prepared") {
        throw integrity("Admitted Modelica generation-zero dispatch is out of order.");
      }
      return deepFreeze({
        ...base(current),
        phase: "dispatching",
        dispatch: { dispatchCount: 1, producerGeneration: 0, dispatchedAt },
        generationRecovery: null,
      });
    });
  }

  markGenerationZeroCleaned(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly destruction: Extract<
        IsolatedCodeExecutionReceiptRecord["destruction"],
        { readonly status: "proven" }
      >;
    },
  ): Promise<AdmittedModelicaExecutionAttempt> {
    return this.#transition(input, (current) => {
      const destruction = validateGenerationZeroDestruction(
        input.destruction,
        current.executionRunId,
      );
      if (current.phase === "generation-zero-cleaned") {
        if (
          deterministicJson(current.generationZeroDestruction) ===
            deterministicJson(destruction)
        ) return current;
        throw integrity(
          "Admitted Modelica generation-zero cleanup proof is divergent.",
        );
      }
      if (
        current.phase !== "dispatching" ||
        current.dispatch.dispatchCount !== 1 ||
        current.dispatch.producerGeneration !== 0 ||
        current.generationRecovery !== null
      ) {
        throw integrity("Admitted Modelica generation-zero cleanup is out of order.");
      }
      return deepFreeze({
        ...base(current),
        phase: "generation-zero-cleaned",
        dispatch: current.dispatch as AdmittedModelicaExecutionDispatch & {
          readonly dispatchCount: 1;
          readonly producerGeneration: 0;
        },
        generationZeroDestruction: destruction,
      });
    });
  }

  markRedispatching(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly advance: Parameters<
        typeof validateIsolatedOutputProducerGenerationAdvance
      >[0];
      readonly dispatchedAt: string;
    },
  ): Promise<AdmittedModelicaExecutionDispatchTransition> {
    return this.#dispatchTransition(input, async (current) => {
      const dispatchedAt = timestamp(input.dispatchedAt, "$redispatchedAt");
      if (dispatchedAt !== current.identity.startedAt) {
        throw integrity(
          "Admitted Modelica generation-one dispatch time differs from its exact run start.",
        );
      }
      const advance = await validateGenerationAdvance(
        input.advance,
        current.executionRunId,
      );
      if (current.phase === "dispatching") {
        if (
          current.dispatch.dispatchCount === 2 &&
          current.dispatch.producerGeneration === 1 &&
          current.dispatch.dispatchedAt === dispatchedAt &&
          current.generationRecovery !== null &&
          deterministicJson(current.generationRecovery.advance) ===
            deterministicJson(advance)
        ) return current;
        throw integrity("Admitted Modelica generation-one dispatch is divergent.");
      }
      if (current.phase !== "generation-zero-cleaned") {
        throw integrity("Admitted Modelica generation-one dispatch is out of order.");
      }
      const generationRecovery: AdmittedModelicaExecutionGenerationRecovery =
        deepFreeze({
          generationZeroDestruction: current.generationZeroDestruction,
          advance,
        });
      return deepFreeze({
        ...base(current),
        phase: "dispatching",
        dispatch: {
          dispatchCount: 2,
          producerGeneration: 1,
          dispatchedAt,
        },
        generationRecovery,
      });
    });
  }

  markOutputPublished(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<AdmittedModelicaExecutionAttempt> {
    return this.#transition(input, async (current) => {
      if (
        current.phase !== "dispatching" &&
        current.phase !== "output-published" &&
        current.phase !== "completed"
      ) {
        throw integrity("Admitted Modelica output publication is out of order.");
      }
      const receiptRecord = await validatePublishedReceipt(
        input.receiptRecord,
        current.identity,
        current.dispatch.producerGeneration,
      );
      if (current.phase !== "dispatching") {
        if (
          deterministicJson(current.receiptRecord) ===
            deterministicJson(receiptRecord)
        ) return current;
        throw integrity("Admitted Modelica output publication is divergent.");
      }
      return deepFreeze({
        ...base(current),
        phase: "output-published",
        dispatch: current.dispatch,
        generationRecovery: current.generationRecovery,
        receiptRecord,
      });
    });
  }

  markCompleted(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly threadEvidence: AdmittedModelicaExecutionThreadEvidenceInput;
    },
  ): Promise<AdmittedModelicaExecutionAttempt> {
    return this.#transition(input, async (current) => {
      if (current.phase === "completed") {
        const threadEvidence = await sealThreadEvidence(
          input.threadEvidence,
          current.identity,
          current.receiptRecord,
        );
        if (
          deterministicJson(current.threadEvidence) ===
            deterministicJson(threadEvidence)
        ) return current;
        throw integrity("Admitted Modelica Thread completion proof is divergent.");
      }
      if (current.phase !== "output-published") {
        throw integrity(
          "Admitted Modelica execution cannot complete before output publication.",
        );
      }
      const threadEvidence = await sealThreadEvidence(
        input.threadEvidence,
        current.identity,
        current.receiptRecord,
      );
      return deepFreeze({
        ...current,
        phase: "completed",
        threadEvidence,
      });
    });
  }

  markOutputValidationRejected(
    input: AdmittedModelicaExecutionAttemptKey & {
      readonly observation: {
        readonly role: string;
        readonly byteCount: number;
        readonly sha256: string;
      };
      readonly destruction: AdmittedModelicaProvenDestruction;
    },
  ): Promise<AdmittedModelicaExecutionAttempt> {
    return this.#transition(input, (current) => {
      const observation = validateIsolatedCodeOutputValidationRejection(
        input.observation,
      );
      assertRegisteredOutputRole(observation.role, current.identity);
      const destruction = validateGenerationZeroDestruction(
        input.destruction,
        current.executionRunId,
      );
      const outputValidationRejection = deepFreeze({ observation, destruction });
      if (current.phase === "output-validation-rejected") {
        if (
          deterministicJson(current.outputValidationRejection) ===
            deterministicJson(outputValidationRejection)
        ) return current;
        throw integrity(
          "Admitted Modelica output-validation rejection is divergent.",
        );
      }
      if (current.phase !== "dispatching") {
        throw integrity(
          "Admitted Modelica output-validation rejection is out of order.",
        );
      }
      return deepFreeze({
        ...base(current),
        phase: "output-validation-rejected" as const,
        dispatch: current.dispatch,
        generationRecovery: current.generationRecovery,
        outputValidationRejection,
      });
    });
  }

  async pathFor(projectIdValue: string, agentRunIdValue: string): Promise<string> {
    const projectId = safeId(projectIdValue, "$projectId");
    const agentRunId = safeId(agentRunIdValue, "$agentRunId");
    const key = await sha256Fingerprint({
      schemaVersion: "modelica-admitted-execution-wal-key/1.0",
      projectId,
      agentRunId,
    });
    return `${this.#directory}/run-${key.digest}.json`;
  }

  async #transition(
    keyValue: AdmittedModelicaExecutionAttemptKey,
    transition: (
      current: AdmittedModelicaExecutionAttempt,
    ) =>
      | AdmittedModelicaExecutionAttempt
      | Promise<AdmittedModelicaExecutionAttempt>,
  ): Promise<AdmittedModelicaExecutionAttempt> {
    const key = validateKey({
      projectId: keyValue.projectId,
      agentRunId: keyValue.agentRunId,
      executionRunId: keyValue.executionRunId,
      attemptFingerprint: keyValue.attemptFingerprint,
    });
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) {
        throw integrity("The admitted Modelica execution WAL is missing.");
      }
      assertKey(current, key);
      const next = await transition(current);
      if (next !== current) await this.#replace(next);
      return next;
    });
  }

  async #dispatchTransition(
    keyValue: AdmittedModelicaExecutionAttemptKey,
    transition: (
      current: AdmittedModelicaExecutionAttempt,
    ) =>
      | Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>
      | Promise<
        Extract<AdmittedModelicaExecutionAttempt, { phase: "dispatching" }>
      >,
  ): Promise<AdmittedModelicaExecutionDispatchTransition> {
    const key = validateKey({
      projectId: keyValue.projectId,
      agentRunId: keyValue.agentRunId,
      executionRunId: keyValue.executionRunId,
      attemptFingerprint: keyValue.attemptFingerprint,
    });
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) {
        throw integrity("The admitted Modelica execution WAL is missing.");
      }
      assertKey(current, key);
      const next = await transition(current);
      if (next === current) {
        return deepFreeze({
          outcome: "already-transitioned",
          attempt: next,
        });
      }
      await this.#replace(next);
      return deepFreeze({ outcome: "transitioned-now", attempt: next });
    });
  }

  async #writeNew(attempt: AdmittedModelicaExecutionAttempt): Promise<void> {
    await this.#ensureDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await writeWalFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
      "create-new",
    );
    await this.#assertReread(attempt);
  }

  async #replace(attempt: AdmittedModelicaExecutionAttempt): Promise<void> {
    await this.#ensureDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await writeWalFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
      "replace",
    );
    await this.#assertReread(attempt);
  }

  async #assertReread(expected: AdmittedModelicaExecutionAttempt): Promise<void> {
    const actual = await this.read(expected.projectId, expected.agentRunId);
    if (!actual || deterministicJson(actual) !== deterministicJson(expected)) {
      throw integrity(
        "The admitted Modelica execution WAL failed its durable reread.",
      );
    }
  }

  async #ensureDirectory(): Promise<void> {
    await ensureAbsoluteDirectoryTreeNoSymlinks(this.#directory);
    await assertPrivateDirectory(this.#directory);
  }

  async #withLock<Result>(
    projectId: string,
    agentRunId: string,
    body: () => Promise<Result>,
  ): Promise<Result> {
    await this.#ensureDirectory();
    const path = `${await this.pathFor(projectId, agentRunId)}.lock`;
    const file = await openRegularLockFile(this.#directory, path);
    try {
      await file.lock(true);
      await assertOpenRegularFile(this.#directory, path, file, "WAL lock");
      return await body();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

export async function validateAdmittedModelicaExecutionAttempt(
  value: unknown,
  expectedProjectId?: string,
  expectedAgentRunId?: string,
): Promise<AdmittedModelicaExecutionAttempt> {
  const phase = phaseOf(value);
  const root = exactRecord(value, keysForPhase(phase), "$attempt");
  literalValue(
    root.schemaVersion,
    ADMITTED_MODELICA_EXECUTION_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const identity = await validateIdentity(root.identity);
  const attemptFingerprint = validateContentFingerprint(
    root.attemptFingerprint,
    "$attempt.attemptFingerprint",
  );
  const key = validateKey({
    projectId: root.projectId,
    agentRunId: root.agentRunId,
    executionRunId: root.executionRunId,
    attemptFingerprint,
  });
  if (
    key.projectId !== identity.projectId ||
    key.agentRunId !== identity.agentRunId ||
    key.executionRunId !== identity.executionRunId ||
    (expectedProjectId !== undefined && key.projectId !== expectedProjectId) ||
    (expectedAgentRunId !== undefined && key.agentRunId !== expectedAgentRunId) ||
    !fingerprintsEqual(
      attemptFingerprint,
      await fingerprintAdmittedModelicaExecutionAttemptIdentity(identity),
    )
  ) {
    throw integrity("The admitted Modelica execution WAL identity is divergent.");
  }
  const baseValue = {
    schemaVersion: ADMITTED_MODELICA_EXECUTION_ATTEMPT_SCHEMA,
    ...key,
    identity,
    preparedAt: timestamp(root.preparedAt, "$attempt.preparedAt"),
  } as const;
  if (baseValue.preparedAt !== identity.startedAt) {
    throw integrity(
      "The admitted Modelica WAL prepared time differs from its exact run start.",
    );
  }
  if (phase === "prepared") return deepFreeze({ ...baseValue, phase });

  const dispatch = validateDispatch(root.dispatch);
  if (dispatch.dispatchedAt !== identity.startedAt) {
    throw integrity(
      "The admitted Modelica dispatch time differs from its exact run start.",
    );
  }
  if (phase === "generation-zero-cleaned") {
    if (dispatch.dispatchCount !== 1 || dispatch.producerGeneration !== 0) {
      throw integrity("Generation-zero cleanup names another dispatch.");
    }
    return deepFreeze({
      ...baseValue,
      phase,
      dispatch: dispatch as AdmittedModelicaExecutionDispatch & {
        readonly dispatchCount: 1;
        readonly producerGeneration: 0;
      },
      generationZeroDestruction: validateGenerationZeroDestruction(
        root.generationZeroDestruction,
        identity.executionRunId,
      ),
    });
  }
  const generationRecovery = await validateGenerationRecovery(
    root.generationRecovery,
    identity.executionRunId,
    dispatch,
  );
  if (phase === "dispatching") {
    return deepFreeze({
      ...baseValue,
      phase,
      dispatch,
      generationRecovery,
    });
  }
  if (phase === "output-validation-rejected") {
    return deepFreeze({
      ...baseValue,
      phase,
      dispatch,
      generationRecovery,
      outputValidationRejection: validateOutputValidationRejection(
        root.outputValidationRejection,
        identity,
      ),
    });
  }
  const receiptRecord = await validatePublishedReceipt(
    root.receiptRecord,
    identity,
    dispatch.producerGeneration,
  );
  if (phase === "output-published") {
    return deepFreeze({
      ...baseValue,
      phase,
      dispatch,
      generationRecovery,
      receiptRecord,
    });
  }
  return deepFreeze({
    ...baseValue,
    phase,
    dispatch,
    generationRecovery,
    receiptRecord,
    threadEvidence: await validateStoredThreadEvidence(
      root.threadEvidence,
      identity,
      receiptRecord,
    ),
  });
}

async function validateIdentity(
  value: unknown,
): Promise<AdmittedModelicaExecutionAttemptIdentity> {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "startedAt",
    "basis",
    "basisFingerprint",
    "reviewedRunFingerprint",
    "decision",
    "approval",
    "admission",
    "executionProfile",
    "isolatedRequest",
  ], "$identity");
  const projectId = safeId(root.projectId, "$identity.projectId");
  const agentRunId = safeId(root.agentRunId, "$identity.agentRunId");
  const executionRunId = safeId(
    root.executionRunId,
    "$identity.executionRunId",
  );
  if (
    executionRunId !==
      await deriveAdmittedModelicaExecutionRunId(projectId, agentRunId)
  ) {
    throw integrity("The admitted Modelica execution run id is not server-derived.");
  }
  const startedAt = timestamp(root.startedAt, "$identity.startedAt");
  const basis = parseExactThreadSnapshotBasis(root.basis, "$identity.basis");
  const basisFingerprint = validateContentFingerprint(
    root.basisFingerprint,
    "$identity.basisFingerprint",
  );
  const reviewedRunFingerprint = validateContentFingerprint(
    root.reviewedRunFingerprint,
    "$identity.reviewedRunFingerprint",
  );
  const decision = validateAuthorityRef(root.decision, "$identity.decision");
  const approval = validateAuthorityRef(root.approval, "$identity.approval");
  if (!fingerprintsEqual(decision.inputFingerprint, approval.inputFingerprint)) {
    throw integrity(
      "The admitted Modelica decision and approval fingerprints diverge.",
    );
  }
  const admission = validateModelicaAdmittedRunAdmission(
    root.admission,
    "$identity.admission",
  );
  const executionProfile = await validateAdmittedModelicaExecutionProfile(
    root.executionProfile,
  );
  const isolatedRequest = validateIsolatedRequest(
    root.isolatedRequest,
    executionRunId,
    admission,
    executionProfile,
  );
  assertAdmissionProfileMatch(admission, executionProfile);
  return deepFreeze({
    projectId,
    agentRunId,
    executionRunId,
    startedAt,
    basis,
    basisFingerprint,
    reviewedRunFingerprint,
    decision,
    approval,
    admission,
    executionProfile,
    isolatedRequest,
  });
}

function validateAuthorityRef(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "inputFingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    inputFingerprint: validateContentFingerprint(
      root.inputFingerprint,
      `${path}.inputFingerprint`,
    ),
  });
}

function validateIsolatedRequest(
  value: unknown,
  executionRunId: string,
  admission: ReturnType<typeof validateModelicaAdmittedRunAdmission>,
  profile: Awaited<ReturnType<typeof validateAdmittedModelicaExecutionProfile>>,
): AdmittedModelicaExecutionAttemptIdentity["isolatedRequest"] {
  const root = exactRecord(value, [
    "schemaVersion",
    "runId",
    "producerGeneration",
    "profile",
    "sourceSha256",
    "policy",
    "outputs",
  ], "$identity.isolatedRequest");
  literalValue(
    root.schemaVersion,
    ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    "$identity.isolatedRequest.schemaVersion",
  );
  literalValue(
    root.producerGeneration,
    0,
    "$identity.isolatedRequest.producerGeneration",
  );
  const requestProfile = validateIsolatedCodeProfileRef(
    root.profile,
    "$identity.isolatedRequest.profile",
  );
  const policy = validateIsolatedCodePolicyRef(
    root.policy,
    "$identity.isolatedRequest.policy",
  );
  const outputs = validateIsolatedCodeOutputManifest(
    root.outputs,
    "$identity.isolatedRequest.outputs",
  );
  const sourceSha256 = sha256Hex(
    root.sourceSha256,
    "$identity.isolatedRequest.sourceSha256",
  );
  if (
    safeId(root.runId, "$identity.isolatedRequest.runId") !== executionRunId ||
    sourceSha256 !== admission.compilation.source.sourceFingerprint.digest ||
    !isolatedCodeRefsEqual(requestProfile, profile.executionProfile) ||
    !isolatedCodeRefsEqual(policy, profile.isolationPolicy) ||
    !isolatedCodeOutputManifestsEqual(outputs, profile.outputManifest)
  ) {
    throw integrity(
      "The admitted source and isolated request differ from their durable authority.",
    );
  }
  return deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: executionRunId,
    producerGeneration: 0,
    profile: requestProfile,
    sourceSha256,
    policy,
    outputs,
  });
}

function assertAdmissionProfileMatch(
  admission: ReturnType<typeof validateModelicaAdmittedRunAdmission>,
  profile: Awaited<ReturnType<typeof validateAdmittedModelicaExecutionProfile>>,
): void {
  if (
    admission.compilation.profile.id !== profile.compilationProfile.id ||
    admission.compilation.profile.version !== profile.compilationProfile.version ||
    !fingerprintsEqual(
      admission.compilation.profile.fingerprint,
      profile.compilationProfileFingerprint,
    ) ||
    admission.execution.profile.id !== profile.executionProfile.id ||
    admission.execution.profile.version !== profile.executionProfile.version ||
    !fingerprintsEqual(
      admission.execution.profile.fingerprint,
      profile.profileFingerprint,
    ) ||
    !isolatedCodeRefsEqual(
      admission.execution.isolationPolicy,
      profile.isolationPolicy,
    ) ||
    deterministicJson(admission.execution.runtimeBackend) !==
      deterministicJson(profile.runtimeBackend) ||
    !fingerprintsEqual(
      admission.execution.runtime.imageDigest,
      profile.runtime.imageDigest,
    ) ||
    admission.execution.runtime.isolationClass !== profile.runtime.isolationClass ||
    deterministicJson(admission.execution.runtime.limits) !==
      deterministicJson(profile.runtime.requestedLimits) ||
    deterministicJson(admission.execution.runtime.limitAssurance) !==
      deterministicJson(profile.runtime.limitAssurance) ||
    deterministicJson(admission.execution.outputValidator) !==
      deterministicJson(profile.outputValidator) ||
    !isolatedCodeOutputManifestsEqual(
      admission.execution.outputs,
      profile.outputManifest,
    ) ||
    admission.execution.minimumDestructionAssurance !==
      profile.minimumDestructionAssurance
  ) {
    throw integrity(
      "The admitted Modelica MRTR and server execution profile diverge.",
    );
  }
}

async function validatePublishedReceipt(
  value: unknown,
  identity: AdmittedModelicaExecutionAttemptIdentity,
  expectedProducerGeneration: 0 | 1,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(value);
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    receipt.runId,
    receipt.producerGeneration,
    receipt.outputs.map((
      { validation: _validation, persistence: _persistence, ...output },
    ) => output),
  );
  if (
    receipt.runId !== identity.executionRunId ||
    receipt.producerGeneration !== expectedProducerGeneration ||
    receipt.publication.ref.runId !== identity.executionRunId ||
    receipt.publication.ref.producerGeneration !== expectedProducerGeneration ||
    !fingerprintsEqual(
      receipt.publication.ref.fingerprint,
      publicationFingerprint,
    ) ||
    receipt.sourceSha256 !== identity.isolatedRequest.sourceSha256 ||
    !isolatedCodeRefsEqual(receipt.profile, identity.isolatedRequest.profile) ||
    !isolatedCodeRefsEqual(receipt.policy, identity.isolatedRequest.policy) ||
    !runtimeAttestationsEqual(receipt.runtime, identity.executionProfile.runtime) ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      identity.isolatedRequest.outputs,
    ) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" ||
    receipt.destruction.runId !== identity.executionRunId ||
    receipt.publication.status !== "atomic-batch-published"
  ) {
    throw integrity(
      "The published admitted Modelica receipt differs from its durable identity.",
    );
  }
  return receipt;
}

function validateDispatch(value: unknown): AdmittedModelicaExecutionDispatch {
  const root = exactRecord(
    value,
    ["dispatchCount", "producerGeneration", "dispatchedAt"],
    "$attempt.dispatch",
  );
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    root.producerGeneration,
    "$attempt.dispatch.producerGeneration",
  );
  if (
    (root.dispatchCount !== 1 && root.dispatchCount !== 2) ||
    root.dispatchCount !== producerGeneration + 1
  ) {
    throw integrity(
      "Admitted Modelica dispatch count and producer generation diverge.",
    );
  }
  return deepFreeze({
    dispatchCount: root.dispatchCount,
    producerGeneration,
    dispatchedAt: timestamp(
      root.dispatchedAt,
      "$attempt.dispatch.dispatchedAt",
    ),
  } as AdmittedModelicaExecutionDispatch);
}

async function validateGenerationRecovery(
  value: unknown,
  executionRunId: string,
  dispatch: AdmittedModelicaExecutionDispatch,
): Promise<AdmittedModelicaExecutionGenerationRecovery | null> {
  if (dispatch.producerGeneration === 0) {
    literalValue(value, null, "$attempt.generationRecovery");
    return null;
  }
  const root = exactRecord(
    value,
    ["generationZeroDestruction", "advance"],
    "$attempt.generationRecovery",
  );
  return deepFreeze({
    generationZeroDestruction: validateGenerationZeroDestruction(
      root.generationZeroDestruction,
      executionRunId,
    ),
    advance: await validateGenerationAdvance(root.advance, executionRunId),
  });
}

function validateOutputValidationRejection(
  value: unknown,
  identity: AdmittedModelicaExecutionAttemptIdentity,
) {
  const root = exactRecord(
    value,
    ["observation", "destruction"],
    "$outputValidationRejection",
  );
  const observation = validateIsolatedCodeOutputValidationRejection(
    root.observation,
    "$outputValidationRejection.observation",
  );
  assertRegisteredOutputRole(observation.role, identity);
  return deepFreeze({
    observation,
    destruction: validateGenerationZeroDestruction(
      root.destruction,
      identity.executionRunId,
    ),
  });
}

function assertRegisteredOutputRole(
  role: string,
  identity: AdmittedModelicaExecutionAttemptIdentity,
): void {
  if (!identity.isolatedRequest.outputs.some((item) => item.role === role)) {
    throw integrity("Output-validation rejection role is not registered.");
  }
}

function validateGenerationZeroDestruction(
  value: unknown,
  executionRunId: string,
): Extract<
  IsolatedCodeExecutionReceiptRecord["destruction"],
  { readonly status: "proven" }
> {
  const root = exactRecord(
    value,
    ["status", "runId", "proofFingerprint"],
    "$attempt.generationZeroDestruction",
  );
  literalValue(
    root.status,
    "proven",
    "$attempt.generationZeroDestruction.status",
  );
  literalValue(
    root.runId,
    executionRunId,
    "$attempt.generationZeroDestruction.runId",
  );
  return deepFreeze({
    status: "proven",
    runId: executionRunId,
    proofFingerprint: validateContentFingerprint(
      root.proofFingerprint,
      "$attempt.generationZeroDestruction.proofFingerprint",
    ),
  });
}

async function validateGenerationAdvance(
  value: unknown,
  executionRunId: string,
) {
  try {
    return await validateIsolatedOutputProducerGenerationAdvance(
      value,
      executionRunId,
    );
  } catch {
    throw integrity(
      "The producer-generation advance differs from this admitted Modelica run.",
    );
  }
}

function validateThreadEvidenceInput(
  value: unknown,
  identity: AdmittedModelicaExecutionAttemptIdentity,
  receipt: IsolatedCodeExecutionReceiptRecord,
): AdmittedModelicaExecutionThreadEvidenceInput {
  const root = exactRecord(value, [
    "snapshotId",
    "revision",
    "subjectId",
    "artifacts",
  ], "$threadEvidence");
  const artifacts = exactRecord(
    root.artifacts,
    ["capture", "evidence", "result"],
    "$threadEvidence.artifacts",
  );
  const capture = validateThreadArtifactEvidence(
    artifacts.capture,
    "capture",
  );
  const evidence = validateThreadArtifactEvidence(
    artifacts.evidence,
    "evidence",
  );
  const result = validateThreadArtifactEvidence(artifacts.result, "result");
  const snapshotId = safeId(root.snapshotId, "$threadEvidence.snapshotId");
  const revision = positiveInteger(root.revision, "$threadEvidence.revision");
  const subjectId = safeId(root.subjectId, "$threadEvidence.subjectId");
  const expectedRevision = identity.basis.revision + 1;
  const expectedSnapshotId =
    `${identity.basis.subjectId}:r${expectedRevision}:simulate-run-admitted-modelica-${identity.agentRunId}`;
  const outputByRole = new Map(
    receipt.outputs.map((output) => [output.role, output]),
  );
  const evidenceOutput = outputByRole.get("evidence");
  const resultOutput = outputByRole.get("result");
  if (
    snapshotId !== expectedSnapshotId ||
    revision !== expectedRevision ||
    subjectId !== identity.basis.subjectId ||
    outputByRole.size !== 2 ||
    !evidenceOutput ||
    !resultOutput ||
    evidence.id !== `modelica-admitted-evidence-${evidenceOutput.sha256}` ||
    evidence.fingerprint.digest !== evidenceOutput.sha256 ||
    result.id !== `modelica-admitted-result-${resultOutput.sha256}` ||
    result.fingerprint.digest !== resultOutput.sha256
  ) {
    throw integrity(
      "The admitted Modelica Thread evidence is not the exact documentary successor.",
    );
  }
  return deepFreeze({
    snapshotId,
    revision,
    subjectId,
    artifacts: { capture, evidence, result },
  });
}

async function sealThreadEvidence(
  value: unknown,
  identity: AdmittedModelicaExecutionAttemptIdentity,
  receipt: IsolatedCodeExecutionReceiptRecord,
): Promise<AdmittedModelicaExecutionThreadEvidence> {
  const evidence = validateThreadEvidenceInput(value, identity, receipt);
  return deepFreeze({
    ...evidence,
    fingerprint: await fingerprintThreadEvidence(identity, receipt, evidence),
  });
}

async function validateStoredThreadEvidence(
  value: unknown,
  identity: AdmittedModelicaExecutionAttemptIdentity,
  receipt: IsolatedCodeExecutionReceiptRecord,
): Promise<AdmittedModelicaExecutionThreadEvidence> {
  const root = exactRecord(value, [
    "snapshotId",
    "revision",
    "subjectId",
    "artifacts",
    "fingerprint",
  ], "$threadEvidence");
  const evidence = validateThreadEvidenceInput(
    {
      snapshotId: root.snapshotId,
      revision: root.revision,
      subjectId: root.subjectId,
      artifacts: root.artifacts,
    },
    identity,
    receipt,
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$threadEvidence.fingerprint",
  );
  if (
    !fingerprintsEqual(
      fingerprint,
      await fingerprintThreadEvidence(identity, receipt, evidence),
    )
  ) {
    throw integrity(
      "The admitted Modelica Thread evidence fingerprint is divergent.",
    );
  }
  return deepFreeze({ ...evidence, fingerprint });
}

async function fingerprintThreadEvidence(
  identity: AdmittedModelicaExecutionAttemptIdentity,
  receipt: IsolatedCodeExecutionReceiptRecord,
  evidence: AdmittedModelicaExecutionThreadEvidenceInput,
) {
  return await sha256Fingerprint({
    schemaVersion: "modelica-admitted-execution-thread-evidence/1.0",
    attemptIdentityFingerprint:
      await fingerprintAdmittedModelicaExecutionAttemptIdentity(identity),
    receiptFingerprint: receipt.fingerprint,
    evidence,
  });
}

function validateThreadArtifactEvidence(
  value: unknown,
  role: "capture" | "evidence" | "result",
): AdmittedModelicaExecutionThreadArtifactEvidence {
  const path = `$threadEvidence.artifacts.${role}`;
  const root = exactRecord(value, ["id", "fingerprint"], path);
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const id = safeId(root.id, `${path}.id`);
  if (id !== `modelica-admitted-${role}-${fingerprint.digest}`) {
    throw integrity(`${path}.id does not derive from its exact fingerprint.`);
  }
  return deepFreeze({ id, fingerprint });
}

function phaseOf(value: unknown): AdmittedModelicaExecutionAttempt["phase"] {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
    "identity",
    "preparedAt",
    "phase",
    ...optionalAttemptFields(value),
  ], "$attempt");
  if (
    root.phase !== "prepared" &&
    root.phase !== "dispatching" &&
    root.phase !== "generation-zero-cleaned" &&
    root.phase !== "output-published" &&
    root.phase !== "completed" &&
    root.phase !== "output-validation-rejected"
  ) {
    throw integrity("The admitted Modelica execution WAL phase is unsupported.");
  }
  return root.phase;
}

function optionalAttemptFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [
    "dispatch",
    "generationRecovery",
    "generationZeroDestruction",
    "receiptRecord",
    "threadEvidence",
    "outputValidationRejection",
  ].filter((key) => Object.hasOwn(value, key));
}

function keysForPhase(
  phase: AdmittedModelicaExecutionAttempt["phase"],
): string[] {
  const keys = [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
    "identity",
    "preparedAt",
    "phase",
  ];
  if (phase === "prepared") return keys;
  keys.push("dispatch");
  if (phase === "generation-zero-cleaned") {
    keys.push("generationZeroDestruction");
    return keys;
  }
  keys.push("generationRecovery");
  if (phase === "dispatching") return keys;
  if (phase === "output-validation-rejected") {
    keys.push("outputValidationRejection");
    return keys;
  }
  keys.push("receiptRecord");
  if (phase === "completed") keys.push("threadEvidence");
  return keys;
}

function keyFor(
  identity: AdmittedModelicaExecutionAttemptIdentity,
  attemptFingerprint: AdmittedModelicaExecutionAttemptKey["attemptFingerprint"],
): AdmittedModelicaExecutionAttemptKey {
  return {
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    attemptFingerprint,
  };
}

function validateKey(value: unknown): AdmittedModelicaExecutionAttemptKey {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
  ], "$attemptKey");
  return deepFreeze({
    projectId: safeId(root.projectId, "$attemptKey.projectId"),
    agentRunId: safeId(root.agentRunId, "$attemptKey.agentRunId"),
    executionRunId: safeId(
      root.executionRunId,
      "$attemptKey.executionRunId",
    ),
    attemptFingerprint: validateContentFingerprint(
      root.attemptFingerprint,
      "$attemptKey.attemptFingerprint",
    ),
  });
}

function assertKey(
  attempt: AdmittedModelicaExecutionAttempt,
  key: AdmittedModelicaExecutionAttemptKey,
): void {
  if (
    attempt.projectId !== key.projectId ||
    attempt.agentRunId !== key.agentRunId ||
    attempt.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(attempt.attemptFingerprint, key.attemptFingerprint)
  ) {
    throw integrity("The admitted Modelica execution WAL key is divergent.");
  }
}

function base(attempt: AdmittedModelicaExecutionAttempt) {
  return {
    schemaVersion: attempt.schemaVersion,
    projectId: attempt.projectId,
    agentRunId: attempt.agentRunId,
    executionRunId: attempt.executionRunId,
    attemptFingerprint: attempt.attemptFingerprint,
    identity: attempt.identity,
    preparedAt: attempt.preparedAt,
  };
}

function timestamp(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  try {
    if (new Date(text).toISOString() !== text) throw new Error();
  } catch {
    throw integrity(`${path} must be canonical ISO-8601 UTC.`);
  }
  return text;
}

function validateStorageRoot(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes("//")
  ) {
    throw new TypeError(
      "Admitted Modelica WAL directory must be a bounded path.",
    );
  }
  const root = value.replace(/\/+$/, "");
  if (root.length === 0 || root === "/" || root === "." || root === "..") {
    throw new TypeError(
      "Admitted Modelica WAL directory must be a bounded path.",
    );
  }
  const segments = root.split("/");
  if (segments[0] === "") segments.shift();
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError(
      "Admitted Modelica WAL directory must be a bounded path.",
    );
  }
  return root;
}

function absoluteStorageRoot(root: string): string {
  if (root.startsWith("/")) return root;
  return `${Deno.cwd().replace(/\/+$/, "")}/${root}`;
}

async function assertDirectoryTreeNoSymlinksIfPresent(
  path: string,
): Promise<boolean> {
  const inspected = await inspectDirectoryAnchor(path);
  return inspected.missing.length === 0;
}

async function ensureAbsoluteDirectoryTreeNoSymlinks(path: string): Promise<void> {
  const inspected = await inspectDirectoryAnchor(path);
  for (const directory of inspected.missing.reverse()) {
    const parent = parentPath(directory);
    await assertRealDirectory(parent, "WAL root parent");
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    await assertRealDirectory(directory, "WAL root");
    assertMode(await Deno.lstat(directory), 0o700, "WAL directory");
    await syncDirectorySecure(parent);
  }
  await assertRealDirectory(path, "WAL root");
}

async function inspectDirectoryAnchor(path: string): Promise<{
  readonly anchor: string;
  readonly missing: string[];
}> {
  const missing: string[] = [];
  let anchor = path;
  while (true) {
    try {
      await assertRealDirectory(anchor, "WAL root or ancestor");
      return { anchor, missing };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      missing.push(anchor);
      const parent = parentPath(anchor);
      if (parent === anchor) throw error;
      anchor = parent;
    }
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  await assertRealDirectory(path, "WAL root");
  assertMode(await Deno.lstat(path), 0o700, "WAL root");
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (
    info.isSymlink || !info.isDirectory ||
    await Deno.realPath(path) !== path
  ) {
    throw integrity(`${label} and its ancestors must be real directories.`);
  }
}

async function readRegularTextFileIfPresent(
  root: string,
  path: string,
  label: string,
): Promise<string | undefined> {
  try {
    await assertRegularFileWithinRoot(root, path, label);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
  const file = await Deno.open(path, { read: true });
  try {
    const info = await assertOpenRegularFile(root, path, file, label);
    assertMode(info, 0o600, label);
    if (info.size > MAX_WAL_BYTES) {
      throw integrity(`${label} exceeds the bounded WAL size.`);
    }
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = await file.read(bytes.subarray(offset));
      if (count === null || count < 1) {
        throw integrity(`${label} changed during exact readback.`);
      }
      offset += count;
    }
    if (await file.read(new Uint8Array(1)) !== null) {
      throw integrity(`${label} changed during exact readback.`);
    }
    await assertOpenRegularFile(root, path, file, label);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw integrity(`${label} is not UTF-8 text.`);
    }
  } finally {
    file.close();
  }
}

async function openRegularLockFile(
  root: string,
  path: string,
): Promise<Deno.FsFile> {
  requireDescendantPath(root, path);
  await assertMissingOrRegularFileWithinRoot(root, path, "WAL lock");
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, {
      createNew: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    await assertRegularFileWithinRoot(root, path, "WAL lock");
    file = await Deno.open(path, { read: true, write: true });
  }
  try {
    const info = await assertOpenRegularFile(root, path, file, "WAL lock");
    assertMode(info, 0o600, "WAL lock");
    return file;
  } catch (error) {
    file.close();
    throw error;
  }
}

async function writeWalFileDurably(
  path: string,
  text: string,
  directory: string,
  noProgressMessage: string,
  mode: "create-new" | "replace",
): Promise<void> {
  requireDescendantPath(directory, path);
  await ensureAbsoluteDirectoryTreeNoSymlinks(directory);
  await assertPrivateDirectory(directory);
  if (mode === "replace") {
    await assertRegularFileWithinRoot(directory, path, "WAL file");
  } else {
    await assertMissingOrRegularFileWithinRoot(directory, path, "WAL file");
  }
  const temporary = `${directory}/.${crypto.randomUUID()}.tmp`;
  try {
    const file = await Deno.open(temporary, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      await assertOpenRegularFile(directory, temporary, file, "WAL temporary");
      const bytes = new TextEncoder().encode(text);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = await file.write(bytes.subarray(offset));
        if (count < 1) throw new Error(noProgressMessage);
        offset += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    await assertRealDirectory(directory, "WAL root");
    if (mode === "create-new") {
      await Deno.link(temporary, path);
    } else {
      await assertRegularFileWithinRoot(directory, path, "WAL file");
      await Deno.rename(temporary, path);
    }
    const info = await assertRegularFileWithinRoot(directory, path, "WAL file");
    assertMode(info, 0o600, "WAL file");
    await syncDirectorySecure(directory);
  } finally {
    await Deno.remove(temporary).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

async function assertRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<Deno.FileInfo> {
  requireDescendantPath(root, path);
  await assertRealDirectory(root, "WAL root");
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) {
    throw integrity(`${label} must be one regular file inside the WAL root.`);
  }
  return info;
}

async function assertMissingOrRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  try {
    await assertRegularFileWithinRoot(root, path, label);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function assertOpenRegularFile(
  root: string,
  path: string,
  file: Deno.FsFile,
  label: string,
): Promise<Deno.FileInfo> {
  const pathInfo = await assertRegularFileWithinRoot(root, path, label);
  const openInfo = await file.stat();
  if (
    !openInfo.isFile ||
    (pathInfo.dev !== null && pathInfo.ino !== null &&
      openInfo.dev !== null && openInfo.ino !== null &&
      (pathInfo.dev !== openInfo.dev || pathInfo.ino !== openInfo.ino))
  ) {
    throw integrity(`${label} path changed while it was open.`);
  }
  return openInfo;
}

async function syncDirectorySecure(path: string): Promise<void> {
  await assertRealDirectory(path, "WAL directory");
  const directory = await Deno.open(path, { read: true });
  try {
    const openInfo = await directory.stat();
    const pathInfo = await Deno.lstat(path);
    if (
      !openInfo.isDirectory || pathInfo.isSymlink || !pathInfo.isDirectory ||
      (pathInfo.dev !== null && pathInfo.ino !== null &&
        openInfo.dev !== null && openInfo.ino !== null &&
        (pathInfo.dev !== openInfo.dev || pathInfo.ino !== openInfo.ino))
    ) {
      throw integrity("WAL directory changed while it was open.");
    }
    await directory.sync();
  } finally {
    directory.close();
  }
}

function requireDescendantPath(root: string, path: string): void {
  if (path.startsWith(`${root}/`)) return;
  throw integrity("Filesystem operation escaped the anchored WAL root.");
}

function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  return slash <= 0 ? "/" : clean.slice(0, slash);
}

function assertMode(
  info: Deno.FileInfo,
  expected: number,
  label: string,
): void {
  if (
    Deno.build.os !== "windows" && info.mode !== null &&
    (info.mode & 0o777) !== expected
  ) {
    throw integrity(`${label} permissions must be ${expected.toString(8)}.`);
  }
}

function integrity(
  message: string,
): AdmittedModelicaExecutionAttemptIntegrityError {
  return new AdmittedModelicaExecutionAttemptIntegrityError(message);
}
