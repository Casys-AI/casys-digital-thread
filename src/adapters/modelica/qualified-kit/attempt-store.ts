/** Durable monotone WAL for locally isolated Modelica execution. */

import {
  fingerprintModelicaIsolatedAttemptIdentity,
  type ModelicaIsolatedBundleDescriptor,
  type ModelicaIsolatedExecutionAttempt,
  type ModelicaIsolatedExecutionAttemptIdentity,
  type ModelicaIsolatedExecutionAttemptKey,
  type ModelicaIsolatedExecutionAttemptStore,
  type ModelicaIsolatedExecutionCaptureReference,
  type ModelicaIsolatedExecutionDispatch,
  type ModelicaIsolatedExecutionGenerationRecovery,
  type ModelicaIsolatedProvenDestruction,
} from "../../../application/ports/out/modelica/isolated-execution-attempt-store.ts";
import { validateModelicaIsolatedExecutionProfile } from "./execution-profile.ts";
import {
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
import {
  MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
  MODELICA_LOCAL_QUALIFIED_KIT,
  type ModelicaIsolatedInputBundle,
  type ModelicaIsolatedInputRole,
  validateModelicaIsolatedEvidence,
} from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  compareAsciiCodeUnits,
  sha256Hex,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  validateModelicaMicrosandboxQualificationReference,
} from "../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const MODELICA_ISOLATED_EXECUTION_ATTEMPT_SCHEMA =
  "modelica-qualified-kit-execution-attempt/1.0" as const;

const NO_PROGRESS = "Modelica isolated execution WAL made no write progress.";

export class ModelicaIsolatedExecutionAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaIsolatedExecutionAttemptIntegrityError";
  }
}

