/** Publication-backed authority for one exact local Modelica qualification. */

import type { ModelicaIsolatedExecutionQualificationAuthority } from "../../../application/ports/out/modelica/isolated-execution-qualification.ts";
import type { ModelicaIsolatedExecutionProfile } from "../../../application/ports/out/modelica/isolated-execution-profile.ts";
import type { IsolatedOutputPublicationReader } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { isolatedCodeExecutionReceiptRecord } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  type ModelicaMicrosandboxQualificationCapture,
  type ModelicaMicrosandboxQualificationReference,
  validateModelicaMicrosandboxQualificationCapture,
  validateModelicaMicrosandboxQualificationReference,
} from "../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import { validateModelicaIsolatedRun } from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
  MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
  MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
} from "./kit-v1/qualification-kit.ts";
import { validateModelicaIsolatedExecutionProfile } from "./execution-profile.ts";
import {
  type CaptureStoreDescriptor,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export const MODELICA_MICROSANDBOX_QUALIFICATION_DESCRIPTOR: CaptureStoreDescriptor<
  "modelica-microsandbox-qualification"
> = {
  kind: "modelica-microsandbox-qualification",
  directory: "state/local/modelica-microsandbox-qualifications",
  uriNamespace: "modelica-microsandbox-qualification",
  label: "Modelica Microsandbox qualification",
};

export class ModelicaMicrosandboxQualificationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelicaMicrosandboxQualificationIntegrityError";
  }
}

export class FileModelicaMicrosandboxQualificationStore {
  readonly #directory: string;
  readonly #store: FileCaptureStore<"modelica-microsandbox-qualification">;

  constructor(
    directory = MODELICA_MICROSANDBOX_QUALIFICATION_DESCRIPTOR.directory,
  ) {
    this.#directory = boundedDirectory(directory);
    this.#store = new FileCaptureStore({
      ...MODELICA_MICROSANDBOX_QUALIFICATION_DESCRIPTOR,
      directory: this.#directory,
    });
  }

  async save(
    value: ModelicaMicrosandboxQualificationCapture,
  ): Promise<ModelicaMicrosandboxQualificationReference> {
    const capture = await validateModelicaMicrosandboxQualificationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Deno.chmod(this.#directory, 0o700);
    const persisted = await this.#store.save(fingerprint, deterministicJson(capture));
    await Deno.chmod(persisted.path, 0o600);
    const reread = await this.read(fingerprint);
    if (!reread || deterministicJson(reread) !== deterministicJson(capture)) {
      throw integrity("The qualification capture failed its durable reread.");
    }
    return validateModelicaMicrosandboxQualificationReference({
      schemaVersion: "modelica-microsandbox-qualification-reference/1.0",
      uri: persisted.uri,
      fingerprint,
      executionProfileFingerprint: capture.executionProfileFingerprint,
    });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ModelicaMicrosandboxQualificationCapture | undefined> {
    const text = await this.#store.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw integrity("The qualification capture is not JSON.");
    }
    let capture: ModelicaMicrosandboxQualificationCapture;
    try {
      capture = await validateModelicaMicrosandboxQualificationCapture(parsed);
    } catch {
      throw integrity("The qualification capture failed exact validation.");
    }
    if (
      deterministicJson(capture) !== text ||
      !fingerprintsEqual(await sha256Fingerprint(capture), fingerprint)
    ) throw integrity("The qualification capture is non-canonical or divergent.");
    return capture;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return this.#store.uriFor(fingerprint);
  }
}

export class PublicationBackedModelicaMicrosandboxQualificationAuthority
  implements ModelicaIsolatedExecutionQualificationAuthority {
  readonly #fingerprint: ContentFingerprint;

  constructor(
    private readonly options: {
      readonly store: FileModelicaMicrosandboxQualificationStore;
      readonly publications: IsolatedOutputPublicationReader;
      readonly pinnedCaptureFingerprint: ContentFingerprint;
    },
  ) {
    this.#fingerprint = Object.freeze({ ...options.pinnedCaptureFingerprint });
  }

  async reopenQualified(
    profileValue: ModelicaIsolatedExecutionProfile,
  ): Promise<ModelicaMicrosandboxQualificationReference | undefined> {
    const profile = await validateModelicaIsolatedExecutionProfile(profileValue);
    const capture = await this.options.store.read(this.#fingerprint);
    if (!capture) return undefined;
    if (
      !fingerprintsEqual(
        capture.executionProfileFingerprint,
        profile.profileFingerprint,
      ) || capture.image.reference !== profile.runtimeBackend.imageReference ||
      !fingerprintsEqual(capture.image.digest, profile.runtime.imageDigest) ||
      capture.worker.wrapperSha256 !== MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 ||
      capture.worker.wrapperSha256 !== profile.wrapper.sha256 ||
      capture.worker.workerContractSha256 !==
        MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256 ||
      capture.worker.denoLockSha256 !== MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256 ||
      deterministicJson(capture.receipt.profile) !==
        deterministicJson(profile.executionProfile) ||
      deterministicJson(capture.receipt.policy) !==
        deterministicJson(profile.isolationPolicy) ||
      deterministicJson(capture.receipt.runtime) !== deterministicJson(profile.runtime)
    ) throw integrity("The qualification capture proves another local profile.");

    const receipt = await this.options.publications.readReceipt(
      capture.receipt.publication.ref,
    );
    if (
      !receipt || deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
        deterministicJson(capture.receipt)
    ) {
      throw integrity("The qualification receipt diverges from its capture.");
    }
    const evidenceRecord = capture.receipt.outputs.find((output) =>
      output.role === "evidence"
    );
    const resultRecord = capture.receipt.outputs.find((output) =>
      output.role === "result"
    );
    if (!evidenceRecord || !resultRecord || capture.receipt.outputs.length !== 2) {
      throw integrity("The qualification publication has an incomplete role set.");
    }
    const [evidenceBytes, resultBytes] = await Promise.all([
      this.options.publications.readPublishedObject(
        capture.receipt.publication.ref,
        evidenceRecord,
      ),
      this.options.publications.readPublishedObject(
        capture.receipt.publication.ref,
        resultRecord,
      ),
    ]);
    if (!evidenceBytes || !resultBytes) {
      throw integrity("The qualification output bytes cannot be reopened.");
    }
    const evidence = await validateModelicaIsolatedRun({
      bundle: capture.bundle.document,
      evidenceBytes,
      resultBytes,
    });
    if (deterministicJson(evidence) !== deterministicJson(capture.evidence)) {
      throw integrity("The externally revalidated qualification result diverges.");
    }
    return validateModelicaMicrosandboxQualificationReference({
      schemaVersion: "modelica-microsandbox-qualification-reference/1.0",
      uri: this.options.store.uriFor(this.#fingerprint),
      fingerprint: this.#fingerprint,
      executionProfileFingerprint: profile.profileFingerprint,
    }, profile.profileFingerprint);
  }
}

function boundedDirectory(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || value === "/" || value.replace(/\/+$/, "") === ""
  ) throw new TypeError("Modelica qualification directory must be bounded.");
  return value.replace(/\/+$/, "");
}

function integrity(
  message: string,
): ModelicaMicrosandboxQualificationIntegrityError {
  return new ModelicaMicrosandboxQualificationIntegrityError(message);
}
