/**
 * Content-addressed persistence of project-source-closure/1.0 documents.
 */

import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  PROJECT_SOURCE_CLOSURE_URI_PREFIX,
  type ProjectSourceClosure,
  type ProjectSourceClosureLocator,
  validateProjectSourceClosure,
  validateProjectSourceClosureLocator,
} from "../../domain/project-source-workspace/closure.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  fingerprintResourceBytes,
  type ImmutableBytes,
} from "../../domain/compile/source/provider-resource-reader.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../shared/cas/file-byte-store.ts";
import type {
  ProjectSourceClosureStore,
  ReopenedProjectSourceClosure,
} from "../../application/ports/out/project-source-workspace/project-source-closure-store.ts";
import {
  ProjectSourceClosureStoreError,
} from "../../application/ports/out/project-source-workspace/project-source-closure-store.ts";

export class FileProjectSourceClosureStore implements ProjectSourceClosureStore {
  readonly #documents: FileByteStore<"project-source-closure">;

  constructor(documents: FileByteStore<"project-source-closure">) {
    this.#documents = documents;
  }

  async persist(
    document: ProjectSourceClosure,
  ): Promise<ProjectSourceClosureLocator> {
    const validated = await validateProjectSourceClosure(document);
    const text = deterministicJson(validated);
    const bytes = new TextEncoder().encode(text);
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(bytes),
    };
    let stored: VerifiedStoredBytes<"project-source-closure">;
    try {
      stored = await this.#documents.save(fingerprint, bytes);
      const readback = await this.#documents.read(stored.fingerprint);
      if (
        readback === undefined ||
        readback.byteLength !== bytes.byteLength
      ) {
        throw new Error("byte-count mismatch");
      }
    } catch (error) {
      throw new ProjectSourceClosureStoreError(
        "closure_readback_failed",
        `Project source closure was not durably readable after persist: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return validateProjectSourceClosureLocator({
      schemaVersion: PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
      kind: PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
      fingerprint: stored.fingerprint,
      byteCount: stored.byteCount,
      casUri: stored.uri,
    });
  }

  async reopenLocator(value: unknown): Promise<ReopenedProjectSourceClosure> {
    const locator = validateProjectSourceClosureLocator(value);
    if (
      this.#documents.uriFor(locator.fingerprint) !== locator.casUri ||
      !locator.casUri.startsWith(PROJECT_SOURCE_CLOSURE_URI_PREFIX)
    ) {
      throw new ProjectSourceClosureStoreError(
        "locator_cas_tampered",
        "Project source closure locator names a foreign CAS URI.",
        locator,
      );
    }
    let bytes: ImmutableBytes | undefined;
    try {
      bytes = await this.#documents.read(locator.fingerprint);
    } catch (error) {
      throw new ProjectSourceClosureStoreError(
        "locator_cas_tampered",
        `Project source closure failed content-addressed readback: ${
          error instanceof Error ? error.message : String(error)
        }`,
        locator,
      );
    }
    if (bytes === undefined || bytes.byteLength !== locator.byteCount) {
      throw new ProjectSourceClosureStoreError(
        "locator_cas_tampered",
        "Project source closure byte count does not match its locator.",
        locator,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes.copy()));
    } catch (error) {
      throw new ProjectSourceClosureStoreError(
        "closure_invalid",
        `Project source closure is not exact JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        locator,
      );
    }
    let document: ProjectSourceClosure;
    try {
      document = await validateProjectSourceClosure(parsed);
    } catch (error) {
      throw new ProjectSourceClosureStoreError(
        "closure_invalid",
        `Project source closure document is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        locator,
      );
    }
    const canonical = deterministicJson(document);
    const observed = await fingerprintResourceBytes(bytes.copy());
    if (
      canonical !== new TextDecoder().decode(bytes.copy()) ||
      observed !== locator.fingerprint.digest
    ) {
      throw new ProjectSourceClosureStoreError(
        "locator_cas_tampered",
        "Project source closure does not match its locator fingerprint.",
        locator,
      );
    }
    return { locator, document };
  }
}
