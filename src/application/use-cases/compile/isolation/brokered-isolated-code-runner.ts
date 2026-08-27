import type {
  EphemeralExecutionBackend,
  EphemeralExecutionBackendRequest,
  EphemeralExecutionDestruction,
  EphemeralExecutionLog,
  EphemeralOutputInventoryEntry,
} from "../../../ports/out/compile/isolation/ephemeral-execution-backend.ts";
import type {
  IsolatedCodeRunRecovery,
  IsolatedOutputCasSink,
  IsolatedOutputCasWriteReceipt,
  IsolatedOutputPublicationResolution,
  StagedIsolatedOutputBatch,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
  type IsolatedCodeRunner,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  copyObservedUint8Array,
  createIsolatedCodeExecutionReceipt,
  createIsolatedCodeExecutionRejectionDiagnostic,
  createIsolatedCodeOutputValidationRejection,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRejectionDiagnostic,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeOutputDeclaration,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodeOutputValidationRejection,
  type IsolatedCodePolicyRef,
  type IsolatedCodeProfileRef,
  isolatedCodeRefsEqual,
  type IsolatedCodeRuntimeAttestation,
  isolatedCodeTerminationIsRejected,
  type IsolatedOutputProducerGeneration,
  type IsolatedOutputProducerGenerationAdvance,
  type IsolatedOutputProducerGenerationAdvanceInput,
  type IsolatedOutputPublicationRef,
  observedUint8ArrayByteLength,
  runtimeAttestationsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRejectionDiagnostic,
  validateIsolatedCodeExecutionRequest,
  validateIsolatedCodeOutputBasename,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodeOutputValidationRejection,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
  validateIsolatedCodeTermination,
  validateIsolatedOutputCasUri,
  validateIsolatedOutputProducerGeneration,
  validateIsolatedOutputPublicationRef,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  sha256Hex,
} from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";

export type BrokeredIsolatedCodeRunnerErrorCode =
  | "invalid_request"
  | "unregistered_profile"
  | "unregistered_policy"
  | "infrastructure_failure"
  | "backend_contract_violation"
  | "output_manifest_mismatch"
  | "output_integrity_failed"
  | "output_quota_exceeded"
  | "cas_integrity_failed"
  | "cas_publication_outcome_unknown";

export class BrokeredIsolatedCodeRunnerError extends Error {
  readonly code: BrokeredIsolatedCodeRunnerErrorCode;

  constructor(
    code: BrokeredIsolatedCodeRunnerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrokeredIsolatedCodeRunnerError";
    this.code = code;
  }
}

export interface BrokeredIsolatedCodeRunnerDependencies<
  Lease = unknown,
  OutputHandle = unknown,
  CasBatch = unknown,
> {
  readonly backend: EphemeralExecutionBackend<Lease, OutputHandle>;
  readonly cas: IsolatedOutputCasSink<CasBatch>;
  /** One code-owned frontend/profile binding per runner instance. */
  readonly profile: IsolatedCodeProfileRef;
  /** Source byte ceiling registered with the profile by server code. */
  readonly maximumSourceBytes: number;
  /** Exact output manifest registered with this profile by server code. */
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  /** One server-owned isolation policy revision per runner instance. */
  readonly policy: IsolatedCodePolicyRef;
  /** Exact enforcement expected from the selected backend adapter. */
  readonly runtime: IsolatedCodeRuntimeAttestation;
  /** A strict production policy can reject acknowledgement-only cleanup. */
  readonly minimumDestructionAssurance: "acknowledged-unattested" | "proven";
  /** Format-aware validator selected by server code, never by the agent. */
  readonly validateOutput: (
    declaration: IsolatedCodeOutputDeclaration,
    bytes: Uint8Array,
  ) => void | Promise<void>;
}

interface PreparedOutput {
  readonly declaration: IsolatedCodeOutputDeclaration;
  readonly bytes: Uint8Array;
  readonly byteCount: number;
  readonly sha256: string;
}

interface PreparedExecution {
  readonly termination: ReturnType<typeof validateIsolatedCodeTermination>;
  readonly logs: {
    readonly stdout: EphemeralExecutionLog;
    readonly stderr: EphemeralExecutionLog;
  };
  readonly outputs: readonly PreparedOutput[];
}

/**
 * Fail-closed broker between the public runner port and an ephemeral backend.
 *
 * Backend inventory metadata is never trusted. The broker verifies the exact
 * manifest, copies and hashes every file outside the backend, runs a code-owned
 * format validator, closes cleanup, then stages, re-reads, and atomically
 * publishes CAS objects.
 */
export class BrokeredIsolatedCodeRunner<
  Lease = unknown,
  OutputHandle = unknown,
  CasBatch = unknown,
