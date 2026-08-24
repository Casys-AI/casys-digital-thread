/**
 * Pure, provider-free cross-domain impact transitions.
 *
 * This module only recrosses a sealed manifest against supplied immutable
 * facts. It never reads persistence, selects a provider, queues work or
 * executes an engineering method. Its outcomes are gate-claim link states,
 * never engineering pass/fail verdicts.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { fingerprintsEqual, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type {
  EngineeringGateClaimRole,
  EngineeringGateClaimStatus,
} from "../project/engineering-project.ts";
import {
  CROSS_DOMAIN_IMPACT_THREAD_CHANGE_KINDS,
  type CrossDomainImpactAnchorSourceKind,
  type CrossDomainImpactBranchId,
  crossDomainImpactBranchOrder,
  type CrossDomainImpactChangeKind,
  type CrossDomainImpactManifest,
  type CrossDomainImpactProjectIdentity,
  type CrossDomainImpactReference,
  type CrossDomainImpactSubjectIdentity,
  type CrossDomainImpactThreadBasis,
  type CrossDomainImpactThreadChangeKind,
  parseCrossDomainImpactBranchId,
  parseCrossDomainImpactChangeKind,
  requireExactDeclaredBranchSet,
  validateCrossDomainImpactManifest,
} from "./cross-domain-impact-manifest.ts";

export const CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA =
  "cross-domain-impact-evaluation/2.0" as const;

const MECHANICAL_BRANCH_ID = "mechanical";

/** The existing project gate-claim vocabulary; no verdict vocabulary is admitted. */
export const CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES = [
  "current",
  "impact-unresolved",
  "invalidated",
  "carried-forward",
] as const satisfies readonly EngineeringGateClaimStatus[];

export type CrossDomainImpactGateClaimStatus =
  (typeof CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES)[number];

