/**
 * Code-owned runtime qualification specification. One exact Chrono probe
 * identity, not a generic engine framework or provider envelope.
 */

import {
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_SPECIFICATION_SCHEMA =
  "capability-runtime-qualification-specification/1.0" as const;

export interface CapabilityRuntimeQualificationSpecification {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_QUALIFICATION_SPECIFICATION_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly candidate: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly sourceFingerprint: ContentFingerprint;
  readonly loweringFingerprint: ContentFingerprint;
  readonly caseFingerprint: ContentFingerprint;
  readonly protocolFingerprint: ContentFingerprint;
  readonly criteriaFingerprint: ContentFingerprint;
  readonly fingerprint: ContentFingerprint;
}

export function capabilityRuntimeQualificationSpecificationManifest(
  value: Omit<CapabilityRuntimeQualificationSpecification, "fingerprint">,
): Omit<CapabilityRuntimeQualificationSpecification, "fingerprint"> {
  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    candidate: value.candidate,
    sourceFingerprint: value.sourceFingerprint,
    loweringFingerprint: value.loweringFingerprint,
    caseFingerprint: value.caseFingerprint,
    protocolFingerprint: value.protocolFingerprint,
    criteriaFingerprint: value.criteriaFingerprint,
  };
}

export function fingerprintCapabilityRuntimeQualificationSpecification(
  value: Omit<CapabilityRuntimeQualificationSpecification, "fingerprint">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(
    capabilityRuntimeQualificationSpecificationManifest(value),
  );
}

export async function createCapabilityRuntimeQualificationSpecification(
  value: Omit<CapabilityRuntimeQualificationSpecification, "fingerprint">,
): Promise<CapabilityRuntimeQualificationSpecification> {
  const parsed = parseSpecification(value);
  return deepFreeze({
    ...parsed,
    fingerprint: await fingerprintCapabilityRuntimeQualificationSpecification(parsed),
  });
}

export async function validateCapabilityRuntimeQualificationSpecification(
  value: unknown,
  path = "$capabilityRuntimeQualificationSpecification",
): Promise<CapabilityRuntimeQualificationSpecification> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "candidate",
    "sourceFingerprint",
    "loweringFingerprint",
    "caseFingerprint",
    "protocolFingerprint",
    "criteriaFingerprint",
    "fingerprint",
  ], path);
  const parsed = parseSpecification(root, path);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await fingerprintCapabilityRuntimeQualificationSpecification(
    parsed,
  );
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(`${path}.fingerprint does not match the canonical body.`);
  }
  return deepFreeze({ ...parsed, fingerprint });
}

function parseSpecification(
  value: unknown,
  path = "$capabilityRuntimeQualificationSpecification",
): Omit<CapabilityRuntimeQualificationSpecification, "fingerprint"> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "candidate",
    "sourceFingerprint",
    "loweringFingerprint",
    "caseFingerprint",
    "protocolFingerprint",
    "criteriaFingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_SPECIFICATION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const candidate = exactRecord(
    root.candidate,
    ["id", "version", "fingerprint"],
    `${path}.candidate`,
  );
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_SPECIFICATION_SCHEMA,
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    candidate: {
      id: safeId(candidate.id, `${path}.candidate.id`),
      version: exactVersionToken(candidate.version, `${path}.candidate.version`),
      fingerprint: parseFingerprint(
        candidate.fingerprint,
        `${path}.candidate.fingerprint`,
      ),
    },
    sourceFingerprint: parseFingerprint(
      root.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    loweringFingerprint: parseFingerprint(
      root.loweringFingerprint,
      `${path}.loweringFingerprint`,
    ),
    caseFingerprint: parseFingerprint(
      root.caseFingerprint,
      `${path}.caseFingerprint`,
    ),
    protocolFingerprint: parseFingerprint(
      root.protocolFingerprint,
      `${path}.protocolFingerprint`,
    ),
    criteriaFingerprint: parseFingerprint(
      root.criteriaFingerprint,
      `${path}.criteriaFingerprint`,
    ),
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof root.digest === "string" ? root.digest : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}

export function canonicalCapabilityRuntimeQualificationSpecificationText(
  value: unknown,
): Promise<string> {
  return validateCapabilityRuntimeQualificationSpecification(value).then(
    deterministicJson,
  );
}
