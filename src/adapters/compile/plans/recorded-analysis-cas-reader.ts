/**
 * Closed local CAS reader for the recorded-analysis verticals.
 *
 * This adapter deliberately has no filesystem-path, provider-resource, or
 * discovery API. Callers can only name an already-bound Thread artifact or a
 * complete local CAS tuple. Extending its namespaces is a code change: an
 * injected configuration cannot add a new authority surface.
 */

import {
  canonicalResourceUri,
  fingerprintResourceBytes,
  sha256Hex,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ImmutableBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ThreadArtifact } from "../../../domain/thread/thread-snapshot.ts";
import type { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";

const PROBE_FINGERPRINT: ContentFingerprint = {
  algorithm: "sha256",
  digest: "0".repeat(64),
};

const PROFILE = {
  "fea-proof-case-capture": {
    storage: "text",
    mediaTypes: ["application/json"],
  },
  "sensitivity-catalog-offer-capture": {
    storage: "text",
    mediaTypes: ["application/json"],
  },
  "requirements-capture": {
    storage: "text",
    mediaTypes: ["application/json"],
  },
  "technical-compilation-admission-capture": {
    storage: "bytes",
    mediaTypes: ["application/json"],
  },
} as const;

export type RecordedAnalysisCasNamespace = keyof typeof PROFILE;

export interface RecordedAnalysisCasTuple {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
  readonly mediaType: string;
}

type FeaProofCaptureStoreBinding = {
  readonly namespace: "fea-proof-case-capture";
  readonly storage: "text";
  readonly store: FileCaptureStore<"fea-proof-case">;
};

type SensitivityCatalogOfferCaptureStoreBinding = {
  readonly namespace: "sensitivity-catalog-offer-capture";
  readonly storage: "text";
  readonly store: FileCaptureStore<"sensitivity-catalog-offer">;
};

type RequirementsCaptureStoreBinding = {
  readonly namespace: "requirements-capture";
  readonly storage: "text";
  readonly store: FileCaptureStore<"requirements-capture">;
};

/**
 * The admission sealer publishes canonical bytes into this dedicated local
 * CAS lane.  ROP reopening consumes those bytes directly; it never rebuilds
 * an admission capture from a Thread document or a specialised reader.
 */
type TechnicalCompilationAdmissionCaptureStoreBinding = {
  readonly namespace: "technical-compilation-admission-capture";
  readonly storage: "bytes";
  readonly store: Pick<
    FileByteStore<"technical-compilation-admission-capture">,
    "read" | "uriFor"
  >;
};

/**
 * This union is intentionally closed. A caller may inject only the reviewed
 * stores; it cannot register an arbitrary namespace, provider URI, or STEP
 * asset reader.
 */
export type RecordedAnalysisCasStoreBinding =
  | FeaProofCaptureStoreBinding
  | SensitivityCatalogOfferCaptureStoreBinding
  | RequirementsCaptureStoreBinding
  | TechnicalCompilationAdmissionCaptureStoreBinding;

export interface RecordedAnalysisCasReaderOptions {
  readonly stores: readonly RecordedAnalysisCasStoreBinding[];
}

interface TextStoreReader {
  uriFor(fingerprint: ContentFingerprint): string;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

interface ByteStoreReader {
  uriFor(fingerprint: ContentFingerprint): string;
  read(fingerprint: ContentFingerprint): Promise<ImmutableBytes | undefined>;
}

export interface RecordedAnalysisArtifactRead {
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

type RegisteredTextStore = {
  readonly storage: "text";
  readonly mediaTypes: readonly string[];
  readonly store: TextStoreReader;
};

type RegisteredByteStore = {
  readonly storage: "bytes";
  readonly mediaTypes: readonly string[];
  readonly store: ByteStoreReader;
};

type RegisteredStore = RegisteredTextStore | RegisteredByteStore;

/**
 * A local read adapter that structurally satisfies Thread-artifact reader
 * ports without importing an executor.
 */
export class RecordedAnalysisCasReader {
  readonly #stores: ReadonlyMap<RecordedAnalysisCasNamespace, RegisteredStore>;

  constructor(options: RecordedAnalysisCasReaderOptions) {
    const stores = new Map<RecordedAnalysisCasNamespace, RegisteredStore>();
    for (const binding of options.stores) {
      if (!Object.hasOwn(PROFILE, binding.namespace)) {
        throw new TypeError("Recorded-analysis CAS namespace is not registered.");
      }
      const profile = PROFILE[binding.namespace];
      if (stores.has(binding.namespace)) {
        throw new TypeError("Recorded-analysis CAS namespaces must be unique.");
      }
      if (binding.storage !== profile.storage) {
        throw new TypeError(
          "Recorded-analysis CAS store has the wrong reviewed storage kind.",
        );
      }
      const expectedProbeUri =
        `casys://${binding.namespace}/sha256/${PROBE_FINGERPRINT.digest}`;
      if (binding.store.uriFor(PROBE_FINGERPRINT) !== expectedProbeUri) {
        throw new TypeError(
          "Recorded-analysis CAS store does not own its configured namespace.",
        );
      }
      const registered: RegisteredStore = binding.storage === "text"
        ? {
          storage: "text",
          mediaTypes: profile.mediaTypes,
          store: binding.store,
        }
        : {
          storage: "bytes",
          mediaTypes: profile.mediaTypes,
          store: binding.store,
        };
      stores.set(binding.namespace, registered);
    }
    if (stores.size !== Object.keys(PROFILE).length) {
      throw new TypeError(
        "Recorded-analysis CAS configuration must contain every reviewed namespace exactly once.",
      );
    }
    this.#stores = stores;
  }

  read(artifact: Readonly<ThreadArtifact>): Promise<Uint8Array | undefined>;
  read(expected: Readonly<RecordedAnalysisCasTuple>): Promise<Uint8Array | undefined>;
  async read(
    input: Readonly<ThreadArtifact> | Readonly<RecordedAnalysisCasTuple>,
  ): Promise<Uint8Array | undefined> {
    if (isTuple(input)) {
      return await this.#readTuple(validateTuple(input));
    }
    return await this.#readArtifact(input);
  }

  /**
   * Exact Thread-artifact receipt for FEA executors that must attest both the
   * byte count and full content hash before publishing a consumption.
   */
  async readArtifact(
    artifact: Readonly<ThreadArtifact>,
  ): Promise<RecordedAnalysisArtifactRead | undefined> {
    const bytes = await this.#readArtifact(artifact);
    if (!bytes) return undefined;
    return Object.freeze({
      uri: artifact.uri!,
      mediaType: artifact.mediaType!,
      byteCount: bytes.byteLength,
      sha256: artifact.fingerprint.digest,
      bytes: Uint8Array.from(bytes),
    });
  }

  async #readArtifact(
    artifact: Readonly<ThreadArtifact>,
  ): Promise<Uint8Array | undefined> {
    if (!artifact || typeof artifact !== "object") {
      throw new TypeError("Recorded-analysis artifact must be an object.");
    }
    if (artifact.fingerprint?.algorithm !== "sha256") {
      throw new TypeError("Recorded-analysis artifact requires a sha256 fingerprint.");
    }
    const sha256 = sha256Hex(
      artifact.fingerprint.digest,
      "recordedAnalysisArtifact.fingerprint.digest",
    );
    if (typeof artifact.uri !== "string" || typeof artifact.mediaType !== "string") {
      throw new TypeError(
        "Recorded-analysis artifact requires an exact local CAS URI and media type.",
      );
    }
    return await this.#readExact({
      uri: canonicalResourceUri(artifact.uri, "recordedAnalysisArtifact.uri"),
      sha256,
      mediaType: artifact.mediaType,
    });
  }

  async #readTuple(
    expected: RecordedAnalysisCasTuple,
  ): Promise<Uint8Array | undefined> {
    const bytes = await this.#readExact(expected);
    if (bytes && bytes.byteLength !== expected.byteCount) {
      throw new TypeError(
        "Recorded-analysis CAS bytes do not match their exact byte count.",
      );
    }
    return bytes;
  }

  async #readExact(expected: {
    readonly uri: string;
    readonly sha256: string;
    readonly mediaType: string;
  }): Promise<Uint8Array | undefined> {
    const namespace = namespaceFor(expected.uri);
    const registered = this.#stores.get(namespace);
    if (!registered) {
      throw new TypeError(
        "Recorded-analysis CAS URI is outside the reviewed namespace table.",
      );
    }
    if (!registered.mediaTypes.includes(expected.mediaType)) {
      throw new TypeError(
        "Recorded-analysis CAS media type is not permitted for its namespace.",
      );
    }
    const fingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: expected.sha256,
    };
    const requirementsComponent = namespace === "requirements-capture"
      ? requirementsComponentFromUri(expected.uri, expected.sha256)
      : undefined;
    if (
      requirementsComponent === undefined &&
      registered.store.uriFor(fingerprint) !== expected.uri
    ) {
      throw new TypeError(
        "Recorded-analysis CAS URI does not match its exact local store.",
      );
    }
    const bytes = registered.storage === "text"
      ? await readTextBytes(registered.store)
      : await readByteStoreBytes(registered.store);
    if (!bytes) return undefined;
    if (await fingerprintResourceBytes(bytes) !== expected.sha256) {
      throw new TypeError(
        "Recorded-analysis CAS bytes do not match their exact sha256.",
      );
    }
    if (requirementsComponent !== undefined) {
      assertRequirementsCaptureUriIdentity(
        bytes,
        requirementsComponent,
        expected.uri,
        expected.sha256,
      );
    }
    return Uint8Array.from(bytes);

    async function readTextBytes(
      store: TextStoreReader,
    ): Promise<Uint8Array | undefined> {
      const text = await store.read(fingerprint);
      if (text === undefined) return undefined;
      const bytes = new TextEncoder().encode(text);
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new TypeError("Recorded-analysis text capture is not exact UTF-8.");
      }
      if (decoded !== text) {
        throw new TypeError(
          "Recorded-analysis text capture does not round-trip exact UTF-8.",
        );
      }
      return bytes;
    }

    async function readByteStoreBytes(
      store: ByteStoreReader,
    ): Promise<Uint8Array | undefined> {
      const stored = await store.read(fingerprint);
      return stored === undefined ? undefined : stored.copy();
    }
  }
}

