/**
 * Deterministic isolated static-proof Thread successor.
 *
 * Builds the closed nine CalculiX output artifacts plus execution evidence
 * and evaluation capture. `localOperation` and `oracleOperation` are values
 * supplied by the adapter. L4 evaluations stay oracle-derived.
 */

import { CALCULIX_ISOLATED_OUTPUT_MANIFEST } from "./calculix-isolated-execution.ts";
import type { CalculixIsolatedStaticResult } from "./calculix-isolated-execution.ts";
import {
  evaluationsFromStaticProofOracle,
  type StaticProofOracleOutcome,
} from "./static-proof-oracle-input.ts";
import type { MechanicalRequirement } from "../seal-case/mechanical-proof-case.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { EngineeringThreadEntityRef } from "../../project/engineering-project.ts";
import type {
  ProposedThreadAction,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
} from "../../thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../thread/thread-snapshot-extension.ts";

export interface StaticProofOutputReceipt {
  readonly role: string;
  readonly sha256: string;
  readonly casUri: string;
  readonly mediaType: string;
}

export interface StaticProofEvidenceProjection {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
  readonly outputs: readonly StaticProofOutputReceipt[];
  readonly metrics: CalculixIsolatedStaticResult["metrics"];
}

export interface StaticProofEvaluationProjection {
  readonly sha256: string;
  readonly uri: string;
  readonly outcomes: ReadonlyMap<string, StaticProofOracleOutcome>;
}

export interface StaticProofCompletedProjectBinding {
  readonly runStatus: string;
  readonly resultSnapshot: unknown;
  readonly evidenceRefs: unknown;
  readonly workItemStatus: string | undefined;
  readonly workItemEvidenceRefs: unknown;
  readonly expectedSnapshot: unknown;
  readonly expectedEvidenceRefs: unknown;
}

export function uniqueStaticProofRequirementTraces(
  requirements: readonly MechanicalRequirement[],
  basis: ThreadSnapshot,
  requirementsArtifactId: string,
): ReadonlyMap<string, string> {
  const requirementIds = new Map<string, string>();
  for (const requirement of requirements) {
    const matches = basis.requirements.filter((candidate) =>
      candidate.trace.sourceArtifactId === requirementsArtifactId &&
      candidate.criterion.metric === requirement.feature
    );
    if (matches.length !== 1) {
      throw new TypeError(
        `Proof requirement ${requirement.id} has no unique Thread requirement.`,
      );
    }
    requirementIds.set(requirement.id, matches[0]!.id);
  }
  return requirementIds;
}

