/** Durable append-only journal for the isolated cache-preparation lane. */

import {
  resolveCapabilityRuntimeCachePreparations,
  validateCapabilityRuntimeCachePreparationIntent,
  validateCapabilityRuntimeCachePreparationLineages,
  validateCapabilityRuntimeCachePreparationTerminal,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import type {
  CapabilityRuntimeCachePreparation,
  CapabilityRuntimeCachePreparationIntent,
  CapabilityRuntimeCachePreparationTerminal,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { safeId } from "../../domain/kernel/case-validation.ts";
import type { CapabilityRuntimeCachePreparationJournal } from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";
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

/**
 * Current authoritative root for first-party microVM material preparation.
 * The retired generic cache-preparation root is deliberately not read or
 * migrated: its recipes belonged to a different closed runtime model.
 */
export const DEFAULT_CAPABILITY_RUNTIME_MICROVM_PREPARATION_DIRECTORY =
  "state/local/capability-runtime-microvm-preparation";

/**
 * The cache journal deliberately uses its own anchored root, not the H1 host
 * journal. An incomplete cache intent therefore remains an administrative
 * recovery marker without changing Compose or engineering authority.
 */
export class FileCapabilityRuntimeCachePreparationJournal
  implements CapabilityRuntimeCachePreparationJournal {
  readonly #root: TrustedAnchoredStorageRoot;

  constructor(
    directory = DEFAULT_CAPABILITY_RUNTIME_MICROVM_PREPARATION_DIRECTORY,
  ) {
    try {
      this.#root = resolveTrustedAnchoredStorageRoot(directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TypeError("Cache preparation journal directory is invalid.");
      }
      throw error;
    }
  }

  async read(idValue: string): Promise<CapabilityRuntimeCachePreparation | undefined> {
    const id = safeId(idValue, "$cachePreparationJournal.id");
    const key = await storageKey(id);
    const intent = await this.#readOptional(
      `${this.#intentsDirectory()}/${key}.json`,
      validateCapabilityRuntimeCachePreparationIntent,
      "Cache preparation intent",
    );
    const terminal = await this.#readOptional(
      `${this.#terminalsDirectory()}/${key}.json`,
      validateCapabilityRuntimeCachePreparationTerminal,
      "Cache preparation terminal",
    );
    if (!intent && !terminal) return undefined;
    if (intent && intent.id !== id) {
      throw new Error(
        "Cache preparation journal intent does not match its storage key.",
      );
    }
    if (terminal && terminal.preparationId !== id) {
      throw new Error(
        "Cache preparation journal terminal does not match its storage key.",
      );
    }
    if (!intent || !terminal) {
      if (!intent) {
        throw new Error("Cache preparation journal terminal exists without an intent.");
      }
      return (await resolveCapabilityRuntimeCachePreparations({
        intents: [intent],
        terminals: [],
      }))[0]!;
    }
    return (await resolveCapabilityRuntimeCachePreparations({
      intents: [intent],
      terminals: [terminal],
    }))[0]!;
  }

  async list(): Promise<readonly CapabilityRuntimeCachePreparation[]> {
    const intents = await this.#listDirectory(
      this.#intentsDirectory(),
      validateCapabilityRuntimeCachePreparationIntent,
      "Cache preparation intent",
      (value) => value.id,
    );
    const terminals = await this.#listDirectory(
      this.#terminalsDirectory(),
      validateCapabilityRuntimeCachePreparationTerminal,
      "Cache preparation terminal",
      (value) => value.preparationId,
    );
    const preparations = await resolveCapabilityRuntimeCachePreparations({
      intents,
      terminals,
    });
    validateCapabilityRuntimeCachePreparationLineages(preparations);
    return preparations;
  }

  async appendIntent(input: CapabilityRuntimeCachePreparationIntent): Promise<void> {
    const intent = await validateCapabilityRuntimeCachePreparationIntent(input);
    await this.#append(
      this.#intentsDirectory(),
      `${await storageKey(intent.id)}.json`,
      intent,
      "Cache preparation intent",
    );
  }

  async appendTerminal(
    input: CapabilityRuntimeCachePreparationTerminal,
  ): Promise<void> {
    const terminal = await validateCapabilityRuntimeCachePreparationTerminal(input);
    const intent = await this.read(terminal.preparationId);
    if (!intent) throw new Error("Cache preparation terminal has no durable intent.");
    await resolveCapabilityRuntimeCachePreparations({
      intents: [intent.intent],
      terminals: [terminal],
    });
    await this.#append(
      this.#terminalsDirectory(),
      `${await storageKey(terminal.preparationId)}.json`,
      terminal,
      "Cache preparation terminal",
    );
  }

  async #append(
    directory: string,
    name: string,
    value:
      | CapabilityRuntimeCachePreparationIntent
      | CapabilityRuntimeCachePreparationTerminal,
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
          `Cache preparation journal contains unsupported entry ${entry.name}.`,
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

  #intentsDirectory(): string {
    return `${this.#root.storageRoot}/intents`;
  }

  #terminalsDirectory(): string {
    return `${this.#root.storageRoot}/terminals`;
  }
}

async function storageKey(id: string): Promise<string> {
  return (await sha256Fingerprint({ id: safeId(id, "$cachePreparationJournal.id") }))
    .digest;
}

const WALK = {
  escaped: "Cache preparation journal escaped its anchored storage root.",
  appearedBehindMissingAncestor:
    "Cache preparation journal path appeared behind a missing ancestor.",
  notRealDirectory:
    "Cache preparation journal root and ancestors must be real directories.",
  componentChanged: "Cache preparation journal path changed while it was checked.",
  regularFile: "Cache preparation journal record must be one regular file.",
  pathChangedWhileOpen: "Cache preparation journal record changed while it was open.",
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
