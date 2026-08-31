/** Durable append-only local adapter for capability runtime rollover sagas. */

import type {
  CapabilityRuntimeRolloverAdvanceInput,
  CapabilityRuntimeRolloverIdentity,
  CapabilityRuntimeRolloverKey,
  CapabilityRuntimeRolloverSaga,
} from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import {
  advanceCapabilityRuntimeRolloverSaga,
  assertCapabilityRuntimeRolloverIdentity,
  assertCapabilityRuntimeRolloverKey,
  canonicalCapabilityRuntimeRolloverSagaText,
  capabilityRuntimeRolloverEventFileName,
  capabilityRuntimeRolloverKeyFor,
  CapabilityRuntimeRolloverSagaIntegrityError,
  capabilityRuntimeRolloverStorageKey,
  prepareCapabilityRuntimeRolloverSaga,
  resolveCapabilityRuntimeRolloverSaga,
  validateCapabilityRuntimeRolloverIdentity,
  validateCapabilityRuntimeRolloverKey,
  validateCapabilityRuntimeRolloverSaga,
} from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import type { CapabilityRuntimeRolloverSagaStore } from "../../application/ports/out/capability/capability-runtime-rollover-saga-store.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";
import {
  AnchoredLexicalPathError,
  assertAnchoredOpenRegularFile,
  assertAnchoredRealDirectoryIfPresent,
  assertAnchoredRegularFile,
  ensureAnchoredDirectoryTree,
  isAlreadyExists,
  isNotFound,
  openAnchoredRegularLockFile,
  requireContainedStoragePath,
  resolveTrustedAnchoredStorageRoot,
  type TrustedAnchoredStorageRoot,
} from "../shared/wal/trusted-anchored-storage-root.ts";

const DEFAULT_DIRECTORY = "state/local/capability-runtime-rollovers";

/**
 * The adapter never overwrites or deletes a saga event. A retry recreates the
 * same content-addressed file and must observe its exact previous bytes.
 */
