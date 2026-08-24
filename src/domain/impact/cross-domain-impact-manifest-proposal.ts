/**
 * Closed MRTR grammar for `verify.seal-cross-domain-impact-manifest@2`.
 *
 * The proposal seals exact identities, Brief V2 gate dependencies, and the
 * already-declared Thread evidence recross. It is intentionally not an impact
 * evaluation: it has no branch result, gate-claim transition, provider, solver,
 * source bytes, or physical value.
 */

import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringGateClaimRole,
  EngineeringOperationRef,
} from "../project/engineering-project.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA,
  type CrossDomainImpactBranchId,
  type CrossDomainImpactSourceAnchor,
  parseCrossDomainImpactBranchId,
  parseCrossDomainImpactChangeKind,
} from "./cross-domain-impact-manifest.ts";
import type { ThreadFreshnessStatus } from "../thread/thread-snapshot.ts";

export const VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION = {
  id: "verify.seal-cross-domain-impact-manifest",
  version: "2",
} as const;

export const CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA =
  "cross-domain-impact-manifest-seal-admission/2.0" as const;

export const CROSS_DOMAIN_IMPACT_MANIFEST_URI_PREFIX =
  "casys://cross-domain-impact-manifest/sha256/" as const;

export interface CrossDomainImpactManifestSealBriefGate {
  readonly gateItemId: string;
  readonly kind: "success-criterion" | "verification-activity";
  readonly branchId: CrossDomainImpactBranchId;
  readonly role: EngineeringGateClaimRole;
  readonly fingerprint: ContentFingerprint;
  /** Explicit V2 declaration. An empty array means declared independence. */
  readonly dependsOnItemIds: readonly string[];
}

export interface CrossDomainImpactManifestSealMechanicalEvidence {
  readonly assertionId: string;
  readonly evidence: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evidenceFreshness: ThreadFreshnessStatus;
  readonly consumptions: readonly {
    readonly id: string;
    readonly consumerEvidence: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly input: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
  }[];
}

/**
 * Exact facts whose single canonical parameter sequence is reviewed by a
 * human. The full manifest is reopened separately by its content address at
 * execution; `manifest.fingerprint` binds its closed body, including all
 * branches and causal edges, without asking the caller to resupply either.
 */
export interface CrossDomainImpactManifestSealAdmission {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA;
  readonly manifest: {
    readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA;
    readonly id: string;
    readonly revision: number;
    /** Body fingerprint embedded in the closed manifest. */
    readonly fingerprint: ContentFingerprint;
    /** Content address of the full canonical manifest document. */
    readonly reference: ContentFingerprint;
    readonly uri: string;
  };
  readonly project: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly subject: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly brief: {
    readonly contractVersion: "2.0";
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
    readonly gates: readonly CrossDomainImpactManifestSealBriefGate[];
  };
  readonly sourceAnchors: readonly CrossDomainImpactSourceAnchor[];
  readonly mechanicalEvidence:
    readonly CrossDomainImpactManifestSealMechanicalEvidence[];
}

