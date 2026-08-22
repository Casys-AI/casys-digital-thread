import type {
  IsolatedOutputCasObject,
  IsolatedOutputCasSink,
  IsolatedOutputCasWriteReceipt,
  IsolatedOutputPublicationReader,
  IsolatedOutputPublicationResolution,
  IsolatedOutputRunPublicationResolution,
  StagedIsolatedOutputBatch,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  copyObservedUint8Array,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceipt,
  type IsolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputReceiptRecord,
  type IsolatedOutputProducerGeneration,
  type IsolatedOutputProducerGenerationAdvance,
  type IsolatedOutputProducerGenerationAdvanceInput,
  isolatedOutputPublicationManifestUri,
  type IsolatedOutputPublicationRef,
  restoreIsolatedCodeExecutionReceipt,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeOutputDeclaration,
  validateIsolatedCodeOutputReceiptRecord,
  validateIsolatedOutputCasUri,
  validateIsolatedOutputProducerGeneration,
  validateIsolatedOutputProducerGenerationAdvance,
  validateIsolatedOutputPublicationRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  fingerprintResourceBytes,
  sha256Hex,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { FileByteStore } from "./file-byte-store.ts";

const PUBLICATION_MARKER_SCHEMA = "isolated-output-publication-marker/1.0" as const;
const STAGED_BATCH_SCHEMA = "isolated-output-staged-batch/1.0" as const;
const RUN_CLOSED_FENCE_SCHEMA = "isolated-output-run-closed-fence/1.0" as const;
const PUBLICATION_URI_PREFIX = "casys://isolated-output-publication/sha256/" as const;
const ISOLATED_OUTPUT_OBJECTS_SEGMENT = "objects" as const;

/** Digest-addressed object directory owned by `FileIsolatedOutputCas`. */
export function isolatedOutputCasObjectStore(
  root: string,
): FileByteStore<"isolated-output"> {
  return new FileByteStore({
    kind: "isolated-output",
    directory: isolatedOutputCasObjectDirectory(root),
    uriNamespace: "isolated-output",
    label: "Isolated output",
  });
}

function isolatedOutputCasObjectDirectory(root: string): string {
  return `${
    absoluteStorageRoot(validateStorageRoot(root))
  }/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}`;
}

export interface FileIsolatedOutputCasSeams {
  readonly afterObjectDurable?: (role: string) => void | Promise<void>;
  readonly afterReceiptDurable?: () => void | Promise<void>;
  /** Test seam for a lost acknowledgement after the linearization point. */
  readonly afterMarkerDurable?: () => void | Promise<void>;
  /** Test seam for a lost acknowledgement after the run fence is durable. */
  readonly afterRunFenceDurable?: (runId: string) => void | Promise<void>;
  /** Test seam for a lost acknowledgement after generation 1 is durable. */
  readonly afterProducerGenerationAdvanceDurable?: (
    advance: IsolatedOutputProducerGenerationAdvance,
  ) => void | Promise<void>;
}

interface StagedObjectRecord extends IsolatedOutputCasWriteReceipt {
  readonly mediaType: string;
  readonly format: string;
  readonly basename: string;
  readonly stagingPath: string;
}

interface BatchState {
  readonly batchId: string;
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly runKey: string;
  readonly directory: string;
  readonly objects: readonly StagedObjectRecord[];
}

/** Opaque adapter capability. Its paths live only in a module-private WeakMap. */
export class FileIsolatedOutputBatch {
  readonly id: string;

  constructor(token: symbol, id: string) {
    if (token !== FILE_BATCH_TOKEN) {
      throw new TypeError("FileIsolatedOutputBatch is adapter-owned.");
    }
    this.id = id;
    Object.freeze(this);
  }
}

const FILE_BATCH_TOKEN = Symbol("file-isolated-output-batch");

export class FileIsolatedOutputCasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileIsolatedOutputCasError";
  }
}

/**
 * Filesystem CAS whose only visibility boundary is a run-keyed marker.
 *
 * Objects and receipt records may exist before that marker (for crash safety),
 * but the public reader never addresses them directly. `abort` removes one
 * batch. `abortByRunId` first writes a durable generation fence and then removes
 * that generation's staging, so a producer delayed past cleanup cannot publish.
 * One durable server-owned advance may authorize generation 1. Shared object
 * digests remain safe across concurrent publications.
 */