export class FileModelicaIsolatedExecutionAttemptStore
  implements ModelicaIsolatedExecutionAttemptStore {
  readonly #directory: string;

  constructor(directory = "state/local/modelica-qualified-kit-execution-attempts") {
    this.#directory = boundedDirectory(directory);
  }

  async read(
    projectIdValue: string,
    agentRunIdValue: string,
  ): Promise<ModelicaIsolatedExecutionAttempt | undefined> {
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
      throw integrity("The Modelica isolated execution WAL is not JSON.");
    }
    const attempt = await validateModelicaIsolatedExecutionAttempt(
      parsed,
      projectId,
      agentRunId,
    );
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw integrity("The Modelica isolated execution WAL is not canonical.");
    }
    return attempt;
  }

  async prepare(
    identityValue: ModelicaIsolatedExecutionAttemptIdentity,
    preparedAtValue: string,
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    const identity = await validateIdentity(identityValue);
    const preparedAt = timestamp(preparedAtValue, "$preparedAt");
    const attemptFingerprint = await fingerprintModelicaIsolatedAttemptIdentity(
      identity,
    );
    const fresh: ModelicaIsolatedExecutionAttempt = deepFreeze({
      schemaVersion: MODELICA_ISOLATED_EXECUTION_ATTEMPT_SCHEMA,
      ...keyFor(identity, attemptFingerprint),
      identity,
      preparedAt,
      phase: "prepared",
    });
    return await this.#withLock(identity.projectId, identity.agentRunId, async () => {
      const current = await this.read(identity.projectId, identity.agentRunId);
      if (current) {
        assertKey(current, keyFor(identity, attemptFingerprint));
        if (deterministicJson(current.identity) !== deterministicJson(identity)) {
          throw integrity("The Modelica execution identity conflicts with its WAL.");
        }
        return current;
      }
      await this.#writeNew(fresh);
      return fresh;
    });
  }

  markDispatching(
    input: ModelicaIsolatedExecutionAttemptKey & { readonly dispatchedAt: string },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    return this.#transition(input, (current) => {
      const dispatchedAt = timestamp(input.dispatchedAt, "$dispatchedAt");
      if (current.phase !== "prepared") {
        if ("dispatch" in current && current.dispatch.dispatchedAt === dispatchedAt) {
          return current;
        }
        throw integrity("Modelica dispatch is out of order.");
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
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly destruction: Extract<
        IsolatedCodeExecutionReceiptRecord["destruction"],
        { readonly status: "proven" }
      >;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
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
        throw integrity("Modelica generation-zero cleanup proof is divergent.");
      }
      if (
        current.phase !== "dispatching" || current.dispatch.dispatchCount !== 1 ||
        current.dispatch.producerGeneration !== 0 ||
        current.generationRecovery !== null
      ) {
        throw integrity("Modelica generation-zero cleanup is out of order.");
      }
      return deepFreeze({
        ...base(current),
        phase: "generation-zero-cleaned",
        dispatch: current.dispatch as ModelicaIsolatedExecutionDispatch & {
          readonly dispatchCount: 1;
          readonly producerGeneration: 0;
        },
        generationZeroDestruction: destruction,
      });
    });
  }

  markRedispatching(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly advance: Parameters<
        typeof validateIsolatedOutputProducerGenerationAdvance
      >[0];
      readonly dispatchedAt: string;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    return this.#transition(input, async (current) => {
      const dispatchedAt = timestamp(input.dispatchedAt, "$redispatchedAt");
      const advance = await validateIsolatedOutputProducerGenerationAdvance(
        input.advance,
        current.executionRunId,
      );
      if (current.phase === "dispatching" && current.dispatch.dispatchCount === 2) {
        if (
          current.dispatch.producerGeneration === 1 &&
          current.dispatch.dispatchedAt === dispatchedAt &&
          current.generationRecovery !== null &&
          deterministicJson(current.generationRecovery.advance) ===
            deterministicJson(advance)
        ) return current;
        throw integrity("Modelica generation-one dispatch is divergent.");
      }
      if (current.phase !== "generation-zero-cleaned") {
        throw integrity("Modelica generation-one dispatch is out of order.");
      }
      const generationRecovery: ModelicaIsolatedExecutionGenerationRecovery =
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
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    return this.#transition(input, async (current) => {
      const receiptRecord = await validatePublishedReceipt(
        input.receiptRecord,
        current.identity,
        current.phase === "dispatching"
          ? current.dispatch.producerGeneration
          : undefined,
      );
      if (current.phase !== "dispatching") {
        if (
          "receiptRecord" in current &&
          deterministicJson(current.receiptRecord) === deterministicJson(receiptRecord)
        ) return current;
        throw integrity("Modelica output publication is out of order.");
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

  markEvidencePersisted(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly evidence: Parameters<typeof validateModelicaIsolatedEvidence>[0];
      readonly capture: ModelicaIsolatedExecutionCaptureReference;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    return this.#transition(input, (current) => {
      const evidence = validateModelicaIsolatedEvidence(input.evidence);
      const capture = validateCaptureReference(input.capture);
      if (current.phase !== "output-published") {
        if (
          (current.phase === "evidence-persisted" || current.phase === "completed") &&
          deterministicJson({
              evidence: current.evidence,
              capture: current.capture,
            }) ===
            deterministicJson({ evidence, capture })
        ) return current;
        throw integrity("Modelica evidence persistence is out of order.");
      }
      return deepFreeze({
        ...base(current),
        phase: "evidence-persisted",
        dispatch: current.dispatch,
        generationRecovery: current.generationRecovery,
        receiptRecord: current.receiptRecord,
        evidence,
        capture,
      });
    });
  }

  markCompleted(
    input: ModelicaIsolatedExecutionAttemptKey,
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    return this.#transition(input, (current) => {
      if (current.phase === "completed") return current;
      if (current.phase !== "evidence-persisted") {
        throw integrity("Modelica execution cannot complete before evidence.");
      }
      return deepFreeze({ ...current, phase: "completed" });
    });
  }

  markOutputValidationRejected(
    input: ModelicaIsolatedExecutionAttemptKey & {
      readonly observation: {
        readonly role: string;
        readonly byteCount: number;
        readonly sha256: string;
      };
      readonly destruction: ModelicaIsolatedProvenDestruction;
    },
  ): Promise<ModelicaIsolatedExecutionAttempt> {
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
          "Modelica output-validation rejection is divergent.",
        );
      }
      if (current.phase !== "dispatching") {
        throw integrity("Modelica output-validation rejection is out of order.");
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
      schemaVersion: "modelica-isolated-execution-wal-key/1.0",
      projectId,
      agentRunId,
    });
    return `${this.#directory}/run-${key.digest}.json`;
  }

  async #transition(
    keyValue: ModelicaIsolatedExecutionAttemptKey,
    transition: (
      current: ModelicaIsolatedExecutionAttempt,
    ) => ModelicaIsolatedExecutionAttempt | Promise<ModelicaIsolatedExecutionAttempt>,
  ): Promise<ModelicaIsolatedExecutionAttempt> {
    const key = validateKey({
      projectId: keyValue.projectId,
      agentRunId: keyValue.agentRunId,
      executionRunId: keyValue.executionRunId,
      attemptFingerprint: keyValue.attemptFingerprint,
    });
    return await this.#withLock(key.projectId, key.agentRunId, async () => {
      const current = await this.read(key.projectId, key.agentRunId);
      if (!current) throw integrity("The Modelica execution WAL is missing.");
      assertKey(current, key);
      const next = await transition(current);
      if (next !== current) await this.#replace(next);
      return next;
    });
  }

  async #writeNew(attempt: ModelicaIsolatedExecutionAttempt): Promise<void> {
    await this.#ensureDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await writeNewAttemptFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
    );
    await Deno.chmod(path, 0o600);
    await this.#assertReread(attempt);
  }

  async #replace(attempt: ModelicaIsolatedExecutionAttempt): Promise<void> {
    await this.#ensureDirectory();
    const path = await this.pathFor(attempt.projectId, attempt.agentRunId);
    await replaceAttemptFileDurably(
      path,
      `${deterministicJson(attempt)}\n`,
      this.#directory,
      NO_PROGRESS,
    );
    await Deno.chmod(path, 0o600);
    await this.#assertReread(attempt);
  }

  async #assertReread(expected: ModelicaIsolatedExecutionAttempt): Promise<void> {
    const actual = await this.read(expected.projectId, expected.agentRunId);
    if (!actual || deterministicJson(actual) !== deterministicJson(expected)) {
      throw integrity("The Modelica execution WAL failed its durable reread.");
    }
  }

  async #ensureDirectory(): Promise<void> {
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.#directory, 0o700);
  }

  async #withLock<T>(
    projectId: string,
    agentRunId: string,
    body: () => Promise<T>,
  ): Promise<T> {
    await this.#ensureDirectory();
    const lock = await Deno.open(`${await this.pathFor(projectId, agentRunId)}.lock`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    try {
      await lock.lock(true);
      return await body();
    } finally {
      await lock.unlock().catch(() => undefined);
      lock.close();
    }
  }
}