export interface CrossDomainImpactChangedSource {
  readonly sourceAnchorId: string;
  readonly changeKind: CrossDomainImpactChangeKind;
  readonly threadChange: {
    readonly id: string;
    readonly kind: CrossDomainImpactThreadChangeKind;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly kind: CrossDomainImpactAnchorSourceKind;
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
}

/** Current availability facts for one declared branch method and its joins. */
export interface CrossDomainImpactBranchReadiness {
  readonly branchId: CrossDomainImpactBranchId;
  readonly method: {
    readonly reference: CrossDomainImpactReference;
    readonly available: boolean;
  };
  readonly joins: readonly {
    readonly reference: CrossDomainImpactReference;
    readonly current: boolean;
  }[];
}

export interface CrossDomainImpactEvidenceConsumption {
  readonly id: string;
  readonly consumerEvidence: CrossDomainImpactReference;
  readonly input: CrossDomainImpactReference;
}

/** Exact mechanical evidence and its actual input consumptions at recross time. */
export interface CrossDomainImpactMechanicalEvidence {
  readonly evidence: CrossDomainImpactReference;
  readonly consumptions: readonly CrossDomainImpactEvidenceConsumption[];
}

export interface CrossDomainImpactEvaluationInput {
  readonly manifest: CrossDomainImpactManifest;
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  readonly changedSources: readonly CrossDomainImpactChangedSource[];
  readonly reviewTrigger: CrossDomainImpactReference;
  readonly branchReadiness: readonly CrossDomainImpactBranchReadiness[];
  /** `null` is an honest unavailable fact and can never carry a claim forward. */
  readonly mechanicalEvidence: CrossDomainImpactMechanicalEvidence | null;
  readonly evaluatedAt: string;
}

export interface CrossDomainImpactBranchResult {
  readonly branchId: CrossDomainImpactBranchId;
  readonly status: CrossDomainImpactGateClaimStatus;
}

export interface CrossDomainImpactGateClaimTransition {
  readonly gateItemId: string;
  readonly branchId: CrossDomainImpactBranchId;
  readonly role: EngineeringGateClaimRole;
  readonly status: CrossDomainImpactGateClaimStatus;
}

export interface CrossDomainImpactEvaluationBody {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA;
  readonly manifest: CrossDomainImpactReference;
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  readonly changedSources: readonly CrossDomainImpactChangedSource[];
  readonly reviewTrigger: CrossDomainImpactReference;
  readonly branchReadiness: readonly CrossDomainImpactBranchReadiness[];
  readonly mechanicalEvidence: CrossDomainImpactMechanicalEvidence | null;
  readonly evaluatedAt: string;
  readonly branches: readonly CrossDomainImpactBranchResult[];
  readonly gateClaims: readonly CrossDomainImpactGateClaimTransition[];
}

export interface CrossDomainImpactEvaluation extends CrossDomainImpactEvaluationBody {
  /** SHA-256 of the canonical evaluation body, excluding this field. */
  readonly fingerprint: ContentFingerprint;
}

const BODY_KEYS = [
  "schemaVersion",
  "manifest",
  "project",
  "subject",
  "basis",
  "changedSources",
  "reviewTrigger",
  "branchReadiness",
  "mechanicalEvidence",
  "evaluatedAt",
  "branches",
  "gateClaims",
] as const;
const ROOT_KEYS = [...BODY_KEYS, "fingerprint"] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ANCHOR_SOURCE_KINDS = ["artifact", "requirement", "sysml-element"] as const;
const GATE_ROLES = ["contributes-to", "satisfies"] as const;

/**
 * Re-evaluate exact facts against a sealed manifest. The returned object is a
 * canonical, content-addressed capture candidate; this function does not store
 * it anywhere.
 */
export async function evaluateCrossDomainImpact(
  input: CrossDomainImpactEvaluationInput,
): Promise<CrossDomainImpactEvaluation> {
  const manifest = await validateCrossDomainImpactManifest(input.manifest);
  assertExactIdentityContext(manifest, input);

  const changedSources = canonicalChangedSources(input.changedSources, manifest);
  const branchReadiness = canonicalBranchReadiness(
    input.branchReadiness,
    manifest.branches.map((item) => item.id),
  );
  const mechanicalEvidence = parseMechanicalEvidence(
    input.mechanicalEvidence,
    "$evaluation.mechanicalEvidence",
  );
  const reviewTrigger = parseReference(
    input.reviewTrigger,
    "$evaluation.reviewTrigger",
  );
  const evaluatedAt = parseIsoDateTime(input.evaluatedAt, "$evaluation.evaluatedAt");

  const declaredBranchIds = manifest.branches.map((item) => item.id);
  const changedAnchorIds = new Set(changedSources.map((item) => item.sourceAnchorId));
  const statuses = new Map<
    CrossDomainImpactBranchId,
    CrossDomainImpactGateClaimStatus
  >();
  for (const branch of manifest.branches) {
    const hasPositiveEdge = manifest.causalEdges.some((edge) =>
      edge.to.branchId === branch.id && changedAnchorIds.has(edge.fromAnchorId)
    );
    statuses.set(
      branch.id,
      branchStatus(
        branch.id,
        changedSources,
        hasPositiveEdge,
        manifest,
        branchReadiness,
        reviewTrigger,
        evaluatedAt,
        mechanicalEvidence,
      ),
    );
  }

  if (
    mechanicalEvidence !== null && !declaredBranchIds.includes(MECHANICAL_BRANCH_ID)
  ) {
    throw new TypeError(
      "$evaluation.mechanicalEvidence is only admitted when mechanical is a declared branch.",
    );
  }

  const branches = declaredBranchIds.map((branchId) => ({
    branchId,
    status: statuses.get(branchId)!,
  }));
  const gateClaims = manifest.gateMap.map((item) => ({
    gateItemId: item.gateItemId,
    branchId: item.branchId,
    role: item.role,
    status: statuses.get(item.branchId)!,
  }));

  const body = canonicalizeCrossDomainImpactEvaluationBody({
    schemaVersion: CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA,
    manifest: { id: manifest.id, fingerprint: manifest.fingerprint },
    project: input.project,
    subject: input.subject,
    basis: input.basis,
    changedSources,
    reviewTrigger,
    branchReadiness,
    mechanicalEvidence,
    evaluatedAt,
    branches,
    gateClaims,
  });
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

/** Canonicalize an evaluation body before fingerprint validation or storage. */
export function canonicalizeCrossDomainImpactEvaluationBody(
  value: unknown,
): CrossDomainImpactEvaluationBody {
  const root = exactRecord(value, BODY_KEYS, "$evaluation");
  return parseEvaluationBody(root);
}

export async function fingerprintCrossDomainImpactEvaluationBody(
  bodyValue: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    canonicalizeCrossDomainImpactEvaluationBody(bodyValue),
  );
}

/** Validate a sealed canonical capture, including its body fingerprint and status vocabulary. */
export async function validateCrossDomainImpactEvaluation(
  value: unknown,
): Promise<CrossDomainImpactEvaluation> {
  const root = exactRecord(value, ROOT_KEYS, "$evaluation");
  const body = parseEvaluationBody(root);
  const fingerprint = parseFingerprint(root.fingerprint, "$evaluation.fingerprint");
  const recomputed = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, recomputed)) {
    throw new TypeError(
      "$evaluation.fingerprint must equal the SHA-256 of the canonical evaluation body.",
    );
  }
  return deepFreeze({ ...body, fingerprint: recomputed });
}

