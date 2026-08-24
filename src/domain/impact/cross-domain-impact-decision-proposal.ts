/**
 * Closed MRTR grammar for `decide.accept-cross-domain-impact@2`.
 *
 * The signed parameters name identities and the already-proposed X07/X08
 * gate-claim statuses recrossed onto existing work-item claims. X07/X08 does
 * not propose work-item invalidations or reruns. Callers never supply a
 * branch, provider, tool, argument, value, unit, or invented work item.
 */

import type { ContentFingerprint } from "../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
} from "../project/engineering-project.ts";
import {
  canonicalizeCrossDomainImpactWorkItemClaims,
  type CrossDomainImpactWorkItemClaimTransition,
} from "./cross-domain-impact-decision.ts";

export const DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION = {
  id: "decide.accept-cross-domain-impact",
  version: "2",
} as const;

export const CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA =
  "cross-domain-impact-decision-admission/2.0" as const;

export const CROSS_DOMAIN_IMPACT_DECISION_LIMITS = {
  providerCalls: "none",
  solverCalls: "none",
  reruns: "none",
  newWorkItems: "none",
} as const;

export interface CrossDomainImpactDecisionAdmission {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA;
  readonly consequence: "accept";
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly brief: {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evaluation: {
    readonly capture: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly trustedRunId: string;
  };
  readonly manifestSeal: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly workItemClaims: readonly CrossDomainImpactWorkItemClaimTransition[];
  readonly limits: typeof CROSS_DOMAIN_IMPACT_DECISION_LIMITS;
}

const PARAMETER_KEYS = [
  "impact.decision.schemaVersion",
  "impact.decision.consequence",
  "impact.project.id",
  "impact.subject.id",
  "impact.basis.snapshotId",
  "impact.basis.revision",
  "impact.basis.fingerprint.digest",
  "impact.brief.id",
  "impact.brief.revision",
  "impact.brief.fingerprint.digest",
  "impact.evaluation.capture.id",
  "impact.evaluation.capture.fingerprint.digest",
  "impact.evaluation.trustedRunId",
  "impact.manifest.seal.id",
  "impact.manifest.seal.fingerprint.digest",
  "impact.workItemClaims.canonicalJson",
  "impact.limits.providerCalls",
  "impact.limits.solverCalls",
  "impact.limits.reruns",
  "impact.limits.newWorkItems",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "impact.decision.schemaVersion": "Cross-domain impact decision schema",
  "impact.decision.consequence": "Declared human consequence",
  "impact.project.id": "Project",
  "impact.subject.id": "Subject",
  "impact.basis.snapshotId": "Thread snapshot",
  "impact.basis.revision": "Thread revision",
  "impact.basis.fingerprint.digest": "Thread fingerprint",
  "impact.brief.id": "Approved brief",
  "impact.brief.revision": "Approved brief revision",
  "impact.brief.fingerprint.digest": "Approved brief fingerprint",
  "impact.evaluation.capture.id": "Impact evaluation capture",
  "impact.evaluation.capture.fingerprint.digest":
    "Impact evaluation capture fingerprint",
  "impact.evaluation.trustedRunId": "Impact evaluation run",
  "impact.manifest.seal.id": "Sealed impact-manifest document",
  "impact.manifest.seal.fingerprint.digest": "Sealed impact-manifest fingerprint",
  "impact.workItemClaims.canonicalJson": "Recrossed work-item gate-claim transitions",
  "impact.limits.providerCalls": "Provider-call limit",
  "impact.limits.solverCalls": "Solver-call limit",
  "impact.limits.reruns": "Rerun limit",
  "impact.limits.newWorkItems": "New-work-item limit",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function acceptCrossDomainImpactWorkItemOperation(): EngineeringOperationRef {
  return {
    id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  };
}

export function encodeCrossDomainImpactDecisionAdmission(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const admission = validateCrossDomainImpactDecisionAdmission(value);
  return deepFreeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(admission, key),
  })));
}

