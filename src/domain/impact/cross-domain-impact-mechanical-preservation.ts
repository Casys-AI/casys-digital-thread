/**
 * Pure, provider-free mechanical preservation control.
 *
 * It recrosses an already-accepted X07/X08 evaluation and a reviewed
 * independence assertion against exact current FEA proof/closeout identities
 * and consumptions. It never infers a mechanical verdict from thermal or
 * electrical evidence, never invents pass/fail, and never calls a solver.
 */

import {
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
import type { ThreadFreshnessStatus } from "../thread/thread-snapshot.ts";
import {
  CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA,
  type CrossDomainImpactEvaluation,
  type CrossDomainImpactEvidenceConsumption,
  type CrossDomainImpactGateClaimStatus,
  validateCrossDomainImpactEvaluation,
} from "./cross-domain-impact-evaluation.ts";
import {
  type CrossDomainImpactManifest,
  type CrossDomainImpactProjectIdentity,
  type CrossDomainImpactReference,
  type CrossDomainImpactSubjectIdentity,
  type CrossDomainImpactThreadBasis,
  validateCrossDomainImpactManifest,
} from "./cross-domain-impact-manifest.ts";

export const CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_SCHEMA =
  "cross-domain-impact-mechanical-preservation/2.0" as const;

export const MECHANICAL_PRESERVATION_FEA_PROOF_TOOL =
  "verify.run-fea-static-proof@3" as const;
export const MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL =
  "verify.seal-proof-case@1" as const;
export const MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL =
  "decide.accept-evaluation-closeout@1" as const;

export type MechanicalPreservationStatus = Extract<
  CrossDomainImpactGateClaimStatus,
  "carried-forward" | "impact-unresolved"
>;

export interface MechanicalPreservationFeaEvidence {
  readonly execution: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producer: {
      readonly serverId: string;
      readonly tool: string;
      readonly runId: string;
    };
    readonly kind: string;
    readonly freshness: ThreadFreshnessStatus;
  };
  readonly sealedProof: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerTool: string;
  };
  readonly canonicalStep: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly kind: string;
    readonly mediaType: string;
  };
  readonly l4Evaluation: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerTool: string;
  };
  readonly consumptions: readonly MechanicalPreservationConsumption[];
}

export interface MechanicalPreservationConsumption {
  readonly id: string;
  readonly consumerEvidence?: CrossDomainImpactReference;
  readonly input: CrossDomainImpactReference;
  readonly status: "verified" | "mismatch";
}

export interface MechanicalPreservationCloseoutEvidence {
  readonly artifact: CrossDomainImpactReference;
  readonly producerTool: string;
  readonly consequence: "accept" | "reject";
  readonly inputs: {
    readonly canonicalStep: CrossDomainImpactReference;
    readonly sealedProof: CrossDomainImpactReference;
    readonly executionEvidence: CrossDomainImpactReference;
    readonly evaluationCapture: CrossDomainImpactReference;
  };
  readonly consumptions: readonly MechanicalPreservationConsumption[];
}

export interface MechanicalPreservationInput {
  readonly manifest: CrossDomainImpactManifest;
  readonly evaluation: CrossDomainImpactEvaluation;
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  readonly reviewTrigger: CrossDomainImpactReference;
  readonly evaluatedAt: string;
  readonly feaEvidence: MechanicalPreservationFeaEvidence | null;
  readonly closeout: MechanicalPreservationCloseoutEvidence | null;
}

export interface MechanicalPreservationBody {
  readonly schemaVersion: typeof CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_SCHEMA;
  readonly manifest: CrossDomainImpactReference;
  readonly evaluation: CrossDomainImpactReference;
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  readonly reviewTrigger: CrossDomainImpactReference;
  readonly evaluatedAt: string;
  readonly feaEvidence: MechanicalPreservationFeaEvidence | null;
  readonly closeout: MechanicalPreservationCloseoutEvidence | null;
  readonly status: MechanicalPreservationStatus;
}

