/** Durable monotone WAL for `design.execute-build123d@1`. */

import {
  type Build123dExecutionAttempt,
  type Build123dExecutionAttemptIdentity,
  type Build123dExecutionAttemptKey,
  type Build123dExecutionAttemptStore,
  type Build123dExecutionDispatch,
  type Build123dExecutionRedispatchConsumption,
  type Build123dExecutionThreadEvidence,
  fingerprintBuild123dExecutionAttemptIdentity,
} from "../../../application/ports/out/cad/isolated/build123d-execution-attempt-store.ts";
import {
  type Build123dExecutionDraftReference,
  buildBuild123dExecutionDraftReference,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
  validateBuild123dExecutionBasis,
  validateBuild123dExecutionDraftReference,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  validateBuild123dExecutionAdmission,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  type IsolatedOutputProducerGenerationAdvance,
  runtimeAttestationsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedOutputProducerGenerationAdvance,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { validateMicrosandboxLocalRuntimeIdentity } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  BUILD123D_EXECUTION_PROFILE_SCHEMA,
  type Build123dExecutionProfile,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
  type TechnicalCompilationDraftReference,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
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
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const BUILD123D_EXECUTION_ATTEMPT_SCHEMA =
  "build123d-execution-attempt/1.0" as const;

const NO_WRITE_PROGRESS = "Build123d execution attempt journal made no write progress.";

export class Build123dExecutionAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Build123dExecutionAttemptIntegrityError";
  }
}

