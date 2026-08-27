/**
 * Closed MRTR grammar for sealing one agent-authored architecture SysML analysis.
 *
 * The signed parameters name exact CAS identities only. They grant no SysON
 * insertion, no provider dispatch, and no `compile.seal-admission@3` authority.
 * Bindings later consumed from the sealed document are symbol ids, never labels.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";

export const MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION = {
  id: "model.seal-architecture-sysml",
  version: "1",
} as const;

export const ARCHITECTURE_SYSML_SEAL_ADMISSION_SCHEMA =
  "architecture-sysml-seal-admission/1.0" as const;

export interface ArchitectureSysmlSealAdmission {
  readonly schemaVersion: typeof ARCHITECTURE_SYSML_SEAL_ADMISSION_SCHEMA;
  readonly sourceId: string;
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly sha256: string;
    readonly byteCount: number;
    readonly casUri: string;
  };
  readonly analysis: {
    readonly analyzer: {
      readonly id: string;
      readonly version: string;
    };
    readonly policy: {
      readonly profile: string;
      readonly status: "passed";
    };
    readonly sha256: string;
    readonly byteCount: number;
    readonly casUri: string;
  };
}

const PARAMETER_KEYS = [
  "architecture.sysml.sourceId",
  "architecture.sysml.profile.id",
  "architecture.sysml.profile.version",
  "architecture.sysml.profile.fingerprint.digest",
  "architecture.sysml.source.sha256",
  "architecture.sysml.source.byteCount",
  "architecture.sysml.source.casUri",
  "architecture.sysml.analyzer.id",
  "architecture.sysml.analyzer.version",
  "architecture.sysml.analysis.policy.profile",
  "architecture.sysml.analysis.policy.status",
  "architecture.sysml.analysis.sha256",
  "architecture.sysml.analysis.byteCount",
  "architecture.sysml.analysis.casUri",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "architecture.sysml.sourceId": "Architecture SysML source id",
  "architecture.sysml.profile.id": "Architecture SysML profile id",
  "architecture.sysml.profile.version": "Architecture SysML profile version",
  "architecture.sysml.profile.fingerprint.digest":
    "Architecture SysML profile fingerprint",
  "architecture.sysml.source.sha256": "Architecture SysML source sha256",
  "architecture.sysml.source.byteCount": "Architecture SysML source byte count",
  "architecture.sysml.source.casUri": "Architecture SysML source CAS URI",
  "architecture.sysml.analyzer.id": "Architecture SysML analyzer id",
  "architecture.sysml.analyzer.version": "Architecture SysML analyzer version",
  "architecture.sysml.analysis.policy.profile":
    "Architecture SysML analysis policy profile",
  "architecture.sysml.analysis.policy.status":
    "Architecture SysML analysis policy status",
  "architecture.sysml.analysis.sha256": "Architecture SysML analysis sha256",
  "architecture.sysml.analysis.byteCount": "Architecture SysML analysis byte count",
  "architecture.sysml.analysis.casUri": "Architecture SysML analysis CAS URI",
};

/** Encode one typed admission into the unique canonical MRTR sequence. */
export function encodeArchitectureSysmlSealParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateArchitectureSysmlSealAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

