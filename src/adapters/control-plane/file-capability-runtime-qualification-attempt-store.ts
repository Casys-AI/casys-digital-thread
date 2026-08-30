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
import type { CapabilityRuntimeQualificationHostStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_DIRECTORY = "state/local/capability-runtime-host/qualification-attempts";

/**
 * Each content-addressed key owns its own directory. An unrelated candidate
 * or host cannot make this attempt unreadable merely by appending its own WAL.
 */
export class FileCapabilityRuntimeQualificationAttemptStore
  implements CapabilityRuntimeQualificationAttemptStore {
  readonly #directory: string;
  readonly #now: () => string;

  constructor(
    directory = DEFAULT_DIRECTORY,
    options: { readonly now?: () => string } = {},
  ) {
    this.#directory = absoluteStorageRoot(validateStorageRoot(directory));
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async read(
    value: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined> {
    const key = validateCapabilityRuntimeQualificationAttemptKey(value);
    const directory = await this.#attemptDirectory(key);
    await assertRealDirectoryIfPresent(directory);
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
      requireDescendantPath(this.#directory, path);
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
    input: { readonly runtimeStopProof: CapabilityRuntimeQualificationHostStopProof },
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
    await ensureAbsoluteDirectoryTreeNoSymlinks(directory);
    const path = `${directory}/attempt.lock`;
    const file = await openRegularLockFile(this.#directory, path);
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      await assertOpenRegularFile(this.#directory, path, file, "WAL lock");
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
    await ensureAbsoluteDirectoryTreeNoSymlinks(directory);
    await writeIdempotently(
      this.#directory,
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
    await ensureAbsoluteDirectoryTreeNoSymlinks(directory);
    return await writeClaim(this.#directory, directory, name, text);
  }

  async #attemptDirectory(
    key: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<string> {
    const directory =
      `${this.#directory}/${await capabilityRuntimeQualificationAttemptStorageKey(
        key,
      )}`;
    requireDescendantPath(this.#directory, directory);
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
  root: string,
  directory: string,
  name: string,
  text: string,
  message: string,
): Promise<void> {
  const path = `${directory}/${name}`;
  requireDescendantPath(root, path);
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
  root: string,
  directory: string,
  name: string,
  text: string,
): Promise<boolean> {
  const path = `${directory}/${name}`;
  requireDescendantPath(root, path);
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

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}

function integrity(
  message: string,
): CapabilityRuntimeQualificationAttemptIntegrityError {
  return new CapabilityRuntimeQualificationAttemptIntegrityError(message);
}

function validateStorageRoot(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes("//")
  ) {
    throw new TypeError(
      "Capability runtime qualification attempt directory is invalid.",
    );
  }
  const root = value.replace(/\/+$/, "");
  if (root.length === 0 || root === "/" || root === "." || root === "..") {
    throw new TypeError(
      "Capability runtime qualification attempt directory is invalid.",
    );
  }
  const segments = root.split("/");
  if (segments[0] === "") segments.shift();
  if (
    segments.length === 0 ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError(
      "Capability runtime qualification attempt directory is invalid.",
    );
  }
  return root;
}

function absoluteStorageRoot(root: string): string {
  if (root.startsWith("/")) return root;
  return `${Deno.cwd().replace(/\/+$/, "")}/${root}`;
}

function requireDescendantPath(root: string, path: string): void {
  if (path.startsWith(`${root}/`)) return;
  throw integrity("Filesystem operation escaped the anchored WAL root.");
}

function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  return slash <= 0 ? "/" : clean.slice(0, slash);
}

function assertMode(
  info: Deno.FileInfo,
  expected: number,
  label: string,
): void {
  if (
    Deno.build.os !== "windows" && info.mode !== null &&
    (info.mode & 0o777) !== expected
  ) {
    throw integrity(`${label} permissions must be ${expected.toString(8)}.`);
  }
}

type PathComponentSnapshot = {
  readonly path: string;
  readonly info: Deno.FileInfo;
};

function sameInode(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return left.dev !== null && left.ino !== null && right.dev !== null &&
    right.ino !== null && left.dev === right.dev && left.ino === right.ino;
}

/**
 * lstat every existing lexical component. A symlink is refused except a
 * platform prefix alias whose parent is `/` (`/var` → `/private/var`).
 * Intermediate components must stay real directories. Recheck inodes so a
 * component that changes during the walk fails closed.
 */
async function assertExistingLexicalComponents(path: string): Promise<void> {
  const parts = path.replace(/\/+$/, "").split("/").filter((part) => part.length > 0);
  let cursor = "";
  let missing = false;
  const snapshots: PathComponentSnapshot[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    cursor = `${cursor}/${parts[index]}`;
    const last = index === parts.length - 1;
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(cursor);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      missing = true;
      continue;
    }
    if (missing) {
      throw integrity("WAL path component appeared behind a missing ancestor.");
    }
    if (info.isSymlink) {
      if (parentPath(cursor) === "/") continue;
      if (last) continue;
      throw integrity(
        "WAL root or ancestor and its ancestors must be real directories.",
      );
    }
    if (!info.isDirectory && (!last || !info.isFile)) {
      throw integrity(
        "WAL root or ancestor and its ancestors must be real directories.",
      );
    }
    snapshots.push({ path: cursor, info });
  }
  for (const snapshot of snapshots) {
    const again = await Deno.lstat(snapshot.path);
    if (
      again.isSymlink ||
      (snapshot.info.isDirectory && !again.isDirectory) ||
      (snapshot.info.isFile && !again.isFile) ||
      (snapshot.info.dev !== null && snapshot.info.ino !== null &&
        again.dev !== null && again.ino !== null &&
        !sameInode(snapshot.info, again))
    ) {
      throw integrity("WAL path component changed while it was checked.");
    }
  }
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  await assertExistingLexicalComponents(path);
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isDirectory) {
    throw integrity(`${label} and its ancestors must be real directories.`);
  }
  const real = await Deno.realPath(path);
  const realInfo = await Deno.lstat(real);
  if (
    realInfo.isSymlink || !realInfo.isDirectory ||
    (info.dev !== null && info.ino !== null && realInfo.dev !== null &&
      realInfo.ino !== null &&
      (info.dev !== realInfo.dev || info.ino !== realInfo.ino))
  ) {
    throw integrity(`${label} and its ancestors must be real directories.`);
  }
}

async function assertRealDirectoryIfPresent(path: string): Promise<void> {
  await assertExistingLexicalComponents(path);
  try {
    await assertRealDirectory(path, "WAL attempt directory");
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

async function collectMissingDirectories(path: string): Promise<string[]> {
  const missing: string[] = [];
  let cursor = path.replace(/\/+$/, "");
  while (true) {
    try {
      await Deno.lstat(cursor);
      return missing;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound) && !isNotFound(error)) throw error;
      missing.push(cursor);
      const parent = parentPath(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

async function ensureAbsoluteDirectoryTreeNoSymlinks(path: string): Promise<void> {
  await assertExistingLexicalComponents(path);
  for (const directory of (await collectMissingDirectories(path)).reverse()) {
    const parent = parentPath(directory);
    await assertRealDirectory(parent, "WAL root parent");
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    await assertRealDirectory(directory, "WAL root");
    assertMode(await Deno.lstat(directory), 0o700, "WAL directory");
  }
  await assertRealDirectory(path, "WAL root");
}

async function assertRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<Deno.FileInfo> {
  requireDescendantPath(root, path);
  await assertExistingLexicalComponents(path);
  await assertRealDirectory(parentPath(path), "WAL root");
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) {
    throw integrity(`${label} must be one regular file inside the WAL root.`);
  }
  return info;
}

async function assertMissingOrRegularFileWithinRoot(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  try {
    await assertRegularFileWithinRoot(root, path, label);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || isNotFound(error)) return;
    throw error;
  }
}

async function assertOpenRegularFile(
  root: string,
  path: string,
  file: Deno.FsFile,
  label: string,
): Promise<Deno.FileInfo> {
  const pathInfo = await assertRegularFileWithinRoot(root, path, label);
  const openInfo = await file.stat();
  if (
    !openInfo.isFile ||
    (pathInfo.dev !== null && pathInfo.ino !== null &&
      openInfo.dev !== null && openInfo.ino !== null &&
      (pathInfo.dev !== openInfo.dev || pathInfo.ino !== openInfo.ino))
  ) {
    throw integrity(`${label} path changed while it was open.`);
  }
  assertMode(openInfo, 0o600, label);
  return openInfo;
}

async function openRegularLockFile(
  root: string,
  path: string,
): Promise<Deno.FsFile> {
  requireDescendantPath(root, path);
  await assertMissingOrRegularFileWithinRoot(root, path, "WAL lock");
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, {
      createNew: true,
      read: true,
      write: true,
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists) && !isAlreadyExists(error)) {
      throw error;
    }
    await assertRegularFileWithinRoot(root, path, "WAL lock");
    file = await Deno.open(path, { read: true, write: true });
  }
  try {
    await assertOpenRegularFile(root, path, file, "WAL lock");
    return file;
  } catch (error) {
    file.close();
    throw error;
  }
}
