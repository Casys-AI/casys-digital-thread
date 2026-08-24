/**
 * Canonical, provider-free record of one cross-domain impact recross.
 *
 * This is deliberately a documentary capture, not an impact decision.  Its
 * branch and gate-claim states are proposals for the later human decision
 * boundary; it does not alter any project claim, work item, freshness record,
 * or provider queue.
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
import { fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { ThreadFreshnessStatus } from "../thread/thread-snapshot.ts";
import {
  type CrossDomainImpactBranchId,
  crossDomainImpactBranchOrder,
  type CrossDomainImpactReference,
  parseCrossDomainImpactBranchId,
  requireExactDeclaredBranchSet,
} from "./cross-domain-impact-manifest.ts";
import {
  CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA,
  type CrossDomainImpactEvaluation,
  validateCrossDomainImpactEvaluation,
} from "./cross-domain-impact-evaluation.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "./cross-domain-impact-evaluation-proposal.ts";
import type { CrossDomainImpactManifestSealBriefGate } from "./cross-domain-impact-manifest-proposal.ts";

export const CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA =
  "cross-domain-impact-evaluation-capture/2.0" as const;
export const CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_URI_PREFIX =
  "casys://cross-domain-impact-evaluation-capture/sha256/" as const;

export type CrossDomainImpactAvailability = "available" | "unavailable" | "unresolved";
export type CrossDomainImpactJoinCurrentness = "current" | "unavailable" | "unresolved";

export interface CrossDomainImpactEvaluationBranchFact {
  readonly branchId: CrossDomainImpactBranchId;
  readonly method: {
    readonly reference: CrossDomainImpactReference;
    readonly availability: CrossDomainImpactAvailability;
  };
  readonly joins: readonly {
    readonly reference: CrossDomainImpactReference;
    readonly currentness: CrossDomainImpactJoinCurrentness;
  }[];
}

export interface CrossDomainImpactEvaluationMechanicalFact {
  /** `current` is the sole state that may enter X03 as mechanical evidence. */
  readonly status: "current" | "unavailable" | "unresolved";
  readonly assertionId: string | null;
  readonly reviewTrigger: CrossDomainImpactReference;
  readonly evidence: CrossDomainImpactReference | null;
  readonly evidenceFreshness: ThreadFreshnessStatus | null;
  readonly consumptions: readonly {
    readonly id: string;
    readonly consumerEvidence: CrossDomainImpactReference;
    readonly input: CrossDomainImpactReference;
  }[];
}

export interface CrossDomainImpactEvaluationCapture {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA;
  readonly kind: "cross-domain-impact-evaluation";
  readonly operation: typeof ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION;
  readonly trustedRunId: string;
  readonly evaluatedAt: string;
  /** The exact sealed document named by the current work's required dependsOn leaf. */
  readonly manifestSeal: {
    readonly artifact: CrossDomainImpactReference;
    readonly trustedRunId: string;
  };
  /**
   * The exact Thread artifacts the server actually reread for this capture.
   * It is a closed, canonical set: unavailable or unresolved branch facts do
   * not become invented artifact consumptions.
   */
  readonly artifactInputs: readonly CrossDomainImpactReference[];
  /** Body and complete-CAS identities remain distinct, as for the manifest seal. */
  readonly manifest: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly reference: ContentFingerprint;
  };
  /** Current approved Brief V2 facts, not a decision or gate-claim mutation. */
  readonly brief: {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
    readonly gates: readonly CrossDomainImpactManifestSealBriefGate[];
  };
  readonly branchFacts: readonly CrossDomainImpactEvaluationBranchFact[];
  readonly mechanicalFact: CrossDomainImpactEvaluationMechanicalFact;
  readonly evaluation: CrossDomainImpactEvaluation;
  readonly limits: {
    readonly providerCalls: "none";
    readonly solverCalls: "none";
    readonly gateClaimTransitions: "none";
    readonly workItemInvalidations: "none";
    readonly rerunProposals: "none";
  };
}