const PARAMETER_KEYS = [
  "impact.manifest.seal.schemaVersion",
  "impact.manifest.schemaVersion",
  "impact.manifest.id",
  "impact.manifest.revision",
  "impact.manifest.fingerprint.digest",
  "impact.manifest.reference.digest",
  "impact.project.id",
  "impact.project.fingerprint.digest",
  "impact.subject.id",
  "impact.subject.fingerprint.digest",
  "impact.basis.snapshotId",
  "impact.basis.revision",
  "impact.basis.fingerprint.digest",
  "impact.brief.contractVersion",
  "impact.brief.id",
  "impact.brief.revision",
  "impact.brief.fingerprint.digest",
  "impact.brief.gates.canonicalJson",
  "impact.sourceAnchors.canonicalJson",
  "impact.mechanicalEvidence.canonicalJson",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "impact.manifest.seal.schemaVersion": "Impact manifest seal schema",
  "impact.manifest.schemaVersion": "Impact manifest schema",
  "impact.manifest.id": "Impact manifest",
  "impact.manifest.revision": "Impact manifest revision",
  "impact.manifest.fingerprint.digest": "Impact manifest body fingerprint",
  "impact.manifest.reference.digest": "Impact manifest document reference",
  "impact.project.id": "Project",
  "impact.project.fingerprint.digest": "Project fingerprint",
  "impact.subject.id": "Subject",
  "impact.subject.fingerprint.digest": "Subject fingerprint",
  "impact.basis.snapshotId": "Thread snapshot",
  "impact.basis.revision": "Thread revision",
  "impact.basis.fingerprint.digest": "Thread fingerprint",
  "impact.brief.contractVersion": "Approved brief contract",
  "impact.brief.id": "Approved brief",
  "impact.brief.revision": "Approved brief revision",
  "impact.brief.fingerprint.digest": "Approved brief fingerprint",
  "impact.brief.gates.canonicalJson": "Brief V2 gate dependencies",
  "impact.sourceAnchors.canonicalJson": "Reviewed Thread source anchors",
  "impact.mechanicalEvidence.canonicalJson": "Declared mechanical evidence recross",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GATE_ROLES = ["contributes-to", "satisfies"] as const;
const FRESHNESS = ["fresh", "stale", "running", "failed"] as const;

/** The only permitted work-item operation shape; callers choose no binding. */
export function sealCrossDomainImpactManifestWorkItemOperation(): EngineeringOperationRef {
  return {
    id: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.id,
    version: VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
}

export function crossDomainImpactManifestUri(
  fingerprint: ContentFingerprint,
): string {
  return `${CROSS_DOMAIN_IMPACT_MANIFEST_URI_PREFIX}${fingerprint.digest}`;
}

export function encodeCrossDomainImpactManifestSealAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateCrossDomainImpactManifestSealAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

/** Parse the ordered, fixed MRTR grammar; extra/reordered parameters are refused. */
export function parseCrossDomainImpactManifestSealParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): CrossDomainImpactManifestSealAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Cross-domain impact manifest seal proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected || parameter.label !== PARAMETER_LABELS[expected]) {
      throw new TypeError(
        `Cross-domain impact manifest seal parameter ${index} must be ${expected} with its canonical label.`,
      );
    }
    if (parameter.unit !== undefined) {
      throw new TypeError(
        `Cross-domain impact manifest seal parameter ${expected} has no unit.`,
      );
    }
    values.set(expected, parameter.value);
  }
  return validateCrossDomainImpactManifestSealAdmission({
    schemaVersion: values.get("impact.manifest.seal.schemaVersion"),
    manifest: {
      schemaVersion: values.get("impact.manifest.schemaVersion"),
      id: values.get("impact.manifest.id"),
      revision: integerValue(
        values.get("impact.manifest.revision"),
        "impact.manifest.revision",
      ),
      fingerprint: fingerprintFromDigest(
        values.get("impact.manifest.fingerprint.digest"),
        "impact.manifest.fingerprint",
      ),
      reference: fingerprintFromDigest(
        values.get("impact.manifest.reference.digest"),
        "impact.manifest.reference",
      ),
      uri: crossDomainImpactManifestUri(fingerprintFromDigest(
        values.get("impact.manifest.reference.digest"),
        "impact.manifest.reference",
      )),
    },
    project: {
      id: values.get("impact.project.id"),
      fingerprint: fingerprintFromDigest(
        values.get("impact.project.fingerprint.digest"),
        "impact.project.fingerprint",
      ),
    },
    subject: {
      id: values.get("impact.subject.id"),
      fingerprint: fingerprintFromDigest(
        values.get("impact.subject.fingerprint.digest"),
        "impact.subject.fingerprint",
      ),
    },
    basis: {
      snapshotId: values.get("impact.basis.snapshotId"),
      revision: integerValue(
        values.get("impact.basis.revision"),
        "impact.basis.revision",
      ),
      fingerprint: fingerprintFromDigest(
        values.get("impact.basis.fingerprint.digest"),
        "impact.basis.fingerprint",
      ),
    },
    brief: {
      contractVersion: values.get("impact.brief.contractVersion"),
      id: values.get("impact.brief.id"),
      revision: integerValue(
        values.get("impact.brief.revision"),
        "impact.brief.revision",
      ),
      fingerprint: fingerprintFromDigest(
        values.get("impact.brief.fingerprint.digest"),
        "impact.brief.fingerprint",
      ),
      gates: parseCanonicalJson(
        values.get("impact.brief.gates.canonicalJson"),
        "$impactManifestSeal.brief.gates",
      ),
    },
    sourceAnchors: parseCanonicalJson(
      values.get("impact.sourceAnchors.canonicalJson"),
      "$impactManifestSeal.sourceAnchors",
    ),
    mechanicalEvidence: parseCanonicalJson(
      values.get("impact.mechanicalEvidence.canonicalJson"),
      "$impactManifestSeal.mechanicalEvidence",
    ),
  });
}

