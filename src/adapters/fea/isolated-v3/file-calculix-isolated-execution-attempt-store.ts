/** Durable, monotone WAL for the isolated CalculiX execution slice. */

import {
  type CalculixIsolatedExecutionAttempt,
  type CalculixIsolatedExecutionAttemptIdentity,
  type CalculixIsolatedExecutionAttemptKey,
  type CalculixIsolatedExecutionAttemptStore,
  type CalculixIsolatedExecutionDispatch,
  type CalculixIsolatedProvenDestruction,
  type CalculixIsolatedRedispatchConsumption,
  fingerprintCalculixIsolatedExecutionAttemptIdentity,
} from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-attempt-store.ts";
import { validateCalculixIsolatedExecutionProfile } from "./fixed-calculix-isolated-execution-profile.ts";
import {
  validateCalculixIsolatedExecutionEvidence,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionRejectionDiagnostic,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  type IsolatedOutputProducerGenerationAdvance,
  runtimeAttestationsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRejectionDiagnostic,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedOutputProducerGenerationAdvance,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { sha256Hex } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

const SCHEMA = "calculix-isolated-execution-attempt/1.0" as const;
const NO_PROGRESS = "Isolated CalculiX attempt journal made no write progress.";

export class CalculixIsolatedExecutionAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculixIsolatedExecutionAttemptIntegrityError";
  }
}