export async function validateModelicaIsolatedExecutionAttempt(
  value: unknown,
  expectedProjectId?: string,
  expectedAgentRunId?: string,
): Promise<ModelicaIsolatedExecutionAttempt> {
  const initial = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "agentRunId",
    "executionRunId",
    "attemptFingerprint",
    "identity",
    "preparedAt",
    "phase",
    ...phaseFields(value),
  ], "$attempt");
  literalValue(
    initial.schemaVersion,
    MODELICA_ISOLATED_EXECUTION_ATTEMPT_SCHEMA,
    "$attempt.schemaVersion",
  );
  const identity = await validateIdentity(initial.identity);
  const attemptFingerprint = validateContentFingerprint(
    initial.attemptFingerprint,
    "$attempt.attemptFingerprint",
  );
  const key = validateKey({
    projectId: initial.projectId,
    agentRunId: initial.agentRunId,
    executionRunId: initial.executionRunId,
    attemptFingerprint,
  });
  if (
    key.projectId !== identity.projectId || key.agentRunId !== identity.agentRunId ||
    key.executionRunId !== identity.executionRunId ||
    (expectedProjectId !== undefined && key.projectId !== expectedProjectId) ||
    (expectedAgentRunId !== undefined && key.agentRunId !== expectedAgentRunId) ||
    !fingerprintsEqual(
      attemptFingerprint,
      await fingerprintModelicaIsolatedAttemptIdentity(identity),
    )
  ) throw integrity("The Modelica execution WAL identity is divergent.");
  const baseValue = {
    schemaVersion: MODELICA_ISOLATED_EXECUTION_ATTEMPT_SCHEMA,
    ...key,
    identity,
    preparedAt: timestamp(initial.preparedAt, "$attempt.preparedAt"),
  };
  if (initial.phase === "prepared") {
    return deepFreeze({ ...baseValue, phase: "prepared" });
  }
  const dispatch = validateDispatch(initial.dispatch);
  if (initial.phase === "generation-zero-cleaned") {
    if (dispatch.dispatchCount !== 1 || dispatch.producerGeneration !== 0) {
      throw integrity("Generation-zero cleanup names another dispatch.");
    }
    return deepFreeze({
      ...baseValue,
      phase: "generation-zero-cleaned",
      dispatch: dispatch as ModelicaIsolatedExecutionDispatch & {
        readonly dispatchCount: 1;
        readonly producerGeneration: 0;
      },
      generationZeroDestruction: validateGenerationZeroDestruction(
        initial.generationZeroDestruction,
        identity.executionRunId,
      ),
    });
  }
  const generationRecovery = await validateGenerationRecovery(
    initial.generationRecovery,
    identity.executionRunId,
    dispatch,
  );
  if (initial.phase === "dispatching") {
    return deepFreeze({
      ...baseValue,
      phase: "dispatching",
      dispatch,
      generationRecovery,
    });
  }
  if (initial.phase === "output-validation-rejected") {
    return deepFreeze({
      ...baseValue,
      phase: "output-validation-rejected",
      dispatch,
      generationRecovery,
      outputValidationRejection: validateOutputValidationRejection(
        initial.outputValidationRejection,
        identity,
      ),
    });
  }
  const receiptRecord = await validatePublishedReceipt(
    initial.receiptRecord,
    identity,
    dispatch.producerGeneration,
  );
  if (initial.phase === "output-published") {
    return deepFreeze({
      ...baseValue,
      phase: "output-published",
      dispatch,
      generationRecovery,
      receiptRecord,
    });
  }
  const evidence = validateModelicaIsolatedEvidence(initial.evidence);
  const capture = validateCaptureReference(initial.capture);
  if (initial.phase === "evidence-persisted" || initial.phase === "completed") {
    return deepFreeze({
      ...baseValue,
      phase: initial.phase,
      dispatch,
      generationRecovery,
      receiptRecord,
      evidence,
      capture,
    });
  }
  throw integrity("The Modelica execution WAL phase is unsupported.");
}