export function validateCrossDomainImpactManifestSealAdmission(
  value: unknown,
): CrossDomainImpactManifestSealAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "manifest",
    "project",
    "subject",
    "basis",
    "brief",
    "sourceAnchors",
    "mechanicalEvidence",
  ], "$impactManifestSeal");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
    "$impactManifestSeal.schemaVersion",
  );
  const manifest = exactRecord(
    root.manifest,
    ["schemaVersion", "id", "revision", "fingerprint", "reference", "uri"],
    "$impactManifestSeal.manifest",
  );
  literalValue(
    manifest.schemaVersion,
    CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA,
    "$impactManifestSeal.manifest.schemaVersion",
  );
  const reference = parseFingerprint(
    manifest.reference,
    "$impactManifestSeal.manifest.reference",
  );
  const expectedManifestUri = crossDomainImpactManifestUri(reference);
  if (manifest.uri !== expectedManifestUri) {
    throw new TypeError(
      "$impactManifestSeal.manifest.uri must be the server-issued CAS URI.",
    );
  }
  const project = parseIdentity(root.project, "$impactManifestSeal.project");
  const subject = parseIdentity(root.subject, "$impactManifestSeal.subject");
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$impactManifestSeal.basis",
  );
  const brief = exactRecord(
    root.brief,
    ["contractVersion", "id", "revision", "fingerprint", "gates"],
    "$impactManifestSeal.brief",
  );
  literalValue(
    brief.contractVersion,
    "2.0",
    "$impactManifestSeal.brief.contractVersion",
  );

  const sourceAnchors = arrayOf(
    root.sourceAnchors,
    "$impactManifestSeal.sourceAnchors",
  ).map((item, index) =>
    parseSourceAnchor(item, `$impactManifestSeal.sourceAnchors[${index}]`)
  );
  if (sourceAnchors.length === 0) {
    throw new TypeError("$impactManifestSeal.sourceAnchors must not be empty.");
  }
  rejectDuplicates(
    sourceAnchors.map((item) => item.id),
    "$impactManifestSeal.sourceAnchors ids",
  );
  const canonicalSourceAnchors = [...sourceAnchors].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  requireCanonicalArray(
    root.sourceAnchors,
    canonicalSourceAnchors,
    "$impactManifestSeal.sourceAnchors",
  );

  const gates = arrayOf(brief.gates, "$impactManifestSeal.brief.gates").map(
    (item, index) => parseBriefGate(item, `$impactManifestSeal.brief.gates[${index}]`),
  );
  if (gates.length === 0) {
    throw new TypeError("$impactManifestSeal.brief.gates must not be empty.");
  }
  rejectDuplicates(
    gates.map((item) => item.gateItemId),
    "$impactManifestSeal.brief.gates ids",
  );
  const canonicalGates = [...gates].sort((left, right) =>
    left.gateItemId.localeCompare(right.gateItemId)
  );
  requireCanonicalArray(brief.gates, canonicalGates, "$impactManifestSeal.brief.gates");

  const mechanicalEvidence = arrayOf(
    root.mechanicalEvidence,
    "$impactManifestSeal.mechanicalEvidence",
  ).map((item, index) =>
    parseMechanicalEvidence(item, `$impactManifestSeal.mechanicalEvidence[${index}]`)
  );
  rejectDuplicates(
    mechanicalEvidence.map((item) => item.assertionId),
    "$impactManifestSeal.mechanicalEvidence assertion ids",
  );
  const canonicalMechanicalEvidence = [...mechanicalEvidence].sort((left, right) =>
    left.assertionId.localeCompare(right.assertionId)
  );
  requireCanonicalArray(
    root.mechanicalEvidence,
    canonicalMechanicalEvidence,
    "$impactManifestSeal.mechanicalEvidence",
  );

  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
    manifest: {
      schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SCHEMA,
      id: safeId(manifest.id, "$impactManifestSeal.manifest.id"),
      revision: positiveInteger(
        manifest.revision,
        "$impactManifestSeal.manifest.revision",
      ),
      fingerprint: parseFingerprint(
        manifest.fingerprint,
        "$impactManifestSeal.manifest.fingerprint",
      ),
      reference,
      uri: expectedManifestUri,
    },
    project,
    subject,
    basis: {
      snapshotId: safeId(basis.snapshotId, "$impactManifestSeal.basis.snapshotId"),
      revision: positiveInteger(basis.revision, "$impactManifestSeal.basis.revision"),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$impactManifestSeal.basis.fingerprint",
      ),
    },
    brief: {
      contractVersion: "2.0",
      id: safeId(brief.id, "$impactManifestSeal.brief.id"),
      revision: positiveInteger(brief.revision, "$impactManifestSeal.brief.revision"),
      fingerprint: parseFingerprint(
        brief.fingerprint,
        "$impactManifestSeal.brief.fingerprint",
      ),
      gates: canonicalGates,
    },
    sourceAnchors: canonicalSourceAnchors,
    mechanicalEvidence: canonicalMechanicalEvidence,
  });
}