export class FileIsolatedOutputCas
  implements
    IsolatedOutputCasSink<FileIsolatedOutputBatch>,
    IsolatedOutputPublicationReader {
  readonly #root: string;
  readonly #objects: FileByteStore<"isolated-output">;
  readonly #receipts: FileByteStore<"isolated-output-receipt-record">;
  readonly #batches = new WeakMap<FileIsolatedOutputBatch, BatchState>();
  readonly #seams: FileIsolatedOutputCasSeams;

  constructor(root: string, seams: FileIsolatedOutputCasSeams = {}) {
    this.#root = absoluteStorageRoot(validateStorageRoot(root));
    this.#objects = isolatedOutputCasObjectStore(this.#root);
    this.#receipts = new FileByteStore({
      kind: "isolated-output-receipt-record",
      directory: `${this.#root}/receipts`,
      uriNamespace: "isolated-output-receipt-record",
      label: "Isolated output receipt record",
    });
    this.#seams = Object.freeze({ ...seams });
  }

  async stageBatch(
    objectValues: readonly IsolatedOutputCasObject[],
  ): Promise<StagedIsolatedOutputBatch<FileIsolatedOutputBatch>> {
    await this.#ensureAnchoredRoot();
    if (!Array.isArray(objectValues) || objectValues.length === 0) {
      throw new FileIsolatedOutputCasError("A non-empty output batch is required.");
    }
    const objects: Array<IsolatedOutputCasObject & { readonly casUri: string }> = [];
    const roles = new Set<string>();
    let runId: string | undefined;
    let producerGeneration: IsolatedOutputProducerGeneration | undefined;
    for (const [index, value] of objectValues.entries()) {
      const object = await validateCasObject(value, index);
      runId ??= object.runId;
      producerGeneration ??= object.producerGeneration;
      if (object.runId !== runId) {
        throw new FileIsolatedOutputCasError(
          "Every staged object must name the same execution run.",
        );
      }
      if (object.producerGeneration !== producerGeneration) {
        throw new FileIsolatedOutputCasError(
          "Every staged object must name the same producer generation.",
        );
      }
      if (roles.has(object.role)) {
        throw new FileIsolatedOutputCasError("Staged output roles must be unique.");
      }
      roles.add(object.role);
      objects.push(object);
    }
    const exactRunId = runId!;
    const exactProducerGeneration = producerGeneration!;
    const runKey = await isolatedOutputRunKey(exactRunId);
    return await this.#withRunLock(runKey, async () => {
      await this.#assertProducerGenerationOpen(
        exactRunId,
        runKey,
        exactProducerGeneration,
      );
      const batchId = crypto.randomUUID();
      const directory =
        `${this.#root}/staging/${runKey}/${exactProducerGeneration}/${batchId}`;
      const objectDirectory = `${directory}/objects`;
      await this.#ensurePrivateDirectory(objectDirectory);

      const staged: StagedObjectRecord[] = [];
      try {
        for (const [index, object] of objects.entries()) {
          const path = `${objectDirectory}/${index}.bin`;
          await writeNewBytesDurably(path, object.bytes, objectDirectory);
          const reread = await Deno.readFile(path);
          if (
            reread.byteLength !== object.byteCount ||
            await fingerprintResourceBytes(reread) !== object.sha256 ||
            !bytesEqual(reread, object.bytes)
          ) {
            throw new FileIsolatedOutputCasError(
              "A staged output failed its durable reread.",
            );
          }
          staged.push(Object.freeze({
            role: object.role,
            basename: object.basename,
            mediaType: object.mediaType,
            format: object.format,
            casUri: object.casUri,
            byteCount: object.byteCount,
            sha256: object.sha256,
            stagingPath: path,
          }));
        }
        await writeNewBytesDurably(
          `${directory}/stage.json`,
          encodeCanonical({
            schemaVersion: STAGED_BATCH_SCHEMA,
            batchId,
            runId: exactRunId,
            producerGeneration: exactProducerGeneration,
            objects: staged.map(({ stagingPath: _path, ...object }) => object),
          }),
          directory,
        );
      } catch (failure) {
        await this.#removeStagingDirectory(directory);
        throw failure;
      }

      const batch = new FileIsolatedOutputBatch(FILE_BATCH_TOKEN, batchId);
      this.#batches.set(
        batch,
        Object.freeze({
          batchId,
          runId: exactRunId,
          producerGeneration: exactProducerGeneration,
          runKey,
          directory,
          objects: Object.freeze(staged),
        }),
      );
      return Object.freeze({
        batch,
        runId: exactRunId,
        producerGeneration: exactProducerGeneration,
        receipts: Object.freeze(staged.map((object) =>
          Object.freeze({
            role: object.role,
            casUri: object.casUri,
            byteCount: object.byteCount,
            sha256: object.sha256,
          })
        )),
      });
    });
  }

  async readStaged(
    batch: FileIsolatedOutputBatch,
    casUri: string,
  ): Promise<Uint8Array> {
    await this.#assertAnchoredRoot();
    const state = this.#batchState(batch);
    const matches = state.objects.filter((object) => object.casUri === casUri);
    if (matches.length !== 1) {
      throw new FileIsolatedOutputCasError(
        "The requested object is not an exact member of this staged batch.",
      );
    }
    const member = matches[0]!;
    await assertRegularFileWithinRoot(
      this.#root,
      member.stagingPath,
      "Staged output",
    );
    const bytes = await Deno.readFile(member.stagingPath);
    await assertObjectBytes(bytes, member);
    return Uint8Array.from(bytes);
  }

  async commit(
    batch: FileIsolatedOutputBatch,
    receiptValue: IsolatedCodeExecutionReceiptRecord,
  ): Promise<IsolatedOutputPublicationResolution> {
    await this.#assertAnchoredRoot();
    const state = this.#batchState(batch);
    const receipt = await validateIsolatedCodeExecutionReceiptRecord(receiptValue);
    await assertReceiptMatchesBatch(receipt, state);

    return await this.#withRunLock(state.runKey, async () => {
      await this.#assertProducerGenerationOpen(
        state.runId,
        state.runKey,
        state.producerGeneration,
      );
      await this.#ensurePrivateDirectory(
        `${this.#root}/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}`,
      );
      for (const member of state.objects) {
        await assertRegularFileWithinRoot(
          this.#root,
          member.stagingPath,
          "Staged output",
        );
        const bytes = await Deno.readFile(member.stagingPath);
        await assertObjectBytes(bytes, member);
        const objectPath =
          `${this.#root}/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}/${member.sha256}`;
        await assertMissingOrRegularFileWithinRoot(
          this.#root,
          objectPath,
          "Isolated output object",
        );
        await this.#objects.save(
          { algorithm: "sha256", digest: member.sha256 },
          bytes,
        );
        await assertRegularFileWithinRoot(
          this.#root,
          objectPath,
          "Isolated output object",
        );
        await Deno.chmod(objectPath, 0o600);
        await this.#seams.afterObjectDurable?.(member.role);
      }

      const receiptBytes = encodeCanonical(receipt);
      const receiptRecordFingerprint = await fingerprintBytes(receiptBytes);
      await this.#ensurePrivateDirectory(`${this.#root}/receipts`);
      const receiptPath = `${this.#root}/receipts/${receiptRecordFingerprint.digest}`;
      await assertMissingOrRegularFileWithinRoot(
        this.#root,
        receiptPath,
        "Receipt record",
      );
      const storedReceipt = await this.#receipts.save(
        receiptRecordFingerprint,
        receiptBytes,
      );
      await assertRegularFileWithinRoot(
        this.#root,
        receiptPath,
        "Receipt record",
      );
      await Deno.chmod(receiptPath, 0o600);
      if (
        storedReceipt.byteCount !== receiptBytes.byteLength ||
        !bytesEqual(storedReceipt.copyBytes(), receiptBytes)
      ) {
        throw new FileIsolatedOutputCasError(
          "The durable receipt record failed its exact reread.",
        );
      }
      await this.#seams.afterReceiptDurable?.();

      const marker = Object.freeze({
        schemaVersion: PUBLICATION_MARKER_SCHEMA,
        ref: receipt.publication.ref,
        receiptRecordFingerprint,
        receiptRecordByteCount: receiptBytes.byteLength,
      });
      const markerPath = this.#markerPath(receipt.publication.ref);
      await this.#ensurePrivateDirectory(`${this.#root}/publications`);
      try {
        await writeNewBytesDurably(
          markerPath,
          encodeCanonical(marker),
          `${this.#root}/publications`,
        );
        await assertRegularFileWithinRoot(
          this.#root,
          markerPath,
          "Publication marker",
        );
        await Deno.chmod(markerPath, 0o600);
      } catch (failure) {
        if (!(failure instanceof Deno.errors.AlreadyExists)) throw failure;
        // A concurrent exact commit is resolved below; a divergent marker stays
        // outcome-unknown and is never overwritten.
      }
      await this.#seams.afterMarkerDurable?.();
      const resolution = await this.resolvePublication(receipt.publication.ref);
      if (resolution.status === "published") {
        await this.#removeStagingDirectory(state.directory).catch(() => undefined);
        this.#batches.delete(batch);
      }
      return resolution;
    });
  }

  async resolvePublication(
    refValue: IsolatedOutputPublicationRef,
  ): Promise<IsolatedOutputPublicationResolution> {
    await this.#ensureAnchoredRoot();
    const ref = await validateIsolatedOutputPublicationRef(refValue);
    let markerBytes: Uint8Array;
    try {
      const markerPath = this.#markerPath(ref);
      await assertRegularFileWithinRoot(
        this.#root,
        markerPath,
        "Publication marker",
      );
      markerBytes = await Deno.readFile(markerPath);
    } catch (failure) {
      if (failure instanceof Deno.errors.NotFound) {
        try {
          if (
            await this.#producerGenerationStatus(
              ref.runId,
              await isolatedOutputRunKey(ref.runId),
              ref.producerGeneration,
            ) === "unknown"
          ) {
            return Object.freeze({ status: "outcome-unknown", ref });
          }
        } catch {
          return Object.freeze({ status: "outcome-unknown", ref });
        }
        return Object.freeze({ status: "not-published", ref });
      }
      return Object.freeze({ status: "outcome-unknown", ref });
    }
    try {
      // A prior commit may have lost the directory-fsync acknowledgement after
      // linking the marker. Close that durability window before classifying a
      // currently visible marker as published.
      await syncDirectory(`${this.#root}/publications`);
      const marker = await validateMarker(markerBytes, ref);
      const receiptPath =
        `${this.#root}/receipts/${marker.receiptRecordFingerprint.digest}`;
      await assertRegularFileWithinRoot(
        this.#root,
        receiptPath,
        "Receipt record",
      );
      const receiptBytes = await this.#receipts.read(
        marker.receiptRecordFingerprint,
      );
      if (
        receiptBytes === undefined ||
        receiptBytes.byteLength !== marker.receiptRecordByteCount
      ) {
        throw new FileIsolatedOutputCasError("Publication receipt is unavailable.");
      }
      const receiptText = new TextDecoder().decode(receiptBytes.copy());
      const receipt = await validateIsolatedCodeExecutionReceiptRecord(
        JSON.parse(receiptText),
      );
      if (
        receiptText !== deterministicJson(receipt) ||
        !publicationRefsEqual(receipt.publication.ref, ref)
      ) {
        throw new FileIsolatedOutputCasError("Publication receipt is divergent.");
      }
      const canonicalFingerprint = await fingerprintIsolatedOutputPublicationManifest(
        receipt.runId,
        receipt.producerGeneration,
        receipt.outputs.map(publicationObjectTuple),
      );
      if (!fingerprintsEqual(canonicalFingerprint, ref.fingerprint)) {
        throw new FileIsolatedOutputCasError(
          "Publication fingerprint does not match its receipt.",
        );
      }
      for (const output of receipt.outputs) {
        await assertRegularFileWithinRoot(
          this.#root,
          `${this.#root}/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}/${output.sha256}`,
          "Isolated output object",
        );
        const bytes = await this.#objects.read({
          algorithm: "sha256",
          digest: output.sha256,
        });
        if (bytes === undefined || bytes.byteLength !== output.byteCount) {
          throw new FileIsolatedOutputCasError(
            "A published output object is unavailable.",
          );
        }
      }
      return Object.freeze({ status: "published", ref, receipt });
    } catch {
      return Object.freeze({ status: "outcome-unknown", ref });
    }
  }

  async resolvePublicationByRunId(
    runIdValue: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedOutputRunPublicationResolution> {
    await this.#ensureAnchoredRoot();
    const runId = safeId(runIdValue, "$runId");
    const runKey = await isolatedOutputRunKey(runId);
    return await this.#withRunLock(
      runKey,
      async () =>
        await this.#resolvePublicationByRunIdUnlocked(
          runId,
          runKey,
          producerGeneration,
        ),
    );
  }

  async #resolvePublicationByRunIdUnlocked(
    runId: string,
    runKey: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<IsolatedOutputRunPublicationResolution> {
    const manifestUri = await isolatedOutputPublicationManifestUri(
      runId,
      producerGeneration,
    );
    let markerBytes: Uint8Array;
    try {
      const markerPath = this.#markerPathForManifestUri(manifestUri);
      await assertRegularFileWithinRoot(
        this.#root,
        markerPath,
        "Publication marker",
      );
      markerBytes = await Deno.readFile(markerPath);
    } catch (failure) {
      if (failure instanceof Deno.errors.NotFound) {
        try {
          if (
            await this.#producerGenerationStatus(
              runId,
              runKey,
              producerGeneration,
            ) === "unknown"
          ) {
            return Object.freeze({
              status: "outcome-unknown",
              runId,
              producerGeneration,
            });
          }
        } catch {
          return Object.freeze({
            status: "outcome-unknown",
            runId,
            producerGeneration,
          });
        }
        return Object.freeze({ status: "not-published", runId, producerGeneration });
      }
      return Object.freeze({ status: "outcome-unknown", runId, producerGeneration });
    }
    try {
      const marker = await validateMarkerForRun(
        markerBytes,
        runId,
        producerGeneration,
      );
      const resolution = await this.resolvePublication(marker.ref);
      if (resolution.status !== "published") {
        // A marker was observed. Its disappearance or later unreadability is
        // ambiguity, never proof that publication did not happen.
        return Object.freeze({ status: "outcome-unknown", runId, producerGeneration });
      }
      return Object.freeze({
        status: "published",
        runId,
        producerGeneration,
        ref: resolution.ref,
        receipt: resolution.receipt,
      });
    } catch {
      return Object.freeze({ status: "outcome-unknown", runId, producerGeneration });
    }
  }

  async readReceipt(
    ref: IsolatedOutputPublicationRef,
  ): Promise<IsolatedCodeExecutionReceipt | undefined> {
    const resolution = await this.resolvePublication(ref);
    if (resolution.status === "not-published") return undefined;
    if (resolution.status === "outcome-unknown") {
      throw new FileIsolatedOutputCasError(
        "The isolated output publication cannot be resolved safely.",
      );
    }
    const outputBytes = await Promise.all(
      resolution.receipt.outputs.map(async (output) => {
        await assertRegularFileWithinRoot(
          this.#root,
          `${this.#root}/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}/${output.sha256}`,
          "Isolated output object",
        );
        const bytes = await this.#objects.read({
          algorithm: "sha256",
          digest: output.sha256,
        });
        if (bytes === undefined) {
          throw new FileIsolatedOutputCasError("A published output is unavailable.");
        }
        return { role: output.role, bytes: bytes.copy() };
      }),
    );
    return await restoreIsolatedCodeExecutionReceipt(
      resolution.receipt,
      outputBytes,
    );
  }

  async readPublishedObject(
    ref: IsolatedOutputPublicationRef,
    memberValue: IsolatedCodeOutputReceiptRecord,
  ): Promise<Uint8Array | undefined> {
    const member = validateIsolatedCodeOutputReceiptRecord(
      memberValue,
      "$publishedMember",
      Number.MAX_SAFE_INTEGER,
    );
    const resolution = await this.resolvePublication(ref);
    if (resolution.status === "not-published") return undefined;
    if (resolution.status === "outcome-unknown") {
      throw new FileIsolatedOutputCasError(
        "The isolated output publication cannot be resolved safely.",
      );
    }
    const matches = resolution.receipt.outputs.filter((output) =>
      deterministicJson(output) === deterministicJson(member)
    );
    if (matches.length !== 1) {
      throw new FileIsolatedOutputCasError(
        "The requested object is not an exact publication member.",
      );
    }
    await assertRegularFileWithinRoot(
      this.#root,
      `${this.#root}/${ISOLATED_OUTPUT_OBJECTS_SEGMENT}/${member.sha256}`,
      "Isolated output object",
    );
    const bytes = await this.#objects.read({
      algorithm: "sha256",
      digest: member.sha256,
    });
    if (bytes === undefined || bytes.byteLength !== member.byteCount) {
      throw new FileIsolatedOutputCasError("The published object is unavailable.");
    }
    return bytes.copy();
  }

  async abort(batch: FileIsolatedOutputBatch): Promise<void> {
    await this.#assertAnchoredRoot();
    const state = this.#batchState(batch);
    await this.#withRunLock(state.runKey, async () => {
      await this.#removeStagingDirectory(state.directory);
      this.#batches.delete(batch);
    });
  }

  async abortByRunId(
    runIdValue: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<void> {
    await this.#ensureAnchoredRoot();
    const runId = safeId(runIdValue, "$runId");
    const runKey = await isolatedOutputRunKey(runId);
    await this.#withRunLock(runKey, async () => {
      if (
        await this.#publicationMarkerStatus(runId, producerGeneration) !==
          "absent"
      ) {
        throw new FileIsolatedOutputCasError(
          "Run-scoped abort cannot close a published or ambiguous generation.",
        );
      }
      await this.#writeRunFence(runId, runKey, producerGeneration);
      await this.#seams.afterRunFenceDurable?.(runId);
      await this.#removeStagingDirectory(
        `${this.#root}/staging/${runKey}/${producerGeneration}`,
      );
    });
  }

  async advanceProducerGeneration(
    input: IsolatedOutputProducerGenerationAdvanceInput,
  ): Promise<IsolatedOutputProducerGenerationAdvance> {
    await this.#ensureAnchoredRoot();
    const advance = await createIsolatedOutputProducerGenerationAdvance(input);
    const runKey = await isolatedOutputRunKey(advance.runId);
    return await this.#withRunLock(runKey, async () => {
      if (
        await this.#publicationMarkerStatus(advance.runId, 0) !== "absent" ||
        await this.#publicationMarkerStatus(advance.runId, 1) !== "absent"
      ) {
        throw new FileIsolatedOutputCasError(
          "Producer generation cannot advance after a publication marker exists.",
        );
      }
      if (await this.#runFenceStatus(advance.runId, runKey, 0) !== "closed") {
        throw new FileIsolatedOutputCasError(
          "Producer generation 0 must be durably closed before generation 1 is authorized.",
        );
      }
      if (await this.#runFenceStatus(advance.runId, runKey, 1) !== "open") {
        throw new FileIsolatedOutputCasError(
          "Producer generation 1 is already closed or cannot be resolved safely.",
        );
      }
      const directory = `${this.#root}/generation-advances`;
      const path = `${directory}/${runKey}.json`;
      await this.#ensurePrivateDirectory(directory);
      try {
        await writeNewBytesDurably(path, encodeCanonical(advance), directory);
      } catch (failure) {
        if (!(failure instanceof Deno.errors.AlreadyExists)) throw failure;
      }
      await syncDirectory(directory);
      const reread = await this.#readProducerGenerationAdvance(
        advance.runId,
        runKey,
      );
      if (
        reread === undefined ||
        deterministicJson(reread) !== deterministicJson(advance)
      ) {
        throw new FileIsolatedOutputCasError(
          "The producer generation advance failed its durable exact reread.",
        );
      }
      await Deno.chmod(path, 0o600);
      await this.#seams.afterProducerGenerationAdvanceDurable?.(advance);
      return advance;
    });
  }

  async #assertProducerGenerationOpen(
    runId: string,
    runKey: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<void> {
    const publication = await this.#publicationMarkerStatus(
      runId,
      producerGeneration,
    );
    if (publication === "present") {
      throw new FileIsolatedOutputCasError(
        "The isolated execution generation has already published.",
      );
    }
    if (publication === "unknown") {
      throw new FileIsolatedOutputCasError(
        "The isolated execution publication marker cannot be resolved safely.",
      );
    }
    const status = await this.#producerGenerationStatus(
      runId,
      runKey,
      producerGeneration,
    );
    if (status === "closed") {
      throw new FileIsolatedOutputCasError(
        "The isolated execution run is durably fenced against staging or publication.",
      );
    }
    if (status === "unknown") {
      throw new FileIsolatedOutputCasError(
        "The isolated execution run fence cannot be resolved safely.",
      );
    }
  }

  async #writeRunFence(
    runId: string,
    runKey: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<void> {
    const directory = `${this.#root}/run-fences`;
    const path = `${directory}/${runKey}-${producerGeneration}.json`;
    await this.#ensurePrivateDirectory(directory);
    try {
      await writeNewBytesDurably(
        path,
        encodeCanonical({
          schemaVersion: RUN_CLOSED_FENCE_SCHEMA,
          runId,
          runKey,
          producerGeneration,
        }),
        directory,
      );
    } catch (failure) {
      if (!(failure instanceof Deno.errors.AlreadyExists)) throw failure;
    }
    // A retry may observe the winning link before its creator fsyncs the parent.
    // Synchronize unconditionally before acknowledging the exact fence.
    await syncDirectory(directory);
    if (
      await this.#runFenceStatus(runId, runKey, producerGeneration) !== "closed"
    ) {
      throw new FileIsolatedOutputCasError(
        "The isolated execution run fence failed its durable exact reread.",
      );
    }
    await Deno.chmod(path, 0o600);
  }

  async #runFenceStatus(
    runId: string,
    runKey: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<"open" | "closed" | "unknown"> {
    const path = `${this.#root}/run-fences/${runKey}-${producerGeneration}.json`;
    let bytes: Uint8Array;
    try {
      await assertRegularFileWithinRoot(this.#root, path, "Run fence");
      bytes = await Deno.readFile(path);
    } catch (failure) {
      if (failure instanceof Deno.errors.NotFound) return "open";
      return "unknown";
    }
    try {
      validateRunFence(bytes, runId, runKey, producerGeneration);
      return "closed";
    } catch {
      return "unknown";
    }
  }

  async #producerGenerationStatus(
    runId: string,
    runKey: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<"open" | "closed" | "unknown"> {
    const fence = await this.#runFenceStatus(
      runId,
      runKey,
      producerGeneration,
    );
    if (fence !== "open") return fence;
    const advance = await this.#readProducerGenerationAdvance(runId, runKey);
    if (producerGeneration === 0) {
      return advance === undefined ? "open" : "unknown";
    }
    return advance === undefined ? "closed" : "open";
  }

  async #readProducerGenerationAdvance(
    runId: string,
    runKey: string,
  ): Promise<IsolatedOutputProducerGenerationAdvance | undefined> {
    const path = `${this.#root}/generation-advances/${runKey}.json`;
    let bytes: Uint8Array;
    try {
      await assertRegularFileWithinRoot(this.#root, path, "Generation advance");
      bytes = await Deno.readFile(path);
    } catch (failure) {
      if (failure instanceof Deno.errors.NotFound) return undefined;
      throw new FileIsolatedOutputCasError(
        "The producer generation advance cannot be resolved safely.",
      );
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const advance = await validateIsolatedOutputProducerGenerationAdvance(
        JSON.parse(text),
        runId,
      );
      if (text !== deterministicJson(advance)) throw new TypeError("non-canonical");
      return advance;
    } catch {
      throw new FileIsolatedOutputCasError(
        "The producer generation advance cannot be resolved safely.",
      );
    }
  }

  async #publicationMarkerStatus(
    runId: string,
    producerGeneration: IsolatedOutputProducerGeneration,
  ): Promise<"absent" | "present" | "unknown"> {
    const manifestUri = await isolatedOutputPublicationManifestUri(
      runId,
      producerGeneration,
    );
    const path = this.#markerPathForManifestUri(manifestUri);
    try {
      const info = await Deno.lstat(path);
      if (info.isSymlink || !info.isFile) return "unknown";
      return "present";
    } catch (failure) {
      return failure instanceof Deno.errors.NotFound ? "absent" : "unknown";
    }
  }

  async #withRunLock<T>(runKey: string, body: () => Promise<T>): Promise<T> {
    const directory = `${this.#root}/run-locks`;
    const path = `${directory}/${runKey}.lock`;
    await this.#ensurePrivateDirectory(directory);
    await assertMissingOrRegularFileWithinRoot(this.#root, path, "Run lock");
    const file = await Deno.open(path, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    try {
      await assertRegularFileWithinRoot(this.#root, path, "Run lock");
      await Deno.chmod(path, 0o600);
      await file.lock(true);
      await assertRegularFileWithinRoot(this.#root, path, "Run lock");
      return await body();
    } finally {
      await file.unlock().catch(() => undefined);
      file.close();
    }
  }

  #batchState(batch: FileIsolatedOutputBatch): BatchState {
    const state = this.#batches.get(batch);
    if (!state || state.batchId !== batch.id) {
      throw new FileIsolatedOutputCasError(
        "The staged batch capability is unknown to this CAS instance.",
      );
    }
    return state;
  }

  #markerPath(ref: IsolatedOutputPublicationRef): string {
    return this.#markerPathForManifestUri(ref.manifestUri);
  }

  #markerPathForManifestUri(manifestUri: string): string {
    if (!manifestUri.startsWith(PUBLICATION_URI_PREFIX)) {
      throw new FileIsolatedOutputCasError("Publication URI namespace is invalid.");
    }
    const digest = sha256Hex(
      manifestUri.slice(PUBLICATION_URI_PREFIX.length),
      "$publication.manifestUri.digest",
    );
    return `${this.#root}/publications/${digest}.json`;
  }

  async #ensureAnchoredRoot(): Promise<void> {
    await ensureAbsoluteDirectoryTreeNoSymlinks(this.#root);
    await Deno.chmod(this.#root, 0o700);
  }

  async #assertAnchoredRoot(): Promise<void> {
    await assertAbsoluteDirectoryTreeNoSymlinks(this.#root);
  }

  async #ensurePrivateDirectory(directory: string): Promise<void> {
    await this.#ensureAnchoredRoot();
    requireDescendantPath(this.#root, directory);
    let current = this.#root;
    for (const segment of directory.slice(this.#root.length + 1).split("/")) {
      current = `${current}/${segment}`;
      try {
        const info = await Deno.lstat(current);
        if (info.isSymlink || !info.isDirectory) {
          throw new FileIsolatedOutputCasError(
            "Isolated output CAS directories must not be symlinks.",
          );
        }
      } catch (failure) {
        if (!(failure instanceof Deno.errors.NotFound)) throw failure;
        try {
          await Deno.mkdir(current, { mode: 0o700 });
        } catch (creationFailure) {
          if (!(creationFailure instanceof Deno.errors.AlreadyExists)) {
            throw creationFailure;
          }
          const winner = await Deno.lstat(current);
          if (winner.isSymlink || !winner.isDirectory) {
            throw new FileIsolatedOutputCasError(
              "Isolated output CAS directory creation raced with a non-directory.",
            );
          }
        }
        await syncDirectory(parentPath(current));
      }
      await Deno.chmod(current, 0o700);
    }
    await syncDirectoryChain(directory, this.#root);
  }

  async #removeStagingDirectory(directory: string): Promise<void> {
    requireDescendantPath(`${this.#root}/staging`, directory, true);
    await this.#assertAnchoredRoot();
    try {
      await assertDirectoryAncestorsNoSymlinks(this.#root, parentPath(directory));
    } catch (failure) {
      // A missing staging ancestor proves that this exact descendant is absent.
      // Every caller holds the run lock, so the same run cannot recreate it
      // between this observation and the return.
      if (failure instanceof Deno.errors.NotFound) return;
      throw failure;
    }
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(directory);
    } catch (failure) {
      if (failure instanceof Deno.errors.NotFound) return;
      throw failure;
    }
    if (info.isSymlink || !info.isDirectory) {
      throw new FileIsolatedOutputCasError(
        "Staging cleanup target must be one anchored directory.",
      );
    }
    // Recheck the complete parent chain immediately before the only recursive
    // mutation. All staging ancestors are private (0700) and code-owned.
    await assertDirectoryAncestorsNoSymlinks(this.#root, parentPath(directory));
    await Deno.remove(directory, { recursive: true });
    await syncDirectory(parentPath(directory));
  }
}

async function validateCasObject(
  value: unknown,
  index: number,
): Promise<IsolatedOutputCasObject & { readonly casUri: string }> {
  const path = `$objects[${index}]`;
  const record = exactRecord(value, [
    "runId",
    "producerGeneration",
    "role",
    "basename",
    "mediaType",
    "format",
    "byteCount",
    "sha256",
    "bytes",
  ], path);
  const declaration = validateIsolatedCodeOutputDeclaration({
    role: record.role,
    basename: record.basename,
    mediaType: record.mediaType,
    format: record.format,
  }, path);
  if (!Number.isSafeInteger(record.byteCount) || Number(record.byteCount) < 0) {
    throw new TypeError(`${path}.byteCount must be a non-negative safe integer.`);
  }
  const byteCount = Number(record.byteCount);
  const bytes = copyObservedUint8Array(
    record.bytes,
    `${path}.bytes`,
    byteCount,
  );
  const sha256 = sha256Hex(record.sha256, `${path}.sha256`);
  if (
    bytes.byteLength !== byteCount ||
    await fingerprintResourceBytes(bytes) !== sha256
  ) {
    throw new FileIsolatedOutputCasError(
      "Staged output bytes do not match their declared size and digest.",
    );
  }
  return Object.freeze({
    runId: safeId(record.runId, `${path}.runId`),
    producerGeneration: validateIsolatedOutputProducerGeneration(
      record.producerGeneration,
      `${path}.producerGeneration`,
    ),
    role: declaration.role,
    basename: declaration.basename,
    mediaType: declaration.mediaType,
    format: declaration.format,
    byteCount,
    sha256,
    bytes,
    casUri: validateIsolatedOutputCasUri(
      `casys://isolated-output/sha256/${sha256}`,
      sha256,
      `${path}.casUri`,
    ),
  });
}

async function assertReceiptMatchesBatch(
  receipt: IsolatedCodeExecutionReceiptRecord,
  state: BatchState,
): Promise<void> {
  if (receipt.runId !== state.runId) {
    throw new FileIsolatedOutputCasError(
      "Receipt run does not match the staged batch.",
    );
  }
  if (receipt.producerGeneration !== state.producerGeneration) {
    throw new FileIsolatedOutputCasError(
      "Receipt producer generation does not match the staged batch.",
    );
  }
  const expectedRef = await createIsolatedOutputPublicationRef(
    state.runId,
    state.producerGeneration,
    await fingerprintIsolatedOutputPublicationManifest(
      state.runId,
      state.producerGeneration,
      receipt.outputs.map(publicationObjectTuple),
    ),
  );
  if (!publicationRefsEqual(receipt.publication.ref, expectedRef)) {
    throw new FileIsolatedOutputCasError(
      "Receipt publication identity does not match its exact output manifest.",
    );
  }
  if (receipt.outputs.length !== state.objects.length) {
    throw new FileIsolatedOutputCasError(
      "Receipt outputs do not match the staged batch.",
    );
  }
  for (const [index, output] of receipt.outputs.entries()) {
    const staged = state.objects[index];
    if (
      staged === undefined || output.role !== staged.role ||
      output.basename !== staged.basename || output.mediaType !== staged.mediaType ||
      output.format !== staged.format || output.byteCount !== staged.byteCount ||
      output.sha256 !== staged.sha256 || output.casUri !== staged.casUri
    ) {
      throw new FileIsolatedOutputCasError(
        "Receipt outputs do not match the staged batch exactly.",
      );
    }
  }
}

function publicationObjectTuple(output: IsolatedCodeOutputReceiptRecord) {
  return {
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
    byteCount: output.byteCount,
    sha256: output.sha256,
    casUri: output.casUri,
  };
}

async function validateMarker(
  bytes: Uint8Array,
  expectedRef: IsolatedOutputPublicationRef,
): Promise<{
  readonly receiptRecordFingerprint: ContentFingerprint;
  readonly receiptRecordByteCount: number;
}> {
  const parsed = await validateMarkerForRun(
    bytes,
    expectedRef.runId,
    expectedRef.producerGeneration,
  );
  if (!publicationRefsEqual(parsed.ref, expectedRef)) {
    throw new FileIsolatedOutputCasError("Publication marker is divergent.");
  }
  return parsed;
}

async function validateMarkerForRun(
  bytes: Uint8Array,
  expectedRunId: string,
  expectedProducerGeneration: IsolatedOutputProducerGeneration,
): Promise<{
  readonly ref: IsolatedOutputPublicationRef;
  readonly receiptRecordFingerprint: ContentFingerprint;
  readonly receiptRecordByteCount: number;
}> {
  const text = new TextDecoder().decode(bytes);
  const value = exactRecord(JSON.parse(text), [
    "schemaVersion",
    "ref",
    "receiptRecordFingerprint",
    "receiptRecordByteCount",
  ], "$marker");
  literalValue(value.schemaVersion, PUBLICATION_MARKER_SCHEMA, "$marker.schemaVersion");
  const ref = await validateIsolatedOutputPublicationRef(
    value.ref,
    expectedRunId,
    "$marker.ref",
    expectedProducerGeneration,
  );
  if (
    !Number.isSafeInteger(value.receiptRecordByteCount) ||
    Number(value.receiptRecordByteCount) < 1
  ) {
    throw new TypeError("$marker.receiptRecordByteCount must be positive.");
  }
  const parsed = {
    schemaVersion: PUBLICATION_MARKER_SCHEMA,
    ref,
    receiptRecordFingerprint: validateContentFingerprint(
      value.receiptRecordFingerprint,
      "$marker.receiptRecordFingerprint",
    ),
    receiptRecordByteCount: Number(value.receiptRecordByteCount),
  };
  if (text !== deterministicJson(parsed)) {
    throw new FileIsolatedOutputCasError("Publication marker is not canonical.");
  }
  return parsed;
}

function validateRunFence(
  bytes: Uint8Array,
  expectedRunId: string,
  expectedRunKey: string,
  expectedProducerGeneration: IsolatedOutputProducerGeneration,
): void {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = exactRecord(JSON.parse(text), [
    "schemaVersion",
    "runId",
    "runKey",
    "producerGeneration",
  ], "$runFence");
  literalValue(
    value.schemaVersion,
    RUN_CLOSED_FENCE_SCHEMA,
    "$runFence.schemaVersion",
  );
  literalValue(value.runId, expectedRunId, "$runFence.runId");
  literalValue(value.runKey, expectedRunKey, "$runFence.runKey");
  literalValue(
    value.producerGeneration,
    expectedProducerGeneration,
    "$runFence.producerGeneration",
  );
  const parsed = {
    schemaVersion: RUN_CLOSED_FENCE_SCHEMA,
    runId: expectedRunId,
    runKey: expectedRunKey,
    producerGeneration: expectedProducerGeneration,
  };
  if (text !== deterministicJson(parsed)) {
    throw new FileIsolatedOutputCasError("Run fence is not canonical.");
  }
}

async function isolatedOutputRunKey(runId: string): Promise<string> {
  return (await sha256Fingerprint({
    schemaVersion: "isolated-output-run-key/1.0",
    runId,
  })).digest;
}

function publicationRefsEqual(
  left: IsolatedOutputPublicationRef,
  right: IsolatedOutputPublicationRef,
): boolean {
  return left.runId === right.runId && left.manifestUri === right.manifestUri &&
    left.producerGeneration === right.producerGeneration &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

async function assertObjectBytes(
  bytes: Uint8Array,
  member: Pick<StagedObjectRecord, "byteCount" | "sha256">,
): Promise<void> {
  if (
    bytes.byteLength !== member.byteCount ||
    await fingerprintResourceBytes(bytes) !== member.sha256
  ) {
    throw new FileIsolatedOutputCasError(
      "An isolated output object failed size or digest verification.",
    );
  }
}

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  };
}

function encodeCanonical(value: unknown): Uint8Array {
  return new TextEncoder().encode(deterministicJson(value));
}

async function writeNewBytesDurably(
  path: string,
  bytes: Uint8Array,
  directory: string,
): Promise<void> {
  const temporary = `${directory.replace(/\/+$/, "")}/.${crypto.randomUUID()}.tmp`;
  try {
    const file = await Deno.open(temporary, {
      createNew: true,
      write: true,
      mode: 0o600,
    });
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = await file.write(bytes.subarray(offset));
        if (count < 1) {
          throw new FileIsolatedOutputCasError("Filesystem write made no progress.");
        }
        offset += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
    await Deno.link(temporary, path);
    await syncDirectory(directory);
  } finally {
    await Deno.remove(temporary).catch((failure) => {
      if (!(failure instanceof Deno.errors.NotFound)) throw failure;
    });
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await Deno.open(directory, { read: true });
  try {
    await handle.sync();
  } finally {
    handle.close();
  }
}

async function syncDirectoryChain(directory: string, anchor: string): Promise<void> {
  let current = directory.replace(/\/+$/, "") || ".";
  while (true) {
    await syncDirectory(current);
    if (current === anchor) return;
    requireDescendantPath(anchor, current);
    const slash = current.lastIndexOf("/");
    current = slash < 0 ? "." : slash === 0 ? "/" : current.slice(0, slash);
  }
}

function absoluteStorageRoot(root: string): string {
  if (root.startsWith("/")) return root;
  const current = Deno.cwd().replace(/\/+$/, "");
  return `${current}/${root}`;
}

async function ensureAbsoluteDirectoryTreeNoSymlinks(path: string): Promise<void> {
  const missing: string[] = [];
  let anchor = path;
  while (true) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(anchor);
    } catch (failure) {
      if (!(failure instanceof Deno.errors.NotFound)) throw failure;
      missing.push(anchor);
      anchor = parentPath(anchor);
      continue;
    }
    if (
      info.isSymlink || !info.isDirectory ||
      await Deno.realPath(anchor) !== anchor
    ) {
      throw new FileIsolatedOutputCasError(
        anchor === path
          ? "Isolated output CAS root and ancestors must be real directories."
          : "Isolated output CAS root parent must not resolve through a symlink.",
      );
    }
    break;
  }

  for (const directory of missing.reverse()) {
    const parent = parentPath(directory);
    const parentInfo = await Deno.lstat(parent);
    if (
      parentInfo.isSymlink || !parentInfo.isDirectory ||
      await Deno.realPath(parent) !== parent
    ) {
      throw new FileIsolatedOutputCasError(
        "Isolated output CAS root parent must not resolve through a symlink.",
      );
    }
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (failure) {
      if (!(failure instanceof Deno.errors.AlreadyExists)) throw failure;
    }
    const created = await Deno.lstat(directory);
    if (
      created.isSymlink || !created.isDirectory ||
      await Deno.realPath(directory) !== directory
    ) {
      throw new FileIsolatedOutputCasError(
        "Isolated output CAS root and ancestors must be real directories.",
      );
    }
    await Deno.chmod(directory, 0o700);
    await syncDirectory(parent);
  }
  await syncDirectory(path);
}