export class FileBuild123dExecutionAttemptStore
  implements Build123dExecutionAttemptStore {
  readonly #directory: string;

  constructor(directory = "state/local/build123d-execution-attempts") {
    this.#directory = boundedDirectory(directory);
  }

  async read(
    projectIdValue: string,
    agentRunIdValue: string,
  ): Promise<Build123dExecutionAttempt | undefined> {
    const projectId = safeId(projectIdValue, "$projectId");
    const agentRunId = safeId(agentRunIdValue, "$agentRunId");
    let text: string;
    try {
      text = await Deno.readTextFile(await this.pathFor(projectId, agentRunId));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The Build123d execution journal is not JSON.");
    }
    const attempt = await validateBuild123dExecutionAttempt(
      parsed,
      projectId,
      agentRunId,
    );
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw integrity("The Build123d execution journal is not canonical.");
    }
    return attempt;
  }

  async prepare(
    identityValue: Build123dExecutionAttemptIdentity,
  ): Promise<Build123dExecutionAttempt> {
    const identity = await validateAttemptIdentity(identityValue);
    const attemptFingerprint = await fingerprintAttemptIdentity(identity);
    const fresh: Build123dExecutionAttempt = deepFreeze({
      schemaVersion: BUILD123D_EXECUTION_ATTEMPT_SCHEMA,
      ...attemptKey(identity, attemptFingerprint),
      identity,
      preparedAt: identity.run.startedAt,
      phase: "prepared",
    });
    return await this.#withLock(identity.projectId, identity.agentRunId, async () => {
      const existing = await this.read(identity.projectId, identity.agentRunId);
      if (existing) {
        assertSameIdentity(existing, identity, attemptFingerprint);
        return existing;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  async markDispatching(
    input: Build123dExecutionAttemptKey & { readonly dispatchedAt: string },
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, (current) => {
      const dispatchedAt = timestamp(input.dispatchedAt, "$dispatchedAt");
      if (current.phase !== "prepared") {
        if (
          "dispatch" in current && current.dispatch.dispatchCount === 1 &&
          current.dispatch.dispatchedAt === dispatchedAt
        ) return current;
        throw integrity("Build123d execution dispatch is out of order.");
      }
      if (dispatchedAt !== current.identity.run.startedAt) {
        throw integrity("Dispatch time must equal the durable run start time.");
      }
      return deepFreeze({
        ...baseOf(current),
        phase: "dispatching",
        dispatch: {
          dispatchCount: 1,
          producerGeneration: 0,
          dispatchedAt,
        },
      });
    });
  }

  async authorizeRedispatch(
    input: Build123dExecutionAttemptKey & {
      readonly recoveryDestruction: IsolatedCodeExecutionReceipt["destruction"];
      readonly generationAdvance: IsolatedOutputProducerGenerationAdvance;
    },
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, async (current) => {
      if (current.phase !== "dispatching") {
        throw integrity("Build123d redispatch is possible only while dispatching.");
      }
      const destruction = validateDestruction(
        input.recoveryDestruction,
        current.executionRunId,
      );
      if (destruction.status !== "proven") {
        throw integrity(
          "Build123d redispatch requires proven cleanup of producer generation zero.",
        );
      }
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
        throw integrity("Build123d redispatch recovery evidence is divergent.");
      }
      return deepFreeze({
        ...baseOf(current),
        phase: "dispatching",
        dispatch: {
          dispatchCount: 2,
          producerGeneration: 1,
          dispatchedAt: current.dispatch.dispatchedAt,
          redispatch: {
            status: "authorized",
            previousProducerGeneration: 0,
            generationAdvance,
            recoveryDestruction: destruction,
          },
        },
      });
    });
  }

  async consumeRedispatch(
    keyValue: Build123dExecutionAttemptKey,
  ): Promise<Build123dExecutionRedispatchConsumption> {
    const key = validateAttemptKey(keyValue);
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) throw integrity("Build123d execution journal is missing.");
      assertKey(current, key);
      if (
        current.phase !== "dispatching" ||
        current.dispatch.dispatchCount !== 2
      ) {
        throw integrity(
          "Build123d redispatch can be consumed only after exact authorization.",
        );
      }
      if (current.dispatch.redispatch.status === "consumed") {
        return deepFreeze({ outcome: "already-consumed", attempt: current });
      }
      const next: Build123dExecutionAttempt = deepFreeze({
        ...baseOf(current),
        phase: "dispatching",
        dispatch: {
          dispatchCount: 2,
          producerGeneration: 1,
          dispatchedAt: current.dispatch.dispatchedAt,
          redispatch: {
            status: "consumed",
            previousProducerGeneration: 0,
            generationAdvance: current.dispatch.redispatch.generationAdvance,
            recoveryDestruction: current.dispatch.redispatch.recoveryDestruction,
          },
        },
      });
      await this.#replace(next);
      return deepFreeze({ outcome: "consumed-now", attempt: next });
    });
  }

  async markOutputPublished(
    input: Build123dExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, async (current) => {
      if (current.phase !== "dispatching") {
        if (
          hasReceipt(current) &&
          deterministicJson(current.receiptRecord) ===
            deterministicJson(
              await validatePublishedReceipt(
                input.receiptRecord,
                current.identity,
                current.dispatch.producerGeneration,
              ),
            )
        ) return current;
        throw integrity("Output publication is out of order.");
      }
      const receiptRecord = await validatePublishedReceipt(
        input.receiptRecord,
        current.identity,
        current.dispatch.producerGeneration,
      );
      if (
        current.dispatch.dispatchCount === 2 &&
        current.dispatch.redispatch.status !== "consumed"
      ) {
        throw integrity(
          "Published output cannot follow an unconsumed redispatch authorization.",
        );
      }
      return deepFreeze({
        ...baseOf(current),
        phase: "output-published",
        dispatch: current.dispatch,
        receiptRecord,
      });
    });
  }

  async markDraftPersisted(
    input: Build123dExecutionAttemptKey & {
      readonly draftReference: Build123dExecutionDraftReference;
    },
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, async (current) => {
      const observedDraftReference = validateBuild123dExecutionDraftReference(
        input.draftReference,
      );
      if (current.phase !== "output-published") {
        if (
          hasDraft(current) &&
          deterministicJson(current.draftReference) ===
            deterministicJson(observedDraftReference)
        ) return current;
        throw integrity("Draft persistence is out of order.");
      }
      const draftReference = await validateExactDraftReference(
        observedDraftReference,
        current.identity,
        current.receiptRecord,
      );
      return deepFreeze({
        ...baseOf(current),
        phase: "draft-persisted",
        dispatch: current.dispatch,
        receiptRecord: current.receiptRecord,
        draftReference,
      });
    });
  }

  async markThreadPersisted(
    input: Build123dExecutionAttemptKey & {
      readonly threadEvidence: Build123dExecutionThreadEvidence;
    },
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, (current) => {
      const threadEvidence = validateThreadEvidence(input.threadEvidence);
      if (current.phase !== "draft-persisted") {
        if (
          hasThread(current) && deterministicJson(current.threadEvidence) ===
            deterministicJson(threadEvidence)
        ) return current;
        throw integrity("Thread persistence is out of order.");
      }
      return deepFreeze({
        ...baseOf(current),
        phase: "thread-persisted",
        dispatch: current.dispatch,
        receiptRecord: current.receiptRecord,
        draftReference: current.draftReference,
        threadEvidence,
      });
    });
  }

  async markCompleted(
    input: Build123dExecutionAttemptKey,
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, (current) => {
      if (current.phase === "completed") return current;
      if (current.phase !== "thread-persisted") {
        throw integrity("Build123d execution completion is out of order.");
      }
      return deepFreeze({ ...current, phase: "completed" });
    });
  }

  async markOutputValidationRejected(
    input: Build123dExecutionAttemptKey & {
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
  ): Promise<Build123dExecutionAttempt> {
    return await this.#transition(input, (current) => {
      const observation = validateIsolatedCodeOutputValidationRejection(
        input.observation,
      );
      assertRegisteredOutputRole(observation.role, current.identity);
      const destruction = validateDestruction(
        input.destruction,
        current.executionRunId,
      );
      if (destruction.status !== "proven") {
        throw integrity(
          "Build123d output-validation rejection requires proven cleanup.",
        );
      }
      const outputValidationRejection = deepFreeze({ observation, destruction });
      if (current.phase === "output-validation-rejected") {
        if (
          deterministicJson(current.outputValidationRejection) ===
            deterministicJson(outputValidationRejection)
        ) return current;
        throw integrity(
          "Build123d output-validation rejection evidence diverges.",
        );
      }
      if (current.phase !== "dispatching") {
        throw integrity("Build123d output-validation rejection is out of order.");
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
        ...baseOf(current),
        phase: "output-validation-rejected" as const,
        dispatch: current.dispatch,
        outputValidationRejection,
      });
    });
  }

  async pathFor(projectIdValue: string, agentRunIdValue: string): Promise<string> {
    const projectId = safeId(projectIdValue, "$projectId");
    const agentRunId = safeId(agentRunIdValue, "$agentRunId");
    const key = await sha256Fingerprint({ projectId, agentRunId });
    return `${this.#directory}/run-${key.digest}.json`;
  }

  async #transition(
    keyValue: Build123dExecutionAttemptKey,
    transition: (
      current: Build123dExecutionAttempt,
    ) => Build123dExecutionAttempt | Promise<Build123dExecutionAttempt>,
  ): Promise<Build123dExecutionAttempt> {
    const key = validateAttemptKey({
      projectId: keyValue.projectId,
      agentRunId: keyValue.agentRunId,
      executionRunId: keyValue.executionRunId,
      attemptFingerprint: keyValue.attemptFingerprint,
    });
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) throw integrity("Build123d execution journal is missing.");
      assertKey(current, key);
      const next = await transition(current);
      if (next === current) return current;
      await this.#replace(next);
      return next;
    });
  }

  async #writeNew(attempt: Build123dExecutionAttempt): Promise<void> {
    await this.#ensurePrivateDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await writeNewAttemptFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_WRITE_PROGRESS,
    );
    await Deno.chmod(path, 0o600);
    await this.#assertReread(attempt);
  }

  async #replace(attempt: Build123dExecutionAttempt): Promise<void> {
    await this.#ensurePrivateDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await replaceAttemptFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_WRITE_PROGRESS,
    );
    await Deno.chmod(path, 0o600);
    await this.#assertReread(attempt);
  }

  async #assertReread(expected: Build123dExecutionAttempt): Promise<void> {
    const reread = await this.read(expected.projectId, expected.agentRunId);
    if (!reread || deterministicJson(reread) !== deterministicJson(expected)) {
      throw integrity("Build123d execution journal failed durable reread.");
    }
  }

  async #ensurePrivateDirectory(): Promise<void> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.#directory, 0o700);
  }

  async #withLock<Result>(
    projectId: string,
    agentRunId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    await this.#ensurePrivateDirectory();
    const path = `${await this.pathFor(projectId, agentRunId)}.lock`;
    const file = await Deno.open(path, { create: true, read: true, write: true });
    await Deno.chmod(path, 0o600);
    try {
      await file.lock(true);
      return await operation();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }
}

