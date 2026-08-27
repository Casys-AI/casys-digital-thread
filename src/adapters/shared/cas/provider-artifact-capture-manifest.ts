import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  rejectDuplicates,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  canonicalProviderResourceAcquisitionLedgerText,
  canonicalResourceUri,
  compareAsciiCodeUnits,
  createProviderResourceRead,
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  type ProviderResourceAcquisitionLedger,
  type ProviderResourceRead,
  sha256Hex,
  validateExpectedProviderResource,
  validateProviderResourceAcquisitionLedger,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { isVerifiedStoredBytes, type VerifiedStoredBytes } from "./file-byte-store.ts";

export const PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA =
  "provider-artifact-capture-manifest/1.0" as const;

export interface ProviderArtifactCaptureManifest {
  readonly schemaVersion: typeof PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA;
  readonly provider: {
    readonly id: string;
    readonly runId: string;
  };
  /** Identity of the DT-normalized acquisition ledger, not a native run envelope. */
  readonly ledger: {
    readonly id: string;
    readonly byteCount: number;
    readonly fingerprint: ContentFingerprint;
    readonly casUri: string;
  };
  /** Sorted by role. Roles and provider URIs are unique; CAS may deduplicate. */
  readonly artifacts: readonly ProviderArtifactCaptureManifestEntry[];
  readonly fingerprint: ContentFingerprint;
}

export interface ProviderArtifactCaptureManifestEntry {
  readonly role: string;
  readonly resource: ExpectedProviderResource;
  readonly cas: {
    readonly uri: string;
    readonly byteCount: number;
    readonly sha256: string;
  };
}

export interface ProviderArtifactCaptureInput<
  ArtifactKind extends string,
  LedgerKind extends string,
> {
  readonly schemaVersion: typeof PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA;
  readonly ledger: {
    readonly stored: VerifiedStoredBytes<LedgerKind>;
  };
  readonly artifacts: readonly {
    readonly role: string;
    readonly resourceRead: ProviderResourceRead;
    readonly stored: VerifiedStoredBytes<ArtifactKind>;
  }[];
}

type UnsignedManifest = Omit<ProviderArtifactCaptureManifest, "fingerprint">;

/**
 * Seal acquisition lineage from three independently verified boundaries: the
 * canonical ledger was reopened from FileByteStore, provider bytes matched its
 * exact tuples, and every artifact CAS object was reopened byte-for-byte. This
 * API accepts neither a caller-supplied ledger hash nor an arbitrary CAS URI.
 * The resulting manifest still makes no authority or engineering claim.
 */
export async function createProviderArtifactCaptureManifest<
  ArtifactKind extends string,
  LedgerKind extends string,
>(
  value: ProviderArtifactCaptureInput<ArtifactKind, LedgerKind>,
): Promise<ProviderArtifactCaptureManifest> {
  const input = exactRecord(
    value,
    ["schemaVersion", "ledger", "artifacts"],
    "$captureInput",
  );
  literalValue(
    input.schemaVersion,
    PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
    "$captureInput.schemaVersion",
  );
  const openedLedger = await openLedger(input.ledger, "$captureInput.ledger");
  const artifactInputs = arrayOf(
    input.artifacts,
    "$captureInput.artifacts",
  );
  if (artifactInputs.length === 0) {
    throw new TypeError("$captureInput.artifacts must not be empty.");
  }
  const artifacts = await Promise.all(
    artifactInputs.map((entry, index) => {
      const role = readArtifactRole(entry, `$captureInput.artifacts[${index}]`);
      const expected = openedLedger.value.resources.find((item) => item.role === role);
      if (!expected) {
        throw new TypeError(
          `$captureInput.artifacts[${index}].role is not declared by the ledger.`,
        );
      }
      return sealedArtifactEntry(
        entry,
        expected,
        `$captureInput.artifacts[${index}]`,
      );
    }),
  );
  validateArtifactUniqueness(artifacts);
  if (artifacts.length !== openedLedger.value.resources.length) {
    throw new TypeError(
      "$captureInput.artifacts must cover every ledger resource exactly once.",
    );
  }
  artifacts.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  const unsigned = deepFreeze<UnsignedManifest>({
    schemaVersion: PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
    provider: openedLedger.value.provider,
    ledger: openedLedger.identity,
    artifacts,
  });
  return deepFreeze({
    ...unsigned,
    fingerprint: await sha256Fingerprint(unsigned),
  });
}