async function assertAbsoluteDirectoryTreeNoSymlinks(path: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isDirectory || await Deno.realPath(path) !== path) {
    throw new FileIsolatedOutputCasError(
      "Isolated output CAS root and ancestors must be real directories.",
    );
  }
}

async function assertDirectoryAncestorsNoSymlinks(
  root: string,
  target: string,
): Promise<void> {
  requireDescendantPath(root, target, true);
  await assertAbsoluteDirectoryTreeNoSymlinks(root);
  if (target === root) return;
  let current = root;
  for (const segment of target.slice(root.length + 1).split("/")) {
    current = `${current}/${segment}`;
    const info = await Deno.lstat(current);
    if (info.isSymlink || !info.isDirectory) {
      throw new FileIsolatedOutputCasError(
        "Isolated output CAS child directories must be anchored.",
      );
    }
  }
}

function requireDescendantPath(
  root: string,
  path: string,
  allowEqual = false,
): void {
  if ((allowEqual && path === root) || path.startsWith(`${root}/`)) return;
  throw new FileIsolatedOutputCasError(
    "Filesystem operation escaped the anchored CAS root.",
  );
}

function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  return slash <= 0 ? "/" : clean.slice(0, slash);
}

function validateStorageRoot(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value.includes("\\") || value.includes("//")
  ) {
    throw new TypeError("Isolated output CAS root must be a bounded directory.");
  }
  const root = value.replace(/\/+$/, "");
  if (root.length === 0 || root === "/" || root === "." || root === "..") {
    throw new TypeError("Isolated output CAS root must be a bounded directory.");
  }
  const segments = root.split("/");
  if (segments[0] === "") segments.shift();
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError("Isolated output CAS root must be a bounded directory.");
  }
  return root;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function assertRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  requireDescendantPath(root, path);
  await assertDirectoryAncestorsNoSymlinks(root, parentPath(path));
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) {
    throw new FileIsolatedOutputCasError(`${label} must be one regular file.`);
  }
}

async function assertMissingOrRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  try {
    await assertRegularFileWithinRoot(root, path, label);
  } catch (failure) {
    if (failure instanceof Deno.errors.NotFound) return;
    throw failure;
  }
}
