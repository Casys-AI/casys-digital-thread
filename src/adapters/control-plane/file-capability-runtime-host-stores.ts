/**
 * Durable local stores for host-runtime administration.
 *
 * Their root is deliberately outside EngineeringProject, Thread, CAS and WAL
 * stores.  They carry host intents/leases/admin configuration only and never
 * publish a project proof.
 */

import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  validateCapabilityRuntimeJournalEntry,
  validateCapabilityRuntimeJournalOutcome,
  validateCapabilityRuntimeLease,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeAdminLock,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";
import { validateCapabilityRuntimeAdminLock } from "./capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseStore,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_DIRECTORY = "state/local/capability-runtime-host";

/**
 * Every intent and terminal outcome is a create-new durable document.  No
 * record is edited or removed: a missing outcome remains a real crash marker.
 */
export class FileCapabilityRuntimeJournal implements CapabilityRuntimeJournal {
  readonly #directory: string;

  constructor(directory = DEFAULT_DIRECTORY) {
    this.#directory = requiredDirectory(directory);
  }

  async appendBeforeMutation(entryValue: CapabilityRuntimeJournalEntry): Promise<void> {
    const entry = validateCapabilityRuntimeJournalEntry(entryValue);
    await this.#append(
      this.#intentPath(entry.id),
      entry,
      `Capability runtime intent ${entry.id}`,
    );
  }

  async appendOutcome(outcomeValue: CapabilityRuntimeJournalOutcome): Promise<void> {
    const outcome = validateCapabilityRuntimeJournalOutcome(outcomeValue);
    const intent = await this.#readIntent(outcome.journalEntryId);
    if (outcome.recordedAt < intent.plannedAt) {
      throw new Error(
        `Capability runtime outcome ${outcome.journalEntryId} predates its durable intent.`,
      );
    }
    await this.#append(
      this.#outcomePath(outcome.journalEntryId),
      outcome,
      `Capability runtime outcome ${outcome.journalEntryId}`,
    );
  }

  async list(): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    return await this.#list(
      this.#intentsDirectory(),
      validateCapabilityRuntimeJournalEntry,
    );
  }

  async listOutcomes(): Promise<readonly CapabilityRuntimeJournalOutcome[]> {
    return await this.#list(
      this.#outcomesDirectory(),
      validateCapabilityRuntimeJournalOutcome,
    );
  }

  async #append<T>(path: string, value: T, label: string): Promise<void> {
    const directory = parent(path);
    await Deno.mkdir(directory, { recursive: true });
    const text = `${deterministicJson(value)}\n`;
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        directory,
        `${label} made no write progress.`,
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const current = await Deno.readTextFile(path);
      if (current === text) return;
      throw new Error(`${label} already exists with different content.`);
    }
  }

  async #readIntent(id: string): Promise<CapabilityRuntimeJournalEntry> {
    return await readCanonical(
      this.#intentPath(id),
      validateCapabilityRuntimeJournalEntry,
      `Capability runtime intent ${id}`,
    );
  }

  async #list<T>(
    directory: string,
    validate: (value: unknown) => T,
  ): Promise<readonly T[]> {
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
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        throw new Error(
          `Capability runtime journal contains unsupported entry ${entry.name}.`,
        );
      }
      values.push(
        await readCanonical(
          `${directory}/${entry.name}`,
          validate,
          "Capability runtime journal record",
        ),
      );
    }
    return values;
  }

  #intentsDirectory(): string {
    return `${this.#directory}/intents`;
  }

  #outcomesDirectory(): string {
    return `${this.#directory}/outcomes`;
  }

  #intentPath(id: string): string {
    return `${this.#intentsDirectory()}/${encodeURIComponent(id)}.json`;
  }

  #outcomePath(id: string): string {
    return `${this.#outcomesDirectory()}/${encodeURIComponent(id)}.json`;
  }
}

/**
 * Leases are immutable create-new claims.  Expiration is evaluated at read
 * time; stale records are retained so an interrupted process cannot turn into
 * a silent deletion of operational history.
 */
export class FileCapabilityRuntimeLeaseStore implements CapabilityRuntimeLeaseStore {
  readonly #directory: string;

  constructor(directory = `${DEFAULT_DIRECTORY}/leases`) {
    this.#directory = requiredDirectory(directory);
  }

  async acquire(leaseValue: CapabilityRuntimeLease): Promise<void> {
    const lease = validateCapabilityRuntimeLease(leaseValue);
    await Deno.mkdir(this.#directory, { recursive: true });
    const path = await this.#path(lease.id);
    const text = `${deterministicJson(lease)}\n`;
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        this.#directory,
        "Capability runtime lease made no write progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await Deno.readTextFile(path);
      if (existing === text) return;
      throw new Error(
        `Capability runtime lease ${lease.id} already exists with different content.`,
      );
    }
  }