export async function validateBuild123dExecutionAttempt(
  value: unknown,
  expectedProjectId?: string,
  expectedAgentRunId?: string,
): Promise<Build123dExecutionAttempt> {
  const phase = phaseOf(value);
  const root = exactRecord(value, keysForPhase(phase), "$attempt");
  literalValue(
    root.schemaVersion,
    BUILD123D_EXECUTION_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const identity = await validateAttemptIdentity(root.identity);
  const attemptFingerprint = validateContentFingerprint(
    root.attemptFingerprint,
    "$attempt.attemptFingerprint",
  );
  const expectedFingerprint = await fingerprintAttemptIdentity(identity);
  if (!fingerprintsEqual(attemptFingerprint, expectedFingerprint)) {
    throw integrity("Attempt fingerprint does not match its exact identity.");
  }
  const projectId = safeId(root.projectId, "$attempt.projectId");
  const agentRunId = safeId(root.agentRunId, "$attempt.agentRunId");
  const executionRunId = safeId(root.executionRunId, "$attempt.executionRunId");
  if (
    projectId !== identity.projectId || agentRunId !== identity.agentRunId ||
    executionRunId !== identity.executionRunId ||
    (expectedProjectId !== undefined && projectId !== expectedProjectId) ||
    (expectedAgentRunId !== undefined && agentRunId !== expectedAgentRunId)
  ) throw integrity("Attempt root identity is divergent.");
  const base = {
    schemaVersion: BUILD123D_EXECUTION_ATTEMPT_SCHEMA,
    projectId,
    agentRunId,
    executionRunId,
    attemptFingerprint,
    identity,
    preparedAt: timestamp(root.preparedAt, "$attempt.preparedAt"),
  } as const;
  if (base.preparedAt !== identity.run.startedAt) {
    throw integrity("Prepared time must equal the exact run start time.");
  }
  if (phase === "prepared") return deepFreeze({ ...base, phase });
  const dispatch = await validateDispatch(root.dispatch, executionRunId);
  if (phase === "dispatching") return deepFreeze({ ...base, phase, dispatch });
  if (phase === "output-validation-rejected") {
    return deepFreeze({
      ...base,
      phase,
      dispatch,
      outputValidationRejection: validateOutputValidationRejection(
        root.outputValidationRejection,
        executionRunId,
        identity,
      ),
    });
  }
  if (
    dispatch.dispatchCount === 2 &&
    dispatch.redispatch.status !== "consumed"
  ) {
    throw integrity(
      "Published Build123d output requires a consumed redispatch authorization.",
    );
  }
  const receiptRecord = await validatePublishedReceipt(
    root.receiptRecord,
    identity,
    dispatch.producerGeneration,
  );
  if (phase === "output-published") {
    return deepFreeze({ ...base, phase, dispatch, receiptRecord });
  }
  const draftReference = await validateExactDraftReference(
    root.draftReference,
    identity,
    receiptRecord,
  );
  if (phase === "draft-persisted") {
    return deepFreeze({ ...base, phase, dispatch, receiptRecord, draftReference });
  }
  const threadEvidence = validateThreadEvidence(root.threadEvidence);
  return deepFreeze({
    ...base,
    phase,
    dispatch,
    receiptRecord,
    draftReference,
    threadEvidence,
  });
}

async function validatePublishedReceipt(
  value: unknown,
  identity: Build123dExecutionAttemptIdentity,
  expectedProducerGeneration: 0 | 1,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const receiptRecord = await validateIsolatedCodeExecutionReceiptRecord(value);
  if (
    receiptRecord.producerGeneration !== expectedProducerGeneration ||
    receiptRecord.publication.ref.producerGeneration !== expectedProducerGeneration
  ) {
    throw integrity(
      "Published output receipt names another producer generation.",
    );
  }
  try {
    // Reuse the closed evidence boundary so a WAL entry cannot advance with a
    // structurally valid receipt from another profile, policy, runtime, source,
    // output publication, or destruction-assurance decision.
    await createBuild123dExecutionDraft({
      projectId: identity.projectId,
      basis: identity.basis,
      agentRunId: identity.agentRunId,
      executionRunId: identity.executionRunId,
      decisionId: identity.decision.id,
      executedAt: identity.run.startedAt,
      admission: identity.admission,
      receiptRecord,
    });
  } catch {
    throw integrity(
      "Published output receipt does not match the exact attempt identity.",
    );
  }
  return receiptRecord;
}

async function validateExactDraftReference(
  value: unknown,
  identity: Build123dExecutionAttemptIdentity,
  receiptRecord: IsolatedCodeExecutionReceiptRecord,
): Promise<Build123dExecutionDraftReference> {
  const observed = validateBuild123dExecutionDraftReference(value);
  try {
    const expectedDraft = await createBuild123dExecutionDraft({
      projectId: identity.projectId,
      basis: identity.basis,
      agentRunId: identity.agentRunId,
      executionRunId: identity.executionRunId,
      decisionId: identity.decision.id,
      executedAt: identity.run.startedAt,
      admission: identity.admission,
      receiptRecord,
    });
    const expected = await buildBuild123dExecutionDraftReference(expectedDraft);
    if (deterministicJson(observed) !== deterministicJson(expected)) {
      throw new TypeError("draft reference drift");
    }
    return observed;
  } catch {
    throw integrity(
      "Draft reference does not derive from the exact durable execution receipt.",
    );
  }
}

async function validateAttemptIdentity(
  value: unknown,
): Promise<Build123dExecutionAttemptIdentity> {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "basis",
    "run",
    "decision",
    "approval",
    "admission",
    "technicalAdmission",
    "executionProfile",
    "isolatedRequest",
    "document",
    "projection",
    "source",
    "profile",
    "output",
  ], "$identity");
  const projectId = safeId(root.projectId, "$identity.projectId");
  const agentRunId = safeId(root.agentRunId, "$identity.agentRunId");
  const executionRunId = safeId(
    root.executionRunId,
    "$identity.executionRunId",
  );
  if (
    executionRunId !== await deriveBuild123dExecutionRunId(projectId, agentRunId)
  ) throw integrity("Execution run id is not server-derived.");
  const basis = validateBuild123dExecutionBasis(root.basis, "$identity.basis");
  const run = validateRun(root.run);
  const decision = validateDecision(root.decision);
  const approval = validateApproval(root.approval);
  const admission = validateBuild123dExecutionAdmission(root.admission);
  const technicalAdmission = validateTechnicalAdmission(
    root.technicalAdmission,
    projectId,
    admission,
  );
  const executionProfile = await validateExecutionProfile(
    root.executionProfile,
    admission,
  );
  const isolatedRequest = validateIsolatedRequest(
    root.isolatedRequest,
    executionRunId,
    admission,
    executionProfile,
  );
  const document = validateBuild123dExecutionAdmission({
    ...admission,
    compilation: { ...admission.compilation, document: root.document },
  }).compilation.document;
  const projection = validateBuild123dExecutionAdmission({
    ...admission,
    compilation: { ...admission.compilation, projection: root.projection },
  }).compilation.projection;
  const source = validateBuild123dExecutionAdmission({
    ...admission,
    compilation: { ...admission.compilation, source: root.source },
  }).compilation.source;
  const profile = validateBuild123dExecutionAdmission({
    ...admission,
    execution: {
      ...admission.execution,
      profile: root.profile as typeof admission.execution.profile,
    },
  }).execution.profile;
  const outputRecord = exactRecord(
    root.output,
    ["role", "basename", "mediaType", "format"],
    "$identity.output",
  );
  for (
    const key of Object.keys(BUILD123D_EXECUTION_OUTPUT) as Array<
      keyof typeof BUILD123D_EXECUTION_OUTPUT
    >
  ) {
    literalValue(
      outputRecord[key],
      BUILD123D_EXECUTION_OUTPUT[key],
      `$identity.output.${key}`,
    );
  }
  if (
    deterministicJson(document) !== deterministicJson(admission.compilation.document) ||
    deterministicJson(projection) !==
      deterministicJson(admission.compilation.projection) ||
    deterministicJson(source) !== deterministicJson(admission.compilation.source) ||
    deterministicJson(profile) !== deterministicJson(admission.execution.profile) ||
    deterministicJson(root.output) !== deterministicJson(admission.execution.output) ||
    !fingerprintsEqual(decision.inputFingerprint, approval.inputFingerprint)
  ) throw integrity("Attempt identity redundancies do not match the admission/MRTR.");
  return deepFreeze({
    projectId,
    agentRunId,
    executionRunId,
    basis,
    run,
    decision,
    approval,
    admission,
    technicalAdmission,
    executionProfile,
    isolatedRequest,
    document,
    projection,
    source,
    profile,
    output: BUILD123D_EXECUTION_OUTPUT,
  });
}