function branchStatus(
  branchId: CrossDomainImpactBranchId,
  changedSources: readonly CrossDomainImpactChangedSource[],
  hasPositiveEdge: boolean,
  manifest: CrossDomainImpactManifest,
  branchReadiness: readonly CrossDomainImpactBranchReadiness[],
  reviewTrigger: CrossDomainImpactReference,
  evaluatedAt: string,
  mechanicalEvidence: CrossDomainImpactMechanicalEvidence | null,
): CrossDomainImpactGateClaimStatus {
  if (changedSources.length === 0) return "current";

  if (branchId === MECHANICAL_BRANCH_ID) {
    if (hasPositiveEdge) return "invalidated";
    return hasCurrentMechanicalIndependenceAssertion(
        manifest,
        changedSources,
        reviewTrigger,
        evaluatedAt,
        mechanicalEvidence,
      )
      ? "carried-forward"
      : "impact-unresolved";
  }

  if (!hasPositiveEdge) return "impact-unresolved";
  return hasCurrentNonmechanicalBranchReadiness(
      manifest,
      branchId,
      branchReadiness,
    )
    ? "invalidated"
    : "impact-unresolved";
}

function hasCurrentNonmechanicalBranchReadiness(
  manifest: CrossDomainImpactManifest,
  branchId: CrossDomainImpactBranchId,
  readiness: readonly CrossDomainImpactBranchReadiness[],
): boolean {
  const branch = manifest.branches.find((item) => item.id === branchId);
  const facts = readiness.find((item) => item.branchId === branchId);
  if (!branch || !facts || !facts.method.available) return false;
  if (!sameReference(branch.method, facts.method.reference)) return false;
  if (branch.joins.length !== facts.joins.length) return false;
  return branch.joins.every((expected) => {
    const actual = facts.joins.find((item) => sameReference(item.reference, expected));
    return actual?.current === true;
  });
}

function hasCurrentMechanicalIndependenceAssertion(
  manifest: CrossDomainImpactManifest,
  changedSources: readonly CrossDomainImpactChangedSource[],
  reviewTrigger: CrossDomainImpactReference,
  evaluatedAt: string,
  mechanicalEvidence: CrossDomainImpactMechanicalEvidence | null,
): boolean {
  if (!mechanicalEvidence) return false;
  const evaluatedAtMs = Date.parse(evaluatedAt);
  return manifest.independenceAssertions.some((assertion) => {
    if (assertion.branchId !== MECHANICAL_BRANCH_ID) return false;
    if (!sameReference(assertion.review.trigger, reviewTrigger)) return false;
    if (
      Date.parse(assertion.review.reviewedAt) > evaluatedAtMs ||
      Date.parse(assertion.review.expiresAt) <= evaluatedAtMs
    ) {
      return false;
    }
    if (!sameReference(assertion.evidence, mechanicalEvidence.evidence)) return false;
    if (
      !sameInspectedAnchors(assertion.inspectedSourceAnchors, changedSources, manifest)
    ) {
      return false;
    }
    return sameMechanicalConsumptions(
      assertion.inspectedConsumptions,
      mechanicalEvidence,
    );
  });
}

