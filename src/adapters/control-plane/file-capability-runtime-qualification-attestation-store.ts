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

const DEFAULT_DIRECTORY =
  "state/local/capability-runtime-host/qualification-attestations";
const LOCK_NAME = "attestation.lock";

/**
 * An event file is named solely by its content fingerprint.  Existing equal
 * content is idempotent; a different collision is an integrity failure.  No
 * record is replaced or removed by this adapter. All appends share one
 * exclusive File.lock so qualified/revoked order is the durable linearization.
 */
export class FileCapabilityRuntimeQualificationAttestationStore
  implements CapabilityRuntimeQualificationAttestationStore {
  readonly #directory: string;

  constructor(directory = DEFAULT_DIRECTORY) {
    if (!directory || directory !== directory.trim() || directory.includes("\0")) {
      throw new TypeError("Capability runtime qualification directory is invalid.");
    }
    this.#directory = directory;
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
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const file = await openAttestationLockFile(`${this.#directory}/${LOCK_NAME}`);
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
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        this.#directory,
        "Capability runtime qualification attestation made no write progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
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
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
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
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(this.#directory));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const result: CapabilityRuntimeBindingQualificationAttestation[] = [];
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (entry.isFile && isDurableAttemptTemporaryFileName(entry.name)) continue;
      if (entry.isFile && entry.name === LOCK_NAME) continue;
      if (!entry.isFile || !entry.name.endsWith(".json")) {
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
        await Deno.readTextFile(`${this.#directory}/${entry.name}`),
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
    return `${this.#directory}/${fingerprint.digest}.json`;
  }
}

async function openAttestationLockFile(path: string): Promise<Deno.FsFile> {
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
    file = await Deno.open(path, { read: true, write: true });
  }
  try {
    const info = await Deno.lstat(path);
    if (info.isSymlink || !info.isFile) {
      throw new Error(
        "Capability runtime qualification lock must be one regular file.",
      );
    }
    const openInfo = await file.stat();
    if (
      !openInfo.isFile ||
      (info.dev !== null && info.ino !== null &&
        openInfo.dev !== null && openInfo.ino !== null &&
        (info.dev !== openInfo.dev || info.ino !== openInfo.ino))
    ) {
      throw new Error(
        "Capability runtime qualification lock path changed while it was open.",
      );
    }
    return file;
  } catch (error) {
    file.close();
    throw error;
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

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}