> implements IsolatedCodeRunner, IsolatedCodeRunRecovery {
  readonly #backend: EphemeralExecutionBackend<Lease, OutputHandle>;
  readonly #cas: IsolatedOutputCasSink<CasBatch>;
  readonly #profile: IsolatedCodeProfileRef;
  readonly #maximumSourceBytes: number;
  readonly #outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly #policy: IsolatedCodePolicyRef;
  readonly #runtime: IsolatedCodeRuntimeAttestation;
  readonly #minimumDestructionAssurance:
    | "acknowledged-unattested"
    | "proven";
  readonly #validateOutput: (
    declaration: IsolatedCodeOutputDeclaration,
    bytes: Uint8Array,
  ) => void | Promise<void>;

  constructor(
    dependencies: BrokeredIsolatedCodeRunnerDependencies<
      Lease,
      OutputHandle,
      CasBatch
    >,
  ) {
    this.#backend = dependencies.backend;
    this.#cas = dependencies.cas;
    this.#profile = validateIsolatedCodeProfileRef(dependencies.profile);
    this.#maximumSourceBytes = positiveSafeInteger(
      dependencies.maximumSourceBytes,
      "maximumSourceBytes",
    );
    this.#outputManifest = validateIsolatedCodeOutputManifest(
      dependencies.outputManifest,
      "$registeredProfile.outputs",
    );
    this.#policy = validateIsolatedCodePolicyRef(dependencies.policy);
    this.#runtime = validateIsolatedCodeRuntimeAttestation(dependencies.runtime);
    this.#minimumDestructionAssurance = dependencies.minimumDestructionAssurance;
    if (
      this.#minimumDestructionAssurance !== "acknowledged-unattested" &&
      this.#minimumDestructionAssurance !== "proven"
    ) {
      throw new TypeError("minimumDestructionAssurance is unsupported.");
    }
    assertBrokerObservedCaps(this.#runtime);
    this.#validateOutput = dependencies.validateOutput;
  }

  async run(
    requestValue: IsolatedCodeExecutionRequest,
  ): Promise<IsolatedCodeExecutionReceipt> {
    let request;
    try {
      request = await validateIsolatedCodeExecutionRequest(
        requestValue,
        this.#maximumSourceBytes,
      );
    } catch {
      throw new BrokeredIsolatedCodeRunnerError(
        "invalid_request",
        "The isolated execution request failed exact validation.",
      );
    }
    if (!isolatedCodeRefsEqual(request.profile, this.#profile)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "unregistered_profile",
        "The requested source profile is not registered by this runner.",
      );
    }
    if (!isolatedCodeOutputManifestsEqual(request.outputs, this.#outputManifest)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "output_manifest_mismatch",
        "The requested outputs do not match the code-owned profile manifest.",
      );
    }
    if (!isolatedCodeRefsEqual(request.policy, this.#policy)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "unregistered_policy",
        "The requested isolation policy is not registered by this runner.",
      );
    }

    const backendRequest: EphemeralExecutionBackendRequest = Object.freeze({
      runId: request.runId,
      producerGeneration: request.producerGeneration,
      profile: request.profile,
      source: Object.freeze({
        bytes: request.source.bytes.copy(),
        sha256: request.source.sha256,
      }),
      policy: request.policy,
      outputs: this.#outputManifest,
      runtime: this.#runtime,
    });

    let lease: Lease;
    try {
      lease = await this.#backend.create(backendRequest);
    } catch {
      await this.#recoverFailedCreation(request.runId);
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "The ephemeral execution environment could not be created.",
      );
    }

    let prepared: PreparedExecution | undefined;
    let executionFailure:
      | BrokeredIsolatedCodeRunnerError
      | IsolatedExecutionRejectionInspection
      | IsolatedOutputValidationRejectionInspection
      | undefined;
    try {
      prepared = await this.#executeAndInspect(lease, this.#outputManifest);
    } catch (failure) {
      executionFailure = normalizeBackendInspectionFailure(failure);
    }

    let destruction: Exclude<
      EphemeralExecutionDestruction,
      { status: "unproven" }
    >;
    try {
      destruction = validateAcceptedDestruction(
        await this.#backend.destroy(lease),
        this.#minimumDestructionAssurance,
        request.runId,
      );
    } catch {
      const recovered = await this.#recoverFailedDestruction(request.runId);
      if (!recovered) {
        throw new BrokeredIsolatedCodeRunnerError(
          "infrastructure_failure",
          "Ephemeral environment destruction was not proven; no receipt or output is released.",
        );
      }
      destruction = recovered;
    }

    if (executionFailure instanceof IsolatedOutputValidationRejectionInspection) {
      throw new IsolatedCodeOutputValidationRejectedError(
        executionFailure.observation,
        destruction,
      );
    }
    if (executionFailure instanceof IsolatedExecutionRejectionInspection) {
      throw new IsolatedCodeExecutionRejectedError(
        executionFailure.diagnostic,
        destruction,
      );
    }
    if (executionFailure !== undefined) throw executionFailure;
    if (!prepared) {
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "The isolated execution ended without a prepared result.",
      );
    }

    return await this.#publishAtomically(
      request.runId,
      request.producerGeneration,
      prepared.outputs,
      (outputs, publication) =>
        createIsolatedCodeExecutionReceipt({
          request,
          runtime: this.#runtime,
          termination: prepared.termination,
          logs: prepared.logs,
          outputs,
          destruction,
          publication,
        }),
    );
  }

  /**
   * Idempotent, provider-neutral recovery for a WAL-owned run id. This is not
   * an execution capability: it can only destroy environments and returns no
   * lease, handle, path or backend diagnostic.
   */
  async destroyByRunId(
    runId: string,
    producerGenerationValue: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedCodeExecutionReceipt["destruction"]> {
    const acceptedRunId = requireRecoveryRunId(runId);
    const producerGeneration = validateIsolatedOutputProducerGeneration(
      producerGenerationValue,
      "$producerGeneration",
    );
    let stagingRemoved = false;
    try {
      await this.#cas.abortByRunId(acceptedRunId, producerGeneration);
      stagingRemoved = true;
    } catch {
      // Still attempt environment cleanup below, but never authorize a retry
      // while unpublished staging remains ambiguous.
    }
    const destruction = await this.#recoverFailedDestruction(acceptedRunId);
    if (!stagingRemoved || !destruction) {
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "Run-scoped isolated execution cleanup could not be verified.",
      );
    }
    return destruction;
  }

  async advanceProducerGeneration(
    input: IsolatedOutputProducerGenerationAdvanceInput,
  ): Promise<IsolatedOutputProducerGenerationAdvance> {
    try {
      return await this.#cas.advanceProducerGeneration(input);
    } catch {
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "The isolated output producer generation could not be advanced safely.",
      );
    }
  }

  async #recoverFailedCreation(runId: string): Promise<void> {
    await this.#recoverFailedDestruction(runId);
  }

  async #recoverFailedDestruction(
    runId: string,
  ): Promise<
    | Exclude<EphemeralExecutionDestruction, { status: "unproven" }>
    | undefined
  > {
    try {
      return validateAcceptedDestruction(
        await this.#backend.destroyByRunId(runId),
        this.#minimumDestructionAssurance,
        runId,
      );
    } catch {
      // No diagnostic sink is part of this bounded application contract. Raw
      // backend errors and destruction capabilities therefore remain private.
      // `undefined` keeps both creation and ordinary-destruction recovery
      // fail-closed when the required assurance cannot be validated.
      return undefined;
    }
  }

  async #executeAndInspect(
    lease: Lease,
    declarations: readonly IsolatedCodeOutputDeclaration[],
  ): Promise<PreparedExecution> {
    let rawReport: unknown;
    try {
      rawReport = await this.#backend.execute(lease);
    } catch {
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "The isolated execution backend did not return a report.",
      );
    }
    const report = exactRecord(
      rawReport,
      ["runtime", "termination", "logs"],
      "$backend.report",
    );
    const runtime = validateIsolatedCodeRuntimeAttestation(
      report.runtime,
      "$backend.report.runtime",
    );
    if (!runtimeAttestationsEqual(runtime, this.#runtime)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "backend_contract_violation",
        "The backend runtime attestation does not match the server-owned policy.",
      );
    }
    const termination = validateIsolatedCodeTermination(
      report.termination,
      "$backend.report.termination",
    );
    const logs = validateBackendLogs(report.logs, this.#runtime);
    if (isolatedCodeTerminationIsRejected(termination)) {
      throw new IsolatedExecutionRejectionInspection(
        await createIsolatedCodeExecutionRejectionDiagnostic({
          termination,
          logs,
          maximumLogBytes: {
            stdout: this.#runtime.requestedLimits.maxStdoutBytes,
            stderr: this.#runtime.requestedLimits.maxStderrBytes,
          },
        }),
      );
    }

    let rawInventory: readonly EphemeralOutputInventoryEntry<OutputHandle>[];
    try {
      rawInventory = await this.#backend.inventory(lease);
    } catch {
      throw new BrokeredIsolatedCodeRunnerError(
        "infrastructure_failure",
        "The isolated output inventory could not be read.",
      );
    }
    if (!Array.isArray(rawInventory)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "backend_contract_violation",
        "The isolated output inventory is not an array.",
      );
    }
    if (rawInventory.length !== declarations.length) {
      throw new BrokeredIsolatedCodeRunnerError(
        "output_manifest_mismatch",
        "Backend outputs do not match the declared manifest exactly.",
      );
    }

    const inventory = rawInventory.map((entry, index) =>
      validateInventoryEntry<OutputHandle>(entry, index)
    );
    assertExactOutputManifest(inventory, declarations);

    const declarationByBasename = new Map(
      declarations.map((declaration) => [declaration.basename, declaration] as const),
    );
    inventory.sort((left, right) =>
      compareAsciiCodeUnits(
        declarationByBasename.get(left.basename)!.role,
        declarationByBasename.get(right.basename)!.role,
      )
    );
    const outputs: PreparedOutput[] = [];
    let totalBytes = 0;
    for (const entry of inventory) {
      if (entry.kind !== "file") {
        throw new BrokeredIsolatedCodeRunnerError(
          "output_manifest_mismatch",
          "Every declared output must resolve to one regular file.",
        );
      }
      let backendBytes: Uint8Array;
      try {
        const remainingTotal = this.#runtime.requestedLimits.maxOutputTotalBytes -
          totalBytes;
        backendBytes = await this.#backend.readOutput(
          lease,
          entry.handle,
          Math.min(
            this.#runtime.requestedLimits.maxOutputFileBytes,
            remainingTotal,
          ),
        );
      } catch {
        throw new BrokeredIsolatedCodeRunnerError(
          "infrastructure_failure",
          "A declared isolated output could not be read.",
        );
      }
      const observedByteLength = observedUint8ArrayByteLength(
        backendBytes,
        "$backend.output.bytes",
      );
      if (observedByteLength > this.#runtime.requestedLimits.maxOutputFileBytes) {
        throw new BrokeredIsolatedCodeRunnerError(
          "output_quota_exceeded",
          "An isolated output exceeds the per-file byte cap.",
        );
      }
      totalBytes += observedByteLength;
      if (totalBytes > this.#runtime.requestedLimits.maxOutputTotalBytes) {
        throw new BrokeredIsolatedCodeRunnerError(
          "output_quota_exceeded",
          "Isolated outputs exceed the total byte cap.",
        );
      }
      const bytes = copyObservedUint8Array(
        backendBytes,
        "$backend.output.bytes",
        observedByteLength,
      );
      const sha256 = await fingerprintResourceBytes(bytes);
      if (
        entry.claimedByteCount !== bytes.byteLength || entry.claimedSha256 !== sha256
      ) {
        throw new BrokeredIsolatedCodeRunnerError(
          "output_integrity_failed",
          "Backend output size or digest claims do not match observed bytes.",
        );
      }
      const declaration = declarationByBasename.get(entry.basename)!;
      try {
        await this.#validateOutput(declaration, Uint8Array.from(bytes));
      } catch {
        throw new IsolatedOutputValidationRejectionInspection(
          createIsolatedCodeOutputValidationRejection({
            role: declaration.role,
            byteCount: bytes.byteLength,
            sha256,
          }),
        );
      }
      outputs.push(Object.freeze({
        declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
      }));
    }
    outputs.sort((left, right) =>
      compareAsciiCodeUnits(left.declaration.role, right.declaration.role)
    );
    return Object.freeze({
      termination,
      logs,
      outputs: Object.freeze(outputs),
    });
  }

  async #publishAtomically(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
    outputs: readonly PreparedOutput[],
    seal: (
      outputs: readonly (IsolatedCodeOutputDeclaration & {
        readonly bytes: Uint8Array;
        readonly byteCount: number;
        readonly sha256: string;
        readonly casUri: string;
      })[],
      publication: IsolatedOutputPublicationRef,
    ) => Promise<IsolatedCodeExecutionReceipt>,
  ): Promise<IsolatedCodeExecutionReceipt> {
    type PersistedOutput = IsolatedCodeOutputDeclaration & {
      readonly bytes: Uint8Array;
      readonly byteCount: number;
      readonly sha256: string;
      readonly casUri: string;
    };
    let rawStaged: StagedIsolatedOutputBatch<CasBatch>;
    try {
      rawStaged = await this.#cas.stageBatch(outputs.map((output) => ({
        runId,
        producerGeneration,
        ...output.declaration,
        byteCount: output.byteCount,
        sha256: output.sha256,
        bytes: Uint8Array.from(output.bytes),
      })));
    } catch {
      const cleaned = await this.#abortCasByRunId(runId, producerGeneration);
      throw new BrokeredIsolatedCodeRunnerError(
        "cas_integrity_failed",
        cleaned
          ? "The isolated output batch could not be staged atomically."
          : "CAS staging and run-scoped cleanup both failed.",
      );
    }

    let staged: StagedIsolatedOutputBatch<CasBatch>;
    try {
      staged = validateStagedBatch(
        rawStaged,
        runId,
        producerGeneration,
        outputs,
      );
    } catch {
      if (!await this.#abortCasByRunId(runId, producerGeneration)) {
        throw new BrokeredIsolatedCodeRunnerError(
          "cas_integrity_failed",
          "CAS staging validation and staging cleanup both failed.",
        );
      }
      throw new BrokeredIsolatedCodeRunnerError(
        "cas_integrity_failed",
        "The CAS staging receipt failed exact validation.",
      );
    }

    try {
      const persisted: PersistedOutput[] = [];
      for (const [index, output] of outputs.entries()) {
        const write = staged.receipts[index]!;
        let reread: Uint8Array;
        try {
          reread = await this.#cas.readStaged(staged.batch, write.casUri);
        } catch {
          throw new BrokeredIsolatedCodeRunnerError(
            "cas_integrity_failed",
            "An isolated output could not be re-read from CAS staging.",
          );
        }
        const rereadByteLength = observedUint8ArrayByteLength(
          reread,
          "$cas.staged.bytes",
        );
        if (rereadByteLength !== output.byteCount) {
          throw new BrokeredIsolatedCodeRunnerError(
            "cas_integrity_failed",
            "The CAS staged re-read does not match the observed output bytes.",
          );
        }
        const bytes = copyObservedUint8Array(
          reread,
          "$cas.staged.bytes",
          output.byteCount,
        );
        if (
          await fingerprintResourceBytes(bytes) !== output.sha256 ||
          !bytesEqual(bytes, output.bytes)
        ) {
          throw new BrokeredIsolatedCodeRunnerError(
            "cas_integrity_failed",
            "The CAS staged re-read does not match the observed output bytes.",
          );
        }
        persisted.push(Object.freeze({
          ...output.declaration,
          bytes,
          byteCount: output.byteCount,
          sha256: output.sha256,
          casUri: write.casUri,
        }));
      }
      const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
        runId,
        producerGeneration,
        persisted.map(({ bytes: _bytes, ...output }) => output),
      );
      const publication = await createIsolatedOutputPublicationRef(
        runId,
        producerGeneration,
        publicationFingerprint,
      );
      const sealed = await seal(
        Object.freeze(persisted),
        publication,
      );
      const receipt = isolatedCodeExecutionReceiptRecord(sealed);
      let status: IsolatedOutputPublicationResolution["status"];
      try {
        status = await validatePublicationResolution(
          await this.#cas.commit(staged.batch, receipt),
          publication,
          receipt,
        );
      } catch {
        try {
          status = await validatePublicationResolution(
            await this.#cas.resolvePublication(publication),
            publication,
            receipt,
          );
        } catch {
          status = "outcome-unknown";
        }
      }
      if (status === "outcome-unknown") {
        try {
          status = await validatePublicationResolution(
            await this.#cas.resolvePublication(publication),
            publication,
            receipt,
          );
        } catch {
          status = "outcome-unknown";
        }
      }
      if (status === "published") return sealed;
      if (status === "outcome-unknown") {
        throw new BrokeredIsolatedCodeRunnerError(
          "cas_publication_outcome_unknown",
          "The isolated output publication outcome is unknown; execution will not be repeated by this broker.",
        );
      }
      await this.#abortCasBatch(runId, producerGeneration, staged.batch);
      throw new BrokeredIsolatedCodeRunnerError(
        "cas_integrity_failed",
        "The isolated output publication was proven absent; execution will not be repeated by this broker.",
      );
    } catch (failure) {
      if (
        failure instanceof BrokeredIsolatedCodeRunnerError &&
        ((failure.code === "cas_integrity_failed" &&
          failure.message.includes("execution will not be repeated")) ||
          failure.code === "cas_publication_outcome_unknown")
      ) {
        throw normalizeCasPublicationFailure(failure);
      }
      if (!await this.#abortCasBatch(runId, producerGeneration, staged.batch)) {
        throw new BrokeredIsolatedCodeRunnerError(
          "cas_integrity_failed",
          "The CAS batch failed and its staging cleanup also failed.",
        );
      }
      throw normalizeCasPublicationFailure(failure);
    }
  }

  async #abortCasBatch(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
    batch: CasBatch,
  ): Promise<boolean> {
    try {
      await this.#cas.abort(batch);
      return true;
    } catch {
      return await this.#abortCasByRunId(runId, producerGeneration);
    }
  }

  async #abortCasByRunId(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<boolean> {
    try {
      await this.#cas.abortByRunId(runId, producerGeneration);
      return true;
    } catch {
      return false;
    }
  }
}