export class FileCalculixIsolatedExecutionAttemptStore
  implements CalculixIsolatedExecutionAttemptStore {
  readonly #directory: string;
  readonly #syncBoundary: string | undefined;

  constructor(
    directory = "state/local/calculix-isolated-execution-attempts",
    syncBoundary?: string,
  ) {
    this.#directory = boundedDirectory(directory);
    this.#syncBoundary = syncBoundary === undefined
      ? undefined
      : boundedDirectory(syncBoundary);
  }

  async read(projectIdValue: string, agentRunIdValue: string) {
    const projectId = safeId(projectIdValue, "$projectId");
    const agentRunId = safeId(agentRunIdValue, "$agentRunId");
    let text: string;
    try {
      text = await Deno.readTextFile(await this.pathFor(projectId, agentRunId));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw integrity("The isolated CalculiX journal is not JSON.");
    }
    const attempt = await validateAttempt(value, projectId, agentRunId);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw integrity("The isolated CalculiX journal is not canonical.");
    }
    return attempt;
  }

  async prepare(identityValue: CalculixIsolatedExecutionAttemptIdentity) {
    const identity = await validateIdentity(identityValue);
    const attemptFingerprint =
      await fingerprintCalculixIsolatedExecutionAttemptIdentity(identity);
    const fresh: CalculixIsolatedExecutionAttempt = deepFreeze({
      schemaVersion: SCHEMA,
      ...keyFromIdentity(identity, attemptFingerprint),
      identity,
      preparedAt: identity.startedAt,
      phase: "prepared",
    });
    return await this.#withLock(identity.projectId, identity.agentRunId, async () => {
      const existing = await this.read(identity.projectId, identity.agentRunId);
      if (existing) {
        assertKey(existing, keyFromIdentity(identity, attemptFingerprint));
        return existing;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  markDispatching(
    input: CalculixIsolatedExecutionAttemptKey & { readonly dispatchedAt: string },
  ) {
    return this.#transition(input, (current) => {
      const dispatchedAt = iso(input.dispatchedAt, "$dispatchedAt");
      if (current.phase !== "prepared") {
        if (
          "dispatch" in current && current.dispatch.dispatchCount === 1 &&
          current.dispatch.dispatchedAt === dispatchedAt
        ) return current;
        throw integrity("Isolated CalculiX dispatch is out of order.");
      }
      if (dispatchedAt !== current.identity.startedAt) {
        throw integrity("Dispatch time must equal the durable run start.");
      }
      return deepFreeze({
        ...base(current),
        phase: "dispatching" as const,
        dispatch: {
          dispatchCount: 1 as const,
          producerGeneration: 0 as const,
          dispatchedAt,
        },
      });
    });
  }

  authorizeRedispatch(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly recoveryDestruction: {
        readonly status: "proven";
        readonly runId: string;
        readonly proofFingerprint: {
          readonly algorithm: "sha256";
          readonly digest: string;
        };
      };
      readonly generationAdvance: IsolatedOutputProducerGenerationAdvance;
    },
  ) {
    return this.#transition(input, async (current) => {
      if (current.phase !== "dispatching") {
        throw integrity("Redispatch is possible only while dispatching.");
      }
      const destruction = validateDestruction(
        input.recoveryDestruction,
        current.executionRunId,
      );
      const generationAdvance = await validateGenerationAdvance(
        input.generationAdvance,
        current.executionRunId,
      );
      if (current.dispatch.dispatchCount === 2) {
        if (
          deterministicJson(current.dispatch.redispatch.recoveryDestruction) ===
            deterministicJson(destruction) &&
          deterministicJson(current.dispatch.redispatch.generationAdvance) ===
            deterministicJson(generationAdvance)
        ) return current;
        throw integrity("Redispatch cleanup evidence diverges.");
      }
      return deepFreeze({
        ...base(current),
        phase: "dispatching" as const,
        dispatch: {
          dispatchCount: 2 as const,
          producerGeneration: 1 as const,
          dispatchedAt: current.dispatch.dispatchedAt,
          redispatch: {
            status: "authorized" as const,
            previousProducerGeneration: 0 as const,
            generationAdvance,
            recoveryDestruction: destruction,
          },
        },
      });
    });
  }

  async consumeRedispatch(
    input: CalculixIsolatedExecutionAttemptKey,
  ): Promise<CalculixIsolatedRedispatchConsumption> {
    const key = validateKey(input);
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) throw integrity("The isolated CalculiX journal is missing.");
      assertKey(current, key);
      if (current.phase !== "dispatching" || current.dispatch.dispatchCount !== 2) {
        throw integrity("Redispatch consumption requires exact authorization.");
      }
      if (current.dispatch.redispatch.status === "consumed") {
        return deepFreeze({ outcome: "already-consumed", attempt: current });
      }
      const next: CalculixIsolatedExecutionAttempt = deepFreeze({
        ...base(current),
        phase: "dispatching",
        dispatch: {
          ...current.dispatch,
          redispatch: { ...current.dispatch.redispatch, status: "consumed" },
        },
      });
      await this.#replace(next);
      return deepFreeze({ outcome: "consumed-now", attempt: next });
    });
  }

  markOutputPublished(
    input: CalculixIsolatedExecutionAttemptKey & { readonly receiptRecord: unknown },
  ) {
    return this.#transition(input, async (current) => {
      const receiptRecord = await validateIsolatedCodeExecutionReceiptRecord(
        input.receiptRecord,
      );
      if (!("dispatch" in current)) {
        throw integrity("Output publication has no durable dispatch generation.");
      }
      assertReceipt(
        receiptRecord,
        current.identity,
        current.dispatch.producerGeneration,
      );
      if (current.phase !== "dispatching") {
        if (
          "receiptRecord" in current &&
          deterministicJson(current.receiptRecord) === deterministicJson(receiptRecord)
        ) return current;
        throw integrity("Output publication is out of order.");
      }
      if (
        current.dispatch.dispatchCount === 2 &&
        current.dispatch.redispatch.status !== "consumed"
      ) throw integrity("Published output follows unconsumed redispatch authority.");
      return deepFreeze({
        ...base(current),
        phase: "output-published" as const,
        dispatch: current.dispatch,
        receiptRecord,
      });
    });
  }

  markRedispatchExhausted(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly destruction: CalculixIsolatedProvenDestruction;
    },
  ) {
    return this.#transition(input, (current) => {
      const destruction = validateDestruction(
        input.destruction,
        current.executionRunId,
      );
      const exhaustion = deepFreeze({
        producerGeneration: 1 as const,
        destruction,
      });
      if (current.phase === "redispatch-exhausted") {
        if (deterministicJson(current.exhaustion) === deterministicJson(exhaustion)) {
          return current;
        }
        throw integrity("Isolated CalculiX redispatch exhaustion evidence diverges.");
      }
      if (
        current.phase !== "dispatching" ||
        current.dispatch.dispatchCount !== 2 ||
        current.dispatch.redispatch.status !== "consumed"
      ) {
        throw integrity("Redispatch exhaustion is out of order.");
      }
      return deepFreeze({
        ...base(current),
        phase: "redispatch-exhausted" as const,
        dispatch: current.dispatch,
        exhaustion,
      });
    });
  }

  markExecutionRejected(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;
      readonly destruction: Extract<
        IsolatedCodeExecutionReceipt["destruction"],
        { readonly status: "proven" }
      >;
    },
  ) {
    return this.#transition(input, (current) => {
      const diagnostic = validateIsolatedCodeExecutionRejectionDiagnostic(
        input.diagnostic,
      );
      const destruction = validateDestruction(
        input.destruction,
        current.executionRunId,
      );
      const rejection = deepFreeze({ diagnostic, destruction });
      if (current.phase === "execution-rejected") {
        if (deterministicJson(current.rejection) === deterministicJson(rejection)) {
          return current;
        }
        throw integrity("Isolated CalculiX rejection evidence diverges.");
      }
      if (current.phase !== "dispatching") {
        throw integrity("Execution rejection is out of order.");
      }
      if (
        current.dispatch.dispatchCount === 2 &&
        current.dispatch.redispatch.status !== "consumed"
      ) {
        throw integrity("Rejected redispatch follows unconsumed redispatch authority.");
      }
      return deepFreeze({
        ...base(current),
        phase: "execution-rejected" as const,
        dispatch: current.dispatch,
        rejection,
      });
    });
  }

  markOutputValidationRejected(
    input: CalculixIsolatedExecutionAttemptKey & {
      readonly observation: {
        readonly role: string;
        readonly byteCount: number;
        readonly sha256: string;
      };
      readonly destruction: Extract<
        IsolatedCodeExecutionReceipt["destruction"],
        { readonly status: "proven" }
      >;
    },
  ) {
    return this.#transition(input, (current) => {
      const observation = validateIsolatedCodeOutputValidationRejection(
        input.observation,
      );
      assertRegisteredOutputRole(observation.role, current.identity);
      const destruction = validateDestruction(
        input.destruction,
        current.executionRunId,
      );
      const outputValidationRejection = deepFreeze({ observation, destruction });
      if (current.phase === "output-validation-rejected") {
        if (
          deterministicJson(current.outputValidationRejection) ===
            deterministicJson(outputValidationRejection)
        ) {
          return current;
        }
        throw integrity("Isolated CalculiX output-validation rejection diverges.");
      }
      if (current.phase !== "dispatching") {
        throw integrity("Output-validation rejection is out of order.");
      }
      if (
        current.dispatch.dispatchCount === 2 &&
        current.dispatch.redispatch.status !== "consumed"
      ) {
        throw integrity(
          "Rejected redispatch follows unconsumed redispatch authority.",
        );
      }
      return deepFreeze({
        ...base(current),
        phase: "output-validation-rejected" as const,
        dispatch: current.dispatch,
        outputValidationRejection,
      });
    });
  }

  markEvidenceCaptured(
    input: CalculixIsolatedExecutionAttemptKey & { readonly evidence: unknown },
  ) {
    return this.#transition(input, async (current) => {
      const evidence = await validateCalculixIsolatedExecutionEvidence(input.evidence);
      if (current.phase !== "output-published") {
        if (
          current.phase === "evidence-captured" &&
          deterministicJson(current.evidence) === deterministicJson(evidence)
        ) return current;
        throw integrity("Evidence capture is out of order.");
      }
      assertEvidence(
        evidence,
        keyFromIdentity(current.identity, current.attemptFingerprint),
        current.identity,
        current.receiptRecord,
      );
      return deepFreeze({
        ...base(current),
        phase: "evidence-captured" as const,
        dispatch: current.dispatch,
        receiptRecord: current.receiptRecord,
        evidence,
      });
    });
  }

  async pathFor(projectId: string, agentRunId: string): Promise<string> {
    const digest = await sha256Fingerprint({
      projectId: safeId(projectId, "$projectId"),
      agentRunId: safeId(agentRunId, "$agentRunId"),
    });
    return `${this.#directory}/run-${digest.digest}.json`;
  }

  async #transition(
    keyValue: CalculixIsolatedExecutionAttemptKey,
    transition: (
      current: CalculixIsolatedExecutionAttempt,
    ) => CalculixIsolatedExecutionAttempt | Promise<CalculixIsolatedExecutionAttempt>,
  ) {
    const key = validateKey(keyValue);
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) throw integrity("The isolated CalculiX journal is missing.");
      assertKey(current, key);
      const next = await transition(current);
      if (next !== current) await this.#replace(next);
      return next;
    });
  }

  async #writeNew(attempt: CalculixIsolatedExecutionAttempt): Promise<void> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await writeNewAttemptFileDurably(
      await this.pathFor(attempt.projectId, attempt.agentRunId),
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
      undefined,
      this.#syncBoundary,
    );
    await this.#assertReread(attempt);
  }

  async #replace(attempt: CalculixIsolatedExecutionAttempt): Promise<void> {
    await replaceAttemptFileDurably(
      await this.pathFor(attempt.projectId, attempt.agentRunId),
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
      undefined,
      this.#syncBoundary,
    );
    await this.#assertReread(attempt);
  }

  async #assertReread(expected: CalculixIsolatedExecutionAttempt): Promise<void> {
    const actual = await this.read(expected.projectId, expected.agentRunId);
    if (!actual || deterministicJson(actual) !== deterministicJson(expected)) {
      throw integrity("The isolated CalculiX journal failed its durable reread.");
    }
  }

  async #withLock<T>(projectId: string, agentRunId: string, body: () => Promise<T>) {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const file = await Deno.open(`${await this.pathFor(projectId, agentRunId)}.lock`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    try {
      await file.lock(true);
      return await body();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