export interface MechanicalPreservation extends MechanicalPreservationBody {
  readonly fingerprint: ContentFingerprint;
}

const BODY_KEYS = [
  "schemaVersion",
  "manifest",
  "evaluation",
  "project",
  "subject",
  "basis",
  "reviewTrigger",
  "evaluatedAt",
  "feaEvidence",
  "closeout",
  "status",
] as const;
const ROOT_KEYS = [...BODY_KEYS, "fingerprint"] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FRESHNESS = ["fresh", "stale", "running", "failed"] as const;
const CONSUMPTION_STATUSES = ["verified", "mismatch"] as const;
const PRESERVATION_STATUSES = ["carried-forward", "impact-unresolved"] as const;

/**
 * Recross exact current FEA/closeout facts against a sealed manifest and the
 * already-recorded X07 evaluation. The returned object is a canonical capture
 * candidate; this function does not store it.
 */
export async function evaluateMechanicalPreservation(
  input: MechanicalPreservationInput,
): Promise<MechanicalPreservation> {
  const manifest = await validateCrossDomainImpactManifest(input.manifest);
  const evaluation = await validateCrossDomainImpactEvaluation(input.evaluation);
  assertExactIdentityContext(manifest, evaluation, input);

  const reviewTrigger = parseReference(
    input.reviewTrigger,
    "$mechanicalPreservation.reviewTrigger",
  );
  const evaluatedAt = parseIsoDateTime(
    input.evaluatedAt,
    "$mechanicalPreservation.evaluatedAt",
  );
  const feaEvidence = parseFeaEvidence(
    input.feaEvidence,
    "$mechanicalPreservation.feaEvidence",
  );
  const closeout = parseCloseout(
    input.closeout,
    "$mechanicalPreservation.closeout",
  );
  const status = preservationStatus(
    manifest,
    evaluation,
    reviewTrigger,
    evaluatedAt,
    feaEvidence,
    closeout,
  );

  const body = canonicalizeMechanicalPreservationBody({
    schemaVersion: CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_SCHEMA,
    manifest: { id: manifest.id, fingerprint: manifest.fingerprint },
    evaluation: {
      id: `cross-domain-impact-evaluation-${evaluation.fingerprint.digest}`,
      fingerprint: evaluation.fingerprint,
    },
    project: input.project,
    subject: input.subject,
    basis: input.basis,
    reviewTrigger,
    evaluatedAt,
    feaEvidence,
    closeout,
    status,
  });
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export function canonicalizeMechanicalPreservationBody(
  value: unknown,
): MechanicalPreservationBody {
  const root = exactRecord(value, BODY_KEYS, "$mechanicalPreservation");
  return parseBody(root);
}

export async function validateMechanicalPreservation(
  value: unknown,
): Promise<MechanicalPreservation> {
  const root = exactRecord(value, ROOT_KEYS, "$mechanicalPreservation");
  const body = parseBody(root);
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$mechanicalPreservation.fingerprint",
  );
  const recomputed = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, recomputed)) {
    throw new TypeError(
      "$mechanicalPreservation.fingerprint must equal the SHA-256 of the canonical body.",
    );
  }
  return deepFreeze({ ...body, fingerprint: recomputed });
}

function preservationStatus(
  manifest: CrossDomainImpactManifest,
  evaluation: CrossDomainImpactEvaluation,
  reviewTrigger: CrossDomainImpactReference,
  evaluatedAt: string,
  feaEvidence: MechanicalPreservationFeaEvidence | null,
  closeout: MechanicalPreservationCloseoutEvidence | null,
): MechanicalPreservationStatus {
  const mechanical = evaluation.branches.find((item) => item.branchId === "mechanical");
  if (mechanical?.status !== "carried-forward") return "impact-unresolved";
  if (hasMechanicalCausalEdge(manifest, evaluation)) return "impact-unresolved";
  if (
    !hasCurrentMechanicalIndependenceAssertion(
      manifest,
      evaluation,
      reviewTrigger,
      evaluatedAt,
      feaEvidence,
    )
  ) {
    return "impact-unresolved";
  }
  if (!isExactCurrentFeaEvidence(feaEvidence, evaluation)) {
    return "impact-unresolved";
  }
  if (!isExactAcceptCloseout(closeout, feaEvidence)) return "impact-unresolved";
  return "carried-forward";
}

