/** Filesystem CAS adapters for provider-free Build123d execution evidence. */

import {
  type Build123dExecutionCapture,
  type Build123dExecutionDraft,
  type Build123dExecutionDraftReference,
  buildBuild123dExecutionDraftReference,
  validateBuild123dExecutionCapture,
  validateBuild123dExecutionDraft,
  validateBuild123dExecutionDraftReference,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  Build123dExecutionCaptureStore,
  Build123dExecutionDraftStore,
  PersistedBuild123dExecutionCapture,
} from "../../../application/ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import {
  type CaptureStoreDescriptor,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export const BUILD123D_EXECUTION_DRAFT_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "build123d-execution-draft"
> = {
  kind: "build123d-execution-draft",
  directory: "state/local/build123d-execution-drafts",
  uriNamespace: "build123d-execution-draft",
  label: "Build123d execution draft",
};

export const BUILD123D_EXECUTION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "build123d-execution-capture"
> = {
  kind: "build123d-execution-capture",
  directory: "state/local/build123d-execution-captures",
  uriNamespace: "build123d-execution-capture",
  label: "Build123d execution capture",
};

export class Build123dExecutionEvidenceStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Build123dExecutionEvidenceStoreIntegrityError";
  }
}

/**
 * Private non-canonical draft CAS. Its storage URI and path never cross the
 * adapter; callers receive only the domain reference derived from its bytes.
 */
export class FileBuild123dExecutionDraftStore implements Build123dExecutionDraftStore {
  readonly #directory: string;
  readonly #store: FileCaptureStore<"build123d-execution-draft">;

  constructor(
    directory = BUILD123D_EXECUTION_DRAFT_CAPTURE_DESCRIPTOR.directory,
  ) {
    this.#directory = privateDirectory(directory);
    this.#store = new FileCaptureStore({
      ...BUILD123D_EXECUTION_DRAFT_CAPTURE_DESCRIPTOR,
      directory: this.#directory,
    });
  }

  async save(
    value: unknown,
  ): Promise<{
    readonly draft: Build123dExecutionDraft;
    readonly reference: Build123dExecutionDraftReference;
  }> {
    const draft = await validateBuild123dExecutionDraft(value);
    const reference = await buildBuild123dExecutionDraftReference(draft);
    const canonical = deterministicJson(draft);
    await ensurePrivateDirectory(this.#directory);
    const persisted = await this.#store.save(reference.fingerprint, canonical);
    await Deno.chmod(persisted.path, 0o600);
    await Deno.chmod(this.#directory, 0o700);
    const reread = await this.read(reference);
    if (!reread || deterministicJson(reread) !== canonical) {
      throw new Build123dExecutionEvidenceStoreIntegrityError(
        "The Build123d execution draft failed its exact durable reread.",
      );
    }
    return Object.freeze({ draft: reread, reference });
  }

  async read(
    referenceValue: Build123dExecutionDraftReference,
  ): Promise<Build123dExecutionDraft | undefined> {
    const reference = validateBuild123dExecutionDraftReference(referenceValue);
    const text = await this.#store.read(reference.fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Build123dExecutionEvidenceStoreIntegrityError(
        "The Build123d execution draft is not JSON.",
      );
    }
    let draft: Build123dExecutionDraft;
    try {
      draft = await validateBuild123dExecutionDraft(parsed);
    } catch {
      throw new Build123dExecutionEvidenceStoreIntegrityError(
        "The Build123d execution draft failed exact replay validation.",
      );
    }
    const observedReference = await buildBuild123dExecutionDraftReference(draft);
    if (
      text !== deterministicJson(draft) ||
      deterministicJson(observedReference) !== deterministicJson(reference)
    ) {
      throw new Build123dExecutionEvidenceStoreIntegrityError(
        "The Build123d execution draft is non-canonical or divergent.",
      );
    }
    return draft;
  }
}

/** Private capture CAS used to publish the documentary Thread evidence. */
export class FileBuild123dExecutionCaptureStore
  implements Build123dExecutionCaptureStore {
  readonly #directory: string;
  readonly #store: FileCaptureStore<"build123d-execution-capture">;

  constructor(
    directory = BUILD123D_EXECUTION_CAPTURE_DESCRIPTOR.directory,
  ) {
    this.#directory = privateDirectory(directory);
    this.#store = new FileCaptureStore({
      ...BUILD123D_EXECUTION_CAPTURE_DESCRIPTOR,
      directory: this.#directory,
    });
  }

  async save(value: unknown): Promise<PersistedBuild123dExecutionCapture> {
    await ensurePrivateDirectory(this.#directory);
    const persisted = await persistBuild123dExecutionCapture(this.#store, value);
    const path = this.#store.pathFor(persisted.fingerprint);
    await Deno.chmod(path, 0o600);
    await Deno.chmod(this.#directory, 0o700);
    const reread = await this.read(persisted.fingerprint);
    if (
      !reread || deterministicJson(reread) !== deterministicJson(persisted.capture)
    ) {
      throw new Build123dExecutionEvidenceStoreIntegrityError(
        "The Build123d execution capture failed its exact durable reread.",
      );
    }
    return Object.freeze({ ...persisted, capture: reread });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<Build123dExecutionCapture | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    return await parseCapture(text, fingerprint);
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#store.uriFor(fingerprint);
  }
}

/**
 * Persist and reopen through a structurally supplied capture CAS. This helper
 * keeps executor dependencies adapter-neutral while retaining exact readback.
 */
export async function persistBuild123dExecutionCapture(
  store: Pick<
    FileCaptureStore<"build123d-execution-capture">,
    "save" | "read" | "uriFor"
  >,
  value: unknown,
): Promise<PersistedBuild123dExecutionCapture> {
  const capture = await validateBuild123dExecutionCapture(value);
  const fingerprint = await sha256Fingerprint(capture);
  const canonical = deterministicJson(capture);
  await store.save(fingerprint, canonical);
  const reread = await store.read(fingerprint);
  if (reread === undefined) {
    throw new Build123dExecutionEvidenceStoreIntegrityError(
      "The Build123d execution capture disappeared after publication.",
    );
  }
  const reopened = await parseCapture(reread, fingerprint);
  return Object.freeze({
    capture: reopened,
    fingerprint,
    uri: store.uriFor(fingerprint),
  });
}

async function parseCapture(
  text: string,
  expectedFingerprint: ContentFingerprint,
): Promise<Build123dExecutionCapture> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Build123dExecutionEvidenceStoreIntegrityError(
      "The Build123d execution capture is not JSON.",
    );
  }
  let capture: Build123dExecutionCapture;
  try {
    capture = await validateBuild123dExecutionCapture(parsed);
  } catch {
    throw new Build123dExecutionEvidenceStoreIntegrityError(
      "The Build123d execution capture failed exact replay validation.",
    );
  }
  const observed = await sha256Fingerprint(capture);
  if (
    text !== deterministicJson(capture) ||
    !fingerprintsEqual(observed, expectedFingerprint)
  ) {
    throw new Build123dExecutionEvidenceStoreIntegrityError(
      "The Build123d execution capture is non-canonical or divergent.",
    );
  }
  return capture;
}

function privateDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) {
    throw new TypeError("Build123d evidence directory must be a bounded path.");
  }
  return value.replace(/\/+$/, "");
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
  await Deno.chmod(directory, 0o700);
}