async function validateIdentity(
  value: unknown,
): Promise<ModelicaIsolatedExecutionAttemptIdentity> {
  const root = exactRecord(value, [
    "projectId",
    "agentRunId",
    "executionRunId",
    "reviewedRunFingerprint",
    "bundle",
    "executionProfile",
    "runtimeQualification",
    "isolatedRequest",
  ], "$identity");
  const executionProfile = await validateModelicaIsolatedExecutionProfile(
    root.executionProfile,
  );
  const runtimeQualification = validateModelicaMicrosandboxQualificationReference(
    root.runtimeQualification,
    executionProfile.profileFingerprint,
    "$identity.runtimeQualification",
  );
  const bundle = validateBundleDescriptor(root.bundle);
  const request = exactRecord(root.isolatedRequest, [
    "schemaVersion",
    "runId",
    "producerGeneration",
    "profile",
    "sourceSha256",
    "policy",
    "outputs",
  ], "$identity.isolatedRequest");
  literalValue(
    request.schemaVersion,
    ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    "$identity.isolatedRequest.schemaVersion",
  );
  const executionRunId = safeId(root.executionRunId, "$identity.executionRunId");
  literalValue(
    request.producerGeneration,
    0,
    "$identity.isolatedRequest.producerGeneration",
  );
  const requestProfile = validateIsolatedCodeProfileRef(request.profile);
  const requestPolicy = validateIsolatedCodePolicyRef(request.policy);
  const requestOutputs = validateIsolatedCodeOutputManifest(request.outputs);
  if (
    safeId(request.runId, "$identity.isolatedRequest.runId") !== executionRunId ||
    sha256Hex(request.sourceSha256, "$identity.isolatedRequest.sourceSha256") !==
      bundle.fingerprint.digest ||
    !isolatedCodeRefsEqual(requestProfile, executionProfile.executionProfile) ||
    !isolatedCodeRefsEqual(requestPolicy, executionProfile.isolationPolicy) ||
    !isolatedCodeOutputManifestsEqual(
      requestOutputs,
      executionProfile.outputManifest,
    ) ||
    deterministicJson(bundle.method) !== deterministicJson(executionProfile.method) ||
    bundle.byteCount > executionProfile.maximumBundleBytes ||
    bundle.invocation.timeoutMs > executionProfile.runtime.requestedLimits.maxWallTimeMs
  ) throw integrity("The Modelica bundle and execution profile are incompatible.");
  return deepFreeze({
    projectId: safeId(root.projectId, "$identity.projectId"),
    agentRunId: safeId(root.agentRunId, "$identity.agentRunId"),
    executionRunId,
    reviewedRunFingerprint: validateContentFingerprint(
      root.reviewedRunFingerprint,
      "$identity.reviewedRunFingerprint",
    ),
    bundle,
    executionProfile,
    runtimeQualification,
    isolatedRequest: {
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: executionRunId,
      producerGeneration: 0,
      profile: requestProfile,
      sourceSha256: bundle.fingerprint.digest,
      policy: requestPolicy,
      outputs: requestOutputs,
    },
  });
}