async function fingerprintAttemptIdentity(
  identity: Build123dExecutionAttemptIdentity,
): Promise<ContentFingerprint> {
  return await fingerprintBuild123dExecutionAttemptIdentity(identity);
}

function attemptKey(
  identity: Build123dExecutionAttemptIdentity,
  attemptFingerprint: ContentFingerprint,
): Build123dExecutionAttemptKey {
  return {
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    attemptFingerprint,
  };
}

function validateAttemptKey(value: unknown): Build123dExecutionAttemptKey {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
  ], "$attemptKey");
  return deepFreeze({
    projectId: safeId(root.projectId, "$attemptKey.projectId"),
    agentRunId: safeId(root.agentRunId, "$attemptKey.agentRunId"),
    executionRunId: safeId(root.executionRunId, "$attemptKey.executionRunId"),
    attemptFingerprint: validateContentFingerprint(
      root.attemptFingerprint,
      "$attemptKey.attemptFingerprint",
    ),
  });
}

function validateRun(value: unknown) {
  const run = exactRecord(
    value,
    ["workItemId", "inputFingerprint", "startedAt"],
    "$identity.run",
  );
  return deepFreeze({
    workItemId: safeId(run.workItemId, "$identity.run.workItemId"),
    inputFingerprint: validateContentFingerprint(
      run.inputFingerprint,
      "$identity.run.inputFingerprint",
    ),
    startedAt: timestamp(run.startedAt, "$identity.run.startedAt"),
  });
}