function validateBackendLogs(
  value: unknown,
  runtime: IsolatedCodeRuntimeAttestation,
): { readonly stdout: EphemeralExecutionLog; readonly stderr: EphemeralExecutionLog } {
  const logs = exactRecord(value, ["stdout", "stderr"], "$backend.report.logs");
  return Object.freeze({
    stdout: validateBackendLog(
      logs.stdout,
      "$backend.report.logs.stdout",
      runtime.requestedLimits.maxStdoutBytes,
    ),
    stderr: validateBackendLog(
      logs.stderr,
      "$backend.report.logs.stderr",
      runtime.requestedLimits.maxStderrBytes,
    ),
  });
}

function validateBackendLog(
  value: unknown,
  path: string,
  byteCap: number,
): EphemeralExecutionLog {
  const log = exactRecord(value, ["bytes", "truncated"], path);
  if (typeof log.truncated !== "boolean") {
    throw new BrokeredIsolatedCodeRunnerError(
      "backend_contract_violation",
      "Backend logs must declare whether they were truncated.",
    );
  }
  const rawBytes = log.bytes;
  const observedByteLength = observedUint8ArrayByteLength(rawBytes, `${path}.bytes`);
  if (observedByteLength > byteCap) {
    throw new BrokeredIsolatedCodeRunnerError(
      "backend_contract_violation",
      "Backend logs exceed the server-owned byte cap.",
    );
  }
  const bytes = copyObservedUint8Array(rawBytes, `${path}.bytes`, byteCap);
  return Object.freeze({ bytes, truncated: log.truncated });
}

