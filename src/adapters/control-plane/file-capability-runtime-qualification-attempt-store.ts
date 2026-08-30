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
  dispatchingQualificationAttempt,
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

  constructor(directory = DEFAULT_DIRECTORY) {
    if (!directory || directory === "/" || directory.includes("\0")) {
      throw new TypeError(
        "Capability runtime qualification attempt directory is invalid.",
      );
    }
    this.#directory = directory.replace(/\/+$/, "");
  }

  async read(
    value: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined> {
    const key = validateCapabilityRuntimeQualificationAttemptKey(value);
    const directory = await this.#attemptDirectory(key);
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
      const event = entry.isFile && entry.name.startsWith("event-") &&
        entry.name.endsWith(".json");
      const claim = entry.isFile && entry.name.startsWith("dispatch-claim-") &&
        entry.name.endsWith(".json");
      if (!event && !claim) {
        throw integrity(
          `Capability runtime qualification WAL contains unsupported entry ${entry.name}.`,
        );
      }
      const attempt = await readCanonicalAttempt(
        `${directory}/${entry.name}`,
        entry.name,
      );
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
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await validateCapabilityRuntimeQualificationAttemptIdentity(
      identityValue,
    );
    const current = await this.read(qualificationAttemptKeyFor(identity));
    if (current) assertQualificationAttemptIdentity(current, identity);
    return await this.#publish(prepareQualificationAttempt(identity, current));
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
    const current = await this.read(key);
    if (!current) {
      throw integrity("Qualification dispatch cannot precede durable preparation.");
    }
    assertQualificationAttemptIdentity(current, identity);
    const dispatching = dispatchingQualificationAttempt(current);
    if (!dispatching) return { attempt: current, dispatchNow: false };
    const claimedNow = await this.#claim(dispatching);
    // If event publication fails after this write, the immutable claim still
    // reconstructs `dispatching` and future recovery never calls `run` again.
    await this.#publish(dispatching);
    const observed = await this.read(key);
    if (!observed || observed.phase !== "dispatching") {
      throw integrity("Qualification dispatch claim did not become recoverable.");
    }
    return claimedNow
      ? { attempt: observed, dispatchNow: true }
      : { attempt: observed, dispatchNow: false };
  }

  markRecorded(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly receiptFingerprint: ContentFingerprint },
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
    input: { readonly runtimeStopFingerprint: ContentFingerprint },
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
    const current = await this.read(qualificationAttemptKeyFor(identity));
    if (!current) {
      throw integrity("Capability runtime qualification WAL is absent.");
    }
    assertQualificationAttemptIdentity(current, identity);
    const next = await transition(current);
    return await this.#publish(next);
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
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    await writeIdempotently(
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
    await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
    return await writeClaim(directory, name, text);
  }

  async #attemptDirectory(
    key: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<string> {
    return `${this.#directory}/${await capabilityRuntimeQualificationAttemptStorageKey(
      key,
    )}`;
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
  directory: string,
  name: string,
  text: string,
  message: string,
): Promise<void> {
  const path = `${directory}/${name}`;
  try {
    await writeNewAttemptFileDurably(path, text, directory, message);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (await Deno.readTextFile(path) !== text) {
      throw integrity(
        "Capability runtime qualification WAL event collides with divergent content.",
      );
    }
  }
}

async function writeClaim(
  directory: string,
  name: string,
  text: string,
): Promise<boolean> {
  const path = `${directory}/${name}`;
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