function parameterValue(
  admission: CrossDomainImpactManifestSealAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "impact.manifest.seal.schemaVersion":
      return admission.schemaVersion;
    case "impact.manifest.schemaVersion":
      return admission.manifest.schemaVersion;
    case "impact.manifest.id":
      return admission.manifest.id;
    case "impact.manifest.revision":
      return admission.manifest.revision;
    case "impact.manifest.fingerprint.digest":
      return admission.manifest.fingerprint.digest;
    case "impact.manifest.reference.digest":
      return admission.manifest.reference.digest;
    case "impact.project.id":
      return admission.project.id;
    case "impact.project.fingerprint.digest":
      return admission.project.fingerprint.digest;
    case "impact.subject.id":
      return admission.subject.id;
    case "impact.subject.fingerprint.digest":
      return admission.subject.fingerprint.digest;
    case "impact.basis.snapshotId":
      return admission.basis.snapshotId;
    case "impact.basis.revision":
      return admission.basis.revision;
    case "impact.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "impact.brief.contractVersion":
      return admission.brief.contractVersion;
    case "impact.brief.id":
      return admission.brief.id;
    case "impact.brief.revision":
      return admission.brief.revision;
    case "impact.brief.fingerprint.digest":
      return admission.brief.fingerprint.digest;
    case "impact.brief.gates.canonicalJson":
      return deterministicJson(admission.brief.gates);
    case "impact.sourceAnchors.canonicalJson":
      return deterministicJson(admission.sourceAnchors);
    case "impact.mechanicalEvidence.canonicalJson":
      return deterministicJson(admission.mechanicalEvidence);
  }
}