function validateInventoryEntry<OutputHandle>(
  value: unknown,
  index: number,
): EphemeralOutputInventoryEntry<OutputHandle> {
  const path = `$backend.inventory[${index}]`;
  const entry = exactRecord(
    value,
    ["handle", "basename", "kind", "claimedByteCount", "claimedSha256"],
    path,
  );
  const kind = nonEmptyText(entry.kind, `${path}.kind`);
  if (
    kind !== "file" && kind !== "directory" && kind !== "symlink" &&
    kind !== "hardlink" && kind !== "device" && kind !== "socket" &&
    kind !== "other"
  ) {
    throw new BrokeredIsolatedCodeRunnerError(
      "backend_contract_violation",
      "The backend output kind is unsupported.",
    );
  }
  if (
    !Number.isSafeInteger(entry.claimedByteCount) ||
    Number(entry.claimedByteCount) < 0
  ) {
    throw new BrokeredIsolatedCodeRunnerError(
      "backend_contract_violation",
      "The backend output byte-count claim is invalid.",
    );
  }
  return Object.freeze({
    handle: entry.handle as OutputHandle,
    basename: validateIsolatedCodeOutputBasename(
      entry.basename,
      `${path}.basename`,
    ),
    kind,
    claimedByteCount: Number(entry.claimedByteCount),
    claimedSha256: sha256Hex(entry.claimedSha256, `${path}.claimedSha256`),
  });
}