function hasMechanicalCausalEdge(
  manifest: CrossDomainImpactManifest,
  evaluation: CrossDomainImpactEvaluation,
): boolean {
  const changed = new Set(
    evaluation.changedSources.map((item) => item.sourceAnchorId),
  );
  return manifest.causalEdges.some((edge) =>
    edge.to.branchId === "mechanical" && changed.has(edge.fromAnchorId)
  );
}

function hasCurrentMechanicalIndependenceAssertion(
  manifest: CrossDomainImpactManifest,
  evaluation: CrossDomainImpactEvaluation,
  reviewTrigger: CrossDomainImpactReference,
  evaluatedAt: string,
  feaEvidence: MechanicalPreservationFeaEvidence | null,
): boolean {
  if (!feaEvidence) return false;
  const evaluatedAtMs = Date.parse(evaluatedAt);
  return manifest.independenceAssertions.some((assertion) => {
    if (assertion.branchId !== "mechanical") return false;
    if (!sameReference(assertion.review.trigger, reviewTrigger)) return false;
    if (!sameReference(assertion.review.trigger, evaluation.reviewTrigger)) {
      return false;
    }
    if (
      Date.parse(assertion.review.reviewedAt) > evaluatedAtMs ||
      Date.parse(assertion.review.expiresAt) <= evaluatedAtMs
    ) {
      return false;
    }
    if (
      !sameReference(assertion.evidence, {
        id: feaEvidence.execution.id,
        fingerprint: feaEvidence.execution.fingerprint,
      })
    ) {
      return false;
    }
    if (
      !evaluation.mechanicalEvidence ||
      !sameReference(assertion.evidence, evaluation.mechanicalEvidence.evidence)
    ) {
      return false;
    }
    return sameInspectedConsumptions(
      assertion.inspectedConsumptions,
      feaEvidence.consumptions,
      evaluation.mechanicalEvidence.consumptions,
      feaEvidence,
    );
  });
}

function sameInspectedConsumptions(
  inspected: CrossDomainImpactManifest["independenceAssertions"][number][
    "inspectedConsumptions"
  ],
  current: readonly MechanicalPreservationConsumption[],
  evaluated: readonly CrossDomainImpactEvidenceConsumption[],
  feaEvidence: MechanicalPreservationFeaEvidence,
): boolean {
  if (
    inspected.length === 0 ||
    inspected.length !== current.length ||
    inspected.length !== evaluated.length
  ) {
    return false;
  }
  if (current.some((item) => item.status !== "verified")) return false;
  if (
    current.some((item) =>
      item.consumerEvidence &&
      !sameReference(item.consumerEvidence, {
        id: feaEvidence.execution.id,
        fingerprint: feaEvidence.execution.fingerprint,
      })
    )
  ) {
    return false;
  }
  const expected = new Set(
    inspected.map((item) => consumptionKey(item.id, item.input)),
  );
  const actual = new Set(current.map((item) => consumptionKey(item.id, item.input)));
  const recorded = new Set(
    evaluated.map((item) => consumptionKey(item.id, item.input)),
  );
  return expected.size === actual.size &&
    expected.size === recorded.size &&
    [...expected].every((item) => actual.has(item) && recorded.has(item));
}

