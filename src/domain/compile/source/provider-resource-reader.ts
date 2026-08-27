import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../kernel/resource-bytes.ts";

export { fingerprintResourceBytes };

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CANONICAL_MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:; [a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"\r\n]*"))*$/;

export const PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA =
  "provider-resource-acquisition-ledger/1.0" as const;

/**
 * Digital Thread-normalized acquisition expectation. It is not the provider's
 * native run envelope; a provider adapter must separately prove how that
 * envelope yields these exact resource tuples.
 */
export interface ProviderResourceAcquisitionLedger {
  readonly schemaVersion: typeof PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA;
  readonly id: string;
  readonly provider: {
    readonly id: string;
    readonly runId: string;
  };
  /** Sorted by role; roles and URIs are unique. */
  readonly resources: readonly (ExpectedProviderResource & { readonly role: string })[];
}

/**
 * Exact resource identity already selected by an upstream, persisted ledger.
 *
 * This contract intentionally contains no provider discovery operation and no
 * filesystem path. A reader may fetch only this URI and must verify all four
 * fields before returning bytes.
 */
export interface ExpectedProviderResource {
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
}

/** Bytes whose backing storage is never exposed to a caller. */
export interface ImmutableBytes {
  readonly byteLength: number;
  copy(): Uint8Array;
}

/**
 * Content-match evidence produced at the provider-read boundary.
 *
 * It attests only that the returned bytes matched the expected ledger tuple;
 * it deliberately makes no claim about engineering or execution authority.
 */
export interface ProviderResourceReadAttestation {
  readonly schemaVersion: "provider-resource-read-attestation/1.0";
  readonly verification: "exact-content-match";
  readonly uri: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface ProviderResourceRead {
  readonly bytes: ImmutableBytes;
  readonly attestation: ProviderResourceReadAttestation;
}

/** Provider-neutral driven port. Implementations perform the actual I/O. */
export interface ProviderResourceReader {
  read(expected: ExpectedProviderResource): Promise<ProviderResourceRead>;
}

export function validateProviderResourceAcquisitionLedger(
  value: unknown,
  path = "$ledger",
): ProviderResourceAcquisitionLedger {
  const root = exactRecord(
    value,
    ["schemaVersion", "id", "provider", "resources"],
    path,
  );
  literalValue(
    root.schemaVersion,
    PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    `${path}.schemaVersion`,
  );
  const providerInput = exactRecord(
    root.provider,
    ["id", "runId"],
    `${path}.provider`,
  );
  const resources = arrayOf(root.resources, `${path}.resources`).map(
    (value, index) => {
      const resourcePath = `${path}.resources[${index}]`;
      const input = exactRecord(
        value,
        ["role", "uri", "mediaType", "byteCount", "sha256"],
        resourcePath,
      );
      return deepFreeze({
        role: safeId(input.role, `${resourcePath}.role`),
        ...validateExpectedProviderResource({
          uri: input.uri,
          mediaType: input.mediaType,
          byteCount: input.byteCount,
          sha256: input.sha256,
        }, resourcePath),
      });
    },
  );
  if (resources.length === 0) {
    throw new TypeError(`${path}.resources must not be empty.`);
  }
  rejectDuplicates(resources.map((resource) => resource.role), `${path} roles`);
  rejectDuplicates(resources.map((resource) => resource.uri), `${path} URIs`);
  resources.sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  return deepFreeze({
    schemaVersion: PROVIDER_RESOURCE_ACQUISITION_LEDGER_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    provider: {
      id: safeId(providerInput.id, `${path}.provider.id`),
      runId: safeId(providerInput.runId, `${path}.provider.runId`),
    },
    resources,
  });
}

export function canonicalProviderResourceAcquisitionLedgerText(
  ledger: ProviderResourceAcquisitionLedger,
): string {
  return deterministicJson(validateProviderResourceAcquisitionLedger(ledger));
}

export function validateExpectedProviderResource(
  value: unknown,
  path = "expectedResource",
): ExpectedProviderResource {
  const record = exactRecord(
    value,
    ["uri", "mediaType", "byteCount", "sha256"],
    path,
  );
  const uri = canonicalUri(record.uri, `${path}.uri`);
  const mediaType = nonEmptyText(record.mediaType, `${path}.mediaType`);
  if (!CANONICAL_MEDIA_TYPE.test(mediaType)) {
    throw new TypeError(`${path}.mediaType must be a canonical media type.`);
  }
  const byteCount = nonNegativeSafeInteger(
    record.byteCount,
    `${path}.byteCount`,
  );
  const sha256 = nonEmptyText(record.sha256, `${path}.sha256`);
  if (!SHA256_HEX.test(sha256)) {
    throw new TypeError(`${path}.sha256 must be lowercase sha256 hex.`);
  }
  return deepFreeze({ uri, mediaType, byteCount, sha256 });
}

export async function createProviderResourceRead(
  expectedValue: ExpectedProviderResource,
  sourceBytes: Uint8Array,
): Promise<ProviderResourceRead> {
  const expected = validateExpectedProviderResource(expectedValue);
  if (sourceBytes.byteLength !== expected.byteCount) {
    throw new TypeError(
      `Resource bytes have ${sourceBytes.byteLength} bytes; expected ${expected.byteCount}.`,
    );
  }
  const actualSha256 = await fingerprintResourceBytes(sourceBytes);
  if (actualSha256 !== expected.sha256) {
    throw new TypeError(
      `Resource bytes have sha256 ${actualSha256}; expected ${expected.sha256}.`,
    );
  }
  const bytes = immutableBytes(sourceBytes);
  const attestation = deepFreeze<ProviderResourceReadAttestation>({
    schemaVersion: "provider-resource-read-attestation/1.0",
    verification: "exact-content-match",
    uri: expected.uri,
    mediaType: expected.mediaType,
    byteCount: expected.byteCount,
    sha256: expected.sha256,
  });
  return Object.freeze({ bytes, attestation });
}

export function immutableBytes(source: Uint8Array): ImmutableBytes {
  const value = Uint8Array.from(source);
  return Object.freeze({
    byteLength: value.byteLength,
    copy: (): Uint8Array => Uint8Array.from(value),
  });
}

export function canonicalResourceUri(value: unknown, path: string): string {
  return canonicalUri(value, path);
}

/**
 * Stable lexical ordering for persisted contracts. `localeCompare` depends on
 * the host's locale and collation settings, whereas roles are protocol IDs and
 * must sort by their JavaScript code units everywhere.
 */
export function compareAsciiCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

export function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be lowercase sha256 hex.`);
  }
  return digest;
}

function canonicalUri(value: unknown, path: string): string {
  const uri = nonEmptyText(value, path);
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new TypeError(`${path} must be an absolute canonical URI.`);
  }
  if (parsed.href !== uri) {
    throw new TypeError(`${path} must be an absolute canonical URI.`);
  }
  return uri;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
