/** Host-local append-only store for exact runtime qualification attestations. */

import type {
  CapabilityRuntimeQualificationAttestationStore,
  CapabilityRuntimeQualifiedAttestationAppendResult,
} from "../../application/ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import {
  canonicalCapabilityRuntimeBindingQualificationAttestationText,
  type CapabilityRuntimeBindingQualificationAttestation,
  sameCapabilityRuntimeQualificationRevocationScope,
  validateCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";
import {
  AnchoredLexicalPathError,
  assertAnchoredOpenRegularFile,
  assertAnchoredRealDirectory,
  assertAnchoredRegularFile,
  ensureAnchoredDirectoryTree,
  isAlreadyExists,
  isNotFound,
  type LexicalWalkMessages,
  openAnchoredRegularLockFile,
  requireContainedStoragePath,
  resolveTrustedAnchoredStorageRoot,
  type TrustedAnchoredStorageRoot,
} from "../shared/wal/trusted-anchored-storage-root.ts";

const DEFAULT_DIRECTORY =
  "state/local/capability-runtime-host/qualification-attestations";
const LOCK_NAME = "attestation.lock";

/**
 * An event file is named solely by its content fingerprint.  Existing equal
 * content is idempotent; a different collision is an integrity failure.  No
 * record is replaced or removed by this adapter. All appends share one
 * exclusive File.lock so qualified/revoked order is the durable linearization.
 */
export interface FileCapabilityRuntimeQualificationAttestationStoreOptions {
  readonly afterAnchoredDirectoryReady?: () => Promise<void> | void;
  readonly afterLockAcquired?: () => Promise<void> | void;
}