function isExactCurrentFeaEvidence(
  feaEvidence: MechanicalPreservationFeaEvidence | null,
  evaluation: CrossDomainImpactEvaluation,
): boolean {
  if (!feaEvidence || !evaluation.mechanicalEvidence) return false;
  if (feaEvidence.execution.freshness !== "fresh") return false;
  if (feaEvidence.execution.kind !== "evidence") return false;
  if (
    feaEvidence.execution.producer.serverId !== "digital-thread" ||
    feaEvidence.execution.producer.tool !== MECHANICAL_PRESERVATION_FEA_PROOF_TOOL
  ) {
    return false;
  }
  if (
    !sameReference(
      { id: feaEvidence.execution.id, fingerprint: feaEvidence.execution.fingerprint },
      evaluation.mechanicalEvidence.evidence,
    )
  ) {
    return false;
  }
  if (
    feaEvidence.sealedProof.producerTool !== MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL
  ) {
    return false;
  }
  if (
    feaEvidence.canonicalStep.kind !== "step" ||
    feaEvidence.canonicalStep.mediaType !== "model/step"
  ) {
    return false;
  }
  if (
    feaEvidence.l4Evaluation.producerTool !== MECHANICAL_PRESERVATION_FEA_PROOF_TOOL
  ) {
    return false;
  }
  return feaEvidence.consumptions.every((item) => item.status === "verified");
}

function isExactAcceptCloseout(
  closeout: MechanicalPreservationCloseoutEvidence | null,
  feaEvidence: MechanicalPreservationFeaEvidence | null,
): boolean {
  if (!closeout || !feaEvidence) return false;
  if (closeout.producerTool !== MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL) {
    return false;
  }
  if (closeout.consequence !== "accept") return false;
  if (
    !sameReference(closeout.inputs.executionEvidence, {
      id: feaEvidence.execution.id,
      fingerprint: feaEvidence.execution.fingerprint,
    }) ||
    !sameReference(closeout.inputs.sealedProof, {
      id: feaEvidence.sealedProof.id,
      fingerprint: feaEvidence.sealedProof.fingerprint,
    }) ||
    !sameReference(closeout.inputs.canonicalStep, {
      id: feaEvidence.canonicalStep.id,
      fingerprint: feaEvidence.canonicalStep.fingerprint,
    }) ||
    !sameReference(closeout.inputs.evaluationCapture, {
      id: feaEvidence.l4Evaluation.id,
      fingerprint: feaEvidence.l4Evaluation.fingerprint,
    })
  ) {
    return false;
  }
  const expectedInputs = [
    closeout.inputs.canonicalStep,
    closeout.inputs.sealedProof,
    closeout.inputs.executionEvidence,
    closeout.inputs.evaluationCapture,
  ];
  if (closeout.consumptions.length !== expectedInputs.length) return false;
  const actualIds = new Set(closeout.consumptions.map((item) => item.id));
  if (actualIds.size !== expectedInputs.length) return false;
  return expectedInputs.every((input) => {
    const expectedId = `consume-${input.id}-by-${closeout.artifact.id}`;
    const consumption = closeout.consumptions.find((item) => item.id === expectedId);
    return !!consumption &&
      consumption.status === "verified" &&
      sameReference(consumption.input, input);
  });
}

function assertExactIdentityContext(
  manifest: CrossDomainImpactManifest,
  evaluation: CrossDomainImpactEvaluation,
  input: MechanicalPreservationInput,
): void {
  if (
    !sameReference(manifest.project, input.project) ||
    !sameReference(manifest.subject, input.subject) ||
    !sameBasis(manifest.basis, input.basis) ||
    !sameReference(evaluation.project, input.project) ||
    !sameReference(evaluation.subject, input.subject) ||
    !sameBasis(evaluation.basis, input.basis) ||
    evaluation.schemaVersion !== CROSS_DOMAIN_IMPACT_EVALUATION_SCHEMA ||
    evaluation.manifest.id !== manifest.id ||
    !fingerprintsEqual(evaluation.manifest.fingerprint, manifest.fingerprint)
  ) {
    throw new TypeError(
      "Mechanical preservation requires the manifest and evaluation exact project, subject and Thread basis identities.",
    );
  }
}