function validateDecision(value: unknown) {
  const decision = exactRecord(
    value,
    ["id", "inputFingerprint"],
    "$identity.decision",
  );
  return deepFreeze({
    id: safeId(decision.id, "$identity.decision.id"),
    inputFingerprint: validateContentFingerprint(
      decision.inputFingerprint,
      "$identity.decision.inputFingerprint",
    ),
  });
}

function validateApproval(value: unknown) {
  const approval = exactRecord(
    value,
    ["id", "inputFingerprint", "fingerprint"],
    "$identity.approval",
  );
  return deepFreeze({
    id: safeId(approval.id, "$identity.approval.id"),
    inputFingerprint: validateContentFingerprint(
      approval.inputFingerprint,
      "$identity.approval.inputFingerprint",
    ),
    fingerprint: validateContentFingerprint(
      approval.fingerprint,
      "$identity.approval.fingerprint",
    ),
  });
}

function validateTechnicalAdmission(
  value: unknown,
  projectId: string,
  admission: ReturnType<typeof validateBuild123dExecutionAdmission>,
) {
  const root = exactRecord(value, [
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "draftReference",
    "documentFingerprint",
    "projectionFingerprint",
    "sourceFingerprint",
  ], "$identity.technicalAdmission");
  const draftReference = validateTechnicalCompilationDraftReference(
    root.draftReference,
    projectId,
  );
  const documentFingerprint = validateContentFingerprint(
    root.documentFingerprint,
    "$identity.technicalAdmission.documentFingerprint",
  );
  const projectionFingerprint = validateContentFingerprint(
    root.projectionFingerprint,
    "$identity.technicalAdmission.projectionFingerprint",
  );
  const sourceFingerprint = validateContentFingerprint(
    root.sourceFingerprint,
    "$identity.technicalAdmission.sourceFingerprint",
  );
  if (
    !fingerprintsEqual(
      documentFingerprint,
      admission.compilation.document.fingerprint,
    ) ||
    !fingerprintsEqual(
      projectionFingerprint,
      admission.compilation.projection.fingerprint,
    ) ||
    !fingerprintsEqual(
      sourceFingerprint,
      admission.compilation.source.sourceFingerprint,
    )
  ) throw integrity("Technical admission hashes do not match the MRTR admission.");
  return deepFreeze({
    trustedRunId: safeId(
      root.trustedRunId,
      "$identity.technicalAdmission.trustedRunId",
    ),
    decisionId: safeId(
      root.decisionId,
      "$identity.technicalAdmission.decisionId",
    ),
    sealedAt: timestamp(root.sealedAt, "$identity.technicalAdmission.sealedAt"),
    draftReference,
    documentFingerprint,
    projectionFingerprint,
    sourceFingerprint,
  });
}