function parseIdentity(
  value: unknown,
  path: string,
): { id: string; fingerprint: ContentFingerprint } {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseSourceAnchor(
  value: unknown,
  path: string,
): CrossDomainImpactSourceAnchor {
  const input = exactRecord(value, [
    "id",
    "changeKind",
    "role",
    "threadChange",
    "source",
  ], path);
  const changeKind = parseCrossDomainImpactChangeKind(
    input.changeKind,
    `${path}.changeKind`,
  );
  literalValue(input.role, "reviewed-change-source", `${path}.role`);
  const change = exactRecord(
    input.threadChange,
    ["id", "kind", "fingerprint"],
    `${path}.threadChange`,
  );
  const kind = nonEmptyText(change.kind, `${path}.threadChange.kind`);
  if (!["created", "modified", "deleted", "archived"].includes(kind)) {
    throw new TypeError(
      `${path}.threadChange.kind must use the existing Thread change vocabulary.`,
    );
  }
  const source = exactRecord(
    input.source,
    ["kind", "id", "fingerprint"],
    `${path}.source`,
  );
  const sourceKind = nonEmptyText(source.kind, `${path}.source.kind`);
  if (!["artifact", "requirement", "sysml-element"].includes(sourceKind)) {
    throw new TypeError(
      `${path}.source.kind must be artifact, requirement or sysml-element.`,
    );
  }
  return {
    id: safeId(input.id, `${path}.id`),
    changeKind,
    role: "reviewed-change-source",
    threadChange: {
      id: safeId(change.id, `${path}.threadChange.id`),
      kind: kind as CrossDomainImpactSourceAnchor["threadChange"]["kind"],
      fingerprint: parseFingerprint(
        change.fingerprint,
        `${path}.threadChange.fingerprint`,
      ),
    },
    source: {
      kind: sourceKind as CrossDomainImpactSourceAnchor["source"]["kind"],
      id: safeId(source.id, `${path}.source.id`),
      fingerprint: parseFingerprint(source.fingerprint, `${path}.source.fingerprint`),
    },
  };
}

function parseBriefGate(
  value: unknown,
  path: string,
): CrossDomainImpactManifestSealBriefGate {
  const input = exactRecord(value, [
    "gateItemId",
    "kind",
    "branchId",
    "role",
    "fingerprint",
    "dependsOnItemIds",
  ], path);
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (kind !== "success-criterion" && kind !== "verification-activity") {
    throw new TypeError(
      `${path}.kind must be success-criterion or verification-activity.`,
    );
  }
  const branchId = parseCrossDomainImpactBranchId(input.branchId, `${path}.branchId`);
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!GATE_ROLES.includes(role as EngineeringGateClaimRole)) {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  const dependsOnItemIds = arrayOf(input.dependsOnItemIds, `${path}.dependsOnItemIds`)
    .map(
      (item, index) => safeId(item, `${path}.dependsOnItemIds[${index}]`),
    );
  rejectDuplicates(dependsOnItemIds, `${path}.dependsOnItemIds`);
  const canonicalDependencies = [...dependsOnItemIds].sort((left, right) =>
    left.localeCompare(right)
  );
  requireCanonicalArray(
    input.dependsOnItemIds,
    canonicalDependencies,
    `${path}.dependsOnItemIds`,
  );
  return {
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    kind,
    branchId,
    role: role as EngineeringGateClaimRole,
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    dependsOnItemIds: canonicalDependencies,
  };
}

function parseMechanicalEvidence(
  value: unknown,
  path: string,
): CrossDomainImpactManifestSealMechanicalEvidence {
  const input = exactRecord(value, [
    "assertionId",
    "evidence",
    "evidenceFreshness",
    "consumptions",
  ], path);
  const freshness = nonEmptyText(input.evidenceFreshness, `${path}.evidenceFreshness`);
  if (!FRESHNESS.includes(freshness as ThreadFreshnessStatus)) {
    throw new TypeError(`${path}.evidenceFreshness must be a Thread freshness status.`);
  }
  const consumptions = arrayOf(input.consumptions, `${path}.consumptions`).map(
    (item, index) => {
      const consumption = exactRecord(
        item,
        ["id", "consumerEvidence", "input"],
        `${path}.consumptions[${index}]`,
      );
      return {
        id: safeId(consumption.id, `${path}.consumptions[${index}].id`),
        consumerEvidence: parseIdentity(
          consumption.consumerEvidence,
          `${path}.consumptions[${index}].consumerEvidence`,
        ),
        input: parseIdentity(consumption.input, `${path}.consumptions[${index}].input`),
      };
    },
  );
  rejectDuplicates(consumptions.map((item) => item.id), `${path}.consumptions ids`);
  const canonicalConsumptions = [...consumptions].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  requireCanonicalArray(
    input.consumptions,
    canonicalConsumptions,
    `${path}.consumptions`,
  );
  return {
    assertionId: safeId(input.assertionId, `${path}.assertionId`),
    evidence: parseIdentity(input.evidence, `${path}.evidence`),
    evidenceFreshness: freshness as ThreadFreshnessStatus,
    consumptions: canonicalConsumptions,
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function fingerprintFromDigest(value: unknown, path: string): ContentFingerprint {
  return parseFingerprint({ algorithm: "sha256", digest: value }, path);
}

function integerValue(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  throw new TypeError(`${path} must be an integer.`);
}

function parseCanonicalJson(value: unknown, path: string): unknown {
  const text = nonEmptyText(value, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${path} must be canonical JSON.`);
  }
  if (deterministicJson(parsed) !== text) {
    throw new TypeError(`${path} must be canonical JSON.`);
  }
  return parsed;
}

function requireCanonicalArray(
  input: unknown,
  canonical: unknown,
  path: string,
): void {
  if (deterministicJson(input) !== deterministicJson(canonical)) {
    throw new TypeError(`${path} must use canonical stable ordering.`);
  }
}