/** Validate parsed persisted JSON, including all exact keys and manifest hash. */
export async function validateProviderArtifactCaptureManifest(
  value: unknown,
): Promise<ProviderArtifactCaptureManifest> {
  const root = exactRecord(
    value,
    ["schemaVersion", "provider", "ledger", "artifacts", "fingerprint"],
    "$manifest",
  );
  literalValue(
    root.schemaVersion,
    PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
    "$manifest.schemaVersion",
  );
  const artifacts = arrayOf(root.artifacts, "$manifest.artifacts").map(
    (entry, index) => persistedArtifactEntry(entry, `$manifest.artifacts[${index}]`),
  );
  if (artifacts.length === 0) {
    throw new TypeError("$manifest.artifacts must not be empty.");
  }
  validateArtifactUniqueness(artifacts);
  const sorted = [...artifacts].sort((left, right) =>
    compareAsciiCodeUnits(left.role, right.role)
  );
  if (artifacts.some((entry, index) => entry.role !== sorted[index].role)) {
    throw new TypeError("$manifest.artifacts must be sorted by role.");
  }
  const unsigned = deepFreeze<UnsignedManifest>({
    schemaVersion: PROVIDER_ARTIFACT_CAPTURE_MANIFEST_SCHEMA,
    provider: providerIdentity(root.provider, "$manifest.provider"),
    ledger: ledgerIdentity(root.ledger, "$manifest.ledger"),
    artifacts,
  });
  const fingerprint = contentFingerprint(
    root.fingerprint,
    "$manifest.fingerprint",
  );
  const actual = await sha256Fingerprint(unsigned);
  if (!fingerprintsEqual(fingerprint, actual)) {
    throw new TypeError(
      `$manifest.fingerprint mismatch: expected ${actual.digest}.`,
    );
  }
  return deepFreeze({ ...unsigned, fingerprint });
}