function parseBody(root: Record<string, unknown>): MechanicalPreservationBody {
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_SCHEMA,
    "$mechanicalPreservation.schemaVersion",
  );
  const project = parseReference(root.project, "$mechanicalPreservation.project");
  const subject = parseReference(root.subject, "$mechanicalPreservation.subject");
  const basis = parseBasis(root.basis, "$mechanicalPreservation.basis");
  if (basis.projectId !== project.id || basis.subjectId !== subject.id) {
    throw new TypeError(
      "$mechanicalPreservation.basis projectId and subjectId must exactly match project and subject.",
    );
  }
  const status = parsePreservationStatus(
    root.status,
    "$mechanicalPreservation.status",
  );
  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_SCHEMA,
    manifest: parseReference(root.manifest, "$mechanicalPreservation.manifest"),
    evaluation: parseReference(
      root.evaluation,
      "$mechanicalPreservation.evaluation",
    ),
    project,
    subject,
    basis,
    reviewTrigger: parseReference(
      root.reviewTrigger,
      "$mechanicalPreservation.reviewTrigger",
    ),
    evaluatedAt: parseIsoDateTime(
      root.evaluatedAt,
      "$mechanicalPreservation.evaluatedAt",
    ),
    feaEvidence: parseFeaEvidence(
      root.feaEvidence,
      "$mechanicalPreservation.feaEvidence",
    ),
    closeout: parseCloseout(root.closeout, "$mechanicalPreservation.closeout"),
    status,
  });
}

