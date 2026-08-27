/**
 * Generic, passive acquisition capture for provider resources selected by a
 * caller. It names neither an engineering operation nor any authority: it
 * only seals exact provider bytes into independently reread CAS objects.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  fingerprintResourceBytes,
  PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
  type ProviderResourceAcquisitionLedger,
  type ProviderResourceReader,
  validateProviderResourceAcquisitionLedger,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  createProviderArtifactCaptureManifest,
  PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
  type ProviderArtifactCaptureManifest,
  validateProviderArtifactCaptureManifest,
} from "./provider-artifact-capture-manifest.ts";
import { FileByteStore, type VerifiedStoredBytes } from "./file-byte-store.ts";

export interface ProviderResourceCaptureServiceDependencies<
  ArtifactKind extends string,
  LedgerKind extends string,
  ManifestKind extends string,
> {
  /** Exact-only reader; discovery and listing are deliberately out of scope. */
  readonly reader: ProviderResourceReader;
  readonly artifactStore: FileByteStore<ArtifactKind>;
  readonly ledgerStore: FileByteStore<LedgerKind>;
  /** Stores the complete JSON envelope, including its inner manifest hash. */
  readonly manifestStore: FileByteStore<ManifestKind>;
}

/** Normalized acquisition selection; it contains no paths or authority fields. */
export interface ProviderResourceCaptureRequest {
  readonly provider: {
    readonly id: string;
    readonly runId: string;
  };
  readonly resources: readonly {
    readonly role: string;
    readonly uri: string;
    readonly mediaType: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[];
}

export interface ProviderResourceCaptureResult<
  ManifestKind extends string,
> {
  readonly ledger: ProviderResourceAcquisitionLedger;
  readonly manifest: ProviderArtifactCaptureManifest;
  /**
   * Receipt for the full serialized manifest bytes. Its fingerprint is not
   * the manifest's inner fingerprint, which signs the unsigned manifest.
   */
  readonly storedManifest: VerifiedStoredBytes<ManifestKind>;
}

/**
 * Captures a complete exact ledger bijection. The deterministic ledger id is
 * content-derived so callers cannot adopt or relabel a pre-existing ledger.
 */
export class ProviderResourceCaptureService<
  ArtifactKind extends string,
  LedgerKind extends string,
  ManifestKind extends string,
> {
  constructor(
    private readonly dependencies: ProviderResourceCaptureServiceDependencies<
      ArtifactKind,
      LedgerKind,
      ManifestKind
    >,
  ) {}

  async capture(
    inputValue: ProviderResourceCaptureRequest,
  ): Promise<ProviderResourceCaptureResult<ManifestKind>> {
    const ledger = await ledgerFor(inputValue);
    const ledgerText = canonicalProviderResourceAcquisitionLedgerText(ledger);
    const ledgerBytes = new TextEncoder().encode(ledgerText);
    const ledgerFingerprint = await fingerprintBytes(ledgerBytes);
    const storedLedger = await this.dependencies.ledgerStore.save(
      ledgerFingerprint,
      ledgerBytes,
    );
    await assertReread(
      this.dependencies.ledgerStore,
      ledgerFingerprint,
      ledgerBytes,
      storedLedger,
      "Provider resource ledger",
    );

    const artifacts: Array<{
      role: string;
      resourceRead: Awaited<ReturnType<ProviderResourceReader["read"]>>;
      stored: VerifiedStoredBytes<ArtifactKind>;
    }> = [];
    // The ledger validator uses ASCII code-unit ordering. Preserve that order
    // for provider I/O as well as in the persisted manifest.
    for (const resource of ledger.resources) {
      const expected = {
        uri: resource.uri,
        mediaType: resource.mediaType,
        byteCount: resource.byteCount,
        sha256: resource.sha256,
      };
      const resourceRead = await this.dependencies.reader.read(expected);
      const bytes = copyReadBytes(resourceRead, resource.role);
      const resourceFingerprint: ContentFingerprint = {
        algorithm: "sha256",
        digest: resource.sha256,
      };
      const stored = await this.dependencies.artifactStore.save(
        resourceFingerprint,
        bytes,
      );
      await assertReread(
        this.dependencies.artifactStore,
        resourceFingerprint,
        bytes,
        stored,
        `Provider resource ${resource.role}`,
      );
      artifacts.push({ role: resource.role, resourceRead, stored });
    }

    const manifest = await createProviderArtifactCaptureManifest({
      schemaVersion: PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
      ledger: { stored: storedLedger },
      artifacts,
    });
    const manifestText = deterministicJson(manifest);
    const manifestBytes = new TextEncoder().encode(manifestText);
    const fullManifestFingerprint = await fingerprintBytes(manifestBytes);
    if (fingerprintsEqual(fullManifestFingerprint, manifest.fingerprint)) {
      throw new TypeError(
        "Complete manifest bytes must not reuse the inner manifest fingerprint.",
      );
    }
    const storedManifest = await this.dependencies.manifestStore.save(
      fullManifestFingerprint,
      manifestBytes,
    );
    await assertReread(
      this.dependencies.manifestStore,
      fullManifestFingerprint,
      manifestBytes,
      storedManifest,
      "Provider artifact capture manifest",
    );
    await assertManifestReadback(
      this.dependencies.manifestStore,
      fullManifestFingerprint,
      manifestText,
      manifest,
    );

    return deepFreeze({ ledger, manifest, storedManifest });
  }
}

async function ledgerFor(
  inputValue: ProviderResourceCaptureRequest,
): Promise<ProviderResourceAcquisitionLedger> {
  const input = exactRecord(inputValue, ["provider", "resources"], "$capture");
  const provider = exactRecord(input.provider, ["id", "runId"], "$capture.provider");
  const provisional = validateProviderResourceAcquisitionLedger({
    schemaVersion: PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    id: "ledger:pending",
    provider: {
      id: safeId(provider.id, "$capture.provider.id"),
      runId: safeId(provider.runId, "$capture.provider.runId"),
    },
    resources: arrayOf(input.resources, "$capture.resources").map((resource, index) => {
      const entry = exactRecord(
        resource,
        ["role", "uri", "mediaType", "byteCount", "sha256"],
        `$capture.resources[${index}]`,
      );
      return {
        role: safeId(entry.role, `$capture.resources[${index}].role`),
        uri: entry.uri,
        mediaType: entry.mediaType,
        byteCount: entry.byteCount,
        sha256: entry.sha256,
      };
    }),
  });
  const identity = await sha256Fingerprint({
    provider: provisional.provider,
    resources: provisional.resources,
  });
  return validateProviderResourceAcquisitionLedger({
    ...provisional,
    id: `ledger:${identity.digest}`,
  });
}

function copyReadBytes(
  read: Awaited<ReturnType<ProviderResourceReader["read"]>>,
  role: string,
): Uint8Array {
  if (
    read === null || typeof read !== "object" || read.bytes === null ||
    typeof read.bytes !== "object" || typeof read.bytes.copy !== "function"
  ) {
    throw new TypeError(`Provider resource ${role} did not return readable bytes.`);
  }
  const bytes = read.bytes.copy();
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`Provider resource ${role} returned non-byte content.`);
  }
  return bytes;
}

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
  return { algorithm: "sha256", digest: await fingerprintResourceBytes(bytes) };
}