function sameInspectedAnchors(
  inspected: CrossDomainImpactManifest["independenceAssertions"][number][
    "inspectedSourceAnchors"
  ],
  changedSources: readonly CrossDomainImpactChangedSource[],
  manifest: CrossDomainImpactManifest,
): boolean {
  if (inspected.length !== changedSources.length) return false;
  const expected = new Set(
    changedSources.map((changed) => {
      const anchor = manifest.sourceAnchors.find((item) =>
        item.id === changed.sourceAnchorId
      )!;
      return [
        anchor.id,
        anchor.threadChange.fingerprint.digest,
        anchor.source.fingerprint.digest,
      ].join(":");
    }),
  );
  const actual = new Set(
    inspected.map((item) =>
      [
        item.sourceAnchorId,
        item.threadChangeFingerprint.digest,
        item.sourceFingerprint.digest,
      ].join(":")
    ),
  );
  return expected.size === actual.size &&
    [...expected].every((item) => actual.has(item));
}

function sameMechanicalConsumptions(
  inspected: CrossDomainImpactManifest["independenceAssertions"][number][
    "inspectedConsumptions"
  ],
  mechanicalEvidence: CrossDomainImpactMechanicalEvidence | null,
): boolean {
  if (!mechanicalEvidence) return false;
  if (
    inspected.length === 0 ||
    inspected.length !== mechanicalEvidence.consumptions.length
  ) {
    return false;
  }
  if (
    mechanicalEvidence.consumptions.some((item) =>
      !sameReference(item.consumerEvidence, mechanicalEvidence.evidence)
    )
  ) {
    return false;
  }
  const expected = new Set(
    inspected.map((item) => consumptionKey(item.id, item.input)),
  );
  const actual = new Set(
    mechanicalEvidence.consumptions.map((item) => consumptionKey(item.id, item.input)),
  );
  return expected.size === actual.size &&
    [...expected].every((item) => actual.has(item));
}

function assertExactIdentityContext(
  manifest: CrossDomainImpactManifest,
  input: CrossDomainImpactEvaluationInput,
): void {
  if (
    !sameReference(manifest.project, input.project) ||
    !sameReference(manifest.subject, input.subject) ||
    !sameBasis(manifest.basis, input.basis)
  ) {
    throw new TypeError(
      "Cross-domain impact evaluation requires the manifest's exact project, subject and Thread basis identities and fingerprints.",
    );
  }
}

function canonicalChangedSources(
  value: unknown,
  manifest: CrossDomainImpactManifest,
): readonly CrossDomainImpactChangedSource[] {
  const changed = arrayOf(value, "$evaluation.changedSources").map((item, index) =>
    parseChangedSource(item, `$evaluation.changedSources[${index}]`)
  );
  rejectDuplicates(
    changed.map((item) => item.sourceAnchorId),
    "$evaluation.changedSources anchors",
  );
  for (const item of changed) {
    const anchor = manifest.sourceAnchors.find((candidate) =>
      candidate.id === item.sourceAnchorId
    );
    if (
      !anchor ||
      anchor.changeKind !== item.changeKind ||
      anchor.threadChange.id !== item.threadChange.id ||
      anchor.threadChange.kind !== item.threadChange.kind ||
      !fingerprintsEqual(
        anchor.threadChange.fingerprint,
        item.threadChange.fingerprint,
      ) ||
      anchor.source.kind !== item.source.kind ||
      anchor.source.id !== item.source.id ||
      !fingerprintsEqual(anchor.source.fingerprint, item.source.fingerprint)
    ) {
      throw new TypeError(
        `$evaluation.changedSources ${
          JSON.stringify(item.sourceAnchorId)
        } must exactly recross a manifest sourceAnchor and its Thread change lineage.`,
      );
    }
  }
  return deepFreeze(
    [...changed].sort((left, right) =>
      left.sourceAnchorId.localeCompare(right.sourceAnchorId)
    ),
  );
}

