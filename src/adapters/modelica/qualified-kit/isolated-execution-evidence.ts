/** Private CAS for documentary local Modelica execution captures. */

import type {
  ModelicaIsolatedExecutionCaptureStore,
  PersistedModelicaIsolatedExecutionCapture,
} from "../../../application/ports/out/modelica/isolated-execution-evidence-store.ts";
import {
  type ModelicaIsolatedExecutionCapture,
  validateModelicaIsolatedExecutionCapture,
} from "../../../domain/modelica/qualified-kit/isolated-execution-evidence.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type CaptureStoreDescriptor,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export const MODELICA_ISOLATED_EXECUTION_CAPTURE_DESCRIPTOR: CaptureStoreDescriptor<
  "modelica-qualified-kit-execution-capture"
> = {
  kind: "modelica-qualified-kit-execution-capture",
  directory: "state/local/modelica-qualified-kit-execution-captures",
  uriNamespace: "modelica-qualified-kit-execution-capture",
  label: "Qualified Modelica kit execution",
};

export class ModelicaIsolatedExecutionEvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaIsolatedExecutionEvidenceIntegrityError";
  }
}

export class FileModelicaIsolatedExecutionCaptureStore
  implements ModelicaIsolatedExecutionCaptureStore {
  readonly #directory: string;
  readonly #store: FileCaptureStore<"modelica-qualified-kit-execution-capture">;

  constructor(
    directory = MODELICA_ISOLATED_EXECUTION_CAPTURE_DESCRIPTOR.directory,
  ) {
    this.#directory = boundedDirectory(directory);
    this.#store = new FileCaptureStore({
      ...MODELICA_ISOLATED_EXECUTION_CAPTURE_DESCRIPTOR,
      directory: this.#directory,
    });
  }

  async save(
    value: ModelicaIsolatedExecutionCapture,
  ): Promise<PersistedModelicaIsolatedExecutionCapture> {
    const capture = await validateModelicaIsolatedExecutionCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.#directory, 0o700);
    const persisted = await this.#store.save(fingerprint, deterministicJson(capture));
    await Deno.chmod(persisted.path, 0o600);
    const reread = await this.read(fingerprint);
    if (!reread || deterministicJson(reread) !== deterministicJson(capture)) {
      throw integrity("The local Modelica capture failed its durable reread.");
    }
    return Object.freeze({ capture: reread, fingerprint, uri: persisted.uri });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ModelicaIsolatedExecutionCapture | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The local Modelica capture is not JSON.");
    }
    let capture: ModelicaIsolatedExecutionCapture;
    try {
      capture = await validateModelicaIsolatedExecutionCapture(parsed);
    } catch {
      throw integrity("The local Modelica capture failed exact replay validation.");
    }
    const observed = await sha256Fingerprint(capture);
    if (
      text !== deterministicJson(capture) || !fingerprintsEqual(observed, fingerprint)
    ) {
      throw integrity("The local Modelica capture is non-canonical or divergent.");
    }
    return capture;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#store.uriFor(fingerprint);
  }
}

function boundedDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) throw new TypeError("Modelica evidence directory must be a bounded path.");
  return value.replace(/\/+$/, "");
}

function integrity(message: string): ModelicaIsolatedExecutionEvidenceIntegrityError {
  return new ModelicaIsolatedExecutionEvidenceIntegrityError(message);
}