function assertExactOutputManifest<OutputHandle>(
  inventory: readonly EphemeralOutputInventoryEntry<OutputHandle>[],
  declarations: readonly IsolatedCodeOutputDeclaration[],
): void {
  const handles = new Set<OutputHandle>();
  const basenames = new Set<string>();
  const foldedBasenames = new Set<string>();
  for (const entry of inventory) {
    if (handles.has(entry.handle)) {
      throw new BrokeredIsolatedCodeRunnerError(
        "output_manifest_mismatch",
        "The backend output inventory contains a duplicate handle.",
      );
    }
    handles.add(entry.handle);
    if (
      basenames.has(entry.basename) ||
      foldedBasenames.has(entry.basename.toLowerCase())
    ) {
      throw new BrokeredIsolatedCodeRunnerError(
        "output_manifest_mismatch",
        "The backend output inventory contains a basename collision.",
      );
    }
    basenames.add(entry.basename);
    foldedBasenames.add(entry.basename.toLowerCase());
  }
  const expected = new Set(declarations.map((declaration) => declaration.basename));
  if (
    expected.size !== inventory.length ||
    inventory.some((entry) => !expected.has(entry.basename))
  ) {
    throw new BrokeredIsolatedCodeRunnerError(
      "output_manifest_mismatch",
      "Backend outputs do not match the declared manifest exactly.",
    );
  }
}

