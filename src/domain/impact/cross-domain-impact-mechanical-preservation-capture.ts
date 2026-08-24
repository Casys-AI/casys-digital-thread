/**
 * Canonical, provider-free record of one mechanical preservation recross.
 *
 * The capture documents whether existing FEA proof/closeout evidence remains
 * legally carried-forward after the X09 impact decision. It never mutates a
 * gate claim, queues a rerun, or calls CalculiX.
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
import type { CrossDomainImpactManifestSealBriefGate } from "./cross-domain-impact-manifest-proposal.ts";
import {
  type CrossDomainImpactReference,
  parseCrossDomainImpactBranchId,
} from "./cross-domain-impact-manifest.ts";
import {
  ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
  MECHANICAL_PRESERVATION_LIMITS,
} from "./cross-domain-impact-mechanical-preservation-proposal.ts";
import {
  type MechanicalPreservation,
  validateMechanicalPreservation,
} from "./cross-domain-impact-mechanical-preservation.ts";

export const CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_SCHEMA =
  "cross-domain-impact-mechanical-preservation-capture/2.0" as const;
export const CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_URI_PREFIX =
  "casys://cross-domain-impact-mechanical-preservation-capture/sha256/" as const;

export interface MechanicalPreservationCapture {
  readonly schemaVersion:
    typeof CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_SCHEMA;
  readonly kind: "cross-domain-impact-mechanical-preservation";
  readonly operation: typeof ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION;
  readonly trustedRunId: string;
  readonly evaluatedAt: string;
  readonly decision: {
    readonly artifact: CrossDomainImpactReference;
    readonly trustedRunId: string;
  };
  readonly evaluation: {
    readonly artifact: CrossDomainImpactReference;
    readonly trustedRunId: string;
  };
  readonly manifestSeal: {
    readonly artifact: CrossDomainImpactReference;
    readonly trustedRunId: string;
  };
  readonly artifactInputs: readonly CrossDomainImpactReference[];
  readonly manifest: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly reference: ContentFingerprint;
  };
  readonly brief: {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
    readonly gates: readonly CrossDomainImpactManifestSealBriefGate[];
  };
  readonly preservation: MechanicalPreservation;
  readonly limits: typeof MECHANICAL_PRESERVATION_LIMITS;
}

const ROOT_KEYS = [
  "schemaVersion",
  "kind",
  "operation",
  "trustedRunId",
  "evaluatedAt",
  "decision",
  "evaluation",
  "manifestSeal",
  "artifactInputs",
  "manifest",
  "brief",
  "preservation",
  "limits",
] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const GATE_ROLES = ["contributes-to", "satisfies"] as const;

export function crossDomainImpactMechanicalPreservationCaptureUri(
  digest: string,
): string {
  return `${CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_URI_PREFIX}${digest}`;
}

export async function validateMechanicalPreservationCapture(
  value: unknown,
): Promise<MechanicalPreservationCapture> {
  const root = exactRecord(value, ROOT_KEYS, "$mechanicalPreservationCapture");
  literalValue(
    root.schemaVersion,
    CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_SCHEMA,
    "$mechanicalPreservationCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "cross-domain-impact-mechanical-preservation",
    "$mechanicalPreservationCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$mechanicalPreservationCapture.operation",
  );
  literalValue(
    operation.id,
    ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.id,
    "$mechanicalPreservationCapture.operation.id",
  );
  literalValue(
    operation.version,
    ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION.version,
    "$mechanicalPreservationCapture.operation.version",
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    "$mechanicalPreservationCapture.trustedRunId",
  );
  const evaluatedAt = parseIsoDateTime(
    root.evaluatedAt,
    "$mechanicalPreservationCapture.evaluatedAt",
  );
  const decision = parseNamedCapture(
    root.decision,
    "$mechanicalPreservationCapture.decision",
  );
  const evaluation = parseNamedCapture(
    root.evaluation,
    "$mechanicalPreservationCapture.evaluation",
  );
  const manifestSeal = parseNamedCapture(
    root.manifestSeal,
    "$mechanicalPreservationCapture.manifestSeal",
  );
  const artifactInputs = parseArtifactInputs(
    root.artifactInputs,
    "$mechanicalPreservationCapture.artifactInputs",
  );
  const manifest = parseManifest(
    root.manifest,
    "$mechanicalPreservationCapture.manifest",
  );
  const brief = parseBrief(root.brief, "$mechanicalPreservationCapture.brief");
  const preservation = await validateMechanicalPreservation(root.preservation);
  const limits = parseLimits(root.limits, "$mechanicalPreservationCapture.limits");

  if (preservation.evaluatedAt !== evaluatedAt) {
    throw new TypeError(
      "$mechanicalPreservationCapture.evaluatedAt must equal preservation.evaluatedAt.",
    );
  }
  if (
    preservation.manifest.id !== manifest.id ||
    !fingerprintsEqual(preservation.manifest.fingerprint, manifest.fingerprint)
  ) {
    throw new TypeError(
      "$mechanicalPreservationCapture.manifest must exactly identify preservation.manifest.",
    );
  }
  if (
    preservation.evaluation.id !==
      `cross-domain-impact-evaluation-${preservation.evaluation.fingerprint.digest}`
  ) {
    throw new TypeError(
      "$mechanicalPreservationCapture.preservation.evaluation.id must derive from the evaluation body digest.",
    );
  }
  assertArtifactInputs(
    artifactInputs,
    decision,
    evaluation,
    manifestSeal,
    preservation,
  );

  return deepFreeze({
    schemaVersion: CROSS_DOMAIN_IMPACT_MECHANICAL_PRESERVATION_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-mechanical-preservation",
    operation: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
    trustedRunId,
    evaluatedAt,
    decision,
    evaluation,
    manifestSeal,
    artifactInputs,
    manifest,
    brief,
    preservation,
    limits,
  });
}

function parseNamedCapture(
  value: unknown,
  path: string,
): { artifact: CrossDomainImpactReference; trustedRunId: string } {
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
): MechanicalPreservationCapture["manifest"] {
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
): MechanicalPreservationCapture["brief"] {
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
  if (!GATE_ROLES.includes(role as "contributes-to" | "satisfies")) {
    throw new TypeError(`${path}.role must be contributes-to or satisfies.`);
  }
  const dependsOnItemIds = arrayOf(input.dependsOnItemIds, `${path}.dependsOnItemIds`)
    .map((item, index) => safeId(item, `${path}.dependsOnItemIds[${index}]`));
  rejectDuplicates(dependsOnItemIds, `${path}.dependsOnItemIds`);
  const ordered = [...dependsOnItemIds].sort((left, right) =>
    left.localeCompare(right)
  );
  if (ordered.some((item, index) => item !== dependsOnItemIds[index])) {
    throw new TypeError(`${path}.dependsOnItemIds must be canonically ordered.`);
  }
  const branchId = parseCrossDomainImpactBranchId(input.branchId, `${path}.branchId`);
  return {
    gateItemId: safeId(input.gateItemId, `${path}.gateItemId`),
    kind,
    branchId,
    role: role as "contributes-to" | "satisfies",
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    dependsOnItemIds: ordered,
  };
}

function parseLimits(
  value: unknown,
  path: string,
): typeof MECHANICAL_PRESERVATION_LIMITS {
  const input = exactRecord(
    value,
    [
      "providerCalls",
      "solverCalls",
      "gateClaimTransitions",
      "workItemInvalidations",
      "rerunProposals",
      "newWorkItems",
    ],
    path,
  );
  literalValue(input.providerCalls, "none", `${path}.providerCalls`);
  literalValue(input.solverCalls, "none", `${path}.solverCalls`);
  literalValue(input.gateClaimTransitions, "none", `${path}.gateClaimTransitions`);
  literalValue(input.workItemInvalidations, "none", `${path}.workItemInvalidations`);
  literalValue(input.rerunProposals, "none", `${path}.rerunProposals`);
  literalValue(input.newWorkItems, "none", `${path}.newWorkItems`);
  return MECHANICAL_PRESERVATION_LIMITS;
}

function assertArtifactInputs(
  artifactInputs: readonly CrossDomainImpactReference[],
  decision: MechanicalPreservationCapture["decision"],
  evaluation: MechanicalPreservationCapture["evaluation"],
  manifestSeal: MechanicalPreservationCapture["manifestSeal"],
  preservation: MechanicalPreservation,
): void {
  const required = [
    decision.artifact,
    evaluation.artifact,
    manifestSeal.artifact,
  ];
  if (preservation.feaEvidence) {
    required.push({
      id: preservation.feaEvidence.execution.id,
      fingerprint: preservation.feaEvidence.execution.fingerprint,
    });
    required.push({
      id: preservation.feaEvidence.sealedProof.id,
      fingerprint: preservation.feaEvidence.sealedProof.fingerprint,
    });
    required.push({
      id: preservation.feaEvidence.canonicalStep.id,
      fingerprint: preservation.feaEvidence.canonicalStep.fingerprint,
    });
    required.push({
      id: preservation.feaEvidence.l4Evaluation.id,
      fingerprint: preservation.feaEvidence.l4Evaluation.fingerprint,
    });
    for (const consumption of preservation.feaEvidence.consumptions) {
      required.push(consumption.input);
    }
  }
  if (preservation.closeout) required.push(preservation.closeout.artifact);
  for (const expected of required) {
    const match = artifactInputs.find((item) =>
      item.id === expected.id &&
      fingerprintsEqual(item.fingerprint, expected.fingerprint)
    );
    if (!match) {
      throw new TypeError(
        "$mechanicalPreservationCapture.artifactInputs must include every exact recrossed document.",
      );
    }
  }
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

function parseIsoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_DATE_TIME.test(text) || Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp.`);
  }
  return text;
}

function referenceKey(value: CrossDomainImpactReference): string {
  return `${value.id}:${value.fingerprint.algorithm}:${value.fingerprint.digest}`;
}