  async release(leaseId: string): Promise<void> {
    const path = await this.#path(nonBlank(leaseId, "leaseId"));
    try {
      await Deno.remove(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async read(leaseId: string): Promise<CapabilityRuntimeLease | undefined> {
    const path = await this.#path(nonBlank(leaseId, "leaseId"));
    try {
      return await readCanonical(
        path,
        validateCapabilityRuntimeLease,
        "Capability runtime lease",
      );
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async listActive(at: string): Promise<readonly CapabilityRuntimeLease[]> {
    const instant = canonicalIso(at, "at");
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(this.#directory));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const leases: CapabilityRuntimeLease[] = [];
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        throw new Error(
          `Capability runtime lease store contains unsupported entry ${entry.name}.`,
        );
      }
      const lease = await readCanonical(
        `${this.#directory}/${entry.name}`,
        validateCapabilityRuntimeLease,
        "Capability runtime lease",
      );
      if (lease.expiresAt > instant) leases.push(lease);
    }
    return leases.toSorted((left, right) => left.id.localeCompare(right.id));
  }

  async #path(id: string): Promise<string> {
    const fingerprint = await sha256Fingerprint({ id });
    return `${this.#directory}/${fingerprint.digest}.json`;
  }
}

/**
 * Durable local administration lock desired-state.  It is neither a project
 * ledger entry nor a host-process mutex.  Revisions are compare-and-swap-like:
 * a new lock must explicitly chain to the fingerprint of its predecessor.
 */
export class FileCapabilityRuntimeAdminLockStore {
  readonly #path: string;

  constructor(path = `${DEFAULT_DIRECTORY}/admin-lock.json`) {
    this.#path = requiredPath(path);
  }

  async read(): Promise<CapabilityRuntimeAdminLock | undefined> {
    try {
      return await readCanonical(
        this.#path,
        (value) => validateCapabilityRuntimeAdminLock(value),
        "Capability runtime admin lock",
      );
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async save(value: CapabilityRuntimeAdminLock): Promise<void> {
    const lockPath = `${this.#path}.lock`;
    await Deno.mkdir(parent(lockPath), { recursive: true });
    const lock = await Deno.open(lockPath, { create: true, read: true, write: true });
    let locked = false;
    try {
      await lock.lock(true);
      locked = true;
      await this.#saveLocked(value);
    } finally {
      try {
        if (locked) await lock.unlock();
      } finally {
        lock.close();
      }
    }
  }

  async #saveLocked(value: CapabilityRuntimeAdminLock): Promise<void> {
    const next = await validateCapabilityRuntimeAdminLock(value);
    const directory = parent(this.#path);
    await Deno.mkdir(directory, { recursive: true });
    const text = `${deterministicJson(next)}\n`;
    const current = await this.read();
    if (!current) {
      try {
        await writeNewAttemptFileDurably(
          this.#path,
          text,
          directory,
          "Capability runtime admin lock made no write progress.",
        );
        return;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        return await this.#saveLocked(next);
      }
    }
    if (deterministicJson(current) === deterministicJson(next)) return;
    const previous = await sha256Fingerprint(current);
    if (
      next.revision !== current.revision + 1 || !next.previous ||
      next.previous.algorithm !== previous.algorithm ||
      next.previous.digest !== previous.digest
    ) {
      throw new Error(
        "Capability runtime admin lock must advance one revision and bind the exact previous lock.",
      );
    }
    await replaceAttemptFileDurably(
      this.#path,
      text,
      directory,
      "Capability runtime admin lock made no write progress.",
    );
  }
}

/** Advisory cross-process mutation lock; it owns no project or host data. */
export class FileCapabilityRuntimeHostMutationLock
  implements CapabilityRuntimeHostMutationLock {
  readonly #path: string;

  constructor(path = `${DEFAULT_DIRECTORY}/mutation.lock`) {
    this.#path = requiredPath(path);
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await Deno.mkdir(parent(this.#path), { recursive: true });
    const file = await Deno.open(this.#path, { create: true, read: true, write: true });
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      return await operation();
    } finally {
      try {
        if (locked) await file.unlock();
      } finally {
        file.close();
      }
    }
  }
}

async function readCanonical<T>(
  path: string,
  validate: (value: unknown) => T | Promise<T>,
  label: string,
): Promise<T> {
  const text = await Deno.readTextFile(path);
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

function requiredDirectory(value: string): string {
  const directory = requiredPath(value);
  if (directory.endsWith("/")) return directory.replace(/\/+$/, "");
  return directory;
}

function requiredPath(value: string): string {
  const path = nonBlank(value, "path");
  if (path.includes("\0")) throw new TypeError("path must not contain NUL.");
  return path;
}

function parent(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : index === 0 ? "/" : path.slice(0, index);
}

function nonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must not be empty.`);
  }
  return value;
}

function canonicalIso(value: string, label: string): string {
  const text = nonBlank(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) ||
    Number.isNaN(Date.parse(text))
  ) throw new TypeError(`${label} must be one canonical UTC ISO date-time.`);
  return text;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}