function validateAcceptedDestruction(
  value: unknown,
  minimum: "acknowledged-unattested" | "proven",
  expectedRunId: string,
): Exclude<EphemeralExecutionDestruction, { status: "unproven" }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$backend.destruction must be an object.");
  }
  const status = (value as { status?: unknown }).status;
  if (status === "unproven") {
    const unproven = exactRecord(
      value,
      ["status", "runId", "reason"],
      "$backend.destruction",
    );
    literalValue(unproven.status, "unproven", "$backend.destruction.status");
    requireMatchingRunId(
      unproven.runId,
      expectedRunId,
      "$backend.destruction.runId",
    );
    nonEmptyText(unproven.reason, "$backend.destruction.reason");
    throw new TypeError("Backend destruction is unproven.");
  }
  if (status === "acknowledged-unattested") {
    const acknowledged = exactRecord(
      value,
      ["status", "runId", "acknowledgementFingerprint"],
      "$backend.destruction",
    );
    if (minimum === "proven") {
      throw new TypeError("The server-owned policy requires proven destruction.");
    }
    return Object.freeze({
      status,
      runId: requireMatchingRunId(
        acknowledged.runId,
        expectedRunId,
        "$backend.destruction.runId",
      ),
      acknowledgementFingerprint: validateContentFingerprint(
        acknowledged.acknowledgementFingerprint,
        "$backend.destruction.acknowledgementFingerprint",
      ),
    });
  }
  const proven = exactRecord(
    value,
    ["status", "runId", "proofFingerprint"],
    "$backend.destruction",
  );
  literalValue(proven.status, "proven", "$backend.destruction.status");
  return Object.freeze({
    status: "proven",
    runId: requireMatchingRunId(
      proven.runId,
      expectedRunId,
      "$backend.destruction.runId",
    ),
    proofFingerprint: validateContentFingerprint(
      proven.proofFingerprint,
      "$backend.destruction.proofFingerprint",
    ),
  });
}

function assertBrokerObservedCaps(runtime: IsolatedCodeRuntimeAttestation): void {
  for (
    const key of [
      "maxWallTimeMs",
      "maxCpuTimeMs",
      "maxMemoryBytes",
      "maxProcesses",
    ] as const
  ) {
    if (runtime.limitAssurance[key] === "broker-observed-cap") {
      throw new TypeError(
        `${key} cannot be broker-observed-cap because this broker does not observe it.`,
      );
    }
  }
  for (
    const key of [
      "maxStdoutBytes",
      "maxStderrBytes",
      "maxOutputFileBytes",
      "maxOutputTotalBytes",
    ] as const
  ) {
    if (runtime.limitAssurance[key] !== "broker-observed-cap") {
      throw new TypeError(
        `${key} assurance must be broker-observed-cap for this broker.`,
      );
    }
  }
}

