/** Host-local append-only store for exact runtime qualification attestations. */

import type {
  CapabilityRuntimeQualificationAttestationStore,
} from "../../application/ports/out/capability/capability-runtime-qualification-attestation-store.ts";
import {
  canonicalCapabilityRuntimeBindingQualificationAttestationText,
  type CapabilityRuntimeBindingQualificationAttestation,
  validateCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_DIRECTORY =
  "state/local/capability-runtime-host/qualification-attestations";

/**
 * An event file is named solely by its content fingerprint.  Existing equal
 * content is idempotent; a different collision is an integrity failure.  No
 * record is replaced or removed by this adapter.
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
    const attestation = await validateCapabilityRuntimeBindingQualificationAttestation(
      value,
    );
    const text = `${await canonicalCapabilityRuntimeBindingQualificationAttestationText(
      attestation,
    )}\n`;
    const path = this.#path(attestation.fingerprint);
    await Deno.mkdir(this.#directory, { recursive: true });
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

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CapabilityRuntimeBindingQualificationAttestation | undefined> {
    validateFingerprint(fingerprint, "$qualificationAttestationFingerprint");
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

  async list(): Promise<readonly CapabilityRuntimeBindingQualificationAttestation[]> {
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
      // A list may overlap the short private-write window before `link` makes
      // the canonical immutable name visible. Ignore only this writer's exact
      // UUID temporary pattern; every other foreign entry remains corruption.
      if (entry.isFile && isDurableAttemptTemporaryFileName(entry.name)) continue;
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