/** Parse the exact human-reviewed MRTR sequence. */
export function parseArchitectureSysmlSealParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ArchitectureSysmlSealAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Architecture SysML seal proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected) {
      throw new TypeError(
        `Architecture SysML seal parameter ${index} must be ${expected}.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  return validateArchitectureSysmlSealAdmission({
    schemaVersion: ARCHITECTURE_SYSML_SEAL_ADMISSION_SCHEMA,
    sourceId: values.get("architecture.sysml.sourceId"),
    profile: {
      id: values.get("architecture.sysml.profile.id"),
      version: values.get("architecture.sysml.profile.version"),
      fingerprint: {
        algorithm: "sha256",
        digest: values.get("architecture.sysml.profile.fingerprint.digest"),
      },
    },
    source: {
      sha256: values.get("architecture.sysml.source.sha256"),
      byteCount: integerValue(
        values.get("architecture.sysml.source.byteCount"),
        "architecture.sysml.source.byteCount",
      ),
      casUri: values.get("architecture.sysml.source.casUri"),
    },
    analysis: {
      analyzer: {
        id: values.get("architecture.sysml.analyzer.id"),
        version: values.get("architecture.sysml.analyzer.version"),
      },
      policy: {
        profile: values.get("architecture.sysml.analysis.policy.profile"),
        status: values.get("architecture.sysml.analysis.policy.status"),
      },
      sha256: values.get("architecture.sysml.analysis.sha256"),
      byteCount: integerValue(
        values.get("architecture.sysml.analysis.byteCount"),
        "architecture.sysml.analysis.byteCount",
      ),
      casUri: values.get("architecture.sysml.analysis.casUri"),
    },
  });
}

export function validateArchitectureSysmlSealAdmission(
  value: unknown,
  path = "$architectureSysmlSealAdmission",
): ArchitectureSysmlSealAdmission {
  const root = exactRecord(
    value,
    ["schemaVersion", "sourceId", "profile", "source", "analysis"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ARCHITECTURE_SYSML_SEAL_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version", "fingerprint"],
    `${path}.profile`,
  );
  const source = exactRecord(
    root.source,
    ["sha256", "byteCount", "casUri"],
    `${path}.source`,
  );
  const analysis = exactRecord(
    root.analysis,
    ["analyzer", "policy", "sha256", "byteCount", "casUri"],
    `${path}.analysis`,
  );
  const analyzer = exactRecord(
    analysis.analyzer,
    ["id", "version"],
    `${path}.analysis.analyzer`,
  );
  const policy = exactRecord(
    analysis.policy,
    ["profile", "status"],
    `${path}.analysis.policy`,
  );
  literalValue(policy.status, "passed", `${path}.analysis.policy.status`);
  const sourceSha256 = canonicalSha256(source.sha256, `${path}.source.sha256`);
  const analysisSha256 = canonicalSha256(analysis.sha256, `${path}.analysis.sha256`);
  return deepFreeze({
    schemaVersion: ARCHITECTURE_SYSML_SEAL_ADMISSION_SCHEMA,
    sourceId: safeId(root.sourceId, `${path}.sourceId`),
    profile: {
      id: safeId(profile.id, `${path}.profile.id`),
      version: safeVersion(profile.version, `${path}.profile.version`),
      fingerprint: parseFingerprint(profile.fingerprint, `${path}.profile.fingerprint`),
    },
    source: {
      sha256: sourceSha256,
      byteCount: nonNegativeInteger(source.byteCount, `${path}.source.byteCount`),
      casUri: canonicalCasUri(source.casUri, sourceSha256, `${path}.source.casUri`),
    },
    analysis: {
      analyzer: {
        id: safeId(analyzer.id, `${path}.analysis.analyzer.id`),
        version: safeVersion(analyzer.version, `${path}.analysis.analyzer.version`),
      },
      policy: {
        profile: safeId(policy.profile, `${path}.analysis.policy.profile`),
        status: "passed",
      },
      sha256: analysisSha256,
      byteCount: nonNegativeInteger(
        analysis.byteCount,
        `${path}.analysis.byteCount`,
      ),
      casUri: canonicalCasUri(
        analysis.casUri,
        analysisSha256,
        `${path}.analysis.casUri`,
      ),
    },
  });
}

function parameterValue(
  admission: ArchitectureSysmlSealAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "architecture.sysml.sourceId":
      return admission.sourceId;
    case "architecture.sysml.profile.id":
      return admission.profile.id;
    case "architecture.sysml.profile.version":
      return admission.profile.version;
    case "architecture.sysml.profile.fingerprint.digest":
      return admission.profile.fingerprint.digest;
    case "architecture.sysml.source.sha256":
      return admission.source.sha256;
    case "architecture.sysml.source.byteCount":
      return admission.source.byteCount;
    case "architecture.sysml.source.casUri":
      return admission.source.casUri;
    case "architecture.sysml.analyzer.id":
      return admission.analysis.analyzer.id;
    case "architecture.sysml.analyzer.version":
      return admission.analysis.analyzer.version;
    case "architecture.sysml.analysis.policy.profile":
      return admission.analysis.policy.profile;
    case "architecture.sysml.analysis.policy.status":
      return admission.analysis.policy.status;
    case "architecture.sysml.analysis.sha256":
      return admission.analysis.sha256;
    case "architecture.sysml.analysis.byteCount":
      return admission.analysis.byteCount;
    case "architecture.sysml.analysis.casUri":
      return admission.analysis.casUri;
  }
}

function integerValue(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return Number(value);
  }
  throw new TypeError(`${path} must be a non-negative integer.`);
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  return {
    algorithm: "sha256",
    digest: canonicalSha256(input.digest, `${path}.digest`),
  };
}

function canonicalSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be canonical lowercase SHA-256 hex.`);
  }
  return value;
}

function canonicalCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (
    !/^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/.test(uri) ||
    !uri.endsWith(`/sha256/${digest}`)
  ) {
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