const ROOT_KEYS = [
  "schemaVersion",
  "kind",
  "operation",
  "trustedRunId",
  "evaluatedAt",
  "manifestSeal",
  "artifactInputs",
  "manifest",
  "brief",
  "branchFacts",
  "mechanicalFact",
  "evaluation",
  "limits",
] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FRESHNESS = ["fresh", "stale", "running", "failed"] as const;
const AVAILABILITY = ["available", "unavailable", "unresolved"] as const;
const CURRENTNESS = ["current", "unavailable", "unresolved"] as const;

export function crossDomainImpactEvaluationCaptureUri(digest: string): string {
  return `${CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_URI_PREFIX}${digest}`;
}

/** Validate a fully materialized capture before CAS persistence or reread. */
export async function validateCrossDomainImpactEvaluationCapture(
  value: unknown,
): Promise<CrossDomainImpactEvaluationCapture> {
  const root = exactRecord(value, ROOT_KEYS, "$impactEvaluationCapture");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
    "$impactEvaluationCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "cross-domain-impact-evaluation",
    "$impactEvaluationCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$impactEvaluationCapture.operation",
  );
  literalValue(
    operation.id,
    ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    "$impactEvaluationCapture.operation.id",
  );
  literalValue(
    operation.version,
    ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    "$impactEvaluationCapture.operation.version",
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    "$impactEvaluationCapture.trustedRunId",
  );
  const evaluatedAt = parseIsoDateTime(
    root.evaluatedAt,
    "$impactEvaluationCapture.evaluatedAt",
  );
  const manifestSeal = parseManifestSeal(
    root.manifestSeal,
    "$impactEvaluationCapture.manifestSeal",
  );
  const artifactInputs = parseArtifactInputs(
    root.artifactInputs,
    "$impactEvaluationCapture.artifactInputs",
  );
  const manifest = parseManifest(root.manifest, "$impactEvaluationCapture.manifest");
  const brief = parseBrief(root.brief, "$impactEvaluationCapture.brief");
  const branchFacts = parseBranchFacts(
    root.branchFacts,
    "$impactEvaluationCapture.branchFacts",
  );
  const mechanicalFact = parseMechanicalFact(
    root.mechanicalFact,
    "$impactEvaluationCapture.mechanicalFact",
  );
  const evaluation = await validateCrossDomainImpactEvaluation(root.evaluation);
  const limits = parseLimits(root.limits, "$impactEvaluationCapture.limits");

  if (evaluation.evaluatedAt !== evaluatedAt) {
    throw new TypeError(
      "$impactEvaluationCapture.evaluatedAt must equal evaluation.evaluatedAt.",
    );
  }
  if (
    evaluation.manifest.id !== manifest.id ||
    !fingerprintsEqual(evaluation.manifest.fingerprint, manifest.fingerprint)
  ) {
    throw new TypeError(
      "$impactEvaluationCapture.manifest must exactly identify evaluation.manifest.",
    );
  }
  assertBranchFactsMatchEvaluation(branchFacts, evaluation);
  assertBriefGatesMatchEvaluation(brief.gates, evaluation);
  assertMechanicalFactMatchesEvaluation(mechanicalFact, evaluation);
  assertArtifactInputsMatchRecross(
    artifactInputs,
    manifestSeal,
    evaluation,
    branchFacts,
    mechanicalFact,
  );

  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId,
    evaluatedAt,
    manifestSeal,
    artifactInputs,
    manifest,
    brief,
    branchFacts,
    mechanicalFact,
    evaluation,
    limits,
  });
}

function parseManifestSeal(
  value: unknown,
  path: string,
): CrossDomainImpactEvaluationCapture["manifestSeal"] {
  const input = exactRecord(value, ["artifact", "trustedRunId"], path);
  return {
    artifact: parseReference(input.artifact, `${path}.artifact`),
    trustedRunId: safeId(input.trustedRunId, `${path}.trustedRunId`),
  };
}