async function validateExecutionProfile(
  value: unknown,
  admission: ReturnType<typeof validateBuild123dExecutionAdmission>,
): Promise<Build123dExecutionProfile> {
  const root = exactRecord(value, [
    "schemaVersion",
    "executionProfile",
    "compilationTarget",
    "compilationProfile",
    "compilationProfileFingerprint",
    "isolationPolicy",
    "runtimeBackend",
    "runtime",
    "outputManifest",
    "outputValidator",
    "maximumSourceBytes",
    "minimumDestructionAssurance",
    "profileFingerprint",
  ], "$identity.executionProfile");
  literalValue(
    root.schemaVersion,
    BUILD123D_EXECUTION_PROFILE_SCHEMA,
    "$identity.executionProfile.schemaVersion",
  );
  const profile = deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile: root.executionProfile,
    compilationTarget: root.compilationTarget,
    compilationProfile: root.compilationProfile,
    compilationProfileFingerprint: root.compilationProfileFingerprint,
    isolationPolicy: root.isolationPolicy,
    runtimeBackend: validateMicrosandboxLocalRuntimeIdentity(
      root.runtimeBackend,
      "$identity.executionProfile.runtimeBackend",
    ),
    runtime: root.runtime,
    outputManifest: root.outputManifest,
    outputValidator: root.outputValidator,
    maximumSourceBytes: root.maximumSourceBytes,
    minimumDestructionAssurance: root.minimumDestructionAssurance,
    profileFingerprint: root.profileFingerprint,
  }) as unknown as Build123dExecutionProfile;
  const observed = await sha256Fingerprint({
    schemaVersion: profile.schemaVersion,
    executionProfile: profile.executionProfile,
    compilationTarget: profile.compilationTarget,
    compilationProfile: profile.compilationProfile,
    compilationProfileFingerprint: profile.compilationProfileFingerprint,
    isolationPolicy: profile.isolationPolicy,
    runtimeBackend: profile.runtimeBackend,
    runtime: profile.runtime,
    outputManifest: profile.outputManifest,
    outputValidator: profile.outputValidator,
    maximumSourceBytes: profile.maximumSourceBytes,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
  });
  const profileFingerprint = validateContentFingerprint(
    profile.profileFingerprint,
    "$identity.executionProfile.profileFingerprint",
  );
  const checks = {
    body: fingerprintsEqual(observed, profileFingerprint),
    admissionFingerprint: fingerprintsEqual(
      profileFingerprint,
      admission.execution.profile.fingerprint,
    ),
    executionProfile: profile.executionProfile.id ===
        admission.execution.profile.id &&
      profile.executionProfile.version === admission.execution.profile.version,
    isolationPolicy: isolatedCodeRefsEqual(
      profile.isolationPolicy,
      admission.execution.isolationPolicy,
    ),
    runtimeBackend: deterministicJson(profile.runtimeBackend) ===
      deterministicJson(admission.execution.runtimeBackend),
    runtime: runtimeAttestationsEqual(profile.runtime, {
      isolationClass: admission.execution.runtime.isolationClass,
      imageDigest: admission.execution.runtime.imageDigest,
      requestedLimits: admission.execution.runtime.limits,
      limitAssurance: admission.execution.runtime.limitAssurance,
    }),
    outputManifest: isolatedCodeOutputManifestsEqual(profile.outputManifest, [
      admission.execution.output,
    ]),
    outputValidator: deterministicJson(profile.outputValidator) ===
      deterministicJson(admission.execution.outputValidator),
    destruction: profile.minimumDestructionAssurance ===
      admission.execution.minimumDestructionAssurance,
  };
  if (
    Object.values(checks).some((value) => !value)
  ) {
    throw integrity(
      `Execution profile does not match its complete MRTR admission: ${
        Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key).join(",")
      }.`,
    );
  }
  return profile;
}

function validateIsolatedRequest(
  value: unknown,
  executionRunId: string,
  admission: ReturnType<typeof validateBuild123dExecutionAdmission>,
  profile: Build123dExecutionProfile,
) {
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
  const request = deepFreeze({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: safeId(root.runId, "$identity.isolatedRequest.runId"),
    producerGeneration: 0 as const,
    profile: profile.executionProfile,
    sourceSha256: nonEmptyText(
      root.sourceSha256,
      "$identity.isolatedRequest.sourceSha256",
    ),
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
  });
  if (
    request.runId !== executionRunId ||
    request.sourceSha256 !== admission.compilation.source.sourceFingerprint.digest ||
    deterministicJson(root.profile) !== deterministicJson(request.profile) ||
    deterministicJson(root.policy) !== deterministicJson(request.policy) ||
    deterministicJson(root.outputs) !== deterministicJson(request.outputs)
  ) throw integrity("Isolated request does not match the exact execution profile.");
  return request;
}