function canonicalBranchReadiness(
  value: unknown,
  declared: readonly CrossDomainImpactBranchId[],
): readonly CrossDomainImpactBranchReadiness[] {
  const readiness = parseBranchReadinessList(value, "$evaluation.branchReadiness");
  requireExactDeclaredBranchSet(
    readiness.map((item) => item.branchId),
    declared,
    "$evaluation.branchReadiness",
  );
  return readiness;
}

function parseBranchReadinessList(
  value: unknown,
  path: string,
): readonly CrossDomainImpactBranchReadiness[] {
  const readiness = nonEmptyArray(value, path).map(
    (item, index) => parseBranchReadiness(item, `${path}[${index}]`),
  );
  rejectDuplicates(readiness.map((item) => item.branchId), `${path} branches`);
  return deepFreeze(
    [...readiness].sort((left, right) =>
      crossDomainImpactBranchOrder(left.branchId, right.branchId)
    ),
  );
}

function parseEvaluationBody(
  root: Record<string, unknown>,
): CrossDomainImpactEvaluationBody {
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA,
    "$evaluation.schemaVersion",
  );
  const project = parseProject(root.project, "$evaluation.project");
  const subject = parseSubject(root.subject, "$evaluation.subject");
  const basis = parseBasis(root.basis, "$evaluation.basis");
  if (basis.projectId !== project.id || basis.subjectId !== subject.id) {
    throw new TypeError(
      "$evaluation.basis projectId and subjectId must exactly match $evaluation.project and $evaluation.subject.",
    );
  }
  const changedSources = arrayOf(root.changedSources, "$evaluation.changedSources").map(
    (item, index) => parseChangedSource(item, `$evaluation.changedSources[${index}]`),
  );
  rejectDuplicates(
    changedSources.map((item) => item.sourceAnchorId),
    "$evaluation.changedSources anchors",
  );
  const branchReadiness = parseBranchReadinessList(
    root.branchReadiness,
    "$evaluation.branchReadiness",
  );
  const branches = nonEmptyArray(root.branches, "$evaluation.branches").map((
    item,
    index,
  ) => parseBranchResult(item, `$evaluation.branches[${index}]`));
  rejectDuplicates(branches.map((item) => item.branchId), "$evaluation.branches ids");
  requireExactDeclaredBranchSet(
    branchReadiness.map((item) => item.branchId),
    branches.map((item) => item.branchId),
    "$evaluation.branchReadiness",
  );
  const gateClaims = nonEmptyArray(root.gateClaims, "$evaluation.gateClaims").map(
    (item, index) => parseGateClaimTransition(item, `$evaluation.gateClaims[${index}]`),
  );
  rejectDuplicates(
    gateClaims.map((item) => item.gateItemId),
    "$evaluation.gateClaims gateItemIds",
  );
  const declaredBranchIds = branches.map((item) => item.branchId);
  requireExactDeclaredBranchSet(
    [...new Set(gateClaims.map((item) => item.branchId))],
    declaredBranchIds,
    "$evaluation.gateClaims",
  );
  const branchStatuses = new Map(branches.map((item) => [item.branchId, item.status]));
  for (const gateClaim of gateClaims) {
    if (branchStatuses.get(gateClaim.branchId) !== gateClaim.status) {
      throw new TypeError(
        `$evaluation.gateClaims ${
          JSON.stringify(gateClaim.gateItemId)
        } must carry its branch result status.`,
      );
    }
  }
  const mechanicalEvidence = parseMechanicalEvidence(
    root.mechanicalEvidence,
    "$evaluation.mechanicalEvidence",
  );
  if (
    mechanicalEvidence !== null && !declaredBranchIds.includes(MECHANICAL_BRANCH_ID)
  ) {
    throw new TypeError(
      "$evaluation.mechanicalEvidence is only admitted when mechanical is a declared branch.",
    );
  }

  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA,
    manifest: parseReference(root.manifest, "$evaluation.manifest"),
    project,
    subject,
    basis,
    changedSources: [...changedSources].sort((left, right) =>
      left.sourceAnchorId.localeCompare(right.sourceAnchorId)
    ),
    reviewTrigger: parseReference(root.reviewTrigger, "$evaluation.reviewTrigger"),
    branchReadiness,
    mechanicalEvidence,
    evaluatedAt: parseIsoDateTime(root.evaluatedAt, "$evaluation.evaluatedAt"),
    branches: [...branches].sort((left, right) =>
      crossDomainImpactBranchOrder(left.branchId, right.branchId)
    ),
    gateClaims: [...gateClaims].sort((left, right) =>
      gateClaimKey(left).localeCompare(gateClaimKey(right))
    ),
  });
}