function validateBundleDescriptor(value: unknown): ModelicaIsolatedBundleDescriptor {
  const root = exactRecord(value, [
    "schemaVersion",
    "qualification",
    "selection",
    "invocation",
    "method",
    "inputs",
    "byteCount",
    "fingerprint",
  ], "$identity.bundle");
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    "$identity.bundle.schemaVersion",
  );
  const qualification = exactRecord(root.qualification, [
    "caseSha256",
    "manifestSha256",
    "sourceCaptureSha256",
  ], "$identity.bundle.qualification");
  const selection = exactRecord(root.selection, [
    "modelId",
    "modelVersion",
    "scenarioId",
  ], "$identity.bundle.selection");
  const invocation = validateDescriptorInvocation(root.invocation);
  const method = validateDescriptorMethod(root.method);
  const inputs = nonEmptyArray(root.inputs, "$identity.bundle.inputs").map(
    (item, index) => {
      const path = `$identity.bundle.inputs[${index}]`;
      const member = exactRecord(
        item,
        ["role", "basename", "mediaType", "byteCount", "sha256"],
        path,
      );
      if (
        member.role !== "model" && member.role !== "scenario" &&
        member.role !== "parameter_schema"
      ) throw integrity(`${path}.role is unsupported.`);
      const role = member.role as ModelicaIsolatedInputRole;
      const expected = role === "model"
        ? ["model.mo", "text/x-modelica"]
        : role === "scenario"
        ? ["scenario.json", "application/json"]
        : ["parameter-schema.json", "application/json"];
      literalValue(member.basename, expected[0], `${path}.basename`);
      literalValue(member.mediaType, expected[1], `${path}.mediaType`);
      return deepFreeze({
        role,
        basename:
          expected[0] as ModelicaIsolatedBundleDescriptor["inputs"][number]["basename"],
        mediaType: expected[1] as ModelicaIsolatedBundleDescriptor["inputs"][number][
          "mediaType"
        ],
        byteCount: nonNegative(member.byteCount, `${path}.byteCount`),
        sha256: sha256Hex(member.sha256, `${path}.sha256`),
      });
    },
  ).sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(inputs.map((input) => input.role), "$identity.bundle.inputs roles");
  const descriptor: ModelicaIsolatedBundleDescriptor = deepFreeze({
    schemaVersion: MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    qualification: {
      caseSha256: sha256Hex(
        qualification.caseSha256,
        "$identity.bundle.qualification.caseSha256",
      ),
      manifestSha256: sha256Hex(
        qualification.manifestSha256,
        "$identity.bundle.qualification.manifestSha256",
      ),
      sourceCaptureSha256: sha256Hex(
        qualification.sourceCaptureSha256,
        "$identity.bundle.qualification.sourceCaptureSha256",
      ),
    },
    selection: {
      modelId: safeId(selection.modelId, "$identity.bundle.selection.modelId"),
      modelVersion: nonEmptyText(
        selection.modelVersion,
        "$identity.bundle.selection.modelVersion",
      ),
      scenarioId: safeId(
        selection.scenarioId,
        "$identity.bundle.selection.scenarioId",
      ),
    },
    invocation,
    method,
    inputs,
    byteCount: positiveInteger(root.byteCount, "$identity.bundle.byteCount"),
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$identity.bundle.fingerprint",
    ),
  });
  assertQualifiedBundleDescriptor(descriptor);
  return descriptor;
}