function validateTechnicalCompilationDraftReference(
  value: unknown,
  projectId: string,
): TechnicalCompilationDraftReference {
  const root = exactRecord(value, [
    "schemaVersion",
    "draftId",
    "projectId",
    "documentFingerprint",
    "envelopeFingerprint",
  ], "$identity.technicalAdmission.draftReference");
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    "$identity.technicalAdmission.draftReference.schemaVersion",
  );
  const observedProjectId = safeId(
    root.projectId,
    "$identity.technicalAdmission.draftReference.projectId",
  );
  if (observedProjectId !== projectId) {
    throw integrity("Technical admission draft belongs to another project.");
  }
  const documentFingerprint = validateContentFingerprint(
    root.documentFingerprint,
    "$identity.technicalAdmission.draftReference.documentFingerprint",
  );
  // Derived as technical-compilation:${projectId}:${digest}; that string
  // exceeds the standalone 256-char safeId bound at a legal project id.
  const draftId = nonEmptyText(
    root.draftId,
    "$identity.technicalAdmission.draftReference.draftId",
  );
  if (
    draftId !==
      `technical-compilation:${projectId}:${documentFingerprint.digest}`
  ) {
    throw integrity(
      "Technical compilation draft id does not match its project and document fingerprint.",
    );
  }
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId,
    projectId,
    documentFingerprint,
    envelopeFingerprint: validateContentFingerprint(
      root.envelopeFingerprint,
      "$identity.technicalAdmission.draftReference.envelopeFingerprint",
    ),
  });
}

async function validateDispatch(
  value: unknown,
  runId: string,
): Promise<Build123dExecutionDispatch> {
  const keys = value && typeof value === "object" &&
      Object.hasOwn(value, "redispatch")
    ? ["dispatchCount", "producerGeneration", "dispatchedAt", "redispatch"]
    : ["dispatchCount", "producerGeneration", "dispatchedAt"];
  const dispatch = exactRecord(value, keys, "$attempt.dispatch");
  const dispatchCount = positiveInteger(
    dispatch.dispatchCount,
    "$attempt.dispatch.dispatchCount",
  );
  if (dispatchCount !== 1 && dispatchCount !== 2) {
    throw integrity("Dispatch count must be 1 or 2.");
  }
  if (dispatchCount === 1 && Object.hasOwn(dispatch, "redispatch")) {
    throw integrity("A first dispatch cannot have redispatch evidence.");
  }
  if (dispatchCount === 2 && !Object.hasOwn(dispatch, "redispatch")) {
    throw integrity("A second dispatch requires exact redispatch state.");
  }
  const dispatchedAt = timestamp(
    dispatch.dispatchedAt,
    "$attempt.dispatch.dispatchedAt",
  );
  if (dispatchCount === 1) {
    literalValue(
      dispatch.producerGeneration,
      0,
      "$attempt.dispatch.producerGeneration",
    );
    return deepFreeze({
      dispatchCount: 1,
      producerGeneration: 0,
      dispatchedAt,
    });
  }
  literalValue(
    dispatch.producerGeneration,
    1,
    "$attempt.dispatch.producerGeneration",
  );
  return deepFreeze({
    dispatchCount: 2,
    producerGeneration: 1,
    dispatchedAt,
    redispatch: await validateRedispatch(dispatch.redispatch, runId),
  });
}

async function validateRedispatch(
  value: unknown,
  runId: string,
): Promise<
  Extract<Build123dExecutionDispatch, { dispatchCount: 2 }>["redispatch"]
> {
  const redispatch = exactRecord(
    value,
    [
      "status",
      "previousProducerGeneration",
      "generationAdvance",
      "recoveryDestruction",
    ],
    "$attempt.dispatch.redispatch",
  );
  if (redispatch.status !== "authorized" && redispatch.status !== "consumed") {
    throw integrity("Redispatch status must be authorized or consumed.");
  }
  literalValue(
    redispatch.previousProducerGeneration,
    0,
    "$attempt.dispatch.redispatch.previousProducerGeneration",
  );
  const recoveryDestruction = validateDestruction(
    redispatch.recoveryDestruction,
    runId,
  );
  if (recoveryDestruction.status !== "proven") {
    throw integrity(
      "Build123d redispatch requires proven cleanup of producer generation zero.",
    );
  }
  return deepFreeze({
    status: redispatch.status,
    previousProducerGeneration: 0 as const,
    generationAdvance: await validateGenerationAdvance(
      redispatch.generationAdvance,
      runId,
    ),
    recoveryDestruction,
  });
}

async function validateGenerationAdvance(
  value: unknown,
  runId: string,
): Promise<IsolatedOutputProducerGenerationAdvance> {
  try {
    return await validateIsolatedOutputProducerGenerationAdvance(value, runId);
  } catch {
    throw integrity(
      "Producer generation advance does not match this execution run.",
    );
  }
}

function validateOutputValidationRejection(
  value: unknown,
  runId: string,
  identity: Build123dExecutionAttemptIdentity,
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
  const destruction = validateDestruction(root.destruction, runId);
  if (destruction.status !== "proven") {
    throw integrity(
      "Build123d output-validation rejection requires proven cleanup.",
    );
  }
  return deepFreeze({ observation, destruction });
}

function assertRegisteredOutputRole(
  role: string,
  identity: Build123dExecutionAttemptIdentity,
): void {
  if (!identity.isolatedRequest.outputs.some((item) => item.role === role)) {
    throw integrity("Output-validation rejection role is not registered.");
  }
}