function parseChangedSource(
  value: unknown,
  path: string,
): CrossDomainImpactChangedSource {
  const input = exactRecord(
    value,
    ["sourceAnchorId", "changeKind", "threadChange", "source"],
    path,
  );
  const threadChange = exactRecord(
    input.threadChange,
    ["id", "kind", "fingerprint"],
    `${path}.threadChange`,
  );
  const source = exactRecord(
    input.source,
    ["kind", "id", "fingerprint"],
    `${path}.source`,
  );
  const changeKind = parseChangeKind(input.changeKind, `${path}.changeKind`);
  const threadChangeKind = parseThreadChangeKind(
    threadChange.kind,
    `${path}.threadChange.kind`,
  );
  const sourceKind = parseAnchorSourceKind(source.kind, `${path}.source.kind`);
  return {
    sourceAnchorId: safeId(input.sourceAnchorId, `${path}.sourceAnchorId`),
    changeKind,
    threadChange: {
      id: safeId(threadChange.id, `${path}.threadChange.id`),
      kind: threadChangeKind,
      fingerprint: parseFingerprint(
        threadChange.fingerprint,
        `${path}.threadChange.fingerprint`,
      ),
    },
    source: {
      kind: sourceKind,
      id: safeId(source.id, `${path}.source.id`),
      fingerprint: parseFingerprint(source.fingerprint, `${path}.source.fingerprint`),
    },
  };
}

function parseBranchReadiness(
  value: unknown,
  path: string,
): CrossDomainImpactBranchReadiness {
  const input = exactRecord(value, ["branchId", "method", "joins"], path);
  const method = exactRecord(
    input.method,
    ["reference", "available"],
    `${path}.method`,
  );
  if (typeof method.available !== "boolean") {
    throw new TypeError(`${path}.method.available must be boolean.`);
  }
  const joins = nonEmptyArray(input.joins, `${path}.joins`).map((item, index) => {
    const join = exactRecord(item, ["reference", "current"], `${path}.joins[${index}]`);
    if (typeof join.current !== "boolean") {
      throw new TypeError(`${path}.joins[${index}].current must be boolean.`);
    }
    return {
      reference: parseReference(join.reference, `${path}.joins[${index}].reference`),
      current: join.current,
    };
  });
  rejectDuplicates(joins.map((item) => referenceKey(item.reference)), `${path}.joins`);
  return {
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    method: {
      reference: parseReference(method.reference, `${path}.method.reference`),
      available: method.available,
    },
    joins: [...joins].sort((left, right) =>
      referenceKey(left.reference).localeCompare(referenceKey(right.reference))
    ),
  };
}

