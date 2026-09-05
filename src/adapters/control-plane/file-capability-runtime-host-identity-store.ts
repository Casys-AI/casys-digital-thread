/** Stable opaque identity for one local capability-runtime host. */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { writeNewAttemptFileDurably } from "../shared/wal/durable-attempt-file-writes.ts";

const DEFAULT_PATH = "state/local/capability-runtime-host/host-identity.json";
const SCHEMA_VERSION = "capability-runtime-host-identity/1.0" as const;

export interface CapabilityRuntimeHostIdentityReader {
  read(): Promise<ContentFingerprint>;
}

/**
 * The random opaque id stays local. Consumers receive only its deterministic
 * digest, so qualification can reject an attestation copied from another host
 * without serialising a serial number, credential, Docker value or hostname.
 */
export class FileCapabilityRuntimeHostIdentityStore
  implements CapabilityRuntimeHostIdentityReader {
  readonly #path: string;

  constructor(path = DEFAULT_PATH) {
    if (!path || path !== path.trim() || path.includes("\0")) {
      throw new TypeError("Capability runtime host identity path is invalid.");
    }
    this.#path = path;
  }

  async read(): Promise<ContentFingerprint> {
    try {
      return await this.#readStored();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const id = crypto.randomUUID();
    const body = { schemaVersion: SCHEMA_VERSION, id };
    const fingerprint = await sha256Fingerprint(body);
    const text = `${deterministicJson({ ...body, fingerprint })}\n`;
    const directory = parent(this.#path);
    await Deno.mkdir(directory, { recursive: true });
    try {
      await writeNewAttemptFileDurably(
        this.#path,
        text,
        directory,
        "Capability runtime host identity made no write progress.",
      );
      return fingerprint;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      return await this.#readStored();
    }
  }

  async #readStored(): Promise<ContentFingerprint> {
    const text = await Deno.readTextFile(this.#path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Capability runtime host identity is not valid JSON.");
    }
    const root = record(parsed, ["schemaVersion", "id", "fingerprint"]);
    if (
      root.schemaVersion !== SCHEMA_VERSION || typeof root.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(root.id)
    ) {
      throw new Error("Capability runtime host identity has an invalid body.");
    }
    const fingerprint = contentFingerprint(root.fingerprint);
    const expected = await sha256Fingerprint({
      schemaVersion: SCHEMA_VERSION,
      id: root.id,
    });
    if (
      fingerprint.algorithm !== expected.algorithm ||
      fingerprint.digest !== expected.digest
    ) {
      throw new Error("Capability runtime host identity fingerprint is stale.");
    }
    if (
      text !==
        `${
          deterministicJson({ schemaVersion: SCHEMA_VERSION, id: root.id, fingerprint })
        }\n`
    ) {
      throw new Error("Capability runtime host identity is not canonical JSON.");
    }
    return fingerprint;
  }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capability runtime host identity must be an object.");
  }
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  ) {
    throw new Error("Capability runtime host identity has unsupported fields.");
  }
  return result;
}

function contentFingerprint(value: unknown): ContentFingerprint {
  const root = record(value, ["algorithm", "digest"]);
  if (
    root.algorithm !== "sha256" || typeof root.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.digest)
  ) {
    throw new Error("Capability runtime host identity has an invalid fingerprint.");
  }
  return { algorithm: "sha256", digest: root.digest };
}

function parent(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    throw new TypeError(
      "Capability runtime host identity path requires one parent directory.",
    );
  }
  return path.slice(0, index);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}