export function parseCrossDomainImpactDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): CrossDomainImpactDecisionAdmission {
  if (parameters.length !== PARAMETER_KEYS.length) {
    throw new TypeError(
      `Cross-domain impact decision proposal must contain exactly ${PARAMETER_KEYS.length} parameters.`,
    );
  }
  const values = new Map<string, EngineeringDecisionProposalParameter["value"]>();
  for (const [index, parameter] of parameters.entries()) {
    const expected = PARAMETER_KEYS[index];
    if (parameter.key !== expected || parameter.label !== PARAMETER_LABELS[expected]) {
      throw new TypeError(
        `Cross-domain impact decision parameter ${index} must be ${expected} with its canonical label.`,
      );
    }
    if (parameter.unit !== undefined) {
      throw new TypeError(
        `Cross-domain impact decision parameter ${expected} has no unit.`,
      );
    }
    values.set(expected, parameter.value);
  }
  return validateCrossDomainImpactDecisionAdmission({
    schemaVersion: values.get("impact.decision.schemaVersion"),
    consequence: values.get("impact.decision.consequence"),
    projectId: values.get("impact.project.id"),
    subjectId: values.get("impact.subject.id"),
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
      id: values.get("impact.brief.id"),
      revision: integerValue(
        values.get("impact.brief.revision"),
        "impact.brief.revision",
      ),
      fingerprint: fingerprintFromDigest(
        values.get("impact.brief.fingerprint.digest"),
        "impact.brief.fingerprint",
      ),
    },
    evaluation: {
      capture: {
        id: values.get("impact.evaluation.capture.id"),
        fingerprint: fingerprintFromDigest(
          values.get("impact.evaluation.capture.fingerprint.digest"),
          "impact.evaluation.capture.fingerprint",
        ),
      },
      trustedRunId: values.get("impact.evaluation.trustedRunId"),
    },
    manifestSeal: {
      id: values.get("impact.manifest.seal.id"),
      fingerprint: fingerprintFromDigest(
        values.get("impact.manifest.seal.fingerprint.digest"),
        "impact.manifest.seal.fingerprint",
      ),
    },
    workItemClaims: parseCanonicalJson(
      values.get("impact.workItemClaims.canonicalJson"),
      "$impactDecision.workItemClaims",
    ),
    limits: {
      providerCalls: values.get("impact.limits.providerCalls"),
      solverCalls: values.get("impact.limits.solverCalls"),
      reruns: values.get("impact.limits.reruns"),
      newWorkItems: values.get("impact.limits.newWorkItems"),
    },
  });
}