function assertQualifiedBundleDescriptor(
  bundle: ModelicaIsolatedBundleDescriptor,
): void {
  const kit = MODELICA_LOCAL_QUALIFIED_KIT;
  const model = bundle.inputs.find((input) => input.role === "model");
  const scenario = bundle.inputs.find((input) => input.role === "scenario");
  const parameters = bundle.invocation.parameters.map((parameter) => ({
    id: parameter.id,
    modelicaName: parameter.modelicaName,
    inputUnit: parameter.inputUnit,
    modelicaUnit: parameter.modelicaUnit,
  }));
  const expectedParameters = kit.parameters.map((parameter) => ({
    id: parameter.id,
    modelicaName: parameter.modelicaName,
    inputUnit: parameter.unit,
    modelicaUnit: parameter.conversion.to,
  }));
  if (
    bundle.selection.modelId !== kit.modelId ||
    bundle.selection.modelVersion !== kit.modelVersion ||
    bundle.selection.scenarioId !== kit.scenarioId ||
    bundle.inputs.length !== 2 || !model || !scenario ||
    model.byteCount !== kit.modelByteCount || model.sha256 !== kit.modelSha256 ||
    scenario.byteCount !== kit.scenarioByteCount ||
    scenario.sha256 !== kit.scenarioSha256 ||
    bundle.invocation.modelName !== kit.modelName ||
    bundle.invocation.startTimeS !== kit.scenario.startTimeS ||
    bundle.invocation.stopTimeS !== kit.scenario.stopTimeS ||
    bundle.invocation.numberOfIntervals !== kit.scenario.numberOfIntervals ||
    bundle.invocation.solver !== kit.scenario.solver ||
    deterministicJson(parameters) !== deterministicJson(expectedParameters) ||
    deterministicJson(bundle.invocation.metrics) !==
      deterministicJson(kit.metrics) ||
    bundle.invocation.parameters.some((parameter, index) => {
      const qualified = kit.parameters[index];
      if (!qualified) return true;
      const expectedValue = parameter.inputValue * qualified.conversion.factor +
        qualified.conversion.offset;
      return parameter.inputValue < qualified.minimum ||
        parameter.inputValue > qualified.maximum ||
        parameter.modelicaValue !== (Object.is(expectedValue, -0) ? 0 : expectedValue);
    })
  ) {
    throw integrity("The WAL bundle is not the code-owned Modelica qualified kit.");
  }
}