function validateCasWriteReceipt(
  value: unknown,
  expectedRole: string,
  expectedSha256: string,
): IsolatedOutputCasWriteReceipt {
  const write = exactRecord(
    value,
    ["role", "casUri", "byteCount", "sha256"],
    "$cas.writeReceipt",
  );
  if (!Number.isSafeInteger(write.byteCount) || Number(write.byteCount) < 0) {
    throw new BrokeredIsolatedCodeRunnerError(
      "cas_integrity_failed",
      "The CAS write receipt has an invalid byte count.",
    );
  }
  const sha256 = sha256Hex(write.sha256, "$cas.writeReceipt.sha256");
  const role = nonEmptyText(write.role, "$cas.writeReceipt.role");
  if (role !== expectedRole) {
    throw new BrokeredIsolatedCodeRunnerError(
      "cas_integrity_failed",
      "The CAS write receipt role does not match the staged output.",
    );
  }
  return Object.freeze({
    role,
    casUri: validateIsolatedOutputCasUri(
      write.casUri,
      expectedSha256,
      "$cas.writeReceipt.casUri",
    ),
    byteCount: Number(write.byteCount),
    sha256,
  });
}

function validateStagedBatch<Batch>(
  value: unknown,
  expectedRunId: string,
  expectedProducerGeneration: IsolatedOutputProducerGeneration,
  outputs: readonly PreparedOutput[],
): StagedIsolatedOutputBatch<Batch> {
  const staged = exactRecord(
    value,
    ["batch", "runId", "producerGeneration", "receipts"],
    "$cas.stagedBatch",
  );
  const runId = requireMatchingRunId(
    staged.runId,
    expectedRunId,
    "$cas.stagedBatch.runId",
  );
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    staged.producerGeneration,
    "$cas.stagedBatch.producerGeneration",
  );
  if (producerGeneration !== expectedProducerGeneration) {
    throw new BrokeredIsolatedCodeRunnerError(
      "cas_integrity_failed",
      "The staged CAS generation does not match the execution dispatch.",
    );
  }
  const receiptValues = staged.receipts;
  if (!Array.isArray(receiptValues) || receiptValues.length !== outputs.length) {
    throw new BrokeredIsolatedCodeRunnerError(
      "cas_integrity_failed",
      "The staged CAS receipts do not match the output batch exactly.",
    );
  }
  const receipts = outputs.map((output, index) => {
    const receipt = validateCasWriteReceipt(
      receiptValues[index],
      output.declaration.role,
      output.sha256,
    );
    if (
      receipt.byteCount !== output.byteCount || receipt.sha256 !== output.sha256
    ) {
      throw new BrokeredIsolatedCodeRunnerError(
        "cas_integrity_failed",
        "A staged CAS receipt does not match the observed output.",
      );
    }
    return receipt;
  });
  return Object.freeze({
    batch: staged.batch as Batch,
    runId,
    producerGeneration,
    receipts: Object.freeze(receipts),
  });
}

function requireMatchingRunId(
  value: unknown,
  expected: string,
  path: string,
): string {
  const runId = nonEmptyText(value, path);
  if (runId !== expected) {
    throw new TypeError(`${path} does not match the execution run.`);
  }
  return runId;
}