export function validateCrossDomainImpactDecisionAdmission(
  value: unknown,
): CrossDomainImpactDecisionAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "consequence",
    "projectId",
    "subjectId",
    "basis",
    "brief",
    "evaluation",
    "manifestSeal",
    "workItemClaims",
    "limits",
  ], "$impactDecision");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
    "$impactDecision.schemaVersion",
  );
  literalValue(root.consequence, "accept", "$impactDecision.consequence");
  const basis = exactRecord(
    root.basis,
    ["snapshotId", "revision", "fingerprint"],
    "$impactDecision.basis",
  );
  const brief = exactRecord(
    root.brief,
    ["id", "revision", "fingerprint"],
    "$impactDecision.brief",
  );
  const evaluation = exactRecord(
    root.evaluation,
    ["capture", "trustedRunId"],
    "$impactDecision.evaluation",
  );
  const capture = exactRecord(
    evaluation.capture,
    ["id", "fingerprint"],
    "$impactDecision.evaluation.capture",
  );
  const captureFingerprint = parseFingerprint(
    capture.fingerprint,
    "$impactDecision.evaluation.capture.fingerprint",
  );
  const captureId = safeId(capture.id, "$impactDecision.evaluation.capture.id");
  if (captureId !== `cross-domain-impact-evaluation-${captureFingerprint.digest}`) {
    throw new TypeError(
      "$impactDecision.evaluation.capture.id must derive from its digest.",
    );
  }
  const limits = exactRecord(
    root.limits,
    ["providerCalls", "solverCalls", "reruns", "newWorkItems"],
    "$impactDecision.limits",
  );
  literalValue(limits.providerCalls, "none", "$impactDecision.limits.providerCalls");
  literalValue(limits.solverCalls, "none", "$impactDecision.limits.solverCalls");
  literalValue(limits.reruns, "none", "$impactDecision.limits.reruns");
  literalValue(limits.newWorkItems, "none", "$impactDecision.limits.newWorkItems");
  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
    consequence: "accept",
    projectId: safeId(root.projectId, "$impactDecision.projectId"),
    subjectId: safeId(root.subjectId, "$impactDecision.subjectId"),
    basis: {
      snapshotId: safeId(basis.snapshotId, "$impactDecision.basis.snapshotId"),
      revision: positiveInteger(basis.revision, "$impactDecision.basis.revision"),
      fingerprint: parseFingerprint(
        basis.fingerprint,
        "$impactDecision.basis.fingerprint",
      ),
    },
    brief: {
      id: safeId(brief.id, "$impactDecision.brief.id"),
      revision: positiveInteger(brief.revision, "$impactDecision.brief.revision"),
      fingerprint: parseFingerprint(
        brief.fingerprint,
        "$impactDecision.brief.fingerprint",
      ),
    },
    evaluation: {
      capture: { id: captureId, fingerprint: captureFingerprint },
      trustedRunId: safeId(
        evaluation.trustedRunId,
        "$impactDecision.evaluation.trustedRunId",
      ),
    },
    manifestSeal: parseIdentity(root.manifestSeal, "$impactDecision.manifestSeal"),
    workItemClaims: canonicalizeCrossDomainImpactWorkItemClaims(root.workItemClaims),
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  });
}

function parameterValue(
  admission: CrossDomainImpactDecisionAdmission,
  key: (typeof PARAMETER_KEYS)[number],
): EngineeringDecisionProposalParameter["value"] {
  switch (key) {
    case "impact.decision.schemaVersion":
      return admission.schemaVersion;
    case "impact.decision.consequence":
      return admission.consequence;
    case "impact.project.id":
      return admission.projectId;
    case "impact.subject.id":
      return admission.subjectId;
    case "impact.basis.snapshotId":
      return admission.basis.snapshotId;
    case "impact.basis.revision":
      return admission.basis.revision;
    case "impact.basis.fingerprint.digest":
      return admission.basis.fingerprint.digest;
    case "impact.brief.id":
      return admission.brief.id;
    case "impact.brief.revision":
      return admission.brief.revision;
    case "impact.brief.fingerprint.digest":
      return admission.brief.fingerprint.digest;
    case "impact.evaluation.capture.id":
      return admission.evaluation.capture.id;
    case "impact.evaluation.capture.fingerprint.digest":
      return admission.evaluation.capture.fingerprint.digest;
    case "impact.evaluation.trustedRunId":
      return admission.evaluation.trustedRunId;
    case "impact.manifest.seal.id":
      return admission.manifestSeal.id;
    case "impact.manifest.seal.fingerprint.digest":
      return admission.manifestSeal.fingerprint.digest;
    case "impact.workItemClaims.canonicalJson":
      return deterministicJson(admission.workItemClaims);
    case "impact.limits.providerCalls":
      return admission.limits.providerCalls;
    case "impact.limits.solverCalls":
      return admission.limits.solverCalls;
    case "impact.limits.reruns":
      return admission.limits.reruns;
    case "impact.limits.newWorkItems":
      return admission.limits.newWorkItems;
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

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof input.digest === "string" ? input.digest : "";
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
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
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be canonical JSON.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(`${path} must be canonical JSON.`);
  }
  if (deterministicJson(parsed) !== value) {
    throw new TypeError(`${path} must be canonical JSON.`);
  }
  return parsed;
}
