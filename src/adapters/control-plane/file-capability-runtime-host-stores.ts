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
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeCatalog,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
  CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  validateCapabilityRuntimeAdminLock,
  validateCapabilityRuntimeAdminPolicy,
} from "./capability-runtime-catalog.ts";
import type {
  CapabilityRuntimeHostMutationLock,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseClaim,
  CapabilityRuntimeLeaseStore,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_DIRECTORY = "state/local/capability-runtime-host";

/**
 * Local administrator policy. It is deliberately absent-by-default: absence
 * means the reviewed catalogue order is used, not that a caller may nominate a
 * binding. A malformed or stale file is an operational configuration error,
 * never a reason to fall back silently.
 */
export class FileCapabilityRuntimeAdminPolicyStore {
  readonly #path: string;

  constructor(
    path = `${DEFAULT_DIRECTORY}/admin-policy.json`,
    private readonly catalog?: CapabilityRuntimeCatalog,
  ) {
    this.#path = requiredPath(path);
  }

  async read(): Promise<CapabilityRuntimeAdminPolicy> {
    try {
      return await readCanonical(
        this.#path,
        (value) => validateCapabilityRuntimeAdminPolicy(value, this.catalog),
        "Capability runtime admin policy",
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return validateCapabilityRuntimeAdminPolicy({
        schemaVersion: CAPABILITY_RUNTIME_ADMIN_POLICY_SCHEMA_VERSION,
        disabledBindingIds: [],
        preferences: [],
      }, this.catalog);
    }
  }

  /** Administrative writes are local-only and never exposed through MCP/UI. */
  async save(value: CapabilityRuntimeAdminPolicy): Promise<void> {
    const next = validateCapabilityRuntimeAdminPolicy(value, this.catalog);
    const directory = parent(this.#path);
    await Deno.mkdir(directory, { recursive: true });
    await replaceAttemptFileDurably(
      this.#path,
      `${deterministicJson(next)}\n`,
      directory,
      "Capability runtime admin policy made no write progress.",
    );
  }
}

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
    const entry = await validateCapabilityRuntimeJournalEntry(entryValue);
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
    if (
      !sameOrderedMaterials(
        outcome.observations.map((observation) => observation.material),
        intent.materials,
      )
    ) {
      throw new Error(
        `Capability runtime outcome ${outcome.journalEntryId} must observe every exact group material in order.`,
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
    validate: (value: unknown) => T | Promise<T>,
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

  async claim(
    leaseValue: CapabilityRuntimeLease,
  ): Promise<CapabilityRuntimeLeaseClaim> {
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
      return { status: "created", lease };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      return {
        status: "existing",
        lease: await readCanonical(
          path,
          validateCapabilityRuntimeLease,
          "Capability runtime lease",
        ),
      };
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
 * Immutable local administration-lock history. It is deliberately separate
 * from project ledgers and host mutation leases. `admin-lock.json` from the
 * retired overwrite model is not read or migrated: an ambiguous old desired
 * state must never regain authority after this breaking boundary.
 */
export class FileCapabilityRuntimeAdminLockStore {
  readonly #legacyPath: string;

  constructor(
    path = `${DEFAULT_DIRECTORY}/admin-lock.json`,
    private readonly catalog?: CapabilityRuntimeCatalog,
  ) {
    this.#legacyPath = requiredPath(path);
  }

  /**
   * The empty local lock is a safe desired-state baseline: it authorizes no
   * activation by itself and keeps every selected material desired `absent`.
   */
  async read(): Promise<CapabilityRuntimeAdminLock> {
    const head = await this.#readHead();
    if (!head) {
      await this.#assertNoOrphanedHistory();
      return await this.#empty();
    }
    const history = await this.#readHistoryToHead(head);
    const lock = history.at(-1)!;
    const fingerprint = await sha256Fingerprint(lock);
    if (
      fingerprint.algorithm !== head.lockFingerprint.algorithm ||
      fingerprint.digest !== head.lockFingerprint.digest
    ) {
      throw new Error(
        "Capability runtime admin lock head does not name its exact revision.",
      );
    }
    return lock;
  }

  async readRevision(revision: number): Promise<CapabilityRuntimeAdminLock> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new TypeError(
        "Capability runtime admin lock revision must be non-negative.",
      );
    }
    if (revision === 0) return await this.#empty();
    try {
      const lock = await readCanonical(
        this.#revisionPath(revision),
        (value) => validateCapabilityRuntimeAdminLock(value),
        `Capability runtime admin lock revision ${revision}`,
      );
      if (lock.revision !== revision) {
        throw new Error(
          `Capability runtime admin lock path ${revision} contains another revision.`,
        );
      }
      return lock;
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(
          `Capability runtime admin lock revision ${revision} is absent.`,
        );
      }
      throw error;
    }
  }

  async list(): Promise<readonly CapabilityRuntimeAdminLock[]> {
    const head = await this.#readHead();
    if (!head) {
      await this.#assertNoOrphanedHistory();
      return [await this.#empty()];
    }
    return await this.#readHistoryToHead(head);
  }

  /**
   * `read()` and `list()` share this non-recursive chain validation. A valid
   * head is insufficient: deleting or corrupting a predecessor must revoke
   * the local activation authority rather than leaving a truncated history.
   */
  async #readHistoryToHead(
    head: {
      readonly schemaVersion: "capability-runtime-admin-lock-head/1.0";
      readonly revision: number;
      readonly lockFingerprint: Awaited<ReturnType<typeof sha256Fingerprint>>;
    },
  ): Promise<readonly CapabilityRuntimeAdminLock[]> {
    const result: CapabilityRuntimeAdminLock[] = [await this.#empty()];
    for (let revision = 1; revision <= head.revision; revision++) {
      const lock = await this.readRevision(revision);
      const previous = result.at(-1)!;
      const previousFingerprint = await sha256Fingerprint(previous);
      if (
        lock.revision !== revision || !lock.previous ||
        lock.previous.algorithm !== previousFingerprint.algorithm ||
        lock.previous.digest !== previousFingerprint.digest
      ) {
        throw new Error(
          `Capability runtime admin lock revision ${revision} does not retain its exact predecessor.`,
        );
      }
      result.push(lock);
    }
    const tip = result.at(-1)!;
    const fingerprint = await sha256Fingerprint(tip);
    if (
      fingerprint.algorithm !== head.lockFingerprint.algorithm ||
      fingerprint.digest !== head.lockFingerprint.digest
    ) {
      throw new Error(
        "Capability runtime admin lock head does not name its exact revision.",
      );
    }
    return result;
  }

  async save(value: CapabilityRuntimeAdminLock): Promise<void> {
    const lockPath = `${this.#historyDirectory()}/.write.lock`;
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
    const next = await validateCapabilityRuntimeAdminLock(value, this.catalog);
    const directory = this.#historyDirectory();
    await Deno.mkdir(directory, { recursive: true });
    // The only headless recoverable state is a first revision whose immutable
    // body was synced just before the process died. Adopt precisely the same
    // candidate; any other headless artifact fails closed.
    if (!await this.#readHead()) {
      const orphan = await this.#readOrphanedFirstRevision(next);
      if (orphan) {
        await this.#writeHead(next);
        return;
      }
      await this.#assertNoOrphanedHistory();
    }
    const current = await this.read();
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
    const revisionPath = this.#revisionPath(next.revision);
    const text = `${deterministicJson(next)}\n`;
    try {
      await writeNewAttemptFileDurably(
        revisionPath,
        text,
        directory,
        "Capability runtime admin lock revision made no write progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await Deno.readTextFile(revisionPath);
      if (existing !== text) {
        throw new Error(
          "Capability runtime admin lock revision already exists with different exact content.",
        );
      }
    }
    await this.#writeHead(next);
  }

  async #writeHead(next: CapabilityRuntimeAdminLock): Promise<void> {
    const head = {
      schemaVersion: "capability-runtime-admin-lock-head/1.0" as const,
      revision: next.revision,
      lockFingerprint: await sha256Fingerprint(next),
    };
    await replaceAttemptFileDurably(
      this.#headPath(),
      `${deterministicJson(head)}\n`,
      parent(this.#headPath()),
      "Capability runtime admin lock head made no write progress.",
    );
  }

  async #readOrphanedFirstRevision(
    next: CapabilityRuntimeAdminLock,
  ): Promise<boolean> {
    if (next.revision !== 1) return false;
    try {
      const stored = await readCanonical(
        this.#revisionPath(1),
        (value) => validateCapabilityRuntimeAdminLock(value, this.catalog),
        "Capability runtime orphaned first revision",
      );
      if (
        stored.revision !== 1 || deterministicJson(stored) !== deterministicJson(next)
      ) {
        throw new Error(
          "Capability runtime orphaned first revision differs from the exact save retry.",
        );
      }
      const baseline = await this.#empty();
      const baselineFingerprint = await sha256Fingerprint(baseline);
      if (
        !stored.previous ||
        stored.previous.algorithm !== baselineFingerprint.algorithm ||
        stored.previous.digest !== baselineFingerprint.digest
      ) {
        throw new Error(
          "Capability runtime orphaned first revision does not bind the empty baseline.",
        );
      }
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async rollback(revision: number): Promise<CapabilityRuntimeAdminLock> {
    const source = await this.readRevision(revision);
    const current = await this.read();
    const previous = await sha256Fingerprint(current);
    const successor = await validateCapabilityRuntimeAdminLock({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
      revision: current.revision + 1,
      previous,
      units: structuredClone(source.units),
    }, this.catalog);
    await this.save(successor);
    return await this.read();
  }

  #historyDirectory(): string {
    return `${parent(this.#legacyPath)}/admin-lock-revisions`;
  }

  #headPath(): string {
    return `${parent(this.#legacyPath)}/admin-lock-head.json`;
  }

  #revisionPath(revision: number): string {
    return `${this.#historyDirectory()}/${String(revision).padStart(10, "0")}.json`;
  }

  async #readHead(): Promise<
    {
      readonly schemaVersion: "capability-runtime-admin-lock-head/1.0";
      readonly revision: number;
      readonly lockFingerprint: Awaited<ReturnType<typeof sha256Fingerprint>>;
    } | undefined
  > {
    try {
      return await readCanonical(this.#headPath(), (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError("Capability runtime admin lock head is not an object.");
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).toSorted();
        if (
          deterministicJson(keys) !== deterministicJson([
              "lockFingerprint",
              "revision",
              "schemaVersion",
            ]) ||
          record.schemaVersion !== "capability-runtime-admin-lock-head/1.0" ||
          !Number.isSafeInteger(record.revision) || Number(record.revision) < 1 ||
          !record.lockFingerprint || typeof record.lockFingerprint !== "object"
        ) {
          throw new TypeError("Capability runtime admin lock head is invalid.");
        }
        const fingerprint = record.lockFingerprint as Record<string, unknown>;
        if (
          fingerprint.algorithm !== "sha256" ||
          typeof fingerprint.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(fingerprint.digest)
        ) {
          throw new TypeError(
            "Capability runtime admin lock head fingerprint is invalid.",
          );
        }
        return {
          schemaVersion: "capability-runtime-admin-lock-head/1.0" as const,
          revision: Number(record.revision),
          lockFingerprint: { algorithm: "sha256" as const, digest: fingerprint.digest },
        };
      }, "Capability runtime admin lock head");
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async #assertNoOrphanedHistory(): Promise<void> {
    try {
      for await (const entry of Deno.readDir(this.#historyDirectory())) {
        if (entry.name === ".write.lock") continue;
        throw new Error(
          "Capability runtime admin lock history exists without one durable head.",
        );
      }
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async #empty(): Promise<CapabilityRuntimeAdminLock> {
    return await validateCapabilityRuntimeAdminLock({
      schemaVersion: CAPABILITY_RUNTIME_ADMIN_LOCK_SCHEMA_VERSION,
      revision: 0,
      previous: null,
      units: [],
    }, this.catalog);
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

function sameOrderedMaterials(
  left: readonly {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }[],
  right: readonly {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }[],
): boolean {
  return left.length === right.length &&
    left.every((material, index) =>
      material.unitId === right[index]!.unitId &&
      material.materialId === right[index]!.materialId &&
      material.imageDigest === right[index]!.imageDigest
    );
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