async function validatePublicationResolution(
  value: unknown,
  expectedRef: IsolatedOutputPublicationRef,
  expectedReceipt: ReturnType<typeof isolatedCodeExecutionReceiptRecord>,
): Promise<IsolatedOutputPublicationResolution["status"]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BrokeredIsolatedCodeRunnerError(
      "cas_integrity_failed",
      "The CAS publication resolution failed exact validation.",
    );
  }
  const rawStatus = (value as { status?: unknown }).status;
  try {
    if (rawStatus === "published") {
      const published = exactRecord(
        value,
        ["status", "ref", "receipt"],
        "$cas.publication",
      );
      const ref = await validateIsolatedOutputPublicationRef(
        published.ref,
        expectedRef.runId,
        "$cas.publication.ref",
      );
      const receipt = await validateIsolatedCodeExecutionReceiptRecord(
        published.receipt,
      );
      if (
        !fingerprintsEqual(ref.fingerprint, expectedRef.fingerprint) ||
        ref.manifestUri !== expectedRef.manifestUri ||
        deterministicJson(receipt) !== deterministicJson(expectedReceipt)
      ) {
        throw new TypeError("publication does not match");
      }
      return "published";
    }
    if (rawStatus === "not-published" || rawStatus === "outcome-unknown") {
      const unresolved = exactRecord(value, ["status", "ref"], "$cas.publication");
      const ref = await validateIsolatedOutputPublicationRef(
        unresolved.ref,
        expectedRef.runId,
        "$cas.publication.ref",
      );
      if (
        !fingerprintsEqual(ref.fingerprint, expectedRef.fingerprint) ||
        ref.manifestUri !== expectedRef.manifestUri
      ) {
        throw new TypeError("publication does not match");
      }
      return rawStatus;
    }
  } catch {
    // Rebuild below; never retain an adapter-owned error or capability.
  }
  throw new BrokeredIsolatedCodeRunnerError(
    "cas_integrity_failed",
    "The CAS publication resolution failed exact validation.",
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

function requireRecoveryRunId(value: unknown): string {
  try {
    return safeId(value, "$recovery.runId");
  } catch {
    throw new BrokeredIsolatedCodeRunnerError(
      "invalid_request",
      "The isolated execution recovery run id failed exact validation.",
    );
  }
}

class IsolatedExecutionRejectionInspection {
  readonly diagnostic: IsolatedCodeExecutionRejectionDiagnostic;

  constructor(diagnostic: IsolatedCodeExecutionRejectionDiagnostic) {
    this.diagnostic = validateIsolatedCodeExecutionRejectionDiagnostic(diagnostic);
  }
}

class IsolatedOutputValidationRejectionInspection {
  readonly observation: IsolatedCodeOutputValidationRejection;

  constructor(observation: IsolatedCodeOutputValidationRejection) {
    this.observation = validateIsolatedCodeOutputValidationRejection(observation);
  }
}

function normalizeBackendInspectionFailure(
  failure: unknown,
):
  | BrokeredIsolatedCodeRunnerError
  | IsolatedExecutionRejectionInspection
  | IsolatedOutputValidationRejectionInspection {
  try {
    if (failure instanceof IsolatedOutputValidationRejectionInspection) {
      return new IsolatedOutputValidationRejectionInspection(failure.observation);
    }
    if (failure instanceof IsolatedExecutionRejectionInspection) {
      return new IsolatedExecutionRejectionInspection(failure.diagnostic);
    }
    if (failure instanceof BrokeredIsolatedCodeRunnerError) {
      const code = failure.code;
      const message = failure.message;
      const key = `${code}\0${message}`;
      if (SAFE_BACKEND_INSPECTION_ERROR_KEYS.has(key)) {
        // Always rebuild the error. Even an object with this prototype may have
        // originated in a hostile adapter with an attached cause or pathful
        // stack; only code-owned code/message pairs cross the public boundary.
        return new BrokeredIsolatedCodeRunnerError(
          code,
          message,
        );
      }
    }
  } catch {
    // Proxies may throw from prototype or property access. Fall through to the
    // stable generic contract error without retaining the hostile object.
  }
  return new BrokeredIsolatedCodeRunnerError(
    "backend_contract_violation",
    "The isolated execution backend returned an invalid result.",
  );
}

const SAFE_BACKEND_INSPECTION_ERROR_KEYS = new Set<string>([
  "infrastructure_failure\0The isolated execution backend did not return a report.",
  "infrastructure_failure\0The isolated output inventory could not be read.",
  "infrastructure_failure\0A declared isolated output could not be read.",
  "backend_contract_violation\0The backend runtime attestation does not match the server-owned policy.",
  "backend_contract_violation\0The isolated output inventory is not an array.",
  "backend_contract_violation\0The backend returned non-byte output content.",
  "backend_contract_violation\0Backend logs must contain bytes.",
  "backend_contract_violation\0Backend logs must declare whether they were truncated.",
  "backend_contract_violation\0Backend logs exceed the server-owned byte cap.",
  "backend_contract_violation\0The backend output kind is unsupported.",
  "backend_contract_violation\0The backend output byte-count claim is invalid.",
  "output_manifest_mismatch\0Backend outputs do not match the declared manifest exactly.",
  "output_manifest_mismatch\0Every declared output must resolve to one regular file.",
  "output_manifest_mismatch\0The backend output inventory contains a duplicate handle.",
  "output_manifest_mismatch\0The backend output inventory contains a basename collision.",
  "output_quota_exceeded\0An isolated output exceeds the per-file byte cap.",
  "output_quota_exceeded\0Isolated outputs exceed the total byte cap.",
  "output_integrity_failed\0Backend output size or digest claims do not match observed bytes.",
]);

function normalizeCasPublicationFailure(
  failure: unknown,
): BrokeredIsolatedCodeRunnerError {
  try {
    if (failure instanceof BrokeredIsolatedCodeRunnerError) {
      const code = failure.code;
      const message = failure.message;
      const key = `${code}\0${message}`;
      if (SAFE_CAS_PUBLICATION_ERROR_KEYS.has(key)) {
        return new BrokeredIsolatedCodeRunnerError(
          code,
          message,
        );
      }
    }
  } catch {
    // Hostile adapters may reject with a Proxy that throws from prototype or
    // property access. Never retain or expose that value.
  }
  return new BrokeredIsolatedCodeRunnerError(
    "cas_integrity_failed",
    "The isolated output batch could not be published atomically.",
  );
}

const SAFE_CAS_PUBLICATION_ERROR_KEYS = new Set<string>([
  "cas_integrity_failed\0An isolated output could not be re-read from CAS staging.",
  "cas_integrity_failed\0The CAS staged re-read did not return bytes.",
  "cas_integrity_failed\0The CAS staged re-read does not match the observed output bytes.",
  "cas_integrity_failed\0The CAS publication resolution failed exact validation.",
  "cas_integrity_failed\0The isolated output publication was proven absent; execution will not be repeated by this broker.",
  "cas_publication_outcome_unknown\0The isolated output publication outcome is unknown; execution will not be repeated by this broker.",
]);