async function validateAttempt(
  value: unknown,
  projectId?: string,
  agentRunId?: string,
): Promise<CalculixIsolatedExecutionAttempt> {
  const record = value as Record<string, unknown>;
  const phase = record?.phase;
  const fields = phase === "prepared"
    ? []
    : phase === "dispatching"
    ? ["dispatch"]
    : phase === "output-published"
    ? ["dispatch", "receiptRecord"]
    : phase === "evidence-captured"
    ? ["dispatch", "receiptRecord", "evidence"]
    : phase === "execution-rejected"
    ? ["dispatch", "rejection"]
    : phase === "output-validation-rejected"
    ? ["dispatch", "outputValidationRejection"]
    : phase === "redispatch-exhausted"
    ? ["dispatch", "exhaustion"]
    : [];
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
    "identity",
    "preparedAt",
    "phase",
    ...fields,
  ], "$attempt");
  literalValue(root.schemaVersion, SCHEMA, "$attempt.schemaVersion");
  const identity = await validateIdentity(root.identity);
  const attemptFingerprint = validateContentFingerprint(
    root.attemptFingerprint,
    "$attempt.attemptFingerprint",
  );
  const expected = await fingerprintCalculixIsolatedExecutionAttemptIdentity(identity);
  if (!fingerprintsEqual(attemptFingerprint, expected)) {
    throw integrity("Attempt fingerprint is stale.");
  }
  const key = keyFromIdentity(identity, attemptFingerprint);
  if (
    root.projectId !== key.projectId || root.agentRunId !== key.agentRunId ||
    root.executionRunId !== key.executionRunId ||
    (projectId && projectId !== key.projectId) ||
    (agentRunId && agentRunId !== key.agentRunId)
  ) throw integrity("Attempt identity fields diverge.");
  const common = {
    schemaVersion: SCHEMA,
    ...key,
    identity,
    preparedAt: iso(root.preparedAt, "$attempt.preparedAt"),
  };
  if (phase === "prepared") return deepFreeze({ ...common, phase });
  const dispatch = await validateDispatch(root.dispatch, key.executionRunId);
  if (phase === "dispatching") return deepFreeze({ ...common, phase, dispatch });
  if (phase === "execution-rejected") {
    return deepFreeze({
      ...common,
      phase,
      dispatch,
      rejection: validateRejection(root.rejection, key.executionRunId),
    });
  }
  if (phase === "output-validation-rejected") {
    return deepFreeze({
      ...common,
      phase,
      dispatch,
      outputValidationRejection: validateOutputValidationRejection(
        root.outputValidationRejection,
        key.executionRunId,
        identity,
      ),
    });
  }
  if (phase === "redispatch-exhausted") {
    if (dispatch.dispatchCount !== 2 || dispatch.redispatch.status !== "consumed") {
      throw integrity(
        "Redispatch exhaustion requires a consumed generation-1 dispatch.",
      );
    }
    return deepFreeze({
      ...common,
      phase,
      dispatch,
      exhaustion: validateExhaustion(root.exhaustion, key.executionRunId),
    });
  }
  const receiptRecord = await validateIsolatedCodeExecutionReceiptRecord(
    root.receiptRecord,
  );
  assertReceipt(receiptRecord, identity, dispatch.producerGeneration);
  if (phase === "output-published") {
    return deepFreeze({ ...common, phase, dispatch, receiptRecord });
  }
  if (phase === "evidence-captured") {
    const evidence = await validateCalculixIsolatedExecutionEvidence(root.evidence);
    assertEvidence(evidence, key, identity, receiptRecord);
    return deepFreeze({ ...common, phase, dispatch, receiptRecord, evidence });
  }
  throw integrity("The isolated CalculiX phase is unsupported.");
}