export function buildStaticProofSuccessor(input: {
  readonly basis: ThreadSnapshot;
  readonly capturedAt: string;
  readonly localOperation: ThreadOperationRef;
  readonly oracleOperation: ThreadOperationRef;
  readonly proofArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly requirementsArtifact: ThreadArtifact;
  readonly proofRequirements: readonly MechanicalRequirement[];
  readonly evidence: StaticProofEvidenceProjection;
  readonly evaluation: StaticProofEvaluationProjection;
}): ThreadSnapshot {
  const capturedAt = input.capturedAt;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const localOperation = input.localOperation;
  const outputArtifacts = input.evidence.outputs.map((output) => ({
    id: outputArtifactId(output.role, output.sha256),
    name: `Local CalculiX ${output.role}`,
    kind: outputArtifactKind(output.role),
    version: output.sha256,
    fingerprint: { algorithm: "sha256" as const, digest: output.sha256 },
    uri: output.casUri,
    mediaType: output.mediaType,
    producer: localOperation,
    inputArtifactIds: output.role === "input.step" ? [input.geometryArtifact.id] : [
      outputArtifactId(
        "input.step",
        requiredOutput(input.evidence.outputs, "input.step").sha256,
      ),
      input.proofArtifact.id,
    ],
    freshness,
  } satisfies ThreadArtifact));
  if (outputArtifacts.length !== CALCULIX_ISOLATED_OUTPUT_MANIFEST.length) {
    throw new TypeError(
      "The local CalculiX Thread branch requires exactly nine outputs.",
    );
  }
  const resultArtifact = requiredOutputArtifact(outputArtifacts, "result.json");
  const evidenceArtifact: ThreadArtifact = {
    id: `calculix-isolated-evidence-${input.evidence.fingerprint.digest}`,
    name: "Isolated local CalculiX execution evidence",
    kind: "evidence",
    version: input.evidence.fingerprint.digest,
    fingerprint: input.evidence.fingerprint,
    uri: input.evidence.uri,
    mediaType: "application/json",
    producer: localOperation,
    inputArtifactIds: [
      input.proofArtifact.id,
      ...outputArtifacts.map((artifact) => artifact.id),
    ],
    freshness,
  };
  const evaluationArtifact: ThreadArtifact = {
    id: `calculix-isolated-syson-evaluation-${input.evaluation.sha256}`,
    name: "SysON evaluation of isolated CalculiX evidence",
    kind: "evidence",
    version: input.evaluation.sha256,
    fingerprint: { algorithm: "sha256", digest: input.evaluation.sha256 },
    uri: input.evaluation.uri,
    mediaType: "application/json",
    producer: localOperation,
    inputArtifactIds: [
      evidenceArtifact.id,
      resultArtifact.id,
      input.proofArtifact.id,
      input.requirementsArtifact.id,
    ],
    freshness,
  };
  const inputConsumptions: ThreadArtifactConsumption[] = [
    input.proofArtifact,
    input.geometryArtifact,
    input.requirementsArtifact,
  ].map((artifact) =>
    consumption(
      `calculix-isolated-input-${artifact.id}`,
      artifact.id,
      localOperation,
      artifact.fingerprint,
      capturedAt,
    )
  );
  const outputConsumptions = outputArtifacts.map((artifact) =>
    consumption(
      `calculix-isolated-cas-reread-${artifact.id}`,
      artifact.id,
      localOperation,
      artifact.fingerprint,
      capturedAt,
    )
  );
  const evidenceConsumption = consumption(
    `calculix-isolated-cas-reread-${evidenceArtifact.id}`,
    evidenceArtifact.id,
    localOperation,
    evidenceArtifact.fingerprint,
    capturedAt,
  );
  const observations: ThreadObservation[] = input.proofRequirements.map(
    (requirement) => {
      const metric = requirement.metric === "maximum-displacement"
        ? input.evidence.metrics.maximumDisplacement
        : input.evidence.metrics.maximumVonMises;
      return {
        id:
          `calculix-isolated-observation-${resultArtifact.fingerprint.digest}-${requirement.id}`,
        name: `${requirement.name} measured by local CalculiX`,
        metric: requirement.feature,
        quantity: { value: metric.value, unit: metric.unit },
        source: {
          operation: localOperation,
          artifactIds: [resultArtifact.id, evidenceArtifact.id],
          capturedAt,
        },
        freshness,
      };
    },
  );
  const requirementIds = uniqueStaticProofRequirementTraces(
    input.proofRequirements,
    input.basis,
    input.requirementsArtifact.id,
  );
  const evaluations = evaluationsFromStaticProofOracle(
    input.evaluation.outcomes,
    input.proofRequirements,
    {
      verdictCaptureFp: input.evaluation.sha256,
      evaluatedAt: capturedAt,
      evidenceArtifactId: evaluationArtifact.id,
      observationIds: observations.map((observation) => observation.id),
      threadRequirementIds: requirementIds,
      evaluator: input.oracleOperation,
    },
  );
  const violations: ThreadViolation[] = evaluations.flatMap((item) =>
    item.status === "fail"
      ? [{
        id: `${item.id}-violation`,
        name: `${item.name} exceeds the reviewed limit`,
        requirementId: item.requirementId,
        evaluationId: item.id,
        severity: "error" as const,
        status: "open" as const,
        detectedAt: capturedAt,
        observationIds: item.observationIds,
        evidenceArtifactIds: [evidenceArtifact.id, evaluationArtifact.id],
        summary: item.message,
        freshness,
      }]
      : []
  );
  const actions: ProposedThreadAction[] = violations.map((violation) => ({
    id: `${violation.id}-review`,
    name: `Review local CalculiX violation: ${violation.name}`,
    kind: "review",
    readiness: "ready",
    rationale: "A human review is required for a failed engineering constraint.",
    targets: [{ kind: "artifact", id: resultArtifact.id }],
    addressesViolationIds: [violation.id],
    dependsOnActionIds: [],
  }));
  const consumptions = [
    ...inputConsumptions,
    ...outputConsumptions,
    evidenceConsumption,
  ];
  const newArtifacts = [
    ...outputArtifacts,
    evidenceArtifact,
    evaluationArtifact,
  ];
  const provenance: ThreadProvenanceLink[] = [
    ...newArtifacts.flatMap((artifact) =>
      artifact.inputArtifactIds.map((inputArtifactId) =>
        derived(
          artifact.id,
          inputArtifactId,
          "The downstream local evidence was derived from this exact fingerprint-attested input.",
        )
      )
    ),
    ...consumptions.map(uses),
    ...observations.flatMap((observation) =>
      observation.source.artifactIds.map((artifactId) => ({
        id: `${observation.id}-from-${artifactId}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: artifactId },
        rationale:
          "The observation is reported by the exact local result and its durable execution evidence.",
      }))
    ),
    ...evaluations.flatMap((item) =>
      item.observationIds.map((observationId) => ({
        id: `${item.id}-uses-${observationId}`,
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "observation" as const, id: observationId },
        rationale: "SysON evaluated this exact observed quantity.",
      }))
    ),
    ...evaluations.map((item) => ({
      id: `${item.id}-evaluates-requirement`,
      relation: "evaluates" as const,
      from: { kind: "evaluation" as const, id: item.id },
      to: { kind: "requirement" as const, id: item.requirementId },
      rationale: "SysON evaluated the reviewed Thread requirement.",
    })),
    ...evaluations.map((item) => ({
      id: `${item.id}-evidenced-by-capture`,
      relation: "evidences" as const,
      from: { kind: "evaluation" as const, id: item.id },
      to: { kind: "artifact" as const, id: evaluationArtifact.id },
      rationale: "The immutable SysON envelope is the evaluation evidence.",
    })),
    ...violations.flatMap((item) => [
      {
        id: `caused-by-${item.id}`,
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "evaluation" as const, id: item.evaluationId },
        rationale:
          "The named violation is caused by the failing local CalculiX evaluation.",
      },
      ...item.evidenceArtifactIds.map((artifactId) => ({
        id: `evidences-${item.id}-${artifactId}`,
        relation: "evidences" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "artifact" as const, id: artifactId },
        rationale:
          "The named violation is evidenced by the exact local CalculiX evidence artifact.",
      })),
    ]),
    ...actions.flatMap((item) =>
      item.addressesViolationIds.map((violationId) => ({
        id: `addresses-${item.id}`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: item.id },
        to: { kind: "violation" as const, id: violationId },
        rationale: "The proposed review addresses the named local CalculiX violation.",
      }))
    ),
  ];
  const extension: ThreadSnapshotExtension = {
    id: `calculix-isolated-${localOperation.runId}`,
    name: "Isolated local CalculiX static proof",
    subjectId: input.basis.subject.id,
    capturedAt,
    artifacts: newArtifacts,
    consumptions,
    observations,
    requirements: [],
    evaluations,
    violations,
    provenance,
    proposedActions: actions,
  };
  return applyThreadSnapshotExtensionIfNew(
    input.basis,
    extension,
    { appliedAt: capturedAt },
  ).snapshot;
}

export function assertExactStaticProofLocalArtifacts(
  snapshot: ThreadSnapshot,
  localOperation: ThreadOperationRef,
): readonly ThreadArtifact[] {
  const artifacts = snapshot.artifacts.filter((artifact) =>
    artifact.producer.serverId === localOperation.serverId &&
    artifact.producer.tool === localOperation.tool &&
    artifact.producer.runId === localOperation.runId
  );
  if (
    artifacts.length !== 11 ||
    artifacts.filter((artifact) => artifact.name.startsWith("Local CalculiX "))
        .length !== 9 ||
    artifacts.filter((artifact) =>
        artifact.name === "Isolated local CalculiX execution evidence"
      ).length !== 1 ||
    artifacts.filter((artifact) =>
        artifact.name === "SysON evaluation of isolated CalculiX evidence"
      ).length !== 1
  ) {
    throw new TypeError(
      "The isolated CalculiX completion requires exactly nine outputs, execution evidence and SysON evidence.",
    );
  }
  return artifacts;
}

export function exactStaticProofEvidenceRefs(
  snapshot: ThreadSnapshot,
  localOperation: ThreadOperationRef,
): readonly EngineeringThreadEntityRef[] {
  return assertExactStaticProofLocalArtifacts(snapshot, localOperation).map(
    (artifact) => ({
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: artifact.id,
    }),
  );
}

export function assertExactCompletedStaticProofProjectBinding(
  binding: StaticProofCompletedProjectBinding,
): void {
  if (
    binding.runStatus !== "completed" ||
    deterministicJson(binding.resultSnapshot) !==
      deterministicJson(binding.expectedSnapshot) ||
    deterministicJson(binding.evidenceRefs) !==
      deterministicJson(binding.expectedEvidenceRefs) ||
    binding.workItemStatus !== "completed" ||
    deterministicJson(binding.workItemEvidenceRefs) !==
      deterministicJson(binding.expectedEvidenceRefs)
  ) {
    throw new TypeError(
      "The completed project run and work item do not bind the exact isolated CalculiX snapshot and evidence refs.",
    );
  }
}

function outputArtifactId(role: string, digest: string): string {
  return `calculix-isolated-${role.replaceAll(".", "-")}-${digest}`;
}

function outputArtifactKind(role: string): ThreadArtifact["kind"] {
  if (role === "input.step" || role === "request.json") return "solver-input";
  if (role.startsWith("mesh.")) return "mesh";
  if (role === "result.json") return "solver-result";
  return "evidence";
}

function requiredOutput(
  outputs: readonly StaticProofOutputReceipt[],
  role: string,
): StaticProofOutputReceipt {
  const matches = outputs.filter((output) => output.role === role);
  if (matches.length !== 1) {
    throw new TypeError(
      `The isolated CalculiX evidence has no unique ${role} output.`,
    );
  }
  return matches[0]!;
}

function requiredOutputArtifact(
  artifacts: readonly ThreadArtifact[],
  role: string,
): ThreadArtifact {
  const prefix = `calculix-isolated-${role.replaceAll(".", "-")}-`;
  const matches = artifacts.filter((artifact) => artifact.id.startsWith(prefix));
  if (matches.length !== 1) {
    throw new TypeError(
      `The local CalculiX Thread branch has no unique ${role} artifact.`,
    );
  }
  return matches[0]!;
}

function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadOperationRef,
  observedFingerprint: ContentFingerprint,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint,
    verifiedAt,
    status: "verified",
  };
}

function derived(
  from: string,
  to: string,
  rationale: string,
): ThreadProvenanceLink {
  return {
    id: `${from}-from-${to}`,
    relation: "derived_from",
    from: { kind: "artifact", id: from },
    to: { kind: "artifact", id: to },
    rationale,
  };
}

function uses(entry: ThreadArtifactConsumption): ThreadProvenanceLink {
  return {
    id: `${entry.id}-uses`,
    relation: "uses",
    from: { kind: "consumption", id: entry.id },
    to: { kind: "artifact", id: entry.artifactId },
    rationale: "Exact bytes were reread and fingerprint-attested.",
  };
}