function validateDestruction(value: unknown, runId: string) {
  const root = value && typeof value === "object" &&
      (value as { status?: unknown }).status === "proven"
    ? exactRecord(value, ["status", "runId", "proofFingerprint"], "$destruction")
    : exactRecord(
      value,
      ["status", "runId", "acknowledgementFingerprint"],
      "$destruction",
    );
  const observedRunId = safeId(root.runId, "$destruction.runId");
  if (observedRunId !== runId) throw integrity("Destruction names another run.");
  if (root.status === "proven") {
    return deepFreeze({
      status: "proven" as const,
      runId,
      proofFingerprint: validateContentFingerprint(
        root.proofFingerprint,
        "$destruction.proofFingerprint",
      ),
    });
  }
  literalValue(
    root.status,
    "acknowledged-unattested",
    "$destruction.status",
  );
  return deepFreeze({
    status: "acknowledged-unattested" as const,
    runId,
    acknowledgementFingerprint: validateContentFingerprint(
      root.acknowledgementFingerprint,
      "$destruction.acknowledgementFingerprint",
    ),
  });
}

function validateThreadEvidence(value: unknown): Build123dExecutionThreadEvidence {
  const root = exactRecord(value, [
    "snapshotId",
    "revision",
    "subjectId",
    "artifactId",
    "artifactFingerprint",
  ], "$threadEvidence");
  return deepFreeze({
    snapshotId: safeId(root.snapshotId, "$threadEvidence.snapshotId"),
    revision: positiveInteger(root.revision, "$threadEvidence.revision"),
    subjectId: safeId(root.subjectId, "$threadEvidence.subjectId"),
    artifactId: safeId(root.artifactId, "$threadEvidence.artifactId"),
    artifactFingerprint: validateContentFingerprint(
      root.artifactFingerprint,
      "$threadEvidence.artifactFingerprint",
    ),
  });
}

function baseOf(attempt: Build123dExecutionAttempt) {
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

function assertSameIdentity(
  attempt: Build123dExecutionAttempt,
  identity: Build123dExecutionAttemptIdentity,
  fingerprint: ContentFingerprint,
): void {
  if (
    deterministicJson(attempt.identity) !== deterministicJson(identity) ||
    !fingerprintsEqual(attempt.attemptFingerprint, fingerprint)
  ) throw integrity("Build123d execution run already has a divergent identity.");
}

function assertKey(
  attempt: Build123dExecutionAttempt,
  key: Build123dExecutionAttemptKey,
): void {
  if (
    attempt.projectId !== key.projectId ||
    attempt.agentRunId !== key.agentRunId ||
    attempt.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(attempt.attemptFingerprint, key.attemptFingerprint)
  ) throw integrity("Build123d execution transition key is divergent.");
}

function hasReceipt(
  attempt: Build123dExecutionAttempt,
): attempt is Extract<Build123dExecutionAttempt, { receiptRecord: unknown }> {
  return "receiptRecord" in attempt;
}

function hasDraft(
  attempt: Build123dExecutionAttempt,
): attempt is Extract<Build123dExecutionAttempt, { draftReference: unknown }> {
  return "draftReference" in attempt;
}

function hasThread(
  attempt: Build123dExecutionAttempt,
): attempt is Extract<Build123dExecutionAttempt, { threadEvidence: unknown }> {
  return "threadEvidence" in attempt;
}

function phaseOf(value: unknown): Build123dExecutionAttempt["phase"] {
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
    root.phase !== "prepared" && root.phase !== "dispatching" &&
    root.phase !== "output-published" && root.phase !== "draft-persisted" &&
    root.phase !== "thread-persisted" && root.phase !== "completed" &&
    root.phase !== "output-validation-rejected"
  ) throw integrity("Build123d execution journal phase is unsupported.");
  return root.phase;
}

function optionalAttemptFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [
    "dispatch",
    "receiptRecord",
    "draftReference",
    "threadEvidence",
    "outputValidationRejection",
  ].filter(
    (key) => Object.hasOwn(value, key),
  );
}

function keysForPhase(phase: Build123dExecutionAttempt["phase"]): string[] {
  const base = [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
    "identity",
    "preparedAt",
    "phase",
  ];
  if (phase === "prepared") return base;
  base.push("dispatch");
  if (phase === "dispatching") return base;
  if (phase === "output-validation-rejected") {
    base.push("outputValidationRejection");
    return base;
  }
  base.push("receiptRecord");
  if (phase === "output-published") return base;
  base.push("draftReference");
  if (phase === "draft-persisted") return base;
  base.push("threadEvidence");
  return base;
}

function timestamp(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const epoch = Date.parse(text);
  if (Number.isNaN(epoch) || new Date(epoch).toISOString() !== text) {
    throw new TypeError(`${path} must be a canonical ISO-8601 timestamp.`);
  }
  return text;
}

function boundedDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) throw new TypeError("Build123d WAL directory must be a bounded path.");
  return value.replace(/\/+$/, "");
}

function integrity(message: string): Build123dExecutionAttemptIntegrityError {
  return new Build123dExecutionAttemptIntegrityError(message);
}