async function validateIdentity(
  value: unknown,
): Promise<CalculixIsolatedExecutionAttemptIdentity> {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "requestId",
    "startedAt",
    "resolvedOperationPlanFingerprint",
    "proofFingerprint",
    "step",
    "bundleFingerprint",
    "profile",
  ], "$identity");
  const step = exactRecord(root.step, ["byteCount", "sha256"], "$identity.step");
  return deepFreeze({
    projectId: safeId(root.projectId, "$identity.projectId"),
    agentRunId: safeId(root.agentRunId, "$identity.agentRunId"),
    executionRunId: safeId(root.executionRunId, "$identity.executionRunId"),
    requestId: safeId(root.requestId, "$identity.requestId"),
    startedAt: iso(root.startedAt, "$identity.startedAt"),
    resolvedOperationPlanFingerprint: validateContentFingerprint(
      root.resolvedOperationPlanFingerprint,
      "$identity.resolvedOperationPlanFingerprint",
    ),
    proofFingerprint: validateContentFingerprint(
      root.proofFingerprint,
      "$identity.proofFingerprint",
    ),
    step: {
      byteCount: positiveInteger(step.byteCount, "$identity.step.byteCount"),
      sha256: sha256Hex(step.sha256, "$identity.step.sha256"),
    },
    bundleFingerprint: validateContentFingerprint(
      root.bundleFingerprint,
      "$identity.bundleFingerprint",
    ),
    profile: await validateCalculixIsolatedExecutionProfile(root.profile),
  });
}