function parseFeaEvidence(
  value: unknown,
  path: string,
): MechanicalPreservationFeaEvidence | null {
  if (value === null) return null;
  const input = exactRecord(
    value,
    ["execution", "sealedProof", "canonicalStep", "l4Evaluation", "consumptions"],
    path,
  );
  const execution = exactRecord(
    input.execution,
    ["id", "fingerprint", "producer", "kind", "freshness"],
    `${path}.execution`,
  );
  const producer = exactRecord(
    execution.producer,
    ["serverId", "tool", "runId"],
    `${path}.execution.producer`,
  );
  const sealedProof = exactRecord(
    input.sealedProof,
    ["id", "fingerprint", "producerTool"],
    `${path}.sealedProof`,
  );
  const canonicalStep = exactRecord(
    input.canonicalStep,
    ["id", "fingerprint", "kind", "mediaType"],
    `${path}.canonicalStep`,
  );
  const l4Evaluation = exactRecord(
    input.l4Evaluation,
    ["id", "fingerprint", "producerTool"],
    `${path}.l4Evaluation`,
  );
  const consumptions = nonEmptyArray(input.consumptions, `${path}.consumptions`)
    .map((item, index) =>
      parseConsumption(item, `${path}.consumptions[${index}]`, true)
    );
  rejectDuplicates(consumptions.map((item) => item.id), `${path}.consumptions ids`);
  rejectDuplicates(
    consumptions.map((item) => referenceKey(item.input)),
    `${path}.consumptions inputs`,
  );
  return {
    execution: {
      id: safeId(execution.id, `${path}.execution.id`),
      fingerprint: parseFingerprint(
        execution.fingerprint,
        `${path}.execution.fingerprint`,
      ),
      producer: {
        serverId: nonEmptyText(
          producer.serverId,
          `${path}.execution.producer.serverId`,
        ),
        tool: nonEmptyText(producer.tool, `${path}.execution.producer.tool`),
        runId: safeId(producer.runId, `${path}.execution.producer.runId`),
      },
      kind: nonEmptyText(execution.kind, `${path}.execution.kind`),
      freshness: parseFreshness(execution.freshness, `${path}.execution.freshness`),
    },
    sealedProof: {
      id: safeId(sealedProof.id, `${path}.sealedProof.id`),
      fingerprint: parseFingerprint(
        sealedProof.fingerprint,
        `${path}.sealedProof.fingerprint`,
      ),
      producerTool: nonEmptyText(
        sealedProof.producerTool,
        `${path}.sealedProof.producerTool`,
      ),
    },
    canonicalStep: {
      id: safeId(canonicalStep.id, `${path}.canonicalStep.id`),
      fingerprint: parseFingerprint(
        canonicalStep.fingerprint,
        `${path}.canonicalStep.fingerprint`,
      ),
      kind: nonEmptyText(canonicalStep.kind, `${path}.canonicalStep.kind`),
      mediaType: nonEmptyText(
        canonicalStep.mediaType,
        `${path}.canonicalStep.mediaType`,
      ),
    },
    l4Evaluation: {
      id: safeId(l4Evaluation.id, `${path}.l4Evaluation.id`),
      fingerprint: parseFingerprint(
        l4Evaluation.fingerprint,
        `${path}.l4Evaluation.fingerprint`,
      ),
      producerTool: nonEmptyText(
        l4Evaluation.producerTool,
        `${path}.l4Evaluation.producerTool`,
      ),
    },
    consumptions: [...consumptions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function parseCloseout(
  value: unknown,
  path: string,
): MechanicalPreservationCloseoutEvidence | null {
  if (value === null) return null;
  const input = exactRecord(
    value,
    ["artifact", "producerTool", "consequence", "inputs", "consumptions"],
    path,
  );
  const consequence = nonEmptyText(input.consequence, `${path}.consequence`);
  if (consequence !== "accept" && consequence !== "reject") {
    throw new TypeError(`${path}.consequence must be accept or reject.`);
  }
  const inputs = exactRecord(
    input.inputs,
    ["canonicalStep", "sealedProof", "executionEvidence", "evaluationCapture"],
    `${path}.inputs`,
  );
  const consumptions = nonEmptyArray(input.consumptions, `${path}.consumptions`)
    .map((item, index) =>
      parseConsumption(item, `${path}.consumptions[${index}]`, false)
    );
  rejectDuplicates(consumptions.map((item) => item.id), `${path}.consumptions ids`);
  return {
    artifact: parseReference(input.artifact, `${path}.artifact`),
    producerTool: nonEmptyText(input.producerTool, `${path}.producerTool`),
    consequence,
    inputs: {
      canonicalStep: parseReference(
        inputs.canonicalStep,
        `${path}.inputs.canonicalStep`,
      ),
      sealedProof: parseReference(inputs.sealedProof, `${path}.inputs.sealedProof`),
      executionEvidence: parseReference(
        inputs.executionEvidence,
        `${path}.inputs.executionEvidence`,
      ),
      evaluationCapture: parseReference(
        inputs.evaluationCapture,
        `${path}.inputs.evaluationCapture`,
      ),
    },
    consumptions: [...consumptions].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function parseConsumption(
  value: unknown,
  path: string,
  requireConsumer: boolean,
): MechanicalPreservationConsumption {
  const keys = requireConsumer
    ? ["id", "consumerEvidence", "input", "status"]
    : ["id", "input", "status"];
  const input = exactRecord(value, keys, path);
  const status = nonEmptyText(input.status, `${path}.status`);
  if (!CONSUMPTION_STATUSES.includes(status as "verified" | "mismatch")) {
    throw new TypeError(`${path}.status must be verified or mismatch.`);
  }
  return {
    id: safeId(input.id, `${path}.id`),
    ...(requireConsumer
      ? {
        consumerEvidence: parseReference(
          input.consumerEvidence,
          `${path}.consumerEvidence`,
        ),
      }
      : {}),
    input: parseReference(input.input, `${path}.input`),
    status: status as "verified" | "mismatch",
  };
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

function parsePreservationStatus(
  value: unknown,
  path: string,
): MechanicalPreservationStatus {
  const status = nonEmptyText(value, path);
  if (
    !PRESERVATION_STATUSES.includes(status as MechanicalPreservationStatus)
  ) {
    throw new TypeError(
      `${path} must be carried-forward or impact-unresolved.`,
    );
  }
  return status as MechanicalPreservationStatus;
}

function parseFreshness(value: unknown, path: string): ThreadFreshnessStatus {
  const status = nonEmptyText(value, path);
  if (!FRESHNESS.includes(status as ThreadFreshnessStatus)) {
    throw new TypeError(`${path} must be a Thread freshness status.`);
  }
  return status as ThreadFreshnessStatus;
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