function requirementsComponentFromUri(uri: string, sha256: string): string {
  const parsed = new URL(uri);
  const parts = parsed.pathname.split("/");
  if (
    parts.length !== 4 || parts[0] !== "" || parts[1] === "" ||
    parts[2] !== "sha256" || parts[3] !== sha256 || parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(
      "Recorded-analysis requirements URI is not an exact component-scoped capture URI.",
    );
  }
  let component: string;
  try {
    component = decodeURIComponent(parts[1]);
  } catch {
    throw new TypeError(
      "Recorded-analysis requirements URI has an invalid component segment.",
    );
  }
  if (
    component.length === 0 ||
    `casys://requirements-capture/${component}/sha256/${sha256}` !== uri
  ) {
    throw new TypeError(
      "Recorded-analysis requirements URI is not canonical for its component.",
    );
  }
  return component;
}

function assertRequirementsCaptureUriIdentity(
  bytes: Uint8Array,
  component: string,
  uri: string,
  sha256: string,
): void {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError(
      "Recorded-analysis requirements capture is not exact UTF-8 JSON.",
    );
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    (value as Record<string, unknown>).containerComponent !== component ||
    uri !== `casys://requirements-capture/${component}/sha256/${sha256}`
  ) {
    throw new TypeError(
      "Recorded-analysis requirements URI does not bind its captured component.",
    );
  }
}