async function assertReread<Kind extends string>(
  store: FileByteStore<Kind>,
  fingerprint: ContentFingerprint,
  expected: Uint8Array,
  stored: VerifiedStoredBytes<Kind>,
  label: string,
): Promise<void> {
  if (
    !fingerprintsEqual(stored.fingerprint, fingerprint) ||
    stored.byteCount !== expected.byteLength ||
    stored.uri !== store.uriFor(fingerprint)
  ) {
    throw new TypeError(`${label} save receipt does not match exact bytes.`);
  }
  const reopened = await store.read(fingerprint);
  if (!reopened || !bytesEqual(reopened.copy(), expected)) {
    throw new TypeError(`${label} was not durably reread as exact bytes.`);
  }
}

async function assertManifestReadback<ManifestKind extends string>(
  store: FileByteStore<ManifestKind>,
  fingerprint: ContentFingerprint,
  text: string,
  manifest: ProviderArtifactCaptureManifest,
): Promise<void> {
  const reread = await store.read(fingerprint);
  if (!reread) {
    throw new TypeError("Provider artifact capture manifest is absent after save.");
  }
  let persisted: unknown;
  try {
    const persistedText = new TextDecoder("utf-8", { fatal: true }).decode(
      reread.copy(),
    );
    if (persistedText !== text) {
      throw new TypeError(
        "Provider artifact capture manifest bytes changed after save.",
      );
    }
    persisted = JSON.parse(persistedText);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Provider artifact capture manifest is not valid UTF-8 JSON.");
  }
  const validated = await validateProviderArtifactCaptureManifest(persisted);
  if (
    deterministicJson(validated) !== text || !fingerprintsEqual(
      validated.fingerprint,
      manifest.fingerprint,
    )
  ) {
    throw new TypeError(
      "Provider artifact capture manifest failed exact readback validation.",
    );
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