export class FileCapabilityRuntimeRolloverSagaStore
  implements CapabilityRuntimeRolloverSagaStore {
  readonly #root: TrustedAnchoredStorageRoot;

  constructor(directory = DEFAULT_DIRECTORY) {
    try {
      this.#root = resolveTrustedAnchoredStorageRoot(directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TypeError("Capability runtime rollover saga directory is invalid.");
      }
      throw error;
    }
  }

  async read(
    value: CapabilityRuntimeRolloverKey,
  ): Promise<CapabilityRuntimeRolloverSaga | undefined> {
    const key = validateCapabilityRuntimeRolloverKey(value);
    const directory = await this.#directory(key);
    await assertDirectoryIfPresent(this.#root, directory);
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(directory));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    const events: CapabilityRuntimeRolloverSaga[] = [];
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (
        entry.isFile &&
        (entry.name === "rollover.lock" ||
          isDurableAttemptTemporaryFileName(entry.name))
      ) continue;
      if (
        !entry.isFile || !entry.name.startsWith("event-") ||
        !entry.name.endsWith(".json")
      ) {
        throw integrity(
          `Capability runtime rollover WAL contains unsupported entry ${entry.name}.`,
        );
      }
      const path = `${directory}/${entry.name}`;
      requireContained(this.#root, path);
      await assertRegular(this.#root, path);
      const event = await readCanonical(path, entry.name);
      assertCapabilityRuntimeRolloverKey(event, key);
      if (entry.name !== await capabilityRuntimeRolloverEventFileName(event)) {
        throw integrity(
          `Capability runtime rollover WAL entry ${entry.name} has a noncanonical name.`,
        );
      }
      events.push(event);
    }
    return await resolveCapabilityRuntimeRolloverSaga(events);
  }

  async prepare(
    value: CapabilityRuntimeRolloverIdentity,
  ): Promise<CapabilityRuntimeRolloverSaga> {
    const identity = validateCapabilityRuntimeRolloverIdentity(value);
    const key = capabilityRuntimeRolloverKeyFor(identity);
    return await this.#serialized(key, async () => {
      const current = await this.read(key);
      const next = await prepareCapabilityRuntimeRolloverSaga(identity, current);
      return await this.#publish(next);
    });
  }

  async advance(
    value: CapabilityRuntimeRolloverIdentity,
    input: CapabilityRuntimeRolloverAdvanceInput,
  ): Promise<CapabilityRuntimeRolloverSaga> {
    const identity = validateCapabilityRuntimeRolloverIdentity(value);
    const key = capabilityRuntimeRolloverKeyFor(identity);
    return await this.#serialized(key, async () => {
      const current = await this.read(key);
      if (!current) {
        throw integrity(
          "Capability runtime rollover cannot advance before durable preparation.",
        );
      }
      assertCapabilityRuntimeRolloverIdentity(current, identity);
      return await this.#publish(
        await advanceCapabilityRuntimeRolloverSaga(current, input),
      );
    });
  }

  async #serialized<T>(
    key: CapabilityRuntimeRolloverKey,
    operation: () => Promise<T>,
  ): Promise<T> {
    const directory = await this.#directory(key);
    await ensureDirectory(this.#root, directory);
    const path = `${directory}/rollover.lock`;
    const file = await openLock(this.#root, path);
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      await assertOpenRegular(this.#root, path, file);
      return await operation();
    } finally {
      try {
        if (locked) await file.unlock();
      } finally {
        file.close();
      }
    }
  }

  async #publish(
    event: CapabilityRuntimeRolloverSaga,
  ): Promise<CapabilityRuntimeRolloverSaga> {
    const key = capabilityRuntimeRolloverKeyFor(event.identity);
    const directory = await this.#directory(key);
    await ensureDirectory(this.#root, directory);
    const name = await capabilityRuntimeRolloverEventFileName(event);
    const text = `${await canonicalCapabilityRuntimeRolloverSagaText(event)}\n`;
    const path = `${directory}/${name}`;
    requireContained(this.#root, path);
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        directory,
        "Capability runtime rollover WAL write made no progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await assertRegular(this.#root, path);
      if (await Deno.readTextFile(path) !== text) {
        throw integrity(
          "Capability runtime rollover WAL event collides with divergent bytes.",
        );
      }
    }
    const observed = await this.read(key);
    if (!observed) {
      throw integrity("Capability runtime rollover WAL append was not readable.");
    }
    assertCapabilityRuntimeRolloverIdentity(observed, event.identity);
    return observed;
  }

  async #directory(key: CapabilityRuntimeRolloverKey): Promise<string> {
    const directory =
      `${this.#root.storageRoot}/${await capabilityRuntimeRolloverStorageKey(key)}`;
    requireContained(this.#root, directory);
    return directory;
  }
}

async function readCanonical(
  path: string,
  name: string,
): Promise<CapabilityRuntimeRolloverSaga> {
  const text = await Deno.readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw integrity(`Capability runtime rollover WAL entry ${name} is not JSON.`);
  }
  const event = await validateCapabilityRuntimeRolloverSaga(parsed);
  if (`${await canonicalCapabilityRuntimeRolloverSagaText(event)}\n` !== text) {
    throw integrity(
      `Capability runtime rollover WAL entry ${name} is not canonical JSON.`,
    );
  }
  return event;
}

const MESSAGES = {
  escaped: "Filesystem operation escaped the anchored rollover WAL root.",
  appearedBehindMissingAncestor:
    "Rollover WAL path component appeared behind a missing ancestor.",
  notRealDirectory: "Rollover WAL root or ancestor must be a real directory.",
  componentChanged: "Rollover WAL path component changed while checked.",
  regularFile:
    "Rollover WAL lock or event must be one regular file inside the WAL root.",
  pathChangedWhileOpen: "Rollover WAL lock path changed while it was open.",
} as const;

function integrity(message: string): CapabilityRuntimeRolloverSagaIntegrityError {
  return new CapabilityRuntimeRolloverSagaIntegrityError(message);
}

function rethrowWalk(error: unknown): never {
  if (error instanceof AnchoredLexicalPathError) throw integrity(error.message);
  throw error;
}

function requireContained(root: TrustedAnchoredStorageRoot, path: string): void {
  try {
    requireContainedStoragePath(root, path, MESSAGES.escaped);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertDirectoryIfPresent(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await assertAnchoredRealDirectoryIfPresent(root, path, MESSAGES);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function ensureDirectory(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await ensureAnchoredDirectoryTree(root, path, MESSAGES, 0o700);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertRegular(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await assertAnchoredRegularFile(root, path, MESSAGES);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertOpenRegular(
  root: TrustedAnchoredStorageRoot,
  path: string,
  file: Deno.FsFile,
): Promise<void> {
  try {
    await assertAnchoredOpenRegularFile(root, path, file, MESSAGES, 0o600);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function openLock(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<Deno.FsFile> {
  try {
    return await openAnchoredRegularLockFile(root, path, MESSAGES, 0o600);
  } catch (error) {
    rethrowWalk(error);
  }
}