function validateDescriptorInvocation(
  value: unknown,
): ModelicaIsolatedInputBundle["invocation"] {
  // Reuse the canonical bundle validator's closed grammar without retaining
  // source text by validating an exact local projection here.
  const root = exactRecord(value, [
    "modelName",
    "startTimeS",
    "stopTimeS",
    "numberOfIntervals",
    "solver",
    "timeoutMs",
    "parameters",
    "metrics",
  ], "$identity.bundle.invocation");
  const number = (candidate: unknown, path: string) => {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      throw integrity(`${path} must be finite.`);
    }
    return Object.is(candidate, -0) ? 0 : candidate;
  };
  const parameters = Array.isArray(root.parameters)
    ? root.parameters.map((item, index) => {
      const path = `$identity.bundle.invocation.parameters[${index}]`;
      const p = exactRecord(item, [
        "id",
        "modelicaName",
        "inputValue",
        "inputUnit",
        "modelicaValue",
        "modelicaUnit",
      ], path);
      return {
        id: safeId(p.id, `${path}.id`),
        modelicaName: safeId(p.modelicaName, `${path}.modelicaName`),
        inputValue: number(p.inputValue, `${path}.inputValue`),
        inputUnit: nonEmptyText(p.inputUnit, `${path}.inputUnit`),
        modelicaValue: number(p.modelicaValue, `${path}.modelicaValue`),
        modelicaUnit: nonEmptyText(p.modelicaUnit, `${path}.modelicaUnit`),
      };
    }).sort(compareById)
    : (() => {
      throw integrity("$identity.bundle.invocation.parameters must be an array.");
    })();
  rejectDuplicates(parameters.map((item) => item.id), "$identity.bundle parameter ids");
  const metrics = nonEmptyArray(
    root.metrics,
    "$identity.bundle.invocation.metrics",
  ).map((item, index) => {
    const path = `$identity.bundle.invocation.metrics[${index}]`;
    const metric = exactRecord(item, ["id", "unit", "required"], path);
    if (typeof metric.required !== "boolean") throw integrity(`${path}.required`);
    return {
      id: safeId(metric.id, `${path}.id`),
      unit: nonEmptyText(metric.unit, `${path}.unit`),
      required: metric.required,
    };
  }).sort(compareById);
  rejectDuplicates(metrics.map((item) => item.id), "$identity.bundle metric ids");
  return deepFreeze({
    modelName: safeId(root.modelName, "$identity.bundle.invocation.modelName"),
    startTimeS: number(root.startTimeS, "$identity.bundle.invocation.startTimeS"),
    stopTimeS: number(root.stopTimeS, "$identity.bundle.invocation.stopTimeS"),
    numberOfIntervals: positiveInteger(
      root.numberOfIntervals,
      "$identity.bundle.invocation.numberOfIntervals",
    ),
    solver: safeId(root.solver, "$identity.bundle.invocation.solver"),
    timeoutMs: positiveInteger(root.timeoutMs, "$identity.bundle.invocation.timeoutMs"),
    parameters,
    metrics,
  });
}

function validateDescriptorMethod(
  value: unknown,
): ModelicaIsolatedInputBundle["method"] {
  const root = exactRecord(
    value,
    ["lowering", "resultNormalizer", "engine"],
    "$identity.bundle.method",
  );
  const id = (candidate: unknown, path: string) => {
    const record = exactRecord(candidate, ["id", "version"], path);
    return {
      id: safeId(record.id, `${path}.id`),
      version: nonEmptyText(record.version, `${path}.version`),
    };
  };
  const engine = exactRecord(
    root.engine,
    ["name", "version", "mslVersion"],
    "$identity.bundle.method.engine",
  );
  return deepFreeze({
    lowering: id(root.lowering, "$identity.bundle.method.lowering"),
    resultNormalizer: id(
      root.resultNormalizer,
      "$identity.bundle.method.resultNormalizer",
    ),
    engine: {
      name: nonEmptyText(engine.name, "$identity.bundle.method.engine.name"),
      version: nonEmptyText(engine.version, "$identity.bundle.method.engine.version"),
      mslVersion: nonEmptyText(
        engine.mslVersion,
        "$identity.bundle.method.engine.mslVersion",
      ),
    },
  });
}

async function validatePublishedReceipt(
  value: unknown,
  identity: ModelicaIsolatedExecutionAttemptIdentity,
  expectedProducerGeneration?: 0 | 1,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  const receipt = await validateIsolatedCodeExecutionReceiptRecord(value);
  if (
    receipt.runId !== identity.executionRunId ||
    (expectedProducerGeneration !== undefined &&
      receipt.producerGeneration !== expectedProducerGeneration) ||
    receipt.sourceSha256 !== identity.bundle.fingerprint.digest ||
    !isolatedCodeRefsEqual(
      receipt.profile,
      identity.executionProfile.executionProfile,
    ) ||
    !isolatedCodeRefsEqual(receipt.policy, identity.executionProfile.isolationPolicy) ||
    !runtimeAttestationsEqual(receipt.runtime, identity.executionProfile.runtime) ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      identity.executionProfile.outputManifest,
    ) || receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" ||
    receipt.destruction.runId !== identity.executionRunId ||
    receipt.publication.status !== "atomic-batch-published"
  ) {
    throw integrity(
      "The published Modelica receipt differs from its durable identity.",
    );
  }
  return receipt;
}