function isTuple(
  value: Readonly<ThreadArtifact> | Readonly<RecordedAnalysisCasTuple>,
): value is Readonly<RecordedAnalysisCasTuple> {
  return "byteCount" in value;
}

function validateTuple(
  value: Readonly<RecordedAnalysisCasTuple>,
): RecordedAnalysisCasTuple {
  const uri = canonicalResourceUri(value.uri, "recordedAnalysisCas.uri");
  const sha256 = sha256Hex(value.sha256, "recordedAnalysisCas.sha256");
  if (!Number.isSafeInteger(value.byteCount) || value.byteCount < 0) {
    throw new TypeError(
      "Recorded-analysis CAS byteCount must be a non-negative safe integer.",
    );
  }
  if (typeof value.mediaType !== "string" || value.mediaType.length === 0) {
    throw new TypeError("Recorded-analysis CAS mediaType must be non-empty.");
  }
  return { uri, sha256, byteCount: value.byteCount, mediaType: value.mediaType };
}

function namespaceFor(uri: string): RecordedAnalysisCasNamespace {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError("Recorded-analysis CAS URI must be absolute.");
  }
  if (parsed.protocol !== "casys:" || !Object.hasOwn(PROFILE, parsed.host)) {
    throw new TypeError(
      "Recorded-analysis CAS URI is outside the reviewed namespace table.",
    );
  }
  return parsed.host as RecordedAnalysisCasNamespace;
}