function parseArtifactInputs(
  value: unknown,
  path: string,
): readonly CrossDomainImpactReference[] {
  const inputs = nonEmptyArray(value, path).map((item, index) =>
    parseReference(item, `${path}[${index}]`)
  );
  rejectDuplicates(inputs.map(referenceKey), `${path} exact references`);
  const ordered = [...inputs].sort((left, right) =>
    referenceKey(left).localeCompare(referenceKey(right))
  );
  if (
    ordered.some((item, index) => referenceKey(item) !== referenceKey(inputs[index]!))
  ) {
    throw new TypeError(`${path} must be canonically ordered.`);
  }
  return deepFreeze(ordered);
}

function parseManifest(
  value: unknown,
  path: string,
): CrossDomainImpactEvaluationCapture["manifest"] {
  const input = exactRecord(value, ["id", "fingerprint", "reference"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    reference: parseFingerprint(input.reference, `${path}.reference`),
  };
}

function parseBrief(
  value: unknown,
  path: string,
): CrossDomainImpactEvaluationCapture["brief"] {
  const input = exactRecord(value, ["id", "revision", "fingerprint", "gates"], path);
  const gates = nonEmptyArray(input.gates, `${path}.gates`).map((item, index) =>
    parseBriefGate(item, `${path}.gates[${index}]`)
  );
  rejectDuplicates(gates.map((item) => item.gateItemId), `${path}.gates gateItemIds`);
  return {
    id: safeId(input.id, `${path}.id`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    gates: [...gates].sort((left, right) =>
      left.gateItemId.localeCompare(right.gateItemId)
    ),
  };
}

function parseBriefGate(
  value: unknown,
  path: string,
): CrossDomainImpactManifestSealBriefGate {
  const input = exactRecord(
    value,
    ["gateItemId", "kind", "branchId", "role", "fingerprint", "dependsOnItemIds"],
    path,
  );
  const kind = nonEmptyText(input.kind, `${path}.kind`);
  if (kind !== "success-criterion" && kind !== "verification-activity") {
    throw new TypeError(
      `${path}.kind must be success-criterion or verification-activity.`,
    );
  }
  const role = nonEmptyText(input.role, `${path}.role`);
  if (role !== "contributes-to" && role !== "satisfies") {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  const dependsOnItemIds = arrayOf(input.dependsOnItemIds, `${path}.dependsOnItemIds`)
    .map(
      (item, index) => safeId(item, `${path}.dependsOnItemIds[${index}]`),
    );
  rejectDuplicates(dependsOnItemIds, `${path}.dependsOnItemIds`);
  const orderedDependencies = [...dependsOnItemIds].sort((left, right) =>
    left.localeCompare(right)
  );
  if (orderedDependencies.some((item, index) => item !== dependsOnItemIds[index])) {
    throw new TypeError(`${path}.dependsOnItemIds must be canonically ordered.`);
  }
  return {
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    kind,
    branchId: parseBranchId(input.branchId, `${path}.branchId`),
    role,
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    dependsOnItemIds: orderedDependencies,
  };
}

function parseBranchFacts(
  value: unknown,
  path: string,
): readonly CrossDomainImpactEvaluationBranchFact[] {
  const facts = nonEmptyArray(value, path).map((item, index) => {
    const input = exactRecord(
      item,
      ["branchId", "method", "joins"],
      `${path}[${index}]`,
    );
    const method = exactRecord(
      input.method,
      ["reference", "availability"],
      `${path}[${index}].method`,
    );
    const availability = nonEmptyText(
      method.availability,
      `${path}[${index}].method.availability`,
    );
    if (!AVAILABILITY.includes(availability as CrossDomainImpactAvailability)) {
      throw new TypeError(
        `${path}[${index}].method.availability is not a literal availability state.`,
      );
    }
    const joins = nonEmptyArray(input.joins, `${path}[${index}].joins`).map(
      (join, joinIndex) => {
        const parsed = exactRecord(
          join,
          ["reference", "currentness"],
          `${path}[${index}].joins[${joinIndex}]`,
        );
        const currentness = nonEmptyText(
          parsed.currentness,
          `${path}[${index}].joins[${joinIndex}].currentness`,
        );
        if (!CURRENTNESS.includes(currentness as CrossDomainImpactJoinCurrentness)) {
          throw new TypeError(
            `${path}[${index}].joins[${joinIndex}].currentness is not literal.`,
          );
        }
        return {
          reference: parseReference(
            parsed.reference,
            `${path}[${index}].joins[${joinIndex}].reference`,
          ),
          currentness: currentness as CrossDomainImpactJoinCurrentness,
        };
      },
    );
    rejectDuplicates(
      joins.map((item) => referenceKey(item.reference)),
      `${path}[${index}].joins`,
    );
    return {
      branchId: parseBranchId(input.branchId, `${path}[${index}].branchId`),
      method: {
        reference: parseReference(
          method.reference,
          `${path}[${index}].method.reference`,
        ),
        availability: availability as CrossDomainImpactAvailability,
      },
      joins: [...joins].sort((left, right) =>
        referenceKey(left.reference).localeCompare(referenceKey(right.reference))
      ),
    };
  });
  rejectDuplicates(facts.map((item) => item.branchId), `${path} branchIds`);
  return deepFreeze(
    [...facts].sort((left, right) =>
      crossDomainImpactBranchOrder(left.branchId, right.branchId)
    ),
  );
}

function parseMechanicalFact(
  value: unknown,
  path: string,
): CrossDomainImpactEvaluationMechanicalFact {
  const input = exactRecord(
    value,
    [
      "status",
      "assertionId",
      "reviewTrigger",
      "evidence",
      "evidenceFreshness",
      "consumptions",
    ],
    path,
  );
  const status = nonEmptyText(input.status, `${path}.status`);
  if (status !== "current" && status !== "unavailable" && status !== "unresolved") {
    throw new TypeError(`${path}.status must be current, unavailable, or unresolved.`);
  }
  const assertionId = input.assertionId === null
    ? null
    : safeId(input.assertionId, `${path}.assertionId`);
  const evidence = input.evidence === null
    ? null
    : parseReference(input.evidence, `${path}.evidence`);
  const evidenceFreshness = input.evidenceFreshness === null
    ? null
    : parseFreshness(input.evidenceFreshness, `${path}.evidenceFreshness`);
  const consumptions = arrayOf(input.consumptions, `${path}.consumptions`).map(
    (item, index) => {
      const consumption = exactRecord(
        item,
        ["id", "consumerEvidence", "input"],
        `${path}.consumptions[${index}]`,
      );
      return {
        id: safeId(consumption.id, `${path}.consumptions[${index}].id`),
        consumerEvidence: parseReference(
          consumption.consumerEvidence,
          `${path}.consumptions[${index}].consumerEvidence`,
        ),
        input: parseReference(
          consumption.input,
          `${path}.consumptions[${index}].input`,
        ),
      };
    },
  );
  rejectDuplicates(consumptions.map((item) => item.id), `${path}.consumptions ids`);
  if (status === "current") {
    if (
      !assertionId || !evidence || evidenceFreshness !== "fresh" ||
      consumptions.length === 0
    ) {
      throw new TypeError(
        `${path} current requires an exact assertion, fresh evidence, and consumption facts.`,
      );
    }
    if (consumptions.some((item) => !sameReference(item.consumerEvidence, evidence))) {
      throw new TypeError(
        `${path} current consumptions must name the exact mechanical evidence.`,
      );
    }
  }
  return {
    status,
    assertionId,
    reviewTrigger: parseReference(input.reviewTrigger, `${path}.reviewTrigger`),
    evidence,
    evidenceFreshness,
    consumptions: [...consumptions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function parseLimits(
  value: unknown,
  path: string,
): CrossDomainImpactEvaluationCapture["limits"] {
  const input = exactRecord(
    value,
    [
      "providerCalls",
      "solverCalls",
      "gateClaimTransitions",
      "workItemInvalidations",
      "rerunProposals",
    ],
    path,
  );
  literalValue(input.providerCalls, "none", `${path}.providerCalls`);
  literalValue(input.solverCalls, "none", `${path}.solverCalls`);
  literalValue(input.gateClaimTransitions, "none", `${path}.gateClaimTransitions`);
  literalValue(input.workItemInvalidations, "none", `${path}.workItemInvalidations`);
  literalValue(input.rerunProposals, "none", `${path}.rerunProposals`);
  return {
    providerCalls: "none",
    solverCalls: "none",
    gateClaimTransitions: "none",
    workItemInvalidations: "none",
    rerunProposals: "none",
  };
}

function assertBranchFactsMatchEvaluation(
  facts: readonly CrossDomainImpactEvaluationBranchFact[],
  evaluation: CrossDomainImpactEvaluation,
): void {
  requireExactDeclaredBranchSet(
    facts.map((item) => item.branchId),
    evaluation.branchReadiness.map((item) => item.branchId),
    "$impactEvaluationCapture.branchFacts",
  );
  requireExactDeclaredBranchSet(
    facts.map((item) => item.branchId),
    evaluation.branches.map((item) => item.branchId),
    "$impactEvaluationCapture.branchFacts",
  );
  for (const readiness of evaluation.branchReadiness) {
    const fact = facts.find((item) => item.branchId === readiness.branchId);
    if (
      !fact ||
      !sameReference(fact.method.reference, readiness.method.reference) ||
      (fact.method.availability === "available") !== readiness.method.available ||
      fact.joins.length !== readiness.joins.length
    ) {
      throw new TypeError(
        "$impactEvaluationCapture.branchFacts must exactly recross evaluation.branchReadiness.",
      );
    }
    for (const join of readiness.joins) {
      const actual = fact.joins.find((candidate) =>
        sameReference(candidate.reference, join.reference)
      );
      if (!actual || (actual.currentness === "current") !== join.current) {
        throw new TypeError(
          "$impactEvaluationCapture.branchFacts join currentness must exactly recross evaluation.",
        );
      }
    }
  }
}

function assertBriefGatesMatchEvaluation(
  gates: readonly CrossDomainImpactManifestSealBriefGate[],
  evaluation: CrossDomainImpactEvaluation,
): void {
  if (gates.length !== evaluation.gateClaims.length) {
    throw new TypeError(
      "$impactEvaluationCapture.brief.gates must exactly cover evaluation gate claims.",
    );
  }
  for (const claim of evaluation.gateClaims) {
    const gate = gates.find((candidate) => candidate.gateItemId === claim.gateItemId);
    if (!gate || gate.branchId !== claim.branchId || gate.role !== claim.role) {
      throw new TypeError(
        "$impactEvaluationCapture.brief.gates must retain the exact gate-map branch and role.",
      );
    }
  }
}

function assertMechanicalFactMatchesEvaluation(
  fact: CrossDomainImpactEvaluationMechanicalFact,
  evaluation: CrossDomainImpactEvaluation,
): void {
  if (fact.status === "current") {
    if (
      !evaluation.mechanicalEvidence || !fact.evidence || !sameReference(
        evaluation.mechanicalEvidence.evidence,
        fact.evidence,
      )
    ) {
      throw new TypeError(
        "$impactEvaluationCapture current mechanical fact must be the exact evaluation evidence.",
      );
    }
    if (
      !sameMechanicalConsumptions(
        fact.consumptions,
        evaluation.mechanicalEvidence.consumptions,
      )
    ) {
      throw new TypeError(
        "$impactEvaluationCapture current mechanical fact must retain every exact evaluation consumption.",
      );
    }
    return;
  }
  if (evaluation.mechanicalEvidence !== null) {
    throw new TypeError(
      "$impactEvaluationCapture non-current mechanical fact cannot supply evaluation evidence.",
    );
  }
}

/**
 * Keep X08 provenance closed over facts truly reread by X07.  A branch that
 * is unavailable or unresolved remains visible in `branchFacts`, but its
 * artifact is not promoted to a verified Thread consumption.
 */
function assertArtifactInputsMatchRecross(
  inputs: readonly CrossDomainImpactReference[],
  manifestSeal: CrossDomainImpactEvaluationCapture["manifestSeal"],
  evaluation: CrossDomainImpactEvaluation,
  branchFacts: readonly CrossDomainImpactEvaluationBranchFact[],
  mechanicalFact: CrossDomainImpactEvaluationMechanicalFact,
): void {
  const expected = new Map<string, CrossDomainImpactReference>();
  const add = (reference: CrossDomainImpactReference) => {
    const previous = expected.get(reference.id);
    if (previous && !sameReference(previous, reference)) {
      throw new TypeError(
        "$impactEvaluationCapture cannot consume incompatible fingerprints for one artifact id.",
      );
    }
    expected.set(reference.id, reference);
  };
  add(manifestSeal.artifact);
  for (const source of evaluation.changedSources) {
    if (source.source.kind === "artifact") add(source.source);
  }
  for (const branch of branchFacts) {
    if (branch.method.availability === "available") add(branch.method.reference);
    for (const join of branch.joins) {
      if (join.currentness === "current") add(join.reference);
    }
  }
  if (mechanicalFact.status === "current") {
    if (!mechanicalFact.evidence) {
      throw new TypeError(
        "$impactEvaluationCapture current mechanical evidence is absent from provenance inputs.",
      );
    }
    add(mechanicalFact.evidence);
    for (const consumption of mechanicalFact.consumptions) add(consumption.input);
  }

  const actual = new Map<string, CrossDomainImpactReference>();
  for (const input of inputs) {
    const previous = actual.get(input.id);
    if (previous && !sameReference(previous, input)) {
      throw new TypeError(
        "$impactEvaluationCapture.artifactInputs cannot contain incompatible fingerprints for one artifact id.",
      );
    }
    actual.set(input.id, input);
  }
  if (
    actual.size !== expected.size || [...expected].some(([id, reference]) => {
      const actualReference = actual.get(id);
      return !actualReference || !sameReference(actualReference, reference);
    })
  ) {
    throw new TypeError(
      "$impactEvaluationCapture.artifactInputs must exactly equal the server-reread artifact set.",
    );
  }
}

function sameMechanicalConsumptions(
  left: readonly CrossDomainImpactEvaluationMechanicalFact["consumptions"][number][],
  right: readonly NonNullable<
    CrossDomainImpactEvaluation["mechanicalEvidence"]
  >["consumptions"][number][],
): boolean {
  const key = (
    item: CrossDomainImpactEvaluationMechanicalFact["consumptions"][number],
  ) => `${item.id}:${referenceKey(item.consumerEvidence)}:${referenceKey(item.input)}`;
  const leftKeys = [...left.map(key)].sort();
  const rightKeys = [...right.map(key)].sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((item, index) => item === rightKeys[index]);
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

function parseFreshness(value: unknown, path: string): ThreadFreshnessStatus {
  const status = nonEmptyText(value, path);
  if (!FRESHNESS.includes(status as ThreadFreshnessStatus)) {
    throw new TypeError(`${path} must be a Thread freshness status.`);
  }
  return status as ThreadFreshnessStatus;
}

function parseBranchId(value: unknown, path: string): CrossDomainImpactBranchId {
  return parseCrossDomainImpactBranchId(value, path);
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

function referenceKey(value: CrossDomainImpactReference): string {
  return `${value.id}:${value.fingerprint.algorithm}:${value.fingerprint.digest}`;
}

void CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA;