async function validateDispatch(
  value: unknown,
  runId: string,
): Promise<CalculixIsolatedExecutionDispatch> {
  const root = exactRecord(
    value,
    (value as { dispatchCount?: unknown })?.dispatchCount === 1
      ? ["dispatchCount", "producerGeneration", "dispatchedAt"]
      : ["dispatchCount", "producerGeneration", "dispatchedAt", "redispatch"],
    "$attempt.dispatch",
  );
  const dispatchedAt = iso(root.dispatchedAt, "$attempt.dispatch.dispatchedAt");
  if (root.dispatchCount === 1) {
    literalValue(
      root.producerGeneration,
      0,
      "$attempt.dispatch.producerGeneration",
    );
    return deepFreeze({
      dispatchCount: 1 as const,
      producerGeneration: 0 as const,
      dispatchedAt,
    });
  }
  literalValue(root.dispatchCount, 2, "$attempt.dispatch.dispatchCount");
  literalValue(
    root.producerGeneration,
    1,
    "$attempt.dispatch.producerGeneration",
  );
  const redispatch = exactRecord(
    root.redispatch,
    [
      "status",
      "previousProducerGeneration",
      "generationAdvance",
      "recoveryDestruction",
    ],
    "$attempt.dispatch.redispatch",
  );
  if (redispatch.status !== "authorized" && redispatch.status !== "consumed") {
    throw integrity("Redispatch status is unsupported.");
  }
  const status: "authorized" | "consumed" = redispatch.status;
  literalValue(
    redispatch.previousProducerGeneration,
    0,
    "$attempt.dispatch.redispatch.previousProducerGeneration",
  );
  return deepFreeze({
    dispatchCount: 2 as const,
    producerGeneration: 1 as const,
    dispatchedAt,
    redispatch: {
      status,
      previousProducerGeneration: 0 as const,
      generationAdvance: await validateGenerationAdvance(
        redispatch.generationAdvance,
        runId,
      ),
      recoveryDestruction: validateDestruction(redispatch.recoveryDestruction, runId),
    },
  });
}