function validateDispatch(value: unknown): ModelicaIsolatedExecutionDispatch {
  const root = exactRecord(
    value,
    ["dispatchCount", "producerGeneration", "dispatchedAt"],
    "$attempt.dispatch",
  );
  const dispatchedAt = timestamp(root.dispatchedAt, "$attempt.dispatch.dispatchedAt");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    root.producerGeneration,
    "$attempt.dispatch.producerGeneration",
  );
  if (
    (root.dispatchCount !== 1 && root.dispatchCount !== 2) ||
    root.dispatchCount !== producerGeneration + 1
  ) {
    throw integrity("Modelica dispatch count and producer generation diverge.");
  }
  return deepFreeze({
    dispatchCount: root.dispatchCount,
    producerGeneration,
    dispatchedAt,
  } as ModelicaIsolatedExecutionDispatch);
}

async function validateGenerationRecovery(
  value: unknown,
  executionRunId: string,
  dispatch: ModelicaIsolatedExecutionDispatch,
): Promise<ModelicaIsolatedExecutionGenerationRecovery | null> {
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
    advance: await validateIsolatedOutputProducerGenerationAdvance(
      root.advance,
      executionRunId,
    ),
  });
}

function validateOutputValidationRejection(
  value: unknown,
  identity: ModelicaIsolatedExecutionAttemptIdentity,
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
  identity: ModelicaIsolatedExecutionAttemptIdentity,
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
  literalValue(root.status, "proven", "$attempt.generationZeroDestruction.status");
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

function validateCaptureReference(
  value: unknown,
): ModelicaIsolatedExecutionCaptureReference {
  const root = exactRecord(value, ["schemaVersion", "uri", "fingerprint"], "$capture");
  literalValue(
    root.schemaVersion,
    "modelica-qualified-kit-execution-capture-reference/1.0",
    "$capture.schemaVersion",
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    "$capture.fingerprint",
  );
  const uri = nonEmptyText(root.uri, "$capture.uri");
  if (!uri.endsWith(`/sha256/${fingerprint.digest}`)) {
    throw integrity("The Modelica capture URI differs from its fingerprint.");
  }
  return deepFreeze({
    schemaVersion: "modelica-qualified-kit-execution-capture-reference/1.0",
    uri,
    fingerprint,
  });
}

function phaseFields(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const phase = (value as Record<string, unknown>).phase;
  if (phase === "prepared") return [];
  if (phase === "generation-zero-cleaned") {
    return ["dispatch", "generationZeroDestruction"];
  }
  if (phase === "dispatching") return ["dispatch", "generationRecovery"];
  if (phase === "output-validation-rejected") {
    return ["dispatch", "generationRecovery", "outputValidationRejection"];
  }
  if (phase === "output-published") {
    return ["dispatch", "generationRecovery", "receiptRecord"];
  }
  if (phase === "evidence-persisted" || phase === "completed") {
    return [
      "dispatch",
      "generationRecovery",
      "receiptRecord",
      "evidence",
      "capture",
    ];
  }
  return [];
}

function keyFor(
  identity: ModelicaIsolatedExecutionAttemptIdentity,
  attemptFingerprint: ModelicaIsolatedExecutionAttemptKey["attemptFingerprint"],
): ModelicaIsolatedExecutionAttemptKey {
  return {
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    attemptFingerprint,
  };
}

function validateKey(value: unknown): ModelicaIsolatedExecutionAttemptKey {
  const root = exactRecord(
    value,
    ["projectId", "agentRunId", "executionRunId", "attemptFingerprint"],
    "$attemptKey",
  );
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

function assertKey(
  attempt: ModelicaIsolatedExecutionAttempt,
  key: ModelicaIsolatedExecutionAttemptKey,
): void {
  if (
    attempt.projectId !== key.projectId || attempt.agentRunId !== key.agentRunId ||
    attempt.executionRunId !== key.executionRunId ||
    !fingerprintsEqual(attempt.attemptFingerprint, key.attemptFingerprint)
  ) throw integrity("The Modelica execution WAL key is divergent.");
}

function base(attempt: ModelicaIsolatedExecutionAttempt) {
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

function nonNegative(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw integrity(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return compareAsciiCodeUnits(left.id, right.id);
}

function boundedDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) throw new TypeError("Modelica WAL directory must be a bounded path.");
  return value.replace(/\/+$/, "");
}

function integrity(message: string): ModelicaIsolatedExecutionAttemptIntegrityError {
  return new ModelicaIsolatedExecutionAttemptIntegrityError(message);
}
