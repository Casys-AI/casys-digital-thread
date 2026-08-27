/**
 * Closed `led-driver-source-capture/1.0` envelope.
 *
 * The capture names exact human-source bytes (SHA-256, byte count, CAS URI),
 * identity, provenance and revision. It is not a Thread result, spice
 * payload, D1 IR/netlist or an alias such as `latest`.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type LedDriverHumanSource,
  type LedDriverNamedCircuit,
  type LedDriverNamedTestCondition,
  type LedDriverSourceProvenance,
  type LedDriverSourceUnknown,
  validateLedDriverHumanSource,
} from "./led-driver-human-source.ts";

export const LED_DRIVER_SOURCE_CAPTURE_SCHEMA =
  "led-driver-source-capture/1.0" as const;

export const LED_DRIVER_SOURCE_MEDIA_TYPE = "application/json" as const;

export interface LedDriverSourceCaptureBytes {
  readonly sha256: string;
  readonly byteCount: number;
  readonly casUri: string;
  readonly mediaType: typeof LED_DRIVER_SOURCE_MEDIA_TYPE;
}

export interface LedDriverSourceCaptureDocument {
  readonly schemaVersion: typeof LED_DRIVER_SOURCE_CAPTURE_SCHEMA;
  readonly kind: "led-driver-source";
  readonly identity: {
    readonly id: string;
    readonly revision: number;
  };
  readonly provenance: LedDriverSourceProvenance;
  readonly source: LedDriverSourceCaptureBytes;
  readonly circuit: LedDriverNamedCircuit;
  readonly testCondition: LedDriverNamedTestCondition;
  readonly unknowns: readonly LedDriverSourceUnknown[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "kind",
  "identity",
  "provenance",
  "source",
  "circuit",
  "testCondition",
  "unknowns",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CAS_URI = /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/;

export function assembleLedDriverSourceCaptureDocument(input: {
  readonly source: LedDriverHumanSource;
  readonly sha256: string;
  readonly byteCount: number;
  readonly casUri: string;
}): LedDriverSourceCaptureDocument {
  return validateLedDriverSourceCaptureDocument({
    schemaVersion: LED_DRIVER_SOURCE_CAPTURE_SCHEMA,
    kind: "led-driver-source",
    identity: {
      id: input.source.id,
      revision: input.source.revision,
    },
    provenance: input.source.provenance,
    source: {
      sha256: input.sha256,
      byteCount: input.byteCount,
      casUri: input.casUri,
      mediaType: LED_DRIVER_SOURCE_MEDIA_TYPE,
    },
    circuit: input.source.circuit,
    testCondition: input.source.testCondition,
    unknowns: input.source.unknowns,
  });
}

export function validateLedDriverSourceCaptureDocument(
  value: unknown,
  path = "$ledDriverSourceCapture",
): LedDriverSourceCaptureDocument {
  const root = exactRecord(value, ROOT_KEYS, path);
  literalValue(
    root.schemaVersion,
    LED_DRIVER_SOURCE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, "led-driver-source", `${path}.kind`);
  const identityInput = exactRecord(
    root.identity,
    ["id", "revision"],
    `${path}.identity`,
  );
  const sourceInput = exactRecord(
    root.source,
    ["sha256", "byteCount", "casUri", "mediaType"],
    `${path}.source`,
  );
  literalValue(
    sourceInput.mediaType,
    LED_DRIVER_SOURCE_MEDIA_TYPE,
    `${path}.source.mediaType`,
  );
  const sha256 = canonicalSha256(sourceInput.sha256, `${path}.source.sha256`);
  const parsed = validateLedDriverHumanSource({
    schemaVersion: "led-driver-human-source/1.0",
    id: identityInput.id,
    revision: identityInput.revision,
    provenance: root.provenance,
    circuit: root.circuit,
    testCondition: root.testCondition,
    unknowns: root.unknowns,
  }, path);
  return deepFreeze({
    schemaVersion: LED_DRIVER_SOURCE_CAPTURE_SCHEMA,
    kind: "led-driver-source",
    identity: {
      id: parsed.id,
      revision: parsed.revision,
    },
    provenance: parsed.provenance,
    source: {
      sha256,
      byteCount: nonNegativeInteger(
        sourceInput.byteCount,
        `${path}.source.byteCount`,
      ),
      casUri: canonicalCasUri(sourceInput.casUri, sha256, `${path}.source.casUri`),
      mediaType: LED_DRIVER_SOURCE_MEDIA_TYPE,
    },
    circuit: parsed.circuit,
    testCondition: parsed.testCondition,
    unknowns: parsed.unknowns,
  });
}

export function fingerprintLedDriverSourceCapture(
  document: LedDriverSourceCaptureDocument,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateLedDriverSourceCaptureDocument(document));
}

export function sameLedDriverSourceFacts(
  document: LedDriverSourceCaptureDocument,
  source: LedDriverHumanSource,
): boolean {
  return document.identity.id === source.id &&
    document.identity.revision === source.revision &&
    document.provenance.kind === source.provenance.kind &&
    document.provenance.authorId === source.provenance.authorId &&
    document.provenance.reference === source.provenance.reference &&
    document.circuit.id === source.circuit.id &&
    document.circuit.name === source.circuit.name &&
    document.testCondition.id === source.testCondition.id &&
    document.testCondition.name === source.testCondition.name &&
    sameUnknowns(document.unknowns, source.unknowns);
}

function sameUnknowns(
  left: readonly LedDriverSourceUnknown[],
  right: readonly LedDriverSourceUnknown[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined &&
      item.id === other.id &&
      item.status === other.status &&
      item.name === other.name;
  });
}

function canonicalSha256(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be canonical lowercase SHA-256 hex.`);
  }
  return digest;
}

function canonicalCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (!CAS_URI.test(uri) || !uri.endsWith(`/sha256/${digest}`)) {
    throw new TypeError(`${path} must be a canonical CAS URI for its sha256.`);
  }
  return uri;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