async function validateGenerationAdvance(value: unknown, runId: string) {
  try {
    return await validateIsolatedOutputProducerGenerationAdvance(value, runId);
  } catch {
    throw integrity("Producer generation advance differs from this CalculiX run.");
  }
}

function validateDestruction(value: unknown, runId: string) {
  const root = exactRecord(
    value,
    ["status", "runId", "proofFingerprint"],
    "$destruction",
  );
  literalValue(root.status, "proven", "$destruction.status");
  literalValue(root.runId, runId, "$destruction.runId");
  return deepFreeze({
    status: "proven" as const,
    runId,
    proofFingerprint: validateContentFingerprint(
      root.proofFingerprint,
      "$destruction.proofFingerprint",
    ),
  });
}

function validateRejection(value: unknown, runId: string) {
  const root = exactRecord(value, ["diagnostic", "destruction"], "$rejection");
  return deepFreeze({
    diagnostic: validateIsolatedCodeExecutionRejectionDiagnostic(
      root.diagnostic,
      "$rejection.diagnostic",
    ),
    destruction: validateDestruction(root.destruction, runId),
  });
}

function validateOutputValidationRejection(
  value: unknown,
  runId: string,
  identity: CalculixIsolatedExecutionAttemptIdentity,
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
    destruction: validateDestruction(root.destruction, runId),
  });
}

function assertRegisteredOutputRole(
  role: string,
  identity: CalculixIsolatedExecutionAttemptIdentity,
): void {
  if (!identity.profile.outputManifest.some((item) => item.role === role)) {
    throw integrity("Output-validation rejection role is not registered.");
  }
}

function validateExhaustion(value: unknown, runId: string) {
  const root = exactRecord(
    value,
    ["producerGeneration", "destruction"],
    "$exhaustion",
  );
  literalValue(root.producerGeneration, 1, "$exhaustion.producerGeneration");
  return deepFreeze({
    producerGeneration: 1 as const,
    destruction: validateDestruction(root.destruction, runId),
  });
}