async function openLedger(
  value: unknown,
  path: string,
): Promise<{
  value: ProviderResourceAcquisitionLedger;
  identity: ProviderArtifactCaptureManifest["ledger"];
}> {
  const input = exactRecord(value, ["stored"], path);
  if (!isVerifiedStoredBytes(input.stored)) {
    throw new TypeError(
      `${path}.stored must be a verified FileByteStore reread receipt.`,
    );
  }
  assertReceiptCasUri(input.stored, path);
  const bytes = input.stored.copyBytes();
  if (bytes.byteLength !== input.stored.byteCount) {
    throw new TypeError(
      `${path}.stored copied bytes do not match the receipt byteCount.`,
    );
  }
  const sha256 = await fingerprintResourceBytes(bytes);
  if (sha256 !== input.stored.fingerprint.digest) {
    throw new TypeError(
      `${path}.stored copied bytes do not match the receipt sha256.`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${path}.stored must contain valid UTF-8 ledger bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${path}.stored must contain a JSON ledger.`);
  }
  const ledger = validateProviderResourceAcquisitionLedger(
    parsed,
    `${path}.stored`,
  );
  if (canonicalProviderResourceAcquisitionLedgerText(ledger) !== text) {
    throw new TypeError(`${path}.stored ledger bytes must be canonical JSON.`);
  }
  return {
    value: ledger,
    identity: ledgerIdentity({
      id: ledger.id,
      byteCount: input.stored.byteCount,
      fingerprint: input.stored.fingerprint,
      casUri: input.stored.uri,
    }, path),
  };
}

function readArtifactRole(value: unknown, path: string): string {
  const input = exactRecord(value, ["role", "resourceRead", "stored"], path);
  return safeId(input.role, `${path}.role`);
}

async function sealedArtifactEntry(
  value: unknown,
  expected: ExpectedProviderResource & { readonly role: string },
  path: string,
): Promise<ProviderArtifactCaptureManifestEntry> {
  const input = exactRecord(value, ["role", "resourceRead", "stored"], path);
  if (!isVerifiedStoredBytes(input.stored)) {
    throw new TypeError(
      `${path}.stored must be a verified FileByteStore reread receipt.`,
    );
  }
  assertReceiptCasUri(input.stored, path);
  const readInput = exactRecord(
    input.resourceRead,
    ["bytes", "attestation"],
    `${path}.resourceRead`,
  );
  const attestationInput = exactRecord(
    readInput.attestation,
    [
      "schemaVersion",
      "verification",
      "uri",
      "mediaType",
      "byteCount",
      "sha256",
    ],
    `${path}.resourceRead.attestation`,
  );
  literalValue(
    attestationInput.schemaVersion,
    "provider-resource-read-attestation/1.0",
    `${path}.resourceRead.attestation.schemaVersion`,
  );
  literalValue(
    attestationInput.verification,
    "exact-content-match",
    `${path}.resourceRead.attestation.verification`,
  );
  const resource = validateExpectedProviderResource({
    uri: attestationInput.uri,
    mediaType: attestationInput.mediaType,
    byteCount: attestationInput.byteCount,
    sha256: attestationInput.sha256,
  }, `${path}.resourceRead.attestation`);
  if (!sameExpectedResource(resource, expected)) {
    throw new TypeError(
      `${path}.resourceRead does not match the exact ledger tuple.`,
    );
  }
  if (
    readInput.bytes === null ||
    typeof readInput.bytes !== "object" ||
    typeof (readInput.bytes as { copy?: unknown }).copy !== "function"
  ) {
    throw new TypeError(`${path}.resourceRead.bytes must expose copy().`);
  }
  // Recompute the provider-read proof at the sealing boundary instead of
  // trusting a structurally compatible object supplied by a caller.
  const readBytes = (readInput.bytes as { copy(): Uint8Array }).copy();
  await createProviderResourceRead(
    resource,
    readBytes,
  );
  if (
    input.stored.fingerprint.digest !== resource.sha256 ||
    input.stored.byteCount !== resource.byteCount
  ) {
    throw new TypeError(
      `${path}.stored bytes must equal the verified provider resource bytes.`,
    );
  }
  if (!bytesEqual(readBytes, input.stored.copyBytes())) {
    throw new TypeError(
      `${path}.stored reread differs from the verified provider resource bytes.`,
    );
  }
  const entry = {
    role: safeId(input.role, `${path}.role`),
    resource,
    cas: {
      uri: input.stored.uri,
      byteCount: input.stored.byteCount,
      sha256: input.stored.fingerprint.digest,
    },
  };
  // Reuse persisted validation for exact CAS URI/digest semantics.
  return persistedArtifactEntry(entry, path);
}

function persistedArtifactEntry(
  value: unknown,
  path: string,
): ProviderArtifactCaptureManifestEntry {
  const input = exactRecord(value, ["role", "resource", "cas"], path);
  const resource = validateExpectedProviderResource(
    input.resource,
    `${path}.resource`,
  );
  const casInput = exactRecord(
    input.cas,
    ["uri", "byteCount", "sha256"],
    `${path}.cas`,
  );
  const casSha256 = sha256Hex(casInput.sha256, `${path}.cas.sha256`);
  const casByteCount = nonNegativeSafeInteger(
    casInput.byteCount,
    `${path}.cas.byteCount`,
  );
  const casUri = canonicalResourceUri(casInput.uri, `${path}.cas.uri`);
  assertCasUri(casUri, casSha256, `${path}.cas.uri`);
  if (casSha256 !== resource.sha256 || casByteCount !== resource.byteCount) {
    throw new TypeError(
      `${path}.cas bytes and sha256 must equal the provider resource identity.`,
    );
  }
  return deepFreeze({
    role: safeId(input.role, `${path}.role`),
    resource,
    cas: { uri: casUri, byteCount: casByteCount, sha256: casSha256 },
  });
}

function providerIdentity(value: unknown, path: string) {
  const input = exactRecord(value, ["id", "runId"], path);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    runId: safeId(input.runId, `${path}.runId`),
  });
}

function ledgerIdentity(value: unknown, path: string) {
  const input = exactRecord(
    value,
    ["id", "byteCount", "fingerprint", "casUri"],
    path,
  );
  const fingerprint = contentFingerprint(input.fingerprint, `${path}.fingerprint`);
  const byteCount = nonNegativeSafeInteger(input.byteCount, `${path}.byteCount`);
  const casUri = canonicalResourceUri(input.casUri, `${path}.casUri`);
  assertCasUri(casUri, fingerprint.digest, `${path}.casUri`);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    byteCount,
    fingerprint,
    casUri,
  });
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  return deepFreeze({
    algorithm: "sha256" as const,
    digest: sha256Hex(input.digest, `${path}.digest`),
  });
}

function validateArtifactUniqueness(
  artifacts: readonly ProviderArtifactCaptureManifestEntry[],
): void {
  rejectDuplicates(artifacts.map((entry) => entry.role), "artifact roles");
  rejectDuplicates(
    artifacts.map((entry) => entry.resource.uri),
    "artifact resource URIs",
  );
}

function sameExpectedResource(
  left: ExpectedProviderResource,
  right: ExpectedProviderResource,
): boolean {
  return left.uri === right.uri && left.mediaType === right.mediaType &&
    left.byteCount === right.byteCount && left.sha256 === right.sha256;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}

function assertReceiptCasUri(
  stored: VerifiedStoredBytes<string>,
  path: string,
): void {
  assertCasUri(
    stored.uri,
    stored.fingerprint.digest,
    `${path}.stored.uri`,
    stored.uriNamespace,
  );
}

function assertCasUri(
  uri: string,
  digest: string,
  path: string,
  namespace?: string,
): void {
  const parsed = new URL(uri);
  if (
    parsed.protocol !== "casys:" ||
    parsed.hostname === "" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== `/sha256/${digest}` ||
    (namespace !== undefined && parsed.hostname !== namespace)
  ) {
    throw new TypeError(
      `${path} must be a canonical casys CAS URI for the declared sha256.`,
    );
  }
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
