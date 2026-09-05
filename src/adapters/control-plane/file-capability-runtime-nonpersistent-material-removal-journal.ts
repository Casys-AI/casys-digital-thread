/** Append-only journal for non-persistent cache-image administrative removal. */

import {
  type CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  type CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  validateCapabilityRuntimeNonpersistentMaterialRemovalIntent,
  validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { safeId } from "../../domain/kernel/case-validation.ts";
import type { CapabilityRuntimeNonpersistentMaterialRemovalJournal } from "../../application/ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";
import {
  AnchoredLexicalPathError,
  assertAnchoredOpenRegularFile,
  assertAnchoredRealDirectoryIfPresent,
  ensureAnchoredDirectoryTree,
  isAlreadyExists,
  isNotFound,
  requireContainedStoragePath,
  resolveTrustedAnchoredStorageRoot,
  type TrustedAnchoredStorageRoot,
} from "../shared/wal/trusted-anchored-storage-root.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_DIRECTORY =
  "state/local/capability-runtime-host/nonpersistent-material-removal";

export class FileCapabilityRuntimeNonpersistentMaterialRemovalJournal
  implements CapabilityRuntimeNonpersistentMaterialRemovalJournal {
  readonly #root: TrustedAnchoredStorageRoot;

  constructor(directory = DEFAULT_DIRECTORY) {
    try {
      this.#root = resolveTrustedAnchoredStorageRoot(directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TypeError(
          "Non-persistent material removal journal directory is invalid.",
        );
      }
      throw error;
    }
  }

  async appendIntent(
    input: CapabilityRuntimeNonpersistentMaterialRemovalIntent,
  ): Promise<void> {
    const intent = await validateCapabilityRuntimeNonpersistentMaterialRemovalIntent(
      input,
    );
    await this.#append(
      this.#intentsDirectory(),
      `${await storageKey(intent.id)}.json`,
      intent,
      "Non-persistent material removal intent",
    );
  }

  async appendOutcome(
    input: CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  ): Promise<void> {
    const outcome = await validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
      input,
    );
    const intents = await this.listIntents();
    const intent = intents.find((candidate) => candidate.id === outcome.intentId);
    if (!intent) {
      throw new Error(
        "Non-persistent material removal outcome has no durable intent.",
      );
    }
    if (
      intent.fingerprint.algorithm !== outcome.intentFingerprint.algorithm ||
      intent.fingerprint.digest !== outcome.intentFingerprint.digest
    ) {
      throw new Error(
        "Non-persistent material removal outcome does not attest its exact intent.",
      );
    }
    if (outcome.recordedAt < intent.plannedAt) {
      throw new Error(
        "Non-persistent material removal outcome predates its durable intent.",
      );
    }
    await this.#append(
      this.#outcomesDirectory(),
      `${await storageKey(outcome.intentId)}.json`,
      outcome,
      "Non-persistent material removal outcome",
    );
  }

  async listIntents(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalIntent[]
  > {
    return await this.#listDirectory(
      this.#intentsDirectory(),
      validateCapabilityRuntimeNonpersistentMaterialRemovalIntent,
      "Non-persistent material removal intent",
      (value) => value.id,
    );
  }

  async listOutcomes(): Promise<
    readonly CapabilityRuntimeNonpersistentMaterialRemovalOutcome[]
  > {
    return await this.#listDirectory(
      this.#outcomesDirectory(),
      validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
      "Non-persistent material removal outcome",
      (value) => value.intentId,
    );
  }

  async #append(
    directory: string,
    name: string,
    value:
      | CapabilityRuntimeNonpersistentMaterialRemovalIntent
      | CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
    label: string,
  ): Promise<void> {
    await ensureDirectory(this.#root, directory);
    const path = `${directory}/${name}`;
    requireContained(this.#root, path);
    const text = `${deterministicJson(value)}\n`;
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        directory,
        `${label} made no write progress.`,
        undefined,
        this.#root.storageRoot,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await readAnchoredText(this.#root, path) !== text) {
        throw new Error(`${label} already exists with different content.`);
      }
    }
  }

  async #listDirectory<T>(
    directory: string,
    validate: (value: unknown) => T | Promise<T>,
    label: string,
    id: (value: T) => string,
  ): Promise<readonly T[]> {
    await assertDirectoryIfPresent(this.#root, directory);
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(directory));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const values: T[] = [];
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (entry.isFile && isDurableAttemptTemporaryFileName(entry.name)) continue;
      if (!entry.isFile || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        throw new Error(
          `Non-persistent material removal journal contains unsupported entry ${entry.name}.`,
        );
      }
      const value = await this.#readOptional(
        `${directory}/${entry.name}`,
        validate,
        label,
      );
      if (!value) throw new Error(`${label} disappeared while reading the journal.`);
      const expected = `${await storageKey(id(value))}.json`;
      if (entry.name !== expected) {
        throw new Error(`${label} has a noncanonical storage key.`);
      }
      values.push(value);
    }
    return values;
  }

  async #readOptional<T>(
    path: string,
    validate: (value: unknown) => T | Promise<T>,
    label: string,
  ): Promise<T | undefined> {
    requireContained(this.#root, path);
    let text: string;
    try {
      text = await readAnchoredText(this.#root, path);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${label} is not JSON.`);
    }
    const value = await validate(parsed);
    if (`${deterministicJson(value)}\n` !== text) {
      throw new Error(`${label} is not canonical.`);
    }
    return value;
  }

  #intentsDirectory(): string {
    return `${this.#root.storageRoot}/intents`;
  }

  #outcomesDirectory(): string {
    return `${this.#root.storageRoot}/outcomes`;
  }
}

async function storageKey(id: string): Promise<string> {
  return (await sha256Fingerprint({
    id: safeId(id, "$nonpersistentRemovalJournal.id"),
  })).digest;
}

const WALK = {
  escaped: "Non-persistent material removal journal escaped its anchored storage root.",
  appearedBehindMissingAncestor:
    "Non-persistent material removal journal path appeared behind a missing ancestor.",
  notRealDirectory:
    "Non-persistent material removal journal root and ancestors must be real directories.",
  componentChanged:
    "Non-persistent material removal journal path changed while it was checked.",
  regularFile:
    "Non-persistent material removal journal record must be one regular file.",
  pathChangedWhileOpen:
    "Non-persistent material removal journal record changed while it was open.",
} as const;

function requireContained(root: TrustedAnchoredStorageRoot, path: string): void {
  try {
    requireContainedStoragePath(root, path, WALK.escaped);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function ensureDirectory(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await ensureAnchoredDirectoryTree(root, path, WALK, 0o700);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertDirectoryIfPresent(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await assertAnchoredRealDirectoryIfPresent(root, path, WALK);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function readAnchoredText(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<string> {
  requireContained(root, path);
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (error) {
    if (isNotFound(error)) throw error;
    rethrowWalk(error);
  }
  try {
    try {
      await assertAnchoredOpenRegularFile(root, path, file, WALK);
    } catch (error) {
      rethrowWalk(error);
    }
    const chunks: Uint8Array[] = [];
    while (true) {
      const buffer = new Uint8Array(16_384);
      const count = await file.read(buffer);
      if (count === null) break;
      if (count > 0) chunks.push(buffer.subarray(0, count));
    }
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    file.close();
  }
}

function rethrowWalk(error: unknown): never {
  if (error instanceof AnchoredLexicalPathError) throw new Error(error.message);
  throw error;
}