export class FileCapabilityRuntimeQualificationAttestationStore
  implements CapabilityRuntimeQualificationAttestationStore {
  readonly #root: TrustedAnchoredStorageRoot;
  readonly #afterAnchoredDirectoryReady?: () => Promise<void> | void;
  readonly #afterLockAcquired?: () => Promise<void> | void;

  constructor(
    directory = DEFAULT_DIRECTORY,
    options: FileCapabilityRuntimeQualificationAttestationStoreOptions = {},
  ) {
    try {
      this.#root = resolveTrustedAnchoredStorageRoot(directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TypeError(
          "Capability runtime qualification directory is invalid.",
        );
      }
      throw error;
    }
    this.#afterAnchoredDirectoryReady = options.afterAnchoredDirectoryReady;
    this.#afterLockAcquired = options.afterLockAcquired;
  }

  async append(value: CapabilityRuntimeBindingQualificationAttestation): Promise<void> {
    await this.#serialized(() => this.#write(value));
  }

  async appendQualifiedUnlessRevoked(
    value: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<CapabilityRuntimeQualifiedAttestationAppendResult> {
    const attestation = await validateCapabilityRuntimeBindingQualificationAttestation(
      value,
    );
    if (attestation.state !== "qualified") {
      throw new TypeError(
        "Conditional qualification append requires a qualified attestation.",
      );
    }
    return await this.#serialized(async () => {
      const existing = await this.#readUnlocked(attestation.fingerprint);
      if (existing) {
        const expected =
          `${await canonicalCapabilityRuntimeBindingQualificationAttestationText(
            attestation,
          )}\n`;
        const path = this.#path(attestation.fingerprint);
        await assertRegularAttestationFile(this.#root, path);
        if (await Deno.readTextFile(path) !== expected) {
          throw new Error(
            `Capability runtime qualification attestation ${attestation.fingerprint.digest} already exists with different content.`,
          );
        }
        return { status: "existing" as const };
      }
      const events = await this.#scanUnlocked();
      if (
        events.some((event) =>
          event.state === "revoked" &&
          sameCapabilityRuntimeQualificationRevocationScope(event, attestation)
        )
      ) {
        return { status: "revoked" as const };
      }
      await this.#writeUnlocked(attestation);
      return { status: "appended" as const };
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeBindingQualificationAttestation | undefined> {
    validateFingerprint(fingerprint, "$qualificationAttestationFingerprint");
    return await this.#readUnlocked(fingerprint);
  }

  async list(): Promise<readonly CapabilityRuntimeBindingQualificationAttestation[]> {
    return await this.#scanUnlocked();
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    await ensureAttestationDirectory(this.#root);
    await this.#afterAnchoredDirectoryReady?.();
    const path = `${this.#root.storageRoot}/${LOCK_NAME}`;
    const file = await openAttestationLockFile(this.#root, path);
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      await this.#afterLockAcquired?.();
      await assertOpenAttestationLock(this.#root, path, file);
      return await operation();
    } finally {
      try {
        if (locked) await file.unlock();
      } finally {
        file.close();
      }
    }
  }

  async #write(
    value: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<void> {
    const attestation = await validateCapabilityRuntimeBindingQualificationAttestation(
      value,
    );
    await this.#writeUnlocked(attestation);
  }

  async #writeUnlocked(
    attestation: CapabilityRuntimeBindingQualificationAttestation,
  ): Promise<void> {
    const text = `${await canonicalCapabilityRuntimeBindingQualificationAttestationText(
      attestation,
    )}\n`;
    const path = this.#path(attestation.fingerprint);
    await ensureAttestationDirectory(this.#root);
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        this.#root.storageRoot,
        "Capability runtime qualification attestation made no write progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await assertRegularAttestationFile(this.#root, path);
      const existing = await Deno.readTextFile(path);
      if (existing === text) return;
      throw new Error(
        `Capability runtime qualification attestation ${attestation.fingerprint.digest} already exists with different content.`,
      );
    }
  }

  async #readUnlocked(
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeBindingQualificationAttestation | undefined> {
    const path = this.#path(fingerprint);
    try {
      await assertRegularAttestationFile(this.#root, path);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    const text = await Deno.readTextFile(path);
    const value = await parseCanonical(
      text,
      `Capability runtime qualification attestation ${fingerprint.digest}`,
    );
    if (!sameFingerprint(value.fingerprint, fingerprint)) {
      throw new Error(
        `Capability runtime qualification attestation ${fingerprint.digest} has a mismatched body fingerprint.`,
      );
    }
    return value;
  }

  async #scanUnlocked(): Promise<
    readonly CapabilityRuntimeBindingQualificationAttestation[]
  > {
    try {
      await assertAnchoredRealDirectory(
        this.#root,
        this.#root.storageRoot,
        ATTESTATION_WALK_MESSAGES,
      );
    } catch (error) {
      if (isNotFound(error)) return [];
      rethrowAttestationWalk(error);
    }
    const entries = await Array.fromAsync(Deno.readDir(this.#root.storageRoot));
    const result: CapabilityRuntimeBindingQualificationAttestation[] = [];
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (isDurableAttemptTemporaryFileName(entry.name)) continue;
      if (entry.name === LOCK_NAME) continue;
      const path = `${this.#root.storageRoot}/${entry.name}`;
      requireContainedAttestationPath(this.#root, path);
      await assertRegularAttestationFile(this.#root, path);
      if (!entry.name.endsWith(".json")) {
        throw new Error(
          `Capability runtime qualification store contains unsupported entry ${entry.name}.`,
        );
      }
      const digest = entry.name.slice(0, -".json".length);
      if (!/^[a-f0-9]{64}$/.test(digest)) {
        throw new Error(
          `Capability runtime qualification store contains an invalid attestation filename ${entry.name}.`,
        );
      }
      const value = await parseCanonical(
        await Deno.readTextFile(path),
        `Capability runtime qualification attestation ${digest}`,
      );
      if (value.fingerprint.digest !== digest) {
        throw new Error(
          `Capability runtime qualification attestation filename ${entry.name} does not match its body fingerprint.`,
        );
      }
      result.push(value);
    }
    return result;
  }

  #path(fingerprint: ContentFingerprint): string {
    const path = `${this.#root.storageRoot}/${fingerprint.digest}.json`;
    requireContainedAttestationPath(this.#root, path);
    return path;
  }
}

const ATTESTATION_WALK_MESSAGES: LexicalWalkMessages = {
  escaped: "Filesystem operation escaped the anchored qualification store root.",
  appearedBehindMissingAncestor:
    "Qualification store path component appeared behind a missing ancestor.",
  notRealDirectory:
    "Qualification store directory and its ancestors must be real directories.",
  componentChanged: "Qualification store path component changed while it was checked.",
  regularFile:
    "Qualification attestation lock or event must be one regular file inside the store root.",
  pathChangedWhileOpen:
    "Qualification attestation lock path changed while it was open.",
};

function rethrowAttestationWalk(error: unknown): never {
  if (error instanceof AnchoredLexicalPathError) throw new Error(error.message);
  throw error;
}

function requireContainedAttestationPath(
  root: TrustedAnchoredStorageRoot,
  path: string,
): void {
  try {
    requireContainedStoragePath(root, path, ATTESTATION_WALK_MESSAGES.escaped);
  } catch (error) {
    rethrowAttestationWalk(error);
  }
}

async function ensureAttestationDirectory(
  root: TrustedAnchoredStorageRoot,
): Promise<void> {
  try {
    await ensureAnchoredDirectoryTree(
      root,
      root.storageRoot,
      ATTESTATION_WALK_MESSAGES,
      0o700,
    );
  } catch (error) {
    rethrowAttestationWalk(error);
  }
}

async function assertRegularAttestationFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<Deno.FileInfo> {
  try {
    return await assertAnchoredRegularFile(root, path, ATTESTATION_WALK_MESSAGES);
  } catch (error) {
    rethrowAttestationWalk(error);
  }
}

async function openAttestationLockFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<Deno.FsFile> {
  try {
    return await openAnchoredRegularLockFile(
      root,
      path,
      ATTESTATION_WALK_MESSAGES,
      0o600,
    );
  } catch (error) {
    rethrowAttestationWalk(error);
  }
}

async function assertOpenAttestationLock(
  root: TrustedAnchoredStorageRoot,
  path: string,
  file: Deno.FsFile,
): Promise<Deno.FileInfo> {
  try {
    return await assertAnchoredOpenRegularFile(
      root,
      path,
      file,
      ATTESTATION_WALK_MESSAGES,
      0o600,
    );
  } catch (error) {
    rethrowAttestationWalk(error);
  }
}

async function parseCanonical(
  text: string,
  label: string,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  const value = await validateCapabilityRuntimeBindingQualificationAttestation(parsed);
  const expected =
    `${await canonicalCapabilityRuntimeBindingQualificationAttestationText(value)}\n`;
  if (text !== expected) throw new Error(`${label} is not canonical JSON.`);
  return value;
}

function validateFingerprint(value: ContentFingerprint, path: string): void {
  if (value.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.digest)) {
    throw new TypeError(`${path} must name one lowercase SHA-256 fingerprint.`);
  }
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}
