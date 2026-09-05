/** Durable file adapter for the private capability-runtime qualification WAL. */

import type {
  CapabilityRuntimeQualificationAttempt,
  CapabilityRuntimeQualificationAttemptIdentity,
  CapabilityRuntimeQualificationAttemptKey,
  CapabilityRuntimeQualificationAttemptOutcome,
  CapabilityRuntimeQualificationDispatchingAttempt,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import type {
  CapabilityRuntimeQualificationAttemptStore,
} from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import {
  activateQualificationAttempt,
  assertQualificationAttemptIdentity,
  assertQualificationAttemptKey,
  attestQualificationAttempt,
  canonicalCapabilityRuntimeQualificationAttemptText,
  CapabilityRuntimeQualificationAttemptIntegrityError,
  capabilityRuntimeQualificationAttemptStorageKey,
  createCapabilityRuntimeQualificationAttemptOutcome,
  dispatchingQualificationAttempt,
  fingerprintCapabilityRuntimeQualificationAttempt,
  outcomeQualificationAttempt,
  prepareQualificationAttempt,
  qualificationAttemptDispatchClaimFileName,
  qualificationAttemptEventFileName,
  qualificationAttemptIdentityOf,
  qualificationAttemptKeyFor,
  quarantineQualificationAttempt,
  recordQualificationAttempt,
  resolveQualificationAttempts,
  stopQualificationAttempt,
  submitQualificationAttemptCase,
  validateCapabilityRuntimeQualificationAttempt,
  validateCapabilityRuntimeQualificationAttemptIdentity,
  validateCapabilityRuntimeQualificationAttemptKey,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import type { CapabilityRuntimeQualificationStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-stop-proof.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
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

const DEFAULT_DIRECTORY = "state/local/capability-runtime-host/qualification-attempts";

/**
 * Each content-addressed key owns its own directory. An unrelated candidate
 * or host cannot make this attempt unreadable merely by appending its own WAL.
 */
export class FileCapabilityRuntimeQualificationAttemptStore
  implements CapabilityRuntimeQualificationAttemptStore {
  readonly #root: TrustedAnchoredStorageRoot;
  readonly #now: () => string;

  constructor(
    directory = DEFAULT_DIRECTORY,
    options: { readonly now?: () => string } = {},
  ) {
    try {
      this.#root = resolveTrustedAnchoredStorageRoot(directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TypeError(
          "Capability runtime qualification attempt directory is invalid.",
        );
      }
      throw error;
    }
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async read(
    value: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined> {
    const key = validateCapabilityRuntimeQualificationAttemptKey(value);
    const directory = await this.#attemptDirectory(key);
    await assertRealDirectoryIfPresent(this.#root, directory);
    const events: CapabilityRuntimeQualificationAttempt[] = [];
    const claims: CapabilityRuntimeQualificationDispatchingAttempt[] = [];
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(directory));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (entry.isFile && isDurableAttemptTemporaryFileName(entry.name)) continue;
      if (entry.isFile && entry.name === "attempt.lock") continue;
      const event = entry.isFile && entry.name.startsWith("event-") &&
        entry.name.endsWith(".json");
      const claim = entry.isFile && entry.name.startsWith("dispatch-claim-") &&
        entry.name.endsWith(".json");
      if (!event && !claim) {
        throw integrity(
          `Capability runtime qualification WAL contains unsupported entry ${entry.name}.`,
        );
      }
      const path = `${directory}/${entry.name}`;
      requireContainedPath(this.#root, path);
      const attempt = await readCanonicalAttempt(path, entry.name);
      assertQualificationAttemptKey(attempt, key);
      const expected = event
        ? await qualificationAttemptEventFileName(attempt)
        : await qualificationAttemptDispatchClaimFileName(asDispatching(attempt));
      if (entry.name !== expected) {
        throw integrity(
          `Capability runtime qualification WAL entry ${entry.name} has a noncanonical name.`,
        );
      }
      if (claim) claims.push(asDispatching(attempt));
      else events.push(attempt);
    }
    return resolveQualificationAttempts(events, claims);
  }

  async prepare(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    clock: { readonly preparedAt: string },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await validateCapabilityRuntimeQualificationAttemptIdentity(
      identityValue,
    );
    return await this.#serialized(qualificationAttemptKeyFor(identity), async () => {
      const current = await this.read(qualificationAttemptKeyFor(identity));
      if (current) assertQualificationAttemptIdentity(current, identity);
      return await this.#publish(
        prepareQualificationAttempt(identity, current, clock.preparedAt),
      );
    });
  }

  markActive(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStartFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => activateQualificationAttempt(current, input),
    );
  }

  markCaseSubmitted(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly caseSha256: string; readonly caseUri: string },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => submitQualificationAttemptCase(current, input),
    );
  }

  async claimDispatching(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    clock: { readonly claimedAt: string; readonly deadlineAt: string },
  ): Promise<
    | {
      readonly attempt: CapabilityRuntimeQualificationDispatchingAttempt;
      readonly dispatchNow: true;
    }
    | {
      readonly attempt: CapabilityRuntimeQualificationAttempt;
      readonly dispatchNow: false;
    }
  > {
    const identity = await validateCapabilityRuntimeQualificationAttemptIdentity(
      identityValue,
    );
    const key = qualificationAttemptKeyFor(identity);
    return await this.#serialized(key, async () => {
      const current = await this.read(key);
      if (!current) {
        throw integrity("Qualification dispatch cannot precede durable preparation.");
      }
      assertQualificationAttemptIdentity(current, identity);
      if (current.phase === "dispatching") {
        return { attempt: current, dispatchNow: false as const };
      }
      const dispatching = dispatchingQualificationAttempt(current, clock);
      if (!dispatching) return { attempt: current, dispatchNow: false as const };
      const claimedNow = await this.#claim(dispatching);
      // If event publication fails after this write, the immutable claim still
      // reconstructs `dispatching` and future recovery never calls `run` again.
      await this.#publish(dispatching);
      const observed = await this.read(key);
      if (!observed || observed.phase !== "dispatching") {
        throw integrity("Qualification dispatch claim did not become recoverable.");
      }
      return claimedNow
        ? { attempt: observed, dispatchNow: true as const }
        : { attempt: observed, dispatchNow: false as const };
    });
  }

  markRecorded(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: {
      readonly receiptSha256: string;
      readonly receiptFingerprint: ContentFingerprint;
    },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => recordQualificationAttempt(current, input),
    );
  }

  markQuarantined(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly reason: "uncertain" | "absent" | "malformed" },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => quarantineQualificationAttempt(current, input),
    );
  }

  markOutcome(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    outcome: CapabilityRuntimeQualificationAttemptOutcome,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => outcomeQualificationAttempt(current, outcome),
    );
  }

  markStopped(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStopProof: CapabilityRuntimeQualificationStopProof },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => stopQualificationAttempt(current, input),
    );
  }

  markAttested(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly attestationFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    return this.#transition(
      identityValue,
      (current) => attestQualificationAttempt(current, input),
    );
  }

  async sealDispatchDeadline(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await validateCapabilityRuntimeQualificationAttemptIdentity(
      identityValue,
    );
    return await this.#serialized(qualificationAttemptKeyFor(identity), async () => {
      const current = await this.read(qualificationAttemptKeyFor(identity));
      if (!current) {
        throw integrity("Qualification WAL is absent.");
      }
      assertQualificationAttemptIdentity(current, identity);
      if (
        current.phase === "recorded" || current.phase === "outcome" ||
        current.phase === "stopped" || current.phase === "attested"
      ) {
        return current;
      }
      if (current.phase !== "dispatching" && current.phase !== "quarantined") {
        throw integrity("Dispatch deadline applies only after a durable claim.");
      }
      if (this.#now() < current.deadlineAt) return current;
      const quarantined = current.phase === "quarantined"
        ? current
        : quarantineQualificationAttempt(current, { reason: "absent" });
      if (quarantined.phase === "quarantined") {
        await this.#publish(quarantined);
      }
      const outcome = await createCapabilityRuntimeQualificationAttemptOutcome({
        schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
        status: "unavailable",
        basis: "quarantined",
        recordedAt: this.#now(),
        basisFingerprint: await fingerprintCapabilityRuntimeQualificationAttempt(
          quarantined.phase === "quarantined" ? quarantined : current,
        ),
      });
      return await this.#publish(
        await outcomeQualificationAttempt(
          quarantined.phase === "quarantined" ? quarantined : current,
          outcome,
        ),
      );
    });
  }

  async #transition(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    transition: (
      current: CapabilityRuntimeQualificationAttempt,
    ) =>
      | CapabilityRuntimeQualificationAttempt
      | Promise<CapabilityRuntimeQualificationAttempt>,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await validateCapabilityRuntimeQualificationAttemptIdentity(
      identityValue,
    );
    return await this.#serialized(qualificationAttemptKeyFor(identity), async () => {
      const current = await this.read(qualificationAttemptKeyFor(identity));
      if (!current) {
        throw integrity("Capability runtime qualification WAL is absent.");
      }
      assertQualificationAttemptIdentity(current, identity);
      const next = await transition(current);
      return await this.#publish(next);
    });
  }

  async #serialized<T>(
    key: ReturnType<typeof qualificationAttemptKeyFor>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const directory = await this.#attemptDirectory(key);
    await ensureAbsoluteDirectoryTreeNoSymlinks(this.#root, directory);
    const path = `${directory}/attempt.lock`;
    const file = await openRegularLockFile(this.#root, path);
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      await assertOpenRegularFile(this.#root, path, file);
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
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await qualificationAttemptIdentityOf(attempt);
    const directory = await this.#attemptDirectory(
      qualificationAttemptKeyFor(identity),
    );
    const name = await qualificationAttemptEventFileName(attempt);
    const text = `${await canonicalCapabilityRuntimeQualificationAttemptText(
      attempt,
    )}\n`;
    await ensureAbsoluteDirectoryTreeNoSymlinks(this.#root, directory);
    await writeIdempotently(
      this.#root,
      directory,
      name,
      text,
      "Capability runtime qualification WAL write made no progress.",
    );
    const observed = await this.read(qualificationAttemptKeyFor(identity));
    if (!observed) {
      throw integrity("Capability runtime qualification WAL append was not readable.");
    }
    assertQualificationAttemptIdentity(observed, identity);
    return observed;
  }

  async #claim(
    attempt: CapabilityRuntimeQualificationDispatchingAttempt,
  ): Promise<boolean> {
    const identity = await qualificationAttemptIdentityOf(attempt);
    const directory = await this.#attemptDirectory(
      qualificationAttemptKeyFor(identity),
    );
    const name = await qualificationAttemptDispatchClaimFileName(attempt);
    const text = `${await canonicalCapabilityRuntimeQualificationAttemptText(
      attempt,
    )}\n`;
    await ensureAbsoluteDirectoryTreeNoSymlinks(this.#root, directory);
    return await writeClaim(this.#root, directory, name, text);
  }

  async #attemptDirectory(
    key: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<string> {
    const directory =
      `${this.#root.storageRoot}/${await capabilityRuntimeQualificationAttemptStorageKey(
        key,
      )}`;
    requireContainedPath(this.#root, directory);
    return directory;
  }
}

async function readCanonicalAttempt(
  path: string,
  label: string,
): Promise<CapabilityRuntimeQualificationAttempt> {
  const text = await Deno.readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw integrity(`Capability runtime qualification WAL entry ${label} is not JSON.`);
  }
  const attempt = await validateCapabilityRuntimeQualificationAttempt(parsed);
  if (
    `${await canonicalCapabilityRuntimeQualificationAttemptText(attempt)}\n` !== text
  ) {
    throw integrity(
      `Capability runtime qualification WAL entry ${label} is not canonical JSON.`,
    );
  }
  return attempt;
}

async function writeIdempotently(
  root: TrustedAnchoredStorageRoot,
  directory: string,
  name: string,
  text: string,
  message: string,
): Promise<void> {
  const path = `${directory}/${name}`;
  requireContainedPath(root, path);
  try {
    await writeNewAttemptFileDurably(path, text, directory, message);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    await assertRegularFileWithinRoot(root, path, "WAL event");
    if (await Deno.readTextFile(path) !== text) {
      throw integrity(
        "Capability runtime qualification WAL event collides with divergent content.",
      );
    }
  }
}

async function writeClaim(
  root: TrustedAnchoredStorageRoot,
  directory: string,
  name: string,
  text: string,
): Promise<boolean> {
  const path = `${directory}/${name}`;
  requireContainedPath(root, path);
  try {
    await writeNewAttemptFileDurably(
      path,
      text,
      directory,
      "Capability runtime qualification dispatch claim made no progress.",
    );
    return true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    await assertRegularFileWithinRoot(root, path, "WAL claim");
    if (await Deno.readTextFile(path) !== text) {
      throw integrity(
        "Capability runtime qualification dispatch claim conflicts with existing intent.",
      );
    }
    return false;
  }
}

function asDispatching(
  attempt: CapabilityRuntimeQualificationAttempt,
): CapabilityRuntimeQualificationDispatchingAttempt {
  if (attempt.phase !== "dispatching") {
    throw integrity("Only dispatching state can be a claim.");
  }
  return attempt;
}

function integrity(
  message: string,
): CapabilityRuntimeQualificationAttemptIntegrityError {
  return new CapabilityRuntimeQualificationAttemptIntegrityError(message);
}

function rethrowWalk(error: unknown): never {
  if (error instanceof AnchoredLexicalPathError) throw integrity(error.message);
  throw error;
}

const WAL_WALK_MESSAGES = {
  escaped: "Filesystem operation escaped the anchored WAL root.",
  appearedBehindMissingAncestor:
    "WAL path component appeared behind a missing ancestor.",
  notRealDirectory: "WAL root or ancestor and its ancestors must be real directories.",
  componentChanged: "WAL path component changed while it was checked.",
  regularFile: "WAL lock or event must be one regular file inside the WAL root.",
  pathChangedWhileOpen: "WAL lock path changed while it was open.",
} as const;

function requireContainedPath(
  root: TrustedAnchoredStorageRoot,
  path: string,
): void {
  try {
    requireContainedStoragePath(root, path, WAL_WALK_MESSAGES.escaped);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertRealDirectoryIfPresent(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await assertAnchoredRealDirectoryIfPresent(root, path, WAL_WALK_MESSAGES);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function ensureAbsoluteDirectoryTreeNoSymlinks(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<void> {
  try {
    await ensureAnchoredDirectoryTree(root, path, WAL_WALK_MESSAGES, 0o700);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertRegularFileWithinRoot(
  root: TrustedAnchoredStorageRoot,
  path: string,
  _label: string,
): Promise<Deno.FileInfo> {
  try {
    return await assertAnchoredRegularFile(root, path, WAL_WALK_MESSAGES);
  } catch (error) {
    rethrowWalk(error);
  }
}

async function assertOpenRegularFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
  file: Deno.FsFile,
): Promise<Deno.FileInfo> {
  try {
    return await assertAnchoredOpenRegularFile(
      root,
      path,
      file,
      WAL_WALK_MESSAGES,
      0o600,
    );
  } catch (error) {
    rethrowWalk(error);
  }
}

async function openRegularLockFile(
  root: TrustedAnchoredStorageRoot,
  path: string,
): Promise<Deno.FsFile> {
  try {
    return await openAnchoredRegularLockFile(root, path, WAL_WALK_MESSAGES, 0o600);
  } catch (error) {
    rethrowWalk(error);
  }
}