function assertReceipt(
  receipt: Awaited<ReturnType<typeof validateIsolatedCodeExecutionReceiptRecord>>,
  identity: CalculixIsolatedExecutionAttemptIdentity,
  expectedProducerGeneration: 0 | 1,
) {
  if (
    receipt.runId !== identity.executionRunId ||
    receipt.producerGeneration !== expectedProducerGeneration ||
    receipt.publication.ref.producerGeneration !== expectedProducerGeneration ||
    receipt.sourceSha256 !== identity.bundleFingerprint.digest ||
    !isolatedCodeRefsEqual(receipt.profile, identity.profile.executionProfile) ||
    !isolatedCodeRefsEqual(receipt.policy, identity.profile.isolationPolicy) ||
    !runtimeAttestationsEqual(receipt.runtime, identity.profile.runtime) ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      identity.profile.outputManifest,
    ) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.termination.signal !== null ||
    receipt.destruction.status !== identity.profile.minimumDestructionAssurance
  ) throw integrity("Published receipt differs from the exact attempt.");
}

function assertEvidence(
  evidence: Awaited<ReturnType<typeof validateCalculixIsolatedExecutionEvidence>>,
  key: CalculixIsolatedExecutionAttemptKey,
  identity: CalculixIsolatedExecutionAttemptIdentity,
  receipt: Awaited<ReturnType<typeof validateIsolatedCodeExecutionReceiptRecord>>,
): void {
  if (
    evidence.projectId !== key.projectId ||
    evidence.agentRunId !== key.agentRunId ||
    evidence.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(evidence.bundleFingerprint, identity.bundleFingerprint) ||
    !fingerprintsEqual(evidence.proofFingerprint, identity.proofFingerprint) ||
    !fingerprintsEqual(
      evidence.executionProfileFingerprint,
      identity.profile.profileFingerprint,
    ) ||
    !fingerprintsEqual(
      evidence.authority.resolvedOperationPlanFingerprint,
      identity.resolvedOperationPlanFingerprint,
    ) ||
    deterministicJson(evidence.receipt) !== deterministicJson(receipt)
  ) throw integrity("Evidence differs from the exact attempt.");
}

function base(value: CalculixIsolatedExecutionAttempt) {
  return {
    schemaVersion: SCHEMA,
    projectId: value.projectId,
    agentRunId: value.agentRunId,
    executionRunId: value.executionRunId,
    attemptFingerprint: value.attemptFingerprint,
    identity: value.identity,
    preparedAt: value.preparedAt,
  };
}

function keyFromIdentity(
  identity: CalculixIsolatedExecutionAttemptIdentity,
  attemptFingerprint: ReturnType<typeof validateContentFingerprint>,
): CalculixIsolatedExecutionAttemptKey {
  return {
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    attemptFingerprint,
  };
}

function validateKey(
  value: CalculixIsolatedExecutionAttemptKey,
): CalculixIsolatedExecutionAttemptKey {
  return deepFreeze({
    projectId: safeId(value.projectId, "$key.projectId"),
    agentRunId: safeId(value.agentRunId, "$key.agentRunId"),
    executionRunId: safeId(value.executionRunId, "$key.executionRunId"),
    attemptFingerprint: validateContentFingerprint(
      value.attemptFingerprint,
      "$key.attemptFingerprint",
    ),
  });
}

function assertKey(
  attempt: CalculixIsolatedExecutionAttempt,
  value: CalculixIsolatedExecutionAttemptKey,
): void {
  const key = validateKey(value);
  if (
    attempt.projectId !== key.projectId || attempt.agentRunId !== key.agentRunId ||
    attempt.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(attempt.attemptFingerprint, key.attemptFingerprint)
  ) throw integrity("The isolated CalculiX attempt key diverges.");
}

function iso(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) throw new TypeError(`${path} must be canonical ISO.`);
  return value;
}

function boundedDirectory(value: string): string {
  if (!value || value !== value.trim() || value.includes("\0") || value === "/") {
    throw new TypeError("CalculiX attempt directory must be bounded.");
  }
  return value.replace(/\/+$/, "");
}

function integrity(message: string) {
  return new CalculixIsolatedExecutionAttemptIntegrityError(message);
}
