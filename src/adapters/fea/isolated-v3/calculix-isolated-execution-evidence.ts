/** CAS persistence for one replay-valid isolated CalculiX evidence record. */

import type { CalculixIsolatedExecutionEvidenceStore } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-evidence-store.ts";
import {
  type CalculixIsolatedExecutionEvidence,
  validateCalculixIsolatedExecutionEvidence,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type CaptureStoreDescriptor,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export const CALCULIX_ISOLATED_EVIDENCE_DESCRIPTOR: CaptureStoreDescriptor<
  "calculix-isolated-execution-evidence"
> = {
  kind: "calculix-isolated-execution-evidence",
  directory: "state/local/calculix-isolated-execution-evidence",
  uriNamespace: "calculix-isolated-execution-evidence",
  label: "Isolated CalculiX execution evidence",
};

export class CalculixIsolatedExecutionEvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculixIsolatedExecutionEvidenceIntegrityError";
  }
}

export class FileCalculixIsolatedExecutionEvidenceStore
  implements CalculixIsolatedExecutionEvidenceStore {
  readonly #directory: string;
  readonly #store: FileCaptureStore<"calculix-isolated-execution-evidence">;

  constructor(
    directory = CALCULIX_ISOLATED_EVIDENCE_DESCRIPTOR.directory,
    syncBoundary?: string,
  ) {
    this.#directory = boundedDirectory(directory);
    this.#store = new FileCaptureStore({
      ...CALCULIX_ISOLATED_EVIDENCE_DESCRIPTOR,
      directory: this.#directory,
      ...(syncBoundary === undefined ? {} : { syncBoundary }),
    });
  }

  async save(value: unknown) {
    const evidence = await validateCalculixIsolatedExecutionEvidence(value);
    const fingerprint = evidence.fingerprint;
    const text = deterministicJson(evidenceBody(evidence));
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.#directory, 0o700);
    const persisted = await this.#store.save(fingerprint, text);
    await Deno.chmod(persisted.path, 0o600);
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(evidenceBody(reopened)) !== text) {
      throw new CalculixIsolatedExecutionEvidenceIntegrityError(
        "The isolated CalculiX evidence failed its durable reread.",
      );
    }
    return Object.freeze({
      evidence: reopened,
      fingerprint,
      uri: this.uriFor(fingerprint),
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CalculixIsolatedExecutionEvidence | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The isolated CalculiX evidence is not JSON.");
    }
    let evidence: CalculixIsolatedExecutionEvidence;
    try {
      evidence = await validateCalculixIsolatedExecutionEvidence({
        ...(parsed as Record<string, unknown>),
        fingerprint,
      });
    } catch {
      throw integrity("The isolated CalculiX evidence failed replay validation.");
    }
    if (
      text !== deterministicJson(evidenceBody(evidence)) ||
      !fingerprintsEqual(evidence.fingerprint, fingerprint)
    ) {
      throw integrity("The isolated CalculiX evidence is non-canonical or divergent.");
    }
    return evidence;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#store.uriFor(fingerprint);
  }
}

function evidenceBody(evidence: CalculixIsolatedExecutionEvidence) {
  const { fingerprint: _fingerprint, ...body } = evidence;
  return body;
}

function boundedDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) throw new TypeError("CalculiX evidence directory must be bounded.");
  return value.replace(/\/+$/, "");
}

function integrity(message: string): CalculixIsolatedExecutionEvidenceIntegrityError {
  return new CalculixIsolatedExecutionEvidenceIntegrityError(message);
}