function parseMechanicalEvidence(
  value: unknown,
  path: string,
): CrossDomainImpactMechanicalEvidence | null {
  if (value === null) return null;
  const input = exactRecord(value, ["evidence", "consumptions"], path);
  const consumptions = nonEmptyArray(input.consumptions, `${path}.consumptions`).map(
    (item, index) => parseEvidenceConsumption(item, `${path}.consumptions[${index}]`),
  );
  rejectDuplicates(consumptions.map((item) => item.id), `${path}.consumptions ids`);
  rejectDuplicates(
    consumptions.map((item) => referenceKey(item.input)),
    `${path}.consumptions inputs`,
  );
  return {
    evidence: parseReference(input.evidence, `${path}.evidence`),
    consumptions: [...consumptions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function parseEvidenceConsumption(
  value: unknown,
  path: string,
): CrossDomainImpactEvidenceConsumption {
  const input = exactRecord(value, ["id", "consumerEvidence", "input"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    consumerEvidence: parseReference(
      input.consumerEvidence,
      `${path}.consumerEvidence`,
    ),
    input: parseReference(input.input, `${path}.input`),
  };
}

function parseBranchResult(
  value: unknown,
  path: string,
): CrossDomainImpactBranchResult {
  const input = exactRecord(value, ["branchId", "status"], path);
  return {
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    status: parseGateClaimStatus(input.status, `${path}.status`),
  };
}

function parseGateClaimTransition(
  value: unknown,
  path: string,
): CrossDomainImpactGateClaimTransition {
  const input = exactRecord(value, ["gateItemId", "branchId", "role", "status"], path);
  const role = nonEmptyText(input.role, `${path}.role`);
  if (!GATE_ROLES.includes(role as EngineeringGateClaimRole)) {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  return {
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    role: role as EngineeringGateClaimRole,
    status: parseGateClaimStatus(input.status, `${path}.status`),
  };
}

function parseProject(value: unknown, path: string): CrossDomainImpactProjectIdentity {
  return parseReference(value, path);
}

function parseSubject(value: unknown, path: string): CrossDomainImpactSubjectIdentity {
  return parseReference(value, path);
}

function parseBasis(value: unknown, path: string): CrossDomainImpactThreadBasis {
  const input = exactRecord(
    value,
    ["projectId", "subjectId", "snapshotId", "revision", "fingerprint"],
    path,
  );
  return {
    projectId: safeId(input.projectId, `${path}.projectId`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
    snapshotId: safeId(input.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseReference(value: unknown, path: string): CrossDomainImpactReference {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
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

function parseChangeKind(value: unknown, path: string): CrossDomainImpactChangeKind {
  return parseCrossDomainImpactChangeKind(value, path);
}

function parseThreadChangeKind(
  value: unknown,
  path: string,
): CrossDomainImpactThreadChangeKind {
  const kind = nonEmptyText(value, path);
  if (
    !CROSS_DOMAIN_IMPACT_THREAD_CHANGE_KINDS.includes(
      kind as CrossDomainImpactThreadChangeKind,
    )
  ) {
    throw new TypeError(`${path} must use the existing Thread change vocabulary.`);
  }
  return kind as CrossDomainImpactThreadChangeKind;
}

function parseAnchorSourceKind(
  value: unknown,
  path: string,
): CrossDomainImpactAnchorSourceKind {
  const kind = nonEmptyText(value, path);
  if (!ANCHOR_SOURCE_KINDS.includes(kind as CrossDomainImpactAnchorSourceKind)) {
    throw new TypeError(`${path} must be artifact, requirement or sysml-element.`);
  }
  return kind as CrossDomainImpactAnchorSourceKind;
}

function parseBranchId(value: unknown, path: string): CrossDomainImpactBranchId {
  return parseCrossDomainImpactBranchId(value, path);
}

function parseGateClaimStatus(
  value: unknown,
  path: string,
): CrossDomainImpactGateClaimStatus {
  const status = nonEmptyText(value, path);
  if (
    !CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES.includes(
      status as CrossDomainImpactGateClaimStatus,
    )
  ) {
    throw new TypeError(
      `${path} must be current, impact-unresolved, invalidated or carried-forward.`,
    );
  }
  return status as CrossDomainImpactGateClaimStatus;
}

function parseIsoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_DATE_TIME.test(text) || Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return text;
}

function sameReference(
  left: CrossDomainImpactReference,
  right: CrossDomainImpactReference,
): boolean {
  return left.id === right.id && fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function sameBasis(
  left: CrossDomainImpactThreadBasis,
  right: CrossDomainImpactThreadBasis,
): boolean {
  return left.projectId === right.projectId && left.subjectId === right.subjectId &&
    left.snapshotId === right.snapshotId && left.revision === right.revision &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function referenceKey(value: CrossDomainImpactReference): string {
  return `${value.id}:${value.fingerprint.algorithm}:${value.fingerprint.digest}`;
}

function consumptionKey(id: string, input: CrossDomainImpactReference): string {
  return `${id}:${referenceKey(input)}`;
}

function gateClaimKey(value: CrossDomainImpactGateClaimTransition): string {
  return `${value.gateItemId}:${value.branchId}:${value.role}`;
}
